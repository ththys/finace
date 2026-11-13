"use strict";
/* 종목 차트: 캔들(일·주·월봉)·보조지표·내가 그린 선·PER/PBR 밴드·종목 수급·종목 화면 */

/* ---------------- 캔들 (일봉·주봉) ---------------- */
/** candles = { o, h, l, c } 배열 (x 축과 같은 길이) */
function drawCandles(u, { o, h, l, c }) {
  const ctx = u.ctx, [i0, i1] = u.series[0].idxs || [0, c.length - 1], n = Math.max(1, i1 - i0 + 1);
  const bw = Math.max(1, Math.min(14, u.bbox.width / n * 0.7)), up = css("--up"), dn = css("--down");
  ctx.save(); ctx.beginPath(); ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height); ctx.clip();
  for (let i = i0; i <= i1; i++) {
    if (c[i] == null || o[i] == null) continue;
    const x = Math.round(u.valToPos(u.data[0][i], "x", true)), col = c[i] >= o[i] ? up : dn;
    const yo = u.valToPos(o[i], "y", true), yc = u.valToPos(c[i], "y", true);
    ctx.strokeStyle = ctx.fillStyle = col; ctx.lineWidth = Math.max(1, devicePixelRatio);
    if (h[i] != null && l[i] != null) { ctx.beginPath(); ctx.moveTo(x + .5, u.valToPos(h[i], "y", true)); ctx.lineTo(x + .5, u.valToPos(l[i], "y", true)); ctx.stroke(); }
    ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
  }
  ctx.restore();
}
/** 오른쪽 축에 현재가 꼬리표 */
/** 보이는 구간 표시: 차트 테두리 · 시작가 선/라벨 · 양 끝 날짜 · 현재가 옆 변화율 */
function drawRangeMarks(u, bars, n, last) {
  const ctx = u.ctx, dpr = devicePixelRatio, L = u.bbox.left, T = u.bbox.top, W = u.bbox.width, H = u.bbox.height;
  const a0 = Math.max(0, Math.ceil(u.scales.x.min)), b0 = Math.min(n - 1, Math.floor(u.scales.x.max));
  ctx.save();
  ctx.strokeStyle = css("--faint"); ctx.lineWidth = dpr; ctx.setLineDash([]); ctx.strokeRect(L + dpr / 2, T + dpr / 2, W - dpr, H - dpr);
  // 기준가 = 첫 봉 바로 전 봉 종가 (아래 '기간 수익률' 카드·홈 수익률과 같은 기준)
  const p0 = a0 > 0 && bars.c[a0 - 1] > 0 ? bars.c[a0 - 1] : bars.c[a0], font = w => `${w} ${11 * dpr}px sans-serif`, hgt = 17 * dpr;
  const tag = (x, y, txt, bg, fg, alignRight) => { ctx.font = font(600); const w = ctx.measureText(txt).width + 10 * dpr, x0 = alignRight ? x - w : x;
    ctx.fillStyle = bg; ctx.fillRect(x0, y - hgt / 2, w, hgt); ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(txt, x0 + 5 * dpr, y); };
  // 시작가 선 + 라벨 (왼쪽)
  if (p0 > 0) { const y = u.valToPos(p0, "y", true);
    if (y >= T && y <= T + H) { ctx.strokeStyle = css("--sub"); ctx.setLineDash([1 * dpr, 3 * dpr]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + W, y); ctx.stroke(); ctx.setLineDash([]);
      tag(L + 1, y, `기준 ${fmtNum(p0)}`, css("--sub"), css("--card"), false); } }
  // 양 끝 날짜 (차트 안쪽 아래)
  ctx.font = font(600); ctx.fillStyle = css("--ink"); ctx.textBaseline = "bottom";
  if (bars.d[a0]) { ctx.textAlign = "left"; ctx.fillText(`◀ ${bars.d[a0]}`, L + 6 * dpr, T + H - 5 * dpr); }
  if (bars.d[b0]) { ctx.textAlign = "right"; ctx.fillText(`${b0 === n - 1 ? "오늘(최근) " : ""}${bars.d[b0]} ▶`, L + W - 6 * dpr, T + H - 5 * dpr); }
  ctx.restore();
  // 현재가 + 보이는 구간 시작 대비 %
  if (last > 0) { const ch = p0 > 0 ? (last / p0 - 1) * 100 : null;
    drawLastTag(u, last, ch == null ? "" : `  ${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%`); }
}
function drawLastTag(u, v, extra = "") {
  const ctx = u.ctx, y = u.valToPos(v, "y", true); if (!isFinite(y) || y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
  const dpr = devicePixelRatio, txt = fmtNum(v) + extra; ctx.save();
  ctx.strokeStyle = css("--accent"); ctx.setLineDash([2 * dpr, 3 * dpr]); ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke();
  ctx.font = `600 ${11 * dpr}px sans-serif`; const w = ctx.measureText(txt).width + 10 * dpr, hgt = 16 * dpr;
  ctx.fillStyle = css("--accent"); ctx.fillRect(u.bbox.left + u.bbox.width - w, y - hgt / 2, w, hgt);
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(txt, u.bbox.left + u.bbox.width - w + 5 * dpr, y); ctx.restore();
}
const obucket = t => [...t].reduce((s, ch) => s + ch.charCodeAt(0), 0) % (S.meta.obuckets || 16);
/** 한 종목 시가·고가·저가 {date: [o,h,l]} */
async function loadOHLC(t, start) {
  const names = S.meta.ochunks || []; if (!names.length) return {};
  let i = names.indexOf(chunkFor(start)); if (i < 0) i = start < S.meta.first ? 0 : names.length - 1;
  const cs = await Promise.all(names.slice(Math.max(0, i)).map(n => loadChunk(n, "ohlc/" + obucket(t)).catch(() => null)));
  const out = {};
  cs.forEach(c => { if (!c) return; const k = c.idx[t]; if (k == null) return; const g = a => a?.[k] || null; const o = g(c.o), h = g(c.h), l = g(c.l), cl = g(c.c), v = g(c.v);
    c.d.forEach((d, j) => out[d] = [o?.[j] ?? null, h?.[j] ?? null, l?.[j] ?? null, cl?.[j] ?? null, v?.[j] ?? null]); });
  return out;
}
/* ---------------- PER·PBR 밴드 ---------------- */
async function loadFund(t, start) {
  const F = await loadX("fund_last"), names = F?.chunks || []; if (!names.length) return null;
  let i = names.indexOf(chunkFor(start)); if (i < 0) i = start < names[0].slice(1) ? 0 : names.length - 1;
  const cs = await Promise.all(names.slice(Math.max(0, i - 1)).map(n => loadChunk(n, "fund/" + obucket(t)).catch(() => null)));
  const out = {}; cs.forEach(c => { const k = c?.idx[t]; if (k == null) return; c.d.forEach((d, j) => out[d] = [c.e[k][j], c.b[k][j]]); });
  return out;
}
async function valueBand(t, pd, close, tok) {
  const el = $("#vb"), info = $("#vbinfo"); if (!el) return;
  const kind = store.get("vbt", "per"), FD = await loadFund(t, pd.d[0]);
  if (tok !== S.tok || !$("#vb")) return;
  if (!FD) { info.textContent = "PER·PBR 데이터는 집 PC의 다음 업데이트(kospi.bat) 때부터 나와요."; return; }
  // EPS·BPS 는 바뀔 때까지 앞 값 유지
  let le = null, lb = null; const base = pd.d.map(d => { const x = FD[d]; if (x) { if (x[0] != null) le = x[0]; if (x[1] != null) lb = x[1]; } return kind === "per" ? le : lb; });
  const mult = close.map((c, i) => c && base[i] > 0 ? c / base[i] : null).filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (mult.length < 20) { info.textContent = kind === "per" ? "이 기간엔 EPS가 없거나 적자라 PER 밴드를 그릴 수 없어요. PBR 밴드를 보세요." : "이 기간엔 BPS 데이터가 부족해요."; return; }
  const q = p => mult[Math.min(mult.length - 1, Math.floor(p * (mult.length - 1)))];
  const ms = [...new Set([0.05, 0.25, 0.5, 0.75, 0.95].map(p => +(q(p)).toFixed(kind === "per" ? 1 : 2)))];
  const cur = close.at(-1) / base.at(-1), rank = mult.filter(x => x <= cur).length / mult.length * 100;
  const cols = ["#2f8f9d", "#4a7dff", "#8a8f98", "#b07d2a", "#d1302b"];
  lineChart(el, pd.d, [{ label: "주가", data: close, color: css("--ink"), width: 2 },
    ...ms.map((m, i) => ({ label: `${kind.toUpperCase()} ${m}배`, data: base.map(b => b > 0 ? b * m : null), color: cols[i % cols.length], width: 1.1, dash: i === 2 ? [4, 3] : undefined }))],
    { height: 260, won: true });
  info.innerHTML = `지금 ${kind.toUpperCase()} <b>${cur.toFixed(kind === "per" ? 1 : 2)}배</b> · 이 기간 범위 ${ms[0]}~${ms.at(-1)}배 중 하위 <b>${rank.toFixed(0)}%</b> 위치 ` +
    `<span class="muted">(${rank < 25 ? "기간 중 싼 편" : rank > 75 ? "기간 중 비싼 편" : "중간"} · ${kind === "per" ? "EPS" : "BPS"} ${fmtNum(base.at(-1))}원 기준, KRX 확정 실적이라 최근 분기가 늦게 반영될 수 있어요)</span>`;
}

/* ---------------- 종목 수급 (관심종목, Firebase) ---------------- */
async function stockFlowSection(t, pd) {
  const el = $("#sfl"); if (!el) return;
  const draw = async () => {
    if (!$("#sfl")) return;
    if (!FB.enabled || !FB.user) { el.innerHTML = `<p class="small muted">로그인하면 관심종목의 외국인·기관 순매수, 외국인 지분율, 공매도 잔고가 보여요.</p>`; return; }
    if (!inWatch(t)) { el.innerHTML = `<p class="small muted">☆ 관심종목에 넣으면 다음 업데이트(kospi.bat)부터 이 종목 수급을 받아요 (처음엔 2년치).</p>`; return; }
    let D = null;
    try { const r = await FB.F.getDoc(FB.F.doc(FB.db, "state", "sf_" + t)); if (r.exists()) D = JSON.parse(r.data().json); } catch (e) { console.warn(e); }
    if (!$("#sfl")) return;
    if (!D) { el.innerHTML = `<p class="small muted">아직 받은 수급이 없어요. 다음 업데이트(kospi.bat) 때 채워져요.</p>`; return; }
    destroyIn(el);
    const i0 = Math.max(0, D.d.findIndex(d => d >= pd.d[0])), d = D.d.slice(i0);
    const cum = arr => { let s = 0; return (arr || []).slice(i0).map(v => (s += v || 0)); };
    const sum = arr => (arr || []).slice(i0).reduce((a, v) => a + (v || 0), 0), s5 = arr => (arr || []).slice(-5).reduce((a, v) => a + (v || 0), 0);
    const card = (l, arr) => `<div><div class="lbl">${l}</div><div class="v ${cls(sum(arr))}">${fmtJo(sum(arr))}</div><div class="s">최근 5일 ${fmtJo(s5(arr))}</div></div>`;
    const own = D.own.slice(i0), sr = D.sratio.slice(i0), lastOf = a => [...a].reverse().find(x => x != null);
    el.innerHTML = `<div class="stats">${card("외국인", D.frg)}${card("기관", D.inst)}${card("개인", D.ind)}${D.pen ? card("연기금", D.pen) : ""}
        <div><div class="lbl">외국인 지분율</div><div class="v">${lastOf(own) != null ? lastOf(own).toFixed(2) + "%" : "–"}</div><div class="s">기간 처음 ${own.find(x => x != null)?.toFixed(2) ?? "–"}%</div></div>
        <div><div class="lbl">공매도 잔고 비중</div><div class="v">${lastOf(sr) != null ? lastOf(sr).toFixed(2) + "%" : "–"}</div><div class="s">상장주식 대비</div></div></div>
      <div class="two"><div class="chart"><h3>누적 순매수 <small>억원</small></h3><div id="sf1"></div></div>
        <div><div class="chart"><h3>외국인 지분율 <small>%</small></h3><div id="sf2"></div></div>
          <div class="chart" style="margin-top:10px"><h3>공매도 잔고 비중 <small>상장주식 대비 %</small></h3><div id="sf3"></div></div></div></div>`;
    lineChart($("#sf1"), d, [{ label: "외국인", data: cum(D.frg), color: css("--accent"), width: 2 }, { label: "기관", data: cum(D.inst), color: "#b07d2a" },
      { label: "개인", data: cum(D.ind), color: css("--ink") }, ...(D.pen ? [{ label: "연기금", data: cum(D.pen), color: "#7a52b3", dash: [4, 3] }] : [])], { height: 220, ref: 0, compact: true });
    lineChart($("#sf2"), d, [{ label: "외국인 지분율", data: own, color: css("--accent"), width: 2 }], { height: 110, legend: false });
    lineChart($("#sf3"), d, [{ label: "공매도 잔고 비중", data: sr, color: css("--down"), width: 2 }], { height: 110, legend: false });
  };
  FB.listeners.push(draw); FB.ready.then(draw);
}

/* ---------------- 일봉·주봉 (거래일 순번 축, 휠 확대·드래그 이동) ---------------- */
/** 한 종목 봉 데이터: 묶음 파일(o,h,l,c,v)이 있으면 그것만, 없으면 종가·거래량 전체 파일에서 (짧게) */
async function loadBars(t, from) {
  const OH = await loadOHLC(t, from), ds = Object.keys(OH).sort();
  const full = ds.length && OH[ds.at(-1)].length > 3 && OH[ds.at(-1)][3] != null;
  if (full) return { d: ds, o: ds.map(d => OH[d][0]), h: ds.map(d => OH[d][1]), l: ds.map(d => OH[d][2]), c: ds.map(d => OH[d][3]), v: ds.map(d => OH[d][4] ?? null), full: true };
  const [px, vr] = await Promise.all([loadRange(from), loadRange(from, "vol")]);
  const c = ffill(px.series(t)), vm = Object.fromEntries(vr.dates.map((d, i) => [d, i])), vv = vr.series(t);
  const d = [], o = [], h = [], l = [], cc = [], v = [];
  px.dates.forEach((dt, i) => { if (dt < from || c[i] == null) return; const x = OH[dt];
    d.push(dt); cc.push(c[i]); o.push(x?.[0] ?? (cc.length > 1 ? cc.at(-2) : c[i])); h.push(x?.[1] ?? null); l.push(x?.[2] ?? null); v.push(vm[dt] != null ? vv[vm[dt]] : null); });
  return { d, o, h, l, c: cc, v, full: false, hasOHLC: ds.length > 0 };
}
/* ---------------- 보조지표 ---------------- */
function emaArr(x, k) { const a = 2 / (k + 1), o = new Array(x.length).fill(null); let e = null;
  for (let i = 0; i < x.length; i++) { if (x[i] == null) { o[i] = e; continue; } e = e == null ? x[i] : x[i] * a + e * (1 - a); o[i] = i >= k - 1 ? e : null; } return o; }
function rsiArr(c, k = 14) { const o = new Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(0, d), dn = Math.max(0, -d);
    if (i <= k) { g += up / k; l += dn / k; if (i === k) o[i] = l ? 100 - 100 / (1 + g / l) : 100; }
    else { g = (g * (k - 1) + up) / k; l = (l * (k - 1) + dn) / k; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } } return o; }
function bbArr(c, k = 20, m = 2) { const up = [], mid = [], lo = [];
  for (let i = 0; i < c.length; i++) { if (i < k - 1) { up.push(null); mid.push(null); lo.push(null); continue; }
    let s1 = 0, s2 = 0; for (let j = i - k + 1; j <= i; j++) { s1 += c[j]; s2 += c[j] * c[j]; } const mu = s1 / k, sd = Math.sqrt(Math.max(0, s2 / k - mu * mu));
    up.push(mu + m * sd); mid.push(mu); lo.push(mu - m * sd); } return [up, mid, lo]; }
/** 일봉 → 월봉 */
function toPeriod(d, o, h, l, c, vol, keyFn) {
  const W = { d: [], o: [], h: [], l: [], c: [], v: [], idx: [] }; let key = null;
  for (let i = 0; i < d.length; i++) {
    if (c[i] == null) continue;
    const k = keyFn(d[i]);
    if (k !== key) { key = k; W.d.push(d[i]); W.o.push(o[i] ?? c[i]); W.h.push(h[i] ?? c[i]); W.l.push(l[i] ?? c[i]); W.c.push(c[i]); W.v.push(vol?.[i] ?? null); W.idx.push(i); continue; }
    const j = W.d.length - 1; W.d[j] = d[i]; W.c[j] = c[i]; W.idx[j] = i;
    if (h[i] != null && h[i] > W.h[j]) W.h[j] = h[i]; if (l[i] != null && l[i] < W.l[j]) W.l[j] = l[i];
    if (vol?.[i] != null) W.v[j] = (W.v[j] || 0) + vol[i];
  }
  return W;
}

/* ---------------- 내가 그린 선 (수평선·추세선) — 로그인하면 Firebase(state/drawings), 아니면 이 브라우저 ---------------- */
const DRAW = { all: null };
async function drawingsAll() {
  const key = FB.user?.uid || "anon";
  if (DRAW.all && DRAW.key === key) return DRAW.all;
  DRAW.key = key; let all = null;
  if (FB.user) { try { const r = await FB.F.getDoc(FB.F.doc(FB.db, "state", "drawings")); if (r.exists()) all = JSON.parse(r.data().json || "{}"); } catch (e) { console.warn("선 읽기 실패", e); } }
  if (!all) { try { all = JSON.parse(localStorage.getItem("kd_drawings") || "{}"); } catch { all = {}; } }
  return DRAW.all = all;
}
async function drawingsSave() {
  const js = JSON.stringify(DRAW.all || {});
  try { localStorage.setItem("kd_drawings", js); } catch {}
  if (FB.user) { try { await FB.F.setDoc(FB.F.doc(FB.db, "state", "drawings"), { json: js }); } catch (e) { console.warn("선 저장 실패", e); } }
}

async function candleView(t, s, me, ctype, start, tok, marks, shown) {
  const weekly = ctype === "week", monthly = ctype === "month", unit = monthly ? "개월" : weekly ? "주" : "거래일";
  const B0 = await loadBars(t, isoMinus(S.meta.asof, 365 * 3 + 14));  // 우선 3년치 + 기준일 봉 (묶음 파일이 있으면 가볍게)
  let D = B0;
  if (B0.full && (weekly || monthly)) D = await loadBars(t, S.meta.first);   // 주봉·월봉은 처음부터
  const DR = await drawingsAll();
  if (tok !== S.tok) return null;
  // 고가·저가 없는 날은 몸통만
  D.h = D.h.map((x, i) => x ?? Math.max(D.o[i] ?? D.c[i], D.c[i])); D.l = D.l.map((x, i) => x ?? Math.min(D.o[i] ?? D.c[i], D.c[i]));
  const wkKey = s2 => { const tt = Date.parse(s2 + "T00:00:00Z"), dow = (new Date(tt).getUTCDay() + 6) % 7; return new Date(tt - dow * 864e5).toISOString().slice(0, 10); };
  const W = weekly ? toPeriod(D.d, D.o, D.h, D.l, D.c, D.v, wkKey) : monthly ? toPeriod(D.d, D.o, D.h, D.l, D.c, D.v, s2 => s2.slice(0, 7)) : null;
  const bars = W ? { d: W.d, o: W.o, h: W.h, l: W.l, c: W.c, v: W.v } : D, n = bars.d.length;
  if (n < 2) { $("#c1").innerHTML = `<p class="small muted">봉 데이터가 부족해요</p>`; return null; }
  $("#c1s").textContent = (D.full ? "" : D.hasOHLC ? "최근 3년 · " : "시가·고가·저가는 집 PC 다음 업데이트부터 · ") + "휠 확대·축소 · 드래그 이동 · 가격축 위아래 드래그로 늘이기 · 더블클릭 처음으로";
  // 이평선·52주 고저는 항상 일봉 기준(20·60·120일)으로 계산하고, 주봉·월봉이면 그 기간 마지막 날 값을 찍음
  const nd = D.d.length, pickW = arr => W ? W.idx.map(i => arr[i]) : arr;
  const rollMA = k => { const o = new Array(nd).fill(null); let s2 = 0; for (let i = 0; i < nd; i++) { s2 += D.c[i]; if (i >= k) s2 -= D.c[i - k]; if (i >= k - 1) o[i] = s2 / k; } return pickW(o); };
  const rollX = (k, mx) => pickW(D.c.map((_, i) => { if (i < k - 1) return null; let r = mx ? -Infinity : Infinity; for (let j = i - k + 1; j <= i; j++) r = mx ? Math.max(r, D.h[j]) : Math.min(r, D.l[j]); return r; }));
  const on = (lab, def) => shown[lab] ?? def;
  const [bbU, bbM, bbL] = bbArr(bars.c);
  const extra = [
    { label: "20일선", data: rollMA(20), color: "#b07d2a", width: 1.2 },
    { label: "60일선", data: rollMA(60), color: "#7a52b3", width: 1.2 },
    { label: "120일선", data: rollMA(120), color: "#2f8f9d", width: 1.2 },
    { label: "52주 최고", data: rollX(252, true), color: css("--up"), dash: [2, 3], width: 1 },
    { label: "52주 최저", data: rollX(252, false), color: css("--down"), dash: [2, 3], width: 1 },
    { label: "BB 상단", data: bbU, color: "#8a8f98", width: 1 },
    { label: "BB 중심", data: bbM, color: "#8a8f98", width: 1, dash: [3, 3] },
    { label: "BB 하단", data: bbL, color: "#8a8f98", width: 1 }].map(x => ({ ...x, show: on(x.label.startsWith("BB") ? "BB" : x.label, false) }));
  // 추세 밴드
  let bandS = [], bands = null;
  const bc = bandControls("band_stock", bars.d[Math.max(0, bars.d.findIndex(d => d >= start))] || bars.d[0], () => renderStock(t, start));
  $("#bandc").replaceChildren(bc.box);
  const B = bc.get();
  if (B.on) { const fit = fitBand(bars.d, bars.c, B.from, B.to, monthly ? 12 : weekly ? 52 : 250);
    if (fit) { const bs = bandSeries(fit, bars.d, B.from, B.k, me.last, bars.d.at(-1)); bandS = bs.series; bands = [{ series: [5 + extra.length, 7 + extra.length], fill: "rgba(74,125,255,.10)" }]; bc.box.querySelector(".bandinfo").textContent = bs.info; }
    else bc.box.querySelector(".bandinfo").textContent = "시작~끝 사이 데이터가 너무 적어요"; }
  // 처음 보이는 범위 = 기준일(start 이하 마지막 봉) 바로 다음 봉부터 → 기준가가 아래 '기간 수익률' 카드와 같음 (최소 5봉) · 오른쪽에 여백
  let bi = -1; while (bi + 1 < n && bars.d[bi + 1] <= start) bi++;
  const i0 = Math.max(0, Math.min(bi <= 0 ? 0 : bi + 1, n - 5));
  const rpad = span => Math.max(3, span * 0.08);
  const home = [i0 - 0.5, n - 0.5 + rpad(n - i0)];
  const zkey = `${t}|${ctype}|${start}`, keep = S.candleX?.k === zkey ? S.candleX : null, init = keep ? [keep.min, keep.max] : home;
  const xs = bars.d.map((_, i) => i);
  const fmtX = (u, vals) => { const span = u.scales.x.max - u.scales.x.min;
    return vals.map(v => { const d = bars.d[Math.round(v)]; if (!d || Math.abs(v - Math.round(v)) > 0.01) return ""; return monthly || span > (weekly ? 150 : 260) ? d.slice(0, 7).replace("-", ".") : d.slice(2).replace(/-/g, "."); }); };
  const sub = css("--sub"), rule = css("--rule"), el = $("#c1");
  // 축 모드: 일반 / 로그 / % (보는 구간 기준가 대비)
  const AX = store.get("pxaxis", "lin"), YZ = { f: 1 };
  const visIdx = uu => [Math.max(0, Math.ceil(uu.scales.x.min)), Math.min(n - 1, Math.floor(uu.scales.x.max))];
  const baseOf = uu => { const [a0] = visIdx(uu); return a0 > 0 && bars.c[a0 - 1] > 0 ? bars.c[a0 - 1] : bars.c[a0]; };
  const series = [
    { label: "시가", data: bars.o }, { label: "고가", data: bars.h }, { label: "저가", data: bars.l }, { label: "종가", data: bars.c }].map(x => ({ ...x, color: "transparent", width: 0, hidden: true }));
  const all = [...series, ...extra, ...bandS];
  // y 범위: 보이는 봉의 고가·저가 기준 + 아래 22%는 거래량 자리 + 가격축 드래그 배율
  const yRange = uu => { const [a0, b0] = visIdx(uu); let lo = Infinity, hi = -Infinity;
    for (let i = a0; i <= b0; i++) { if (bars.l[i] != null && bars.l[i] < lo) lo = bars.l[i]; if (bars.h[i] != null && bars.h[i] > hi) hi = bars.h[i]; }
    uu.series.forEach((sr, si) => { if (si < 5 || !sr.show) return; const dd = uu.data[si]; for (let i = a0; i <= b0; i++) { const v = dd[i]; if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } } });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (AX === "log") { const L0 = Math.log(lo), L1 = Math.log(hi), sp = (L1 - L0 || 0.01) * YZ.f, mid = (L0 + L1) / 2;
      return [Math.exp(mid - sp / 2 - sp * 0.30), Math.exp(mid + sp / 2 + sp * 0.06)]; }
    const sp = (hi - lo || hi * 0.01) * YZ.f, mid = (lo + hi) / 2; return [mid - sp / 2 - sp * 0.30, mid + sp / 2 + sp * 0.06]; };
  const yVals = (uu, vals) => AX === "pct" ? vals.map(v => { const b = baseOf(uu); return b ? ((v / b - 1) * 100).toFixed(1) + "%" : fmtNum(v); }) : vals.map(v => fmtNum(v));
  const vmaxVis = uu => { const [a0, b0] = visIdx(uu); let m = 0; for (let i = a0; i <= b0; i++) if (bars.v[i] > m) m = bars.v[i]; return m; };
  const upc = css("--up"), dnc = css("--down");
  const drawVolume = uu => { if (!S.showVol) return; const c = uu.ctx, [a, b] = uu.series[0].idxs || [0, n - 1], vm = vmaxVis(uu); if (!vm) return;
    const bw = Math.max(1, Math.min(14, uu.bbox.width / Math.max(1, b - a + 1) * 0.7)), H = uu.bbox.height * 0.18, y0 = uu.bbox.top + uu.bbox.height;
    c.save(); c.beginPath(); c.rect(uu.bbox.left, uu.bbox.top, uu.bbox.width, uu.bbox.height); c.clip(); c.globalAlpha = .35;
    for (let i = a; i <= b; i++) { const vv = bars.v[i]; if (vv == null) continue; const x = uu.valToPos(i, "x", true), hh = vv / vm * H;
      c.fillStyle = bars.c[i] >= bars.o[i] ? upc : dnc; c.fillRect(x - bw / 2, y0 - hh, bw, hh); }
    c.restore(); };
  S.showVol = store.get("showvol", true);
  // 내가 그린 선
  const myD = DR[t] ||= { h: [], t: [] };
  const drawMine = uu => { const c = uu.ctx, dpr = devicePixelRatio, L = uu.bbox.left, T = uu.bbox.top, Wd = uu.bbox.width, H = uu.bbox.height; c.save();
    c.beginPath(); c.rect(L, T, Wd, H); c.clip(); c.lineWidth = 1.4 * dpr; c.font = `600 ${10 * dpr}px sans-serif`;
    myD.h.forEach(hl => { const y = uu.valToPos(hl.p, "y", true); if (y < T || y > T + H) return; c.strokeStyle = c.fillStyle = "#e0a800"; c.setLineDash([]);
      c.beginPath(); c.moveTo(L, y); c.lineTo(L + Wd, y); c.stroke(); c.textBaseline = "bottom"; c.textAlign = "left"; c.fillText(`─ ${fmtNum(hl.p)}`, L + 60 * dpr, y - 2 * dpr); });
    const ix = d => { let i = bars.d.findIndex(x => x >= d); return i < 0 ? n - 1 : i; };
    myD.t.forEach(tl => { const x1 = uu.valToPos(ix(tl.d1), "x", true), x2 = uu.valToPos(ix(tl.d2), "x", true), y1 = uu.valToPos(tl.p1, "y", true), y2 = uu.valToPos(tl.p2, "y", true);
      c.strokeStyle = "#e0a800"; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.fillStyle = "#e0a800"; [[x1, y1], [x2, y2]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 2.5 * dpr, 0, 7); c.fill(); }); });
    if (S.drawTmp) { const p = S.drawTmp; c.fillStyle = "#e0a800"; c.beginPath(); c.arc(uu.valToPos(p.i, "x", true), uu.valToPos(p.p, "y", true), 4 * dpr, 0, 7); c.fill(); }
    c.restore(); };
  const opts = {
    width: Math.max(280, el.clientWidth - 4), height: 400, padding: [10, 12, 0, 0],
    scales: { x: { time: false, auto: false, range: (uu, mn, mx) => [mn, mx] }, y: { distr: AX === "log" ? 3 : 1, range: (uu) => yRange(uu) } },
    cursor: { sync: { key: "kc" }, points: { show: false }, drag: { x: false, y: false } },
    legend: { show: false },
    axes: [{ stroke: sub, grid: { stroke: rule, width: 1 }, ticks: { stroke: rule }, space: 80, incrs: [1, 2, 3, 6, 12, 24, 60, 120, 250, 500, 1000], values: fmtX },
      { stroke: sub, grid: { stroke: rule, width: 1 }, ticks: { stroke: rule }, size: 72, values: yVals }],
    series: [{ label: "날짜" }, ...all.map(sr => ({ label: sr.label, show: sr.show !== false, stroke: sr.color, width: sr.width ?? 1.2, dash: sr.dash, spanGaps: true,
        paths: sr.hidden ? () => null : undefined, points: { show: false } }))],
    hooks: { drawClear: [drawVolume], draw: [u => drawCandles(u, bars), u => drawRangeMarks(u, bars, n, me.last), drawMine, u => {
      const c = u.ctx, dpr = devicePixelRatio; c.save();
      marks.forEach(([iso, col, lab]) => { let i = bars.d.findIndex(d => d >= iso); if (i < 0) return; const x = u.valToPos(i, "x", true);
        if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
        c.strokeStyle = col; c.setLineDash([4 * dpr, 3 * dpr]); c.beginPath(); c.moveTo(x, u.bbox.top); c.lineTo(x, u.bbox.top + u.bbox.height); c.stroke();
        c.fillStyle = col; c.font = `${11 * dpr}px sans-serif`; c.fillText(lab, x + 3 * dpr, u.bbox.top + 12 * dpr); });
      c.restore(); }],
      ready: [uu => uu.setScale("x", { min: init[0], max: init[1] })],
      setScale: [(uu, key) => { if (key !== "x") return; S.candleX = { k: zkey, min: uu.scales.x.min, max: uu.scales.x.max };
        (uu._subs || []).forEach(p => p.setScale("x", { min: uu.scales.x.min, max: uu.scales.x.max }));
        const [a0, b0] = visIdx(uu), rg = $("#viewrange");
        if (rg && bars.d[a0] && bars.d[b0]) { const p0 = baseOf(uu), p1 = bars.c[b0], ch = p0 && p1 != null ? (p1 / p0 - 1) * 100 : null;
          rg.innerHTML = `보는 구간 ${bars.d[a0]} ~ ${bars.d[b0]} · ${b0 - a0 + 1}${unit === "거래일" ? "거래일" : unit === "주" ? "주" : "개월"}` +
            (ch == null ? "" : ` · 기준 ${fmtNum(p0)}${a0 > 0 ? `(${bars.d[a0 - 1].slice(2)} 종가)` : ""} → 끝 ${fmtNum(p1)} <span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "+" : ""}${ch.toFixed(1)}%</span>`); } }] },
  };
  if (bands) opts.bands = bands;
  // 보조선 칩 + 지표 칩 + 축/그리기 도구
  const chipBox = document.createElement("div"); chipBox.className = "indchips";
  const groups = [["20일선", [5]], ["60일선", [6]], ["120일선", [7]], ["52주 최고·최저", [8, 9]], ["볼린저밴드", [10, 11, 12]]];
  const IND = store.get("ind", { rsi: false, macd: false });
  chipBox.innerHTML = `<span class="muted">보조선</span>` + groups.map(([lab, ids], gi) =>
    `<button type="button" data-g="${gi}" class="chip ${all[ids[0] - 1].show !== false ? "on" : ""}"><i style="background:${all[ids[0] - 1].color}"></i>${lab} <b class="cv"></b></button>`).join("") +
    `<span class="muted" style="margin-left:6px">아래 창</span>
     <button type="button" class="chip ${S.showVol ? "on" : ""}" data-x="vol">거래량</button>
     <button type="button" class="chip ${IND.rsi ? "on" : ""}" data-x="rsi">RSI</button>
     <button type="button" class="chip ${IND.macd ? "on" : ""}" data-x="macd">MACD</button>`;
  const tools = document.createElement("div"); tools.className = "indchips tools";
  tools.innerHTML = `<span class="muted">가격축</span><span class="tabs" id="pxaxis">${[["lin", "일반"], ["log", "로그"], ["pct", "%"]].map(([k, l]) => `<button data-k="${k}" class="${k === AX ? "on" : ""}">${l}</button>`).join("")}</span>
    <span class="muted" style="margin-left:6px">그리기</span>
    <button type="button" class="chip" data-tool="h">─ 수평선</button><button type="button" class="chip" data-tool="t">／ 추세선</button>
    <button type="button" class="chip" data-tool="clear">지우기</button>
    <span class="small muted" id="drawhint">${FB.user ? "선은 내 계정에 저장돼요" : "선은 이 브라우저에 저장 (로그인하면 계정에)"} · 선 위에서 오른쪽 클릭하면 그 선만 지움</span>`;
  const vr = document.createElement("div"); vr.className = "viewrange"; vr.id = "viewrange";
  $("#bandc").prepend(chipBox, tools, vr);
  // 차트 안 왼쪽 위: 날짜·시고저종·등락·거래량 (마우스가 없으면 마지막 봉)
  el.style.position = "relative";
  const ohlc = document.createElement("div"); ohlc.className = "ohlcbox";
  const tip = document.createElement("div"); tip.className = "curtip"; tip.hidden = true;
  const ylab = document.createElement("div"); ylab.className = "axlab ylab"; ylab.hidden = true;
  const xlab = document.createElement("div"); xlab.className = "axlab xlab"; xlab.hidden = true;
  const showOHLC = k => { const pc = k > 0 ? bars.c[k - 1] : null, ch = pc ? (bars.c[k] / pc - 1) * 100 : null, col = ch == null ? "" : ch >= 0 ? "up" : "down";
    ohlc.innerHTML = `<b>${bars.d[k]}</b> <span>시 <i class="${col}">${fmtNum(bars.o[k])}</i></span> <span>고 <i class="${col}">${fmtNum(bars.h[k])}</i></span> <span>저 <i class="${col}">${fmtNum(bars.l[k])}</i></span> <span>종 <i class="${col}">${fmtNum(bars.c[k])}</i></span>` +
      (ch == null ? "" : ` <i class="${col}">${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</i>`) + (bars.v[k] != null ? ` <span>거래량 <i>${kfmt(bars.v[k])}</i></span>` : ""); };
  opts.hooks.setCursor = [uu => { const i = uu.cursor.idx, k = i == null ? n - 1 : Math.max(0, Math.min(n - 1, i));
    chipBox.querySelectorAll("button[data-g]").forEach(btn => { const ids = groups[+btn.dataset.g][1];
      btn.querySelector(".cv").textContent = ids.length === 3 ? "" : ids.map(s2 => uu.data[s2][k] == null ? "–" : fmtNum(uu.data[s2][k])).join(" / "); });
    showOHLC(k);
    const { left, top } = uu.cursor;
    if (left == null || left < 0 || top < 0) { tip.hidden = ylab.hidden = xlab.hidden = true; return; }
    const price = uu.posToVal(top, "y"), d = bars.d[Math.round(uu.posToVal(left, "x"))] || "", b = baseOf(uu);
    const ptxt = fmtNum(Math.round(price)) + (AX === "pct" && b ? ` (${((price / b - 1) * 100).toFixed(1)}%)` : "");
    const ox = uu.over.offsetLeft, oy = uu.over.offsetTop;
    ylab.hidden = false; ylab.textContent = ptxt; ylab.style.top = (oy + top - 9) + "px"; ylab.style.left = "0px"; ylab.style.width = (ox - 2) + "px";
    xlab.hidden = !d; xlab.textContent = d; xlab.style.left = (ox + left) + "px"; xlab.style.top = (oy + uu.over.clientHeight + 2) + "px";
    tip.hidden = false; tip.innerHTML = `${d}<br><b>${ptxt}</b>`;
    const tw = 110, flip = left > uu.over.clientWidth - tw - 20;
    tip.style.left = (ox + left + (flip ? -tw - 12 : 14)) + "px"; tip.style.top = (oy + Math.max(0, top - 40)) + "px"; }];
  const u = new uPlot(opts, [xs, ...all.map(sr => sr.data)], el); S.charts.push(u);
  el.append(ohlc, tip, ylab, xlab);
  u.setScale("x", { min: init[0], max: init[1] });   // y 범위를 '보이는 봉' 기준으로 다시 계산
  opts.hooks.setCursor[0](u);
  chipBox.querySelectorAll("button[data-g]").forEach(btn => btn.onclick = () => { const ids = groups[+btn.dataset.g][1], show = !u.series[ids[0]].show;
    ids.forEach(s2 => u.setSeries(s2, { show })); btn.classList.toggle("on", show); u.setScale("x", { min: u.scales.x.min, max: u.scales.x.max });
    const st = store.get("pxshow", {}); ids.forEach(s2 => st[u.series[s2].label.startsWith("BB") ? "BB" : u.series[s2].label] = show); store.set("pxshow", st); });
  chipBox.querySelectorAll("button[data-x]").forEach(btn => btn.onclick = () => { const k = btn.dataset.x;
    if (k === "vol") { S.showVol = !S.showVol; store.set("showvol", S.showVol); btn.classList.toggle("on", S.showVol); u.redraw(false); return; }
    IND[k] = !IND[k]; store.set("ind", IND); btn.classList.toggle("on", IND[k]); buildSubs(); });
  tools.querySelectorAll("#pxaxis button").forEach(b2 => b2.onclick = () => { store.set("pxaxis", b2.dataset.k); renderStock(t, start); });
  // 아래 창: RSI · MACD (같이 움직임)
  const cv = $("#cv"); $("#cvl").hidden = true;
  const buildSubs = () => {
    (u._subs || []).forEach(p => { p.destroy(); const k = S.charts.indexOf(p); if (k >= 0) S.charts.splice(k, 1); }); u._subs = []; cv.innerHTML = "";
    const mk = (label, data, cols, opt = {}) => { const box = document.createElement("div"); box.className = "subpane"; box.innerHTML = `<div class="small muted sublab">${label}</div>`; cv.append(box);
      const p = new uPlot({ width: u.width, height: 110, legend: { show: false }, padding: [8, 12, 0, 0],
        scales: { x: { time: false, auto: false, range: (uu, mn, mx) => [mn, mx] }, y: opt.range ? { range: () => opt.range } : {} },
        cursor: { sync: { key: "kc" }, points: { show: false }, drag: { x: false, y: false } },
        axes: [{ show: false }, { stroke: sub, grid: { stroke: rule, width: 1 }, ticks: { show: false }, size: 72, space: 28, values: (uu, v) => v.map(x => opt.fmt ? opt.fmt(x) : x.toFixed(0)) }],
        series: [{}, ...data.map((d2, k) => ({ stroke: cols[k], width: 1.3, points: { show: false }, paths: opt.bars === k ? uPlot.paths.bars({ size: [0.7, 10] }) : undefined, fill: opt.bars === k ? cols[k] : undefined }))],
        hooks: { draw: [uu => { if (!opt.lines) return; const c = uu.ctx; c.save(); c.strokeStyle = css("--faint"); c.setLineDash([3, 3]);
          opt.lines.forEach(v => { const y = uu.valToPos(v, "y", true); c.beginPath(); c.moveTo(uu.bbox.left, y); c.lineTo(uu.bbox.left + uu.bbox.width, y); c.stroke(); }); c.restore(); }],
          ready: [uu => uu.setScale("x", { min: u.scales.x.min, max: u.scales.x.max })] } }, [xs, ...data], box);
      S.charts.push(p); u._subs.push(p); requestAnimationFrame(() => p.setScale("x", { min: u.scales.x.min, max: u.scales.x.max })); };
    if (IND.rsi) mk("RSI 14 · 70 위 과열, 30 아래 침체", [rsiArr(bars.c)], [css("--accent")], { range: [0, 100], lines: [30, 70] });
    if (IND.macd) { const e12 = emaArr(bars.c, 12), e26 = emaArr(bars.c, 26), m = bars.c.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null),
        sg = emaArr(m.map(x => x ?? null), 9), hist = m.map((x, i) => x != null && sg[i] != null ? x - sg[i] : null);
      mk("MACD 12·26·9 · 막대 = MACD − 시그널", [hist, m, sg], [css("--faint"), css("--accent"), "#b07d2a"], { bars: 0, lines: [0], fmt: x => kfmt(x) }); }
  };
  buildSubs();
  // 휠 확대·축소, 드래그 이동, 더블클릭 처음으로
  const setX = (mn, mx) => { const lo = -0.5 - 5; const span0 = mx - mn, hi = n - 0.5 + Math.max(10, span0 * 0.3); const span = Math.min(span0, hi - lo);
    if (span < 8) return; if (mn < lo) { mn = lo; mx = lo + span; } if (mx > hi) { mx = hi; mn = hi - span; }
    u.setScale("x", { min: mn, max: mx }); };
  const over = u.over;
  over.addEventListener("wheel", e => { e.preventDefault(); const { min, max } = u.scales.x, x = u.posToVal(e.offsetX, "x"), f = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    setX(x - (x - min) * f, x + (max - x) * f); }, { passive: false });
  let drag = null, ydrag = null;
  const busy = () => S.bandPick || S.drawTool;
  over.addEventListener("mousedown", e => { if (e.button !== 0 || busy()) return; drag = { x: e.clientX, min: u.scales.x.min, max: u.scales.x.max, moved: false }; over.style.cursor = "grabbing"; });
  // 가격축(왼쪽 숫자 칸)을 위아래로 끌면 늘이기·줄이기, 더블클릭하면 원래대로
  u.root.addEventListener("mousedown", e => { const r = over.getBoundingClientRect(); if (e.clientX >= r.left || e.clientY < r.top || e.clientY > r.bottom) return;
    ydrag = { y: e.clientY, f: YZ.f }; e.preventDefault(); });
  u.root.addEventListener("dblclick", e => { const r = over.getBoundingClientRect(); if (e.clientX >= r.left) return; YZ.f = 1; u.setScale("x", { min: u.scales.x.min, max: u.scales.x.max }); });
  const onMove = e => {
    if (ydrag) { YZ.f = Math.max(0.2, Math.min(8, ydrag.f * Math.exp((e.clientY - ydrag.y) * 0.006))); u.setScale("x", { min: u.scales.x.min, max: u.scales.x.max }); return; }
    if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 6) drag.moved = true; if (!drag.moved) return;
    const per = (drag.max - drag.min) / u.bbox.width * devicePixelRatio; setX(drag.min - dx * per, drag.max - dx * per); };
  const onUp = () => { ydrag = null; if (!drag) return; const moved = drag.moved; drag = null; over.style.cursor = busy() ? "crosshair" : "";
    if (moved) { over.dataset.justDragged = "1"; setTimeout(() => delete over.dataset.justDragged, 50); } };
  window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  u.hooks.destroy = [() => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }];
  over.addEventListener("dblclick", () => setTimeout(() => { if (!busy()) setX(home[0], home[1]); }, 0));
  over.addEventListener("click", e => { if (over.dataset.justDragged) e.stopImmediatePropagation(); }, true);
  // 그리기
  const setTool = k => { S.drawTool = k; S.drawTmp = null; tools.querySelectorAll("[data-tool]").forEach(b2 => b2.classList.toggle("on", b2.dataset.tool === k)); over.style.cursor = k ? "crosshair" : "";
    $("#drawhint").textContent = k === "h" ? "가격을 클릭하면 수평선 (Esc 취소)" : k === "t" ? "시작점 → 끝점 두 번 클릭 (Esc 취소)" : (FB.user ? "선은 내 계정에 저장돼요" : "선은 이 브라우저에 저장 (로그인하면 계정에)") + " · 선 위에서 오른쪽 클릭하면 그 선만 지움"; u.redraw(false); };
  S.drawTool = null; S.drawTmp = null;
  tools.querySelectorAll("[data-tool]").forEach(b2 => b2.onclick = () => { const k = b2.dataset.tool;
    if (k === "clear") { if (!myD.h.length && !myD.t.length) return; if (b2.dataset.arm) { myD.h = []; myD.t = []; drawingsSave(); delete b2.dataset.arm; b2.textContent = "지우기"; u.redraw(false); }
      else { b2.dataset.arm = "1"; b2.textContent = "한 번 더 누르면 이 종목 선 전부 지움"; setTimeout(() => { delete b2.dataset.arm; b2.textContent = "지우기"; }, 3000); } return; }
    setTool(S.drawTool === k ? null : k); });
  S.onEsc = () => S.drawTool && setTool(null);
  over.addEventListener("click", e => { if (!S.drawTool || S.bandPick) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(u.posToVal(e.offsetX, "x")))), p = u.posToVal(e.offsetY, "y");
    if (S.drawTool === "h") { myD.h.push({ p: Math.round(p) }); drawingsSave(); setTool(null); return; }
    if (!S.drawTmp) { S.drawTmp = { i, p }; u.redraw(false); return; }
    const a = S.drawTmp; myD.t.push({ d1: bars.d[a.i], p1: Math.round(a.p), d2: bars.d[i], p2: Math.round(p) }); drawingsSave(); setTool(null); });
  over.addEventListener("contextmenu", e => { const x = e.offsetX * devicePixelRatio + u.bbox.left, y = e.offsetY * devicePixelRatio + u.bbox.top, tol = 6 * devicePixelRatio;
    const ix = d => { let k = bars.d.findIndex(z => z >= d); return k < 0 ? n - 1 : k; };
    let hit = myD.h.findIndex(hl => Math.abs(u.valToPos(hl.p, "y", true) - y) < tol), kind = "h";
    if (hit < 0) { kind = "t"; hit = myD.t.findIndex(tl => { const x1 = u.valToPos(ix(tl.d1), "x", true), x2 = u.valToPos(ix(tl.d2), "x", true), y1 = u.valToPos(tl.p1, "y", true), y2 = u.valToPos(tl.p2, "y", true);
      if (x < Math.min(x1, x2) - tol || x > Math.max(x1, x2) + tol) return false; const yy = x2 === x1 ? y1 : y1 + (y2 - y1) * (x - x1) / (x2 - x1); return Math.abs(yy - y) < tol; }); }
    if (hit < 0) return; e.preventDefault(); myD[kind].splice(hit, 1); drawingsSave(); u.redraw(false); });
  bc.attach(u, bars.d);
  return u;
}

/* ---------------- 종목 차트 ---------------- */
const DDWIN = [["P", "기간 고점"], [20, "20일"], [60, "60일"], [120, "120일"]];
function viewStock(app) {
  const fav = Object.keys(FB.watch).find(isFav);
  let t = store.get("stock", null); if (!S.byT[t]) t = fav && S.byT[fav] ? fav : S.byT["005930"] ? "005930" : S.stocks[0].t;
  app.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:16px">
    <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
      <div style="min-width:0"><div class="kicker">종목 차트</div><h2 id="sname"></h2><div id="sact" class="acts"></div></div>
      <div class="search"><input id="q" placeholder="종목명 또는 코드" autocomplete="off" aria-label="종목 검색"><ul class="sugg" id="sugg" hidden></ul></div>
    </div>
    <div id="pbar"></div>
    <div class="charts">
      <div class="pricegrid">
        <div class="chart"><h3 style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">주가
          <span class="tabs" id="pxm">${[["price", "가격"], ["ret", "수익률 비교"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("pxmode", "price") ? "on" : ""}">${l}</button>`).join("")}</span>
          <span class="tabs" id="ctype" ${store.get("pxmode", "price") === "price" ? "" : "hidden"}>${[["day", "일봉"], ["week", "주봉"], ["month", "월봉"], ["line", "선"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("ctype", "day") ? "on" : ""}">${l}</button>`).join("")}</span>
          <small id="c1s"></small></h3><div id="bandc"></div><div id="c1"></div><div class="small muted" style="margin:6px 0 0" id="cvl">거래량</div><div id="cv"></div>
          <div id="jmk" class="small" style="padding:4px 6px"></div></div>
        <div class="chart"><h3>매물대 <small id="vps">기간 거래량을 가격대별로</small></h3><div id="vp"></div></div>
      </div>
      <div class="stats" id="stats"></div>
      <div class="two">
        <div class="chart"><h3 style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">고점 대비 낙폭
          <span class="tabs" id="ddw">${DDWIN.map(([k, l]) => `<button data-w="${k}" class="${String(store.get("ddw", "P")) === String(k) ? "on" : ""}">${l}</button>`).join("")}</span></h3><div id="c2"></div></div>
        <div class="chart"><h3>섹터 대비 상대강도 <small>100 위면 섹터보다 강함</small></h3><div id="c3"></div></div>
      </div>
    </div>
    <section class="block"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div class="kicker" style="margin:0">PER · PBR 밴드</div>
      <span class="tabs" id="vbt">${[["per", "PER 밴드"], ["pbr", "PBR 밴드"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("vbt", "per") ? "on" : ""}">${l}</button>`).join("")}</span>
      <small class="muted">주가를 '이익(EPS)·순자산(BPS) × 배수' 선과 비교. 배수는 이 기간에 실제로 매겨졌던 PER·PBR 범위로 잡아요</small></div>
      <div class="chart"><div id="vbinfo" class="small" style="padding:4px 6px"></div><div id="vb"></div></div></section>
    <section class="block"><div class="kicker">이 종목 수급 <small class="muted">관심종목만 · 로그인해야 보여요</small></div><div id="sfl"></div></section>
    <section class="block"><div class="kicker">이 종목 리포트</div><ul class="feed" id="srep"></ul>
      <div><a class="small" id="jl">✏️ 이 종목 투자일지 쓰기</a></div></section>
  </div>`;
  attachSearch($("#q"), $("#sugg"), t => { store.set("stock", t); renderStock(t, curStart); });
  $("#ddw").querySelectorAll("button").forEach(b => b.onclick = () => { store.set("ddw", b.dataset.w === "P" ? "P" : +b.dataset.w);
    $("#ddw").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); renderStock(store.get("stock", t), curStart); });
  let curStart = null;
  tabsBind("#pxm", k => { store.set("pxmode", k); $("#ctype").hidden = k !== "price"; renderStock(store.get("stock", t), curStart); });
  tabsBind("#ctype", k => { store.set("ctype", k); renderStock(store.get("stock", t), curStart); });
  tabsBind("#vbt", k => { store.set("vbt", k); renderStock(store.get("stock", t), curStart); });
  $("#pbar").replaceWith(periodBar(start => { curStart = start; renderStock(store.get("stock", t), start); }));
}
function stockActions(t) {
  const el = $("#sact"); if (!el) return;
  if (!FB.enabled) { el.innerHTML = ""; return; }
  if (!FB.user) { el.innerHTML = `<button class="act" onclick="fbLogin()">☆ 관심종목은 로그인 후</button>`; return; }
  const w = FB.watch[t] || {};
  el.innerHTML = `<button class="act ${w.favorite ? "on" : ""}" id="favb">${w.favorite ? "★ 관심종목" : "☆ 관심종목 추가"}</button>
    <a class="act" href="https://m.stock.naver.com/domestic/stock/${t}/research" target="_blank" rel="noopener">네이버 리서치 ↗</a>`;
  $("#favb").onclick = () => toggleWatch(t, "favorite").then(() => stockActions(t));
}
function volumeProfile(el, closes, vols, cur, bins = 24) {
  const pts = closes.map((c, i) => [c, vols[i]]).filter(([c, v]) => c != null && v != null && v > 0);
  if (!pts.length) { el.innerHTML = `<p class="small muted" style="padding:8px">거래량 데이터가 아직 없어요. 집 PC의 다음 업데이트 때 채워져요.</p>`; return null; }
  const lo = Math.min(...pts.map(p => p[0])), hi = Math.max(...pts.map(p => p[0])), step = (hi - lo) / bins || 1;
  const acc = new Array(bins).fill(0);
  pts.forEach(([c, v]) => { acc[Math.min(bins - 1, Math.floor((c - lo) / step))] += v; });
  const tot = acc.reduce((a, b) => a + b, 0), mx = Math.max(...acc), poc = acc.indexOf(mx);
  const curBin = Math.min(bins - 1, Math.max(0, Math.floor((cur - lo) / step)));
  const above = acc.slice(curBin + 1).reduce((a, b) => a + b, 0) / tot * 100;
  el.innerHTML = `<div class="vprof">${acc.map((v, i) => i).reverse().map(i => {
    const p0 = lo + i * step, p1 = p0 + step;
    return `<div class="vrow ${i === curBin ? "cur" : ""} ${i === poc ? "poc" : ""}" title="${fmtNum(p0)}~${fmtNum(p1)} · ${(acc[i] / tot * 100).toFixed(1)}%">
      <span class="vp">${fmtNum((p0 + p1) / 2)}</span><span class="vb"><i style="width:${(acc[i] / mx * 100).toFixed(1)}%"></i></span><span class="vs">${(acc[i] / tot * 100).toFixed(1)}%</span></div>`; }).join("")}</div>
    <p class="small muted" style="margin:6px 6px 0">현재가 위쪽에 쌓인 매물 <b class="num">${above.toFixed(1)}%</b> · 가장 많이 거래된 가격대 <b class="num">${fmtNum(lo + (poc + .5) * step)}</b></p>`;
  return { above, poc: lo + (poc + .5) * step };
}
async function renderStock(t, start, listedNote = null) {
  if (!start) return;
  destroyCharts();
  const s = S.byT[t]; if (!s) return;
  $("#sname").innerHTML = `${star(t)}${esc(s.n)} <small class="muted small">${t} · ${esc(s.s)} · ${s.m}</small><span id="sprice" class="sprice"></span>`;
  stockActions(t); FB.ready?.then(() => stockActions(t)); FB.listeners = [() => stockActions(t)];
  const secT = S.stocks.filter(x => x.s === s.s).map(x => x.t);
  const all = S.stocks.map(x => x.t);
  store.set("stock", t);
  const tok = S.tok = (S.tok || 0) + 1;
  const [pd, rd, vr, wide] = await Promise.all([periodData(start, all), recentDD([t]), loadRange(isoMinus(start, 45), "vol"),
    loadRange(isoMinus(start < S.meta.asof ? start : S.meta.asof, 380))]);
  if (tok !== S.tok || !$("#c1")) return;
  const me = pd.s[t];
  if (!me) {  // 기간 중간에 상장한 종목: 상장 첫날부터 그림
    const r = await loadRange(start), ser = r.series(t), i = ser.findIndex(x => x != null);
    if (tok !== S.tok) return;
    if (i >= 0 && r.dates[i] > start) return renderStock(t, r.dates[i], r.dates[i]);
    $("#stats").innerHTML = `<div class="empty">이 기간에는 ${esc(s.n)} 가격이 없어요.</div>`; return;
  }
  const mk = mktOf(t), v = ffill(me.v), sec = capIndex(pd, secT), mkt = capIndex(pd, mktTickers(mk));
  const st = ddStats(v, pd.d), r = rd[t] || {};
  const ret = (v.at(-1) - 1) * 100, sret = (sec.at(-1) - 1) * 100, mret = (mkt.at(-1) - 1) * 100;
  $("#stats").innerHTML = `
    <div><div class="lbl">기간 수익률</div><div class="v ${cls(ret)}">${fmtPct(ret)}</div><div class="s">${fmtNum(me.base)} → ${fmtNum(me.last)}</div></div>
    <div><div class="lbl">섹터 대비</div><div class="v ${cls(ret - sret)}">${fmtPct(ret - sret)}</div><div class="s">섹터 ${fmtPct(sret)} · ${mktName(mk)} ${fmtPct(mret)}</div></div>
    <div><div class="lbl">기간 MDD</div><div class="v down">${fmtPct(st.mdd)}</div><div class="s">${st.peak} → ${st.trough}</div></div>
    <div><div class="lbl">20일 MDD</div><div class="v down">${fmtPct(r.mdd20)}</div><div class="s">현재 ${fmtPct(r.cur20)}</div></div>
    <div><div class="lbl">60일 MDD</div><div class="v down">${fmtPct(r.mdd60)}</div><div class="s">현재 ${fmtPct(r.cur60)}</div></div>
    <div><div class="lbl">현재 낙폭</div><div class="v ${st.cur < -0.005 ? "down" : ""}">${fmtPct(st.cur)}</div><div class="s">기간 고점 대비</div></div>`;
  const pxmode = store.get("pxmode", "price");
  { const cl = v.map(x => x == null ? null : x * me.base), pv = cl.length > 1 ? cl.at(-2) : null, ch = pv ? me.last - pv : null;
    const show = (p, ch, pct, note) => `<b class="num ${cls(ch)}">${fmtNum(p)}</b>` + (ch == null ? "" :
      ` <span class="num ${cls(ch)}">${ch > 0 ? "▲" : ch < 0 ? "▼" : ""}${fmtNum(Math.abs(ch))} (${fmtPct(pct)})</span>`) + ` <small class="muted">${note}</small>`;
    $("#sprice").innerHTML = `<span id="spx">${show(me.last, ch, ch == null ? null : ch / pv * 100, pd.d.at(-1) + " 종가")}</span>`;
    const upd = async () => { try { const L = await livePrices([t], { [t]: me.last }), q = L[t]; if (!q || !$("#spx") || S.tok !== tok) return;
        const pc = q.prev || q.p / (1 + q.d1 / 100); $("#spx").innerHTML = show(q.p, q.p - pc, q.d1, `실시간 ${L._at}`); }
      catch (e) { const x = $("#spx small"); if (x && S.tok === tok) x.textContent = `${pd.d.at(-1)} 종가 (실시간 못 받음: ${e.message})`; } };
    upd(); liveLoop("stock", upd, () => S.tok === tok && !!$("#spx")); }
  $("#c1s").textContent = (listedNote ? `${listedNote} 상장(데이터 시작) 이후만 · ` : "") + (pxmode === "price" ? "원" : `기준일 ${pd.baseDate} = 100 · 섹터·시장과 비교`);
  // 이동평균·52주 고저 (기간 앞 1년치까지 받아 계산)
  const wraw = ffill(wide.series(t)), wm = Object.fromEntries(wide.dates.map((d, i) => [d, i]));
  const rollMA = k => { const o = new Array(wraw.length).fill(null); let s2 = 0, nn = 0;
    for (let i = 0; i < wraw.length; i++) { if (wraw[i] != null) { s2 += wraw[i]; nn++; } if (i >= k && wraw[i - k] != null) { s2 -= wraw[i - k]; nn--; } if (i >= k - 1 && nn === k) o[i] = s2 / k; } return o; };
  const rollX = (k, mx) => wraw.map((_, i) => { let r = null; for (let j = Math.max(0, i - k + 1); j <= i; j++) { const x = wraw[j]; if (x != null && (r == null || (mx ? x > r : x < r))) r = x; } return i >= k - 1 ? r : null; });
  const won = pxmode === "price", k = won ? 1 : 100 / me.base;
  const toIdx = arr => pd.d.map(d => wm[d] != null && arr[wm[d]] != null ? arr[wm[d]] * k : null);
  const marks = [], shown = store.get("pxshow", {}), on = (lab, def) => shown[lab] ?? def;
  const extra0 = [
    { label: "20일선", data: toIdx(rollMA(20)), color: "#b07d2a", width: 1.1 },
    { label: "60일선", data: toIdx(rollMA(60)), color: "#7a52b3", width: 1.1 },
    { label: "120일선", data: toIdx(rollMA(120)), color: "#2f8f9d", width: 1.1 },
    { label: "52주 최고", data: toIdx(rollX(252, true)), color: css("--up"), dash: [2, 3], width: 1 },
    { label: "52주 최저", data: toIdx(rollX(252, false)), color: css("--down"), dash: [2, 3], width: 1 }].map(x => ({ ...x, show: on(x.label, false) }));
  const ctype = won ? store.get("ctype", "day") : "line";
  // 거래량 (기간) — 매물대·선 차트용
  const vmap = Object.fromEntries(vr.dates.map((d, i) => [d, i]));
  const vs = vr.series(t), vol = pd.d.map(d => vmap[d] != null ? vs[vmap[d]] : null);
  const closes = v.map(x => x * me.base);
  let u1 = null;
  if (won && ctype !== "line") {
    // 일봉·주봉: 기간 버튼과 상관없이 긴 기간을 받아 두고 휠로 확대·축소, 드래그로 이동
    u1 = await candleView(t, s, me, ctype, start, tok, marks, shown);
    if (!u1 || tok !== S.tok) return;
  } else {
    const main = won ? [{ label: s.n, data: closes, width: 2.2 }]
      : [{ label: s.n, data: v.map(x => x * 100), width: 2.2 },
         { label: s.s + " 섹터", data: sec.map(x => x * 100), color: css("--accent"), show: on("섹터", true) },
         { label: mktName(mk), data: mkt.map(x => x * 100), color: css("--faint"), dash: [5, 4], show: on("시장", true) }];
    const extra = extra0;
    let bandS = [], bands = null, bc = null;
    if (won) {
      bc = bandControls("band_stock", pd.d[0], () => renderStock(t, start, listedNote));
      $("#bandc").replaceChildren(bc.box);
      const B = bc.get();
      if (B.on) {
        const src = B.from < pd.d[0] ? await loadRange(B.from) : null;
        if (tok !== S.tok) return;
        const fd = src ? src.dates : pd.d, fv = src ? ffill(src.series(t)) : closes;
        const fit = fitBand(fd, fv, B.from, B.to);
        if (fit) { const bs = bandSeries(fit, pd.d, B.from, B.k, me.last, pd.d.at(-1)); bandS = bs.series;
          const base = main.length + extra.length + 1; bands = [{ series: [base, base + 2], fill: "rgba(74,125,255,.10)" }];
          $("#bandc .bandinfo").textContent = bs.info; }
        else $("#bandc .bandinfo").textContent = "시작~끝 사이 데이터가 너무 적어요";
      }
    } else $("#bandc").innerHTML = "";
    u1 = lineChart($("#c1"), pd.d, [...main, ...extra, ...bandS], { ref: won ? null : 100, height: 320, marks, won, bands, lastTag: won ? me.last : null,
      onToggle: (lab, sh) => { const key = lab.endsWith(" 섹터") ? "섹터" : lab === mktName(mk) ? "시장" : lab; const o = store.get("pxshow", {}); o[key] = sh; store.set("pxshow", o); } });
    bc?.attach(u1, pd.d);
    const avg20 = pd.d.map(d => { const i = vmap[d]; if (i == null) return null; let s2 = 0, k = 0; for (let j = Math.max(0, i - 20); j < i; j++) if (vs[j] != null) { s2 += vs[j]; k++; } return k >= 10 ? s2 / k : null; });
    const spike = vol.map((x, i) => x != null && avg20[i] && x > 3 * avg20[i]);
    $("#cvl").hidden = false; $("#cv").innerHTML = "";
    $("#cvl").innerHTML = `거래량 <span class="up">■</span> 그날 거래량이 직전 20거래일 평균의 3배를 넘은 날`;
    if (vol.some(x => x != null)) {
      lineChart($("#cv"), pd.d, [{ label: "거래량", data: vol.map((x, i) => spike[i] ? null : x), color: css("--faint"), bars: true },
        { label: "급증", data: vol.map((x, i) => spike[i] ? x : null), color: css("--up"), bars: true }], { height: 96, compact: true, legend: false });
    } else $("#cv").innerHTML = "";
  }
  // 내 투자일지 표시
  const jm = () => { const posts = (FB.journal || []).filter(p => (p.tickers || []).some(x => x.code === t)).sort((x, y) => (y.date || "").localeCompare(x.date || ""));
    marks.length = 0; posts.forEach(p => p.date >= pd.d[0] && marks.push([p.date, css("--accent"), "✎"]));
    requestAnimationFrame(() => u1 && u1.redraw && u1.redraw(false));
    if (!$("#jmk")) return;
    $("#jmk").innerHTML = !FB.user ? "" : posts.length ? `<span class="muted">내 투자일지 ${posts.length}건 (차트의 ✎) · 작성 후 수익률:</span> ` + posts.slice(0, 6).map(p =>
      `<a href="#journal/post/${esc(p.id)}">${esc(p.date || "")} ${esc(p.title || "(제목 없음)")}</a> <b class="jchg" data-d="${esc(p.date || "")}"></b>`).join(" · ") : `<span class="muted">이 종목 투자일지가 아직 없어요.</span>`;
    $("#jmk").querySelectorAll(".jchg").forEach(async b => { const p0 = b.dataset.d && await priceOn(t, b.dataset.d); if (!p0) return;
      const c = (me.last / p0 - 1) * 100; b.className = "jchg " + cls(c); b.textContent = fmtPct(c, 1); }); };
  FB.listeners.push(jm); FB.ready.then(jm);
  volumeProfile($("#vp"), closes, vol, me.last);
  // PER·PBR 현재값 (헤더) + 밸류 밴드
  loadX("fund_last").then(F => { const f = F?.rows?.[t]; if (!f || !$("#sprice")) return;
    $("#sprice").insertAdjacentHTML("beforeend", ` <small class="muted">· PER ${f[0] ? f[0].toFixed(1) : "–"} · PBR ${f[1] ? f[1].toFixed(2) : "–"} · 배당 ${f[2] ? f[2].toFixed(1) + "%" : "–"}</small>`); });
  valueBand(t, pd, v.map(x => x == null ? null : x * me.base), tok);
  stockFlowSection(t, pd);
  // 낙폭: 기간 고점 또는 최근 n거래일 고점
  const w = store.get("ddw", "P");
  let ddSeries;
  if (w === "P") ddSeries = st.dd;
  else {
    const raw = ffill(wide.series(t)), rdd = rollDD(raw, w), wm = Object.fromEntries(wide.dates.map((d, i) => [d, i]));
    ddSeries = pd.d.map(d => wm[d] != null ? rdd[wm[d]] : null);
  }
  lineChart($("#c2"), pd.d, [{ label: w === "P" ? "기간 고점 대비" : `${w}일 고점 대비`, data: ddSeries, color: css("--down"),
    fill: "color-mix(in srgb, " + css("--down") + " 14%, transparent)" }], { pct: true, height: 220 });
  lineChart($("#c3"), pd.d, [{ label: "섹터 대비", data: v.map((x, i) => x / sec[i] * 100), color: css("--accent") },
    { label: mktName(mk) + " 대비", data: v.map((x, i) => x / mkt[i] * 100), color: css("--faint"), dash: [5, 4] }], { ref: 100, height: 220 });
  const sr = async () => { if (!FB.user) return reportGate($("#srep"), []);
    const list = await reportsFor([t]); if (!$("#srep")) return;
    reportGate($("#srep"), list.slice(0, 12), "이 종목은 받아 둔 리포트가 없어요."); };
  FB.listeners.push(sr); FB.ready.then(sr);
  $("#jl").href = "#journal/new?code=" + t + "&name=" + encodeURIComponent(s.n);
}
