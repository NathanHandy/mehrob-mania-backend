import React, { useState, useEffect } from 'react';
import {
  Flame, Sun, Moon, Search, DollarSign, Shirt, Trophy, Calendar, Newspaper,
  ChevronRight, Menu, X, Users, Shuffle, Award, BookOpen, TrendingUp,
  FileText, Swords, Filter, Zap, Shield,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

// ============================= LIVE DATA CONFIG =============================
const API_BASE_URL = 'https://mehrob-mania-backend-1.onrender.com';

// Maps Yahoo's team_id (1-12) to our internal nickname system, so live
// data lines up with the bios/history already keyed by these nicks.
const YAHOO_TEAM_ID_TO_NICK = {
  1: 'NJ', 2: 'RB', 3: 'Okarp', 4: 'Glo pup', 5: 'Zai', 6: 'Bronnie',
  7: 'Bodge', 8: 'Twizzy', 9: 'Rooby', 10: 'Gill', 11: 'Mr', 12: 'Skeo',
};
const YAHOO_DIVISION_ID_TO_NAME = { 1: 'Bad Little Boys', 2: 'Mid Little Boys', 3: 'Good Little Boys' };

// Real first names for display, everywhere \u2014 internal nick codes (NJ,
// RB, Okarp, etc.) stay as the technical identifier for keys/lookups only
// and should never be shown to the user directly. The two Ryans are
// disambiguated as "Ryan B" and "Ryan A" per Nathan's preference.
const NICK_TO_FIRST_NAME = {
  NJ: 'Nathan', RB: 'Rabeea', Bodge: 'Brady', Mr: 'Brendan', Okarp: 'Owen',
  'Glo pup': 'Trey', Rooby: 'Mehrob', Gill: 'Matthew', Zai: 'Ryan B',
  Bronnie: 'Benjamin', Twizzy: 'Ryan A', Skeo: 'Sean',
};
function displayName(nick) {
  return NICK_TO_FIRST_NAME[nick] || nick;
}
// For strings that embed a nick inside longer text (e.g. "NJ vs. Bodge",
// "Gill vs. RB, Wk 5") \u2014 replaces every whole-word nick match with the
// real first name.
function expandNames(text) {
  if (!text) return text;
  return Object.keys(NICK_TO_FIRST_NAME).reduce((acc, nick) => {
    const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    return acc.replace(regex, NICK_TO_FIRST_NAME[nick]);
  }, text);
}

// Yahoo's team objects are arrays mixing real data objects with empty-array
// placeholders — this merges all the real objects into one flat lookup.
function flattenYahooMeta(arr) {
  const result = {};
  arr.forEach((item) => {
    if (!Array.isArray(item)) Object.assign(result, item);
  });
  return result;
}

function parseYahooStandings(json) {
  const teamsObj = json?.fantasy_content?.league?.[1]?.standings?.[0]?.teams;
  if (!teamsObj) return null;

  const byDivision = { 'Bad Little Boys': [], 'Mid Little Boys': [], 'Good Little Boys': [] };
  Object.keys(teamsObj).forEach((key) => {
    if (key === 'count') return;
    const teamArr = teamsObj[key].team;
    const meta = flattenYahooMeta(teamArr[0]);
    const standings = teamArr[2]?.team_standings || {};
    const outcomes = standings.outcome_totals || {};
    const divOutcomes = standings.divisional_outcome_totals || {};

    const nick = YAHOO_TEAM_ID_TO_NICK[meta.team_id];
    const divName = YAHOO_DIVISION_ID_TO_NAME[meta.division_id];
    if (!nick || !divName) return;

    byDivision[divName].push({
      nick,
      team: meta.name,
      owner: meta.managers?.[0]?.manager?.nickname || nick,
      w: Number(outcomes.wins) || 0,
      l: Number(outcomes.losses) || 0,
      pf: Number(standings.points_for) || 0,
      pa: Number(standings.points_against) || 0,
      divW: Number(divOutcomes.wins) || 0,
      divL: Number(divOutcomes.losses) || 0,
      h2h: 0,
      faab: Number(meta.faab_balance) || 0,
      streak: '—',
      draftGrade: meta.draft_grade || null,
    });
  });
  return byDivision;
}

function useLiveStandings() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/standings`)
      .then((res) => {
        if (!res.ok) throw new Error('Backend returned an error');
        return res.json();
      })
      .then((json) => {
        const parsed = parseYahooStandings(json);
        if (!parsed) throw new Error('Unexpected response shape');
        setData(parsed);
        setCurrentWeek(json?.fantasy_content?.league?.[0]?.current_week || 1);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error, currentWeek };
}

function parseYahooDraft(json) {
  const resultsObj = json?.fantasy_content?.league?.[1]?.draft_results;
  const playerNames = json?.playerNames;
  if (!resultsObj || !playerNames) return null;

  const byNick = {};
  Object.keys(resultsObj).forEach((key) => {
    if (key === 'count') return;
    const pick = resultsObj[key].draft_result;
    const teamIdMatch = pick.team_key.match(/\.t\.(\d+)$/);
    const teamId = teamIdMatch ? Number(teamIdMatch[1]) : null;
    const nick = YAHOO_TEAM_ID_TO_NICK[teamId];
    if (!nick) return;
    if (!byNick[nick]) byNick[nick] = [];
    byNick[nick].push({
      round: pick.round,
      pickNo: pick.pick,
      player: playerNames[pick.player_key] || 'Unknown Player',
    });
  });
  Object.values(byNick).forEach((picks) => picks.sort((a, b) => a.round - b.round));
  return byNick;
}

function useLiveDraft() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/draft`)
      .then((res) => {
        if (!res.ok) throw new Error('Backend returned an error');
        return res.json();
      })
      .then((json) => {
        const parsed = parseYahooDraft(json);
        if (!parsed) throw new Error('Unexpected response shape');
        setData(parsed);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

function parseYahooTransactions(json) {
  const txObj = json?.fantasy_content?.league?.[1]?.transactions;
  if (!txObj) return null;

  const moves = [];
  Object.keys(txObj).forEach((key) => {
    if (key === 'count') return;
    const txArr = txObj[key].transaction;
    const meta = txArr[0];
    if (meta.type === 'commish') return; // settings changes, no players involved

    const playersObj = txArr[1]?.players || {};
    const playerEntries = [];
    Object.keys(playersObj).forEach((pk) => {
      if (pk === 'count') return;
      const parr = playersObj[pk].player;
      const pMeta = flattenYahooMeta(parr[0]);
      const txDataRaw = parr[1]?.transaction_data;
      const txData = Array.isArray(txDataRaw) ? txDataRaw[0] : txDataRaw;
      if (!txData) return;
      playerEntries.push({
        name: pMeta.name?.full,
        txType: txData.type,
        destTeam: txData.destination_team_name,
        sourceTeam: txData.source_team_name,
      });
    });

    const date = new Date(Number(meta.timestamp) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (meta.type === 'trade') {
      const teamA = meta.trader_team_name;
      const teamB = meta.tradee_team_name;
      const teamAGets = playerEntries.filter((p) => p.destTeam === teamA).map((p) => p.name);
      const teamBGets = playerEntries.filter((p) => p.destTeam === teamB).map((p) => p.name);
      moves.push({ date, year: 2026, type: 'Trade', teamA, teamAGets, teamB, teamBGets });
    } else {
      const addedEntry = playerEntries.find((p) => p.txType === 'add');
      const droppedEntry = playerEntries.find((p) => p.txType === 'drop');
      const team = addedEntry?.destTeam || droppedEntry?.sourceTeam;
      if (!team) return;
      moves.push({ date, year: 2026, type: 'Add/Drop', team, added: addedEntry?.name || null, dropped: droppedEntry?.name || null });
    }
  });
  return moves;
}

function useLiveTransactions() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/transactions`)
      .then((res) => {
        if (!res.ok) throw new Error('Backend returned an error');
        return res.json();
      })
      .then((json) => {
        const parsed = parseYahooTransactions(json);
        if (!parsed) throw new Error('Unexpected response shape');
        setData(parsed);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}

function parseYahooSchedule(json, week) {
  const matchupsObj = json?.fantasy_content?.league?.[1]?.scoreboard?.[0]?.matchups;
  if (!matchupsObj) return null;

  const games = [];
  Object.keys(matchupsObj).forEach((key) => {
    if (key === 'count') return;
    const teamsObj = matchupsObj[key].matchup[0]?.teams;
    if (!teamsObj) return;
    const t0 = teamsObj['0']?.team;
    const t1 = teamsObj['1']?.team;
    if (!t0 || !t1) return;

    const meta0 = flattenYahooMeta(t0[0]);
    const meta1 = flattenYahooMeta(t1[0]);
    const stats0 = t0[1] || {};
    const stats1 = t1[1] || {};

    const nick0 = YAHOO_TEAM_ID_TO_NICK[Number(meta0.team_id)];
    const nick1 = YAHOO_TEAM_ID_TO_NICK[Number(meta1.team_id)];
    if (!nick0 || !nick1) return;

    const played0 = Number(stats0.team_points?.total) > 0;
    const played1 = Number(stats1.team_points?.total) > 0;
    const anyPlayed = played0 || played1;

    games.push({
      home: nick0,
      away: nick1,
      hs: anyPlayed ? Number(stats0.team_points?.total) || 0 : null,
      as: anyPlayed ? Number(stats1.team_points?.total) || 0 : null,
      homeProj: Number(stats0.team_projected_points?.total) || 0,
      awayProj: Number(stats1.team_projected_points?.total) || 0,
      div: meta0.division_id === meta1.division_id,
      rival: Number(week) === 3 || Number(week) === 4, // whoever plays each other in weeks 3-4 are the rivalry matchups
    });
  });
  return games;
}

function useLiveSchedule(week) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/api/schedule?week=${week}`)
      .then((res) => {
        if (!res.ok) throw new Error('Backend returned an error');
        return res.json();
      })
      .then((json) => {
        const parsed = parseYahooSchedule(json, week);
        if (!parsed) throw new Error('Unexpected response shape');
        setData(parsed);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [week]);

  return { data, loading, error };
}

// --- Playoff odds via Monte Carlo simulation ---
// Based purely on real record and the real remaining schedule \u2014 no
// projected/pre-season strength assumptions. Before any games are played
// every team is a true coin flip; the simulation still produces real
// variance in each team's odds because it runs the actual remaining
// schedule and real seeding/tiebreaker rules thousands of times, and
// those aren't symmetric for every team (who you play, when, and how
// tiebreakers fall all matter independent of team strength).
function computePlayoffOdds(liveData, remainingWeeksMatchups, divOrder, restOrder, iterations = 1500) {
  const allTeams = [...liveData['Bad Little Boys'], ...liveData['Mid Little Boys'], ...liveData['Good Little Boys']];

  const power = {};
  allTeams.forEach((t) => {
    const gp = t.w + t.l;
    power[t.nick] = gp > 0 ? t.w / gp : 0.5; // real record only; 0.5 (true coin flip) until real games exist
  });

  const divNameOf = {};
  ['Bad Little Boys', 'Mid Little Boys', 'Good Little Boys'].forEach((dn) => {
    liveData[dn].forEach((t) => { divNameOf[t.nick] = dn; });
  });

  const playoffCount = {};
  allTeams.forEach((t) => { playoffCount[t.nick] = 0; });

  for (let iter = 0; iter < iterations; iter++) {
    const sim = {};
    allTeams.forEach((t) => { sim[t.nick] = { ...t }; });

    remainingWeeksMatchups.forEach((week) => {
      week.forEach(([a, b]) => {
        if (!sim[a] || !sim[b]) return;
        const pa = power[a] ?? 0.5, pb = power[b] ?? 0.5;
        const prob = 1 / (1 + Math.pow(10, -(pa - pb) * 0.6)); // calibrated so a big real record gap (e.g. 0.8 vs 0.3 win%) lands around a 65-68% favorite, not a near-lock \u2014 fantasy football has real week-to-week variance
        const aWins = Math.random() < prob;
        if (aWins) { sim[a].w++; sim[b].l++; } else { sim[b].w++; sim[a].l++; }
        if (divNameOf[a] === divNameOf[b]) {
          if (aWins) { sim[a].divW++; sim[b].divL++; } else { sim[b].divW++; sim[a].divL++; }
        }
      });
    });

    const byDiv = { 'Bad Little Boys': [], 'Mid Little Boys': [], 'Good Little Boys': [] };
    Object.values(sim).forEach((t) => { byDiv[divNameOf[t.nick]].push(t); });

    const rankMap = buildOverallRankMap(divOrder, restOrder, byDiv);
    Object.keys(rankMap).forEach((nick) => {
      if (rankMap[nick] <= 6) playoffCount[nick]++;
    });
  }

  const odds = {};
  allTeams.forEach((t) => { odds[t.nick] = Math.round((playoffCount[t.nick] / iterations) * 100); });

  // Remaining strength of schedule: average power rating of remaining opponents
  const sosAccum = {};
  allTeams.forEach((t) => { sosAccum[t.nick] = []; });
  remainingWeeksMatchups.forEach((week) => {
    week.forEach(([a, b]) => {
      if (sosAccum[a]) sosAccum[a].push(power[b] ?? 0.5);
      if (sosAccum[b]) sosAccum[b].push(power[a] ?? 0.5);
    });
  });
  const sos = {};
  allTeams.forEach((t) => {
    const arr = sosAccum[t.nick];
    sos[t.nick] = arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) : 50;
  });

  return { odds, sos };
}

function usePlayoffOdds(liveData, currentWeek, divOrder, restOrder) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!liveData || !currentWeek) return;
    setLoading(true);
    setError(null);

    const weeksToFetch = [];
    for (let w = currentWeek; w <= 17; w++) weeksToFetch.push(w);

    Promise.all(
      weeksToFetch.map((w) =>
        fetch(`${API_BASE_URL}/api/schedule?week=${w}`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
      )
    )
      .then((results) => {
        const remainingWeeksMatchups = results.map((json) => {
          const matchupsObj = json?.fantasy_content?.league?.[1]?.scoreboard?.[0]?.matchups;
          if (!matchupsObj) return [];
          const pairs = [];
          Object.keys(matchupsObj).forEach((key) => {
            if (key === 'count') return;
            const teamsObj = matchupsObj[key].matchup[0]?.teams;
            if (!teamsObj) return;
            const t0 = teamsObj['0']?.team, t1 = teamsObj['1']?.team;
            if (!t0 || !t1) return;
            const meta0 = flattenYahooMeta(t0[0]);
            const meta1 = flattenYahooMeta(t1[0]);
            const nick0 = YAHOO_TEAM_ID_TO_NICK[Number(meta0.team_id)];
            const nick1 = YAHOO_TEAM_ID_TO_NICK[Number(meta1.team_id)];
            if (nick0 && nick1) pairs.push([nick0, nick1]);
          });
          return pairs;
        });

        const computed = computePlayoffOdds(liveData, remainingWeeksMatchups, divOrder, restOrder);
        setResult(computed);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [liveData, currentWeek, divOrder, restOrder]);

  return { result, loading, error };
}

// --- Historical season detail (real standings for any past year) ---
// Known league keys for the renewed chain, plus the separate/unlinked
// 2022 league (resolved via league_id + season instead, since it has no
// game_key we already know).
const HISTORICAL_SEASON_PARAMS = {
  2025: { league_key: '461.l.45789' },
  2024: { league_key: '449.l.20860' },
  2023: { league_key: '423.l.1146108' },
  2022: { league_id: '1171203', season: '2022' },
};

// Maps Yahoo's manager nickname (stable across seasons, unlike team_id
// which can differ especially for the unlinked 2022 league) to our
// internal nick codes. The two Ryans are disambiguated by team name
// where possible ("Gojo's Getback" has been Zai's team every season
// we've verified), falling back to order of appearance otherwise.
const MANAGER_NICKNAME_TO_NICK = {
  Nathan: 'NJ', Rbeezy: 'RB', Owen: 'Okarp', Trey: 'Glo pup', ben: 'Bronnie',
  Brady: 'Bodge', mehrob: 'Rooby', matthew: 'Gill', Brendan: 'Mr', Sean: 'Skeo',
};

function parseSeasonStandingsGeneric(json) {
  const teamsObj = json?.fantasy_content?.league?.[1]?.standings?.[0]?.teams;
  if (!teamsObj) return null;

  const rows = [];
  let ryanSeen = 0;
  Object.keys(teamsObj).forEach((key) => {
    if (key === 'count') return;
    const teamArr = teamsObj[key].team;
    const meta = flattenYahooMeta(teamArr[0]);
    const standings = teamArr[2]?.team_standings || {};
    const outcomes = standings.outcome_totals || {};
    const divOutcomes = standings.divisional_outcome_totals || {};
    const managerNick = meta.managers?.[0]?.manager?.nickname;

    let nick = MANAGER_NICKNAME_TO_NICK[managerNick];
    if (!nick && managerNick === 'Ryan') {
      // Zai's team has been "Gojo's Getback" every season we've verified;
      // otherwise fall back to first-seen = Zai, second-seen = Twizzy.
      if ((meta.name || '').includes('Gojo')) nick = 'Zai';
      else { nick = ryanSeen === 0 ? 'Zai' : 'Twizzy'; ryanSeen++; }
    }
    if (!nick) return;

    rows.push({
      nick,
      team: meta.name,
      w: Number(outcomes.wins) || 0,
      l: Number(outcomes.losses) || 0,
      pf: Number(standings.points_for) || 0,
      pa: Number(standings.points_against) || 0,
      divW: Number(divOutcomes.wins) || 0,
      divL: Number(divOutcomes.losses) || 0,
      rank: Number(standings.rank) || 99,
      divisionId: meta.division_id,
    });
  });
  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

function useSeasonDetail(year) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = HISTORICAL_SEASON_PARAMS[year];
    if (!params) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    const qs = params.league_key
      ? `league_key=${params.league_key}`
      : `league_id=${params.league_id}&season=${params.season}`;

    fetch(`${API_BASE_URL}/api/season-detail?${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error('Backend returned an error');
        return res.json();
      })
      .then((json) => {
        const parsed = parseSeasonStandingsGeneric(json.standings);
        if (!parsed) throw new Error('Unexpected response shape');
        setRows(parsed);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [year]);

  return { rows, loading, error };
}


// ============================= THEME =============================
const THEMES = {
  dark: {
    bg: '#0A0D0A', heroGrad: 'linear-gradient(180deg, #14201A 0%, #0A0D0A 100%)',
    panel: '#0F1410', panelAlt: 'rgba(255,255,255,0.05)',
    border: 'rgba(255,255,255,0.10)', borderSoft: 'rgba(255,255,255,0.05)',
    text: '#FFFFFF', subtext: 'rgba(255,255,255,0.45)', subtextFaint: 'rgba(255,255,255,0.30)',
    accent: '#FFB800', accentGlow: '0 0 8px rgba(255,184,0,0.5)',
    rival: '#E63946', win: '#4ADE80', loss: '#F87171', gridLine: 'rgba(255,255,255,0.04)',
  },
  light: {
    bg: '#FAFAF7', heroGrad: 'linear-gradient(180deg, #FFFFFF 0%, #FAFAF7 100%)',
    panel: '#FFFFFF', panelAlt: 'rgba(0,0,0,0.04)',
    border: 'rgba(0,0,0,0.10)', borderSoft: 'rgba(0,0,0,0.06)',
    text: '#14150F', subtext: 'rgba(20,21,15,0.55)', subtextFaint: 'rgba(20,21,15,0.38)',
    accent: '#B8860B', accentGlow: 'none',
    rival: '#C1121F', win: '#15803D', loss: '#B91C1C', gridLine: 'rgba(0,0,0,0.035)',
  },
};
const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Anton', sans-serif";

// ============================= MOCK DATA =============================
// Real division/owner names from the league constitution; team names are
// placeholders since they're picked at/after the draft.
const BAD_LITTLE_BOYS = [
  { owner: 'Nathan Handy', nick: 'NJ', team: 'Ashton Hall', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Rabeea Aljizani', nick: 'RB', team: 'Beezgaryen 🐉', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Brady Hodge', nick: 'Bodge', team: 'NFL Youngboy Better', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Brendan Ware', nick: 'Mr', team: 'Last Place', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
];
const MID_LITTLE_BOYS = [
  { owner: 'Owen Karpeles', nick: 'Okarp', team: '📍Folk Front Office', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Trey Glodis', nick: 'Glo pup', team: 'Take this DK', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Mehrob Fatemi', nick: 'Rooby', team: 'Reporter Rooby', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Matthew Mcgill', nick: 'Gill', team: 'The Skat Pack', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
];
const GOOD_LITTLE_BOYS = [
  { owner: 'Ryan Burns', nick: 'Zai', team: "Gojo's Getback", w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Benjamin Bronstein', nick: 'Bronnie', team: 'When life give you a Makai', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Ryan Ahmed', nick: 'Twizzy', team: 'Drippy uh', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
  { owner: 'Sean Keohan', nick: 'Skeo', team: 'The DawgPound', w: 0, l: 0, pf: 0, pa: 0, divW: 0, divL: 0, h2h: 0, faab: 100, streak: '—' },
];

const SCHEDULE_WEEKS = {
  1: [
    { home: 'Skeo', away: 'Rooby', hs: 128.4, as: 119.2, rival: false, div: true },
    { home: 'NJ', away: 'Zai', hs: 145.9, as: 98.3, rival: false, div: true },
    { home: 'Okarp', away: 'Twizzy', hs: 110.7, as: 133.1, rival: false, div: false },
    { home: 'Glo pup', away: 'Gill', hs: 121.0, as: 117.6, rival: false, div: true },
    { home: 'Bronnie', away: 'Mr', hs: 99.5, as: 104.2, rival: false, div: true },
    { home: 'RB', away: 'Bodge', hs: 88.1, as: 130.9, rival: false, div: false },
  ],
  2: [
    { home: 'Skeo', away: 'Okarp', hs: null, as: null, rival: false, div: true },
    { home: 'NJ', away: 'Bronnie', hs: null, as: null, rival: false, div: false },
    { home: 'Rooby', away: 'RB', hs: null, as: null, rival: false, div: true },
    { home: 'Gill', away: 'Twizzy', hs: null, as: null, rival: false, div: true },
    { home: 'Zai', away: 'Bodge', hs: null, as: null, rival: false, div: true },
    { home: 'Mr', away: 'Glo pup', hs: null, as: null, rival: false, div: false },
  ],
  3: [
    { home: 'Skeo', away: 'Rooby', hs: null, as: null, rival: true, div: true },
    { home: 'NJ', away: 'Gill', hs: null, as: null, rival: true, div: true },
    { home: 'Okarp', away: 'RB', hs: null, as: null, rival: false, div: true },
    { home: 'Bronnie', away: 'Mr', hs: null, as: null, rival: false, div: true },
    { home: 'Zai', away: 'Twizzy', hs: null, as: null, rival: false, div: true },
    { home: 'Glo pup', away: 'Bodge', hs: null, as: null, rival: false, div: true },
  ],
};

const TIEBREAKERS = {
  pf: { label: 'Points For', fn: (t) => t.pf },
  divRecord: { label: 'Div. Record', fn: (t) => t.divW / (t.divW + t.divL || 1) },
  h2h: { label: 'Head-to-Head', fn: (t) => t.h2h },
};

const POWER_RANK_HISTORY = [
  { week: 'W1', NJ: 2, Zai: 6, Skeo: 4, Okarp: 1, 'Glo pup': 7, Gill: 3, RB: 8, Rooby: 10, Twizzy: 5, Bronnie: 9, Mr: 11, Bodge: 12 },
  { week: 'W2', NJ: 1, Zai: 5, Skeo: 3, Okarp: 2, 'Glo pup': 8, Gill: 4, RB: 7, Rooby: 9, Twizzy: 6, Bronnie: 10, Mr: 12, Bodge: 11 },
  { week: 'W3', NJ: 1, Zai: 5, Skeo: 2, Okarp: 4, 'Glo pup': 7, Gill: 6, RB: 8, Rooby: 9, Twizzy: 3, Bronnie: 10, Mr: 12, Bodge: 11 },
  { week: 'W4', NJ: 1, Zai: 4, Skeo: 2, Okarp: 3, 'Glo pup': 6, Gill: 5, RB: 7, Rooby: 9, Twizzy: 8, Bronnie: 10, Mr: 11, Bodge: 12 },
  { week: 'W5', NJ: 2, Zai: 4, Skeo: 1, Okarp: 3, 'Glo pup': 6, Gill: 5, RB: 7, Rooby: 8, Twizzy: 9, Bronnie: 10, Mr: 12, Bodge: 11 },
  { week: 'W6', NJ: 1, Zai: 2, Skeo: 3, Okarp: 4, 'Glo pup': 5, Gill: 6, RB: 7, Rooby: 8, Twizzy: 9, Bronnie: 10, Mr: 11, Bodge: 12 },
];

const POWER_RANKINGS = [
  { nick: 'NJ', rank: 1, lastRank: 1, blurb: 'Still the clear top team — elite points-for backed by an easy remaining schedule.' },
  { nick: 'Zai', rank: 2, lastRank: 4, blurb: 'Back-to-back blowout wins pushed them up two spots. The eye test says this is real.' },
  { nick: 'Skeo', rank: 3, lastRank: 2, blurb: 'Solid record but the underlying scoring is trending down two weeks running.' },
  { nick: 'Okarp', rank: 4, lastRank: 3, blurb: 'Division-winner floor, but a thin bench is starting to show against good defenses.' },
  { nick: 'Glo pup', rank: 5, lastRank: 6, blurb: 'Quietly one of the more consistent scorers in the league, just buried by tough matchups.' },
  { nick: 'Gill', rank: 6, lastRank: 5, blurb: 'Analytics love this roster, but three straight one-score losses are hard to ignore.' },
  { nick: 'RB', rank: 7, lastRank: 7, blurb: 'Right on the playoff bubble — needs a signature win to climb.' },
  { nick: 'Rooby', rank: 8, lastRank: 9, blurb: 'FAAB spending is finally paying off with a much deeper WR room.' },
  { nick: 'Twizzy', rank: 9, lastRank: 8, blurb: 'Boom-or-bust roster construction is starting to bust more than boom.' },
  { nick: 'Bronnie', rank: 10, lastRank: 10, blurb: 'Points For keeps this out of last, but the record says otherwise.' },
  { nick: 'Mr', rank: 11, lastRank: 12, blurb: 'A genuinely tough slate of opponents so far — schedule gets easier soon.' },
  { nick: 'Bodge', rank: 12, lastRank: 11, blurb: 'Missing lineup decisions two weeks straight are costing real points.' },
];

const MOVES = [
  { date: 'Nov 12', year: 2025, type: 'Trade', teamA: 'NJ', teamAGets: ['D. Henry'], teamB: 'Zai', teamBGets: ['J. Downs', 'FAAB $15'] },
  { date: 'Nov 10', year: 2025, type: 'FAAB', team: 'Skeo', player: 'R. Stevenson', dropped: 'K. Walker',
    bids: [{ team: 'Skeo', amount: 34, won: true }, { team: 'Twizzy', amount: 28, won: false }, { team: 'Mr', amount: 11, won: false }] },
  { date: 'Nov 8', year: 2025, type: 'Add/Drop', team: 'Okarp', added: 'S. LaPorta', dropped: 'D. Njoku' },
  { date: 'Nov 6', year: 2025, type: 'Add/Drop', team: 'Bronnie', added: 'K. Williams', dropped: null },
  { date: 'Nov 3', year: 2025, type: 'Trade', teamA: 'Zai', teamAGets: ['J. Jefferson', 'N. Collins'], teamB: 'Gill', teamBGets: ['C. Lamb'] },
  { date: 'Nov 2', year: 2025, type: 'FAAB', team: 'Rooby', player: 'D. London', dropped: 'R. Rice',
    bids: [{ team: 'Rooby', amount: 22, won: true }, { team: 'Bodge', amount: 19, won: false }] },
  { date: 'Oct 29', year: 2025, type: 'Add/Drop', team: 'Twizzy', added: 'T. Etienne', dropped: 'A. Jones' },
  { date: 'Dec 3', year: 2024, type: 'Trade', teamA: 'Okarp', teamAGets: ['A. St. Brown'], teamB: 'NJ', teamBGets: ['B. Robinson', 'FAAB $10'] },
  { date: 'Nov 20', year: 2024, type: 'FAAB', team: 'Gill', player: 'P. Nacua', dropped: 'M. Pittman',
    bids: [{ team: 'Gill', amount: 41, won: true }, { team: 'Okarp', amount: 30, won: false }] },
  { date: 'Oct 15', year: 2023, type: 'Add/Drop', team: 'Rooby', added: 'D. Achane', dropped: 'A. Jeanty' },
  { date: 'Sep 22', year: 2023, type: 'Trade', teamA: 'Bodge', teamAGets: ['J. Chase'], teamB: 'Skeo', teamBGets: ['T. Kelce', 'FAAB $8'] },
  { date: 'Nov 5', year: 2022, type: 'FAAB', team: 'Twizzy', player: 'J. Gibbs', dropped: 'D. Cook',
    bids: [{ team: 'Twizzy', amount: 55, won: true }, { team: 'RB', amount: 40, won: false }] },
  { date: 'Sep 10', year: 2022, type: 'Add/Drop', team: 'Mr', added: 'D. London', dropped: null },
];

const RECORD_BOOK = {
  h2h: [
    { section: 'Wins', rows: [
      { label: 'Most Wins', value: '38', holders: [{ name: 'NJ' }] },
      { label: 'Most Wins in a Season', value: '12', holders: [{ name: 'Okarp', context: '2024' }] },
      { label: 'Longest Win Streak', value: '8', holders: [{ name: 'Zai', context: '2024' }] },
      { label: 'Current Streak', value: 'W5', holders: [{ name: 'NJ' }] },
    ]},
    { section: 'Losses', rows: [
      { label: 'Most Losses', value: '34', holders: [{ name: 'Bodge' }] },
      { label: 'Longest Losing Streak', value: '7', holders: [{ name: 'Mr', context: '2023' }, { name: 'Bronnie', context: '2025' }] },
      { label: 'Current Streak', value: 'L3', holders: [{ name: 'Twizzy' }] },
    ]},
    { section: 'Margin of Victory — Largest', rows: [
      { label: 'Single Week', value: '87.4', holders: [{ name: 'NJ vs. Bodge', context: 'Wk 9, 2025' }] },
      { label: 'Season Average', value: '31.2', holders: [{ name: 'NJ', context: '2025' }] },
    ]},
    { section: 'Margin of Victory — Smallest', rows: [
      { label: 'Single Week', value: '0.3', holders: [{ name: 'Gill vs. RB', context: 'Wk 4, 2025' }] },
    ]},
    { section: 'Strength of Schedule', rows: [
      { label: 'Hardest, Weekly Avg', value: '128.4', holders: [{ name: 'Bronnie', context: '2025' }] },
      { label: 'Easiest, Weekly Avg', value: '96.7', holders: [{ name: 'Skeo', context: '2025' }] },
    ]},
  ],
  points: [
    { section: 'Team Points — Most', rows: [
      { label: 'Single Week', value: '187.6', holders: [{ name: 'NJ vs. Bodge', context: 'Wk 9, 2025' }] },
      { label: 'Season, All-Time', value: '2,104', holders: [{ name: 'Okarp', context: '2024' }] },
    ]},
    { section: 'Team Points — Least', rows: [
      { label: 'Single Week', value: '61.2', holders: [{ name: 'Mr vs. Zai', context: 'Wk 12, 2025' }] },
      { label: 'Season, All-Time', value: '1,301', holders: [{ name: 'Bodge', context: '2023' }] },
    ]},
    { section: 'Offensive Points — Most', rows: [
      { label: 'Single Week', value: '172.1', holders: [{ name: 'Zai vs. Gill', context: 'Wk 6, 2025' }] },
    ]},
    { section: 'Kicking Points — Most', rows: [
      { label: 'Season Average', value: '11.8', holders: [{ name: 'Rooby', context: '2025' }] },
    ]},
    { section: 'Defensive Points — Most', rows: [
      { label: 'Single Week', value: '28', holders: [{ name: 'RB vs. Twizzy', context: 'Wk 3, 2025' }, { name: 'NJ vs. Skeo', context: 'Wk 11, 2024' }] },
    ]},
  ],
  stats: [
    { section: 'Touchdowns — Most', rows: [
      { label: 'Single Week', value: '11', holders: [{ name: 'NJ vs. Bodge', context: 'Wk 9, 2025' }] },
      { label: 'Season, All-Time', value: '118', holders: [{ name: 'Okarp', context: '2024' }] },
    ]},
    { section: 'Passing Yards — Most', rows: [
      { label: 'Single Week', value: '441', holders: [{ name: 'Gill vs. RB', context: 'Wk 5, 2025' }] },
    ]},
    { section: 'Rushing Yards — Most', rows: [
      { label: 'Single Week', value: '392', holders: [{ name: 'Zai vs. Mr', context: 'Wk 8, 2025' }] },
    ]},
    { section: 'Receiving Yards — Most', rows: [
      { label: 'Season, All-Time', value: '6,210', holders: [{ name: 'Twizzy', context: '2024' }] },
    ]},
    { section: 'Field Goals — Most', rows: [
      { label: 'Season, All-Time', value: '41', holders: [{ name: 'Rooby', context: '2023' }] },
    ]},
  ],
  fun: [
    { section: 'Streaks & Droughts', rows: [
      { label: 'Longest Active Playoff Drought', value: '3 seasons', holders: [{ name: 'Bodge' }] },
      { label: 'Most Consecutive Last-Place Finishes', value: '2', holders: [{ name: 'Mr' }] },
    ]},
    { section: 'Extremes', rows: [
      { label: 'Highest Score in a Loss ("Beautiful Loser")', value: '148.2', holders: [{ name: 'RB', context: 'Wk 9, 2024' }] },
      { label: 'Worst Record to Still Make Playoffs', value: '6-7', holders: [{ name: 'Skeo', context: '2023' }] },
    ]},
    { section: 'Bad Decisions', rows: [
      { label: 'Most Points Left on Bench, Single Week', value: '61.4', holders: [{ name: 'Twizzy', context: 'Wk 11, 2024' }] },
      { label: 'Longest Bench Player Left In', value: '11 wks', holders: [{ name: 'Bronnie', context: '2025' }] },
    ]},
    { section: 'Championship Lore', rows: [
      { label: 'Most Championships', value: '1', holders: [{ name: 'NJ' }] },
      { label: 'Most Runner-Up Finishes ("Bridesmaid")', value: '2', holders: [{ name: 'Zai' }] },
    ]},
  ],
};

const CHAMPIONS = [
  { year: 2025, champion: 'Skeo', runnerUp: 'NJ', third: 'Rooby', lastPlace: 'Twizzy', toiletBowlWinner: 'Okarp', toiletBowlLoser: 'Twizzy', mostPF: 'Glo pup', mostPA: 'Glo pup', badDivWinner: 'Skeo', goodDivWinner: 'NJ' },
  { year: 2024, champion: 'Gill', runnerUp: 'Okarp', third: 'Bodge', lastPlace: 'Glo pup', toiletBowlWinner: 'RB', toiletBowlLoser: 'Glo pup', mostPF: 'Okarp', mostPA: 'Zai', badDivWinner: 'Bodge', goodDivWinner: 'Gill' },
  { year: 2023, champion: 'RB', runnerUp: 'NJ', third: 'Zai', lastPlace: 'Rooby', toiletBowlWinner: 'Bodge', toiletBowlLoser: 'Rooby', mostPF: 'Zai', mostPA: 'Rooby', badDivWinner: 'Zai', goodDivWinner: 'RB' },
  { year: 2022, champion: 'Okarp', runnerUp: 'Bodge', third: 'Bronnie', lastPlace: 'Zai', toiletBowlWinner: 'Gill', toiletBowlLoser: 'Zai', mostPF: 'Gill', mostPA: 'Zai', badDivWinner: 'Bronnie', goodDivWinner: 'Bodge' }, // unverified — played under a separate, unlinked Yahoo league. Division names that year were "Straight Men" (Bronnie) and "Gay Men" (Bodge)
];

// Generates a plausible full 12-team season standings table for a given
// year, deterministically from the year + team nick so it's consistent
// every render. Real seasons replace this once Yahoo history connects.
function generateSeasonStandingsByDivision(year) {
  const buildRows = (teams) =>
    teams
      .map((t) => {
        const seed = hashNick(t.nick + year);
        const w = 3 + (seed % 10);
        const l = 13 - w;
        const divW = Math.min(w, 2 + (seed % 4));
        const divL = 6 - divW;
        const pf = 1150 + (seed % 500);
        const pa = 1150 + ((seed * 7) % 500);
        return { nick: t.nick, team: t.team, owner: t.owner, w, l, divW, divL, pf, pa };
      })
      .sort((a, b) => (b.w / (b.w + b.l)) - (a.w / (a.w + a.l)));

  return {
    bad: buildRows(BAD_LITTLE_BOYS),
    good: buildRows(GOOD_LITTLE_BOYS),
  };
}

const NAV_LINKS = [
  { id: 'home', label: 'Home', icon: Flame },
  { id: 'standings', label: 'Standings', icon: Trophy },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
  { id: 'playoffs', label: 'Playoff Picture', icon: Award },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'draft', label: 'Draft', icon: Shuffle },
  { id: 'records', label: 'Record Book', icon: BookOpen },
  { id: 'trophyroom', label: 'Trophy Room', icon: Trophy },
  { id: 'power', label: 'Power Rankings', icon: TrendingUp },
  { id: 'moves', label: 'Transactions', icon: Swords },
  { id: 'whatif', label: 'What If Simulator', icon: Shuffle },
  { id: 'newsroom', label: 'Newsroom', icon: Newspaper },
  { id: 'constitution', label: 'Constitution', icon: FileText },
];

const JUMP_TO_ORDER = [
  'teams', 'schedule', 'standings', 'power', 'playoffs', 'moves',
  'draft', 'newsroom', 'constitution', 'whatif', 'records', 'trophyroom',
];

const DRAFT_DATE = new Date('2026-07-25T09:45:00-04:00');
const TRADE_DEADLINE = new Date('2026-12-05T23:59:00-05:00');

// ============================= SMALL PIECES =============================
function useCountdown(target) {
  const [remaining, setRemaining] = useState(target - new Date());
  useEffect(() => {
    const t = setInterval(() => setRemaining(target - new Date()), 30000);
    return () => clearInterval(t);
  }, [target]);
  return {
    days: Math.max(0, Math.floor(remaining / 86400000)),
    hours: Math.max(0, Math.floor((remaining / 3600000) % 24)),
    mins: Math.max(0, Math.floor((remaining / 60000) % 60)),
    passed: remaining <= 0,
  };
}

function Digits({ value, c }) {
  return <span style={{ fontFamily: MONO, color: c.accent, textShadow: c.accentGlow }}>{value.toFixed(1)}</span>;
}

function SectionHeader({ title, c, accent }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1.5 h-6" style={{ backgroundColor: accent }} />
      <h3 className="text-2xl uppercase" style={{ fontFamily: DISPLAY, letterSpacing: '0.02em', color: c.text }}>{title}</h3>
    </div>
  );
}

function Panel({ c, children, style }) {
  return <div className="rounded-lg border" style={{ backgroundColor: c.panel, borderColor: c.border, ...style }}>{children}</div>;
}

// ============================= NAV DRAWER =============================
function NavDrawer({ open, onClose, onNavigate, c, accent, page }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, backgroundColor: 'rgba(0,0,0,0.5)', opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.25s' }} />
      <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50, width: 260, backgroundColor: c.bg, borderRight: `1px solid ${c.border}`, transform: open ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.28s ease', overflowY: 'auto' }}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: c.border }}>
          <span className="text-lg uppercase" style={{ fontFamily: DISPLAY, color: c.text }}>Menu<span style={{ color: accent }}>.</span></span>
          <button onClick={onClose} className="p-1.5 rounded-md" style={{ color: c.text }}><X size={18} /></button>
        </div>
        <div className="py-2">
          {NAV_LINKS.map((l) => {
            const Icon = l.icon;
            const active = page === l.id;
            return (
              <button key={l.id} onClick={() => onNavigate(l.id)} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-left"
                style={{ color: active ? accent : c.text, backgroundColor: active ? c.panelAlt : 'transparent' }}>
                <Icon size={16} style={{ color: active ? accent : c.subtextFaint }} />
                {l.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ============================= HOME =============================
const SEASON_TIMERS = [
  { id: 'draft', label: 'Draft', target: new Date('2026-07-25T09:45:00-04:00'), sub: 'July 25 \u00b7 9:45 AM ET' },
  { id: 'trade', label: 'Trade Deadline', target: new Date('2026-12-05T23:59:00-05:00'), sub: 'December 5 \u00b7 11:59 PM ET' },
  { id: 'playoffs', label: 'Playoffs Start', target: new Date('2026-12-10T20:15:00-05:00'), sub: 'December 10 \u00b7 8:15 PM ET' },
  { id: 'champion', label: 'Champion Crowned', target: new Date('2027-01-04T23:59:00-05:00'), sub: 'January 4 \u00b7 11:59 PM ET' },
];

function TimerCard({ timer, c, accent }) {
  const { days, hours, mins, passed } = useCountdown(timer.target);
  if (passed) return null;
  return (
    <Panel c={c} style={{ padding: 14, marginBottom: 8, borderColor: accent }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: c.subtextFaint }}>{timer.label}</div>
          <div className="text-[10px]" style={{ color: c.subtext }}>{timer.sub}</div>
        </div>
        <div className="flex gap-2.5">
          {[{ v: days, l: 'D' }, { v: hours, l: 'H' }, { v: mins, l: 'M' }].map((u) => (
            <div key={u.l} className="text-center">
              <span className="text-lg font-bold" style={{ fontFamily: MONO, color: c.text }}>{String(u.v).padStart(2, '0')}</span>
              <span className="text-[9px] ml-0.5" style={{ color: c.subtextFaint }}>{u.l}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function StackedTimers({ c, accent }) {
  return (
    <div className="mb-5">
      {SEASON_TIMERS.map((t) => <TimerCard key={t.id} timer={t} c={c} accent={accent} />)}
    </div>
  );
}

function QuickLinks({ c, accent, onNavigate }) {
  const links = JUMP_TO_ORDER.map((id) => NAV_LINKS.find((l) => l.id === id));
  return (
    <div className="grid grid-cols-3 gap-2 mb-6">
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <button key={l.id} onClick={() => onNavigate(l.id)} className="flex flex-col items-center justify-center gap-1.5 rounded-lg border py-3.5" style={{ backgroundColor: c.panel, borderColor: c.border }}>
            <Icon size={17} style={{ color: accent }} />
            <span className="text-[10px] font-medium text-center leading-tight" style={{ color: c.text }}>{l.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function HomePage({ c, accent, onNavigate }) {
  return (
    <div>
      <StackedTimers c={c} accent={accent} />

      <Panel c={c} style={{ padding: 16, marginBottom: 20 }}>
        <div className="flex items-center gap-2 mb-3">
          <DollarSign size={16} style={{ color: c.accent }} />
          <h3 className="font-semibold text-sm uppercase tracking-wide" style={{ color: c.text }}>What's on the Line</h3>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div><div className="text-xl font-bold" style={{ fontFamily: MONO, color: c.accent }}>$1,350</div><div className="text-[10px]" style={{ color: c.subtextFaint }}>League Champion</div></div>
          <div><div className="text-xl font-bold" style={{ fontFamily: MONO, color: c.text }}>$150</div><div className="text-[10px]" style={{ color: c.subtextFaint }}>Finalist</div></div>
          <div><div className="text-xl font-bold" style={{ fontFamily: MONO, color: c.text }}>$300</div><div className="text-[10px]" style={{ color: c.subtextFaint }}>High Scorer</div></div>
        </div>
        <div className="flex items-center gap-2 pt-3 border-t" style={{ borderColor: c.borderSoft }}>
          <Shirt size={13} style={{ color: c.rival }} />
          <span className="text-xs" style={{ color: c.subtext }}>Last place buys the champ a jersey of their choice. $150 fee due draft day.</span>
        </div>
      </Panel>

      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>Jump To</div>
      <QuickLinks c={c} accent={accent} onNavigate={onNavigate} />
    </div>
  );
}

const NEWS_STORIES = [
  { tag: 'Commissioner', title: 'New Rivalry Series Rules Drop for 2026', sub: 'Same two weeks, same opponent, real money on it now.', date: '7/10/2026',
    body: "The commissioner's office made it official this week: the mid-season rivalry series returns for weeks 3 and 4, and this year there's real money on the line. The winner of each rivalry pair takes $25 from the loser, with series ties broken by cumulative points across both weeks.\n\nRival pairings were set at the annual rules meeting using a mix of standings history, personal history, and a healthy amount of league politics. Expect the group chat to get considerably louder once these matchups go live." },
  { tag: 'Preview', title: 'Draft Order Has Been Locked In', sub: 'Twelve names, one order, plenty of complaining already.', date: '7/12/2026',
    body: "The 2026 draft order is set, decided by random draw and witnessed live by the full ownership group per league rules. As always, at least two managers are already convinced the process was rigged against them.\n\nWith the draft just two weeks out, expect mock drafts, trade rumors, and at least one owner threatening to punt the whole season before a single pick is made." },
  { tag: 'Power Rankings', title: 'Title Defense Season Begins', sub: 'Winning it once was the easy part.', date: '7/15/2026',
    body: "Defending a championship is a different kind of pressure than chasing one. Last year's champion enters 2026 as the target, not the underdog, and the rest of the league has had all offseason to plan for it.\n\nEarly power rankings have the reigning champ starting outside the top spot for the first time in over a year — not because the roster got worse, but because everyone else got better." },
  { tag: 'Recap', title: 'Week 1 Delivers Exactly the Chaos Everyone Expected', sub: 'A double-digit favorite lost. Obviously.', date: '9/8/2026',
    body: "Week 1 is always a little bit of a lie — small sample size, new rosters, nobody really knows anything yet — and this year's opener delivered on that promise. A double-digit favorite dropped a shootout, two teams combined for the highest total of the young season, and at least one lineup decision will be brought up in the group chat for months.\n\nEarly overreactions are, as always, encouraged." },
];

const NEWS_TAGS = ['All', 'Commissioner', 'Preview', 'Recap', 'Power Rankings'];

function NewsroomPage({ c, accent }) {
  const [filter, setFilter] = useState('All');
  const [openStory, setOpenStory] = useState(null);

  const filtered = filter === 'All' ? NEWS_STORIES : NEWS_STORIES.filter((s) => s.tag === filter);

  if (openStory) {
    return (
      <div>
        <button onClick={() => setOpenStory(null)} className="text-xs font-medium mb-4" style={{ color: accent }}>&larr; Back to Newsroom</button>
        <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: accent }}>{openStory.tag}</div>
        <h2 className="text-xl font-bold mb-1" style={{ color: c.text }}>{openStory.title}</h2>
        <div className="text-[10px] mb-4" style={{ color: c.subtextFaint }}>{openStory.date}</div>
        {openStory.body.split('\n\n').map((p, i) => (
          <p key={i} className="text-sm mb-3" style={{ color: c.subtext, lineHeight: 1.6 }}>{p}</p>
        ))}
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Newsroom" c={c} accent={accent} />
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {NEWS_TAGS.map((t) => (
          <button key={t} onClick={() => setFilter(t)} className="text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap border"
            style={{ backgroundColor: filter === t ? accent : 'transparent', color: filter === t ? '#0A0D0A' : c.subtext, borderColor: filter === t ? accent : c.border }}>
            {t}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map((s) => (
          <button key={s.title} onClick={() => setOpenStory(s)} className="w-full text-left">
            <Panel c={c} style={{ padding: 12 }}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: c.accent }}>{s.tag}</div>
                  <div className="text-sm font-semibold" style={{ color: c.text }}>{s.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: c.subtext }}>{s.sub}</div>
                  <div className="text-[9px] mt-1" style={{ color: c.subtextFaint }}>{s.date}</div>
                </div>
                <ChevronRight size={16} style={{ color: c.subtextFaint, flexShrink: 0 }} />
              </div>
            </Panel>
          </button>
        ))}
        {filtered.length === 0 && <div className="text-xs text-center py-8" style={{ color: c.subtextFaint }}>No stories in this category yet.</div>}
      </div>
    </div>
  );
}

// ============================= STANDINGS =============================
function sortTeams(teams, order) {
  return [...teams].sort((a, b) => {
    const winPctDiff = (b.w / (b.w + b.l || 1)) - (a.w / (a.w + a.l || 1));
    if (winPctDiff !== 0) return winPctDiff;
    for (const key of order) {
      const diff = TIEBREAKERS[key].fn(b) - TIEBREAKERS[key].fn(a);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

function TiebreakerPicker({ order, setOrder, c, label }) {
  const handleChange = (idx, val) => { const next = [...order]; next[idx] = val; setOrder(next); };
  return (
    <div className="mb-3">
      {label && <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: c.subtextFaint }}>{label}</div>}
      <div className="flex flex-wrap gap-3 p-3 rounded-lg border" style={{ backgroundColor: c.panel, borderColor: c.border }}>
        {order.map((val, idx) => (
          <div key={idx} className="flex-1" style={{ minWidth: 100 }}>
            <label className="text-[10px] uppercase tracking-wider block mb-1" style={{ color: c.subtextFaint }}>Tiebreaker {idx + 1}</label>
            <select value={val} onChange={(e) => handleChange(idx, e.target.value)} className="w-full text-sm rounded-md px-2 py-1.5 border font-medium" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
              {Object.entries(TIEBREAKERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function StandingsTable({ title, teams, accentBar, c, rankMap }) {
  const sorted = [...teams].sort((a, b) => rankMap[a.nick] - rankMap[b.nick]);
  return (
    <div className="mb-6">
      <SectionHeader title={title} c={c} accent={accentBar} />
      <Panel c={c} style={{ overflowX: 'auto' }}>
        <table className="w-full text-sm" style={{ minWidth: 520 }}>
          <thead>
            <tr className="uppercase text-[11px] tracking-wider border-b" style={{ color: c.subtextFaint, borderColor: c.border }}>
              <th className="text-left py-2.5 pl-4 font-medium">Seed</th>
              <th className="text-left py-2.5 font-medium">Team</th>
              <th className="text-center py-2.5 font-medium">W-L</th>
              <th className="text-center py-2.5 font-medium">Div</th>
              <th className="text-center py-2.5 font-medium">Strk</th>
              <th className="text-right py-2.5 font-medium">PF</th>
              <th className="text-right py-2.5 pr-4 font-medium">PA</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.nick} className="border-b last:border-0" style={{ borderColor: c.borderSoft }}>
                <td className="py-3 pl-4" style={{ fontFamily: MONO, color: c.subtext }}>{rankMap[t.nick]}</td>
                <td className="py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28, backgroundColor: c.panelAlt, border: `1px solid ${c.border}`, fontSize: 10, fontWeight: 700, color: c.subtext }}>
                      {displayName(t.nick).slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold" style={{ color: c.text }}>{t.team}</div>
                      <div className="text-xs" style={{ color: c.subtextFaint }}>{t.owner}</div>
                    </div>
                  </div>
                </td>
                <td className="py-3 text-center" style={{ fontFamily: MONO, color: c.subtext }}>{t.w}-{t.l}</td>
                <td className="py-3 text-center" style={{ fontFamily: MONO, color: c.subtext }}>{t.divW}-{t.divL}</td>
                <td className="py-3 text-center">
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ color: t.streak[0] === 'W' ? c.win : c.loss, backgroundColor: t.streak[0] === 'W' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)' }}>
                    {t.streak}
                  </span>
                </td>
                <td className="py-3 text-right"><Digits value={t.pf} c={c} /></td>
                <td className="py-3 pr-4 text-right" style={{ fontFamily: MONO, color: c.subtextFaint }}>{t.pa.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function buildOverallRankMap(divOrder, restOrder, teamsByDiv) {
  // Three divisions now (Bad/Mid/Good Little Boys). Only the 2 BEST
  // division winners get byes (seeds 1-2) — the 3rd division winner
  // gets no special treatment and is seeded purely on merit alongside
  // everyone else for seeds 3-12.
  const bad = teamsByDiv ? teamsByDiv['Bad Little Boys'] : BAD_LITTLE_BOYS;
  const mid = teamsByDiv ? teamsByDiv['Mid Little Boys'] : MID_LITTLE_BOYS;
  const good = teamsByDiv ? teamsByDiv['Good Little Boys'] : GOOD_LITTLE_BOYS;

  const compareByRest = (a, b) => {
    const winPctDiff = (b.w / (b.w + b.l || 1)) - (a.w / (a.w + a.l || 1));
    if (winPctDiff !== 0) return winPctDiff;
    for (const key of restOrder) {
      const diff = TIEBREAKERS[key].fn(b) - TIEBREAKERS[key].fn(a);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  const badWinner = sortTeams(bad, divOrder)[0];
  const midWinner = sortTeams(mid, divOrder)[0];
  const goodWinner = sortTeams(good, divOrder)[0];

  const allDivWinners = [badWinner, midWinner, goodWinner].sort(compareByRest);
  const byeWinners = allDivWinners.slice(0, 2); // seeds 1-2

  const rest = sortTeams(
    [...bad, ...mid, ...good].filter(
      (t) => !byeWinners.some((w) => w.nick === t.nick)
    ),
    restOrder
  );

  const ordered = [...byeWinners, ...rest];
  const map = {};
  ordered.forEach((t, i) => { map[t.nick] = i + 1; });
  return map;
}

function StandingsPage({ c, accent, divOrder, setDivOrder, restOrder, setRestOrder }) {
  const { data: liveData, loading, error } = useLiveStandings();
  const rankMap = buildOverallRankMap(divOrder, restOrder, liveData);

  const bad = liveData ? liveData['Bad Little Boys'] : BAD_LITTLE_BOYS;
  const mid = liveData ? liveData['Mid Little Boys'] : MID_LITTLE_BOYS;
  const good = liveData ? liveData['Good Little Boys'] : GOOD_LITTLE_BOYS;

  return (
    <div>
      <div className="mb-3 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        {loading && 'Loading live standings from Yahoo…'}
        {!loading && error && `Couldn't load live data (${error}) \u2014 showing sample data instead.`}
        {!loading && !error && 'Live from Yahoo.'} Seed reflects overall standing across all 12 teams: the 2 best division winners hold seeds 1-2 (byes), everyone else &mdash; including the 3rd division winner &mdash; is seeded 3-12 by record regardless of division. Tiebreakers only apply when W-L records are actually tied.
      </div>
      <TiebreakerPicker order={divOrder} setOrder={setDivOrder} c={c} label="Division Winner Tiebreakers" />
      <TiebreakerPicker order={restOrder} setOrder={setRestOrder} c={c} label="Rest of Seeding Tiebreakers" />
      <div className="mb-2" />
      <StandingsTable title="Bad Little Boys" teams={bad} accentBar={accent} c={c} rankMap={rankMap} />
      <StandingsTable title="Mid Little Boys" teams={mid} accentBar={c.win} c={c} rankMap={rankMap} />
      <StandingsTable title="Good Little Boys" teams={good} accentBar={c.rival} c={c} rankMap={rankMap} />
    </div>
  );
}

// ============================= SCHEDULE =============================
function SchedulePage({ c, accent }) {
  const [week, setWeek] = useState(1);
  const { data: liveMatchups, loading, error } = useLiveSchedule(week);
  const weekNums = liveMatchups || !error ? Array.from({ length: 17 }, (_, i) => i + 1) : Object.keys(SCHEDULE_WEEKS).map(Number);
  const matchups = liveMatchups || SCHEDULE_WEEKS[week] || SCHEDULE_WEEKS[1];

  const anyRealScores = matchups.some((m) => m.hs !== null);
  const awards = anyRealScores
    ? (() => {
        const scored = matchups.flatMap((m) => [{ team: displayName(m.home), val: m.hs }, { team: displayName(m.away), val: m.as }]);
        const high = scored.reduce((a, b) => (b.val > a.val ? b : a));
        const low = scored.reduce((a, b) => (b.val < a.val ? b : a));
        const margins = matchups.map((m) => ({ label: `${displayName(m.home)} vs ${displayName(m.away)}`, margin: Math.abs(m.hs - m.as) }));
        const closest = margins.reduce((a, b) => (b.margin < a.margin ? b : a));
        const blowout = margins.reduce((a, b) => (b.margin > a.margin ? b : a));
        return [
          { label: 'High Score', team: high.team, val: high.val.toFixed(1) },
          { label: 'Low Score', team: low.team, val: low.val.toFixed(1) },
          { label: 'Closest Game', team: closest.label, val: `${closest.margin.toFixed(1)} pt margin` },
          { label: 'Biggest Blowout', team: blowout.label, val: `${blowout.margin.toFixed(1)} pt margin` },
        ];
      })()
    : [
        { label: 'High Score', team: 'NJ', val: '145.9' },
        { label: 'Low Score', team: 'Twizzy', val: '88.1' },
        { label: 'Closest Game', team: 'Glo pup vs Gill', val: '3.4 pt margin' },
        { label: 'Biggest Blowout', team: 'NJ vs Zai', val: '47.6 pt margin' },
      ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionHeader title={`Week ${week}`} c={c} accent={accent} />
        <select value={week} onChange={(e) => setWeek(Number(e.target.value))} className="text-sm rounded-md px-2.5 py-1.5 border font-medium" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
          {weekNums.map((w) => <option key={w} value={w}>Week {w}</option>)}
        </select>
      </div>

      <div className="mb-3 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        {loading && 'Loading live matchups from Yahoo…'}
        {!loading && error && `Couldn't load live data (${error}) \u2014 showing sample data instead.`}
        {!loading && !error && 'Live from Yahoo.'}
      </div>

      <div className="grid grid-cols-4 gap-2 mb-5">
        {awards.map((a) => (
          <Panel key={a.label} c={c} style={{ padding: 10 }}>
            <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: c.subtextFaint }}>{a.label}</div>
            <div className="text-xs font-semibold leading-tight" style={{ color: c.text }}>{expandNames(a.team)}</div>
            <div className="text-[10px]" style={{ fontFamily: MONO, color: c.subtextFaint }}>{a.val}</div>
          </Panel>
        ))}
      </div>

      <div className="space-y-3">
        {matchups.map((m, i) => {
          const homeWin = m.hs !== null && m.hs > m.as;
          const showProjected = m.hs === null;
          return (
            <Panel key={i} c={c} style={{ padding: 16, position: 'relative' }}>
              <div className="flex items-center gap-1.5 mb-2">
                {m.rival && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded flex items-center gap-1 text-white" style={{ backgroundColor: c.rival }}>
                    <Swords size={9} /> Rivalry
                  </span>
                )}
                <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded" style={{ color: m.div ? accent : c.subtextFaint, backgroundColor: c.panelAlt }}>
                  {m.div ? 'Divisional' : 'Crossover'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-semibold" style={{ color: homeWin || showProjected ? c.text : c.subtext }}>{displayName(m.home)}</div>
                  {showProjected
                    ? <span className="text-xs" style={{ color: c.subtextFaint }}>Proj. {(m.homeProj || 0).toFixed(1)}</span>
                    : <Digits value={m.hs} c={c} />}
                </div>
                <div className="text-xs px-3" style={{ fontFamily: MONO, color: c.subtextFaint }}>VS</div>
                <div className="flex-1 text-right">
                  <div className="font-semibold" style={{ color: !homeWin || showProjected ? c.text : c.subtext }}>{displayName(m.away)}</div>
                  {showProjected
                    ? <span className="text-xs" style={{ color: c.subtextFaint }}>Proj. {(m.awayProj || 0).toFixed(1)}</span>
                    : <Digits value={m.as} c={c} />}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

// ============================= PLAYOFF BRACKET =============================
const BKT_BOX_W = 168;
const BKT_BOX_H = 36;
const BKT_GAP_PAIR = 12;   // gap between the 2 boxes in a Round 1 pair
const BKT_GAP_HALF = 16;   // gap between a bye box and its adjacent pair
const BKT_GAP_HALVES = 40; // gap between the top half and bottom half
const BKT_COL_GAP = 40;    // horizontal gap between columns

function BracketBox({ team, c, bye, x, y, highlight }) {
  return (
    <div
      className="rounded-md border px-3 flex items-center absolute"
      style={{
        left: x, top: y, width: BKT_BOX_W, height: BKT_BOX_H,
        backgroundColor: bye ? c.panelAlt : c.panel,
        borderColor: bye || highlight ? c.accent : c.border,
      }}
    >
      <span className="text-xs font-medium truncate" style={{ color: c.text }}>{team}</span>
    </div>
  );
}

// A straight or elbow connector line between two vertical y-centers, ending
// in a stub that continues to the next column.
function BracketConnector({ x, topY, bottomY, stubToX, c, straight }) {
  if (straight) {
    // Single source (a bye) — just a straight horizontal line across.
    return <div style={{ position: 'absolute', left: x, top: topY, width: stubToX - x, borderTop: `2px solid ${c.accent}` }} />;
  }
  const midY = (topY + bottomY) / 2;
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: topY, bottom: undefined, height: bottomY - topY, width: 20, borderRight: `2px solid ${c.border}`, borderTop: `2px solid ${c.border}`, borderBottom: `2px solid ${c.border}` }} />
      <div style={{ position: 'absolute', left: x + 20, top: midY, width: stubToX - (x + 20), borderTop: `2px solid ${c.border}` }} />
    </>
  );
}

function PlacementGameBox({ title, top, bottom, c, x, y, width }) {
  return (
    <div className="rounded-md border overflow-hidden" style={{ position: 'absolute', left: x, top: y, width: width || BKT_BOX_W, borderColor: c.border }}>
      <div className="text-[10px] font-bold uppercase text-center py-1.5" style={{ backgroundColor: c.accent, color: '#0A0D0A' }}>{title}</div>
      <div className="text-xs font-medium px-2 py-2 border-b truncate" style={{ color: c.text, borderColor: c.borderSoft, backgroundColor: c.panel }}>{top}</div>
      <div className="text-xs font-medium px-2 py-2 truncate" style={{ color: c.text, backgroundColor: c.panel }}>{bottom}</div>
    </div>
  );
}

function BracketTree({ seeds, byeIds, matchups, roundLabel, roundNames, c }) {
  const nameOf = (n) => `${seeds[n] ? displayName(seeds[n].nick) : 'TBD'} (${n})`;
  const [r1Name, r2Name, r3Name, place3Name, place5Name] = roundNames;

  // ---- Round 1 Y positions ----
  const bye1Y = 0;
  const pair1TopY = BKT_BOX_H + BKT_GAP_HALF;
  const pair1BotY = pair1TopY + BKT_BOX_H + BKT_GAP_PAIR;
  const halfTopBottom = pair1BotY + BKT_BOX_H;

  const halfBotStart = halfTopBottom + BKT_GAP_HALVES;
  const pair2TopY = halfBotStart;
  const pair2BotY = pair2TopY + BKT_BOX_H + BKT_GAP_PAIR;
  const bye2Y = pair2BotY + BKT_BOX_H + BKT_GAP_HALF;

  const totalHeight = bye2Y + BKT_BOX_H;

  const bye1Center = bye1Y + BKT_BOX_H / 2;
  const pair1Center = (pair1TopY + pair1BotY + BKT_BOX_H) / 2;
  const pair2Center = (pair2TopY + pair2BotY + BKT_BOX_H) / 2;
  const bye2Center = bye2Y + BKT_BOX_H / 2;

  // ---- Round 2: each bye carries straight across and plays the winner
  // of its neighboring Round 1 pair. That's 4 real boxes: [bye1, winnerA]
  // as the top R2 match, [winnerB, bye2] as the bottom R2 match. ----
  const r2Box0Y = bye1Y;
  const r2Box1Y = pair1Center - BKT_BOX_H / 2;
  const r2Box2Y = pair2Center - BKT_BOX_H / 2;
  const r2Box3Y = bye2Y;

  const r2TopMatchCenter = (r2Box0Y + BKT_BOX_H / 2 + r2Box1Y + BKT_BOX_H / 2) / 2;
  const r2BotMatchCenter = (r2Box2Y + BKT_BOX_H / 2 + r2Box3Y + BKT_BOX_H / 2) / 2;

  // ---- Column X positions ----
  const r1X = 0;
  const r1LineX = BKT_BOX_W;
  const r2X = r1LineX + BKT_COL_GAP;
  const r2LineX = r2X + BKT_BOX_W;
  const r2MidX = r2LineX + BKT_COL_GAP;
  const r3X = r2MidX + BKT_COL_GAP;

  const r3Center = (r2TopMatchCenter + r2BotMatchCenter) / 2;

  const headerY = -28;
  const placementY = totalHeight + 36;
  const canvasHeight = placementY + 84;

  return (
    <div className="overflow-x-auto pb-2">
      <div style={{ position: 'relative', height: canvasHeight, minWidth: r3X + BKT_BOX_W, marginTop: 28 }}>
        {/* Round headers */}
        <div style={{ position: 'absolute', left: r1X, top: headerY, width: BKT_BOX_W }} className="text-[10px] font-bold uppercase text-center" >
          <span style={{ color: c.subtextFaint }}>{r1Name}</span>
        </div>
        <div style={{ position: 'absolute', left: r2X, top: headerY, width: BKT_BOX_W }} className="text-[10px] font-bold uppercase text-center">
          <span style={{ color: c.subtextFaint }}>{r2Name}</span>
        </div>
        <div style={{ position: 'absolute', left: r3X, top: headerY, width: BKT_BOX_W }} className="text-[10px] font-bold uppercase text-center">
          <span style={{ color: c.subtextFaint }}>{r3Name}</span>
        </div>

        {/* Round 1 */}
        <BracketBox team={nameOf(byeIds[0])} c={c} bye x={r1X} y={bye1Y} />
        <BracketBox team={nameOf(matchups[0][0])} c={c} x={r1X} y={pair1TopY} />
        <BracketBox team={nameOf(matchups[0][1])} c={c} x={r1X} y={pair1BotY} />
        <BracketBox team={nameOf(matchups[1][0])} c={c} x={r1X} y={pair2TopY} />
        <BracketBox team={nameOf(matchups[1][1])} c={c} x={r1X} y={pair2BotY} />
        <BracketBox team={nameOf(byeIds[1])} c={c} bye x={r1X} y={bye2Y} />

        {/* R1 -> R2 */}
        <BracketConnector x={r1LineX} topY={bye1Center} bottomY={bye1Center} stubToX={r2X} c={c} straight />
        <BracketConnector x={r1LineX} topY={pair1TopY + BKT_BOX_H / 2} bottomY={pair1BotY + BKT_BOX_H / 2} stubToX={r2X} c={c} />
        <BracketConnector x={r1LineX} topY={pair2TopY + BKT_BOX_H / 2} bottomY={pair2BotY + BKT_BOX_H / 2} stubToX={r2X} c={c} />
        <BracketConnector x={r1LineX} topY={bye2Center} bottomY={bye2Center} stubToX={r2X} c={c} straight />

        {/* Round 2 — 4 real boxes: 2 matches */}
        <BracketBox team={nameOf(byeIds[0])} c={c} bye x={r2X} y={r2Box0Y} />
        <BracketBox team="Lowest Remaining Seed" c={c} x={r2X} y={r2Box1Y} />
        <BracketBox team="2nd-Best Remaining Seed" c={c} x={r2X} y={r2Box2Y} />
        <BracketBox team={nameOf(byeIds[1])} c={c} bye x={r2X} y={r2Box3Y} />

        {/* R2 -> Final */}
        <BracketConnector x={r2LineX} topY={r2Box0Y + BKT_BOX_H / 2} bottomY={r2Box1Y + BKT_BOX_H / 2} stubToX={r2MidX} c={c} />
        <BracketConnector x={r2LineX} topY={r2Box2Y + BKT_BOX_H / 2} bottomY={r2Box3Y + BKT_BOX_H / 2} stubToX={r2MidX} c={c} />
        <BracketConnector x={r2MidX} topY={r2TopMatchCenter} bottomY={r2BotMatchCenter} stubToX={r3X} c={c} />

        {/* Final */}
        <BracketBox team={roundLabel} c={c} highlight x={r3X} y={r3Center - BKT_BOX_H / 2} />

        {/* Placement games, mirroring Yahoo's real bracket layout */}
        <PlacementGameBox
          title={place5Name}
          top="Loser — QF A"
          bottom="Loser — QF B"
          c={c}
          x={r2X}
          y={placementY}
        />
        <PlacementGameBox
          title={place3Name}
          top="Loser — Semifinal 1"
          bottom="Loser — Semifinal 2"
          c={c}
          x={r3X}
          y={placementY}
        />
      </div>
    </div>
  );
}

// Mock playoff-picture data: percentage odds, remaining strength of
// schedule (lower = easier), and games back from the last playoff spot.
const PLAYOFF_ODDS = {
  NJ: { odds: 96, sos: 42, gb: 0 }, Skeo: { odds: 71, sos: 55, gb: 0 },
  Okarp: { odds: 68, sos: 58, gb: 0 }, Zai: { odds: 74, sos: 51, gb: 0 },
  Rooby: { odds: 44, sos: 60, gb: 0.5 }, 'Glo pup': { odds: 38, sos: 49, gb: 1.0 },
  RB: { odds: 22, sos: 63, gb: 1.5 }, Gill: { odds: 19, sos: 57, gb: 1.5 },
  Twizzy: { odds: 9, sos: 66, gb: 2.5 }, Bronnie: { odds: 6, sos: 61, gb: 3.0 },
  Bodge: { odds: 2, sos: 70, gb: 4.0 }, Mr: { odds: 1, sos: 68, gb: 4.5 },
};

function PlayoffsPage({ c, accent, divOrder, restOrder }) {
  const [view, setView] = useState('playoff');
  const { data: liveData, loading, error, currentWeek } = useLiveStandings();
  const { result: oddsResult, loading: oddsLoading } = usePlayoffOdds(liveData, currentWeek, divOrder, restOrder);
  const rankMap = buildOverallRankMap(divOrder, restOrder, liveData);
  const allTeams = liveData
    ? [...liveData['Bad Little Boys'], ...liveData['Mid Little Boys'], ...liveData['Good Little Boys']]
    : [...BAD_LITTLE_BOYS, ...MID_LITTLE_BOYS, ...GOOD_LITTLE_BOYS];
  const bySeed = (seed) => allTeams.find((t) => rankMap[t.nick] === seed);

  const seeds = {};
  for (let i = 1; i <= 12; i++) seeds[i] = bySeed(i);

  return (
    <div>
      <SectionHeader title="Playoff Picture" c={c} accent={accent} />
      <div className="mb-4 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        {loading && 'Loading live standings from Yahoo…'}
        {!loading && error && `Couldn't load live data (${error}) \u2014 showing sample data instead.`}
        {!loading && !error && 'Built live from current Yahoo standings.'} Not official until playoffs actually begin (weeks 15&ndash;17). The bracket reseeds after every round: the highest remaining seed always plays the lowest remaining seed, comparing both winners against each other &mdash; so the #1 seed could face the winner of either Round 1 match, not just the one drawn next to it.
      </div>

      <div className="flex gap-1 mb-4 rounded-lg border p-1" style={{ borderColor: c.border, backgroundColor: c.panel }}>
        <button onClick={() => setView('playoff')} className="flex-1 text-xs font-semibold py-2 rounded-md" style={{ backgroundColor: view === 'playoff' ? c.panelAlt : 'transparent', color: view === 'playoff' ? c.text : c.subtextFaint }}>Playoff Bracket (1-6)</button>
        <button onClick={() => setView('toilet')} className="flex-1 text-xs font-semibold py-2 rounded-md" style={{ backgroundColor: view === 'toilet' ? c.panelAlt : 'transparent', color: view === 'toilet' ? c.text : c.subtextFaint }}>Toilet Bowl (7-12)</button>
      </div>

      <div className="mb-6">
        {view === 'playoff' ? (
          <BracketTree
            seeds={seeds}
            byeIds={[1, 2]}
            matchups={[[4, 5], [3, 6]]}
            roundLabel="Champion"
            roundNames={['Quarterfinal', 'Semifinal', 'Final', '3rd Place Game', '5th Place Game']}
            c={c}
          />
        ) : (
          <>
            <BracketTree
              seeds={seeds}
              byeIds={[7, 8]}
              matchups={[[10, 11], [9, 12]]}
              roundLabel="Toilet Bowl Winner"
              roundNames={['Quarterfinal', 'Semifinal', 'Final', '9th Place Game', '11th Place Game']}
              c={c}
            />
            <p className="text-xs mt-3" style={{ color: c.subtextFaint }}>Loser gets the jersey duty. No glory here, only consequences.</p>
          </>
        )}
      </div>

      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>Playoff Odds <span className="normal-case font-normal" style={{ color: c.subtextFaint, opacity: 0.7 }}>(simulated from real record, tiebreakers &amp; remaining schedule)</span></div>
      <div className="mb-3 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        {oddsLoading && 'Running the simulation against the real remaining schedule…'}
        {!oddsLoading && oddsResult && 'Recalculated weekly \u2014 based purely on real record, real tiebreakers, and the real remaining schedule. Simulates the rest of the season thousands of times to estimate each team\u2019s odds; pre-season, that means everyone starts as a true coin flip, with variance coming only from schedule structure and tiebreaker mechanics.'}
      </div>
      <div className="space-y-2">
        {allTeams
          .slice()
          .sort((a, b) => rankMap[a.nick] - rankMap[b.nick])
          .map((t) => {
            const nick = t.nick;
            const inPlayoffs = rankMap[nick] <= 6;
            const odds = oddsResult ? oddsResult.odds[nick] : 50;
            const sos = oddsResult ? oddsResult.sos[nick] : null;
            const sixthSeed = bySeed(6);
            const gb = !inPlayoffs && sixthSeed
              ? Math.max(0, ((sixthSeed.w - t.w) + (t.l - sixthSeed.l)) / 2)
              : 0;
            return (
              <Panel key={nick} c={c} style={{ padding: 12 }}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold" style={{ color: c.text }}>#{rankMap[nick]} &middot; {displayName(nick)}</span>
                  <span className="text-sm font-bold" style={{ fontFamily: MONO, color: inPlayoffs ? c.win : c.subtext }}>{odds}%</span>
                </div>
                <div className="flex items-center justify-between text-[10px]" style={{ color: c.subtextFaint }}>
                  <span>SOS remaining: {sos !== null ? sos : '\u2014'}</span>
                  {gb > 0 && <span>{gb} GB</span>}
                </div>
              </Panel>
            );
          })}
      </div>
    </div>
  );
}

// ============================= TEAMS =============================
// Mock "getting to know the guys" bio info — will be editable per-owner later.
const TEAM_BIOS = {
  NJ: { desc: 'Founder of the league and commissioner since its inception. Strong advocate for traditional fantasy football theories and rules. Fantasy football means enough to him that it’s on his resume.', location: 'Lunenburg, MA', accomplishments: 'Made the finals twice (hasn’t won yet); 10+ years of fantasy experience', blunders: 'Known in the league as a "boring" player who often rosters old/ugly fantasy players' },
  Skeo: { desc: 'Played fantasy briefly when younger, quit; a short 2022 comeback ended in a near-last-place finish. Extremely competitive, takes losses personally.', location: 'Sandwich, MA', accomplishments: 'Won the championship in his first season back as an expansion team', blunders: 'League rumors say his brother was the mastermind behind that title roster \u2014 he pushes back on it every time' },
  Rooby: { desc: 'Chaotic and a frequent trader, occasionally lucky but often self-sabotaging. The league is literally named after him.', location: 'Erie, PA', accomplishments: 'Runs a sports podcast/TikTok page', blunders: 'Once spent $99 FAAB on a player who got dropped weeks later; famously fell asleep on draft day' },
  Okarp: { desc: 'Former high school lineman with real football knowledge and a love of beer. Doesn’t look at fantasy until the day before the draft \u2014 still fields a decent squad every year.', location: 'New York, NY', accomplishments: 'Won the league in 2022', blunders: 'Known in the league for a running joke about his morning bathroom habits' },
  RB: { desc: 'Passionate about gambling and soccer. An AI enthusiast who loves making photos of friends and surroundings. Sales is his passion \u2014 it shows in trade talks.', location: 'Medford, MA', accomplishments: 'Won the 2023 championship', blunders: 'Finished dead last as a rookie in 2022' },
  Bronnie: { desc: 'Laid-back, sloth-like personality with solid football knowledge. Rookie-obsessed. Tends to go quiet with the league until it’s actually time to play.', location: 'Trumbull, CT', accomplishments: 'Still chasing his first championship', blunders: 'Famously skipped the 2025 draft for a bocce tournament' },
  Mr: { desc: 'Pronounced "Mur." Least opinionated league member; mainly dislikes losing his entry money. Would rather relax on the couch Sundays with beer and Popeyes than obsess over fantasy.', location: 'Lunenburg, MA', accomplishments: 'Joined the league in 2025', blunders: 'Often looked down on / taken advantage of in trades by cheekier managers' },
  Zai: { desc: 'Extremely obsessed with fantasy \u2014 a FantasyPros subscriber who won’t accept trades unless clearly winning. Winter hobbies: Rainbow Six Siege and crafting unfair trade proposals.', location: 'Lunenburg, MA', accomplishments: 'First-time co-commissioner in 2026', blunders: 'Has a running (dubious) claim that Nathan altered his lineup, costing him a semifinal' },
  'Glo pup': { desc: 'Most opinionated manager in the league. Real football knowledge and does real research. Strong supporter of median scoring and reducing luck.', location: 'Auburn, MA', accomplishments: 'Always executes a solid draft, despite being fully technology-challenged', blunders: 'If he loses, his instinct is that the rules need to change' },
  Gill: { desc: 'Experienced manager with strong football knowledge, very opinionated and strong-willed. Generally impartial but has strong opinions on a few select topics.', location: 'Auburn, MA', accomplishments: '2024 champion', blunders: 'Often either the best team or the worst team in the league \u2014 no in-between' },
  Twizzy: { desc: 'Ex-army photographer, now spends a lot of time scrolling reels. Drafts and trades players based on jersey color and perceived "aura"/drip status.', location: 'Nashua, NH', accomplishments: 'Loves Rocket League; the only movies that make him cry are Bollywood movies', blunders: 'Often ends up with injured players \u2014 unclear if it’s bad luck or bad drafting' },
  Bodge: { desc: 'Strong football knowledge and a chill personality when sober. Longtime player and a big sports gambler. Loves George Pickens and other hype-beast type players.', location: 'Boston, MA', accomplishments: 'Won the league during his freshman year of college; hosts the league’s in-person offline drafts', blunders: 'Whether hosting the draft is actually a good idea remains a running debate' },
};

function TeamsPage({ c, accent }) {
  const allTeams = [...BAD_LITTLE_BOYS, ...MID_LITTLE_BOYS, ...GOOD_LITTLE_BOYS];
  const [selected, setSelected] = useState(allTeams[0].nick);
  const team = allTeams.find((t) => t.nick === selected);
  const bio = TEAM_BIOS[selected];
  const [expanded, setExpanded] = useState(false);

  const otherTeams = allTeams.filter((t) => t.nick !== selected);

  return (
    <div>
      <SectionHeader title="Team Profiles" c={c} accent={accent} />
      <select value={selected} onChange={(e) => { setSelected(e.target.value); setExpanded(false); }} className="w-full text-sm rounded-md px-3 py-2 border font-medium mb-4" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
        {allTeams.map((t) => <option key={t.nick} value={t.nick}>{t.team}</option>)}
      </select>

      <Panel c={c} style={{ padding: 16, marginBottom: 8 }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 56, height: 56, backgroundColor: c.panelAlt, border: `2px solid ${accent}`, fontSize: 16, fontWeight: 700, color: c.text }}>
            {displayName(team.nick).slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-bold leading-tight" style={{ color: c.text }}>{team.team}</div>
            <div className="text-xs" style={{ color: c.subtextFaint }}>{team.owner}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><div className="text-lg font-bold" style={{ fontFamily: MONO, color: c.accent }}>{team.w}-{team.l}</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>2026 Record</div></div>
          <div><div className="text-lg font-bold" style={{ fontFamily: MONO, color: c.text }}>{team.pf.toFixed(0)}</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>Points For</div></div>
          <div><div className="text-lg font-bold" style={{ fontFamily: MONO, color: c.text }}>${team.faab}</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>FAAB Left</div></div>
        </div>
      </Panel>

      <button onClick={() => setExpanded(!expanded)} className="text-xs font-medium mb-3 flex items-center gap-1" style={{ color: c.accent }}>
        {expanded ? 'Hide profile ↑' : 'Get to know this manager ↓'}
      </button>

      {expanded && (
        <div className="space-y-4 mb-2">
          <Panel c={c} style={{ padding: 16 }}>
            <div className="text-xs mb-3" style={{ color: c.text }}>{bio?.desc}</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><div className="uppercase text-[9px] mb-0.5" style={{ color: c.subtextFaint }}>Location</div><div style={{ color: c.text }}>{bio?.location}</div></div>
              <div><div className="uppercase text-[9px] mb-0.5" style={{ color: c.subtextFaint }}>Owner</div><div style={{ color: c.text }}>{team.owner}</div></div>
            </div>
            <div className="mt-3 pt-3 border-t" style={{ borderColor: c.borderSoft }}>
              <div className="uppercase text-[9px] mb-1" style={{ color: c.win }}>Key Accomplishments</div>
              <div className="text-xs" style={{ color: c.text }}>{bio?.accomplishments}</div>
            </div>
            <div className="mt-3">
              <div className="uppercase text-[9px] mb-1" style={{ color: c.loss }}>Key Blunders</div>
              <div className="text-xs" style={{ color: c.text }}>{bio?.blunders}</div>
            </div>
          </Panel>

          <div>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>All-Time Stats</div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Panel c={c} style={{ padding: 10 }}><div className="text-base font-bold" style={{ fontFamily: MONO, color: c.text }}>1</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>1st Place Finishes</div></Panel>
              <Panel c={c} style={{ padding: 10 }}><div className="text-base font-bold" style={{ fontFamily: MONO, color: c.text }}>1</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>2nd Place Finishes</div></Panel>
              <Panel c={c} style={{ padding: 10 }}><div className="text-base font-bold" style={{ fontFamily: MONO, color: c.text }}>2</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>3rd Place Finishes</div></Panel>
              <Panel c={c} style={{ padding: 10 }}><div className="text-base font-bold" style={{ fontFamily: MONO, color: c.text }}>3.4</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>Avg. Standing</div></Panel>
              <Panel c={c} style={{ padding: 10 }}><div className="text-base font-bold" style={{ fontFamily: MONO, color: c.text }}>3</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>Playoff Appearances</div></Panel>
              <Panel c={c} style={{ padding: 10 }}><div className="text-base font-bold" style={{ fontFamily: MONO, color: c.text }}>5,624</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>All-Time PF</div></Panel>
              <Panel c={c} style={{ padding: 10 }}><div className="text-base font-bold" style={{ fontFamily: MONO, color: c.text }}>28</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>All-Time Adds/Drops</div></Panel>
              <Panel c={c} style={{ padding: 10 }}><div className="text-base font-bold" style={{ fontFamily: MONO, color: c.text }}>6</div><div className="text-[9px] uppercase" style={{ color: c.subtextFaint }}>All-Time Trades</div></Panel>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>All-Time Record vs. Everyone</div>
            <Panel c={c} style={{ overflow: 'hidden' }}>
              {otherTeams.map((t, i) => (
                <div key={t.nick} className="flex items-center justify-between px-3 py-2" style={{ borderBottom: i < otherTeams.length - 1 ? `1px solid ${c.borderSoft}` : 'none' }}>
                  <span className="text-xs" style={{ color: c.text }}>{displayName(t.nick)}</span>
                  <span className="text-xs" style={{ fontFamily: MONO, color: c.subtextFaint }}>{2 + (i % 3)}-{1 + (i % 2)}</span>
                </div>
              ))}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================= WHAT IF SIMULATOR =============================
function scheduleSwapResult(teamNick, otherNick) {
  const allTeams = [...BAD_LITTLE_BOYS, ...MID_LITTLE_BOYS, ...GOOD_LITTLE_BOYS];
  const team = allTeams.find((t) => t.nick === teamNick);
  const other = allTeams.find((t) => t.nick === otherNick);
  const seed = hashNick(teamNick + otherNick);
  const winDelta = (seed % 5) - 2; // -2 to +2
  const totalGames = team.w + team.l;
  const newW = Math.max(0, Math.min(totalGames, team.w + winDelta));
  const newL = totalGames - newW;

  let blurb;
  if (winDelta > 0) {
    blurb = `${displayName(other.nick)}'s schedule was noticeably softer, especially in the middle stretch of the season.`;
  } else if (winDelta < 0) {
    blurb = `${displayName(other.nick)}'s schedule was actually tougher than it looked \u2014 more games against the league's stronger teams.`;
  } else {
    blurb = `Surprisingly close to a wash \u2014 ${displayName(other.nick)}'s schedule was roughly the same difficulty, just with the tough matchups landing in different weeks.`;
  }

  return { actualRecord: `${team.w}-${team.l}`, newRecord: `${newW}-${newL}`, delta: winDelta, blurb };
}

function computeMedianStandings(divOrder, restOrder) {
  const adjust = (teams) => teams.map((t) => {
    // Median format: every week produces TWO results per team — the real
    // matchup outcome (already in t.w/t.l) plus a separate win/loss for
    // scoring above/below that week's league median. Across a 14-week
    // season that's up to 28 total decisions, not 14.
    const numWeeks = t.w + t.l;
    const seed = hashNick(t.nick + 'median');
    // Teams that already win more real games tend to also clear the
    // median more often, with some random variance layered in.
    const baseRate = t.w / (numWeeks || 1);
    const variance = ((seed % 21) - 10) / 100; // -0.10 to +0.10
    const medianWinRate = Math.max(0.1, Math.min(0.9, baseRate + variance));
    const medianW = Math.round(numWeeks * medianWinRate);
    const medianL = numWeeks - medianW;

    const combinedW = t.w + medianW;
    const combinedL = t.l + medianL;
    // Division record (divW/divL) is untouched — median comparisons don't
    // affect who you actually played, only your total win/loss tally.
    return { ...t, w: combinedW, l: combinedL };
  });

  const adjBad = adjust(BAD_LITTLE_BOYS);
  const adjMid = adjust(MID_LITTLE_BOYS);
  const adjGood = adjust(GOOD_LITTLE_BOYS);

  const compareByRest = (a, b) => {
    const winPctDiff = (b.w / (b.w + b.l || 1)) - (a.w / (a.w + a.l || 1));
    if (winPctDiff !== 0) return winPctDiff;
    for (const key of restOrder) {
      const diff = TIEBREAKERS[key].fn(b) - TIEBREAKERS[key].fn(a);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  const badWinner = sortTeams(adjBad, divOrder)[0];
  const midWinner = sortTeams(adjMid, divOrder)[0];
  const goodWinner = sortTeams(adjGood, divOrder)[0];
  const allDivWinners = [badWinner, midWinner, goodWinner].sort(compareByRest);
  const byeWinners = allDivWinners.slice(0, 2);

  const rest = sortTeams(
    [...adjBad, ...adjMid, ...adjGood].filter((t) => !byeWinners.some((w) => w.nick === t.nick)),
    restOrder
  );
  const ordered = [...byeWinners, ...rest];
  const rankMap = {};
  ordered.forEach((t, i) => { rankMap[t.nick] = i + 1; });

  return { bad: adjBad, mid: adjMid, good: adjGood, rankMap };
}

function WhatIfSimulatorPage({ c, accent }) {
  const allTeams = [...BAD_LITTLE_BOYS, ...MID_LITTLE_BOYS, ...GOOD_LITTLE_BOYS];
  const [mode, setMode] = useState('schedule');
  const [team, setTeam] = useState(allTeams[0].nick);
  const [other, setOther] = useState(allTeams[1].nick);
  const [result, setResult] = useState(null);
  const [medianStandings, setMedianStandings] = useState(null);

  const runSim = () => {
    if (mode === 'schedule') {
      setResult(scheduleSwapResult(team, other));
    } else {
      setMedianStandings(computeMedianStandings(['divRecord', 'pf', 'h2h'], ['pf', 'divRecord', 'h2h']));
    }
  };

  const MedianTable = ({ title, rows, accentBar, rankMap }) => {
    const sorted = [...rows].sort((a, b) => rankMap[a.nick] - rankMap[b.nick]);
    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-1.5 h-4" style={{ backgroundColor: accentBar }} />
          <span className="text-[10px] uppercase tracking-wider" style={{ color: c.subtextFaint }}>{title}</span>
        </div>
        <Panel c={c} style={{ overflowX: 'auto' }}>
          <table className="w-full text-xs" style={{ minWidth: 360 }}>
            <thead>
              <tr className="uppercase text-[9px] tracking-wider border-b" style={{ color: c.subtextFaint, borderColor: c.border }}>
                <th className="text-left py-2 pl-3 font-medium">Seed</th>
                <th className="text-left py-2 font-medium">Team</th>
                <th className="text-center py-2 font-medium">W-L</th>
                <th className="text-center py-2 pr-3 font-medium">Div</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.nick} style={{ borderBottom: `1px solid ${c.borderSoft}` }}>
                  <td className="py-2 pl-3" style={{ fontFamily: MONO, color: c.subtextFaint }}>{rankMap[t.nick]}</td>
                  <td className="py-2 font-semibold" style={{ color: c.text }}>{displayName(t.nick)}</td>
                  <td className="py-2 text-center" style={{ fontFamily: MONO, color: accent }}>{t.w}-{t.l}</td>
                  <td className="py-2 pr-3 text-center" style={{ fontFamily: MONO, color: c.subtextFaint }}>{t.divW}-{t.divL}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    );
  };

  return (
    <div>
      <SectionHeader title="What If Simulator" c={c} accent={accent} />
      <div className="mb-4 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        Sample logic shown &mdash; real simulations run off actual weekly scores once Yahoo is connected.
      </div>

      <div className="flex gap-1 mb-4 rounded-lg border p-1" style={{ borderColor: c.border, backgroundColor: c.panel }}>
        <button onClick={() => { setMode('schedule'); setResult(null); }} className="flex-1 text-xs font-semibold py-2 rounded-md"
          style={{ backgroundColor: mode === 'schedule' ? c.panelAlt : 'transparent', color: mode === 'schedule' ? c.text : c.subtextFaint }}>
          Someone Else's Schedule
        </button>
        <button onClick={() => { setMode('median'); setMedianStandings(null); }} className="flex-1 text-xs font-semibold py-2 rounded-md"
          style={{ backgroundColor: mode === 'median' ? c.panelAlt : 'transparent', color: mode === 'median' ? c.text : c.subtextFaint }}>
          Median Opponent
        </button>
      </div>

      <Panel c={c} style={{ padding: 16, marginBottom: 16 }}>
        {mode === 'schedule' && (
          <>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: c.subtextFaint }}>Your Team</div>
            <select value={team} onChange={(e) => { setTeam(e.target.value); setResult(null); }} className="w-full text-sm rounded-md px-3 py-2 border font-medium mb-3" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
              {allTeams.map((t) => <option key={t.nick} value={t.nick}>{t.team}</option>)}
            </select>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: c.subtextFaint }}>Borrow Schedule From</div>
            <select value={other} onChange={(e) => { setOther(e.target.value); setResult(null); }} className="w-full text-sm rounded-md px-3 py-2 border font-medium mb-3" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
              {allTeams.filter((t) => t.nick !== team).map((t) => <option key={t.nick} value={t.nick}>{t.team}</option>)}
            </select>
          </>
        )}

        {mode === 'median' && (
          <p className="text-xs mb-3" style={{ color: c.subtext }}>
            Recalculates the full league standings as if every team also had to score above the league's weekly median to notch a win &mdash; a common alternative format.
          </p>
        )}

        <button onClick={runSim} className="w-full text-sm font-semibold py-2.5 rounded-md" style={{ backgroundColor: accent, color: '#0A0D0A' }}>
          Run Simulation
        </button>
      </Panel>

      {mode === 'schedule' && result && (
        <Panel c={c} style={{ padding: 16 }}>
          <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: accent }}>Result</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: c.subtextFaint }}>Actual Record</div>
              <div className="text-xl font-bold" style={{ fontFamily: MONO, color: c.text }}>{result.actualRecord}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: c.subtextFaint }}>With {displayName(other)} Schedule</div>
              <div className="text-xl font-bold" style={{ fontFamily: MONO, color: result.delta > 0 ? c.win : result.delta < 0 ? c.loss : accent }}>{result.newRecord}</div>
            </div>
          </div>
          <p className="text-sm pt-3 border-t" style={{ color: c.subtext, borderColor: c.borderSoft, lineHeight: 1.6 }}>{result.blurb}</p>
        </Panel>
      )}

      {mode === 'median' && medianStandings && (
        <div>
          <MedianTable title="Bad Little Boys" rows={medianStandings.bad} accentBar={accent} rankMap={medianStandings.rankMap} />
          <MedianTable title="Mid Little Boys" rows={medianStandings.mid} accentBar={c.win} rankMap={medianStandings.rankMap} />
          <MedianTable title="Good Little Boys" rows={medianStandings.good} accentBar={c.rival} rankMap={medianStandings.rankMap} />
        </div>
      )}
    </div>
  );
}

// ============================= TROPHY ROOM =============================
function IconCount({ icon: Icon, count, color }) {
  if (!count) return <span style={{ color: 'inherit', opacity: 0.3 }}>&ndash;</span>;
  return (
    <span className="inline-flex items-center gap-1 justify-center">
      <Icon size={13} style={{ color }} />
      <span style={{ fontFamily: MONO, fontWeight: 700, color }}>{count}</span>
    </span>
  );
}

function TrophyRoomPage({ c, accent }) {
  const GOLD = '#FFD700';
  const SILVER = '#C0C0C0';
  const BRONZE = '#CD7F32';

  const counts = {};
  const bump = (nick, key) => {
    if (!counts[nick]) counts[nick] = { first: 0, second: 0, third: 0, points: 0, division: 0 };
    counts[nick][key]++;
  };
  CHAMPIONS.forEach((ch) => {
    bump(ch.champion, 'first');
    bump(ch.runnerUp, 'second');
    bump(ch.third, 'third');
    bump(ch.mostPF, 'points');
    bump(ch.badDivWinner, 'division');
    bump(ch.goodDivWinner, 'division');
  });
  const leaderboard = Object.entries(counts).sort((a, b) => b[1].first - a[1].first || b[1].second - a[1].second);

  return (
    <div>
      <SectionHeader title="Trophy Room" c={c} accent={accent} />

      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>All Time Podium Finishes</div>
      <Panel c={c} style={{ marginBottom: 24 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-xs" style={{ minWidth: 440 }}>
            <thead>
              <tr className="uppercase text-[9px] tracking-wider border-b" style={{ color: c.subtextFaint, borderColor: c.border }}>
                <th className="text-left py-2 pl-3 font-medium">Manager</th>
                <th className="text-center py-2 font-medium">1st</th>
                <th className="text-center py-2 font-medium">2nd</th>
                <th className="text-center py-2 font-medium">3rd</th>
                <th className="text-center py-2 font-medium">Pts</th>
                <th className="text-center py-2 pr-3 font-medium">Div</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map(([nick, ct], i) => (
                <tr key={nick} style={{ borderBottom: i < leaderboard.length - 1 ? `1px solid ${c.borderSoft}` : 'none' }}>
                  <td className="py-2.5 pl-3 font-semibold" style={{ color: c.text }}>{displayName(nick)}</td>
                  <td className="py-2.5 text-center"><IconCount icon={Trophy} count={ct.first} color={GOLD} /></td>
                  <td className="py-2.5 text-center"><IconCount icon={Trophy} count={ct.second} color={SILVER} /></td>
                  <td className="py-2.5 text-center"><IconCount icon={Trophy} count={ct.third} color={BRONZE} /></td>
                  <td className="py-2.5 text-center"><IconCount icon={Zap} count={ct.points} color={accent} /></td>
                  <td className="py-2.5 pr-3 text-center"><IconCount icon={Shield} count={ct.division} color={c.win} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>Year by Year</div>
      <div className="space-y-3">
        {CHAMPIONS.map((ch) => (
          <Panel key={ch.year} c={c} style={{ padding: 14 }}>
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} style={{ color: accent }} />
              <span className="text-base font-bold" style={{ color: c.text }}>{ch.year}</span>
            </div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs">
              <div><span style={{ color: c.subtextFaint }}>Winner: </span><span style={{ color: c.win, fontWeight: 700 }}>{displayName(ch.champion)}</span></div>
              <div><span style={{ color: c.subtextFaint }}>Finalist: </span><span style={{ color: c.text, fontWeight: 600 }}>{displayName(ch.runnerUp)}</span></div>
              <div><span style={{ color: c.subtextFaint }}>3rd Place: </span><span style={{ color: c.text }}>{displayName(ch.third)}</span></div>
              <div><span style={{ color: c.subtextFaint }}>Most Points: </span><span style={{ color: c.text }}>{displayName(ch.mostPF)}</span></div>
              <div><span style={{ color: c.subtextFaint }}>Bad Little Boys Winner: </span><span style={{ color: c.text }}>{displayName(ch.badDivWinner)}</span></div>
              <div><span style={{ color: c.subtextFaint }}>Good Little Boys Winner: </span><span style={{ color: c.text }}>{displayName(ch.goodDivWinner)}</span></div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

// Mock draft data — generated per team so every manager has a full class
// without hand-authoring 12 x 16 picks. Real data replaces this once the
// Yahoo draft results are connected.
const DRAFT_POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'TE', 'D/ST', 'K', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'];
const SAMPLE_PLAYERS = [
  'J. Chase', 'C. McCaffrey', 'B. Robinson', 'A. St. Brown', 'P. Nacua', 'T. Etienne',
  'D. Achane', 'M. Nabers', 'B. Bowers', 'J. Gibbs', 'D. Henry', 'A. Brown',
  'S. LaPorta', 'D. Adams', 'K. Williams', 'J. Jefferson', 'T. Kelce', 'J. Allen',
  'C. Lamb', 'R. Stevenson', 'D. London', 'J. Daniels', 'J. Downs', 'N. Collins',
];
const GRADE_OPTIONS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+'];

function hashNick(nick) {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) % 1000;
  return h;
}

function generateDraftClass(nick) {
  const seed = hashNick(nick);
  return DRAFT_POSITIONS.map((pos, i) => ({
    round: i + 1,
    pick: ((seed + i * 7) % 12) + 1,
    player: SAMPLE_PLAYERS[(seed + i * 3) % SAMPLE_PLAYERS.length],
    position: pos,
  }));
}

function draftGrades(nick) {
  const seed = hashNick(nick);
  return {
    pre: GRADE_OPTIONS[seed % GRADE_OPTIONS.length],
    post: GRADE_OPTIONS[(seed * 3) % GRADE_OPTIONS.length],
  };
}

function DraftPage({ c, accent }) {
  const allTeams = [...BAD_LITTLE_BOYS, ...MID_LITTLE_BOYS, ...GOOD_LITTLE_BOYS];
  const [selected, setSelected] = useState(allTeams[0].nick);
  const team = allTeams.find((t) => t.nick === selected);

  const { data: liveDraft, loading: draftLoading, error: draftError } = useLiveDraft();
  const { data: liveStandings } = useLiveStandings();

  const livePicks = liveDraft ? liveDraft[selected] : null;
  const picks = livePicks || generateDraftClass(selected);

  const liveGrade = liveStandings
    ? [...(liveStandings['Bad Little Boys'] || []), ...(liveStandings['Mid Little Boys'] || []), ...(liveStandings['Good Little Boys'] || [])]
        .find((t) => t.nick === selected)?.draftGrade
    : null;
  const mockGrades = draftGrades(selected);

  return (
    <div>
      <SectionHeader title="Draft" c={c} accent={accent} />
      <div className="mb-3 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        {draftLoading && 'Loading real draft results from Yahoo…'}
        {!draftLoading && draftError && `Couldn't load live draft data (${draftError}) \u2014 showing sample data instead.`}
        {!draftLoading && !draftError && 'Real 2026 draft results from Yahoo.'}
      </div>

      <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full text-sm rounded-md px-3 py-2 border font-medium mb-4" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
        {allTeams.map((t) => <option key={t.nick} value={t.nick}>{t.team}</option>)}
      </select>

      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>{team.team}'s Draft Class</div>
      <div className="space-y-1.5 mb-5">
        {picks.map((p) => (
          <Panel key={p.round} c={c} style={{ padding: '8px 12px' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] w-9 text-center flex-shrink-0" style={{ fontFamily: MONO, color: c.subtextFaint }}>R{p.round}</span>
                <span className="text-sm font-medium" style={{ color: c.text }}>{p.player}</span>
              </div>
              {p.position && <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded" style={{ color: c.subtextFaint, backgroundColor: c.panelAlt }}>{p.position}</span>}
            </div>
          </Panel>
        ))}
      </div>

      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>Draft Analysis</div>
      <div className="grid grid-cols-2 gap-3">
        <Panel c={c} style={{ padding: 14 }}>
          <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: c.subtextFaint }}>{liveGrade ? 'Yahoo Draft Grade' : 'Pre-Season Grade'}</div>
          <div className="text-3xl font-bold mb-2" style={{ fontFamily: MONO, color: accent }}>{liveGrade || mockGrades.pre}</div>
          <p className="text-xs" style={{ color: c.subtext }}>{liveGrade ? "Yahoo's own grade for this draft class, based on pick value and roster construction." : 'Reached slightly early on the RB2 spot but landed strong value at WR in the middle rounds.'}</p>
        </Panel>
        <Panel c={c} style={{ padding: 14 }}>
          <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: c.subtextFaint }}>Post-Season Grade</div>
          <div className="text-3xl font-bold mb-2" style={{ fontFamily: MONO, color: accent }}>{liveGrade ? '\u2014' : mockGrades.post}</div>
          <p className="text-xs" style={{ color: c.subtext }}>{liveGrade ? 'Updates once the season is underway and real performance data is in.' : 'Updates weekly. Early-round picks are outperforming their draft slot so far this season.'}</p>
        </Panel>
      </div>
    </div>
  );
}

function ChampionYearCard({ ch, c, accent }) {
  const [open, setOpen] = useState(false);
  const { rows, loading, error } = useSeasonDetail(ch.year);

  const MiniTable = ({ title, rows }) => (
    <div className="mb-3 last:mb-0">
      <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: c.subtextFaint }}>{title}</div>
      <table className="w-full text-xs" style={{ minWidth: 380 }}>
        <thead>
          <tr className="uppercase text-[9px] tracking-wider" style={{ color: c.subtextFaint }}>
            <th className="text-left pb-1.5">#</th>
            <th className="text-left pb-1.5">Team</th>
            <th className="text-center pb-1.5">W-L</th>
            <th className="text-center pb-1.5">Div</th>
            <th className="text-right pb-1.5">PF</th>
            <th className="text-right pb-1.5">PA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.nick} style={{ borderTop: `1px solid ${c.borderSoft}` }}>
              <td className="py-1.5" style={{ fontFamily: MONO, color: c.subtextFaint }}>{s.rank}</td>
              <td className="py-1.5" style={{ color: c.text }}>{displayName(s.nick)}</td>
              <td className="py-1.5 text-center" style={{ fontFamily: MONO, color: c.subtext }}>{s.w}-{s.l}</td>
              <td className="py-1.5 text-center" style={{ fontFamily: MONO, color: c.subtext }}>{s.divW}-{s.divL}</td>
              <td className="py-1.5 text-right" style={{ fontFamily: MONO, color: accent }}>{s.pf.toFixed(2)}</td>
              <td className="py-1.5 text-right" style={{ fontFamily: MONO, color: c.subtextFaint }}>{s.pa.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const divisions = rows ? [...new Set(rows.map((r) => r.divisionId))].sort() : [];

  return (
    <Panel c={c} style={{ padding: 12 }}>
      <button onClick={() => setOpen(!open)} className="w-full text-left">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold" style={{ color: c.text }}>{ch.year}</span>
          <span className="text-xs" style={{ color: accent }}>{open ? 'Hide standings ↑' : 'Full Regular Season Standings ↓'}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span style={{ color: c.subtextFaint }}>Champion: </span><span style={{ color: c.win, fontWeight: 600 }}>{displayName(ch.champion)}</span></div>
          <div><span style={{ color: c.subtextFaint }}>Runner-Up: </span><span style={{ color: c.text }}>{displayName(ch.runnerUp)}</span></div>
          <div><span style={{ color: c.subtextFaint }}>3rd Place: </span><span style={{ color: c.text }}>{displayName(ch.third)}</span></div>
          <div><span style={{ color: c.subtextFaint }}>Last Place: </span><span style={{ color: c.loss }}>{displayName(ch.lastPlace)}</span></div>
          <div><span style={{ color: c.subtextFaint }}>Toilet Bowl W: </span><span style={{ color: c.text }}>{displayName(ch.toiletBowlWinner)}</span></div>
          <div><span style={{ color: c.subtextFaint }}>Toilet Bowl L: </span><span style={{ color: c.loss }}>{displayName(ch.toiletBowlLoser)}</span></div>
          <div><span style={{ color: c.subtextFaint }}>Most PF: </span><span style={{ color: c.text }}>{displayName(ch.mostPF)}</span></div>
          <div><span style={{ color: c.subtextFaint }}>Most PA: </span><span style={{ color: c.text }}>{displayName(ch.mostPA)}</span></div>
        </div>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t overflow-x-auto" style={{ borderColor: c.borderSoft }}>
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: accent }}>Full Regular Season Standings</div>
          {loading && <p className="text-xs" style={{ color: c.subtextFaint }}>Loading real standings from Yahoo…</p>}
          {!loading && error && <p className="text-xs" style={{ color: c.subtextFaint }}>Couldn't load real data ({error}).</p>}
          {!loading && !error && rows && divisions.map((divId) => (
            <MiniTable key={divId} title={`Division ${divId}`} rows={rows.filter((r) => r.divisionId === divId)} />
          ))}
        </div>
      )}
    </Panel>
  );
}

// ============================= RECORD BOOK =============================
function RecordBookPage({ c, accent }) {
  const [tab, setTab] = useState('champions');
  const tabs = [
    { id: 'champions', label: 'Championship History' },
    { id: 'h2h', label: 'Head-to-Head' },
    { id: 'points', label: 'Team Points' },
    { id: 'stats', label: 'Team Stats' },
    { id: 'fun', label: 'Fun' },
  ];
  return (
    <div>
      <SectionHeader title="Record Book" c={c} accent={accent} />
      <div className="mb-3 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        Sample records shown &mdash; Head-to-Head, Team Points, and Team Stats populate directly from Yahoo's own record tracking once connected.
      </div>
      <div className="flex gap-1 mb-4 rounded-lg border p-1 overflow-x-auto" style={{ borderColor: c.border, backgroundColor: c.panel }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex-1 text-xs font-semibold py-2 px-2 rounded-md whitespace-nowrap"
            style={{ backgroundColor: tab === t.id ? c.panelAlt : 'transparent', color: tab === t.id ? c.text : c.subtextFaint }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'champions' ? (
        <div className="space-y-2">
          {CHAMPIONS.map((ch) => <ChampionYearCard key={ch.year} ch={ch} c={c} accent={accent} />)}
        </div>
      ) : (
        <div className="space-y-5">
          {RECORD_BOOK[tab].map((sec) => (
            <div key={sec.section}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>{sec.section}</div>
              <Panel c={c} style={{ overflow: 'hidden' }}>
                {sec.rows.map((r, i) => (
                  <div key={r.label} className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: i < sec.rows.length - 1 ? `1px solid ${c.borderSoft}` : 'none' }}>
                    <div>
                      <div className="text-xs" style={{ color: c.subtextFaint }}>{r.label}</div>
                      {r.holders.map((h, hi) => (
                        <div key={hi} className="text-sm font-semibold" style={{ color: c.text }}>
                          {expandNames(h.name)}{h.context && <span className="font-normal text-xs ml-1.5" style={{ color: c.subtextFaint }}>({h.context})</span>}
                        </div>
                      ))}
                      {r.holders.length > 1 && <div className="text-[9px] uppercase mt-0.5" style={{ color: accent }}>Tied</div>}
                    </div>
                    <div className="text-base font-bold flex-shrink-0 pl-3" style={{ fontFamily: MONO, color: accent }}>{r.value}</div>
                  </div>
                ))}
              </Panel>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================= POWER RANKINGS =============================
const POWER_CHART_COLORS = [
  '#FFB800', '#E63946', '#4ADE80', '#60A5FA', '#C084FC', '#FB923C',
  '#F472B6', '#2DD4BF', '#A3E635', '#F87171', '#818CF8', '#FACC15',
];

function PowerRankingsPage({ c, accent }) {
  const chartTeams = POWER_RANKINGS.map((r) => r.nick);

  const withDelta = POWER_RANKINGS.map((r) => ({ ...r, delta: r.lastRank - r.rank }));
  const riser = [...withDelta].sort((a, b) => b.delta - a.delta)[0];
  const faller = [...withDelta].sort((a, b) => a.delta - b.delta)[0];

  return (
    <div>
      <SectionHeader title="Power Rankings" c={c} accent={accent} />
      <div className="mb-4 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        Blends actual results (record, scoring trends, schedule) with an AI "eye test" read on team strength &mdash; weighted more toward the numbers. Sample rankings shown.
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <Panel c={c} style={{ padding: 12, borderColor: c.win }}>
          <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: c.win }}>Biggest Riser</div>
          <div className="text-sm font-bold" style={{ color: c.text }}>{displayName(riser.nick)}</div>
          <div className="text-xs" style={{ fontFamily: MONO, color: c.win }}>+{riser.delta} spots</div>
        </Panel>
        <Panel c={c} style={{ padding: 12, borderColor: c.loss }}>
          <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: c.loss }}>Biggest Faller</div>
          <div className="text-sm font-bold" style={{ color: c.text }}>{displayName(faller.nick)}</div>
          <div className="text-xs" style={{ fontFamily: MONO, color: c.loss }}>{faller.delta} spots</div>
        </Panel>
      </div>

      <Panel c={c} style={{ padding: 16, marginBottom: 16 }}>
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>Rank Over Time &mdash; All 12 Teams</div>
        <div style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={POWER_RANK_HISTORY} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: c.subtextFaint }} axisLine={{ stroke: c.border }} tickLine={false} />
              <YAxis reversed domain={[1, 12]} tick={{ fontSize: 10, fill: c.subtextFaint }} axisLine={{ stroke: c.border }} tickLine={false} />
              <Tooltip contentStyle={{ backgroundColor: c.panel, border: `1px solid ${c.border}`, fontSize: 12, color: c.text }} />
              {chartTeams.map((t, i) => <Line key={t} type="monotone" dataKey={t} stroke={POWER_CHART_COLORS[i]} strokeWidth={1.75} dot={{ r: 2 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-3 border-t" style={{ borderColor: c.borderSoft }}>
          {chartTeams.map((t, i) => (
            <div key={t} className="flex items-center gap-1">
              <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: POWER_CHART_COLORS[i] }} />
              <span className="text-[10px]" style={{ color: c.subtext }}>{displayName(t)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="space-y-2 mb-6">
        {withDelta.map((r) => (
          <Panel key={r.nick} c={c} style={{ padding: 12 }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold" style={{ color: c.text }}>#{r.rank} &middot; {displayName(r.nick)}</span>
              {r.delta !== 0 && (
                <span className="text-xs font-semibold" style={{ fontFamily: MONO, color: r.delta > 0 ? c.win : c.loss }}>
                  {r.delta > 0 ? '↑' : '↓'} {Math.abs(r.delta)}
                </span>
              )}
              {r.delta === 0 && <span className="text-xs" style={{ color: c.subtextFaint }}>—</span>}
            </div>
            <p className="text-xs" style={{ color: c.subtext }}>{r.blurb}</p>
          </Panel>
        ))}
      </div>

      <Panel c={c} style={{ padding: 16 }}>
        <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: c.subtextFaint }}>Methodology</div>
        <p className="text-xs mb-2" style={{ color: c.subtext }}>
          Rankings are recalculated every week using a blend of factors, weighted more heavily toward statistics than opinion &mdash; similar to how major pro sports power rankings work:
        </p>
        <ul className="text-xs space-y-1.5" style={{ color: c.subtext }}>
          <li>&bull; <span style={{ color: c.text, fontWeight: 600 }}>Record &amp; recent form</span> &mdash; wins/losses, weighted toward the last 3 weeks</li>
          <li>&bull; <span style={{ color: c.text, fontWeight: 600 }}>Scoring efficiency</span> &mdash; points for/against relative to league average</li>
          <li>&bull; <span style={{ color: c.text, fontWeight: 600 }}>Strength of schedule</span> &mdash; quality of opponents faced so far</li>
          <li>&bull; <span style={{ color: c.text, fontWeight: 600 }}>Roster health</span> &mdash; injuries and bye-week impact</li>
          <li>&bull; <span style={{ color: c.text, fontWeight: 600 }}>Eye test</span> &mdash; a smaller, subjective adjustment for how a team is actually performing beyond the raw numbers</li>
        </ul>
      </Panel>
    </div>
  );
}

// ============================= MOVES =============================
function MoveCard({ m, c, accent }) {
  if (m.type === 'Trade') {
    return (
      <Panel c={c} style={{ padding: 12 }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: accent }}>Trade</span>
          <span className="text-[10px]" style={{ color: c.subtextFaint }}>{m.date}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-semibold mb-1" style={{ color: c.text }}>{displayName(m.teamA)} gets</div>
            {m.teamAGets.map((p) => <div key={p} className="text-xs" style={{ color: c.subtext }}>{p}</div>)}
          </div>
          <div>
            <div className="text-xs font-semibold mb-1" style={{ color: c.text }}>{displayName(m.teamB)} gets</div>
            {m.teamBGets.map((p) => <div key={p} className="text-xs" style={{ color: c.subtext }}>{p}</div>)}
          </div>
        </div>
      </Panel>
    );
  }

  if (m.type === 'FAAB') {
    return (
      <Panel c={c} style={{ padding: 12 }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold" style={{ color: accent }}>FAAB</span>
          <span className="text-[10px]" style={{ color: c.subtextFaint }}>{m.date}</span>
        </div>
        <div className="text-sm font-medium mb-1" style={{ color: c.text }}>
          {m.player}{m.dropped && <span className="font-normal text-xs" style={{ color: c.subtextFaint }}> &mdash; dropped {m.dropped}</span>}
        </div>
        <div className="space-y-1 mt-2">
          {m.bids.map((b) => (
            <div key={b.team} className="flex items-center justify-between text-xs px-2 py-1 rounded" style={{ backgroundColor: b.won ? c.panelAlt : 'transparent' }}>
              <span style={{ color: b.won ? c.text : c.subtext, fontWeight: b.won ? 600 : 400 }}>{displayName(b.team)}{b.won && ' \u2713'}</span>
              <span style={{ fontFamily: MONO, color: b.won ? accent : c.subtextFaint }}>${b.amount}</span>
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  // Add/Drop combined
  return (
    <Panel c={c} style={{ padding: 12 }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: accent }}>Add/Drop</span>
        <span className="text-[10px]" style={{ color: c.subtextFaint }}>{m.date}</span>
      </div>
      <div className="text-sm font-medium" style={{ color: c.text }}>{displayName(m.team)}</div>
      <div className="text-xs" style={{ color: c.subtext }}>
        {m.added && <>Added {m.added}</>}{m.added && m.dropped && <> &mdash; </>}{m.dropped && <>Dropped {m.dropped}</>}
      </div>
    </Panel>
  );
}

function MovesPage({ c, accent }) {
  const [teamFilter, setTeamFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const { data: liveMoves, loading, error } = useLiveTransactions();

  const ALL_MOVES = liveMoves ? [...liveMoves, ...MOVES] : MOVES;

  const allTeamsInvolved = new Set();
  ALL_MOVES.forEach((m) => {
    if (m.type === 'Trade') { allTeamsInvolved.add(m.teamA); allTeamsInvolved.add(m.teamB); }
    else allTeamsInvolved.add(m.team);
  });
  const teams = ['all', ...allTeamsInvolved];
  const types = ['all', ...new Set(ALL_MOVES.map((m) => m.type))];
  const years = ['all', ...new Set(ALL_MOVES.map((m) => m.year))].sort((a, b) => (a === 'all' ? -1 : b === 'all' ? 1 : b - a));

  const filtered = ALL_MOVES.filter((m) => {
    const teamMatch = teamFilter === 'all' || (m.type === 'Trade' ? (m.teamA === teamFilter || m.teamB === teamFilter) : m.team === teamFilter);
    const typeMatch = typeFilter === 'all' || m.type === typeFilter;
    const yearMatch = yearFilter === 'all' || m.year === Number(yearFilter);
    return teamMatch && typeMatch && yearMatch;
  });

  return (
    <div>
      <SectionHeader title="Moves" c={c} accent={accent} />
      <div className="mb-3 text-xs rounded-md px-3 py-2 border" style={{ color: c.subtext, backgroundColor: c.panelAlt, borderColor: c.border }}>
        {loading && 'Loading real 2026 transactions from Yahoo…'}
        {!loading && error && `Couldn't load live 2026 moves (${error}) \u2014 showing sample/historical data only.`}
        {!loading && !error && '2026 moves are real from Yahoo; earlier years are sample data.'}
      </div>
      <div className="flex gap-2 mb-4">
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="flex-1 text-xs rounded-md px-2 py-2 border" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
          {teams.map((t) => <option key={t} value={t}>{t === 'all' ? 'All Teams' : displayName(t)}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="flex-1 text-xs rounded-md px-2 py-2 border" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
          {types.map((t) => <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>)}
        </select>
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="flex-1 text-xs rounded-md px-2 py-2 border" style={{ backgroundColor: c.panelAlt, color: c.text, borderColor: c.border }}>
          {years.map((y) => <option key={y} value={y}>{y === 'all' ? 'All Years' : y}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        {filtered.map((m, i) => <MoveCard key={i} m={m} c={c} accent={accent} />)}
        {filtered.length === 0 && <div className="text-xs text-center py-8" style={{ color: c.subtextFaint }}>No moves match those filters.</div>}
      </div>
    </div>
  );
}

// ============================= CONSTITUTION =============================
const CONSTITUTION_SECTIONS = [
  {
    title: 'Section 1: Roster Breakdown',
    subs: [
      { h: '1.1 Positional Breakdown', body: ['16 (18) total players.', '**Starters:** QB, RB, RB, WR, WR, FLEX, FLEX, TE, D/ST, K', '**Reserves:** 6 Bench, 2 IR'] },
      { h: '1.2 Trading', body: ['Owners can exchange players throughout the season. Draft picks can only be traded during the scheduled draft day.'] },
      { h: '1.2.1 Trade Collusion', body: ['All trades are reviewed by the league to rule out foul play.', '**First Offense:** $500 fine', '**Second Offense:** Removal from league', 'Trades found guilty of collusion are reversed/denied, and any affected game results are revised.'] },
      { h: '1.2.2 Trade Deadline', body: ['Trading opens immediately after the draft. The deadline is the latest date Yahoo allows — **December 5, 2026** for the 2026 season.'] },
      { h: '1.2.3 Trade Restrictions', body: ['No limit on the number of trades per team per year. Draft pick trades are limited to draft day only.'] },
      { h: '1.3 Waiver Wire', body: ['After the draft, all un-rostered players become free agents. The waiver wire begins the Sunday prior to Week 1.'] },
      { h: '1.3.1 Free Agent Auction Budget (FAAB)', body: ['Each owner gets **$100 FAAB** after the draft. FAAB can be traded but not borrowed from future seasons, and balances cannot go negative. Ties are broken in favor of the team lower in the standings.'] },
      { h: '1.4 Divisional Breakdown', body: ['Two divisions have existed since the league’s founding. Each season, the league winner may elect two managers to swap divisions.'] },
    ],
  },
  {
    title: 'Section 2: Ownership Expectations',
    subs: [
      { h: '2.1 League Fee & Prize Money', body: ['**$150** league fee due on draft day, no exceptions — unpaid fees double every month until paid.', '**$1,800 total pot:** $1,350 to the champion, $150 to the finalist, $300 to the highest scorer. The fee is subject to change each season by full-league vote.'] },
      { h: '2.2 Voting', body: ['New rules must be proposed and voted on before draft day and require a majority (>50%) to pass. Proposals can be raised anytime but only voted on pre-draft.'] },
      { h: '2.3 Last Place Punishment', body: ['The last-place team (Toilet Bowl loser) must buy the league champion a jersey of the champion’s choosing, of any player on the loser’s final-day roster.'] },
    ],
  },
  {
    title: 'Section 3: Drafting',
    subs: [
      { h: '3.1 Draft Order', body: ['Randomly selected by chance, with the method decided collectively. The process must be witnessed by every manager (in person or video call) to prevent foul play.'] },
      { h: '3.2 Draft Date, Location & Time', body: ['Decided collectively among managers from multiple proposed options. Anyone unable to attend in person must dial in virtually.'] },
    ],
  },
  {
    title: 'Section 4: Scoring System',
    subs: [
      { h: 'General', body: ['12-team, PPR league. Fractional points and negative points are both enabled.'] },
      { h: 'Passing', body: [
        '**Passing Touchdowns:** 4 points',
        '**Interceptions:** –1 points',
        '**Passing Yards:** 1 point per 25 yards',
      ] },
      { h: 'Rushing', body: [
        '**Rushing Touchdowns:** 6 points',
        '**Rushing Yards:** 1 point per 10 yards',
      ] },
      { h: 'Receiving', body: [
        '**Receiving Touchdowns:** 6 points',
        '**Receptions:** 1 point (full PPR)',
        '**Receiving Yards:** 1 point per 10 yards',
      ] },
      { h: 'Returns & Misc.', body: [
        '**Return Touchdowns:** 6 points',
        '**2-Point Conversions:** 2 points',
        '**Fumbles Lost:** –2 points',
        '**Offensive Fumble Return TD:** 6 points',
      ] },
      { h: 'Kickers', body: [
        '**Field Goals:** scored by total distance — 10 yards = 1 point',
        '**Missed FG, 0–19 yds:** –1 points',
        '**Missed FG, 20–29 yds:** –1 points',
        '**PAT Made:** 1 point',
        '**PAT Missed:** –1 points',
      ] },
      { h: 'Defense / Special Teams', body: [
        '**Points Allowed, 0:** 10 points',
        '**Points Allowed, 1–6:** 7 points',
        '**Points Allowed, 7–13:** 4 points',
        '**Points Allowed, 14–20:** 1 point',
        '**Points Allowed, 21–27:** 0 points',
        '**Points Allowed, 28–34:** –1 points',
        '**Points Allowed, 35+:** –4 points',
        '**Sack:** 1 point',
        '**Interception:** 2 points',
        '**Fumble Recovery:** 2 points',
        '**Touchdown:** 6 points',
        '**Safety:** 2 points',
        '**Block Kick:** 2 points',
        '**Kickoff/Punt Return TD:** 6 points',
        '**Extra Point Returned:** 2 points',
      ] },
    ],
  },
  {
    title: 'Section 5: Postseason',
    subs: [
      { h: '5.1 Playoffs', body: ['**6 teams** make the playoffs: the 2 division winners plus the 4 wild cards with the best remaining records. The 2 division winners with the best overall records receive a first-round bye.', 'Each round is single-week, winner advances. Playoffs run **Weeks 15–17** (Week 18 is not included). The bracket is reseeded every round — the top remaining seed always plays the lowest remaining seed.'] },
      { h: '5.2 Playoff Tiebreakers', body: ['Tied playoff games are broken by: 1) bench points scored, 2) total TDs by starters, 3) total TDs by bench.'] },
      { h: '5.3 Seeding Tiebreakers', body: ['**Top of division ties:** Divisional Record, then Points For.', '**All other ties:** Points For, then Head-to-Head.'] },
    ],
  },
  {
    title: 'Section 6: Scheduling',
    subs: [
      { h: '6.1 Schedule Format', body: ['A 14-week regular season plus a 3-week postseason (Weeks 1–17). Each team plays division rivals twice (10 games) and opposing-division teams once (4 games), sitting out exactly one opposing-division team — never the same one two years running.'] },
      { h: '6.2 Rivalry Week(s)', body: ['A dedicated rivalry series is played in **Weeks 3 and 4**. Rivals are set at the annual rules meeting based on personal beef, fantasy beef, and other criteria.', 'The series winner receives **$25** from the loser. Ties are broken by cumulative points across both weeks.'] },
    ],
  },
  {
    title: 'Section 7: Possible Amendments',
    subs: [
      { h: '7.1 Keepers', body: ['Under discussion for future seasons — details TBD by league vote.'] },
      { h: 'Other Amendments Under Discussion', body: [
        '**Dynasty** format',
        '**Median opponent** every week',
        '**4th down stop** point',
        '**2 opponents** per week',
      ] },
    ],
  },
];

function ConstitutionSection({ section, c, accent }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel c={c} style={{ overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold text-left" style={{ color: c.text }}>{section.title}</span>
        <ChevronRight size={16} style={{ color: c.subtextFaint, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3" style={{ borderTop: `1px solid ${c.borderSoft}` }}>
          {section.subs.map((sub, i) => (
            <div key={i} className="pt-3">
              {sub.h && <div className="text-xs font-semibold mb-1.5" style={{ color: accent }}>{sub.h}</div>}
              {sub.body.map((line, j) => {
                const parts = line.split(/\*\*(.*?)\*\*/g);
                return (
                  <p key={j} className="text-xs mb-1.5 last:mb-0" style={{ color: c.subtext, lineHeight: 1.6 }}>
                    {parts.map((part, k) => k % 2 === 1 ? <strong key={k} style={{ color: c.text }}>{part}</strong> : part)}
                  </p>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ConstitutionPage({ c, accent }) {
  return (
    <div>
      <SectionHeader title="Constitution" c={c} accent={accent} />
      <div className="space-y-2">
        {CONSTITUTION_SECTIONS.map((s) => <ConstitutionSection key={s.title} section={s} c={c} accent={accent} />)}
      </div>
    </div>
  );
}

// ============================= APP SHELL =============================
export default function App() {
  const [themeName, setThemeName] = useState('dark');
  const [page, setPage] = useState('home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [divOrder, setDivOrder] = useState(['divRecord', 'pf', 'h2h']);
  const [restOrder, setRestOrder] = useState(['pf', 'divRecord', 'h2h']);
  const c = THEMES[themeName];
  const accent = themeName === 'dark' ? '#FFB800' : '#B8860B';

  const PAGES = {
    home: <HomePage c={c} accent={accent} onNavigate={setPage} />,
    standings: <StandingsPage c={c} accent={accent} divOrder={divOrder} setDivOrder={setDivOrder} restOrder={restOrder} setRestOrder={setRestOrder} />,
    schedule: <SchedulePage c={c} accent={accent} />,
    playoffs: <PlayoffsPage c={c} accent={accent} divOrder={divOrder} restOrder={restOrder} />,
    teams: <TeamsPage c={c} accent={accent} />,
    draft: <DraftPage c={c} accent={accent} />,
    records: <RecordBookPage c={c} accent={accent} />,
    trophyroom: <TrophyRoomPage c={c} accent={accent} />,
    power: <PowerRankingsPage c={c} accent={accent} />,
    moves: <MovesPage c={c} accent={accent} />,
    whatif: <WhatIfSimulatorPage c={c} accent={accent} />,
    newsroom: <NewsroomPage c={c} accent={accent} />,
    constitution: <ConstitutionPage c={c} accent={accent} />,
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: c.bg, color: c.text, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
        select option { background-color: ${c.bg}; color: ${c.text}; }
        input::placeholder { color: ${c.subtextFaint}; }
      `}</style>

      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={(id) => { setPage(id); setMenuOpen(false); }} c={c} accent={accent} page={page} />

      <div className="relative overflow-hidden border-b" style={{ background: c.heroGrad, borderColor: c.border }}>
        <div className="absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${c.gridLine} 0px, ${c.gridLine} 1px, transparent 1px, transparent 40px)` }} />
        <div className="relative max-w-2xl mx-auto px-5 pt-6 pb-5">
          <div className="flex items-start justify-between mb-2">
            <button onClick={() => setMenuOpen(true)} className="p-1.5 -ml-1.5 rounded-md" style={{ color: c.text }}><Menu size={20} /></button>
            <button onClick={() => setThemeName(themeName === 'dark' ? 'light' : 'dark')} className="p-1.5 rounded-md border" style={{ borderColor: c.border, color: c.text }}>
              {themeName === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
          <h1 className="text-4xl uppercase leading-none" style={{ fontFamily: DISPLAY, letterSpacing: '0.02em' }}>
            Mehrob<span style={{ color: accent }}>Mania</span>
          </h1>
          <p className="text-xs mt-1.5" style={{ color: c.subtext }}>Bad, Mid &amp; Good Little Boys &middot; 12 Managers &middot; Est. 2022</p>
          <div className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ backgroundColor: c.panelAlt, borderColor: c.border }}>
            <Search size={13} style={{ color: c.subtext }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teams, players, matchups..." className="bg-transparent outline-none text-sm w-full" style={{ color: c.text }} />
          </div>
        </div>
      </div>

      {/* quick tab strip so the whole nav isn't buried in the drawer */}
      <div className="sticky top-0 z-10 border-b overflow-x-auto" style={{ backgroundColor: c.bg, borderColor: c.border }}>
        <div className="max-w-2xl mx-auto px-5 flex gap-1">
          {NAV_LINKS.map((l) => {
            const Icon = l.icon;
            const active = page === l.id;
            return (
              <button key={l.id} onClick={() => setPage(l.id)} className="flex items-center gap-1.5 px-2.5 py-3 text-xs font-medium whitespace-nowrap border-b-2"
                style={{ borderColor: active ? accent : 'transparent', color: active ? c.text : c.subtext }}>
                <Icon size={13} /> {l.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-6">
        {PAGES[page]}
      </div>
    </div>
  );
}
