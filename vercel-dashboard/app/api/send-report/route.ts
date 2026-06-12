import { NextResponse } from 'next/server';
import {
  getTotalSummary, getWeeklySummaries, getTopErr, getDeviceModels, getRecontact,
} from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function esc(v: unknown) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function POST() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_FROM;
  const to = (process.env.REPORT_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!apiKey || !from || !to.length) {
    return NextResponse.json(
      { ok: false, error: '환경변수(RESEND_API_KEY / REPORT_FROM / REPORT_TO) 미설정' }, { status: 500 });
  }
  try {
    const [total, weeks, topErr, devices, recon] = await Promise.all([
      getTotalSummary(), getWeeklySummaries(1), getTopErr(5), getDeviceModels(), getRecontact(),
    ]);
    const wk = weeks[0];
    const row = (a: string, b: string) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">${esc(a)}</td>` +
      `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${esc(b)}</td></tr>`;

    const topErrRows = topErr.map((t) => row(t.key, `${t.count}건`)).join('') || row('-', '0');
    const devRows = devices.map((d) => row(d.model, `${d.count}건`)).join('') || row('-', '0');

    const html = `
    <div style="font-family:Malgun Gothic,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1f2937">
      <h2 style="color:#111">📞 고객센터 전화접수 현황 보고</h2>
      ${total ? `
      <h3 style="margin:18px 0 6px">총 누적현황</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row('1차 필터', `${total.first_filter.toLocaleString()}건`)}
        ${row('2차 필터', `${total.second_filter.toLocaleString()}건`)}
        ${row('현장인계', `${total.handover.toLocaleString()}건`)}
        ${row('총 합계', `${total.total.toLocaleString()}건`)}
        ${row('필터율', `${total.filter_rate}%`)}
      </table>` : ''}
      ${wk ? `
      <h3 style="margin:18px 0 6px">최근 주차 (${esc(wk.week_label)})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row('전체 접수', `${wk.total}건`)}
        ${row('필터율', `${wk.filter_rate}%`)}
        ${row('현장인계', `${wk.handover}건`)}
      </table>` : ''}
      ${recon ? `
      <h3 style="margin:18px 0 6px">재접수율 (동일차량·동일유형 3일내)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row('1차 재접수율', `${recon.l1_rate}% (${recon.l1_recontact}/${recon.l1_total})`)}
        ${row('2차 재접수율', `${recon.l2_rate}% (${recon.l2_recontact}/${recon.l2_total})`)}
      </table>` : ''}
      <h3 style="margin:18px 0 6px">접수오류유형 TOP5</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${topErrRows}</table>
      <h3 style="margin:18px 0 6px">기종별 누적</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${devRows}</table>
      <p style="color:#9ca3af;font-size:12px;margin-top:20px">본 메일은 대시보드에서 수동 발송되었습니다. PII는 마스킹 처리됨.</p>
    </div>`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: '[고객센터] 전화접수 현황 보고', html }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ ok: false, error: 'Resend: ' + JSON.stringify(data).slice(0, 300) }, { status: 502 });
    }
    return NextResponse.json({ ok: true, to: to.join(', ') });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
