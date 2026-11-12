"""집 PC 매일 실행의 본체: KRX 가격 수집(pykrx → kospi.db) → 리포트 → 수급·매크로 → DB 백업 → 사이트 데이터 올리기

  python collect.py          처음이면 20년치 전체, 이후엔 새 날짜만 (kospi.bat · kospi_update.bat 이 updater.py 다음에 실행)
  python collect.py --full   전 종목 과거 가격을 처음부터 다시 받기 (몇 시간 걸림, 보통 필요 없음)

받는 종목: 코스피·코스닥 전 종목(우선주·스팩 제외) + 사이트에서 ☆ 누른 관심종목
.env: KRX_ID, KRX_PW (pykrx 1.2+ 는 KRX 정보데이터시스템 로그인 필요) + cloud.py · publish_site.py 가 쓰는 값
"""
import argparse
import datetime as dt
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)   # 어디서 실행하든 이 폴더 기준 (kospi.db, .env, site_data/)

import cloud  # noqa: E402

cloud.load_env()
if not (os.getenv("KRX_ID") and os.getenv("KRX_PW")):
    sys.exit("KRX_ID / KRX_PW 가 없습니다. 이 폴더의 .env 파일에 적어 주세요.")


class _Out:
    """화면에 나오는 내용을 last_run.log 에도 저장 (창이 닫혀도 확인 가능).
    pykrx 가 로그인하면서 찍는 KRX 아이디 줄은 화면에도 로그에도 남기지 않음"""

    def __init__(self, *streams):
        self.streams, self.skip_newline = streams, False

    def write(self, x):
        if "로그인 ID" in x:
            x = "".join(line for line in x.splitlines(True) if "로그인 ID" not in line)
            self.skip_newline = not x          # print 는 줄바꿈을 따로 한 번 더 쓰므로 그것도 뺌
            if not x:
                return
        elif self.skip_newline and x == "\n":
            self.skip_newline = False
            return
        else:
            self.skip_newline = False
        for s in self.streams:
            try:
                s.write(x)
                s.flush()
            except Exception:
                pass

    def flush(self):
        pass

    def __getattr__(self, name):      # encoding, isatty 등은 진짜 화면 것 그대로
        return getattr(self.streams[0], name)


try:
    _log = open(os.path.join(HERE, "last_run.log"), "w", encoding="utf-8")
    sys.stdout, sys.stderr = _Out(sys.__stdout__, _log), _Out(sys.__stderr__, _log)
except Exception:
    pass

from pykrx import stock  # noqa: E402

import db  # noqa: E402

YEARS = 20                # 처음 받을 기간
SLEEP = 0.5               # 요청 사이 대기(초) - 너무 줄이면 차단될 수 있음
HL_MAX_REQ = 700          # 한 번 실행에 고가·저가를 채울 날짜 수 (날짜 1개 = 요청 1번)

# 업종지수 중 섹터로 쓰지 않을 것(시장 전체, 규모별, 대표지수 등)
SKIP_KEYWORDS = ["코스피", "대형", "중형", "소형", "제조업", "200", "100", "50", "배당", "우량"]
KOSDAQ_SKIP = ["150", "대형", "중형", "소형", "기업부", "벤처", "프리미어", "글로벌", "우량", "종합"]
INSERT_PRICE = "INSERT OR REPLACE INTO prices (ticker, date, open, high, low, close, volume, value) VALUES (?,?,?,?,?,?,?,?)"


def watchlist():
    """사이트의 관심종목 {종목: {...}}. 못 읽으면 빈 목록으로 계속 (가격 수집은 전 종목이라 영향 없음)"""
    if not cloud.configured():
        return {}
    try:
        return cloud.watchlist()
    except Exception as e:
        print(f"  ⚠ 관심종목(Firebase)을 못 읽었어요 → 이번엔 관심종목 전용 작업을 건너뜀: {e}")
        return {}


# ---------------- 종목 · 섹터 ----------------

def update_master(conn, kospi_cap, kosdaq_cap):
    """코스피/코스닥 전 종목 이름 (ticker_master)"""
    rows = None
    try:  # 한 번의 요청으로 전 종목 이름을 받는 방법 (pykrx 내부 클래스)
        from pykrx.website.krx.market.ticker import StockTicker
        listed = StockTicker().listed
        mk = {"STK": "KOSPI", "KSQ": "KOSDAQ"}
        listed = listed[listed["시장"].isin(mk)]
        rows = [(t, r["종목"], mk[r["시장"]]) for t, r in listed.iterrows()]
    except Exception as e:
        print(f"  전 종목 목록 일괄 조회 실패, 개별 조회로 대체: {e}")
    if not rows:
        rows = [(t, stock.get_market_ticker_name(t), "KOSPI") for t in kospi_cap.index]
        rows += [(t, stock.get_market_ticker_name(t), "KOSDAQ") for t in kosdaq_cap.index]
    conn.execute("DELETE FROM ticker_master")
    conn.executemany("INSERT OR REPLACE INTO ticker_master VALUES (?,?,?)", rows)
    conn.commit()
    print(f"  검색용 종목 목록 {len(rows)}개 저장")


def fetch_universe(conn, kospi_cap, kosdaq_cap, watch):
    """코스피·코스닥 전체(우선주·스팩 제외) + 관심종목. 반환: {종목: (시총, 시장)}"""
    names = dict(conn.execute("SELECT ticker, name FROM ticker_master").fetchall())

    def clean(cap):
        cap = cap[(cap["시가총액"] > 0) & cap.index.str.endswith("0")]            # 끝자리 0 이 아니면 우선주
        return cap[[("스팩" not in names.get(t, "")) for t in cap.index]].sort_values("시가총액", ascending=False)

    universe = {t: (float(c), "KOSPI") for t, c in clean(kospi_cap)["시가총액"].items()}
    universe.update({t: (float(c), "KOSDAQ") for t, c in clean(kosdaq_cap)["시가총액"].items()})
    added = 0
    for t, w in watch.items():          # 관심종목은 우선주·스팩이어도 받음
        if t in universe:
            continue
        if t in kospi_cap.index:
            universe[t] = (float(kospi_cap.loc[t, "시가총액"]), "KOSPI")
        elif t in kosdaq_cap.index:
            universe[t] = (float(kosdaq_cap.loc[t, "시가총액"]), "KOSDAQ")
        else:
            print(f"  ⚠ 관심 종목 {t} {w.get('name', '')}: 오늘 시세 없음 (상장폐지/거래정지?)")
            continue
        added += 1
    k = sum(1 for _, m in universe.values() if m == "KOSPI")
    print(f"  코스피 {k} + 코스닥 {len(universe) - k}종목 (관심 종목 추가 {added}개)")
    return universe


def _index_members(day, market, skip, exclude_names=()):
    members = {}
    for idx in stock.get_index_ticker_list(day, market=market):
        name = stock.get_index_ticker_name(idx)
        if name in exclude_names or any(k in name for k in skip):
            continue
        try:
            tickers = stock.get_index_portfolio_deposit_file(idx, day)
        except Exception as e:
            print(f"  업종지수 {idx} {name} 실패: {e}")
            continue
        if tickers:
            members[name] = set(tickers)
        time.sleep(SLEEP)
    return members


def fetch_sector_map(day, need_kosdaq=False):
    """업종지수 구성종목으로 종목->섹터 매핑.
    한 종목이 여러 지수에 속하면 구성종목이 가장 적은(가장 구체적인) 지수를 택함.
    코스닥 섹터는 코스피와 구분되도록 '코스닥 ' 을 앞에 붙임 (사이트도 이 접두어로 구분)."""
    groups = [_index_members(day, "KOSPI", SKIP_KEYWORDS)]
    if need_kosdaq:
        kq = _index_members(day, "KOSDAQ", KOSDAQ_SKIP, exclude_names=("코스닥",))
        groups.append({f"코스닥 {n.replace('코스닥', '').strip()}": t for n, t in kq.items()})

    sector_of = {}
    for members in groups:
        for name, tickers in sorted(members.items(), key=lambda kv: len(kv[1])):
            for t in tickers:
                sector_of.setdefault(t, name)
    return sector_of


def update_stocks(conn, day, watch):
    print("종목/섹터 정보 갱신 중...")
    kospi_cap = stock.get_market_cap(day, market="KOSPI")
    kosdaq_cap = stock.get_market_cap(day, market="KOSDAQ")
    update_master(conn, kospi_cap, kosdaq_cap)

    universe = fetch_universe(conn, kospi_cap, kosdaq_cap, watch)
    need_kosdaq = any(m == "KOSDAQ" for _, m in universe.values())
    sectors = fetch_sector_map(day, need_kosdaq)
    names = dict(conn.execute("SELECT ticker, name FROM ticker_master").fetchall())
    today = dt.date.today().isoformat()
    rows = [
        (t, names.get(t) or stock.get_market_ticker_name(t), sectors.get(t, "기타"), cap, today)
        for t, (cap, _) in universe.items()
    ]
    conn.executemany(
        """INSERT INTO stocks VALUES (?,?,?,?,?)
           ON CONFLICT(ticker) DO UPDATE SET
             name=excluded.name, sector=excluded.sector,
             market_cap=excluded.market_cap, updated=excluded.updated""",
        rows,
    )
    # 이번에 빠진 종목은 목록에서만 제외 (가격 기록은 남겨 둠 → 다시 들어오면 이어서 받음)
    conn.execute("DELETE FROM stocks WHERE updated <> ?", (today,))
    conn.commit()
    print(f"  {len(rows)}종목, 섹터 {len(set(r[2] for r in rows))}개")
    return list(universe.keys())


# ---------------- 가격 ----------------

def _fetch_one(conn, t, start, end_day):
    """한 종목 기간 시세 (수정주가) → DB. 반환: 저장한 일수"""
    df = stock.get_market_ohlcv(start, end_day, t, adjusted=True)
    if df.empty:
        return 0
    rows = [
        (t, d.strftime("%Y-%m-%d"),
         float(r["시가"]) if r["시가"] > 0 else None,   # 거래정지일은 시가 0
         float(r["고가"]) if r.get("고가", 0) > 0 else None,
         float(r["저가"]) if r.get("저가", 0) > 0 else None,
         float(r["종가"]),
         float(r["거래량"]) if "거래량" in r else None,
         float(r["거래대금"]) if "거래대금" in r and r["거래대금"] == r["거래대금"] else None)
        for d, r in df.iterrows()
    ]
    conn.executemany(INSERT_PRICE, rows)
    conn.commit()
    return len(rows)


def _by_date(conn, tickers, start, end_day):
    """날짜별로 전 종목을 한 번에 받기 (하루 1번 요청). 반환: 과거를 다시 받아야 할 종목(분할·병합 등), 실패하면 None"""
    want = set(tickers)
    redo = set()
    d = dt.datetime.strptime(start, "%Y%m%d").date()
    last = dt.datetime.strptime(end_day, "%Y%m%d").date()
    while d <= last:
        if d.weekday() < 5:
            ds = d.strftime("%Y%m%d")
            try:
                df = stock.get_market_ohlcv_by_ticker(ds, market="ALL")
            except Exception as e:
                print(f"  {ds} 전 종목 시세 실패 → 종목별로 받음: {e}")
                return None
            time.sleep(SLEEP)
            if df is not None and not df.empty and not (df[["시가", "고가", "저가", "종가"]] == 0).all(axis=None):
                iso = d.isoformat()
                prev = dict(conn.execute(
                    "SELECT p.ticker, p.close FROM prices p JOIN (SELECT ticker, MAX(date) md FROM prices WHERE date < ? GROUP BY ticker) m "
                    "ON p.ticker = m.ticker AND p.date = m.md", (iso,)).fetchall())
                rows = []
                for t, r in df.iterrows():
                    if t not in want or not r["종가"]:
                        continue
                    close = float(r["종가"])
                    pc = prev.get(t)
                    # 전 종목 시세는 '그날 가격'(수정 전). 하루 가격제한폭(±30%)을 넘게 변한 종목 = 분할·병합·감자 → 과거를 수정주가로 다시 받음
                    if pc and abs(close / pc - 1) > 0.305:
                        redo.add(t)
                    pos = lambda k: float(r[k]) if k in r and r[k] > 0 else None
                    rows.append((t, iso, pos("시가"), pos("고가"), pos("저가"), close,
                                 float(r["거래량"]), float(r["거래대금"]) if "거래대금" in r else None))
                conn.executemany(INSERT_PRICE, rows)
                conn.commit()
                print(f"  {iso}: 전 종목 {len(rows)}개 한 번에 저장")
        d += dt.timedelta(days=1)
    return redo


def backfill_high_low(conn, max_req=HL_MAX_REQ):
    """예전에 받은 가격에 비어 있는 고가·저가를 날짜별 전 종목 시세로 채움 (다 채우면 할 일 없음).
    전 종목 시세는 '그날 가격'(수정 전)이라, DB 종가(수정주가)와의 비율로 맞춰서 넣음 → 분할 종목도 캔들이 맞음"""
    todo = [r[0] for r in conn.execute(
        "SELECT date FROM prices WHERE high IS NULL AND close > 0 AND date NOT IN (SELECT date FROM hl_done) "
        "GROUP BY date ORDER BY date DESC")]
    if not todo:
        return
    n = min(len(todo), max_req)
    print(f"고가·저가 채우기: 남은 {len(todo)}일 중 {n}일 (최근부터)", flush=True)
    t0, filled = time.time(), 0
    for k, iso in enumerate(todo[:n], 1):
        ds = iso.replace("-", "")
        try:
            df = stock.get_market_ohlcv_by_ticker(ds, market="ALL")
        except Exception as e:
            print(f"\n  {iso} 실패: {e} → 다음 실행 때 이어서")
            break
        time.sleep(SLEEP)
        rows = []
        if df is not None and not df.empty:
            have = dict(conn.execute("SELECT ticker, close FROM prices WHERE date=? AND high IS NULL", (iso,)).fetchall())
            for t, r in df.iterrows():
                c0 = have.get(t)
                if not c0 or not r["종가"] or not (r["고가"] > 0 and r["저가"] > 0):
                    continue
                f = c0 / float(r["종가"])
                rows.append((float(r["고가"]) * f, float(r["저가"]) * f,
                             float(r["시가"]) * f if r["시가"] > 0 else None, t, iso))
            conn.executemany("UPDATE prices SET high=?, low=?, open=COALESCE(open, ?) WHERE ticker=? AND date=? AND high IS NULL", rows)
        conn.execute("INSERT OR IGNORE INTO hl_done VALUES (?)", (iso,))
        if k % 20 == 0 or k == n:
            conn.commit()
        filled += len(rows)
        el = time.time() - t0
        sys.stdout.write(f"\r  [{'#' * int(k / n * 25)}{'.' * (25 - int(k / n * 25))}] {k / n * 100:5.1f}%  {iso}  "
                         f"{k}/{n}일 · 남은 시간 약 {el / k * (n - k) / 60:,.0f}분   ")
        sys.stdout.flush()
    conn.commit()
    print(f"\n  고가·저가 {filled:,}개 채움" + (f" · 남은 {len(todo) - n}일은 다음 실행 때" if len(todo) > n else " · 전부 완료"))


def update_prices(conn, tickers, end_day, full=False):
    """평소: 날짜별 전 종목 한 번에 (몇 초). 새 종목·분할 종목·오래 끊긴 종목·--full 만 종목별로 받음"""
    start_default = (dt.date.today() - dt.timedelta(days=365 * YEARS)).strftime("%Y%m%d")
    info = {t: conn.execute("SELECT MAX(date), COUNT(volume) FROM prices WHERE ticker=?", (t,)).fetchone()
            for t in tickers}
    # 종목별로 받아야 하는 것: --full, 처음 보는 종목, 거래량이 아직 없는 종목
    redo_full = set()
    one_by_one = [t for t in tickers if full or not info[t][0] or not info[t][1]]
    rest = [t for t in tickers if t not in set(one_by_one)]
    if rest:  # 한 달 넘게 끊긴 종목(거래정지 등)은 종목별로
        newest = max(info[t][0] for t in rest)
        cut = (dt.date.fromisoformat(newest) - dt.timedelta(days=30)).isoformat()
        stale = [t for t in rest if info[t][0] < cut]
        one_by_one += stale
        rest = [t for t in rest if info[t][0] >= cut]

    if rest:
        common = min(info[t][0] for t in rest)  # 가장 뒤처진 날짜부터
        start = (dt.date.fromisoformat(common) + dt.timedelta(days=1)).strftime("%Y%m%d")
        gap = (dt.datetime.strptime(end_day, "%Y%m%d").date() - dt.date.fromisoformat(common)).days
        if start <= end_day:
            redo = _by_date(conn, rest, start, end_day) if gap <= 120 else None
            if redo is None:  # 실패했거나 너무 오래 비었으면 종목별로
                one_by_one += rest
            elif redo:
                print(f"  분할·병합 등으로 과거 가격을 다시 받을 종목 {len(redo)}개: {', '.join(sorted(redo)[:10])}")
                redo_full.update(redo)
                one_by_one += sorted(redo)
        else:
            print("  가격: 이미 최신")

    for i, t in enumerate(one_by_one, 1):
        last = None if (full or t in redo_full) else conn.execute("SELECT MAX(date) FROM prices WHERE ticker=? AND volume IS NOT NULL",
                                              (t,)).fetchone()[0]
        start = (dt.date.fromisoformat(last) + dt.timedelta(days=1)).strftime("%Y%m%d") if last else start_default
        if start > end_day:
            continue
        try:
            n = _fetch_one(conn, t, start, end_day)
        except Exception as e:
            print(f"  [{i}/{len(one_by_one)}] {t} 실패: {e}")
            continue
        if n:
            print(f"  [{i}/{len(one_by_one)}] {t} +{n}일")
        time.sleep(SLEEP)


# ---------------- 실행 ----------------

def step(name, fn):
    """한 단계가 실패해도 나머지는 계속"""
    try:
        return fn()
    except Exception as e:
        print(f"{name} 실패: {type(e).__name__}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="가격 전체 다시 받기")
    args = ap.parse_args()

    def lazy(module, func, *a):   # 모듈 하나가 고장 나도 나머지 단계는 돌도록 그때그때 import
        return lambda: getattr(__import__(module), func)(*a)

    step("리포트 버튼 설정", lazy("publish_site", "setup_actions"))
    conn = db.connect()
    day = stock.get_nearest_business_day_in_a_week()  # 'YYYYMMDD'
    print(f"기준일: {day}")
    watch = watchlist()
    tickers = update_stocks(conn, day, watch)
    update_prices(conn, tickers, day, full=args.full)
    step("고가·저가 채우기", lambda: backfill_high_low(conn))
    step("리포트 업데이트", lazy("reports", "run"))
    step("수급 업데이트", lazy("flows", "update_all", conn, day, watch))
    folder = os.getenv("DRIVE_EXPORT_DIR", "").strip()   # DB 백업 (구글 드라이브 동기화 폴더 등)
    if folder:
        step("DB 백업", lambda: print(f"드라이브 폴더로 복사 완료: {db.export_copy(conn, folder)}"))
    conn.close()

    try:  # 사이트(GitHub Pages) 데이터 갱신 — .env 에 GITHUB_TOKEN 이 있을 때만
        import publish_site
        publish_site.main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"사이트 올리기 실패: {e}")
        print("(이 화면을 캡처해 주세요. 같은 내용이 last_run.log 에도 저장돼요.)")
        sys.exit(1)
    print("완료")


if __name__ == "__main__":
    main()
