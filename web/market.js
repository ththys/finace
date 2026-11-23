"use strict";
/* 시장 화면: 홈 · 섹터(로테이션 맵) · 수급/파생/매크로 */

/* ---------------- 홈 ---------------- */
function viewHome(app) {
  const h = S.home, m = h.market;
  app.innerHTML = `
  <div class="grid">
    <div class="block" style="display:grid;grid-template-columns:minmax(0,1fr);gap:26px;align-content:start">
      <section class="block brief">
        <div class="kicker">마감 브리핑 · ${h.asof}</div>
        <h2>${esc(h.brief[0])}</h2>
        <ul>${h.brief.slice(1).map(b => `<li>${esc(b)}</li>`).join("")}</ul>
      </section>
      <section class="block">
        <div style="display:flex;justify-content:space-between;align-items:end;gap:8px;flex-wrap:wrap">
          <div><div class="kicker">지수 추세</div><h2>코스피·코스닥 지수와 추세 밴드</h2></div>
          <span style="display:flex;gap:6px;flex-wrap:wrap"><span class="tabs" id="ixm">${[["IDX_KOSPI", "코스피"], ["IDX_KOSDAQ", "코스닥"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("ixm", "IDX_KOSPI") ? "on" : ""}">${l}</button>`).join("")}</span>
          <span class="tabs" id="ixr">${[[1, "1년"], [3, "3년"], [5, "5년"], [10, "10년"], [60, "전체"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("ixr", 3) ? "on" : ""}">${l}</button>`).join("")}</span></span></div>
        <div id="idxbox"><p class="loading">불러오는 중…</p></div>
      </section>
      <section class="block">
        <div style="display:flex;justify-content:space-between;align-items:end;gap:8px;flex-wrap:wrap">
          <div><div class="kicker">연속 등락 통계</div><h2>며칠째 빠지는(오르는) 중이고, 과거엔 그다음 어땠나</h2></div>
          <span class="tabs" id="stkm">${[["IDX_KOSPI", "코스피"], ["IDX_KOSDAQ", "코스닥"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("stkm", "IDX_KOSPI") ? "on" : ""}">${l}</button>`).join("")}</span></div>
        <div id="streak"><p class="loading">불러오는 중…</p></div>
      </section>
      <section class="block">
        <div style="display:flex;justify-content:space-between;align-items:end;gap:8px;flex-wrap:wrap">
          <div><div class="kicker">시장 체력</div><h2>지수 말고 종목들은?</h2></div>
          <span class="tabs" id="brmk">${[["ALL", "전체"], ["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("brmk", "ALL") ? "on" : ""}">${l}</button>`).join("")}</span></div>
        <div id="breadth"><p class="loading">전 종목 계산 중…</p></div>
      </section>
      <section class="block">
        <div style="display:flex;justify-content:space-between;align-items:end;gap:8px;flex-wrap:wrap">
          <div><div class="kicker">섹터 지도</div><h2>섹터별 수익률</h2></div>
          <span class="tabs" id="secmk">${[["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("secmk", "KOSPI") ? "on" : ""}">${l}</button>`).join("")}</span></div>
        <div class="collapse" id="secbox"><div id="sectbl"></div></div>
        <button class="more" id="secmore">전체 펼치기</button>
      </section>
    </div>
    <aside style="display:grid;grid-template-columns:minmax(0,1fr);gap:26px;align-content:start">
      <section class="block" id="evbox"><div class="kicker">다가오는 일정</div><div id="evlist"><p class="loading">불러오는 중…</p></div></section>
      <section class="block" id="lnalert" style="display:none"></section>
      <section class="block">
        <div class="kicker">등락률 · 거래대금 상위</div>
        <div class="tabs" id="mvtabs">${[["up1d", "오늘 상승"], ["down1d", "오늘 하락"], ["val", "거래대금"], ["upytd", "YTD 상승"], ["downytd", "YTD 하락"]]
          .map(([k, l]) => `<button data-k="${k}" class="${k === store.get("mvk", "up1d") ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="filters"><select id="mvmk" aria-label="시장">${[["ALL", "코스피+코스닥"], ["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]].map(([k, l]) => `<option value="${k}" ${k === store.get("mvmk", "ALL") ? "selected" : ""}>${l}</option>`).join("")}</select>
          <select id="mvcap" aria-label="시총">${CAPF.map(([k, l]) => `<option value="${k}" ${k === store.get("mvcap", 1000) ? "selected" : ""}>시총 ${l}</option>`).join("")}</select></div>
        <ol class="rank" id="rank"><li class="muted small">불러오는 중…</li></ol>
      </section>
      <section class="block">
        <div style="display:flex;justify-content:space-between;align-items:end"><div class="kicker">관심종목 리포트</div>
          <a class="small" href="#reports">전체 보기</a></div>
        <ul class="feed" id="hrep"><li class="muted small">불러오는 중…</li></ul>
      </section>
    </aside>
  </div>`;
  // 내가 그린 선 알림: 오늘 종가가 선을 넘었거나(돌파·이탈) 2% 안으로 다가온 종목
  const drawAlerts = async () => { DRAW.all = null; const all = await drawingsAll(), U = await universe(), box = $("#lnalert"); if (!box) return;
    const hits = [];
    for (const [t, d] of Object.entries(all)) { const r = U.byT[t]; if (!r || !d?.h?.length || r.p == null) continue; const pv = r.d1 != null ? r.p / (1 + r.d1 / 100) : null;
      d.h.forEach(hl => { const L = hl.p, gap = (r.p / L - 1) * 100;
        const kind = pv != null && pv < L && r.p >= L ? ["up", "돌파 ▲"] : pv != null && pv > L && r.p <= L ? ["down", "이탈 ▼"] : Math.abs(gap) <= 2 ? ["", "근접"] : null;
        if (kind) hits.push({ t, n: r.n, L, p: r.p, gap, kind }); }); }
    box.style.display = hits.length ? "" : "none";
    box.innerHTML = `<div class="kicker">내 선 알림 · ${S.meta.asof} 종가</div>
      <ul class="feed">${hits.sort((a, b) => (a.kind[1] === "근접") - (b.kind[1] === "근접") || Math.abs(a.gap) - Math.abs(b.gap)).map(x =>
        `<li><div class="meta"><a href="#" onclick="openStock('${x.t}');return false"><b>${esc(x.n)}</b></a> <span class="chip ${x.kind[0]}">${x.kind[1]}</span></div>
         <div class="small">내 선 ${fmtNum(x.L)} · 종가 ${fmtNum(x.p)} <span class="${cls(x.gap)}">(${fmtPct(x.gap, 1)})</span></div></li>`).join("")}</ul>`; };
  FB.listeners.push(drawAlerts); FB.ready.then(drawAlerts);
  // 섹터 지도 (코스피/코스닥 탭, 접기)
  const drawSec = () => {
    const mk = store.get("secmk", "KOSPI"), rows = h.sectors.filter(r => isKQsec(r.s) === (mk === "KOSDAQ")).map(r => ({ ...r, id: r.s }));
    sortableTable($("#sectbl"), [
      { k: "s", l: "섹터", f: r => `<td class="name">${esc(r.s.replace("코스닥 ", ""))}<small>${r.k}</small></td>` },
      { k: "1D", l: "오늘", f: r => pctCell(r["1D"], 4) },
      { k: "1W", l: "1주", f: r => pctCell(r["1W"], 8) },
      { k: "1M", l: "1개월", f: r => pctCell(r["1M"], 15) },
      { k: "YTD", l: "YTD", f: r => pctCell(r.YTD, 40) },
      { k: "rs20", l: "RS 20일", f: r => `<td class="${cls(r.rs20)}">${r.rs20 == null ? "–" : (r.rs20 > 0 ? "+" : "") + r.rs20.toFixed(1)}</td>` },
    ], rows, { key: "1D", onRow: r => { store.set("sector", r.s); location.hash = "sectors"; } });
    $("#secmore").textContent = $("#secbox").classList.contains("open") ? "접기" : `전체 ${rows.length}개 펼치기`;
    $("#secmore").hidden = rows.length <= 12;
  };
  $("#secmore").onclick = () => { $("#secbox").classList.toggle("open"); drawSec(); };
  tabsBind("#secmk", k => { store.set("secmk", k); drawSec(); });
  drawSec();
  // 등락·거래대금 (전 종목에서 바로 계산)
  const drawRank = async () => {
    const U = await universe(); if (!$("#rank")) return;
    const k = store.get("mvk", "up1d"), mk = store.get("mvmk", "ALL"), cap = +store.get("mvcap", 1000);
    const f = { up1d: ["d1", -1], down1d: ["d1", 1], val: ["val", -1], upytd: ["ytd", -1], downytd: ["ytd", 1] }[k];
    const rows = U.rows.filter(r => r[f[0]] != null && r.cap >= cap && (mk === "ALL" || r.m === mk)).sort((x, y) => (x[f[0]] - y[f[0]]) * -f[1] * -1).slice(0, 15);
    const metric = r => k === "val" ? r.d1 : r[f[0]], mx = Math.max(...rows.map(r => Math.abs(k === "val" ? r.val : metric(r))), 1);
    $("#rank").innerHTML = rows.map((r, i) => `<li data-t="${r.t}"><span class="i">${i + 1}</span>
      <span class="nm">${star(r.t)}${esc(r.n)}<small>${esc(r.s.replace("코스닥 ", "코스닥·"))}</small></span>
      <span class="num ${cls(metric(r))}">${k === "val" ? `${fmtNum(r.val)}억 <small class="${cls(r.d1)}">${fmtPct(r.d1, 1)}</small>` : fmtPct(metric(r), k.endsWith("ytd") ? 1 : 2)}</span>
      <span class="bar" style="width:${(Math.abs(k === "val" ? r.val : metric(r)) / mx * 100).toFixed(0)}%;background:var(${k === "val" ? "--accent" : metric(r) >= 0 ? "--up" : "--down"})"></span></li>`).join("") || `<li class="muted small">조건에 맞는 종목이 없어요</li>`;
    $("#rank").querySelectorAll("li[data-t]").forEach(li => li.onclick = () => openStock(li.dataset.t));
  };
  tabsBind("#mvtabs", k => { store.set("mvk", k); drawRank(); });
  $("#mvmk").onchange = e => { store.set("mvmk", e.target.value); drawRank(); };
  $("#mvcap").onchange = e => { store.set("mvcap", +e.target.value); drawRank(); };
  drawRank();
  // 지수 추세
  tabsBind("#ixm", k => { store.set("ixm", k); drawIndex(); });
  tabsBind("#ixr", k => { store.set("ixr", +k); drawIndex(); });
  drawIndex();
  // 시장 체력
  drawEvents();
  tabsBind("#stkm", k => { store.set("stkm", k); drawStreak(); });
  drawStreak();
  tabsBind("#brmk", k => { store.set("brmk", k); drawBreadth(); });
  drawBreadth();
  const hr = async () => { if (!FB.user) return reportGate($("#hrep"), []);
    const list = await reportsFor(Object.keys(FB.watch).filter(inWatch)); reportGate($("#hrep"), list.slice(0, 8)); };
  FB.listeners.push(hr); FB.ready.then(hr);
}

async function drawIndex() {
  const M = await loadX("macro"), key = store.get("ixm", "IDX_KOSPI"), ser = M?.[key];
  const el = $("#idxbox"); if (!el) return;   // 기다리는 사이 화면이 바뀌었을 수 있어 받은 뒤에 찾음
  destroyIn(el);
  if (!ser) { el.innerHTML = `<div class="empty small">지수 데이터는 집 PC의 다음 업데이트(kospi.bat) 때부터 나와요.</div>`; return; }
  const from = isoMinus(S.meta.asof, Math.round(365.25 * store.get("ixr", 3))), i0 = Math.max(0, ser.d.findIndex(d => d >= from));
  const d = ser.d.slice(i0), v = ser.v.slice(i0), nm = key === "IDX_KOSPI" ? "코스피" : "코스닥";
  el.innerHTML = `<div id="ixbc"></div><div class="chart"><div id="ixc"></div></div>`;
  const bc = bandControls("band_idx", d[0], () => drawIndex()); $("#ixbc", el).replaceChildren(bc.box);
  const B = bc.get(); let bs = { series: [] }, bands = null;
  if (B.on) { const fit = fitBand(ser.d, ser.v, B.from, B.to);
    if (fit) { bs = bandSeries(fit, d, B.from, B.k, v.at(-1), d.at(-1)); bands = [{ series: [2, 4], fill: "rgba(74,125,255,.12)" }]; bc.box.querySelector(".bandinfo").textContent = bs.info; }
    else bc.box.querySelector(".bandinfo").textContent = "시작~끝 사이 데이터가 너무 적어요"; }
  const ui = lineChart($("#ixc", el), d, [{ label: nm, data: v, color: css("--ink"), width: 1.8 }, ...bs.series], { height: 320, won: true, bands, lastTag: v.at(-1) });
  bc.attach(ui, d);
}
async function drawBreadth() {
  const U = await universe(), el = $("#breadth"); if (!el) return;
  destroyIn(el);
  const B = breadthHistory(U, store.get("brmk", "ALL")), j = B.d.length - 1, n20 = j >= 20 ? j - 20 : 0;
  const card = (l, v, s, c = "") => `<div><div class="lbl">${l}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;
  const p = x => x == null ? "–" : x.toFixed(0) + "%", dlt = (x, y) => x == null || y == null ? "" : `20일 전 ${y.toFixed(0)}%`;
  el.innerHTML = `<div class="stats br">
      ${card("20일선 위", p(B.a20[j]), dlt(B.a20[j], B.a20[n20]), B.a20[j] < 30 ? "down" : B.a20[j] > 70 ? "up" : "")}
      ${card("60일선 위", p(B.a60[j]), dlt(B.a60[j], B.a60[n20]), B.a60[j] < 30 ? "down" : B.a60[j] > 70 ? "up" : "")}
      ${card("200일선 위", p(B.a200[j]), dlt(B.a200[j], B.a200[n20]), B.a200[j] < 40 ? "down" : B.a200[j] > 60 ? "up" : "")}
      ${card("52주 신고가 / 신저가", `<span class="up">${B.nh[j]}</span> / <span class="down">${B.nl[j]}</span>`, "최근 5일 " + B.nh.slice(-5).reduce((s, x) => s + x, 0) + " / " + B.nl.slice(-5).reduce((s, x) => s + x, 0))}
      ${card("상한가 / 하한가", `<span class="up">${B.lu[j]}</span> / <span class="down">${B.ld[j]}</span>`, `상승 ${B.up[j]} · 하락 ${B.dn[j]}`)}</div>
    <div class="two" style="margin-top:12px"><div class="chart"><h3>이평선 위 종목 비율 <small>${B.n}종목, %</small></h3><div id="bc1"></div></div>
      <div class="chart"><h3>52주 신고가 − 신저가 <small>종목 수</small></h3><div id="bc2"></div></div></div>`;
  lineChart($("#bc1"), B.d, [{ label: "20일선", data: B.a20, color: css("--faint") }, { label: "60일선", data: B.a60, color: css("--accent"), width: 2 },
    { label: "200일선", data: B.a200, color: css("--ink"), width: 2 }], { height: 200, ref: 50 });
  lineChart($("#bc2"), B.d, [{ label: "신고가", data: B.nh, color: css("--up"), bars: true }, { label: "신저가", data: B.nl.map(x => -x), color: css("--down"), bars: true }],
    { height: 200, ref: 0, compact: true });
}

/* ---------------- 섹터 ---------------- */
function viewSectors(app) {
  app.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:18px">
    <div><div class="kicker">섹터</div><h2>기간별 섹터 성과와 섹터 안 종목</h2></div>
    <section class="block"><div style="display:flex;justify-content:space-between;align-items:end;gap:8px;flex-wrap:wrap">
      <div><div class="kicker">섹터 로테이션 맵</div><h3 style="margin:2px 0 0">시장 대비 강도 × 그 강도의 변화 <small class="muted">최근 5주 궤적, 점을 누르면 그 섹터</small></h3></div>
      <span class="tabs" id="rrgmk">${[["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("rrgmk", "KOSPI") ? "on" : ""}">${l}</button>`).join("")}</span></div>
      <div id="rrg" class="rrg"><p class="loading">계산 중…</p></div></section>
    <div id="pbar"></div>
    <div class="loading" id="ld">불러오는 중…</div>
    <div id="secwrap" hidden style="display:grid;grid-template-columns:minmax(0,1fr);gap:18px">
      <div id="sectbl2"></div>
      <div class="two"><div class="chart"><h3 id="c1t"></h3><div id="c1"></div></div><div class="chart"><h3>고점 대비 낙폭 <small>%</small></h3><div id="c2"></div></div></div>
      <div><h3 id="stt" style="margin-bottom:6px"></h3><div id="stbl"></div></div>
    </div></div>`;
  let cur = null;
  tabsBind("#rrgmk", k => { store.set("rrgmk", k); drawRRG(() => cur && renderSectors(cur)); });
  drawRRG(() => cur && renderSectors(cur));
  $("#pbar").replaceWith(periodBar(start => { cur = start; renderSectors(start); }));
}
/** RRG: RS-Ratio = 상대강도 / 50일 평균 상대강도, RS-Momentum = RS-Ratio 의 10일 변화 */
async function drawRRG(onPick) {
  const U = await universe(), el = $("#rrg"); if (!el) return;
  const mk = store.get("rrgmk", "KOSPI"), L = U.L, b = Math.max(0, L - 110);
  const idx = ts => { let w = 0; const acc = new Float64Array(L - b + 1);
    for (const t of ts) { const c = U.C[t], r = U.byT[t]; if (!c || !r || !c[b] || !c[L]) continue; const wt = r.cap * c[b] / c[L]; w += wt;
      for (let i = b; i <= L; i++) acc[i - b] += (c[i] ?? c[b]) / c[b] * wt; }
    return w ? Array.from(acc, x => x / w) : null; };
  const mt = U.rows.filter(r => r.m === mk).map(r => r.t), mi = idx(mt);
  const groups = {}; U.rows.filter(r => r.m === mk && isKQsec(r.s) === (mk === "KOSDAQ")).forEach(r => (groups[r.s] ||= []).push(r.t));
  const pts = [];
  for (const [sec, ts] of Object.entries(groups)) {
    if (ts.length < 4) continue;
    const si = idx(ts); if (!si) continue;
    const rs = si.map((x, i) => x / mi[i] * 100), N = rs.length;
    const ratio = rs.map((x, i) => { if (i < 49) return null; let s = 0; for (let k = i - 49; k <= i; k++) s += rs[k]; return 100 * x / (s / 50); });
    const mom = ratio.map((x, i) => x != null && ratio[i - 10] != null ? 100 * x / ratio[i - 10] : null);
    const tail = [20, 15, 10, 5, 0].map(k => [ratio[N - 1 - k], mom[N - 1 - k]]).filter(([x, y]) => x != null && y != null);
    if (tail.length) pts.push({ s: sec, k: ts.length, tail });
  }
  if (!pts.length) { el.innerHTML = `<p class="small muted">데이터가 부족해요</p>`; return; }
  // 축 범위는 '지금' 위치 기준 (궤적은 밖으로 나가면 가장자리에 붙임)
  const xs = pts.map(p => p.tail.at(-1)[0]), ys = pts.map(p => p.tail.at(-1)[1]);
  const rx = Math.max(1, ...xs.map(x => Math.abs(x - 100))) * 1.25, ry = Math.max(0.5, ...ys.map(y => Math.abs(y - 100))) * 1.25;
  const W = 680, H = 440, pad = 34;
  const X = x => pad + (x - 100 + rx) / (2 * rx) * (W - 2 * pad), Y = y => H - pad - (y - 100 + ry) / (2 * ry) * (H - 2 * pad);
  const qc = (x, y) => x >= 100 ? (y >= 100 ? "var(--up)" : "#b07d2a") : (y >= 100 ? "var(--accent)" : "var(--down)");
  const sel = store.get("sector", "");
  // 이름표 겹침 피하기: 오른쪽 → 왼쪽 → 위 → 아래 → 조금씩 비켜서, 빈자리에 놓음 (멀어지면 가는 선으로 연결)
  const tw = t => [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 11 : 6.2), 0), boxes = [];
  pts.forEach(p => { const [lx, ly] = p.tail.at(-1); p.px = X(lx); p.py = Y(ly); boxes.push([p.px - 5, p.py - 5, p.px + 5, p.py + 5]); });
  const hit = (a) => boxes.some(b => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
  [...pts].sort((a, b) => a.py - b.py).forEach(p => { const name = p.s.replace("코스닥 ", ""), w = tw(name), h = 13;
    const cand = [];
    for (const d of [0, 12, -12, 24, -24, 36, -36]) cand.push([7, d, "start"], [-7, d, "end"]);
    cand.splice(2, 0, [0, -10, "middle"], [0, 17, "middle"]);
    let best = null;
    for (const [dx, dy, an] of cand) { const x0 = an === "start" ? p.px + dx : an === "end" ? p.px + dx - w : p.px - w / 2, y0 = p.py + dy - 9;
      const bx = [x0 - 1, y0, x0 + w + 1, y0 + h]; if (bx[0] < pad || bx[2] > W - pad || bx[1] < pad || bx[3] > H - pad) continue;
      if (!hit(bx)) { best = [dx, dy, an, bx]; break; } }
    if (!best) { const [dx, dy, an] = [7, 0, "start"]; best = [dx, dy, an, [p.px + 6, p.py - 9, p.px + 7 + w, p.py + 4]]; }
    boxes.push(best[3]); p.lab = { x: p.px + best[0], y: p.py + best[1] + 4, an: best[2], name, far: Math.abs(best[1]) > 12 }; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="섹터 로테이션 맵">
    <defs><clipPath id="rrgclip"><rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}"/></clipPath></defs>
    <rect x="${X(100)}" y="${pad}" width="${W - pad - X(100)}" height="${Y(100) - pad}" fill="var(--up)" opacity=".05"/>
    <rect x="${pad}" y="${Y(100)}" width="${X(100) - pad}" height="${H - pad - Y(100)}" fill="var(--down)" opacity=".05"/>
    <line x1="${X(100)}" y1="${pad}" x2="${X(100)}" y2="${H - pad}" stroke="var(--rule-strong)" stroke-dasharray="3 3"/>
    <line x1="${pad}" y1="${Y(100)}" x2="${W - pad}" y2="${Y(100)}" stroke="var(--rule-strong)" stroke-dasharray="3 3"/>
    <text x="${W - pad - 4}" y="${pad + 14}" text-anchor="end" class="q" fill="var(--up)">주도 (강하고 더 강해짐)</text>
    <text x="${W - pad - 4}" y="${H - pad - 6}" text-anchor="end" class="q" fill="#b07d2a">약화 (강하지만 꺾임)</text>
    <text x="${pad + 4}" y="${H - pad - 6}" class="q" fill="var(--down)">소외 (약하고 더 약해짐)</text>
    <text x="${pad + 4}" y="${pad + 14}" class="q" fill="var(--accent)">개선 (약하지만 살아남)</text>
    <text x="${W / 2}" y="${H - 8}" text-anchor="middle" class="ax">← 시장보다 약함 · RS-Ratio · 시장보다 강함 →</text>
    <text x="12" y="${H / 2}" text-anchor="middle" class="ax" transform="rotate(-90 12 ${H / 2})">RS-Momentum ↑</text>
    ${pts.map(p => { const [lx, ly] = p.tail.at(-1), col = qc(lx, ly), on = p.s === sel;
      return `<g class="pt ${on ? "on" : ""}" data-s="${esc(p.s)}" clip-path="url(#rrgclip)"><title>${esc(p.s)} (${p.k}종목) · RS-Ratio ${lx.toFixed(1)} · Momentum ${ly.toFixed(2)}</title>
        <polyline points="${p.tail.map(([x, y]) => X(x).toFixed(1) + "," + Y(y).toFixed(1)).join(" ")}" fill="none" stroke="${col}" stroke-width="${on ? 2.4 : 1.2}" opacity="${on ? 1 : 0}"/>
        ${p.tail.slice(0, -1).map(([x, y]) => `<circle class="tl" cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="1.8" fill="${col}" opacity="${on ? .8 : 0}"/>`).join("")}
        <circle cx="${X(lx).toFixed(1)}" cy="${Y(ly).toFixed(1)}" r="${on ? 6 : 4.5}" fill="${col}" stroke="var(--card)" stroke-width="1.5"/>
        ${p.lab.far ? `<line x1="${p.px.toFixed(1)}" y1="${p.py.toFixed(1)}" x2="${(p.lab.x + (p.lab.an === "end" ? -2 : 2)).toFixed(1)}" y2="${(p.lab.y - 4).toFixed(1)}" stroke="var(--faint)" stroke-width=".6"/>` : ""}
        <text x="${p.lab.x.toFixed(1)}" y="${p.lab.y.toFixed(1)}" text-anchor="${p.lab.an}" class="lb">${esc(p.lab.name)}</text></g>`; }).join("")}
  </svg>`;
  el.querySelectorAll("g.pt").forEach(g => g.onclick = () => { store.set("sector", g.dataset.s); drawRRG(onPick); onPick(); });
}
async function renderSectors(start) {
  destroyCharts(); $("#ld").hidden = false;
  const all = S.stocks.map(s => s.t);
  const tok = S.tok = (S.tok || 0) + 1;
  const [pd, rdd] = await Promise.all([periodData(start, all), recentDD(all)]);
  if (tok !== S.tok || !$("#sectbl2")) return;
  const mkt = capIndex(pd, mktTickers("KOSPI"));
  const secs = {};
  S.stocks.forEach(s => (secs[s.s] ||= []).push(s.t));
  const rows = Object.entries(secs).map(([sec, ts]) => {
    const idx = capIndex(pd, ts); if (!idx) return null;
    const st = ddStats(idx, pd.d);
    return { id: sec, s: sec, k: ts.length, ret: (idx.at(-1) - 1) * 100, vs: (idx.at(-1) - mkt.at(-1)) * 100, mdd: st.mdd, cur: st.cur, idx };
  }).filter(Boolean);
  let sel = store.get("sector", null); if (!rows.find(r => r.s === sel)) sel = [...rows].sort((a, b) => b.ret - a.ret)[0].s;
  $("#ld").hidden = true; $("#secwrap").hidden = false;
  const draw = () => {
    destroyCharts();
    sortableTable($("#sectbl2"), [
      { k: "s", l: "섹터", f: r => `<td class="name">${esc(r.s)}<small>${r.k}</small></td>` },
      { k: "ret", l: "수익률", f: r => pctCell(r.ret, 30) },
      { k: "vs", l: "코스피 대비", f: r => pctCell(r.vs, 20) },
      { k: "mdd", l: "MDD", f: r => `<td class="down">${fmtPct(r.mdd)}</td>` },
      { k: "cur", l: "현재 낙폭", f: r => `<td class="${r.cur < -0.005 ? "down" : ""}">${fmtPct(r.cur)}</td>` },
    ], rows, { key: "ret", selected: r => r.s === sel, onRow: r => { sel = r.s; store.set("sector", sel); draw(); drawRRG(() => {}); } });
    const r = rows.find(x => x.s === sel);
    $("#c1t").innerHTML = `${esc(sel)} vs 코스피 <small>기준일 ${pd.baseDate} = 100</small>`;
    lineChart($("#c1"), pd.d, [{ label: sel, data: r.idx.map(v => v * 100), width: 2 }, { label: "코스피", data: mkt.map(v => v * 100), dash: [5, 4] }], { ref: 100 });
    lineChart($("#c2"), pd.d, [{ label: sel, data: ddStats(r.idx, pd.d).dd, color: css("--down"), fill: "color-mix(in srgb, " + css("--down") + " 12%, transparent)" },
      { label: "코스피", data: ddStats(mkt, pd.d).dd, dash: [5, 4] }], { pct: true });
    const ts = secs[sel].filter(t => pd.s[t]);
    const srows = ts.map(t => { const v = pd.s[t].v.map(x => x ?? NaN); const st = ddStats(ffill(pd.s[t].v), pd.d);
      const q = rdd[t] || {};
      return { id: t, n: S.byT[t].n, ret: (v.at(-1) - 1) * 100, vs: (v.at(-1) - r.idx.at(-1)) * 100, mdd: st.mdd, cur: st.cur,
        m20: q.mdd20, m60: q.mdd60, cap: S.byT[t].cap }; });
    $("#stt").textContent = `${sel} 종목 ${srows.length}개 · 누르면 종목 차트`;
    sortableTable($("#stbl"), [
      { k: "n", l: "종목", f: r => `<td class="name">${star(r.id)}${esc(r.n)}<small>${r.id}</small></td>` },
      { k: "ret", l: "수익률", f: r => pctCell(r.ret, 40) },
      { k: "vs", l: "섹터 대비", f: r => pctCell(r.vs, 30) },
      { k: "mdd", l: "기간 MDD", f: r => `<td class="down">${fmtPct(r.mdd)}</td>` },
      { k: "m20", l: "20일 MDD", f: r => `<td class="down">${fmtPct(r.m20)}</td>` },
      { k: "m60", l: "60일 MDD", f: r => `<td class="down">${fmtPct(r.m60)}</td>` },
      { k: "cur", l: "현재 낙폭", f: r => `<td class="${r.cur < -0.005 ? "down" : ""}">${fmtPct(r.cur)}</td>` },
      { k: "cap", l: "시총(억)", f: r => `<td>${fmtNum(r.cap)}</td>` },
    ], srows, { key: "ret", onRow: r => openStock(r.id) });
  };
  draw();
}

/** 여러 매크로 시리즈를 날짜 합집합으로 맞춤 */
/* 다가오는 일정: cal/events.json(고정 일정) + 옵션 만기(계산). 종류별로 켜고 끔 */
const EVK = [["fomc", "FOMC"], ["cpi", "미국 CPI"], ["nfp", "미국 고용"], ["bok", "한은 금리"], ["exp", "옵션 만기"], ["tv", "경제지표"]];
function expiries(from, to) {   // 코스피200 옵션·선물: 매달 둘째 목요일 (3·6·9·12월은 선물 동시 만기). 휴장이면 하루 앞당겨짐
  const out = [], d0 = new Date(from + "T00:00:00Z"), d1 = new Date(to + "T00:00:00Z");
  for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); new Date(Date.UTC(y, m, 1)) <= d1; m++ === 11 && (m = 0, y++)) {
    const first = new Date(Date.UTC(y, m, 1)), th = 1 + ((4 - first.getUTCDay() + 7) % 7) + 7, ds = new Date(Date.UTC(y, m, th)).toISOString().slice(0, 10);
    if (ds >= from && ds <= to) out.push([ds, "exp", (m % 3 === 2 ? "선물·옵션 동시 만기" : "옵션 만기"), m % 3 === 2 ? "쿼드러플 위칭, 변동성 주의" : ""]);
  }
  return out;
}
const EVINFO = {
  fomc: { what: "미국 연준이 기준금리를 정하는 회의. 한국 시간 다음 날 새벽 4시 결정문, 4시 30분 의장 기자회견. '점도표' 회의는 위원들의 앞으로 금리 예상도 같이 나와요.",
    watch: ["금리를 올렸나·내렸나·동결했나보다 시장 예상(선물 가격)과 달랐는지가 중요", "결정문 문구 변화와 기자회견 말투(매파=긴축, 비둘기=완화)", "점도표의 내년 금리 중간값이 지난번보다 위인지 아래인지"],
    react: "예상보다 매파적이면 달러·미국 금리 상승 → 원화 약세, 외국인 매도, 성장주 약세. 비둘기면 반대. 한국 시장 반응은 다음 날 아침 장에 나와요." },
  cpi: { what: "미국 소비자물가. 한국 시간 밤 10시 30분(서머타임 땐 9시 30분) 발표. 연준이 금리를 정할 때 가장 크게 보는 숫자 중 하나예요.",
    watch: ["전월 대비 근원 CPI(식료품·에너지 뺀 것)가 예상보다 높은지 낮은지", "주거비·서비스 물가가 꺾이는지", "0.1%p 차이에도 시장이 크게 움직여요"],
    react: "예상보다 높으면 금리 인하 기대 축소 → 미국 금리·달러 상승, 주식 약세. 낮으면 반대. 금리 인상·인하 확률이 바로 바뀌어요." },
  nfp: { what: "미국 고용보고서(비농업 일자리 수·실업률·임금). 보통 매달 첫 금요일 한국 시간 밤 10시 30분.",
    watch: ["일자리 증가 수가 예상보다 많은지", "실업률 방향", "시간당 임금 상승률(물가로 이어짐)", "지난달 수치 수정 폭"],
    react: "고용이 너무 강하면 금리 인하가 늦어진다고 보고 금리 상승, 너무 약하면 경기 걱정. '적당히 식는' 숫자가 주식엔 가장 좋아요." },
  bok: { what: "한국은행 금융통화위원회가 기준금리를 정하는 날. 오전 10시쯤 발표, 이후 총재 기자간담회.",
    watch: ["금리 결정과 소수의견(누가 반대했나)", "3개월 뒤 금리 전망(포워드 가이던스)에서 인하·인상 의견 수", "환율·집값에 대한 총재 발언"],
    react: "예상보다 매파적이면 원화 강세·채권 금리 상승, 은행주엔 유리하고 성장주엔 불리. 환율이 높을 땐 금리 결정이 원/달러에 바로 반영돼요." },
  exp: { what: "코스피200 옵션 만기일(매달 둘째 목요일). 3·6·9·12월은 선물까지 같이 끝나는 동시 만기예요.",
    watch: ["오후 장 막판 프로그램 매매(차익거래 청산)로 지수가 출렁일 수 있음", "옵션이 많이 몰린 행사가(콜 벽·풋 벽) 근처로 지수가 끌려가는 경향", "동시 만기엔 선물 롤오버와 외국인 베이시스 매매"],
    react: "만기 직전엔 변동성이 커지고, 만기가 지나면 딜러 감마 포지션이 풀리면서 방향이 새로 잡히기도 해요. 수급·매크로 화면의 옵션 감마와 같이 보세요." },
};
const TVC = [["US", "미국"], ["KR", "한국"], ["CN", "중국"], ["JP", "일본"], ["EU", "유럽"], ["DE", "독일"], ["GB", "영국"]];
const TVKO = { "Inflation Rate YoY Flash": "소비자물가 (CPI) 전년비 속보", "PCE Price Index MoM": "PCE 물가 전월비", "Core PCE Price Index YoY": "근원 PCE 물가 전년비 (Core PCE)", "Non Farm Payrolls": "비농업 고용 (NFP)", "Unemployment Rate": "실업률 (Unemployment Rate)", "Inflation Rate YoY": "소비자물가 (CPI) 전년비", "Inflation Rate MoM": "소비자물가 (CPI) 전월비",
  "Core Inflation Rate YoY": "근원 CPI 전년비", "Core Inflation Rate MoM": "근원 CPI 전월비", "Core PCE Price Index MoM": "근원 PCE 물가 전월비 (Core PCE)", "PPI MoM": "생산자물가 (PPI) 전월비",
  "Retail Sales MoM": "소매판매 (Retail Sales) 전월비", "Retail Sales YoY": "소매판매 (Retail Sales) 전년비", "ISM Manufacturing PMI": "ISM 제조업 지수 (ISM Mfg PMI)", "ISM Services PMI": "ISM 서비스업 지수 (ISM Svcs PMI)",
  "GDP Growth Rate QoQ Prel": "GDP 성장률 속보 (GDP QoQ)", "GDP Growth Rate QoQ 2nd Est": "GDP 성장률 잠정 (GDP QoQ)", "GDP Growth Rate QoQ Final": "GDP 성장률 확정 (GDP QoQ)", "GDP Growth Rate YoY Prel": "GDP 성장률 전년비 속보 (GDP YoY)",
  "Interest Rate": "기준금리 결정 (Rate Decision)", "ECB Interest Rate Decision": "ECB 금리 결정", "Deposit Facility Rate": "ECB 예금금리 (DFR)", "JOLTs Job Openings": "구인건수 (JOLTS)",
  "Michigan Consumer Sentiment Prel": "미시간 소비자심리 예비 (UMich)", "Consumer Confidence": "소비자신뢰지수 (CB)", "Balance of Trade": "무역수지 (Trade Balance)", "Exports YoY": "수출 전년비", "Imports YoY": "수입 전년비",
  "Industrial Production YoY": "산업생산 (IP) 전년비", "Housing Starts": "주택착공 (Housing Starts)", "Building Permits Prel": "건축허가 예비 (Building Permits)", "Existing Home Sales": "기존주택판매 (Existing Home Sales)", "Durable Goods Orders MoM": "내구재 주문 (Durable Goods)",
  "Personal Income MoM": "개인소득 (Personal Income)", "Personal Spending MoM": "개인소비 (PCE Spending)", "NBS Manufacturing PMI": "국가통계국 제조업 PMI (NBS PMI)", "Tankan Large Manufacturers Index": "단칸 대형 제조업",
  "S&P Global Manufacturing PMI Flash": "S&P 제조업 PMI 예비 (Flash PMI)", "S&P Global Services PMI Flash": "S&P 서비스업 PMI 예비 (Flash PMI)", "Ifo Business Climate": "Ifo 기업환경", "ZEW Economic Sentiment Index": "ZEW 경기기대" };
const kstOf = iso => { const x = new Date(new Date(iso).getTime() + 9 * 3600e3); return [x.toISOString().slice(0, 10), x.toISOString().slice(11, 16)]; };
async function loadEvents() {
  const get = async f => { try { return await (await fetch(f, { cache: "no-cache" })).json(); } catch { return null; } };
  const [C, T, TI, TH] = await Promise.all([get("cal/events.json"), get("cal/tv.json"), get("cal/tvinfo.json"), get("cal/tvhist.json")]);
  const today = kstToday();
  const tv = (T?.events || []).map(r => { const [d, t] = kstOf(r.date), cn = TVC.find(c => c[0] === r.country)?.[1] || r.country;
    return [d, "tv", `${cn} ${TVKO[r.title] || r.title}`, `${t} 발표${r.period ? " · " + r.period : ""}`, { ...r, time: t, info: TI?.[r.k] }]; });
  const evs = [...(C?.events || []), ...expiries(isoMinus(today, 400), isoMinus(today, -400)), ...tv].sort((a, b) => a[0].localeCompare(b[0]) || (a[4]?.time || "").localeCompare(b[4]?.time || ""));
  const stale = C ? Object.entries(C.covered || {}).filter(([, v]) => v < isoMinus(today, -60)).map(([k]) => EVK.find(x => x[0] === k)?.[1] || k) : ["고정 일정"];
  return { evs, stale, today, tvUpdated: T?.updated, hist: TH || {} };
}
/* 경제지표는 나라·중요도 필터도 통과해야 보임 */
const evPass = (e, on) => on.includes(e[1]) && (e[1] !== "tv" || (store.get("evtvc", ["US", "KR", "CN"]).includes(e[4].country) && (store.get("evtvi", 1) === 0 || e[4].importance >= 1)));
const evTvFilterHTML = () => { const cs = store.get("evtvc", ["US", "KR", "CN"]), im = store.get("evtvi", 1);
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 8px;align-items:center"><span class="small muted">경제지표:</span><span class="tabs" id="evtvc">${TVC.map(([k, l]) => `<button data-k="${k}" class="${cs.includes(k) ? "on" : ""}">${l}</button>`).join("")}</span>
    <span class="tabs" id="evtvi">${[[1, "중요만"], [0, "전체"]].map(([k, l]) => `<button data-k="${k}" class="${k === im ? "on" : ""}">${l}</button>`).join("")}</span></div>`; };
const evTvClick = t => { if (t.closest("#evtvc")) { const cs = store.get("evtvc", ["US", "KR", "CN"]), k = t.dataset.k, i = cs.indexOf(k); i >= 0 ? cs.splice(i, 1) : cs.push(k); store.set("evtvc", cs); return true; }
  if (t.closest("#evtvi")) { store.set("evtvi", +t.dataset.k); return true; } return false; };
const EVCOL = { fomc: "var(--up)", cpi: "#b07d2a", nfp: "#2f8f9d", bok: "var(--accent)", exp: "var(--down)", tv: "var(--sub)" };
const evDD = (ds, today) => Math.round((new Date(ds + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 864e5);
const evFilterHTML = on => `<div class="tabs" id="evf" style="flex-wrap:wrap;margin-bottom:8px">${EVK.map(([k, l]) => `<button data-k="${k}" class="${on.includes(k) ? "on" : ""}"><i style="color:${EVCOL[k]}">●</i> ${l}</button>`).join("")}</div>`;
const evListHTML = (rows, today, evs) => `<ul class="feed">${rows.map(e => { const n = evDD(e[0], today);
  return `<li data-i="${evs.indexOf(e)}" style="cursor:pointer"><span class="num ${n <= 3 ? "up" : ""}" style="display:inline-block;min-width:3.4em">${n === 0 ? "오늘" : "D-" + n}</span> <b>${esc(e[2])}</b>
    <small class="muted">${e[0].slice(5).replace("-", "/")}${e[1] === "fomc" ? " (미국, 한국은 다음 날 새벽 4시)" : ["cpi", "nfp"].includes(e[1]) ? " (한국 시간 밤 10:30)" : ""}${e[3] ? " · " + esc(e[3]) : ""}</small></li>`; }).join("") || `<li class="muted small">고른 종류의 일정이 75일 안에 없어요</li>`}</ul>`;
/* 홈: 목록만 (누르면 일정 메뉴에서 해석) */
async function drawEvents() {
  const el = $("#evlist"); if (!el) return;
  const { evs, stale, today } = await loadEvents(); if (!document.body.contains(el)) return;
  const on = store.get("evon2", EVK.map(k => k[0]));
  const draw = () => { el.innerHTML = evFilterHTML(on) + (on.includes("tv") ? evTvFilterHTML() : "") + evListHTML(evs.filter(e => evPass(e, on) && e[0] >= today && e[0] <= isoMinus(today, -75)).slice(0, 12), today, evs)
    + `<p class="small" style="margin-top:6px"><a href="#cal">달력과 해석 보기 →</a></p>` + (stale.length ? `<p class="small down">${stale.join(", ")} 다음 해 일정이 아직 안 들어갔어요</p>` : ""); };
  el.addEventListener("click", e => { const t = e.target.closest("[data-i],#evf button,#evtvc button,#evtvi button"); if (!t) return;
    if (evTvClick(t)) return draw();
    if (t.dataset.i != null) { store.set("evpick", evs[+t.dataset.i][0] + "|" + evs[+t.dataset.i][2]); location.hash = "cal"; return; }
    const k = t.dataset.k, i = on.indexOf(k); i >= 0 ? on.splice(i, 1) : on.push(k); store.set("evon2", on); draw(); });
  draw();
}
/* 지표 발표 때 시장 반응: 발표 시각 이후 첫 종가 − 직전 종가. 서프라이즈(실제−예상)와의 상관 */
const REACT = [["IDX_KOSPI", "코스피", "%"], ["SP500", "S&P 500", "%"], ["DGS2", "미국 2년 금리", "bp"], ["US10Y", "미국 10년 금리", "bp"], ["DXY", "달러인덱스", "%"], ["DEXKOUS", "원/달러", "%"]];
function reactions(H, M) {
  return REACT.map(([k, nm, u]) => { const z = M?.[k]; if (!z) return null;
    const rows = H.map(([iso, a, f]) => { const ut = new Date(iso + ":00Z"), kst = new Date(ut.getTime() + 9 * 3600e3).toISOString(), us = new Date(ut.getTime() - 5 * 3600e3).toISOString();
      // 한국 지수는 15:30(KST) 이후 발표면 다음 날 반응, 미국 지표(FRED 일자)는 미국 날짜 기준 그날 종가
      const day = k === "IDX_KOSPI" ? (kst.slice(11, 16) >= "15:30" ? isoMinus(kst.slice(0, 10), -1) : kst.slice(0, 10)) : us.slice(0, 10);
      let i = z.d.findIndex(d => d >= day); if (i < 1) return null;
      const ch = u === "bp" ? (z.v[i] - z.v[i - 1]) * 100 : (z.v[i] / z.v[i - 1] - 1) * 100;
      return f == null || a == null ? null : { s: a - f, r: ch, d: iso.slice(0, 10) }; }).filter(Boolean);
    if (rows.length < 6) return { k, nm, u, n: rows.length };
    const mx = rows.reduce((p, q) => p + q.s, 0) / rows.length, my = rows.reduce((p, q) => p + q.r, 0) / rows.length;
    let sxy = 0, sxx = 0, syy = 0; rows.forEach(q => { sxy += (q.s - mx) * (q.r - my); sxx += (q.s - mx) ** 2; syy += (q.r - my) ** 2; });
    const hi = rows.filter(q => q.s > 0), lo = rows.filter(q => q.s < 0), avg = a => a.length ? a.reduce((p, q) => p + q.r, 0) / a.length : null;
    return { k, nm, u, n: rows.length, corr: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, hi: avg(hi), nhi: hi.length, lo: avg(lo), nlo: lo.length }; }).filter(Boolean);
}
/* 지표 vs 시장: 발표치(왼쪽 축)와 시장 지표 여러 개(각자 축)를 한 차트에 */
const CMPM = [["SP500", "S&P 500", "mkt"], ["NASDAQ", "나스닥", "mkt"], ["IDX_KOSPI", "코스피", "macro"], ["DGS2", "미국 2년 금리", "macro"], ["US10Y", "미국 10년 금리", "mkt"],
  ["DXY", "달러인덱스", "macro"], ["DEXKOUS", "원/달러", "macro"], ["VIXCLS", "VIX", "macro"]];
async function viewCmp(el) {
  const get = async f => { try { return await (await fetch(f, { cache: "no-cache" })).json(); } catch { return null; } };
  const [H, MK, M, T] = await Promise.all([get("cal/tvhist.json"), get("cal/mkt.json"), loadX("macro").catch(() => null), get("cal/tv.json")]);
  if (!document.body.contains(el)) return;
  if (!H) { el.innerHTML = NODATA("지표"); return; }
  const names = { ...(H._names || {}) }; (T?.events || []).forEach(r => names[r.k] ||= [r.country, r.title]);
  const keys = Object.keys(H).filter(k => !k.startsWith("_") && H[k].length > 3);
  const label = k => { const [c, t] = names[k] || ["", k]; return `${TVC.find(x => x[0] === c)?.[1] || c} ${TVKO[t] || t}`; };
  keys.sort((a, b) => { const ca = TVC.findIndex(x => x[0] === names[a]?.[0]), cb = TVC.findIndex(x => x[0] === names[b]?.[0]); return (ca - cb) || label(a).localeCompare(label(b)); });
  let k = store.get("cmpk", null); if (!keys.includes(k)) k = keys.find(x => /Non Farm|Inflation Rate MoM/.test(names[x]?.[1] || "") && names[x]?.[0] === "US") || keys[0];
  const sel = store.get("cmpm", ["SP500", "DGS2"]), yrs = store.get("cmpy", 5);
  const pal = [css("--up"), css("--down"), "#b07d2a", "#7a52b3", "#2f8f9d", css("--faint"), "#c03fa0", css("--sub")];
  el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <select id="cmpk" aria-label="지표" style="max-width:100%">${keys.map(x => `<option value="${esc(x)}" ${x === k ? "selected" : ""}>${esc(label(x))}</option>`).join("")}</select>
      <span class="tabs" id="cmpy">${[[1, "1년"], [3, "3년"], [5, "5년"]].map(([y, l]) => `<button data-k="${y}" class="${y === yrs ? "on" : ""}">${l}</button>`).join("")}</span></div>
    <div class="tabs" id="cmpm" style="flex-wrap:wrap;margin-bottom:10px"><span class="small muted" style="align-self:center">같이 볼 것:</span>${CMPM.map(([m, l], i) => `<button data-k="${m}" class="${sel.includes(m) ? "on" : ""}"><i style="color:${pal[i]}">●</i> ${l}</button>`).join("")}</div>
    <div class="chart"><h3>${esc(label(k))} <small>막대 = 발표치(왼쪽 축), 점선 = 예상 · 선 = 시장(각자 축, 오른쪽)</small></h3><div id="cmpc"></div></div>
    <div id="cmpr"></div>`;
  const start = isoMinus(kstToday(), Math.round(365.25 * yrs)), Hk = H[k].filter(x => x[0].slice(0, 10) >= start);
  const ser = sel.map(m => { const i = CMPM.findIndex(x => x[0] === m), z = CMPM[i][2] === "mkt" ? MK?.[m] : M?.[m]; return z ? { m, l: CMPM[i][1], col: pal[i], z } : null; }).filter(Boolean);
  const set = new Set(Hk.map(x => x[0].slice(0, 10))); ser.forEach(s => s.z.d.forEach(d => d >= start && set.add(d)));
  const xs = [...set].sort(), xi = new Map(xs.map((d, i) => [d, i])), col = () => xs.map(() => null);
  const ha = col(), hf = col(); Hk.forEach(x => { const i = xi.get(x[0].slice(0, 10)); ha[i] = x[1]; hf[i] = x[2]; });
  const cols = ser.map(s => { const c = col(); s.z.d.forEach((d, j) => { const i = xi.get(d); if (i != null) c[i] = s.z.v[j]; }); return c; });
  const sub = css("--sub"), rule = css("--rule"), host = $("#cmpc");
  const u = new uPlot({ width: Math.max(300, host.clientWidth - 4), height: 380,
    cursor: { points: { size: 6 }, drag: { x: true, y: false } }, legend: { live: true },
    scales: { x: { time: true }, y: {}, ...Object.fromEntries(ser.map(s => [s.m, {}])) },
    axes: [{ stroke: sub, grid: { stroke: rule } }, { scale: "y", stroke: css("--accent"), grid: { stroke: rule }, size: 56 },
      ...ser.map((s, i) => ({ scale: s.m, side: 1, stroke: s.col, grid: { show: false }, size: 58, show: i < 3 }))],
    series: [{ label: "날짜", value: (uu, v) => v == null ? "–" : new Date(v * 1000).toISOString().slice(0, 10) },
      { label: "발표치", scale: "y", stroke: css("--accent"), fill: "color-mix(in srgb, " + css("--accent") + " 55%, transparent)", paths: uPlot.paths.bars({ size: [0.6, 10] }), points: { show: false } },
      { label: "예상", scale: "y", stroke: css("--ink"), dash: [4, 3], width: 1.2, spanGaps: true, points: { show: true, size: 4 } },
      ...ser.map(s => ({ label: s.l, scale: s.m, stroke: s.col, width: 1.6, spanGaps: true, points: { show: false } }))],
    hooks: { setSelect: [uu => { if (uu.select.width > 10) uu.setScale("x", { min: uu.posToVal(uu.select.left, "x"), max: uu.posToVal(uu.select.left + uu.select.width, "x") }); uu.setSelect({ width: 0, height: 0 }, false); }] },
  }, [xs.map(d => Date.parse(d + "T00:00:00Z") / 1000), ha, hf, ...cols], host);
  S.charts.push(u);
  host.ondblclick = () => u.setScale("x", { min: u.data[0][0], max: u.data[0].at(-1) });
  const R = reactions(H[k], { ...(M || {}), ...(MK || {}) }), fm = (v, un) => v == null ? "–" : (v > 0 ? "+" : "") + v.toFixed(un === "bp" ? 1 : 2) + (un === "bp" ? "bp" : "%");
  $("#cmpr").innerHTML = `<p class="small muted">드래그하면 그 구간 확대, 더블클릭하면 원래대로. 시장 선은 각자 축이라 높이보다 방향을 같이 보세요.</p>
    <div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>발표 날 시장 반응</th><th>상관</th><th>예상보다 높을 때</th><th>낮을 때</th></tr></thead><tbody>${R.map(x => `<tr><td class="name">${x.nm}<small>${x.n}번</small></td>
      <td>${x.corr == null ? "–" : x.corr.toFixed(2)}</td><td class="${cls(x.hi)}">${fm(x.hi, x.u)}<small>${x.nhi ?? ""}번</small></td><td class="${cls(x.lo)}">${fm(x.lo, x.u)}<small>${x.nlo ?? ""}번</small></td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">상관 = 서프라이즈(실제−예상)가 클수록 그날 시장이 어느 쪽으로 움직였는지 (−1~1, ±0.3 넘으면 꽤 뚜렷).</p>`;
  el.onclick = e => { const t = e.target.closest("#cmpm button,#cmpy button"); if (!t) return;
    if (t.closest("#cmpy")) store.set("cmpy", +t.dataset.k); else { const i = sel.indexOf(t.dataset.k); i >= 0 ? sel.splice(i, 1) : sel.push(t.dataset.k); store.set("cmpm", sel); }
    destroyCharts(); viewCmp(el); };
  $("#cmpk").onchange = e => { store.set("cmpk", e.target.value); destroyCharts(); viewCmp(el); };
}
/* 일정 메뉴: 달력 + 해석 + 다가오는 목록 */
async function viewCal(app) {
  app.innerHTML = `<div><div class="kicker">일정</div><h2>경제 일정 달력</h2>
    <p class="small muted">FOMC·미국 CPI·고용·한국은행 금리 결정·옵션 만기. 날짜의 일정을 누르면 무엇이고 어떻게 해석하는지 나와요. FOMC는 한국 시간 다음 날 새벽, CPI·고용은 같은 날 밤에 나와요.</p></div>
    <span class="tabs" id="caltab" style="margin-top:10px">${[["mine", "주요 일정 · 해석"], ["cmp", "지표 vs 시장 비교"], ["tv", "전체 경제 일정 (TradingView)"]].map(([k, l]) => `<button data-k="${k}" class="${k === store.get("caltab", "mine") ? "on" : ""}">${l}</button>`).join("")}</span>
    <div id="calbox" style="margin-top:14px"><p class="loading">불러오는 중…</p></div>`;
  tabsBind("#caltab", k => { store.set("caltab", k); viewCal(app); });
  if (store.get("caltab", "mine") === "tv") {   // 외부 위젯: 전 세계 경제지표 발표 일정(예상치·이전치·실제치)
    const box = $("#calbox"), w = document.createElement("div"), sc = document.createElement("script");
    w.className = "tradingview-widget-container"; w.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    sc.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js"; sc.async = true;
    sc.textContent = JSON.stringify({ colorTheme: isDark() ? "dark" : "light", isTransparent: true, width: "100%", height: 720,
      locale: "kr", importanceFilter: "0,1", countryFilter: "us,kr,cn,jp,eu" });
    box.innerHTML = `<p class="small muted">미국·한국·중국·일본·유로존의 중요도 중간 이상 지표. 발표되면 실제치가 채워져요. 화면 위 필터로 나라·중요도를 바꿀 수 있어요. (TradingView 제공, 해석은 '주요 일정 · 해석' 탭)</p>`;
    w.appendChild(sc); box.appendChild(w); return;
  }
  if (store.get("caltab", "mine") === "cmp") return viewCmp($("#calbox"));
  const el = $("#calbox"), { evs, stale, today, tvUpdated, hist } = await loadEvents(), M = { ...((await loadX("macro").catch(() => null)) || {}), ...((await fetch("cal/mkt.json", { cache: "no-cache" }).then(r => r.json()).catch(() => null)) || {}) }; if (!document.body.contains(el)) return;
  const on = store.get("evon2", EVK.map(k => k[0])), pk = store.get("evpick", ""); store.set("evpick", "");
  let pick = evs.find(e => e[0] + "|" + e[2] === pk) || evs.find(e => evPass(e, on) && e[0] >= today && e[1] !== "tv") || null, ym = (pick?.[0] || today).slice(0, 7);
  const shown = () => evs.filter(e => evPass(e, on));
  const fmtV = (v, r) => v == null ? "–" : (+v).toLocaleString("ko-KR", { maximumFractionDigits: 3 }) + (r.scale || "") + (r.unit && r.unit !== r.scale ? r.unit : "");
  const tvKind = r => /Non Farm Payrolls/.test(r.title) && r.country === "US" ? "nfp" : /Inflation Rate|PCE/.test(r.title) && r.country === "US" ? "cpi" : /Interest Rate/.test(r.title) ? (r.country === "KR" ? "bok" : r.country === "US" ? "fomc" : null) : null;
  const detailTv = e => { const r = e[4], n = evDD(e[0], today), sur = r.actual != null && r.forecast != null ? r.actual - r.forecast : null, I = EVINFO[tvKind(r)];
    return `<div style="border:1px solid var(--rule);border-left:4px solid var(--sub);padding:12px 14px">
      <div><b style="font-size:16px">${esc(e[2])}</b></div><div class="small muted">${esc(r.title)} · ${e[0]} ${r.time} (한국 시간)${r.period ? " · " + esc(r.period) : ""} · ${n === 0 ? "오늘" : n > 0 ? "D-" + n : -n + "일 지남"} · 중요도 ${r.importance >= 1 ? "높음" : "보통"}</div>
      <div class="stats" style="margin-top:8px"><div><div class="lbl">실제</div><div class="v ${sur == null ? "" : sur > 0 ? "up" : sur < 0 ? "down" : ""}">${fmtV(r.actual, r)}</div><div class="s">${sur == null ? (r.actual == null ? "발표 전" : "") : sur > 0 ? "예상보다 높음" : sur < 0 ? "예상보다 낮음" : "예상과 같음"}</div></div>
        <div><div class="lbl">예상</div><div class="v">${fmtV(r.forecast, r)}</div></div><div><div class="lbl">이전</div><div class="v">${fmtV(r.previous, r)}</div></div></div>
      ${I ? `<p style="margin:10px 0 6px">${I.what}</p><div><b>볼 것</b><ul style="margin:4px 0 8px 18px;padding:0">${I.watch.map(w => `<li>${w}</li>`).join("")}</ul></div><p style="margin:0 0 8px"><b>시장 반응</b> ${I.react}</p>` : ""}
      <p class="small" style="margin:8px 0 0"><b>해석</b> 실제가 예상과 크게 다를수록 시장이 크게 움직여요. 물가·고용이 예상보다 높으면 보통 금리 상승·달러 강세(주식엔 부담), 낮으면 반대. 경기지표(PMI·소매판매·GDP)는 예상보다 좋으면 경기에 긍정적이지만 금리 인하 기대는 줄어요.</p>
      ${(hist[r.k] || []).length > 2 ? `<p class="small" style="margin:10px 0 0"><a href="#" data-cmp="${esc(r.k)}">금리·S&P·코스피와 한 차트에서 크게 비교 →</a></p><div class="chart" style="margin-top:6px"><h3>지난 발표치 <small>실제 · 예상(점선), 최근 5년</small></h3><div id="tvh"></div></div>
        <div class="chart"><h3>같은 기간 시장 <small><span class="tabs" id="tvm">${REACT.map(([k, nm]) => `<button data-k="${k}" class="${k === store.get("tvm", "IDX_KOSPI") ? "on" : ""}">${nm}</button>`).join("")}</span></small></h3><div id="tvmc"></div></div>
        ${(() => { const R = reactions(hist[r.k], M), fm = (v, u) => v == null ? "–" : (v > 0 ? "+" : "") + v.toFixed(u === "bp" ? 1 : 2) + (u === "bp" ? "bp" : "%");
          return `<div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>발표 날 반응</th><th>상관</th><th>예상보다 높을 때</th><th>낮을 때</th></tr></thead><tbody>${R.map(x => `<tr><td class="name">${x.nm}<small>${x.n}번</small></td>
            <td>${x.corr == null ? "–" : x.corr.toFixed(2)}</td><td class="${cls(x.hi)}">${fm(x.hi, x.u)}<small>${x.nhi ?? ""}번</small></td><td class="${cls(x.lo)}">${fm(x.lo, x.u)}<small>${x.nlo ?? ""}번</small></td></tr>`).join("")}</tbody></table></div>
            <p class="small muted">상관 = 서프라이즈(실제−예상)가 클수록 그날 시장이 어느 쪽으로 움직였는지 (−1~1, 0.3 넘으면 꽤 뚜렷). 코스피는 장 마감 뒤 발표면 다음 날 종가로 계산.</p>`; })()}` : ""}
      ${r.info ? `<details style="margin-top:8px"><summary class="small">지표 설명 (TradingView, 영어)</summary><p class="small muted">${esc(r.info)}</p></details>` : ""}</div>`; };
  const tvCharts = () => { const r = pick?.[1] === "tv" ? pick[4] : null, H = r && hist[r.k]; if (!H || H.length < 3 || !$("#tvh")) return;
    const d = H.map(x => x[0].slice(0, 10));
    lineChart($("#tvh"), d, [{ label: "실제", data: H.map(x => x[1]), color: css("--accent"), width: 2 }, { label: "예상", data: H.map(x => x[2]), color: css("--faint"), dash: [4, 3] }], { height: 170 });
    const k = store.get("tvm", "IDX_KOSPI"), z = M?.[k]; if (!z) return;
    const i0 = z.d.findIndex(x => x >= d[0]), zd = z.d.slice(Math.max(0, i0)), zv = z.v.slice(Math.max(0, i0));
    lineChart($("#tvmc"), zd, [{ label: REACT.find(q => q[0] === k)[1], data: zv, color: css("--ink"), width: 1.5 }], { height: 150, marks: [[d.at(-1), css("--faint"), "최근 발표"]] }); };
  const detail = e => { if (e[1] === "tv") return detailTv(e); const I = EVINFO[e[1]], n = evDD(e[0], today);
    return `<div style="border:1px solid var(--rule);border-left:4px solid ${EVCOL[e[1]]};padding:12px 14px">
      <div><b style="font-size:16px">${esc(e[2])}</b></div><div class="small muted">${e[0]}${["fomc", "cpi", "nfp"].includes(e[1]) ? " (미국 현지)" : ""} · ${n === 0 ? "오늘" : n > 0 ? "D-" + n : -n + "일 지남"}</div>
      ${e[3] ? `<div class="small" style="margin-top:4px">${esc(e[3])}</div>` : ""}
      <p style="margin:10px 0 6px">${I.what}</p>
      <div><b>볼 것</b><ul style="margin:4px 0 8px 18px;padding:0">${I.watch.map(w => `<li>${w}</li>`).join("")}</ul></div>
      <p style="margin:0"><b>시장 반응</b> ${I.react}</p></div>`; };
  const cal = () => { const [y, m] = ym.split("-").map(Number), pad = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const by = {}; shown().forEach(e => { if (e[0].startsWith(ym)) (by[+e[0].slice(8)] ||= []).push(e); });
    let cells = ""; for (let i = 0; i < pad; i++) cells += "<div></div>";
    for (let d = 1; d <= days; d++) { const ds = `${ym}-${String(d).padStart(2, "0")}`, es = by[d] || [];
      cells += `<div style="min-height:74px;border:1px solid var(--rule);padding:3px 4px;overflow:hidden;${ds === today ? "outline:2px solid var(--accent);" : ""}${ds < today ? "opacity:.55;" : ""}">
        <div class="small muted">${d}</div>${es.map(e => `<div data-i="${evs.indexOf(e)}" title="${esc(e[2])}" style="cursor:pointer;font-size:11.5px;line-height:1.3;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:${e[1] === "tv" ? "var(--ink)" : EVCOL[e[1]]};${pick === e ? "font-weight:700;text-decoration:underline;" : ""}">${e[1] === "tv" ? `<span class="muted">${e[4].time} ${{ US: "美", KR: "韓", CN: "中", JP: "日", EU: "EU", DE: "獨", GB: "英" }[e[4].country] || e[4].country}</span> ${esc(TVKO[e[4].title] || e[4].title)}` : "● " + esc(e[2])}</div>`).join("")}</div>`; }
    return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><button class="more" data-mv="-1">◀ 이전 달</button><b style="font-size:16px">${y}년 ${m}월</b><button class="more" data-mv="1">다음 달 ▶</button></div>
      <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px">${["일", "월", "화", "수", "목", "금", "토"].map(w => `<div class="small muted" style="padding:2px 4px">${w}</div>`).join("")}${cells}</div>`; };
  const draw = () => {
    el.innerHTML = evFilterHTML(on) + (on.includes("tv") ? evTvFilterHTML() : "") + `<div class="grid" style="align-items:start">
        <div style="min-width:0">${cal()}</div>
        <aside style="display:grid;gap:16px;align-content:start;min-width:0">${pick ? detail(pick) : `<p class="small muted">일정을 누르면 해석이 나와요.</p>`}
          <div><div class="kicker">다가오는 일정</div>${evListHTML(shown().filter(e => e[0] >= today && e[0] <= isoMinus(today, -75)).slice(0, 12), today, evs)}</div></aside></div>
      <p class="small muted" style="margin-top:10px">출처: 연준(FOMC), 미국 노동통계국(CPI·고용), 한국은행(금통위), 경제지표는 TradingView(2시간마다 갱신${tvUpdated ? ", 마지막 " + tvUpdated : ""}). 옵션 만기는 매달 둘째 목요일로 계산(휴장이면 앞당겨짐).</p>
      ${stale.length ? `<p class="small down">${stale.join(", ")} 다음 해 일정이 아직 안 들어갔어요</p>` : ""}`;
    destroyCharts(); tvCharts();
  };
  el.addEventListener("click", e => { const c = e.target.closest("[data-cmp]"); if (c) { e.preventDefault(); store.set("cmpk", c.dataset.cmp); store.set("caltab", "cmp"); return viewCal(app); }
    const t = e.target.closest("[data-i],[data-mv],#evf button,#evtvc button,#evtvi button,#tvm button"); if (!t) return;
    if (t.closest("#tvm")) { store.set("tvm", t.dataset.k); }
    else if (evTvClick(t)) {}
    else if (t.dataset.i != null) { pick = evs[+t.dataset.i]; ym = pick[0].slice(0, 7); }
    else if (t.dataset.mv) { const [y, m] = ym.split("-").map(Number); ym = new Date(Date.UTC(y, m - 1 + +t.dataset.mv, 1)).toISOString().slice(0, 7); }
    else { const k = t.dataset.k, i = on.indexOf(k); i >= 0 ? on.splice(i, 1) : on.push(k); store.set("evon2", on); }
    draw(); });
  draw();
}
/* 연속 등락: 지금 몇 일째인지 + 과거에 같은 길이에 처음 닿은 날 이후 수익률 */
function streakStats(d, v, from = "1990-01-01") {
  const n = v.length, run = new Int16Array(n);   // +k: k일 연속 상승, -k: 연속 하락
  for (let i = 1; i < n; i++) { const r = v[i] / v[i - 1] - 1; run[i] = r > 0 ? (run[i - 1] > 0 ? run[i - 1] + 1 : 1) : r < 0 ? (run[i - 1] < 0 ? run[i - 1] - 1 : -1) : 0; }
  const fwd = (i, h) => i + h < n ? (v[i + h] / v[i] - 1) * 100 : null;
  const agg = xs => { const a = xs.filter(x => x != null); if (!a.length) return null; const s = [...a].sort((x, y) => x - y);
    return { n: a.length, up: a.filter(x => x > 0).length / a.length * 100, avg: a.reduce((p, q) => p + q, 0) / a.length, med: s[s.length >> 1] }; };
  const at = k => { const ev = []; for (let i = 1; i < n; i++) if (d[i] >= from && run[i] === k) ev.push(i); return ev; };
  const row = k => { const ev = at(k); return { k, ev, cnt: ev.length, more: ev.filter(i => i + 1 < n && Math.sign(run[i + 1]) === Math.sign(k)).length,
    f1: agg(ev.map(i => fwd(i, 1))), f5: agg(ev.map(i => fwd(i, 5))), f20: agg(ev.map(i => fwd(i, 20))) }; };
  return { cur: run[n - 1], row };
}
async function drawStreak() {
  const el = $("#streak"); if (!el) return;
  const M = await loadX("macro").catch(() => null), k = store.get("stkm", "IDX_KOSPI"), ser = M?.[k];
  if (!$("#streak")) return;
  if (!ser) { el.innerHTML = NODATA("지수"); return; }
  const { d, v } = ser, { cur, row } = streakStats(d, v), nm = k === "IDX_KOSPI" ? "코스피" : "코스닥", dir = cur < 0 ? "하락" : "상승", sg = cur < 0 ? -1 : 1;
  const show = Math.max(1, Math.abs(cur)), lens = [...new Set([3, 4, 5, 6, 7, 8, 9, 10, show])].sort((a, b) => a - b);
  const now = row(sg * show), f = (a, key) => a && a[key] != null ? (key === "up" ? a.up.toFixed(0) + "%" : fmtPct(a[key])) : "–";
  const cell = a => a ? `<td class="${cls(a.avg)}">${fmtPct(a.avg)}<small> · 오를 확률 ${a.up.toFixed(0)}%</small></td>` : "<td>–</td>";
  el.innerHTML = `<div class="stats">
      <div><div class="lbl">${nm} 지금</div><div class="v ${cur < 0 ? "down" : cur > 0 ? "up" : ""}">${cur ? Math.abs(cur) + "일 연속 " + dir : "보합"}</div><div class="s">${d.at(-1)} 종가까지</div></div>
      <div><div class="lbl">1990년 이후 같은 경우</div><div class="v">${now.cnt}번</div><div class="s">그중 하루 더 ${dir}: ${now.more}번 (${now.cnt ? (now.more / now.cnt * 100).toFixed(0) : 0}%)</div></div>
      <div><div class="lbl">다음 날</div><div class="v ${cls(now.f1?.avg)}">${f(now.f1, "avg")}</div><div class="s">오를 확률 ${f(now.f1, "up")} · 중간값 ${f(now.f1, "med")}</div></div>
      <div><div class="lbl">1주 뒤 (5거래일)</div><div class="v ${cls(now.f5?.avg)}">${f(now.f5, "avg")}</div><div class="s">오를 확률 ${f(now.f5, "up")}</div></div>
      <div><div class="lbl">1개월 뒤 (20거래일)</div><div class="v ${cls(now.f20?.avg)}">${f(now.f20, "avg")}</div><div class="s">오를 확률 ${f(now.f20, "up")}</div></div></div>
    <div class="tablewrap"><table><thead><tr><th>연속 ${dir}</th><th>횟수</th><th>하루 더</th><th>다음 날 평균</th><th>1주 뒤</th><th>1개월 뒤</th></tr></thead><tbody>
      ${lens.map(L => { const r = row(sg * L); return `<tr${L === show ? ' style="background:color-mix(in srgb, var(--accent) 12%, transparent)"' : ""}><td class="name">${L}일${L === show ? " ← 지금" : ""}</td><td>${r.cnt}</td><td>${r.cnt ? (r.more / r.cnt * 100).toFixed(0) + "%" : "–"}</td>${cell(r.f1)}${cell(r.f5)}${cell(r.f20)}</tr>`; }).join("")}
    </tbody></table></div>
    <p class="small muted">${show}일째 연속 ${dir}에 처음 닿은 날 종가 기준. 최근 사례: ${now.ev.slice(-6).reverse().map(i => d[i]).join(" · ") || "없음"}. 표본이 적으면(10번 미만) 참고만 하세요.</p>`;
}
function alignMacro(M, keys, start) {
  const set = new Set(); keys.forEach(k => M[k]?.d.forEach(d => d >= start && set.add(d)));
  const d = [...set].sort();
  const cols = keys.map(k => { const s = M[k]; if (!s) return d.map(() => null); const m = new Map(s.d.map((x, i) => [x, s.v[i]])); return d.map(x => m.has(x) ? m.get(x) : null); });
  return { d, cols };
}
const MRANGE = [["1Y", "1년", 1], ["3Y", "3년", 3], ["5Y", "5년", 5], ["10Y", "10년", 10], ["ALL", "전체", 60]];
function lastOf(M, k) { const s = M?.[k]; return s && s.v.length ? s.v[s.v.length - 1] : null; }
function chgOf(M, k, n) { const s = M?.[k]; if (!s || s.v.length <= n) return null; return s.v[s.v.length - 1] - s.v[s.v.length - 1 - n]; }

function viewFlow(app) {
  const mk = store.get("flowmkt", "KOSPI"), mr = store.get("mrange", "3Y");
  app.innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:22px">
    <div><div class="kicker">수급 · 파생 · 매크로</div><h2>돈이 어디로 움직이나</h2>
      <p class="small muted">투자자별 순매수, 레버리지 ETF, 옵션 감마(숏 감마), 변동성, 달러·금리·유동성을 한 화면에서 봐요.</p></div>
    <div id="pbar"></div>
    <section class="block"><div class="kicker">1 · 투자자별 순매수 <span class="tabs" id="fmkt" style="display:inline-flex;margin-left:8px">${["KOSPI", "KOSDAQ"].map(k => `<button data-k="${k}" class="${k === mk ? "on" : ""}">${k === "KOSPI" ? "코스피" : "코스닥"}</button>`).join("")}</span></div>
      <div id="f1"><p class="loading">불러오는 중…</p></div></section>
    <section class="block"><div class="kicker">2 · 레버리지 · 인버스 ETF</div><div id="f2"><p class="loading">불러오는 중…</p></div></section>
    <section class="block"><div class="kicker">3 · 코스피200 옵션 감마 (숏 감마)</div><div id="f3"><p class="loading">불러오는 중…</p></div></section>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:2px solid var(--rule-strong);padding-top:14px">
      <div class="kicker" style="margin:0">매크로 기간</div>
      <span class="tabs" id="mrange">${MRANGE.map(([k, l]) => `<button data-k="${k}" class="${k === mr ? "on" : ""}">${l}</button>`).join("")}</span></div>
    <section class="block"><div class="kicker">4 · 변동성</div><div id="f4"></div></section>
    <section class="block"><div class="kicker">5 · 달러 · 환율</div><div id="f5"></div></section>
    <section class="block"><div class="kicker">6 · 금리 · 유동성</div><div id="f6"></div></section>
  </div>`;
  let curStart = null;
  tabsBind("#fmkt", k => { store.set("flowmkt", k); renderFlow(curStart); });
  tabsBind("#mrange", k => { store.set("mrange", k); renderFlow(curStart); });
  $("#pbar").replaceWith(periodBar(start => { curStart = start; renderFlow(start); }));
}
const NODATA = what => `<div class="empty small">${what} 데이터가 아직 없어요. 집 PC가 다음 업데이트(kospi.bat) 때 받아와요.</div>`;
async function renderFlow(start) {
  if (!start) return;
  destroyCharts();
  const [F, E, M, G] = await Promise.all(["flow", "etf", "macro", "gex"].map(loadX));
  if (!$("#f1")) return;
  /* 1. 투자자별 */
  const mk = store.get("flowmkt", "KOSPI");
  if (F && F.m[mk]) {
    const b = Math.max(0, baseIndex(F.d, start) + 1), d = F.d.slice(b), m = F.m[mk];
    const keys = ["외국인합계", "기관합계", "개인", "연기금", "금융투자", "투신"].filter(k => m[k]);
    const sum = k => m[k].slice(b).reduce((a, v) => a + (v || 0), 0);
    const cum = k => { let s = 0; return m[k].slice(b).map(v => (s += v || 0)); };
    const lbl = k => k.replace("합계", "");
    $("#f1").innerHTML = `<div class="stats">${keys.map(k => { const v = sum(k), v5 = m[k].slice(-5).reduce((a, x) => a + (x || 0), 0);
        return `<div><div class="lbl">${lbl(k)}</div><div class="v ${cls(v)}">${fmtJo(v)}</div><div class="s">최근 5일 ${fmtJo(v5)}</div></div>`; }).join("")}</div>
      <div class="two"><div class="chart"><h3>누적 순매수 <small>${d[0] || ""}부터, 억원</small></h3><div id="fc1"></div></div>
        <div class="chart"><h3>최근 20거래일 <small>억원</small></h3><div id="ft1"></div></div></div>`;
    const pal = { 외국인합계: css("--accent"), 기관합계: "#b07d2a", 개인: css("--ink"), 연기금: "#7a52b3", 금융투자: css("--faint"), 투신: "#2f8f9d" };
    lineChart($("#fc1"), d, keys.map(k => ({ label: lbl(k), data: cum(k), color: pal[k], width: k === "연기금" || k === "외국인합계" ? 2.2 : 1.4,
      dash: ["금융투자", "투신"].includes(k) ? [4, 3] : undefined })), { compact: true, ref: 0, height: 280 });
    const n = F.d.length, rows = [];
    for (let i = n - 1; i >= Math.max(0, n - 20); i--) rows.push(`<tr><td class="name">${F.d[i].slice(5)}</td>${keys.slice(0, 4).map(k => `<td class="${cls(m[k][i])}">${fmtNum(m[k][i])}</td>`).join("")}</tr>`);
    $("#ft1").innerHTML = `<div class="tablewrap" style="max-height:300px;overflow:auto"><table><thead><tr><th>날짜</th>${keys.slice(0, 4).map(k => `<th>${lbl(k)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  } else $("#f1").innerHTML = NODATA("투자자별 순매수");

  /* 2. ETF */
  if (E) {
    const b = Math.max(0, baseIndex(E.d, start)), d = E.d.slice(b);
    const agg = k => d.map((_, i) => E.list.filter(x => x.k === k).reduce((a, x) => a + (x.aum[b + i] || 0), 0));
    const cumf = k => { let s = 0; return d.map((_, i) => i === 0 ? 0 : (s += E.list.filter(x => x.k === k).reduce((a, x) => a + (x.flow[b + i] || 0), 0))); };
    const lev = agg("lev"), inv = agg("inv"), lf = cumf("lev"), vf = cumf("inv");
    const rows = E.list.map(x => { const f = x.flow.slice(b + 1).reduce((a, v) => a + (v || 0), 0), a0 = x.aum[b], a1 = x.aum.at(-1);
      return { id: x.t, n: x.n, k: x.k === "lev" ? "레버리지" : "인버스", aum: a1, chg: a0 ? (a1 / a0 - 1) * 100 : null, f, f5: x.flow.slice(-5).reduce((a, v) => a + (v || 0), 0) }; });
    $("#f2").innerHTML = `<div class="stats">
        <div><div class="lbl">레버리지 순자산</div><div class="v">${fmtJo(lev.at(-1)).replace("+", "")}</div><div class="s">기간 자금 ${fmtJo(lf.at(-1))}</div></div>
        <div><div class="lbl">인버스 순자산</div><div class="v">${fmtJo(inv.at(-1)).replace("+", "")}</div><div class="s">기간 자금 ${fmtJo(vf.at(-1))}</div></div>
        <div><div class="lbl">레버리지 ÷ 인버스</div><div class="v">${inv.at(-1) ? (lev.at(-1) / inv.at(-1)).toFixed(2) + "배" : "–"}</div><div class="s">기간 시작 ${inv[0] ? (lev[0] / inv[0]).toFixed(2) + "배" : "–"}</div></div></div>
      <div id="f2rb"></div>
      <div class="two"><div class="chart"><h3>순자산 <small>억원</small></h3><div id="fc2a"></div></div>
        <div class="chart"><h3>누적 자금 유출입 <small>상장주식수 변화 × NAV, 억원</small></h3><div id="fc2b"></div></div></div><div id="ft2"></div>`;
    lineChart($("#fc2a"), d, [{ label: "레버리지", data: lev, color: css("--up"), width: 2 }, { label: "인버스", data: inv, color: css("--down"), width: 2 }], { compact: true });
    lineChart($("#fc2b"), d, [{ label: "레버리지", data: lf, color: css("--up"), width: 2 }, { label: "인버스", data: vf, color: css("--down"), width: 2 }], { compact: true, ref: 0 });
    // 장 마감 기계적 매매 추정: 레버리지·인버스는 매일 배율을 맞추려고 지수 방향으로 사고팖 = 전일 순자산 × L(L−1) × 지수 등락률
    const lev2 = nm => /인버스\s*2X/i.test(nm) ? -2 : /인버스/.test(nm) ? -1 : /2X|레버리지/i.test(nm) ? 2 : 1;
    const ixmap = {}; ["IDX_KOSPI", "IDX_KOSDAQ"].forEach(k => { const z = M?.[k]; if (z) { const mp = new Map(); for (let i = 1; i < z.d.length; i++) mp.set(z.d[i], z.v[i] / z.v[i - 1] - 1); ixmap[k] = mp; } });
    const rb = E.d.map((dt, i) => i === 0 ? null : E.list.reduce((a, x) => { const L = lev2(x.n), r = ixmap[/코스닥/.test(x.n) ? "IDX_KOSDAQ" : "IDX_KOSPI"]?.get(dt), a0 = x.aum[i - 1];
      return r == null || !a0 ? a : a + a0 * L * (L - 1) * r; }, 0));
    const per1 = E.list.reduce((a, x) => { const L = lev2(x.n); return a + (x.aum.at(-1) || 0) * L * (L - 1) * 0.01; }, 0), rbNow = rb.at(-1);
    $("#f2rb").innerHTML = `<div class="stats">
        <div><div class="lbl">최근 장 마감 기계적 매매 (추정)</div><div class="v ${cls(rbNow)}">${rbNow != null ? fmtJo(rbNow) : "–"}</div><div class="s">${E.d.at(-1)} · +면 매수, −면 매도 (주로 선물)</div></div>
        <div><div class="lbl">지수 1% 움직이면</div><div class="v">${fmtJo(per1).replace("+", "")}</div><div class="s">그 방향으로 장 마감에 기계적으로 사고팔 규모</div></div>
        <div><div class="lbl">최근 5일 합계</div><div class="v ${cls(rb.slice(-5).reduce((a, v) => a + (v || 0), 0))}">${fmtJo(rb.slice(-5).reduce((a, v) => a + (v || 0), 0))}</div><div class="s">하락 때 더 팔고 상승 때 더 사는 쪽 → 추세를 키움</div></div></div>
      <div class="chart"><h3>레버리지·인버스 ETF 리밸런싱 추정 <small>억원 · 전일 순자산 × 배율(배율−1) × 지수 등락률</small></h3><div id="fc2r"></div></div>`;
    lineChart($("#fc2r"), d, [{ label: "기계적 매매", data: rb.slice(b), color: css("--accent"), width: 1.8 }], { ref: 0, height: 200 });
    sortableTable($("#ft2"), [
      { k: "n", l: "ETF", f: r => `<td class="name">${esc(r.n)}<small>${r.id} · ${r.k}</small></td>` },
      { k: "aum", l: "순자산", f: r => `<td>${fmtJo(r.aum).replace("+", "")}</td>` },
      { k: "chg", l: "순자산 증감", f: r => pctCell(r.chg, 40) },
      { k: "f", l: "기간 유출입", f: r => `<td class="${cls(r.f)}">${fmtJo(r.f)}</td>` },
      { k: "f5", l: "최근 5일", f: r => `<td class="${cls(r.f5)}">${fmtJo(r.f5)}</td>` },
    ], rows, { key: "aum" });
  } else $("#f2").innerHTML = NODATA("ETF");

  /* 3. 감마 */
  if (G) {
    const neg = G.total < 0, below = G.flip != null && G.spot < G.flip;
    $("#f3").innerHTML = `<div class="stats">
        <div><div class="lbl">코스피200</div><div class="v">${G.spot.toFixed(2)}</div><div class="s">${G.date} · 옵션 ${G.n}종목</div></div>
        <div><div class="lbl">딜러 감마 (1% 움직일 때)</div><div class="v ${neg ? "down" : "up"}">${fmtJo(G.total)}</div><div class="s">${neg ? "숏 감마: 하락 때 팔고 상승 때 사는 쪽 → 변동 키움" : "롱 감마: 반대로 매매 → 변동 줄임"}</div></div>
        <div><div class="lbl">감마 전환 지점</div><div class="v">${G.flip != null ? G.flip.toFixed(1) : "–"}</div><div class="s">${G.flip != null ? (below ? "지금 그 아래 (숏 감마 구간)" : "지금 그 위") + ` · 거리 ${fmtPct((G.flip / G.spot - 1) * 100)}` : "±15% 안에 없음"}</div></div>
        <div><div class="lbl">콜 / 풋 벽</div><div class="v">${G.callWall ?? "–"} / ${G.putWall ?? "–"}</div><div class="s">감마가 가장 몰린 행사가</div></div>
        <div><div class="lbl">ATM 내재변동성</div><div class="v">${G.atmIV != null ? G.atmIV.toFixed(1) + "%" : "–"}</div><div class="s">근월물 기준 근사</div></div></div>
      <div class="two"><div class="chart"><h3>감마 프로필 <small>지수가 여기로 가면 딜러 감마는? (억원/1%)</small></h3><div id="fg1"></div></div>
        <div class="chart"><h3>행사가별 감마 <small>콜(+) · 풋(−), 억원/1%</small></h3><div id="fg2"></div></div></div>
      <div class="chart"><h3>추이 <small>딜러 감마(억원) · 코스피200</small></h3><div id="fg3"></div></div>
      <p class="small muted">가정: 딜러는 콜을 사고(+) 풋을 판(−) 상태, 근월~원월 모든 만기 합산, 각 종목 종가로 역산한 내재변동성 사용. 실제 딜러 포지션은 공개되지 않아 방향은 추정이에요. 레버리지 ETF LP의 깊은 내가격 옵션처럼 숨은 감마는 반영되지 않아요.</p>`;
    xyChart($("#fg1"), G.profile.map(p => p[0]), [{ label: "딜러 감마", data: G.profile.map(p => p[1]), color: css("--accent"), width: 2,
      fill: "color-mix(in srgb, " + css("--accent") + " 10%, transparent)" }], { xfmt: v => v.toFixed(0), vline: [[G.spot, css("--ink"), "현재"], [G.flip, css("--down"), "전환"]] });
    xyChart($("#fg2"), G.strikes.map(s => s[0]), [{ label: "콜", data: G.strikes.map(s => s[3]), color: css("--up"), bars: true },
      { label: "풋", data: G.strikes.map(s => s[4]), color: css("--down"), bars: true }], { xfmt: v => v.toFixed(0), vline: [[G.spot, css("--ink"), "현재"]] });
    const h = G.history;
    if (h.length > 1) {
      lineChart($("#fg3"), h.map(x => x[0]), [{ label: "딜러 감마", data: h.map(x => x[2]), color: css("--accent"), width: 2 }], { compact: true, ref: 0, height: 180 });
      lineChart($("#fg3"), h.map(x => x[0]), [{ label: "코스피200", data: h.map(x => x[1]), color: css("--ink") }, { label: "감마 전환", data: h.map(x => x[3]), color: css("--down"), dash: [4, 3] }], { height: 180 });
    }
  } else $("#f3").innerHTML = NODATA("옵션");

  /* 4~6. 매크로 */
  if (!M) { ["#f4", "#f5", "#f6"].forEach(id => $(id).innerHTML = NODATA("매크로")); return; }
  const yrs = MRANGE.find(r => r[0] === store.get("mrange", "3Y"))[2], ms = isoMinus(S.meta.asof, Math.round(365.25 * yrs));
  const mchart = (el, keys, labels, opt = {}, colors = []) => {
    const { d, cols } = alignMacro(M, keys, ms);
    if (!d.length) { el.innerHTML = `<p class="small muted">데이터 없음</p>`; return; }
    lineChart(el, d, cols.map((c, i) => ({ label: labels[i], data: c, color: colors[i], width: i === 0 ? 2 : 1.5, dash: opt.dash?.[i] })), { compact: false, height: 220, ...opt });
  };
  const stat = (lbl, k, unit = "", n = 20, nd = 2, per = "거래일") => { const v = lastOf(M, k), c = chgOf(M, k, n);
    return `<div><div class="lbl">${lbl}</div><div class="v">${v == null ? "–" : v.toFixed(nd) + unit}</div><div class="s">${c == null ? "" : `${n}${per} 전보다 ${c > 0 ? "+" : ""}${c.toFixed(nd)}`} · ${M._asof?.[k] || ""}</div></div>`; };
  // 내재변동성(VKOSPI) vs 실현변동성(코스피 20일, 연율)
  const KX = M.IDX_KOSPI, rv = new Map();
  if (KX) for (let i = 20; i < KX.v.length; i++) { let s = 0, s2 = 0; for (let j = i - 19; j <= i; j++) { const r = Math.log(KX.v[j] / KX.v[j - 1]); s += r; s2 += r * r; }
    rv.set(KX.d[i], Math.sqrt(Math.max(0, (s2 - s * s / 20) / 19) * 252) * 100); }
  const vk = M.VKOSPI, ivd = vk ? vk.d.filter(x => rv.has(x)) : [], ivv = ivd.map(x => vk.v[vk.d.indexOf(x)]), rvv = ivd.map(x => rv.get(x));
  const ivNow = ivv.at(-1), rvNow = rvv.at(-1), prem = ivNow != null && rvNow != null ? ivNow - rvNow : null;
  $("#f4").innerHTML = `<div class="stats">${stat("VIX", "VIXCLS")}${stat("VKOSPI", "VKOSPI")}
      <div><div class="lbl">코스피 실현변동성 20일</div><div class="v">${rvNow != null ? rvNow.toFixed(1) + "%" : "–"}</div><div class="s">실제로 움직인 폭, 연율</div></div>
      <div><div class="lbl">공포 프리미엄</div><div class="v ${prem > 0 ? "up" : "down"}">${prem != null ? (prem > 0 ? "+" : "") + prem.toFixed(1) + "%p" : "–"}</div><div class="s">VKOSPI − 실현변동성. 클수록 앞으로 더 흔들릴 거라고 비싸게 값을 매김</div></div>
      <div><div class="lbl">하루 예상 변동폭</div><div class="v">${ivNow != null ? "±" + (ivNow / Math.sqrt(252)).toFixed(2) + "%" : "–"}</div><div class="s">VKOSPI ÷ √252 · 하루 동안 위아래로 이만큼 (1표준편차, 약 68%)</div></div></div>
    <div class="two"><div class="chart"><h3>VIX · VKOSPI</h3><div id="fm4"></div></div>
      <div class="chart"><h3>내재 vs 실현 변동성 <small>VKOSPI · 코스피 20일 실현, 연율 %</small></h3><div id="fm4b"></div></div></div>`;
  mchart($("#fm4"), ["VIXCLS", "VKOSPI"], ["VIX", "VKOSPI"], {}, [css("--ink"), css("--up")]);
  if (ivd.length > 2) lineChart($("#fm4b"), ivd, [{ label: "VKOSPI (내재)", data: ivv, color: css("--up"), width: 2 }, { label: "실현 20일", data: rvv, color: css("--ink"), width: 1.6 },
    { label: "프리미엄", data: ivv.map((x, i) => x - rvv[i]), color: css("--faint"), dash: [4, 3] }], { height: 220, ref: 0 });
  else $("#fm4b").innerHTML = `<p class="small muted">VKOSPI 데이터가 쌓이면 보여요</p>`;
  const dk = M.DXY ? "DXY" : "DTWEXBGS";
  $("#f5").innerHTML = `<div class="stats">${stat(dk === "DXY" ? "달러인덱스" : "달러(브로드)", dk)}${stat("달러 변동성 10일", "DXY_RV10", "%")}${stat("원/달러", "DEXKOUS", "", 20, 1)}${stat("엔/달러", "DEXJPUS", "", 4, 2, "주")}</div>
    <div class="two"><div class="chart"><h3>달러 ${dk === "DXY" ? "인덱스" : "(브로드)"}</h3><div id="fm5a"></div></div>
      <div class="chart"><h3>달러 실현변동성 <small>연율 %, 10일 · 30일</small></h3><div id="fm5b"></div></div></div>
    <div class="two"><div class="chart"><h3>원/달러</h3><div id="fm5c"></div></div>
      <div class="chart"><h3>엔/달러 장기 <small>1971년~, 주간 · 기간 선택과 무관</small></h3><div id="fm5d"></div></div></div>`;
  mchart($("#fm5a"), [dk], [dk === "DXY" ? "DXY" : "브로드 달러"], {}, [css("--ink")]);
  mchart($("#fm5b"), ["DXY_RV10", "DXY_RV30"], ["10일", "30일"], {}, ["#c03fa0", css("--ink")]);
  mchart($("#fm5c"), ["DEXKOUS"], ["원/달러"], {}, [css("--accent")]);
  if (M.DEXJPUS) lineChart($("#fm5d"), M.DEXJPUS.d, [{ label: "엔/달러", data: M.DEXJPUS.v, color: css("--ink") }],
    { height: 220, marks: [["1985-09-22", css("--down"), "플라자 합의 1985.9"]] });
  $("#f6").innerHTML = `<div class="stats">${stat("미국 2년", "DGS2", "%")}${stat("2년 − 5년 BEI", "REAL2", "%p")}${stat("5년 실질금리", "DFII5", "%")}${stat("10년−3개월 1년 변화", "CURVE_CHG", "bp", 20, 0)}${stat("연준 순유동성", "NETLIQ", "", 4, 0, "주").replace("</div><div class=\"s\">", "<small>십억$</small></div><div class=\"s\">")}${stat("M2 증가율", "M2YOY", "%", 1, 1, "개월")}</div>
    <div class="two"><div class="chart"><h3>미국 2년 금리 vs 기대인플레 <small>%, 2년 − 5년 BEI는 실질금리 근사</small></h3><div id="fm6a"></div></div>
      <div class="chart"><h3>3개월·10년 금리차 1년 변화 <small>bp, 커질수록 긴축 완화 쪽</small></h3><div id="fm6b"></div></div></div>
    <div class="two"><div class="chart"><h3>연준 순유동성 <small>총자산 − TGA − 역레포, 십억 달러</small></h3><div id="fm6c"></div></div>
      <div class="chart"><h3>미국 M2 증가율 <small>전년 대비 %</small></h3><div id="fm6d"></div></div></div>
    <p class="small muted">출처: FRED(미 연준 경제데이터), Yahoo(DXY), KRX(VKOSPI). 블룸버그 글로벌 통화공급(.GLMOSUPP)과 2년 BEI는 무료 데이터가 없어 미국 순유동성·M2, 5년 BEI로 대신했어요.</p>`;
  mchart($("#fm6a"), ["DGS2", "T5YIE", "REAL2"], ["2년 금리", "5년 BEI", "2년 − BEI"], { dash: [null, [4, 3], null] }, [css("--ink"), css("--faint"), css("--accent")]);
  mchart($("#fm6b"), ["CURVE_CHG"], ["1년 변화"], { ref: 0 }, [css("--ink")]);
  mchart($("#fm6c"), ["NETLIQ", "WALCL"], ["순유동성", "연준 총자산"], { dash: [null, [4, 3]] }, [css("--accent"), css("--faint")]);
  mchart($("#fm6d"), ["M2YOY"], ["M2 YoY"], { ref: 0 }, [css("--ink")]);
}
