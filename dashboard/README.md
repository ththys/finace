# 코스피 지표 대시보드

집 PC에서 데이터를 모으고, 웹(Streamlit 클라우드)에서도 같은 화면을 봅니다.

```
집 PC (켤 때마다 자동)                         웹 (Streamlit 클라우드)
 collect.py → kospi.db ──복사본──▶ 구글 드라이브 ──▶ app.py 가 읽어서 표시
 관심 종목·리포트 확인 상태 ◀──────── Firebase(finace-journal) ────────▶ 같이 씀
 투자일지(journal/) 글도 Firebase 에서 읽음
```

## 파일
| 파일 | 역할 |
|---|---|
| `collect.py` | 가격·섹터 수집 (pykrx), 끝나면 리포트 수집 + 드라이브로 DB 복사 |
| `reports.py` | 네이버 리서치 리포트 수집 |
| `metrics.py` | 수익률·섹터 집계·상대강도·MDD 계산 |
| `app.py` | 화면 (섹터, 상대강도·MDD, 종목 리스트, 차트, 리포트, 투자일지, 종목 관리) |
| `settings.py` / `cloud.py` | 관심 종목·리포트 확인 상태를 Firebase에 저장 (없으면 로컬 DB) |
| `datasource.py` | 웹에서 드라이브의 kospi.db 받아 오기 |
| `journal.py` | 투자일지 글 읽기 |
| `db.py` | DB 구조 |

## 집 PC
1. 이 폴더 파일들을 `C:\Users\<이름>\kospi` 에 두기 (kospi.db, .env 는 그대로)
2. `pip install -r requirements-pc.txt`
3. `.env`
   ```
   KRX_ID=...
   KRX_PW=...
   FIREBASE_API_KEY=AIzaSyBdXtCVCYp8QkvQ4ZTccFbzVO1kQkD9PPE
   FIREBASE_PROJECT_ID=finace-journal
   JOURNAL_EMAIL=rnqhscjf7410@naver.com
   JOURNAL_PASSWORD=...
   JOURNAL_URL=https://ththys.github.io/finace/journal/
   DRIVE_EXPORT_DIR=G:\내 드라이브\kospi-data
   ```
4. `kospi.bat` 실행 (또는 작업 스케줄러로 로그온 시·매일 18시 자동)

## 웹 (Streamlit Community Cloud)
- 저장소 `ththys/finace`, 브랜치 `main`, 파일 `dashboard/app.py`
- Secrets: `.streamlit/secrets.toml.example` 참고
- 서비스 계정 이메일에 드라이브 `kospi-data` 폴더를 '뷰어'로 공유

## Firestore 규칙
`journal`, `journal_images`, `watchlist`, `state` 컬렉션을 허용된 계정만 읽고 쓰게 설정
