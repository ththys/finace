"use strict";
/* 틀: 투자일지(iframe) · 메뉴 이동 · 상단 요약 · 시작 */

/* ---------------- 틀 ---------------- */
/* ---------------- 투자일지 (같은 사이트의 journal/ 을 화면 안에) ---------------- */
function viewJournal(app) {
  const sub = location.hash.slice("#journal".length).replace(/^\//, "");
  app.innerHTML = `<iframe id="jf" class="jframe" title="투자일지" src="${JOURNAL}#/${sub}"></iframe>`;
}
window.addEventListener("message", e => {
  if (e.origin !== location.origin || !e.data) return;
  const f = $("#jf"); if (!f) return;
  if (e.data.type === "journal") {
    f.style.height = Math.max(640, e.data.h + 20) + "px";
    const want = "#journal" + (e.data.path || "").replace(/^#\/?/, "/").replace(/^\/$/, "");
    if (location.hash !== want) history.replaceState(null, "", want);
  } else if (e.data.type === "journal-top") window.scrollTo(0, 0);
});
const ROUTES = { journal: viewJournal, home: viewHome, sectors: viewSectors, screen: viewScreen, watch: viewWatch, flow: viewFlow, stock: viewStock, reports: viewReports };
document.addEventListener("keydown", e => { if (e.key === "Escape") S.onEsc?.(); });
function route() {
  const seg = location.hash.slice(1).split("/")[0].split("?")[0], k = ROUTES[seg] ? seg : "home";
  document.querySelectorAll("nav.menu a[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === k));
  destroyCharts(); window.scrollTo(0, 0); FB.listeners = []; S.bandPick = null; S.drawTool = null; S.onEsc = null;
  ROUTES[k]($("#app"));
}
function renderTape() {
  const h = S.home, m = h.market, b = m.breadth, tot = b.up + b.down + b.flat || 1;
  $("#tape").innerHTML = `
    <div class="cell"><span class="lbl">시장 · ${esc(m.name)}</span><span class="big ${cls(m.chg["1D"])}">${fmtPct(m.chg["1D"])}</span></div>
    ${sparkSVG(m.spark.v)}
    ${m.kq ? `<div class="cell"><span class="lbl">코스닥</span><span class="num ${cls(m.kq["1D"])}">${fmtPct(m.kq["1D"])}</span></div>` : ""}
    ${["1W", "1M", "3M", "YTD", "1Y"].map(k => `<div class="cell"><span class="lbl">${k === "1W" ? "1주" : k === "1M" ? "1개월" : k === "3M" ? "3개월" : k === "1Y" ? "1년" : k}</span><span class="num ${cls(m.chg[k])}">${fmtPct(m.chg[k])}</span></div>`).join("")}
    <div class="cell"><span class="lbl">상승 ${b.up} · 하락 ${b.down} · 보합 ${b.flat}</span>
      <span class="breadth"><i style="width:${b.up / tot * 100}%;background:var(--up)"></i><i style="width:${b.flat / tot * 100}%;background:var(--flat)"></i><i style="width:${b.down / tot * 100}%;background:var(--down)"></i></span></div>`;
  const d = new Date(h.asof + "T00:00:00"), wd = "일월화수목금토"[d.getDay()];
  $("#dateline").innerHTML = `<b>${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${wd})</b> 마감 기준<br>코스피 ${S.home.market.n?.KOSPI ?? ""} · 코스닥 ${S.home.market.n?.KOSDAQ ?? ""}종목 · 업데이트 ${esc(S.meta.built)}`;
}

/** 화면 틀 (머리글 · 시장 요약 줄 · 메뉴 · 본문 자리 · 바닥글) */
const SHELL = `<header class="wrap mast">
  <div class="mast-row">
    <h1>코스피 <span>데일리</span></h1>
    <div class="dateline" id="dateline"></div>
    <div class="user" id="user"></div>
  </div>
</header>
<div class="wrap tape" id="tape" aria-label="시장 요약"><span class="loading">불러오는 중…</span></div>
<nav class="menu" aria-label="메뉴"><div class="wrap"><div class="links">
  <a href="#home" data-r="home">홈</a>
  <span class="navsep" aria-hidden="true"></span>
  <span class="navgrp">종목</span>
  <a href="#screen" data-r="screen">스크리너</a>
  <a href="#stock" data-r="stock">종목 차트</a>
  <a href="#watch" data-r="watch">관심</a>
  <a href="#reports" data-r="reports">리포트</a>
  <span class="navsep" aria-hidden="true"></span>
  <span class="navgrp">시장</span>
  <a href="#sectors" data-r="sectors">섹터</a>
  <a href="#flow" data-r="flow">수급·매크로</a>
  <span class="navsep" aria-hidden="true"></span>
  <a href="#journal" data-r="journal">투자일지</a></div>
  <button type="button" id="themeBtn" class="themebtn" title="라이트/다크 모드 바꾸기">🌙</button>
  <div class="search gsearch"><input id="gq" placeholder="🔍 종목 검색" autocomplete="off" aria-label="종목 검색"><ul class="sugg" id="gsugg" hidden></ul></div>
</div></nav>
<main class="wrap" id="app"><p class="loading">불러오는 중…</p></main>
<footer class="wrap">
  KRX(pykrx) 일별 종가와 네이버 증권 리서치를 바탕으로 매일 자동으로 만들어요. 수정주가 기준이고, 코스피·코스닥 전 종목(우선주·스팩 제외)이고, 시장 지수는 코스피(또는 코스닥) 종목을 시가총액으로 가중한 값이에요. 투자 판단을 위한 참고 자료예요.
</footer>`;
async function boot() {
  document.body.innerHTML = SHELL;
  try {
    S.meta = await getJSON("meta.json");  // 먼저 받아야 나머지 주소에 데이터 버전이 붙음
    const [stocks, home] = await Promise.all([getJSON("stocks.json"), getJSON("home.json")]);
    Object.assign(S, { stocks, home, byT: Object.fromEntries(stocks.map(s => [s.t, s])) });
    renderTape(); fbInit();
    attachSearch($("#gq"), $("#gsugg"), openStock);
    $("#themeBtn")?.addEventListener("click", toggleTheme); applyTheme(document.documentElement.dataset.theme || "");
    S.reports = [];
    window.addEventListener("hashchange", route);
    route();
  } catch (e) {
    $("#app").innerHTML = `<div class="empty">데이터를 불러오지 못했어요: ${esc(e.message)}</div>`;
  }
}
window.openStock = openStock;
boot();
