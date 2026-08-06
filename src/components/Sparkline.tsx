import { useId } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  min?: number;
  max?: number;
}

export default function Sparkline({
  data,
  width = 140,
  height = 40,
  color = '#0078D4',
  fill = true,
  min,
  max,
}: SparklineProps) {
  const gid = useId().replace(/[:]/g, '');
  const safe = data.length > 1 ? data : [0, 0.01];
  const maxV = max ?? Math.max(...safe, 0.01);
  const minV = min ?? Math.min(...safe, 0);
  const range = maxV - minV || 1;

  const pts = safe.map((v, i) => {
    const x = (i / (safe.length - 1)) * width;
    const y = height - ((v - minV) / range) * (height - 4) - 2;
    return [x, y] as const;
  });

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible shrink-0">
      {fill && (
        <>
          <defs>
            <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#spark-${gid})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r={2.6} fill={color} stroke="#fff" strokeWidth={1} />}
    </svg>
  );
}
