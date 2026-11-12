"""사이트 데이터(site_data/ → 저장소 data/)를 만들어 GitHub 에 올리기 — 집 PC가 매일 실행 (collect.py 가 호출)

python publish_site.py

- build_site.py 로 site_data/ 를 만들고, GitHub API 로 '바뀐 파일만' 올림 (git 설치 필요 없음). 1~2분 뒤 사이트에 반영.
- 화면 코드(index.html, web/)는 저장소에 있는 것을 그대로 쓰므로 여기서는 data/ 만 올림.
- 관심종목 수급은 공개 파일이 아니라 Firebase(state/sf_종목)에 올림 (로그인한 본인만 봄).
- 한 번만: 사이트 [지금 리포트 받기] 버튼용 설정(setup_actions).

.env: GITHUB_TOKEN=github_pat_...  (Fine-grained 토큰, 이 저장소만: Contents 읽기·쓰기 + 리포트 버튼을 쓰려면 Actions·Secrets 읽기·쓰기)
"""
import base64
import hashlib
import os
import subprocess
import sys
import time

import requests

import cloud

HERE = os.path.dirname(os.path.abspath(__file__))
cloud.load_env()
REPO = os.getenv("SITE_REPO", "ththys/finace")
BRANCH = os.getenv("SITE_BRANCH", "main")
API = f"https://api.github.com/repos/{REPO}"
BOT = {"name": "site-bot", "email": "site-bot@users.noreply.github.com"}   # 데이터 커밋에 계정 정보를 남기지 않음
MAX_BLOBS = 440      # GitHub 은 '파일 만들기' 요청을 1시간 500개, 1분 80개까지만 받아줌 → 넘는 건 다음 실행 때
BATCH = 60           # 60개마다 바로 반영 (중간에 꺼져도 올린 건 남음)
PACE = 0.85          # 요청 간격(초) → 1분 약 70개
SECRETS = cloud.KEYS  # GitHub Actions(reports.yml)에 넘겨줄 Firebase 값


def git_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def collect_files(out_dir):
    """{저장소 경로: 내용 bytes} — data/**"""
    files = {}
    for root, _, names in os.walk(out_dir):
        for n in names:
            p = os.path.join(root, n)
            files["data/" + os.path.relpath(p, out_dir).replace(os.sep, "/")] = open(p, "rb").read()
    return files


def _session(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    return s


def publish(files, token, message):
    s = _session(token)

    def call(method, path, **kw):
        for k in range(6):
            try:
                r = s.request(method, API + path, timeout=60, **kw)
            except requests.RequestException:
                if k == 5:
                    raise
                time.sleep(5 * (k + 1))
                continue
            if r.status_code in (403, 429) and ("rate limit" in r.text.lower() or "retry-after" in r.headers):
                wait = int(r.headers.get("retry-after") or 0) or max(60, int(r.headers.get("x-ratelimit-reset", 0)) - int(time.time()))
                wait = min(wait, 900)
                print(f"\n  GitHub 속도 제한 → {wait}초 쉬었다 이어서 올려요...", flush=True)
                time.sleep(wait)
                continue
            if r.status_code in (401, 403, 404):
                raise RuntimeError(f"GitHub 권한/주소 문제 ({r.status_code}): {r.text[:200]}")
            if r.status_code >= 500 and k < 5:
                time.sleep(5 * (k + 1))
                continue
            r.raise_for_status()
            return r.json()

    head = call("GET", f"/git/ref/heads/{BRANCH}")["object"]["sha"]
    base_tree = call("GET", f"/git/commits/{head}")["tree"]["sha"]
    tree = call("GET", f"/git/trees/{base_tree}", params={"recursive": "1"})
    remote = {e["path"]: e["sha"] for e in tree.get("tree", []) if e["type"] == "blob"}

    changed = [p for p, b in files.items() if remote.get(p) != git_sha(b)]
    if not changed:
        print("사이트: 바뀐 파일 없음")
        return 0
    # 순서: 요약 파일 → 종목별 묶음 파일(최근 것부터: M2026-11 → Y2025 → …)
    big = lambda p: p.startswith(("data/ohlc/", "data/fund/"))
    rest = sorted((p for p in changed if big(p)), key=lambda p: p.rsplit("/", 1)[-1][1:], reverse=True)
    changed = [p for p in changed if not big(p)] + rest
    later = changed[MAX_BLOBS:]
    changed = changed[:MAX_BLOBS]
    total = sum(len(files[p]) for p in changed)
    print(f"  GitHub 올리는 중: {len(changed)}개 파일, {total / 1048576:,.1f} MB"
          + (f" (나머지 {len(later)}개는 1시간 뒤 다음 실행 때)" if later else ""), flush=True)
    done, t0 = [0, 0], time.time()

    def bar():
        pct = done[1] / total * 100 if total else 100
        el = time.time() - t0
        left = len(changed) - done[0]
        eta = left * max(PACE, el / done[0] if done[0] else PACE)
        fill = int(pct / 4)
        sys.stdout.write(f"\r  [{'#' * fill}{'.' * (25 - fill)}] {pct:5.1f}%  {done[0]}/{len(changed)}개"
                         f"  {done[1] / 1048576:,.1f}/{total / 1048576:,.1f} MB  남은 시간 약 {eta / 60:,.0f}분   ")
        sys.stdout.flush()

    def commit_batch(entries, msg):
        for _ in range(3):
            cur = call("GET", f"/git/ref/heads/{BRANCH}")["object"]["sha"]
            bt = call("GET", f"/git/commits/{cur}")["tree"]["sha"]
            nt = call("POST", "/git/trees", json={"base_tree": bt, "tree": entries})["sha"]
            c = call("POST", "/git/commits", json={"message": msg, "tree": nt, "parents": [cur], "author": BOT, "committer": BOT})["sha"]
            try:
                call("PATCH", f"/git/refs/heads/{BRANCH}", json={"sha": c})
                return
            except requests.HTTPError:
                time.sleep(3)   # 그 사이 다른 커밋이 들어옴 → 다시
        raise RuntimeError("GitHub 반영 실패 (계속 충돌)")

    bar()
    entries, nb = [], 0
    for p in changed:
        t1 = time.time()
        blob = call("POST", "/git/blobs", json={"content": base64.b64encode(files[p]).decode(), "encoding": "base64"})
        entries.append({"path": p, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        done[0] += 1
        done[1] += len(files[p])
        bar()
        if len(entries) >= BATCH or done[0] == len(changed):
            nb += 1
            commit_batch(entries, message + (f" ({nb})" if len(changed) > BATCH else ""))
            entries = []
        time.sleep(max(0, PACE - (time.time() - t1)))
    print(flush=True)
    print(f"사이트: {len(changed)}개 파일 올림 ({total / 1024:,.0f} KB) → https://{REPO.split('/')[0]}.github.io/{REPO.split('/')[1]}/"
          + (f"\n  남은 {len(later)}개는 다음 실행(1시간 뒤 이후) 때 이어서 올려요." if later else ""))
    return len(changed)


def push_stock_flows():
    """관심종목 수급(종목별 투자자 순매수·외국인 지분율·공매도)을 Firebase 에 → 로그인한 본인만 봄"""
    import sqlite3
    import flowsite
    if not cloud.configured():
        return
    conn = sqlite3.connect(os.path.join(HERE, "kospi.db"))
    try:
        docs = flowsite.stock_flow_docs(conn)
    finally:
        conn.close()
    ok = 0
    for t, blob in docs.items():
        try:
            cloud.set_doc("state", f"sf_{t}", {"json": blob})
            ok += 1
        except Exception as e:
            print(f"  종목 수급 {t} 올리기 실패: {e}")
    if docs:
        print(f"관심종목 수급: {ok}종목 Firebase 에 올림")


def setup_actions(force=False):
    """한 번만: 사이트 [지금 리포트 받기] 버튼이 되게 준비.
    1) .env 의 Firebase 값 4개를 저장소 Secrets 에 (GitHub Actions 가 Firebase 에 쓰려면 필요)
    2) GITHUB_TOKEN 을 내 Firebase(state/gh)에 (사이트 버튼이 GitHub Actions 를 부를 때 씀 — 로그인한 본인만 읽음)
    토큰에 Actions·Secrets 읽기·쓰기 권한이 없으면 안내만 하고 다음 실행 때 다시 시도"""
    mark = os.path.join(HERE, ".cloud_setup_done")
    cloud.load_env()
    tok = os.getenv("GITHUB_TOKEN", "").strip()
    if (os.path.exists(mark) and not force) or not tok or not cloud.configured():
        return False
    howto = ("  → 권한을 추가해 두면 다음 실행 때 자동으로 설정돼요: https://github.com/settings/personal-access-tokens 에서 이 저장소용 토큰 → Edit\n"
             "     → Repository permissions → Actions 와 Secrets 를 Read and write 로 → Update")
    s = _session(tok)
    r = s.get(f"{API}/actions/secrets/public-key", timeout=20)
    if r.status_code in (401, 403, 404):
        print(f"사이트 [지금 리포트 받기] 버튼 설정: GitHub 토큰에 Secrets 권한이 없어 건너뜀 ({r.status_code})\n{howto}")
        return False
    r.raise_for_status()
    pk = r.json()
    print("리포트 버튼 설정 (한 번만)...")
    try:
        from nacl import encoding, public
    except ImportError:
        print("  암호화 도구(pynacl) 설치 중...")
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "pynacl"], check=False)
        from nacl import encoding, public
    box = public.SealedBox(public.PublicKey(pk["key"].encode(), encoding.Base64Encoder()))
    for k in SECRETS:
        enc = base64.b64encode(box.encrypt(os.environ[k].encode())).decode()
        x = s.put(f"{API}/actions/secrets/{k}", json={"encrypted_value": enc, "key_id": pk["key_id"]}, timeout=20)
        if x.status_code not in (201, 204):
            print(f"  {k} 넣기 실패 ({x.status_code}): {x.text[:150]}\n{howto}")
            return False
    print(f"  GitHub Secrets {len(SECRETS)}개 넣음")
    t = s.post(f"{API}/actions/workflows/reports.yml/dispatches", json={"ref": BRANCH}, timeout=20)
    if t.status_code in (401, 403, 404):
        print(f"  GitHub 토큰에 Actions 권한이 없어 건너뜀 ({t.status_code})\n{howto}")
        return False
    cloud.set_doc("state", "gh", {"token": tok})
    print("  사이트 버튼용 토큰 저장 · 리포트 받기 한 번 실행 시작 (1~2분 뒤 사이트 리포트 화면에 반영)")
    open(mark, "w").write("ok")
    return True


def main():
    cloud.load_env()
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if not token:
        print("사이트: .env 에 GITHUB_TOKEN 이 없어서 올리지 않았어요.")
        return
    import build_site
    out = os.path.join(HERE, "site_data")
    print("사이트 파일 만드는 중...", flush=True)
    meta = build_site.build(os.path.join(HERE, "kospi.db"), out)
    publish(collect_files(out), token, f"Site data {meta['asof']}")
    push_stock_flows()


if __name__ == "__main__":
    os.chdir(HERE)
    main()
