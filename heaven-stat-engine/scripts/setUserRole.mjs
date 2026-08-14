/**
 * Heaven Stat Engine — Role Assignment Tool
 * 
 * Usage:
 *   node scripts/setUserRole.mjs <email_or_uid> <owner|operator> [serviceAccountKey.json]
 * 
 * Example:
 *   node scripts/setUserRole.mjs operator@example.com operator
 *   node scripts/setUserRole.mjs ogadizion01@gmail.com owner
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const [,, targetUser, role, serviceAccountPath] = process.argv;

if (!targetUser || !role || !['owner', 'operator'].includes(role.toLowerCase())) {
  console.error('\n❌ Usage: node scripts/setUserRole.mjs <email_or_uid> <owner|operator> [serviceAccountPath]\n');
  process.exit(1);
}

const targetRole = role.toLowerCase();

// Initialize Firebase Admin
let app;
if (serviceAccountPath && existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(readFileSync(resolve(serviceAccountPath), 'utf8'));
  app = initializeApp({ credential: cert(serviceAccount) });
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    app = initializeApp({ credential: cert(serviceAccount) });
  } catch {
    app = initializeApp();
  }
} else {
  // Try default credentials or environment
  app = getApps().length ? getApps()[0] : initializeApp();
}

const auth = getAuth(app);

async function setRole() {
  try {
    let uid = targetUser;
    if (targetUser.includes('@')) {
      const userRecord = await auth.getUserByEmail(targetUser);
      uid = userRecord.uid;
      console.log(`Found user: ${userRecord.email} (${uid})`);
    } else {
      const userRecord = await auth.getUser(uid);
      console.log(`Found user: ${userRecord.email || 'No email'} (${uid})`);
    }

    // Set custom claim
    await auth.setCustomUserClaims(uid, { role: targetRole });
    console.log(`✅ Successfully set role "${targetRole}" for user ${uid}`);
    console.log(`Note: The user must refresh their token or sign in again for changes to take effect.\n`);
  } catch (error) {
    console.error(`❌ Failed to set role:`, error.message);
    process.exit(1);
  }
}

setRole();
