import type { Geom, Probe, Scene, Shape, ShapeKind, Unit } from './scene.ts'

export interface Preset {
  id: string
  name: string
  scene: Scene
  probes: Pt2[]
  /** Analytic solution to compare probes against, when one exists. */
  analytic?: (x: number, y: number) => number
}
type Pt2 = [number, number]

let nextId = 1
export const newId = () => nextId++
export function setNextId(n: number) { nextId = Math.max(nextId, n) }

const sh = (kind: ShapeKind, value: number, geom: Geom): Shape => ({ id: newId(), kind, value, geom })
const rect = (x: number, y: number, w: number, h: number): Geom => ({ t: 'rect', x, y, w, h })
const circ = (cx: number, cy: number, r: number): Geom => ({ t: 'circle', cx, cy, r })
const poly = (...pts: Pt2[]): Geom => ({ t: 'poly', pts })
const scene = (unit: Unit, width: number, height: number, outer: Scene['outer'], shapes: Shape[]): Scene => ({ unit, width, height, outer, shapes })

function pcb(): Preset {
  return {
    id: 'pcb', name: 'PCB with hot regulator',
    scene: scene('°C', 160, 100, { shape: 'rect', kind: 'insulated', value: 0 }, [
      sh('fixed', 25, circ(8, 8, 3)), sh('fixed', 25, circ(152, 8, 3)), sh('fixed', 25, circ(8, 92, 3)), sh('fixed', 25, circ(152, 92, 3)),
      sh('fixed', 35, poly([95, 12], [148, 12], [148, 46], [124, 46], [124, 30], [95, 30])),
      sh('source', 0.12, rect(52, 42, 18, 14)),
      sh('source', 0.02, rect(100, 66, 14, 14)),
      sh('insulated', 0, rect(34, 18, 3, 46)),
    ]),
    probes: [[61, 49], [105, 38], [20, 50], [107, 73]],
  }
}

function capacitor(): Preset {
  return {
    id: 'capacitor', name: 'Electrode pair / capacitor',
    scene: scene('V', 160, 100, { shape: 'rect', kind: 'fixed', value: 0 }, [
      sh('fixed', 100, rect(56, 25, 5, 50)), sh('fixed', -100, rect(100, 25, 5, 50)),
    ]),
    probes: [[80, 50], [80, 20], [40, 50]],
  }
}

function coax(): Preset {
  const a = 8, b = 50, V0 = 100
  return {
    id: 'coax', name: 'Coaxial cross-section',
    scene: scene('V', 100, 100, { shape: 'circle', kind: 'fixed', value: 0 }, [sh('fixed', V0, circ(50, 50, a))]),
    probes: [[50 + 12, 50], [50, 50 - 20], [50 - 30, 50], [50, 50 + 40]],
    analytic: (x, y) => {
      const r = Math.hypot(x - 50, y - 50)
      return r <= a ? V0 : r >= b ? 0 : (V0 * Math.log(b / r)) / Math.log(b / a)
    },
  }
}

function heatSink(): Preset {
  const comb: Pt2[] = [[38, 88], [38, 38]]
  for (let i = 0; i < 7; i++) {
    const x = 38 + 13 * i
    comb.push([x + 4, 38], [x + 4, 78])
    if (i < 6) comb.push([x + 13, 78], [x + 13, 38])
  }
  comb.push([120, 88])
  return {
    id: 'heatsink', name: 'Heat sink fins',
    scene: scene('°C', 160, 100, { shape: 'rect', kind: 'fixed', value: 20 }, [
      sh('fixed', 85, { t: 'poly', pts: comb }),
      sh('insulated', 0, rect(20, 89, 120, 3)),
      sh('insulated', 0, rect(26, 14, 3, 72)),
      sh('insulated', 0, rect(131, 14, 3, 72)),
    ]),
    probes: [[47, 60], [60, 50], [80, 20], [80, 8]],
  }
}

function maze(): Preset {
  return {
    id: 'maze', name: 'Maze (potential flow)',
    scene: scene('V', 160, 100, { shape: 'rect', kind: 'insulated', value: 0 }, [
      sh('insulated', 0, rect(0, 24, 140, 3)), sh('insulated', 0, rect(20, 49, 140, 3)), sh('insulated', 0, rect(0, 74, 140, 3)),
      sh('fixed', 100, rect(2, 4, 3, 18)), sh('fixed', 0, rect(2, 79, 3, 18)),
    ]),
    probes: [[80, 12], [150, 38], [10, 62], [80, 88]],
  }
}

export const PRESETS: (() => Preset)[] = [pcb, capacitor, coax, heatSink, maze]

export function emptyScene(): Scene {
  return scene('°C', 160, 100, { shape: 'rect', kind: 'fixed', value: 20 }, [])
}

export function toProbes(pts: Pt2[]): Probe[] { return pts.map(([x, y]) => ({ id: newId(), x, y })) }

export function defaultValue(kind: ShapeKind, unit: string): number {
  return kind === 'source' ? 0.05 : kind === 'insulated' ? 0 : unit === 'V' ? 100 : 80
}
