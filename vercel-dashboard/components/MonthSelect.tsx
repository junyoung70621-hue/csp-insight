'use client';

import { useRouter, useSearchParams } from 'next/navigation';

// 월 선택 → ?month= 갱신(다른 쿼리파라미터 유지)
export default function MonthSelect({ months, selected }: { months: string[]; selected: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  function onChange(v: string) {
    const p = new URLSearchParams(sp.toString());
    p.set('month', v);
    router.push('/?' + p.toString());
  }
  return (
    <select className="week-select" value={selected} onChange={(e) => onChange(e.target.value)} aria-label="월 선택">
      {months.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}
