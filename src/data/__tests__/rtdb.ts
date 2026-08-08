/**
 * Model what Realtime Database actually does to a value: keys with a null value
 * are not stored, and an empty array or object is stored as nothing. Arrays with
 * contiguous keys come back as arrays.
 *
 * Passing every simulated write through this is what makes the room tests
 * exercise the same lossy round-trip the real database imposes.
 */
export function simulateRtdb(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const items = value.map(simulateRtdb).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const kept = simulateRtdb(raw);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

/**
 * A stand-in for one room node in the database: it stores exactly what RTDB
 * would store, and hands back exactly what RTDB would hand back.
 */
export class FakeRoomNode {
  private value: unknown = null;

  read(): unknown {
    return this.value === undefined ? null : structuredClone(this.value);
  }

  write(next: unknown): void {
    this.value = simulateRtdb(next) ?? null;
  }
}
