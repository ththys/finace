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
out = {"updated": now.strftime("%Y-%m-%d %H:%M UTC"), "events": ev, "info": info}
path = os.path.join(os.path.dirname(__file__), "..", "..", "cal", "tv.json")
old = None
try:
    old = json.load(open(path, encoding="utf-8"))
except Exception:
    pass
if old and old.get("events") == ev and old.get("info") == info:
    print("바뀐 것 없음")
else:
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"저장: {len(ev)}개")
