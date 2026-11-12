# 코스피 데일리 — 유지보수 메모

개인용 한국 주식 분석 사이트(GitHub Pages). 사용자는 개발자가 아니고 이 저장소는 Claude 만 고친다.
사용자에게는 한국어로, 쉬운 말로, 한 일과 확인한 것 위주로 짧게 답한다. 고치면 바로 커밋·푸시(main)까지 한다.

## 전체 흐름

```
집 PC (Windows·Anaconda, 로그온 때 + 매일 18시)        이 저장소 = 사이트 (Pages: main 브랜치 루트)
  kospi.bat / kospi_update.bat                          index.html      로더. web/* 를 매번 no-cache 로 받아 실행 (빌드 없음)
    updater.py   저장소의 dashboard/*.py 로 자기 갱신     web/*.js, style.css   화면 (아래 표)
    collect.py   KRX(pykrx) → kospi.db                  journal/index.html    투자일지 (iframe 으로 #journal 에)
      reports.run()      네이버 리포트 → Firebase         data/**               PC가 올리는 공개 데이터 (손으로 고치지 않음)
      flows.update_all() 수급·파생·매크로 → kospi.db      dashboard/            집 PC 코드
      publish_site.main() build_site → data/** 커밋      .github/workflows/reports.yml   리포트 받기 (PC 없이: 사이트 버튼·평일 5번)
Firebase (Auth + Firestore) = 개인 데이터만: 로그인(구글), 관심종목, 리포트, 종목 수급, 투자일지, 그린 선, 사이트 버튼용 토큰
```

- 공개 데이터(data/)에는 개인 것이 없다. 관심종목과 거기서 나온 것(리포트·종목 수급)은 Firestore 에만 두고 로그인해야 읽힌다.
- 개인 정보(이메일·실명·PC 경로·KRX 아이디·다른 프로젝트 이름)는 코드·화면·로그·커밋에 남기지 않는다.
  GitHub 아이디는 주소라서 예외, Firebase 웹 설정값(web/core.js, journal/index.html)은 공개돼도 되는 값.

## 화면 (web/) — 한 전역 스코프를 나눠 쓰는 일반 스크립트 5개, 읽는 순서대로

| 파일 | 내용 |
|---|---|
| core.js | 도구($·fmt·store), 상태 `S`, 로그인 `FB`(fbInit·관심종목), 데이터 읽기(loadChunk·loadRange·periodData·capIndex), 기간 바, lineChart·xyChart·sortableTable·검색, 추세 밴드(fitBand·bandControls), 전 종목 지표 `universe()`(+퀀트 점수·시장 체력) |
| stock.js | 종목 차트: candleView(일·주·월봉, 휠·드래그, 보조지표, 그린 선), 선/수익률 비교, PER·PBR 밴드, 종목 수급, viewStock·renderStock |
| market.js | 홈(viewHome·지수 추세·시장 체력·내 선 알림), 섹터(RRG), 수급·파생·매크로(viewFlow) |
| lists.js | 스크리너(SF 필드·SPRESET), 관심종목, 리포트(prepReports·목표가 레이더·[지금 리포트 받기]) |
| main.js | 화면 틀 `SHELL`(머리글·메뉴), 투자일지 iframe, ROUTES·route, boot |

- 새 메뉴: main.js 의 SHELL 에 링크 + ROUTES 에 view 함수. view 는 `app.innerHTML` 을 채우고, 로그인 상태에 따라 다시 그릴 함수는 `FB.listeners.push(fn); FB.ready.then(fn)`.
- 차트는 uPlot 1.6.30 (CDN). 만든 차트는 `S.charts` 에 넣어야 화면 이동 때 지워진다. 색은 CSS 변수(`css("--up")`): 오르면 빨강, 내리면 파랑.
- 기간 수익률의 기준 = 시작일 이하 마지막 거래일 종가 (periodData). 캔들은 그 다음 봉부터 보여 줘서 카드와 숫자가 같다.
- localStorage 키는 `kd_` 로 시작 (store.get/set). 사용자 설정을 지우지 않게 키 이름을 바꾸지 않는다.
- index.html 은 고칠 일이 거의 없다. 브라우저가 10분쯤 기억하므로 화면 틀·메뉴처럼 바뀔 수 있는 것은 main.js 에 둔다.

## 데이터 (data/, build_site.py · flowsite.py 가 만듦)

- `meta.json` {asof, first, chunks, vchunks, ochunks, obuckets, extra, built} — 화면은 이것부터 읽고 나머지 주소에 `?v=built` 를 붙인다.
- `px|vol/{Y2019|M2026-11}.json` {d, t, c[[...]]} 종가·거래량 전 종목. 지난 해는 연 파일, 올해는 월 파일.
- `ohlc/{0..15}/{Y|M}.json` {d,t,o,h,l,c,v}, `fund/{0..15}/…` {d,t,e,b}: 종목 하나만 볼 때 쓰는 묶음. 묶음 번호 = 종목코드 글자코드 합 % 16 (build_site.bucket = stock.js obucket).
- `stocks.json`, `home.json`, `flow|etf|macro|gex|fund_last.json`. 값이 없으면 null, 전부 null 인 배열은 null 하나.
- 형식을 바꾸면 화면(web)과 집 PC(dashboard)를 같은 커밋에 고치되, 집 PC가 새 형식으로 다시 올리기 전까지 옛 파일로도 화면이 깨지지 않게 한다.

## Firestore (규칙: 허용된 계정만 읽고 씀 — 규칙은 Firebase 콘솔에 있음)

`watchlist/{종목}` {name, market, favorite, track_reports, group, added} · `journal`, `journal_images` (투자일지) ·
`state/reports` {json 문자열: [{nid,date,t,broker,title,op,tp,pdf}], n, updated} · `state/report_job` {state, at, new, n, msg} ·
`state/sf_{종목}` {json} 종목 수급 · `state/drawings` {json} 차트에 그린 선 · `state/gh` {token} 사이트 버튼이 Actions 를 부를 때 쓰는 GitHub 토큰

## 집 PC 코드 (dashboard/) — 건드릴 때 꼭 지킬 것

- 집 PC는 `updater.py` 의 RAW 주소와 FILES 목록으로만 새 코드를 받는다. **dashboard/ 경로나 파일 이름을 바꾸지 않는다.**
  새 .py 를 추가하면 FILES 에 넣고, 첫 실행에서는 그 파일이 아직 없을 수 있으니(옛 updater 가 모름) 없어도 죽지 않게 한다.
  배치(.bat)는 자동으로 안 바뀐다 (NEW_ONLY 는 없을 때만 생성). 배치가 부르는 이름: `updater.py`, `collect.py`, `reports.py`.
- 집 PC에 직접 들어가 볼 수 없는 때가 많다. 실패해도 다음 단계가 돌게(collect.step), 화면 출력은 `last_run.log` 에도 남는다.
- pykrx 는 import/첫 요청 때 KRX 로그인을 한다. KRX·네이버는 요청 사이에 SLEEP 을 둔다 (줄이면 차단될 수 있음).
- GitHub 올리기는 git 없이 API 로: 바뀐 파일만, 1분 70개·1회 440개 제한(나머지는 다음 실행), 커밋 작성자는 site-bot.
  publish 는 data/** 만 올린다 (index.html·web 은 건드리지 않음). 원격에 남은 옛 파일은 지우지 않는다.
- `backfill_high_low` 는 예전에 고가·저가 없이 받은 날짜를 채우는 임시 작업(한 번에 700일). 다 채워지면 지워도 된다.
- .env (집 PC에만): KRX_ID, KRX_PW, FIREBASE_API_KEY, FIREBASE_PROJECT_ID, JOURNAL_EMAIL, JOURNAL_PASSWORD, GITHUB_TOKEN, DRIVE_EXPORT_DIR(DB 백업 폴더, 선택)
- 리포트 버튼: 집 PC가 `publish_site.setup_actions()` 로 저장소 Secrets 4개와 `state/gh` 토큰을 한 번 넣는다 (토큰에 Actions·Secrets 읽기·쓰기 권한 필요).

## 고친 뒤 확인 (둘 다 인터넷·로그인 없이 돈다)

```
python tools/smoke.py HEAD -v     # 화면: 모든 메뉴를 열어 JS 에러 확인 + HEAD 와 글자·픽셀 비교 (Playwright, 4분). 의도한 변경만 달라야 함
python tools/pc_test.py HEAD      # 집 PC: 가짜 KRX·네이버·Firebase 로 이틀치 실행, HEAD 와 DB·data·Firebase 결과 비교 (1~2분)
python -m pyflakes dashboard/*.py tools/*.py && for f in web/*.js; do node --check $f; done
```
- 화면을 바꿨으면 /tmp/smoke_now 의 스크린샷을 직접 본다. 이 환경에서는 실제 사이트(github.io)와 집 PC에 접속이 안 될 수 있으니, 직접 확인 못 한 것은 그렇다고 말한다.
- 푸시하면 1분쯤 뒤 사이트에 반영되고(.nojekyll, 빌드 없음), 사용자는 새로고침만 하면 된다.

## 알아 둘 것 · 남은 일

- 2026-11-13 이전의 집 PC 코드는 index.html·ver.json 도 올렸다. `Site data` 커밋이 index.html 을 바꾸거나 ver.json 을 다시 만들었으면
  집 PC가 옛 코드로 돈 것(updater 실패) → index.html 을 로더(2KB)로 되돌리고 ver.json 을 지운다. 작성자가 site-bot 인 data 커밋이 보이면 새 코드로 넘어온 것이라 이 줄은 지워도 된다.
- 저장소는 매일 data 커밋으로 연 0.3GB 쯤 커진다. 1GB 가까워지면 기록 정리(히스토리 다시 쓰기)가 필요하고, 되돌릴 수 없으니 사용자 확인을 받는다.
- 해가 바뀌면 px/vol/ohlc/fund 의 지난해 월 파일(M2026-*)이 연 파일로 합쳐진다. 옛 월 파일은 원격에 남는다(지우는 기능 없음).
- 리포트는 Firestore 문서 하나(1MB 제한, 넘으면 오래된 것부터 버림). 관심종목이 수십 개로 늘면 종목별 문서로 나눠야 한다.
- 사용자가 말해 둔 다음 단계: 실시간 가격, 리포트 PDF → LLM 요약 에이전트(섹터 → 종목 구조), 포트폴리오 손익, 실적 캘린더, 스크리너 백테스트.
- 문서(재구축 요청서 등)는 사용자가 요청할 때만 고친다.
