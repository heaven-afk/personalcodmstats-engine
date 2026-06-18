'use client';

// Helper to check if running in browser
const isBrowser = typeof window !== 'undefined';

function getStorageItem(key, fallback = []) {
  if (!isBrowser) return fallback;
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch (e) {
    return fallback;
  }
}

function setStorageItem(key, value) {
  if (!isBrowser) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

// Generates a mock Firestore serverTimestamp
function mockTimestamp() {
  return {
    toDate: () => new Date(),
    seconds: Math.floor(Date.now() / 1000),
    nanoseconds: 0
  };
}

// ─── Initial Seed Data ────────────────────────────────────────────────────────
const SEED_PLAYERS = [
  { id: 'p1', professionalName: 'Heaven', ign: 'heaven-afk', gender: 'Male', region: 'Europe', country: 'United Kingdom', device: 'iPad', deviceModel: 'Pro M4', careerKills: 124, careerMatches: 24, tournamentIds: ['t1'], createdAt: mockTimestamp() },
  { id: 'p2', professionalName: 'Eques', ign: 'eques-zero', gender: 'Male', region: 'North America', country: 'United States', device: 'Phone', deviceModel: 'iPhone 15 Pro', careerKills: 98, careerMatches: 24, tournamentIds: ['t1'], createdAt: mockTimestamp() },
  { id: 'p3', professionalName: 'Viper', ign: 'viper-strike', gender: 'Male', region: 'Asia', country: 'Japan', device: 'Phone', deviceModel: 'ROG Phone 8', careerKills: 156, careerMatches: 24, tournamentIds: ['t1'], createdAt: mockTimestamp() },
  { id: 'p4', professionalName: 'Nova', ign: 'nova-star', gender: 'Female', region: 'Europe', country: 'France', device: 'iPad', deviceModel: 'Air 5', careerKills: 82, careerMatches: 18, tournamentIds: ['t1'], createdAt: mockTimestamp() },
  { id: 'p5', professionalName: 'Alpha', ign: 'alpha-omega', gender: 'Male', region: 'Latin America', country: 'Brazil', device: 'Phone', deviceModel: 'Galaxy S24 Ultra', careerKills: 110, careerMatches: 24, tournamentIds: ['t1'], createdAt: mockTimestamp() }
];

const SEED_TEAMS = [
  { id: 'tm1', teamName: 'Heavenly Knights', clanName: 'Heavenly', tournamentIds: ['t1'], createdAt: mockTimestamp() },
  { id: 'tm2', teamName: 'Viper Clan', clanName: 'Vipers', tournamentIds: ['t1'], createdAt: mockTimestamp() },
  { id: 'tm3', teamName: 'Nova Storm', clanName: 'Nova', tournamentIds: ['t1'], createdAt: mockTimestamp() },
  { id: 'tm4', teamName: 'Alpha Squad', clanName: 'Alphas', tournamentIds: ['t1'], createdAt: mockTimestamp() }
];

const SEED_CLANS = [
  { id: 'c1', clanName: 'Heavenly', teamIds: ['tm1'], createdAt: mockTimestamp() },
  { id: 'c2', clanName: 'Vipers', teamIds: ['tm2'], createdAt: mockTimestamp() },
  { id: 'c3', clanName: 'Nova', teamIds: ['tm3'], createdAt: mockTimestamp() },
  { id: 'c4', clanName: 'Alphas', teamIds: ['tm4'], createdAt: mockTimestamp() }
];

const SEED_TOURNAMENTS = [
  {
    id: 't1',
    name: 'Heaven BR Showcase Season 1',
    season: '2026 Season 1',
    description: 'The inaugural showcase tournament of Heaven BR Battle Royale league.',
    status: 'active',
    createdAt: mockTimestamp(),
    completedAt: null,
    structure: {
      totalDays: 6,
      lobbiesPerDay: 4,
      playerClasses: [
        { className: 'Class 1', activeDays: [1,2,3,4,5,6], badgeColor: '#C00000' },
        { className: 'Class 2', activeDays: [3,4,5], badgeColor: '#00B0F0' }
      ]
    },
    scoring: {
      killPointValue: 2,
      placementPoints: [
        { position: 1, points: 25 },
        { position: 2, points: 20 },
        { position: 3, points: 15 },
        { position: 4, points: 10 },
        { position: 5, points: 5 }
      ],
      bonusTypes: [{ name: 'Wildcard Win' }, { name: 'Penalty' }]
    }
  }
];

// Seed Helper
export function seedDatabase() {
  if (!isBrowser) return;
  if (!localStorage.getItem('heaven_tournaments')) {
    localStorage.setItem('heaven_tournaments', JSON.stringify(SEED_TOURNAMENTS));
    localStorage.setItem('heaven_players', JSON.stringify(SEED_PLAYERS));
    localStorage.setItem('heaven_teams', JSON.stringify(SEED_TEAMS));
    localStorage.setItem('heaven_clans', JSON.stringify(SEED_CLANS));

    // Seed registrations
    const teamRegs = [
      { id: 'tr1', teamId: 'tm1', teamName: 'Heavenly Knights', clanName: 'Heavenly', slot: 1, tier: 'Tier 1' },
      { id: 'tr2', teamId: 'tm2', teamName: 'Viper Clan', clanName: 'Vipers', slot: 2, tier: 'Tier 1' },
      { id: 'tr3', teamId: 'tm3', teamName: 'Nova Storm', clanName: 'Nova', slot: 3, tier: 'Tier 1' },
      { id: 'tr4', teamId: 'tm4', teamName: 'Alpha Squad', clanName: 'Alphas', slot: 4, tier: 'Tier 2' },
    ];
    localStorage.setItem('heaven_regs_teams_t1', JSON.stringify(teamRegs));

    const playerRegs = [
      { id: 'pr1', playerId: 'p1', professionalName: 'Heaven', ign: 'heaven-afk', teamId: 'tm1', teamName: 'Heavenly Knights', clanName: 'Heavenly', slot: 1, class: 'Class 1', gender: 'Male', region: 'Europe', country: 'United Kingdom', device: 'iPad', deviceModel: 'Pro M4' },
      { id: 'pr2', playerId: 'p2', professionalName: 'Eques', ign: 'eques-zero', teamId: 'tm1', teamName: 'Heavenly Knights', clanName: 'Heavenly', slot: 2, class: 'Class 1', gender: 'Male', region: 'North America', country: 'United States', device: 'Phone', deviceModel: 'iPhone 15 Pro' },
      { id: 'pr3', playerId: 'p3', professionalName: 'Viper', ign: 'viper-strike', teamId: 'tm2', teamName: 'Viper Clan', clanName: 'Vipers', slot: 3, class: 'Class 1', gender: 'Male', region: 'Asia', country: 'Japan', device: 'Phone', deviceModel: 'ROG Phone 8' },
      { id: 'pr4', playerId: 'p4', professionalName: 'Nova', ign: 'nova-star', teamId: 'tm3', teamName: 'Nova Storm', clanName: 'Nova', slot: 4, class: 'Class 2', gender: 'Female', region: 'Europe', country: 'France', device: 'iPad', deviceModel: 'Air 5' },
      { id: 'pr5', playerId: 'p5', professionalName: 'Alpha', ign: 'alpha-omega', teamId: 'tm4', teamName: 'Alpha Squad', clanName: 'Alphas', slot: 5, class: 'Class 1', gender: 'Male', region: 'Latin America', country: 'Brazil', device: 'Phone', deviceModel: 'Galaxy S24 Ultra' },
    ];
    localStorage.setItem('heaven_regs_players_t1', JSON.stringify(playerRegs));

    // Seed matches results
    const teamResults = [];
    const playerResults = [];

    // Let's seed Day 1 & Day 2 lobbies (L1, L2, L3, L4)
    for (let day = 1; day <= 2; day++) {
      for (let lobby = 1; lobby <= 4; lobby++) {
        // Teams positions: tm1:1st, tm2:2nd, tm3:3rd, tm4:4th (Day 1) or slightly mixed (Day 2)
        const placements = day === 1 
          ? [{ tid: 'tm1', name: 'Heavenly Knights', place: 1, kills: 12 }, { tid: 'tm2', name: 'Viper Clan', place: 2, kills: 8 }, { tid: 'tm3', name: 'Nova Storm', place: 3, kills: 5 }, { tid: 'tm4', name: 'Alpha Squad', place: 4, kills: 4 }]
          : [{ tid: 'tm2', name: 'Viper Clan', place: 1, kills: 10 }, { tid: 'tm1', name: 'Heavenly Knights', place: 2, kills: 9 }, { tid: 'tm4', name: 'Alpha Squad', place: 3, kills: 6 }, { tid: 'tm3', name: 'Nova Storm', place: 4, kills: 3 }];
        
        placements.forEach(p => {
          teamResults.push({
            id: `tres_${day}_${lobby}_${p.tid}`,
            teamId: p.tid,
            teamName: p.name,
            day,
            lobby,
            placement: p.place,
            kills: p.kills,
            clanName: p.tid === 'tm1' ? 'Heavenly' : p.tid === 'tm2' ? 'Vipers' : p.tid === 'tm3' ? 'Nova' : 'Alphas'
          });
        });

        // Player results: Heaven: 6, Eques: 6, Viper: 8, Nova: 4, Alpha: 5
        const pKills = [
          { pid: 'p1', name: 'Heaven', ign: 'heaven-afk', tid: 'tm1', team: 'Heavenly Knights', kills: Math.floor(Math.random() * 5) + 3, dmg: Math.floor(Math.random() * 800) + 1200, acc: 0.28 },
          { pid: 'p2', name: 'Eques', ign: 'eques-zero', tid: 'tm1', team: 'Heavenly Knights', kills: Math.floor(Math.random() * 4) + 2, dmg: Math.floor(Math.random() * 600) + 900, acc: 0.22 },
          { pid: 'p3', name: 'Viper', ign: 'viper-strike', tid: 'tm2', team: 'Viper Clan', kills: Math.floor(Math.random() * 6) + 4, dmg: Math.floor(Math.random() * 1000) + 1500, acc: 0.32 },
          { pid: 'p5', name: 'Alpha', ign: 'alpha-omega', tid: 'tm4', team: 'Alpha Squad', kills: Math.floor(Math.random() * 5) + 2, dmg: Math.floor(Math.random() * 700) + 1000, acc: 0.25 }
        ];

        // Add Nova on Day 3 onwards as Class 2 (active only on D3-D5 in config)
        if (day >= 3) {
          pKills.push({ pid: 'p4', name: 'Nova', ign: 'nova-star', tid: 'tm3', team: 'Nova Storm', kills: Math.floor(Math.random() * 4) + 1, dmg: Math.floor(Math.random() * 500) + 800, acc: 0.24 });
        }

        pKills.forEach(pk => {
          playerResults.push({
            id: `pres_${day}_${lobby}_${pk.pid}`,
            playerId: pk.pid,
            playerName: pk.name,
            ign: pk.ign,
            teamId: pk.tid,
            teamName: pk.team,
            day,
            lobby,
            kills: pk.kills,
            damage: pk.dmg,
            accuracy: pk.acc,
            clanName: pk.tid === 'tm1' ? 'Heavenly' : pk.tid === 'tm2' ? 'Vipers' : pk.tid === 'tm3' ? 'Nova' : 'Alphas'
          });
        });
      }
    }

    localStorage.setItem('heaven_results_teams_t1', JSON.stringify(teamResults));
    localStorage.setItem('heaven_results_players_t1', JSON.stringify(playerResults));
    localStorage.setItem('heaven_bonus_t1', JSON.stringify([
      { id: 'b1', teamId: 'tm1', day: 1, type: 'Wildcard Win', amount: 5, note: 'Lobby sweep bonus' }
    ]));
  }
}

// ─── Local DB CRUD Implementation ─────────────────────────────────────────────

// Tournaments
export function localGetTournaments() {
  seedDatabase();
  return getStorageItem('heaven_tournaments');
}

export function localGetTournament(id) {
  const list = localGetTournaments();
  return list.find(t => t.id === id) || null;
}

export function localCreateTournament(data) {
  const list = localGetTournaments();
  const id = 't_' + Math.random().toString(36).substr(2, 9);
  const newT = {
    id,
    name: '', season: '', description: '', status: 'setup',
    createdAt: mockTimestamp(), completedAt: null,
    structure: { totalDays: 6, lobbiesPerDay: 4, playerClasses: [] },
    scoring: { killPointValue: 2, placementPoints: [], bonusTypes: [] },
    ...data
  };
  list.unshift(newT);
  setStorageItem('heaven_tournaments', list);
  return newT;
}

export function localUpdateTournament(id, data) {
  const list = localGetTournaments();
  const index = list.findIndex(t => t.id === id);
  if (index !== -1) {
    list[index] = { ...list[index], ...data };
    setStorageItem('heaven_tournaments', list);
  }
}

export function localSetTournamentStatus(id, status) {
  const updates = { status };
  if (status === 'completed') updates.completedAt = mockTimestamp();
  localUpdateTournament(id, updates);
}

export function localDeleteTournament(id) {
  let list = localGetTournaments();
  list = list.filter(t => t.id !== id);
  setStorageItem('heaven_tournaments', list);

  // Clean up associated local storage keys
  if (isBrowser) {
    localStorage.removeItem(`heaven_regs_teams_${id}`);
    localStorage.removeItem(`heaven_regs_players_${id}`);
    localStorage.removeItem(`heaven_results_teams_${id}`);
    localStorage.removeItem(`heaven_results_players_${id}`);
    localStorage.removeItem(`heaven_bonus_${id}`);
  }
}

// Team Registrations
export function localGetTeamRegistrations(tId) {
  return getStorageItem(`heaven_regs_teams_${tId}`);
}

export function localAddTeamRegistration(tId, data) {
  const list = localGetTeamRegistrations(tId);
  const newReg = { id: 'treg_' + Date.now() + Math.random().toString(36).substr(2, 5), teamId: '', slot: list.length + 1, tier: '', ...data };
  list.push(newReg);
  setStorageItem(`heaven_regs_teams_${tId}`, list);
  return newReg;
}

export function localUpdateTeamRegistration(tId, regId, data) {
  const list = localGetTeamRegistrations(tId);
  const index = list.findIndex(r => r.id === regId);
  if (index !== -1) {
    list[index] = { ...list[index], ...data };
    setStorageItem(`heaven_regs_teams_${tId}`, list);
  }
}

export function localDeleteTeamRegistration(tId, regId) {
  let list = localGetTeamRegistrations(tId);
  list = list.filter(r => r.id !== regId);
  setStorageItem(`heaven_regs_teams_${tId}`, list);
}

// Player Registrations
export function localGetPlayerRegistrations(tId) {
  return getStorageItem(`heaven_regs_players_${tId}`);
}

export function localAddPlayerRegistration(tId, data) {
  const list = localGetPlayerRegistrations(tId);
  const newReg = { id: 'preg_' + Date.now() + Math.random().toString(36).substr(2, 5), playerId: '', slot: list.length + 1, class: '', teamId: '', ign: '', ...data };
  list.push(newReg);
  setStorageItem(`heaven_regs_players_${tId}`, list);
  return newReg;
}

export function localUpdatePlayerRegistration(tId, regId, data) {
  const list = localGetPlayerRegistrations(tId);
  const index = list.findIndex(r => r.id === regId);
  if (index !== -1) {
    list[index] = { ...list[index], ...data };
    setStorageItem(`heaven_regs_players_${tId}`, list);
  }
}

export function localDeletePlayerRegistration(tId, regId) {
  let list = localGetPlayerRegistrations(tId);
  list = list.filter(r => r.id !== regId);
  setStorageItem(`heaven_regs_players_${tId}`, list);
}

// Players Global Registry
export function localGetPlayers() {
  seedDatabase();
  return getStorageItem('heaven_players');
}

export function localGetPlayer(id) {
  const list = localGetPlayers();
  return list.find(p => p.id === id) || null;
}

export function localCreatePlayer(data) {
  const list = localGetPlayers();
  const existing = list.find(p => p.professionalName.toLowerCase() === data.professionalName?.toLowerCase());
  if (existing) return existing;
  const newP = {
    id: 'p_' + Math.random().toString(36).substr(2, 9),
    professionalName: '', ign: '', gender: '', region: '', country: '',
    device: '', deviceModel: '', tournamentIds: [], createdAt: mockTimestamp(),
    ...data
  };
  list.push(newP);
  setStorageItem('heaven_players', list);
  return newP;
}

export function localUpdatePlayer(id, data) {
  const list = localGetPlayers();
  const index = list.findIndex(p => p.id === id);
  if (index !== -1) {
    list[index] = { ...list[index], ...data };
    setStorageItem('heaven_players', list);
  }
}

export function localDeletePlayer(id) {
  let list = localGetPlayers();
  list = list.filter(p => p.id !== id);
  setStorageItem('heaven_players', list);
}

// Teams Global Registry
export function localGetTeams() {
  seedDatabase();
  return getStorageItem('heaven_teams');
}

export function localGetTeam(id) {
  const list = localGetTeams();
  return list.find(t => t.id === id) || null;
}

export function localCreateTeam(data) {
  const list = localGetTeams();
  const existing = list.find(t => t.teamName.toLowerCase() === data.teamName?.toLowerCase());
  if (existing) return existing;
  
  if (data.clanName) {
    localEnsureClan(data.clanName);
  }

  const newT = {
    id: 'tm_' + Math.random().toString(36).substr(2, 9),
    teamName: '', clanName: '', tournamentIds: [], createdAt: mockTimestamp(),
    ...data
  };
  list.push(newT);
  setStorageItem('heaven_teams', list);
  return newT;
}

export function localUpdateTeam(id, data) {
  const list = localGetTeams();
  const index = list.findIndex(t => t.id === id);
  if (index !== -1) {
    list[index] = { ...list[index], ...data };
    setStorageItem('heaven_teams', list);
  }
}

export function localDeleteTeam(id) {
  let list = localGetTeams();
  list = list.filter(t => t.id !== id);
  setStorageItem('heaven_teams', list);
}

// Clans Global Registry
export function localGetClans() {
  seedDatabase();
  return getStorageItem('heaven_clans');
}

export function localEnsureClan(clanName) {
  if (!clanName) return null;
  const list = localGetClans();
  const existing = list.find(c => c.clanName.toLowerCase() === clanName.toLowerCase());
  if (existing) return existing;

  const newClan = {
    id: 'clan_' + Math.random().toString(36).substr(2, 9),
    clanName, teamIds: [], createdAt: mockTimestamp()
  };
  list.push(newClan);
  setStorageItem('heaven_clans', list);
  return newClan;
}

export function localGetClan(id) {
  const list = localGetClans();
  return list.find(c => c.id === id) || null;
}

// Team Match Results
export function localGetTeamMatchResults(tId) {
  return getStorageItem(`heaven_results_teams_${tId}`);
}

export function localSaveTeamMatchResult(tId, data) {
  const list = localGetTeamMatchResults(tId);
  const newRes = { id: 'tres_' + Date.now() + Math.random().toString(36).substr(2, 5), teamId: '', day: 1, lobby: 1, placement: 0, kills: 0, ...data };
  
  // Prevent duplicate placements per day/lobby
  const filteredList = list.filter(r => !(r.day === data.day && r.lobby === data.lobby && r.teamId === data.teamId));
  filteredList.push(newRes);
  
  setStorageItem(`heaven_results_teams_${tId}`, filteredList);
  return newRes;
}

export function localUpdateTeamMatchResult(tId, resId, data) {
  const list = localGetTeamMatchResults(tId);
  const index = list.findIndex(r => r.id === resId);
  if (index !== -1) {
    list[index] = { ...list[index], ...data };
    setStorageItem(`heaven_results_teams_${tId}`, list);
  }
}

export function localDeleteTeamMatchResult(tId, resId) {
  let list = localGetTeamMatchResults(tId);
  list = list.filter(r => r.id !== resId);
  setStorageItem(`heaven_results_teams_${tId}`, list);
}

// Player Match Results
export function localGetPlayerMatchResults(tId) {
  return getStorageItem(`heaven_results_players_${tId}`);
}

export function localSavePlayerMatchResult(tId, data) {
  const list = localGetPlayerMatchResults(tId);
  const newRes = { id: 'pres_' + Date.now() + Math.random().toString(36).substr(2, 5), playerId: '', day: 1, lobby: 1, kills: 0, damage: 0, accuracy: 0, ...data };
  
  // Prevent duplicates
  const filteredList = list.filter(r => !(r.day === data.day && r.lobby === data.lobby && r.playerId === data.playerId));
  filteredList.push(newRes);

  setStorageItem(`heaven_results_players_${tId}`, filteredList);
  return newRes;
}

export function localUpdatePlayerMatchResult(tId, resId, data) {
  const list = localGetPlayerMatchResults(tId);
  const index = list.findIndex(r => r.id === resId);
  if (index !== -1) {
    list[index] = { ...list[index], ...data };
    setStorageItem(`heaven_results_players_${tId}`, list);
  }
}

// Bonus Points
export function localGetBonusPoints(tId) {
  return getStorageItem(`heaven_bonus_${tId}`);
}

export function localAddBonusPoint(tId, data) {
  const list = localGetBonusPoints(tId);
  const newBonus = { id: 'bonus_' + Date.now() + Math.random().toString(36).substr(2, 5), teamId: '', day: 1, type: '', amount: 0, note: '', ...data };
  list.push(newBonus);
  setStorageItem(`heaven_bonus_${tId}`, list);
  return newBonus;
}

export function localUpdateBonusPoint(tId, bonusId, data) {
  const list = localGetBonusPoints(tId);
  const index = list.findIndex(b => b.id === bonusId);
  if (index !== -1) {
    list[index] = { ...list[index], ...data };
    setStorageItem(`heaven_bonus_${tId}`, list);
  }
}

export function localDeleteBonusPoint(tId, bonusId) {
  let list = localGetBonusPoints(tId);
  list = list.filter(b => b.id !== bonusId);
  setStorageItem(`heaven_bonus_${tId}`, list);
}
