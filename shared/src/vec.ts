export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export function copyV3(out: V3, a: V3): V3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
