import { useState, useEffect, useCallback, useRef } from 'react';
import type { TeamMember, TimerStatus } from '@/types/standup';

const WS_BASE = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
  : 'ws://localhost:3001';

interface TimerState {
  currentSpeaker: TeamMember | null;
  standupId: string | null;
  status: TimerStatus;
  elapsedTime: number;
  interruptions: number;
}

export function useWebSocket(teamId: string) {
  const [state, setState] = useState<TimerState>({
    currentSpeaker: null,
    standupId: null,
    status: 'idle',
    elapsedTime: 0,
    interruptions: 0,
  });
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!teamId) return;

    const ws = new WebSocket(`${WS_BASE}/ws/${teamId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') {
          setState({
            currentSpeaker: msg.currentSpeaker,
            standupId: msg.standupId,
            status: msg.status,
            elapsedTime: msg.elapsedTime,
            interruptions: msg.interruptions,
          });
        } else if (msg.type === 'tick') {
          setState(prev => ({ ...prev, elapsedTime: msg.elapsedTime }));
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    return () => {
      ws.close();
    };
  }, [teamId]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const startTimer = useCallback((speaker: TeamMember) => {
    send({ type: 'start', speaker });
  }, [send]);

  const pauseTimer = useCallback(() => {
    send({ type: 'pause' });
  }, [send]);

  const resumeTimer = useCallback(() => {
    send({ type: 'resume' });
  }, [send]);

  const stopTimer = useCallback(() => {
    send({ type: 'stop' });
  }, [send]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return {
    ...state,
    isConnected,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    formatTime,
  };
}
