import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart2, History } from 'lucide-react';
import { useStandup } from '@/context/StandupContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimerDisplay } from '@/components/shared/TimerDisplay';
import { MemberSelector } from '@/components/shared/MemberSelector';
import { RadialIndicator } from '@/components/shared/TimeIndicator';
import { Settings } from '@/components/Settings';
import { StandupSummary } from '@/components/StandupSummary';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export function StandupTimer() {
  const {
    teamId, teamMembers, sessions, currentSpeaker, currentStandupId, status, elapsedTime, interruptions,
    endedStandupId, startTimer, pauseTimer, resumeTimer, stopTimer, addMember, removeMember,
    clearSessions, clearEndedStandupId, formatTime,
  } = useStandup();

  const [expectedSeconds, setExpectedSeconds] = useState(90);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryStandupId, setSummaryStandupId] = useState<string | null>(null);
  const expectedMs = expectedSeconds * 1000;

  // Show summary when standup is ended (e.g., from control page)
  useEffect(() => {
    if (endedStandupId) {
      setSummaryStandupId(endedStandupId);
      setShowSummary(true);
      clearEndedStandupId();
    }
  }, [endedStandupId, clearEndedStandupId]);

  const handleEndStandup = () => {
    // No-op if no one has spoken yet
    if (!currentStandupId) {
      return;
    }
    // Save the standup ID before stopping (stopTimer resets it to null)
    setSummaryStandupId(currentStandupId);
    if (status !== 'idle') {
      stopTimer();
    }
    setShowSummary(true);
  };

  const handleShowLastSummary = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/${teamId}/trends/standups?days=7`);
      const standups = await response.json();
      if (standups.length > 0) {
        setSummaryStandupId(standups[0].id);
        setShowSummary(true);
      }
    } catch (err) {
      console.error('Failed to fetch last standup:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 relative">
      {/* Top bar icons - Absolute positioned */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleShowLastSummary}
          title="Last standup summary"
        >
          <History className="h-5 w-5" />
        </Button>
        <Link to={`/${teamId}/trends`}>
          <Button variant="ghost" size="icon" className="h-9 w-9">
            <BarChart2 className="h-5 w-5" />
          </Button>
        </Link>
        <Settings
          teamId={teamId}
          expectedSeconds={expectedSeconds}
          onExpectedSecondsChange={setExpectedSeconds}
          teamMembers={teamMembers}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onClearSessions={clearSessions}
          disabled={status !== 'idle'}
        />
      </div>

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Timer Card */}
        <Card
          className={`border-2 relative ${status !== 'idle' ? 'cursor-pointer' : ''}`}
          onClick={status === 'idle' ? undefined : (status === 'paused' ? resumeTimer : pauseTimer)}
        >
          {interruptions > 0 && (
            <span className="absolute top-3 left-3 text-xs text-muted-foreground">
              Paused {interruptions}×
            </span>
          )}
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg text-muted-foreground">
              {currentSpeaker ? `${currentSpeaker.name} is speaking` : 'Select a speaker to begin'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center py-8">
            <RadialIndicator elapsed={elapsedTime} expected={expectedMs}>
              <TimerDisplay
                time={formatTime(elapsedTime)}
                status={status}
                size="xl"
              />
            </RadialIndicator>
          </CardContent>
        </Card>

        {/* End Standup Button */}
        <Button
          variant="outline"
          onClick={handleEndStandup}
          disabled={!currentStandupId}
          className="w-full text-muted-foreground"
        >
          End Standup
        </Button>

        {/* Team Members */}
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <MemberSelector
              members={teamMembers}
              currentSpeaker={currentSpeaker}
              currentElapsedTime={elapsedTime}
              currentStandupId={currentStandupId}
              teamId={teamId}
              sessions={sessions}
              onSelect={startTimer}
              onAddMember={addMember}
              onRemoveMember={removeMember}
              formatTime={formatTime}
            />
          </CardContent>
        </Card>
      </div>

      {/* Summary Dialog */}
      <StandupSummary
        open={showSummary}
        onClose={() => setShowSummary(false)}
        sessions={sessions}
        teamMembers={teamMembers}
        teamId={teamId}
        standupId={summaryStandupId}
        formatTime={formatTime}
      />
    </div>
  );
}
