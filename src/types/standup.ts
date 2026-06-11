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

export interface SyncNote {
  id: string;
  text: string;
  standupId: string;
  createdAt: number;
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

// Days-remaining cutoffs at which each urgency level kicks in (notice > warning > critical).
export interface SprintThresholds {
  notice: number;
  warning: number;
  critical: number;
}

export interface SprintStatus {
  configured: boolean;
  goal: string;
  hasGoal: boolean;
  lengthDays: number;
  startDate: string;
  sprintStart: number;
  sprintEnd: number;
  elapsedFraction: number;
  daysRemaining: number;
  done: boolean;
  thresholds: SprintThresholds;
}
