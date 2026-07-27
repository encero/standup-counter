import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  // Set/edit/clear this window's goal inline. Passing '' clears it. Omit to make
  // the banner read-only.
  onSetGoal?: (goal: string) => void;
  className?: string;
}

/**
 * The always-on, main-page signal of sprint-goal health, and the place the goal is
 * set. When a sprint window has no goal it shows a "set a goal" prompt; once set it
 * stays calm early and escalates color → pulse → shake with louder copy as the end
 * nears with the goal unmet, then flips to a green "complete" state once done. On a
 * rollover the new window starts empty again — the old goal never leaks in. Renders
 * nothing until a sprint cadence is configured in Settings.
 */
export function SprintGoalBanner({ status, onSetGoal, className }: SprintGoalBannerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!status) return null;
  const u = getSprintUrgency(status);
  if (!u.show) return null;

  const Icon = u.icon;
  const canEdit = Boolean(onSetGoal);
  const pct = u.level === 'done' ? 100 : Math.round(status.elapsedFraction * 100);

  const beginEdit = () => { setDraft(status.goal); setEditing(true); };
  const save = () => { onSetGoal?.(draft.trim()); setEditing(false); };
  const cancel = () => { setEditing(false); };

  return (
    <div
      className={cn('rounded-xl border p-3 md:p-4 transition-all', u.banner, u.animate, className)}
      role={u.level === 'critical' ? 'alert' : 'status'}
    >
      <div className="flex items-start gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', u.iconWrap)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="font-semibold leading-tight">{u.headline}</span>
            {!u.isEmpty && !editing && (
              <span
                className={cn(
                  'ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                  u.badge
                )}
              >
                {u.daysLabel}
              </span>
            )}
          </div>

          {editing ? (
            <div className="mt-2 flex items-center gap-2">
              <Input
                autoFocus
                value={draft}
                maxLength={200}
                placeholder="e.g. Ship checkout v2"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') cancel();
                }}
                className="h-8 flex-1 bg-white/80 dark:bg-black/20"
              />
              <Button size="sm" className="h-8" onClick={save}>Save</Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={cancel}>Cancel</Button>
            </div>
          ) : (
            <>
              {u.subline && <p className="mt-0.5 break-words text-sm opacity-90">{u.subline}</p>}
              <div className="mt-1 flex items-center gap-2">
                {!u.isEmpty && u.metaLabel && (
                  <span className="text-xs opacity-70 tabular-nums">{u.metaLabel}</span>
                )}
                {canEdit && (
                  <button
                    onClick={beginEdit}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium opacity-70 transition-opacity hover:opacity-100"
                  >
                    {u.isEmpty
                      ? (<><Plus className="h-3.5 w-3.5" /> Set goal</>)
                      : (<><Pencil className="h-3 w-3" /> Edit</>)}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {!u.isEmpty && !editing && (
        <div className={cn('mt-2.5 h-1.5 w-full overflow-hidden rounded-full', u.track)}>
          <div
            className={cn('h-full rounded-full transition-all duration-500', u.bar)}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      )}
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
            {u.daysLabel} · {u.metaLabel}
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
