import { cn } from '@/lib/utils';

interface TimerDisplayProps {
  time: string;
  status: 'idle' | 'running' | 'paused';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'text-2xl sm:text-3xl',
  md: 'text-3xl sm:text-4xl md:text-5xl',
  lg: 'text-4xl sm:text-5xl md:text-7xl',
  xl: 'text-4xl sm:text-5xl md:text-6xl',
};

export function TimerDisplay({ time, status, size = 'lg', className }: TimerDisplayProps) {
  return (
    <div
      className={cn(
        'font-mono font-bold tabular-nums tracking-tight transition-colors select-none text-center',
        sizeClasses[size],
        status === 'running' && 'text-green-600 dark:text-green-400',
        status === 'paused' && 'text-amber-600 dark:text-amber-400 animate-pulse',
        status === 'idle' && 'text-muted-foreground',
        className
      )}
    >
      {time}
    </div>
  );
}
