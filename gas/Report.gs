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
