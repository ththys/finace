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
      <div class="two"><div class="chart"><h3>순자산 <small>억원</small></h3><div id="fc2a"></div></div>
        <div class="chart"><h3>누적 자금 유출입 <small>상장주식수 변화 × NAV, 억원</small></h3><div id="fc2b"></div></div></div><div id="ft2"></div>`;
    lineChart($("#fc2a"), d, [{ label: "레버리지", data: lev, color: css("--up"), width: 2 }, { label: "인버스", data: inv, color: css("--down"), width: 2 }], { compact: true });
    lineChart($("#fc2b"), d, [{ label: "레버리지", data: lf, color: css("--up"), width: 2 }, { label: "인버스", data: vf, color: css("--down"), width: 2 }], { compact: true, ref: 0 });
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
  $("#f4").innerHTML = `<div class="stats">${stat("VIX", "VIXCLS")}${stat("VKOSPI", "VKOSPI")}</div>
    <div class="chart"><h3>VIX · VKOSPI</h3><div id="fm4"></div></div>`;
  mchart($("#fm4"), ["VIXCLS", "VKOSPI"], ["VIX", "VKOSPI"], {}, [css("--ink"), css("--up")]);
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
