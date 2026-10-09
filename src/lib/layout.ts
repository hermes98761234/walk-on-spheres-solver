import type { Scene } from './scene.ts'

/** Shared description of what is being solved and where each point lives in the flat arrays. */
export interface Layout {
  /** Point coordinates: probes, then arrow sites, then heat-map cell centers. */
  pts: Float64Array
  /** Sample multiplier per point (probes and arrows get more walks per pass). */
  mult: Uint8Array
  nProbe: number
  nArrow: number
  /** Points with a gradient estimate: probes + arrows (they come first). */
  nGrad: number
  ax: number
  ay: number
  nx: number
  ny: number
  /** First index counted for convergence: heat-map cells, or probes in probe-only mode. */
  probeOnlyStart: number
}

export interface SolveSettings { probeOnly: boolean; resolution: number; arrows: boolean }

export function buildLayout(scene: Scene, probes: { x: number; y: number }[], st: SolveSettings): Layout {
  const nx = st.probeOnly ? 0 : st.resolution
  const ny = st.probeOnly ? 0 : Math.max(1, Math.round((st.resolution * scene.height) / scene.width))
  const ax = st.probeOnly || !st.arrows ? 0 : 24
  const ay = ax ? Math.max(1, Math.round((ax * scene.height) / scene.width)) : 0
  const nProbe = probes.length, nArrow = ax * ay, n = nProbe + nArrow + nx * ny
  const pts = new Float64Array(n * 2), mult = new Uint8Array(n)
  let k = 0
  for (const p of probes) { pts[2 * k] = p.x; pts[2 * k + 1] = p.y; mult[k++] = st.probeOnly ? 1 : 8 }
  for (let j = 0; j < ay; j++) for (let i = 0; i < ax; i++) { pts[2 * k] = ((i + 0.5) * scene.width) / ax; pts[2 * k + 1] = ((j + 0.5) * scene.height) / ay; mult[k++] = 12 }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { pts[2 * k] = ((i + 0.5) * scene.width) / nx; pts[2 * k + 1] = ((j + 0.5) * scene.height) / ny; mult[k++] = 1 }
  return { pts, mult, nProbe, nArrow, nGrad: nProbe + nArrow, ax, ay, nx, ny, probeOnlyStart: nx > 0 ? nProbe + nArrow : 0 }
}

/** Running sums for every point; merged from worker deltas. */
export class Accum {
  /** [sum, sum², n] per point */
  v: Float64Array
  /** [gx, gy, gx², gy²] per gradient point */
  g: Float64Array
  walks = 0
  readonly n: number
  readonly nGrad: number
  constructor(n: number, nGrad: number) {
    this.n = n
    this.nGrad = nGrad
    this.v = new Float64Array(n * 3)
    this.g = new Float64Array(nGrad * 4)
  }
  merge(v: Float64Array, g: Float64Array, walks: number) {
    for (let i = 0; i < v.length; i++) this.v[i] += v[i]
    for (let i = 0; i < g.length; i++) this.g[i] += g[i]
    this.walks += walks
  }
  count(i: number) { return this.v[3 * i + 2] }
  mean(i: number) { const n = this.v[3 * i + 2]; return n > 0 ? this.v[3 * i] / n : NaN }
  stderr(i: number) {
    const n = this.v[3 * i + 2]
    if (n < 2) return NaN
    const m = this.v[3 * i] / n
    return Math.sqrt(Math.max(0, (this.v[3 * i + 1] / n - m * m) * (n / (n - 1))) / n)
  }
  /** Gradient mean (gx, gy) and standard error of its magnitude estimate. */
  grad(i: number): { gx: number; gy: number; se: number } {
    const n = this.v[3 * i + 2]
    if (n < 2) return { gx: NaN, gy: NaN, se: NaN }
    const sx = this.g[4 * i], sy = this.g[4 * i + 1]
    const vx = Math.max(0, this.g[4 * i + 2] / n - (sx / n) ** 2), vy = Math.max(0, this.g[4 * i + 3] / n - (sy / n) ** 2)
    return { gx: sx / n, gy: sy / n, se: Math.sqrt((vx + vy) / n) }
  }
}
