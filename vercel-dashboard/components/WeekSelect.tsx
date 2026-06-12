'use client';

import { useRouter, useSearchParams } from 'next/navigation';

type WeekOpt = { week_label: string; total: number };

// 주차 선택 → ?week= 갱신(다른 쿼리파라미터 period/page 유지)
export default function WeekSelect({ weeks, selected }: { weeks: WeekOpt[]; selected: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  function onChange(v: string) {
    const p = new URLSearchParams(sp.toString());
    p.set('week', v);
    router.push('/?' + p.toString());
  }
  return (
    <select className="week-select" value={selected} onChange={(e) => onChange(e.target.value)} aria-label="주차 선택">
      {weeks.map((w) => (
        <option key={w.week_label} value={w.week_label}>{w.week_label} ({w.total}건)</option>
      ))}
    </select>
  );
}
