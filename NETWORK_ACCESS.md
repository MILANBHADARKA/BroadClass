# Network Access Configuration Guide

## 🌐 Allowing Other Devices to Access Your Video Call Server

### Step 1: Find Your Server's IP Address

Run this command in PowerShell:
```powershell
ipconfig
```

Look for your network adapter (usually WiFi or Ethernet) and find the IPv4 Address.
Example: `192.168.43.230`

### Step 2: Update Server Configuration

Edit the `.env` file and change `MEDIASOUP_ANNOUNCED_IP` to your server's IP:

```env
MEDIASOUP_ANNOUNCED_IP=192.168.43.230
```

**Important:** Use your actual server machine's IP address!

### Step 3: Restart the Server

Kill the current server (Ctrl+C) and restart:
```powershell
cd C:\Users\bhada\Desktop\Coding\Name-Pending
node server/index.js
```

### Step 4: Configure Firewall

Allow incoming connections on these ports:

**Windows Firewall:**
1. Open Windows Defender Firewall
2. Click "Advanced settings"
3. Click "Inbound Rules" → "New Rule"
4. Choose "Port" → "TCP"
5. Add ports: `3000, 5173, 40000-49999`
6. Allow the connection
7. Name it "Video Call App"

**Quick PowerShell command (Run as Administrator):**
```powershell
New-NetFirewallRule -DisplayName "Video Call Server" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
New-NetFirewallRule -DisplayName "Video Call Client" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
New-NetFirewallRule -DisplayName "Video Call WebRTC" -Direction Inbound -Protocol UDP -LocalPort 40000-49999 -Action Allow
```

### Step 5: Start the Client

The client is already configured to work on the network!

```powershell
cd C:\Users\bhada\Desktop\Coding\Name-Pending\client
npm run dev -- --host
```

### Step 6: Access from Other Devices

From devices at `192.168.43.190` or `192.168.43.230`:

**Option A: Access via server IP (Recommended)**
```
http://192.168.43.230:5173
```
Replace `192.168.43.230` with your actual server IP.

**Option B: Use local client on each device**
- Clone the project on each device
- Update `App.jsx` to use server IP:
  ```javascript
  const WS_URL = 'ws://192.168.43.230:3000';
  ```

## 📋 Quick Setup Checklist

- [ ] Find your server's IP address
- [ ] Update `.env` file with `MEDIASOUP_ANNOUNCED_IP`
- [ ] Restart the server
- [ ] Configure Windows Firewall
- [ ] Start client with `--host` flag
- [ ] Access from other devices using `http://SERVER_IP:5173`

## 🔧 Current Configuration

Based on your request, I've set:
- **MEDIASOUP_ANNOUNCED_IP:** `192.168.43.230` (change this to your actual IP!)
- **Vite host:** `0.0.0.0` (already configured)
- **WebSocket URL:** Automatically detects hostname

## 🧪 Testing

1. **On Server Machine:**
   - Access: http://localhost:5173
   - Create a room as instructor

2. **On Device 192.168.43.190:**
   - Access: http://192.168.43.230:5173 (use your server IP)
   - Join the room as student

3. **On Device 192.168.43.230:**
   - Access: http://192.168.43.230:5173
   - Join the room as student

## ⚠️ Troubleshooting

### Can't connect from other devices?

1. **Check firewall:**
   ```powershell
   Test-NetConnection -ComputerName 192.168.43.230 -Port 3000
   ```

2. **Verify server is running:**
   ```powershell
   Get-NetTCPConnection -LocalPort 3000
   ```

3. **Check network connectivity:**
   - Ping the server: `ping 192.168.43.230`
   - Make sure all devices are on the same network

4. **Verify Vite is listening on all interfaces:**
   - Look for "Network: use --host to expose" in Vite output
   - Or start with: `npm run dev -- --host`

### WebRTC not connecting?

- Ensure UDP ports 40000-49999 are open in firewall
- Check that `MEDIASOUP_ANNOUNCED_IP` matches your server's actual IP
- Make sure NAT/Router isn't blocking UDP traffic

## 📝 Notes

- The client WebSocket URL now automatically uses the hostname you access it from
- If accessing via `http://192.168.43.230:5173`, it will connect to `ws://192.168.43.230:3000`
- If accessing via `http://localhost:5173`, it will connect to `ws://localhost:3000`

## 🚀 Production Deployment

For production on the internet:
1. Use your public IP or domain
2. Set up TURN server for NAT traversal
3. Use HTTPS/WSS instead of HTTP/WS
4. Configure proper SSL certificates
