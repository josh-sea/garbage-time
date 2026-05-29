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
    fta = parseFloat(parts[1]) || 0;
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

// --- Secondary API fetchers (all wrapped in try/catch; return null if unavailable) ---

// stats.nba.com — USG%, ORtg, DRtg, PIE for NBA and WNBA
async function fetchNbaAdvancedStats(gameDate, homeTeamAbbrev, league) {
  const [year, month, day] = gameDate.split('-');
  const nbaDate = `${month}/${day}/${year}`;
  const leagueId = league === 'wnba' ? '10' : '00';

  const headers = {
    'Referer': 'https://www.nba.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.nba.com',
  };

  try {
    const schedRes = await fetch(
      `https://stats.nba.com/stats/scoreboardv2?GameDate=${encodeURIComponent(nbaDate)}&LeagueID=${leagueId}`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    if (!schedRes.ok) return null;
    const sched = await schedRes.json();

    // GAMECODE format: "20240529/MEMOKC" — last 3 chars = home abbreviation
    const gameHeader = sched.resultSets?.find(rs => rs.name === 'GameHeader');
    if (!gameHeader) return null;
    const ghCols = gameHeader.headers;
    const gameCodeIdx = ghCols.indexOf('GAMECODE');
    const ghGameIdIdx = ghCols.indexOf('GAME_ID');

    const matchedRow = gameHeader.rowSet?.find(row => {
      const code = String(row[gameCodeIdx] ?? '');
      const homeAbbrev = code.slice(code.lastIndexOf('/') + 1).slice(-3);
      return homeAbbrev.toUpperCase() === homeTeamAbbrev?.toUpperCase();
    });
    if (!matchedRow) return null;

    const gameId = matchedRow[ghGameIdIdx];

    const boxRes = await fetch(
      `https://stats.nba.com/stats/boxscoreadvancedv3?GameID=${gameId}&StartPeriod=0&EndPeriod=10&RangeType=0&StartRange=0&EndRange=28800`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    if (!boxRes.ok) return null;
    const box = await boxRes.json();

    const players = [];
    for (const team of box.boxScoreAdvanced?.playerStats ?? []) {
      for (const p of team.statistics ?? []) {
        const usg = p.usagePercentage;
        const pie = p.playerImpactEstimate;
        players.push({
          name: `${p.firstName ?? ''} ${p.familyName ?? ''}`.trim(),
          team: team.teamAbbreviation,
          min: p.minutes,
          usg: usg != null ? +(usg * 100).toFixed(1) : null,
          ortg: p.offensiveRating ?? null,
          drtg: p.defensiveRating ?? null,
          netRtg: p.netRating ?? null,
          pie: pie != null ? +(pie * 100).toFixed(1) : null,
        });
      }
    }

    const teams = {};
    for (const team of box.boxScoreAdvanced?.teamStats ?? []) {
      const side = String(team.homeAway ?? '').toLowerCase() === 'home' ? 'home' : 'away';
      const s = team.statistics ?? {};
      teams[side] = {
        abbrev: team.teamAbbreviation,
        ortg: s.offensiveRating ?? null,
        drtg: s.defensiveRating ?? null,
        netRtg: s.netRating ?? null,
        pace: s.pace ?? null,
        efg: s.effectiveFieldGoalPercentage != null ? +(s.effectiveFieldGoalPercentage * 100).toFixed(1) : null,
        ts: s.trueShootingPercentage != null ? +(s.trueShootingPercentage * 100).toFixed(1) : null,
      };
    }

    return { source: 'nba-stats', gameId, players, teams };
  } catch (err) {
    console.warn('[sports] NBA Stats API unavailable:', err.message);
    return null;
  }
}

// MLB Stats API (statsapi.mlb.com) — official, free, no key
async function fetchMlbAdvancedStats(gameDate, homeTeamAbbrev) {
  try {
    const schedRes = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${gameDate}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!schedRes.ok) return null;
    const sched = await schedRes.json();

    const games = sched.dates?.[0]?.games ?? [];
    const game = games.find(g =>
      g.teams?.home?.team?.abbreviation?.toUpperCase() === homeTeamAbbrev?.toUpperCase()
    );
    if (!game) return null;

    const feedRes = await fetch(
      `https://statsapi.mlb.com/api/v1.1/game/${game.gamePk}/feed/live`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!feedRes.ok) return null;
    const feed = await feedRes.json();

    const boxscore = feed.liveData?.boxscore;
    const linescore = feed.liveData?.linescore;

    const teams = {};
    for (const side of ['home', 'away']) {
      const t = boxscore?.teams?.[side];
      if (!t) continue;

      // Pitchers for this team
      const pitchers = (t.pitchers ?? []).map((id, idx) => {
        const p = t.players?.[`ID${id}`];
        if (!p) return null;
        return {
          name: p.person?.fullName,
          isStarter: idx === 0,
          era: p.seasonStats?.pitching?.era,
          wins: p.seasonStats?.pitching?.wins,
          losses: p.seasonStats?.pitching?.losses,
          seasonK: p.seasonStats?.pitching?.strikeOuts,
          seasonWhip: p.seasonStats?.pitching?.whip,
          gameStats: p.stats?.pitching,  // IP, ER, K, BB, HR for this game
        };
      }).filter(Boolean);

      // Batters with season context
      const batters = (t.batters ?? []).map(id => {
        const p = t.players?.[`ID${id}`];
        if (!p) return null;
        return {
          name: p.person?.fullName,
          position: p.position?.abbreviation,
          gameStats: p.stats?.batting,   // H, AB, R, RBI, HR, BB, K
          seasonAvg: p.seasonStats?.batting?.avg,
          seasonOps: p.seasonStats?.batting?.ops,
          seasonHr: p.seasonStats?.batting?.homeRuns,
        };
      }).filter(Boolean);

      teams[side] = {
        name: t.team?.name,
        abbrev: t.team?.abbreviation,
        pitchers,
        batters,
        teamBatting: t.teamStats?.batting,
        teamPitching: t.teamStats?.pitching,
        errors: t.teamStats?.fielding?.errors,
        leftOnBase: t.teamStats?.batting?.leftOnBase,
      };
    }

    // Inning-by-inning line score
    const innings = (linescore?.innings ?? []).map(inn => ({
      num: inn.num,
      home: { runs: inn.home?.runs, hits: inn.home?.hits, errors: inn.home?.errors },
      away: { runs: inn.away?.runs, hits: inn.away?.hits, errors: inn.away?.errors },
    }));

    return {
      source: 'mlb-stats-api',
      gamePk: game.gamePk,
      gameDate,
      venue: feed.gameData?.venue?.name,
      weather: feed.gameData?.weather,
      attendance: feed.gameData?.gameInfo?.attendance,
      teams,
      innings,
    };
  } catch (err) {
    console.warn('[sports] MLB Stats API unavailable:', err.message);
    return null;
  }
}

// NHL API (api-web.nhle.com) — official, free, no key
async function fetchNhlAdvancedStats(gameDate, homeTeamAbbrev) {
  try {
    const schedRes = await fetch(
      `https://api-web.nhle.com/v1/schedule/${gameDate}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!schedRes.ok) return null;
    const sched = await schedRes.json();

    // The schedule endpoint returns a week; find the matching date
    const dayData = (sched.gameWeek ?? []).find(d => d.date === gameDate);
    const games = dayData?.games ?? [];
    const game = games.find(g =>
      g.homeTeam?.abbrev?.toUpperCase() === homeTeamAbbrev?.toUpperCase()
    );
    if (!game) return null;

    const [boxRes, pbpRes] = await Promise.allSettled([
      fetch(`https://api-web.nhle.com/v1/gamecenter/${game.id}/boxscore`, { signal: AbortSignal.timeout(8000) }),
      fetch(`https://api-web.nhle.com/v1/gamecenter/${game.id}/play-by-play`, { signal: AbortSignal.timeout(8000) }),
    ]);

    const box = boxRes.status === 'fulfilled' && boxRes.value.ok
      ? await boxRes.value.json() : null;
    const pbp = pbpRes.status === 'fulfilled' && pbpRes.value.ok
      ? await pbpRes.value.json() : null;

    // Shot chart from play-by-play (typeCode 505=shot-on-goal, 506=goal)
    const shotChart = (pbp?.plays ?? [])
      .filter(p => (p.typeCode === 505 || p.typeCode === 506) && p.details?.xCoord != null)
      .map(p => ({
        x: p.details.xCoord,
        y: p.details.yCoord,
        made: p.typeCode === 506,
        period: p.periodDescriptor?.number,
        team: p.details?.teamAbbrev,
        shotType: p.details?.shotType,
        shootingPlayerId: p.details?.shootingPlayerId,
      }));

    const teams = {};
    for (const side of ['homeTeam', 'awayTeam']) {
      const t = box?.[side];
      if (!t) continue;

      const goalies = (t.goalies ?? []).map(g => ({
        name: `${g.firstName?.default ?? ''} ${g.lastName?.default ?? ''}`.trim(),
        saves: g.saves,
        goalsAgainst: g.goalsAgainst,
        savePct: g.savePctg,
        toi: g.toi,
      }));

      const skaters = (t.forwards ?? []).concat(t.defense ?? []).map(p => ({
        name: `${p.firstName?.default ?? ''} ${p.lastName?.default ?? ''}`.trim(),
        position: p.position,
        goals: p.goals,
        assists: p.assists,
        points: p.points,
        plusMinus: p.plusMinus,
        pim: p.pim,
        toi: p.toi,
        shots: p.shots,
        hits: p.hits,
        blockedShots: p.blockedShots,
        powerPlayGoals: p.powerPlayGoals,
        shorthandedGoals: p.shorthandedGoals,
      }));

      teams[side === 'homeTeam' ? 'home' : 'away'] = {
        abbrev: t.abbrev,
        sog: t.sog,
        faceoffPct: t.faceoffWinningPctg,
        powerPlay: t.powerPlayConversions, // e.g. "1/3"
        hits: t.hits,
        blockedShots: t.blockedShots,
        pim: t.pim,
        goalies,
        skaters,
      };
    }

    return {
      source: 'nhl-api',
      gameId: game.id,
      gameDate,
      teams,
      shotChart: shotChart.length > 0 ? shotChart : null,
    };
  } catch (err) {
    console.warn('[sports] NHL API unavailable:', err.message);
    return null;
  }
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
      coordinate: p.coordinate ?? null,
      athlete: p.players?.[0]?.athlete?.displayName ?? null,
      team: p.team?.abbreviation ?? null,
      type: p.type?.text ?? null,
    }));

    // Shot chart from ESPN play-by-play
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

    // Largest single-play win probability swing
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
    if (winProbabilitySwing?.playId) {
      const play = allPlays.find(p => p.id === winProbabilitySwing.playId);
      if (play) winProbabilitySwing.play = play;
    }

    // Longest uninterrupted scoring run
    let longestRun = null;
    if (allPlays.length > 0) {
      let runTeam = null, runPoints = 0, bestRun = 0, bestRunTeam = null;
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

    // --- Secondary API enrichment (transparent, fails gracefully) ---
    let advancedStats = null;
    const gameDate = data.header?.competitions?.[0]?.date?.slice(0, 10);
    const homeTeamAbbrev = data.header?.competitions?.[0]?.competitors
      ?.find(c => c.homeAway === 'home')?.team?.abbreviation;

    if (gameDate && homeTeamAbbrev) {
      if (sport === 'basketball' && (league === 'nba' || league === 'wnba')) {
        advancedStats = await fetchNbaAdvancedStats(gameDate, homeTeamAbbrev, league);
      } else if (sport === 'baseball' && league === 'mlb') {
        advancedStats = await fetchMlbAdvancedStats(gameDate, homeTeamAbbrev);
      } else if (sport === 'hockey' && league === 'nhl') {
        advancedStats = await fetchNhlAdvancedStats(gameDate, homeTeamAbbrev);
      }
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
      advancedStats,  // null if unavailable or sport not supported
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
