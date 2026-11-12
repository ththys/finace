"""가짜 KRX 세계 (결정적, 날짜는 오늘 기준 상대값). 환경변수 FAKE_DAY=YYYYMMDD 가 '오늘'(가장 최근 영업일)
들어 있는 상황: 분할 1종목(SPLIT, 끝에서 2번째 영업일) · 신규 상장 1종목(LISTED, 같은 날) · 거래정지 3일(HALT) · 우선주 · 스팩 · 코넥스"""
import datetime as dt
import hashlib
import math
import os

import pandas as pd


def _weekdays_back(end, n):
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= dt.timedelta(days=1)
    return out[::-1]


REAL_END = _weekdays_back(dt.date.today(), 1)[0]
DAYS = _weekdays_back(REAL_END, 290)                 # 가짜 세계의 모든 영업일 (약 13개월 → 전년 말·1년 전 기준일이 있음)
START = DAYS[0]
SPLIT = {"000030": DAYS[-2]}                         # 이 날 2:1 분할 (그날 가격은 절반, 수정주가는 분할 뒤에야 과거가 절반으로 바뀜)
LISTED = {"100090": DAYS[-2]}                        # 이 날 신규 상장
HALT = {"000050": (DAYS[-50], DAYS[-48])}            # 거래정지(시가·고가·저가 0, 거래량 0)

KOSPI = {f"0000{i}0": f"코스피종목{i}" for i in range(1, 10)}
KOSPI.update({"000015": "코스피종목1우", "000100": "가나다홀딩스", "000110": "라마바화학"})
KOSDAQ = {f"1000{i}0": f"코스닥종목{i}" for i in range(1, 10)}
KOSDAQ.update({"100100": "가짜스팩1호", "100110": "사아자바이오"})
SECT = {"KOSPI": {"1001": ("코스피", list(KOSPI)), "1028": ("코스피 200", list(KOSPI)[:6]), "1013": ("전기전자", ["000010", "000020", "000030", "000015"]),
                  "1008": ("화학", ["000040", "000050", "000110"]), "1021": ("금융", ["000060", "000070", "000100"]), "1005": ("제조업", list(KOSPI)[:8])},
        "KOSDAQ": {"2001": ("코스닥", list(KOSDAQ)), "2203": ("코스닥 150", list(KOSDAQ)[:5]), "2012": ("코스닥 IT", ["100010", "100020", "100030", "100090"]),
                   "2015": ("코스닥 제약", ["100040", "100050", "100110"])}}


def today():
    v = os.environ.get("FAKE_DAY")
    return dt.datetime.strptime(v, "%Y%m%d").date() if v else REAL_END


def bdays(a=START, b=None):
    b = b or today()
    return [d for d in DAYS if a <= d <= b]


def h(*a):
    return int(hashlib.md5("|".join(map(str, a)).encode()).hexdigest()[:8], 16)


def listed_on(t, d):
    return d >= LISTED.get(t, START)


def market_of(t):
    return "KOSPI" if t in KOSPI else "KOSDAQ" if t in KOSDAQ else None


def adj_bar(t, d):
    """수정주가 기준 봉 (연속). 100원 단위"""
    i = (d - START).days
    base = 5000 + h(t) % 200000
    c = base * math.exp(0.3 * math.sin(i / 23 + h(t) % 7) + 0.0006 * i * ((h(t) % 5) - 2))
    c = max(500, round(c / 10) * 10)
    r = (h(t, d) % 600) / 10000
    o, hi, lo = round(c * (1 - r / 2) / 10) * 10, round(c * (1 + r) / 10) * 10, round(c * (1 - r) / 10) * 10
    v = 10000 + h(t, d, "v") % 900000
    halt = HALT.get(t)
    if halt and halt[0] <= d <= halt[1]:
        o = hi = lo = 0
        v = 0
    return o, hi, lo, c, v


def raw_factor(t, d):
    """그날 가격 = 수정주가 × factor (분할 전에는 2배)"""
    s = SPLIT.get(t)
    return 2.0 if s and d < s else 1.0


def ohlcv_df(t, a, b, adjusted=True):
    rows, idx = [], []
    for d in bdays(max(a, START), min(b, today())):
        if not listed_on(t, d):
            continue
        o, hi, lo, c, v = adj_bar(t, d)
        # 수정주가: 분할이 '이미 일어난 뒤'에만 과거가 절반으로 바뀜 (분할 전에는 그날 가격 그대로)
        f = (2.0 if (t in SPLIT and today() < SPLIT[t]) else 1.0) if adjusted else raw_factor(t, d)
        rows.append([o * f, hi * f, lo * f, c * f, v / f, c * v])
        idx.append(pd.Timestamp(d))
    return pd.DataFrame(rows, index=idx, columns=["시가", "고가", "저가", "종가", "거래량", "거래대금"])


def snapshot_df(d):
    rows, idx = [], []
    if d in bdays(START, today()):
        for t in list(KOSPI) + list(KOSDAQ):
            if not listed_on(t, d):
                continue
            o, hi, lo, c, v = adj_bar(t, d)
            f = raw_factor(t, d)
            rows.append([o * f, hi * f, lo * f, c * f, v / f, c * v])
            idx.append(t)
    return pd.DataFrame(rows, index=idx, columns=["시가", "고가", "저가", "종가", "거래량", "거래대금"])


def cap_df(d, market):
    src = KOSPI if market == "KOSPI" else KOSDAQ
    ts = [t for t in src if listed_on(t, d)]
    return pd.DataFrame({"시가총액": [(1 + h(t, "cap") % 5000) * 1e9 for t in ts]}, index=ts)
