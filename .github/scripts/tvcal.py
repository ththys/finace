"""TradingView 경제 일정 → cal/tv.json (GitHub Actions tvcal.yml 이 2시간마다)
브라우저에서 바로 못 읽어서(출처 제한) 여기서 받아 저장소에 둠. 바뀐 게 있을 때만 커밋."""
import datetime as dt
import json
import os
import urllib.request

URL = "https://economic-calendar.tradingview.com/events?from={a}&to={b}&countries={c}&minImportance=0"
COUNTRIES = "US,KR,CN,JP,EU,DE,GB"
now = dt.datetime.now(dt.timezone.utc)
a = (now - dt.timedelta(days=21)).strftime("%Y-%m-%dT00:00:00.000Z")
b = (now + dt.timedelta(days=60)).strftime("%Y-%m-%dT00:00:00.000Z")
req = urllib.request.Request(URL.format(a=a, b=b, c=COUNTRIES), headers={
    "Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/", "User-Agent": "Mozilla/5.0"})
js = json.load(urllib.request.urlopen(req, timeout=30))
rows = js.get("result", js) if isinstance(js, dict) else js
info, ev = {}, []
for r in rows:
    key = r.get("ticker") or (r.get("country", "") + ":" + (r.get("indicator") or r.get("title", "")))
    if r.get("comment") and key not in info:
        info[key] = r["comment"][:600]
    ev.append({k: r.get(k) for k in ("date", "title", "country", "period", "actual", "forecast", "previous", "unit", "scale", "importance")} | {"k": key})
ev.sort(key=lambda x: x["date"] or "")
CAL = os.path.join(os.path.dirname(__file__), "..", "..", "cal")


def save(name, data, same):
    path = os.path.join(CAL, name)
    try:
        if same(json.load(open(path, encoding="utf-8"))):
            return print(name, "바뀐 것 없음")
    except Exception:
        pass
    json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(name, "저장")


# 설명(info)은 거의 안 바뀌니 따로 (저장소가 덜 커지게). 기존 설명에 새 것만 더함
try:
    allinfo = json.load(open(os.path.join(CAL, "tvinfo.json"), encoding="utf-8"))
except Exception:
    allinfo = {}
merged = {**allinfo, **info}
save("tvinfo.json", merged, lambda o: o == merged)
save("tv.json", {"updated": now.strftime("%Y-%m-%d %H:%M UTC"), "events": ev}, lambda o: o.get("events") == ev)


# ---------------- 지표별 과거 발표치 (차트·발표일 시장 반응용): 하루 한 번, 중요 지표만 5년 ----------------
HIST = os.path.join(CAL, "tvhist.json")
try:
    hist = json.load(open(HIST, encoding="utf-8"))
except Exception:
    hist = {}
if hist.get("_day") != now.strftime("%Y-%m-%d") or os.getenv("FORCE_HIST"):
    keys = {e["k"] for e in ev if (e.get("importance") or 0) >= 1}
    series = {}
    start = now - dt.timedelta(days=365 * 5 + 30)
    while start < now:   # 1년씩 나눠 받기
        end = min(now + dt.timedelta(days=1), start + dt.timedelta(days=366))
        r2 = urllib.request.Request(URL.format(a=start.strftime("%Y-%m-%dT00:00:00.000Z"), b=end.strftime("%Y-%m-%dT00:00:00.000Z"), c=COUNTRIES), headers=req.headers)
        rows2 = json.load(urllib.request.urlopen(r2, timeout=60))
        rows2 = rows2.get("result", rows2) if isinstance(rows2, dict) else rows2
        for r in rows2:
            k = r.get("ticker") or (r.get("country", "") + ":" + (r.get("indicator") or r.get("title", "")))
            if k in keys and r.get("actual") is not None:
                series.setdefault(k, {})[r["date"][:16]] = [r.get("actual"), r.get("forecast")]
        start = end
    out = {"_day": now.strftime("%Y-%m-%d")}
    for k, m in series.items():
        out[k] = [[d] + v for d, v in sorted(m.items())]
    save("tvhist.json", out, lambda o: {k: v for k, v in o.items() if k != "_day"} == {k: v for k, v in out.items() if k != "_day"})
    print("과거 발표치:", len(series), "지표,", sum(len(v) for v in series.values()), "개")
