# Mehrob Mania Backend

This is the server that connects to Yahoo Fantasy Sports, handles login,
and serves your league's data to the website.

## What this does right now
- Lets you (the commissioner) connect your Yahoo account once
- Refreshes the connection automatically so it doesn't expire
- Fetches league standings from Yahoo

## What's still coming
Schedule, history, draft, moves, and the AI-powered features aren't built
yet — this is the foundation. Once this piece is confirmed working, the
next step adds each of those one at a time.

---

## Step 1: Find your Yahoo "Game Key"

Yahoo's Fantasy API requires a season-specific code (separate from your
League ID) to identify "NFL, 2026 season" vs other years. To find it:

1. Make sure your backend is deployed and connected (see Step 3 below)
2. Visit: `https://your-backend-url.com/auth/yahoo` and log in once
3. Then visit: `https://fantasysports.yahooapis.com/fantasy/v2/game/nfl?format=json`
   in your browser while logged in via the same session — the response
   will contain a `game_key` (a number like `461`)
4. Put that number in your `.env` file as `YAHOO_GAME_KEY`

(This step is a little clunky — a cleaner in-app way to grab this
automatically is a good next improvement once the basics are working.)

## Step 2: Set up your environment variables

Copy `.env.example` to a new file named `.env` and fill in:
- `YAHOO_CLIENT_ID` — from your Yahoo Developer app
- `YAHOO_CLIENT_SECRET` — from your Yahoo Developer app (keep this private)
- `YAHOO_REDIRECT_URI` — see Step 3, this depends on where you deploy
- `YAHOO_LEAGUE_ID` — 4374
- `YAHOO_GAME_KEY` — from Step 1

## Step 3: Deploy the backend (using Render — free tier)

1. Go to **render.com** and sign up (free)
2. Click **New +** → **Web Service**
3. Connect your GitHub account, and push this folder to a new GitHub
   repo first (Render deploys from GitHub)
   - If you don't have GitHub yet: create a free account at
     **github.com**, then create a "New repository," and use GitHub's
     web upload feature to drag these files in — no command line needed
4. Once connected, Render will detect this as a Node app automatically
5. Set the **Build Command** to `npm install`
6. Set the **Start Command** to `npm start`
7. Under **Environment**, add each variable from your `.env` file
8. Click **Create Web Service**

Render will give you a live URL like `https://mehrob-mania-backend.onrender.com`

## Step 4: Update your Yahoo app's Redirect URI

Go back to **developer.yahoo.com/apps**, open your app, and change the
Redirect URI from `https://localhost` to:

```
https://mehrob-mania-backend.onrender.com/auth/yahoo/callback
```

(using your actual Render URL). Also update `YAHOO_REDIRECT_URI` in
Render's environment variables to match exactly.

## Step 5: Connect Yahoo for real

Visit `https://your-backend-url.com/auth/yahoo` in your browser, log in
with the commissioner Yahoo account, and click Agree. You should see a
success message.

## Step 6: Test it

Visit `https://your-backend-url.com/api/standings` — you should see raw
JSON data from your actual league.

---

If you get stuck on any step, send me exactly what you see (screenshot
is great) and I'll help troubleshoot.
