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

// --- Draft results, WITH real player names resolved ---
// Yahoo's draft results only give player IDs (e.g. "470.p.40055"), so
// this makes a second batched call to look up actual names and merges
// them in as a `playerNames` map keyed by player_key.
app.get('/api/draft', async (req, res) => {
  const cacheKey = 'draft';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const gameKey = process.env.YAHOO_GAME_KEY;
    const leagueKey = `${gameKey}.l.${LEAGUE_ID}`;
    const draftData = await yahooGet(`league/${leagueKey}/draftresults`);

    const resultsObj = draftData?.fantasy_content?.league?.[1]?.draft_results || {};
    const playerKeys = Object.keys(resultsObj)
      .filter((k) => k !== 'count')
      .map((k) => resultsObj[k].draft_result.player_key);

    const playerNames = {};
    for (let i = 0; i < playerKeys.length; i += 25) {
      const chunk = playerKeys.slice(i, i + 25);
      const playersData = await yahooGet(`league/${leagueKey}/players;player_keys=${chunk.join(',')}`);
      const playersObj = playersData?.fantasy_content?.league?.[1]?.players || {};
      Object.keys(playersObj).forEach((k) => {
        if (k === 'count') return;
        const meta = flattenMeta(playersObj[k].player[0]);
        if (meta.player_key) {
          playerNames[meta.player_key] = meta.name?.full || meta.editorial_team_abbr || 'Unknown Player';
        }
      });
    }

    const enriched = { ...draftData, playerNames };
    cache.set(cacheKey, enriched);
    res.json(enriched);
  } catch (err) {
    console.error('Draft results fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch draft results from Yahoo.' });
  }
});

// --- Transactions: adds, drops, trades, FAAB history ---
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

app.get('/', (req, res) => {
  res.send('Mehrob Mania backend is running. Visit /auth/yahoo to connect Yahoo.');
});

app.listen(PORT, () => {
  console.log(`Mehrob Mania backend running on port ${PORT}`);
});
