import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { getSprintUrgency } from '@/lib/sprint';
import type { SprintStatus } from '@/types/standup';
import { cn } from '@/lib/utils';

interface SprintGoalBannerProps {
  status: SprintStatus | null;
  className?: string;
}

/**
 * The always-on, main-page signal of sprint-goal health. Calm and quiet early in
 * the sprint, it escalates color → pulse → shake with louder copy as the deadline
 * nears with the goal unmet, and flips to a green "complete" state once done.
 * Renders nothing until a goal is configured.
 */
export function SprintGoalBanner({ status, className }: SprintGoalBannerProps) {
  if (!status) return null;
  const u = getSprintUrgency(status);
  if (!u.show) return null;

  const Icon = u.icon;
  const pct = u.level === 'done' ? 100 : Math.round(status.elapsedFraction * 100);

  return (
    <div
      className={cn(
        'rounded-xl border p-3 md:p-4 transition-all',
        u.banner,
        u.animate,
        className
      )}
      role={u.level === 'critical' ? 'alert' : 'status'}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            u.iconWrap
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="font-semibold leading-tight">{u.headline}</span>
            <span
              className={cn(
                'ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                u.badge
              )}
            >
              {u.daysLabel}
            </span>
          </div>
          {u.subline && (
            <p className="mt-0.5 break-words text-sm opacity-90">{u.subline}</p>
          )}
        </div>
      </div>

      <div className={cn('mt-2.5 h-1.5 w-full overflow-hidden rounded-full', u.track)}>
        <div
          className={cn('h-full rounded-full transition-all duration-500', u.bar)}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

interface SprintGoalDialogProps {
  open: boolean;
  status: SprintStatus | null;
  onDone: () => void;
  onNotDone: () => void;
}

/**
 * Shown when a standup ends (before the sync/parking-lot review) if a sprint goal
 * is set and not yet done. The framing gets more insistent the closer the sprint
 * is to ending, matching the banner's urgency level.
 */
export function SprintGoalDialog({ open, status, onDone, onNotDone }: SprintGoalDialogProps) {
  if (!status) return null;
  const u = getSprintUrgency(status);
  const Icon = u.icon;
  const goal = status.goal.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onNotDone(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            Sprint goal check
          </DialogTitle>
          <DialogDescription>
            {u.daysLabel} in this sprint.
          </DialogDescription>
        </DialogHeader>

        <div className={cn('rounded-lg border p-3', u.banner, u.animate)}>
          <p className="font-semibold leading-snug">{u.headline}</p>
          {goal && (
            <p className="mt-1 break-words text-sm opacity-90">“{goal}”</p>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Did the team complete the sprint goal?
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onNotDone}>Not yet</Button>
          <Button className={u.confirmBtn} onClick={onDone}>
            Yes — it&apos;s done!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
