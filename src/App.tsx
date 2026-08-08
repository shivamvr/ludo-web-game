import { useEffect, useState } from 'react';
import { useAuth } from './data/useAuth';
import { normalizeCode } from './data/rooms';
import Home from './ui/Home';
import LocalGame from './ui/LocalGame';
import Room from './ui/Room';

const NAME_KEY = 'ludo.name';

/** The room code lives in the URL so an invite link drops you straight in. */
function readRoomFromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get('room');
  const code = raw ? normalizeCode(raw) : '';
  return code.length === 4 ? code : null;
}

function writeRoomToUrl(roomId: string | null) {
  const url = roomId
    ? `${window.location.pathname}?room=${roomId}`
    : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export default function App() {
  const auth = useAuth();
  const [roomId, setRoomId] = useState<string | null>(readRoomFromUrl);
  const [local, setLocal] = useState(false);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');

  useEffect(() => {
    localStorage.setItem(NAME_KEY, name);
  }, [name]);

  const enterRoom = (id: string) => {
    setRoomId(id);
    writeRoomToUrl(id);
  };

  const leaveRoom = () => {
    setRoomId(null);
    writeRoomToUrl(null);
  };

  if (local) {
    return <LocalGame onExit={() => setLocal(false)} />;
  }

  if (roomId && auth.uid) {
    return (
      <Room
        roomId={roomId}
        uid={auth.uid}
        name={name}
        onNameChange={setName}
        onLeave={leaveRoom}
      />
    );
  }

  return (
    <Home
      auth={auth}
      name={name}
      onNameChange={setName}
      onEnterRoom={enterRoom}
      onPlayLocal={() => setLocal(true)}
    />
  );
}
