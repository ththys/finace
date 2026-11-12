"use strict";
/* 목록 화면: 스크리너 · 관심종목 · 리포트(목표가 레이더) */

/* ---------------- 리포트 (집 PC·GitHub Actions 가 받아 Firebase state/reports 에 둔 목록) ---------------- */
/** 받은 목록에 종목 이름과 '같은 증권사의 직전 목표가·의견'을 붙임 (저장된 건 사실만: nid·날짜·종목·증권사·제목·의견·목표가·PDF) */
function prepReports(rows) {
  const last = {};
  [...rows].sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.nid).localeCompare(String(b.nid))).forEach(r => {
    const p = last[r.t + "|" + r.broker] ||= {};
    r.prev_tp = p.tp ?? null; r.prev_op = p.op ?? null; if (r.tp) p.tp = r.tp; if (r.op) p.op = r.op;
    r.n = S.byT[r.t]?.n || FB.watch[r.t]?.name || r.n || r.t; });
  return rows;
}
/** 그 종목들 리포트, 최신순. 상승여력은 지금 가격 기준 */
async function reportsFor(ts) {
  const U = await universe().catch(() => null);
  return (S.reports || []).filter(r => ts.includes(r.t))
    .map(r => ({ ...r, upside: r.tp && U?.byT[r.t]?.p ? (r.tp / U.byT[r.t].p - 1) * 100 : null }))
    .sort((x, y) => (y.date || "").localeCompare(x.date || "") || String(y.nid).localeCompare(String(x.nid)));
}
function reportItem(r) {
  const ch = r.tp && r.prev_tp && r.tp !== r.prev_tp ? (r.tp > r.prev_tp ? `<span class="chip up">목표가 ▲ ${fmtNum(r.prev_tp)}→${fmtNum(r.tp)}</span>` : `<span class="chip down">목표가 ▼ ${fmtNum(r.prev_tp)}→${fmtNum(r.tp)}</span>`)
    : r.tp ? `<span class="chip">목표가 ${fmtNum(r.tp)}</span>` : "";
  return `<li><div class="meta"><span class="num">${esc(r.date)}</span><span>${esc(r.broker || "")}</span>
      <a href="#" data-stock="${esc(r.t)}" onclick="openStock('${esc(r.t)}');return false">${esc(r.n)}</a></div>
    <div class="t"><a href="https://stock.naver.com/research/company/${esc(r.nid)}" target="_blank" rel="noopener">${esc(r.title)}</a></div>
    <div class="meta">${r.op ? `<span class="chip">${esc(r.op)}</span>` : ""}${ch}${r.upside != null ? `<span>상승여력 <b class="num ${cls(r.upside)}">${fmtPct(r.upside, 1)}</b></span>` : ""}
      ${r.pdf ? `<a href="${esc(r.pdf)}" target="_blank" rel="noopener">PDF</a>` : ""}</div></li>`;
}

/* ---------------- 관심종목 ---------------- */
function viewWatch(app) {
  app.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:16px">
    <div><div class="kicker">관심종목</div><h2>내가 표시한 종목 한눈에</h2>
      <p class="small muted">종목 차트에서 ☆ 를 누르면 여기 모여요. 투자일지와 같은 계정이고, 관심종목의 네이버 리포트는 리포트 메뉴에 모여요.</p></div>
    <div id="pbar"></div><div id="wbody"><p class="loading">불러오는 중…</p></div></div>`;
  let curStart = null;
  const go = () => curStart && renderWatch(curStart);
  FB.listeners = [go];
  $("#pbar").replaceWith(periodBar(start => { curStart = start; FB.ready.then(go); }));
}
async function renderWatch(start) {
  const el = $("#wbody"); if (!el) return;
  if (!FB.enabled) { el.innerHTML = `<div class="empty">로그인 기능을 불러오지 못했어요. 새로고침해 주세요.</div>`; return; }
  if (!FB.user) { el.innerHTML = `<div class="empty">관심종목을 보려면 <button class="act" onclick="fbLogin()">구글 로그인</button></div>`; return; }
  const allW = Object.keys(FB.watch).filter(t => FB.watch[t].favorite || FB.watch[t].track_reports);
  const groups = [...new Set(allW.map(t => FB.watch[t].group).filter(Boolean))].sort();
  let g = store.get("wgroup", ""); if (g && g !== "_none" && !groups.includes(g)) g = "";
  const ts = allW.filter(t => !g || (g === "_none" ? !FB.watch[t].group : FB.watch[t].group === g));
  if (!allW.length) { el.innerHTML = `<div class="empty">${FB.err ? "읽기 실패: " + esc(FB.err) : "아직 관심종목이 없어요. 종목 차트에서 ☆ 를 눌러 추가하세요."}</div>`; return; }
  const all = S.stocks.map(s => s.t);
  const [pd, rdd, p1] = await Promise.all([periodData(start, all), recentDD(ts), loadRange(isoMinus(S.meta.asof, 10))]);
  const secT = {}; S.stocks.forEach(s => (secT[s.s] ||= []).push(s.t));
  const secIdx = {};
  const rows = ts.map(t => {
    const s = S.byT[t], w = FB.watch[t], x = pd.s[t], q = rdd[t] || {};
    const raw = ffill(p1.series(t)), d1 = raw.length > 1 && raw.at(-2) ? (raw.at(-1) / raw.at(-2) - 1) * 100 : null;
    if (!s || !x) return { id: t, n: w.name || t, s: s?.s || "수집 전", miss: true, fav: w.favorite, trk: w.track_reports, grp: w.group };
    const v = ffill(x.v), ret = (v.at(-1) - 1) * 100;
    const si = secIdx[s.s] ||= capIndex(pd, secT[s.s]);
    return { id: t, n: s.n, s: s.s, d1, ret, vs: si ? ret - (si.at(-1) - 1) * 100 : null, mdd: ddStats(v, pd.d).mdd,
      m20: q.mdd20, m60: q.mdd60, cur: q.cur60, p: x.last, fav: w.favorite, trk: w.track_reports, grp: w.group };
  });
  destroyCharts();
  el.innerHTML = `<div class="tabs" id="wg" style="margin-bottom:10px">${[["", `전체 ${allW.length}`], ...groups.map(x => [x, `${x} ${allW.filter(t => FB.watch[t].group === x).length}`]), ["_none", "그룹 없음"]]
      .map(([k, l]) => `<button data-k="${esc(k)}" class="${k === g ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
    <div class="chart" style="margin-bottom:14px"><h3>비교 <small>기준일 ${pd.baseDate} = 100 · 범례를 누르면 켜고 꺼요</small></h3><div id="wc"></div></div>
    <datalist id="grplist">${groups.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
    <div id="wt"></div><p class="small muted" style="margin-top:8px">그룹 칸에 이름을 쓰면 묶여요 (예: 반도체, 장기보유). 현재 낙폭은 최근 60거래일 고점 대비. '수집 전' 종목은 집 PC가 다음 업데이트 때 가격을 받아와요.</p>`;
  tabsBind("#wg", k => { store.set("wgroup", k); renderWatch(start); });
  const live = rows.filter(r => !r.miss).sort((x, y) => (y.ret ?? -1e9) - (x.ret ?? -1e9)).slice(0, 16);
  if (live.length) lineChart($("#wc"), pd.d, live.map((r, i) => ({ label: r.n, data: ffill(pd.s[r.id].v).map(x => x == null ? null : x * 100),
    color: `hsl(${(i * 137.5) % 360} 55% ${isDark() ? 65 : 42}%)`, width: 1.6 })), { ref: 100, height: 280 });
  else $("#wc").innerHTML = `<p class="small muted">이 그룹엔 가격이 있는 종목이 없어요</p>`;
  $("#wt").addEventListener("change", async e => { const inp = e.target.closest("input.grp"); if (!inp) return;
    const t = inp.dataset.t, val = inp.value.trim();
    try { await FB.F.setDoc(FB.F.doc(FB.db, "watchlist", t), { group: val }, { merge: true }); FB.watch[t] = { ...FB.watch[t], group: val }; renderWatch(start); }
    catch (err) { inp.style.borderColor = "var(--up)"; inp.title = "저장 실패: " + err.message; } });
  sortableTable($("#wt"), [
    { k: "n", l: "종목", f: r => `<td class="name">${r.fav ? "★ " : ""}${esc(r.n)}<small>${r.id} · ${esc(r.s)}</small></td>` },
    { k: "grp", l: "그룹", f: r => `<td><input class="grp" list="grplist" data-t="${r.id}" value="${esc(r.grp || "")}" placeholder="–" onclick="event.stopPropagation()" aria-label="그룹"></td>` },
    { k: "p", l: "현재가", f: r => `<td>${fmtNum(r.p)}</td>` },
    { k: "d1", l: "오늘", f: r => pctCell(r.d1, 8) },
    { k: "ret", l: "기간 수익률", f: r => pctCell(r.ret, 40) },
    { k: "vs", l: "섹터 대비", f: r => pctCell(r.vs, 30) },
    { k: "mdd", l: "기간 MDD", f: r => `<td class="down">${fmtPct(r.mdd)}</td>` },
    { k: "m20", l: "20일 MDD", f: r => `<td class="down">${fmtPct(r.m20)}</td>` },
    { k: "m60", l: "60일 MDD", f: r => `<td class="down">${fmtPct(r.m60)}</td>` },
    { k: "cur", l: "현재 낙폭", f: r => `<td class="${r.cur < -0.005 ? "down" : ""}">${fmtPct(r.cur)}</td>` },
  ], rows, { key: "ret", onRow: r => !r.miss && openStock(r.id) });
}

/* ---------------- 스크리너 ---------------- */
const SF = [["cap", "시총(억)"], ["val", "거래대금(억)"], ["d1", "오늘 %"], ["w1", "1주 %"], ["m1", "1개월 %"], ["m3", "3개월 %"], ["ytd", "YTD %"],
  ["dHi", "52주 고점 대비 %"], ["mdd20", "20일 MDD %"], ["vs1m", "섹터 대비 1개월 %p"], ["vr", "거래량 배수"], ["over", "매물대 위 비중 %"],
  ["per", "PER (배)"], ["pbr", "PBR (배)"], ["div", "배당수익률 %"], ["roe", "ROE % (PBR÷PER)"], ["mom12", "12-1개월 모멘텀 %"], ["sd", "변동성 % (연환산)"],
  ["fAll", "멀티팩터 점수 (0~100)"], ["fV", "밸류 점수"], ["fM", "모멘텀 점수"], ["fQ", "퀄리티 점수"], ["fL", "저변동 점수"]];
const SB = [["a20", "20일선 위"], ["a60", "60일선 위"], ["a200", "200일선 위"], ["align", "정배열(20>60>120)"]];
const SPRESET = [
  ["신고가 근처", { dHi: { min: -3 }, val: { min: 30 } }],
  ["거래량 급증", { vr: { min: 3 }, val: { min: 50 }, d1: { min: 0 } }],
  ["강한 종목 눌림목", { m3: { min: 20 }, dHi: { min: -25, max: -8 }, cap: { min: 1000 }, a60: true }],
  ["낙폭과대", { mdd20: { max: -25 }, cap: { min: 1000 } }],
  ["매물 가벼움", { over: { max: 10 }, cap: { min: 1000 }, a20: true }],
  ["정배열 + 섹터보다 강함", { align: true, vs1m: { min: 5 }, cap: { min: 1000 } }],
  ["저PBR 고배당", { pbr: { min: 0.01, max: 1 }, div: { min: 3 }, cap: { min: 1000 } }],
  ["저PER 성장", { per: { min: 0.01, max: 12 }, m3: { min: 10 }, cap: { min: 1000 } }],
  ["퀀트: 멀티팩터 상위", { fAll: { min: 75 }, cap: { min: 1000 } }],
  ["퀀트: 밸류+모멘텀", { fV: { min: 70 }, fM: { min: 70 }, cap: { min: 1000 } }],
  ["퀀트: 싸고 돈 잘 버는 (마법공식형)", { fV: { min: 70 }, fQ: { min: 70 }, cap: { min: 1000 } }],
  ["퀀트: 저변동 우량", { fL: { min: 80 }, fQ: { min: 60 }, cap: { min: 3000 } }],
];
function viewScreen(app) {
  const f = store.get("screen", { cap: { min: 1000 } });
  app.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px">
    <div><div class="kicker">스크리너</div><h2>조건으로 전 종목 거르기</h2>
      <p class="small muted">${S.stocks.length.toLocaleString()}종목, ${S.meta.asof} 종가 기준. 칸을 비우면 조건 없음.</p></div>
    <div class="tabs" id="spre">${SPRESET.map(([l], i) => `<button data-k="${i}">${l}</button>`).join("")}<button data-k="reset">초기화</button></div>
    <div class="sform">
      ${SF.map(([k, l]) => `<label><span>${l}</span><input type="number" step="any" data-k="${k}" data-m="min" placeholder="최소" value="${f[k]?.min ?? ""}"><input type="number" step="any" data-k="${k}" data-m="max" placeholder="최대" value="${f[k]?.max ?? ""}"></label>`).join("")}
      <div class="chk">${SB.map(([k, l]) => `<label><input type="checkbox" data-b="${k}" ${f[k] ? "checked" : ""}> ${l}</label>`).join("")}</div>
      <div class="chk"><select id="smk" aria-label="시장">${[["ALL", "코스피+코스닥"], ["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]].map(([k, l]) => `<option value="${k}" ${k === (f.mk || "ALL") ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select id="ssec" aria-label="섹터"><option value="">전체 섹터</option>${[...new Set(S.stocks.map(s => s.s))].sort().map(x => `<option ${x === f.sec ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
        <input id="sq" placeholder="이름 포함" value="${esc(f.q || "")}" style="max-width:140px"></div>
    </div>
    <div id="sres"><p class="loading">전 종목 계산 중…</p></div></div>`;
  const read = () => { const o = {}; app.querySelectorAll(".sform input[type=number]").forEach(i => { if (i.value !== "") (o[i.dataset.k] ||= {})[i.dataset.m] = +i.value; });
    app.querySelectorAll(".sform input[type=checkbox]").forEach(i => { if (i.checked) o[i.dataset.b] = true; });
    o.mk = $("#smk").value; o.sec = $("#ssec").value; o.q = $("#sq").value.trim(); return o; };
  const write = o => { app.querySelectorAll(".sform input[type=number]").forEach(i => i.value = o[i.dataset.k]?.[i.dataset.m] ?? "");
    app.querySelectorAll(".sform input[type=checkbox]").forEach(i => i.checked = !!o[i.dataset.b]); $("#smk").value = o.mk || "ALL"; $("#ssec").value = o.sec || ""; $("#sq").value = o.q || ""; };
  let tm; const go = () => { clearTimeout(tm); tm = setTimeout(() => { const o = read(); store.set("screen", o); renderScreen(o); }, 200); };
  app.querySelector(".sform").addEventListener("input", go); app.querySelector(".sform").addEventListener("change", go);
  $("#spre").querySelectorAll("button").forEach(b => b.onclick = () => { write(b.dataset.k === "reset" ? {} : SPRESET[+b.dataset.k][1]); go(); });
  renderScreen(f);
}
const fCell = v => `<td style="color:${v == null ? "var(--faint)" : v >= 80 ? "var(--up)" : v <= 20 ? "var(--down)" : "var(--sub)"}">${v ?? "–"}</td>`;
async function renderScreen(f) {
  const U = await universe();
  if (f.over) { if (!U.overDone) { $("#sres") && ($("#sres").innerHTML = `<p class="loading">매물대 계산 중…</p>`); await overhead(U); U.overDone = true; } }
  const el = $("#sres"); if (!el) return;
  const q = (f.q || "").toLowerCase();
  const ok = r => SF.every(([k]) => { const c = f[k]; if (!c) return true; const v = r[k]; if (v == null) return false; return (c.min == null || v >= c.min) && (c.max == null || v <= c.max); })
    && SB.every(([k]) => !f[k] || r[k] === true) && (!f.mk || f.mk === "ALL" || r.m === f.mk) && (!f.sec || r.s === f.sec) && (!q || r.n.toLowerCase().includes(q));
  const qk = f.fAll || f.fV || f.fM || f.fQ || f.fL, sk0 = qk ? "fAll" : "val";
  const hit = U.rows.filter(ok), shown = hit.sort((x, y) => (y[sk0] ?? -1) - (x[sk0] ?? -1)).slice(0, 400);
  el.innerHTML = `<p class="small" style="margin:0 0 6px"><b>${hit.length.toLocaleString()}</b>종목${hit.length > 400 ? (qk ? " · 멀티팩터 상위 400개만 표시" : " · 거래대금 상위 400개만 표시") : ""} · 행을 누르면 종목 차트 · 표가 넘치면 옆으로 밀어서 PER·PBR·시총 보기</p><div id="stab"></div>`;
  sortableTable($("#stab"), [
    { k: "n", l: "종목", f: r => `<td class="name">${star(r.t)}${esc(r.n)}<small>${r.t} · ${esc(r.s.replace("코스닥 ", "코스닥·"))}</small></td>` },
    { k: "p", l: "현재가", f: r => `<td>${fmtNum(r.p)}</td>` },
    { k: "d1", l: "오늘", f: r => pctCell(r.d1, 8) },
    { k: "m1", l: "1개월", f: r => pctCell(r.m1, 30) },
    { k: "ytd", l: "YTD", f: r => pctCell(r.ytd, 60) },
    { k: "dHi", l: "52주고점 대비", f: r => `<td class="${r.dHi > -3 ? "up" : ""}">${fmtPct(r.dHi, 1)}</td>` },
    { k: "mdd20", l: "20일MDD", f: r => `<td class="down">${fmtPct(r.mdd20, 1)}</td>` },
    { k: "vr", l: "거래량배수", f: r => `<td class="${r.vr >= 3 ? "up" : ""}">${r.vr == null ? "–" : r.vr.toFixed(1) + "x"}</td>` },
    { k: "val", l: "거래대금(억)", f: r => `<td>${fmtNum(r.val)}</td>` },
    ...(U.overDone ? [{ k: "over", l: "매물대위", f: r => `<td>${r.over == null ? "–" : r.over.toFixed(0) + "%"}</td>` }] : []),
    { k: "per", l: "PER", f: r => `<td>${r.per ? r.per.toFixed(1) : "–"}</td>` },
    { k: "pbr", l: "PBR", f: r => `<td>${r.pbr ? r.pbr.toFixed(2) : "–"}</td>` },
    { k: "div", l: "배당%", f: r => `<td>${r.div ? r.div.toFixed(1) : "–"}</td>` },
    { k: "fAll", l: "멀티팩터", f: r => `<td class="${r.fAll >= 75 ? "up" : ""}" title="밸류 ${r.fV ?? "–"} · 모멘텀 ${r.fM ?? "–"} · 퀄리티 ${r.fQ ?? "–"} · 저변동 ${r.fL ?? "–"}">${r.fAll ?? "–"}</td>` },
    { k: "fV", l: "V", f: r => fCell(r.fV) }, { k: "fM", l: "M", f: r => fCell(r.fM) }, { k: "fQ", l: "Q", f: r => fCell(r.fQ) }, { k: "fL", l: "L", f: r => fCell(r.fL) },
    { k: "cap", l: "시총(억)", f: r => `<td>${fmtNum(r.cap)}</td>` },
  ], shown, { key: sk0, onRow: r => openStock(r.t) });
}

/* ---------------- 리포트 ---------------- */
/* ---------------- 목표가 레이더 (리포트 목표가 변화로 보는 신호) ----------------
   - 컨센 목표가: 증권사별 '가장 최근' 목표가의 평균 (180일 넘은 건 뺌)
   - 리비전: 같은 증권사의 직전 목표가 대비 상향/하향 건수 → 점수 = (상향-하향)/(상향+하향)
   - 연구 결과 요약: 목표가·이익추정 '상향 흐름'은 이후 주가에 이어지는 경향(리비전 모멘텀),
     괴리율(목표가/현재가)만으로는 신호가 약함(목표가는 늘 높게 나오는 편향) */
const TP_STALE = 180;
function consensusAt(list, day) {
  const last = new Map(), cut = isoMinus(day, TP_STALE);
  for (const r of list) { if (!r.tp || r.date > day) continue; const k = r.broker || r.nid, o = last.get(k); if (!o || r.date >= o.date) last.set(k, r); }
  const v = [...last.values()].filter(r => r.date >= cut).map(r => r.tp);
  return v.length ? { v: v.reduce((a, b) => a + b, 0) / v.length, n: v.length, hi: Math.max(...v), lo: Math.min(...v) } : null;
}
function tpStats(list, asof, price) {
  const now = consensusAt(list, asof), m1 = consensusAt(list, isoMinus(asof, 30)), m3 = consensusAt(list, isoMinus(asof, 91));
  const recent = list.filter(r => r.date >= isoMinus(asof, 91) && r.tp && r.prev_tp);
  const up = recent.filter(r => r.tp > r.prev_tp).length, dn = recent.filter(r => r.tp < r.prev_tp).length;
  const score = up + dn ? (up - dn) / (up + dn) : null;
  const c1 = now && m1 ? (now.v / m1.v - 1) * 100 : null, c3 = now && m3 ? (now.v / m3.v - 1) * 100 : null;
  const gap = now && price ? (now.v / price - 1) * 100 : null;
  const sig = c1 == null && score == null ? ["", "자료 부족"] : (c1 ?? 0) > 0 && (score ?? 0) >= 0.3 ? ["up", "상향 흐름"] : (c1 ?? 0) < 0 && (score ?? 0) <= -0.3 ? ["down", "하향 흐름"] : ["", "보합"];
  return { now, c1, c3, up, dn, score, gap, sig, n90: list.filter(r => r.date >= isoMinus(asof, 91)).length };
}
async function tpRadar(box, reps, ws, pickT) {
  const U = await universe(), asof = S.meta.asof;
  const rows = ws.map(t => ({ t, n: S.byT[t]?.n || FB.watch[t]?.name || t, ...tpStats(reps.filter(r => r.t === t), asof, U.byT[t]?.p) }))
    .sort((a, b) => (b.score ?? -9) - (a.score ?? -9) || (b.c1 ?? -99) - (a.c1 ?? -99));
  box.innerHTML = `<section class="block"><div class="kicker">목표가 레이더</div>
    <h3 style="margin:2px 0 4px">증권사 목표가가 올라가는 중인가 내려가는 중인가</h3>
    <p class="small muted" style="margin:0 0 8px">컨센 목표가 = 증권사별 최근 목표가 평균(${TP_STALE}일 이내). 상향·하향 = 최근 3개월 리포트가 같은 증권사 직전 목표가보다 올렸는지·내렸는지.
      목표가가 계속 <b>올라가는 흐름</b>은 그 뒤 주가에도 이어지는 경향이 알려져 있고, 괴리율(목표가가 현재가보다 얼마나 높은지)만으로는 신호가 약해요(목표가는 원래 높게 나오는 편).</p>
    <div class="tablewrap"><table><thead><tr><th>종목</th><th>신호</th><th>컨센 목표가</th><th>1개월 변화</th><th>3개월 변화</th><th>상향/하향(3개월)</th><th>수정 점수</th><th>괴리율</th><th>리포트(3개월)</th></tr></thead><tbody>
    ${rows.map(r => `<tr data-t="${r.t}" style="cursor:pointer"><td class="name">${esc(r.n)}</td>
      <td><span class="chip ${r.sig[0]}">${r.sig[1]}</span></td>
      <td>${r.now ? fmtNum(Math.round(r.now.v)) + ` <small class="muted">${r.now.n}곳</small>` : "–"}</td>
      <td class="${cls(r.c1)}">${fmtPct(r.c1, 1)}</td><td class="${cls(r.c3)}">${fmtPct(r.c3, 1)}</td>
      <td><span class="up">${r.up}</span> / <span class="down">${r.dn}</span></td>
      <td class="${cls(r.score)}">${r.score == null ? "–" : (r.score > 0 ? "+" : "") + r.score.toFixed(2)}</td>
      <td class="${cls(r.gap)}">${fmtPct(r.gap, 1)}</td><td>${r.n90}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">관심종목 리포트가 아직 없어요</td></tr>`}
    </tbody></table></div>
    <div id="tpc" style="margin-top:12px"></div></section>`;
  const draw = t => {
    box.querySelectorAll("tr[data-t]").forEach(tr => tr.classList.toggle("sel", tr.dataset.t === t));
    const list = reps.filter(r => r.t === t), c = U.C[t], el = box.querySelector("#tpc"); if (!el) return;
    if (!c || !list.some(r => r.tp)) { el.innerHTML = `<p class="small muted">${esc(S.byT[t]?.n || t)}: 목표가가 있는 리포트가 없어요</p>`; return; }
    const i0 = Math.max(0, U.D.findIndex(d => d >= isoMinus(asof, 365))), D = U.D.slice(i0);
    const cons = D.map(d => consensusAt(list, d)?.v ?? null);
    el.innerHTML = `<div class="small" style="margin-bottom:4px"><b>${esc(S.byT[t]?.n || t)}</b> 주가와 컨센 목표가 (최근 1년) <span class="muted">· 표에서 종목을 누르면 바뀜</span></div><div id="tpcc"></div>`;
    S.charts.push(lineChart(el.querySelector("#tpcc"), D, [
      { label: "주가", data: c.slice(i0), color: css("--ink") },
      { label: "컨센 목표가", data: cons, color: css("--up"), dash: [5, 3] }], { height: 240, won: true,
    }));
  };
  box.querySelectorAll("tr[data-t]").forEach(tr => tr.onclick = () => { pickT?.(tr.dataset.t); draw(tr.dataset.t); });
  if (rows.length) draw(rows[0].t);
  return draw;
}

/* ---------------- [지금 리포트 받기] → GitHub Actions(reports.yml) → Firebase ---------------- */
const GH_REPO = (() => { const h = location.hostname.match(/^([\w-]+)\.github\.io$/); return h ? h[1] + "/" + location.pathname.split("/")[1] : null; })();  // 사이트 주소에서 저장소 이름을 앎
async function reloadReports() {
  const r = await FB.F.getDoc(FB.F.doc(FB.db, "state", "reports"));
  if (r.exists()) { const x = r.data(); S.reports = prepReports(JSON.parse(x.json || "[]")); S.reportsInfo = x.updated; }
}
async function fetchReportsNow(btn, msg, done) {
  const F = FB.F, say = (t, c = "") => { msg.innerHTML = t; msg.className = "small " + c; };
  if (!GH_REPO) { say("이 기능은 실제 사이트 주소에서만 돼요.", "down"); return; }
  let tok = null;
  try { const g = await F.getDoc(F.doc(FB.db, "state", "gh")); tok = g.exists() ? g.data().token : null; } catch {}
  if (!tok) { ghSetup(msg, () => fetchReportsNow(btn, msg, done)); return; }
  btn.disabled = true; say("요청 보내는 중…");
  const t0 = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/reports.yml/dispatches`, { method: "POST",
      headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json" }, body: JSON.stringify({ ref: "main" }) });
    if (r.status === 401 || r.status === 403 || r.status === 404) { btn.disabled = false; say(`GitHub 토큰이 안 맞아요 (${r.status}). 다시 넣어 주세요.`, "down"); ghSetup(msg, () => fetchReportsNow(btn, msg, done), true); return; }
    if (!r.ok) throw new Error(r.status + " " + (await r.text()).slice(0, 120));
  } catch (e) { btn.disabled = false; say("요청 실패: " + esc(e.message), "down"); return; }
  say("네이버에서 받는 중… 보통 1~2분 (창 닫아도 계속 진행돼요)");
  const start = Date.now();
  const poll = async () => {
    if (!document.body.contains(btn)) return;
    try { const j = await F.getDoc(F.doc(FB.db, "state", "report_job")), x = j.exists() ? j.data() : {};
      if (x.at >= t0 && x.state === "done") { await reloadReports(); btn.disabled = false; say(`완료 · 새 리포트 ${x.new ?? 0}건`, "up"); done(); return; }
      if (x.at >= t0 && x.state === "error") { btn.disabled = false; say("받기 실패: " + esc(x.msg || ""), "down"); return; }
    } catch {}
    if (Date.now() - start > 8 * 60e3) { btn.disabled = false; say(`오래 걸리네요. <a href="https://github.com/${GH_REPO}/actions/workflows/reports.yml" target="_blank" rel="noopener">GitHub 진행 상황 보기 ↗</a>`); return; }
    setTimeout(poll, 8000);
  };
  setTimeout(poll, 15000);
}
function ghSetup(msg, then, again = false) {
  msg.className = "small";
  msg.innerHTML = `<div class="ghsetup"><b>${again ? "토큰 다시 넣기" : "처음 한 번만: GitHub 토큰 넣기"}</b>
    <ol><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 토큰 만들기 ↗</a> → Repository access: <b>Only select → ${GH_REPO}</b></li>
    <li>Permissions → Repository → <b>Actions: Read and write</b> → Generate → 복사</li>
    <li>아래에 붙여넣고 저장 (내 Firebase 에만 저장돼서 로그인한 나만 읽을 수 있어요)</li></ol>
    <input id="ghtok" type="password" placeholder="github_pat_..." style="width:260px"> <button class="act" id="ghsave">저장하고 받기</button></div>`;
  msg.querySelector("#ghsave").onclick = async () => { const v = msg.querySelector("#ghtok").value.trim(); if (!v) return;
    try { await FB.F.setDoc(FB.F.doc(FB.db, "state", "gh"), { token: v }); then(); } catch (e) { alert("저장 실패: " + e.message); } };
}

function viewReports(app) {
  app.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-width:820px">
    <div><div class="kicker">리포트</div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h2 id="rh" style="margin:0">관심종목 리포트</h2>
      <button class="act" id="rget" hidden>⟳ 지금 리포트 받기</button></div><div id="rmsg" class="small muted"></div>
      <p class="small muted" style="margin:4px 0 0">관심종목(☆)의 네이버 증권 리서치를 보여줘요. 로그인한 본인만 볼 수 있어요. <span id="rsrc"></span></p></div>
    <div id="rlinks" class="nvlinks"></div>
    <div id="tpr"></div>
    <div id="rfw"></div><ul class="feed" id="rl"><li class="muted small">불러오는 중…</li></ul></div>`;
  const render = async () => {
    const ws = Object.keys(FB.watch).filter(inWatch), reps = FB.user ? await reportsFor(ws) : [], names = [...new Set(ws.map(t => S.byT[t]?.n || FB.watch[t].name || t))].sort();
    if (!$("#rl")) return;
    $("#rsrc").textContent = !FB.user ? "" : "아래 목록: " + (S.reportsInfo ? `마지막으로 받은 시각 ${S.reportsInfo} (평일 하루 5번 자동 · 위 버튼으로 바로 받기)` : "아직 받은 목록 없음 · 위 [지금 리포트 받기]");
    $("#rlinks").innerHTML = FB.user && ws.length ? `<span class="small muted">네이버 리서치 바로가기</span> ` + ws.map(t =>
      `<a class="act" href="https://m.stock.naver.com/domestic/stock/${t}/research" target="_blank" rel="noopener">${esc(S.byT[t]?.n || FB.watch[t].name || t)} ↗</a>`).join("") : "";
    const gb = $("#rget"); gb.hidden = !FB.user;
    gb.onclick = () => fetchReportsNow(gb, $("#rmsg"), render);
    if (!FB.user) { $("#rfw").innerHTML = ""; $("#tpr").innerHTML = ""; $("#rh").textContent = "관심종목 리포트"; return reportGate($("#rl"), []); }
    $("#rh").textContent = `관심종목 리포트 ${reps.length}건`;
    $("#rfw").innerHTML = `<select id="rf" aria-label="종목"><option value="">전체 종목</option>${names.map(n => `<option>${esc(n)}</option>`).join("")}</select>
      <a class="small" id="rnv" target="_blank" rel="noopener" style="margin-left:8px" hidden>네이버에서 이 종목 리포트 전체 ↗</a>`;
    const draw = () => { const f = $("#rf").value, t = ws.find(x => (S.byT[x]?.n || FB.watch[x].name) === f);
      $("#rnv").hidden = !t; if (t) $("#rnv").href = `https://m.stock.naver.com/domestic/stock/${t}/research`;
      reportGate($("#rl"), reps.filter(r => !f || r.n === f), ws.length ? "관심종목 리포트가 아직 없어요." : "관심종목이 없어요. 종목 차트에서 ☆ 를 눌러 추가하세요."); };
    $("#rf").onchange = draw; draw();
    destroyCharts();
    await tpRadar($("#tpr"), reps, ws, t => { const n = S.byT[t]?.n || FB.watch[t]?.name; if ($("#rf") && n) { $("#rf").value = n; draw(); } });
  };
  FB.listeners = [render]; FB.ready.then(render);
}
