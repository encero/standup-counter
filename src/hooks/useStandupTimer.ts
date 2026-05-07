import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TeamMember, SpeakerSession, TimerStatus } from '@/types/standup';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
const WS_BASE = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
  : 'ws://localhost:3001';

export function useStandupTimer(teamId: string) {
  const navigate = useNavigate();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [sessions, setSessions] = useState<SpeakerSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [teamValid, setTeamValid] = useState(true);

  const API_URL = `${API_BASE}/api/${teamId}`;
  const WS_URL = `${WS_BASE}/ws/${teamId}`;

  // Load initial data from SQLite
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/members`).then(r => {
        if (r.status === 404) throw new Error('Team not found');
        return r.json();
      }),
      fetch(`${API_URL}/sessions`).then(r => r.json()),
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

  const startTimeRef = useRef<number | null>(null);
  const pauseStartRef = useRef<number | null>(null);
  const totalPausedRef = useRef(0);
  const standupIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
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
      fetch(`${API_URL}/sessions/${existingSession.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSession),
      }).catch(err => console.error('Failed to update session:', err));
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
      fetch(`${API_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      }).catch(err => console.error('Failed to save session:', err));
    }
  }, [API_URL]);

  // WebSocket connection for syncing with control page
  useEffect(() => {
    if (!teamValid || !teamId) return;

    let ws: WebSocket | null = null;
    let isCancelled = false;

    // Small delay to avoid race conditions during React strict mode / fast refresh
    const timeout = setTimeout(() => {
      if (isCancelled) return;

      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state') {
            const prevSpeaker = currentSpeakerRef.current;
            const newSpeaker = msg.currentSpeaker;
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
            setCurrentSpeaker(msg.currentSpeaker);
            setStatus(msg.status);
            setElapsedTime(msg.elapsedTime);
            setInterruptions(msg.interruptions);
            standupIdRef.current = msg.standupId;
            setCurrentStandupId(msg.standupId);
            startTimeRef.current = msg.startTime;
            totalPausedRef.current = msg.totalPaused;
            pauseStartRef.current = msg.pauseStart;
          } else if (msg.type === 'tick') {
            setElapsedTime(msg.elapsedTime);
          } else if (msg.type === 'end_standup') {
            // Standup was ended (possibly from control page) - trigger summary
            setEndedStandupId(msg.standupId);
          }
        } catch (err) {
          console.error('WebSocket message error:', err);
        }
      };

      ws.onerror = () => {
        if (!isCancelled) {
          console.error('WebSocket error - team may not exist');
        }
      };
    }, 100);

    return () => {
      isCancelled = true;
      clearTimeout(timeout);
      if (ws) ws.close();
    };
  }, [teamId, WS_URL, teamValid, saveSession]);

  const wsSend = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
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
    // Save to SQLite
    fetch(`${API_URL}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newMember),
    }).catch(err => console.error('Failed to save member:', err));
    return newMember;
  }, []);

  const removeMember = useCallback((id: string) => {
    setTeamMembers(prev => prev.filter(m => m.id !== id));
    // Delete from SQLite
    fetch(`${API_URL}/members/${id}`, { method: 'DELETE' })
      .catch(err => console.error('Failed to delete member:', err));
  }, []);

  const clearSessions = useCallback(() => {
    setSessions([]);
    // Clear from SQLite
    fetch(`${API_URL}/sessions`, { method: 'DELETE' })
      .catch(err => console.error('Failed to clear sessions:', err));
  }, []);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const clearEndedStandupId = useCallback(() => {
    setEndedStandupId(null);
  }, []);

  return {
    teamMembers,
    sessions,
    currentSpeaker,
    currentStandupId,
    endedStandupId,
    status,
    elapsedTime,
    interruptions,
    isLoading,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    addMember,
    removeMember,
    clearSessions,
    clearEndedStandupId,
    formatTime,
  };
}
