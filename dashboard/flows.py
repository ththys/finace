"""수급·파생·매크로 데이터 수집 (집 PC, collect.py 가 매일 같이 실행) — 표는 db.py 참고

python flows.py          # 이것만 따로 실행 (진단 출력 포함)

받는 것
  KRX (pykrx 로그인 세션 재사용)
    - 투자자별 순매수 (코스피/코스닥, 외국인·개인·기관·연기금 등) 2014년~
    - 레버리지·인버스 ETF 순자산, 상장주식수 → 자금 유출입
    - VKOSPI (V-KOSPI 선물 화면의 기초자산 값) 최근 1년~
    - 코스피200 옵션 전 종목 종가·미결제약정 → 사이트에서 감마(GEX) 계산, 최근 40거래일~
  FRED / Yahoo (공개 데이터, 키 필요 없음)
    - VIX, 달러인덱스(DXY), 엔/달러, 원/달러, 미국 2년·10년·3개월 금리, 5년 BEI·실질금리,
      연준 대차대조표·TGA·역레포(순유동성), M2
"""
import datetime as dt
import io
import re
import sys
import time

import pandas as pd

SLEEP = 0.4
FLOW_START = "20140101"
VKOSPI_DAYS = 260        # 처음 받을 VKOSPI 거래일 수
OPTION_DAYS = 40         # 처음 받을 옵션 거래일 수
MAX_DAILY_REQ = 320      # 한 번 실행에 날짜별 요청 최대 (나머지는 다음 날 이어서)

ETFS = {  # 티커: (이름, 종류)
    "122630": ("KODEX 레버리지", "lev"),
    "123320": ("TIGER 레버리지", "lev"),
    "233740": ("KODEX 코스닥150레버리지", "lev"),
    "252670": ("KODEX 200선물인버스2X", "inv"),
    "114800": ("KODEX 인버스", "inv"),
    "251340": ("KODEX 코스닥150선물인버스", "inv"),
}

FRED = {  # 시리즈: 설명
    "VIXCLS": "VIX",
    "DGS2": "미국 2년", "DGS10": "미국 10년", "DGS3MO": "미국 3개월",
    "T5YIE": "5년 BEI", "DFII5": "5년 실질금리",
    "DEXJPUS": "엔/달러", "DEXKOUS": "원/달러", "DTWEXBGS": "달러(브로드)",
    "WALCL": "연준 총자산", "WTREGEN": "TGA", "RRPONTSYD": "역레포",
    "M2SL": "미국 M2",
}

def num(x):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).replace(",", "").strip()
    if s in ("", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def trading_days(conn):
    """가격 테이블에 있는 거래일 (KRX 영업일 목록 대용)"""
    return [r[0] for r in conn.execute("SELECT DISTINCT date FROM prices ORDER BY date")]


# ---------------- KRX ----------------

def update_investor_flows(conn, end):
    from pykrx import stock
    for mkt in ("KOSPI", "KOSDAQ"):
        last = conn.execute("SELECT MAX(date) FROM flow WHERE market=?", (mkt,)).fetchone()[0]
        start = (dt.date.fromisoformat(last) + dt.timedelta(days=1)).strftime("%Y%m%d") if last else FLOW_START
        if start > end:
            continue
        df = stock.get_market_trading_value_by_date(start, end, mkt, detail=True)
        if df is None or df.empty:
            print(f"  투자자별 {mkt}: 새 데이터 없음")
            continue
        rows = [(d.strftime("%Y-%m-%d"), mkt, str(c), float(v))
                for d, r in df.iterrows() for c, v in r.items() if pd.notna(v)]
        conn.executemany("INSERT OR REPLACE INTO flow VALUES (?,?,?,?)", rows)
        conn.commit()
        print(f"  투자자별 {mkt}: {len(df)}일 ({', '.join(map(str, df.columns))})")
        time.sleep(SLEEP)


def update_etfs(conn, end):
    from pykrx.website.krx.etx.core import 개별종목시세_ETF
    from pykrx.website.krx.etx.ticker import get_etx_isin
    for t, (name, _) in ETFS.items():
        last = conn.execute("SELECT MAX(date) FROM etf WHERE ticker=?", (t,)).fetchone()[0]
        start = (dt.date.fromisoformat(last) + dt.timedelta(days=1)).strftime("%Y%m%d") if last else FLOW_START
        if start > end:
            continue
        try:
            df = 개별종목시세_ETF().fetch(start, end, get_etx_isin(t))
        except Exception as e:
            print(f"  ETF {t} {name} 실패: {e}")
            continue
        if df.empty:
            continue
        rows = [(r["TRD_DD"].replace("/", "-"), t, num(r.get("TDD_CLSPRC")), num(r.get("LST_NAV")),
                 num(r.get("INVSTASST_NETASST_TOTAMT")), num(r.get("LIST_SHRS"))) for _, r in df.iterrows()]
        conn.executemany("INSERT OR REPLACE INTO etf VALUES (?,?,?,?,?,?)", rows)
        conn.commit()
        print(f"  ETF {name}: +{len(rows)}일")
        time.sleep(SLEEP)


def _drv(day, prod):
    from pykrx.website.krx.future.core import 전종목시세
    return 전종목시세().fetch(day, prod)


def _second_thursday(yyyymm):
    y, m = int(yyyymm[:4]), int(yyyymm[4:6])
    d = dt.date(y, m, 1)
    d += dt.timedelta(days=(3 - d.weekday()) % 7)
    return (d + dt.timedelta(days=7)).isoformat()


NAME_RE = re.compile(r"(?:^|\s)(C|P|콜|풋)\s+(\d{6})\s+([\d.]+)")


def parse_options(df, base):
    """전종목시세 행 → (isu, kind, expiry, strike, close, spot, oi)"""
    out = []
    for _, r in df.iterrows():
        isu = r.get("ISU_CD")
        kind = expiry = strike = None
        if base is not None and isu in base.index:
            b = base.loc[isu]
            rt = str(b.get("RGHT_TP_NM", ""))
            kind = "C" if ("콜" in rt or "C" in rt.upper()) else "P" if ("풋" in rt or "P" in rt.upper()) else None
            strike = num(b.get("EXER_PRC"))
            expiry = str(b.get("LSTTRD_DD", "")).replace("/", "-") or None
        if not (kind and strike and expiry):
            m = NAME_RE.search(str(r.get("ISU_NM", "")))
            if not m:
                continue
            kind = "C" if m.group(1) in ("C", "콜") else "P"
            expiry, strike = _second_thursday(m.group(2)), float(m.group(3))
        out.append((isu, kind, expiry, strike, num(r.get("TDD_CLSPRC")) or num(r.get("SETL_PRC")),
                    num(r.get("SPOT_PRC")), num(r.get("ACC_OPNINT_QTY"))))
    return out


def update_daily_drv(conn, days):
    """VKOSPI / 코스피200 옵션: 하루 한 번 요청 → 빠진 날만 받음"""
    budget = MAX_DAILY_REQ
    # VKOSPI
    have = {r[0] for r in conn.execute("SELECT date FROM macro WHERE series='VKOSPI'")}
    need = [d for d in days[-VKOSPI_DAYS:] if d not in have]
    got = 0
    for d in reversed(need[-budget:]):
        try:
            df = _drv(d.replace("-", ""), "KRDRVFUVKI")
        except Exception as e:
            print(f"  VKOSPI {d} 실패: {e}")
            break
        budget -= 1
        spot = next((num(x) for x in df.get("SPOT_PRC", []) if num(x)), None)
        if spot:
            conn.execute("INSERT OR REPLACE INTO macro VALUES ('VKOSPI',?,?)", (d, spot))
            got += 1
        time.sleep(SLEEP)
    conn.commit()
    if need:
        print(f"  VKOSPI: {got}/{len(need)}일")

    # 옵션
    try:
        from pykrx.website.krx.future.core import 전종목기본정보
        base = 전종목기본정보().fetch("KRDRVOPK2I").set_index("ISU_CD")
    except Exception as e:
        print(f"  옵션 기본정보 실패(이름에서 행사가 추출로 대체): {e}")
        base = None
    have = {r[0] for r in conn.execute("SELECT DISTINCT date FROM opt")}
    need = [d for d in days[-OPTION_DAYS:] if d not in have]
    first = True
    for d in reversed(need[-max(budget, 1):]):
        try:
            df = _drv(d.replace("-", ""), "KRDRVOPK2I")
        except Exception as e:
            print(f"  옵션 {d} 실패: {e}")
            break
        rows = parse_options(df, base)
        if first:
            print(f"  옵션 {d}: 원본 {len(df)}행 → 해석 {len(rows)}행. 예) {df.iloc[0].get('ISU_NM') if len(df) else '-'}")
            first = False
        conn.executemany("INSERT OR REPLACE INTO opt VALUES (?,?,?,?,?,?,?,?)", [(d, *r) for r in rows])
        time.sleep(SLEEP)
    conn.commit()
    # 오래된 옵션 데이터는 정리 (최근 120거래일만)
    keep = days[-120:]
    if keep:
        conn.execute("DELETE FROM opt WHERE date < ?", (keep[0],))
        conn.commit()


FUND_DAYS = 760          # PER·PBR 과거 몇 거래일까지 (약 3년)
FUND_MAX_REQ = 400       # 한 번 실행에 과거 채우기 최대 요청 수 (나머지는 다음 실행 때)
STOCK_FLOW_START = 730   # 관심종목 수급 처음 받을 기간(일)


def update_fundamentals(conn, days):
    """전 종목 PER·PBR·EPS·BPS·배당 — 날짜마다 요청 1번. 최신부터 거꾸로 채움"""
    from pykrx import stock
    have = {r[0] for r in conn.execute("SELECT DISTINCT date FROM fund")}
    need = [d for d in days[-FUND_DAYS:] if d not in have][::-1][:FUND_MAX_REQ]
    got = 0
    for d in need:
        try:
            df = stock.get_market_fundamental_by_ticker(d.replace("-", ""), market="ALL")
        except Exception as e:
            print(f"  PER·PBR {d} 실패: {e}")
            break
        time.sleep(SLEEP)
        if df is None or df.empty or (df[["BPS", "PER", "PBR", "EPS"]] == 0).all(axis=None):
            continue
        nz = lambda v: float(v) if v == v and v != 0 else None
        conn.executemany("INSERT OR REPLACE INTO fund VALUES (?,?,?,?,?,?,?,?)",
                         [(d, t, nz(r["EPS"]), nz(r["BPS"]), nz(r["DPS"]), nz(r["PER"]), nz(r["PBR"]), nz(r["DIV"]))
                          for t, r in df.iterrows()])
        conn.commit()
        got += 1
    left = len([d for d in days[-FUND_DAYS:] if d not in have]) - got
    if need:
        print(f"  PER·PBR: {got}일 받음" + (f" (과거 {left}일은 다음 실행 때 이어서)" if left > 0 else ""))


def update_stock_flows(conn, end, watch):
    """관심종목만: 투자자별 순매수, 외국인 지분율, 공매도 잔고"""
    from pykrx import stock
    tickers = [t for t in watch if len(str(t)) == 6]
    first = (dt.date.today() - dt.timedelta(days=STOCK_FLOW_START)).strftime("%Y%m%d")
    for t in tickers:
        last = conn.execute("SELECT MAX(date) FROM stown WHERE ticker=?", (t,)).fetchone()[0]
        start = (dt.date.fromisoformat(last) + dt.timedelta(days=1)).strftime("%Y%m%d") if last else first
        if start > end:
            continue
        try:
            f = stock.get_market_trading_value_by_date(start, end, t, detail=True)
            time.sleep(SLEEP)
            o = stock.get_exhaustion_rates_of_foreign_investment_by_date(start, end, t)
            time.sleep(SLEEP)
            try:
                sh = stock.get_shorting_balance_by_date(start, end, t)
            except Exception:
                sh = None
            time.sleep(SLEEP)
        except Exception as e:
            print(f"  종목 수급 {t} 실패: {e}")
            continue
        if f is not None and not f.empty:
            conn.executemany("INSERT OR REPLACE INTO stflow VALUES (?,?,?,?)",
                             [(d.strftime("%Y-%m-%d"), t, str(c), float(v)) for d, r in f.iterrows() for c, v in r.items() if v == v])
        rows = {}
        if o is not None and not o.empty:
            for d, r in o.iterrows():
                rows[d.strftime("%Y-%m-%d")] = [num(r.get("지분율")), num(r.get("한도소진률")), None, None, None]
        if sh is not None and not sh.empty:
            for d, r in sh.iterrows():
                x = rows.setdefault(d.strftime("%Y-%m-%d"), [None, None, None, None, None])
                x[2:] = [num(r.get("공매도잔고")), num(r.get("공매도금액")), num(r.get("비중"))]
        conn.executemany("INSERT OR REPLACE INTO stown VALUES (?,?,?,?,?,?,?)", [(d, t, *v) for d, v in rows.items()])
        conn.commit()
    if tickers:
        print(f"  관심종목 수급: {len(tickers)}종목")


INDEX_FROM = {"IDX_KOSPI": ("1001", "19800104"), "IDX_KOSDAQ": ("2001", "19960701")}  # 지수는 상장폐지 문제가 없어 처음부터


def update_indices(conn, end):
    """코스피(1980~)·코스닥(1996~) 지수 종가 → macro 테이블 IDX_KOSPI / IDX_KOSDAQ"""
    from pykrx import stock
    for sid, (code, first) in INDEX_FROM.items():
        lo, hi = conn.execute("SELECT MIN(date), MAX(date) FROM macro WHERE series=?", (sid,)).fetchone()
        spans = []
        if not lo:
            spans.append((first, end))
        else:
            if lo.replace("-", "") > first:  # 앞쪽(옛날) 비어 있으면 채움
                spans.append((first, (dt.date.fromisoformat(lo) - dt.timedelta(days=1)).strftime("%Y%m%d")))
            nxt = (dt.date.fromisoformat(hi) + dt.timedelta(days=1)).strftime("%Y%m%d")
            if nxt <= end:
                spans.append((nxt, end))
        for a, b in spans:
            try:
                df = stock.get_index_ohlcv_by_date(a, b, code, name_display=False)
            except Exception as e:
                print(f"  지수 {sid} {a}~{b} 실패: {e}")
                continue
            time.sleep(SLEEP)
            if df is None or df.empty:
                continue
            conn.executemany("INSERT OR REPLACE INTO macro VALUES (?,?,?)",
                             [(sid, d.strftime("%Y-%m-%d"), float(r["종가"])) for d, r in df.iterrows() if r["종가"]])
            conn.commit()
            print(f"  지수 {sid}: {a}~{b} {len(df)}일")


# ---------------- FRED / Yahoo ----------------

def _get(url, **kw):
    import requests
    r = requests.get(url, timeout=40, headers={"User-Agent": "Mozilla/5.0 (kospi-daily)"}, **kw)
    r.raise_for_status()
    return r


def fred_series(sid):
    txt = _get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": sid}).text
    df = pd.read_csv(io.StringIO(txt))
    df.columns = ["date", "value"]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna()


def yahoo_series(sym):
    j = _get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
             params={"period1": int(dt.datetime(2005, 1, 1).timestamp()), "period2": int(time.time()),
                     "interval": "1d"}).json()["chart"]["result"][0]  # range=max 는 분기 단위로 줘서 기간 지정
    ts, cl = j["timestamp"], j["indicators"]["quote"][0]["close"]
    df = pd.DataFrame({"date": pd.to_datetime(ts, unit="s").strftime("%Y-%m-%d"), "value": cl}).dropna()
    return df.drop_duplicates("date", keep="last")


def update_macro(conn):
    ok = []
    jobs = [(sid, lambda s=sid: fred_series(s)) for sid in FRED] + [("DXY", lambda: yahoo_series("DX-Y.NYB"))]
    for sid, fn in jobs:
        try:
            df = fn()
        except Exception as e:
            print(f"  매크로 {sid} 실패: {e}")
            continue
        conn.execute("DELETE FROM macro WHERE series=?", (sid,))  # FRED·야후는 매번 전체
        conn.executemany("INSERT INTO macro VALUES (?,?,?)", [(sid, d, float(v)) for d, v in zip(df["date"], df["value"])])
        ok.append(sid)
    conn.commit()
    print(f"  매크로 {len(ok)}/{len(jobs)}개 시리즈")


def update_all(conn, end_day=None, watch=None):
    from pykrx import stock
    end = end_day or stock.get_nearest_business_day_in_a_week()
    days = trading_days(conn)
    print("수급·파생·매크로 업데이트...")
    for name, fn in [("지수", lambda: update_indices(conn, end)), ("PER·PBR", lambda: update_fundamentals(conn, days)),
                     ("관심종목 수급", lambda: update_stock_flows(conn, end, watch or {})), ("투자자별", lambda: update_investor_flows(conn, end)), ("ETF", lambda: update_etfs(conn, end)),
                     ("VKOSPI·옵션", lambda: update_daily_drv(conn, days)), ("매크로", lambda: update_macro(conn))]:
        try:
            fn()
        except Exception as e:
            print(f"  {name} 실패: {type(e).__name__}: {e}")


if __name__ == "__main__":
    sys.argv = sys.argv[:1]
    import collect  # .env 읽기 + pykrx 로그인 + 화면 로그
    import db
    c = db.connect()
    update_all(c, watch=collect.watchlist())
    for t in ("flow", "etf", "macro", "opt", "fund", "stown"):
        print(t, c.execute(f"SELECT COUNT(*), MIN(date), MAX(date) FROM {t}").fetchone())
    c.close()
