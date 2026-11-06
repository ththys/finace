"""DB 파일 위치 정하기

- 집 PC: 같은 폴더의 kospi.db 를 그대로 씀
- 웹(Streamlit 클라우드): 구글 드라이브 폴더에서 kospi.db 를 내려받아 씀 (바뀐 경우에만 다시 받음)

웹 설정 (Streamlit secrets):
  GDRIVE_FOLDER_ID = "드라이브 폴더 주소 끝의 ID"
  [gcp_service_account]   ← 서비스 계정 JSON 내용 그대로
  type = "service_account"
  ...
"""
import json
import os
import tempfile

import requests

LOCAL_DB = "kospi.db"
CACHE_DB = os.path.join(tempfile.gettempdir(), "kospi_from_drive.db")
_state = {"modified": None}


def is_web():
    return bool(os.getenv("GDRIVE_FOLDER_ID"))


def _service_account_info():
    raw = os.getenv("GCP_SERVICE_ACCOUNT_JSON")
    if raw:
        return json.loads(raw)
    try:
        import streamlit as st
        return dict(st.secrets["gcp_service_account"])
    except Exception:
        raise RuntimeError("서비스 계정 정보(gcp_service_account)가 secrets에 없어요.")


def _drive_token():
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_info(
        _service_account_info(), scopes=["https://www.googleapis.com/auth/drive.readonly"])
    creds.refresh(Request())
    return creds.token


def drive_info():
    """드라이브 폴더 안 kospi.db 의 (id, 수정시각, 크기)"""
    token = _drive_token()
    q = f"'{os.environ['GDRIVE_FOLDER_ID']}' in parents and name = 'kospi.db' and trashed = false"
    r = requests.get("https://www.googleapis.com/drive/v3/files",
                     headers={"Authorization": f"Bearer {token}"},
                     params={"q": q, "fields": "files(id,modifiedTime,size)", "orderBy": "modifiedTime desc",
                             "supportsAllDrives": "true", "includeItemsFromAllDrives": "true"},
                     timeout=20)
    if r.status_code == 404:
        raise RuntimeError("드라이브 폴더를 찾을 수 없어요. 폴더 ID와 서비스 계정 공유를 확인하세요.")
    r.raise_for_status()
    files = r.json().get("files", [])
    if not files:
        raise RuntimeError("드라이브 폴더에 kospi.db 가 없어요. 집 PC에서 업데이트를 한 번 돌리고, "
                           "폴더가 서비스 계정 이메일과 공유됐는지 확인하세요.")
    f = files[0]
    return f["id"], f["modifiedTime"], int(f.get("size", 0)), token


def db_path():
    """지금 쓸 DB 파일 경로. 웹이면 드라이브 파일이 바뀐 경우에만 새로 받음"""
    if not is_web():
        return LOCAL_DB
    fid, modified, _size, token = drive_info()
    if modified != _state["modified"] or not os.path.exists(CACHE_DB):
        tmp = CACHE_DB + ".part"
        with requests.get(f"https://www.googleapis.com/drive/v3/files/{fid}",
                          headers={"Authorization": f"Bearer {token}"},
                          params={"alt": "media", "supportsAllDrives": "true"},
                          stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(tmp, "wb") as out:
                for chunk in r.iter_content(1 << 20):
                    out.write(chunk)
        os.replace(tmp, CACHE_DB)
        _state["modified"] = modified
    return CACHE_DB


def last_modified():
    return _state["modified"]
