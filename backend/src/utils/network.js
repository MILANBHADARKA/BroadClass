import os from 'os';

/**
 * Get the container's internal IP address (for Docker networking).
 * Falls back to 127.0.0.1 if no external IPv4 interface is found.
 */
export function getContainerIp() {
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}
