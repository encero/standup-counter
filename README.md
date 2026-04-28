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
```

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
node server/index.js
```

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Express, WebSocket (ws)
- **Database**: SQLite (better-sqlite3)
