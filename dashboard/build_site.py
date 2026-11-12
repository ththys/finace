"""kospi.db → 사이트(GitHub Pages)용 공개 데이터 파일 (site_data/ → 저장소의 data/)

python build_site.py [출력폴더]      (기본: ./site_data · 보통은 publish_site.py 가 호출)

  meta.json         기준일(asof), 첫 날짜, 파일 목록(chunks·vchunks·ochunks·extra), 만든 시각(built)
  stocks.json       종목 [{t 코드, n 이름, s 섹터, m 시장, cap 시총(억)}] 시총순
  home.json         첫 화면: 시장 등락, 섹터 표, 등락률 상위, 마감 브리핑
  px/Y2019.json     지난 해 종가 (한 번 만들면 안 바뀜)      {"d": [날짜], "t": [종목], "c": [[종목별 값]]}
  px/M2026-11.json  올해는 월별 (그 달 파일만 매일 바뀜 → 올리는 양이 작음)
  vol/...           거래량 (같은 형식)
  ohlc/{묶음}/...   종목별 시가·고가·저가·종가·거래량 {"d","t","o","h","l","c","v"} — 묶음 = bucket(종목), 한 종목 볼 때 1/16 만 받게
  flow·etf·macro·gex·fund_last.json, fund/{묶음}/...   수급·파생·매크로·PER/PBR (flowsite.py)
화면은 필요한 기간의 파일만 받아서 수익률·MDD·상대강도를 브라우저에서 계산. 개인 데이터(관심종목·리포트·종목 수급)는 여기 없고 Firebase 에만.
"""
import json
import os
import time
import sqlite3
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def _num(x, nd=2):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return None
    r = round(float(x), nd)
    return int(r) if r == int(r) and nd >= 0 and abs(r) > 100 else r


def _px(v):
    if v is None or not np.isfinite(v):
        return None
    return int(round(v)) if abs(v - round(v)) < 1e-6 else round(float(v), 2)


def load(db_path):
    conn = sqlite3.connect(db_path)
    stocks = pd.read_sql("SELECT ticker, name, sector, market_cap FROM stocks", conn).set_index("ticker")
    try:
        master = pd.read_sql("SELECT ticker, market FROM ticker_master", conn).set_index("ticker")["market"]
    except Exception:
        master = pd.Series(dtype=str)
    stocks["market"] = master.reindex(stocks.index).fillna("KOSPI")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(prices)")}
    vsel = ", volume" if "volume" in cols else ""
    px = pd.read_sql(f"SELECT ticker, date, close{vsel} FROM prices", conn)
    px = px[px["ticker"].isin(stocks.index)]
    close = px.pivot(index="date", columns="ticker", values="close").sort_index()
    close.index = pd.to_datetime(close.index)
    if vsel and px["volume"].notna().any():
        volume = px.pivot(index="date", columns="ticker", values="volume").reindex(index=close.index.strftime("%Y-%m-%d"))
        volume.index = close.index
    else:
        volume = None
    conn.close()
    return stocks, close, volume


# ---------------- 시총가중 지수 (사이트 core.js 의 capIndex 와 같은 방식) ----------------

def cap_index(close, caps, base_date):
    """기준일 시총가중 지수 (기준일=100). 기준일에 값 없는 종목 제외"""
    w = close.loc[:pd.Timestamp(base_date)]
    if w.empty:
        return pd.Series(dtype=float)
    base_row = close.loc[w.index[-1]]
    win = close.loc[w.index[-1]:].ffill()
    ok = base_row.notna()
    norm = win.loc[:, ok] / base_row[ok]
    last = close.ffill().iloc[-1][ok]
    wt = caps.reindex(norm.columns) * base_row[ok] / last
    wt = wt.fillna(0)
    return (norm * wt).sum(axis=1) / wt.sum() * 100


def pct(a, b):
    return (a / b - 1) * 100 if b and np.isfinite(a) and np.isfinite(b) else None


def build_home(stocks, close):
    cf = close.ffill()
    dates = cf.index
    d0 = dates[-1]
    d1 = dates[-2]
    caps = stocks["market_cap"]

    def ago(**kw):
        t = d0 - pd.DateOffset(**kw)
        return dates[dates <= t][-1]

    ytd_base = dates[dates <= pd.Timestamp(year=d0.year - 1, month=12, day=31)][-1]
    bases = {"1D": d1, "1W": ago(weeks=1), "1M": ago(months=1), "3M": ago(months=3), "YTD": ytd_base,
             "1Y": ago(years=1)}

    # 시장 지수: 코스피 / 코스닥 종목을 각각 시총가중
    mk_of = stocks["market"].reindex(close.columns).fillna("KOSPI")
    cols = {m: [t for t in close.columns if mk_of[t] == m] for m in ("KOSPI", "KOSDAQ")}

    def mkt_chg(m):
        sub, c = close[cols[m]], caps.reindex(cols[m])
        return {k: _num(pct(cap_index(sub, c, b).iloc[-1], 100)) for k, b in bases.items()}

    mkt_long = cap_index(close[cols["KOSPI"]], caps.reindex(cols["KOSPI"]), ago(years=1))
    market = {
        "name": "코스피 시총가중",
        "chg": mkt_chg("KOSPI"),
        "kq": mkt_chg("KOSDAQ") if len(cols["KOSDAQ"]) >= 20 else None,
        "n": {m: len(v) for m, v in cols.items()},
        "spark": {"v": [_num(v) for v in mkt_long.iloc[-120:]]},   # 최근 120거래일 (1년 전 = 100)
    }
    today = (cf.loc[d0] / cf.loc[d1] - 1) * 100
    today = today[cf.loc[d0].notna() & cf.loc[d1].notna()]
    market["breadth"] = {"up": int((today > 0).sum()), "down": int((today < 0).sum()),
                         "flat": int((today == 0).sum())}

    # 등락률 1위 (브리핑 문장용)
    def extremes(series):
        s = series.dropna().sort_values(ascending=False)
        fmt = lambda t, v: {"n": stocks.at[t, "name"], "chg": _num(v)}
        return fmt(s.index[0], s.iloc[0]), fmt(s.index[-1], s.iloc[-1])

    up1, dn1 = extremes(today)
    upy, _ = extremes((cf.loc[d0] / cf.loc[ytd_base] - 1) * 100)

    # 섹터
    secs = []
    mkt20s = {m: cap_index(close[v], caps.reindex(v), ago(days=45)) for m, v in cols.items() if v}
    for sec, grp in stocks.groupby("sector"):
        t = [x for x in grp.index if x in close.columns]
        if not t:
            continue
        sub = close[t]
        c = caps[t]
        row = {"s": sec, "k": len(t)}
        for k, b in bases.items():
            idx = cap_index(sub, c, b)
            row[k] = _num(pct(idx.iloc[-1], 100)) if len(idx) else None
        # RS 20거래일 변화: (섹터/시장) 비율 변화
        si = cap_index(sub, c, ago(days=45))
        home_mkt = mk_of.reindex(t).mode().iloc[0]
        rs = (si / mkt20s[home_mkt] * 100).dropna()
        row["rs20"] = _num(rs.iloc[-1] - rs.iloc[-21]) if len(rs) > 21 else None
        secs.append(row)
    secs.sort(key=lambda r: -(r["1D"] or -999))

    # 브리핑 (규칙 기반 문장)
    m1 = market["chg"]["1D"] or 0
    br = market["breadth"]
    top3 = [s for s in secs if s["k"] >= 3][:3]
    bot3 = [s for s in secs if s["k"] >= 3][-3:][::-1]
    brief = [
        f"코스피 시총가중 {m1:+.2f}%" + (f" · 코스닥 {market['kq']['1D']:+.2f}%" if market.get("kq") and market["kq"]["1D"] is not None else "")
        + f". 상승 {br['up']} · 하락 {br['down']} · 보합 {br['flat']}.",
        "강한 섹터: " + ", ".join(f"{s['s']} {s['1D']:+.2f}%" for s in top3),
        "약한 섹터: " + ", ".join(f"{s['s']} {s['1D']:+.2f}%" for s in bot3),
        f"상승률 1위 {up1['n']} {up1['chg']:+.2f}% · 하락률 1위 {dn1['n']} {dn1['chg']:+.2f}%",
        f"올해 수익률(YTD) 시장 {market['chg']['YTD']:+.2f}% · 1위 {upy['n']} {upy['chg']:+.1f}%",
    ]

    return {"asof": d0.strftime("%Y-%m-%d"), "market": market, "sectors": secs, "brief": brief}


def write_prices(close, out_dir, sub="px", conv=None):
    """지난 해는 연 단위, 올해는 월 단위 파일 (sub='vol' 이면 거래량)"""
    conv = conv or _px
    os.makedirs(os.path.join(out_dir, sub), exist_ok=True)
    last_year = close.index[-1].year
    chunks = []
    for y, grp in close.groupby(close.index.year):
        if y < last_year:
            chunks.append((f"Y{y}", grp))
        else:
            for m, g2 in grp.groupby(grp.index.month):
                chunks.append((f"M{y}-{m:02d}", g2))
    names = []
    for name, g in chunks:
        g = g.dropna(axis=1, how="all")
        doc = {"d": [d.strftime("%Y-%m-%d") for d in g.index], "t": list(g.columns),
               "c": [[conv(v) for v in g[t].to_numpy()] for t in g.columns]}
        with open(os.path.join(out_dir, sub, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        names.append(name)
    return names


OHLC_BUCKETS = 16


def bucket(t):
    """종목 → 시가·고가·저가 파일 묶음 번호 (한 종목 볼 때 1/16 크기만 받게)"""
    return sum(map(ord, t)) % OHLC_BUCKETS


def write_ohlc(db_path, out_dir, close_index):
    """ohlc/{묶음}/{Y2019|M2026-11}.json = {"d","t","o","h","l"} (고가·저가 없는 옛날 날은 null)"""
    conn = sqlite3.connect(db_path)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(prices)")}
    hl = ", high, low" if "high" in cols else ", NULL AS high, NULL AS low"
    vv = ", volume" if "volume" in cols else ", NULL AS volume"
    df = pd.read_sql(f"SELECT ticker, date, open{hl}, close{vv} FROM prices", conn)
    conn.close()
    df = df[df["ticker"].isin(set(close_index))] if close_index is not None else df
    df["date"] = pd.to_datetime(df["date"])
    df["b"] = df["ticker"].map(bucket)
    last_year = df["date"].max().year
    names = set()
    for bk, g in df.groupby("b"):
        piv = {k: g.pivot(index="date", columns="ticker", values=k).sort_index() for k in ("open", "high", "low", "close", "volume")}
        idx = piv["open"].index
        keys = idx.year.map(lambda y: f"Y{y}") .where(idx.year < last_year, idx.strftime("M%Y-%m"))
        os.makedirs(os.path.join(out_dir, "ohlc", str(bk)), exist_ok=True)
        for name in sorted(set(keys)):
            m = keys == name
            o, h, l, c, v = (piv[k].loc[m] for k in ("open", "high", "low", "close", "volume"))
            keep = [t for t in c.columns if c[t].notna().any()]
            def arr(df, t, conv):
                xs = [conv(x) for x in df[t].to_numpy()]
                return xs if any(x is not None for x in xs) else None  # 전부 비면 null 하나로
            iv = lambda x: None if pd.isna(x) else int(x)
            doc = {"d": [d.strftime("%Y-%m-%d") for d in o.index], "t": keep,
                   "o": [arr(o, t, _px) for t in keep], "h": [arr(h, t, _px) for t in keep], "l": [arr(l, t, _px) for t in keep],
                   "c": [arr(c, t, _px) for t in keep], "v": [arr(v, t, iv) for t in keep]}
            with open(os.path.join(out_dir, "ohlc", str(bk), f"{name}.json"), "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            names.add(name)
    order = lambda n: (n[1:5], n)
    return sorted(names, key=order)


def build(db_path, out_dir):
    t0 = time.time()
    step = lambda m: print(f"  [사이트 만들기] {m} ({time.time() - t0:,.0f}초)", flush=True)
    step("DB 읽는 중")
    stocks, close, volume = load(db_path)
    os.makedirs(out_dir, exist_ok=True)
    step("홈·종가 파일")
    home = build_home(stocks, close)
    chunks = write_prices(close, out_dir)
    vchunks = []
    if volume is not None:
        vchunks = write_prices(volume, out_dir, "vol",
                               lambda v: None if v is None or not np.isfinite(v) else int(v))
    st = [{"t": t, "n": r["name"], "s": r["sector"], "m": r["market"], "cap": round(float(r["market_cap"]) / 1e8)}
          for t, r in stocks.sort_values("market_cap", ascending=False).iterrows()]
    step("일봉(시가·고가·저가) 파일")
    try:
        ochunks = write_ohlc(db_path, out_dir, close.columns)
    except Exception as e:
        print(f"시가·고가·저가 파일 실패: {e}")
        ochunks = []
    meta = {"asof": home["asof"], "first": close.index[0].strftime("%Y-%m-%d"), "chunks": chunks, "vchunks": vchunks,
            "ochunks": ochunks, "obuckets": OHLC_BUCKETS,
            "built": pd.Timestamp.now(tz="Asia/Seoul").strftime("%Y-%m-%d %H:%M")}

    def dump(name, obj):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

    step("수급·매크로·PER 파일")
    try:
        import flowsite
        meta["extra"] = flowsite.build(db_path, out_dir)
    except Exception as e:
        print(f"수급 데이터 만들기 실패: {e}")
        meta["extra"] = []
    dump("meta.json", meta)
    dump("stocks.json", st)
    dump("home.json", home)
    step("완료")
    return meta


if __name__ == "__main__":
    db = os.path.join(HERE, "kospi.db")
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "site_data")
    m = build(db, out)
    print(f"사이트 데이터 생성 완료: {out} (기준일 {m['asof']}, 종가 파일 {len(m['chunks'])}개)")
