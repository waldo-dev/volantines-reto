const bump = (x: number, z: number, cx: number, cz: number, h: number, r: number) => {
  const dx = x - cx;
  const dz = z - cz;
  return h * Math.exp(-(dx * dx + dz * dz) / (2 * r * r));
};

/** Laguna: su centro, radio y nivel del agua. */
export const POND = { x: 95, z: -75, r: 26, level: -1.2 };

/** Altura del terreno en (x, z): el cerro donde se encumbra, lomas alrededor y una laguna. */
export function groundHeight(x: number, z: number): number {
  const hills =
    bump(x, z, 0, 0, 8, 45) + // cerro principal
    bump(x, z, -160, 130, 16, 70) +
    bump(x, z, 190, 170, 11, 60) +
    bump(x, z, -210, -150, 13, 65) +
    bump(x, z, POND.x, POND.z, -4.5, POND.r * 0.75);
  const rolling = 1.2 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 0.6 * Math.sin(x * 0.13 + z * 0.09);
  // Aplana lejos del centro para que el horizonte se vea limpio
  const far = Math.min(1, Math.hypot(x, z) / 320);
  return hills + rolling * (1 - far);
}
