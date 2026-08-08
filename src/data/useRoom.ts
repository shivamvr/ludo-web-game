import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { getDb } from './firebase';
import { toRoom, type Room } from './serialize';

export interface RoomSubscription {
  room: Room | null;
  loading: boolean;
  /** Set when the read is rejected — usually the security rules. */
  error: string | null;
}

/**
 * Subscribe to a room. Everything the game renders comes from here; the client
 * never keeps its own copy of the game state, so reconnects and other players'
 * moves both arrive the same way — as a new snapshot.
 */
export function useRoom(roomId: string | null): RoomSubscription {
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(roomId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    return onValue(
      ref(getDb(), `rooms/${roomId}`),
      (snapshot) => {
        setRoom(toRoom(roomId, snapshot.val()));
        setLoading(false);
      },
      (readError) => {
        setError(readError.message);
        setLoading(false);
      },
    );
  }, [roomId]);

  return { room, loading, error };
}
