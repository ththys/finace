"""지표 계산 (화면과 분리해 두면 나중에 에이전트에도 그대로 넘길 수 있음)"""
import sqlite3

import pandas as pd


def load(db_path="kospi.db"):
    conn = sqlite3.connect(db_path)
    stocks = pd.read_sql("SELECT * FROM stocks", conn).set_index("ticker")
    prices = pd.read_sql("SELECT ticker, date, close FROM prices", conn, parse_dates=["date"])
    conn.close()
    close = prices.pivot(index="date", columns="ticker", values="close").sort_index()
    close = close[[t for t in close.columns if t in stocks.index]]
    return stocks, close


def ytd_base(end_date):
    """YTD 기준일 = 전년도 마지막 날 (그 이전 마지막 거래일 종가를 씀)"""
    end_date = pd.Timestamp(end_date)
    return pd.Timestamp(year=end_date.year - 1, month=12, day=31)


def _close_on_or_before(close, date):
    """해당일(휴장이면 직전 거래일) 종가. 그 전에 상장 안 된 종목은 NaN."""
    sub = close.loc[: pd.Timestamp(date)]
    if sub.empty:
        return pd.Series(float("nan"), index=close.columns)
    return sub.ffill().iloc[-1]


def _window(close, base_date, end_date):
    """기준일(휴장이면 직전 거래일) ~ 종료일 종가.
    거래정지일은 직전가로 채우고, 기준일에 가격이 없는(이후 상장) 종목은 제외."""
    upto = close.loc[: pd.Timestamp(end_date)].ffill()
    pre = upto.loc[: pd.Timestamp(base_date)]
    start = pre.index[-1] if len(pre) else upto.index[0]
    w = upto.loc[start:]
    return w.loc[:, w.iloc[0].notna()]


def drawdown(prices):
    """고점 대비 낙폭(0 ~ -1). Series/DataFrame 모두 가능"""
    return prices / prices.cummax() - 1


def mdd_stats(w):
    """기간 내 MDD, 현재 낙폭, MDD 고점일/저점일"""
    dd = drawdown(w)
    trough = dd.idxmin()
    peak = pd.Series({t: w.loc[:trough[t], t].idxmax() for t in w.columns})
    return pd.DataFrame({
        "MDD(%)": dd.min() * 100,
        "현재낙폭(%)": dd.iloc[-1] * 100,
        "MDD고점일": peak.dt.date,
        "MDD저점일": trough.dt.date,
    })


def changes(stocks, close, base_date, end_date):
    """종목별 기준일 대비 변화율(%) + MDD"""
    base = _close_on_or_before(close, base_date)
    end = _close_on_or_before(close, end_date)
    df = pd.DataFrame({
        "종목명": stocks["name"],
        "섹터": stocks["sector"],
        "시총(억)": stocks["market_cap"] / 1e8,
        "기준가": base,
        "현재가": end,
    })
    df["변화율(%)"] = (df["현재가"] / df["기준가"] - 1) * 100
    df = df.dropna(subset=["변화율(%)"])
    df["섹터내순위"] = df.groupby("섹터")["변화율(%)"].rank(ascending=False).astype(int)
    df["섹터평균대비(%p)"] = df["변화율(%)"] - df.groupby("섹터")["변화율(%)"].transform("mean")
    mdd = mdd_stats(_window(close, base_date, end_date))
    df = df.join(mdd[["MDD(%)", "현재낙폭(%)"]])
    return df.sort_values("변화율(%)", ascending=False)


# ---------------- 상대강도 ----------------

def _base_caps(stocks, close, base_date):
    """기준일 시총 추정 = 현재 시총 × (기준일 종가 / 최근 종가)"""
    base = _close_on_or_before(close, base_date)
    last = close.ffill().iloc[-1]
    return stocks["market_cap"].reindex(close.columns) * base / last


def _rs_change(rs, lookback):
    """최근 lookback 거래일 동안 상대강도 변화(pt). 양수면 최근 강해지는 중"""
    if len(rs) <= lookback:
        return rs.iloc[-1] - rs.iloc[0]
    return rs.iloc[-1] - rs.iloc[-1 - lookback]


def relative_strength(stocks, close, base_date, end_date, lookback=20):
    """섹터 vs 시장, 종목 vs 섹터 상대강도.

    - 섹터/시장 지수: 기준일 시총가중으로 사서 보유했다고 가정한 지수 (기준일=100)
    - 상대강도(RS) = 대상 지수 / 비교 지수 × 100
      100보다 크면 기준일 이후 비교 대상보다 강함, 선이 오르면 지금 강해지는 중
    """
    w = _window(close, base_date, end_date)
    norm = w / w.iloc[0] * 100
    caps = _base_caps(stocks, close, base_date)[w.columns]
    sec_of = stocks.loc[w.columns, "sector"]

    # 시장 / 섹터 지수
    market = (norm * caps).sum(axis=1) / caps.sum()
    sector_idx = pd.DataFrame({
        sec: (norm[t] * caps[t]).sum(axis=1) / caps[t].sum()
        for sec, t in sec_of.groupby(sec_of).groups.items()
    })

    # 상대강도
    rs_sector = sector_idx.div(market, axis=0) * 100
    sec_for_stock = sector_idx[sec_of.values].set_axis(w.columns, axis=1)
    rs_stock = norm / sec_for_stock * 100

    # 섹터 표
    sec_mdd = mdd_stats(sector_idx)
    sector_table = pd.DataFrame({
        "종목수": sec_of.value_counts(),
        "섹터수익률(%)": sector_idx.iloc[-1] - 100,
        "시장대비(%p)": sector_idx.iloc[-1] - market.iloc[-1],
        f"RS {lookback}일변화": _rs_change(rs_sector, lookback),
        "MDD(%)": sec_mdd["MDD(%)"],
        "현재낙폭(%)": sec_mdd["현재낙폭(%)"],
    }).sort_values("시장대비(%p)", ascending=False)

    # 종목 표
    st_mdd = mdd_stats(w)
    stock_table = pd.DataFrame({
        "종목명": stocks.loc[w.columns, "name"],
        "섹터": sec_of,
        "수익률(%)": norm.iloc[-1] - 100,
        "섹터수익률(%)": sec_for_stock.iloc[-1] - 100,
        "섹터대비(%p)": norm.iloc[-1] - sec_for_stock.iloc[-1],
        f"RS {lookback}일변화": _rs_change(rs_stock, lookback),
    }).join(st_mdd).sort_values("섹터대비(%p)", ascending=False)

    return {
        "market": market,
        "sector_idx": sector_idx,
        "rs_sector": rs_sector,
        "rs_stock": rs_stock,
        "stock_dd": drawdown(w) * 100,
        "sector_dd": drawdown(sector_idx) * 100,
        "sector_table": sector_table,
        "stock_table": stock_table,
    }


def sector_summary(df):
    """섹터별 집계. 시총가중은 현재 시총에서 기준시점 시총을 역산해 가중."""
    r = df["변화율(%)"] / 100
    tmp = df.assign(_w=df["시총(억)"] / (1 + r), _wr=df["시총(억)"] / (1 + r) * r)
    g = tmp.groupby("섹터")
    out = pd.DataFrame({
        "종목수": g.size(),
        "평균(%)": g["변화율(%)"].mean(),
        "중앙값(%)": g["변화율(%)"].median(),
        "시총가중(%)": g["_wr"].sum() / g["_w"].sum() * 100,
        "상승": g["변화율(%)"].apply(lambda s: (s > 0).sum()),
        "하락": g["변화율(%)"].apply(lambda s: (s < 0).sum()),
        "최고 종목": df.loc[g["변화율(%)"].idxmax(), "종목명"].set_axis(g.size().index),
        "최저 종목": df.loc[g["변화율(%)"].idxmin(), "종목명"].set_axis(g.size().index),
    })
    return out.sort_values("시총가중(%)", ascending=False)
