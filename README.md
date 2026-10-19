# World Cup 2026 Predictor

A prediction game for the FIFA World Cup 2026, built for a group of friends. Before the tournament kicks off, each player predicts the whole tournament in one go: the score of all 72 group-stage matches and the winner of every knockout match, 104 picks in all. Once games start, results sync in automatically and a live leaderboard tracks who called it best.

## How it works

1. **Submit a bracket.** Enter your name and email, predict every group-stage score, then pick a winner for each knockout match from the Round of 32 to the Final. All 104 picks are submitted together, and submissions close at kickoff (June 11, 2026, by default).
2. **Results come in.** The server pulls scores from [football-data.org](https://www.football-data.org) every 5 minutes. Admins can also enter or correct results by hand.
3. **Points add up.** Look yourself up by email under **My Score**, or check the **Leaderboard** and the **Bracket** view.

## Scoring

**Group stage**, per match:

| Your prediction | Points |
|---|---|
| Exact score | 5 |
| Right winner (or draw) and the same goal difference | 3 |
| Right winner (or draw) | 2 |
| Wrong outcome | 0 |

**Knockout rounds:** points for each team you picked to win a match in that round that actually won one.

| Round | Points per correct team |
|---|---|
| Round of 32 | 1 |
| Round of 16 | 2 |
| Quarter-finals | 4 |
| Semi-finals | 8 |
| Final | 16 |
| Third-place match | 20 |
| **Champion bonus** | **+32** for picking the winner of the Final |

## Features

- Single-page app with five tabs: Submit, Bracket, Leaderboard, My Score and Admin
- Automatic result sync from football-data.org on a 5-minute schedule
- Admin panel (two admin accounts, JWT login): view and delete players, enter or override match results, set knockout teams, trigger a sync, and recalculate scores
- SQLite storage, which persists across deploys when the database sits on a mounted volume

## Tech stack

- **Server:** Node.js and Express (`server.js`), with better-sqlite3, node-cron, axios and jsonwebtoken
- **Front end:** one HTML file (`public/index.html`) with vanilla JavaScript
- **Hosting:** [Railway](https://railway.app), with a persistent volume at `/data` (see `railway.toml`)

## Run it locally

Needs Node.js 18 or later (Railway runs Node 20).

```bash
npm install
cp .env.example .env    # then fill in the values
npm start               # or: npm run dev, which restarts on changes
```

Open http://localhost:3000, and http://localhost:3000/#admin for the admin panel.

### Configuration

Set these in `.env` locally or as service variables on your host:

| Variable | What it's for |
|---|---|
| `FOOTBALL_API_KEY` | football-data.org API key (the free tier is enough) |
| `ADMIN1_EMAIL`, `ADMIN1_PASSWORD` | First admin login |
| `ADMIN2_EMAIL`, `ADMIN2_PASSWORD` | Second admin login |
| `JWT_SECRET` | A random string of 32 or more characters for signing admin sessions |
| `DB_PATH` | SQLite file path: `./worldcup.db` locally, `/data/worldcup.db` on Railway |
| `SUBMISSION_DEADLINE` | Optional. ISO 8601 UTC time when submissions close (default `2026-06-11T18:00:00.000Z`) |

Never commit your `.env` file; it's already in `.gitignore`.

## Deploying

[`DEPLOY.md`](DEPLOY.md) walks through deploying to Railway: getting an API key, adding the volume, setting variables, and a checklist for testing a live deployment.

## API

| Endpoint | What it does |
|---|---|
| `GET /api/status` | Whether submissions are open and the API key is configured |
| `GET /api/matches` | All 104 matches with results |
| `GET /api/leaderboard` | Current standings |
| `GET /api/my-score?email=` | One player's points breakdown |
| `POST /api/submit` | Submit a full set of 104 predictions |
| `/api/admin/*` | Admin actions (requires the admin token) |
