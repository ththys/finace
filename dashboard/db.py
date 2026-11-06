"""DB 스키마와 관심종목 저장/조회 (collect.py, app.py 공용)"""
import datetime as dt
import sqlite3

import pandas as pd

DB_PATH = "kospi.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS stocks (           -- 화면에 나오는 종목 (매 업데이트마다 갱신)
    ticker     TEXT PRIMARY KEY,
    name       TEXT,
    sector     TEXT,
    market_cap REAL,
    updated    TEXT
);
CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT,
    date   TEXT,      -- YYYY-MM-DD
    open   REAL,
    close  REAL,
    PRIMARY KEY (ticker, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ticker_master (    -- 검색용 코스피/코스닥 전 종목
    ticker TEXT PRIMARY KEY,
    name   TEXT,
    market TEXT
);
CREATE TABLE IF NOT EXISTS reports (          -- 증권사 리포트 (네이버 리서치)
    nid          TEXT PRIMARY KEY,            -- 네이버 리포트 번호
    ticker       TEXT,
    name         TEXT,
    title        TEXT,
    broker       TEXT,                        -- 증권사
    date         TEXT,                        -- YYYY-MM-DD
    target_price REAL,                        -- 목표가 (없으면 NULL)
    opinion      TEXT,                        -- 투자의견
    pdf_url      TEXT,
    fetched_at   TEXT,
    seen         INTEGER DEFAULT 0            -- 화면에서 확인했는지
);
CREATE INDEX IF NOT EXISTS idx_reports_ticker ON reports(ticker, date);
CREATE TABLE IF NOT EXISTS watchlist (        -- 관심 종목 (상위 400 밖이어도 항상 받음)
    ticker        TEXT PRIMARY KEY,
    name          TEXT,
    market        TEXT,
    favorite      INTEGER DEFAULT 1,
    track_reports INTEGER DEFAULT 0,
    added         TEXT
);
"""


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH, timeout=30)
    conn.executescript(SCHEMA)
    return conn


def export_copy(conn, folder):
    """완성된 DB 복사본을 folder/kospi.db 로 저장 (구글 드라이브 동기화 폴더용).
    임시 파일에 다 쓴 뒤 한 번에 바꿔치기해서, 반쯤 쓴 파일이 동기화되지 않게 함."""
    import os
    if not folder:
        return None
    os.makedirs(folder, exist_ok=True)
    tmp = os.path.join(folder, "_kospi_writing.tmp")
    dst = os.path.join(folder, "kospi.db")
    out = sqlite3.connect(tmp)
    conn.backup(out)
    out.close()
    os.replace(tmp, dst)
    return dst


# ---------- 관심 종목 ----------

def get_watchlist(conn):
    return pd.read_sql(
        "SELECT ticker, name, market, favorite, track_reports, added FROM watchlist ORDER BY added",
        conn,
    ).set_index("ticker")


def add_watch(conn, ticker, name, market):
    conn.execute(
        "INSERT OR IGNORE INTO watchlist (ticker, name, market, added) VALUES (?,?,?,?)",
        (ticker, name, market, dt.datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()


def remove_watch(conn, tickers):
    conn.executemany("DELETE FROM watchlist WHERE ticker=?", [(t,) for t in tickers])
    conn.commit()


def set_flags(conn, ticker, favorite, track_reports):
    conn.execute(
        "UPDATE watchlist SET favorite=?, track_reports=? WHERE ticker=?",
        (int(favorite), int(track_reports), ticker),
    )
    conn.commit()


# ---------- 리포트 ----------

def get_reports(conn, tickers=None, unseen_only=False):
    sql = "SELECT * FROM reports WHERE 1=1"
    args = []
    if tickers is not None:
        sql += f" AND ticker IN ({','.join('?' * len(tickers))})"
        args += list(tickers)
    if unseen_only:
        sql += " AND seen = 0"
    sql += " ORDER BY date DESC, nid DESC"
    return pd.read_sql(sql, conn, params=args)


def mark_seen(conn, nids=None):
    if nids is None:
        conn.execute("UPDATE reports SET seen = 1")
    else:
        conn.executemany("UPDATE reports SET seen = 1 WHERE nid = ?", [(n,) for n in nids])
    conn.commit()


# ---------- 검색용 종목 목록 ----------

def get_master(conn):
    return pd.read_sql("SELECT ticker, name, market FROM ticker_master ORDER BY name", conn)


def save_master(conn, rows):
    """rows: [(ticker, name, market), ...]"""
    conn.execute("DELETE FROM ticker_master")
    conn.executemany("INSERT OR REPLACE INTO ticker_master VALUES (?,?,?)", rows)
    conn.commit()
