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
