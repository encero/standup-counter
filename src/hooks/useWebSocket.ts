import { useState, useEffect, useCallback } from 'react';
import { ConnectionManager, type ConnectionStatus } from '@/lib/ConnectionManager';
import type { TeamMember, TimerStatus } from '@/types/standup';

interface TimerState {
  currentSpeaker: TeamMember | null;
  standupId: string | null;
  status: TimerStatus;
  elapsedTime: number;
  interruptions: number;
}

interface StateMessage {
  type: 'state';
  currentSpeaker: TeamMember | null;
  standupId: string | null;
  status: TimerStatus;
  elapsedTime: number;
  interruptions: number;
}

interface TickMessage {
  type: 'tick';
  elapsedTime: number;
}

type WebSocketMessage = StateMessage | TickMessage | { type: string };

export function useWebSocket(teamId: string) {
  const [state, setState] = useState<TimerState>({
    currentSpeaker: null,
    standupId: null,
    status: 'idle',
    elapsedTime: 0,
    interruptions: 0,
  });
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const isConnected = connectionStatus === 'connected';

  useEffect(() => {
    if (!teamId) return;

    // Connect via ConnectionManager
    ConnectionManager.connect(teamId);

    // Subscribe to status updates
    const unsubscribeStatus = ConnectionManager.onStatus(setConnectionStatus);

    // Subscribe to messages
    const unsubscribeMessage = ConnectionManager.onMessage((data) => {
      const msg = data as WebSocketMessage;
      if (msg.type === 'state') {
        const stateMsg = msg as StateMessage;
        setState({
          currentSpeaker: stateMsg.currentSpeaker,
          standupId: stateMsg.standupId,
          status: stateMsg.status,
          elapsedTime: stateMsg.elapsedTime,
          interruptions: stateMsg.interruptions,
        });
      } else if (msg.type === 'tick') {
        const tickMsg = msg as TickMessage;
        setState(prev => ({ ...prev, elapsedTime: tickMsg.elapsedTime }));
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeMessage();
      // Note: Don't disconnect here - other components may be using the connection
    };
  }, [teamId]);

  const send = useCallback((data: object) => {
    ConnectionManager.send(data);
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
