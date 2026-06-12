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
