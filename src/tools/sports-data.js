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

    // Extract box score leaders
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

    // Extract key stats from boxscore
    const teamStats = [];
    for (const team of data.boxscore?.teams ?? []) {
      const stats = {};
      for (const statGroup of team.statistics ?? []) {
        stats[statGroup.name] = statGroup.displayValue;
      }
      teamStats.push({
        team: team.team?.displayName,
        abbrev: team.team?.abbreviation,
        stats,
      });
    }

    // Extract player stats (top performers)
    const playerStats = [];
    for (const player of data.boxscore?.players ?? []) {
      for (const stat of player.statistics ?? []) {
        const athletes = (stat.athletes ?? []).slice(0, 5).map(a => ({
          name: a.athlete?.displayName,
          stats: stat.labels?.reduce((acc, label, i) => {
            acc[label] = a.stats?.[i];
            return acc;
          }, {}),
        }));
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

    // Play by play (last 10 plays)
    const recentPlays = (data.plays ?? []).slice(-10).map(p => ({
      clock: p.clock?.displayValue,
      period: p.period?.number,
      text: p.text,
      scoringPlay: p.scoringPlay,
      score: p.awayScore !== undefined ? `${p.awayScore}-${p.homeScore}` : null,
    }));

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
      recentPlays,
      gameInfo: data.gameInfo ?? null,
    };
  } catch (err) {
    return { gameId, sport, league, error: err.message };
  }
}

const LEAGUES_TO_SURVEY = [
  { sport: 'basketball', league: 'nba', label: 'NBA' },
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
