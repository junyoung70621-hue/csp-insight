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
