'use client';

import { useState } from 'react';

export default function MailButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true); setMsg({ ok: true, text: '발송 중…' });
    try {
      const r = await fetch('/api/send-report', { method: 'POST' });
      const d = await r.json();
      setMsg(d.ok
        ? { ok: true, text: `발송 완료 → ${d.to || ''}` }
        : { ok: false, text: `실패: ${d.error || '알 수 없는 오류'}` });
    } catch (e: any) {
      setMsg({ ok: false, text: `오류: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="mail-wrap">
      <button className="mail-btn" onClick={send} disabled={busy}>{busy ? '발송 중…' : '✉️ 보고 메일 발송'}</button>
      {msg && <span className={`mail-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
    </span>
  );
}
