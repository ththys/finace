#!/usr/bin/env python3
"""사이트 화면 시험 (Playwright) — 모든 메뉴를 차례로 열어 JS 에러·화면 글자·스크린샷을 확인 (4분쯤)

  python tools/smoke.py            지금 파일(index.html, web/, journal/ + data/)로 열어 보고 에러만 보고
  python tools/smoke.py HEAD       그 커밋의 화면과 글자·픽셀 단위로 비교 (리팩터링 뒤 '안 바뀌었는지' 확인용)
  python tools/smoke.py HEAD -v    글자가 달라진 줄도 출력
스크린샷은 /tmp/smoke_now, /tmp/smoke_base 에 남음 (바뀐 화면을 눈으로 볼 때).

로그인 화면(관심·리포트·그린 선)은 Firebase 를 가짜로 채워서 그림. 데이터는 저장소의 data/ 를 그대로 씀.
uPlot 은 CDN 이 막힌 곳에서는 npm 으로 받아 씀 (UPLOT_JS=파일경로 로 직접 줄 수도 있음).
"""
import difflib
import functools
import glob
import hashlib
import json
import http.server
import os
import random
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading

from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WATCH = {"005930": "삼성전자", "000660": "SK하이닉스", "462870": "시프트업"}
DRAWINGS = {"005930": {"h": [{"p": 207000}, {"p": 250000}], "t": [{"d1": "2026-03-03", "p1": 150000, "d2": "2026-09-01", "p2": 260000}]}}
LOGIN_JS = """([reps, watch, draw]) => {
  FB.enabled = true; FB.user = { email: 'tester@example.com', uid: 'u1' };
  FB.watch = Object.fromEntries(Object.entries(watch).map(([t, n], i) => [t, { favorite: true, track_reports: true, name: n, group: i ? '반도체' : '' }]));
  S.reports = (typeof prepReports === 'function') ? prepReports(reps) : reps; S.reportsInfo = '2026-11-12 18:00';
  FB.journal = [{ id: 'p1', date: '2026-09-01', title: '테스트 글', kind: '매수', tickers: [{ code: '005930', name: '삼성전자' }] }];
  FB.db = {}; FB.ready = Promise.resolve();
  const docs = { 'state/drawings': { json: JSON.stringify(draw) } };
  FB.F = { doc: (db, c, id) => c + '/' + id, getDoc: async k => ({ exists: () => k in docs, data: () => docs[k] }), setDoc: async (k, v) => { docs[k] = v; },
           deleteDoc: async () => {}, getDocs: async () => ({ forEach() {}, docs: [] }), collection: (db, c) => c };
  if (typeof DRAW !== 'undefined') { DRAW.all = null; DRAW.key = null; }
}"""


def fake_live(route):
    """네이버 실시간 시세 JSONP 흉내. 지수는 100배 값, 하락은 부호 없는 cr + rf=5 로 (실제 응답과 같은 까다로운 경우)"""
    from urllib.parse import urlparse, parse_qs
    cb = parse_qs(urlparse(route.request.url).query).get("_callback", ["cb"])[0]
    js = {"resultCode": "success", "result": {"areas": [
        {"name": "SERVICE_ITEM", "datas": [
            {"cd": "005930", "nv": 210000, "pcv": 208000, "cv": 2000, "cr": 0.96, "rf": "2"},
            {"cd": "000660", "nv": 1240000, "cv": 14000, "cr": 1.12, "rf": "5"},
            {"cd": "462870", "nv": 27000, "pcv": 26700, "cv": 300, "cr": 1.12, "rf": "2"}]},
        {"name": "SERVICE_INDEX", "datas": [
            {"cd": "KOSPI", "nv": 536000, "pcv": 534273, "cv": 1727, "cr": 0.32, "rf": "2"},
            {"cd": "KOSDAQ", "nv": 69000, "pcv": 69653, "cv": 653, "cr": 0.94, "rf": "5"}]}]}}
    route.fulfill(status=200, content_type="text/javascript", body=f"{cb}({json.dumps(js)});")


def fake_reports():
    """관심종목 3개 × 증권사 5곳 × 11개월. 저장 형식 그대로(사실만) + 옛 화면 코드가 기대하던 계산 필드"""
    random.seed(7)
    rows, base = [], {"005930": 200000, "000660": 1500000, "462870": 60000}
    for t, n in WATCH.items():
        for bi, br in enumerate(["KB증권", "NH투자", "미래에셋", "삼성증권", "키움증권"]):
            tp = base[t]
            for m in range(1, 12):
                tp = int(tp * (1 + random.uniform(-.06, .12)) / 100) * 100
                rows.append({"nid": f"{t[-3:]}{bi}{m:02d}", "date": f"2026-{m:02d}-{5 + bi * 4:02d}", "t": t, "n": n, "broker": br,
                             "title": f"{n} {m}월 리뷰", "op": "매수" if m % 5 else "중립", "tp": tp, "pdf": None, "upside": None})
    rows.sort(key=lambda r: (r["date"], r["nid"]))
    last_tp, last_op = {}, {}
    for r in rows:
        k = (r["t"], r["broker"])
        r["prev_tp"], r["prev_op"] = last_tp.get(k), last_op.get(k)
        last_tp[k], last_op[k] = r["tp"], r["op"]
    return rows[::-1]


def uplot_js():
    p = os.environ.get("UPLOT_JS")
    if p:
        return p
    cache = os.path.join(tempfile.gettempdir(), "uplot-1.6.30.iife.min.js")
    if not os.path.exists(cache):
        try:
            d = tempfile.mkdtemp()
            subprocess.run(["npm", "pack", "uplot@1.6.30", "--silent", "--pack-destination", d], check=True, capture_output=True, timeout=120)
            with tarfile.open(glob.glob(d + "/*.tgz")[0]) as tf:
                open(cache, "wb").write(tf.extractfile("package/dist/uPlot.iife.min.js").read())
        except Exception as e:
            print(f"(uPlot 을 npm 으로 못 받음 → CDN 사용: {e})")
            return None
    return cache


def serve(root):
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(H, directory=root))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}"


def scenario(base, out):
    """모든 화면을 차례로. 반환: {단계: {text, canvas}} + _errors + _overflow"""
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    res, errs, cur, up = {}, [], ["boot"], uplot_js()
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(viewport={"width": 1300, "height": 900}, color_scheme="dark", locale="ko-KR", timezone_id="Asia/Seoul").new_page()
        if up:
            pg.route("https://cdn.jsdelivr.net/**", lambda r: r.fulfill(path=up, content_type="application/javascript"))
        pg.route("https://www.gstatic.com/**", lambda r: r.abort())          # Firebase 는 가짜로 대신함
        pg.route("https://fonts.googleapis.com/**", lambda r: r.fulfill(status=200, body="", content_type="text/css"))
        pg.route("https://fonts.gstatic.com/**", lambda r: r.abort())
        pg.route("https://polling.finance.naver.com/**", fake_live)      # 실시간 시세도 가짜 (화면이 매번 같게)
        pg.on("pageerror", lambda e: errs.append(f"[{cur[0]}] {e}"))
        pg.on("console", lambda m: m.type == "error" and not any(x in m.text for x in ("gstatic", "ERR_FAILED", "status of 404")) and errs.append(f"[{cur[0]}] console: {m.text[:200]}"))
        ready = "typeof S !== 'undefined' && S.meta && S.home"

        def snap(name, wait=2500, sel="#app"):
            cur[0] = name
            pg.wait_for_timeout(wait)
            pg.mouse.move(2, 2)
            txt = pg.inner_text(sel) if pg.locator(sel).count() else ""
            pg.screenshot(path=os.path.join(out, name + ".png"), full_page=True)
            res[name] = {"text": txt, "sha": hashlib.sha1(txt.encode()).hexdigest()[:10], "canvas": pg.locator("canvas").count()}

        def go(hash_, pre=None):
            pg.goto(base + "/index.html#home")
            pg.wait_for_function(ready, timeout=60000)
            if pre:
                pg.evaluate(pre)
            pg.evaluate(f"location.hash = '{hash_}'")

        btn = lambda sel, text: pg.locator(sel, has_text=text).first.click()
        pg.goto(base + "/index.html")
        pg.wait_for_function(ready, timeout=60000)
        pg.evaluate("localStorage.clear()")
        go("home"); snap("home", 5000); snap("tape", 0, "#tape")
        btn("#mvtabs button", "거래대금"); snap("home_val", 800)
        btn("#ixm button", "코스닥"); btn("#ixr button", "전체"); snap("home_idx_kq_all", 1500)
        go("sectors"); snap("sectors", 5000)
        btn("#rrgmk button", "코스닥"); snap("sectors_rrg_kq", 1200)
        pg.locator("#sectbl2 tbody tr").nth(3).click(); snap("sectors_pick", 1500)
        go("screen"); snap("screen", 4500)
        pg.get_by_role("button", name="퀀트: 멀티팩터 상위").click(); snap("screen_quant", 2000)
        pg.get_by_role("button", name="매물 가벼움").click(); snap("screen_over", 4000)
        go("flow"); snap("flow", 5000)
        btn("#fmkt button", "코스닥"); btn("#mrange button", "10년"); snap("flow_kq_10y", 2500)
        go("stock", "store.set('stock','005930')"); snap("stock_day", 5000)
        btn(".period .seg button", "3년"); snap("stock_3y", 3500)
        btn("#ctype button", "주봉"); snap("stock_week", 3500)
        btn("#ctype button", "월봉"); snap("stock_month", 3500)
        btn("#ctype button", "선"); snap("stock_line", 3500)
        btn("#pxm button", "수익률 비교"); snap("stock_ret", 3000)
        btn("#pxm button", "가격"); btn("#ctype button", "일봉"); pg.wait_for_timeout(2500)
        btn(".period .seg button", "6개월"); pg.wait_for_timeout(2500)
        for sel in ("button[data-x=rsi]", "button[data-x=macd]", "button[data-g='4']", "button[data-g='0']"):
            pg.click(sel)
        pg.locator("#pxaxis button", has_text="로그").click(); pg.wait_for_timeout(2500)
        pg.locator("#bandc input[data-f=on]").check(); snap("stock_ind_band_log", 3000)
        btn("#vbt button", "PBR 밴드"); btn("#ddw button", "60일"); snap("stock_pbr_dd60", 3000)
        go("stock", "store.set('stock','000660'); store.set('preset','1M')"); snap("stock_hynix_1m", 5000)
        # 여기부터 로그인한 상태 (Firebase 가짜)
        go("home"); pg.wait_for_timeout(1500); pg.evaluate(LOGIN_JS, [fake_reports(), WATCH, DRAWINGS])
        pg.evaluate("location.hash='reports'"); snap("reports", 5000)
        pg.locator("#tpr tbody tr").nth(1).click(); snap("reports_pick", 1500)
        pg.evaluate("location.hash='watch'"); snap("watch", 5000)
        pg.evaluate("location.hash='home'"); snap("home_login", 5000)
        pg.evaluate("store.set('stock','005930'); store.set('preset','YTD'); store.set('ctype','day'); store.set('pxaxis','lin'); location.hash='stock'"); snap("stock_login", 6000)
        go("journal"); snap("journal", 3000, "body")
        go("home"); pg.wait_for_timeout(2500); pg.click("#themeBtn"); snap("home_light", 4000)
        pg.evaluate("location.hash='stock'"); snap("stock_light", 5000)
        pg.set_viewport_size({"width": 390, "height": 844})
        go("home"); snap("m_home", 5000)
        go("stock"); snap("m_stock", 5000)
        res["_overflow"] = pg.evaluate("document.documentElement.scrollWidth")
        b.close()
    res["_errors"] = errs
    return res


def compare(a, b, da, db, verbose):
    from PIL import Image, ImageChops
    bad = 0
    for k in a:
        if k.startswith("_"):
            continue
        t = "같음" if a[k]["text"] == b[k]["text"] else "글자 다름"
        ia, ib = Image.open(f"{da}/{k}.png").convert("RGB"), Image.open(f"{db}/{k}.png").convert("RGB")
        if ia.size != ib.size:
            px = f"크기 {ia.size} → {ib.size}"
        else:
            d = ImageChops.difference(ia, ib).convert("L")
            n = sum(1 for v in d.tobytes() if v > 24)
            px = "같음" if n == 0 else f"픽셀 {n}개 다름 {d.point(lambda v: 255 if v > 24 else 0).getbbox()}"
        if (t, px) != ("같음", "같음") and k != "journal":      # 투자일지 높이는 그때그때 조금 다름
            bad += 1
            print(f"  {k:20s} 글자: {t}  그림: {px}")
            if verbose and t != "같음":
                for line in list(difflib.unified_diff(a[k]["text"].split("\n"), b[k]["text"].split("\n"), lineterm="", n=0))[:12]:
                    print("       ", line[:170])
    return bad


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("-")]
    now = scenario(serve(REPO), "/tmp/smoke_now")
    print(f"지금: {len(now) - 2}개 화면, JS 에러 {len(now['_errors'])}개, 휴대폰 화면 폭 {now['_overflow']} (390 이면 안 넘침)")
    for e in now["_errors"]:
        print("  에러:", e)
    bad = len(now["_errors"]) + (now["_overflow"] > 390)
    if args:
        tmp = tempfile.mkdtemp(prefix="smoke_base_")
        names = [n for n in subprocess.run(["git", "ls-tree", "--name-only", args[0]], capture_output=True, text=True, cwd=REPO, check=True).stdout.split("\n") if n and n != "data"]
        subprocess.run(f"git archive {args[0]} {' '.join(names)} | tar -x -C {tmp}", shell=True, check=True, cwd=REPO)
        os.symlink(os.path.join(REPO, "data"), os.path.join(tmp, "data"))
        base = scenario(serve(tmp), "/tmp/smoke_base")
        n = compare(base, now, "/tmp/smoke_base", "/tmp/smoke_now", "-v" in sys.argv)
        print(f"기준({args[0]})과 " + ("화면이 같아요 ✔" if not n else f"다른 화면 {n}개 (의도한 변경인지 /tmp/smoke_base · /tmp/smoke_now 에서 확인)"))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
