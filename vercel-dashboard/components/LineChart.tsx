// 순수 SVG 꺾은선 차트(서버 컴포넌트). points: 오름차순. Y축 눈금 수치 표시.
export default function LineChart({ points }: { points: { label: string; value: number }[] }) {
  if (!points.length) return <div style={{ color: 'var(--muted)' }}>데이터 없음</div>;
  const W = 660, H = 220, PL = 40, PR = 14, PT = 16, PB = 26;
  const rawMax = Math.max(...points.map((p) => p.value), 1);
  // 눈금 보기 좋게 올림
  const step = Math.max(1, Math.ceil(rawMax / 4));
  const max = step * 4;
  const n = points.length;
  const x = (i: number) => PL + (n === 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (n - 1));
  const y = (v: number) => H - PB - (v / max) * (H - PT - PB);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${(H - PB).toFixed(1)} `
    + points.map((p, i) => `L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    + ` L${x(n - 1).toFixed(1)},${(H - PB).toFixed(1)} Z`;
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);
  const peakIdx = points.reduce((a, _, i) => (points[i].value > points[a].value ? i : a), 0);
  const peak = points[peakIdx];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="line-chart" preserveAspectRatio="xMidYMid meet">
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={PL} y1={y(tv)} x2={W - PR} y2={y(tv)} stroke="#eef2f7" strokeWidth="1" />
            <text x={PL - 6} y={y(tv) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{tv.toLocaleString()}</text>
          </g>
        ))}
        <path d={area} fill="rgba(37,99,235,0.08)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" />
        {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="2.2" fill="var(--brand)" />)}
        <text x={x(peakIdx)} y={y(peak.value) - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#2563eb">{peak.value}</text>
      </svg>
      <div className="chart-axis" style={{ paddingLeft: PL, paddingRight: PR }}><span>{points[0].label}</span><span>{points[n - 1].label}</span></div>
    </div>
  );
}
