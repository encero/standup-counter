import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sparkline, TrendArrow } from '@/components/shared/Sparkline';
import { StockTicker } from '@/components/StockTicker';
import type { SpeakerSession, TeamMember } from '@/types/standup';
import { cn } from '@/lib/utils';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon-Fri

interface TeamTrends {
  overall: { standupCount: number; avgDuration: number; avgSpeakers: number };
  byDayOfWeek: Array<{ dayOfWeek: number; count: number; avgDuration: number }>;
  trend: number;
  dailyStandups: Array<{ date: number; duration: number }>;
}

interface MemberTrends {
  memberStats: Record<string, { avg7d: number | null; avg30d: number | null }>;
  sparklines: Record<string, number[]>;
  trends: Record<string, number>;
}

interface StandupSummaryProps {
  open: boolean;
  onClose: () => void;
  sessions: SpeakerSession[];
  teamMembers: TeamMember[];
  teamId: string;
  standupId: string | null;
  formatTime: (ms: number) => string;
}

export function StandupSummary({ open, onClose, sessions, teamMembers, teamId, standupId, formatTime }: StandupSummaryProps) {
  const [teamTrends, setTeamTrends] = useState<TeamTrends | null>(null);
  const [memberTrends, setMemberTrends] = useState<MemberTrends | null>(null);

  const API_URL = `${API_BASE}/api/${teamId}`;

  // Fetch trends when dialog opens
  useEffect(() => {
    if (open && teamId) {
      Promise.all([
        fetch(`${API_URL}/trends/team?days=30`).then(r => r.json()),
        fetch(`${API_URL}/trends/members?days=30`).then(r => r.json()),
      ]).then(([team, members]) => {
        setTeamTrends(team);
        setMemberTrends(members);
      }).catch(console.error);
    }
  }, [open, teamId, API_URL]);

  // Get current standup sessions only
  const standupSessions = standupId
    ? sessions.filter(s => s.standupId === standupId)
    : [];

  const totalTime = standupSessions.reduce((sum, s) => sum + s.duration, 0);
  const totalInterruptions = standupSessions.reduce((sum, s) => sum + s.interruptions, 0);

  // Group by speaker (cumulative per person, not per session)
  const speakerTotals = standupSessions.reduce((acc, s) => {
    if (!acc[s.memberId]) {
      acc[s.memberId] = { name: s.memberName, time: 0, interruptions: 0 };
    }
    acc[s.memberId].time += s.duration;
    acc[s.memberId].interruptions += s.interruptions;
    return acc;
  }, {} as Record<string, { name: string; time: number; interruptions: number }>);

  // Set of member IDs who spoke in this standup
  const speakerIds = new Set(Object.keys(speakerTotals));

  // Count unique speakers and calculate average per person
  const uniqueSpeakerCount = speakerIds.size;
  const avgTimePerPerson = uniqueSpeakerCount > 0 ? totalTime / uniqueSpeakerCount : 0;

  // Compare to day-of-week average
  const todayDayOfWeek = new Date().getDay();
  const dayAvg = teamTrends?.byDayOfWeek.find(d => d.dayOfWeek === todayDayOfWeek)?.avgDuration || 0;
  const vsDayPercent = dayAvg ? ((totalTime - dayAvg) / dayAvg) * 100 : 0;

  // Compare to 30-day overall average
  const overallAvg = teamTrends?.overall.avgDuration || 0;
  const vsOverallPercent = overallAvg ? ((totalTime - overallAvg) / overallAvg) * 100 : 0;

  // Max duration for day pattern bar chart
  const maxDayAvg = Math.max(...(teamTrends?.byDayOfWeek.map(d => d.avgDuration) || [1]));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Standup Complete</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold font-mono">{formatTime(totalTime)}</div>
              <div className="text-xs text-muted-foreground">Total Time</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{uniqueSpeakerCount}</div>
              <div className="text-xs text-muted-foreground">Speakers</div>
            </div>
            <div>
              <div className="text-2xl font-bold font-mono">{formatTime(avgTimePerPerson)}</div>
              <div className="text-xs text-muted-foreground">Avg/Person</div>
            </div>
          </div>

          {/* Comparison to averages */}
          {(dayAvg > 0 || overallAvg > 0) && (
            <div className="grid grid-cols-2 gap-2">
              {dayAvg > 0 && (
                <div className={cn(
                  "text-center py-2 px-3 rounded-lg",
                  vsDayPercent > 10 ? "bg-red-50 dark:bg-red-950/30" :
                  vsDayPercent < -10 ? "bg-green-50 dark:bg-green-950/30" :
                  "bg-muted/50"
                )}>
                  <div className="flex items-center justify-center gap-1">
                    <TrendArrow trend={vsDayPercent} className="text-base" />
                    <span className="text-sm font-medium">
                      {Math.abs(vsDayPercent).toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    vs {DAY_NAMES[todayDayOfWeek]} avg
                  </div>
                  <div className="text-xs text-muted-foreground/70">
                    {formatTime(dayAvg)}
                  </div>
                </div>
              )}
              {overallAvg > 0 && (
                <div className={cn(
                  "text-center py-2 px-3 rounded-lg",
                  vsOverallPercent > 10 ? "bg-red-50 dark:bg-red-950/30" :
                  vsOverallPercent < -10 ? "bg-green-50 dark:bg-green-950/30" :
                  "bg-muted/50"
                )}>
                  <div className="flex items-center justify-center gap-1">
                    <TrendArrow trend={vsOverallPercent} className="text-base" />
                    <span className="text-sm font-medium">
                      {Math.abs(vsOverallPercent).toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    vs 30d avg
                  </div>
                  <div className="text-xs text-muted-foreground/70">
                    {formatTime(overallAvg)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Day of Week Patterns - shows averages with today's actual overlaid */}
          {teamTrends && teamTrends.byDayOfWeek.length > 0 && (
            <div className="flex justify-between gap-1">
              {WEEKDAYS.map((dayIndex) => {
                const name = DAY_NAMES[dayIndex];
                const dayData = teamTrends.byDayOfWeek.find(d => d.dayOfWeek === dayIndex);
                const avgDuration = dayData?.avgDuration || 0;
                const isToday = dayIndex === todayDayOfWeek;

                // For today, also show actual standup time as comparison
                const maxVal = Math.max(maxDayAvg, isToday ? totalTime : 0);
                const avgHeightPx = avgDuration ? Math.round((avgDuration / maxVal) * 48) : 2;
                const actualHeightPx = isToday ? Math.round((totalTime / maxVal) * 48) : 0;

                return (
                  <div key={dayIndex} className="flex-1 flex flex-col items-center">
                    <div className="h-12 w-full flex items-end justify-center relative">
                      {/* Average bar */}
                      <div
                        className={cn(
                          "w-full rounded-t transition-all",
                          isToday ? "bg-blue-300" : dayData ? "bg-blue-300" : "bg-muted"
                        )}
                        style={{ height: `${Math.max(avgHeightPx, 2)}px` }}
                      />
                      {/* Today's actual time - outline overlay */}
                      {isToday && actualHeightPx > 0 && (
                        <div
                          className="absolute left-0 right-0 bottom-0 border-2 border-blue-600 rounded-t bg-blue-500/20"
                          style={{ height: `${actualHeightPx}px` }}
                        />
                      )}
                    </div>
                    <span className={cn("text-xs mt-0.5", isToday ? "font-bold" : "text-muted-foreground")}>{name}</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {avgDuration ? formatTime(avgDuration) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Stock Ticker */}
          <StockTicker teamId={teamId} className="border-t pt-3" />

          {/* Monthly standup durations chart */}
          {teamTrends && teamTrends.dailyStandups.length > 1 && (() => {
            const data = teamTrends.dailyStandups;
            const maxDuration = Math.max(...data.map(d => d.duration));
            const avgDuration = teamTrends.overall.avgDuration;
            const avgHeightPercent = avgDuration / maxDuration * 100;

            return (
              <div className="border-t pt-3">
                <div className="relative h-16 flex items-end gap-px">
                  {/* Average line */}
                  <div
                    className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/40"
                    style={{ bottom: `${avgHeightPercent}%` }}
                  />
                  {/* Bars */}
                  {data.map((d, i) => {
                    const heightPercent = (d.duration / maxDuration) * 100;
                    const isToday = new Date(d.date).toDateString() === new Date().toDateString();
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 rounded-t transition-all min-w-[3px]",
                          isToday ? "bg-blue-500" : "bg-blue-300"
                        )}
                        style={{ height: `${heightPercent}%` }}
                        title={`${new Date(d.date).toLocaleDateString()}: ${formatTime(d.duration)}`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{new Date(data[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span className="text-muted-foreground/60">— avg {formatTime(avgDuration)}</span>
                  <span>Today</span>
                </div>
              </div>
            );
          })()}

          {/* Team members table */}
          {teamMembers.length > 0 && (
            <div className="border-t pt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-left font-normal pb-1">Name</th>
                    <th className="text-right font-normal pb-1 w-12">Today</th>
                    <th className="text-right font-normal pb-1 w-12">7d</th>
                    <th className="text-right font-normal pb-1 w-12">30d</th>
                    <th className="w-12 pb-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers
                    .filter(m => !m.isGuest)
                    .sort((a, b) => {
                      const aSpoke = speakerIds.has(a.id);
                      const bSpoke = speakerIds.has(b.id);
                      if (aSpoke && !bSpoke) return -1;
                      if (!aSpoke && bSpoke) return 1;
                      if (aSpoke && bSpoke) {
                        return (speakerTotals[b.id]?.time || 0) - (speakerTotals[a.id]?.time || 0);
                      }
                      return a.name.localeCompare(b.name);
                    })
                    .map(member => {
                      const spoke = speakerIds.has(member.id);
                      const time = speakerTotals[member.id]?.time || 0;
                      const sparkline = memberTrends?.sparklines[member.id] || [];
                      const trend = memberTrends?.trends[member.id] || 0;
                      const stats = memberTrends?.memberStats[member.id];
                      const avg7d = stats?.avg7d;
                      const avg30d = stats?.avg30d;
                      return (
                        <tr key={member.id} className={cn(!spoke && "opacity-50")}>
                          <td className="py-1">
                            <div className="flex items-center gap-1">
                              <span className="font-medium">{member.name}</span>
                              {sparkline.length >= 2 && <TrendArrow trend={trend} className="text-xs" />}
                            </div>
                          </td>
                          <td className="text-right font-mono py-1">
                            {spoke ? formatTime(time) : "—"}
                          </td>
                          <td className="text-right font-mono text-muted-foreground py-1">
                            {avg7d ? formatTime(avg7d) : "—"}
                          </td>
                          <td className="text-right font-mono text-muted-foreground py-1">
                            {avg30d ? formatTime(avg30d) : "—"}
                          </td>
                          <td className="text-right py-1">
                            {sparkline.length >= 2 && (
                              <Sparkline data={sparkline} width={40} height={14} color={spoke ? "#888" : "#ccc"} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {totalInterruptions > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {totalInterruptions} interruption{totalInterruptions > 1 ? 's' : ''} total
            </p>
          )}

          <Button onClick={onClose} className="w-full">Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
