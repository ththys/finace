import datetime as dt

import pandas as pd

from pykrx import _world as W

P = lambda s: dt.datetime.strptime(str(s), "%Y%m%d").date()


def _opts(d):
    spot = 800 + W.h("k200", d) % 100 + 0.25
    rows = []
    t = W.today()
    for exp in (t.strftime("%Y%m"), (t.replace(day=1) + dt.timedelta(days=32)).strftime("%Y%m")):   # 이번 달·다음 달 만기
        for k in range(700, 1000, 25):
            for kind in ("C", "P"):
                intr = max(0.0, (spot - k) if kind == "C" else (k - spot))
                rows.append({"ISU_CD": f"KR4{kind}{exp}{k}", "ISU_NM": f"코스피200 {kind} {exp} {k:.1f}", "TDD_CLSPRC": f"{intr + 2 + W.h(d, exp, k, kind) % 30 / 10:.2f}",
                             "SETL_PRC": "-", "SPOT_PRC": f"{spot:.2f}", "ACC_OPNINT_QTY": f"{W.h(d, exp, k, kind, 'oi') % 20000:,}"})
    return rows


class 전종목시세:
    def fetch(self, day, prod):
        d = P(day)
        if d not in W.bdays(W.START, W.today()):
            return pd.DataFrame()
        if prod == "KRDRVFUVKI":
            return pd.DataFrame([{"ISU_NM": "변동성지수 F 202611", "SPOT_PRC": f"{18 + W.h('vk', d) % 150 / 10:.2f}"}, {"ISU_NM": "변동성지수 F 202612", "SPOT_PRC": "-"}])
        return pd.DataFrame(_opts(d))


class 전종목기본정보:
    def fetch(self, prod):
        rows = []
        for r in _opts(W.today()):
            kind, exp, k = r["ISU_CD"][3], r["ISU_CD"][4:10], r["ISU_CD"][10:]
            if int(k) % 50 == 0:      # 절반만 기본정보에 있음 → 나머지는 이름에서 추출하는 길도 탐
                rows.append({"ISU_CD": r["ISU_CD"], "RGHT_TP_NM": "콜" if kind == "C" else "풋", "EXER_PRC": f"{int(k):.2f}",
                             "LSTTRD_DD": f"{exp[:4]}/{exp[4:]}/12"})
        return pd.DataFrame(rows)
