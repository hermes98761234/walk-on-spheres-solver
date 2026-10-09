/** Marching squares: line segments [x0,y0,x1,y1] (in grid index units, cell centers at integers) for one level. NaN cells are skipped. */
export function contourSegments(f: Float32Array | Float64Array, nx: number, ny: number, level: number): number[] {
  const out: number[] = []
  const lerp = (a: number, b: number) => (level - a) / (b - a)
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = f[j * nx + i], b = f[j * nx + i + 1], c = f[(j + 1) * nx + i + 1], d = f[(j + 1) * nx + i]
      if (Number.isNaN(a + b + c + d)) continue
      const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0)
      if (code === 0 || code === 15) continue
      // edge crossing points: top (a-b), right (b-c), bottom (d-c), left (a-d)
      const T: [number, number] = [i + lerp(a, b), j], Rt: [number, number] = [i + 1, j + lerp(b, c)]
      const B: [number, number] = [i + lerp(d, c), j + 1], L: [number, number] = [i, j + lerp(a, d)]
      const seg = (p: [number, number], q: [number, number]) => out.push(p[0], p[1], q[0], q[1])
      switch (code) {
        case 1: case 14: seg(L, T); break
        case 2: case 13: seg(T, Rt); break
        case 3: case 12: seg(L, Rt); break
        case 4: case 11: seg(Rt, B); break
        case 6: case 9: seg(T, B); break
        case 7: case 8: seg(L, B); break
        case 5: seg(L, T); seg(Rt, B); break
        case 10: seg(T, Rt); seg(L, B); break
      }
    }
  }
  return out
}
