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
