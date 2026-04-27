import { cn } from '@/lib/utils';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  color?: string;
}

export function Sparkline({ 
  data, 
  width = 60, 
  height = 20, 
  className,
  color = 'currentColor'
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Generate SVG path
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(' L ')}`;

  return (
    <svg 
      width={width} 
      height={height} 
      className={cn('inline-block', className)}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dot on the last point */}
      <circle
        cx={width}
        cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2}
        r={2}
        fill={color}
      />
    </svg>
  );
}

interface TrendArrowProps {
  trend: number; // percentage change
  className?: string;
}

export function TrendArrow({ trend, className }: TrendArrowProps) {
  if (Math.abs(trend) < 5) {
    return <span className={cn('text-muted-foreground', className)}>→</span>;
  }
  
  if (trend > 0) {
    return <span className={cn('text-red-500', className)}>↑</span>;
  }
  
  return <span className={cn('text-green-500', className)}>↓</span>;
}
