/**
 * Estimate when a probe reaches its target from recent history.
 *
 * Uses a least-squares line over the last `windowMin` minutes of samples.
 * Samples arrive every few seconds from the server, so a time window (not a
 * point count) keeps the estimate stable regardless of the sampling rate.
 *
 * Returns { status: 'done' | 'stalled' | 'eta' | 'waiting', eta?: Date }.
 */
export function predictFinish(history, probeIndex, targetC, { windowMin = 15, minPoints = 8, minSpanMin = 3 } = {}) {
  if (targetC == null) return null;
  const now = history.length ? history[history.length - 1].t : Date.now();
  const pts = history
    .filter((s) => s.t >= now - windowMin * 60000 && s.p[probeIndex] != null)
    .map((s) => ({ x: (s.t - now) / 60000, y: s.p[probeIndex] }));

  const current = pts.length ? pts[pts.length - 1].y : null;
  if (current != null && current >= targetC) return { status: 'done' };
  if (pts.length < minPoints || pts[pts.length - 1].x - pts[0].x < minSpanMin) return { status: 'waiting' };

  const n = pts.length;
  let sx = 0; let sy = 0; let sxy = 0; let sxx = 0;
  for (const { x, y } of pts) {
    sx += x; sy += y; sxy += x * y; sxx += x * x;
  }
  const denom = n * sxx - sx * sx;
  if (!denom) return { status: 'waiting' };
  const slope = (n * sxy - sx * sy) / denom; // C per minute

  // Under ~0.05 C/min (about 1 F per 10 min) the meat is effectively stalled.
  if (!Number.isFinite(slope) || slope < 0.05) return { status: 'stalled' };

  const minutes = Math.min((targetC - current) / slope, 48 * 60);
  return { status: 'eta', eta: new Date(Date.now() + minutes * 60000) };
}
