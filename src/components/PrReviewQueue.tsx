import { GitPullRequest } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { PrInfo } from '@/types/standup';

// GitHub host used to build the clickable link from repo + number. Defaults to
// public github.com; set VITE_GITHUB_HOST at build time for GitHub Enterprise.
const GITHUB_HOST = (import.meta.env.VITE_GITHUB_HOST as string | undefined)?.replace(/\/+$/, '') || 'https://github.com';

function prUrl(repo: string, number: number): string {
  return `${GITHUB_HOST}/${repo}/pull/${number}`;
}

// "synced 3m ago" — coarse relative time so a stalled feed is visible.
function syncedAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

interface PrReviewQueueProps {
  prs: PrInfo[];
  syncedAt: number | null;
  className?: string;
}

export function PrReviewQueue({ prs, syncedAt, className }: PrReviewQueueProps) {
  // Nothing has ever been published for this team — keep the page uncluttered.
  if (syncedAt === null) return null;

  return (
    <Card className={cn('gap-2 py-3 md:gap-4 md:py-4', className)}>
      <CardHeader className="px-3 md:px-4 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base md:text-lg flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-muted-foreground" />
          Needs review
          {prs.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">({prs.length})</span>
          )}
        </CardTitle>
        <span className="text-[11px] text-muted-foreground shrink-0" title={new Date(syncedAt).toLocaleString()}>
          synced {syncedAgo(syncedAt)}
        </span>
      </CardHeader>
      <CardContent className="px-3 md:px-4">
        {prs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-1">🎉 Nothing waiting for review.</p>
        ) : (
          <ul className="space-y-1.5">
            {prs.map(pr => (
              <li key={`${pr.repo}#${pr.number}`}>
                <a
                  href={prUrl(pr.repo, pr.number)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-baseline gap-2 rounded px-1.5 py-1 -mx-1.5 hover:bg-muted/50 transition-colors"
                >
                  <span className="font-mono text-xs text-muted-foreground shrink-0 tabular-nums">
                    #{pr.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm group-hover:underline">
                    {pr.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{pr.author}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
