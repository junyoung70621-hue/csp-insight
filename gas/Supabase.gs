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
