'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<'1차필터' | '2차필터'>('1차필터');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function close() { if (!busy) { setOpen(false); setMsg(null); setFile(null); } }

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
        const dup = d.skipped ? ` · 중복 ${d.skipped}건 제외` : '';
        setMsg({ ok: true, text: `완료: ${sheet}에 ${d.added}행 추가${dup} · 집계는 잠시 후 반영` });
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
    <>
      <button className="top-btn" onClick={() => setOpen(true)}>⬆️ 파일 업로드</button>
      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>CSV 업로드</h2>
              <button className="modal-x" onClick={close} aria-label="닫기">✕</button>
            </div>
            <div className="modal-body">
              <div className="seg">
                <button className={sheet === '1차필터' ? 'seg-on' : ''} onClick={() => setSheet('1차필터')} disabled={busy}>1차필터</button>
                <button className={sheet === '2차필터' ? 'seg-on' : ''} onClick={() => setSheet('2차필터')} disabled={busy}>2차필터</button>
              </div>
              <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} disabled={busy} />
              <button className="upload-btn" onClick={submit} disabled={busy}>{busy ? '업로드 중…' : `${sheet} 업로드`}</button>
              {msg && <div className={`upload-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
              <div className="upload-hint">CSV·XLSX 모두 업로드 가능(xlsx는 자동 변환). 선택한 시트 맨 아래에 추가되고, 집계는 자동 동기화 주기에 반영돼요.</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
