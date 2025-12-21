# Video Not Showing - Debugging Guide

## 🔍 Problem: Student Cannot See Instructor's Video

### Step 1: Open Browser Console

1. **Instructor Browser:** Press `F12` → Go to Console tab
2. **Student Browser:** Press `F12` → Go to Console tab

### Step 2: Check Console Logs

Look for these key messages:

**Instructor side:**
```
[Room] Instructor - media initialized and producing
[WebRTC] Producing: video
[WebRTC] Producing: audio
```

**Student side:**
```
[Room] Student joined, requesting existing producers...
[App] Starting to consume video from [participantId]
[App] Starting to consume audio from [participantId]
[RemoteVideo] Setting stream for [participantId]
```

### Step 3: Common Issues & Fixes

#### Issue 1: Student not receiving producers list

**Symptoms:**
- Student console shows "Student joined, requesting existing producers..."
- But no "Starting to consume..." messages

**Fix:**
- Check if WebSocket connection is established
- Look for errors in console
- Make sure server is running

#### Issue 2: Consumer created but video not showing

**Symptoms:**
- Console shows "Consumer created, track: MediaStreamTrack"
- Console shows "Added video track to stream"
- But video element is black/empty

**Fix - Add this to browser console:**
```javascript
// Check remote videos Map
document.querySelector('video:not([muted])').srcObject
```

#### Issue 3: Autoplay policy blocking

**Symptoms:**
- Error: "play() failed because the user didn't interact with the document first"

**Fix:**
- Click anywhere on the page first
- Or add user interaction before joining

### Step 4: Manual Test in Console

**On Student browser, run:**

```javascript
// Check if remote videos exist
const videos = document.querySelectorAll('video');
console.log('Total videos:', videos.length);

videos.forEach((video, index) => {
  console.log(`Video ${index}:`, {
    srcObject: video.srcObject,
    tracks: video.srcObject?.getTracks().map(t => ({ 
      kind: t.kind, 
      enabled: t.enabled, 
      readyState: t.readyState 
    })),
    muted: video.muted,
    paused: video.paused
  });
});
```

### Expected Output:

Video 0 (Local - Muted):
```javascript
{
  srcObject: MediaStream,
  tracks: [
    { kind: 'video', enabled: true, readyState: 'live' },
    { kind: 'audio', enabled: true, readyState: 'live' }
  ],
  muted: true,
  paused: false
}
```

Video 1 (Remote - Not Muted):
```javascript
{
  srcObject: MediaStream,
  tracks: [
    { kind: 'video', enabled: true, readyState: 'live' },
    { kind: 'audio', enabled: true, readyState: 'live' }
  ],
  muted: false,
  paused: false
}
```

### Step 5: Check Network Tab

1. Open Dev Tools → Network tab
2. Filter by "WS" (WebSocket)
3. Click on the WebSocket connection
4. Check Messages tab

**Look for these messages:**

Instructor sends:
```json
{"type": "produce", "payload": {"transportId": "...", "kind": "video", ...}}
{"type": "produce", "payload": {"transportId": "...", "kind": "audio", ...}}
```

Student receives:
```json
{"type": "newProducer", "data": {"producerId": "...", "participantId": "...", "kind": "video", ...}}
```

Student sends:
```json
{"type": "getProducers", "payload": {}}
{"type": "consume", "payload": {"transportId": "...", "producerId": "...", ...}}
```

### Step 6: Check Video Element Directly

**Run this in student's console:**

```javascript
const remoteVideo = document.querySelector('video:not([muted])');
if (remoteVideo) {
  console.log('Remote video found!');
  console.log('Has srcObject:', !!remoteVideo.srcObject);
  console.log('Tracks:', remoteVideo.srcObject?.getTracks());
  console.log('Video dimensions:', remoteVideo.videoWidth, 'x', remoteVideo.videoHeight);
  console.log('Ready state:', remoteVideo.readyState);
  
  // Try to force play
  remoteVideo.play().then(() => {
    console.log('Video playing!');
  }).catch(err => {
    console.error('Cannot play:', err);
  });
} else {
  console.error('No remote video element found!');
}
```

### Quick Fixes to Try:

1. **Refresh both pages** - Sometimes state gets out of sync

2. **Check firewall** - Make sure ports 3000 and 40000-49999 are open

3. **Try different network** - Some networks block UDP

4. **Check browser permissions** - Both need camera/mic access

5. **Clear browser cache** - Old code might be cached

6. **Check MEDIASOUP_ANNOUNCED_IP** - Must be correct server IP

### Still Not Working?

**Capture full console logs and share:**

**Instructor Console:**
1. Right-click in console → Save as...
2. Name it `instructor-console.log`

**Student Console:**
1. Right-click in console → Save as...
2. Name it `student-console.log`

**Server Console:**
1. Copy all server output
2. Save to `server.log`

These logs will show exactly where the problem is!

### Testing Checklist:

- [ ] Server is running (check console for "Ready to accept connections")
- [ ] Instructor can see their own video
- [ ] Student can see their own video
- [ ] WebSocket shows "connected" in both browsers
- [ ] Console shows "Producing: video" for instructor
- [ ] Console shows "Starting to consume video" for student
- [ ] No red errors in console
- [ ] Network tab shows WebSocket messages flowing
- [ ] Both videos are in DOM (check with querySelector)
- [ ] Remote video srcObject has tracks

If all checkmarks are ✅ but video still not showing, the issue is likely:
- Browser autoplay policy
- Video codec not supported
- Network/firewall blocking media

Run the manual tests above to pinpoint the exact issue!
