import { BRIDLES, KITES, LINES, PHYS, REELS, WIND, byId, type Loadout } from '@volantines/shared';

/** Panel de ajustes en vivo (tecla G). lil-gui se carga solo cuando se abre. */
export async function createDebugPanel(loadout: Loadout, onLoadoutChange: () => void) {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'Ajustes (G)' });

  const eq = gui.addFolder('Equipo');
  const sel = { kite: loadout.kite.id, line: loadout.line.id, reel: loadout.reel.id, bridle: loadout.bridle.id };
  const opts = <T extends { id: string; nombre: string }>(list: T[]) => Object.fromEntries(list.map((i) => [i.nombre, i.id]));
  eq.add(sel, 'kite', opts(KITES))
    .name('Volantín')
    .onChange((id: string) => {
      loadout.kite = byId(KITES, id);
      onLoadoutChange();
    });
  eq.add(sel, 'line', opts(LINES))
    .name('Hilo')
    .onChange((id: string) => {
      loadout.line = byId(LINES, id);
      onLoadoutChange();
    });
  eq.add(sel, 'bridle', opts(BRIDLES))
    .name('Tirantes')
    .onChange((id: string) => {
      loadout.bridle = byId(BRIDLES, id);
      onLoadoutChange();
    });
  eq.add(sel, 'reel', opts(REELS))
    .name('Carrete')
    .onChange((id: string) => {
      loadout.reel = byId(REELS, id);
      onLoadoutChange();
    });

  const wind = gui.addFolder('Viento');
  wind.add(WIND, 'base', 0, 14, 0.1).name('Base (m/s)');
  wind.add(WIND, 'variation', 0, 5, 0.1).name('Variación');
  wind.add(WIND, 'gust', 0, 6, 0.1).name('Ráfagas');
  wind.add(WIND, 'baseAngle', -Math.PI, Math.PI, 0.01).name('Dirección');
  wind.add(WIND, 'angleVar', 0, 1.2, 0.01).name('Giro');

  const phys = gui.addFolder('Física');
  phys.add(PHYS, 'liftScale', 0.2, 3, 0.01).name('Sustentación');
  phys.add(PHYS, 'dragScale', 0.2, 3, 0.01).name('Arrastre');
  phys.add(PHYS, 'reelBase', 0.5, 8, 0.1).name('Vel. tirar');
  phys.add(PHYS, 'releaseSpeed', 1, 20, 0.5).name('Vel. soltar máx.');
  phys.add(PHYS, 'swingDamping', 0, 5, 0.1).name('Amortiguación');
  phys.add(PHYS, 'headingRestore', 0, 15, 0.1).name('Fuerza tirantes');
  phys.add(PHYS, 'headingNoise', 0, 15, 0.1).name('Cabeceo del viento');
  phys.add(PHYS, 'headingSteer', 0, 10, 0.1).name('Fuerza dirigir');
  phys.add(PHYS, 'headingDamping', 0, 8, 0.1).name('Amortig. punta');
  phys.add(PHYS, 'tensionRef', 5, 80, 1).name('Tensión ref. (N)');
  phys.add(PHYS, 'breakFactor', 0.3, 3, 0.05).name('Umbral sobretensión');
  phys.add(PHYS, 'wearTime', 1, 60, 1).name('Aguante hilo (s)');
  phys.close();

  return gui;
}
