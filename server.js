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
const REDIRECT_URI = process.env.YAHOO_REDIRECT_URI; // must exactly match what's registered on Yahoo
const LEAGUE_ID = process.env.YAHOO_LEAGUE_ID; // e.g. 4374

// Cache Yahoo responses for 5 minutes so we don't hammer their API
// or blow through rate limits every time someone loads the site.
const cache = new NodeCache({ stdTTL: 300 });

// --- Token storage ---
// For now, tokens are stored in a local JSON file since this app only
// ever needs ONE Yahoo login (yours, as commissioner) — not per-visitor.
// Once we're on real hosting, this should move to a proper database so
// tokens survive server restarts/redeploys, but this gets us moving.
const TOKEN_FILE = path.join(__dirname, 'tokens.json');

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
}

// --- Step 1: Kick off Yahoo login ---
// Visiting this URL in a browser sends the commissioner to Yahoo's
// consent screen. Only needs to be done once (or again if the refresh
// token ever stops working).
app.get('/auth/yahoo', (req, res) => {
  const authUrl = `https://api.login.yahoo.com/oauth2/request_auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&language=en-us`;
  res.redirect(authUrl);
});

// --- Step 2: Yahoo redirects back here with a ?code=... ---
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

    res.send('Yahoo connected successfully! You can close this tab and go back to the app.');
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err.message);
    res.status(500).send('Something went wrong connecting to Yahoo. Check server logs.');
  }
});

// --- Refresh the access token when it's expired ---
async function getValidAccessToken() {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Yahoo is not connected yet. Visit /auth/yahoo first.');

  const ageSeconds = (Date.now() - tokens.obtained_at) / 1000;
  const isExpired = ageSeconds > tokens.expires_in - 60; // refresh a bit early

  if (!isExpired) return tokens.access_token;

  const refreshRes = await axios.post(
    'https://api.login.yahoo.com/oauth2/get_token',
    new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const newTokens = {
    access_token: refreshRes.data.access_token,
    refresh_token: refreshRes.data.refresh_token || tokens.refresh_token,
    obtained_at: Date.now(),
    expires_in: refreshRes.data.expires_in,
  };
  saveTokens(newTokens);
  return newTokens.access_token;
}

// --- Helper: call the Yahoo Fantasy Sports API ---
async function yahooGet(endpoint) {
  const accessToken = await getValidAccessToken();
  const url = `https://fantasysports.yahooapis.com/fantasy/v2/${endpoint}?format=json`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return response.data;
}

// --- Status check: is Yahoo connected? ---
app.get('/api/status', (req, res) => {
  const tokens = loadTokens();
  res.json({ connected: !!tokens });
});

// --- Standings endpoint ---
// Note: Yahoo requires a full "league key" like "461.l.4374", where the
// number prefix is the game key for a specific NFL season (it changes
// every year). YAHOO_GAME_KEY should be set in .env — see README for
// how to look it up.
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

app.get('/', (req, res) => {
  res.send('Mehrob Mania backend is running. Visit /auth/yahoo to connect Yahoo.');
});

app.listen(PORT, () => {
  console.log(`Mehrob Mania backend running on port ${PORT}`);
});
