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
import type { TeamMember } from '@/types/standup';

interface SettingsProps {
  teamId: string;
  expectedSeconds: number;
  onExpectedSecondsChange: (seconds: number) => void;
  teamMembers: TeamMember[];
  onAddMember: (name: string, isGuest?: boolean) => TeamMember;
  onRemoveMember: (id: string) => void;
  onClearSessions: () => void;
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
  disabled,
}: SettingsProps) {
  const [newMemberName, setNewMemberName] = useState('');
  const [stockSymbols, setStockSymbols] = useState('');
  const [stockSymbolsSaved, setStockSymbolsSaved] = useState(false);

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
      <DialogContent className="sm:max-w-md">
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
