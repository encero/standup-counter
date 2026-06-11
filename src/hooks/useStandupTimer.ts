import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConnectionManager, type ConnectionStatus } from '@/lib/ConnectionManager';
import type { TeamMember, SpeakerSession, SyncNote, TimerStatus, SprintStatus } from '@/types/standup';

export type { ConnectionStatus };

export function useStandupTimer(teamId: string) {
  const navigate = useNavigate();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [sessions, setSessions] = useState<SpeakerSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [teamValid, setTeamValid] = useState(true);

  const API_URL = `/api/${teamId}`;

  // Load initial data from SQLite via ConnectionManager
  useEffect(() => {
    Promise.all([
      ConnectionManager.get<TeamMember[]>(`${API_URL}/members`).catch((err: Error & { status?: number }) => {
        if (err.status === 404) throw new Error('Team not found');
        throw err;
      }),
      ConnectionManager.get<SpeakerSession[]>(`${API_URL}/sessions`),
    ]).then(([members, sessions]) => {
      setTeamMembers(members);
      setSessions(sessions);
      setIsLoading(false);
    }).catch(err => {
      console.error('Failed to load data:', err);
      setTeamValid(false);
      setIsLoading(false);
      navigate('/team-not-found');
    });
  }, [teamId, API_URL, navigate]);

  const [currentSpeaker, setCurrentSpeaker] = useState<TeamMember | null>(null);
  const [status, setStatus] = useState<TimerStatus>('idle');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [interruptions, setInterruptions] = useState(0);
  const [currentStandupId, setCurrentStandupId] = useState<string | null>(null);
  const [endedStandupId, setEndedStandupId] = useState<string | null>(null);
  const [syncNotes, setSyncNotes] = useState<SyncNote[]>([]);
  const [endedStandupNotes, setEndedStandupNotes] = useState<SyncNote[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [sprintStatus, setSprintStatus] = useState<SprintStatus | null>(null);

  // Sprint goal status is DB-backed (not part of the in-memory timer state), so
  // fetch a snapshot on load; live edits arrive via the 'sprint' WS broadcast.
  useEffect(() => {
    if (!teamId) return;
    ConnectionManager.get<SprintStatus>(`${API_URL}/sprint`)
      .then(setSprintStatus)
      .catch(err => console.error('Failed to load sprint status:', err));
  }, [teamId, API_URL]);

  const startTimeRef = useRef<number | null>(null);
  const pauseStartRef = useRef<number | null>(null);
  const totalPausedRef = useRef(0);
  const standupIdRef = useRef<string | null>(null);
  // Track if we initiated a speaker change locally to avoid double-saving
  const localSpeakerChangeRef = useRef(false);

  // Refs for values needed in WebSocket handler to avoid stale closures
  const currentSpeakerRef = useRef<TeamMember | null>(null);
  const elapsedTimeRef = useRef(0);
  const interruptionsRef = useRef(0);
  const sessionsRef = useRef<SpeakerSession[]>([]);

  // Keep refs in sync with state
  useEffect(() => { currentSpeakerRef.current = currentSpeaker; }, [currentSpeaker]);
  useEffect(() => { elapsedTimeRef.current = elapsedTime; }, [elapsedTime]);
  useEffect(() => { interruptionsRef.current = interruptions; }, [interruptions]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Unified helper to save session for a speaker
  const saveSession = useCallback((
    speaker: TeamMember,
    elapsed: number,
    interruptionCount: number,
    totalPaused: number,
    standupId: string,
    startTime: number
  ) => {
    if (elapsed <= 0) return;

    const now = Date.now();
    // Use ref-based lookup to avoid stale closure issues in WebSocket handler
    const existingSession = sessionsRef.current.find(
      s => s.memberId === speaker.id && s.standupId === standupId
    );

    if (existingSession) {
      // Update existing session - accumulate time and interruptions
      const updatedSession: SpeakerSession = {
        ...existingSession,
        endTime: now,
        duration: existingSession.duration + elapsed,
        interruptions: existingSession.interruptions + interruptionCount,
        pausedDuration: existingSession.pausedDuration + totalPaused,
      };
      setSessions(prev => prev.map(s => s.id === existingSession.id ? updatedSession : s));
      ConnectionManager.put(`${API_URL}/sessions/${existingSession.id}`, updatedSession)
        .catch(err => console.error('Failed to update session:', err));
    } else {
      // Create new session
      const session: SpeakerSession = {
        id: crypto.randomUUID(),
        memberId: speaker.id,
        memberName: speaker.name,
        standupId,
        startTime,
        endTime: now,
        duration: elapsed,
        interruptions: interruptionCount,
        pausedDuration: totalPaused,
      };
      setSessions(prev => [...prev, session]);
      ConnectionManager.post(`${API_URL}/sessions`, session)
        .catch(err => console.error('Failed to save session:', err));
    }
  }, [API_URL]);

  // WebSocket connection for syncing with control page via ConnectionManager
  useEffect(() => {
    if (!teamValid || !teamId) return;

    // Connect via ConnectionManager (handles heartbeats, reconnection, visibility changes)
    ConnectionManager.connect(teamId);

    // Subscribe to status updates
    const unsubscribeStatus = ConnectionManager.onStatus(setConnectionStatus);

    // Subscribe to messages
    const unsubscribeMessage = ConnectionManager.onMessage((data) => {
      const msg = data as { type: string; [key: string]: unknown };

      if (msg.type === 'state') {
        const prevSpeaker = currentSpeakerRef.current;
        const newSpeaker = msg.currentSpeaker as TeamMember | null;
        const speakerChanged = prevSpeaker && newSpeaker && prevSpeaker.id !== newSpeaker.id;

        // If speaker changed remotely (from control page), save previous speaker's session
        // Skip if we initiated this change locally (already saved in startTimer)
        if (speakerChanged && startTimeRef.current && standupIdRef.current && !localSpeakerChangeRef.current) {
          const prevElapsed = Date.now() - startTimeRef.current - totalPausedRef.current;
          saveSession(
            prevSpeaker,
            prevElapsed,
            interruptionsRef.current,
            totalPausedRef.current,
            standupIdRef.current,
            startTimeRef.current
          );
        }
        // Reset the local change flag after processing
        localSpeakerChangeRef.current = false;

        // Update all state
        setCurrentSpeaker(newSpeaker);
        setStatus(msg.status as TimerStatus);
        setElapsedTime(msg.elapsedTime as number);
        setInterruptions(msg.interruptions as number);
        standupIdRef.current = msg.standupId as string | null;
        setCurrentStandupId(msg.standupId as string | null);
        startTimeRef.current = msg.startTime as number | null;
        totalPausedRef.current = msg.totalPaused as number;
        pauseStartRef.current = msg.pauseStart as number | null;
        setSyncNotes((msg.syncNotes as SyncNote[]) ?? []);
      } else if (msg.type === 'tick') {
        setElapsedTime(msg.elapsedTime as number);
      } else if (msg.type === 'notes') {
        // Sync notes added/removed (possibly by another client)
        setSyncNotes((msg.syncNotes as SyncNote[]) ?? []);
        // Adding the first note mints a standupId server-side; mirror it so
        // "End Standup" becomes available even before anyone has spoken.
        const noteStandupId = msg.standupId as string | null;
        if (noteStandupId) {
          standupIdRef.current = noteStandupId;
          setCurrentStandupId(noteStandupId);
        }
      } else if (msg.type === 'end_standup') {
        // Standup was ended (possibly from control page) - trigger summary
        setEndedStandupNotes((msg.syncNotes as SyncNote[]) ?? []);
        setEndedStandupId(msg.standupId as string);
      } else if (msg.type === 'sprint') {
        // Sprint goal config/done changed (possibly from another client)
        setSprintStatus(msg.sprint as SprintStatus);
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeMessage();
      // Note: Don't disconnect here - other components may be using the connection
    };
  }, [teamId, teamValid, saveSession]);

  const wsSend = useCallback((data: object) => {
    ConnectionManager.send(data);
  }, []);

  // Note: We rely on server 'tick' messages for elapsed time updates.
  // No client-side interval needed - this avoids doubled timer updates
  // when both client and server calculate elapsed time independently.

  // Wrapper that gathers current values from refs and calls saveSession
  const saveCurrentSession = useCallback(() => {
    const speaker = currentSpeakerRef.current;
    const startTime = startTimeRef.current;
    const standupId = standupIdRef.current;
    const elapsed = elapsedTimeRef.current;

    if (speaker && startTime && elapsed > 0 && standupId) {
      saveSession(
        speaker,
        elapsed,
        interruptionsRef.current,
        totalPausedRef.current,
        standupId,
        startTime
      );
    }
  }, [saveSession]);

  const startTimer = useCallback((speaker: TeamMember) => {
    // If clicking the current speaker, do nothing
    if (currentSpeaker && currentSpeaker.id === speaker.id) {
      return;
    }
    // If switching speakers while running, save current session first
    if (status !== 'idle' && currentSpeaker) {
      // Mark as local change to prevent double-save when WebSocket state comes back
      localSpeakerChangeRef.current = true;
      saveCurrentSession();
    }
    // Send to WebSocket server (server manages standupId)
    wsSend({ type: 'start', speaker });
  }, [status, currentSpeaker, saveCurrentSession, wsSend]);

  const pauseTimer = useCallback(() => {
    wsSend({ type: 'pause' });
  }, [wsSend]);

  const resumeTimer = useCallback(() => {
    wsSend({ type: 'resume' });
  }, [wsSend]);

  const stopTimer = useCallback(() => {
    saveCurrentSession();
    wsSend({ type: 'stop' });
  }, [saveCurrentSession, wsSend]);

  const addMember = useCallback((name: string, isGuest = false) => {
    const newMember: TeamMember = { id: crypto.randomUUID(), name, isGuest };
    setTeamMembers(prev => [...prev, newMember]);
    // Save to SQLite via ConnectionManager
    ConnectionManager.post(`${API_URL}/members`, newMember)
      .catch(err => console.error('Failed to save member:', err));
    return newMember;
  }, [API_URL]);

  const removeMember = useCallback((id: string) => {
    setTeamMembers(prev => prev.filter(m => m.id !== id));
    // Delete from SQLite via ConnectionManager
    ConnectionManager.delete(`${API_URL}/members/${id}`)
      .catch(err => console.error('Failed to delete member:', err));
  }, [API_URL]);

  const addSyncNote = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    wsSend({ type: 'add_note', text: trimmed });
  }, [wsSend]);

  const removeSyncNote = useCallback((id: string) => {
    wsSend({ type: 'remove_note', id });
  }, [wsSend]);

  // Update sprint config and/or the done flag. The PUT response is the freshly
  // computed status; the server also broadcasts it to every other client.
  const updateSprint = useCallback((patch: {
    goal?: string;
    startDate?: string;
    lengthDays?: number;
    done?: boolean;
    thresholds?: { notice: number; warning: number; critical: number };
  }) => {
    return ConnectionManager.put<SprintStatus>(`${API_URL}/sprint`, patch)
      .then(status => { setSprintStatus(status); return status; })
      .catch(err => { console.error('Failed to update sprint:', err); throw err; });
  }, [API_URL]);

  const markGoalDone = useCallback((done = true) => updateSprint({ done }), [updateSprint]);

  const clearSessions = useCallback(() => {
    setSessions([]);
    // Clear from SQLite via ConnectionManager
    ConnectionManager.delete(`${API_URL}/sessions`)
      .catch(err => console.error('Failed to clear sessions:', err));
  }, [API_URL]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const clearEndedStandupId = useCallback(() => {
    setEndedStandupId(null);
    setEndedStandupNotes([]);
  }, []);

  return {
    teamMembers,
    sessions,
    currentSpeaker,
    currentStandupId,
    endedStandupId,
    syncNotes,
    endedStandupNotes,
    status,
    elapsedTime,
    interruptions,
    isLoading,
    connectionStatus,
    sprintStatus,
    updateSprint,
    markGoalDone,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    addMember,
    removeMember,
    addSyncNote,
    removeSyncNote,
    clearSessions,
    clearEndedStandupId,
    formatTime,
  };
}
