/**
 * Walk on spheres / walk on stars for  -Δu = f  with Dirichlet and homogeneous Neumann boundaries in 2D.
 *
 * Dirichlet segments end a walk (epsilon shell). Neumann segments reflect it:
 * each step samples a direction in the star-shaped region around x (a ball of radius R = distance to the
 * Dirichlet boundary, cut off by the first Neumann wall along each ray). The ball Green's function gives
 * kernel dθ/2π on both the arc and the visible walls, so the next point is simply the ray's end point.
 * Sources use the ball Green's function G = ln(R/ρ)/2π. Gradients use the antithetic sphere estimator.
 */
import { SegmentBVH } from './bvh.ts'
import type { Rng } from './rng.ts'

export interface Solid { poly: Float64Array; value: number }
export interface Source { poly: Float64Array; f: number }

export interface ProblemSpec {
  /** Flat segments [x0,y0,x1,y1,...]. */
  segs: Float64Array
  /** 0 = Dirichlet, 1 = Neumann (insulated), per segment. */
  kind: Uint8Array
  /** Dirichlet value per segment (ignored for Neumann). */
  val: Float64Array
  /** Solid fixed-value bodies (points inside take their value). */
  fixed: Solid[]
  /** Insulated bodies (points inside are not part of the domain). */
  holes: Float64Array[]
  sources: Source[]
  outer: { type: 'rect'; w: number; h: number } | { type: 'circle'; cx: number; cy: number; r: number }
  eps: number
}

export const FREE = 0, FIXED = 1, MASKED = 2
const TWO_PI = Math.PI * 2

export function pointInPoly(poly: Float64Array, x: number, y: number): boolean {
  let inside = false
  const n = poly.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i], yi = poly[2 * i + 1], xj = poly[2 * j], yj = poly[2 * j + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export class Problem {
  readonly dir: SegmentBVH
  readonly neu: SegmentBVH
  private dval: Float64Array
  private eps: number
  private epsN: number
  /** Value of the fixed solid found by the last locate() call. */
  locValue = 0
  maxSteps = 4000

  /** `g` overrides the per-segment Dirichlet value with a function of the boundary point (used by tests). */
  readonly spec: ProblemSpec
  private g?: (x: number, y: number) => number
  constructor(spec: ProblemSpec, g?: (x: number, y: number) => number) {
    this.spec = spec
    this.g = g
    const d: number[] = [], nn: number[] = [], dv: number[] = []
    for (let i = 0; i < spec.kind.length; i++) {
      const s = spec.segs.subarray(4 * i, 4 * i + 4)
      if (spec.kind[i] === 0) { d.push(s[0], s[1], s[2], s[3]); dv.push(spec.val[i]) } else nn.push(s[0], s[1], s[2], s[3])
    }
    if (dv.length === 0) throw new Error('A fixed-value (Dirichlet) boundary is required')
    this.dir = new SegmentBVH(new Float64Array(d))
    this.neu = new SegmentBVH(new Float64Array(nn))
    this.dval = new Float64Array(dv)
    this.eps = spec.eps
    this.epsN = spec.eps * 1e-2
  }

  /** FREE, FIXED (value in locValue) or MASKED (outside the domain). */
  locate(x: number, y: number): number {
    const o = this.spec.outer
    if (o.type === 'rect') {
      if (x < 0 || y < 0 || x > o.w || y > o.h) return MASKED
    } else if ((x - o.cx) ** 2 + (y - o.cy) ** 2 > o.r * o.r) return MASKED
    for (const s of this.spec.fixed) if (pointInPoly(s.poly, x, y)) { this.locValue = s.value; return FIXED }
    for (const h of this.spec.holes) if (pointInPoly(h, x, y)) return MASKED
    return FREE
  }

  private sourceAt(x: number, y: number): number {
    let f = 0
    for (const s of this.spec.sources) if (pointInPoly(s.poly, x, y)) f += s.f
    return f
  }

  /** One unbiased sample of u at a free point. */
  walk(x: number, y: number, rng: Rng): number {
    const hasN = this.neu.n > 0, hasS = this.spec.sources.length > 0
    let acc = 0
    let onWall = false, wnx = 0, wny = 0
    for (let step = 0; step < this.maxSteps; step++) {
      const d2 = this.dir.closest(x, y)
      const d = Math.sqrt(d2)
      if (d < this.eps || step === this.maxSteps - 1) return acc + this.boundaryValue()
      const R = d
      const base = onWall ? Math.atan2(wny, wnx) - Math.PI / 2 : 0
      const span = onWall ? Math.PI : TWO_PI
      if (hasS) {
        const th = base + span * rng(), rho = R * Math.sqrt(rng())
        const c = Math.cos(th), s = Math.sin(th)
        const sx = x + rho * c, sy = y + rho * s
        const f = this.sourceAt(sx, sy)
        if (f !== 0 && !(hasN && this.neu.raycast(x, y, c, s, rho) < Infinity)) acc += 0.5 * R * R * f * Math.log(R / rho)
      }
      const th = base + span * rng()
      const c = Math.cos(th), s = Math.sin(th)
      const t = hasN ? this.neu.raycast(x, y, c, s, R) : Infinity
      if (t < R) {
        const k = this.neu.idx * 4, sg = this.neu.segs
        let ex = sg[k + 3] - sg[k + 1], ey = sg[k] - sg[k + 2] // normal (-ey', ex') up to sign
        const len = Math.hypot(ex, ey) || 1
        ex /= len; ey /= len
        if (ex * c + ey * s > 0) { ex = -ex; ey = -ey }
        x += t * c + this.epsN * ex; y += t * s + this.epsN * ey
        onWall = true; wnx = ex; wny = ey
      } else {
        x += R * c; y += R * s
        onWall = false
      }
    }
    return acc
  }

  /** Dirichlet value at the point found by the last dir.closest() call. */
  private boundaryValue(): number {
    return this.g ? this.g(this.dir.px, this.dir.py) : this.dval[this.dir.idx]
  }

  /**
   * One sample of u (out[0]) and, if `grad`, of ∇u (out[1], out[2]) at (x, y).
   * Returns false when the point is outside the domain.
   */
  sample(x: number, y: number, rng: Rng, grad: boolean, out: Float64Array): boolean {
    const loc = this.locate(x, y)
    if (loc === MASKED) return false
    if (loc === FIXED) { out[0] = this.locValue; out[1] = 0; out[2] = 0; return true }
    out[0] = this.walk(x, y, rng)
    if (!grad) return true
    const dd = this.dir.closest(x, y)
    const dn = this.neu.closest(x, y)
    const R = 0.9 * Math.sqrt(Math.min(dd, dn))
    if (!(R > 1e-9)) { out[1] = 0; out[2] = 0; return true }
    const th = TWO_PI * rng(), c = Math.cos(th), s = Math.sin(th)
    const dv = (this.walk(x + R * c, y + R * s, rng) - this.walk(x - R * c, y - R * s, rng)) / R
    let gx = dv * c, gy = dv * s
    if (this.spec.sources.length > 0) {
      const t2 = TWO_PI * rng(), rho = R * rng()
      const c2 = Math.cos(t2), s2 = Math.sin(t2)
      const f = this.sourceAt(x + rho * c2, y + rho * s2)
      const w = f * R * (1 - (rho * rho) / (R * R))
      gx += w * c2; gy += w * s2
    }
    out[1] = gx; out[2] = gy
    return true
  }
}
