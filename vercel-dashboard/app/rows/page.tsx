import { getL1Rows, getL2Rows, supabaseConfigured, type Row } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE = 50;

type Tab = { key: string; label: string; src: 'l1' | 'l2'; cat?: string };
const TABS: Tab[] = [
  { key: 'l1', label: '1차필터(전화상담)', src: 'l1' },
  { key: '2차미출동', label: '2차 미출동', src: 'l2', cat: '2차미출동' },
  { key: '현장인계', label: '현장인계', src: 'l2', cat: '현장인계' },
];

function fmt(v: any) {
  const s = String(v ?? '');
  // ISO timestamptz → 'YYYY-MM-DD HH:mm'
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : s;
}

export default async function RowsPage({ searchParams }: { searchParams: { tab?: string; page?: string } }) {
  if (!supabaseConfigured) {
    return <main className="container"><div className="card empty">Supabase 미설정</div></main>;
  }
  const tab = TABS.find((t) => t.key === searchParams.tab) || TABS[0];
  const page = Math.max(0, parseInt(searchParams.page || '0', 10) || 0);
  const offset = page * PAGE_SIZE;

  const rows: Row[] = tab.src === 'l1'
    ? await getL1Rows(PAGE_SIZE, offset)
    : await getL2Rows(tab.cat || null, PAGE_SIZE, offset);

  const cols: { k: string; h: string }[] = tab.src === 'l1'
    ? [
        { k: 'received_at', h: '접수일시' }, { k: 'dept', h: '배정부서' }, { k: 'channel', h: '접수채널' },
        { k: 'consult_type', h: '상담유형' }, { k: 'status', h: '처리상태' }, { k: 'car_no', h: '차량번호' }, { k: 'region', h: '지역' },
      ]
    : [
        { k: 'reception_id', h: '접수번호' }, { k: 'received_at', h: '장애접수일시' }, { k: 'office', h: '영업소명' },
        { k: 'route', h: '노선명' }, { k: 'dept', h: '배정부서' }, { k: 'device', h: '단말기구분' },
        { k: 'err_type', h: '접수오류유형' }, { k: 'field_type', h: '현장처리유형' }, { k: 'car_no', h: '차량번호' }, { k: 'done', h: '완료' },
      ];

  const mk = (p: number) => `/rows?tab=${encodeURIComponent(tab.key)}&page=${p}`;

  return (
    <main className="container">
      <div className="header header-row">
        <div><h1>📄 로우데이터</h1><p>마스킹된 원본 행 · 최신순</p></div>
        <a href="/" className="period-tab">← 대시보드</a>
      </div>

      <div className="period-tabs">
        {TABS.map((t) => (
          <a key={t.key} href={`/rows?tab=${encodeURIComponent(t.key)}`} className={`period-tab ${t.key === tab.key ? 'active' : ''}`}>{t.label}</a>
        ))}
      </div>

      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>{cols.map((c) => <th key={c.k}>{c.h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={cols.length} style={{ color: 'var(--muted)' }}>데이터 없음</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.row_key || i}>{cols.map((c) => <td key={c.k}>{fmt(r[c.k])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          {page > 0 ? <a className="period-tab" href={mk(page - 1)}>← 이전</a> : <span className="period-tab disabled">← 이전</span>}
          <span className="pager-info">페이지 {page + 1}</span>
          {rows.length === PAGE_SIZE ? <a className="period-tab" href={mk(page + 1)}>다음 →</a> : <span className="period-tab disabled">다음 →</span>}
        </div>
      </div>
    </main>
  );
}
