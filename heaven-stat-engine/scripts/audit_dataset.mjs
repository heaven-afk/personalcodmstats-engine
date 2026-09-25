import fs from 'fs';

const records = JSON.parse(fs.readFileSync('exports/novaplay_hse_historical_dataset.json', 'utf8'));

const anomalies = [];

// 1. Check Kill Share > 100%
const over100KillShare = records.filter(r => r.kill_share_raw > 100);
console.log(`Records with Kill Share > 100%: ${over100KillShare.length}`);
for (const r of over100KillShare) {
  console.log(`  [${r.tournament} Day ${r.matchday}] Player: ${r.player} (${r.team}) -> Kills: ${r.kills}, Team Kills: ${r.team_total_kills}, Kill Share: ${r.kill_share_raw.toFixed(1)}%`);
}

// 2. Check Sum of Player Kills vs Team Total Kills per matchday
const teamDayPlayerKills = new Map();
for (const r of records) {
  const key = `${r.tournament}_D${r.matchday}_${r.team}`;
  if (!teamDayPlayerKills.has(key)) {
    teamDayPlayerKills.set(key, {
      tournament: r.tournament,
      matchday: r.matchday,
      team: r.team,
      team_total_kills: r.team_total_kills,
      playerSumKills: 0,
      players: []
    });
  }
  const entry = teamDayPlayerKills.get(key);
  entry.playerSumKills += r.kills;
  entry.players.push({ player: r.player, kills: r.kills });
}

let killMismatchCount = 0;
const majorMismatches = [];
for (const [key, data] of teamDayPlayerKills.entries()) {
  if (data.team_total_kills != null && data.playerSumKills !== data.team_total_kills) {
    killMismatchCount++;
    const diff = data.playerSumKills - data.team_total_kills;
    majorMismatches.push({
      key,
      tournament: data.tournament,
      matchday: data.matchday,
      team: data.team,
      teamKills: data.team_total_kills,
      playerSum: data.playerSumKills,
      diff
    });
  }
}
console.log(`Team-days where sum of player kills != team total kills: ${killMismatchCount} / ${teamDayPlayerKills.size}`);
majorMismatches.sort((a,b) => Math.abs(b.diff) - Math.abs(a.diff));
console.log('Top 10 Kill Mismatches:', majorMismatches.slice(0, 10));

// 3. Check Damage tracking
const tourneyDamage = {};
for (const r of records) {
  if (!tourneyDamage[r.tournament]) tourneyDamage[r.tournament] = { nonZero: 0, total: 0 };
  tourneyDamage[r.tournament].total++;
  if (r.total_damage > 0) tourneyDamage[r.tournament].nonZero++;
}
console.log('Tournaments damage tracking:', tourneyDamage);

// 4. Missing fields
const missingTeamAvgPlace = records.filter(r => r.team_average_placement == null);
console.log(`Records with missing team_average_placement: ${missingTeamAvgPlace.length}`);
for (const r of missingTeamAvgPlace) {
  console.log(`  [${r.tournament} Day ${r.matchday}] Player: ${r.player} (${r.team})`);
}

const missingKillShare = records.filter(r => r.kill_share == null);
console.log(`Records with missing kill_share: ${missingKillShare.length}`);

// 5. Check matchday lobby consistency
const lobbyDistribution = {};
for (const r of records) {
  const k = `${r.tournament}_D${r.matchday}`;
  if (!lobbyDistribution[k]) lobbyDistribution[k] = new Set();
  lobbyDistribution[k].add(r.games);
}
console.log('Player games played per matchday:', lobbyDistribution);
