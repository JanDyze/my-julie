/** One received position, stamped with local arrival time. */
export interface Snapshot {
  t: number;
  x: number;
  y: number;
  angle: number;
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Drop snapshots already passed, keeping the one immediately behind us. */
export function pruneSnapshots(buffer: Snapshot[], renderTime: number): void {
  while (buffer.length > 2 && buffer[1].t <= renderTime) buffer.shift();
  if (buffer.length > 60) buffer.splice(0, buffer.length - 60);
}

/**
 * Position at `renderTime`, linearly between the two snapshots straddling it.
 * Constant velocity between packets is what makes running look continuous
 * instead of stepped. Returns null only for an empty buffer.
 */
export function sampleSnapshots(
  buffer: Snapshot[],
  renderTime: number,
): { x: number; y: number; angle: number } | null {
  if (buffer.length === 0) return null;

  const first = buffer[0];
  if (buffer.length === 1 || renderTime <= first.t) {
    return { x: first.x, y: first.y, angle: first.angle };
  }

  const from = buffer[0];
  const to = buffer[1];
  if (renderTime >= to.t) {
    // Starved of packets (sender paused or dropped): hold the newest sample.
    return { x: to.x, y: to.y, angle: to.angle };
  }

  const span = to.t - from.t;
  const k = span > 0 ? (renderTime - from.t) / span : 1;
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    angle: lerpAngle(from.angle, to.angle, k),
  };
}
