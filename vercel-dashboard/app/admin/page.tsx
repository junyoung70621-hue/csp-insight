'use client';

import { useState } from 'react';

type Tab = { key: string; label: string; sheet: '1차필터' | '2차필터' };
const TABS: Tab[] = [
  { key: 'l1', label: '1차필터', sheet: '1차필터' },
  { key: '2차미출동', label: '2차 미출동', sheet: '2차필터' },
  { key: '현장인계', label: '현장인계', sheet: '2차필터' },
];
const COLS: Record<string, { k: string; h: string }[]> = {
  l1: [
    { k: 'received_at', h: '접수일시' }, { k: 'dept', h: '배정부서' }, { k: 'channel', h: '접수채널' },
    { k: 'consult_type', h: '상담유형' }, { k: 'status', h: '처리상태' }, { k: 'car_no', h: '차량번호' }, { k: 'region', h: '지역' },
  ],
  l2: [
    { k: 'reception_id', h: '접수번호' }, { k: 'received_at', h: '장애접수일시' }, { k: 'office', h: '영업소명' },
    { k: 'route', h: '노선명' }, { k: 'dept', h: '배정부서' }, { k: 'device', h: '단말기구분' },
    { k: 'err_type', h: '접수오류유형' }, { k: 'field_type', h: '현장처리유형' }, { k: 'car_no', h: '차량번호' }, { k: 'done', h: '완료' },
  ],
};
function fmt(v: any) {
  const s = String(v ?? '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : s;
}

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load(t: Tab, p: number, pw = password) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw, tab: t.key, page: p }) });
      const d = await r.json();
      if (d.ok) { setAuthed(true); setRows(d.rows || []); setSel(new Set()); setTab(t); setPage(p); }
      else { setMsg({ ok: false, text: d.error || '실패' }); if (r.status === 401) setAuthed(false); }
    } catch (e: any) { setMsg({ ok: false, text: e?.message || String(e) }); }
    finally { setBusy(false); }
  }

  function toggle(k: string) { const n = new Set(sel); n.has(k) ? n.delete(k) : n.add(k); setSel(n); }
  function toggleAll() { setSel(sel.size === rows.length ? new Set() : new Set(rows.map((r) => r.row_key))); }

  async function del() {
    if (sel.size === 0) return;
    if (!confirm(`${sel.size}건을 시트와 DB에서 삭제할까요? (복구 불가)`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, sheet: tab.sheet, keys: [...sel] }) });
      const d = await r.json();
      if (d.ok) { setMsg({ ok: true, text: `삭제 완료: 시트 ${d.sheetDeleted}행 / DB ${d.dbDeleted}건` }); await load(tab, page); }
      else setMsg({ ok: false, text: d.error || '삭제 실패' });
    } catch (e: any) { setMsg({ ok: false, text: e?.message || String(e) }); }
    finally { setBusy(false); }
  }

  if (!authed) {
    return (
      <main className="container">
        <div className="header"><h1>🔒 관리자</h1></div>
        <div className="card" style={{ maxWidth: 360 }}>
          <h2>비밀번호</h2>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(TABS[0], 0)} className="week-select" style={{ width: '100%' }} placeholder="관리자 비밀번호" />
          <button className="upload-btn" style={{ marginTop: 10 }} onClick={() => load(TABS[0], 0)} disabled={busy || !password}>{busy ? '확인 중…' : '입장'}</button>
          {msg && <div className={`upload-msg ${msg.ok ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{msg.text}</div>}
        </div>
      </main>
    );
  }

  const cols = COLS[tab.key === 'l1' ? 'l1' : 'l2'];
  return (
    <main className="container">
      <div className="header header-row">
        <div><h1>🔒 관리자 — 데이터 삭제</h1><p>체크 후 삭제 시 시트·DB에서 함께 제거됩니다(복구 불가).</p></div>
        <a href="/" className="period-tab">← 대시보드</a>
      </div>

      <div className="period-tabs">
        {TABS.map((t) => <button key={t.key} className={`period-tab ${t.key === tab.key ? 'active' : ''}`} onClick={() => load(t, 0)} disabled={busy}>{t.label}</button>)}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>선택 {sel.size}건</span>
          <button className="mail-btn" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={del} disabled={busy || sel.size === 0}>🗑️ 선택 삭제</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr>
              <th><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} /></th>
              {cols.map((c) => <th key={c.k}>{c.h}</th>)}
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={cols.length + 1} style={{ color: 'var(--muted)' }}>데이터 없음</td></tr>
                : rows.map((r) => (
                  <tr key={r.row_key} style={sel.has(r.row_key) ? { background: '#fef2f2' } : undefined}>
                    <td><input type="checkbox" checked={sel.has(r.row_key)} onChange={() => toggle(r.row_key)} /></td>
                    {cols.map((c) => <td key={c.k}>{fmt(r[c.k])}</td>)}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <button className={`period-tab ${page === 0 ? 'disabled' : ''}`} onClick={() => page > 0 && load(tab, page - 1)} disabled={busy || page === 0}>← 이전</button>
          <span className="pager-info">페이지 {page + 1}</span>
          <button className={`period-tab ${rows.length < 50 ? 'disabled' : ''}`} onClick={() => rows.length === 50 && load(tab, page + 1)} disabled={busy || rows.length < 50}>다음 →</button>
        </div>
        {msg && <div className={`upload-msg ${msg.ok ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{msg.text}</div>}
      </div>
    </main>
  );
}
