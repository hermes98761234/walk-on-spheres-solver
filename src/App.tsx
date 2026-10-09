import { useCallback, useEffect, useMemo, useState } from 'react'
import SceneCanvas, { type Tool } from './SceneCanvas.tsx'
import { MAP_NAMES, type MapName } from './lib/colormap.ts'
import { canvasHeight, draw, formatNum, type Display } from './lib/render.ts'
import { hasFixedBoundary, type Geom, type Probe, type Scene, type Shape, type ShapeKind } from './lib/scene.ts'
import { PRESETS, defaultValue, emptyScene, setNextId, toProbes } from './lib/presets.ts'
import type { SolveSettings } from './lib/layout.ts'
import { useSolver } from './useSolver.ts'

const STORE = 'wos-solver-v1'
interface Saved { scene: Scene; probes: Probe[]; presetId: string | null; analytic: string | null; settings: SolveSettings; map: MapName; isolines: number }

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Saved | null
    if (s && Array.isArray(s.scene?.shapes) && Array.isArray(s.probes) && s.scene.width > 0) {
      setNextId(1 + Math.max(0, ...s.scene.shapes.map((x) => x.id), ...s.probes.map((p) => p.id)))
      return s
    }
  } catch { /* fall through to the default preset */ }
  const p = PRESETS[0]()
  return { scene: p.scene, probes: toProbes(p.probes), presetId: p.id, analytic: null, settings: { probeOnly: false, resolution: 112, arrows: true }, map: 'inferno', isolines: 8 }
}

function useDark() {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)'), f = () => setDark(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return dark
}

function Num({ value, onChange, min, step = 'any', label }: { value: number; onChange: (v: number) => void; min?: number; step?: string; label: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText((t) => (Number(t) === value ? t : String(+value.toPrecision(6)))) }, [value])
  return (
    <label className="field"><span>{label}</span>
      <input type="number" inputMode="decimal" step={step} min={min} value={text} onChange={(e) => {
        setText(e.target.value)
        const v = parseFloat(e.target.value)
        if (Number.isFinite(v) && (min === undefined || v >= min)) onChange(v)
      }} />
    </label>
  )
}

const KIND_LABEL: Record<ShapeKind, string> = { fixed: 'Fixed value (conductor)', insulated: 'Insulated (Neumann)', source: 'Source region' }
const TOOLS: [Tool, string][] = [['probe', 'Probe'], ['select', 'Select / move'], ['poly', 'Polygon'], ['rect', 'Rectangle'], ['circle', 'Circle']]

export default function App() {
  const [init] = useState(load)
  const [scene, setScene] = useState<Scene>(init.scene)
  const [probes, setProbes] = useState<Probe[]>(init.probes)
  const [presetId, setPresetId] = useState<string | null>(init.presetId)
  const [analyticId, setAnalyticId] = useState<string | null>(init.analytic ?? (init.presetId === 'coax' ? 'coax' : null))
  const [settings, setSettings] = useState<SolveSettings>(init.settings)
  const [map, setMap] = useState<MapName>(init.map)
  const [isolines, setIsolines] = useState(init.isolines)
  const [tool, setTool] = useState<Tool>('probe')
  const [newKind, setNewKind] = useState<ShapeKind>('fixed')
  const [selShape, setSelShape] = useState<number | null>(null)
  const [selProbe, setSelProbe] = useState<number | null>(null)
  const dark = useDark()
  const { state, paused, setPaused } = useSolver(scene, probes, settings)
  const { layout, acc } = state

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify({ scene, probes, presetId, analytic: analyticId, settings, map, isolines } satisfies Saved))
  }, [scene, probes, presetId, analyticId, settings, map, isolines])

  const analytic = useMemo(() => (analyticId ? PRESETS.map((p) => p()).find((p) => p.id === analyticId)?.analytic ?? null : null), [analyticId])
  const editScene = useCallback((f: (s: Scene) => Scene) => { setScene(f); setAnalyticId(null) }, [])
  const display: Display = { map, isolines, arrows: settings.arrows, probeOnly: settings.probeOnly }
  const drawOpts = { scene, layout, acc, display, probes, selectedId: selShape, selectedProbe: selProbe, dark, analytic }
  const selected = scene.shapes.find((s) => s.id === selShape) ?? null
  const patchShape = (id: number, f: (s: Shape) => Shape) => editScene((s) => ({ ...s, shapes: s.shapes.map((x) => (x.id === id ? f(x) : x)) }))
  const patchGeom = (id: number, g: Partial<Geom>) => patchShape(id, (s) => ({ ...s, geom: { ...s.geom, ...g } as Geom }))

  const loadPreset = (id: string) => {
    const p = PRESETS.map((f) => f()).find((x) => x.id === id)
    if (!p) return
    setScene(p.scene); setProbes(toProbes(p.probes)); setPresetId(id); setAnalyticId(p.analytic ? id : null)
    setSelShape(null); setSelProbe(null)
  }
  const clearScene = () => { setScene(emptyScene()); setProbes([]); setPresetId(null); setAnalyticId(null); setSelShape(null); setSelProbe(null) }
  const del = () => {
    if (selShape !== null) { editScene((s) => ({ ...s, shapes: s.shapes.filter((x) => x.id !== selShape) })); setSelShape(null) }
    else if (selProbe !== null) { setProbes((p) => p.filter((x) => x.id !== selProbe)); setSelProbe(null) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT') return
      if (e.key === 'Delete' || e.key === 'Backspace') del()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const exportPng = () => {
    const W = 900, H = canvasHeight(W, scene), k = 2, c = document.createElement('canvas')
    c.width = W * k; c.height = H * k
    const ctx = c.getContext('2d')!
    ctx.scale(k, k)
    draw(ctx, W, H, { ...drawOpts, selectedId: null, selectedProbe: null })
    c.toBlob((b) => b && download(b, 'walk-on-spheres.png'))
  }
  const probeRows = probes.map((p, i) => {
    const ok = !!acc && layout.nProbe === probes.length && acc.count(i) > 1
    const g = ok ? acc!.grad(i) : null
    return { p, i, ok, mean: ok ? acc!.mean(i) : NaN, se: ok ? acc!.stderr(i) : NaN, n: ok ? acc!.count(i) : 0, fx: g ? -g.gx : NaN, fy: g ? -g.gy : NaN, exact: analytic ? analytic(p.x, p.y) : NaN }
  })
  const exportCsv = () => {
    const rows = [`probe,x_mm,y_mm,value_${scene.unit === 'V' ? 'V' : 'C'},stderr,minus_grad_x,minus_grad_y,walks${analytic ? ',analytic' : ''}`]
    for (const r of probeRows) rows.push([`P${r.i + 1}`, r.p.x, r.p.y, r.mean, r.se, r.fx, r.fy, r.n, ...(analytic ? [r.exact] : [])].join(','))
    download(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }), 'probes.csv')
  }

  const heat = scene.unit === '°C'
  const cap = settings.probeOnly ? 2_000_000 : 4096
  const statusText = state.status === 'invalid'
    ? (!hasFixedBoundary(scene) ? 'Add a fixed-value boundary: a pure insulated problem has no unique solution.' : 'Add a probe point to solve.')
    : `${state.status === 'done' ? 'Converged' : paused ? 'Paused' : 'Solving'} · ${formatNum(state.perPoint, 4)} walks per ${settings.probeOnly ? 'probe' : 'cell'} · ${formatNum(state.walksPerSec, 3)} walks/s · ${state.threads} workers`

  return (
    <div className="app">
      <header>
        <div>
          <h1>Walk on Spheres Solver</h1>
          <p className="sub">Mesh-free Monte Carlo solver for Laplace and Poisson problems, running in your browser.</p>
        </div>
        <label className="field inline"><span>Preset</span>
          <select value={presetId ?? ''} onChange={(e) => e.target.value && loadPreset(e.target.value)}>
            {presetId === null && <option value="">Custom</option>}
            {PRESETS.map((f) => { const p = f(); return <option key={p.id} value={p.id}>{p.name}</option> })}
          </select>
        </label>
      </header>

      <main>
        <section className="stage">
          <div className="toolbar" role="toolbar" aria-label="Drawing tools">
            {TOOLS.map(([t, label]) => <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)}>{label}</button>)}
            <label className="field inline"><span>New shape</span>
              <select value={newKind} onChange={(e) => setNewKind(e.target.value as ShapeKind)}>
                {(Object.keys(KIND_LABEL) as ShapeKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <button onClick={del} disabled={selShape === null && selProbe === null}>Delete</button>
          </div>
          <SceneCanvas
            opts={drawOpts} tool={tool} newKind={newKind}
            onScene={(f) => { editScene(f); setPresetId((p) => p) }}
            onProbes={setProbes}
            onSelect={(s, p) => { setSelShape(s); setSelProbe(p) }}
            onToolDone={() => setTool('select')}
          />
          <p className="hint">
            {tool === 'probe' && 'Click inside the domain to place a probe. Switch to Select to drag probes or shapes.'}
            {tool === 'select' && 'Click a shape to edit it, drag to move it. Delete removes the selection.'}
            {tool === 'poly' && 'Click to add corners. Click the first corner, double-click or press Enter to close; Esc cancels.'}
            {(tool === 'rect' || tool === 'circle') && 'Drag on the canvas to draw. The circle is drawn from its centre.'}
          </p>
          <div className="status" role="status">
            <progress max={cap} value={Math.min(cap, state.perPoint)} />
            <span>{statusText}</span>
            <button onClick={() => setPaused(!paused)} disabled={state.status === 'invalid'}>{paused || state.status === 'done' ? 'Resume' : 'Pause'}</button>
          </div>
        </section>

        <aside>
          <section className="card">
            <h2>Solver</h2>
            <label className="check"><input type="checkbox" checked={settings.probeOnly} onChange={(e) => setSettings({ ...settings, probeOnly: e.target.checked })} />
              Solve only at probe points (no grid at all)</label>
            <label className="field"><span>Heat-map columns</span>
              <select value={settings.resolution} disabled={settings.probeOnly} onChange={(e) => setSettings({ ...settings, resolution: +e.target.value })}>
                {[56, 80, 112, 160, 224].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <p className="note">Each cell and probe is an independent average of random walks, so there is no mesh. Error bars shrink as 1/√walks.</p>
          </section>

          <section className="card">
            <h2>Display</h2>
            <label className="field"><span>Colormap</span>
              <select value={map} onChange={(e) => setMap(e.target.value as MapName)}>{MAP_NAMES.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="field"><span>Isolines: {isolines}</span>
              <input type="range" min={0} max={20} value={isolines} onChange={(e) => setIsolines(+e.target.value)} /></label>
            <label className="check"><input type="checkbox" checked={settings.arrows} onChange={(e) => setSettings({ ...settings, arrows: e.target.checked })} />
              {heat ? 'Heat flux arrows (−∇T)' : 'Electric field arrows (−∇V)'}</label>
          </section>

          <section className="card">
            <h2>{selected ? 'Selected shape' : 'Scene'}</h2>
            {selected ? (
              <>
                <label className="field"><span>Type</span>
                  <select value={selected.kind} onChange={(e) => { const k = e.target.value as ShapeKind; patchShape(selected.id, (s) => ({ ...s, kind: k, value: defaultValue(k, scene.unit) })) }}>
                    {(Object.keys(KIND_LABEL) as ShapeKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select></label>
                {selected.kind === 'fixed' && <Num label={`Value (${scene.unit})`} value={selected.value} onChange={(v) => patchShape(selected.id, (s) => ({ ...s, value: v }))} />}
                {selected.kind === 'source' && <Num label={`Source f = −∇²u (${scene.unit}/mm²)`} value={selected.value} onChange={(v) => patchShape(selected.id, (s) => ({ ...s, value: v }))} />}
                {selected.geom.t === 'circle' && <div className="row">
                  <Num label="x" value={selected.geom.cx} onChange={(v) => patchGeom(selected.id, { cx: v })} />
                  <Num label="y" value={selected.geom.cy} onChange={(v) => patchGeom(selected.id, { cy: v })} />
                  <Num label="r" min={0.5} value={selected.geom.r} onChange={(v) => patchGeom(selected.id, { r: v })} /></div>}
                {selected.geom.t === 'rect' && <div className="row">
                  <Num label="x" value={selected.geom.x} onChange={(v) => patchGeom(selected.id, { x: v })} />
                  <Num label="y" value={selected.geom.y} onChange={(v) => patchGeom(selected.id, { y: v })} />
                  <Num label="w" min={0.5} value={selected.geom.w} onChange={(v) => patchGeom(selected.id, { w: v })} />
                  <Num label="h" min={0.5} value={selected.geom.h} onChange={(v) => patchGeom(selected.id, { h: v })} /></div>}
                <button onClick={del}>Delete shape</button>
              </>
            ) : (
              <>
                <label className="field"><span>Quantity</span>
                  <select value={scene.unit} onChange={(e) => editScene((s) => ({ ...s, unit: e.target.value as Scene['unit'] }))}>
                    <option value="°C">Temperature (°C)</option><option value="V">Voltage (V)</option></select></label>
                <div className="row">
                  <Num label="Width (mm)" min={10} value={scene.width} onChange={(v) => editScene((s) => ({ ...s, width: v }))} />
                  <Num label="Height (mm)" min={10} value={scene.height} onChange={(v) => editScene((s) => ({ ...s, height: v }))} />
                </div>
                <div className="row">
                  <label className="field"><span>Outline</span>
                    <select value={scene.outer.shape} onChange={(e) => editScene((s) => ({ ...s, outer: { ...s.outer, shape: e.target.value as 'rect' | 'circle' } }))}>
                      <option value="rect">Rectangle</option><option value="circle">Circle</option></select></label>
                  <label className="field"><span>Boundary</span>
                    <select value={scene.outer.kind} onChange={(e) => editScene((s) => ({ ...s, outer: { ...s.outer, kind: e.target.value as 'fixed' | 'insulated' } }))}>
                      <option value="fixed">Fixed</option><option value="insulated">Insulated</option></select></label>
                  {scene.outer.kind === 'fixed' && <Num label={`Value (${scene.unit})`} value={scene.outer.value} onChange={(v) => editScene((s) => ({ ...s, outer: { ...s.outer, value: v } }))} />}
                </div>
                <button onClick={clearScene}>Clear scene</button>
              </>
            )}
          </section>

          <section className="card">
            <h2>Probes</h2>
            {probes.length === 0 ? <p className="note">Pick the Probe tool and click the domain.</p> : (
              <div className="tablewrap"><table>
                <thead><tr><th>#</th><th>x, y</th><th>{scene.unit}</th><th>± se</th><th>|{heat ? 'q' : 'E'}|</th>{analytic && <th>exact</th>}<th /></tr></thead>
                <tbody>{probeRows.map((r) => (
                  <tr key={r.p.id} className={selProbe === r.p.id ? 'sel' : ''} onClick={() => { setSelProbe(r.p.id); setSelShape(null) }}>
                    <td>P{r.i + 1}</td><td>{r.p.x}, {r.p.y}</td>
                    <td>{r.ok ? formatNum(r.mean, 4) : '…'}</td><td>{r.ok ? formatNum(r.se, 2) : ''}</td>
                    <td>{r.ok ? formatNum(Math.hypot(r.fx, r.fy), 3) : ''}</td>
                    {analytic && <td>{formatNum(r.exact, 4)}</td>}
                    <td><button className="x" aria-label={`Remove probe ${r.i + 1}`} onClick={(e) => { e.stopPropagation(); setProbes((ps) => ps.filter((q) => q.id !== r.p.id)) }}>×</button></td>
                  </tr>))}</tbody>
              </table></div>
            )}
            {analytic && <p className="note">Exact column: analytic V(r) = V₀ ln(b/r) / ln(b/a). Each estimate should lie within a few standard errors of it.</p>}
            <p className="note">Flux units: {scene.unit}/mm, as −∇u.</p>
          </section>

          <section className="card">
            <h2>Export</h2>
            <div className="row"><button onClick={exportPng}>PNG image</button><button onClick={exportCsv} disabled={probes.length === 0}>CSV of probes</button></div>
          </section>
        </aside>
      </main>
      <footer>
        Walk on spheres: Muller 1956; Sawhney &amp; Crane, “Monte Carlo Geometry Processing”, SIGGRAPH 2020. Walk on stars for insulated boundaries: Sawhney et al., 2023.
        Everything runs locally in {state.threads || 'several'} Web Workers.
      </footer>
    </div>
  )
}
