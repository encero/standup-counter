# Standup Timer

A team standup timer app with real-time sync, analytics, and multi-device support.

## Features

- **Timer** - Track speaking time for each team member
- **Multi-device sync** - WebSocket-based real-time sync between devices
- **Mobile control page** - Start/stop timer from your phone
- **Teams** - Multi-tenant support with team-based URL routing
- **Trends & Analytics** - Day-of-week patterns, 7d/30d averages, sparklines
- **Standup Summary** - Post-standup overview with comparisons to averages
- **Stock Ticker** - Optional stock price display in standup summary
- **Persistent storage** - SQLite database with automatic migrations

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The server will display local and network URLs for multi-device access.

## Team Management

Teams provide data isolation. Create a team before using the app:

```bash
# Create a team
npm run team create "My Team"

# List teams
npm run team list

# Add a member
npm run team add-member <team_id> "Alice"

# View team info
npm run team info <team_id>

# Delete a team
npm run team delete <team_id>

# Move a team to a new, strong ID (old URLs stop working)
npm run team rotate-id <team_id>
```

The team ID is the team's access token: anyone with the URL can view and
control that team's timer and settings. New teams get 20-character random IDs;
teams created with older versions have 8-character IDs, which keep working but
are much easier to guess. Upgrade them with `rotate-id`.

## URLs

All routes are prefixed with the team ID:

- `/:teamId` - Main timer view
- `/:teamId/control` - Mobile control page
- `/:teamId/trends` - Trends dashboard

## Seeding Test Data

```bash
npm run seed <team_id>
```

Creates ~25 standups with realistic data for the past month.

## Production Build

```bash
npm run build
NODE_ENV=production npx tsx server/index.ts
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP/WebSocket port |
| `DB_PATH` | `./standup.db` | SQLite database file |
| `NODE_ENV` | | `production` serves the built frontend from `dist/` |
| `TZ` | system | Timezone for standup dates and sprint-day rollover (e.g. `Europe/Prague`) |
| `TRUST_PROXY` | | Number of reverse-proxy hops (e.g. `1` behind an ingress) so rate limiting sees client IPs |
| `CORS_ORIGINS` | | Comma-separated extra origins allowed to call the API / open WebSockets. Not needed when the app serves its own frontend |
| `FRAME_ANCESTORS` | `'self'` | CSP `frame-ancestors`; set e.g. `*` or `https://dash.example.com` to embed the display in another site |
| `TEAM_LOOKUP_FAIL_LIMIT` | `100` | Unknown-team lookups allowed per client IP per 10 minutes before it's throttled |

Serve the app over HTTPS in any shared deployment: the team ID in the URL and
the PR publisher token are both credentials.

The Docker image runs as the unprivileged `node` user. When started as root it
first takes ownership of the database directory, so volumes created by older
images keep working.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Express, WebSocket (ws)
- **Database**: SQLite (better-sqlite3)
