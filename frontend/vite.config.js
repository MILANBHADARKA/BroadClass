import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs';
import { resolve } from 'path';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  
  // Build configuration
  build: {
    outDir: 'dist',
    sourcemap: mode === 'development',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: mode === 'production',
        drop_debugger: mode === 'production',
      },
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        viewer: resolve(__dirname, 'viewer.html'),
      },
      output: {
        // Chunk splitting for better caching
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          mediasoup: ['mediasoup-client'],
          socket: ['socket.io-client'],
        },
      },
    },
    // Increase chunk size warning limit for mediasoup
    chunkSizeWarningLimit: 1000,
  },

  // Preview server (for testing production build locally)
  preview: {
    port: 4173,
    host: '0.0.0.0',
  },

  // Development server
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Enable HTTPS with SSL certificates (uncomment for mobile camera access)
    // https: {
    //   key: fs.readFileSync('./cert.key'),
    //   cert: fs.readFileSync('./cert.crt'),
    // }
  },
}))
