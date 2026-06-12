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
