/**
 * Ends a live room, so the win screen can be looked at without playing a game
 * out to the finish.
 *
 *   node scripts/end-game.mjs 4GK6            # the seat to move wins
 *   node scripts/end-game.mjs 4GK6 yellow     # that colour wins
 *   node scripts/end-game.mjs 4GK6 --abandon  # ended by everyone leaving
 *
 * It writes straight to the database over REST, which works while the rules in
 * database.rules.json are still unpublished. Once they are published this stops
 * working — an unauthenticated write is exactly what those rules are there to
 * refuse — and the way to test the win screen then is the emulator.
 *
 * Nothing in here is imported by the app; it is a development tool.
 */

import { readFileSync } from 'node:fs';

const COLORS = ['green', 'yellow', 'blue', 'red'];

const [code, ...flags] = process.argv.slice(2);
const abandon = flags.includes('--abandon');
const winner = flags.find((flag) => COLORS.includes(flag));

if (!code) {
  console.error('usage: node scripts/end-game.mjs <ROOM CODE> [colour] [--abandon]');
  process.exit(1);
}

/** The database URL, from the same env files Vite reads. */
function databaseUrl() {
  for (const file of ['.env.local', '.env']) {
    let contents;
    try {
      contents = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    const match = contents.match(/^VITE_FIREBASE_DATABASE_URL=(.+)$/m);
    if (match) return match[1].trim().replace(/\/$/, '');
  }
  throw new Error('No VITE_FIREBASE_DATABASE_URL in .env.local or .env');
}

const db = databaseUrl();
const room = await (await fetch(`${db}/rooms/${code.toUpperCase()}.json`)).json();

if (!room) throw new Error(`No room ${code}`);
if (room.status !== 'playing') throw new Error(`Room ${code} is ${room.status}, not playing`);

const state = room.gameState;
const seats = state.players.map((player) => player.color);
const won = winner ?? seats[state.turnIndex] ?? seats[0];
if (!seats.includes(won)) throw new Error(`No ${won} seat — this room is ${seats.join(', ')}`);

// The same shape a real win leaves behind: the winner first in winnerOrder, the
// phase closed, and the room finished. Everyone watching jumps to the result.
const patch = abandon
  ? { status: 'finished', endedReason: 'abandoned' }
  : {
      status: 'finished',
      endedReason: 'won',
      gameState: {
        ...state,
        phase: 'game-over',
        winnerOrder: [won, ...seats.filter((color) => color !== won)],
        version: (state.version ?? 0) + 1,
      },
    };

const response = await fetch(`${db}/rooms/${code.toUpperCase()}.json`, {
  method: 'PATCH',
  body: JSON.stringify(patch),
});
if (!response.ok) {
  throw new Error(`Write refused (${response.status}) — are the security rules published?`);
}

console.log(
  abandon
    ? `Room ${code.toUpperCase()} abandoned.`
    : `Room ${code.toUpperCase()} finished — ${won} wins.`,
);
