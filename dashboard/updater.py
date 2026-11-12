"""저장소의 최신 코드로 이 폴더의 파이썬 파일을 맞춤 — kospi.bat · kospi_update.bat · 리포트만.bat 이 매번 먼저 실행

- 전부 받은 뒤에 한꺼번에 덮어씀 (중간에 끊겨 새 파일과 옛 파일이 섞이지 않게). 실패하면 지금 파일 그대로 진행.
- updater.py 자신이 바뀌었으면 새 버전으로 한 번 더 실행 (새로 생긴 파일도 같은 실행에서 받도록).
- .env, kospi.db, 배치(.bat)는 건드리지 않음. NEW_ONLY 의 배치는 없을 때만 만들어 줌.
유지보수 주의: 집 PC는 이 파일의 RAW 주소와 FILES 로만 새 코드를 받는다.
  저장소 경로(dashboard/)나 파일 이름을 바꾸면 집 PC가 더는 업데이트를 못 받는다.
  새 파일을 추가한 첫 실행에서는 (옛 updater 가 모르는 파일이라) 그 파일이 아직 없을 수 있다 → 새 모듈 import 는 실패해도 넘어가게.
"""
import os
import subprocess
import sys
from urllib.parse import quote

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = "https://raw.githubusercontent.com/ththys/finace/main/dashboard/"
FILES = ["collect.py", "db.py", "cloud.py", "flows.py", "flowsite.py", "build_site.py", "publish_site.py", "reports.py", "updater.py"]
NEW_ONLY = ["리포트만.bat"]


def fetch(name):
    """파일 내용(줄바꿈 LF). 저장소에 없으면 None, 그 밖의 실패는 예외"""
    r = requests.get(RAW + quote(name), timeout=20)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    if not r.content:
        raise RuntimeError(f"{name}: 빈 응답")
    return r.content.replace(b"\r\n", b"\n")


def main(again=False):
    try:
        got = {f: fetch(f) for f in FILES}
    except Exception as e:
        print(f"코드 업데이트 건너뜀 (지금 파일로 계속): {e}")
        return
    changed = []
    for f, new in got.items():
        path = os.path.join(HERE, f)
        old = open(path, "rb").read().replace(b"\r\n", b"\n") if os.path.exists(path) else None
        if new is None or old == new:
            continue
        with open(path + ".new", "wb") as fh:
            fh.write(new)
        os.replace(path + ".new", path)
        changed.append(f)
    for f in NEW_ONLY:
        path = os.path.join(HERE, f)
        try:
            new = None if os.path.exists(path) else fetch(f)
            if new:
                open(path, "wb").write(new.replace(b"\n", b"\r\n"))
                changed.append(f + " (새로 만듦)")
        except Exception:
            pass
    print(f"코드 업데이트: {', '.join(changed)}" if changed else "코드 업데이트: 이미 최신")
    if "updater.py" in changed and not again:
        subprocess.call([sys.executable, os.path.join(HERE, "updater.py"), "--again"])


if __name__ == "__main__":
    try:
        main("--again" in sys.argv)
    except Exception as e:
        print(f"코드 업데이트 실패(지금 파일로 계속): {e}")
    sys.exit(0)
