/**
 * The single place Firebase is configured. Everything comes from VITE_FIREBASE_*
 * environment variables — nothing is hardcoded.
 *
 * Initialization is lazy and tolerant: with no .env present the app still runs
 * and offers local pass-and-play, and the lobby explains what is missing rather
 * than crashing on a white screen.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type Auth,
} from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Point at the local Firebase emulators instead of the real project. Set
 * VITE_FIREBASE_EMULATOR=1 to try rule changes without touching live data.
 */
const useEmulator = import.meta.env.VITE_FIREBASE_EMULATOR === '1';

/** The two values online play cannot work without. */
export const isFirebaseConfigured = useEmulator || Boolean(config.apiKey && config.databaseURL);

export const missingConfigKeys: string[] = Object.entries({
  VITE_FIREBASE_API_KEY: config.apiKey,
  VITE_FIREBASE_DATABASE_URL: config.databaseURL,
  VITE_FIREBASE_PROJECT_ID: config.projectId,
  VITE_FIREBASE_APP_ID: config.appId,
})
  .filter(([, value]) => !value)
  .map(([key]) => key);

let app: FirebaseApp | null = null;
let database: Database | null = null;
let auth: Auth | null = null;

function ensureApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new Error(`Firebase is not configured. Missing: ${missingConfigKeys.join(', ')}`);
  }
  app ??= initializeApp(
    useEmulator
      ? {
          apiKey: 'emulator',
          projectId: config.projectId || 'demo',
          databaseURL: `http://127.0.0.1:9000?ns=${emulatorNamespace()}`,
        }
      : config,
  );
  return app;
}

/**
 * The emulator enforces the rules file on exactly one namespace — the one your
 * real database URL names, e.g. `my-project-default-rtdb`. Any other namespace
 * is served with an allow-all ruleset, which would make local testing pass
 * while proving nothing.
 */
function emulatorNamespace(): string {
  try {
    if (config.databaseURL) return new URL(config.databaseURL).hostname.split('.')[0];
  } catch {
    /* fall through to the conventional name */
  }
  return `${config.projectId || 'demo'}-default-rtdb`;
}

export function getDb(): Database {
  // No connectDatabaseEmulator call: the URL above already points at the
  // emulator, and calling it as well throws once the instance is live.
  database ??= getDatabase(ensureApp());
  return database;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(ensureApp());
    if (useEmulator) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    }
  }
  return auth;
}

/**
 * Sign in anonymously and report the stable uid. Firebase persists the anonymous
 * account in the browser, so a refresh keeps the same uid and the player keeps
 * their seat.
 */
export function watchAuth(
  onUid: (uid: string) => void,
  onError: (message: string) => void,
): () => void {
  let unsubscribe = () => {};
  try {
    const instance = getFirebaseAuth();
    unsubscribe = onAuthStateChanged(instance, (user) => {
      if (user) onUid(user.uid);
    });
    signInAnonymously(instance).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    });
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
  }
  return () => unsubscribe();
}
