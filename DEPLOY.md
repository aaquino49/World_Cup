# Deployment Guide — WC 2026 Predictor

## Current Status

As of June 8, 2026, the Railway deployment has been created, required environment variables have been added, and a persistent Volume is mounted at `/data`.

The next step is not initial deployment. The next step is live validation:

1. Visit `https://your-app.railway.app/api/status`.
2. Confirm `submissionOpen: true`.
3. Confirm `apiConfigured: true`.
4. Visit `https://your-app.railway.app/#admin` and log in.
5. Click **Sync API** in Admin.
6. Submit one complete test bracket.
7. Confirm the test player appears in Leaderboard, My Score, and Admin > Players.
8. Manually finish one group-stage match in Admin and confirm scoring updates.
9. Restart or redeploy the service and confirm the test player still exists.
10. Delete the test player after validation.

If the test player remains after restart/redeploy, the `/data` volume and `DB_PATH=/data/worldcup.db` are working correctly.

## UI Update Process

A Claude Design document is expected before the next UI pass. Once received:

1. Compare the design document against `../UI_OVERVIEW.md` and `public/index.html`.
2. Implement the agreed UI changes in `public/index.html`.
3. Preserve existing API routes, scoring, and submission behavior unless explicitly changing them.
4. Test locally, then redeploy to Railway.
5. Re-run the live validation checklist above.

## Quick Start (Railway)

### 1. Get a football-data.org API key
- Go to https://www.football-data.org/client/register
- Free tier gives you 10 req/min — plenty for our 5-min poll interval

### 2. Push to GitHub
```bash
cd "C:\Users\alexa\OneDrive\Desktop\Claude Projects\World_Cup\web-app"
git init
git add .
git commit -m "Initial commit"
# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/wc2026-predictor.git
git push -u origin main
```

### 3. Deploy on Railway
1. Go to https://railway.app → New Project → Deploy from GitHub repo
2. Select your `wc2026-predictor` repo
3. Railway auto-detects Node.js and runs `npm start`

### 4. Add a Volume (for SQLite persistence)
1. In Railway project → Add Service → Volume
2. Mount path: `/data`
3. This keeps the database alive across deploys

### 5. Set Environment Variables
In Railway → your service → Variables, add:

| Variable | Value |
|---|---|
| `FOOTBALL_API_KEY` | your football-data.org key |
| `ADMIN1_EMAIL` | alejo's email |
| `ADMIN1_PASSWORD` | strong password |
| `ADMIN2_EMAIL` | second admin email |
| `ADMIN2_PASSWORD` | strong password |
| `JWT_SECRET` | random 32+ char string |
| `DB_PATH` | `/data/worldcup.db` |
| `SUBMISSION_DEADLINE` | `2026-06-11T18:00:00.000Z` |

### 6. (Optional) Custom Domain
Railway → Settings → Domains → Add custom domain

---

## Admin Access
- Visit `https://your-app.railway.app/#admin`
- Log in with ADMIN1 or ADMIN2 credentials
- You can manually enter match results in addition to API auto-sync

## Local Development
```bash
cd web-app
npm install
cp .env.example .env
# Edit .env with your values
node server.js
# Open http://localhost:3000
```

## Scoring Reference
| Scenario | Points |
|---|---|
| Exact scoreline | 5 pts |
| Correct winner + same goal difference | 3 pts |
| Correct winner (or correct draw) | 2 pts |
| Wrong outcome | 0 pts |
| Round of 32 — correct advancing team | 1 pt |
| Round of 16 — correct advancing team | 2 pts |
| Quarter-Finals | 4 pts |
| Semi-Finals | 8 pts |
| 3rd Place Match | 20 pts |
| Final | 16 pts |
| Champion Bonus | +32 pts |
