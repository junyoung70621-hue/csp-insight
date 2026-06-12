// 순수 SVG 꺾은선 차트(서버 컴포넌트). points: 오름차순.
// 모든 점에 값 라벨 + X축 날짜 라벨 표시.
export default function LineChart({ points }: { points: { label: string; value: number }[] }) {
  if (!points.length) return <div style={{ color: 'var(--muted)' }}>데이터 없음</div>;
  const n = points.length;
  const W = Math.max(680, n * 26), H = 250, PL = 40, PR = 18, PT = 24, PB = 52;
  const rawMax = Math.max(...points.map((p) => p.value), 1);
  const step = Math.max(1, Math.ceil(rawMax / 4));
  const max = step * 4;
  const x = (i: number) => PL + (n === 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (n - 1));
  const y = (v: number) => H - PB - (v / max) * (H - PT - PB);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${(H - PB).toFixed(1)} `
    + points.map((p, i) => `L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    + ` L${x(n - 1).toFixed(1)},${(H - PB).toFixed(1)} Z`;
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="line-chart">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={PL} y1={y(tv)} x2={W - PR} y2={y(tv)} stroke="#eef2f7" strokeWidth="1" />
            <text x={PL - 6} y={y(tv) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{tv.toLocaleString()}</text>
          </g>
        ))}
        <path d={area} fill="rgba(230,0,126,0.10)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r="2.6" fill="var(--brand)" />
            <text x={x(i)} y={y(p.value) - 7} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#1f2937">{p.value}</text>
            <text x={x(i)} y={H - PB + 14} textAnchor="end" fontSize="9" fill="#6b7280"
              transform={`rotate(-45 ${x(i)} ${H - PB + 14})`}>{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
