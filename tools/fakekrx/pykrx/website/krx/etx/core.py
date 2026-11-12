import datetime as dt

import pandas as pd

from pykrx import _world as W


class 개별종목시세_ETF:
    def fetch(self, start, end, isin):
        P = lambda s: dt.datetime.strptime(str(s), "%Y%m%d").date()
        days = W.bdays(max(P(start), W.START), min(P(end), W.today()))
        rows = [{"TRD_DD": d.strftime("%Y/%m/%d"), "TDD_CLSPRC": f"{10000 + W.h(isin, d) % 5000:,}", "LST_NAV": f"{10000 + W.h(isin, d) % 5000 + 3.25:,.2f}",
                 "INVSTASST_NETASST_TOTAMT": f"{(1000 + W.h(isin, d, 'a') % 9000) * 100000000:,}" if W.h(isin, d, "z") % 9 else "-",
                 "LIST_SHRS": f"{1000000 + (W.h(isin, d, 's') % 50) * 10000:,}"} for d in reversed(days)]
        return pd.DataFrame(rows)
