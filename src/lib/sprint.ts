import { Target, CheckCircle2, AlertTriangle, Skull, type LucideIcon } from 'lucide-react';
import type { SprintStatus } from '@/types/standup';

/**
 * Presentation layer for sprint-goal urgency. The server hands us the facts
 * (elapsed fraction, days left, configurable thresholds, done flag); here we map
 * them to an escalating "angrier the closer to the deadline" visual treatment
 * that is shared by the main-page banner and the end-of-standup dialog.
 */

export type SprintLevel = 'idle' | 'done' | 'calm' | 'notice' | 'warning' | 'critical';

export interface SprintUrgency {
  level: SprintLevel;
  show: boolean; // whether the banner/dialog should render at all
  icon: LucideIcon;
  headline: string;
  subline: string;
  daysLabel: string;
  // tailwind class bundles, keyed off the level
  banner: string;
  iconWrap: string;
  bar: string;
  track: string;
  badge: string;
  animate: string;
  // dialog-specific accents
  confirmBtn: string;
}

export function sprintLevel(status: SprintStatus): SprintLevel {
  if (!status.configured || !status.hasGoal) return 'idle';
  if (status.done) return 'done';
  // Thresholds are days-remaining cutoffs: a level triggers once the sprint has
  // that many days (or fewer) left. critical < warning < notice.
  const { daysRemaining: d, thresholds: t } = status;
  if (d <= t.critical) return 'critical';
  if (d <= t.warning) return 'warning';
  if (d <= t.notice) return 'notice';
  return 'calm';
}

function daysLabel(daysRemaining: number): string {
  // daysRemaining is days left AFTER today, so 0 means today is the final day.
  if (daysRemaining <= 0) return '0 days left';
  if (daysRemaining === 1) return '1 day left';
  return `${daysRemaining} days left`;
}

const STYLES: Record<Exclude<SprintLevel, 'idle'>, {
  icon: LucideIcon;
  banner: string;
  iconWrap: string;
  bar: string;
  track: string;
  badge: string;
  animate: string;
  confirmBtn: string;
}> = {
  done: {
    icon: CheckCircle2,
    banner: 'border-green-300 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300',
    iconWrap: 'bg-green-200/70 text-green-700 dark:bg-green-900/50 dark:text-green-300',
    bar: 'bg-green-500',
    track: 'bg-black/5 dark:bg-white/10',
    badge: 'bg-green-200 text-green-800 dark:bg-green-900/60 dark:text-green-200',
    animate: '',
    confirmBtn: 'bg-green-600 text-white hover:bg-green-600/90',
  },
  calm: {
    icon: Target,
    banner: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300',
    iconWrap: 'bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    bar: 'bg-slate-400',
    track: 'bg-black/5 dark:bg-white/10',
    badge: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    animate: '',
    confirmBtn: 'bg-slate-900 text-white hover:bg-slate-900/90 dark:bg-slate-100 dark:text-slate-900',
  },
  notice: {
    icon: Target,
    banner: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300',
    iconWrap: 'bg-amber-200/70 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    bar: 'bg-amber-500',
    track: 'bg-black/5 dark:bg-white/10',
    badge: 'bg-amber-200 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
    animate: '',
    confirmBtn: 'bg-amber-600 text-white hover:bg-amber-600/90',
  },
  warning: {
    icon: AlertTriangle,
    banner: 'border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300',
    iconWrap: 'bg-orange-300/80 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
    bar: 'bg-orange-500',
    track: 'bg-black/5 dark:bg-white/10',
    badge: 'bg-orange-300 text-orange-900 dark:bg-orange-900/60 dark:text-orange-200',
    animate: 'animate-pulse',
    confirmBtn: 'bg-orange-600 text-white hover:bg-orange-600/90',
  },
  critical: {
    icon: Skull,
    banner: 'border-red-400 bg-red-50 text-red-900 ring-2 ring-red-500/40 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200',
    iconWrap: 'bg-red-600 text-white',
    bar: 'bg-red-600',
    track: 'bg-red-500/15',
    badge: 'bg-red-600 text-white',
    animate: 'animate-angry-shake',
    confirmBtn: 'bg-red-600 text-white hover:bg-red-600/90',
  },
};

export function getSprintUrgency(status: SprintStatus): SprintUrgency {
  const level = sprintLevel(status);
  const goal = status.goal.trim();
  const dl = daysLabel(status.daysRemaining);

  if (level === 'idle') {
    return {
      level, show: false, icon: Target, headline: '', subline: '', daysLabel: dl,
      banner: '', iconWrap: '', bar: '', track: '', badge: '', animate: '', confirmBtn: '',
    };
  }

  const s = STYLES[level];

  let headline: string;
  let subline: string;
  switch (level) {
    case 'done':
      headline = 'Sprint goal complete 🎉';
      subline = goal || 'Nice work — the goal is in the bag.';
      break;
    case 'calm':
      headline = 'Sprint goal in progress';
      subline = goal;
      break;
    case 'notice':
      headline = 'Goal still open — keep it moving';
      subline = goal;
      break;
    case 'warning':
      headline = "Crunch time — the goal isn't done";
      subline = goal;
      break;
    case 'critical':
      headline = status.daysRemaining <= 0
        ? 'LAST CHANCE — the goal is STILL not done!'
        : "Time's almost up and the goal is NOT done!";
      subline = goal;
      break;
    default:
      headline = '';
      subline = goal;
  }

  return {
    level,
    show: true,
    icon: s.icon,
    headline,
    subline,
    daysLabel: dl,
    banner: s.banner,
    iconWrap: s.iconWrap,
    bar: s.bar,
    track: s.track,
    badge: s.badge,
    animate: s.animate,
    confirmBtn: s.confirmBtn,
  };
}
