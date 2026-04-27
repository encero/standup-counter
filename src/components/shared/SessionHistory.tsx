import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { SpeakerSession } from '@/types/standup';

interface SessionHistoryProps {
  sessions: SpeakerSession[];
  formatTime: (ms: number) => string;
  onClear: () => void;
  variant?: 'card' | 'table' | 'minimal';
}

export function SessionHistory({ sessions, formatTime, onClear, variant = 'card' }: SessionHistoryProps) {
  if (sessions.length === 0) return null;

  const totalTime = sessions.reduce((sum, s) => sum + s.duration, 0);
  const avgTime = totalTime / sessions.length;

  if (variant === 'minimal') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {sessions.length} speakers • Total: {formatTime(totalTime)}
          </span>
          <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {sessions.map((s) => (
            <Badge key={s.id} variant="outline" className="text-xs">
              {s.memberName}: {formatTime(s.duration)}
            </Badge>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Session History</h3>
          <Button variant="ghost" size="sm" onClick={onClear}>Clear All</Button>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Speaker</th>
                <th className="text-right p-2">Duration</th>
                <th className="text-right p-2">Interruptions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{s.memberName}</td>
                  <td className="text-right p-2 font-mono">{formatTime(s.duration)}</td>
                  <td className="text-right p-2">{s.interruptions}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted font-medium">
              <tr className="border-t">
                <td className="p-2">Total / Avg</td>
                <td className="text-right p-2 font-mono">{formatTime(totalTime)} / {formatTime(avgTime)}</td>
                <td className="text-right p-2">{sessions.reduce((sum, s) => sum + s.interruptions, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Session History</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between py-2 border-b last:border-0">
            <div>
              <span className="font-medium">{s.memberName}</span>
              {s.interruptions > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {s.interruptions} pause{s.interruptions > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            <span className="font-mono text-sm">{formatTime(s.duration)}</span>
          </div>
        ))}
        <div className="pt-2 flex justify-between text-sm text-muted-foreground">
          <span>Total: {formatTime(totalTime)}</span>
          <span>Avg: {formatTime(avgTime)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
