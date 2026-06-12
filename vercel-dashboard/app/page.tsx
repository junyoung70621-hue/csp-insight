import {
  getTotalSummary, getWeeklySummaries, getMonthlySummaries, getDailySummaries, getDailyByMonth,
  getRecontact, getTopErr, getDeviceModels, supabaseConfigured,
  type TotalSummary, type KeyCount, type WeeklySummary,
} from '@/lib/supabase';
import UploadModal from '@/components/UploadModal';
import MailButton from '@/components/MailButton';
import LineChart from '@/components/LineChart';
import WeekSelect from '@/components/WeekSelect';
import MonthSelect from '@/components/MonthSelect';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Kpi({ num, lbl }: { num: string; lbl: string }) {
  return <div className="kpi"><div className="num">{num}</div><div className="lbl">{lbl}</div></div>;
}

function TotalCards({ t }: { t: TotalSummary }) {
  const cells: { label: string; val: string; href?: string; accent?: boolean }[] = [
    { label: '1차 필터', val: t.first_filter.toLocaleString(), href: '/rows?tab=l1' },
    { label: '2차 필터', val: t.second_filter.toLocaleString(), href: '/rows?tab=2차미출동' },
    { label: '현장인계', val: t.handover.toLocaleString(), href: '/rows?tab=현장인계' },
    { label: '총 합계', val: t.total.toLocaleString(), href: '/rows?tab=l1' },
    { label: '필터율', val: `${t.filter_rate}%`, accent: true },
  ];
  return (
    <div className="kpi-grid kpi-grid-5">
      {cells.map((c) => {
        const inner = <><div className="num">{c.val}</div><div className="lbl">{c.label}{c.href ? ' ↗' : ''}</div></>;
        return c.href
          ? <a key={c.label} className={`kpi kpi-link${c.accent ? ' accent' : ''}`} href={c.href}>{inner}</a>
          : <div key={c.label} className={`kpi${c.accent ? ' accent' : ''}`}>{inner}</div>;
      })}
    </div>
  );
}

function BarList({ title, rows, color = 'var(--brand)' }: { title: string; rows: KeyCount[]; color?: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? <div style={{ color: 'var(--muted)' }}>데이터 없음</div> : (
        <div className="barlist">
          {rows.map((r) => (
            <div key={r.key} className="barlist-row">
              <div className="barlist-key" title={r.key}>{r.key}</div>
              <div className="barlist-track"><div className="barlist-fill" style={{ width: `${(r.count / max) * 100}%`, background: color }} /></div>
              <div className="barlist-val">{r.count.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InsightPanel({ s, weeks }: { s?: WeeklySummary; weeks: WeeklySummary[] }) {
  const badge = s?.ai_source === 'gemini' ? 'Gemini' : s?.ai_source === 'fallback' ? '규칙기반' : '대기';
  return (
    <div className="card ai-box">
      <div className="ai-head">
        <h2 style={{ margin: 0 }}>🧠 AI 요약 <span className="badge">{badge}</span></h2>
        <WeekSelect weeks={weeks.map((w) => ({ week_label: w.week_label, total: w.total }))} selected={s?.week_label || ''} />
      </div>
      {s?.ai_summary ? (
        <>
          <p style={{ lineHeight: 1.7, margin: '10px 0 0', fontSize: 14 }}>{s.ai_summary}</p>
          {(s.ai_highlights?.length ?? 0) > 0 && (
            <><h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>특이사항</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{s.ai_highlights!.map((h, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>{h}</li>)}</ul></>
          )}
          {(s.ai_suggestions?.length ?? 0) > 0 && (
            <><h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>개선 제안</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{s.ai_suggestions!.map((h, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>{h}</li>)}</ul></>
          )}
        </>
      ) : <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>이 주차의 요약이 아직 없습니다. (GAS backfillInsights 실행 시 생성)</p>}
    </div>
  );
}

type Period = 'daily' | 'weekly' | 'monthly';
const PERIOD_LABEL: Record<Period, string> = { daily: '일별', weekly: '주별', monthly: '월별' };
const TREND_SIZE = 12;

async function fetchPeriod(period: Period, limit: number, offset: number) {
  if (period === 'daily') return (await getDailySummaries(limit, offset)).map((d) => ({ label: d.day, ...d }));
  if (period === 'monthly') return (await getMonthlySummaries(limit, offset)).map((m) => ({ label: m.month, ...m }));
  return (await getWeeklySummaries(limit, offset)).map((w) => ({ label: w.week_label, ...w }));
}

export default async function Page({ searchParams }: { searchParams: { period?: string; page?: string; week?: string; month?: string } }) {
  if (!supabaseConfigured) {
    return <main className="container"><div className="header"><h1>📞 고객센터 전화접수 현황</h1></div><div className="card empty">Supabase 환경변수가 설정되지 않았습니다.</div></main>;
  }
  const period: Period = searchParams.period === 'daily' || searchParams.period === 'monthly' ? searchParams.period : 'weekly';
  const page = Math.max(0, parseInt(searchParams.page || '0', 10) || 0);
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const currentMonth = kstNow.toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || '') ? (searchParams.month as string) : currentMonth;

  const [total, recon, topErr, devices, weeks, months, dailyMonth, trend] = await Promise.all([
    getTotalSummary(), getRecontact(), getTopErr(5), getDeviceModels(),
    getWeeklySummaries(52, 0), getMonthlySummaries(24, 0), getDailyByMonth(month),
    fetchPeriod(period, TREND_SIZE, page * TREND_SIZE),
  ]);

  const monthOpts = Array.from(new Set([currentMonth, ...months.map((m) => m.month)])).sort().reverse();
  const selWeek = weeks.find((w) => w.week_label === searchParams.week) || weeks.find((w) => w.ai_summary) || weeks[0];
  const latest = trend[0];
  const chartPoints = dailyMonth.map((d) => ({ label: d.day.slice(5), value: d.total }));
  const wk = selWeek ? `&week=${encodeURIComponent(selWeek.week_label)}` : '';
  const mo = `&month=${encodeURIComponent(month)}`;
  const periodHref = (p: Period) => `/?period=${p}${wk}${mo}`;
  const pageHref = (n: number) => `/?period=${period}&page=${n}${wk}${mo}`;

  return (
    <main className="container">
      <div className="header header-row">
        <div><h1>📞 고객센터 전화접수 현황</h1><p>집계는 Supabase View · 화면 직접 조회 · PII 마스킹</p></div>
        <div className="header-actions"><UploadModal /><MailButton /></div>
      </div>

      {/* 1) 총 누적현황 KPI (클릭 → 로우데이터) */}
      {total && <TotalCards t={total} />}

      {/* 2) 접수오류유형 TOP5 + 기종별 누적 */}
      <div className="grid-2col">
        <BarList title="🏷️ 접수오류유형 TOP5" rows={topErr} />
        <BarList title="📟 기종별 누적" rows={devices.map((d) => ({ key: d.model, count: d.count }))} color="#7c3aed" />
      </div>

      {/* 3) 일자별 접수현황 (월 선택) */}
      <div className="card">
        <div className="ai-head">
          <h2 style={{ margin: 0 }}>📈 일자별 접수현황</h2>
          <MonthSelect months={monthOpts} selected={month} />
        </div>
        <div style={{ marginTop: 10 }}>
          <LineChart points={chartPoints} />
        </div>
      </div>

      {/* 4) AI 요약 (차트 아래) */}
      <InsightPanel s={selWeek} weeks={weeks} />

      {/* 5) 재접수율 */}
      {recon && (
        <div className="card">
          <h2>🔁 재접수율 <span className="badge">동일차량·3일내 (1차: 차량+날짜 / 2차: 차량+유형)</span></h2>
          <div className="recon-grid">
            <div className="recon-cell"><div className="recon-rate">{recon.l1_rate}%</div><div className="recon-lbl">1차필터 재접수</div><div className="recon-sub">{recon.l1_recontact.toLocaleString()} / {recon.l1_total.toLocaleString()}건</div></div>
            <div className="recon-cell"><div className="recon-rate">{recon.l2_rate}%</div><div className="recon-lbl">2차필터 재접수</div><div className="recon-sub">{recon.l2_recontact.toLocaleString()} / {recon.l2_total.toLocaleString()}건</div></div>
          </div>
        </div>
      )}

      {/* 6) 기간 탭 + 추이 */}
      <div className="period-tabs">
        {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
          <a key={p} href={periodHref(p)} className={`period-tab ${p === period ? 'active' : ''}`}>{PERIOD_LABEL[p]}</a>
        ))}
      </div>

      {latest && (
        <div className="kpi-grid">
          <Kpi num={`${latest.total.toLocaleString()}건`} lbl={`최근 ${PERIOD_LABEL[period]} (${latest.label})`} />
          <Kpi num={`${latest.filter_rate}%`} lbl={`필터율 (1차 ${latest.first_filter}·2차 ${latest.second_filter})`} />
          <Kpi num={`${latest.handover.toLocaleString()}건`} lbl="현장인계" />
          <Kpi num={`${latest.avg_days}일`} lbl="평균 처리소요일" />
        </div>
      )}

      <div className="card">
        <h2>{PERIOD_LABEL[period]} 추이</h2>
        <table>
          <thead><tr><th>{period === 'monthly' ? '월' : period === 'daily' ? '일자' : '주차'}</th><th className="num">전체</th><th className="num">1차</th><th className="num">2차</th><th className="num">현장인계</th><th className="num">필터율</th></tr></thead>
          <tbody>
            {trend.length === 0 ? <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>데이터 없음</td></tr>
              : trend.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td><td className="num">{r.total.toLocaleString()}</td><td className="num">{r.first_filter.toLocaleString()}</td>
                  <td className="num">{r.second_filter.toLocaleString()}</td><td className="num">{r.handover.toLocaleString()}</td><td className="num">{r.filter_rate}%</td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="pager">
          {page > 0 ? <a className="period-tab" href={pageHref(page - 1)}>← 최근</a> : <span className="period-tab disabled">← 최근</span>}
          <span className="pager-info">페이지 {page + 1}</span>
          {trend.length === TREND_SIZE ? <a className="period-tab" href={pageHref(page + 1)}>이전 기간 →</a> : <span className="period-tab disabled">이전 기간 →</span>}
        </div>
      </div>

    </main>
  );
}
