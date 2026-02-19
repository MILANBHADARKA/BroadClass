import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs';
import { resolve } from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'viewer.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173,
    // // Enable HTTPS with SSL certificates (required for mobile camera access)
    // https: {
    //   key: fs.readFileSync('./cert.key'),
    //   cert: fs.readFileSync('./cert.crt'),
    // }
  }
})
