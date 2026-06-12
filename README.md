# 티머니 고객센터 전화접수 현황 자동화 (v2)

구글 시트는 **입력 창구 + 결과 뷰**로만 쓰고, **데이터 저장소와 집계 엔진은 Supabase**,
시각화는 **Vercel 대시보드가 Supabase를 직접 호출**하는 구조입니다. 데이터가 방대해져도
스프레드시트 한계에 묶이지 않도록 설계했습니다.

```
구글시트 워크북            GAS (수집·전송)              Supabase (저장 + 연산)        표시
──────────────      ────────────────────       ────────────────────      ──────────────
[전체접수] 탭  ┐                                  cs_all_receptions(raw)
[1차필터] 탭  ┼→ 읽기→마스킹→날짜정규화→ upsert →  cs_receptions(raw)     ┐
                       (집계·중복 없음)            └ SQL View/Function ┘ → ┬→ Vercel 대시보드(anon, View 직접조회)
                                                   (일/주/월 집계)          └→ GAS가 주차요약 View 조회→Gemini→메일
                                                   중복=접수번호 PK 자동차단
```

## 설계 핵심 (이번 변경)

1. **GAS는 행 변환만** — 시트를 읽어 마스킹·날짜정규화 후 Supabase에 `upsert`. 집계/주차계산을 하지 않음.
2. **집계는 SQL** — 일/주/월 통계는 Supabase의 View(`cs_v_daily/weekly/monthly_summary`)와 Function(`cs_week_label`)이 계산.
3. **중복은 DB가 차단** — `receptions.row_key`(접수번호 우선) PK + `Prefer: resolution=merge-duplicates`로 멱등 upsert.
4. **대시보드는 직접 조회** — Vercel이 anon 키로 집계 View만 SELECT(API 연동), 프런트는 렌더만.

## 데이터 구조

원본은 **하나의 구글 시트 워크북**(입력 창구), 탭 2개:
- **전체접수 탭** → `cs_all_receptions` (필터링율의 *분모*)
- **1차필터 탭** → `cs_receptions`. A~D열(일자·2차필터·주차구분·월변환)은 요약용 **수식 컬럼**,
  실제 데이터는 **E열(접수번호)부터**. `2차필터` 컬럼값은 그대로 적재하고 **분류는 SQL이 수행**.
  - 컬럼은 *헤더 이름*으로 매핑하므로 A~D 수식 컬럼이 앞에 있어도 무방.

| 항목 | 정의 |
|---|---|
| 주차 기준 | 목~차주 수 (`cs_week_label` SQL Function, Asia/Seoul) |
| 전체/1차/2차 | 전체=cs_all_receptions 행수 / 1차=cs_receptions 행수 / 2차=stage='2차' |
| 현장인계 | `2차필터` 값으로 SQL이 stage 분류(`cs_v_receptions_classified`) |
| 필터링율 | (1차 + 2차) ÷ 전체 (분모 0 → 0%) |
| 중복키 | 접수번호(있으면), 없으면 내용 합성키(MD5) |
| 마스킹 | 차량번호·차량ID = `***` (요청자명·카드번호는 적재하지 않음) |
| 비밀값 | 전부 ScriptProperties / Vercel 환경변수 |

---

## 1. Supabase 설정 (먼저)

1. 프로젝트 생성(또는 **기존 DB 공유 가능**) → SQL Editor 에 **`supabase/schema.sql`** 전체 실행
   - 모든 객체에 **`cs_` 접두사**가 붙어 있어 `warehouse_v2` 등 다른 앱과 같은 DB를 써도 충돌하지 않습니다.
   - raw 테이블(`cs_receptions`, `cs_all_receptions`) + `cs_weekly_insight`
   - 주차 함수(`cs_week_start`, `cs_week_label`)
   - 집계 View(`cs_v_receptions_classified`, `cs_v_daily/weekly/monthly_summary`, `cs_v_weekly_by_*`, `cs_v_weekly_full`)
   - RLS: raw 테이블 직접 접근 차단(쓰기는 service_role), 집계 View는 anon SELECT 허용
2. Settings → API 에서 키 확보
   - `service_role` → GAS `SUPABASE_SERVICE_KEY` (쓰기)
   - `anon public` → Vercel `NEXT_PUBLIC_SUPABASE_ANON_KEY` (읽기)
3. ⚠️ **`2차필터` 컬럼의 실제 값**에 맞춰 `schema.sql` 의 `cs_v_receptions_classified` CASE 문
   (`현장인계`/제외값 목록)을 한 번 맞춰주세요. 여기서 2차/현장인계 집계가 갈립니다.

## 2. Google Apps Script 설정

### 2-1. 구성
`gas/`의 `.gs` + `appsscript.json` 을 Apps Script 프로젝트에 올립니다(clasp 권장).

### 2-2. 매핑 확인 ⚠️
실제 시트와 다르면 **`gas/Config.gs` 상단만** 수정:
- `SRC_TABS` (탭 이름), `COLS_ALL`/`COLS_1` (헤더 매핑)

### 2-3. 스크립트 속성
편집기 → ⚙️ 프로젝트 설정 → 스크립트 속성 (또는 `setupProperties_()` 1회):

| 키 | 필수 | 설명 |
|---|---|---|
| `SOURCE_SPREADSHEET_ID` | ⬜ | 원본 워크북 ID(미설정 시 `SPREADSHEET_ID`와 동일 파일) |
| `SPREADSHEET_ID` | ✅ | 실행 로그(`_Log`) 저장용 스프레드시트 ID |
| `SUPABASE_URL` | ✅ | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_KEY` | ✅ | service_role 키 |
| `REPORT_RECIPIENTS` | ✅ | 보고 메일 수신자(쉼표 구분) |
| `GEMINI_API_KEY` | ⬜ | 없으면 규칙 기반 폴백 요약 |
| `DASHBOARD_URL` | ⬜ | 메일에 넣을 대시보드 링크 |
| `ADMIN_EMAIL` | ⬜ | 오류 알림 수신자(기본: 실행 계정) |
| `TIMEZONE` | ⬜ | 기본 `Asia/Seoul` |

> service_role 키는 절대 클라이언트/대시보드에 노출하지 마세요.

### 2-4. 트리거 / 테스트
- `installTrigger()` 1회 실행 → 매일 08:00(KST) `runDaily()` 자동 실행
- `syncToSupabase()` — 시트→Supabase 동기화만 테스트
- `resyncAll()` — 증분 포인터 초기화 후 **전량 재전송**(스키마/매핑 변경 시 1회)
- `runDaily()` — 전체 파이프라인(동기화→집계조회→AI→메일) 1회 실행
- 실행 로그는 `_Log` 시트.

> **증분 동기화**: 탭별 마지막 동기화 행 인덱스를 ScriptProperties에 저장해 신규 행만 보냅니다
> (입력 창구는 append 가정). 겹쳐 보내도 upsert라 안전합니다.

## 3. Vercel 대시보드

`vercel-dashboard/` (Next.js 14 App Router).

```bash
cd vercel-dashboard
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 채우기
npm install
npm run dev                  # http://localhost:3000
```

배포: Vercel 임포트(Root Directory = `vercel-dashboard`) → 환경변수 2개 등록 → 배포 후 URL을 GAS `DASHBOARD_URL`에.
대시보드는 `cs_v_weekly_full`(주차 KPI/AI/분해)과 `cs_v_monthly_summary`(월간 추이)를 직접 조회합니다.

> **다른 DB와 공유 시 주의**: `anon` 키는 프로젝트 전체 공용이므로 노출돼도 안전하도록 다른 테이블도 RLS가 켜져 있어야 하고,
> GAS의 `service_role` 키는 프로젝트 전체 읽기/쓰기 권한이니 서버(ScriptProperties)에만 보관하세요.

---

## 디렉토리 구조

```
aiedu/
├─ flowchart/             # 순서도 (make_flowchart.py → process_flow.jpg)
├─ gas/                   # Google Apps Script
│  ├─ Config.gs           # 탭/컬럼매핑/DB·비밀값 래퍼
│  ├─ Masking.gs          # PII 마스킹(차량번호·차량ID)
│  ├─ WeekUtil.gs         # 주차 라벨/날짜 파싱(라벨 생성·정규화용)
│  ├─ Ingest.gs           # 시트→마스킹/정규화→Supabase 증분 upsert
│  ├─ Analyze.gs          # 집계 View 조회 → stats 매핑(연산은 SQL)
│  ├─ Gemini.gs           # AI 코멘트(폴백 포함)
│  ├─ Report.gs           # HTML 메일
│  ├─ Supabase.gs         # REST upsert/select, 통합뷰 조회, 인사이트 저장
│  ├─ Main.gs             # 오케스트레이션·로깅·트리거
│  └─ appsscript.json     # OAuth 스코프
├─ supabase/schema.sql    # 테이블 + 주차함수 + 일/주/월 View + RLS
├─ vercel-dashboard/      # Next.js 대시보드(View 직접 조회)
└─ README.md
```

## 운영 메모
- PII는 전송 전 마스킹 → Supabase에도 원본 미저장. 요청자명/카드번호는 적재 자체를 안 함(분모 카운트만).
- 단계별 실패는 격리, 오류 시 `ADMIN_EMAIL`로 알림. 멱등 upsert로 재실행 안전.
- 집계 로직을 바꾸려면 GAS가 아니라 `supabase/schema.sql`의 View를 수정하면 됩니다.
