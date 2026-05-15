import { useState, useEffect, useCallback, useRef } from 'react';
import type { TeamMember, TimerStatus } from '@/types/standup';

const WS_BASE = import.meta.env.PROD
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
  : 'ws://localhost:3001';

// Reconnection configuration
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const RECONNECT_BACKOFF_MULTIPLIER = 2;

interface TimerState {
  currentSpeaker: TeamMember | null;
  standupId: string | null;
  status: TimerStatus;
  elapsedTime: number;
  interruptions: number;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export function useWebSocket(teamId: string) {
  const [state, setState] = useState<TimerState>({
    currentSpeaker: null,
    standupId: null,
    status: 'idle',
    elapsedTime: 0,
    interruptions: 0,
  });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (!teamId) return;

    const connect = () => {
      if (!isMountedRef.current) return;

      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      setConnectionStatus(reconnectDelayRef.current > INITIAL_RECONNECT_DELAY ? 'reconnecting' : 'connecting');
      const ws = new WebSocket(`${WS_BASE}/ws/${teamId}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        console.log('WebSocket connected');
        setConnectionStatus('connected');
        setIsConnected(true);
        // Reset reconnect delay on successful connection
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
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
        if (!isMountedRef.current) return;
        console.log('WebSocket disconnected');
        setConnectionStatus('disconnected');
        setIsConnected(false);

        // Schedule reconnection with exponential backoff
        const delay = reconnectDelayRef.current;
        console.log(`Reconnecting in ${delay}ms...`);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * RECONNECT_BACKOFF_MULTIPLIER,
              MAX_RECONNECT_DELAY
            );
            connect();
          }
        }, delay);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        // onclose will be called after onerror, triggering reconnection
      };
    };

    connect();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
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
    connectionStatus,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    formatTime,
  };
}
