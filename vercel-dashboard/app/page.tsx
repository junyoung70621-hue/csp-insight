import {
  getWeeklySummaries, getMonthlySummaries, getTotalSummary, supabaseConfigured,
  type Breakdown, type WeeklySummary, type MonthlySummary, type TotalSummary,
} from '@/lib/supabase';
import WeekSelect from '@/components/WeekSelect';
import CsvUpload from '@/components/CsvUpload';

export const dynamic = 'force-dynamic';   // 항상 최신(View 직접 조회)
export const revalidate = 0;

function Kpi({ num, lbl }: { num: string; lbl: string }) {
  return (
    <div className="kpi">
      <div className="num">{num}</div>
      <div className="lbl">{lbl}</div>
    </div>
  );
}

function BreakdownTable({ title, data }: { title: string; data: Breakdown }) {
  const rows = Object.entries(data || {})
    .map(([key, count]) => ({ key, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <div className="card">
      <h2>{title}</h2>
      <table>
        <thead><tr><th>항목</th><th className="num">건수</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={2} style={{ color: 'var(--muted)' }}>데이터 없음</td></tr>
          ) : rows.map((r) => (
            <tr key={r.key}>
              <td>
                {r.key}
                <div className="bar-wrap"><div className="bar" style={{ width: `${(r.count / max) * 100}%` }} /></div>
              </td>
              <td className="num">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AiBox({ s }: { s: WeeklySummary }) {
  const badge = s.ai_source === 'gemini' ? 'AI 분석(Gemini)' : s.ai_source === 'fallback' ? '규칙 기반 요약' : '요약 대기';
  const highlights = s.ai_highlights ?? [];
  const suggestions = s.ai_suggestions ?? [];
  return (
    <div className="card ai-box">
      <h2>🧠 주간 요약 <span className="badge">{badge}</span></h2>
      <p style={{ lineHeight: 1.7, margin: 0 }}>{s.ai_summary || '아직 생성된 요약이 없습니다.'}</p>
      {highlights.length > 0 && (
        <>
          <h2 style={{ marginTop: 16 }}>특이사항</h2>
          <ul>{highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </>
      )}
      {suggestions.length > 0 && (
        <>
          <h2 style={{ marginTop: 16 }}>개선 제안</h2>
          <ul>{suggestions.map((h, i) => <li key={i}>{h}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function TotalCard({ t }: { t: TotalSummary }) {
  const cells: [string, string][] = [
    ['1차 필터', `${t.first_filter.toLocaleString()}`],
    ['2차 필터', `${t.second_filter.toLocaleString()}`],
    ['현장인계', `${t.handover.toLocaleString()}`],
    ['총 합계', `${t.total.toLocaleString()}`],
    ['필터율', `${t.filter_rate}%`],
  ];
  return (
    <div className="card total-card">
      <h2>📊 총 누적현황</h2>
      <div className="total-grid">
        {cells.map(([label, val], i) => (
          <div key={label} className={`total-cell${i === cells.length - 1 ? ' accent' : ''}`}>
            <div className="total-val">{val}</div>
            <div className="total-lbl">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthlyTrend({ rows }: { rows: MonthlySummary[] }) {
  if (!rows.length) return null;
  const asc = [...rows].reverse();
  return (
    <div className="card">
      <h2>📈 월간 추이</h2>
      <table>
        <thead>
          <tr>
            <th>월</th><th className="num">전체</th><th className="num">1차</th>
            <th className="num">2차</th><th className="num">현장인계</th>
            <th className="num">필터링율</th><th className="num">평균처리일</th>
          </tr>
        </thead>
        <tbody>
          {asc.map((m) => (
            <tr key={m.month}>
              <td>{m.month}</td>
              <td className="num">{m.total}</td>
              <td className="num">{m.first_filter}</td>
              <td className="num">{m.second_filter}</td>
              <td className="num">{m.handover}</td>
              <td className="num">{m.filter_rate}%</td>
              <td className="num">{m.avg_days}일</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: { week?: string } }) {
  if (!supabaseConfigured) {
    return (
      <main className="container">
        <div className="header"><h1>📞 고객센터 전화접수 현황</h1></div>
        <div className="card empty">
          Supabase 환경변수가 설정되지 않았습니다.<br />
          <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> 를 설정하세요.
        </div>
      </main>
    );
  }

  const [summaries, monthly, total] = await Promise.all([
    getWeeklySummaries(12),
    getMonthlySummaries(6),
    getTotalSummary(),
  ]);

  if (summaries.length === 0) {
    return (
      <main className="container">
        <div className="header"><h1>📞 고객센터 전화접수 현황</h1></div>
        <CsvUpload />
        <div className="card empty">아직 집계된 주차 데이터가 없습니다. 위에서 CSV를 업로드하세요.</div>
      </main>
    );
  }

  // 기본 선택: URL 지정 주차 → 없으면 2차(AS) 데이터가 있는 최신 주차 → 그것도 없으면 최신
  const selected =
    summaries.find((s) => s.week_label === searchParams.week) ||
    summaries.find((s) => s.second_filter > 0) ||
    summaries[0];

  return (
    <main className="container">
      <div className="header">
        <h1>📞 고객센터 전화접수 현황</h1>
        <p>집계 주차(목~수) · 집계는 Supabase View, 화면은 직접 조회 · PII 마스킹</p>
      </div>

      {total && <TotalCard t={total} />}

      <CsvUpload />

      <div className="week-bar">
        <span className="week-bar-label">주차 선택</span>
        <WeekSelect
          weeks={summaries.map((s) => ({ week_label: s.week_label, total: s.total }))}
          selected={selected.week_label}
        />
      </div>

      {selected.second_filter === 0 && (
        <div className="note">
          ※ 이 주차는 아직 2차(AS) 처리 데이터가 없어 필터링율이 100%·현장인계 0으로 표시됩니다(진행 중인 주차).
        </div>
      )}

      <div className="kpi-grid">
        <Kpi num={`${selected.total}건`} lbl="전체 접수" />
        <Kpi num={`${selected.filter_rate}%`} lbl={`필터링율 (1차 ${selected.first_filter}·2차 ${selected.second_filter})`} />
        <Kpi num={`${selected.handover}건`} lbl={`현장인계 (${selected.handover_rate}%)`} />
        <Kpi num={`${selected.avg_days}일`} lbl="평균 처리소요일" />
      </div>

      <AiBox s={selected} />

      <div className="grid-2">
        <BreakdownTable title="부서별" data={selected.by_dept} />
        <BreakdownTable title="상담유형별" data={selected.by_type} />
        <BreakdownTable title="처리상태별" data={selected.by_status} />
      </div>

      <MonthlyTrend rows={monthly} />

      <p className="foot">
        {selected.updated_at ? `요약 업데이트: ${new Date(selected.updated_at).toLocaleString('ko-KR')}` : '요약 생성 대기 중'}
      </p>
    </main>
  );
}
