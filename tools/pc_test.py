#!/usr/bin/env python3
"""집 PC 파이프라인 시험 — 가짜 KRX·네이버·FRED·Firebase 로 끝까지 돌려 봄 (인터넷·로그인 필요 없음, 1~2분)

  python tools/pc_test.py            지금 코드(dashboard/)를 이틀치 돌려 보고 요약 (에러 없이 도는지)
  python tools/pc_test.py HEAD       그 커밋의 코드와 결과가 같은지 비교 (리팩터링 뒤 확인용): DB 표 · site_data 파일 · Firebase 문서

돌리는 것: collect.main() 전체(종목·가격·고저 채우기·리포트·수급) → build_site.build → publish_site.push_stock_flows.
GitHub 올리기(publish)는 토큰이 없어 건너뜀. 둘째 날에는 분할·신규 상장·새 리포트가 생김 (fakekrx/pykrx/_world.py).
"""
import datetime as dt
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TOOLS)
FAKE = os.path.join(TOOLS, "fakekrx")
hh = lambda *a: int(hashlib.md5("|".join(map(str, a)).encode()).hexdigest()[:8], 16)


def run(code):
    """CODE 폴더의 코드를 FAKE_DAY 하루치 실행하고 결과를 그 폴더에 덤프 (하위 프로세스에서)"""
    for k in ("GITHUB_TOKEN", "DRIVE_EXPORT_DIR", "FIREBASE_API_KEY"):
        os.environ.pop(k, None)
    os.environ.update(KRX_ID="x", KRX_PW="y")
    sys.path[:0] = [code, FAKE]
    sys.argv = ["collect.py"]
    os.chdir(code)
    from pykrx import _world as W
    today = W.today()

    # 가짜 Firestore (파일에 저장해 다음 날 실행으로 이어짐)
    fs_path = os.path.join(code, "_fs.json")
    store = json.load(open(fs_path)) if os.path.exists(fs_path) else {
        "watchlist/000010": {"name": "코스피종목1", "market": "KOSPI", "favorite": True, "track_reports": True, "added": "2026-10-01T10:00:00"},
        "watchlist/000015": {"name": "코스피종목1우", "market": "KOSPI", "favorite": True, "track_reports": False, "added": "2026-10-02T10:00:00"},
        "watchlist/100020": {"name": "코스닥종목2", "market": "KOSDAQ", "favorite": False, "track_reports": True, "added": "2026-10-03T10:00:00"}}
    save = lambda: json.dump(store, open(fs_path, "w"), ensure_ascii=False, indent=1, sort_keys=True)
    import cloud

    def set_doc(c, i, data, merge=False):
        store[f"{c}/{i}"] = {**(store.get(f"{c}/{i}", {}) if merge else {}), **data}
        save()

    cloud.configured = lambda: True
    cloud.load_env = lambda *a, **k: None
    cloud.list_docs = lambda coll, fields=None: [(k.split("/", 1)[1], dict(v)) for k, v in sorted(store.items()) if k.startswith(coll + "/")]
    cloud.get_doc = lambda c, i: (dict(store[f"{c}/{i}"]) if f"{c}/{i}" in store else None)
    cloud.set_doc = set_doc

    def naver(url, params=None):   # 가짜 네이버 리서치: 목록(일부는 목표가 포함) + 상세
        if "/research/stock/" in url:
            t, items = url.rsplit("/", 1)[1], []
            for d in W.DAYS[-70:]:
                if d <= today and (hh(t, d) % 4 == 0 or d >= W.DAYS[-2]):
                    it = {"researchId": 100000 + hh(t, d, "n") % 800000, "title": f"{t} 리포트 {d:%m%d}",
                          "brokerName": ["KB증권", "NH투자증권", "미래에셋증권"][hh(t, d, "b") % 3], "writeDate": d.strftime("%Y%m%d")}
                    if hh(t, d, "inline") % 3 == 0:
                        it.update(goalPrice=f"{(50 + hh(t, d, 'tp') % 100) * 1000:,}", opinion="Buy")
                    items.append(it)
            items.sort(key=lambda x: (x["writeDate"], x["researchId"]), reverse=True)
            p, s = params["page"], params["pageSize"]
            return {"result": {"researchList": items[(p - 1) * s:p * s], "totalCount": len(items)}}
        nid = int(url.rsplit("/", 1)[1])
        return {"researchContent": {"goalPrice": "" if nid % 7 == 0 else f"{(60 + nid % 90) * 1000:,}", "opinion": "-" if nid % 5 == 0 else "매수",
                                    "attachUrl": f"https://example.com/r/{nid}.pdf"}, "title": f"상세 {nid}"}

    class Resp:
        def __init__(self, text=None, js=None):
            self.text, self._js = text, js

        def json(self):
            return self._js

    def macro(url, **kw):          # 가짜 FRED(csv) · Yahoo(json)
        d0 = W.START - dt.timedelta(days=420)
        days = [d0 + dt.timedelta(days=i) for i in range((today - d0).days + 1)]
        days = [d for d in days if d.weekday() < 5]
        if "fred" in url:
            sid = kw["params"]["id"]
            if sid == "M2SL":
                ms = sorted({d.replace(day=1) for d in days})
                return Resp("observation_date,M2SL\n" + "\n".join(f"{d},{21000 + i * 30}" for i, d in enumerate(ms)))
            if sid in ("WALCL", "WTREGEN"):
                return Resp(f"observation_date,{sid}\n" + "\n".join(f"{d},{(6600000 if sid == 'WALCL' else 800000) + hh(sid, d) % 50000}" for d in days if d.weekday() == 2))
            return Resp(f"observation_date,{sid}\n" + "\n".join(f"{d},{'.' if hh(sid, d) % 40 == 0 else round(1 + hh(sid, d) % 4000 / 1000, 3)}" for d in days))
        ts = [int(dt.datetime(d.year, d.month, d.day, 5).timestamp()) for d in days]
        return Resp(js={"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [{"close": [None if hh("dxy", d) % 50 == 0 else 100 + hh("dxy", d) % 800 / 100 for d in days]}]}}]}})

    import collect
    import flows
    import reports
    import build_site
    import publish_site
    collect.SLEEP = flows.SLEEP = reports.SLEEP = 0
    reports._get_json, flows._get = naver, macro
    try:
        collect.main()
    except SystemExit as e:
        print("SystemExit", e)
    sys.stdout, sys.stderr = sys.__stdout__, sys.__stderr__
    db_path = os.path.join(code, "kospi.db")
    build_site.build(db_path, os.path.join(code, "site_data"))
    publish_site.push_stock_flows()
    save()
    conn, dump = sqlite3.connect(db_path), {}
    for (tb,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({tb})")]
        rows = [list(r) for r in conn.execute(f"SELECT * FROM {tb}").fetchall()]
        if "updated" in cols:
            rows = [r[:cols.index("updated")] + r[cols.index("updated") + 1:] for r in rows]
        dump[tb] = sorted(rows, key=lambda r: json.dumps(r, ensure_ascii=False, default=str))
    json.dump(dump, open(os.path.join(code, "_dump.json"), "w"), ensure_ascii=False)
    print("RUN OK", {k: len(v) for k, v in dump.items()})


def snapshot(code):
    """비교용: DB 표 · site_data 파일 · Firebase 문서"""
    files = {}
    for root, _, names in os.walk(os.path.join(code, "site_data")):
        for n in names:
            p = os.path.join(root, n)
            js = json.load(open(p, encoding="utf-8"))
            if n == "meta.json":
                js.pop("built", None)
            files[os.path.relpath(p, code).replace(os.sep, "/")] = js
    fs = json.load(open(os.path.join(code, "_fs.json")))
    fs.get("state/report_job", {}).pop("at", None)
    fs.get("state/reports", {}).pop("updated", None)
    return {"db": json.load(open(os.path.join(code, "_dump.json"))), "files": files, "fs": fs}


def pipeline(src, label, tmp):
    """src(dashboard 폴더 또는 git 커밋)를 임시 폴더에 복사해 이틀치 실행. 반환: 날짜별 snapshot"""
    code = os.path.join(tmp, label)
    os.makedirs(code)
    if os.path.isdir(src):
        for f in os.listdir(src):
            if f.endswith(".py"):
                shutil.copy(os.path.join(src, f), code)
    else:
        subprocess.run(f"git archive {src} dashboard | tar -x -C {code} --strip-components=1", shell=True, check=True, cwd=REPO)
    sys.path.insert(0, FAKE)
    from pykrx import _world as W
    snaps = []
    for day in (W.DAYS[-3], W.DAYS[-1]):
        r = subprocess.run([sys.executable, os.path.abspath(__file__), "--run", code], capture_output=True, text=True,
                           env={**os.environ, "FAKE_DAY": day.strftime("%Y%m%d"), "PYTHONIOENCODING": "utf-8"})
        if "RUN OK" not in r.stdout:
            print((r.stdout + r.stderr)[-3000:])
            sys.exit(f"[{label}] {day} 실행 실패")
        print(f"[{label}] {day}: " + r.stdout.strip().splitlines()[-1])
        for line in r.stdout.splitlines():
            if "실패" in line or "Traceback" in line:
                print("    !", line.strip()[:200])
        snaps.append(snapshot(code))
    return snaps


def main():
    tmp = tempfile.mkdtemp(prefix="pc_test_")
    new = pipeline(os.path.join(REPO, "dashboard"), "now", tmp)
    fs = new[-1]["fs"]
    print("  Firebase 문서:", sorted(fs), "| 리포트", fs.get("state/reports", {}).get("n"), "건 | site_data 파일", len(new[-1]["files"]), "개")
    if len(sys.argv) > 1:
        old, bad = pipeline(sys.argv[1], "base", tmp), 0
        for i, (a, b) in enumerate(zip(old, new), 1):
            for part in ("db", "files", "fs"):
                for k in sorted(set(a[part]) | set(b[part])):
                    if a[part].get(k) != b[part].get(k):
                        bad += 1
                        print(f"  다름 (실행 {i}) {part}: {k}" + ("  ← 한쪽에만 있음" if k not in a[part] or k not in b[part] else ""))
        print(f"기준({sys.argv[1]})과 " + ("결과가 같아요 ✔" if not bad else f"다른 곳 {bad}개"))
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    run(sys.argv[2]) if sys.argv[1:2] == ["--run"] else main()
