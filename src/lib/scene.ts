/** Editable 2D scene model and its compilation into a solver problem. */
import type { ProblemSpec, Solid, Source } from './wos.ts'

export type Pt = [number, number]
export type Geom =
  | { t: 'poly'; pts: Pt[] }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number }
export type ShapeKind = 'fixed' | 'insulated' | 'source'
export interface Shape { id: number; kind: ShapeKind; value: number; geom: Geom }
export type Unit = '°C' | 'V'
export interface Scene {
  unit: Unit
  width: number
  height: number
  outer: { shape: 'rect' | 'circle'; kind: 'fixed' | 'insulated'; value: number }
  shapes: Shape[]
}
export interface Probe { id: number; x: number; y: number }

export const CIRCLE_SEGMENTS = 128

export function toPolygon(g: Geom, n = CIRCLE_SEGMENTS): Pt[] {
  if (g.t === 'poly') return g.pts
  if (g.t === 'rect') return [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]]
  return Array.from({ length: n }, (_, i): Pt => [g.cx + g.r * Math.cos((2 * Math.PI * i) / n), g.cy + g.r * Math.sin((2 * Math.PI * i) / n)])
}

export function translate(g: Geom, dx: number, dy: number): Geom {
  if (g.t === 'poly') return { t: 'poly', pts: g.pts.map(([x, y]): Pt => [x + dx, y + dy]) }
  if (g.t === 'rect') return { ...g, x: g.x + dx, y: g.y + dy }
  return { ...g, cx: g.cx + dx, cy: g.cy + dy }
}

function flat(pts: Pt[]): Float64Array {
  const a = new Float64Array(pts.length * 2)
  pts.forEach(([x, y], i) => { a[2 * i] = x; a[2 * i + 1] = y })
  return a
}

export function outerPolygon(s: Scene): Pt[] {
  if (s.outer.shape === 'circle') return toPolygon({ t: 'circle', cx: s.width / 2, cy: s.height / 2, r: Math.min(s.width, s.height) / 2 }, 160)
  return toPolygon({ t: 'rect', x: 0, y: 0, w: s.width, h: s.height })
}

export function hasFixedBoundary(s: Scene): boolean {
  return s.outer.kind === 'fixed' || s.shapes.some((sh) => sh.kind === 'fixed')
}

export function compileScene(s: Scene): ProblemSpec {
  const segs: number[] = [], kind: number[] = [], val: number[] = []
  const addLoop = (pts: Pt[], k: number, v: number) => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      segs.push(a[0], a[1], b[0], b[1]); kind.push(k); val.push(v)
    }
  }
  addLoop(outerPolygon(s), s.outer.kind === 'fixed' ? 0 : 1, s.outer.value)
  const fixed: Solid[] = [], holes: Float64Array[] = [], sources: Source[] = []
  for (const sh of s.shapes) {
    const pts = toPolygon(sh.geom)
    if (sh.kind === 'fixed') { addLoop(pts, 0, sh.value); fixed.push({ poly: flat(pts), value: sh.value }) }
    else if (sh.kind === 'insulated') { addLoop(pts, 1, 0); holes.push(flat(pts)) }
    else sources.push({ poly: flat(pts), f: sh.value })
  }
  const outer: ProblemSpec['outer'] = s.outer.shape === 'circle'
    ? { type: 'circle', cx: s.width / 2, cy: s.height / 2, r: Math.min(s.width, s.height) / 2 }
    : { type: 'rect', w: s.width, h: s.height }
  return { segs: new Float64Array(segs), kind: new Uint8Array(kind), val: new Float64Array(val), fixed, holes, sources, outer, eps: 5e-5 * Math.max(s.width, s.height) }
}

/** Value range implied by the fixed boundaries (the solution lies within it unless sources are present). */
export function fixedRange(s: Scene): [number, number] {
  const v = s.shapes.filter((x) => x.kind === 'fixed').map((x) => x.value)
  if (s.outer.kind === 'fixed') v.push(s.outer.value)
  return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1]
}

export function hitShape(s: Scene, x: number, y: number): Shape | null {
  for (let i = s.shapes.length - 1; i >= 0; i--) {
    const sh = s.shapes[i]
    const pts = toPolygon(sh.geom, 48)
    let inside = false
    for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
      const [xi, yi] = pts[a], [xj, yj] = pts[b]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    if (inside) return sh
  }
  return null
}
