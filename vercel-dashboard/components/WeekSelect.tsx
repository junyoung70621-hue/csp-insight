'use client';

import { useRouter } from 'next/navigation';

type WeekOpt = { week_label: string; total: number };

export default function WeekSelect({ weeks, selected }: { weeks: WeekOpt[]; selected: string }) {
  const router = useRouter();
  return (
    <select
      className="week-select"
      value={selected}
      onChange={(e) => router.push(`/?week=${encodeURIComponent(e.target.value)}`)}
      aria-label="주차 선택"
    >
      {weeks.map((w) => (
        <option key={w.week_label} value={w.week_label}>
          {w.week_label} ({w.total}건)
        </option>
      ))}
    </select>
  );
}
