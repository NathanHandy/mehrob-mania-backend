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
app.get('/api/season-detail', async (req, res) => {
  const { league_key, league_id, season } = req.query;
  const cacheKey = `season-detail-${league_key || `${league_id}-${season}`}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    let leagueKey = league_key;

    if (!leagueKey) {
      if (!league_id || !season) {
        return res.status(400).json({ error: 'Provide either league_key, or both league_id and season.' });
      }
      const gameData = await yahooGet(`games;game_codes=nfl;seasons=${season}`);
      const gamesObj = gameData?.fantasy_content?.games || {};
      const gameKeyEntry = Object.keys(gamesObj).find((k) => k !== 'count');
      let gameKey = null;
      if (gameKeyEntry) {
        const gameEntry = gamesObj[gameKeyEntry].game;
        // Yahoo's shape here varies: could be a flat object, an array of
        // mixed objects, or that array nested one level deeper.
        if (Array.isArray(gameEntry)) {
          const meta = Array.isArray(gameEntry[0]) ? flattenMeta(gameEntry[0]) : flattenMeta(gameEntry);
          gameKey = meta.game_key || null;
        } else if (gameEntry && typeof gameEntry === 'object') {
          gameKey = gameEntry.game_key || null;
        }
      }
      if (!gameKey) return res.status(404).json({ error: `Couldn't resolve a game key for season ${season}.` });
      leagueKey = `${gameKey}.l.${league_id}`;
    }

    const standings = await yahooGet(`league/${leagueKey}/standings`);
    let draft = null;
    try {
      draft = await fetchDraftWithNames(leagueKey);
    } catch (e) {
      // Draft results might not exist/be accessible for very old leagues — that's fine, standings still work.
    }

    let transactions = null;
    try {
      transactions = await yahooGet(`league/${leagueKey}/transactions`);
    } catch (e) {
      // Same deal — transactions might not be pullable for very old leagues.
    }

    const result = { league_key: leagueKey, standings, draft, transactions };
    cache.set(cacheKey, result, 3600);
    res.json(result);
  } catch (err) {
    console.error('Season detail fetch failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch season detail from Yahoo.' });
  }
});

app.get('/', (req, res) => {
  res.send('Mehrob Mania backend is running. Visit /auth/yahoo to connect Yahoo.');
});

app.listen(PORT, () => {
  console.log(`Mehrob Mania backend running on port ${PORT}`);
});
