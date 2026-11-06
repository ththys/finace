"""코스피 지표 대시보드
실행: streamlit run app.py
"""
import os
import subprocess
import sys

import altair as alt
import pandas as pd
import streamlit as st

APP_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(APP_DIR)

st.set_page_config(page_title="코스피 지표", layout="wide", initial_sidebar_state="collapsed")

# Streamlit 클라우드에서는 secrets 를 환경변수로 옮겨서 집 PC(.env)와 같은 방식으로 읽음
try:
    for _k, _v in st.secrets.items():
        if isinstance(_v, (str, int, float)):
            os.environ.setdefault(_k, str(_v))
except Exception:
    pass

import cloud  # noqa: E402
import datasource  # noqa: E402
import db  # noqa: E402
import journal  # noqa: E402
import metrics  # noqa: E402
import settings  # noqa: E402

cloud.load_env()
WEB = datasource.is_web()
ON_CLOUD = APP_DIR.startswith("/mount/src")  # Streamlit 클라우드에서 돌고 있는지

if ON_CLOUD and not WEB:
    st.title("코스피 지표")
    st.error("웹 설정(Secrets)이 아직 없어요. Manage app → ⋮ → Settings → Secrets 에 설정을 붙여 넣고 저장하세요.")
    st.stop()

# 선택: APP_PASSWORD 를 정해 두면 비밀번호를 알아야 열림
if os.getenv("APP_PASSWORD") and not st.session_state.get("authed"):
    st.title("코스피 지표")
    pw = st.text_input("비밀번호", type="password")
    if pw and pw == os.getenv("APP_PASSWORD"):
        st.session_state["authed"] = True
        st.rerun()
    elif pw:
        st.error("비밀번호가 달라요")
    st.stop()


@st.cache_data(ttl=600, show_spinner="데이터 불러오는 중...")
def data_path():
    """웹이면 드라이브에서 받은 파일 경로, 집 PC면 kospi.db (10분마다 드라이브 변경 확인)"""
    p = datasource.db_path()
    return p, datasource.last_modified()


try:
    DB_FILE, DRIVE_MODIFIED = data_path()
except Exception as e:
    st.error(f"데이터를 불러오지 못했어요: {e}")
    st.stop()
db.DB_PATH = DB_FILE


# ================= 공통 =================

@st.cache_data(ttl=3600)
def load(path, _version=None):
    db.connect(path).close()  # 테이블이 없으면 만들어 둠
    return metrics.load(path)


@st.cache_data(ttl=3600)
def changes_data(base_date, end_date, _v=None):
    s, c = load(DB_FILE, DRIVE_MODIFIED)
    df = metrics.changes(s, c, base_date, end_date)
    return df, metrics.sector_summary(df)


@st.cache_data(ttl=3600)
def rs_data(base_date, end_date, _v=None):
    s, c = load(DB_FILE, DRIVE_MODIFIED)
    return metrics.relative_strength(s, c, base_date, end_date)


def favorites():
    try:
        w = settings.get_watchlist()
    except Exception:
        return set()
    return set(w.index[w["favorite"] == 1])


def line_chart(df, ref=None, where=st, height=300):
    """여러 선 차트. Y축을 데이터 범위에 맞추고, ref가 있으면 점선 기준선 표시"""
    d = df.rename_axis("날짜").reset_index().melt("날짜", var_name="이름", value_name="값")
    chart = alt.Chart(d).mark_line(strokeWidth=1.5).encode(
        x=alt.X("날짜:T", title=None),
        y=alt.Y("값:Q", title=None, scale=alt.Scale(zero=False)),
        color=alt.Color("이름:N", legend=alt.Legend(orient="bottom", title=None)),
        tooltip=[alt.Tooltip("날짜:T"), "이름:N", alt.Tooltip("값:Q", format=".1f")],
    )
    if ref is not None:
        rule = alt.Chart(pd.DataFrame({"y": [ref]})).mark_rule(
            strokeDash=[4, 4], color="gray").encode(y="y:Q")
        chart = rule + chart
    where.altair_chart(chart.properties(height=height), use_container_width=True)


def run_update(script="collect.py"):
    """collect.py(또는 reports.py)를 실행하고 진행 로그를 화면에 보여줌"""
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    proc = subprocess.Popen(
        [sys.executable, "-u", script], cwd=APP_DIR, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    lines = []
    msg = ("리포트 확인 중... (처음 추적하는 종목은 상세 페이지를 하나씩 읽느라 조금 걸려요)"
           if script == "reports.py" else "업데이트 중... (처음 추가한 종목은 20년치라 조금 걸려요)")
    with st.status(msg, expanded=True) as status:
        box = st.empty()
        for line in proc.stdout:
            lines.append(line.rstrip())
            box.code("\n".join(lines[-15:]))
        proc.wait()
        ok = proc.returncode == 0
        status.update(label="업데이트 완료" if ok else "업데이트 실패 (아래 로그 확인)",
                      state="complete" if ok else "error")
    st.session_state["update_log"] = (ok, "\n".join(lines[-40:]))
    st.cache_data.clear()
    st.rerun()


pct = st.column_config.NumberColumn(format="%.2f%%")
num = st.column_config.NumberColumn(format="%,.0f")
pt = st.column_config.NumberColumn(format="%+.2f")
STOCK_CFG = {
    "변화율(%)": pct, "섹터평균대비(%p)": pct,
    "시총(억)": num, "기준가": num, "현재가": num,
    "MDD(%)": pct, "현재낙폭(%)": pct,
}

stocks, close = load(DB_FILE, DRIVE_MODIFIED)
HAS_DATA = len(stocks) > 0 and len(close) > 0
names = stocks["name"].to_dict()


# ================= 종목 관리 페이지 =================

def page_manage():
    st.subheader("종목 관리")
    st.caption(
        "여기 추가한 종목은 시총 상위 400 밖이어도(코스닥 포함) 매일 같이 받아요. "
        "즐겨찾기는 화면에서 모아 보기용, 리포트 추적은 리포트 수집 대상이에요."
        + (" 설정은 Firebase에 저장돼서 집 PC와 웹이 같이 써요." if settings.use_cloud() else "")
    )
    conn = db.connect()

    # --- 업데이트 ---
    last = conn.execute("SELECT MAX(date) FROM prices").fetchone()[0]
    c1, c2 = st.columns([3, 1], vertical_alignment="center")
    c1.markdown(f"데이터 최종일: **{last or '없음'}**")
    if WEB:
        up = (pd.Timestamp(DRIVE_MODIFIED).tz_convert("Asia/Seoul").strftime("%Y-%m-%d %H:%M")
              if DRIVE_MODIFIED else "-")
        c1.caption(f"웹 버전이에요. 데이터는 집 PC가 업데이트할 때 드라이브로 올라와요 (마지막 업로드 {up}). "
                   "새로 추가한 종목은 집 PC의 다음 업데이트 때 받아져요.")
    elif c2.button("🔄 지금 업데이트", use_container_width=True):
        conn.close()
        run_update()
    if "update_log" in st.session_state:
        ok, log = st.session_state["update_log"]
        with st.expander("마지막 업데이트 로그" + ("" if ok else " ⚠ 실패"), expanded=not ok):
            st.code(log)

    st.divider()

    # --- 추가 ---
    master = db.get_master(conn)
    watch = settings.get_watchlist(conn)
    if master.empty:
        st.info("검색 목록이 아직 없어요. 위의 '지금 업데이트'를 한 번 실행하면 생겨요.")
    else:
        opts = master[~master["ticker"].isin(watch.index)]
        label = {r.ticker: f"{r.name} · {r.ticker} · {r.market}" for r in opts.itertuples()}
        c1, c2 = st.columns([4, 1], vertical_alignment="bottom")
        pick = c1.selectbox(
            "종목 추가", list(label), index=None, format_func=label.get,
            placeholder="종목명이나 코드를 입력하세요", key="add_pick",
        )
        if c2.button("추가", use_container_width=True, disabled=pick is None):
            row = master.set_index("ticker").loc[pick]
            settings.add_watch(conn, pick, row["name"], row["market"])
            st.toast(f"{row['name']} 추가됨")
            st.rerun()

    # --- 목록 ---
    if watch.empty:
        st.caption("아직 추가한 종목이 없어요.")
        conn.close()
        return

    view = pd.DataFrame({
        "종목명": watch["name"],
        "시장": watch["market"],
        "즐겨찾기": watch["favorite"].astype(bool),
        "리포트 추적": watch["track_reports"].astype(bool),
        "데이터": ["✓" if t in stocks.index else "다음 업데이트 때 받음" for t in watch.index],
        "추가일": watch["added"].str[:10],
        "삭제": False,
    }).rename_axis("코드")

    edited = st.data_editor(
        view, use_container_width=True, key="watch_editor",
        disabled=["종목명", "시장", "데이터", "추가일"],
        column_config={
            "즐겨찾기": st.column_config.CheckboxColumn(width="small"),
            "리포트 추적": st.column_config.CheckboxColumn(width="small"),
            "삭제": st.column_config.CheckboxColumn(width="small"),
        },
    )

    # 체크박스 변경 즉시 저장
    for t in edited.index:
        fav, trk = bool(edited.at[t, "즐겨찾기"]), bool(edited.at[t, "리포트 추적"])
        if fav != view.at[t, "즐겨찾기"] or trk != view.at[t, "리포트 추적"]:
            settings.set_flags(conn, t, fav, trk)

    to_del = list(edited.index[edited["삭제"]])
    if st.button(f"선택한 {len(to_del)}개 삭제", disabled=not to_del, type="secondary"):
        settings.remove_watch(conn, to_del)
        st.rerun()
    conn.close()


# ================= 리포트 페이지 =================

NAVER_READ = "https://stock.naver.com/research/company/"


def report_frame(conn):
    """리포트 + 같은 증권사 직전 리포트 대비 변화, 현재가 대비 상승여력"""
    r = db.get_reports(conn)
    if r.empty:
        return r
    r = r.sort_values(["date", "nid"])
    g = r.groupby(["ticker", "broker"], dropna=False)
    r["직전목표가"] = g["target_price"].transform(lambda s: s.ffill().shift())
    r["직전의견"] = g["opinion"].transform(lambda s: s.ffill().shift())

    def change(row):
        tags = []
        tp, prev = row["target_price"], row["직전목표가"]
        if pd.notna(tp) and pd.notna(prev):
            tags.append("목표가 ▲" if tp > prev else "목표가 ▼" if tp < prev else "유지")
        elif pd.notna(tp):
            tags.append("신규")
        if pd.notna(row["opinion"]) and pd.notna(row["직전의견"]) and row["opinion"] != row["직전의견"]:
            tags.append(f"의견 {row['직전의견']}→{row['opinion']}")
        return " · ".join(tags)

    r["변화"] = r.apply(change, axis=1)
    r["목표가변화(%)"] = (r["target_price"] / r["직전목표가"] - 1) * 100
    last_close = close.ffill().iloc[-1] if HAS_DATA else pd.Series(dtype=float)
    r["현재가"] = r["ticker"].map(last_close)
    r["상승여력(%)"] = (r["target_price"] / r["현재가"] - 1) * 100
    r["링크"] = NAVER_READ + r["nid"].astype(str)
    return r.sort_values(["date", "nid"], ascending=False)


REPORT_COLS = {
    "date": "날짜", "name": "종목", "broker": "증권사", "title": "제목",
    "링크": "보기", "pdf_url": "PDF",
    "opinion": "의견", "target_price": "목표가", "변화": "변화",
    "목표가변화(%)": "목표가변화", "상승여력(%)": "상승여력",
}
REPORT_CFG = {
    "목표가": num,
    "목표가변화": st.column_config.NumberColumn(format="%+.1f%%", help="같은 증권사 직전 리포트 대비"),
    "상승여력": st.column_config.NumberColumn(format="%+.1f%%", help="목표가 ÷ 현재가 − 1"),
    "보기": st.column_config.LinkColumn(display_text="네이버", width="small"),
    "PDF": st.column_config.LinkColumn(display_text="PDF", width="small"),
    "제목": st.column_config.TextColumn(width="medium"),
}


def report_table(r, drop=()):
    t = r[list(REPORT_COLS)].rename(columns=REPORT_COLS).drop(columns=list(drop))
    st.dataframe(t, use_container_width=True, hide_index=True, column_config=REPORT_CFG,
                 height=min(600, 38 + 35 * len(t)))


def page_reports():
    conn = db.connect()
    watch = settings.get_watchlist(conn)
    tracked = watch[watch["track_reports"] == 1]

    c1, c2 = st.columns([3, 1], vertical_alignment="center")
    c1.caption(f"리포트 추적 {len(tracked)}종목 · 네이버 증권 리서치 기준 · "
               "매일 업데이트 때 같이 확인해요 (추적 종목은 '종목 관리'에서 설정)")
    if not WEB and c2.button("🔄 리포트만 지금 확인", use_container_width=True, disabled=tracked.empty):
        conn.close()
        run_update("reports.py")
    if "update_log" in st.session_state:
        ok, log = st.session_state["update_log"]
        if not ok:
            with st.expander("마지막 업데이트 로그 ⚠ 실패", expanded=True):
                st.code(log)

    r = report_frame(conn)
    if r.empty:
        st.info("아직 리포트가 없어요. '종목 관리'에서 리포트 추적을 켜고 확인 버튼을 눌러 보세요.")
        conn.close()
        return

    # 1) 새 리포트
    new = r[settings.unseen_mask(r)]
    st.subheader(f"새 리포트 {len(new)}건")
    if new.empty:
        st.caption("새로 올라온 리포트가 없어요.")
    else:
        report_table(new)
        if st.button("모두 확인 처리"):
            settings.mark_all_seen(conn, new)
            st.rerun()

    st.divider()

    # 2) 종목별 이력
    st.subheader("종목별 리포트")
    have = r.drop_duplicates("ticker").set_index("ticker")["name"]
    t = st.selectbox("종목", list(have.index), format_func=lambda x: f"{have[x]} ({x})")
    rt = r[r["ticker"] == t]

    # 증권사별 최신 목표가(최근 6개월) 평균 = 간이 컨센서스
    recent = rt[pd.to_datetime(rt["date"]) >= pd.Timestamp.today() - pd.DateOffset(months=6)]
    latest = recent.dropna(subset=["target_price"]).drop_duplicates("broker")
    m1, m2, m3, m4 = st.columns(4)
    cur = rt["현재가"].iloc[0]
    m1.metric("현재가", f"{cur:,.0f}" if pd.notna(cur) else "-")
    if not latest.empty:
        cons = latest["target_price"].mean()
        m2.metric("평균 목표가 (6개월, 증권사별 최신)", f"{cons:,.0f}",
                  f"{(cons / cur - 1) * 100:+.1f}% 여력" if pd.notna(cur) else None)
        m3.metric("최고 / 최저 목표가", f"{latest['target_price'].max():,.0f} / {latest['target_price'].min():,.0f}")
    m4.metric("최근 6개월 리포트", f"{len(recent)}건 · {recent['broker'].nunique()}개사")

    # 주가 + 목표가 차트 (최근 2년)
    if HAS_DATA and t in close.columns:
        start = pd.Timestamp.today() - pd.DateOffset(years=2)
        px = close.loc[start:, t].dropna().rename("주가").rename_axis("날짜").reset_index()
        tp = rt.dropna(subset=["target_price"]).assign(날짜=lambda d: pd.to_datetime(d["date"]))
        tp = tp[tp["날짜"] >= start]
        line = alt.Chart(px).mark_line(strokeWidth=1.5, color="#4C78A8").encode(
            x=alt.X("날짜:T", title=None), y=alt.Y("주가:Q", title=None, scale=alt.Scale(zero=False)),
            tooltip=[alt.Tooltip("날짜:T"), alt.Tooltip("주가:Q", format=",.0f")])
        pts = alt.Chart(tp).mark_point(filled=True, size=60, color="#E45756").encode(
            x="날짜:T", y="target_price:Q",
            tooltip=[alt.Tooltip("날짜:T"), "broker:N",
                     alt.Tooltip("target_price:Q", title="목표가", format=",.0f"), "opinion:N"])
        st.markdown("**주가와 목표가** (빨간 점 = 리포트 목표가)")
        st.altair_chart((line + pts).properties(height=320), use_container_width=True)

    report_table(rt, drop=["종목"])
    conn.close()

    # 내 투자일지
    st.markdown("**내 투자일지**")
    journal_section(t, have[t])


# ================= 투자일지 =================

KIND_COLOR = {"매수": "#1f6f5c", "매도": "#b4542d", "관찰": "#4a5fb3", "복기": "#8a5a9e", "메모": "#888888"}


@st.cache_data(ttl=300, show_spinner="투자일지 불러오는 중...")
def journal_posts():
    return journal.fetch_posts()


def journal_status():
    """(설정됨, 글 DataFrame 또는 None, 에러 메시지)"""
    if not journal.configured():
        return False, None, None
    try:
        return True, journal_posts(), None
    except Exception as e:
        return True, None, str(e)


def journal_table(df):
    t = df.assign(종목=df["names"].map(", ".join), 태그=df["tags"].map(lambda ts: " ".join("#" + x for x in ts)))
    t = t[["date", "kind", "title", "종목", "태그", "link"]].rename(
        columns={"date": "날짜", "kind": "유형", "title": "제목", "link": "보기"})
    st.dataframe(t, hide_index=True, use_container_width=True, height=min(500, 38 + 35 * len(t)),
                 column_config={"보기": st.column_config.LinkColumn(display_text="열기", width="small"),
                                "제목": st.column_config.TextColumn(width="large")})


def journal_section(code, name):
    """종목 하나의 일지 목록 + 새 글 링크 (리포트 페이지 등에서 사용)"""
    ok, df, err = journal_status()
    if not ok:
        st.caption("투자일지가 연결되지 않았어요. ('투자일지' 페이지에서 설정 방법 확인)")
        return
    new_url = journal.new_post_url(code, name)
    if new_url:
        st.link_button(f"✏️ {name} 일지 쓰기", new_url)
    if err:
        st.error(err)
        return
    mine = journal.for_ticker(df, code, name)
    if mine.empty:
        st.caption("이 종목으로 쓴 일지가 없어요.")
    else:
        journal_table(mine)


def journal_price_chart(code, posts):
    """주가 위에 일지 쓴 날짜를 유형별 색 점으로"""
    if not HAS_DATA or code not in close.columns:
        return
    dates = pd.to_datetime(posts["date"], errors="coerce").dropna()
    start = min(dates.min() - pd.DateOffset(months=3), pd.Timestamp.today() - pd.DateOffset(years=1)) \
        if len(dates) else pd.Timestamp.today() - pd.DateOffset(years=1)
    px = close.loc[start:, code].dropna().rename("주가").rename_axis("날짜").reset_index()
    pts = posts.assign(날짜=pd.to_datetime(posts["date"], errors="coerce")).dropna(subset=["날짜"])
    pts = pd.merge_asof(pts.sort_values("날짜"), px.sort_values("날짜"), on="날짜", direction="backward")
    line = alt.Chart(px).mark_line(strokeWidth=1.5, color="#4C78A8").encode(
        x=alt.X("날짜:T", title=None), y=alt.Y("주가:Q", title=None, scale=alt.Scale(zero=False)),
        tooltip=[alt.Tooltip("날짜:T"), alt.Tooltip("주가:Q", format=",.0f")])
    dots = alt.Chart(pts).mark_point(filled=True, size=110, shape="diamond").encode(
        x="날짜:T", y="주가:Q",
        color=alt.Color("kind:N", title=None, legend=alt.Legend(orient="bottom"),
                        scale=alt.Scale(domain=list(KIND_COLOR), range=list(KIND_COLOR.values()))),
        href="link:N",
        tooltip=[alt.Tooltip("날짜:T"), alt.Tooltip("kind:N", title="유형"), alt.Tooltip("title:N", title="제목"),
                 alt.Tooltip("주가:Q", format=",.0f")])
    st.altair_chart((line + dots).properties(height=320), use_container_width=True)


def page_journal():
    ok, df, err = journal_status()
    if not ok:
        st.subheader("투자일지 연결하기")
        st.markdown(
            "웹 투자일지(GitHub Pages)에 쓴 글을 여기서 종목별로 볼 수 있어요. "
            "`kospi` 폴더의 `.env` 파일에 아래 다섯 줄을 추가하고 화면을 새로고침하세요.")
        st.code("FIREBASE_API_KEY=AIzaSyBdXtCVCYp8QkvQ4ZTccFbzVO1kQkD9PPE\n"
                "FIREBASE_PROJECT_ID=finace-journal\n"
                "JOURNAL_EMAIL=rnqhscjf7410@naver.com\n"
                "JOURNAL_PASSWORD=네이버 계정 비밀번호 (Firebase에 만든 것)\n"
                "JOURNAL_URL=https://ththys.github.io/finace/journal/", language="ini")
        st.caption("JOURNAL_EMAIL은 Firebase(finace-journal) → Authentication → 사용자에 "
                   "이메일/비밀번호로 만든 계정이어야 해요. 구글 로그인 계정은 여기선 못 써요.")
        return

    c1, c2, c3 = st.columns([3, 1, 1], vertical_alignment="center")
    c1.caption("웹 투자일지에서 쓴 글이에요. 쓰기·수정은 웹에서 하고, 여기는 읽기 전용이에요 (5분마다 새로 읽음).")
    if journal.web_url():
        c2.link_button("✏️ 새 일지", journal.new_post_url(), use_container_width=True)
    if c3.button("🔄 새로고침", use_container_width=True):
        journal_posts.clear()
        data_path.clear()
        st.rerun()
    if err:
        st.error(err)
        return
    if df.empty:
        st.info("아직 쓴 일지가 없어요.")
        return

    # 종목별로 묶기 (코드 있는 것만 차트 가능)
    pairs = {}
    for cs, ns in zip(df["codes"], df["names"]):
        for i, n in enumerate(ns):
            key = cs[i] if i < len(cs) else n
            pairs.setdefault(key, n)
    m1, m2, m3 = st.columns(3)
    m1.metric("전체 일지", f"{len(df)}건")
    m2.metric("최근 30일", f"{(pd.to_datetime(df['date'], errors='coerce') >= pd.Timestamp.today() - pd.DateOffset(days=30)).sum()}건")
    m3.metric("다룬 종목", f"{len(pairs)}개")

    opts = ["전체"] + sorted(pairs, key=lambda k: pairs[k])
    pick = st.selectbox("종목", opts, format_func=lambda k: k if k == "전체" else f"{pairs[k]} ({k})")
    kinds = st.multiselect("유형", list(KIND_COLOR), placeholder="전체 유형")
    view = df if pick == "전체" else journal.for_ticker(df, pick, pairs[pick])
    if kinds:
        view = view[view["kind"].isin(kinds)]

    if pick != "전체":
        if journal.web_url():
            st.link_button(f"✏️ {pairs[pick]} 일지 쓰기", journal.new_post_url(pick, pairs[pick]))
        if HAS_DATA and pick in close.columns:
            st.markdown("**주가와 내 일지** (점을 누르면 그 글이 열려요)")
            journal_price_chart(pick, view)
    journal_table(view)


# ================= 데이터 페이지 =================

def page_sector():
    st.bar_chart(
        summary.reset_index(), x="섹터", y="시총가중(%)",
        horizontal=True, sort="-시총가중(%)", height=max(300, len(summary) * 24),
    )
    st.dataframe(
        summary, use_container_width=True,
        column_config={c: pct for c in ["평균(%)", "중앙값(%)", "시총가중(%)"]},
    )
    pick = st.selectbox("섹터 상세", summary.index)
    sub = df[df["섹터"] == pick].drop(columns="섹터")
    st.dataframe(sub, use_container_width=True, column_config=STOCK_CFG)


def page_rs():
    rs = rs_data(base_date, end_date, DRIVE_MODIFIED)
    rs_col = [c for c in rs["sector_table"].columns if c.startswith("RS")][0]
    rs_cfg = {
        "섹터수익률(%)": pct, "시장대비(%p)": pct, "수익률(%)": pct, "섹터대비(%p)": pct,
        "MDD(%)": pct, "현재낙폭(%)": pct, rs_col: pt,
    }

    # 1) 섹터 vs 시장
    st.subheader("섹터 vs 시장")
    st.caption(
        "시장 = 전체 종목 시총가중 지수. 상대강도(RS) = 섹터지수 ÷ 시장지수 × 100 · "
        "100 위면 기준일 이후 시장보다 강함, 선이 오르면 지금 강해지는 중 · "
        f"{rs_col} = 최근 20거래일 동안 RS가 몇 pt 움직였는지"
    )
    st.dataframe(rs["sector_table"], use_container_width=True, column_config=rs_cfg)

    secs = list(rs["sector_table"].index)
    default_secs = secs[:2] + secs[-1:] if len(secs) > 3 else secs
    pick_secs = st.multiselect("비교할 섹터", secs, default=default_secs)
    if pick_secs:
        c1, c2 = st.columns(2)
        c1.markdown("**시장 대비 상대강도** (100 = 시장과 같음)")
        line_chart(rs["rs_sector"][pick_secs], ref=100, where=c1)
        c2.markdown("**고점 대비 낙폭 (%)**")
        line_chart(rs["sector_dd"][pick_secs], where=c2)

    st.divider()

    # 2) 섹터 내 종목
    st.subheader("섹터 내 종목")
    sec = st.selectbox("섹터", secs, key="rs_sector")
    tbl = rs["stock_table"][rs["stock_table"]["섹터"] == sec].drop(columns="섹터")
    st.caption(
        f"{sec} 섹터 수익률 {rs['sector_table'].loc[sec, '섹터수익률(%)']:.2f}% · "
        "섹터대비 = 종목 수익률 − 섹터(시총가중) 수익률 · MDD = 기간 내 최대 낙폭"
    )
    st.dataframe(tbl.drop(columns="섹터수익률(%)"), use_container_width=True, column_config=rs_cfg)

    ticks = list(tbl.index)
    default_ticks = ticks[:2] + ticks[-1:] if len(ticks) > 3 else ticks
    pick = st.multiselect(
        "비교할 종목", ticks, default=default_ticks,
        format_func=lambda t: f"{names.get(t, t)} ({t})", key="rs_stocks",
    )
    if pick:
        label = {t: names.get(t, t) for t in pick}
        c1, c2 = st.columns(2)
        c1.markdown(f"**{sec} 대비 상대강도** (100 = 섹터와 같음)")
        line_chart(rs["rs_stock"][pick].rename(columns=label), ref=100, where=c1)
        c2.markdown("**고점 대비 낙폭 (%)**")
        line_chart(rs["stock_dd"][pick].rename(columns=label), where=c2)


def page_list():
    favs = favorites()
    c1, c2, c3 = st.columns([3, 1, 1], vertical_alignment="bottom")
    sel = c1.multiselect("섹터 필터", sorted(df["섹터"].unique()))
    q = c2.text_input("종목명 검색")
    only_fav = c3.toggle("⭐ 즐겨찾기만", disabled=not favs)
    view = df
    if sel:
        view = view[view["섹터"].isin(sel)]
    if q:
        view = view[view["종목명"].str.contains(q, case=False)]
    if only_fav:
        view = view[view.index.isin(favs)]
    view = view.assign(종목명=[("⭐ " if t in favs else "") + n for t, n in view["종목명"].items()])
    st.dataframe(view, use_container_width=True, height=min(650, 38 + 35 * len(view)),
                 column_config=STOCK_CFG)


def page_chart():
    favs = [t for t in df.index if t in favorites()]
    choices = st.multiselect(
        "종목 (여러 개 선택 시 기준일=100으로 비교 · 기본값은 즐겨찾기)",
        df.index, default=favs[:8] or list(df.index[:3]),
        format_func=lambda t: f"{names.get(t, t)} ({t})",
    )
    if choices:
        span = close.loc[pd.Timestamp(base_date): pd.Timestamp(end_date), choices].ffill()
        base = metrics._close_on_or_before(close[choices], base_date)
        norm = span / base * 100
        norm.columns = [names.get(t, t) for t in choices]
        line_chart(norm, ref=100, height=450)


# ================= 네비게이션 =================

def _unseen_count():
    conn = db.connect()
    try:
        r = db.get_reports(conn)
        return int(settings.unseen_mask(r).sum()) if len(r) else 0
    except Exception:
        return 0
    finally:
        conn.close()


manage = st.Page(page_manage, title="종목 관리", url_path="manage")
n_new = _unseen_count()
reports_page = st.Page(page_reports, title=f"리포트 ({n_new})" if n_new else "리포트", url_path="reports")
journal_page = st.Page(page_journal, title="투자일지", url_path="journal")
if HAS_DATA:
    nav = st.navigation(
        [
            st.Page(page_sector, title="섹터", url_path="sector", default=True),
            st.Page(page_rs, title="상대강도 · MDD", url_path="rs"),
            st.Page(page_list, title="종목 리스트", url_path="list"),
            st.Page(page_chart, title="차트", url_path="chart"),
            reports_page,
            journal_page,
            manage,
        ],
        position="top",
    )
else:
    nav = st.navigation([manage, reports_page, journal_page], position="top")
    st.warning("아직 가격 데이터가 없어요. " + ("집 PC에서 업데이트를 한 번 돌려 주세요."
               if WEB else "'지금 업데이트'를 눌러 처음 데이터를 받아 주세요 (몇 시간 걸려요)."))


# ================= 상단: 기간 설정 (데이터 페이지 공통) =================

if HAS_DATA and nav.title not in (manage.title, reports_page.title, journal_page.title):
    last_day = close.index.max().date()
    first_day = close.index.min().date()
    PRESETS = {
        "YTD": None,
        "1개월": pd.DateOffset(months=1),
        "3개월": pd.DateOffset(months=3),
        "6개월": pd.DateOffset(months=6),
        "1년": pd.DateOffset(years=1),
        "직접 선택": "custom",
    }
    c_mode, c_base, c_end = st.columns([3, 1, 1], vertical_alignment="bottom")
    mode = c_mode.segmented_control("기간", list(PRESETS), default="YTD", key="mode") or "YTD"
    end_date = c_end.date_input(
        "종료일", last_day, min_value=first_day, max_value=last_day, key="end_date"
    )
    if mode == "YTD":
        base_date = metrics.ytd_base(end_date).date()
    elif mode == "직접 선택":
        base_date = c_base.date_input(
            "기준일", metrics.ytd_base(end_date).date(),
            min_value=first_day, max_value=end_date, key="base_date",
        )
    else:
        base_date = (pd.Timestamp(end_date) - PRESETS[mode]).date()
    if mode != "직접 선택":
        c_base.text_input("기준일", str(base_date), disabled=True)

    df, summary = changes_data(base_date, end_date, DRIVE_MODIFIED)
    st.caption(
        f"**{base_date} → {end_date}** · {len(df)}종목 · 데이터 최종일 {last_day} · "
        "휴장일이면 직전 거래일 종가 기준"
    )

nav.run()
