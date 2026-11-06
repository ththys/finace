"""코스피 시가/종가 수집기 (pykrx -> SQLite)

사용법:
  python collect.py          # 처음이면 20년치 전체, 이후엔 새 날짜만 추가
  python collect.py --full   # 전체 다시 받기 (수정주가 갱신용, 월 1회 정도 권장)

받는 종목: 코스피 시총 상위 TOP_N + 화면의 '종목 관리'에서 추가한 관심 종목(코스닥 가능)

참고: 수정주가는 분할·증자 등이 생기면 과거 값이 바뀝니다.
      평소엔 증분으로 돌리고, 가끔 --full로 전체를 새로 받으세요.

필수: pykrx 1.2.x부터 KRX 정보데이터시스템(data.krx.co.kr) 로그인이 필요합니다.
      회원가입 후 같은 폴더에 .env 파일을 만들어 아래처럼 적어 두세요.
        KRX_ID=아이디
        KRX_PW=비밀번호
"""
import argparse
import datetime as dt
import os
import sys
import time

# 어디서 실행하든 이 파일이 있는 폴더 기준으로 동작
os.chdir(os.path.dirname(os.path.abspath(__file__)))


def _load_env(path=".env"):
    """pykrx import 전에 .env의 KRX_ID/KRX_PW를 환경변수로 올림"""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()
if not (os.getenv("KRX_ID") and os.getenv("KRX_PW")):
    sys.exit("KRX_ID / KRX_PW 가 없습니다. .env 파일을 만들어 주세요 (README 참고).")

from pykrx import stock  # noqa: E402

import db  # noqa: E402
import settings  # noqa: E402

TOP_N = 400               # 시총 상위 몇 종목
YEARS = 20                # 처음 받을 기간
SLEEP = 0.5               # 요청 사이 대기(초) - 너무 줄이면 차단될 수 있음
EXCLUDE_PREFERRED = True  # 상위 N 계산 시 우선주 제외 (관심 종목으로 직접 추가한 건 받음)

# 업종지수 중 섹터로 쓰지 않을 것(시장 전체, 규모별, 대표지수 등)
SKIP_KEYWORDS = ["코스피", "대형", "중형", "소형", "제조업", "200", "100", "50", "배당", "우량"]
KOSDAQ_SKIP = ["150", "대형", "중형", "소형", "기업부", "벤처", "프리미어", "글로벌", "우량", "종합"]


def latest_business_day():
    return stock.get_nearest_business_day_in_a_week()  # 'YYYYMMDD'


def update_master(conn, kospi_cap, kosdaq_cap):
    """검색용 코스피/코스닥 전 종목 목록 저장"""
    rows = None
    try:  # 한 번의 요청으로 전 종목 이름을 받는 방법
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
    db.save_master(conn, rows)
    print(f"  검색용 종목 목록 {len(rows)}개 저장")


def fetch_universe(conn, kospi_cap, kosdaq_cap):
    """코스피 시총 상위 TOP_N + 관심 종목. 반환: {종목: (시총, 시장)}"""
    cap = kospi_cap
    if EXCLUDE_PREFERRED:
        cap = cap[cap.index.str.endswith("0")]
    top = cap.sort_values("시가총액", ascending=False).head(TOP_N)
    universe = {t: (float(c), "KOSPI") for t, c in top["시가총액"].items()}

    watch = settings.get_watchlist(conn)
    added = 0
    for t in watch.index:
        if t in universe:
            continue
        if t in kospi_cap.index:
            universe[t] = (float(kospi_cap.loc[t, "시가총액"]), "KOSPI")
        elif t in kosdaq_cap.index:
            universe[t] = (float(kosdaq_cap.loc[t, "시가총액"]), "KOSDAQ")
        else:
            print(f"  ⚠ 관심 종목 {t} {watch.loc[t, 'name']}: 오늘 시세 없음 (상장폐지/거래정지?)")
            continue
        added += 1
    print(f"  상위 {len(top)}종목 + 관심 종목 {added}개(상위 밖)")
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
    코스닥 섹터는 코스피와 구분되도록 '코스닥 ' 을 앞에 붙임."""
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


def update_stocks(conn, day):
    print("종목/섹터 정보 갱신 중...")
    kospi_cap = stock.get_market_cap(day, market="KOSPI")
    kosdaq_cap = stock.get_market_cap(day, market="KOSDAQ")
    update_master(conn, kospi_cap, kosdaq_cap)

    universe = fetch_universe(conn, kospi_cap, kosdaq_cap)
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


def update_prices(conn, tickers, end_day, full=False):
    start_default = (dt.date.today() - dt.timedelta(days=365 * YEARS)).strftime("%Y%m%d")
    for i, t in enumerate(tickers, 1):
        last = None
        if not full:
            last = conn.execute("SELECT MAX(date) FROM prices WHERE ticker=?", (t,)).fetchone()[0]
        if last:
            start = (dt.date.fromisoformat(last) + dt.timedelta(days=1)).strftime("%Y%m%d")
            if start > end_day:
                continue
        else:
            start = start_default

        try:
            df = stock.get_market_ohlcv(start, end_day, t, adjusted=True)
        except Exception as e:
            print(f"  [{i}/{len(tickers)}] {t} 실패: {e}")
            continue

        if df.empty:
            continue
        rows = [
            (t, d.strftime("%Y-%m-%d"),
             float(r["시가"]) if r["시가"] > 0 else None,   # 거래정지일은 시가 0
             float(r["종가"]))
            for d, r in df.iterrows()
        ]
        conn.executemany("INSERT OR REPLACE INTO prices VALUES (?,?,?,?)", rows)
        conn.commit()
        print(f"  [{i}/{len(tickers)}] {t} +{len(rows)}일")
        time.sleep(SLEEP)


def export_to_drive(conn):
    """.env 의 DRIVE_EXPORT_DIR(구글 드라이브 동기화 폴더)에 완성된 DB 복사본 저장 → 웹 대시보드가 읽음"""
    folder = os.getenv("DRIVE_EXPORT_DIR", "").strip()
    if not folder:
        return
    try:
        path = db.export_copy(conn, folder)
        print(f"드라이브 폴더로 복사 완료: {path}")
    except Exception as e:
        print(f"드라이브 폴더 복사 실패: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="가격 전체 다시 받기")
    args = ap.parse_args()

    conn = db.connect()
    day = latest_business_day()
    print(f"기준일: {day}")
    tickers = update_stocks(conn, day)
    update_prices(conn, tickers, day, full=args.full)

    # 리포트 (실패해도 가격 업데이트에는 영향 없음)
    try:
        import reports
        reports.update_reports(conn)
    except Exception as e:
        print(f"리포트 업데이트 실패: {e}")

    export_to_drive(conn)
    conn.close()
    print("완료")


if __name__ == "__main__":
    main()
