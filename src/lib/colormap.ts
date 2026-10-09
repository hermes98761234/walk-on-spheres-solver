export type MapName = 'inferno' | 'viridis' | 'coolwarm'
const STOPS: Record<MapName, string[]> = {
  inferno: ['#000004', '#280b54', '#65156e', '#9f2a63', '#d44842', '#f57d15', '#fac127', '#fcffa4'],
  viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#fde725'],
  coolwarm: ['#3b4cc0', '#6788ee', '#9abbff', '#c9d7f0', '#edd1c2', '#f7a889', '#e26952', '#b40426'],
}
export const MAP_NAMES = Object.keys(STOPS) as MapName[]
const cache = new Map<MapName, Uint8Array>()

/** 256-entry RGB lookup table. */
export function lut(name: MapName): Uint8Array {
  let t = cache.get(name)
  if (t) return t
  t = new Uint8Array(256 * 3)
  const rgb = STOPS[name].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)))
  for (let i = 0; i < 256; i++) {
    const p = (i / 255) * (rgb.length - 1), k = Math.min(rgb.length - 2, Math.floor(p)), f = p - k
    for (let c = 0; c < 3; c++) t[i * 3 + c] = Math.round(rgb[k][c] * (1 - f) + rgb[k + 1][c] * f)
  }
  cache.set(name, t)
  return t
}

export function colorAt(name: MapName, t: number): [number, number, number] {
  const i = Math.min(255, Math.max(0, Math.round(t * 255))), l = lut(name)
  return [l[i * 3], l[i * 3 + 1], l[i * 3 + 2]]
}

/** "Nice" tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 6): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(10))
  return out
}
