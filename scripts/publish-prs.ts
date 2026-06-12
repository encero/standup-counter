#!/usr/bin/env npx tsx
/**
 * PR review-queue publisher
 *
 * Runs WHERE THE PRIVATE REPO IS REACHABLE (e.g. your laptop on the corp
 * network) — the standup app server never talks to GitHub. Fetches open PRs
 * via the `gh` CLI, keeps only the ones that need human review, strips them to
 * a minimal payload, and pushes them to the counter app's ingest endpoint.
 *
 * The app holds NO GitHub credential. GitHub auth is your existing `gh` login
 * (or GH_TOKEN, which `gh` picks up). The only thing presented to the app is
 * the per-team ingest token (generate with `npm run team pr-token <teamId>`).
 *
 * Filter (review-only; CI is intentionally ignored — human review is critical):
 *   publish if  author ∈ allowlist  &&  !isDraft  &&  reviewDecision !== 'APPROVED'
 *
 * Published payload per PR is the four-field minimum: { author, title, repo, number }.
 *
 * Usage:
 *   STANDUP_INGEST_TOKEN=… npm run publish-prs -- \
 *     --repo owner/name --team <teamId> --app http://localhost:3001 \
 *     --authors alice,bob,carol [--watch] [--interval 300] [--dry-run]
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface Args {
  repo: string;
  team: string;
  app: string;
  authors: string[];
  token: string;
  watch: boolean;
  interval: number; // seconds
  dryRun: boolean;
}

// What `gh pr list --json` gives us (only the fields we ask for).
interface GhPr {
  number: number;
  title: string;
  author: { login: string } | null;
  reviewDecision: string; // 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | ''
  isDraft: boolean;
}

interface PrInfo {
  author: string;
  title: string;
  repo: string;
  number: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const repo = get('repo');
  const team = get('team');
  const app = (get('app') || 'http://localhost:3001').replace(/\/+$/, '');
  const authorsRaw = get('authors') || '';
  const token = get('token') || process.env.STANDUP_INGEST_TOKEN || '';
  const dryRun = has('dry-run');

  const missing: string[] = [];
  if (!repo) missing.push('--repo owner/name');
  if (!team) missing.push('--team <teamId>');
  if (!authorsRaw) missing.push('--authors a,b,c');
  if (!token && !dryRun) missing.push('--token <t> or STANDUP_INGEST_TOKEN env');
  if (missing.length) {
    console.error(`\n❌ Missing required: ${missing.join(', ')}\n`);
    process.exit(1);
  }

  // Preserve original case (GitHub logins are passed verbatim to `gh --author`)
  // and de-dupe.
  const authors = [...new Set(authorsRaw.split(',').map(s => s.trim()).filter(Boolean))];

  return {
    repo: repo!,
    team: team!,
    app,
    authors,
    token,
    watch: has('watch'),
    interval: Math.max(30, Number(get('interval')) || 300),
    dryRun,
  };
}

// Fetch one author's open PRs. We query PER AUTHOR with gh's server-side
// `--author` filter rather than listing all open PRs and filtering locally:
// busy monorepos can have 1000+ open PRs (gh's hard cap), so a global
// `--limit` silently drops older PRs — including ones that need review. Each
// person has only a handful of open PRs, so per-author queries never paginate.
async function fetchPrsForAuthor(repo: string, author: string): Promise<GhPr[]> {
  try {
    const { stdout } = await execFileAsync('gh', [
      'pr', 'list',
      '--repo', repo,
      '--state', 'open',
      '--author', author,
      '--limit', '200',
      '--json', 'number,title,author,reviewDecision,isDraft',
    ], { maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout) as GhPr[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Failed to fetch PRs via gh for ${repo} (author ${author}).`);
    console.error(`   Make sure gh is installed and authed (gh auth status). Details:\n   ${msg}\n`);
    throw err;
  }
}

// Fetch every allowlisted author's open PRs (in parallel) and de-dupe by number.
async function fetchPrs(repo: string, authors: string[]): Promise<GhPr[]> {
  const perAuthor = await Promise.all(authors.map(a => fetchPrsForAuthor(repo, a)));
  const byNumber = new Map<number, GhPr>();
  for (const pr of perAuthor.flat()) byNumber.set(pr.number, pr);
  return [...byNumber.values()];
}

// Keep PRs that need human review, excluding drafts. (Author filtering already
// happened server-side via `gh --author`.)
function selectNeedsReview(prs: GhPr[], repo: string): PrInfo[] {
  return prs
    .filter(pr => !pr.isDraft)
    .filter(pr => pr.reviewDecision !== 'APPROVED')
    .filter(pr => pr.author)
    .map(pr => ({ author: pr.author!.login, title: pr.title, repo, number: pr.number }));
}

async function publish(args: Args, prs: PrInfo[]): Promise<void> {
  const url = `${args.app}/api/${args.team}/pr-status`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.token}`,
    },
    body: JSON.stringify({ prs }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ingest failed: ${res.status} ${res.statusText} ${body}`);
  }
}

async function runOnce(args: Args): Promise<void> {
  const all = await fetchPrs(args.repo, args.authors);
  const needsReview = selectNeedsReview(all, args.repo);

  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] ${args.repo}: ${all.length} open by ${args.authors.length} author(s) → ${needsReview.length} need review`);
  for (const pr of needsReview) {
    console.log(`   #${pr.number}  ${pr.author.padEnd(16)} ${pr.title}`);
  }

  if (args.dryRun) {
    console.log('   (dry-run — not published)');
    return;
  }

  await publish(args, needsReview);
  console.log(`   ✅ published ${needsReview.length} to ${args.app}/api/${args.team}/pr-status`);
}

const args = parseArgs(process.argv.slice(2));

if (args.watch) {
  console.log(`👀 Watching ${args.repo} every ${args.interval}s — Ctrl-C to stop.`);
  const tick = () => runOnce(args).catch(err => console.error(`   ⚠️  ${err.message}`));
  await tick();
  setInterval(tick, args.interval * 1000);
} else {
  await runOnce(args);
}
