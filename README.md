# volantines-reto

Juego web 3D (Three.js) para encumbrar volantines y cortar el hilo de los rivales en comisión.

## Requisitos

- Node.js 20 o superior
- Docker Desktop (para la base de datos PostgreSQL)

## Puesta en marcha

```bash
npm install
cp .env.example .env      # DATABASE_URL y, si generas imágenes, OPENAI_API_KEY
npm run db                # PostgreSQL 17 en localhost:5433 (docker compose)
npm run dev               # API en :8787 + juego en http://localhost:5173
```

Desde el teléfono, en la misma red wifi, abre la dirección "Network" que muestra Vite.

Otros comandos:

```bash
npm test                  # pruebas de física, cortes, bots y progresión
npm run typecheck
npx tsx scripts/botsim.ts 300 4   # simula bots peleando 300 s y cuenta cruces, críticos y cortes
npm start                 # compila el cliente y lo sirve junto a la API en :8787 (modo publicación)
node scripts/gen-textures.mjs   # regenera texturas/diseños con OpenAI (solo los que falten)
```

## Controles

| Acción | Teclado / mouse | Táctil |
| --- | --- | --- |
| Caminar / correr | WASD / flechas | Joystick (mitad izquierda) |
| Tirar | Clic izquierdo / Espacio | Botón TIRAR |
| Soltar hilo | Clic derecho / Shift | Botón SOLTAR |
| Tirón seco (gira de golpe y recoge rápido) | F / clic del medio | Botón ⚡ TIRÓN |
| Largada (dar cuerda rápido) | Shift o clic derecho dos veces y mantener / C | Tocar SOLTAR dos veces y mantener |
| Dirigir (o girar la cámara a pie) | Mouse izq./der. / Q E | Arrastrar en la mitad derecha |
| Zoom | Rueda | Pellizcar |
| Encumbrar | R | Botón 🪁 Encumbrar |
| Menú | M / Esc | Botón 🎨 |
| Panel de ajustes | G (o `?debug` en la URL) | — |

Recoger todo el hilo guarda el volantín: quedas libre para correr y capturar los volantines que caen.

### Combate

- **Golpe crítico:** un tirón o una largada justo al cruzarte con otro hilo (hasta 0,5 s después del cruce) le quita 30 de integridad de una vez.
- **Hilos:** ataque (filo), vida (resistencia) y recuperación. Cruzarse cerca del volantín rival (la **zona débil**, el último 20 % del hilo) hace 30 % más daño.
- **Combos:** cortes seguidos (a menos de 20 s uno del otro) dan DOBLE, TRIPLE… y monedas extra. Con el tercero entras en racha **¡Encachado!**: 25 s con más filo y recuperación.
- **Contra la corriente:** cortar a alguien que tiene mejor hilo que tú paga el doble.

### Equipo

- **Volantines:** cinco tipos chilenos (cambucha, ñecla, comisión, chonchón y pavo) con velocidad, agilidad, estabilidad y tamaño propios, en cuatro rarezas. La cambucha y el chonchón llevan **cola larga**: los estabiliza, pero un tirón seco de un rival pegado a la cola se la corta y el volantín empieza a cabecear.
- **Tirantes:** cada tirante habilita un tramo de la perilla de **amarre** (de tranquilo a cabeceador) que se ajusta en el menú de equipo.
- **Hilos:** 14 hilos en cuatro categorías, con perfiles agresivos (más ataque), aguantadores (más vida) y regeneradores (más recuperación).

### Recoger volantines

- Los volantines que recoges van a la **mochila** y se cobran al dejarlos en **tu casa** (el anillo amarillo donde apareciste; una flecha te guía). Si te cortan cargado, se te cae uno y otro lo puede recoger.
- La **mochila** decide cuántos llevas (de 2 a 10). El **colihue** alcanza más lejos y más alto, y hace que cada volantín pague más.
- Los volantines raros pagan ×1,5, los épicos ×2 y los legendarios ×3. Todos quedan en el **álbum de trofeos** (menú → Cuenta).

### Escenarios

Se eligen en el menú → Jugar (algunos se desbloquean por nivel). Cada uno tiene su terreno y su viento:
**El Cerro**, **Parque O'Higgins** (fondas y una zona de bono en el cielo: cortar ahí paga extra), **Campo al atardecer** (viento suave),
**La Playa** (viento fuerte y parejo, también con zona de bono) y **Cerros de Valparaíso** (rachas y cables del tendido que enredan y cortan el hilo).
En online, la partida rápida y la sala nueva usan el escenario elegido; al entrar con código se usa el de la sala. En desarrollo, `?mapa=playa` en la URL abre ese escenario.

## Voz en salas privadas

En una sala privada (con código) cada jugador puede **activar la voz** en el panel de la derecha y hablar **manteniendo apretado** el botón (o la tecla `V`). El audio va directo entre navegadores por WebRTC; el servidor solo reenvía las señales para que se encuentren, y solo entre jugadores de la misma sala privada que activaron la voz. Cada voz sale desde el personaje que habla: se oye más fuerte cerca, pero nunca se apaga del todo. Cada uno puede silenciar a otro con 🔈/🔇. En partidas rápidas (salas públicas) no hay voz.

El micrófono necesita HTTPS (o `localhost`). Algunas redes (ciertas móviles o de empresas) no permiten la conexión directa: si alguien no logra conectarse, habría que agregar un servidor TURN (`coturn`) en la VPS.

## Datos y seguridad

- **Telemetría:** el juego manda eventos (sesiones, modo, mapa, cortes, entregas, compras) a `POST /api/events`; se guardan en la tabla `events`. Las vistas `daily_players` y `retention` dan jugadores por día y retención a 1 y 7 días.
- **Resumen de uso:** `GET /api/admin/stats` con `Authorization: Bearer <ADMIN_TOKEN>` (definir `ADMIN_TOKEN` en `.env`, mínimo 16 caracteres; sin él la ruta no existe).
- **Online con la última palabra del servidor:** cada estado que manda un cliente se valida (velocidad, largo del hilo contra el carrete, distancia del volantín, ritmo del carrete) y se corrige; los estados imposibles repetidos quedan como `suspect` en la telemetría. En salas online, los cortes, críticos, colas y entregas de las cuentas los acredita el servidor (eventos con `source = 'server'`, los que deben usar los rankings).
- **Gráficos:** menú → Jugar → Gráficos (Automática, Baja, Media, Alta) y tope de cuadros por segundo.

## Estructura

- `shared/` física del volantín (tirantes, desgaste), cruce y corte de hilos, bots, progresión, tienda y logros. La usan el cliente y el servidor.
- `client/` Vite + Three.js: mundo, personajes, volantines, HUD, menú y sesión.
- `server/` API en Node (`/api/auth`, `/api/me`, `/api/shop`, `/api/me/report`) con PostgreSQL; migraciones en `server/migrations`.

## Créditos

Modelos 3D: [Kenney](https://kenney.nl) (Mini Characters, Nature Kit, City Kit Suburban), licencia CC0.
Texturas y diseños especiales: generados con la API de imágenes de OpenAI.
