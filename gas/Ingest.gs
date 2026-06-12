/**
 * Ingest.gs  (Sync)
 * 두 시트 탭 → 필요한 컬럼만 마스킹/정규화 → Supabase upsert.
 *
 * - 1차필터(전화상담) → cs_l1,  2차필터(AS/현장) → cs_l2
 * - 집계/중복제거 없음. 중복은 Supabase PK(접수번호/합성키)가 차단.
 * - 증분 동기화: 탭별 마지막 동기화 행을 ScriptProperties 에 저장(append 가정).
 *   전량 재전송은 resyncAll(). upsert(merge-duplicates)라 겹쳐도 안전.
 */

const SYNC_PTR_PREFIX = 'SYNC_LASTROW_';

/** 메인: 두 탭 동기화. @return {{l1:number, l2:number, done:boolean}} */
function syncToSupabase() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    logEvent_('WARN', 'sync', '다른 실행 진행 중 — 스킵');
    return { l1: 0, l2: 0, done: false };
  }
  SYNC_START_MS = Date.now();
  try {
    const a = syncTab_(SRC_TABS.l1, COLS_L1, buildL1Row_, DB.l1);
    const b = syncTab_(SRC_TABS.l2, COLS_L2, buildL2Row_, DB.l2);
    const done = isSyncCaughtUp_();
    logEvent_('INFO', 'sync', `cs_l1=${a}, cs_l2=${b}, 완료=${done}`);
    return { l1: a, l2: b, done: done };
  } finally {
    lock.releaseLock();
  }
}

/** 두 탭 모두 마지막 행까지 동기화됐는지(이어받기 완료 판정) */
function isSyncCaughtUp_() {
  const ss = SpreadsheetApp.openById(CFG.sourceSpreadsheetId());
  const props = PropertiesService.getScriptProperties();
  return [SRC_TABS.l1, SRC_TABS.l2].every(function (tab) {
    const sh = ss.getSheetByName(tab);
    if (!sh) return true;
    const last = sh.getLastRow();
    const cur = parseInt(props.getProperty(SYNC_PTR_PREFIX + tab) || '1', 10);
    return cur >= last;
  });
}

/**
 * 시트가 매우 커서 한 번에 못 끝낼 때: 다 따라잡을 때까지 반복 호출.
 * 각 호출은 시간예산만큼만 처리하고 포인터를 커밋하므로 안전.
 * (수동 1회 실행용. 평소엔 daily 트리거가 조금씩 따라잡음)
 */
function resyncUntilDone() {
  const r = syncToSupabase();
  logEvent_('INFO', 'sync', `resyncUntilDone 1회 — l1=${r.l1}, l2=${r.l2}, done=${r.done}`);
  if (!r.done) {
    logEvent_('INFO', 'sync', '아직 남음 — resyncUntilDone 를 다시 실행하세요(또는 트리거가 처리).');
  }
  return r;
}

/** 포인터 초기화 후 전량 재동기화 (스키마/매핑 변경 시 1회) */
function resyncAll() {
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty(SYNC_PTR_PREFIX + SRC_TABS.l1);
  p.deleteProperty(SYNC_PTR_PREFIX + SRC_TABS.l2);
  return syncToSupabase();
}

// 한 번 실행에서 쓸 시간예산(GAS 6분 한도 안에서 안전 여유) — 두 탭 합산 기준
const SYNC_BUDGET_MS = 4.5 * 60 * 1000;
const SYNC_BATCH = 500;
let SYNC_START_MS = 0;   // syncToSupabase 진입 시 설정

/**
 * 한 탭을 증분으로 읽어 buildFn 변환 후 배치 upsert.
 * 배치마다 포인터를 즉시 커밋 → 끊겨도 다음 syncToSupabase 가 "이어받기".
 * 시간예산 초과 시 안전하게 중단(나머지는 다음 실행/트리거가 처리).
 * @return {number} 전송 행수
 */
function syncTab_(tabName, colsMap, buildFn, table) {
  const ss = SpreadsheetApp.openById(CFG.sourceSpreadsheetId());
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('원본 탭 없음: ' + tabName);
  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2) return 0;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const idx = {};
  Object.keys(colsMap).forEach(k => { idx[k] = headers.indexOf(colsMap[k]); });

  const props = PropertiesService.getScriptProperties();
  const ptrKey = SYNC_PTR_PREFIX + tabName;
  let cursor = parseInt(props.getProperty(ptrKey) || '1', 10);   // 마지막으로 커밋한 시트행
  if (cursor < 1) cursor = 1;

  let sent = 0;
  while (cursor < lastRow) {
    if (Date.now() - (SYNC_START_MS || Date.now()) > SYNC_BUDGET_MS) {
      logEvent_('INFO', 'sync', `${table} 시간예산 도달 — ${cursor}행까지 저장, 다음 실행에서 이어받음`);
      break;
    }
    const n = Math.min(SYNC_BATCH, lastRow - cursor);
    const data = sheet.getRange(cursor + 1, 1, n, lastCol).getValues();
    const rows = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rec = {};
      Object.keys(idx).forEach(k => { rec[k] = idx[k] >= 0 ? row[idx[k]] : ''; });
      if (!rec.receivedAt) continue;               // 유효행만(날짜 필수)
      rows.push(buildFn(rec, cursor + 1 + i));      // 절대 시트행 번호 전달
    }
    const uniq = dedupeByKey_(rows);                // 배치 내 중복 row_key 제거(21000 방지)
    if (uniq.length && !supabaseUpsert_(table, uniq, 'row_key')) {
      logEvent_('WARN', 'sync', `${table} 배치 실패(${cursor}행) — 포인터 직전까지 유지, 다음 실행 재시도`);
      break;                                        // 실패한 배치는 커밋 안 함
    }
    cursor += n;
    props.setProperty(ptrKey, String(cursor));      // 배치 성공 즉시 커밋(이어받기 핵심)
    sent += uniq.length;
  }
  return sent;
}

/** 1차필터(전화상담) → cs_l1 행. 고유ID 없음 → 시트 행번호로 유니크 키(append 가정, 멱등) */
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
    region: str_(rec.region),
  };
}

/** 2차필터(AS/현장) → cs_l2 행. 접수번호 있으면 그걸 키로(멱등), 없으면 행번호 */
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
    start_at: toIso_(rec.startAt),
    done_at: toIso_(rec.doneAt),
    done: str_(rec.done),
  };
}

/** 배치 내 동일 row_key 제거(마지막 값 유지) — Postgres ON CONFLICT 21000 방지 */
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
