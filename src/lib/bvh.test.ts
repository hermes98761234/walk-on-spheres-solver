import { describe, expect, it } from 'vitest'
import { SegmentBVH, closestBrute } from './bvh.ts'
import { mulberry32 } from './rng.ts'

function randomSegs(n: number, rng: () => number): Float64Array {
  const a = new Float64Array(n * 4)
  for (let i = 0; i < n; i++) {
    const x = rng() * 100, y = rng() * 100
    a[4 * i] = x; a[4 * i + 1] = y
    a[4 * i + 2] = x + (rng() - 0.5) * 20; a[4 * i + 3] = y + (rng() - 0.5) * 20
  }
  return a
}

describe('SegmentBVH', () => {
  it('closest point matches brute force', () => {
    const rng = mulberry32(7)
    for (const n of [1, 3, 17, 300]) {
      const segs = randomSegs(n, rng)
      const bvh = new SegmentBVH(segs)
      for (let k = 0; k < 300; k++) {
        const x = rng() * 140 - 20, y = rng() * 140 - 20
        const b = closestBrute(segs, x, y)
        const d2 = bvh.closest(x, y)
        expect(d2).toBeCloseTo(b.d2, 9)
        expect(bvh.px).toBeCloseTo(b.px, 6)
        expect(bvh.py).toBeCloseTo(b.py, 6)
      }
    }
  })

  it('raycast matches brute force', () => {
    const rng = mulberry32(11)
    const segs = randomSegs(120, rng)
    const bvh = new SegmentBVH(segs)
    for (let k = 0; k < 300; k++) {
      const ox = rng() * 100, oy = rng() * 100, th = rng() * 2 * Math.PI
      const dx = Math.cos(th), dy = Math.sin(th)
      let best = Infinity
      for (let i = 0; i < 120; i++) {
        const ax = segs[4 * i], ay = segs[4 * i + 1], ex = segs[4 * i + 2] - ax, ey = segs[4 * i + 3] - ay
        const den = dx * ey - dy * ex
        if (den === 0) continue
        const t = ((ax - ox) * ey - (ay - oy) * ex) / den
        const u = ((ax - ox) * dy - (ay - oy) * dx) / den
        if (t > 0 && u >= 0 && u <= 1 && t < best) best = t
      }
      const t = bvh.raycast(ox, oy, dx, dy, Infinity)
      if (best === Infinity) expect(t).toBe(Infinity)
      else expect(t).toBeCloseTo(best, 9)
    }
  })

  it('handles an empty set', () => {
    const bvh = new SegmentBVH(new Float64Array(0))
    expect(bvh.closest(0, 0)).toBe(Infinity)
    expect(bvh.raycast(0, 0, 1, 0, 10)).toBe(Infinity)
  })
})
