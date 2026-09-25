import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore';

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

async function inspectTournament(t) {
  console.log(`\n======================================================`);
  console.log(`Tournament: ${t.name} (ID: ${t.id})`);
  console.log(`======================================================`);

  const tDoc = await getDoc(doc(db, 'tournaments', t.id));
  if (!tDoc.exists()) {
    console.log(`Tournament doc NOT FOUND!`);
    return;
  }
  const tData = tDoc.data();
  console.log(`Type: ${tData.type}, Status: ${tData.status}, Stage: ${tData.stage || tData.stageName || 'N/A'}`);
  console.log(`Structure:`, JSON.stringify(tData.structure || {}));
  console.log(`Scoring:`, JSON.stringify(tData.scoring || {}));

  // Inspect subcollections
  const subcollections = [
    'teamRegistrations',
    'playerRegistrations',
    'teamMatchResults',
    'playerMatchResults',
    'bonusPoints',
    'groups'
  ];

  for (const sub of subcollections) {
    const snap = await getDocs(collection(db, 'tournaments', t.id, sub));
    console.log(`Subcollection '${sub}': ${snap.docs.length} docs`);
    if (snap.docs.length > 0 && (sub === 'teamMatchResults' || sub === 'playerMatchResults')) {
      const sample = snap.docs[0].data();
      console.log(`  Sample '${sub}' keys:`, Object.keys(sample));
      console.log(`  Sample doc:`, JSON.stringify(sample).slice(0, 200));
      
      // Let's see distinct days and lobbies
      const days = new Set();
      const lobbies = new Set();
      for (const d of snap.docs) {
        const dData = d.data();
        if (dData.day !== undefined) days.add(dData.day);
        if (dData.lobby !== undefined) lobbies.add(dData.lobby);
      }
      console.log(`  Distinct days:`, [...days].sort((a,b)=>a-b));
      console.log(`  Distinct lobbies:`, [...lobbies].sort((a,b)=>a-b));
    }
    if (sub === 'groups' && snap.docs.length > 0) {
      for (const g of snap.docs) {
        console.log(`  Group:`, g.id, g.data());
      }
    }
  }
}

async function main() {
  for (const t of TOURNAMENTS) {
    await inspectTournament(t);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
