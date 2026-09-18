import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Two pages share one visualizer: the main diamond demo and the (postponed)
// glitch demo. Every page must be listed here, otherwise `vite build` only
// emits index.html. The dev server serves any .html in the root regardless.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        glitch: fileURLToPath(new URL('glitch.html', import.meta.url)),
      },
    },
  },
});
