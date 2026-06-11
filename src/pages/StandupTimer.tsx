import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { BarChart2, History, WifiOff, RefreshCw } from 'lucide-react';
import { useStandup } from '@/context/StandupContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimerDisplay } from '@/components/shared/TimerDisplay';
import { MemberSelector } from '@/components/shared/MemberSelector';
import { RadialIndicator } from '@/components/shared/TimeIndicator';
import { Settings } from '@/components/Settings';
import { StandupSummary } from '@/components/StandupSummary';
import { SyncNotesPanel, SyncNotesDialog } from '@/components/SyncNotes';
import type { SyncNote } from '@/types/standup';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export function StandupTimer() {
  const {
    teamId, teamMembers, sessions, currentSpeaker, currentStandupId, status, elapsedTime, interruptions,
    endedStandupId, syncNotes, endedStandupNotes, connectionStatus, startTimer, pauseTimer, resumeTimer,
    stopTimer, addMember, removeMember, addSyncNote, removeSyncNote, clearSessions, clearEndedStandupId,
    formatTime,
  } = useStandup();

  // Disconnected/reconnecting are surfaced immediately; a transient 'connecting'
  // is only surfaced after a short delay to avoid flashing during initial load.
  const [connectingTooLong, setConnectingTooLong] = useState(false);
  useEffect(() => {
    if (connectionStatus !== 'connecting') return;
    const timeout = setTimeout(() => setConnectingTooLong(true), 2000);
    return () => {
      clearTimeout(timeout);
      setConnectingTooLong(false);
    };
  }, [connectionStatus]);

  const showConnectionStatus =
    connectionStatus === 'disconnected' ||
    connectionStatus === 'reconnecting' ||
    (connectionStatus === 'connecting' && connectingTooLong);

  const [expectedSeconds, setExpectedSeconds] = useState(90);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryStandupId, setSummaryStandupId] = useState<string | null>(null);
  const [showNotesReview, setShowNotesReview] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<SyncNote[]>([]);
  const expectedMs = expectedSeconds * 1000;

  // The "end standup" broadcast reaches every client (including the one that
  // clicked End Standup), so route both local and remote ends through here and
  // dedupe by standup id to avoid re-opening dialogs the user already dismissed.
  const handledEndRef = useRef<string | null>(null);
  const beginEndFlow = (standupId: string | null, notes: SyncNote[]) => {
    if (standupId && handledEndRef.current === standupId) return;
    handledEndRef.current = standupId;
    setSummaryStandupId(standupId);
    if (notes.length > 0) {
      setReviewNotes(notes);
      setShowNotesReview(true);
    } else {
      setShowSummary(true);
    }
  };

  // Standup ended (locally or from the control page) - review notes, then summary.
  // Synchronizing this WebSocket-driven event into dialog state is exactly what
  // an effect is for, so the set-state-in-effect heuristic is suppressed here.
  useEffect(() => {
    if (endedStandupId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      beginEndFlow(endedStandupId, endedStandupNotes);
      clearEndedStandupId();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endedStandupId, clearEndedStandupId]);

  const canEnd = Boolean(currentStandupId) || syncNotes.length > 0;

  const handleEndStandup = () => {
    if (!canEnd) return;
    // stopTimer saves the current speaker's session and tells the server to end;
    // the resulting end_standup broadcast drives the dialogs via beginEndFlow.
    // Capture notes now in case this client is offline and never sees the echo.
    const notes = syncNotes;
    const standupId = currentStandupId;
    if (status !== 'idle' || standupId) {
      stopTimer();
    }
    beginEndFlow(standupId, notes);
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
      {/* Connection Status - Only shown when there's an issue */}
      {showConnectionStatus && (
        <div
          className={cn(
            "absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
            connectionStatus === 'disconnected' && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
            connectionStatus === 'reconnecting' && "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
            connectionStatus === 'connecting' && "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
          )}
        >
          {connectionStatus === 'disconnected' && (
            <>
              <WifiOff className="h-4 w-4" />
              <span>Disconnected</span>
            </>
          )}
          {connectionStatus === 'reconnecting' && (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Reconnecting...</span>
            </>
          )}
          {connectionStatus === 'connecting' && (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Connecting...</span>
            </>
          )}
        </div>
      )}

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
          disabled={!canEnd}
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

        {/* Sync / Parking Lot - quick notes to revisit after standup */}
        <SyncNotesPanel
          notes={syncNotes}
          onAdd={addSyncNote}
          onRemove={removeSyncNote}
          disabled={connectionStatus !== 'connected'}
        />
      </div>

      {/* Sync Notes Review - shown first when a standup ends with parked topics */}
      <SyncNotesDialog
        open={showNotesReview}
        notes={reviewNotes}
        onContinue={() => {
          setShowNotesReview(false);
          setShowSummary(true);
        }}
        onClose={() => {
          setShowNotesReview(false);
          handledEndRef.current = null;
        }}
      />

      {/* Summary Dialog */}
      <StandupSummary
        open={showSummary}
        onClose={() => {
          setShowSummary(false);
          handledEndRef.current = null;
        }}
        sessions={sessions}
        teamMembers={teamMembers}
        teamId={teamId}
        standupId={summaryStandupId}
        formatTime={formatTime}
      />
    </div>
  );
}
