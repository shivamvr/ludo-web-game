import { useEffect, useState } from 'react';
import { isFirebaseConfigured, missingConfigKeys, watchAuth } from './firebase';

export interface AuthState {
  uid: string | null;
  /** Config problem or sign-in failure, ready to show the user. */
  error: string | null;
  ready: boolean;
  configured: boolean;
  missingKeys: string[];
}

/** Sign in anonymously once, and hand the rest of the app a stable uid. */
export function useAuth(): AuthState {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return watchAuth(setUid, setError);
  }, []);

  return {
    uid,
    error,
    ready: uid !== null || error !== null || !isFirebaseConfigured,
    configured: isFirebaseConfigured,
    missingKeys: missingConfigKeys,
  };
}
