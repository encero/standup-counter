import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Trash2, KeyRound, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import { ConnectionManager } from '@/lib/ConnectionManager';
import type { TeamMember, SprintStatus, SprintGoalHistoryEntry } from '@/types/standup';

interface SprintPatch {
  goal?: string;
  startDate?: string;
  lengthDays?: number;
  done?: boolean;
}

interface SettingsProps {
  teamId: string;
  expectedSeconds: number;
  onExpectedSecondsChange: (seconds: number) => void;
  teamMembers: TeamMember[];
  onAddMember: (name: string, isGuest?: boolean) => TeamMember;
  onRemoveMember: (id: string) => void;
  onClearSessions: () => void;
  sprintStatus: SprintStatus | null;
  onUpdateSprint: (patch: SprintPatch) => Promise<SprintStatus>;
  disabled?: boolean;
}

export function Settings({
  teamId,
  expectedSeconds,
  onExpectedSecondsChange,
  teamMembers,
  onAddMember,
  onRemoveMember,
  onClearSessions,
  sprintStatus,
  onUpdateSprint,
  disabled,
}: SettingsProps) {
  const [newMemberName, setNewMemberName] = useState('');
  const [stockSymbols, setStockSymbols] = useState('');
  const [stockSymbolsSaved, setStockSymbolsSaved] = useState(false);

  // PR publisher ingest token. We only learn whether one EXISTS on load (the
  // raw value is never returned by the server); a freshly generated token is
  // held in `prToken` so it can be shown once, right after a reset.
  const [prTokenConfigured, setPrTokenConfigured] = useState(false);
  const [prToken, setPrToken] = useState<string | null>(null);
  const [prTokenCopied, setPrTokenCopied] = useState(false);
  const [prTokenBusy, setPrTokenBusy] = useState(false);

  // Sprint cadence draft — seeded from the live status. The goal itself is set on
  // the banner (per-window), not here; Settings only owns the recurring cadence.
  const [sprintStart, setSprintStart] = useState('');
  const [sprintLength, setSprintLength] = useState(14);
  const [sprintSaved, setSprintSaved] = useState(false);
  const [pastGoals, setPastGoals] = useState<SprintGoalHistoryEntry[]>([]);

  // Re-seed the draft whenever a new status snapshot arrives (initial load or a
  // live broadcast). Adjusting state during render is React's recommended way to
  // sync derived state to a changing prop — no effect/cascading render needed.
  const [seededFrom, setSeededFrom] = useState<SprintStatus | null>(null);
  if (sprintStatus && sprintStatus !== seededFrom) {
    setSeededFrom(sprintStatus);
    setSprintStart(sprintStatus.startDate);
    setSprintLength(sprintStatus.lengthDays);
  }

  const handleSaveSprint = () => {
    onUpdateSprint({ startDate: sprintStart, lengthDays: sprintLength })
      .then(() => {
        setSprintSaved(true);
        setTimeout(() => setSprintSaved(false), 2000);
      })
      .catch(console.error);
  };

  // Load settings from server via ConnectionManager
  useEffect(() => {
    if (!teamId) return;
    ConnectionManager.get<{ stockSymbols?: string; expectedSeconds?: number; prTokenConfigured?: boolean }>(`/api/${teamId}/settings`)
      .then(data => {
        setStockSymbols(data.stockSymbols || '');
        if (data.expectedSeconds !== undefined) {
          onExpectedSecondsChange(data.expectedSeconds);
        }
        setPrTokenConfigured(Boolean(data.prTokenConfigured));
      })
      .catch(console.error);
  }, [teamId, onExpectedSecondsChange]);

  // Load the sprint-goal archive. Refetch whenever the live status changes (a goal
  // was set, completed, or the window rolled) so the "past goals" list stays fresh.
  useEffect(() => {
    if (!teamId) return;
    ConnectionManager.get<SprintGoalHistoryEntry[]>(`/api/${teamId}/sprint/history`)
      .then(setPastGoals)
      .catch(console.error);
  }, [teamId, sprintStatus]);

  // Generate/rotate the publisher ingest token. The server returns the raw
  // token once; any previously issued token stops working immediately.
  const handleResetToken = () => {
    if (prTokenConfigured && !window.confirm('Reset the publisher token? The current token will stop working and the publisher must be reconfigured.')) {
      return;
    }
    setPrTokenBusy(true);
    ConnectionManager.post<{ token: string }>(`/api/${teamId}/pr-status/token`)
      .then(({ token }) => {
        setPrToken(token);
        setPrTokenConfigured(true);
        setPrTokenCopied(false);
      })
      .catch(console.error)
      .finally(() => setPrTokenBusy(false));
  };

  const handleCopyToken = () => {
    if (!prToken) return;
    navigator.clipboard?.writeText(prToken)
      .then(() => {
        setPrTokenCopied(true);
        setTimeout(() => setPrTokenCopied(false), 2000);
      })
      .catch(console.error);
  };

  // Save expected seconds when changed
  const handleExpectedSecondsChange = (seconds: number) => {
    onExpectedSecondsChange(seconds);
    ConnectionManager.put(`/api/${teamId}/settings`, { expectedSeconds: seconds })
      .catch(console.error);
  };

  const handleSaveStockSymbols = () => {
    ConnectionManager.put(`/api/${teamId}/settings`, { stockSymbols })
      .then(() => {
        setStockSymbolsSaved(true);
        setTimeout(() => setStockSymbolsSaved(false), 2000);
      });
  };

  const handleAddMember = () => {
    if (newMemberName.trim()) {
      onAddMember(newMemberName.trim(), false);
      setNewMemberName('');
    }
  };

  const permanentMembers = teamMembers.filter(m => !m.isGuest);

  return (
    <Dialog>
      <DialogTrigger
        aria-label="Open settings"
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        disabled={disabled}
      >
        <SettingsIcon className="h-5 w-5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your standup timer</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Expected Time */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Expected time per speaker</label>
            <div className="flex flex-wrap gap-2">
              {[30, 60, 90, 120, 180].map((secs) => (
                <Button
                  key={secs}
                  variant={expectedSeconds === secs ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleExpectedSecondsChange(secs)}
                >
                  {secs < 60 ? `${secs}s` : `${secs / 60}m`}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <input
                type="range"
                min={15}
                max={300}
                step={15}
                value={expectedSeconds}
                onChange={(e) => handleExpectedSecondsChange(Number(e.target.value))}
                className="flex-1"
              />
              <Input
                type="number"
                min={10}
                max={600}
                value={expectedSeconds}
                onChange={(e) => handleExpectedSecondsChange(Math.max(10, Number(e.target.value)))}
                className="w-16 text-center text-sm"
              />
            </div>
          </div>

          {/* Sprint cadence — set once. The goal itself is set on the banner. */}
          <div className="space-y-3 border-t pt-4">
            <div>
              <label className="text-sm font-medium">Sprint cadence</label>
              <p className="text-xs text-muted-foreground">
                When your sprints start and how long they run. Set the goal itself on the main-page banner — it rolls over automatically each sprint.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Sprint start</label>
                <Input
                  type="date"
                  value={sprintStart}
                  onChange={(e) => setSprintStart(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Length</label>
                <div className="flex items-center gap-1.5">
                  {[
                    [7, '1w'],
                    [14, '2w'],
                    [21, '3w'],
                    [28, '4w'],
                  ].map(([d, label]) => (
                    <Button
                      key={d}
                      variant={sprintLength === d ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSprintLength(d as number)}
                    >
                      {label}
                    </Button>
                  ))}
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={sprintLength}
                    onChange={(e) => setSprintLength(Math.min(60, Math.max(1, Number(e.target.value))))}
                    className="w-16 text-center text-sm"
                  />
                </div>
              </div>
            </div>

            <Button
              onClick={handleSaveSprint}
              size="sm"
              variant={sprintSaved ? 'outline' : 'default'}
            >
              {sprintSaved ? '✓ Saved' : 'Save cadence'}
            </Button>

            {/* Past goals archive */}
            {(() => {
              const past = pastGoals.filter(g => g.startDate !== sprintStatus?.windowStart);
              if (past.length === 0) return null;
              return (
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-medium text-muted-foreground">Past goals</label>
                  <div className="max-h-40 space-y-1 overflow-auto">
                    {past.map((g) => (
                      <div
                        key={g.startDate}
                        className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1.5 text-sm"
                      >
                        <span className="shrink-0" title={g.done ? 'Completed' : 'Not completed'}>
                          {g.done ? '✅' : '⬜'}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{g.goal}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {g.startDate}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Team Members */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Team Members</label>
            <div className="space-y-2 max-h-48 overflow-auto">
              {permanentMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/50">
                  <span className="text-sm">{member.name}</span>
                  <button
                    onClick={() => onRemoveMember(member.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="Add team member..."
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
                className="flex-1"
              />
              <Button onClick={handleAddMember} disabled={!newMemberName.trim()} size="sm">
                Add
              </Button>
            </div>
          </div>

          {/* Stock Ticker */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Stock Ticker</label>
            <p className="text-xs text-muted-foreground">
              Stock symbol to show in standup summary (e.g., AAPL)
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="AAPL"
                value={stockSymbols}
                onChange={(e) => setStockSymbols(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleSaveStockSymbols} size="sm" variant={stockSymbolsSaved ? "outline" : "default"}>
                {stockSymbolsSaved ? '✓ Saved' : 'Save'}
              </Button>
            </div>
          </div>

          {/* PR Publisher Token */}
          <div className="space-y-2 border-t pt-4">
            <label className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              PR review publisher
            </label>
            <p className="text-xs text-muted-foreground">
              Token the <code className="text-[11px]">publish-prs</code> CLI uses to push PRs needing review.
              {prTokenConfigured ? ' A token is configured.' : ' No token yet.'}
            </p>

            {prToken ? (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={prToken}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 font-mono text-xs"
                  />
                  <Button onClick={handleCopyToken} size="sm" variant="outline" className="gap-1.5 shrink-0">
                    {prTokenCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {prTokenCopied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Shown once — copy it now. Set it as <code className="text-[11px]">STANDUP_INGEST_TOKEN</code> for the publisher.
                </p>
              </div>
            ) : null}

            <Button
              onClick={handleResetToken}
              size="sm"
              variant="outline"
              disabled={prTokenBusy}
              className="gap-1.5"
            >
              <KeyRound className="h-4 w-4" />
              {prTokenBusy ? 'Generating…' : prTokenConfigured ? 'Reset token' : 'Generate token'}
            </Button>
          </div>

          {/* Data Management */}
          <div className="pt-4 border-t space-y-3">
            <Button
              variant="destructive"
              className="w-full gap-2"
              onClick={onClearSessions}
            >
              <Trash2 className="h-4 w-4" />
              Clear All Sessions
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
