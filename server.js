require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const NodeCache = require('node-cache');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const CLIENT_ID = process.env.YAHOO_CLIENT_ID;
const CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;
const REDIRECT_URI = process.env.YAHOO_REDIRECT_URI;
const LEAGUE_ID = process.env.YAHOO_LEAGUE_ID;

const cache = new NodeCache({ stdTTL: 300 });

const TOKEN_FILE = path.join(__dirname, 'tokens.json');
let inMemoryTokens = null;

function saveTokens(tokens) {
  inMemoryTokens = tokens;
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  } catch (e) {}
}

function loadTokens() {
  if (inMemoryTokens) return inMemoryTokens;
  if (fs.existsSync(TOKEN_FILE)) {
    inMemoryTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    return inMemoryTokens;
  }
  return null;
}

async function refreshWithToken(refreshToken) {
  const refreshRes = await axios.post(
    'https://api.login.yahoo.com/oauth2/get_token',
    new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const newTokens = {
    access_token: refreshRes.data.access_token,
    refresh_token: refreshRes.data.refresh_token || refreshToken,
    obtained_at: Date.now(),
    expires_in: refreshRes.data.expires_in,
  };
  saveTokens(newTokens);
  return newTokens;
}

app.get('/auth/yahoo', (req, res) => {
  const authUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&language=en-us&scope=fspt-r`;
  res.redirect(authUrl);
});

app.get('/auth/yahoo/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code from Yahoo.');

  try {
    const tokenRes = await axios.post(
      'https://api.login.yahoo.com/oauth2/get_token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const tokens = {
      access_token: tokenRes.data.access_token,
      refresh_token: tokenRes.data.refresh_token,
      obtained_at: Date.now(),
      expires_in: tokenRes.data.expires_in,
    };
    saveTokens(tokens);

    res.send(`
      <div style="font-family: sans-serif; max-width: 600px; margin: 40px auto; line-height: 1.6;">
        <h2>&#9989; Yahoo connected successfully!</h2>
        <p><strong>One-time setup step:</strong> to make this survive server restarts, copy the value below
        and add it as an environment variable in Render named <code>YAHOO_REFRESH_TOKEN</code>.</p>
        <p>Go to your Render dashboard &rarr; this service &rarr; Environment &rarr; Add Environment Variable.</p>
        <div style="background:#f4f4f4; padding:12px; border-radius:6px; word-break:break-all; font-family:monospace; font-size:13px;">
          ${tokens.refresh_token}
        </div>
        <p style="margin-top:20px; color:#666; font-size:14px;">Once you save that in Render, this connection will survive redeploys automatically &mdash; you won't need to do this again.</p>
      </div>
    `);
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err.message);
    res.status(500).send('Something went wrong connecting to Yahoo. Check server logs.');
  }
});

async function getValidAccessToken() {
  let tokens = loadTokens();

  if (!tokens && process.env.YAHOO_REFRESH_TOKEN) {
    tokens = await refreshWithToken(process.env.YAHOO_REFRESH_TOKEN);
  }

  if (!tokens) {
    throw new Error('Yahoo is not connected yet. Visit /auth/yahoo first.');
  }

  const ageSeconds = (Date.now() - tokens.obtained_at) / 1000;
  const isExpired = ageSeconds > tokens.expires_in - 60;

  if (!isExpired) return tokens.access_token;

  const refreshed = await refreshWithToken(tokens.refresh_token);
  return refreshed.access_token;
}

async function yahooGet(endpoint) {
  const accessToken = await getValidAccessToken();
  const url = `https://fantasysports.yahooapis.com/fantasy/v2/${endpoint}?format=json`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data;
}

// Retries with backoff, and a small pause even on success \u2014 used only in
// the big player-stats job, which makes thousands of rapid calls and is
// the one place we've seen Yahoo silently rate-limit and drop requests.
async function yahooGetWithRetry(endpoint, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await yahooGet(endpoint);
      await new Promise((r) => setTimeout(r, 120));
      return result;
    } catch (e) {
      if (attempt === retries) throw e;
      const status = e.response?.status;
      const backoff = status === 429 || status === 999 ? 2500 : 500;
      await new Promise((r) => setTimeout(r, backoff * (attempt + 1)));
    }
  }
}

// Yahoo's arrays mix real data objects with empty-array placeholders —
// this merges all the real objects in an array into one flat lookup.
function flattenMeta(arr) {
  const result = {};
  arr.forEach((item) => {
    if (!Array.isArray(item)) Object.assign(result, item);
  });
  return result;
}

app.get('/api/status', async (req, res) => {
  try {
    await getValidAccessToken();
    res.json({ connected: true });
  } catch {
    res.json({ connected: false });
  }
});

app.get('/api/gamekey', async (req, res) => {
  try {
    const data = await yahooGet('game/nfl');
    res.json(data);
  } catch (err) {
    console.error('Game key lookup failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to look up game key. Make sure /auth/yahoo has been completed.' });
  }
});

// --- Look up the NFL game_key for a SPECIFIC past season (needed to
// build a league_key for any older/unlinked league) ---
app.get('/api/gamekey-for-season', async (req, res) => {
  const { season } = req.query;
  if (!season) return res.status(400).json({ error: 'Provide ?season=YYYY' });
  const cacheKey = `gamekey-${season}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await yahooGet(`games;game_codes=nfl;seasons=${season}`);
    cache.set(cacheKey, data, 86400); // game keys never change, cache a full day
    res.json(data);
  } catch (err) {
    console.error('Season game key lookup failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to look up game key for that season.' });
  }
});

app.get('/api/standings', async (req, res) => {
  const cacheKey = 'standings';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const gameKey = process.env.YAHOO_GAME_KEY;
    const leagueKey = `${gameKey}.l.${LEAGUE_ID}`;
    const data = await yahooGet(`league/${leagueKey}/standings`);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error('Standings fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch standings from Yahoo.' });
  }
});

app.get('/api/settings', async (req, res) => {
  const cacheKey = 'settings';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const gameKey = process.env.YAHOO_GAME_KEY;
    const leagueKey = `${gameKey}.l.${LEAGUE_ID}`;
    const data = await yahooGet(`league/${leagueKey}/settings`);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error('Settings fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch league settings from Yahoo.' });
  }
});

app.get('/api/schedule', async (req, res) => {
  const week = req.query.week || '1';
  const cacheKey = `schedule-${week}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const gameKey = process.env.YAHOO_GAME_KEY;
    const leagueKey = `${gameKey}.l.${LEAGUE_ID}`;
    const data = await yahooGet(`league/${leagueKey}/scoreboard;week=${week}`);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error('Schedule fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch schedule from Yahoo.' });
  }
});

async function fetchDraftWithNames(leagueKey) {
  const draftData = await yahooGetWithRetry(`league/${leagueKey}/draftresults`);
  const resultsObj = draftData?.fantasy_content?.league?.[1]?.draft_results || {};
  const playerKeys = Object.keys(resultsObj)
    .filter((k) => k !== 'count')
    .map((k) => resultsObj[k].draft_result.player_key);

  const playerNames = {};
  for (let i = 0; i < playerKeys.length; i += 25) {
    const chunk = playerKeys.slice(i, i + 25);
    const playersData = await yahooGetWithRetry(`league/${leagueKey}/players;player_keys=${chunk.join(',')}`);
    const playersObj = playersData?.fantasy_content?.league?.[1]?.players || {};
    Object.keys(playersObj).forEach((k) => {
      if (k === 'count') return;
      const meta = flattenMeta(playersObj[k].player[0]);
      if (meta.player_key) {
        playerNames[meta.player_key] = meta.name?.full || meta.editorial_team_abbr || 'Unknown Player';
      }
    });
  }
  return { ...draftData, playerNames };
}

app.get('/api/draft', async (req, res) => {
  const cacheKey = 'draft';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const gameKey = process.env.YAHOO_GAME_KEY;
    const leagueKey = `${gameKey}.l.${LEAGUE_ID}`;
    const enriched = await fetchDraftWithNames(leagueKey);
    cache.set(cacheKey, enriched);
    res.json(enriched);
  } catch (err) {
    console.error('Draft results fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch draft results from Yahoo.' });
  }
});

app.get('/api/transactions', async (req, res) => {
  const cacheKey = 'transactions';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const gameKey = process.env.YAHOO_GAME_KEY;
    const leagueKey = `${gameKey}.l.${LEAGUE_ID}`;
    const data = await yahooGet(`league/${leagueKey}/transactions`);
    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error('Transactions fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch transactions from Yahoo.' });
  }
});

app.get('/api/history', async (req, res) => {
  const cacheKey = 'history';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const seasons = [];
    let currentKey = `${process.env.YAHOO_GAME_KEY}.l.${LEAGUE_ID}`;
    let safety = 0;

    while (currentKey && safety < 15) {
      safety++;
      const standingsData = await yahooGet(`league/${currentKey}/standings`);
      const leagueMeta = standingsData?.fantasy_content?.league?.[0];
      if (!leagueMeta) break;

      seasons.push({
        season: leagueMeta.season,
        league_key: currentKey,
        league_name: leagueMeta.name,
        standings: standingsData,
      });

      const renew = leagueMeta.renew;
      if (!renew) break;
      const [prevGameKey, prevLeagueId] = renew.split('_');
      if (!prevGameKey || !prevLeagueId) break;
      currentKey = `${prevGameKey}.l.${prevLeagueId}`;
    }

    cache.set(cacheKey, seasons, 3600);
    res.json(seasons);
  } catch (err) {
    console.error('History fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch league history from Yahoo.' });
  }
});

// --- Full detail (standings + draft) for ANY specific season ---
// Two ways to call it:
//   ?league_key=423.l.1146108        (when you already know the exact key)
//   ?league_id=1171203&season=2022   (resolves the game_key for that
//                                      season first, then builds the key
//                                      \u2014 needed for older/unlinked leagues)
async function fetchSeasonDetail({ league_key, league_id, season }) {
  let leagueKey = league_key;

  if (!leagueKey) {
    if (!league_id || !season) throw new Error('Provide either league_key, or both league_id and season.');
    const gameKey = await resolveGameKeyForSeason(season);
    if (!gameKey) throw new Error(`Couldn't resolve a game key for season ${season}.`);
    leagueKey = `${gameKey}.l.${league_id}`;
  }

  const standings = await yahooGetWithRetry(`league/${leagueKey}/standings`);
  let draft = null;
  try {
    draft = await fetchDraftWithNames(leagueKey);
  } catch (e) {
    // Draft results might not exist/be accessible for very old leagues — that's fine, standings still work.
  }

  let transactions = null;
  try {
    transactions = await yahooGetWithRetry(`league/${leagueKey}/transactions`);
  } catch (e) {
    // Same deal — transactions might not be pullable for very old leagues.
  }

  return { league_key: leagueKey, standings, draft, transactions };
}

app.get('/api/season-detail', async (req, res) => {
  const { league_key, league_id, season } = req.query;
  const cacheKey = `season-detail-${league_key || `${league_id}-${season}`}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const result = await fetchSeasonDetail({ league_key, league_id, season });
    cache.set(cacheKey, result, 3600);
    res.json(result);
  } catch (err) {
    console.error('Season detail fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch season detail from Yahoo.' });
  }
});

// --- Every weekly matchup, every season (2022\u20132026) ---
// This is the foundation for real Head-to-Head records, Team Points
// records, Fun facts, and the What-If schedule-swap simulator. Pulls one
// scoreboard call per week of every season (~85 calls total), so the
// first request after a cache miss can take a while \u2014 it's cached
// heavily afterward since historical seasons never change.
const ALL_SCORES_SEASONS = [
  { season: 2026, league_key: () => `${process.env.YAHOO_GAME_KEY}.l.${LEAGUE_ID}` },
  { season: 2025, league_key: () => '461.l.45789' },
  { season: 2024, league_key: () => '449.l.20860' },
  { season: 2023, league_key: () => '423.l.1146108' },
  { season: 2022, league_id: '1171203' },
];

async function resolveGameKeyForSeason(season) {
  const gameData = await yahooGet(`games;game_codes=nfl;seasons=${season}`);
  const gamesObj = gameData?.fantasy_content?.games || {};
  const gameKeyEntry = Object.keys(gamesObj).find((k) => k !== 'count');
  if (!gameKeyEntry) return null;
  const gameEntry = gamesObj[gameKeyEntry].game;
  if (Array.isArray(gameEntry)) {
    const meta = Array.isArray(gameEntry[0]) ? flattenMeta(gameEntry[0]) : flattenMeta(gameEntry);
    return meta.game_key || null;
  } else if (gameEntry && typeof gameEntry === 'object') {
    return gameEntry.game_key || null;
  }
  return null;
}

async function computeAllScores() {
  const allMatchups = [];

  for (const s of ALL_SCORES_SEASONS) {
    let leagueKey;
    try {
      leagueKey = s.league_key ? s.league_key() : null;
      if (!leagueKey) {
        const gameKey = await resolveGameKeyForSeason(s.season);
        if (!gameKey) continue;
        leagueKey = `${gameKey}.l.${s.league_id}`;
      }
    } catch (e) { continue; }

    let maxWeek = 17;
    try {
      const standingsData = await yahooGetWithRetry(`league/${leagueKey}/standings`);
      const leagueMeta = standingsData?.fantasy_content?.league?.[0];
      if (leagueMeta) {
        maxWeek = Number(leagueMeta.is_finished ? (leagueMeta.end_week || 17) : (leagueMeta.current_week || 1));
      }
    } catch (e) { /* fall back to 17 */ }

    for (let week = 1; week <= maxWeek; week++) {
      try {
        const data = await yahooGetWithRetry(`league/${leagueKey}/scoreboard;week=${week}`);
        const matchupsObj = data?.fantasy_content?.league?.[1]?.scoreboard?.[0]?.matchups;
        if (!matchupsObj) continue;
        Object.keys(matchupsObj).forEach((key) => {
          if (key === 'count') return;
          const teamsObj = matchupsObj[key].matchup[0]?.teams;
          if (!teamsObj) return;
          const t0 = teamsObj['0']?.team;
          const t1 = teamsObj['1']?.team;
          if (!t0 || !t1) return;
          const meta0 = flattenMeta(t0[0]);
          const meta1 = flattenMeta(t1[0]);
          const pts0 = Number(t0[1]?.team_points?.total) || 0;
          const pts1 = Number(t1[1]?.team_points?.total) || 0;
          if (pts0 === 0 && pts1 === 0) return; // not played yet
          allMatchups.push({
            season: s.season,
            week,
            teamA: { id: meta0.team_id, name: meta0.name, nickname: meta0.managers?.[0]?.manager?.nickname, points: pts0 },
            teamB: { id: meta1.team_id, name: meta1.name, nickname: meta1.managers?.[0]?.manager?.nickname, points: pts1 },
          });
        });
      } catch (e) { /* this week might not exist \u2014 skip it */ }
    }
  }

  return allMatchups;
}

let allScoresPromise = null;
app.get('/api/all-scores', async (req, res) => {
  const cacheKey = 'all-scores';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    if (!allScoresPromise) {
      allScoresPromise = computeAllScores().finally(() => { allScoresPromise = null; });
    }
    const allMatchups = await allScoresPromise;
    cache.set(cacheKey, allMatchups, 21600); // 6 hours \u2014 this is expensive to compute
    res.json(allMatchups);
  } catch (err) {
    console.error('All-scores fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch all-time scores from Yahoo.' });
  }
});

// --- Player-level stats (Team Stats: TDs, yards, FGs) ---
// This is a MUCH bigger pull than everything else combined: for every
// week of every season, every team's roster, every rostered player's
// individual stat line. Realistically ~2,000+ Yahoo API calls, so this
// runs as a background job (fire-and-forget, in-memory progress) rather
// than inside a single request \u2014 the frontend polls for progress.
let playerStatsJob = { status: 'idle', progress: 0, total: 0, skipped: 0, data: null, error: null };

async function runPlayerStatsJob() {
  playerStatsJob = { status: 'computing', progress: 0, total: 0, skipped: 0, data: null, error: null };
  try {
    const seasonMeta = [];
    for (const s of ALL_SCORES_SEASONS) {
      let leagueKey;
      try {
        leagueKey = s.league_key ? s.league_key() : null;
        if (!leagueKey) {
          const gameKey = await resolveGameKeyForSeason(s.season);
          if (!gameKey) continue;
          leagueKey = `${gameKey}.l.${s.league_id}`;
        }
      } catch (e) { continue; }

      let maxWeek = 17;
      try {
        const standingsData = await yahooGet(`league/${leagueKey}/standings`);
        const leagueMeta = standingsData?.fantasy_content?.league?.[0];
        if (leagueMeta) maxWeek = Number(leagueMeta.is_finished ? (leagueMeta.end_week || 17) : (leagueMeta.current_week || 1));
      } catch (e) { /* fall back to 17 */ }

      let statIdToName = {};
      try {
        const settingsData = await yahooGet(`league/${leagueKey}/settings`);
        const statCats = settingsData?.fantasy_content?.league?.[1]?.settings?.[0]?.stat_categories?.stats || {};
        Object.keys(statCats).forEach((k) => {
          if (k === 'count') return;
          const stat = statCats[k].stat;
          if (stat?.stat_id) statIdToName[stat.stat_id] = stat.display_name || stat.name;
        });
      } catch (e) { /* stat names unavailable for this season \u2014 skip it */ }

      seasonMeta.push({ season: s.season, leagueKey, maxWeek, statIdToName });
    }

    playerStatsJob.total = seasonMeta.reduce((sum, sm) => sum + sm.maxWeek * 12, 0);

    const allPlayerWeeks = [];

    for (const sm of seasonMeta) {
      for (let week = 1; week <= sm.maxWeek; week++) {
        let teams = [];
        try {
          const data = await yahooGet(`league/${sm.leagueKey}/scoreboard;week=${week}`);
          const matchupsObj = data?.fantasy_content?.league?.[1]?.scoreboard?.[0]?.matchups;
          if (matchupsObj) {
            Object.keys(matchupsObj).forEach((key) => {
              if (key === 'count') return;
              const teamsObj = matchupsObj[key].matchup[0]?.teams;
              if (!teamsObj) return;
              ['0', '1'].forEach((idx) => {
                const t = teamsObj[idx]?.team;
                if (t) {
                  const meta = flattenMeta(t[0]);
                  const pts = Number(t[1]?.team_points?.total) || 0;
                  if (pts > 0) teams.push({ team_key: meta.team_key, nickname: meta.managers?.[0]?.manager?.nickname, name: meta.name });
                }
              });
            });
          }
        } catch (e) { continue; } // this week doesn't exist \u2014 skip

        for (const tk of teams) {
          try {
            const rosterData = await yahooGetWithRetry(`team/${tk.team_key}/roster;week=${week}`);
            const playersObj = rosterData?.fantasy_content?.team?.[1]?.roster?.[0]?.players || {};
            const playerKeys = [];
            const posMap = {};
            Object.keys(playersObj).forEach((pk) => {
              if (pk === 'count') return;
              const pArr = playersObj[pk].player;
              const meta = flattenMeta(pArr[0]);
              const posInfo = flattenMeta(Array.isArray(pArr[1]) ? pArr[1] : [pArr[1]]);
              playerKeys.push(meta.player_key);
              posMap[meta.player_key] = posInfo.selected_position?.position || 'BN';
            });

            for (let i = 0; i < playerKeys.length; i += 25) {
              const chunk = playerKeys.slice(i, i + 25);
              const statsData = await yahooGetWithRetry(`league/${sm.leagueKey}/players;player_keys=${chunk.join(',')}/stats;type=week;week=${week}`);
              const statsObj = statsData?.fantasy_content?.league?.[1]?.players || {};
              Object.keys(statsObj).forEach((k) => {
                if (k === 'count') return;
                const pArr = statsObj[k].player;
                const meta = flattenMeta(pArr[0]);
                let statsBlock = {};
                let playerPoints = null;
                pArr.forEach((el, idx) => {
                  if (idx === 0) return; // meta array, already handled
                  if (el?.player_stats?.stats) statsBlock = el.player_stats.stats;
                  if (el?.player_points) playerPoints = Number(el.player_points.total) || 0;
                });
                const statLine = {};
                Object.keys(statsBlock).forEach((sk) => {
                  if (sk === 'count') return;
                  const st = statsBlock[sk].stat;
                  const name = sm.statIdToName[st.stat_id];
                  if (name) statLine[name] = Number(st.value) || 0;
                });
                allPlayerWeeks.push({
                  season: sm.season, week,
                  teamNickname: tk.nickname, teamName: tk.name,
                  playerKey: meta.player_key,
                  playerName: meta.name?.full || null,
                  position: posMap[meta.player_key] || 'BN',
                  isStarter: (posMap[meta.player_key] || 'BN') !== 'BN',
                  points: playerPoints,
                  stats: statLine,
                });
              });
            }
          } catch (e) {
            playerStatsJob.skipped++; // even after retries, this team-week couldn't be pulled
          }
          playerStatsJob.progress++;
        }
      }
    }

    playerStatsJob = { status: 'done', progress: playerStatsJob.total, total: playerStatsJob.total, skipped: playerStatsJob.skipped, data: allPlayerWeeks, error: null };
  } catch (err) {
    console.error('Player stats job failed:', err.response?.data || err.message);
    playerStatsJob = { status: 'error', progress: playerStatsJob.progress, total: playerStatsJob.total, skipped: playerStatsJob.skipped, data: null, error: err.message };
  }
}

app.get('/api/player-stats', (req, res) => {
  if (playerStatsJob.status === 'idle') {
    runPlayerStatsJob(); // fire-and-forget \u2014 runs in the background over several minutes
    return res.json({ status: 'computing', progress: 0, total: 0, skipped: 0 });
  }
  if (playerStatsJob.status === 'computing') {
    return res.json({ status: 'computing', progress: playerStatsJob.progress, total: playerStatsJob.total, skipped: playerStatsJob.skipped });
  }
  if (playerStatsJob.status === 'error') {
    return res.json({ status: 'error', error: playerStatsJob.error, skipped: playerStatsJob.skipped });
  }
  res.json({ status: 'done', data: playerStatsJob.data, skipped: playerStatsJob.skipped });
});

app.get('/api/player-stats/reset', (req, res) => {
  playerStatsJob = { status: 'idle', progress: 0, total: 0, skipped: 0, data: null, error: null };
  res.json({ status: 'idle' });
});

// --- Historical snapshot: everything for the permanently-frozen past
// seasons, bundled into one downloadable file. Meant to be fetched once
// (ideally right after a successful Team Stats run), saved, and baked
// into the frontend as static data — so historical years never need a
// live Yahoo pull again. Only the current season keeps pulling live.
const HISTORICAL_SNAPSHOT_SEASONS = [
  { season: 2025, league_key: '461.l.45789' },
  { season: 2024, league_key: '449.l.20860' },
  { season: 2023, league_key: '423.l.1146108' },
  { season: 2022, league_id: '1171203' },
];

app.get('/api/historical-snapshot', async (req, res) => {
  try {
    const allScoresFull = await computeAllScores();
    const allScores = allScoresFull.filter((m) => m.season !== 2026);

    const seasons = {};
    for (const s of HISTORICAL_SNAPSHOT_SEASONS) {
      try {
        seasons[s.season] = await fetchSeasonDetail(s);
      } catch (e) {
        seasons[s.season] = { error: e.message };
      }
    }

    const playerStats = playerStatsJob.status === 'done' && playerStatsJob.data
      ? playerStatsJob.data.filter((pw) => pw.season !== 2026)
      : null;

    const snapshot = {
      generatedAt: new Date().toISOString(),
      allScores,
      seasons,
      playerStats,
      playerStatsNote: playerStats ? null : 'Team Stats job hasn\u2019t been run yet this session \u2014 run it first (Record Book \u2192 Team Stats \u2192 Start Loading Team Stats), then refetch this endpoint to include it.',
    };

    res.setHeader('Content-Disposition', 'attachment; filename="mehrob-mania-historical-snapshot.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(snapshot));
  } catch (err) {
    console.error('Historical snapshot failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to build historical snapshot.' });
  }
});

app.get('/', (req, res) => {
  res.send('Mehrob Mania backend is running. Visit /auth/yahoo to connect Yahoo.');
});

app.listen(PORT, () => {
  console.log(`Mehrob Mania backend running on port ${PORT}`);
});
