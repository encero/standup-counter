import { cn } from '@/lib/utils';

interface RadialIndicatorProps {
  elapsed: number;
  expected: number;
  className?: string;
  children?: React.ReactNode;
}

function getProgress(elapsed: number, expected: number) {
  const progress = Math.min((elapsed / expected) * 100, 150);
  const zone = progress <= 70 ? 'safe' : progress <= 100 ? 'warning' : 'over';
  return { progress, zone };
}

export function RadialIndicator({ elapsed, expected, children, className }: RadialIndicatorProps) {
  const { progress, zone } = getProgress(elapsed, expected);
  const viewBoxSize = 280;
  const strokeWidth = 10;
  const radius = (viewBoxSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(progress, 100) / 100) * circumference;

  return (
    <div className={cn('relative mx-auto w-[200px] h-[200px] sm:w-[240px] sm:h-[240px] md:w-[280px] md:h-[280px]', className)}>
      <svg
        className="absolute inset-0 w-full h-full -rotate-90"
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background circle */}
        <circle
          cx={viewBoxSize/2} cy={viewBoxSize/2} r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        {/* Progress circle */}
        <circle
          cx={viewBoxSize/2} cy={viewBoxSize/2} r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={cn(
            'transition-all duration-300 ease-out',
            zone === 'safe' && 'stroke-green-500',
            zone === 'warning' && 'stroke-amber-500',
            zone === 'over' && 'stroke-red-500'
          )}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

interface LinearIndicatorProps {
  elapsed: number;
  expected: number;
  className?: string;
}

export function LinearIndicator({ elapsed, expected, className }: LinearIndicatorProps) {
  const { progress, zone } = getProgress(elapsed, expected);

  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn(
          'h-full rounded-full transition-all duration-300 ease-out',
          zone === 'safe' && 'bg-green-500',
          zone === 'warning' && 'bg-amber-500',
          zone === 'over' && 'bg-red-500'
        )}
        style={{ width: `${Math.min(progress, 100)}%` }}
      />
    </div>
  );
}
