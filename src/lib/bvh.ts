/**
 * Bounding-volume hierarchy over 2D line segments.
 * Supports closest-point and ray queries; results of the last query are left in the public fields.
 * `segs` is a flat array [x0, y0, x1, y1, ...].
 */
const LEAF_SIZE = 4
const PAD = 1e-7

export class SegmentBVH {
  readonly n: number
  /** Index of the segment found by the last query. */
  idx = -1
  /** Closest point on that segment (closest queries only). */
  px = 0
  py = 0

  private order: Int32Array
  private box: Float64Array // minx, miny, maxx, maxy per node
  private left: Int32Array // child node ids, or -1 for a leaf
  private right: Int32Array
  private start: Int32Array
  private count: Int32Array
  private nodes = 0
  private stack = new Int32Array(128)

  readonly segs: Float64Array

  constructor(segs: Float64Array) {
    this.segs = segs
    this.n = segs.length / 4
    const cap = Math.max(1, 2 * this.n)
    this.order = new Int32Array(this.n)
    for (let i = 0; i < this.n; i++) this.order[i] = i
    this.box = new Float64Array(cap * 4)
    this.left = new Int32Array(cap)
    this.right = new Int32Array(cap)
    this.start = new Int32Array(cap)
    this.count = new Int32Array(cap)
    if (this.n > 0) this.build(0, this.n)
  }

  private build(lo: number, hi: number): number {
    const id = this.nodes++
    const s = this.segs
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    let cminx = Infinity, cminy = Infinity, cmaxx = -Infinity, cmaxy = -Infinity
    for (let i = lo; i < hi; i++) {
      const k = this.order[i] * 4
      const x0 = s[k], y0 = s[k + 1], x1 = s[k + 2], y1 = s[k + 3]
      minx = Math.min(minx, x0, x1); maxx = Math.max(maxx, x0, x1)
      miny = Math.min(miny, y0, y1); maxy = Math.max(maxy, y0, y1)
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      cminx = Math.min(cminx, cx); cmaxx = Math.max(cmaxx, cx)
      cminy = Math.min(cminy, cy); cmaxy = Math.max(cmaxy, cy)
    }
    const b = id * 4
    this.box[b] = minx - PAD; this.box[b + 1] = miny - PAD
    this.box[b + 2] = maxx + PAD; this.box[b + 3] = maxy + PAD
    if (hi - lo <= LEAF_SIZE) {
      this.left[id] = -1; this.right[id] = -1
      this.start[id] = lo; this.count[id] = hi - lo
      return id
    }
    const axis = cmaxx - cminx >= cmaxy - cminy ? 0 : 1
    const sub = this.order.subarray(lo, hi)
    sub.sort((a, c) => s[a * 4 + axis] + s[a * 4 + axis + 2] - s[c * 4 + axis] - s[c * 4 + axis + 2])
    const mid = (lo + hi) >> 1
    this.left[id] = this.build(lo, mid)
    this.right[id] = this.build(mid, hi)
    return id
  }

  private boxDist2(node: number, x: number, y: number): number {
    const b = node * 4
    const dx = Math.max(this.box[b] - x, 0, x - this.box[b + 2])
    const dy = Math.max(this.box[b + 1] - y, 0, y - this.box[b + 3])
    return dx * dx + dy * dy
  }

  /** Squared distance to the closest segment (Infinity if empty or beyond maxD2). */
  closest(x: number, y: number, maxD2 = Infinity): number {
    if (this.n === 0) return Infinity
    const s = this.segs, st = this.stack
    let best = maxD2
    let sp = 0
    st[sp++] = 0
    this.idx = -1
    while (sp > 0) {
      const node = st[--sp]
      if (this.boxDist2(node, x, y) >= best) continue
      const l = this.left[node]
      if (l < 0) {
        const end = this.start[node] + this.count[node]
        for (let i = this.start[node]; i < end; i++) {
          const si = this.order[i], k = si * 4
          const ax = s[k], ay = s[k + 1]
          const ex = s[k + 2] - ax, ey = s[k + 3] - ay
          const len2 = ex * ex + ey * ey
          let t = len2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / len2 : 0
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const qx = ax + t * ex, qy = ay + t * ey
          const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy)
          if (d2 < best) { best = d2; this.idx = si; this.px = qx; this.py = qy }
        }
      } else {
        const r = this.right[node]
        // push the farther child first so the nearer one is visited first
        if (this.boxDist2(l, x, y) <= this.boxDist2(r, x, y)) { st[sp++] = r; st[sp++] = l } else { st[sp++] = l; st[sp++] = r }
      }
    }
    return this.idx < 0 ? Infinity : best
  }

  /** Distance t along the ray (ox,oy)+t(dx,dy) to the first segment hit with 0 < t < tmax, else Infinity. */
  raycast(ox: number, oy: number, dx: number, dy: number, tmax: number): number {
    if (this.n === 0) return Infinity
    const s = this.segs, st = this.stack, box = this.box
    const ix = 1 / dx, iy = 1 / dy
    let best = tmax
    let sp = 0
    st[sp++] = 0
    this.idx = -1
    while (sp > 0) {
      const node = st[--sp]
      const b = node * 4
      let t1 = (box[b] - ox) * ix, t2 = (box[b + 2] - ox) * ix
      let lo = Math.min(t1, t2), hi = Math.max(t1, t2)
      t1 = (box[b + 1] - oy) * iy; t2 = (box[b + 3] - oy) * iy
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2))
      if (!(hi >= Math.max(lo, 0) && lo < best)) continue
      const l = this.left[node]
      if (l < 0) {
        const end = this.start[node] + this.count[node]
        for (let i = this.start[node]; i < end; i++) {
          const si = this.order[i], k = si * 4
          const ax = s[k], ay = s[k + 1]
          const ex = s[k + 2] - ax, ey = s[k + 3] - ay
          const den = dx * ey - dy * ex
          if (den === 0) continue
          const wx = ax - ox, wy = ay - oy
          const t = (wx * ey - wy * ex) / den
          const u = (wx * dy - wy * dx) / den
          if (t > 0 && t < best && u >= 0 && u <= 1) { best = t; this.idx = si }
        }
      } else { st[sp++] = this.right[node]; st[sp++] = l }
    }
    return this.idx < 0 ? Infinity : best
  }
}

/** Reference implementation for tests: squared distance to the closest segment by brute force. */
export function closestBrute(segs: Float64Array, x: number, y: number): { d2: number; idx: number; px: number; py: number } {
  let best = { d2: Infinity, idx: -1, px: 0, py: 0 }
  for (let i = 0; i < segs.length / 4; i++) {
    const ax = segs[i * 4], ay = segs[i * 4 + 1]
    const ex = segs[i * 4 + 2] - ax, ey = segs[i * 4 + 3] - ay
    const len2 = ex * ex + ey * ey
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0
    const qx = ax + t * ex, qy = ay + t * ey
    const d2 = (x - qx) ** 2 + (y - qy) ** 2
    if (d2 < best.d2) best = { d2, idx: i, px: qx, py: qy }
  }
  return best
}
