import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TrendArrow } from '@/components/shared/Sparkline';
import type { TeamMember, SpeakerSession } from '@/types/standup';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

interface MemberTrends {
  sparklines: Record<string, number[]>;
  trends: Record<string, number>;
}

interface MemberSelectorProps {
  members: TeamMember[];
  currentSpeaker: TeamMember | null;
  currentElapsedTime: number;
  currentStandupId: string | null;
  teamId: string;
  sessions: SpeakerSession[];
  onSelect: (member: TeamMember) => void;
  onAddMember: (name: string, isGuest?: boolean) => TeamMember;
  onRemoveMember: (id: string) => void;
  formatTime: (ms: number) => string;
}

function getMemberStats(memberId: string, sessions: SpeakerSession[], currentStandupId: string | null) {
  const memberSessions = sessions.filter(s => s.memberId === memberId);

  // Current standup time (only show time from active standup)
  const standupSessions = currentStandupId
    ? memberSessions.filter(s => s.standupId === currentStandupId)
    : [];
  const standupTotal = standupSessions.reduce((sum, s) => sum + s.duration, 0);

  return { standupTotal };
}

export function MemberSelector({
  members,
  currentSpeaker,
  currentElapsedTime,
  currentStandupId,
  teamId,
  sessions,
  onSelect,
  onAddMember,
  onRemoveMember,
  formatTime,
}: MemberSelectorProps) {
  const [guestName, setGuestName] = useState('');
  const [trends, setTrends] = useState<MemberTrends>({ sparklines: {}, trends: {} });

  const API_URL = `${API_BASE}/api/${teamId}`;

  // Fetch trends data
  useEffect(() => {
    if (!teamId) return;
    fetch(`${API_URL}/trends/members?days=30`)
      .then(r => r.json())
      .then(data => setTrends({ sparklines: data.sparklines, trends: data.trends }))
      .catch(console.error);
  }, [sessions.length, teamId, API_URL]); // Refresh when sessions change

  const memberStats = useMemo(() => {
    const stats: Record<string, ReturnType<typeof getMemberStats>> = {};
    members.forEach(m => {
      stats[m.id] = getMemberStats(m.id, sessions, currentStandupId);
    });
    return stats;
  }, [members, sessions, currentStandupId]);

  const handleAddGuest = () => {
    if (guestName.trim()) {
      const guest = onAddMember(guestName.trim(), true);
      setGuestName('');
      onSelect(guest);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {members.map((member) => {
          const stats = memberStats[member.id];
          const sparkline = trends.sparklines[member.id] || [];
          const trend = trends.trends[member.id] || 0;
          const isCurrentSpeaker = currentSpeaker?.id === member.id;
          const standupTime = isCurrentSpeaker
            ? stats.standupTotal + currentElapsedTime
            : stats.standupTotal;
          const hasSparkline = sparkline.length >= 2;

          return (
            <div key={member.id} className="relative group">
              <Button
                variant={isCurrentSpeaker ? 'default' : 'outline'}
                className="w-full flex-col h-auto py-3 px-2 gap-0.5 cursor-pointer"
                onClick={() => onSelect(member)}
              >
                {/* Name with trend arrow */}
                <div className="flex items-center gap-1">
                  <span className="truncate text-[18px] font-medium">{member.name}</span>
                  {hasSparkline && <TrendArrow trend={trend} className="text-sm" />}
                </div>
                {member.isGuest && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Guest</Badge>}

                {/* Current standup time */}
                {standupTime > 0 && (
                  <div className={cn(
                    "text-[20px] font-semibold font-mono mt-1",
                    isCurrentSpeaker ? "text-primary-foreground" : "text-muted-foreground"
                  )}>
                    {formatTime(standupTime)}
                  </div>
                )}
              </Button>
              {member.isGuest && (
                <button
                  onClick={() => onRemoveMember(member.id)}
                  className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Add guest speaker..."
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddGuest()}
          className="flex-1"
        />
        <Button onClick={handleAddGuest} disabled={!guestName.trim()} variant="secondary">
          Add Guest
        </Button>
      </div>
    </div>
  );
}
