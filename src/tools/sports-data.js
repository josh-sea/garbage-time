// ESPN free public JSON endpoints — no API key needed

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

async function espnFetch(path) {
  const url = `${ESPN_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'garbage-time-bot/0.1' },
  });
  if (!res.ok) throw new Error(`ESPN fetch failed: ${res.status} ${url}`);
  return res.json();
}

function parseGameStatus(event) {
  const status = event.status?.type;
  return {
    id: event.id,
    name: event.name,
    shortName: event.shortName,
    date: event.date,
    status: status?.description ?? 'Unknown',
    statusState: status?.state ?? 'unknown', // 'pre', 'in', 'post'
    clock: event.status?.displayClock ?? null,
    period: event.status?.period ?? null,
    home: {
      id: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.id,
      name: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.displayName,
      abbrev: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation,
      score: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.score,
      record: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.records?.[0]?.summary,
    },
    away: {
      id: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.team?.id,
      name: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.team?.displayName,
      abbrev: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation,
      score: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.score,
      record: event.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.records?.[0]?.summary,
    },
    venue: event.competitions?.[0]?.venue?.fullName,
    broadcasts: event.competitions?.[0]?.broadcasts?.[0]?.names ?? [],
    notes: event.competitions?.[0]?.notes?.[0]?.headline ?? null,
  };
}

// --- Derived metrics helpers ---

function getStatValue(stats, ...keys) {
  for (const key of keys) {
    const raw = stats[key];
    if (raw === undefined || raw === null || raw === '--') continue;
    // Handle "made-attempted" display strings like "10-20"
    const s = String(raw);
    const dashParts = s.split('-');
    if (dashParts.length === 2 && !isNaN(parseFloat(dashParts[0]))) {
      return parseFloat(dashParts[0]);
    }
    const v = parseFloat(s);
    if (!isNaN(v)) return v;
  }
  return 0;
}

function deriveTeamMetrics(stats) {
  if (!stats) return null;
  const pts = getStatValue(stats, 'points', 'score');
  const fga = getStatValue(stats, 'fieldGoalsAttempted', 'fieldGoalAttempts');
  const fgm = getStatValue(stats, 'fieldGoalsMade');
  const fta = getStatValue(stats, 'freeThrowsAttempted', 'freeThrowAttempts');
  const tpa = getStatValue(stats, 'threePointFieldGoalsAttempted', 'threePointsAttempted', 'threePointAttempts');
  const tpm = getStatValue(stats, 'threePointFieldGoalsMade', 'threePointsMade');
  const tov = getStatValue(stats, 'turnovers', 'turnover');
  const oreb = getStatValue(stats, 'offensiveRebounds');

  if (!fga) return null;

  const poss = fga - oreb + tov + 0.44 * fta;
  const tsDenom = 2 * (fga + 0.44 * fta);
  const ts = tsDenom > 0 ? pts / tsDenom : null;
  const efg = (fgm + 0.5 * tpm) / fga;

  return {
    trueShootingPct: ts !== null && isFinite(ts) ? +(ts * 100).toFixed(1) : null,
    effectiveFGPct: isFinite(efg) ? +(efg * 100).toFixed(1) : null,
    estimatedPossessions: poss > 0 ? Math.round(poss) : null,
    offensiveRating: poss > 0 && pts ? +((pts / poss) * 100).toFixed(1) : null,
    threePointRate: fga > 0 && tpa > 0 ? +(tpa / fga * 100).toFixed(1) : null,
  };
}

function derivePlayerMetrics(statsObj) {
  if (!statsObj) return null;

  // Handle both split labels (FGM + FGA) and combined labels (FG = "10-20")
  let fgm = 0, fga = 0, tpm = 0, fta = 0;

  if ('FGM' in statsObj && 'FGA' in statsObj) {
    fgm = getStatValue(statsObj, 'FGM');
    fga = getStatValue(statsObj, 'FGA');
  } else if ('FG' in statsObj) {
    const parts = String(statsObj['FG'] ?? '').split('-');
    fgm = parseFloat(parts[0]) || 0;
    fga = parseFloat(parts[1]) || 0;
  }

  if ('3PM' in statsObj) {
    tpm = getStatValue(statsObj, '3PM');
  } else if ('3PT' in statsObj) {
    const parts = String(statsObj['3PT'] ?? '').split('-');
    tpm = parseFloat(parts[0]) || 0;
  }

  if ('FTA' in statsObj) {
    fta = getStatValue(statsObj, 'FTA');
  } else if ('FT' in statsObj) {
    const parts = String(statsObj['FT'] ?? '').split('-');
    fta = parseFloat(parts[1]) || 0; // second part is attempts
  }

  const pts = getStatValue(statsObj, 'PTS');
  if (!fga && !fta) return null;

  const tsDenom = 2 * (fga + 0.44 * fta);
  const ts = tsDenom > 0 ? pts / tsDenom : null;
  const efg = fga > 0 ? (fgm + 0.5 * tpm) / fga : null;

  return {
    trueShootingPct: ts !== null && isFinite(ts) ? +(ts * 100).toFixed(1) : null,
    effectiveFGPct: efg !== null && isFinite(efg) ? +(efg * 100).toFixed(1) : null,
  };
}

// --- Public API ---

export async function getScoreboard(sport, league) {
  try {
    const data = await espnFetch(`/${sport}/${league}/scoreboard`);
    const events = (data.events ?? []).map(parseGameStatus);
    return {
      sport,
      league,
      season: data.season ?? null,
      week: data.week ?? null,
      games: events,
      count: events.length,
    };
  } catch (err) {
    return { sport, league, error: err.message, games: [] };
  }
}

export async function getGameSummary(sport, league, gameId) {
  try {
    const data = await espnFetch(`/${sport}/${league}/summary?event=${gameId}`);

    // Stat leaders
    const leaders = [];
    for (const category of data.leaders ?? []) {
      for (const leader of category.leaders ?? []) {
        leaders.push({
          category: category.name,
          displayValue: leader.displayValue,
          athlete: leader.athlete?.displayName,
          team: leader.team?.abbreviation,
        });
      }
    }

    // Team box score stats + derived metrics
    const teamStats = [];
    for (const team of data.boxscore?.teams ?? []) {
      const rawStats = {};
      for (const statGroup of team.statistics ?? []) {
        rawStats[statGroup.name] = statGroup.displayValue;
      }
      teamStats.push({
        team: team.team?.displayName,
        abbrev: team.team?.abbreviation,
        stats: rawStats,
        derivedMetrics: deriveTeamMetrics(rawStats),
      });
    }

    // Player stats + per-player derived metrics
    const playerStats = [];
    for (const player of data.boxscore?.players ?? []) {
      for (const stat of player.statistics ?? []) {
        const athletes = (stat.athletes ?? []).map(a => {
          const statsObj = stat.labels?.reduce((acc, label, i) => {
            acc[label] = a.stats?.[i];
            return acc;
          }, {});
          return {
            name: a.athlete?.displayName,
            stats: statsObj,
            derivedMetrics: derivePlayerMetrics(statsObj),
          };
        });
        if (athletes.length > 0) {
          playerStats.push({
            team: player.team?.displayName,
            category: stat.name,
            athletes,
            labels: stat.labels,
          });
        }
      }
    }

    // Full play-by-play with shot coordinates
    const allPlays = (data.plays ?? []).map(p => ({
      id: p.id,
      clock: p.clock?.displayValue,
      period: p.period?.number,
      text: p.text,
      scoringPlay: p.scoringPlay ?? false,
      shootingPlay: p.shootingPlay ?? false,
      awayScore: p.awayScore,
      homeScore: p.homeScore,
      score: p.awayScore !== undefined ? `${p.awayScore}-${p.homeScore}` : null,
      coordinate: p.coordinate ?? null, // { x, y } court position for shots
      athlete: p.players?.[0]?.athlete?.displayName ?? null,
      team: p.team?.abbreviation ?? null,
      type: p.type?.text ?? null,
    }));

    // Shot chart: all shooting plays that have court coordinates
    const shotChart = allPlays
      .filter(p => p.shootingPlay && p.coordinate)
      .map(p => ({
        x: p.coordinate.x,
        y: p.coordinate.y,
        made: p.scoringPlay,
        text: p.text,
        athlete: p.athlete,
        team: p.team,
        period: p.period,
        type: p.type,
      }));

    // Win probability timeline
    const winProbability = (data.winprobability ?? []).map(wp => ({
      playId: wp.playId,
      homeWinPercentage: wp.homeWinPercentage,
      tiePercentage: wp.tiePercentage,
      secondsLeft: wp.secondsLeft,
    }));

    // Largest single-play win probability swing — the actual turning point
    let winProbabilitySwing = null;
    for (let i = 1; i < winProbability.length; i++) {
      const swing = Math.abs(winProbability[i].homeWinPercentage - winProbability[i - 1].homeWinPercentage);
      if (!winProbabilitySwing || swing > winProbabilitySwing.swing) {
        winProbabilitySwing = {
          swing: +(swing * 100).toFixed(1),
          before: +(winProbability[i - 1].homeWinPercentage * 100).toFixed(1),
          after: +(winProbability[i].homeWinPercentage * 100).toFixed(1),
          playId: winProbability[i].playId,
          play: null,
        };
      }
    }
    // Attach the play text for the pivotal moment
    if (winProbabilitySwing?.playId) {
      const play = allPlays.find(p => p.id === winProbabilitySwing.playId);
      if (play) winProbabilitySwing.play = play;
    }

    // Scoring run detector: find the longest uninterrupted run by one team
    let longestRun = null;
    if (allPlays.length > 0) {
      let runTeam = null, runStart = 0, runPoints = 0, bestRun = 0, bestRunTeam = null;
      for (const play of allPlays) {
        if (!play.scoringPlay || !play.team) continue;
        if (play.team === runTeam) {
          runPoints++;
        } else {
          if (runPoints > bestRun) { bestRun = runPoints; bestRunTeam = runTeam; }
          runTeam = play.team;
          runPoints = 1;
        }
      }
      if (runPoints > bestRun) { bestRun = runPoints; bestRunTeam = runTeam; }
      if (bestRun >= 5) longestRun = { team: bestRunTeam, scoringPlays: bestRun };
    }

    return {
      gameId,
      sport,
      league,
      header: {
        competitions: data.header?.competitions?.[0]
          ? parseGameStatus(data.header.competitions[0])
          : null,
      },
      leaders,
      teamStats,
      playerStats,
      plays: allPlays,
      recentPlays: allPlays.slice(-10),
      shotChart: shotChart.length > 0 ? shotChart : null,
      winProbability: winProbability.length > 0 ? winProbability : null,
      winProbabilitySwing,
      longestRun,
      gameInfo: data.gameInfo ?? null,
    };
  } catch (err) {
    return { gameId, sport, league, error: err.message };
  }
}

const LEAGUES_TO_SURVEY = [
  { sport: 'basketball', league: 'nba', label: 'NBA' },
  { sport: 'basketball', league: 'wnba', label: 'WNBA' },
  { sport: 'basketball', league: 'mens-college-basketball', label: "NCAA Men's Basketball" },
  { sport: 'football', league: 'nfl', label: 'NFL' },
  { sport: 'football', league: 'college-football', label: 'College Football' },
  { sport: 'baseball', league: 'mlb', label: 'MLB' },
  { sport: 'hockey', league: 'nhl', label: 'NHL' },
  { sport: 'soccer', league: 'eng.1', label: 'Premier League' },
  { sport: 'soccer', league: 'usa.1', label: 'MLS' },
];

export async function discoverSports() {
  const results = await Promise.allSettled(
    LEAGUES_TO_SURVEY.map(async ({ sport, league, label }) => {
      const data = await getScoreboard(sport, league);
      const live = data.games.filter(g => g.statusState === 'in');
      const finished = data.games.filter(g => g.statusState === 'post');
      const upcoming = data.games.filter(g => g.statusState === 'pre');
      return {
        label,
        sport,
        league,
        total: data.games.length,
        live: live.length,
        finished: finished.length,
        upcoming: upcoming.length,
        liveGames: live.map(g => ({
          name: g.shortName,
          score: `${g.away.abbrev} ${g.away.score} - ${g.home.abbrev} ${g.home.score}`,
          clock: g.clock,
          period: g.period,
        })),
        recentFinished: finished.slice(0, 3).map(g => ({
          name: g.shortName,
          score: `${g.away.abbrev} ${g.away.score} - ${g.home.abbrev} ${g.home.score}`,
        })),
        nextUp: upcoming.slice(0, 2).map(g => ({
          name: g.shortName,
          date: g.date,
        })),
      };
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { ...LEAGUES_TO_SURVEY[i], error: r.reason?.message };
  });
}
