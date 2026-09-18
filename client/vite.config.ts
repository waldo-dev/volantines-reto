import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: {
    // En desarrollo la API corre aparte (npm run dev:server)
    proxy: { '/api': 'http://localhost:8787' },
  },
});
