"""수급·파생·매크로 → 사이트용 JSON (build_site.py 가 호출)

flow.json   투자자별 순매수 (억원, 일별)
etf.json    레버리지·인버스 ETF 순자산·자금 유출입 (억원)
macro.json  VIX·VKOSPI·달러·엔·금리·유동성
gex.json    코스피200 옵션 감마 노출 (딜러 포지션 가정 포함, 추정치)
"""
import json
import math
import os
import sqlite3

import numpy as np
import pandas as pd

MULT = 250_000      # 코스피200 옵션 승수 (원/포인트)
RATE = 0.03         # 무위험이자율 가정
INV_ORDER = ["외국인합계", "개인", "기관합계", "연기금", "금융투자", "투신", "사모", "보험", "은행", "기타금융", "기타법인"]


def _r(x, nd=0):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(x):
        return None
    v = round(x, nd)
    return int(v) if nd == 0 else v


def _tables(conn):
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


# ---------------- 투자자별 ----------------

def build_flow(conn):
    df = pd.read_sql("SELECT * FROM flow", conn)
    if df.empty:
        return None
    out = {"m": {}}
    dates = sorted(df["date"].unique())
    out["d"] = dates
    for mkt, g in df.groupby("market"):
        p = g.pivot(index="date", columns="investor", values="value").reindex(dates)
        if "외국인합계" not in p and "외국인" in p:
            p["외국인합계"] = p["외국인"] + p.get("기타외국인", 0)
        inst = [c for c in ["금융투자", "보험", "투신", "사모", "은행", "기타금융", "연기금"] if c in p]
        if "기관합계" not in p and inst:
            p["기관합계"] = p[inst].sum(axis=1, min_count=1)
        out["m"][mkt] = {c: [_r(v / 1e8) for v in p[c]] for c in INV_ORDER if c in p}
    return out


# ---------------- ETF ----------------

def build_etf(conn):
    import flows
    df = pd.read_sql("SELECT * FROM etf ORDER BY date", conn)
    if df.empty:
        return None
    dates = sorted(df["date"].unique())
    lst = []
    for t, g in df.groupby("ticker"):
        g = g.set_index("date").reindex(dates)
        sh = g["shares"].ffill()
        flow = (sh.diff() * g["nav"]).fillna(0) / 1e8
        aum = g["aum"].where(g["aum"] > 0, sh * g["nav"]) / 1e8
        n, k = flows.ETFS.get(t, (t, "lev"))
        lst.append({"t": t, "n": n, "k": k, "aum": [_r(v) for v in aum], "flow": [_r(v) for v in flow]})
    return {"d": dates, "list": lst}


# ---------------- 매크로 ----------------

def build_macro(conn):
    df = pd.read_sql("SELECT * FROM macro", conn)
    if df.empty:
        return None
    S = {k: g.set_index(pd.to_datetime(g["date"]))["value"].sort_index() for k, g in df.groupby("series")}
    out = {}

    def put(key, s, since="2010-01-01", nd=2):
        s = s.dropna()
        if since:
            s = s[s.index >= since]
        if len(s):
            out[key] = {"d": [d.strftime("%Y-%m-%d") for d in s.index], "v": [_r(v, nd) for v in s]}

    for k in ["VIXCLS", "VKOSPI", "DGS2", "DGS10", "T5YIE", "DFII5", "DEXKOUS", "DXY"] + ([] if "DXY" in S else ["DTWEXBGS"]):
        if k in S:
            put(k, S[k])
    for k in ("IDX_KOSPI", "IDX_KOSDAQ"):  # 지수 종가 (2007년~, 밴드 그리기용)
        if k in S:
            put(k, S[k], since=None)
    if "DEXJPUS" in S:  # 1971년부터, 주간으로 줄임
        put("DEXJPUS", S["DEXJPUS"].resample("W-FRI").last(), since=None)
    dollar = S.get("DXY", S.get("DTWEXBGS"))
    if dollar is not None:
        lr = np.log(dollar).diff()
        put("DXY_RV10", lr.rolling(10).std() * math.sqrt(252) * 100)
        put("DXY_RV30", lr.rolling(30).std() * math.sqrt(252) * 100)
    if "DGS2" in S and "T5YIE" in S:
        put("REAL2", (S["DGS2"] - S["T5YIE"].reindex(S["DGS2"].index).ffill()))
    if "DGS10" in S and "DGS3MO" in S:
        curve = (S["DGS10"] - S["DGS3MO"]).dropna()
        put("CURVE", curve)
        prev = curve.reindex(curve.index - pd.DateOffset(years=1), method="ffill").to_numpy()
        put("CURVE_CHG", pd.Series((curve.to_numpy() - prev) * 100, index=curve.index), nd=0)

    def bil(s):  # 단위를 10억 달러로 맞춤 (FRED 단위가 백만이면 /1000)
        return s / 1000 if s.dropna().median() > 20_000 else s

    if "WALCL" in S:
        w = bil(S["WALCL"])
        tga = bil(S["WTREGEN"]).reindex(w.index, method="ffill") if "WTREGEN" in S else 0
        rrp = bil(S["RRPONTSYD"]).reindex(w.index, method="ffill").fillna(0) if "RRPONTSYD" in S else 0
        put("WALCL", w, nd=0)
        put("NETLIQ", w - tga - rrp, nd=0)
    if "M2SL" in S:
        m2 = S["M2SL"]
        put("M2", m2 / 1000, nd=2)
        put("M2YOY", m2.pct_change(12) * 100)
    out["_asof"] = {k: v["d"][-1] for k, v in out.items() if isinstance(v, dict) and v.get("d")}
    return out


# ---------------- 감마 (GEX) ----------------

def _ncdf(x):
    # Abramowitz-Stegun 7.1.26 (오차 1e-7)
    z = np.abs(x) / math.sqrt(2)
    t = 1 / (1 + 0.3275911 * z)
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-z * z)
    return 0.5 * (1 + np.sign(x) * y)


def _npdf(x):
    return np.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def bs_price(S, K, T, sig, call):
    sq = sig * np.sqrt(T)
    d1 = (np.log(S / K) + (RATE + 0.5 * sig * sig) * T) / sq
    d2 = d1 - sq
    c = S * _ncdf(d1) - K * np.exp(-RATE * T) * _ncdf(d2)
    p = c - S + K * np.exp(-RATE * T)
    return np.where(call, c, p)


def implied_vol(price, S, K, T, call):
    lo, hi = np.full_like(price, 0.01), np.full_like(price, 3.0)
    for _ in range(60):
        mid = (lo + hi) / 2
        too_high = bs_price(S, K, T, mid, call) > price
        hi = np.where(too_high, mid, hi)
        lo = np.where(too_high, lo, mid)
    iv = (lo + hi) / 2
    intrinsic = np.where(call, np.maximum(S - K * np.exp(-RATE * T), 0), np.maximum(K * np.exp(-RATE * T) - S, 0))
    bad = (price <= intrinsic + 0.005) | (iv < 0.02) | (iv > 2.9)
    return np.where(bad, np.nan, iv)


def gamma(S, K, T, sig):
    sq = sig * np.sqrt(T)
    d1 = (np.log(S / K) + (RATE + 0.5 * sig * sig) * T) / sq
    return _npdf(d1) / (S * sq)


def gex_day(g, date):
    """g: 하루치 옵션 행. 딜러는 콜 매수(+)·풋 매도(-) 가정(일반적인 GEX 관례)
    반환 금액 = 지수 1% 움직일 때 딜러가 사고팔아야 하는 델타 변화(억원)"""
    S = g["spot"].dropna().median()
    if not S or not np.isfinite(S):
        return None
    g = g[(g["oi"] > 0) & g["close"].notna() & (g["close"] > 0)].copy()
    T = (pd.to_datetime(g["expiry"]) - pd.Timestamp(date)).dt.days.to_numpy() / 365 + 0.5 / 365
    g = g[T > 0]
    T = T[T > 0]
    if g.empty:
        return None
    K, C = g["strike"].to_numpy(float), (g["kind"] == "C").to_numpy()
    iv = implied_vol(g["close"].to_numpy(float), S, K, T, C)
    # IV 못 구한 종목(깊은 내가격 등)은 같은 만기의 중앙값으로 채움
    ivs = pd.Series(iv)
    fill = ivs.groupby(g["expiry"].to_numpy()).transform("median")
    iv = ivs.fillna(fill).fillna(np.nanmedian(iv) if np.isfinite(iv).any() else 0.2).to_numpy()
    sign = np.where(C, 1.0, -1.0)
    oi = g["oi"].to_numpy(float)

    def total(s):
        return float(np.sum(sign * gamma(s, K, T, iv) * oi) * MULT * s * s * 0.01 / 1e8)

    grid = np.linspace(S * 0.85, S * 1.15, 61)
    prof = [total(s) for s in grid]
    flip = None
    for i in range(1, len(grid)):
        a, b = prof[i - 1], prof[i]
        if a == 0 or (a < 0) != (b < 0):
            x = grid[i - 1] + (grid[i] - grid[i - 1]) * (0 - a) / (b - a) if b != a else grid[i]
            if flip is None or abs(x - S) < abs(flip - S):
                flip = x
    gm = gamma(S, K, T, iv) * oi * MULT * S * S * 0.01 / 1e8
    by = pd.DataFrame({"K": K, "c": np.where(C, oi, 0), "p": np.where(C, 0, oi),
                       "cg": np.where(C, gm, 0), "pg": np.where(C, 0, -gm)}).groupby("K").sum()
    by = by[(by.index >= S * 0.85) & (by.index <= S * 1.15)]
    near = sorted(set(g["expiry"]))[:3]
    return {
        "date": date, "spot": _r(S, 2), "total": _r(total(S)), "flip": _r(flip, 2),
        "profile": [[_r(s, 2), _r(v)] for s, v in zip(grid, prof)],
        "strikes": [[_r(k, 2), _r(r.c), _r(r.p), _r(r.cg, 1), _r(r.pg, 1)] for k, r in by.iterrows()],
        "callWall": _r(by["cg"].idxmax(), 2) if len(by) else None,
        "putWall": _r(by["pg"].idxmin(), 2) if len(by) else None,
        "expiries": near, "n": int(len(g)),
        "atmIV": _r(float(np.nanmedian(iv[np.abs(K / S - 1) < 0.03])) * 100 if (np.abs(K / S - 1) < 0.03).any() else None, 1),
    }


def build_gex(conn):
    df = pd.read_sql("SELECT * FROM opt", conn)
    if df.empty:
        return None
    hist, last = [], None
    for d, g in df.groupby("date"):
        r = gex_day(g, d)
        if r:
            hist.append([d, r["spot"], r["total"], r["flip"], r["atmIV"]])
            last = r
    if not last:
        return None
    last["history"] = hist
    return last


# ---------------- PER·PBR ----------------

def build_fund(conn, out_dir):
    """fund_last.json (스크리너용 최신값) + fund/{묶음}/{Y|M}.json (종목별 EPS·BPS 추이, PER·PBR 밴드용)"""
    import build_site
    df = pd.read_sql("SELECT date, ticker, eps, bps, dps, per, pbr, div FROM fund", conn)
    if df.empty:
        return None
    last = df["date"].max()
    cur = df[df["date"] == last]
    obj = {"asof": last, "rows": {t: [_r(r["per"], 2), _r(r["pbr"], 2), _r(r["div"], 2), _r(r["eps"]), _r(r["bps"]), _r(r["dps"])]
                                  for t, r in cur.set_index("ticker").iterrows()}}
    df["date"] = pd.to_datetime(df["date"])
    df["b"] = df["ticker"].map(build_site.bucket)
    last_year = df["date"].max().year
    names = set()
    for bk, g in df.groupby("b"):
        e = g.pivot(index="date", columns="ticker", values="eps").sort_index()
        b = g.pivot(index="date", columns="ticker", values="bps").reindex(e.index)
        keys = e.index.year.map(lambda y: f"Y{y}").where(e.index.year < last_year, e.index.strftime("M%Y-%m"))
        os.makedirs(os.path.join(out_dir, "fund", str(bk)), exist_ok=True)
        for name in sorted(set(keys)):
            m = keys == name
            ee, bb = e.loc[m], b.loc[m]
            ts = [t for t in ee.columns if ee[t].notna().any() or bb[t].notna().any()]
            doc = {"d": [d.strftime("%Y-%m-%d") for d in ee.index], "t": ts,
                   "e": [[_r(v) for v in ee[t]] for t in ts], "b": [[_r(v) for v in bb[t]] for t in ts]}
            with open(os.path.join(out_dir, "fund", str(bk), f"{name}.json"), "w", encoding="utf-8") as fh:
                json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            names.add(name)
    obj["chunks"] = sorted(names, key=lambda n: (n[1:5], n))
    return obj


def stock_flow_docs(conn):
    """관심종목 수급 → {티커: json 문자열} (Firebase state/sf_티커 로 올림, 로그인해야 보임)"""
    have = _tables(conn)
    if "stown" not in have:
        return {}
    out = {}
    tickers = [r[0] for r in conn.execute("SELECT DISTINCT ticker FROM stown")]
    for t in tickers:
        f = pd.read_sql("SELECT date, investor, value FROM stflow WHERE ticker=?", conn, params=(t,))
        o = pd.read_sql("SELECT date, own, exh, sbal, samt, sratio FROM stown WHERE ticker=? ORDER BY date", conn, params=(t,))
        p = f.pivot(index="date", columns="investor", values="value") if not f.empty else pd.DataFrame()
        dates = sorted(set(p.index) | set(o["date"]))
        p = p.reindex(dates)
        o = o.set_index("date").reindex(dates)
        col = lambda c: [_r(v / 1e8, 1) for v in p[c]] if c in p else None
        frg = col("외국인합계") or (None if "외국인" not in p else [_r((a or 0) / 1e8 + (b or 0) / 1e8, 1) for a, b in zip(p["외국인"], p.get("기타외국인", pd.Series(0, index=p.index)))])
        doc = {"d": dates, "frg": frg, "inst": col("기관합계"), "ind": col("개인"), "pen": col("연기금"),
               "own": [_r(v, 2) for v in o["own"]], "sratio": [_r(v, 2) for v in o["sratio"]],
               "samt": [_r(v / 1e8, 1) if v == v and v is not None else None for v in o["samt"]]}
        out[t] = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return out


def build(db_path, out_dir):
    conn = sqlite3.connect(db_path)
    have = _tables(conn)
    made = []
    for name, tbl, fn in [("flow", "flow", build_flow), ("etf", "etf", build_etf),
                          ("macro", "macro", build_macro), ("gex", "opt", build_gex), ("fund_last", "fund", build_fund)]:
        if tbl not in have:
            continue
        try:
            obj = fn(conn, out_dir) if fn is build_fund else fn(conn)
        except Exception as e:
            print(f"  {name}.json 실패: {type(e).__name__}: {e}")
            continue
        if obj:
            with open(os.path.join(out_dir, f"{name}.json"), "w", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            made.append(name)
    conn.close()
    return made
