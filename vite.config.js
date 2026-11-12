import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` expects the production server (npm start, with VEX_API_KEY set)
// to be running on :8080 so /api/vex is proxied to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api/vex': 'http://localhost:8080' },
  },
});
