// Genera las texturas y diseños especiales de volantín con la API de imágenes de OpenAI.
// Uso: node scripts/gen-textures.mjs [id ...]   (sin ids genera solo los que falten)
// Lee OPENAI_API_KEY desde .env. Cada imagen se guarda en client/public/textures a 512 px (WebP).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
const key = env.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('Falta OPENAI_API_KEY en .env');

const outDir = path.join(root, 'client/public/textures');
fs.mkdirSync(outDir, { recursive: true });

const MODEL = 'gpt-image-1-mini';

const TILE =
  'Seamless tileable texture, viewed straight from above, stylized hand-painted game art, soft even daylight, no shadows, no objects, no text, fills the whole square.';
const KITE =
  'Flat graphic artwork printed on colored tissue paper for a traditional Chilean kite (volantin). The artwork fills the entire square canvas edge to edge with a solid background color, the main motif is centered and fits inside the central diamond area, bold flat colors, clean vector illustration, symmetrical, no text, no letters, no kite frame, no string, no border, no photo.';

const JOBS = [
  { id: 'grass', size: 512, prompt: `Short lush green grass with subtle yellow-green variation. ${TILE}` },
  { id: 'dirt', size: 512, prompt: `Dry light-brown compacted dirt path with a few tiny pebbles. ${TILE}` },
  { id: 'kite-copihue', size: 256, prompt: `${KITE} Motif: a red copihue flower (Lapageria rosea, Chile's national flower) with two green leaves on a white background.` },
  { id: 'kite-condor', size: 256, prompt: `${KITE} Motif: an Andean condor with spread wings in black and white on a sky-blue background.` },
  { id: 'kite-sol', size: 256, prompt: `${KITE} Motif: a geometric golden sun with straight rays on a deep blue background.` },
  { id: 'kite-mosaico', size: 256, prompt: `${KITE} Motif: a colorful geometric mosaic of triangles in red, yellow, blue and green.` },
  { id: 'kite-cara', size: 256, prompt: `${KITE} Motif: a big friendly cartoon face with round eyes and a wide smile on an orange background.` },
  { id: 'kite-fuego', size: 256, prompt: `${KITE} Motif: stylized orange and yellow flames rising from the bottom on a black background.` },
];

const only = process.argv.slice(2);
for (const job of JOBS) {
  const file = path.join(outDir, `${job.id}.webp`);
  if (only.length ? !only.includes(job.id) : fs.existsSync(file)) continue;
  process.stdout.write(`generando ${job.id}... `);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: '1024x1024', quality: 'low', n: 1 }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.log(`error ${res.status}: ${json.error?.message}`);
    continue;
  }
  const png = Buffer.from(json.data[0].b64_json, 'base64');
  await sharp(png).resize(job.size, job.size).webp({ quality: 82 }).toFile(file);
  console.log(`ok (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}
