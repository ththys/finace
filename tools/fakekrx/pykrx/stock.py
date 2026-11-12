import datetime as dt

import pandas as pd

from . import _world as W

P = lambda s: dt.datetime.strptime(str(s), "%Y%m%d").date()


def get_nearest_business_day_in_a_week():
    return W.bdays()[-1].strftime("%Y%m%d")


def get_market_cap(day, market="KOSPI"):
    return W.cap_df(P(day), market)


def get_market_ticker_name(t):
    return {**W.KOSPI, **W.KOSDAQ}[t]


def get_index_ticker_list(day, market="KOSPI"):
    return list(W.SECT[market])


def get_index_ticker_name(idx):
    return {**W.SECT["KOSPI"], **W.SECT["KOSDAQ"]}[idx][0]


def get_index_portfolio_deposit_file(idx, day):
    return [t for t in {**W.SECT["KOSPI"], **W.SECT["KOSDAQ"]}[idx][1] if W.listed_on(t, P(day))]


def get_market_ohlcv(start, end, t, adjusted=True):
    return W.ohlcv_df(t, P(start), P(end), adjusted)


def get_market_ohlcv_by_ticker(ds, market="ALL"):
    return W.snapshot_df(P(ds))


INV = ["금융투자", "보험", "투신", "사모", "은행", "기타금융", "연기금", "기타법인", "개인", "외국인", "기타외국인", "전체"]


def get_market_trading_value_by_date(start, end, who, detail=True):
    a, b = max(P(start), W.START), min(P(end), W.today())
    days = W.bdays(a, b)
    data = [[(W.h(who, d, c) % 2000 - 1000) * 1e8 for c in INV] for d in days]
    return pd.DataFrame(data, index=[pd.Timestamp(d) for d in days], columns=INV)


def get_market_fundamental_by_ticker(ds, market="ALL"):
    d = P(ds)
    ts = [t for t in list(W.KOSPI) + list(W.KOSDAQ) if W.listed_on(t, d)]
    rows = []
    for t in ts:
        c = W.adj_bar(t, d)[3]
        eps = 0 if t.endswith("90") else 100 + W.h(t, "eps") % 5000
        bps = 1000 + W.h(t, "bps") % 90000
        rows.append([bps, round(c / eps, 2) if eps else 0, round(c / bps, 2), eps, round((W.h(t, "dps") % 300) / c * 100, 2), W.h(t, "dps") % 300])
    return pd.DataFrame(rows, index=ts, columns=["BPS", "PER", "PBR", "EPS", "DIV", "DPS"])


def get_exhaustion_rates_of_foreign_investment_by_date(start, end, t):
    days = W.bdays(max(P(start), W.START), min(P(end), W.today()))
    return pd.DataFrame({"지분율": [20 + (W.h(t, d) % 100) / 10 for d in days], "한도소진률": [40.0 for _ in days]}, index=[pd.Timestamp(d) for d in days])


def get_shorting_balance_by_date(start, end, t):
    days = W.bdays(max(P(start), W.START), min(P(end), W.today()))
    return pd.DataFrame({"공매도잔고": [W.h(t, d, "sb") % 100000 for d in days], "공매도금액": [W.h(t, d, "sa") % 100000 * 1e4 for d in days],
                         "비중": [(W.h(t, d, "sr") % 300) / 100 for d in days]}, index=[pd.Timestamp(d) for d in days])


def get_index_ohlcv_by_date(a, b, code, name_display=False):
    days = W.bdays(max(P(a), W.START), min(P(b), W.today()))
    return pd.DataFrame({"종가": [2000 + W.h(code, d) % 500 + (0.5 if code == "2001" else 0) for d in days]}, index=[pd.Timestamp(d) for d in days])
