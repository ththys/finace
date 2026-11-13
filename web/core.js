"use strict";
/* 코스피 데일리 — 공용: 도구·로그인(Firebase)·데이터 읽기·기간·차트·추세 밴드·전 종목 지표
   정적 사이트. data/*.json 을 읽어 브라우저에서 수익률·MDD·상대강도 등을 계산한다. 읽는 순서: core → stock → market → lists → main */


const DATA = "data/", JOURNAL = "journal/";
// Firebase 웹 설정 (공개돼도 되는 값 — 접근은 Firestore 규칙이 막음). 투자일지(journal/index.html)와 같은 프로젝트
const FIREBASE_CONFIG = { apiKey: "AIzaSyBdXtCVCYp8QkvQ4ZTccFbzVO1kQkD9PPE", authDomain: "finace-journal.firebaseapp.com", projectId: "finace-journal",
  storageBucket: "finace-journal.firebasestorage.app", messagingSenderId: "950771828976", appId: "1:950771828976:web:e352c88f5ce878643b1a35" };
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cls = v => v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "flat";
const fmtPct = (v, d = 2) => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : "") + v.toFixed(d) + "%";
const fmtNum = v => v == null || !isFinite(v) ? "–" : Math.round(v).toLocaleString("ko-KR");
const trim = s => s.replace(/\.0+$|(\.\d*?)0+$/, "$1");
const kfmt = v => { const a = Math.abs(v); return a >= 1e8 ? trim((v / 1e8).toFixed(1)) + "억" : a >= 1e4 ? trim((v / 1e4).toFixed(1)) + "만" : trim(v.toFixed(a < 10 ? 1 : 0)); };
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/* 라이트/다크 모드: 저장된 선택 > 기기 설정 */
const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const b = document.getElementById("themeBtn"); if (b) { b.innerHTML = isDark() ? `<span class="ti">☀️</span><span class="tl"> 라이트</span>` : `<span class="ti">🌙</span><span class="tl"> 다크</span>`; }
  try { document.getElementById("jf")?.contentWindow?.postMessage({ type: "theme", t: isDark() ? "dark" : "light" }, location.origin); } catch {}
}
try { applyTheme(localStorage.getItem("kd_theme") || ""); } catch { applyTheme(""); }
function toggleTheme() {
  const t = isDark() ? "light" : "dark"; try { localStorage.setItem("kd_theme", t); } catch {}
  applyTheme(t); if (typeof route === "function" && S.meta) route();   // 차트 색을 새 테마로 다시 그림
}
const store = { get(k, d) { try { const v = localStorage.getItem("kd_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem("kd_" + k, JSON.stringify(v)); } catch {} } };

const S = { meta: null, stocks: [], byT: {}, home: null, reports: null, chunks: new Map(), charts: [] };

async function getJSON(path) {
  // meta.json 은 항상 새로, 나머지는 데이터가 새로 만들어질 때마다 주소가 바뀌게 (브라우저·GitHub 캐시 때문에 옛 데이터가 보이지 않게)
  const q = path === "meta.json" ? `?t=${Date.now()}` : S.meta?.built ? `?v=${encodeURIComponent(S.meta.built)}` : "";
  const r = await fetch(DATA + path + q, path === "meta.json" ? { cache: "no-store" } : undefined);
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

/* ---------------- 관심종목 (Firebase, 투자일지와 같은 로그인) ---------------- */
const FB = { enabled: true, user: null, watch: {}, ready: null, listeners: [] };
function fbInit() {
  if (!FB.enabled) { FB.ready = Promise.resolve(); return; }
  const base = "https://www.gstatic.com/firebasejs/10.12.2/";
  FB.ready = Promise.all([import(base + "firebase-app.js"), import(base + "firebase-auth.js"), import(base + "firebase-firestore.js")])
    .then(([app, auth, fs]) => new Promise(res => {
      const a = app.initializeApp(FIREBASE_CONFIG);
      Object.assign(FB, { A: auth, F: fs, auth: auth.getAuth(a), db: fs.getFirestore(a) });
      let first = true;
      auth.onAuthStateChanged(FB.auth, async u => {
        FB.user = u; FB.watch = {};
        S.reports = []; S.reportsInfo = null;
        if (u) { try { const snap = await fs.getDocs(fs.collection(FB.db, "watchlist"));
          snap.forEach(d => FB.watch[d.id] = d.data()); } catch (e) { console.warn("관심종목 읽기 실패", e); FB.err = e.message; }
          try { const r = await fs.getDoc(fs.doc(FB.db, "state", "reports"));
            if (r.exists()) { const x = r.data(); S.reports = prepReports(JSON.parse(x.json || "[]")); S.reportsInfo = x.updated; } } catch (e) { console.warn("리포트 읽기 실패", e); }
          try { const js = await fs.getDocs(fs.collection(FB.db, "journal"));
            FB.journal = js.docs.map(d => { const x = d.data(); return { id: d.id, date: x.date, title: x.title, kind: x.kind, tickers: x.tickers || [] }; }); } catch (e) { console.warn("일지 읽기 실패", e); FB.journal = []; } }
        else FB.journal = [];
        renderUser(); if (first) { first = false; res(); } else FB.listeners.forEach(f => f());
      });
    })).catch(e => { console.warn("Firebase 로드 실패", e); FB.enabled = false; });
}
window.fbLogin = () => FB.A && FB.A.signInWithPopup(FB.auth, new FB.A.GoogleAuthProvider()).catch(e => alert("로그인 실패: " + e.message));
window.fbLogout = () => FB.A && FB.A.signOut(FB.auth);
function renderUser() {
  const el = $("#user"); if (!el) return;
  if (!FB.enabled) { el.innerHTML = ""; return; }
  el.innerHTML = FB.user ? `<span class="small muted">로그인됨</span> <button class="link" onclick="fbLogout()">로그아웃</button>`
    : `<button class="act" onclick="fbLogin()">구글 로그인</button>`;
}
const isFav = t => !!FB.watch[t]?.favorite;
const inWatch = t => !!(FB.watch[t]?.favorite || FB.watch[t]?.track_reports);
/** 리포트 영역: 로그인 전엔 안내, 로그인 후엔 관심종목 리포트만 */
function reportGate(el, list, empty = "관심종목 리포트가 아직 없어요.") {
  if (!el) return;
  if (!FB.enabled) { el.innerHTML = `<li class="muted small">리포트는 실제 사이트에서 로그인하면 보여요.</li>`; return; }
  if (!FB.user) { el.innerHTML = `<li class="muted small">리포트는 로그인하면 관심종목 것만 보여요. <button class="act" onclick="fbLogin()">구글 로그인</button></li>`; return; }
  el.innerHTML = list.map(reportItem).join("") || `<li class="muted small">${empty}</li>`;
}
const star = t => isFav(t) ? `<span class="star" title="관심종목">★</span>` : "";
async function toggleWatch(t, field) {
  if (!FB.user) return fbLogin();
  const s = S.byT[t], cur = FB.watch[t];
  const doc = cur ? { ...cur, [field]: !cur[field] }
    : { name: s?.n || t, market: s?.m || "KOSPI", favorite: field === "favorite", track_reports: field === "track_reports",
        added: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19).replace("T", " ") };
  if (!cur && field === "track_reports") doc.favorite = true;
  if (field === "favorite") doc.track_reports = doc.favorite;  // 관심종목이면 리포트도 자동으로
  try {
    if (!doc.favorite && !doc.track_reports) { await FB.F.deleteDoc(FB.F.doc(FB.db, "watchlist", t)); delete FB.watch[t]; }
    else { await FB.F.setDoc(FB.F.doc(FB.db, "watchlist", t), doc, { merge: true }); FB.watch[t] = doc; }
  } catch (e) { alert("저장 실패: " + e.message); }
}

const mktOf = t => S.byT[t]?.m === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
const mktTickers = m => S.stocks.filter(s => (s.m === "KOSDAQ" ? "KOSDAQ" : "KOSPI") === m).map(s => s.t);
const mktName = m => m === "KOSDAQ" ? "코스닥" : "코스피";

/* ---------------- 종가 데이터 ---------------- */
function chunkFor(dateStr) {
  const y = +dateStr.slice(0, 4), lastY = +S.meta.asof.slice(0, 4);
  return y < lastY ? "Y" + y : "M" + dateStr.slice(0, 7);
}
function loadChunk(name, sub = "px") {
  const key = sub + "/" + name;
  if (!S.chunks.has(key)) S.chunks.set(key, getJSON(key + ".json").then(c => {
    c.idx = Object.fromEntries(c.t.map((t, i) => [t, i])); return c; }));
  return S.chunks.get(key);
}
/** start~asof 구간 + 기준일 직전 값을 위해 앞 파일 하나 더 (sub='vol' 이면 거래량) */
async function loadRange(start, sub = "px") {
  const names = sub === "vol" ? (S.meta.vchunks || []) : S.meta.chunks;
  if (!names.length) return { dates: [], series: () => [] };
  let i = names.indexOf(chunkFor(start));
  if (i < 0) i = start < S.meta.first ? 0 : names.length - 1;
  const need = names.slice(Math.max(0, i - 1));
  const cs = await Promise.all(need.map(n => loadChunk(n, sub)));
  const dates = cs.flatMap(c => c.d);
  const series = t => cs.flatMap(c => c.idx[t] != null ? c.c[c.idx[t]] : new Array(c.d.length).fill(null));
  return { dates, series };
}
function ffill(a) { let last = null; return a.map(v => (v == null ? last : (last = v))); }
function baseIndex(dates, start) { let b = -1; for (let i = 0; i < dates.length; i++) { if (dates[i] <= start) b = i; else break; } return b; }

/** 기간 데이터: 각 종목 기준일=1 정규화 + 시총가중 지수 */
async function periodData(start, tickers) {
  const { dates, series } = await loadRange(start);
  const b = Math.max(0, baseIndex(dates, start));
  const d = dates.slice(b);
  const out = {};
  for (const t of tickers) {
    const raw = ffill(series(t)), base = raw[b], last = raw[raw.length - 1];
    if (base == null || last == null) continue;
    out[t] = { v: raw.slice(b).map(x => x == null ? null : x / base), base, last };
  }
  return { d, s: out, baseDate: dates[b] };
}
function capIndex(pd, tickers) {
  let wsum = 0; const acc = new Float64Array(pd.d.length);
  for (const t of tickers) {
    const x = pd.s[t]; if (!x) continue;
    const w = (S.byT[t]?.cap || 0) * x.base / x.last; wsum += w;
    x.v.forEach((v, i) => { acc[i] += (v ?? 1) * w; });
  }
  return wsum ? Array.from(acc, v => v / wsum) : null;
}
/** 최근 n거래일 창 안의 고점 대비 낙폭 (각 날짜마다) */
function rollDD(v, n) {
  const out = []; const q = [];  // 단조 감소 큐로 창 안 최댓값
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x == null) { out.push(null); continue; }
    while (q.length && v[q[q.length - 1]] <= x) q.pop();
    q.push(i);
    while (q[0] <= i - n) q.shift();
    out.push((x / v[q[0]] - 1) * 100);
  }
  return out;
}
const isoMinus = (iso, days) => { const x = new Date(iso + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - days); return x.toISOString().slice(0, 10); };
/** 최근 n거래일 MDD / 현재 낙폭 (기간과 상관없이 기준일 기준 최근 구간) */
async function recentDD(tickers, ns = [20, 60]) {
  const { dates, series } = await loadRange(isoMinus(S.meta.asof, 200));
  const out = {};
  for (const t of tickers) {
    const v = ffill(series(t)).filter(x => x != null);
    if (v.length < 5) continue;
    const r = {};
    for (const n of ns) { const w = v.slice(-n); const st = ddStats(w, w.map(() => "")); r["mdd" + n] = st.mdd; r["cur" + n] = st.cur; }
    out[t] = r;
  }
  return out;
}
function ddStats(v, d) {
  let peak = -Infinity, pi = 0, mdd = 0, mp = 0, mt = 0; const dd = [];
  v.forEach((x, i) => { if (x > peak) { peak = x; pi = i; } const r = x / peak - 1; dd.push(r * 100); if (r < mdd) { mdd = r; mp = pi; mt = i; } });
  return { dd, mdd: mdd * 100, cur: dd[dd.length - 1], peak: d[mp], trough: d[mt] };
}

/* ---------------- 기간 선택 ---------------- */
const PRESETS = [["YTD", "YTD"], ["1M", "1개월"], ["3M", "3개월"], ["6M", "6개월"], ["1Y", "1년"], ["3Y", "3년"], ["CUSTOM", "직접"]];
function presetStart(p) {
  const a = new Date(S.meta.asof + "T00:00:00");
  const iso = x => x.toISOString().slice(0, 10);
  if (p === "YTD") return (a.getFullYear() - 1) + "-12-31";
  const m = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36 }[p];
  if (m) { const x = new Date(a); x.setMonth(x.getMonth() - m); return iso(x); }
  return store.get("custom", (a.getFullYear() - 1) + "-12-31");
}
function periodBar(onChange) {
  const p = store.get("preset", "YTD");
  const el = document.createElement("div"); el.className = "period";
  el.innerHTML = `<span class="small muted">기간</span>
    <div class="seg">${PRESETS.map(([k, l]) => `<button data-p="${k}" class="${k === p ? "on" : ""}">${l}</button>`).join("")}</div>
    <input type="date" id="pstart" min="${S.meta.first}" max="${S.meta.asof}" value="${presetStart(p)}" ${p === "CUSTOM" ? "" : "hidden"} aria-label="기준일">
    <span class="info" id="pinfo"></span>`;
  const fire = () => { const pr = store.get("preset", "YTD"); const st = pr === "CUSTOM" ? $("#pstart", el).value : presetStart(pr);
    $("#pinfo", el).textContent = `${st} → ${S.meta.asof}`; onChange(st); };
  el.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
    el.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x === b));
    store.set("preset", b.dataset.p); $("#pstart", el).hidden = b.dataset.p !== "CUSTOM"; fire(); });
  $("#pstart", el).onchange = e => { store.set("custom", e.target.value); fire(); };
  setTimeout(fire);
  return el;
}

/* ---------------- 차트 ---------------- */
function destroyCharts() { S.charts.forEach(c => c.destroy()); S.charts = []; }
/** el 안에 그려 둔 차트만 지움 (그 칸만 다시 그릴 때) */
function destroyIn(el) { S.charts.filter(c => el.contains(c.root)).forEach(c => { c.destroy(); S.charts.splice(S.charts.indexOf(c), 1); }); }
function lineChart(el, d, series, { pct = false, ref = null, height = 260, legend = true, compact = false, marks = [], won = false, onToggle = null, bands = null, lastTag = null } = {}) {
  const xs = d.map(s => Date.parse(s + "T00:00:00Z") / 1000);
  const ink = css("--ink"), sub = css("--sub"), rule = css("--rule");
  const palette = [css("--ink"), css("--accent"), css("--faint"), css("--up"), css("--down"), "#b07d2a", "#7a52b3", "#2f8f9d"];
  const opts = {
    width: Math.max(280, el.clientWidth - 4), height,
    cursor: { sync: { key: "kd", filters: { pub: type => type === "mousemove" || type === "mouseleave" } }, points: { size: 6 }, drag: { x: false, y: false } },
    legend: { show: legend, live: true },
    scales: { x: { time: true } },
    axes: [
      { stroke: sub, grid: { stroke: rule, width: 1 }, ticks: { stroke: rule } },
      { stroke: sub, grid: { stroke: rule, width: 1 }, ticks: { stroke: rule }, size: won ? 72 : 56,
        values: (u, vals) => vals.map(v => pct ? v.toFixed(0) + "%" : won ? fmtNum(v) : compact ? kfmt(v) : v.toFixed(0)) },
    ],
    series: [{ label: "날짜", value: (u, v) => v == null ? "–" : new Date(v * 1000).toISOString().slice(0, 10) },
      ...series.map((s, i) => ({ label: s.label, show: s.show !== false, stroke: s.color || palette[i % palette.length], width: s.width || 1.6,
        dash: s.dash, spanGaps: !s.bars, fill: s.bars ? (s.color || palette[i % palette.length]) : s.fill,
        paths: s.bars ? uPlot.paths.bars({ size: [0.7, 8] }) : s.hidden ? () => null : undefined, points: { show: false },
        value: (u, v) => v == null ? "–" : pct ? v.toFixed(2) + "%" : won || compact ? fmtNum(v) : v.toFixed(1) }))],
    hooks: { drawAxes: [u => { const c = u.ctx; c.save(); c.lineWidth = 1;
      if (ref != null) { const y = u.valToPos(ref, "y", true); c.strokeStyle = sub; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(u.bbox.left, y); c.lineTo(u.bbox.left + u.bbox.width, y); c.stroke(); }
      marks.forEach(([iso, col, lab]) => { const x = u.valToPos(Date.parse(iso + "T00:00:00Z") / 1000, "x", true); c.strokeStyle = col; c.setLineDash([4, 3]);
        c.beginPath(); c.moveTo(x, u.bbox.top); c.lineTo(x, u.bbox.top + u.bbox.height); c.stroke();
        if (lab) { c.fillStyle = col; c.font = `${11 * devicePixelRatio}px sans-serif`; c.fillText(lab, x + 4 * devicePixelRatio, u.bbox.top + 12 * devicePixelRatio); } });
      c.restore(); }] },
  };
  if (compact) { opts.axes[0].show = false; opts.axes[1].space = 24; opts.padding = [6, 8, 0, 0]; }
  if (lastTag != null) opts.hooks.draw = [u => drawLastTag(u, lastTag)];
  if (bands) opts.bands = bands;
  if (onToggle) opts.hooks.setSeries = [(uu, i, o) => { if (i != null && o && o.show != null && uu.series[i]) onToggle(uu.series[i].label, o.show); }];
  const u = new uPlot(opts, [xs, ...series.map(s => s.data)], el);
  S.charts.push(u);
  return u;
}
window.addEventListener("resize", () => S.charts.forEach(u => { const w = u.root.parentElement.clientWidth - 4; if (w > 0) u.setSize({ width: Math.max(280, w), height: u.height }); }));

/* ---------------- 공통 화면 조각 ---------------- */
function sparkSVG(vals, w = 160, h = 34) {
  const v = vals.filter(x => x != null); if (!v.length) return "";
  const lo = Math.min(...v), hi = Math.max(...v), sx = w / (vals.length - 1), sy = (h - 4) / ((hi - lo) || 1);
  const pts = vals.map((x, i) => `${(i * sx).toFixed(1)},${(h - 2 - (x - lo) * sy).toFixed(1)}`).join(" ");
  const col = v[v.length - 1] >= v[0] ? "var(--up)" : "var(--down)";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5"/></svg>`;
}
function heatStyle(v, scale) {
  if (v == null) return "";
  const a = Math.min(1, Math.abs(v) / scale) * 28;
  return `background:color-mix(in srgb, var(${v >= 0 ? "--up" : "--down"}) ${a.toFixed(0)}%, transparent)`;
}
function sortableTable(el, cols, rows, { key, asc = false, onRow, selected } = {}) {
  let sk = key, sa = asc;
  const draw = () => {
    const rs = [...rows].sort((a, b) => { const x = a[sk], y = b[sk]; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * (sa ? 1 : -1); });
    el.innerHTML = `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th data-k="${c.k}" class="${c.k === sk ? "sorted" + (sa ? " asc" : "") : ""}">${c.l}</th>`).join("")}</tr></thead>
      <tbody>${rs.map(r => `<tr class="${onRow ? "click" : ""} ${selected && selected(r) ? "sel" : ""}" data-id="${esc(r.id)}">${cols.map(c => c.f(r)).join("")}</tr>`).join("")}</tbody></table></div>`;
    el.querySelectorAll("th").forEach(th => th.onclick = () => { const k = th.dataset.k; if (k === sk) sa = !sa; else { sk = k; sa = false; } draw(); });
    if (onRow) el.querySelectorAll("tbody tr").forEach(tr => tr.onclick = () => onRow(rows.find(r => String(r.id) === tr.dataset.id)));
  };
  draw();
  return { draw };
}
const pctCell = (v, heat) => `<td class="${cls(v)} ${heat ? "heat" : ""}" style="${heat ? heatStyle(v, heat) : ""}">${fmtPct(v)}</td>`;

/** 종목 검색창 (상단 메뉴·종목 화면 공용) */
function attachSearch(q, sg, onPick) {
  let hits = [], hi = 0;
  const pick = t => { sg.hidden = true; q.value = ""; q.blur(); onPick(t); };
  q.oninput = () => { const s = q.value.trim().toLowerCase(); if (!s) { sg.hidden = true; return; }
    hits = S.stocks.filter(x => x.n.toLowerCase().includes(s) || x.t.includes(s))
      .sort((x, y) => (x.n.toLowerCase().startsWith(s) ? 0 : 1) - (y.n.toLowerCase().startsWith(s) ? 0 : 1) || y.cap - x.cap).slice(0, 12); hi = 0;
    sg.innerHTML = hits.map((x, i) => `<li data-t="${x.t}" class="${i === 0 ? "on" : ""}"><span>${star(x.t)}${esc(x.n)}</span><small>${x.t} · ${esc(x.s)}</small></li>`).join("") || `<li class="muted">없음</li>`;
    sg.hidden = false; sg.querySelectorAll("li[data-t]").forEach(li => li.onmousedown = e => { e.preventDefault(); pick(li.dataset.t); }); };
  q.onkeydown = e => { if (e.key === "Enter" && hits[hi]) pick(hits[hi].t);
    if (e.key === "Escape") { sg.hidden = true; q.blur(); }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && hits.length) { hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      sg.querySelectorAll("li").forEach((li, i) => li.classList.toggle("on", i === hi)); e.preventDefault(); } };
  q.onblur = () => setTimeout(() => sg.hidden = true, 150);
}

/** 그 날짜(휴일이면 직전 거래일) 종가 */
async function priceOn(t, date) {
  const d = date > S.meta.asof ? S.meta.asof : date, names = S.meta.chunks;
  let i = names.indexOf(chunkFor(d)); if (i < 0) i = d < S.meta.first ? -1 : names.length - 1;
  for (let k = 0; i >= 0 && k < 3; i--, k++) { const c = await loadChunk(names[i]), j0 = c.idx[t]; if (j0 == null) continue;
    for (let j = c.d.length - 1; j >= 0; j--) if (c.d[j] <= d && c.c[j0][j] != null) return c.c[j0][j]; }
  return null;
}

/* ---------------- 추세 밴드 (로그 회귀 채널) ---------------- */
const dayN = d => Date.parse(d + "T00:00:00Z") / 864e5;
/** from~to 구간 가격의 ln 을 날짜에 직선 회귀 → 추세선과 ±kσ 밴드 */
function fitBand(dates, vals, from, to, perYear) {
  // perYear 가 있으면 x = 거래일(봉) 순번 → 봉 축 차트에서 추세선이 곧게 나옴
  const pos = perYear ? new Map(dates.map((d, i) => [d, i])) : null, X = d => pos ? pos.get(d) : dayN(d);
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; const pts = [];
  for (let i = 0; i < dates.length; i++) { const d = dates[i], v = vals[i]; if (!(v > 0) || d < from || (to && d > to)) continue;
    const x = X(d), y = Math.log(v); pts.push([x, y]); n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
  if (n < 10) return null;
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  const sig = Math.sqrt(pts.reduce((s, [x, y]) => s + (y - a - b * x) ** 2, 0) / (n - 2));
  return { a, b, sig, n, mid: d => Math.exp(a + b * X(d)), yr: (Math.exp(b * (perYear || 365)) - 1) * 100 };
}
const BANDK = [[1, "±1σ"], [2, "±2σ"]];
/** 밴드 설정 줄: 켜기 · 폭(±1σ/±2σ) · 기간 찍기 · 시작/끝 날짜 */
function bandControls(key, defFrom, onChange) {
  const b = store.get(key, { on: false, from: "", to: "", k: 2 });
  const box = document.createElement("div"); box.className = "bandbar";
  box.innerHTML = `<label class="tgl"><input type="checkbox" data-f="on" ${b.on ? "checked" : ""}> <b>추세</b></label>
    <span class="tabs sm" title="밴드 폭">${BANDK.map(([k, l]) => `<button data-k="${k}" class="${k === b.k ? "on" : ""}">${l}</button>`).join("")}</span>
    <button class="act pick" type="button">📍 기간 찍기</button>
    <span class="bandrange"><input class="dt" inputmode="numeric" maxlength="10" data-f="from" value="${b.from || defFrom}" placeholder="20260315" title="예: 20260315 또는 2026-03-15"> ~ <input class="dt" inputmode="numeric" maxlength="10" data-f="to" value="${b.to}" placeholder="오늘" title="비우면 오늘까지"></span><span class="pickhint"></span>
    <span class="small muted bandinfo"></span>`;
  const pk = box.querySelector(".pick"), hint = box.querySelector(".pickhint");
  const showPick = () => { const P = S.bandPick?.key === key ? S.bandPick : null; pk.classList.toggle("on", !!P);
    pk.textContent = P ? "찍기 취소" : "📍 기간 찍기";
    hint.textContent = !P ? "" : P.step === "from" ? "차트에서 시작점을 클릭하세요" : "끝점을 클릭하세요 · 오늘까지면 '오늘까지' 버튼";
    if (P?.step === "to") hint.insertAdjacentHTML("beforeend", ` <button class="act" type="button" data-now>오늘까지</button>`);
    hint.querySelector("[data-now]")?.addEventListener("click", () => { b.to = ""; S.bandPick = null; save(); }); };
  pk.onclick = () => { S.bandPick = S.bandPick?.key === key ? null : { key, step: "from" }; showPick(); S.charts.forEach(c => c.over.style.cursor = S.bandPick ? "crosshair" : ""); };
  showPick();
  const save = () => { store.set(key, b); onChange(b); };
  box.querySelectorAll("input[type=checkbox]").forEach(i => i.onchange = () => { b[i.dataset.f] = i.checked; save(); });
  // 날짜 칸: 입력 중(연도 타이핑 중)에는 다시 그리지 않고, 다 고른 뒤(포커스 빠짐·엔터·달력 선택) 적용
  box.querySelectorAll("input.dt").forEach(i => { let tm = null;
    const apply = () => { clearTimeout(tm); const f = i.dataset.f, raw = i.value.replace(/\D/g, "");
      if (raw && raw.length !== 8) { i.classList.add("bad"); return; }
      const v = raw ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : "";
      if (v && (!(v >= "1980-01-01" && v <= "2100-12-31") || isNaN(Date.parse(v)))) { i.classList.add("bad"); return; }
      i.classList.remove("bad"); i.value = v;
      if ((b[f] || "") === v) return;
      b[f] = v; b.on = true; box.querySelector("[data-f=on]").checked = true; save(); };
    i.onchange = apply;
    i.onblur = apply; i.onkeydown = e => { if (e.key === "Enter") apply(); }; });
  box.querySelectorAll(".tabs button").forEach(x => x.onclick = () => { b.k = +x.dataset.k; b.on = true; box.querySelector("[data-f=on]").checked = true;
    box.querySelectorAll(".tabs button").forEach(y => y.classList.toggle("on", y === x)); save(); });
  /** 차트를 클릭해 시작 → 끝 순서로 지정 (찍기 버튼을 눌렀을 때만) */
  const attach = (u, dates) => {
    if (S.bandPick?.key === key) u.over.style.cursor = "crosshair";
    u.over.addEventListener("click", () => {
      const P = S.bandPick; if (!P || P.key !== key) return;
      const i = u.cursor.idx; if (i == null || !dates[i]) return;
      if (P.step === "from") { b.from = dates[i]; b.to = ""; b.on = true; S.bandPick = { key, step: "to" }; }
      else { b.to = dates[i] > b.from ? dates[i] : ""; S.bandPick = null; }
      save();
    });
  };
  return { box, get: () => ({ ...b, from: b.from || defFrom }), attach };
}
/** 화면 날짜 d 에 밴드 3줄 + 정보 문구 */
function bandSeries(fit, d, from, k, last, lastDate) {
  const f = x => x >= from ? fit.mid(x) : null, e = Math.exp(k * fit.sig);
  const up = d.map(x => f(x) && f(x) * e), mid = d.map(f), lo = d.map(x => f(x) && f(x) / e);
  const z = (Math.log(last) - Math.log(fit.mid(lastDate))) / fit.sig;
  const where = z > k ? "밴드 위로 이탈" : z < -k ? "밴드 아래로 이탈" : z > 0 ? "추세선 위" : "추세선 아래";
  return { series: [
      { label: `밴드 +${k}σ`, data: up, color: "#4a7dff", width: 1.4 },
      { label: "추세선", data: mid, color: "#4a7dff", dash: [3, 4], width: 1 },
      { label: `밴드 −${k}σ`, data: lo, color: "#4a7dff", width: 1.4 }],
    info: `추세 연 ${fit.yr > 0 ? "+" : ""}${fit.yr.toFixed(0)}% · 지금 ${z > 0 ? "+" : ""}${z.toFixed(1)}σ (${where}) · 지금 밴드 ${fmtNum(fit.mid(lastDate) / e)} ~ ${fmtNum(fit.mid(lastDate) * e)}` };
}

/* ---------------- 전 종목 지표 (홈·섹터·스크리너 공용) ---------------- */
/** start 가 든 파일부터 끝까지 (앞 파일은 안 받음) */
async function loadSpan(start, sub = "px") {
  const names = sub === "vol" ? (S.meta.vchunks || []) : S.meta.chunks;
  if (!names.length) return { dates: [], series: () => [] };
  let i = names.indexOf(chunkFor(start)); if (i < 0) i = start < S.meta.first ? 0 : names.length - 1;
  const cs = await Promise.all(names.slice(i).map(n => loadChunk(n, sub)));
  return { dates: cs.flatMap(c => c.d), series: t => cs.flatMap(c => c.idx[t] != null ? c.c[c.idx[t]] : new Array(c.d.length).fill(null)) };
}
function universe() {
  return S.uni ||= (async () => {
    const [px, vr] = await Promise.all([loadSpan(isoMinus(S.meta.asof, 660)), loadSpan(isoMinus(S.meta.asof, 45), "vol")]);
    const D = px.dates, L = D.length - 1;
    const ytdB = baseIndex(D, (+S.meta.asof.slice(0, 4) - 1) + "-12-31");
    const vIdx = new Map(vr.dates.map((d, i) => [d, i])), vi = vIdx.get(D[L]);
    const rows = [], C = {};
    for (const s of S.stocks) {
      const c = ffill(px.series(s.t)); if (c[L] == null) continue;
      C[s.t] = c;
      const p = c[L], at = k => L - k >= 0 && c[L - k] ? (p / c[L - k] - 1) * 100 : null;
      let hi = -Infinity, lo = Infinity;
      for (let i = Math.max(0, L - 251); i <= L; i++) { const x = c[i]; if (x == null) continue; if (x > hi) hi = x; if (x < lo) lo = x; }
      const ma = k => { if (L - k + 1 < 0) return null; let t = 0; for (let i = L - k + 1; i <= L; i++) { if (c[i] == null) return null; t += c[i]; } return t / k; };
      const win = k => { let pk = -Infinity, mdd = 0; for (let i = Math.max(0, L - k + 1); i <= L; i++) { const x = c[i]; if (x == null) continue; if (x > pk) pk = x; mdd = Math.min(mdd, x / pk - 1); } return [mdd * 100, (p / pk - 1) * 100]; };
      let f0 = 0; while (f0 < L && c[f0] == null) f0++; const days = L - f0 + 1;   // 상장(데이터) 후 거래일 수
      const m20 = ma(20), m60 = ma(60), m120 = ma(120), m200 = ma(200), [mdd20, cur20] = days >= 20 ? win(20) : [null, null], [mdd60, cur60] = days >= 60 ? win(60) : [null, null];
      let vol = null, avg = null;
      if (vi != null) { const vs = vr.series(s.t); vol = vs[vi]; let t = 0, k = 0; for (let i = Math.max(0, vi - 20); i < vi; i++) if (vs[i] != null) { t += vs[i]; k++; } avg = k ? t / k : null; }
      rows.push({ id: s.t, t: s.t, n: s.n, s: s.s, m: s.m === "KOSDAQ" ? "KOSDAQ" : "KOSPI", cap: s.cap, p,
        d1: at(1), w1: at(5), m1: at(21), m3: at(63), y1: at(252), ytd: ytdB >= 0 && c[ytdB] ? (p / c[ytdB] - 1) * 100 : null,
        hi52: hi, lo52: lo, dHi: days >= 20 ? (p / hi - 1) * 100 : null, dLo: days >= 20 ? (p / lo - 1) * 100 : null, days,
        mom12: days >= 252 && c[L - 21] && c[L - 252] ? (c[L - 21] / c[L - 252] - 1) * 100 : null,
        sd: days >= 60 ? (() => { let n = 0, s1 = 0, s2 = 0; for (let i = Math.max(f0 + 1, L - 119); i <= L; i++) { if (!c[i] || !c[i - 1]) continue; const r = Math.log(c[i] / c[i - 1]); n++; s1 += r; s2 += r * r; }
          return n > 40 ? Math.sqrt(Math.max(0, s2 / n - (s1 / n) ** 2) * 252) * 100 : null; })() : null,
        a20: m20 ? p > m20 : null, a60: m60 ? p > m60 : null, a200: m200 ? p > m200 : null,
        align: m20 && m60 && m120 ? m20 > m60 && m60 > m120 : null, mdd20, cur20, mdd60, cur60,
        vol, vr: avg && vol != null ? vol / avg : null, val: vol != null ? vol * p / 1e8 : null });
    }
    const F = await loadX("fund_last");
    if (F) rows.forEach(r => { const f = F.rows[r.t]; if (f) { r.per = f[0]; r.pbr = f[1]; r.div = f[2]; } });
    quantScores(rows);
    const sec = {}; rows.forEach(r => { if (r.m1 == null) return; const o = sec[r.s] ||= [0, 0]; o[0] += r.cap * r.m1; o[1] += r.cap; });
    rows.forEach(r => { const o = sec[r.s]; r.vs1m = o && o[1] && r.m1 != null ? r.m1 - o[0] / o[1] : null; });
    return { D, L, rows, byT: Object.fromEntries(rows.map(r => [r.t, r])), C };
  })();
}
/** 퀀트 팩터 점수 (0~100, 높을수록 좋음 · 전 종목 중 백분위)
 *  V 밸류 = 이익수익률(1/PER)·장부가치(1/PBR)   M 모멘텀 = 12-1개월 수익률(최근 1개월 뺌)
 *  Q 퀄리티 = ROE(=PBR/PER)   L 저변동 = 최근 6개월 변동성이 낮을수록
 *  멀티팩터 = 있는 점수(3개 이상)의 평균. 시총 300억 미만·적자(PER 없음)는 V·Q 없음 */
function quantScores(rows) {
  rows.forEach(r => { const ok = r.cap >= 300 && r.val > 0;   // 거래 정지·거래 없는 종목 제외
    r.ey = ok && r.per > 0 ? 100 / r.per : null; r.bp = ok && r.pbr > 0 ? 1 / r.pbr : null;
    r.roe = r.per > 0 && r.pbr > 0 ? r.pbr / r.per * 100 : null; r.q_ = ok && r.roe != null && r.roe < 80 ? r.roe : null;
    r.lv_ = ok && r.sd != null ? -r.sd : null; r.m_ = ok ? r.mom12 : null; });
  const rank = (k, out) => { const xs = rows.filter(r => r[k] != null).sort((a, b) => a[k] - b[k]), n = xs.length;
    xs.forEach((r, i) => r[out] = n > 1 ? Math.round(i / (n - 1) * 100) : null); };
  rank("ey", "_e"); rank("bp", "_b"); rank("m_", "fM"); rank("q_", "fQ"); rank("lv_", "fL");
  rows.forEach(r => { r.fV = r._e != null && r._b != null ? Math.round((r._e + r._b) / 2) : r._e ?? r._b ?? null;
    const v = [r.fV, r.fM, r.fQ, r.fL].filter(x => x != null); r.fAll = v.length >= 3 ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; });
}
/** 매물대 위 비중 (최근 1년 거래량 중 현재가보다 비싸게 거래된 비율) — 스크리너에서만 */
function overhead(U) {
  return U.over ||= (async () => {
    const vr = await loadSpan(isoMinus(S.meta.asof, 370), "vol"), vm = new Map(vr.dates.map((d, i) => [d, i]));
    const from = Math.max(0, U.L - 251), idx = U.D.map(d => vm.get(d));
    for (const r of U.rows) {
      const c = U.C[r.t], vs = vr.series(r.t); let up = 0, tot = 0;
      for (let i = from; i <= U.L; i++) { const j = idx[i]; if (j == null || c[i] == null) continue; const v = vs[j]; if (!v) continue; tot += v; if (c[i] > r.p) up += v; }
      r.over = tot ? up / tot * 100 : null;
    }
    return true;
  })();
}
/** 시장 체력: 날짜별 이평선 위 비율, 52주 신고가·신저가, 상승·하락 종목 수 */
function breadthHistory(U, mk) {
  const key = "br_" + mk; if (U[key]) return U[key];
  const ts = U.rows.filter(r => mk === "ALL" || r.m === mk).map(r => r.t), n = U.D.length, st = Math.min(n - 1, Math.max(252, n - 250)), m = n - st;
  const Z = () => new Float64Array(m);
  const a = { 20: Z(), 60: Z(), 200: Z() }, v = { 20: Z(), 60: Z(), 200: Z() }, nh = Z(), nl = Z(), up = Z(), dn = Z(), lu = Z(), ld = Z();
  for (const t of ts) {
    const c = U.C[t], ps = new Float64Array(n + 1), pn = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) { ps[i + 1] = ps[i] + (c[i] ?? 0); pn[i + 1] = pn[i] + (c[i] == null ? 1 : 0); }
    const qmax = [], qmin = [];
    for (let i = 0; i < n; i++) {
      const x = c[i];
      if (x != null) {
        while (qmax.length && c[qmax.at(-1)] <= x) qmax.pop(); qmax.push(i);
        while (qmin.length && c[qmin.at(-1)] >= x) qmin.pop(); qmin.push(i);
      }
      while (qmax.length && qmax[0] <= i - 252) qmax.shift();
      while (qmin.length && qmin[0] <= i - 252) qmin.shift();
      if (i < st || x == null) continue;
      const j = i - st;
      for (const k of [20, 60, 200]) if (i - k + 1 >= 0 && pn[i + 1] - pn[i - k + 1] === 0) { v[k][j]++; if (x > (ps[i + 1] - ps[i - k + 1]) / k) a[k][j]++; }
      if (c[i - 252] != null) { if (qmax[0] === i) nh[j]++; if (qmin[0] === i) nl[j]++; }
      const y = c[i - 1]; if (y) { const ch = x / y - 1; if (ch > 0) up[j]++; else if (ch < 0) dn[j]++; if (ch >= 0.295) lu[j]++; if (ch <= -0.295) ld[j]++; }
    }
  }
  const pct = k => Array.from(a[k], (x, j) => v[k][j] ? x / v[k][j] * 100 : null);
  return U[key] = { d: U.D.slice(st), a20: pct(20), a60: pct(60), a200: pct(200), nh: Array.from(nh), nl: Array.from(nl), up: Array.from(up), dn: Array.from(dn), lu: Array.from(lu), ld: Array.from(ld), n: ts.length };
}
const isKQsec = s => s.startsWith("코스닥 ");
const CAPF = [[0, "전체"], [1000, "1천억↑"], [5000, "5천억↑"], [10000, "1조↑"]];

function openStock(t) { store.set("stock", t); if (location.hash === "#stock") route(); else location.hash = "stock"; }

function tabsBind(sel, fn) {
  const box = $(sel); if (!box) return;
  box.querySelectorAll("button").forEach(b => b.onclick = () => { box.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); fn(b.dataset.k); });
}

/* ---------------- 수급 · 파생 · 매크로 ---------------- */
const X = {};  // flow/etf/macro/gex.json 캐시
const loadX = n => (X[n] ||= (S.meta.extra || []).includes(n) ? getJSON(n + ".json").catch(() => null) : Promise.resolve(null));
const fmtJo = v => v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : "") + (Math.abs(v) >= 10000 ? (v / 10000).toFixed(2) + "조" : Math.round(v).toLocaleString("ko-KR") + "억");
/** x가 숫자(지수 레벨)인 차트 */
function xyChart(el, xs, series, { height = 240, xfmt = v => v.toFixed(0), yfmt = v => fmtJo(v), ref = 0, vline = [] } = {}) {
  const sub = css("--sub"), rule = css("--rule");
  const opts = {
    width: Math.max(280, el.clientWidth - 4), height, legend: { live: true },
    scales: { x: { time: false } }, cursor: { points: { size: 6 }, drag: { x: false, y: false } },
    axes: [{ stroke: sub, grid: { stroke: rule, width: 1 }, ticks: { stroke: rule }, values: (u, v) => v.map(xfmt) },
      { stroke: sub, grid: { stroke: rule, width: 1 }, ticks: { stroke: rule }, size: 76, values: (u, v) => v.map(yfmt) }],
    series: [{ label: "지수", value: (u, v) => v == null ? "–" : xfmt(v) }, ...series.map(s => ({
      label: s.label, stroke: s.color, width: s.width || 1.6, fill: s.bars ? s.color : s.fill,
      paths: s.bars ? uPlot.paths.bars({ size: [0.8, 14] }) : undefined, points: { show: false }, value: (u, v) => v == null ? "–" : yfmt(v) }))],
    hooks: { drawAxes: [u => { const c = u.ctx; c.save(); c.lineWidth = 1;
      if (ref != null) { const y = u.valToPos(ref, "y", true); c.strokeStyle = sub; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(u.bbox.left, y); c.lineTo(u.bbox.left + u.bbox.width, y); c.stroke(); }
      vline.forEach(([x, col, lab]) => { if (x == null) return; const px = u.valToPos(x, "x", true); c.strokeStyle = col; c.setLineDash(lab ? [] : [3, 3]); c.beginPath(); c.moveTo(px, u.bbox.top); c.lineTo(px, u.bbox.top + u.bbox.height); c.stroke();
        if (lab) { // 다른 선과 반대쪽에 글자 (겹치지 않게), 줄도 다르게
          const others = vline.filter(v => v[0] != null && v[0] !== x), right = !others.length || others.every(v => v[0] < x) || (others.some(v => v[0] < x) && lab === "현재");
          const k = vline.findIndex(v => v[0] === x), dpr = devicePixelRatio;
          c.fillStyle = col; c.font = `600 ${11 * dpr}px sans-serif`; c.textAlign = right ? "left" : "right";
          c.fillText(lab, px + (right ? 4 : -4) * dpr, u.bbox.top + (12 + 14 * k) * dpr); } });
      c.restore(); }] },
  };
  const u = new uPlot(opts, [xs, ...series.map(s => s.data)], el); S.charts.push(u); return u;
}


/* ---------------- 실시간 가격 (네이버 증권 시세, 브라우저에서 바로) ----------------
   CORS 가 막혀 있어 JSONP(<script>)로 받음. 형식: {result:{areas:[{name:"SERVICE_ITEM"|"SERVICE_INDEX", datas:[{cd,nv,pcv,cv,cr,rf}]}]}}
   지수는 값이 100배로 오는 경우가 있어 전일 종가와 비교해 맞춤. 실패하면 null → 화면은 마지막 종가 그대로 */
const LIVE_IDX = { KOSPI: "IDX_KOSPI", KOSDAQ: "IDX_KOSDAQ" };
function jsonp(url, ms = 5000) {
  return new Promise((ok, no) => {
    const fn = "__kd_cb" + Math.random().toString(36).slice(2), sc = document.createElement("script");
    const end = () => { delete window[fn]; sc.remove(); clearTimeout(tm); };
    const tm = setTimeout(() => { end(); no(new Error("응답 없음")); }, ms);
    window[fn] = x => { end(); ok(x); };
    sc.onerror = () => { end(); no(new Error("불러오기 실패")); };
    sc.charset = "euc-kr"; sc.src = url + (url.includes("?") ? "&" : "?") + "_callback=" + fn;
    document.head.appendChild(sc);
  });
}
async function livePrices(tickers, prevClose = {}) {
  const q = [tickers.length ? "SERVICE_ITEM:" + tickers.join(",") : "", "SERVICE_INDEX:KOSPI,KOSDAQ"].filter(Boolean).join("|");
  const js = await jsonp("https://polling.finance.naver.com/api/realtime?query=" + encodeURIComponent(q));
  const out = {}, num = v => v == null || v === "" ? null : +String(v).replace(/,/g, "");
  for (const a of js?.result?.areas || []) for (const x of a.datas || []) {
    let nv = num(x.nv), pcv = num(x.pcv), cv = num(x.cv), cr = num(x.cr); if (!nv) continue;
    const key = a.name === "SERVICE_INDEX" ? LIVE_IDX[x.cd] || x.cd : x.cd;
    const ref = prevClose[key] || (a.name === "SERVICE_INDEX" ? 20000 / 30 : pcv);
    if (ref && nv / ref > 30) { nv /= 100; if (pcv) pcv /= 100; if (cv != null) cv /= 100; }   // 지수 100배 표기
    const down = ["4", "5"].includes(String(x.rf));
    if (cr != null && down && cr > 0) cr = -cr;
    const d1 = pcv ? (nv / pcv - 1) * 100 : cr;
    out[key] = { p: nv, d1, prev: pcv };
  }
  if (!Object.keys(out).length) throw new Error("빈 응답");
  out._at = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
  return out;
}
/** 한국 장 시간(평일 8:50~15:40)인지 */
function marketOpen() {
  const k = new Date(Date.now() + 9 * 3600e3), m = k.getUTCHours() * 60 + k.getUTCMinutes(), w = k.getUTCDay();
  return w >= 1 && w <= 5 && m >= 530 && m <= 940;
}
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/** 장중이면 ms 마다 fn 실행 (화면이 바뀌면 alive() 가 false → 멈춤) */
function liveLoop(name, fn, alive, ms = 30000) {
  clearInterval(S["lt_" + name]);
  S["lt_" + name] = setInterval(() => { if (!alive()) return clearInterval(S["lt_" + name]); if (marketOpen() && !document.hidden) fn(); }, ms);
}
