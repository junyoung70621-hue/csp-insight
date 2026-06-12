'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// 고정 시트 1개를 받는 업로드 카드. (1차필터/2차필터 각각 하나씩 배치)
export default function CsvUpload({ sheet }: { sheet: '1차필터' | '2차필터' }) {
  const router = useRouter();
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
        setMsg({ ok: true, text: `완료: ${d.added}행 추가됨 · 집계는 잠시 후 반영` });
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
    <div className="upload-box">
      <div className="upload-title">{sheet} CSV</div>
      <div className="upload-row">
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
        <button className="upload-btn" onClick={submit} disabled={busy}>{busy ? '처리 중…' : '업로드'}</button>
      </div>
      {msg && <div className={`upload-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </div>
  );
}
