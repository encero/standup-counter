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

// A PR needing review, pushed in by the publisher CLI. Minimal by design —
// the clickable link is built client-side from repo + number.
export interface PrInfo {
  author: string;
  title: string;
  repo: string;   // "owner/name"
  number: number;
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

// Fully server-derived urgency; the client only maps it to colours/copy.
export type SprintLevel = 'idle' | 'empty' | 'calm' | 'notice' | 'warning' | 'critical' | 'done';

export interface SprintStatus {
  configured: boolean;
  goal: string;             // this window's goal ('' when none set yet)
  hasGoal: boolean;
  lengthDays: number;
  startDate: string;        // cadence anchor (YYYY-MM-DD)
  windowStart: string;      // current window start (YYYY-MM-DD)
  endDate: string;          // last day of the current window (YYYY-MM-DD)
  dayOfSprint: number;      // 1-based day within the window
  daysLeft: number;         // whole calendar days left, including today (last day == 1)
  elapsedFraction: number;
  done: boolean;
  level: SprintLevel;
}

// A past (or current) goal, as returned by GET /sprint/history.
export interface SprintGoalHistoryEntry {
  startDate: string;
  goal: string;
  lengthDays: number;
  setAt: number;
  doneAt: number | null;
  done: boolean;
}
