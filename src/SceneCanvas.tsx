import { useEffect, useRef, useState } from 'react'
import { canvasHeight, computeView, draw, toWorld, toScreen, type DrawOpts, type Draft } from './lib/render.ts'
import { hitShape, translate, type Probe, type Pt, type Scene, type Shape, type ShapeKind } from './lib/scene.ts'
import { defaultValue, newId } from './lib/presets.ts'

export type Tool = 'select' | 'probe' | 'poly' | 'circle' | 'rect'

interface Props {
  opts: Omit<DrawOpts, 'draft'>
  tool: Tool
  newKind: ShapeKind
  onScene: (f: (s: Scene) => Scene) => void
  onProbes: (f: (p: Probe[]) => Probe[]) => void
  onSelect: (shapeId: number | null, probeId: number | null) => void
  onToolDone: () => void
}

const round = (v: number) => Math.round(v * 10) / 10

export default function SceneCanvas({ opts, tool, newKind, onScene, onProbes, onSelect, onToolDone }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [draft, setDraft] = useState<Draft | undefined>()
  const drag = useRef<{ kind: 'shape' | 'probe' | 'new'; id: number; last: Pt; start: Pt } | null>(null)
  const poly = useRef<Pt[]>([])
  const optsRef = useRef(opts)
  optsRef.current = opts
  const scene = opts.scene
  const height = canvasHeight(width, scene)

  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.floor(el.clientWidth))))
    ro.observe(el)
    setWidth(Math.max(280, Math.floor(el.clientWidth)))
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = ref.current!, dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr); c.height = Math.round(height * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, width, height, { ...opts, draft })
  })

  // reset the polygon in progress when the tool changes
  useEffect(() => { poly.current = []; setDraft(undefined) }, [tool])

  const finishPoly = () => {
    const pts = poly.current
    if (pts.length >= 3) {
      const shape: Shape = { id: newId(), kind: newKind, value: defaultValue(newKind, scene.unit), geom: { t: 'poly', pts } }
      onScene((s) => ({ ...s, shapes: [...s.shapes, shape] }))
      onSelect(shape.id, null)
      onToolDone()
    }
    poly.current = []
    setDraft(undefined)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') { poly.current = []; setDraft(undefined) }
      else if (e.key === 'Enter' && poly.current.length) finishPoly()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pos = (e: React.PointerEvent): { px: number; py: number; w: Pt } => {
    const r = ref.current!.getBoundingClientRect()
    const px = e.clientX - r.left, py = e.clientY - r.top
    const v = computeView(width, height, scene)
    const [x, y] = toWorld(v, px, py)
    return { px, py, w: [round(x), round(y)] }
  }
  const inScene = (p: Pt) => p[0] >= 0 && p[1] >= 0 && p[0] <= scene.width && p[1] <= scene.height

  const onDown = (e: React.PointerEvent) => {
    const { px, py, w } = pos(e)
    const v = computeView(width, height, scene)
    ref.current!.setPointerCapture(e.pointerId)
    if (tool === 'probe') {
      if (!inScene(w)) return
      const p: Probe = { id: newId(), x: w[0], y: w[1] }
      onProbes((ps) => [...ps, p])
      onSelect(null, p.id)
    } else if (tool === 'select') {
      const near = optsRef.current.probes.find((p) => { const [sx, sy] = toScreen(v, p.x, p.y); return Math.hypot(sx - px, sy - py) < 11 })
      if (near) { drag.current = { kind: 'probe', id: near.id, last: w, start: w }; onSelect(null, near.id); return }
      const sh = hitShape(scene, w[0], w[1])
      onSelect(sh?.id ?? null, null)
      if (sh) drag.current = { kind: 'shape', id: sh.id, last: w, start: w }
    } else if (tool === 'poly') {
      const pts = poly.current
      const [fx, fy] = pts.length ? toScreen(v, pts[0][0], pts[0][1]) : [Infinity, Infinity]
      if (e.detail >= 2 || (pts.length >= 3 && Math.hypot(fx - px, fy - py) < 10)) { finishPoly(); return }
      if (inScene(w)) { pts.push(w); setDraft({ poly: [...pts], cursor: w }) }
    } else {
      drag.current = { kind: 'new', id: 0, last: w, start: w }
    }
  }

  const geomFor = (a: Pt, b: Pt) => tool === 'circle'
    ? { t: 'circle' as const, cx: a[0], cy: a[1], r: round(Math.hypot(b[0] - a[0], b[1] - a[1])) }
    : { t: 'rect' as const, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: round(Math.abs(b[0] - a[0])), h: round(Math.abs(b[1] - a[1])) }

  const onMove = (e: React.PointerEvent) => {
    const { w } = pos(e)
    const d = drag.current
    if (!d) { if (tool === 'poly' && poly.current.length) setDraft({ poly: [...poly.current], cursor: w }); return }
    if (d.kind === 'new') setDraft({ geom: geomFor(d.start, w) })
    else if (d.kind === 'probe') onProbes((ps) => ps.map((p) => (p.id === d.id ? { ...p, x: w[0], y: w[1] } : p)))
    else {
      const dx = w[0] - d.last[0], dy = w[1] - d.last[1]
      if (dx || dy) onScene((s) => ({ ...s, shapes: s.shapes.map((sh) => (sh.id === d.id ? { ...sh, geom: translate(sh.geom, dx, dy) } : sh)) }))
      d.last = w
    }
  }

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.kind !== 'new') return
    const g = geomFor(d.start, pos(e).w)
    setDraft(undefined)
    const ok = g.t === 'circle' ? g.r >= 1 : g.w >= 1 && g.h >= 1
    if (!ok) return
    const shape: Shape = { id: newId(), kind: newKind, value: defaultValue(newKind, scene.unit), geom: g }
    onScene((s) => ({ ...s, shapes: [...s.shapes, shape] }))
    onSelect(shape.id, null)
    onToolDone()
  }

  return (
    <div ref={wrap} className="canvas-wrap">
      <canvas
        ref={ref}
        style={{ width, height, cursor: tool === 'select' ? 'default' : 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        role="img"
        aria-label="Domain editor and solution heat map"
      />
    </div>
  )
}
