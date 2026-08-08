# Ludo

Mobile-first multiplayer Ludo. React + Vite + TypeScript on the front, Firebase
Realtime Database as the sync layer. There is no backend server.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm run dev -- --host  # also reachable from phones on the same wifi
npm test               # rules engine, serialisation and room logic
npm run build          # static site into dist/
```

Online play needs a `.env` with your Firebase settings — copy `.env.example` and
fill it in from the Firebase console. Without it the app still runs and offers
pass-and-play on one device.

## How it is put together

```
src/game/    pure rules engine — no React, no Firebase, no I/O
src/data/    Firebase: rooms, presence, and the reducers behind every write
src/ui/      board, lobby and game screens
```

The engine is pure `(state, input) -> new state`, which is what makes it safe to
run the same code on whichever client is taking its turn. `GameState` is plain
JSON so it can be written to the database verbatim.

Writes use a **current-player-writes** model: the player whose turn it is
computes the next state with the engine and writes it back; everyone else
subscribes and renders. Every write is a transaction that re-checks turn
ownership against fresh server data, and `database.rules.json` enforces the same
thing server-side.

## Security rules

`database.rules.json` is the deployable ruleset. Paste it into
**Firebase console → Realtime Database → Rules → Publish**.

To try rule changes locally without touching live data:

```bash
npx firebase-tools emulators:start --only database,auth   # needs JDK 21+
VITE_FIREBASE_EMULATOR=1 npm run dev
```

The emulator only enforces rules on the namespace your real database URL names
(e.g. `my-project-default-rtdb`). Any other namespace is served allow-all, so a
misconfigured namespace makes every rule test pass while proving nothing.

## Rules of play

Standard Ludo. Three decisions the rules leave open, resolved here as:

- Landing on a square with two or more opponent tokens captures **all** of them;
  there are no blockades.
- A six grants another roll. Captures and finishing a token do not.
- With three or four players the game continues past first place until one
  player is left, and `winnerOrder` records the finishing order.

## When somebody drops out

Presence is maintained with `onDisconnect`. If the player whose turn it is has
been away for 20 seconds, any other client passes the turn on — their seat and
tokens are kept, and they can rejoin mid-game. If fewer than two players are
present for 60 seconds the game ends as abandoned.
