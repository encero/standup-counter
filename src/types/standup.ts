export interface TeamMember {
  id: string;
  name: string;
  avatar?: string;
  isGuest?: boolean;
}

export interface SpeakerSession {
  id: string;
  memberId: string;
  memberName: string;
  standupId: string;
  startTime: number;
  endTime?: number;
  duration: number;
  interruptions: number;
  pausedDuration: number;
}

export interface StandupState {
  teamMembers: TeamMember[];
  currentSpeaker: TeamMember | null;
  sessions: SpeakerSession[];
  isRunning: boolean;
  isPaused: boolean;
  elapsedTime: number;
  pauseStartTime: number | null;
  totalPausedTime: number;
  startTime: number | null;
}

export type TimerStatus = 'idle' | 'running' | 'paused';
