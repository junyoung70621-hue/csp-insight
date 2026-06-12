/**
 * Config.gs
 * 전역 상수 / 입력 탭·컬럼 매핑 / 비밀값 래퍼.
 *
 * [아키텍처 v3]
 *   구글 시트 = 입력 창구/뷰, Supabase = 저장소+집계 엔진.
 *   GAS 는 두 탭을 읽어 "필요한 컬럼만 마스킹/정규화" 하여 Supabase 에 upsert.
 *   집계/주차계산/중복제거는 GAS 가 하지 않는다(각각 SQL View / PK 제약).
 *
 * [원본 탭]
 *   1차필터 = 전화상담 전체 → cs_l1  (PII·자유텍스트는 저장하지 않음)
 *   2차필터 = AS/현장 처리   → cs_l2  (고유 ID=접수번호, '2차필터'값='현장인계' 가 현장인계)
 *   두 탭 모두 A~D 등 수식 컬럼이 앞에 있을 수 있으나 "헤더 이름"으로 매핑하므로 무방.
 *
 * [집계] 전체=l1+l2, 필터=l1+(l2−현장인계), 필터링율=필터/전체  (전부 SQL)
 * [보안] 비밀값은 ScriptProperties.
 */

const SHEET = { LOG: '_Log' };   // 로그 시트(저장소는 Supabase)

// 원본 워크북 탭 이름 (실제와 다르면 여기만 수정)
const SRC_TABS = {
  l1: '1차필터',   // 전화상담 전체
  l2: '2차필터',   // AS/현장
};

// Supabase 테이블/뷰 이름 (cs_ 접두사로 다른 앱과 공유 안전)
const DB = {
  l1: 'cs_l1',
  l2: 'cs_l2',
  weeklyInsight: 'cs_weekly_insight',
  weeklyFull: 'cs_v_weekly_full',
};

// 1차필터(전화상담) 컬럼 매핑 — 분석에 필요한 것만
const COLS_L1 = {
  receivedAt: '접수일시',
  filterFlag: '필터여부',
  dept: '배정부서',
  channel: '접수채널',
  consultType: '상담유형(대)',
  status: '처리상태',
  carNo: '차량번호',        // 마스킹(표시) + 해시(재접수 매칭)
  errType: '오류유형',      // 재접수 매칭용 장애유형
  region: '지역명',
  // 합성키 재료(원본값) — 저장하진 않음
  callNo: '발신번호',
  asId: 'AS접수번호',
};

// 2차필터(AS/현장) 컬럼 매핑
const COLS_L2 = {
  id: '접수번호',           // 고유 ID
  secondFilter: '2차필터',   // 값이 '현장인계' 면 현장인계
  receivedAt: '장애접수일시',
  operator: '교통사업자명',
  office: '영업소명',
  route: '노선명',
  dept: '배정부서',
  device: '단말기구분',
  reqType: '접수구분',
  errType: '접수오류유형',
  fieldType: '현장처리유형',
  carNo: '차량번호',        // 마스킹
  carId: '차량ID',          // 마스킹
  startAt: '처리시작일시',
  doneAt: '처리완료일시',
  done: '완료',
};

// ── 비밀값 접근 래퍼 ─────────────────────────────────────────
function prop_(key, required) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !v) throw new Error('ScriptProperty 누락: ' + key);
  return v;
}

const CFG = {
  sourceSpreadsheetId: () => prop_('SOURCE_SPREADSHEET_ID', false) || prop_('SPREADSHEET_ID', true),
  spreadsheetId: () => prop_('SPREADSHEET_ID', true),
  geminiKey: () => prop_('GEMINI_API_KEY', false),
  supabaseUrl: () => prop_('SUPABASE_URL', true),
  supabaseKey: () => prop_('SUPABASE_SERVICE_KEY', true),
  recipients: () => (prop_('REPORT_RECIPIENTS', true) || '').split(',').map(s => s.trim()).filter(Boolean),
  dashboardUrl: () => prop_('DASHBOARD_URL', false) || '',
  adminEmail: () => prop_('ADMIN_EMAIL', false) || Session.getActiveUser().getEmail(),
  tz: () => prop_('TIMEZONE', false) || 'Asia/Seoul',
};

/** 최초 1회: 스크립트 속성 세팅. 실행 후 키를 코드에 남기지 말 것. */
function setupProperties_() {
  PropertiesService.getScriptProperties().setProperties({
    SOURCE_SPREADSHEET_ID: '원본_워크북_시트_ID(1차필터·2차필터 탭)',
    SPREADSHEET_ID: '로그_저장용_스프레드시트_ID(같아도 됨)',
    GEMINI_API_KEY: '여기에_Gemini_API_KEY',
    SUPABASE_URL: 'https://epvtsaowyizuhvrwcrmp.supabase.co',
    SUPABASE_SERVICE_KEY: '여기에_service_role_key',
    REPORT_RECIPIENTS: 'a@example.com, b@example.com',
    DASHBOARD_URL: 'https://your-dashboard.vercel.app',
    ADMIN_EMAIL: 'admin@example.com',
    TIMEZONE: 'Asia/Seoul',
  }, false);
}
