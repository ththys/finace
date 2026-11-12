"""Firebase(Firestore) REST + .env 읽기 + 관심종목 — 집 PC와 GitHub Actions 공용 (requests 만 필요)

설정 (.env 또는 환경변수): FIREBASE_API_KEY, FIREBASE_PROJECT_ID, JOURNAL_EMAIL, JOURNAL_PASSWORD
JOURNAL_EMAIL 은 Firebase Authentication 의 '이메일/비밀번호' 계정이고, Firestore 규칙이 허용한 계정이어야 함.
쓰는 곳: watchlist/{종목} (사이트의 ☆), state/reports · state/report_job (리포트), state/sf_{종목} (종목 수급), state/gh (사이트 버튼용 토큰)
"""
import os
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = ("FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "JOURNAL_EMAIL", "JOURNAL_PASSWORD")
_token = {"value": None, "exp": 0}


def load_env(path=None):
    """이 폴더의 .env 를 환경변수로 (이미 있는 값은 그대로)"""
    path = path or os.path.join(HERE, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def configured():
    load_env()
    return all(os.getenv(k) for k in KEYS)


def id_token():
    if _token["value"] and time.time() < _token["exp"] - 60:
        return _token["value"]
    r = requests.post(
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword",
        params={"key": os.environ["FIREBASE_API_KEY"]},
        json={"email": os.environ["JOURNAL_EMAIL"], "password": os.environ["JOURNAL_PASSWORD"],
              "returnSecureToken": True},
        timeout=15,
    )
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", r.text[:200])
        except ValueError:
            msg = r.text[:200]
        raise RuntimeError(f"Firebase 로그인 실패: {msg}")
    js = r.json()
    _token.update(value=js["idToken"], exp=time.time() + int(js.get("expiresIn", 3600)))
    return _token["value"]


def _base():
    return (f"https://firestore.googleapis.com/v1/projects/{os.environ['FIREBASE_PROJECT_ID']}"
            f"/databases/(default)/documents")


def _headers():
    return {"Authorization": f"Bearer {id_token()}"}


def _check(r):
    if r.status_code == 403:
        raise RuntimeError("Firebase 권한 없음: Firestore 규칙에 이 컬렉션과 계정이 허용돼 있는지 확인하세요.")
    r.raise_for_status()
    return r


# ---------- 값 변환 ----------

def decode(v):
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "timestampValue" in v:
        return v["timestampValue"]
    if "nullValue" in v:
        return None
    if "arrayValue" in v:
        return [decode(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: decode(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def encode(x):
    if x is None:
        return {"nullValue": None}
    if isinstance(x, bool):
        return {"booleanValue": x}
    if isinstance(x, int):
        return {"integerValue": str(x)}
    if isinstance(x, float):
        return {"doubleValue": x}
    if isinstance(x, (list, tuple)):
        return {"arrayValue": {"values": [encode(i) for i in x]}}
    if isinstance(x, dict):
        return {"mapValue": {"fields": {k: encode(v) for k, v in x.items()}}}
    return {"stringValue": str(x)}


# ---------- 문서 다루기 ----------

def list_docs(collection, fields=None):
    """[(id, dict), ...]"""
    out, token = [], None
    while True:
        params = {"pageSize": 300}
        if fields:
            params["mask.fieldPaths"] = list(fields)
        if token:
            params["pageToken"] = token
        js = _check(requests.get(f"{_base()}/{collection}", headers=_headers(), params=params, timeout=20)).json()
        for d in js.get("documents", []):
            out.append((d["name"].rsplit("/", 1)[-1], {k: decode(v) for k, v in d.get("fields", {}).items()}))
        token = js.get("nextPageToken")
        if not token:
            return out


def get_doc(collection, doc_id):
    r = requests.get(f"{_base()}/{collection}/{doc_id}", headers=_headers(), timeout=15)
    if r.status_code == 404:
        return None
    return {k: decode(v) for k, v in _check(r).json().get("fields", {}).items()}


def set_doc(collection, doc_id, data, merge=False):
    params = {"updateMask.fieldPaths": list(data)} if merge else None
    _check(requests.patch(f"{_base()}/{collection}/{doc_id}", headers=_headers(), params=params,
                          json={"fields": {k: encode(v) for k, v in data.items()}}, timeout=15))


def watchlist():
    """사이트에서 ☆ 누른 종목: {종목코드: {name, market, favorite, track_reports, group, added}}"""
    return dict(list_docs("watchlist"))
