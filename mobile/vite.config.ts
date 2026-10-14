import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) }, dedupe: ['react', 'react-dom'] },
  build: { target: 'es2020', outDir: 'dist', sourcemap: false },
  server: { proxy: { '/api/mobile': {target:'https://wordweave-cet-study.shiw36663.chatgpt.site',changeOrigin:true} } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
