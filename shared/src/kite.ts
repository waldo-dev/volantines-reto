import { clamp, type V3 } from './vec';
import { groundHeight } from './terrain';
import type { BridleDef, KiteDef, LineDef, ReelDef } from './items';

/** Constantes de física; mutables para ajustarlas en vivo desde el panel de debug. */
export const PHYS = {
  gravity: 9.81,
  rho: 1.2,
  liftScale: 1.0,
  dragScale: 1.0,
  tensionRef: 30, // N que equivalen a tensión 1.0
  breakFactor: 1.25, // sobre resistencia × breakFactor × tensionRef el hilo empieza a gastarse
  wearTime: 12, // s que aguanta el hilo con una sobretensión de 1.5×
  wearRecovery: 0.04, // desgaste que se recupera por segundo con el hilo relajado
  minLine: 2, // con menos hilo que esto y tirando, el volantín llega a la mano y se guarda
  reelBase: 3, // m/s al tirar
  releaseSpeed: 5, // m/s máximos al soltar
  swingDamping: 1.2, // amortigua el vaivén con el hilo tenso
  headingRestore: 6, // qué tan fuerte los tirantes enderezan la punta hacia arriba
  headingNoise: 6, // cuánto mueve el viento la punta
  headingSteer: 3, // cuánto gira la punta al dirigir
  headingDamping: 2.5,
};

/** Maniobras rápidas (ver `stepKite`): tirón seco y dar cuerda rápido. */
export const MANEUVER = {
  tironTime: 0.3, // s que dura el tirón seco
  tironCooldown: 0.7, // s entre un tirón y el siguiente
  tironKick: 5, // rad/s que gira la punta de golpe hacia donde diriges
  tironReel: 2.2, // el tirón recoge hilo a esta fracción de la velocidad normal del carrete
  rapidRelease: 2.2, // dar cuerda rápido suelta hilo a esta fracción de la velocidad normal
  rapidSlack: 3, // m de hilo flojo máximos al dar cuerda rápido
};

/** Efecto de la cola larga (cambucha, chonchón) mientras está entera, y cuando se la cortan. */
export const TAIL = {
  length: 4, // m de cola para los cortes
  stability: 1.3, // estabilidad extra con la cola entera
  calm: 0.7, // nervio con la cola entera
  cutStability: 0.75, // un volantín hecho para cola, sin cola, se endereza peor...
  cutNervio: 1.5, // ...y cabecea mucho más
};

/** 0 = nada, 1 = tirón seco, 2 = largada (dar cuerda rápido). */
export type ManeuverKind = 0 | 1 | 2;

export interface KiteInput {
  tirar: boolean;
  soltar: boolean;
  dirX: number; // -1..1
  /** Tirón seco: se activa en el paso en que llega true (respeta el enfriamiento). */
  tiron?: boolean;
  /** Con soltar: da cuerda rápido (largada). */
  rapido?: boolean;
}

export interface Loadout {
  kite: KiteDef;
  line: LineDef;
  reel: ReelDef;
  bridle: BridleDef;
}

export interface KiteState {
  pos: V3;
  vel: V3;
  lineLength: number;
  lineRate: number; // m/s, negativo al tirar
  tensionN: number;
  tension: number; // 0..1, usado por la fórmula de corte
  stress: number; // tensionN / umbral de sobretensión
  wear: number; // 0..1, desgaste del hilo; en 1 se corta
  heading: number; // rad, hacia dónde apunta la punta: 0 = arriba, ±π = abajo
  spin: number; // rad/s
  aoa: number; // 0..1, ángulo de ataque relativo
  time: number;
  seed: number;
  grounded: boolean;
  broken: boolean;
  /** Recogido hasta la mano: no vuela, el jugador anda libre. */
  stowed: boolean;
  /** 0..100: se gasta al cruzarse con otro hilo; en 0 el hilo se corta. */
  integrity: number;
  /** Última maniobra y hace cuánto empezó (s): sirve para los golpes críticos al cruzarse. */
  maneuver: ManeuverKind;
  maneuverAge: number;
  /** s que le quedan al tirón seco en curso y hasta poder dar el siguiente. */
  tironLeft: number;
  tironCooldown: number;
  /** Dando cuerda rápido en este momento. */
  rapid: boolean;
  /** Le cortaron la cola (solo importa en volantines con cola). */
  tailCut: boolean;
}

export const breakThreshold = (line: LineDef) => line.resistencia * PHYS.breakFactor * PHYS.tensionRef;

export function createKite(anchor: V3, windDirX: number, windDirZ: number, seed = 1): KiteState {
  // Parte sostenido en alto a sotavento, como cuando un amigo ayuda a encumbrar
  const dist = 9;
  const x = anchor.x + windDirX * dist;
  const z = anchor.z + windDirZ * dist;
  return {
    pos: { x, y: Math.max(anchor.y + 3, groundHeight(x, z) + 2), z },
    vel: { x: 0, y: 0, z: 0 },
    lineLength: 10,
    lineRate: 0,
    tensionN: 0,
    tension: 0,
    stress: 0,
    wear: 0,
    heading: 0,
    spin: 0,
    aoa: 0.7,
    time: 0,
    seed,
    grounded: false,
    broken: false,
    stowed: false,
    integrity: 100,
    maneuver: 0,
    maneuverAge: 99,
    tironLeft: 0,
    tironCooldown: 0,
    rapid: false,
    tailCut: false,
  };
}

/** Deja el volantín guardado en la mano (sin volar). */
export function stowKite(s: KiteState, anchor: V3) {
  s.stowed = true;
  s.pos.x = anchor.x;
  s.pos.y = anchor.y;
  s.pos.z = anchor.z;
  s.vel.x = s.vel.y = s.vel.z = 0;
  s.lineLength = PHYS.minLine;
  s.tensionN = s.tension = s.stress = 0;
  s.heading = s.spin = 0;
  s.tironLeft = 0;
  s.rapid = false;
}

/** Turbulencia suave y determinista (-1..1) propia de cada volantín. */
function turbulence(t: number, seed: number): number {
  return (Math.sin(1.7 * t + seed) + 0.6 * Math.sin(3.1 * t + 2.3 * seed) + 0.35 * Math.sin(6.3 * t + 4.1 * seed)) / 1.95;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Avanza la simulación del volantín.
 * El hilo es una restricción de distancia máxima entre la mano (anchor) y el volantín.
 * La punta (heading) decide hacia dónde empuja la sustentación: tirar cuando apunta arriba lo hace subir.
 */
export function stepKite(
  s: KiteState,
  lo: Loadout,
  input: KiteInput,
  anchor: V3,
  anchorVel: V3,
  wind: V3,
  dt: number,
): void {
  const { kite, line, reel, bridle } = lo;
  s.time += dt;
  if (s.stowed) {
    s.pos.x = anchor.x;
    s.pos.y = anchor.y;
    s.pos.z = anchor.z;
    return;
  }

  // Maniobras: el tirón seco gira la punta de golpe y recoge hilo rápido por un instante;
  // dar cuerda rápido (largada) suelta hilo sin esperar a que el volantín tire.
  s.maneuverAge += dt;
  s.tironCooldown = Math.max(0, s.tironCooldown - dt);
  if (input.tiron && !s.broken && !s.grounded && s.tironCooldown <= 0) {
    s.tironLeft = MANEUVER.tironTime;
    s.tironCooldown = MANEUVER.tironCooldown;
    s.maneuver = 1;
    s.maneuverAge = 0;
    const dir = Math.abs(input.dirX) > 0.15 ? Math.sign(input.dirX) : 0;
    s.spin += dir * MANEUVER.tironKick * kite.agilidad;
  }
  const tironing = s.tironLeft > 0 && !s.broken;
  if (s.tironLeft > 0) s.tironLeft -= dt;

  // Carrete: tirar recoge a velocidad fija; soltar deja que el volantín se lleve el hilo (ver restricción)
  const reelSpeed = PHYS.reelBase * reel.speed * (tironing ? MANEUVER.tironReel : 1);
  const releasing = input.soltar && !input.tirar && !tironing && !s.broken;
  const rapid = releasing && !!input.rapido;
  if (rapid && !s.rapid) {
    s.maneuver = 2;
    s.maneuverAge = 0;
  }
  s.rapid = rapid;
  let rate = 0;
  if (!s.broken && (tironing || (input.tirar && !input.soltar))) {
    const next = Math.max(PHYS.minLine, s.lineLength - reelSpeed * dt);
    rate = (next - s.lineLength) / dt;
    s.lineLength = next;
  }

  const aoaTarget = tironing ? 1.25 : rapid ? 0.3 : input.tirar ? 1 : input.soltar ? 0.5 : 0.7;
  s.aoa += (aoaTarget - s.aoa) * Math.min(1, dt * 4);

  const rx = wind.x - s.vel.x;
  const ry = wind.y - s.vel.y;
  const rz = wind.z - s.vel.z;
  const spRaw = Math.hypot(rx, ry, rz);
  // El viento aparente no supera el viento real + la velocidad del carrete (evita picks de tensión al tirar)
  const sp = Math.min(spRaw, Math.hypot(wind.x, wind.y, wind.z) + reelSpeed);

  // Punta del volantín: los tirantes la enderezan, el viento la mueve, dirigir la gira.
  // Con el hilo flojo los tirantes pierden fuerza y el volantín cabecea o se da vuelta.
  if (s.broken) {
    s.spin += (turbulence(s.time, s.seed) * 6 - s.spin) * Math.min(1, dt * 2);
  } else if (s.grounded) {
    s.heading *= 1 - Math.min(1, dt * 3);
    s.spin = 0;
  } else {
    const authority = clamp(sp / 6, 0, 1.6);
    const grip = 0.25 + 0.75 * s.tension;
    // La cola entera lo calma; si se la cortaron, cabecea
    const tailStab = kite.cola ? (s.tailCut ? TAIL.cutStability : TAIL.stability) : 1;
    const tailNerve = kite.cola ? (s.tailCut ? TAIL.cutNervio : TAIL.calm) : 1;
    // Dirigir corre el ángulo al que los tirantes llevan la punta; los ágiles giran más y más rápido
    const steer = clamp(input.dirX, -1, 1);
    const target = steer * (0.5 + 0.2 * bridle.giro) * Math.sqrt(kite.agilidad);
    // La agilidad acelera toda la respuesta de la punta (enderezarse y girar)
    const stiffness =
      (bridle.estabilidad * kite.estabilidad * tailStab * PHYS.headingRestore + bridle.giro * PHYS.headingSteer * Math.abs(steer)) * kite.agilidad;
    const restore = -stiffness * Math.sin(s.heading - target) * authority * (0.5 + 0.5 * grip);
    const noise = ((bridle.nervio * tailNerve) / kite.estabilidad) * PHYS.headingNoise * turbulence(s.time, s.seed) * authority * (1.2 - 0.6 * grip);
    s.spin += (restore + noise - PHYS.headingDamping * s.spin) * dt;
  }
  s.heading = wrapAngle(s.heading + s.spin * dt);

  // Fuerzas aerodinámicas
  let fx = 0;
  let fy = 0;
  let fz = 0;
  if (sp > 0.01) {
    const dx = rx / spRaw;
    const dy = ry / spRaw;
    const dz = rz / spRaw;
    // Sustentación: el "arriba" perpendicular al viento relativo, girado según la punta
    let lx = -dx * dy;
    let ly = 1 - dy * dy;
    let lz = -dz * dy;
    const ll = Math.hypot(lx, ly, lz);
    if (ll > 1e-4) {
      lx /= ll;
      ly /= ll;
      lz /= ll;
      // lateral = d × l
      const sx = dy * lz - dz * ly;
      const sy = dz * lx - dx * lz;
      const sz = dx * ly - dy * lx;
      const c = Math.cos(s.heading);
      const sn = Math.sin(s.heading);
      // La velocidad del volantín agranda el empuje de lado cuando la punta se inclina
      const side = sn * kite.velocidad;
      lx = lx * c + sx * side;
      ly = ly * c + sy * side;
      lz = lz * c + sz * side;
    }
    const q = 0.5 * PHYS.rho * kite.area * sp * sp;
    const cl = kite.cl * (0.5 + 0.7 * s.aoa) * PHYS.liftScale;
    const cd = kite.cd * (0.4 + 0.8 * s.aoa) * PHYS.dragScale;
    const k = s.broken ? 0.25 : 1; // sin hilo el volantín se da vuelta y planea mal
    fx = (lx * cl + dx * cd) * q * k;
    fy = (ly * cl + dy * cd) * q * k;
    fz = (lz * cl + dz * cd) * q * k;
  }
  fy -= kite.masa * PHYS.gravity;

  s.vel.x += (fx / kite.masa) * dt;
  s.vel.y += (fy / kite.masa) * dt;
  s.vel.z += (fz / kite.masa) * dt;
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  s.pos.z += s.vel.z * dt;

  // Restricción del hilo
  let tensionTarget = 0;
  if (!s.broken) {
    const ux0 = s.pos.x - anchor.x;
    const uy0 = s.pos.y - anchor.y;
    const uz0 = s.pos.z - anchor.z;
    const dist = Math.hypot(ux0, uy0, uz0);
    if (rapid) {
      // Largada: el hilo sale rápido aunque el volantín no tire (queda un poco flojo)
      const next = Math.min(reel.maxLine, s.lineLength + PHYS.releaseSpeed * reel.speed * MANEUVER.rapidRelease * dt, Math.max(s.lineLength, dist + MANEUVER.rapidSlack));
      rate = (next - s.lineLength) / dt;
      s.lineLength = next;
    } else if (releasing && dist > s.lineLength) {
      // El hilo sale solo si el volantín tira; el roce del carrete lo frena, así el hilo no queda flojo
      const cap = PHYS.releaseSpeed * reel.speed * (0.25 + 0.75 * s.tension);
      const next = Math.min(reel.maxLine, s.lineLength + Math.min(dist - s.lineLength, cap * dt));
      rate = (next - s.lineLength) / dt;
      s.lineLength = next;
    }
    if (dist >= s.lineLength && dist > 1e-4) {
      const ux = ux0 / dist;
      const uy = uy0 / dist;
      const uz = uz0 / dist;
      s.pos.x = anchor.x + ux * s.lineLength;
      s.pos.y = anchor.y + uy * s.lineLength;
      s.pos.z = anchor.z + uz * s.lineLength;
      const vr = (s.vel.x - anchorVel.x) * ux + (s.vel.y - anchorVel.y) * uy + (s.vel.z - anchorVel.z) * uz;
      const excess = vr - rate;
      if (excess > 0) {
        s.vel.x -= ux * excess;
        s.vel.y -= uy * excess;
        s.vel.z -= uz * excess;
      }
      // Estabilidad aerodinámica: el vaivén alrededor de la mano se amortigua
      const rvx = s.vel.x - anchorVel.x;
      const rvy = s.vel.y - anchorVel.y;
      const rvz = s.vel.z - anchorVel.z;
      const along = rvx * ux + rvy * uy + rvz * uz;
      const damp = Math.min(1, dt * PHYS.swingDamping);
      s.vel.x -= (rvx - ux * along) * damp;
      s.vel.y -= (rvy - uy * along) * damp;
      s.vel.z -= (rvz - uz * along) * damp;
      tensionTarget = Math.max(0, fx * ux + fy * uy + fz * uz);
    }
  }
  s.lineRate = rate;
  // Recogido del todo: el volantín llega a la mano y se guarda
  if (!s.broken && input.tirar && s.lineLength <= PHYS.minLine + 0.01) {
    const d = Math.hypot(s.pos.x - anchor.x, s.pos.y - anchor.y, s.pos.z - anchor.z);
    if (d <= PHYS.minLine + 0.6) {
      stowKite(s, anchor);
      return;
    }
  }
  s.tensionN += (tensionTarget - s.tensionN) * Math.min(1, dt * 4);
  s.tension = clamp(s.tensionN / PHYS.tensionRef, 0, 1);
  s.stress = s.tensionN / breakThreshold(line);

  // Sobretensión: el hilo se va gastando de a poco; más tensión, más rápido. Relajado se recupera.
  if (!s.broken) {
    if (s.stress > 1) s.wear += ((s.stress - 1) / 0.5 / PHYS.wearTime) * dt;
    else if (s.stress < 0.8) s.wear = Math.max(0, s.wear - PHYS.wearRecovery * dt);
    if (s.wear >= 1) {
      s.broken = true;
      s.tensionN = 0;
      s.tension = 0;
      s.stress = 0;
    }
  }

  // Suelo
  const gh = groundHeight(s.pos.x, s.pos.z) + 0.2;
  if (s.pos.y <= gh) {
    s.pos.y = gh;
    if (s.vel.y < 0) s.vel.y = 0;
    const f = 1 - Math.min(1, dt * 5);
    s.vel.x *= f;
    s.vel.z *= f;
    s.grounded = true;
  } else {
    s.grounded = false;
  }
}
