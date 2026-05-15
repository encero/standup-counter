import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkline, TrendArrow } from '@/components/shared/Sparkline';
import { ConnectionManager } from '@/lib/ConnectionManager';
import { cn } from '@/lib/utils';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon-Fri (0=Sun, 6=Sat)

interface TeamTrends {
  overall: { standupCount: number; avgDuration: number; avgSpeakers: number; totalInterruptions: number };
  byDayOfWeek: Array<{ dayOfWeek: number; count: number; avgDuration: number }>;
  trend: number;
}

interface MemberTrends {
  members: Array<{ memberId: string; memberName: string; standupCount: number; avgDuration: number; totalDuration: number }>;
  sparklines: Record<string, number[]>;
  trends: Record<string, number>;
}

interface Standup {
  id: string;
  date: string;
  dayOfWeek: number;
  totalDuration: number;
  speakerCount: number;
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function TrendsPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [teamTrends, setTeamTrends] = useState<TeamTrends | null>(null);
  const [memberTrends, setMemberTrends] = useState<MemberTrends | null>(null);
  const [standups, setStandups] = useState<Standup[]>([]);

  const API_URL = `/api/${teamId}`;

  useEffect(() => {
    if (!teamId) return;
    Promise.all([
      ConnectionManager.get<TeamTrends>(`${API_URL}/trends/team?days=${days}`),
      ConnectionManager.get<MemberTrends>(`${API_URL}/trends/members?days=${days}`),
      ConnectionManager.get<Standup[]>(`${API_URL}/trends/standups?days=${days}`),
    ]).then(([team, members, standupList]) => {
      setTeamTrends(team);
      setMemberTrends(members);
      setStandups(standupList);
    }).catch((err: Error & { status?: number }) => {
      console.error(err);
      if (err.status === 404) {
        navigate('/team-not-found');
      }
    });
  }, [days, teamId, API_URL, navigate]);

  const maxDayAvg = Math.max(...(teamTrends?.byDayOfWeek.map(d => d.avgDuration) || [1]));

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Standup Trends</h1>
          <Link to={`/${teamId}`}><Button variant="outline">← Back</Button></Link>
        </div>

        {/* Time Range Selector */}
        <div className="flex gap-2">
          {[7, 30, 90].map(d => (
            <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
        </div>

        {/* Team Overview */}
        {teamTrends && (
          <Card>
            <CardHeader><CardTitle>Team Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-3xl font-bold">{teamTrends.overall.standupCount}</div>
                  <div className="text-sm text-muted-foreground">Standups</div>
                </div>
                <div>
                  <div className="text-3xl font-bold font-mono">{formatTime(teamTrends.overall.avgDuration || 0)}</div>
                  <div className="text-sm text-muted-foreground">Avg Duration</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">{(teamTrends.overall.avgSpeakers || 0).toFixed(1)}</div>
                  <div className="text-sm text-muted-foreground">Avg Speakers</div>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1">
                    <TrendArrow trend={teamTrends.trend} className="text-2xl" />
                    <span className="text-3xl font-bold">{Math.abs(teamTrends.trend).toFixed(0)}%</span>
                  </div>
                  <div className="text-sm text-muted-foreground">vs Last Week</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Day of Week Patterns */}
        {teamTrends && teamTrends.byDayOfWeek.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Day of Week Patterns</CardTitle></CardHeader>
            <CardContent>
              <div className="flex justify-between gap-2">
                {WEEKDAYS.map((dayIndex) => {
                  const name = DAY_NAMES[dayIndex];
                  const dayData = teamTrends.byDayOfWeek.find(d => d.dayOfWeek === dayIndex);
                  const heightPx = dayData ? Math.round((dayData.avgDuration / maxDayAvg) * 80) : 4;
                  return (
                    <div key={dayIndex} className="flex-1 flex flex-col items-center gap-1">
                      <div className="h-20 w-full flex items-end">
                        <div
                          className={cn("w-full rounded-t transition-all", dayData ? "bg-blue-400" : "bg-muted")}
                          style={{ height: `${Math.max(heightPx, 4)}px` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{name}</span>
                      {dayData && <span className="text-xs font-mono">{formatTime(dayData.avgDuration)}</span>}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Individual Members */}
        {memberTrends && memberTrends.members.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Individual Breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {memberTrends.members
                .sort((a, b) => b.totalDuration - a.totalDuration)
                .map(member => {
                  const sparkline = memberTrends.sparklines[member.memberId] || [];
                  const trend = memberTrends.trends[member.memberId] || 0;
                  return (
                    <div key={member.memberId} className="flex items-center gap-4 py-2 border-b last:border-0">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{member.memberName}</span>
                          <TrendArrow trend={trend} />
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {member.standupCount} standups · {formatTime(member.avgDuration)} avg
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold">{formatTime(member.totalDuration)}</div>
                        <div className="text-xs text-muted-foreground">total</div>
                      </div>
                      {sparkline.length >= 2 && (
                        <Sparkline data={sparkline} width={60} height={24} color="#888" />
                      )}
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        )}

        {/* Standup History */}
        {standups.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Recent Standups</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {standups.slice(0, 10).map(standup => (
                <div key={standup.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="font-medium">{standup.date}</div>
                    <div className="text-sm text-muted-foreground">
                      {DAY_NAMES[standup.dayOfWeek]} · {standup.speakerCount} speakers
                    </div>
                  </div>
                  <div className="font-mono font-bold">{formatTime(standup.totalDuration)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
