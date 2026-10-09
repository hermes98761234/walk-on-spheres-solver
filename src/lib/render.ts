import { colorAt, lut, niceTicks, type MapName } from './colormap.ts'
import { contourSegments } from './contour.ts'
import type { Accum, Layout } from './layout.ts'
import { fixedRange, outerPolygon, toPolygon, type Geom, type Probe, type Pt, type Scene } from './scene.ts'

export interface Display { map: MapName; isolines: number; arrows: boolean; probeOnly: boolean }
export interface Draft { geom?: Geom; poly?: Pt[]; cursor?: Pt }
export interface DrawOpts {
  scene: Scene
  layout: Layout
  acc: Accum | null
  display: Display
  probes: Probe[]
  selectedId: number | null
  selectedProbe: number | null
  draft?: Draft
  dark: boolean
  analytic?: ((x: number, y: number) => number) | null
}
export interface View { s: number; ox: number; oy: number; legendW: number }

export function computeView(W: number, H: number, scene: Scene): View {
  const legendW = W < 520 ? 60 : 80, pad = 10
  const s = Math.min((W - legendW - pad) / scene.width, (H - 2 * pad) / scene.height)
  return { s, ox: pad, oy: (H - scene.height * s) / 2, legendW }
}
export function canvasHeight(W: number, scene: Scene): number {
  const legendW = W < 520 ? 60 : 80
  return Math.round(((W - legendW - 10) * scene.height) / scene.width + 20)
}
export const toScreen = (v: View, x: number, y: number): Pt => [v.ox + x * v.s, v.oy + y * v.s]
export const toWorld = (v: View, px: number, py: number): Pt => [(px - v.ox) / v.s, (py - v.oy) / v.s]

export function colorRange(scene: Scene, layout: Layout, acc: Accum | null): [number, number] {
  let [lo, hi] = fixedRange(scene)
  if (acc) {
    for (let i = layout.nGrad; i < acc.n; i++) {
      if (acc.count(i) < 8) continue
      const m = acc.mean(i)
      if (m < lo) lo = m
      if (m > hi) hi = m
    }
  }
  if (!(hi > lo)) { lo -= 1; hi += 1 }
  return [lo, hi]
}

export function formatNum(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '–'
  const a = Math.abs(v)
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(digits - 1)
  return String(+v.toPrecision(digits))
}

function path(ctx: CanvasRenderingContext2D, v: View, pts: Pt[]) {
  ctx.beginPath()
  pts.forEach(([x, y], i) => { const [px, py] = toScreen(v, x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py) })
  ctx.closePath()
}

function hatch(ctx: CanvasRenderingContext2D, dark: boolean): CanvasPattern | null {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d')!
  g.fillStyle = dark ? '#2b3039' : '#d5d9e0'
  g.fillRect(0, 0, 8, 8)
  g.strokeStyle = dark ? '#6b7280' : '#7b8494'
  g.lineWidth = 1.2
  g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke()
  return ctx.createPattern(c, 'repeat')
}

/** 3x3 blur over valid neighbors, used only for isolines. */
function smooth(f: Float32Array, nx: number, ny: number): Float32Array {
  const o = new Float32Array(f.length)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (Number.isNaN(f[j * nx + i])) { o[j * nx + i] = NaN; continue }
    let s = 0, w = 0
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
      const val = f[jj * nx + ii]
      if (Number.isNaN(val)) continue
      const wt = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1
      s += val * wt; w += wt
    }
    o[j * nx + i] = s / w
  }
  return o
}

export function draw(ctx: CanvasRenderingContext2D, W: number, H: number, o: DrawOpts) {
  const { scene, layout, acc, display, dark } = o
  const v = computeView(W, H, scene)
  const ink = dark ? '#e6e8ec' : '#1b1f27', bg = dark ? '#171a21' : '#ffffff'
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const [lo, hi] = colorRange(scene, layout, acc)
  const norm = (x: number) => (x - lo) / (hi - lo)
  const outer = outerPolygon(scene)

  // domain backdrop
  path(ctx, v, outer)
  ctx.fillStyle = dark ? '#20242d' : '#eef0f4'
  ctx.fill()

  // heat map
  const { nx, ny } = layout
  const cell0 = layout.nGrad
  let field: Float32Array | null = null
  if (acc && nx > 0) {
    const img = document.createElement('canvas')
    img.width = nx; img.height = ny
    const ictx = img.getContext('2d')!
    const data = ictx.createImageData(nx, ny)
    const t = lut(display.map)
    field = new Float32Array(nx * ny)
    for (let i = 0; i < nx * ny; i++) {
      const m = acc.count(cell0 + i) > 0 ? acc.mean(cell0 + i) : NaN
      field[i] = m
      if (Number.isNaN(m)) continue
      const k = Math.min(255, Math.max(0, Math.round(norm(m) * 255)))
      data.data[4 * i] = t[3 * k]; data.data[4 * i + 1] = t[3 * k + 1]; data.data[4 * i + 2] = t[3 * k + 2]; data.data[4 * i + 3] = 255
    }
    ictx.putImageData(data, 0, 0)
    ctx.save()
    path(ctx, v, outer)
    ctx.clip()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, v.ox, v.oy, scene.width * v.s, scene.height * v.s)
    ctx.restore()
  }

  // isolines
  if (field && display.isolines > 0) {
    const sm = smooth(field, nx, ny)
    ctx.save()
    path(ctx, v, outer); ctx.clip()
    ctx.lineWidth = 1
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)'
    for (let l = 1; l <= display.isolines; l++) {
      const level = lo + ((hi - lo) * l) / (display.isolines + 1)
      const seg = contourSegments(sm, nx, ny, level)
      ctx.beginPath()
      for (let i = 0; i < seg.length; i += 4) {
        ctx.moveTo(v.ox + ((seg[i] + 0.5) * scene.width * v.s) / nx, v.oy + ((seg[i + 1] + 0.5) * scene.height * v.s) / ny)
        ctx.lineTo(v.ox + ((seg[i + 2] + 0.5) * scene.width * v.s) / nx, v.oy + ((seg[i + 3] + 0.5) * scene.height * v.s) / ny)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  // shapes
  const pat = hatch(ctx, dark)
  for (const sh of scene.shapes) {
    const pts = toPolygon(sh.geom)
    path(ctx, v, pts)
    if (sh.kind === 'fixed') { const [r, g, b] = colorAt(display.map, norm(sh.value)); ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fill(); ctx.setLineDash([]); ctx.strokeStyle = ink; ctx.lineWidth = 1.5 }
    else if (sh.kind === 'insulated') { ctx.fillStyle = pat ?? '#999'; ctx.fill(); ctx.setLineDash([]); ctx.strokeStyle = dark ? '#9aa1ad' : '#4b5363'; ctx.lineWidth = 1.5 }
    else { ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fill(); ctx.setLineDash([5, 3]); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2 }
    ctx.stroke()
    ctx.setLineDash([])
  }
  path(ctx, v, outer)
  ctx.strokeStyle = scene.outer.kind === 'fixed' ? ink : dark ? '#9aa1ad' : '#4b5363'
  ctx.setLineDash(scene.outer.kind === 'fixed' ? [] : [6, 4])
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.setLineDash([])

  // flux / field arrows (-grad u)
  if (acc && display.arrows && layout.nArrow > 0) {
    const mags: number[] = []
    const g = (k: number) => acc.grad(layout.nProbe + k)
    for (let k = 0; k < layout.nArrow; k++) { const q = g(k); if (acc.count(layout.nProbe + k) >= 2) mags.push(Math.hypot(q.gx, q.gy)) }
    mags.sort((a, b) => a - b)
    const gmax = mags[Math.floor(mags.length * 0.95)] || 0
    if (gmax > 0) {
      const cell = Math.min((scene.width * v.s) / layout.ax, (scene.height * v.s) / layout.ay)
      for (let k = 0; k < layout.nArrow; k++) {
        const idx = layout.nProbe + k
        if (acc.count(idx) < 2) continue
        const { gx, gy } = g(k), m = Math.hypot(gx, gy)
        if (!(m > 0)) continue
        const L = cell * 0.9 * Math.min(1, Math.sqrt(m / gmax)), ux = -gx / m, uy = -gy / m
        const [cx, cy] = toScreen(v, layout.pts[2 * idx], layout.pts[2 * idx + 1])
        const x0 = cx - (ux * L) / 2, y0 = cy - (uy * L) / 2, x1 = cx + (ux * L) / 2, y1 = cy + (uy * L) / 2
        const head = Math.min(6, L * 0.4)
        const stroke = () => {
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1)
          ctx.moveTo(x1 - ux * head - uy * head * 0.6, y1 - uy * head + ux * head * 0.6); ctx.lineTo(x1, y1); ctx.lineTo(x1 - ux * head + uy * head * 0.6, y1 - uy * head - ux * head * 0.6)
          ctx.stroke()
        }
        ctx.lineCap = 'round'
        ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 3; stroke()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; stroke()
      }
    }
  }

  // draft
  const d = o.draft
  if (d) {
    ctx.strokeStyle = '#2563eb'; ctx.fillStyle = 'rgba(37,99,235,.15)'; ctx.lineWidth = 2; ctx.setLineDash([4, 3])
    if (d.geom) { path(ctx, v, toPolygon(d.geom)); ctx.fill(); ctx.stroke() }
    if (d.poly && d.poly.length) {
      const all = d.cursor ? [...d.poly, d.cursor] : d.poly
      ctx.beginPath()
      all.forEach(([x, y], i) => { const [px, py] = toScreen(v, x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py) })
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#2563eb'
      d.poly.forEach(([x, y]) => { const [px, py] = toScreen(v, x, y); ctx.beginPath(); ctx.arc(px, py, 3.5, 0, 7); ctx.fill() })
    }
    ctx.setLineDash([])
  }

  // selection
  const sel = scene.shapes.find((s) => s.id === o.selectedId)
  if (sel) { path(ctx, v, toPolygon(sel.geom)); ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 3; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]) }

  // probes
  ctx.font = '600 12px system-ui, sans-serif'
  o.probes.forEach((p, i) => {
    const [px, py] = toScreen(v, p.x, p.y)
    const selP = o.selectedProbe === p.id
    ctx.lineWidth = 3; ctx.strokeStyle = bg
    ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.moveTo(px - 9, py); ctx.lineTo(px + 9, py); ctx.moveTo(px, py - 9); ctx.lineTo(px, py + 9); ctx.stroke()
    ctx.lineWidth = 1.6; ctx.strokeStyle = selP ? '#2563eb' : '#ef4444'
    ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.moveTo(px - 9, py); ctx.lineTo(px + 9, py); ctx.moveTo(px, py - 9); ctx.lineTo(px, py + 9); ctx.stroke()
    let label = `P${i + 1}`
    if (W >= 520 && acc && layout.nProbe === o.probes.length && acc.count(i) > 1) label += `  ${formatNum(acc.mean(i))} ± ${formatNum(acc.stderr(i), 2)}`
    const w = ctx.measureText(label).width
    const lx = Math.min(px + 8, W - v.legendW - w - 6), ly = Math.max(py - 8, 16)
    ctx.fillStyle = dark ? 'rgba(15,17,21,.85)' : 'rgba(255,255,255,.88)'
    ctx.fillRect(lx - 3, ly - 12, w + 6, 16)
    ctx.fillStyle = ink
    ctx.fillText(label, lx, ly)
  })

  // legend
  const lx = W - v.legendW + 8, top = v.oy + 18, h = Math.max(60, scene.height * v.s - 36), bw = 14
  const grad = ctx.createLinearGradient(0, top + h, 0, top)
  for (let i = 0; i <= 8; i++) { const [r, g, b] = colorAt(display.map, i / 8); grad.addColorStop(i / 8, `rgb(${r},${g},${b})`) }
  ctx.fillStyle = grad
  ctx.fillRect(lx, top, bw, h)
  ctx.strokeStyle = ink; ctx.lineWidth = 1
  ctx.strokeRect(lx, top, bw, h)
  ctx.fillStyle = ink; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'
  for (const t of niceTicks(lo, hi, 5)) {
    const y = top + h - ((t - lo) / (hi - lo)) * h
    ctx.beginPath(); ctx.moveTo(lx + bw, y); ctx.lineTo(lx + bw + 3, y); ctx.stroke()
    ctx.fillText(formatNum(t, 4), lx + bw + 5, y)
  }
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.fillText(scene.unit, lx, top - 9)
  ctx.textBaseline = 'alphabetic'
}
