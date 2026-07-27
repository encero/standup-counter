import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BarChart2, History, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useStandup } from '@/context/StandupContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TimerDisplay } from '@/components/shared/TimerDisplay';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { MemberSelector } from '@/components/shared/MemberSelector';
import { RadialIndicator, LinearIndicator } from '@/components/shared/TimeIndicator';
import { Settings } from '@/components/Settings';
import { StandupSummary } from '@/components/StandupSummary';
import { SyncNotesPanel, SyncNotesDialog } from '@/components/SyncNotes';
import { SprintGoalBanner, SprintGoalDialog } from '@/components/SprintGoal';
import { PrReviewQueue } from '@/components/PrReviewQueue';
import type { SyncNote } from '@/types/standup';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export function StandupTimer() {
  const {
    teamId, teamMembers, sessions, currentSpeaker, currentStandupId, status, elapsedTime, interruptions,
    endedStandupId, syncNotes, endedStandupNotes, connectionStatus, startTimer, pauseTimer, resumeTimer,
    stopTimer, addMember, removeMember, addSyncNote, removeSyncNote, clearSessions, clearEndedStandupId,
    sprintStatus, updateSprint, markGoalDone, formatTime, prs, prsSyncedAt,
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
  const [showGoalCheck, setShowGoalCheck] = useState(false);
  const expectedMs = expectedSeconds * 1000;

  // Below Tailwind's md breakpoint (sidebar widths) we render a compact linear
  // timer; at md+ the full radial dial. Rendering only one keeps the speaker /
  // time text single-sourced in the DOM (no duplicate-label a11y or test churn).
  const isWide = useMediaQuery('(min-width: 768px)');

  // The "end standup" broadcast reaches every client (including the one that
  // clicked End Standup), so route both local and remote ends through here and
  // dedupe by standup id to avoid re-opening dialogs the user already dismissed.
  const handledEndRef = useRef<string | null>(null);
  // Notes parked until the sprint-goal check is answered (it precedes the sync review).
  const pendingNotesRef = useRef<SyncNote[]>([]);

  // After the goal check (or when it's skipped), continue to the sync-notes
  // review if there are parked topics, otherwise straight to the summary.
  const proceedAfterGoal = (notes: SyncNote[]) => {
    if (notes.length > 0) {
      setReviewNotes(notes);
      setShowNotesReview(true);
    } else {
      setShowSummary(true);
    }
  };

  const beginEndFlow = (standupId: string | null, notes: SyncNote[]) => {
    if (standupId && handledEndRef.current === standupId) return;
    handledEndRef.current = standupId;
    setSummaryStandupId(standupId);
    // Ask whether the sprint goal is done first — but only when a goal is set and
    // isn't already marked done for this sprint.
    if (sprintStatus?.hasGoal && !sprintStatus.done) {
      pendingNotesRef.current = notes;
      setShowGoalCheck(true);
    } else {
      proceedAfterGoal(notes);
    }
  };

  const handleGoalDone = () => {
    markGoalDone(true).catch(() => { /* surfaced via console in the hook */ });
    setShowGoalCheck(false);
    proceedAfterGoal(pendingNotesRef.current);
  };

  const handleGoalNotDone = () => {
    setShowGoalCheck(false);
    proceedAfterGoal(pendingNotesRef.current);
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

  // Everyone has had a turn once every team member has a recorded session in the
  // active standup (or is mid-turn). Drives the End Standup button's "wrap up"
  // call-to-action so the moderator knows the round is complete.
  const allSpoken = useMemo(() => {
    if (!currentStandupId || teamMembers.length === 0) return false;
    const spoken = new Set<string>();
    for (const s of sessions) {
      if (s.standupId === currentStandupId && s.duration > 0) spoken.add(s.memberId);
    }
    if (currentSpeaker) spoken.add(currentSpeaker.id);
    return teamMembers.every(m => spoken.has(m.id));
  }, [sessions, currentStandupId, currentSpeaker, teamMembers]);

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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-3 md:space-y-6">
        {/* Toolbar: connection status (when relevant) + utility actions */}
        <div className="flex h-9 items-center justify-between gap-2">
          <div className="min-w-0">
            {showConnectionStatus && (
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all",
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
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
              <Button variant="ghost" size="icon" className="h-9 w-9" title="Trends">
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
              sprintStatus={sprintStatus}
              onUpdateSprint={updateSprint}
              disabled={status !== 'idle'}
            />
          </div>
        </div>

        {/* Sprint Goal — escalating signal of how close the team is to the goal,
            and where this window's goal is set/edited inline. */}
        <SprintGoalBanner
          status={sprintStatus}
          onSetGoal={(goal) => { updateSprint({ goal }); }}
        />

        {/* Timer Card — compact linear header on narrow/sidebar widths,
            full radial dial on wider screens. */}
        <Card
          className={cn(
            'border-2 relative',
            !isWide && 'gap-0 py-0',
            status !== 'idle' && 'cursor-pointer'
          )}
          onClick={status === 'idle' ? undefined : (status === 'paused' ? resumeTimer : pauseTimer)}
        >
          {isWide ? (
            /* Expansive (full-page) layout */
            <>
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
            </>
          ) : (
            /* Compact (sidebar) layout */
            <CardContent className="p-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2 min-w-0 text-sm font-medium text-muted-foreground">
                  <span className="truncate">
                    {currentSpeaker ? `${currentSpeaker.name} is speaking` : 'Select a speaker to begin'}
                  </span>
                  {interruptions > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">paused {interruptions}×</span>
                  )}
                </span>
                <TimerDisplay
                  time={formatTime(elapsedTime)}
                  status={status}
                  size="sm"
                  className="text-right shrink-0"
                />
              </div>
              <LinearIndicator elapsed={elapsedTime} expected={expectedMs} />
            </CardContent>
          )}
        </Card>

        {/* End Standup Button — subdued until everyone has spoken, then a CTA */}
        <Button
          variant={allSpoken ? 'default' : 'outline'}
          size="sm"
          onClick={handleEndStandup}
          disabled={!canEnd}
          className={cn(
            'w-full h-11 md:h-12 text-sm transition-all',
            allSpoken
              ? 'bg-green-600 text-white shadow-sm ring-2 ring-green-500/30 [a]:hover:bg-green-600 hover:bg-green-600/90'
              : 'text-muted-foreground'
          )}
        >
          {allSpoken && <CheckCircle2 className="h-4 w-4" data-icon="inline-start" />}
          {allSpoken ? 'Everyone spoke — End Standup' : 'End Standup'}
        </Button>

        {/* Team Members */}
        <Card className="gap-2 py-3 md:gap-4 md:py-4">
          <CardHeader className="px-3 md:px-4">
            <CardTitle className="text-base md:text-lg">Team Members</CardTitle>
          </CardHeader>
          <CardContent className="px-3 md:px-4">
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

        {/* PR review queue - open PRs by the team awaiting human review */}
        <PrReviewQueue prs={prs} syncedAt={prsSyncedAt} />

        {/* Sync / Parking Lot - quick notes to revisit after standup */}
        <SyncNotesPanel
          notes={syncNotes}
          onAdd={addSyncNote}
          onRemove={removeSyncNote}
          disabled={connectionStatus !== 'connected'}
        />
      </div>

      {/* Sprint goal check - shown first when a standup ends with an unmet goal */}
      <SprintGoalDialog
        open={showGoalCheck}
        status={sprintStatus}
        onDone={handleGoalDone}
        onNotDone={handleGoalNotDone}
      />

      {/* Sync Notes Review - shown when a standup ends with parked topics */}
      <SyncNotesDialog
        open={showNotesReview}
        notes={reviewNotes}
        onContinue={() => {
          setShowNotesReview(false);
          setShowSummary(true);
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
