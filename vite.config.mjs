import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 5174 : Pimplay utilise déjà 5173, les deux peuvent tourner en même temps
export default defineConfig({
  plugins: [react()],
  base: './',
  // release/ : sortie d'electron-builder, à ne pas surveiller (rechargements en boucle et fichiers verrouillés)
  server: { port: 5174, strictPort: true, watch: { ignored: ['**/release/**'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
