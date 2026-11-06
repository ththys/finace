"""관심 종목·리포트 확인 상태 저장소

- Firebase가 설정돼 있으면 Firestore(watchlist, state 컬렉션)에 저장 → 집 PC와 웹이 같은 설정을 씀
- 아니면 예전처럼 kospi.db 안의 watchlist 테이블에 저장
처음 Firebase에 연결하면 로컬에 있던 관심 종목을 한 번 올려 줍니다.
"""
import datetime as dt
import time
from zoneinfo import ZoneInfo

import pandas as pd

import cloud
import db

KST = ZoneInfo("Asia/Seoul")
COLS = ["name", "market", "favorite", "track_reports", "added"]
_cache = {"wl": None, "t": 0, "state": None, "st": 0}
TTL = 30  # 초


def now_kst():
    """한국 시각 (타임존 표시 없이) — 리포트 fetched_at 과 같은 형식"""
    return dt.datetime.now(KST).replace(tzinfo=None).isoformat(timespec="seconds")


def use_cloud():
    return cloud.configured()


def _invalidate():
    _cache.update(wl=None, t=0, state=None, st=0)


def _local_watchlist(conn):
    return db.get_watchlist(conn)


def _migrate_if_needed(conn):
    """Firebase 관심 종목이 비어 있고 로컬에만 있으면 한 번 올려 줌"""
    meta = cloud.get_doc("state", "meta") or {}
    if meta.get("watchlist_migrated"):
        return
    local = _local_watchlist(conn) if conn is not None else pd.DataFrame()
    for t, r in local.iterrows():
        cloud.set_doc("watchlist", t, {
            "name": r["name"], "market": r["market"], "favorite": bool(r["favorite"]),
            "track_reports": bool(r["track_reports"]), "added": r["added"]})
    cloud.set_doc("state", "meta", {"watchlist_migrated": True, "migrated_at": now_kst()}, merge=True)


def get_watchlist(conn=None):
    """index=ticker, columns=name, market, favorite(0/1), track_reports(0/1), added"""
    if not use_cloud():
        return _local_watchlist(conn or db.connect())
    if _cache["wl"] is not None and time.time() - _cache["t"] < TTL:
        return _cache["wl"].copy()
    docs = cloud.list_docs("watchlist")
    if not docs:
        _migrate_if_needed(conn)
        docs = cloud.list_docs("watchlist")
    rows = [{"ticker": i, "name": d.get("name", i), "market": d.get("market", ""),
             "favorite": int(bool(d.get("favorite", True))), "track_reports": int(bool(d.get("track_reports", False))),
             "added": d.get("added", "")} for i, d in docs]
    wl = pd.DataFrame(rows, columns=["ticker"] + COLS).set_index("ticker").sort_values("added")
    _cache.update(wl=wl, t=time.time())
    return wl.copy()


def add_watch(conn, ticker, name, market):
    if use_cloud():
        cloud.set_doc("watchlist", ticker, {"name": name, "market": market, "favorite": True,
                                            "track_reports": False, "added": now_kst()})
        _invalidate()
    else:
        db.add_watch(conn, ticker, name, market)


def remove_watch(conn, tickers):
    if use_cloud():
        for t in tickers:
            cloud.delete_doc("watchlist", t)
        _invalidate()
    else:
        db.remove_watch(conn, tickers)


def set_flags(conn, ticker, favorite, track_reports):
    if use_cloud():
        cloud.set_doc("watchlist", ticker, {"favorite": bool(favorite), "track_reports": bool(track_reports)},
                      merge=True)
        _invalidate()
    else:
        db.set_flags(conn, ticker, favorite, track_reports)


# ---------- 리포트 확인 상태 ----------

def reports_seen_at():
    """이 시각까지 수집된 리포트는 '확인함'. 로컬 모드면 None (db.seen 컬럼만 사용)"""
    if not use_cloud():
        return None
    if _cache["state"] is None or time.time() - _cache["st"] >= TTL:
        _cache.update(state=(cloud.get_doc("state", "reports") or {}), st=time.time())
    return _cache["state"].get("seen_at")


def unseen_mask(reports_df):
    """reports 테이블 DataFrame → 새 리포트 여부 Series"""
    m = reports_df["seen"] == 0
    seen_at = reports_seen_at()
    if seen_at:
        m &= reports_df["fetched_at"].fillna("") > seen_at
    return m


def mark_all_seen(conn, reports_df=None):
    """화면에 보인 새 리포트까지 확인 처리"""
    if use_cloud():
        upto = reports_df["fetched_at"].max() if reports_df is not None and len(reports_df) else now_kst()
        cloud.set_doc("state", "reports", {"seen_at": upto}, merge=True)
        _invalidate()
    else:
        db.mark_seen(conn)
