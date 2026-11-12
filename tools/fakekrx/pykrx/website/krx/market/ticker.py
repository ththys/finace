import pandas as pd

from pykrx import _world as W


class StockTicker:
    @property
    def listed(self):
        rows = [(t, n, "STK") for t, n in W.KOSPI.items()] + [(t, n, "KSQ") for t, n in W.KOSDAQ.items()] + [("900010", "코넥스종목", "KNX")]
        return pd.DataFrame([(n, m) for _, n, m in rows], index=[t for t, _, _ in rows], columns=["종목", "시장"])
