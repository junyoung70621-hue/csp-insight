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

/** 1차필터(전화상담) → cs_l1 행. 행번호 키(전체 새로고침이라 안정적), 차량번호만 마스킹 */
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
