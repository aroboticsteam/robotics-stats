import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    open: false,
    proxy: {
      '/api/v2': {
        target: 'https://events.vex.com',
        changeOrigin: true,
        secure: true,
        headers: {
          Authorization: process.env.VEX_API_KEY ? `Bearer ${process.env.VEX_API_KEY}` : undefined,
          Accept: 'application/json'
        }
      }
    }
  }
});
