'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'worldcup.db');
const JWT_SECRET = process.env.JWT_SECRET || 'wc2026-secret-change-in-prod';
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY || '';
const FOOTBALL_API_BASE = 'https://api.football-data.org/v4';
const COMPETITION_CODE = 'WC';
const SEASON = 2026;

// Submission window closes at kickoff of the first group stage match
const SUBMISSION_DEADLINE = process.env.SUBMISSION_DEADLINE || '2026-06-11T18:00:00.000Z';

const ADMINS = [
  { email: (process.env.ADMIN1_EMAIL || '').toLowerCase(), password: process.env.ADMIN1_PASSWORD || '' },
  { email: (process.env.ADMIN2_EMAIL || '').toLowerCase(), password: process.env.ADMIN2_PASSWORD || '' },
].filter(a => a.email && a.password);

// ─── Scoring Constants ──────────────────────────────────────────────────────────
const KO_ROUND_PTS = { R32: 1, R16: 2, QF: 4, SF: 8, '3RD': 20, FINAL: 16 };
const CHAMPION_BONUS = 32;

// ─── Team Name Normalization ────────────────────────────────────────────────────
const TEAM_ALIASES = {
  'South Korea': 'Korea Republic',
  'Republic of Korea': 'Korea Republic',
  "Côte d'Ivoire": 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
  'Ivory Coast': 'Ivory Coast',
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'Bosnia & Herzegovina': 'Bosnia & Herz.',
  'Turkey': 'Turkiye',
  'Democratic Republic of Congo': 'DR Congo',
  'Congo DR': 'DR Congo',
  'Cabo Verde': 'Cape Verde',
  'United States of America': 'United States',
  'USA': 'United States',
  'USA U23': 'United States',
  'New Zealand': 'New Zealand',
  'Aotearoa New Zealand': 'New Zealand',
};

function normTeam(name) {
  if (!name) return '';
  return TEAM_ALIASES[name] || name;
}

// ─── Match Schedule (hardcoded) ─────────────────────────────────────────────────
const GROUP_MATCHES = [
  // Group A – Mexico, South Africa, Korea Republic, Czechia
  { id: 1,  group: 'A', date: '2026-06-11', home: 'Mexico',          away: 'South Africa' },
  { id: 2,  group: 'A', date: '2026-06-11', home: 'Korea Republic',  away: 'Czechia' },
  { id: 3,  group: 'A', date: '2026-06-18', home: 'Czechia',         away: 'South Africa' },
  { id: 4,  group: 'A', date: '2026-06-18', home: 'Mexico',          away: 'Korea Republic' },
  { id: 5,  group: 'A', date: '2026-06-24', home: 'Czechia',         away: 'Mexico' },
  { id: 6,  group: 'A', date: '2026-06-24', home: 'South Africa',    away: 'Korea Republic' },
  // Group B – Canada, Bosnia & Herz., Qatar, Switzerland
  { id: 7,  group: 'B', date: '2026-06-12', home: 'Canada',          away: 'Bosnia & Herz.' },
  { id: 8,  group: 'B', date: '2026-06-13', home: 'Qatar',           away: 'Switzerland' },
  { id: 9,  group: 'B', date: '2026-06-18', home: 'Switzerland',     away: 'Bosnia & Herz.' },
  { id: 10, group: 'B', date: '2026-06-18', home: 'Canada',          away: 'Qatar' },
  { id: 11, group: 'B', date: '2026-06-24', home: 'Switzerland',     away: 'Canada' },
  { id: 12, group: 'B', date: '2026-06-24', home: 'Bosnia & Herz.',  away: 'Qatar' },
  // Group C – Brazil, Morocco, Haiti, Scotland
  { id: 13, group: 'C', date: '2026-06-13', home: 'Brazil',          away: 'Morocco' },
  { id: 14, group: 'C', date: '2026-06-13', home: 'Haiti',           away: 'Scotland' },
  { id: 15, group: 'C', date: '2026-06-19', home: 'Scotland',        away: 'Morocco' },
  { id: 16, group: 'C', date: '2026-06-19', home: 'Brazil',          away: 'Haiti' },
  { id: 17, group: 'C', date: '2026-06-24', home: 'Scotland',        away: 'Brazil' },
  { id: 18, group: 'C', date: '2026-06-24', home: 'Morocco',         away: 'Haiti' },
  // Group D – United States, Paraguay, Australia, Turkiye
  { id: 19, group: 'D', date: '2026-06-12', home: 'United States',   away: 'Paraguay' },
  { id: 20, group: 'D', date: '2026-06-13', home: 'Australia',       away: 'Turkiye' },
  { id: 21, group: 'D', date: '2026-06-19', home: 'United States',   away: 'Australia' },
  { id: 22, group: 'D', date: '2026-06-19', home: 'Turkiye',         away: 'Paraguay' },
  { id: 23, group: 'D', date: '2026-06-25', home: 'Turkiye',         away: 'United States' },
  { id: 24, group: 'D', date: '2026-06-25', home: 'Paraguay',        away: 'Australia' },
  // Group E – Germany, Curacao, Ivory Coast, Ecuador
  { id: 25, group: 'E', date: '2026-06-14', home: 'Germany',         away: 'Curacao' },
  { id: 26, group: 'E', date: '2026-06-14', home: 'Ivory Coast',     away: 'Ecuador' },
  { id: 27, group: 'E', date: '2026-06-20', home: 'Germany',         away: 'Ivory Coast' },
  { id: 28, group: 'E', date: '2026-06-20', home: 'Ecuador',         away: 'Curacao' },
  { id: 29, group: 'E', date: '2026-06-25', home: 'Curacao',         away: 'Ivory Coast' },
  { id: 30, group: 'E', date: '2026-06-25', home: 'Ecuador',         away: 'Germany' },
  // Group F – Netherlands, Japan, Sweden, Tunisia
  { id: 31, group: 'F', date: '2026-06-14', home: 'Netherlands',     away: 'Japan' },
  { id: 32, group: 'F', date: '2026-06-14', home: 'Sweden',          away: 'Tunisia' },
  { id: 33, group: 'F', date: '2026-06-20', home: 'Netherlands',     away: 'Sweden' },
  { id: 34, group: 'F', date: '2026-06-20', home: 'Tunisia',         away: 'Japan' },
  { id: 35, group: 'F', date: '2026-06-25', home: 'Japan',           away: 'Sweden' },
  { id: 36, group: 'F', date: '2026-06-25', home: 'Tunisia',         away: 'Netherlands' },
  // Group G – Belgium, Egypt, Iran, New Zealand
  { id: 37, group: 'G', date: '2026-06-15', home: 'Belgium',         away: 'Egypt' },
  { id: 38, group: 'G', date: '2026-06-15', home: 'Iran',            away: 'New Zealand' },
  { id: 39, group: 'G', date: '2026-06-21', home: 'Belgium',         away: 'Iran' },
  { id: 40, group: 'G', date: '2026-06-21', home: 'New Zealand',     away: 'Egypt' },
  { id: 41, group: 'G', date: '2026-06-26', home: 'Egypt',           away: 'Iran' },
  { id: 42, group: 'G', date: '2026-06-26', home: 'New Zealand',     away: 'Belgium' },
  // Group H – Spain, Cape Verde, Saudi Arabia, Uruguay
  { id: 43, group: 'H', date: '2026-06-15', home: 'Spain',           away: 'Cape Verde' },
  { id: 44, group: 'H', date: '2026-06-15', home: 'Saudi Arabia',    away: 'Uruguay' },
  { id: 45, group: 'H', date: '2026-06-21', home: 'Spain',           away: 'Saudi Arabia' },
  { id: 46, group: 'H', date: '2026-06-21', home: 'Uruguay',         away: 'Cape Verde' },
  { id: 47, group: 'H', date: '2026-06-26', home: 'Cape Verde',      away: 'Saudi Arabia' },
  { id: 48, group: 'H', date: '2026-06-26', home: 'Uruguay',         away: 'Spain' },
  // Group I – France, Senegal, Iraq, Norway
  { id: 49, group: 'I', date: '2026-06-16', home: 'France',          away: 'Senegal' },
  { id: 50, group: 'I', date: '2026-06-16', home: 'Iraq',            away: 'Norway' },
  { id: 51, group: 'I', date: '2026-06-22', home: 'France',          away: 'Iraq' },
  { id: 52, group: 'I', date: '2026-06-22', home: 'Norway',          away: 'Senegal' },
  { id: 53, group: 'I', date: '2026-06-26', home: 'Norway',          away: 'France' },
  { id: 54, group: 'I', date: '2026-06-26', home: 'Senegal',         away: 'Iraq' },
  // Group J – Argentina, Algeria, Austria, Jordan
  { id: 55, group: 'J', date: '2026-06-16', home: 'Argentina',       away: 'Algeria' },
  { id: 56, group: 'J', date: '2026-06-16', home: 'Austria',         away: 'Jordan' },
  { id: 57, group: 'J', date: '2026-06-22', home: 'Argentina',       away: 'Austria' },
  { id: 58, group: 'J', date: '2026-06-22', home: 'Jordan',          away: 'Algeria' },
  { id: 59, group: 'J', date: '2026-06-27', home: 'Jordan',          away: 'Argentina' },
  { id: 60, group: 'J', date: '2026-06-27', home: 'Algeria',         away: 'Austria' },
  // Group K – Portugal, DR Congo, Uzbekistan, Colombia
  { id: 61, group: 'K', date: '2026-06-17', home: 'Portugal',        away: 'DR Congo' },
  { id: 62, group: 'K', date: '2026-06-17', home: 'Uzbekistan',      away: 'Colombia' },
  { id: 63, group: 'K', date: '2026-06-23', home: 'Portugal',        away: 'Uzbekistan' },
  { id: 64, group: 'K', date: '2026-06-23', home: 'Colombia',        away: 'DR Congo' },
  { id: 65, group: 'K', date: '2026-06-27', home: 'Colombia',        away: 'Portugal' },
  { id: 66, group: 'K', date: '2026-06-27', home: 'DR Congo',        away: 'Uzbekistan' },
  // Group L – England, Croatia, Ghana, Panama
  { id: 67, group: 'L', date: '2026-06-17', home: 'England',         away: 'Croatia' },
  { id: 68, group: 'L', date: '2026-06-17', home: 'Ghana',           away: 'Panama' },
  { id: 69, group: 'L', date: '2026-06-23', home: 'England',         away: 'Ghana' },
  { id: 70, group: 'L', date: '2026-06-23', home: 'Panama',          away: 'Croatia' },
  { id: 71, group: 'L', date: '2026-06-27', home: 'Panama',          away: 'England' },
  { id: 72, group: 'L', date: '2026-06-27', home: 'Croatia',         away: 'Ghana' },
];

// Knockout bracket structure (teams are TBD until groups complete)
// Seeds use group+position notation: A1=group A winner, 3rd=qualifying 3rd-place team
const KO_MATCHES = [
  // Round of 32 (Jun 28 – Jul 1)
  { id: 73,  round: 'R32',   slot: 'A2 v B2',  date: '2026-06-28', feeds_from: [] },
  { id: 74,  round: 'R32',   slot: 'E1 v 3rd', date: '2026-06-28', feeds_from: [] },
  { id: 75,  round: 'R32',   slot: 'F1 v C2',  date: '2026-06-28', feeds_from: [] },
  { id: 76,  round: 'R32',   slot: 'C1 v F2',  date: '2026-06-28', feeds_from: [] },
  { id: 77,  round: 'R32',   slot: 'I1 v 3rd', date: '2026-06-29', feeds_from: [] },
  { id: 78,  round: 'R32',   slot: 'E2 v I2',  date: '2026-06-29', feeds_from: [] },
  { id: 79,  round: 'R32',   slot: 'A1 v 3rd', date: '2026-06-29', feeds_from: [] },
  { id: 80,  round: 'R32',   slot: 'L1 v 3rd', date: '2026-06-29', feeds_from: [] },
  { id: 81,  round: 'R32',   slot: 'D1 v 3rd', date: '2026-06-30', feeds_from: [] },
  { id: 82,  round: 'R32',   slot: 'G1 v 3rd', date: '2026-06-30', feeds_from: [] },
  { id: 83,  round: 'R32',   slot: 'K1 v D2',  date: '2026-06-30', feeds_from: [] },
  { id: 84,  round: 'R32',   slot: 'H1 v J2',  date: '2026-06-30', feeds_from: [] },
  { id: 85,  round: 'R32',   slot: 'B1 v 3rd', date: '2026-07-01', feeds_from: [] },
  { id: 86,  round: 'R32',   slot: 'J1 v H2',  date: '2026-07-01', feeds_from: [] },
  { id: 87,  round: 'R32',   slot: 'K2 v L2',  date: '2026-07-01', feeds_from: [] },
  { id: 88,  round: 'R32',   slot: 'G2 v B2',  date: '2026-07-01', feeds_from: [] },
  // Round of 16 (Jul 2–5)
  { id: 89,  round: 'R16',   slot: 'W73 v W74', date: '2026-07-02', feeds_from: [73, 74] },
  { id: 90,  round: 'R16',   slot: 'W75 v W76', date: '2026-07-02', feeds_from: [75, 76] },
  { id: 91,  round: 'R16',   slot: 'W77 v W78', date: '2026-07-03', feeds_from: [77, 78] },
  { id: 92,  round: 'R16',   slot: 'W79 v W80', date: '2026-07-03', feeds_from: [79, 80] },
  { id: 93,  round: 'R16',   slot: 'W81 v W82', date: '2026-07-04', feeds_from: [81, 82] },
  { id: 94,  round: 'R16',   slot: 'W83 v W84', date: '2026-07-04', feeds_from: [83, 84] },
  { id: 95,  round: 'R16',   slot: 'W85 v W86', date: '2026-07-05', feeds_from: [85, 86] },
  { id: 96,  round: 'R16',   slot: 'W87 v W88', date: '2026-07-05', feeds_from: [87, 88] },
  // Quarter-finals (Jul 6–7)
  { id: 97,  round: 'QF',    slot: 'W89 v W90', date: '2026-07-06', feeds_from: [89, 90] },
  { id: 98,  round: 'QF',    slot: 'W91 v W92', date: '2026-07-06', feeds_from: [91, 92] },
  { id: 99,  round: 'QF',    slot: 'W93 v W94', date: '2026-07-07', feeds_from: [93, 94] },
  { id: 100, round: 'QF',    slot: 'W95 v W96', date: '2026-07-07', feeds_from: [95, 96] },
  // Semi-finals (Jul 11–12)
  { id: 101, round: 'SF',    slot: 'W97 v W98',   date: '2026-07-11', feeds_from: [97, 98] },
  { id: 102, round: 'SF',    slot: 'W99 v W100',  date: '2026-07-12', feeds_from: [99, 100] },
  // 3rd place (Jul 18)
  { id: 103, round: '3RD',   slot: 'L101 v L102', date: '2026-07-18', feeds_from: [101, 102] },
  // Final (Jul 19)
  { id: 104, round: 'FINAL', slot: 'W101 v W102', date: '2026-07-19', feeds_from: [101, 102] },
];

// API stage → internal round mapping
const API_STAGE_MAP = {
  GROUP_STAGE: 'GS',
  ROUND_OF_32: 'R32',
  ROUND_OF_16: 'R16',
  QUARTER_FINAL: 'QF',
  SEMI_FINAL: 'SF',
  THIRD_PLACE: '3RD',
  FINAL: 'FINAL',
};

// ─── Database ───────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id          INTEGER PRIMARY KEY,
      round       TEXT NOT NULL,
      group_name  TEXT,
      slot        TEXT,
      match_date  TEXT NOT NULL,
      home_team   TEXT NOT NULL DEFAULT 'TBD',
      away_team   TEXT NOT NULL DEFAULT 'TBD',
      home_score  INTEGER,
      away_score  INTEGER,
      pen_winner  TEXT,
      status      TEXT NOT NULL DEFAULT 'SCHEDULED',
      api_id      INTEGER,
      manual      INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS players (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      gs_submitted  INTEGER NOT NULL DEFAULT 0,
      gs_submitted_at TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      home_score    INTEGER NOT NULL,
      away_score    INTEGER NOT NULL,
      pen_winner    TEXT,
      submitted_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(player_id, match_id)
    );

    CREATE TABLE IF NOT EXISTS player_points (
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      points     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(player_id, match_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed group stage matches
  const insertMatch = db.prepare(`
    INSERT OR IGNORE INTO matches (id, round, group_name, match_date, home_team, away_team)
    VALUES (?, 'GS', ?, ?, ?, ?)
  `);
  for (const m of GROUP_MATCHES) {
    insertMatch.run(m.id, m.group, m.date, m.home, m.away);
  }

  // Seed knockout match shells
  const insertKO = db.prepare(`
    INSERT OR IGNORE INTO matches (id, round, slot, match_date)
    VALUES (?, ?, ?, ?)
  `);
  for (const m of KO_MATCHES) {
    insertKO.run(m.id, m.round, m.slot, m.date);
  }
}

initDB();

// ─── Scoring Logic ──────────────────────────────────────────────────────────────
function scoreGroupMatch(predHome, predAway, actualHome, actualAway) {
  if (predHome == null || predAway == null) return 0;
  if (actualHome == null || actualAway == null) return 0;

  const predOutcome = Math.sign(predHome - predAway);
  const actualOutcome = Math.sign(actualHome - actualAway);

  if (predOutcome !== actualOutcome) return 0;
  if (predHome === actualHome && predAway === actualAway) return 5;
  if ((predHome - predAway) === (actualHome - actualAway)) return 3;
  return 2;
}

function matchWinner(match) {
  if (match.home_score == null) return null;
  if (match.home_score > match.away_score) return match.home_team;
  if (match.away_score > match.home_score) return match.away_team;
  return match.pen_winner || null;
}

function predictedWinner(pred, match) {
  if (pred.home_score > pred.away_score) return match.home_team;
  if (pred.away_score > pred.home_score) return match.away_team;
  return pred.pen_winner || null;
}

function recalculateMatchPoints(matchId) {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match || match.status !== 'FINISHED') return;

  const preds = db.prepare('SELECT * FROM predictions WHERE match_id = ?').all(matchId);
  const upsert = db.prepare(`
    INSERT INTO player_points (player_id, match_id, points) VALUES (?, ?, ?)
    ON CONFLICT(player_id, match_id) DO UPDATE SET points = excluded.points
  `);

  for (const pred of preds) {
    let pts = 0;
    if (match.round === 'GS') {
      pts = scoreGroupMatch(pred.home_score, pred.away_score, match.home_score, match.away_score);
    } else {
      const actualW = matchWinner(match);
      const predW = predictedWinner(pred, match);
      if (actualW && predW && actualW === predW) {
        pts = KO_ROUND_PTS[match.round] || 0;
        if (match.round === 'FINAL') pts += CHAMPION_BONUS;
      }
    }
    upsert.run(pred.player_id, matchId, pts);
  }
}

// Recalculate all points (used after admin result changes)
function recalculateAll() {
  const finished = db.prepare("SELECT id FROM matches WHERE status = 'FINISHED'").all();
  for (const m of finished) recalculateMatchPoints(m.id);
}

// ─── football-data.org Sync ─────────────────────────────────────────────────────
let lastSyncAt = null;

async function syncFromAPI() {
  if (!FOOTBALL_API_KEY) return;
  try {
    const res = await axios.get(
      `${FOOTBALL_API_BASE}/competitions/${COMPETITION_CODE}/matches`,
      {
        headers: { 'X-Auth-Token': FOOTBALL_API_KEY },
        params: { season: SEASON },
        timeout: 15000,
      }
    );

    const apiMatches = res.data.matches || [];
    lastSyncAt = new Date().toISOString();

    for (const am of apiMatches) {
      const homeTeam = normTeam(am.homeTeam?.name || '');
      const awayTeam = normTeam(am.awayTeam?.name || '');
      const apiId = am.id;
      const status = am.status;
      const apiRound = API_STAGE_MAP[am.stage] || null;

      // Find internal match: first by api_id, then by teams (for GS)
      let dbMatch = db.prepare('SELECT * FROM matches WHERE api_id = ?').get(apiId);

      if (!dbMatch && apiRound === 'GS' && homeTeam && awayTeam) {
        dbMatch = db.prepare(
          'SELECT * FROM matches WHERE home_team = ? AND away_team = ? AND round = ?'
        ).get(homeTeam, awayTeam, 'GS');
        if (dbMatch) db.prepare('UPDATE matches SET api_id = ? WHERE id = ?').run(apiId, dbMatch.id);
      }

      // For KO rounds, link to our pre-created shells or create new
      if (!dbMatch && apiRound && apiRound !== 'GS' && homeTeam && homeTeam !== 'TBD') {
        // Try to find an unlinked shell in the right round with TBD teams
        dbMatch = db.prepare(`
          SELECT * FROM matches WHERE round = ? AND api_id IS NULL AND home_team = 'TBD' LIMIT 1
        `).get(apiRound);
        if (dbMatch) db.prepare('UPDATE matches SET api_id = ? WHERE id = ?').run(apiId, dbMatch.id);
      }

      if (!dbMatch) continue;
      if (dbMatch.manual) continue; // Don't override manual entries

      // Update team names for KO rounds once known
      if (homeTeam && awayTeam && homeTeam !== 'TBD' && awayTeam !== 'TBD') {
        db.prepare('UPDATE matches SET home_team = ?, away_team = ? WHERE id = ?')
          .run(homeTeam, awayTeam, dbMatch.id);
      }

      if (status === 'FINISHED') {
        const hs = am.score?.fullTime?.home ?? null;
        const as = am.score?.fullTime?.away ?? null;
        let penWinner = null;
        const penScore = am.score?.penalties;
        if (penScore?.home != null) {
          penWinner = penScore.home > penScore.away
            ? normTeam(am.homeTeam.name)
            : normTeam(am.awayTeam.name);
        }

        db.prepare(`
          UPDATE matches
          SET home_score = ?, away_score = ?, pen_winner = ?,
              status = 'FINISHED', updated_at = datetime('now')
          WHERE id = ?
        `).run(hs, as, penWinner, dbMatch.id);

        recalculateMatchPoints(dbMatch.id);
      } else {
        db.prepare("UPDATE matches SET status = ? WHERE id = ? AND status != 'FINISHED'")
          .run(status, dbMatch.id);
      }
    }

    console.log(`[sync] API sync complete at ${lastSyncAt}, ${apiMatches.length} matches processed`);
  } catch (err) {
    console.error('[sync] Error:', err.message);
  }
}

// Poll every 5 minutes
cron.schedule('*/5 * * * *', syncFromAPI);
// Also sync at startup (non-blocking)
setTimeout(syncFromAPI, 3000);

// ─── Express App ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ─────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.admin) return res.status(403).json({ error: 'Forbidden' });
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────
function isSubmissionOpen() {
  return new Date() < new Date(SUBMISSION_DEADLINE);
}

function getLeaderboard() {
  const players = db.prepare(`
    SELECT p.id, p.name, p.email,
           COALESCE(SUM(pp.points), 0) AS total_points,
           COALESCE(SUM(CASE WHEN m.round = 'GS' THEN pp.points ELSE 0 END), 0) AS gs_points,
           COALESCE(SUM(CASE WHEN m.round != 'GS' THEN pp.points ELSE 0 END), 0) AS ko_points
    FROM players p
    LEFT JOIN player_points pp ON pp.player_id = p.id
    LEFT JOIN matches m ON m.id = pp.match_id
    WHERE p.gs_submitted = 1
    GROUP BY p.id
    ORDER BY total_points DESC, gs_points DESC, p.name ASC
  `).all();

  return players.map((p, i) => ({ ...p, rank: i + 1, email: undefined }));
}

function getPlayerDetail(playerId) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return null;

  const preds = db.prepare(`
    SELECT p.*, m.round, m.group_name, m.home_team, m.away_team,
           m.home_score AS actual_home, m.away_score AS actual_away,
           m.pen_winner AS actual_pen, m.status, m.slot,
           COALESCE(pp.points, 0) AS points
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    LEFT JOIN player_points pp ON pp.player_id = p.player_id AND pp.match_id = p.match_id
    WHERE p.player_id = ?
    ORDER BY m.id
  `).all(playerId);

  const total = preds.reduce((s, p) => s + p.points, 0);

  return { player: { id: player.id, name: player.name, email: player.email }, predictions: preds, total };
}

// ─── Public Routes ───────────────────────────────────────────────────────────────

// Status / health
app.get('/api/status', (req, res) => {
  const matchCount = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE status = ?').get('FINISHED').n;
  const playerCount = db.prepare('SELECT COUNT(*) AS n FROM players WHERE gs_submitted = 1').get().n;
  res.json({
    submissionOpen: isSubmissionOpen(),
    deadline: SUBMISSION_DEADLINE,
    matchesFinished: matchCount,
    players: playerCount,
    lastSync: lastSyncAt,
    apiConfigured: !!FOOTBALL_API_KEY,
  });
});

// All matches (schedule + results)
app.get('/api/matches', (req, res) => {
  const matches = db.prepare('SELECT * FROM matches ORDER BY id').all();
  res.json(matches);
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json(getLeaderboard());
});

// Check if email already submitted (for duplicate prevention UI)
app.get('/api/check-email', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required' });
  const player = db.prepare('SELECT id, name, gs_submitted FROM players WHERE email = ?').get(email);
  res.json({ exists: !!player, submitted: player?.gs_submitted === 1, name: player?.name || null });
});

// Player score lookup (by email)
app.get('/api/my-score', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required' });
  const player = db.prepare('SELECT * FROM players WHERE email = ?').get(email);
  if (!player) return res.status(404).json({ error: 'Not found' });
  res.json(getPlayerDetail(player.id));
});

// Submit group stage predictions
app.post('/api/submit/group', (req, res) => {
  if (!isSubmissionOpen()) {
    return res.status(403).json({ error: 'Submission window is closed.' });
  }

  const { name, email, predictions } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });
  if (!Array.isArray(predictions) || predictions.length !== 72) {
    return res.status(400).json({ error: 'All 72 group stage predictions are required.' });
  }

  const emailClean = email.trim().toLowerCase();

  // Validate scores
  for (const p of predictions) {
    if (!Number.isInteger(p.home_score) || !Number.isInteger(p.away_score)) {
      return res.status(400).json({ error: `Invalid score for match ${p.match_id}` });
    }
    if (p.home_score < 0 || p.away_score < 0 || p.home_score > 20 || p.away_score > 20) {
      return res.status(400).json({ error: `Score out of range for match ${p.match_id}` });
    }
    if (p.match_id < 1 || p.match_id > 72) {
      return res.status(400).json({ error: `Invalid match_id ${p.match_id}` });
    }
  }

  const submitTx = db.transaction(() => {
    // Upsert player (allow name update; block re-submission)
    let player = db.prepare('SELECT * FROM players WHERE email = ?').get(emailClean);
    if (player && player.gs_submitted) {
      throw new Error('ALREADY_SUBMITTED');
    }
    if (!player) {
      const result = db.prepare(
        'INSERT INTO players (name, email) VALUES (?, ?)'
      ).run(name.trim(), emailClean);
      player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
    } else {
      db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name.trim(), player.id);
    }

    // Insert predictions
    const insertPred = db.prepare(`
      INSERT OR REPLACE INTO predictions (player_id, match_id, home_score, away_score)
      VALUES (?, ?, ?, ?)
    `);
    for (const p of predictions) {
      insertPred.run(player.id, p.match_id, p.home_score, p.away_score);
    }

    // Mark group stage as submitted
    db.prepare("UPDATE players SET gs_submitted = 1, gs_submitted_at = datetime('now') WHERE id = ?")
      .run(player.id);

    // Score any already-finished matches
    const finishedGS = db.prepare("SELECT id FROM matches WHERE round = 'GS' AND status = 'FINISHED'").all();
    for (const m of finishedGS) recalculateMatchPoints(m.id);

    return player;
  });

  try {
    const player = submitTx();
    res.json({ success: true, playerId: player.id, name: player.name });
  } catch (err) {
    if (err.message === 'ALREADY_SUBMITTED') {
      return res.status(409).json({ error: 'You have already submitted your group stage predictions.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Submit a knockout round prediction
app.post('/api/submit/knockout', (req, res) => {
  const { email, match_id, home_score, away_score, pen_winner } = req.body;
  if (!email || !match_id) return res.status(400).json({ error: 'Email and match_id required.' });

  const emailClean = email.trim().toLowerCase();
  const player = db.prepare('SELECT * FROM players WHERE email = ?').get(emailClean);
  if (!player || !player.gs_submitted) {
    return res.status(403).json({ error: 'You must submit group stage predictions first.' });
  }

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id);
  if (!match || match.round === 'GS') return res.status(400).json({ error: 'Invalid match.' });
  if (match.status === 'FINISHED') return res.status(403).json({ error: 'Match already finished.' });
  if (match.home_team === 'TBD' || match.away_team === 'TBD') {
    return res.status(403).json({ error: 'Teams not yet determined for this match.' });
  }

  if (!Number.isInteger(home_score) || !Number.isInteger(away_score)) {
    return res.status(400).json({ error: 'Invalid scores.' });
  }

  // If predicted draw, penalty winner required
  if (home_score === away_score && !pen_winner) {
    return res.status(400).json({ error: 'Penalty winner required for predicted draw.' });
  }
  if (pen_winner && pen_winner !== match.home_team && pen_winner !== match.away_team) {
    return res.status(400).json({ error: 'Invalid penalty winner.' });
  }

  db.prepare(`
    INSERT OR REPLACE INTO predictions (player_id, match_id, home_score, away_score, pen_winner)
    VALUES (?, ?, ?, ?, ?)
  `).run(player.id, match_id, home_score, away_score, pen_winner || null);

  res.json({ success: true });
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admin = ADMINS.find(a => a.email === (email || '').toLowerCase() && a.password === password);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials.' });
  const token = jwt.sign({ admin: true, email: admin.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// All players & submission status
app.get('/api/admin/players', adminAuth, (req, res) => {
  const players = db.prepare(`
    SELECT p.*, COALESCE(SUM(pp.points), 0) AS total_points
    FROM players p
    LEFT JOIN player_points pp ON pp.player_id = p.id
    GROUP BY p.id
    ORDER BY total_points DESC, p.name
  `).all();
  res.json(players);
});

// All predictions for a player (admin view)
app.get('/api/admin/player/:id', adminAuth, (req, res) => {
  const detail = getPlayerDetail(parseInt(req.params.id));
  if (!detail) return res.status(404).json({ error: 'Player not found.' });
  res.json(detail);
});

// Delete a player and their predictions
app.delete('/api/admin/player/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM players WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// Get all results (admin view, includes unplayed)
app.get('/api/admin/matches', adminAuth, (req, res) => {
  const matches = db.prepare('SELECT * FROM matches ORDER BY id').all();
  res.json(matches);
});

// Manually set a match result
app.put('/api/admin/match/:id', adminAuth, (req, res) => {
  const matchId = parseInt(req.params.id);
  const { home_score, away_score, pen_winner, status } = req.body;

  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!match) return res.status(404).json({ error: 'Match not found.' });

  const newStatus = status || (home_score != null ? 'FINISHED' : match.status);

  db.prepare(`
    UPDATE matches SET home_score = ?, away_score = ?, pen_winner = ?,
      status = ?, manual = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    home_score ?? match.home_score,
    away_score ?? match.away_score,
    pen_winner ?? match.pen_winner,
    newStatus,
    matchId
  );

  if (newStatus === 'FINISHED') recalculateMatchPoints(matchId);

  res.json({ success: true });
});

// Clear a manual override (let API take over again)
app.delete('/api/admin/match/:id/override', adminAuth, (req, res) => {
  db.prepare('UPDATE matches SET manual = 0 WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// Update KO match teams (when admin knows who plays who before API updates)
app.put('/api/admin/match/:id/teams', adminAuth, (req, res) => {
  const { home_team, away_team } = req.body;
  if (!home_team || !away_team) return res.status(400).json({ error: 'Both teams required.' });
  db.prepare('UPDATE matches SET home_team = ?, away_team = ? WHERE id = ?')
    .run(home_team, away_team, parseInt(req.params.id));
  res.json({ success: true });
});

// Trigger manual API sync
app.post('/api/admin/sync', adminAuth, async (req, res) => {
  await syncFromAPI();
  res.json({ success: true, lastSync: lastSyncAt });
});

// Recalculate all scores (safety net)
app.post('/api/admin/recalculate', adminAuth, (req, res) => {
  recalculateAll();
  res.json({ success: true });
});

// ─── Catch-all: serve index.html for any non-API route ──────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] World Cup Predictor running on port ${PORT}`);
  console.log(`[server] Submission deadline: ${SUBMISSION_DEADLINE}`);
  console.log(`[server] Admins configured: ${ADMINS.length}`);
  console.log(`[server] API key: ${FOOTBALL_API_KEY ? 'SET' : 'NOT SET (admin-only mode)'}`);
});
