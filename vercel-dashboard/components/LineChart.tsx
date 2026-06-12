// 순수 SVG 꺾은선 차트(서버 컴포넌트). points: 오름차순.
export default function LineChart({ points }: { points: { label: string; value: number }[] }) {
  if (!points.length) return <div style={{ color: 'var(--muted)' }}>데이터 없음</div>;
  const W = 640, H = 200, P = 28;
  const max = Math.max(...points.map((p) => p.value), 1);
  const n = points.length;
  const x = (i: number) => P + (n === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (n - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${(H - P).toFixed(1)} `
    + points.map((p, i) => `L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    + ` L${x(n - 1).toFixed(1)},${(H - P).toFixed(1)} Z`;
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="line-chart" preserveAspectRatio="xMidYMid meet">
        <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#e5e7eb" strokeWidth="1" />
        <path d={area} fill="rgba(37,99,235,0.08)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" />
        {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="2.2" fill="var(--brand)" />)}
        <text x={x(points.indexOf(peak))} y={y(peak.value) - 6} textAnchor="middle" fontSize="11" fill="#2563eb">{peak.value}</text>
      </svg>
      <div className="chart-axis"><span>{points[0].label}</span><span>{points[n - 1].label}</span></div>
    </div>
  );
}
