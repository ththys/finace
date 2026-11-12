"""관심종목 증권사 리포트 (네이버 증권 리서치) → Firebase state/reports

집 PC(collect.py 가 매일)와 GitHub Actions(.github/workflows/reports.yml: 사이트의 [지금 리포트 받기] 버튼 · 평일 자동)가
같은 코드로 실행. DB 는 쓰지 않고 Firebase 문서가 저장소:
  state/reports     {json: [{nid,date,t,broker,title,op,tp,pdf} ... 최신순], n, updated}   ← 사이트가 로그인 후 읽음
  state/report_job  {state: running|done|error, at, new, n, msg}                          ← 사이트 버튼이 끝났는지 확인
직전 목표가·상승여력·종목 이름은 저장하지 않고 사이트가 계산 (web/lists.js prepReports).
처음 보는 종목은 최근 BACKFILL_MONTHS 개월치, 그 다음부터는 새로 올라온 것만. 원문(PDF)은 링크만 보관.

  python reports.py        (리포트만.bat · reports.yml)
"""
import datetime as dt
import json
import re
import sys
import time

import requests

import cloud

LIST_API = "https://m.stock.naver.com/api/research/stock/{ticker}"   # ?pageSize=&page=
DETAIL_API = "https://m.stock.naver.com/api/research/company/{nid}"   # 사람이 보는 주소: https://stock.naver.com/research/company/{nid}
BACKFILL_MONTHS = 12   # 처음 추적할 때 받을 기간
KEEP_DAYS = 730        # 이보다 오래된 리포트는 버림
MAX_BYTES = 900_000    # Firestore 문서 1MB 제한 (넘으면 오래된 것부터 버림)
PAGE_SIZE = 50
MAX_PAGES = 20         # 안전장치
SLEEP = 1.0            # 요청 사이 대기(초)
FIELDS = ("nid", "date", "t", "broker", "title", "op", "tp", "pdf")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://stock.naver.com/research/company",
    "Accept": "application/json",
}


# ---------------- 네이버 응답 읽기 (필드 이름이 바뀌어도 최대한 버티도록) ----------------

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
    """'20260922' / '2026-09-22' / '2026.09.22' / '2026-09-22T10:00:00' / '260922' -> '2026-09-22'"""
    digits = re.sub(r"\D", "", str(v or ""))[:8]
    if len(digits) == 6:
        digits = "20" + digits
    try:
        return dt.date(int(digits[:4]), int(digits[4:6]), int(digits[6:8])).isoformat() if len(digits) == 8 else None
    except ValueError:
        return None


def _num(v):
    try:
        x = float(str(v).replace(",", ""))
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def _opinion(v):
    return None if v in (None, "", "-", "없음", "N/A", "NR") else str(v).strip()


def _parse(js, listing):
    """목록 항목 또는 상세 응답 → 우리 필드 (없으면 None)"""
    nid = _pick(js, "researchId", "nid", "id") if listing else None
    return {
        "nid": str(nid) if nid is not None else None,
        "title": _pick(js, "title", "researchTitle", "subject", *(["name"] if listing else [])),
        "broker": _pick(js, "brokerName", "firmName", "broker", "writerName") if listing else None,
        "date": _date(_pick(js, "writeDate", "date", "regDate", "createdAt")) if listing else None,
        "tp": _num(_pick(js, "goalPrice", "targetPrice")),
        "op": _opinion(_pick(js, "opinion", "investOpinion")),
        "pdf": _pick(js, "attachUrl", "pdfUrl"),
    }


def fetch_list(ticker, page=1, size=PAGE_SIZE):
    js = _get_json(LIST_API.format(ticker=ticker), {"pageSize": size, "page": page})
    items = [_parse(x, True) for x in _items(js)]
    return [x for x in items if x["nid"] and x["date"]], js


def _collect_new(ticker, known, since):
    """새 리포트 목록. since(날짜)보다 오래된 게 나오거나, 이미 아는 게 나오면 그 페이지에서 멈춤.
    첫 페이지부터 비면 (None, 응답) — 리포트가 없는 종목이거나 응답 형식이 바뀐 것"""
    out, page = [], 1
    while page <= MAX_PAGES:
        items, js = fetch_list(ticker, page)
        time.sleep(SLEEP)
        if not items:
            if page == 1:
                return None, js
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


# ---------------- 받아서 Firebase 에 ----------------

def _now():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")   # 한국 시각


def _job(**kw):
    try:
        cloud.set_doc("state", "report_job", {**kw, "at": _now()})
    except Exception as e:
        print(f"  (진행 상태 기록 실패: {e})")


def run():
    """관심종목의 새 리포트를 받아 state/reports 에 합침. 반환: 새 리포트 수 (설정이 없으면 None)"""
    if not cloud.configured():
        print("리포트: Firebase 설정이 없어서 건너뜀 (" + ", ".join(cloud.KEYS) + ")")
        return None
    _job(state="running")
    try:
        watch = cloud.watchlist()
        tickers = [t for t, w in watch.items() if w.get("favorite", True) or w.get("track_reports")]
        old = json.loads((cloud.get_doc("state", "reports") or {}).get("json") or "[]")
        rows = [{k: r.get(k) for k in FIELDS} for r in old if r.get("t") in tickers]   # 관심종목에서 뺀 종목은 정리
        known, have = {str(r["nid"]) for r in rows}, {r["t"] for r in rows}
        since = (dt.date.today() - dt.timedelta(days=30 * BACKFILL_MONTHS)).isoformat()
        print(f"리포트 확인 중... ({len(tickers)}종목)" if tickers else "리포트: 관심종목이 없어요 (사이트 종목 차트에서 ☆ 를 누르세요)")
        total, failed = 0, []
        for t in tickers:
            name, first = watch[t].get("name") or t, t not in have
            try:
                new, raw = _collect_new(t, known, since if first else None)
            except Exception as e:
                print(f"  {name}: 목록 실패 ({e})")
                failed.append(str(e))
                continue
            if new is None:
                print(f"  {name}: 리포트 0건 (리포트가 없는 종목이거나 응답 형식이 바뀜) 응답 앞부분: {json.dumps(raw, ensure_ascii=False)[:300]}")
                continue
            for it in new:
                if it["tp"] is None and it["op"] is None:      # 목록에 목표가·의견이 없으면 상세에서
                    try:
                        d = _parse(_get_json(DETAIL_API.format(nid=it["nid"])), False)
                        it.update({k: v for k, v in d.items() if v is not None and not it.get(k)})
                    except Exception as e:
                        print(f"  {name} {it['nid']}: 상세 실패 ({e})")
                    time.sleep(SLEEP)
                rows.append({"nid": it["nid"], "date": it["date"], "t": t, "broker": it["broker"], "title": it["title"] or "(제목 없음)",
                             "op": it["op"], "tp": int(it["tp"]) if it["tp"] else None, "pdf": it["pdf"]})
                known.add(it["nid"])
            print(f"  {name}: " + (f"처음 추적 → 최근 {BACKFILL_MONTHS}개월 {len(new)}건" if first else f"새 리포트 {len(new)}건"))
            total += 0 if first else len(new)
        if tickers and len(failed) == len(tickers):
            raise RuntimeError(f"네이버에서 리포트 목록을 하나도 못 읽었어요: {failed[0][:150]}")
        cut = (dt.date.today() - dt.timedelta(days=KEEP_DAYS)).isoformat()
        rows = sorted((r for r in rows if (r.get("date") or "") >= cut), key=lambda r: (r.get("date") or "", str(r["nid"])), reverse=True)
        blob = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        while len(blob.encode()) > MAX_BYTES and rows:
            rows = rows[: int(len(rows) * 0.8)]
            blob = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        cloud.set_doc("state", "reports", {"json": blob, "n": len(rows), "updated": _now()})
        _job(state="done", new=total, n=len(rows))
        print(f"리포트 완료: 새 리포트 {total}건 · 전체 {len(rows)}건")
        return total
    except Exception as e:
        _job(state="error", msg=str(e)[:300])
        raise


if __name__ == "__main__":
    import os
    import traceback
    cloud.load_env()
    actions = bool(os.getenv("GITHUB_ACTIONS"))   # GitHub Actions 에서는 실패해도 0 으로 끝냄 (실패 메일이 쌓이지 않게. 결과는 state/report_job 과 로그에)
    try:
        if not actions:   # 집 PC(리포트만.bat): 사이트 버튼 설정도 같이
            import publish_site
            publish_site.setup_actions()
    except Exception as e:
        print(f"리포트 버튼 설정 건너뜀: {e}")
    try:
        ok = run() is not None
    except Exception:
        traceback.print_exc()
        ok = False
    sys.exit(0 if ok or actions else 1)
