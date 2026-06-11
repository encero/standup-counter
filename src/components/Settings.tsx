import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Trash2 } from 'lucide-react';
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
import type { TeamMember, SprintStatus } from '@/types/standup';

interface SprintPatch {
  goal?: string;
  startDate?: string;
  lengthDays?: number;
  done?: boolean;
  thresholds?: { notice: number; warning: number; critical: number };
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

  // Sprint goal draft — seeded from the live status and saved as one block.
  const [sprintGoal, setSprintGoal] = useState('');
  const [sprintStart, setSprintStart] = useState('');
  const [sprintLength, setSprintLength] = useState(14);
  // Urgency cutoffs in days-remaining (notice > warning > critical >= 1).
  const [thresholds, setThresholds] = useState({ notice: 7, warning: 3, critical: 1 });
  const [sprintSaved, setSprintSaved] = useState(false);

  // Re-seed the draft whenever a new status snapshot arrives (initial load or a
  // live broadcast). Adjusting state during render is React's recommended way to
  // sync derived state to a changing prop — no effect/cascading render needed.
  const [seededFrom, setSeededFrom] = useState<SprintStatus | null>(null);
  if (sprintStatus && sprintStatus !== seededFrom) {
    setSeededFrom(sprintStatus);
    setSprintGoal(sprintStatus.goal);
    setSprintStart(sprintStatus.startDate);
    setSprintLength(sprintStatus.lengthDays);
    setThresholds({ ...sprintStatus.thresholds });
  }

  const thresholdsValid =
    thresholds.critical >= 1 &&
    thresholds.critical < thresholds.warning &&
    thresholds.warning < thresholds.notice;

  const handleSaveSprint = () => {
    if (!thresholdsValid) return;
    onUpdateSprint({
      goal: sprintGoal,
      startDate: sprintStart,
      lengthDays: sprintLength,
      thresholds: { ...thresholds },
    })
      .then(() => {
        setSprintSaved(true);
        setTimeout(() => setSprintSaved(false), 2000);
      })
      .catch(console.error);
  };

  // Clear just the goal (and its done flag) — the banner disappears while the
  // team's sprint cadence/thresholds stay configured for the next goal.
  const handleClearSprint = () => {
    setSprintGoal('');
    onUpdateSprint({ goal: '', done: false }).catch(console.error);
  };

  // Load settings from server via ConnectionManager
  useEffect(() => {
    if (!teamId) return;
    ConnectionManager.get<{ stockSymbols?: string; expectedSeconds?: number }>(`/api/${teamId}/settings`)
      .then(data => {
        setStockSymbols(data.stockSymbols || '');
        if (data.expectedSeconds !== undefined) {
          onExpectedSecondsChange(data.expectedSeconds);
        }
      })
      .catch(console.error);
  }, [teamId, onExpectedSecondsChange]);

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

          {/* Sprint Goal */}
          <div className="space-y-3 border-t pt-4">
            <div>
              <label className="text-sm font-medium">Sprint goal</label>
              <p className="text-xs text-muted-foreground">
                Shown on the main page; the alert gets louder as the sprint end nears with the goal unmet.
              </p>
            </div>

            <Input
              placeholder="e.g. Ship checkout v2"
              value={sprintGoal}
              maxLength={200}
              onChange={(e) => setSprintGoal(e.target.value)}
            />

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
                <label className="text-xs text-muted-foreground">Length (days)</label>
                <div className="flex items-center gap-1.5">
                  {[7, 14, 21, 28].map((d) => (
                    <Button
                      key={d}
                      variant={sprintLength === d ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSprintLength(d)}
                    >
                      {d}
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

            {/* Urgency thresholds — escalate when this many days (or fewer) remain */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Escalate when days left ≤
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['notice', 'Notice'],
                  ['warning', 'Warning'],
                  ['critical', 'Critical'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <span className="block text-[11px] text-muted-foreground">{label}</span>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={1}
                        max={365}
                        value={thresholds[key]}
                        onChange={(e) =>
                          setThresholds((t) => ({ ...t, [key]: Math.min(365, Math.max(1, Math.round(Number(e.target.value)))) }))
                        }
                        className="text-center text-sm"
                      />
                      <span className="text-xs text-muted-foreground">d</span>
                    </div>
                  </div>
                ))}
              </div>
              {!thresholdsValid && (
                <p className="text-xs text-destructive">
                  Days must decrease: notice &gt; warning &gt; critical ≥ 1.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={handleSaveSprint}
                size="sm"
                variant={sprintSaved ? 'outline' : 'default'}
                disabled={!thresholdsValid}
              >
                {sprintSaved ? '✓ Saved' : 'Save sprint settings'}
              </Button>
              {sprintGoal.trim() && (
                <Button
                  onClick={handleClearSprint}
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                >
                  Clear goal
                </Button>
              )}
            </div>
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
