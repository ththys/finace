"""네이버 증권 리서치 > 종목분석 리포트 수집 (2026-09 개편 이후 JSON API 사용)

종목 관리에서 '리포트 추적'을 켠 종목만 확인합니다.
- 처음 추적하는 종목: 최근 BACKFILL_MONTHS 개월치를 받아 '과거 리포트'로 저장
- 그 다음부터: 매일 새로 올라온 리포트만 '새 리포트'로 저장

사용법:
  python reports.py               # 추적 종목 전체 업데이트
  python reports.py --test 005930 # 점검: 한 종목을 읽어서 화면에 출력만 (DB 저장 안 함)
                                  # 이상하면 debug_*.json 을 남김 → 그 파일을 보내 주세요

개인 확인용으로 요청 간격을 두고 조금씩만 읽습니다. 리포트 원문(PDF)은 저장하지 않고 링크만 보관합니다.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time

import requests

os.chdir(os.path.dirname(os.path.abspath(__file__)))
import db  # noqa: E402
import settings  # noqa: E402

LIST_API = "https://m.stock.naver.com/api/research/stock/{ticker}"   # ?pageSize=&page=
DETAIL_API = "https://m.stock.naver.com/api/research/company/{nid}"
WEB_URL = "https://stock.naver.com/research/company/{nid}"            # 사람이 보는 페이지

BACKFILL_MONTHS = 12   # 처음 추적할 때 받을 기간
PAGE_SIZE = 50
MAX_PAGES = 20         # 안전장치
SLEEP = 1.0            # 요청 사이 대기(초)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://stock.naver.com/research/company",
    "Accept": "application/json",
}


# ---------------- JSON 다루기 (필드 이름이 바뀌어도 최대한 버티도록) ----------------

def _get_json(url, params=None):
    r = requests.get(url, params=params, headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def _items(js):
    """응답에서 리포트 목록(list of dict)을 찾아냄. 바로 list이거나 dict 안에 들어 있는 경우 모두 처리"""
    if isinstance(js, list):
        return [x for x in js if isinstance(x, dict)]
    if isinstance(js, dict):
        for key in ("researches", "researchList", "items", "list", "contents", "content", "result", "data"):
            if key in js:
                found = _items(js[key])
                if found:
                    return found
        for v in js.values():
            if isinstance(v, (list, dict)):
                found = _items(v)
                if found and any(_pick(x, "researchId", "nid", "id") for x in found):
                    return found
    return []


def _pick(d, *keys):
    """여러 후보 키 중 처음 값이 있는 것. 한 단계 안쪽 dict(researchContent 등)까지 찾아봄"""
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d[k]
    for v in (d.values() if isinstance(d, dict) else []):
        if isinstance(v, dict):
            for k in keys:
                if v.get(k) not in (None, ""):
                    return v[k]
    return None


def _date(v):
    """'20260922' / '2026-09-22' / '2026.09.22' / '2026-09-22T10:00:00' -> '2026-09-22'"""
    if v is None:
        return None
    digits = re.sub(r"\D", "", str(v))[:8]
    if len(digits) == 8:
        try:
            return dt.date(int(digits[:4]), int(digits[4:6]), int(digits[6:])).isoformat()
        except ValueError:
            return None
    if len(digits) == 6:  # yymmdd
        try:
            return dt.date(2000 + int(digits[:2]), int(digits[2:4]), int(digits[4:])).isoformat()
        except ValueError:
            return None
    return None


def _num(v):
    if v in (None, ""):
        return None
    try:
        x = float(str(v).replace(",", ""))
        return x if x > 0 else None
    except ValueError:
        return None


def _opinion(v):
    if v in (None, "", "-", "없음", "N/A", "NR"):
        return None
    return str(v).strip()


def parse_item(it):
    nid = _pick(it, "researchId", "nid", "id")
    return {
        "nid": str(nid) if nid is not None else None,
        "title": _pick(it, "title", "researchTitle", "subject", "name") or "",
        "broker": _pick(it, "brokerName", "firmName", "broker", "writerName"),
        "date": _date(_pick(it, "writeDate", "date", "regDate", "createdAt")),
        # 목록에 목표가/의견이 같이 오면 상세 요청을 생략
        "target_price": _num(_pick(it, "goalPrice", "targetPrice")),
        "opinion": _opinion(_pick(it, "opinion", "investOpinion")),
        "pdf_url": _pick(it, "attachUrl", "pdfUrl"),
    }


def parse_detail(js):
    return {
        "target_price": _num(_pick(js, "goalPrice", "targetPrice")),
        "opinion": _opinion(_pick(js, "opinion", "investOpinion")),
        "pdf_url": _pick(js, "attachUrl", "pdfUrl"),
        "title": _pick(js, "title", "researchTitle", "subject"),
    }


def fetch_list(ticker, page=1, size=PAGE_SIZE):
    js = _get_json(LIST_API.format(ticker=ticker), {"pageSize": size, "page": page})
    items = [parse_item(x) for x in _items(js)]
    return [x for x in items if x["nid"] and x["date"]], js


def fetch_detail(nid):
    js = _get_json(DETAIL_API.format(nid=nid))
    return parse_detail(js), js


# ---------------- DB 업데이트 ----------------

def _collect_new(ticker, known, since):
    """새 리포트 목록. since(날짜)보다 오래된 게 나오거나, 이미 아는 것만 나오면 멈춤"""
    out, page = [], 1
    while page <= MAX_PAGES:
        items, js = fetch_list(ticker, page)
        time.sleep(SLEEP)
        if not items:
            if page == 1:
                return None, js           # 첫 페이지부터 비었음 → 점검 필요
            break
        stop = False
        for it in items:
            if it["nid"] in known or (since and it["date"] < since):
                stop = True
                continue
            out.append(it)
        if stop or len(items) < PAGE_SIZE:
            break
        page += 1
    return out, None


def update_reports(conn, verbose=True):
    watch = settings.get_watchlist(conn)
    tickers = watch.index[watch["track_reports"] == 1]
    if len(tickers) == 0:
        print("리포트: 추적 중인 종목이 없어요 (종목 관리에서 '리포트 추적'을 켜세요)")
        return 0
    print(f"리포트 확인 중... ({len(tickers)}종목)")
    known = {r[0] for r in conn.execute("SELECT nid FROM reports")}
    now = settings.now_kst()
    backfill_since = (dt.date.today() - dt.timedelta(days=30 * BACKFILL_MONTHS)).isoformat()
    total_new = 0

    for t in tickers:
        name = watch.loc[t, "name"]
        first = conn.execute("SELECT 1 FROM reports WHERE ticker=? LIMIT 1", (t,)).fetchone() is None
        try:
            new, empty_js = _collect_new(t, known, backfill_since if first else None)
        except Exception as e:
            print(f"  {name}: 목록 실패 ({e})")
            continue
        if new is None:
            path = f"debug_list_{t}.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(empty_js, f, ensure_ascii=False, indent=1)
            print(f"  {name}: 리포트 0건 → {path} 저장 (리포트가 없는 종목이거나 응답 형식이 달라진 것)")
            continue
        if first:
            print(f"  {name}: 처음 추적 → 최근 {BACKFILL_MONTHS}개월 {len(new)}건 받는 중 (과거 리포트로 저장)")

        for i, it in enumerate(new, 1):
            if it["target_price"] is None and it["opinion"] is None:
                try:
                    d, _ = fetch_detail(it["nid"])
                    it.update({k: v for k, v in d.items() if v is not None and not it.get(k)})
                    it["target_price"] = it["target_price"] or d["target_price"]
                    it["opinion"] = it["opinion"] or d["opinion"]
                except Exception as e:
                    print(f"  {name} {it['nid']}: 상세 실패 ({e})")
                time.sleep(SLEEP)
            conn.execute(
                "INSERT OR IGNORE INTO reports VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (it["nid"], t, name, it["title"], it["broker"], it["date"],
                 it["target_price"], it["opinion"], it["pdf_url"], now, 1 if first else 0),
            )
            known.add(it["nid"])
            if first and verbose and i % 20 == 0:
                print(f"    {i}/{len(new)}")
                conn.commit()
        conn.commit()
        if not first:
            if verbose:
                print(f"  {name}: 새 리포트 {len(new)}건")
            total_new += len(new)
    print(f"리포트 완료: 새 리포트 {total_new}건")
    return total_new


# ---------------- 점검 모드 ----------------

def self_test(ticker):
    print(f"[점검] {ticker} 리포트 목록 API 읽는 중...")
    try:
        items, js = fetch_list(ticker, 1, 5)
    except Exception as e:
        print(f"  ✗ 요청 실패: {e}")
        return
    if not items:
        path = f"debug_list_{ticker}.json"
        json.dump(js, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  ✗ 리포트를 못 읽었어요. 응답을 {path} 로 저장했어요 → 이 파일을 보내 주세요.")
        return
    raw = _items(js)[0]
    print(f"  ✓ {len(items)}건 읽음 (목록 항목의 키: {list(raw.keys())})")
    for it in items[:3]:
        print(f"    {it['date']} | {it['broker']} | {str(it['title'])[:40]} | nid={it['nid']} "
              f"| 목표가={it['target_price']} | 의견={it['opinion']}")
    time.sleep(SLEEP)
    d, djs = fetch_detail(items[0]["nid"])
    print(f"  최신 리포트 상세: 목표가={d['target_price']}, 의견={d['opinion']}, PDF={'O' if d['pdf_url'] else 'X'}")
    if d["target_price"] is None and d["opinion"] is None and items[0]["target_price"] is None:
        path = f"debug_detail_{items[0]['nid']}.json"
        json.dump(djs, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  ✗ 목표가/의견을 못 찾았어요. 응답을 {path} 로 저장했어요 → 이 파일을 보내 주세요.")
    else:
        print("  ✓ 정상")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", metavar="종목코드", help="DB 저장 없이 한 종목 점검")
    args = ap.parse_args()
    if args.test:
        self_test(args.test.zfill(6))
        return
    conn = db.connect()
    update_reports(conn)
    settings.cloud.load_env()
    folder = os.getenv("DRIVE_EXPORT_DIR", "").strip()
    if folder:
        try:
            print(f"드라이브 폴더로 복사 완료: {db.export_copy(conn, folder)}")
        except Exception as e:
            print(f"드라이브 폴더 복사 실패: {e}")
    conn.close()


if __name__ == "__main__":
    sys.exit(main())
