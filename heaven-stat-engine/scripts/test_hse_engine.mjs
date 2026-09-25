import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { computeDailyStandings, computeDailyPlayerStandings } from '../src/lib/engine/standings.js';
import fs from 'fs';

const firebaseConfig = {
  apiKey: "AIzaSyDD1I7waKhyxl8wMv_xIx3nvdC-nzOBYgE",
  authDomain: "heaven-stat-engine.firebaseapp.com",
  projectId: "heaven-stat-engine",
  storageBucket: "heaven-stat-engine.firebasestorage.app",
  messagingSenderId: "33950859525",
  appId: "1:33950859525:web:32b519e58076f13294b76c"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TOURNAMENTS = [
  { id: 'fzfBOCu36E55QFfoBxkW', name: 'FRIENDS OR FOES', stage: 'N/A' },
  { id: 'xLGEeoQ0RBBoKnNflAw3', name: 'ELITE ESPORT', stage: 'N/A' },
  { id: 'cfyGuA5dboYeyGp4XPYC', name: 'MAJOR GAMING LEAGUE TIER 1', stage: 'Tier 1' }
];

async function testHseEngine() {
  for (const t of TOURNAMENTS) {
    console.log(`\n==============================================`);
    console.log(`Testing HSE Engine on: ${t.name}`);
    console.log(`==============================================`);

    const tDoc = await getDoc(doc(db, 'tournaments', t.id));
    const tData = tDoc.data();
    const tournamentConfig = {
      structure: tData.structure,
      scoring: tData.scoring
    };

    const [pRegsSnap, tRegsSnap, pMatchSnap, tMatchSnap, bonusSnap] = await Promise.all([
      getDocs(collection(db, 'tournaments', t.id, 'playerRegistrations')),
      getDocs(collection(db, 'tournaments', t.id, 'teamRegistrations')),
      getDocs(collection(db, 'tournaments', t.id, 'playerMatchResults')),
      getDocs(collection(db, 'tournaments', t.id, 'teamMatchResults')),
      getDocs(collection(db, 'tournaments', t.id, 'bonusPoints')),
    ]);

    const playerRegs = pRegsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const teamRegs = tRegsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const playerMatches = pMatchSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const teamMatches = tMatchSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const bonusPoints = bonusSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const totalDays = tData.structure?.totalDays || 6;
    for (let d = 1; d <= totalDays; d++) {
      const dailyTeamStandings = computeDailyStandings(teamMatches, bonusPoints, tData.scoring, d);
      const dailyPlayerStandings = computeDailyPlayerStandings(playerMatches, playerRegs, tournamentConfig, d, teamMatches);

      console.log(`Day ${d}: ${dailyTeamStandings.length} teams, ${dailyPlayerStandings.length} players`);
      if (d === 1 && dailyPlayerStandings.length > 0) {
        console.log(`  Sample HSE Player Standings:`, dailyPlayerStandings[0]);
      }
      if (d === 1 && dailyTeamStandings.length > 0) {
        console.log(`  Sample HSE Team Standings:`, dailyTeamStandings[0]);
      }
    }
  }
}

testHseEngine().catch(e => { console.error(e); process.exit(1); });
