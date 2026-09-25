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

async function main() {
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    console.log(`Total tournaments: ${snap.docs.length}`);
    for (const doc of snap.docs) {
      const data = doc.data();
      console.log(`ID: ${doc.id} | Name: "${data.name}" | Status: ${data.status} | Type: ${data.type}`);
    }
  } catch (e) {
    console.error('Error fetching tournaments:', e);
  }
}

main();
