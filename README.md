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
npm start                 # compila el cliente y lo sirve junto a la API en :8787 (modo publicación)
node scripts/gen-textures.mjs   # regenera texturas/diseños con OpenAI (solo los que falten)
```

## Controles

| Acción | Teclado / mouse | Táctil |
| --- | --- | --- |
| Caminar / correr | WASD / flechas | Joystick (mitad izquierda) |
| Tirar | Clic izquierdo / Espacio | Botón TIRAR |
| Soltar hilo | Clic derecho / Shift | Botón SOLTAR |
| Dirigir (o girar la cámara a pie) | Mouse izq./der. / Q E | Arrastrar en la mitad derecha |
| Zoom | Rueda | Pellizcar |
| Encumbrar | R | Botón 🪁 Encumbrar |
| Menú | M / Esc | Botón 🎨 |
| Panel de ajustes | G (o `?debug` en la URL) | — |

Recoger todo el hilo guarda el volantín: quedas libre para correr y capturar los volantines que caen.

## Estructura

- `shared/` física del volantín (tirantes, desgaste), cruce y corte de hilos, bots, progresión, tienda y logros. La usan el cliente y el servidor.
- `client/` Vite + Three.js: mundo, personajes, volantines, HUD, menú y sesión.
- `server/` API en Node (`/api/auth`, `/api/me`, `/api/shop`, `/api/me/report`) con PostgreSQL; migraciones en `server/migrations`.

## Créditos

Modelos 3D: [Kenney](https://kenney.nl) (Mini Characters, Nature Kit, City Kit Suburban), licencia CC0.
Texturas y diseños especiales: generados con la API de imágenes de OpenAI.
