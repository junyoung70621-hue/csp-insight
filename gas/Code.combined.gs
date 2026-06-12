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
/**
 * WeekUtil.gs
 * 주차 산정 로직: 매주 "목요일 ~ 차주 수요일".
 * getDay(): 일0 월1 화2 수3 목4 금5 토6  →  주 시작 = 목(4)
 */

/** 날짜 → 'yyyy-MM-dd' (스크립트 타임존 기준) */
function fmtDate_(d) {
  return Utilities.formatDate(d, CFG.tz(), 'yyyy-MM-dd');
}

/**
 * 주어진 날짜가 속한 주차(목~수) 범위를 반환.
 * @return {{start:Date, end:Date, label:string}}
 *   label 예: '2026-06-11~2026-06-17'
 */
function getWeekRange(dateInput) {
  const d = parseDate_(dateInput);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() - 4 + 7) % 7;        // 목요일로부터 경과 일수
  const start = new Date(d);
  start.setDate(d.getDate() - offset);            // 해당 주 목요일
  const end = new Date(start);
  end.setDate(start.getDate() + 6);               // 차주 수요일
  return { start: start, end: end, label: fmtDate_(start) + '~' + fmtDate_(end) };
}

/** 현재(오늘)가 속한 주차 라벨 */
function currentWeekLabel() {
  return getWeekRange(new Date()).label;
}

/**
 * 다양한 입력을 Date 로 안전 파싱. 실패 시 today.
 * 지원: Date / 'yyyy-MM-dd[ HH:mm[:ss]]' / 'yyyy.MM.dd' / 'yyyy/MM/dd'
 *      패킹 숫자 yyyymmdd(8) · yyyymmddHHmm(12) · yyyymmddHHmmss(14) (숫자/문자 공통)
 *      엑셀 시리얼(약 1000~600000 범위의 숫자)
 */
function parseDate_(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v);

  // 숫자/문자 공통: 순수 숫자열의 패킹 날짜 우선 처리
  const raw = String(v == null ? '' : v).trim();
  if (/^\d{8}$/.test(raw)) {                       // yyyymmdd
    return new Date(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8));
  }
  if (/^\d{12}$/.test(raw)) {                      // yyyymmddHHmm
    return new Date(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8),
                    +raw.slice(8, 10), +raw.slice(10, 12));
  }
  if (/^\d{14}$/.test(raw)) {                      // yyyymmddHHmmss
    return new Date(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8),
                    +raw.slice(8, 10), +raw.slice(10, 12), +raw.slice(12, 14));
  }

  if (typeof v === 'number') {                     // 엑셀 1900 시리얼 (위 패킹 아님)
    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }

  if (!raw) return new Date();
  const norm = raw.replace(/[.]/g, '-').replace(/\//g, '-');
  const m = norm.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  const t = new Date(raw);
  return isNaN(t) ? new Date() : t;
}
/**
 * Masking.gs
 * 개인정보(PII) 마스킹 유틸.
 *
 * v3 정책: 분석에 불필요한 PII/자유텍스트(요청자명·카드번호·연락처·주소·문의/답변 등)는
 *          애초에 Supabase 로 보내지 않는다(Ingest 에서 매핑 제외).
 *          저장하는 식별자성 값 중 차량번호·차량ID 만 마스킹한다.
 */

/** 차량번호/차량ID: 전체 마스킹 '***'. 빈값은 '' */
function maskCarNo(v) {
  const s = String(v == null ? '' : v).trim();
  return s ? '***' : '';
}

/** 이름: 첫 글자만 남김 (예: 홍길동 → 홍**). 현재 미사용이나 유지 */
function maskName(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.length === 1) return '*';
  return s.charAt(0) + '*'.repeat(Math.min(s.length - 1, 4));
}

/** 전화/카드번호 등: 전체 마스킹 '***'. 현재 미사용이나 유지 */
function maskPhone(v) {
  const s = String(v == null ? '' : v).trim();
  return s ? '***' : '';
}
/**
 * Ingest.gs  (Sync — 전체 새로고침 방식)
 * 두 시트 탭 → 필요한 컬럼만 마스킹/정규화 → Supabase 전체 교체(delete-all + insert).
 *
 * 왜 전체 새로고침인가:
 *   1차필터(전화상담)는 고유 ID가 없어 행번호 키를 쓰면 정렬·중간삽입 시 중복이 생긴다.
 *   매 실행마다 대상 테이블을 비우고 "현재 시트 내용"으로 다시 채우면 항상 정확히 일치
 *   (중복·수정·삭제 모두 반영). 데이터 규모(~수천 행)에선 충분히 빠르다.
 *
 *   - 1차필터(전화상담) → cs_l1,  2차필터(AS/현장) → cs_l2
 *   - 집계/주차계산은 GAS 가 하지 않는다(전부 SQL View).
 */

/** 메인: 두 탭 전체 새로고침. @return {{l1:number, l2:number, done:boolean}} */
function syncToSupabase() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    logEvent_('WARN', 'sync', '다른 실행 진행 중 — 스킵');
    return { l1: 0, l2: 0, done: false };
  }
  try {
    const a = refreshTab_(SRC_TABS.l1, COLS_L1, buildL1Row_, DB.l1);
    const b = refreshTab_(SRC_TABS.l2, COLS_L2, buildL2Row_, DB.l2);
    logEvent_('INFO', 'sync', `cs_l1=${a}, cs_l2=${b}`);
    return { l1: a, l2: b, done: true };
  } finally {
    lock.releaseLock();
  }
}

// 과거 함수명 호환(둘 다 전체 새로고침을 수행)
function resyncAll() { return syncToSupabase(); }
function resyncUntilDone() { return syncToSupabase(); }

/**
 * 한 탭을 통째로 읽어 변환 → 대상 테이블 비우고 재적재. @return {number} 적재 행수
 */
function refreshTab_(tabName, colsMap, buildFn, table) {
  const ss = SpreadsheetApp.openById(CFG.sourceSpreadsheetId());
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('원본 탭 없음: ' + tabName);
  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2) { supabaseDeleteAll_(table); return 0; }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const idx = {};
  Object.keys(colsMap).forEach(k => { idx[k] = headers.indexOf(colsMap[k]); });

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const rows = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rec = {};
    Object.keys(idx).forEach(k => { rec[k] = idx[k] >= 0 ? row[idx[k]] : ''; });
    if (!rec.receivedAt) continue;                 // 유효행만(날짜 필수)
    rows.push(buildFn(rec, i + 2));                 // 절대 시트행 번호(헤더=1, 데이터 2부터)
  }
  const uniq = dedupeByKey_(rows);

  // 비우고 재적재 (delete 실패 시 중단 — 데이터 유실 방지)
  if (!supabaseDeleteAll_(table)) {
    logEvent_('WARN', 'sync', `${table} 비우기 실패 — 적재 중단(기존 데이터 유지)`);
    return 0;
  }
  let sent = 0, ok = true;
  for (let i = 0; i < uniq.length; i += 500) {
    const batch = uniq.slice(i, i + 500);
    ok = supabaseUpsert_(table, batch, 'row_key') && ok;
    if (ok) sent += batch.length;
  }
  if (!ok) logEvent_('WARN', 'sync', `${table} 일부 적재 실패 — 다음 실행에서 재시도`);
  return sent;
}

/** 1차필터(전화상담) → cs_l1 행. 행번호 키(전체 새로고침이라 안정적), 차량번호 마스킹+해시 */
function buildL1Row_(rec, sheetRow) {
  return {
    row_key: 'L1R:' + sheetRow,
    received_at: toIso_(rec.receivedAt),
    filter_flag: str_(rec.filterFlag),
    dept: str_(rec.dept),
    channel: str_(rec.channel),
    consult_type: str_(rec.consultType),
    status: str_(rec.status),
    car_no: maskCarNo(rec.carNo),
    car_hash: hashCarNo_(rec.carNo),     // 재접수 매칭용(원문 미저장)
    err_type: str_(rec.errType),         // 재접수 매칭용 장애유형
    region: str_(rec.region),
  };
}

/** 2차필터(AS/현장) → cs_l2 행. 접수번호 키(없으면 행번호), 차량번호·차량ID 마스킹 */
function buildL2Row_(rec, sheetRow) {
  const id = str_(rec.id);
  return {
    row_key: id ? 'ID:' + id : 'L2R:' + sheetRow,
    reception_id: id || null,
    second_filter: str_(rec.secondFilter),
    received_at: toIso_(rec.receivedAt),
    operator: str_(rec.operator),
    office: str_(rec.office),
    route: str_(rec.route),
    dept: str_(rec.dept),
    device: str_(rec.device),
    req_type: str_(rec.reqType),
    err_type: str_(rec.errType),
    field_type: str_(rec.fieldType),
    car_no: maskCarNo(rec.carNo),
    car_id: maskCarNo(rec.carId),
    car_hash: hashCarNo_(rec.carNo),     // 재접수 매칭용(원문 미저장)
    start_at: toIso_(rec.startAt),
    done_at: toIso_(rec.doneAt),
    done: str_(rec.done),
  };
}

/** 배치 내 동일 row_key 제거(마지막 값 유지) — ON CONFLICT 21000 방지 */
function dedupeByKey_(rows) {
  const m = {};
  for (const r of rows) m[r.row_key] = r;
  return Object.keys(m).map(k => m[k]);
}

/** 날짜 → ISO8601(+09:00). 빈값 null. 주차계산은 SQL */
function toIso_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  return Utilities.formatDate(parseDate_(s), CFG.tz(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function str_(v) { return String(v == null ? '' : v).trim(); }

/** 차량번호 → 단방향 해시(원문 미저장, 재접수 동일차량 매칭용). 빈값은 '' */
function hashCarNo_(v) {
  var s = String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
  if (!s) return '';
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
  return d.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
/**
 * Analyze.gs
 * v2: 집계는 Supabase 가 수행한다. 여기서는 v_weekly_full 뷰를 조회해
 *     다운스트림(Gemini/Report)이 쓰는 stats 객체 형태로 매핑만 한다.
 *
 * stats = {weekLabel, total, first, second, filterRate, handover, handoverRate,
 *          avgDays, byDept, byType, byStatus}
 */

function analyzeWeek(weekLabel) {
  const label = weekLabel || currentWeekLabel();
  const row = getWeeklyFull_(label);          // Supabase.gs (없으면 null)
  if (!row) return emptyResult_(label);
  return {
    weekLabel: label,
    total: num_(row.total),
    first: num_(row.first_filter),
    second: num_(row.second_filter),
    filterRate: num_(row.filter_rate),
    handover: num_(row.handover),
    handoverRate: num_(row.handover_rate),
    avgDays: num_(row.avg_days),
    byDept: row.by_dept || {},
    byType: row.by_type || {},
    byStatus: row.by_status || {},
  };
}

function emptyResult_(label) {
  return {
    weekLabel: label,
    total: 0, first: 0, second: 0,
    filterRate: 0, handover: 0, handoverRate: 0, avgDays: 0,
    byDept: {}, byType: {}, byStatus: {},
  };
}

function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

/** {key:count} → [{key,count}] 내림차순 (Gemini/Report 공용) */
function toSortedList_(obj) {
  return Object.keys(obj || {}).map(k => ({ key: k, count: obj[k] }))
               .sort((a, b) => b.count - a.count);
}

/** 백분율 (분모 0 → 0), 소수 1자리 — 폴백 메시지 등에서 사용 */
function pct_(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}
/**
 * Supabase.gs
 * Supabase REST 저수준 호출 + 도메인 헬퍼.
 *
 * - 쓰기: service_role 키로 upsert (Prefer: resolution=merge-duplicates)
 *         → 접수번호/row_key PK 로 DB 가 중복 자동 차단.
 * - 읽기: 집계 View(v_weekly_full) 조회 → GAS 는 집계하지 않음.
 */

function supabaseBase_() { return CFG.supabaseUrl().replace(/\/+$/, '') + '/rest/v1/'; }
function supabaseHeaders_() {
  const key = CFG.supabaseKey();
  return { apikey: key, Authorization: 'Bearer ' + key };
}

/** upsert (배열 rows) — @return {boolean} */
function supabaseUpsert_(table, rows, onConflict) {
  if (!rows || !rows.length) return true;
  try {
    const url = supabaseBase_() + table + '?on_conflict=' + encodeURIComponent(onConflict);
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: Object.assign({}, supabaseHeaders_(), {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      payload: JSON.stringify(rows),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) return true;
    logEvent_('WARN', 'supabase', `${table} upsert HTTP ${code}: ${resp.getContentText().slice(0, 300)}`);
    return false;
  } catch (e) {
    logEvent_('ERROR', 'supabase', `${table} upsert 예외: ${e && e.message}`);
    return false;
  }
}

/** 테이블 전체 행 삭제(service_role, RLS 우회). 전체 새로고침용. @return {boolean} */
function supabaseDeleteAll_(table) {
  try {
    const url = supabaseBase_() + table + '?row_key=not.is.null';   // 모든 행 매칭
    const resp = UrlFetchApp.fetch(url, {
      method: 'delete',
      headers: Object.assign({}, supabaseHeaders_(), { Prefer: 'return=minimal' }),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) return true;
    logEvent_('WARN', 'supabase', `${table} delete HTTP ${code}: ${resp.getContentText().slice(0, 200)}`);
    return false;
  } catch (e) {
    logEvent_('ERROR', 'supabase', `${table} delete 예외: ${e && e.message}`);
    return false;
  }
}

/** GET select. @param {string} query  PostgREST 쿼리스트링(앞에 ? 제외) @return {Array} */
function supabaseSelect_(table, query) {
  try {
    const url = supabaseBase_() + table + (query ? '?' + query : '');
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: Object.assign({}, supabaseHeaders_(), { Accept: 'application/json' }),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) return JSON.parse(resp.getContentText() || '[]');
    logEvent_('WARN', 'supabase', `${table} select HTTP ${code}: ${resp.getContentText().slice(0, 300)}`);
    return [];
  } catch (e) {
    logEvent_('ERROR', 'supabase', `${table} select 예외: ${e && e.message}`);
    return [];
  }
}

/** 주차 통합 요약(집계+분해+AI) 1행 조회 — 없으면 null */
function getWeeklyFull_(weekLabel) {
  const rows = supabaseSelect_(DB.weeklyFull,
    'week_label=eq.' + encodeURIComponent(weekLabel) + '&limit=1');
  return rows && rows.length ? rows[0] : null;
}

/** AI 인사이트 저장(주차 PK upsert) */
function upsertWeeklyInsight(weekLabel, insight) {
  const row = {
    week_label: weekLabel,
    ai_summary: insight.summary,
    ai_highlights: insight.highlights,
    ai_suggestions: insight.suggestions,
    ai_source: insight.source,
    updated_at: new Date().toISOString(),
  };
  return supabaseUpsert_(DB.weeklyInsight, [row], 'week_label');
}
/**
 * Gemini.gs
 * 주차 집계 결과(analyzeWeek 반환값)를 받아 Gemini 2.5 Flash 로
 * 자연어 코멘트(요약/특이사항/제안)를 생성한다.
 *
 * - 모델: gemini-2.5-flash (generativelanguage v1beta)
 * - responseSchema 로 JSON 출력 강제 → 파싱 안정화
 * - API 키가 없거나(미설정) 호출/파싱 실패 시 규칙 기반 폴백 코멘트 사용
 * - 전송 데이터는 이미 마스킹된 집계 수치뿐 (원본 PII 없음)
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/' +
  GEMINI_MODEL + ':generateContent';

/**
 * @param {Object} stats analyzeWeek() 반환 객체
 * @return {{summary:string, highlights:string[], suggestions:string[], source:string}}
 *   source: 'gemini' | 'fallback'
 */
function generateInsight(stats) {
  const key = CFG.geminiKey();
  if (!key) {
    logEvent_('INFO', 'gemini', 'API 키 미설정 — 폴백 코멘트 사용');
    return fallbackInsight_(stats);
  }
  try {
    const body = {
      contents: [{
        role: 'user',
        parts: [{ text: buildPrompt_(stats) }],
      }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: INSIGHT_SCHEMA_,
      },
    };
    const resp = UrlFetchApp.fetch(GEMINI_ENDPOINT + '?key=' + encodeURIComponent(key), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code !== 200) {
      logEvent_('WARN', 'gemini', 'HTTP ' + code + ' — 폴백 사용: ' + resp.getContentText().slice(0, 300));
      return fallbackInsight_(stats);
    }
    const json = JSON.parse(resp.getContentText());
    const text = json &&
      json.candidates && json.candidates[0] &&
      json.candidates[0].content && json.candidates[0].content.parts &&
      json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
    if (!text) {
      logEvent_('WARN', 'gemini', '응답 본문 비어 있음 — 폴백 사용');
      return fallbackInsight_(stats);
    }
    const parsed = JSON.parse(text);
    return {
      summary: String(parsed.summary || '').trim() || fallbackInsight_(stats).summary,
      highlights: toStrArr_(parsed.highlights),
      suggestions: toStrArr_(parsed.suggestions),
      source: 'gemini',
    };
  } catch (e) {
    logEvent_('ERROR', 'gemini', '예외 — 폴백 사용: ' + (e && e.message));
    return fallbackInsight_(stats);
  }
}

// Gemini responseSchema (OpenAPI subset)
const INSIGHT_SCHEMA_ = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'highlights', 'suggestions'],
};

function buildPrompt_(s) {
  const top = (list) => toSortedList_(list).slice(0, 5)
    .map(o => `${o.key}(${o.count})`).join(', ') || '없음';
  return [
    '너는 콜센터 운영 분석가다. 아래 한 주(목~수) 고객센터 전화접수 집계를',
    '경영진 보고용으로 간결하고 객관적인 한국어로 해설하라.',
    '추측·과장 없이 수치 근거로만 작성한다. 개인정보는 포함하지 마라.',
    '',
    `주차: ${s.weekLabel}`,
    `전체 접수: ${s.total}건`,
    `1차 필터: ${s.first}건, 2차 필터: ${s.second}건, 필터링율: ${s.filterRate}%`,
    `현장인계: ${s.handover}건 (${s.handoverRate}%)`,
    `평균 처리소요일: ${s.avgDays}일`,
    `배정부서 상위: ${top(s.byDept)}`,
    `상담유형 상위: ${top(s.byType)}`,
    `처리상태: ${top(s.byStatus)}`,
    '',
    'JSON으로만 답하라. summary는 3~4문장. highlights는 특이사항 2~4개,',
    'suggestions는 실행 가능한 운영 개선 제안 2~3개.',
  ].join('\n');
}

/** 규칙 기반 폴백 (API 불가 시에도 보고서가 비지 않도록) */
function fallbackInsight_(s) {
  if (!s.total) {
    return {
      summary: `${s.weekLabel} 주차에는 접수된 건이 없습니다.`,
      highlights: ['접수 0건'],
      suggestions: ['데이터 수집 경로(드라이브 폴더/CSV 적재)를 점검하세요.'],
      source: 'fallback',
    };
  }
  const topDept = toSortedList_(s.byDept)[0];
  const topType = toSortedList_(s.byType)[0];
  const summary =
    `${s.weekLabel} 주차 전체 접수는 ${s.total}건이며, 필터링율은 ${s.filterRate}%` +
    `(1차 ${s.first}건·2차 ${s.second}건)입니다. 현장인계는 ${s.handover}건(${s.handoverRate}%),` +
    ` 평균 처리소요일은 ${s.avgDays}일입니다.`;
  const highlights = [];
  if (topType) highlights.push(`최다 문의유형: ${topType.key} (${topType.count}건)`);
  if (topDept) highlights.push(`최다 처리부서: ${topDept.key} (${topDept.count}건)`);
  highlights.push(`필터링율 ${s.filterRate}% / 현장인계율 ${s.handoverRate}%`);
  const suggestions = [];
  if (s.filterRate >= 50) suggestions.push('필터링 비중이 높습니다 — 1·2차 필터 사유를 분류해 단순 문의 셀프서비스화를 검토하세요.');
  else suggestions.push('필터링율 추이를 주차별로 모니터링하세요.');
  if (s.avgDays >= 3) suggestions.push('평균 처리소요일이 길어지고 있습니다 — 병목 단계를 점검하세요.');
  return { summary: summary, highlights: highlights, suggestions: suggestions, source: 'fallback' };
}

function toStrArr_(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x == null ? '' : x).trim()).filter(Boolean);
}
/**
 * Report.gs
 * 주차 집계(stats) + AI 코멘트(insight) → 인라인 CSS HTML 메일 발송.
 *
 * - 인라인 CSS만 사용 (대부분의 메일 클라이언트가 <style>/외부CSS를 무시)
 * - 0건 주차에도 정상적으로 "접수 없음" 메일을 보낸다
 * - 수신자는 ScriptProperties REPORT_RECIPIENTS (쉼표 구분)
 */

/**
 * @param {Object} stats   analyzeWeek() 반환
 * @param {Object} insight generateInsight() 반환
 * @return {{sent:number, subject:string}}
 */
function sendWeeklyReport(stats, insight) {
  const recipients = CFG.recipients();
  if (!recipients.length) {
    logEvent_('WARN', 'report', '수신자(REPORT_RECIPIENTS) 미설정 — 발송 생략');
    return { sent: 0, subject: '' };
  }
  const subject = `[고객센터 주간보고] ${stats.weekLabel} (접수 ${stats.total}건)`;
  const html = buildReportHtml_(stats, insight);
  GmailApp.sendEmail(recipients.join(','), subject, htmlToPlain_(html), {
    htmlBody: html,
    name: '고객센터 전화접수 자동화',
  });
  logEvent_('INFO', 'report', `발송 완료 → ${recipients.length}명 (${stats.weekLabel})`);
  return { sent: recipients.length, subject: subject };
}

function buildReportHtml_(s, ins) {
  const C = {
    wrap: 'max-width:680px;margin:0 auto;font-family:"Malgun Gothic","맑은 고딕",Arial,sans-serif;color:#1f2937;',
    h1: 'font-size:20px;font-weight:700;margin:0 0 4px;color:#111827;',
    sub: 'font-size:13px;color:#6b7280;margin:0 0 20px;',
    card: 'border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:0 0 16px;',
    kpiTd: 'padding:10px;text-align:center;border-right:1px solid #f1f5f9;',
    kpiNum: 'font-size:22px;font-weight:700;color:#2563eb;',
    kpiLbl: 'font-size:12px;color:#6b7280;margin-top:2px;',
    sectionH: 'font-size:15px;font-weight:700;margin:20px 0 8px;color:#111827;',
    th: 'text-align:left;font-size:12px;color:#6b7280;padding:8px 10px;border-bottom:2px solid #e5e7eb;',
    td: 'font-size:13px;padding:8px 10px;border-bottom:1px solid #f1f5f9;',
    tdNum: 'font-size:13px;padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;',
    aiBox: 'background:#f8fafc;border-left:4px solid #2563eb;border-radius:6px;padding:14px 16px;margin:0 0 16px;',
    li: 'font-size:13px;line-height:1.6;margin:0 0 4px;',
    foot: 'font-size:11px;color:#9ca3af;margin-top:24px;border-top:1px solid #f1f5f9;padding-top:12px;',
  };

  const kpis = [
    ['전체 접수', s.total + '건'],
    ['필터링율', s.filterRate + '%'],
    ['현장인계', s.handover + '건'],
    ['평균 처리일', s.avgDays + '일'],
  ];
  const kpiCells = kpis.map((k, i) =>
    `<td style="${C.kpiTd}${i === kpis.length - 1 ? 'border-right:none;' : ''}">` +
    `<div style="${C.kpiNum}">${esc_(k[1])}</div>` +
    `<div style="${C.kpiLbl}">${esc_(k[0])}</div></td>`).join('');

  const aiList = (arr) => arr.length
    ? arr.map(x => `<li style="${C.li}">${esc_(x)}</li>`).join('')
    : `<li style="${C.li}">-</li>`;

  const breakdowns = [
    ['부서별', s.byDept],
    ['상담유형별', s.byType],
    ['처리상태별', s.byStatus],
  ].map(([title, obj]) => {
    const rows = toSortedList_(obj).slice(0, 8).map(o =>
      `<tr><td style="${C.td}">${esc_(o.key)}</td><td style="${C.tdNum}">${o.count}</td></tr>`
    ).join('') || `<tr><td style="${C.td}" colspan="2">데이터 없음</td></tr>`;
    return `<div style="${C.sectionH}">${esc_(title)}</div>` +
      `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">` +
      `<tr><th style="${C.th}">항목</th><th style="${C.th};text-align:right;">건수</th></tr>` +
      rows + `</table>`;
  }).join('');

  const aiSourceBadge = ins.source === 'gemini'
    ? '<span style="font-size:11px;color:#2563eb;">AI 분석(Gemini)</span>'
    : '<span style="font-size:11px;color:#9ca3af;">규칙 기반 요약</span>';

  const dashLink = CFG.dashboardUrl()
    ? `<p style="margin:8px 0 0;"><a href="${esc_(CFG.dashboardUrl())}" style="color:#2563eb;font-size:13px;">▶ 대시보드에서 자세히 보기</a></p>`
    : '';

  return `<div style="${C.wrap}">
    <h1 style="${C.h1}">📞 고객센터 전화접수 주간 현황</h1>
    <p style="${C.sub}">집계 주차(목~수): <b>${esc_(s.weekLabel)}</b></p>

    <div style="${C.card}">
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr>${kpiCells}</tr></table>
    </div>

    <div style="${C.aiBox}">
      <div style="font-weight:700;margin-bottom:6px;">🧠 주간 요약 ${aiSourceBadge}</div>
      <div style="font-size:13px;line-height:1.7;">${esc_(ins.summary)}</div>
      <div style="${C.sectionH}">특이사항</div>
      <ul style="margin:0;padding-left:18px;">${aiList(ins.highlights)}</ul>
      <div style="${C.sectionH}">개선 제안</div>
      <ul style="margin:0;padding-left:18px;">${aiList(ins.suggestions)}</ul>
    </div>

    ${breakdowns}
    ${dashLink}

    <p style="${C.foot}">본 메일은 자동 생성되었습니다. 개인정보(이름·전화·차량번호)는 마스킹 처리되어 있습니다.<br>
    1차+2차 필터 건수 ÷ 전체 접수 = 필터링율 기준 · 생성시각 ${esc_(nowStamp_())}</p>
  </div>`;
}

/** HTML → 단순 텍스트 (멀티파트 fallback) */
function htmlToPlain_(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h1)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function esc_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), CFG.tz(), 'yyyy-MM-dd HH:mm');
}
/**
 * Upload.gs
 * 웹앱 엔드포인트(doPost): 대시보드에서 올린 CSV 를 해당 시트에 "추가(append)".
 *
 * 흐름: 대시보드 → Next.js /api/upload → (이 웹앱) doPost → 시트 append → syncToSupabase
 *
 * 배포: Apps Script → 배포 → 새 배포 → 유형 "웹 앱"
 *   - 실행: 나(스크립트 소유자)  / 액세스: 모든 사용자
 *   - 생성된 /exec URL 을 Vercel 환경변수 GAS_UPLOAD_URL 에 설정
 *
 * 보안: 사용자 선택에 따라 토큰 없음(공개). URL 은 Next 서버에만 보관해 약간의 은닉.
 */

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var tabName = String(body.sheet || '').trim();
    var allowed = [SRC_TABS.l1, SRC_TABS.l2];
    if (allowed.indexOf(tabName) < 0) return jsonOut_({ ok: false, error: '허용되지 않은 시트: ' + tabName });

    // CSV 텍스트 확보 (base64 우선 — 한글 인코딩 안전 처리)
    var csvText;
    if (body.b64) {
      var blob = Utilities.newBlob(Utilities.base64Decode(body.b64), 'text/csv');
      csvText = blob.getDataAsString('UTF-8');
      if (/�/.test(csvText)) csvText = blob.getDataAsString('EUC-KR');  // 국내 CSV 대비
    } else {
      csvText = String(body.csv || '');
    }
    var table = Utilities.parseCsv(csvText);
    if (!table || table.length < 2) return jsonOut_({ ok: false, error: '빈 CSV 또는 헤더만 있음' });

    var ss = SpreadsheetApp.openById(CFG.sourceSpreadsheetId());
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return jsonOut_({ ok: false, error: '시트 없음: ' + tabName });

    var added = appendCsvToSheet_(sheet, table);

    var sync = null;
    try { sync = syncToSupabase(); } catch (err) { /* 동기화 실패해도 업로드 자체는 성공 처리 */ }

    logEvent_('INFO', 'upload', tabName + ' +' + added + '행' +
      (sync ? (' · sync l1=' + sync.l1 + ' l2=' + sync.l2) : ' · sync 스킵'));
    return jsonOut_({ ok: true, sheet: tabName, added: added, sync: sync });
  } catch (err) {
    logEvent_('ERROR', 'upload', String(err && err.message || err));
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

/** 헬스체크(브라우저 GET 확인용) */
function doGet() {
  return jsonOut_({ ok: true, service: 'cs-upload', tabs: [SRC_TABS.l1, SRC_TABS.l2] });
}

/**
 * CSV(table: [[헤더...],[행...]]) 를 시트 맨 아래에 헤더명 기준으로 추가.
 * - CSV 헤더와 시트 헤더를 이름으로 매핑(열 위치 무관)
 * - 시트의 수식 컬럼(A~D 등)은 직전 행 수식을 새 행들로 복사해 자동 채움
 * @return {number} 추가된 행수
 */
function appendCsvToSheet_(sheet, table) {
  var nCols = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  var sheetHeaders = sheet.getRange(1, 1, 1, nCols).getValues()[0].map(function (h) { return String(h).trim(); });
  var csvHeaders = table[0].map(function (h) { return String(h).trim(); });

  // csv열 -> 시트열(1-based, 없으면 0)
  var colMap = csvHeaders.map(function (h) { return sheetHeaders.indexOf(h) + 1; });

  var nRows = table.length - 1;
  var startRow = lastRow + 1;

  // 직전 데이터행의 수식 파악(수식 컬럼 자동 채움용)
  var formulaRow = lastRow >= 2 ? sheet.getRange(lastRow, 1, 1, nCols).getFormulas()[0] : [];

  // 새 행 2차원 배열 구성(전 컬럼, 기본 빈값)
  var out = [];
  for (var r = 1; r < table.length; r++) {
    var arr = [];
    for (var c = 0; c < nCols; c++) arr.push('');
    for (var cc = 0; cc < csvHeaders.length; cc++) {
      var sc = colMap[cc];
      if (sc > 0) arr[sc - 1] = table[r][cc];
    }
    out.push(arr);
  }
  sheet.getRange(startRow, 1, nRows, nCols).setValues(out);

  // 수식 컬럼은 직전 행 수식을 새 행 범위로 복사(상대참조 자동 조정)
  if (formulaRow.length) {
    for (var col = 0; col < nCols; col++) {
      if (formulaRow[col]) {
        try {
          sheet.getRange(lastRow, col + 1)
               .copyTo(sheet.getRange(startRow, col + 1, nRows, 1), { contentsOnly: false });
        } catch (e) { /* 수식 복사 실패는 무시 */ }
      }
    }
  }
  return nRows;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
/**
 * Main.gs
 * 오케스트레이션 + 실행 로깅 + 트리거 설치.
 *
 * 파이프라인(runDaily) — v2:
 *   1) syncToSupabase()       시트 탭 → 마스킹/정규화 → Supabase upsert(중복은 PK가 차단)
 *   2) analyzeWeek()          Supabase 집계 View(v_weekly_full) 조회 → stats
 *   3) generateInsight()      Gemini(or 폴백) 코멘트
 *   4) upsertWeeklyInsight()  AI 코멘트 저장(주차 PK)
 *   5) sendWeeklyReport()     HTML 메일 발송
 *
 * 단계별 실패는 격리. 마지막에 관리자 알림. 전 과정 _Log 시트 기록.
 */

function runDaily() {
  const errors = [];
  const t0 = new Date();
  let sync = null, stats = null;

  try { sync = syncToSupabase(); }
  catch (e) { errors.push(stepErr_('sync', e)); }

  const label = currentWeekLabel();
  try { stats = analyzeWeek(label); }
  catch (e) { errors.push(stepErr_('analyze', e)); stats = emptyResult_(label); }

  let insight;
  try { insight = generateInsight(stats); }
  catch (e) { errors.push(stepErr_('insight', e)); insight = fallbackInsight_(stats); }

  try { upsertWeeklyInsight(label, insight); }
  catch (e) { errors.push(stepErr_('insight.save', e)); }

  try { sendWeeklyReport(stats, insight); }
  catch (e) { errors.push(stepErr_('report', e)); }

  const secs = Math.round((new Date() - t0) / 1000);
  const summary = `주차=${label}, 접수=${stats ? stats.total : '?'}건, ` +
    `동기화(l1/l2)=${sync ? sync.l1 : 0}/${sync ? sync.l2 : 0}, ` +
    `AI=${insight.source}, 오류=${errors.length}, ${secs}s`;
  logEvent_(errors.length ? 'WARN' : 'INFO', 'runDaily', summary);

  if (errors.length) notifyAdmin_(label, errors);
  return { ok: !errors.length, summary: summary, errors: errors };
}

function stepErr_(step, e) {
  const msg = step + ': ' + (e && e.message ? e.message : e);
  logEvent_('ERROR', step, msg);
  return msg;
}

/** 관리자 오류 알림 */
function notifyAdmin_(label, errors) {
  try {
    const to = CFG.adminEmail();
    if (!to) return;
    MailApp.sendEmail(to,
      `[고객센터 자동화 오류] ${label}`,
      '아래 단계에서 오류가 발생했습니다:\n\n- ' + errors.join('\n- ') +
      '\n\n_Log 시트와 Apps Script 실행 로그를 확인하세요.');
  } catch (e) { /* 알림 실패는 무시 */ }
}

// ── 실행 로깅 (_Log 시트) ──────────────────────────────────────
function logEvent_(level, step, message) {
  try {
    const ss = SpreadsheetApp.openById(CFG.spreadsheetId());
    let sheet = ss.getSheetByName(SHEET.LOG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET.LOG);
      sheet.getRange(1, 1, 1, 4).setValues([['시각', '레벨', '단계', '메시지']]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      Utilities.formatDate(new Date(), CFG.tz(), 'yyyy-MM-dd HH:mm:ss'),
      level, step, message,
    ]);
    const last = sheet.getLastRow();
    if (last > 5001) sheet.deleteRows(2, last - 5001);
  } catch (e) {
    console.error('logEvent_ 실패: ' + (e && e.message) + ' / ' + level + ' ' + step + ' ' + message);
  }
}

// ── 트리거 설치 ────────────────────────────────────────────────
/** 매일 08:00(KST) runDaily 시간기반 트리거(중복 제거 후 설치). 1회 수동 실행. */
function installTrigger() {
  removeTriggers_();
  ScriptApp.newTrigger('runDaily')
    .timeBased().atHour(8).everyDays(1).inTimezone(CFG.tz())
    .create();
  logEvent_('INFO', 'trigger', 'runDaily 일일 트리거 설치(08:00 ' + CFG.tz() + ')');
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runDaily') ScriptApp.deleteTrigger(t);
  });
}

/**
 * 업로드 반영용: 10분마다 syncToSupabase 실행(시트→Supabase 전체 새로고침).
 * 대시보드 CSV 업로드가 ≤10분 내 자동 반영됨. 1회 수동 실행.
 */
function installSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncToSupabase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncToSupabase').timeBased().everyMinutes(10).create();
  logEvent_('INFO', 'trigger', 'syncToSupabase 10분 주기 트리거 설치');
}
