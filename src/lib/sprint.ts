import { Target, CheckCircle2, AlertTriangle, Skull, Plus, type LucideIcon } from 'lucide-react';
import type { SprintStatus, SprintLevel } from '@/types/standup';

/**
 * Presentation layer for sprint-goal urgency. The server fully derives the facts
 * — the urgency `level`, days left, the window's end date, done flag — and here we
 * map that level to an escalating "angrier the closer to the deadline" visual
 * treatment shared by the main-page banner and the end-of-standup dialog. No date
 * math or threshold logic lives on the client.
 */

export type { SprintLevel };

export interface SprintUrgency {
  level: SprintLevel;
  show: boolean;      // whether the banner/dialog should render at all
  isEmpty: boolean;   // configured but no goal yet — render the "set a goal" prompt
  icon: LucideIcon;
  headline: string;
  subline: string;
  daysLabel: string;  // e.g. "Last day", "4 days left"
  metaLabel: string;  // e.g. "Day 6 of 10 · ends Fri Jul 25"
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

// Days left is inclusive of today, so 1 == the final day.
function daysLabel(daysLeft: number): string {
  if (daysLeft <= 1) return 'Last day';
  return `${daysLeft} days left`;
}

// "ends Fri Jul 25", parsed as a LOCAL date so the weekday/day never shifts.
function formatEndDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  empty: {
    icon: Plus,
    banner: 'border-dashed border-slate-300 bg-slate-50/60 text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400',
    iconWrap: 'bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    bar: 'bg-slate-300 dark:bg-slate-700',
    track: 'bg-black/5 dark:bg-white/10',
    badge: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    animate: '',
    confirmBtn: 'bg-slate-900 text-white hover:bg-slate-900/90 dark:bg-slate-100 dark:text-slate-900',
  },
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
  const level = status.level;
  const goal = status.goal.trim();
  const dl = daysLabel(status.daysLeft);
  const meta = status.configured
    ? `Day ${status.dayOfSprint} of ${status.lengthDays} · ends ${formatEndDate(status.endDate)}`
    : '';

  if (level === 'idle') {
    return {
      level, show: false, isEmpty: false, icon: Target, headline: '', subline: '',
      daysLabel: dl, metaLabel: meta,
      banner: '', iconWrap: '', bar: '', track: '', badge: '', animate: '', confirmBtn: '',
    };
  }

  const s = STYLES[level];

  let headline: string;
  let subline: string;
  switch (level) {
    case 'empty':
      headline = 'Set this sprint’s goal';
      subline = 'What’s the one thing this team wants to land this sprint?';
      break;
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
      headline = status.daysLeft <= 1
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
    isEmpty: level === 'empty',
    icon: s.icon,
    headline,
    subline,
    daysLabel: dl,
    metaLabel: meta,
    banner: s.banner,
    iconWrap: s.iconWrap,
    bar: s.bar,
    track: s.track,
    badge: s.badge,
    animate: s.animate,
    confirmBtn: s.confirmBtn,
  };
}
