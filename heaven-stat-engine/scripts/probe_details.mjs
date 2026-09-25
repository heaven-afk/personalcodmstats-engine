import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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
  { id: 'fzfBOCu36E55QFfoBxkW', name: 'FRIENDS OR FOES' },
  { id: 'xLGEeoQ0RBBoKnNflAw3', name: 'ELITE ESPORT' },
  { id: 'cfyGuA5dboYeyGp4XPYC', name: 'MAJOR GAMING LEAGUE TIER 1' }
];

async function checkDetails() {
  for (const t of TOURNAMENTS) {
    console.log(`\n--- TOURNAMENT: ${t.name} ---`);
    const pRegsSnap = await getDocs(collection(db, 'tournaments', t.id, 'playerRegistrations'));
    const tRegsSnap = await getDocs(collection(db, 'tournaments', t.id, 'teamRegistrations'));
    const pMatchSnap = await getDocs(collection(db, 'tournaments', t.id, 'playerMatchResults'));
    const tMatchSnap = await getDocs(collection(db, 'tournaments', t.id, 'teamMatchResults'));

    console.log('Player Reg sample:', pRegsSnap.docs[0]?.data());
    console.log('Team Reg sample:', tRegsSnap.docs[0]?.data());
    console.log('Player Match sample:', pMatchSnap.docs[0]?.data());
    console.log('Team Match sample:', tMatchSnap.docs[0]?.data());

    // Check if teamId is on playerMatchResults
    let pMatchHasTeamId = 0;
    for (const d of pMatchSnap.docs) {
      if (d.data().teamId) pMatchHasTeamId++;
    }
    console.log(`Player match results with teamId: ${pMatchHasTeamId} / ${pMatchSnap.docs.length}`);

    // Check if teamId in teamMatch matches teamRegistrations
    const regTeamIds = new Set(tRegsSnap.docs.map(d => d.data().teamId || d.id));
    let tMatchMatched = 0;
    for (const d of tMatchSnap.docs) {
      if (regTeamIds.has(d.data().teamId)) tMatchMatched++;
    }
    console.log(`Team match results matching teamRegistrations teamId: ${tMatchMatched} / ${tMatchSnap.docs.length}`);
  }
  process.exit(0);
}

checkDetails().catch(e => { console.error(e); process.exit(1); });
