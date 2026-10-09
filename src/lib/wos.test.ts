import { describe, expect, it } from 'vitest'
import { Problem, type ProblemSpec } from './wos.ts'
import { compileScene, type Scene } from './scene.ts'
import { PRESETS } from './presets.ts'
import { mulberry32 } from './rng.ts'

/** Mean and standard error of n samples of u at (x, y). */
function estimate(p: Problem, x: number, y: number, n: number, seed = 1) {
  const rng = mulberry32(seed), out = new Float64Array(3)
  let s = 0, s2 = 0
  for (let i = 0; i < n; i++) { p.sample(x, y, rng, false, out); s += out[0]; s2 += out[0] * out[0] }
  const mean = s / n
  return { mean, se: Math.sqrt(Math.max(0, s2 / n - mean * mean) / n) }
}

function circleSpec(r: number, f: number, kindV = 0): ProblemSpec {
  const N = 256, segs: number[] = []
  const pts = Array.from({ length: N }, (_, i) => [r * Math.cos((2 * Math.PI * i) / N), r * Math.sin((2 * Math.PI * i) / N)])
  for (let i = 0; i < N; i++) segs.push(...pts[i], ...pts[(i + 1) % N])
  const poly = new Float64Array(pts.flat())
  return {
    segs: new Float64Array(segs), kind: new Uint8Array(N).fill(kindV), val: new Float64Array(N), fixed: [], holes: [],
    sources: f ? [{ poly, f }] : [], outer: { type: 'circle', cx: 0, cy: 0, r: r + 1e-9 }, eps: 1e-5,
  }
}

describe('walk on spheres', () => {
  it('Laplace on a disk with harmonic data u = x gives u = x inside', () => {
    const p = new Problem(circleSpec(1, 0), (x) => x)
    for (const [x, y] of [[0.3, 0.2], [-0.5, 0.1], [0, 0.7], [0.8, -0.3]]) {
      const e = estimate(p, x, y, 20000)
      expect(Math.abs(e.mean - x)).toBeLessThan(4 * e.se + 1e-3)
      expect(e.se).toBeLessThan(0.01)
    }
  })

  it('Poisson -Δu = 1 on the unit disk gives (1 - r²)/4', () => {
    const p = new Problem(circleSpec(1, 1))
    for (const [x, y] of [[0, 0], [0.5, 0], [0.3, -0.6], [-0.7, 0.2]]) {
      const e = estimate(p, x, y, 40000)
      const exact = (1 - x * x - y * y) / 4
      expect(Math.abs(e.mean - exact)).toBeLessThan(4 * e.se + 1e-3)
    }
  })

  it('coax: matches V(r) = V0 ln(b/r) / ln(b/a) within error bars', () => {
    const pr = PRESETS[2]()
    const p = new Problem(compileScene(pr.scene))
    for (const [x, y] of pr.probes) {
      const e = estimate(p, x, y, 20000)
      expect(Math.abs(e.mean - pr.analytic!(x, y))).toBeLessThan(4 * e.se + 0.1)
    }
  })

  it('walk on stars: insulated top/bottom with fixed ends gives the linear profile', () => {
    const scene: Scene = {
      unit: 'V', width: 10, height: 4, outer: { shape: 'rect', kind: 'insulated', value: 0 },
      shapes: [
        { id: 1, kind: 'fixed', value: 0, geom: { t: 'rect', x: 0, y: 0, w: 0.5, h: 4 } },
        { id: 2, kind: 'fixed', value: 10, geom: { t: 'rect', x: 9.5, y: 0, w: 0.5, h: 4 } },
      ],
    }
    const p = new Problem(compileScene(scene))
    for (const [x, y] of [[2, 1], [5, 3.5], [7.5, 0.3]]) {
      const e = estimate(p, x, y, 8000)
      expect(Math.abs(e.mean - (x - 0.5) * (10 / 9))).toBeLessThan(4 * e.se + 0.02)
    }
  })

  it('insulated walls with a source: -Δu = 1 in a Neumann-sided channel matches the 1D solution', () => {
    // channel 0<x<10 with u=0 at both ends and insulated sides: u = x(10-x)/2
    const scene: Scene = {
      unit: '°C', width: 10, height: 3, outer: { shape: 'rect', kind: 'insulated', value: 0 },
      shapes: [
        { id: 1, kind: 'fixed', value: 0, geom: { t: 'rect', x: 0, y: 0, w: 1e-3, h: 3 } },
        { id: 2, kind: 'fixed', value: 0, geom: { t: 'rect', x: 10 - 1e-3, y: 0, w: 1e-3, h: 3 } },
        { id: 3, kind: 'source', value: 1, geom: { t: 'rect', x: 0, y: 0, w: 10, h: 3 } },
      ],
    }
    const p = new Problem(compileScene(scene))
    const e = estimate(p, 5, 1.5, 20000)
    expect(Math.abs(e.mean - 12.5)).toBeLessThan(4 * e.se + 0.05)
  })

  it('gradient estimator recovers ∇u = (1, 0) for u = x', () => {
    const p = new Problem(circleSpec(1, 0), (x) => x)
    const rng = mulberry32(5), out = new Float64Array(3)
    let gx = 0, gy = 0
    const n = 20000
    for (let i = 0; i < n; i++) { p.sample(0.2, 0.1, rng, true, out); gx += out[1]; gy += out[2] }
    expect(gx / n).toBeCloseTo(1, 1)
    expect(Math.abs(gy / n)).toBeLessThan(0.05)
  })

  it('gradient with a source: -Δu = 1 on the disk gives ∇u = -r/2', () => {
    const p = new Problem(circleSpec(1, 1))
    const rng = mulberry32(9), out = new Float64Array(3)
    let gx = 0
    const n = 40000
    for (let i = 0; i < n; i++) { p.sample(0.4, 0, rng, true, out); gx += out[1] }
    expect(gx / n).toBeCloseTo(-0.2, 1)
  })
})
