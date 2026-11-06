"""투자일지(Firebase Firestore) 읽기 — 대시보드용, 읽기 전용

웹 투자일지(https://ththys.github.io/finace/journal/)에 쓴 글을 읽어 옵니다.
설정 (.env 또는 Streamlit secrets):
  FIREBASE_API_KEY=AIzaSyBdXtCVCYp8QkvQ4ZTccFbzVO1kQkD9PPE
  FIREBASE_PROJECT_ID=finace-journal
  JOURNAL_EMAIL=rnqhscjf7410@naver.com        (Firebase에 이메일/비밀번호 사용자로 만든 계정)
  JOURNAL_PASSWORD=그 계정 비밀번호
  JOURNAL_URL=https://ththys.github.io/finace/journal/
"""
import os
import re
from urllib.parse import quote

import pandas as pd

import cloud

configured = cloud.configured
load_env = cloud.load_env


def web_url(path=""):
    base = os.getenv("JOURNAL_URL", "").strip()
    if not base:
        return None
    return base.rstrip("/") + "/#/" + path.lstrip("/")


def new_post_url(code=None, name=None):
    if not code:
        return web_url("new")
    return web_url(f"new?code={quote(code)}&name={quote(name or '')}")


def fetch_posts():
    """journal 컬렉션 전체 → DataFrame (최신순)"""
    rows = []
    for doc_id, f in cloud.list_docs("journal", fields=["title", "date", "kind", "tickers", "tags", "body"]):
        tickers = f.get("tickers") or []
        body = f.get("body") or ""
        rows.append({
            "id": doc_id,
            "date": f.get("date") or "",
            "kind": f.get("kind") or "메모",
            "title": f.get("title") or "(제목 없음)",
            "codes": [t.get("code") for t in tickers if isinstance(t, dict) and t.get("code")],
            "names": [t.get("name") for t in tickers if isinstance(t, dict) and t.get("name")],
            "tags": f.get("tags") or [],
            "excerpt": re.sub(r"\s+", " ", re.sub(r"!\[[^\]]*\]\([^)]*\)|[#>*_`]", "", body)).strip()[:120],
        })
    df = pd.DataFrame(rows, columns=["id", "date", "kind", "title", "codes", "names", "tags", "excerpt"])
    if not df.empty:
        df["link"] = df["id"].map(lambda i: web_url(f"post/{i}"))
        df = df.sort_values("date", ascending=False).reset_index(drop=True)
    else:
        df["link"] = []
    return df


def for_ticker(df, code, name=None):
    """종목코드(또는 이름)로 그 종목 일지만"""
    if df.empty:
        return df
    mask = df["codes"].map(lambda cs: code in cs)
    if name:
        mask |= df["names"].map(lambda ns: name in ns)
    return df[mask]
