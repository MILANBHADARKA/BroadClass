import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 5173,
    https: true, // Enable HTTPS for mobile camera access
    // Set to true if you have SSL certificates
    // Uncomment below if you want to use HTTPS (required for mobile camera access)
    // You'll need to generate certificates or accept browser warnings
    https: {
      key: fs.readFileSync('./cert.key'),
      cert: fs.readFileSync('./cert.crt'),
    }
  }
})
