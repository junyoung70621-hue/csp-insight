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
