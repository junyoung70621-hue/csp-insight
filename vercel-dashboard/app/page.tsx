import {
  getTotalSummary, getWeeklySummaries, getMonthlySummaries, getDailySummaries,
  getRecontact, getTopErr, getDeviceModels, supabaseConfigured,
  type TotalSummary, type KeyCount, type DailySummary, type Recontact,
} from '@/lib/supabase';
import CsvUpload from '@/components/CsvUpload';
import MailButton from '@/components/MailButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Kpi({ num, lbl }: { num: string; lbl: string }) {
  return <div className="kpi"><div className="num">{num}</div><div className="lbl">{lbl}</div></div>;
}

function TotalCard({ t }: { t: TotalSummary }) {
  const cells: [string, string][] = [
    ['1차 필터', t.first_filter.toLocaleString()],
    ['2차 필터', t.second_filter.toLocaleString()],
    ['현장인계', t.handover.toLocaleString()],
    ['총 합계', t.total.toLocaleString()],
    ['필터율', `${t.filter_rate}%`],
  ];
  return (
    <div className="card total-card">
      <h2>📊 총 누적현황</h2>
      <div className="total-grid">
        {cells.map(([label, val], i) => (
          <div key={label} className={`total-cell${i === cells.length - 1 ? ' accent' : ''}`}>
            <div className="total-val">{val}</div><div className="total-lbl">{label}</div>
          </div>
        ))}
      </div>
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

function RecontactCard({ r }: { r: Recontact }) {
  return (
    <div className="card">
      <h2>🔁 재접수율 <span className="badge">동일차량·동일유형 3일내</span></h2>
      <div className="recon-grid">
        <div className="recon-cell">
          <div className="recon-rate">{r.l1_rate}%</div>
          <div className="recon-lbl">1차필터 재접수</div>
          <div className="recon-sub">{r.l1_recontact.toLocaleString()} / {r.l1_total.toLocaleString()}건</div>
        </div>
        <div className="recon-cell">
          <div className="recon-rate">{r.l2_rate}%</div>
          <div className="recon-lbl">2차필터 재접수</div>
          <div className="recon-sub">{r.l2_recontact.toLocaleString()} / {r.l2_total.toLocaleString()}건</div>
        </div>
      </div>
    </div>
  );
}

function DailyChart({ rows }: { rows: DailySummary[] }) {
  const asc = [...rows].reverse().slice(-45);
  if (!asc.length) return null;
  const max = asc.reduce((m, d) => Math.max(m, d.total), 0) || 1;
  return (
    <div className="card">
      <h2>📈 일자별 접수현황 (전체)</h2>
      <div className="chart">
        {asc.map((d) => (
          <div key={d.day} className="chart-col" title={`${d.day} · ${d.total}건`}>
            <div className="chart-bar" style={{ height: `${(d.total / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="chart-axis"><span>{asc[0].day}</span><span>{asc[asc.length - 1].day}</span></div>
    </div>
  );
}

type Period = 'daily' | 'weekly' | 'monthly';
const PERIOD_LABEL: Record<Period, string> = { daily: '일별', weekly: '주별', monthly: '월별' };

export default async function Page({ searchParams }: { searchParams: { period?: string } }) {
  if (!supabaseConfigured) {
    return (
      <main className="container">
        <div className="header"><h1>📞 고객센터 전화접수 현황</h1></div>
        <div className="card empty">Supabase 환경변수가 설정되지 않았습니다.</div>
      </main>
    );
  }

  const period: Period = searchParams.period === 'daily' || searchParams.period === 'monthly' ? searchParams.period : 'weekly';

  const [total, weekly, monthly, daily, recon, topErr, devices] = await Promise.all([
    getTotalSummary(), getWeeklySummaries(12), getMonthlySummaries(12), getDailySummaries(60),
    getRecontact(), getTopErr(5), getDeviceModels(),
  ]);

  const periodRows = (
    period === 'daily' ? daily.map((d) => ({ label: d.day, total: d.total, first_filter: d.first_filter, second_filter: d.second_filter, handover: d.handover, filter_rate: d.filter_rate, avg_days: d.avg_days }))
    : period === 'monthly' ? monthly.map((m) => ({ label: m.month, total: m.total, first_filter: m.first_filter, second_filter: m.second_filter, handover: m.handover, filter_rate: m.filter_rate, avg_days: m.avg_days }))
    : weekly.map((w) => ({ label: w.week_label, total: w.total, first_filter: w.first_filter, second_filter: w.second_filter, handover: w.handover, filter_rate: w.filter_rate, avg_days: w.avg_days }))
  );
  const latest = periodRows[0];

  return (
    <main className="container">
      <div className="header header-row">
        <div>
          <h1>📞 고객센터 전화접수 현황</h1>
          <p>집계는 Supabase View · 화면 직접 조회 · PII 마스킹</p>
        </div>
        <MailButton />
      </div>

      {/* 업로드 */}
      <div className="card">
        <h2>⬆️ CSV 업로드</h2>
        <div className="upload-2col">
          <CsvUpload sheet="1차필터" />
          <CsvUpload sheet="2차필터" />
        </div>
        <div className="upload-hint">선택한 시트 맨 아래에 추가됩니다. 집계(대시보드)는 자동 동기화 주기에 맞춰 반영돼요.</div>
      </div>

      {total && <TotalCard t={total} />}

      {/* 기간 탭 */}
      <div className="period-tabs">
        {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
          <a key={p} href={`/?period=${p}`} className={`period-tab ${p === period ? 'active' : ''}`}>{PERIOD_LABEL[p]}</a>
        ))}
      </div>

      {latest ? (
        <>
          <div className="kpi-grid">
            <Kpi num={`${latest.total.toLocaleString()}건`} lbl={`${PERIOD_LABEL[period]} 접수 (${latest.label})`} />
            <Kpi num={`${latest.filter_rate}%`} lbl={`필터율 (1차 ${latest.first_filter}·2차 ${latest.second_filter})`} />
            <Kpi num={`${latest.handover.toLocaleString()}건`} lbl="현장인계" />
            <Kpi num={`${latest.avg_days}일`} lbl="평균 처리소요일" />
          </div>

          <div className="card">
            <h2>{PERIOD_LABEL[period]} 추이</h2>
            <table>
              <thead><tr><th>{period === 'monthly' ? '월' : period === 'daily' ? '일자' : '주차'}</th><th className="num">전체</th><th className="num">1차</th><th className="num">2차</th><th className="num">현장인계</th><th className="num">필터율</th></tr></thead>
              <tbody>
                {periodRows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="num">{r.total.toLocaleString()}</td>
                    <td className="num">{r.first_filter.toLocaleString()}</td>
                    <td className="num">{r.second_filter.toLocaleString()}</td>
                    <td className="num">{r.handover.toLocaleString()}</td>
                    <td className="num">{r.filter_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <div className="card empty">집계 데이터가 없습니다.</div>}

      {recon && <RecontactCard r={recon} />}

      <div className="grid-2col">
        <BarList title="🏷️ 접수오류유형 TOP5" rows={topErr} />
        <BarList title="📟 기종별 누적" rows={devices.map((d) => ({ key: d.model, count: d.count }))} color="#7c3aed" />
      </div>

      <DailyChart rows={daily} />
    </main>
  );
}
