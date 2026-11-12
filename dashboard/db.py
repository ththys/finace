"""kospi.db (SQLite) 의 모든 표. 날짜는 'YYYY-MM-DD' 글자, 값은 원/주 단위 그대로"""
import os
import sqlite3

DB_PATH = "kospi.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS stocks (           -- 사이트에 나오는 종목 (실행할 때마다 통째로 갱신)
    ticker TEXT PRIMARY KEY, name TEXT, sector TEXT, market_cap REAL, updated TEXT);
CREATE TABLE IF NOT EXISTS ticker_master (    -- 코스피·코스닥 전 종목 이름·시장
    ticker TEXT PRIMARY KEY, name TEXT, market TEXT);
CREATE TABLE IF NOT EXISTS prices (           -- 일별 수정주가. open/high/low 는 없을 수 있음(NULL)
    ticker TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, value REAL,
    PRIMARY KEY (ticker, date)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date);
CREATE TABLE IF NOT EXISTS hl_done (date TEXT PRIMARY KEY);   -- 고가·저가 채우기를 끝낸 날짜 (collect.backfill_high_low)
-- 아래는 flows.py 가 채움
CREATE TABLE IF NOT EXISTS flow (date TEXT, market TEXT, investor TEXT, value REAL,       -- 시장 투자자별 순매수(원)
    PRIMARY KEY (date, market, investor)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS etf (date TEXT, ticker TEXT, close REAL, nav REAL, aum REAL, shares REAL,   -- 레버리지·인버스 ETF
    PRIMARY KEY (ticker, date)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS macro (series TEXT, date TEXT, value REAL,                     -- FRED·야후·VKOSPI·지수(IDX_KOSPI/IDX_KOSDAQ)
    PRIMARY KEY (series, date)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS fund (date TEXT, ticker TEXT, eps REAL, bps REAL, dps REAL, per REAL, pbr REAL, div REAL,
    PRIMARY KEY (ticker, date)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS stflow (date TEXT, ticker TEXT, investor TEXT, value REAL,     -- 관심종목 투자자별 순매수(원)
    PRIMARY KEY (ticker, date, investor)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS stown (date TEXT, ticker TEXT, own REAL, exh REAL, sbal REAL, samt REAL, sratio REAL,   -- 관심종목 외국인 지분율·공매도
    PRIMARY KEY (ticker, date)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS opt (date TEXT, isu TEXT, kind TEXT, expiry TEXT, strike REAL,  -- 코스피200 옵션 (최근 120거래일)
    close REAL, spot REAL, oi REAL, PRIMARY KEY (date, isu)) WITHOUT ROWID;
"""


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH, timeout=30)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(prices)")}
    for c in ("volume", "value", "high", "low"):      # 아주 예전 DB 에 없던 칸
        if cols and c not in cols:
            conn.execute(f"ALTER TABLE prices ADD COLUMN {c} REAL")
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def export_copy(conn, folder):
    """DB 복사본을 folder/kospi.db 로 (백업용 · 구글 드라이브 동기화 폴더). 임시 파일에 다 쓴 뒤 바꿔치기"""
    os.makedirs(folder, exist_ok=True)
    tmp, dst = os.path.join(folder, "_kospi_writing.tmp"), os.path.join(folder, "kospi.db")
    out = sqlite3.connect(tmp)
    conn.backup(out)
    out.close()
    os.replace(tmp, dst)
    return dst
