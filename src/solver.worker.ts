/// <reference lib="webworker" />
import { Problem, type ProblemSpec } from './lib/wos.ts'
import { mulberry32 } from './lib/rng.ts'

export type ToWorker =
  | { type: 'start'; job: number; spec: ProblemSpec; pts: Float64Array; mult: Uint8Array; nGrad: number; seed: number }
  | { type: 'pause' }
  | { type: 'resume' }
export type FromWorker = { type: 'delta'; job: number; v: Float64Array; g: Float64Array; walks: number }

const TARGET_MS = 120
let job = 0
let paused = false
let running = false
let latest = -1

async function run(m: Extract<ToWorker, { type: 'start' }>) {
  job = m.job
  paused = false
  const my = m.job
  const problem = new Problem(m.spec)
  const rng = mulberry32(m.seed)
  const n = m.mult.length
  const loc = new Uint8Array(n)
  for (let i = 0; i < n; i++) loc[i] = problem.locate(m.pts[2 * i], m.pts[2 * i + 1])
  const out = new Float64Array(3)
  let k = 1
  running = true
  while (job === my) {
    if (paused) { await new Promise((r) => setTimeout(r, 50)); continue }
    const v = new Float64Array(n * 3), g = new Float64Array(m.nGrad * 4)
    let walks = 0
    const t0 = performance.now()
    for (let i = 0; i < n; i++) {
      if (loc[i] === 2) continue
      const x = m.pts[2 * i], y = m.pts[2 * i + 1], reps = k * m.mult[i], grad = i < m.nGrad
      for (let r = 0; r < reps; r++) {
        problem.sample(x, y, rng, grad, out)
        v[3 * i] += out[0]; v[3 * i + 1] += out[0] * out[0]; v[3 * i + 2]++
        if (grad) { g[4 * i] += out[1]; g[4 * i + 1] += out[2]; g[4 * i + 2] += out[1] * out[1]; g[4 * i + 3] += out[2] * out[2] }
      }
      walks += reps
    }
    const ms = performance.now() - t0
    if (job !== my) break
    const msg: FromWorker = { type: 'delta', job: my, v, g, walks }
    postMessage(msg, { transfer: [v.buffer, g.buffer] })
    k = Math.max(1, Math.min(4096, Math.floor((k * TARGET_MS) / Math.max(ms, 1))))
    await new Promise((r) => setTimeout(r, 0))
  }
  running = false
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  if (m.type === 'start') { job = -1; latest = m.job; void waitThenRun(m) }
  else if (m.type === 'pause') paused = true
  else paused = false
}

async function waitThenRun(m: Extract<ToWorker, { type: 'start' }>) {
  while (running) await new Promise((r) => setTimeout(r, 5))
  if (m.job === latest) await run(m)
}
