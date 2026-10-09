import { useCallback, useEffect, useRef, useState } from 'react'
import { Accum, buildLayout, type Layout, type SolveSettings } from './lib/layout.ts'
import { compileScene, hasFixedBoundary, type Probe, type Scene } from './lib/scene.ts'
import type { FromWorker, ToWorker } from './solver.worker.ts'

export type Status = 'invalid' | 'running' | 'paused' | 'done'
export interface SolverState {
  layout: Layout
  acc: Accum | null
  status: Status
  /** Walks per heat-map cell (grid mode) or per probe (probe mode), max over points. */
  perPoint: number
  walksPerSec: number
  threads: number
}

const CELL_CAP = 4096
const PROBE_CAP = 2_000_000

export function useSolver(scene: Scene, probes: Probe[], settings: SolveSettings) {
  const workers = useRef<Worker[]>([])
  const job = useRef(0)
  const accRef = useRef<Accum | null>(null)
  const layoutRef = useRef<Layout>(buildLayout(scene, [], { ...settings, probeOnly: true }))
  const capRef = useRef(CELL_CAP)
  const pausedRef = useRef(false)
  const stamp = useRef({ t: performance.now(), walks: 0, rate: 0 })
  const timer = useRef(0)
  const [state, setState] = useState<SolverState>({ layout: layoutRef.current, acc: null, status: 'running', perPoint: 0, walksPerSec: 0, threads: 0 })
  const [paused, setPausedState] = useState(false)

  const publish = useCallback((status?: Status) => {
    const acc = accRef.current, layout = layoutRef.current
    let per = 0
    if (acc) for (let i = layout.probeOnlyStart; i < acc.n; i++) per = Math.max(per, acc.count(i))
    setState((s) => ({ ...s, layout, acc, perPoint: per, walksPerSec: stamp.current.rate, status: status ?? s.status, threads: workers.current.length }))
  }, [])

  // worker pool
  useEffect(() => {
    const n = Math.max(2, Math.min(16, navigator.hardwareConcurrency || 4))
    const ws = Array.from({ length: n }, () => new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' }))
    workers.current = ws
    let last = 0
    for (const w of ws) {
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data
        const acc = accRef.current
        if (m.type !== 'delta' || m.job !== job.current || !acc) return
        acc.merge(m.v, m.g, m.walks)
        const now = performance.now()
        if (now - stamp.current.t > 500) {
          stamp.current.rate = ((acc.walks - stamp.current.walks) / (now - stamp.current.t)) * 1000
          stamp.current.t = now; stamp.current.walks = acc.walks
        }
        if (now - last > 150) {
          last = now
          const layout = layoutRef.current
          let per = 0
          for (let i = layout.probeOnlyStart; i < acc.n; i++) per = Math.max(per, acc.count(i))
          if (per >= capRef.current) { for (const x of ws) x.postMessage({ type: 'pause' } satisfies ToWorker); pausedRef.current = true; publish('done') } else publish()
        }
      }
    }
    return () => { ws.forEach((w) => w.terminate()); workers.current = [] }
  }, [publish])

  // restart on any change of the problem
  const key = JSON.stringify([scene, probes.map((p) => [p.x, p.y]), settings])
  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const ws = workers.current
      const layout = buildLayout(scene, probes, settings)
      layoutRef.current = layout
      job.current++
      pausedRef.current = false
      setPausedState(false)
      if (!hasFixedBoundary(scene) || layout.pts.length === 0) {
        accRef.current = null
        for (const w of ws) w.postMessage({ type: 'pause' } satisfies ToWorker)
        publish('invalid')
        return
      }
      accRef.current = new Accum(layout.pts.length / 2, layout.nGrad)
      capRef.current = settings.probeOnly ? PROBE_CAP : CELL_CAP
      stamp.current = { t: performance.now(), walks: 0, rate: 0 }
      const spec = compileScene(scene)
      ws.forEach((w, i) => w.postMessage({
        type: 'start', job: job.current, spec, pts: layout.pts, mult: layout.mult, nGrad: layout.nGrad, seed: (Date.now() + i * 7919) >>> 0,
      } satisfies ToWorker))
      publish('running')
    }, 200)
    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line
  }, [key, publish])

  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p
    setPausedState(p)
    for (const w of workers.current) w.postMessage({ type: p ? 'pause' : 'resume' } satisfies ToWorker)
    if (!p) capRef.current *= 2 // resuming after convergence asks for twice as many walks
    publish(p ? 'paused' : 'running')
  }, [publish])

  return { state, paused, setPaused }
}
