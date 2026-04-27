import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { TeamMember } from '@/types/standup';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export function ControlPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();

  const {
    currentSpeaker,
    standupId,
    status,
    elapsedTime,
    interruptions,
    isConnected,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    formatTime,
  } = useWebSocket(teamId || '');

  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    if (!teamId) return;
    fetch(`${API_BASE}/api/${teamId}/members`)
      .then(r => {
        if (r.status === 404) {
          navigate('/team-not-found');
          return [];
        }
        return r.json();
      })
      .then(setMembers)
      .catch(console.error);
  }, [teamId, navigate]);

  const handleTogglePause = () => {
    if (status === 'running') {
      pauseTimer();
    } else if (status === 'paused') {
      resumeTimer();
    }
  };

  const handleSelectSpeaker = (member: TeamMember) => {
    if (currentSpeaker?.id === member.id) return;
    startTimer(member);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* Connection Status */}
        <div className="flex items-center justify-center gap-2 text-sm">
          <div className={cn(
            "w-2 h-2 rounded-full",
            isConnected ? "bg-green-500" : "bg-red-500"
          )} />
          <span className="text-muted-foreground">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* Timer Display */}
        <Card 
          className={cn(
            "text-center cursor-pointer transition-colors",
            status === 'running' && "bg-green-50 dark:bg-green-950/30",
            status === 'paused' && "bg-amber-50 dark:bg-amber-950/30"
          )}
          onClick={handleTogglePause}
        >
          <CardContent className="py-8">
            <div className="text-muted-foreground text-sm mb-2">
              {currentSpeaker ? currentSpeaker.name : 'No speaker'}
            </div>
            <div className={cn(
              "text-6xl font-mono font-bold tabular-nums",
              status === 'running' && "text-green-600 dark:text-green-400",
              status === 'paused' && "text-amber-600 dark:text-amber-400 animate-pulse",
              status === 'idle' && "text-muted-foreground"
            )}>
              {formatTime(elapsedTime)}
            </div>
            {interruptions > 0 && (
              <div className="text-xs text-muted-foreground mt-2">
                Paused {interruptions}×
              </div>
            )}
            {status !== 'idle' && (
              <div className="text-xs text-muted-foreground mt-2">
                Tap to {status === 'running' ? 'pause' : 'resume'}
              </div>
            )}
          </CardContent>
        </Card>

        {/* End Standup */}
        <Button
          variant="outline"
          onClick={stopTimer}
          disabled={!standupId}
          className="w-full"
        >
          End Standup
        </Button>

        {/* Speaker Selection */}
        <div className="grid grid-cols-2 gap-2">
          {members.map((member) => (
            <Button
              key={member.id}
              variant={currentSpeaker?.id === member.id ? 'default' : 'outline'}
              className="h-16 text-lg"
              onClick={() => handleSelectSpeaker(member)}
            >
              {member.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
