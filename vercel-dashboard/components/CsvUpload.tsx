'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CsvUpload() {
  const router = useRouter();
  const [sheet, setSheet] = useState('1차필터');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (!file) { setMsg({ ok: false, text: 'CSV 파일을 선택하세요.' }); return; }
    setBusy(true); setMsg({ ok: true, text: '업로드 중…' });
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('sheet', sheet);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.ok) {
        setMsg({ ok: true, text: `완료: ${d.sheet} 시트에 ${d.added}행 추가됨 · 대시보드는 잠시 후(자동 동기화) 반영됩니다` });
        setFile(null);
        router.refresh();
      } else {
        setMsg({ ok: false, text: `실패: ${d.error || '알 수 없는 오류'}` });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: `오류: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card upload-card">
      <h2>⬆️ CSV 업로드</h2>
      <div className="upload-row">
        <select className="week-select" value={sheet} onChange={(e) => setSheet(e.target.value)} disabled={busy}>
          <option value="1차필터">1차필터 시트</option>
          <option value="2차필터">2차필터 시트</option>
        </select>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
        <button className="upload-btn" onClick={submit} disabled={busy}>{busy ? '처리 중…' : '업로드'}</button>
      </div>
      {msg && <div className={`upload-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
      <div className="upload-hint">선택한 시트 맨 아래에 행이 추가됩니다. 집계(대시보드)는 자동 동기화 주기에 맞춰 반영돼요. (같은 파일을 두 번 올리면 중복될 수 있어요)</div>
    </div>
  );
}
