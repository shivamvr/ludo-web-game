import { useEffect, useRef, useState } from 'react';
import { onDisconnect, onValue, ref, serverTimestamp, update } from 'firebase/database';
import { getDb } from './firebase';

export interface Presence {
  /** Whether this client currently has a live connection to the database. */
  online: boolean;
  /** Best estimate of the server's clock, for grace-period arithmetic. */
  serverNow: () => number;
}

/**
 * Keep this player's presence flag current, and clear it automatically if the
 * connection drops.
 *
 * The order matters: the onDisconnect handler is registered *before* the
 * connected flag is set, so a client that dies in between never leaves a stale
 * "connected: true" behind. Reconnection needs no special handling — Firebase
 * re-fires `.info/connected`, and this runs again.
 */
export function usePresence(roomId: string | null, uid: string | null, seated: boolean): Presence {
  const [online, setOnline] = useState(false);
  // Server time minus local time. Clocks differ between phones, so every
  // grace-period comparison is made against this corrected clock.
  const offset = useRef(0);

  useEffect(() => {
    const unsubscribe = onValue(ref(getDb(), '.info/serverTimeOffset'), (snapshot) => {
      offset.current = typeof snapshot.val() === 'number' ? snapshot.val() : 0;
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!roomId || !uid || !seated) return;

    const db = getDb();
    const meRef = ref(db, `rooms/${roomId}/players/${uid}`);
    let active = true;

    const unsubscribe = onValue(ref(db, '.info/connected'), (snapshot) => {
      if (snapshot.val() !== true) {
        setOnline(false);
        return;
      }
      onDisconnect(meRef)
        .update({ connected: false, disconnectedAt: serverTimestamp() })
        .then(() => {
          if (!active) return;
          setOnline(true);
          return update(meRef, { connected: true, disconnectedAt: null });
        })
        .catch(() => {
          /* presence is best-effort; the game still plays without it */
        });
    });

    return () => {
      active = false;
      unsubscribe();
      // Leaving deliberately: drop the armed handler and mark ourselves away now
      // rather than waiting for the socket to notice.
      onDisconnect(meRef).cancel().catch(() => {});
      update(meRef, { connected: false, disconnectedAt: serverTimestamp() }).catch(() => {});
    };
  }, [roomId, uid, seated]);

  return {
    online,
    serverNow: () => Date.now() + offset.current,
  };
}
