// The app's one star shape: five points with rounded tips. Used for the
// earned-star icons (SVG) and the celebration bursts (canvas).

/**
 * SVG path data for a 5-point star centred on (cx, cy) with outer radius r.
 * Each tip is cut back `round` of the way along its two edges and joined by a
 * curve through the tip, so the points are soft, not sharp.
 */
export function starPathData(cx: number, cy: number, r: number, inner = 0.46, round = 0.24): string {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  const f = (n: number) => +n.toFixed(2);
  const lerp = (p: number[], q: number[], t: number) => [f(p[0] + (q[0] - p[0]) * t), f(p[1] + (q[1] - p[1]) * t)];
  let d = "";
  for (let i = 0; i < 10; i += 2) {
    const tip = pts[i];
    const before = lerp(tip, pts[(i + 9) % 10], round);
    const after = lerp(tip, pts[i + 1], round);
    d += `${i ? "L" : "M"}${before[0]} ${before[1]}Q${f(tip[0])} ${f(tip[1])} ${after[0]} ${after[1]}L${f(pts[i + 1][0])} ${f(pts[i + 1][1])}`;
  }
  return d + "Z";
}

/** A unit star (radius 1 around 0,0) for canvas drawing. */
let unit: Path2D | null = null;

/** Fill a star of outer radius r at (x, y) in the current fill style. */
export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  unit ??= new Path2D(starPathData(0, 0, 1));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.fill(unit);
  ctx.restore();
}
