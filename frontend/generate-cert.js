// Simple script to generate self-signed certificate for HTTPS development
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const certDir = path.join(__dirname, '.cert');

// Create .cert directory if it doesn't exist
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir);
}

console.log('Generating self-signed certificate for HTTPS...');

try {
  // Generate self-signed certificate using OpenSSL
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj "/CN=192.168.1.68" -keyout "${path.join(certDir, 'key.pem')}" -out "${path.join(certDir, 'cert.pem')}" -days 365`, {
    stdio: 'inherit'
  });
  
  console.log('\n✓ Certificate generated successfully!');
  console.log('Files created:');
  console.log('  - .cert/key.pem');
  console.log('  - .cert/cert.pem');
  console.log('\nNow update vite.config.js to enable HTTPS.');
} catch (error) {
  console.error('\n✗ Error generating certificate.');
  console.error('Make sure OpenSSL is installed on your system.');
  console.error('\nAlternative: Use Vite\'s basic HTTPS with --https flag:');
  console.error('  npm run dev -- --https');
}
