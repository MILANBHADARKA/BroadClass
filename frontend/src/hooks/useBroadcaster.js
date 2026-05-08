import { useState, useRef, useCallback, useEffect } from 'react';

export default function useBroadcaster({ socket, device }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareMode, setScreenShareMode] = useState('screen-only'); // 'screen-only' | 'screen-with-camera'
  const [pipPosition, setPipPosition] = useState('bottom-right'); // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  const [pipSize, setPipSize] = useState('medium'); // 'small' | 'medium' | 'large'

  // Refs for PiP settings to avoid stale closures in animation loop
  const pipPositionRef = useRef(pipPosition);
  const pipSizeRef = useRef(pipSize);

  const transportRef = useRef(null);
  const videoProducerRef = useRef(null);
  const audioProducerRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);

  // Canvas compositing refs for PiP mode
  const canvasRef = useRef(null);
  const canvasCtxRef = useRef(null);
  const compositeStreamRef = useRef(null);
  const animationFrameRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const screenVideoRef = useRef(null);
  const isCompositingActiveRef = useRef(false);

  // Refs that mirror state to avoid stale closures in event handlers
  const isScreenSharingRef = useRef(false);
  const screenShareModeRef = useRef('screen-only');
  // Always points to the latest stopScreenShare — used by the onended handler
  const stopScreenShareFnRef = useRef(null);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const startBroadcast = useCallback(async (roomId) => {
    if (!roomId.trim()) {
      alert('Please enter a room ID');
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Camera access is not available.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280, min: 1280 }, height: { ideal: 720, min: 720 }, frameRate: { ideal: 30, min: 30 } },
        audio: true,
      });

      setIsBroadcasting(true);
      setIsScreenSharing(false);
      isScreenSharingRef.current = false;
      cameraStreamRef.current = stream;
      setLocalStream(stream);

      // Small delay so React can render the video element
      await new Promise((r) => setTimeout(r, 100));

      const transportData = await new Promise((resolve) => {
        socket.emit('createWebRtcTransport', { sender: true, roomId }, resolve);
      });

      if (transportData.error) throw new Error(transportData.error);

      const producerTransport = device.createSendTransport(transportData);
      transportRef.current = producerTransport;

      producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await new Promise((resolve) => {
            socket.emit('connectTransport', { transportId: producerTransport.id, dtlsParameters }, resolve);
          });
          callback();
        } catch (err) { errback(err); }
      });

      producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
        try {
          const { producerId } = await new Promise((resolve) => {
            socket.emit('startBroadcast', { roomId, rtpParameters, kind }, resolve);
          });
          callback({ id: producerId });
        } catch (err) { errback(err); }
      });

      // Video – 3-layer simulcast
      const videoProducer = await producerTransport.produce({
        track: stream.getVideoTracks()[0],
        encodings: [
          { scaleResolutionDownBy: 4, maxBitrate: 500_000, scalabilityMode: 'L1T3' },
          { scaleResolutionDownBy: 2, maxBitrate: 1_000_000, scalabilityMode: 'L1T3' },
          { scaleResolutionDownBy: 1, maxBitrate: 5_000_000, scalabilityMode: 'L1T3' },
        ],
        codecOptions: { videoGoogleStartBitrate: 1000 },
      });
      videoProducerRef.current = videoProducer;

      // Audio
      const audioProducer = await producerTransport.produce({ track: stream.getAudioTracks()[0] });
      audioProducerRef.current = audioProducer;
    } catch (err) {
      console.error('Error starting broadcast:', err);
      alert('Failed to start broadcast: ' + err.message);
      setIsBroadcasting(false);
      setLocalStream(null);
    }
  }, [socket, device]);

  const stopBroadcast = useCallback((roomId) => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    compositeStreamRef.current?.getTracks().forEach((t) => t.stop());
    transportRef.current?.close();

    transportRef.current = null;
    videoProducerRef.current = null;
    audioProducerRef.current = null;
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    compositeStreamRef.current = null;
    canvasRef.current = null;
    canvasCtxRef.current = null;

    socket.emit('stopBroadcast', { roomId });
    setIsBroadcasting(false);
    setLocalStream(null);
    setIsCameraOn(true);
    setIsMicOn(true);
    isScreenSharingRef.current = false;
    setIsScreenSharing(false);
    screenShareModeRef.current = 'screen-only';
    setScreenShareMode('screen-only');
  }, [socket]);

  const toggleCamera = useCallback(() => {
    if (isScreenSharing) return;
    const track = cameraStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsCameraOn(track.enabled); }
  }, [isScreenSharing]);

  const toggleMic = useCallback(() => {
    const track = cameraStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsMicOn(track.enabled); }
  }, []);

  // Stop compositing and clean up
  const stopCompositing = useCallback(() => {
    // Mark compositing as inactive
    isCompositingActiveRef.current = false;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (cameraVideoRef.current) {
      // Stop the cloned PiP camera track if it exists
      if (cameraVideoRef.current._pipTrack) {
        cameraVideoRef.current._pipTrack.stop();
        cameraVideoRef.current._pipTrack = null;
      }
      cameraVideoRef.current.pause();
      cameraVideoRef.current.srcObject = null;
      // Remove from DOM
      if (cameraVideoRef.current.parentNode) {
        cameraVideoRef.current.parentNode.removeChild(cameraVideoRef.current);
      }
      cameraVideoRef.current = null;
    }
    if (screenVideoRef.current) {
      // Stop the cloned screen track
      if (screenVideoRef.current._screenTrack) {
        screenVideoRef.current._screenTrack.stop();
        screenVideoRef.current._screenTrack = null;
      }
      screenVideoRef.current.pause();
      screenVideoRef.current.srcObject = null;
      // Remove from DOM
      if (screenVideoRef.current.parentNode) {
        screenVideoRef.current.parentNode.removeChild(screenVideoRef.current);
      }
      screenVideoRef.current = null;
    }
    compositeStreamRef.current = null;
  }, []);

  // Canvas compositing for PiP mode
  const startCompositing = useCallback((screenStream, cameraStream) => {
    // Stop any existing compositing first
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Mark compositing as active
    isCompositingActiveRef.current = true;

    // Create canvas if it doesn't exist
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 1280;
      canvasRef.current.height = 720;
      canvasCtxRef.current = canvasRef.current.getContext('2d');
    }

    const canvas = canvasRef.current;
    const ctx = canvasCtxRef.current;

    // Create video elements (hidden, for canvas compositing only)
    const screenVideo = document.createElement('video');
    screenVideo.autoplay = true;
    screenVideo.muted = true;
    screenVideo.playsInline = true;
    screenVideo.setAttribute('playsinline', '');
    screenVideo.width = 320;
    screenVideo.height = 180;
    screenVideo.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0.01;pointer-events:none;';
    document.body.appendChild(screenVideo);
    screenVideoRef.current = screenVideo;

    const cameraVideo = document.createElement('video');
    cameraVideo.autoplay = true;
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    cameraVideo.setAttribute('playsinline', '');
    cameraVideo.width = 160;
    cameraVideo.height = 120;
    cameraVideo.style.cssText = 'position:fixed;bottom:0;right:0;width:1px;height:1px;opacity:0.01;pointer-events:none;';
    document.body.appendChild(cameraVideo);
    cameraVideoRef.current = cameraVideo;

    // Set srcObject for screen - clone the track to avoid conflicts with mediasoup producer
    const screenTrackForVideo = screenStream?.getVideoTracks()[0];
    if (screenTrackForVideo && screenTrackForVideo.readyState === 'live') {
      const clonedScreenTrack = screenTrackForVideo.clone();
      clonedScreenTrack.enabled = true;
      const screenMediaStream = new MediaStream([clonedScreenTrack]);
      screenVideo.srcObject = screenMediaStream;
      screenVideoRef.current._screenTrack = clonedScreenTrack;
    }

    // For camera, clone the track to avoid affecting the original
    const cameraTrack = cameraStream?.getVideoTracks()[0];
    if (cameraTrack) {
      const clonedTrack = cameraTrack.clone();
      clonedTrack.enabled = true;
      const pipCameraStream = new MediaStream([clonedTrack]);
      cameraVideo.srcObject = pipCameraStream;
      cameraVideoRef.current._pipTrack = clonedTrack;
    }

    // PiP sizes
    const pipSizes = {
      small: { width: 160, height: 120 },
      medium: { width: 240, height: 180 },
      large: { width: 320, height: 240 },
    };

    const padding = 20;

    // Compositing loop - uses refs to get current values
    const drawFrame = () => {
      if (!isCompositingActiveRef.current) {
        return;
      }

      // Get current pip settings from refs (updated by changePipPosition/changePipSize)
      const currentSize = pipSizeRef.current;
      const currentPosition = pipPositionRef.current;
      const pip = pipSizes[currentSize] || pipSizes.medium;

      // Calculate PiP position
      let posX, posY;
      switch (currentPosition) {
        case 'top-left':
          posX = padding;
          posY = padding;
          break;
        case 'top-right':
          posX = canvas.width - pip.width - padding;
          posY = padding;
          break;
        case 'bottom-left':
          posX = padding;
          posY = canvas.height - pip.height - padding;
          break;
        case 'bottom-right':
        default:
          posX = canvas.width - pip.width - padding;
          posY = canvas.height - pip.height - padding;
      }

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw screen content (full canvas)
      if (screenVideo.paused && screenVideo.srcObject) {
        screenVideo.play().catch(() => {});
      }

      try {
        if (screenVideo.videoWidth > 0) {
          ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      } catch (e) {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Always draw PiP circle (even if camera not ready yet)
      const centerX = posX + pip.width / 2;
      const centerY = posY + pip.height / 2;
      const radius = Math.min(pip.width, pip.height) / 2;

      // Draw camera PiP (circular)
      if (cameraVideo.videoWidth > 0) {
        ctx.save();

        // Create circular clip path
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        // Draw camera video within circle (center crop)
        const videoAspect = cameraVideo.videoWidth / cameraVideo.videoHeight;
        let sourceX = 0, sourceY = 0, sourceWidth = cameraVideo.videoWidth, sourceHeight = cameraVideo.videoHeight;

        if (videoAspect > 1) {
          sourceWidth = cameraVideo.videoHeight;
          sourceX = (cameraVideo.videoWidth - sourceWidth) / 2;
        } else {
          sourceHeight = cameraVideo.videoWidth;
          sourceY = (cameraVideo.videoHeight - sourceHeight) / 2;
        }

        ctx.drawImage(
          cameraVideo,
          sourceX, sourceY, sourceWidth, sourceHeight,
          posX, posY, pip.width, pip.height
        );

        ctx.restore();
      } else {
        // Camera not ready - draw a dark circle placeholder
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(30, 30, 30, 0.9)';
        ctx.fill();
        ctx.restore();
      }

      // Always draw border around PiP
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.9)';
      ctx.lineWidth = 4;
      ctx.stroke();

      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    // Wait for video to have actual data before starting draw loop
    const waitForVideoData = (video) => {
      return new Promise((resolve) => {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          resolve();
          return;
        }
        const checkReady = () => {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            video.removeEventListener('loadeddata', checkReady);
            video.removeEventListener('canplay', checkReady);
            resolve();
          }
        };
        video.addEventListener('loadeddata', checkReady);
        video.addEventListener('canplay', checkReady);
        // Timeout fallback
        setTimeout(resolve, 2000);
      });
    };

    // Start playing videos and wait for data
    const initVideos = async () => {
      try {
        await Promise.all([
          screenVideo.play().catch(() => {}),
          cameraVideo.play().catch(() => {})
        ]);

        await Promise.all([
          waitForVideoData(screenVideo),
          waitForVideoData(cameraVideo)
        ]);

        drawFrame();
      } catch (err) {
        drawFrame();
      }
    };

    initVideos();

    // Create stream from canvas
    const compositeStream = canvas.captureStream(30);
    compositeStreamRef.current = compositeStream;

    return compositeStream.getVideoTracks()[0];
  }, []);

  const stopScreenShare = useCallback(async () => {
    if (!isScreenSharingRef.current) return;

    // Lock immediately — track.stop() fires onended synchronously, which would
    // call stopScreenShare again via the onended handler before this call finishes.
    isScreenSharingRef.current = false;

    stopCompositing();

    // Stop and clear screen tracks before anything else.
    const screenStream = screenStreamRef.current;
    screenStreamRef.current = null;
    screenStream?.getTracks().forEach((t) => t.stop());

    // After being replaced in the WebRTC sender, the original camera track is often
    // suspended by the browser (reports live but produces no frames). Re-acquire the
    // camera from scratch to guarantee a live, frame-producing track.
    const audioTrack = cameraStreamRef.current?.getAudioTracks()[0];
    let newCameraStream = null;

    try {
      const freshVideo = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });

      const freshVideoTrack = freshVideo.getVideoTracks()[0];

      // Stop the old video track now that we have a replacement.
      cameraStreamRef.current?.getVideoTracks().forEach((t) => t.stop());

      newCameraStream = new MediaStream([
        freshVideoTrack,
        ...(audioTrack?.readyState === 'live' ? [audioTrack] : []),
      ]);
      cameraStreamRef.current = newCameraStream;

      if (videoProducerRef.current && !videoProducerRef.current.closed) {
        await videoProducerRef.current.replaceTrack({ track: freshVideoTrack });
      }
    } catch (err) {
      console.error('Failed to re-acquire camera after screen share:', err);
      // Fallback: try to revive the existing track.
      const fallbackTrack = cameraStreamRef.current?.getVideoTracks()[0];
      if (fallbackTrack) fallbackTrack.enabled = true;
      if (fallbackTrack?.readyState === 'live' && videoProducerRef.current && !videoProducerRef.current.closed) {
        try {
          await videoProducerRef.current.replaceTrack({ track: fallbackTrack });
        } catch (e) {
          console.error('Fallback replaceTrack failed:', e);
        }
      }
      newCameraStream = cameraStreamRef.current;
    }

    setIsCameraOn(true);
    setLocalStream(newCameraStream);
    setIsScreenSharing(false);
    screenShareModeRef.current = 'screen-only';
    setScreenShareMode('screen-only');
  }, [stopCompositing]);

  // Keep the ref always pointing to the latest stopScreenShare so the onended
  // handler (set once when screen track is acquired) never calls a stale version.
  useEffect(() => {
    stopScreenShareFnRef.current = stopScreenShare;
  }, [stopScreenShare]);

  // Bug fix: when broadcaster minimizes or switches tabs, requestAnimationFrame
  // is throttled by the browser and the canvas stops updating, causing a black/
  // frozen frame for viewers. Solution: when the page becomes hidden, temporarily
  // replace the mediasoup track with the raw screen track (which the OS captures
  // regardless of browser focus). Restore the composite track when visible again.
  useEffect(() => {
    if (!isScreenSharing || screenShareMode !== 'screen-with-camera') return;

    const handleVisibilityChange = async () => {
      if (!videoProducerRef.current || videoProducerRef.current.closed) return;

      if (document.hidden) {
        // Switch to raw screen track — works even when tab is in background
        const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
        if (screenTrack?.readyState === 'live') {
          try {
            await videoProducerRef.current.replaceTrack({ track: screenTrack });
          } catch (e) {}
        }
      } else {
        // Tab is visible again — restore composite (canvas) track
        const compositeTrack = compositeStreamRef.current?.getVideoTracks()[0];
        if (compositeTrack?.readyState === 'live') {
          try {
            await videoProducerRef.current.replaceTrack({ track: compositeTrack });
          } catch (e) {}
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isScreenSharing, screenShareMode]);

  // Start screen share with mode selection
  const startScreenShare = useCallback(async (mode = 'screen-only') => {
    if (!isBroadcasting) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert('Screen sharing is not available in this browser.');
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) return;

      screenStreamRef.current = screenStream;

      // Use the ref so this handler always calls the latest stopScreenShare,
      // avoiding the stale-closure bug where isScreenSharing was still false
      // at the time startScreenShare ran.
      screenTrack.onended = () => {
        stopScreenShareFnRef.current?.();
      };

      let trackToUse = screenTrack;
      let actualMode = mode;

      if (mode === 'screen-with-camera') {
        // Try to use existing camera stream, or get a fresh one
        let cameraStream = cameraStreamRef.current;
        let cameraTrack = cameraStream?.getVideoTracks()[0];

        // Check if camera track exists and is usable (live, even if disabled)
        if (!cameraTrack || cameraTrack.readyState !== 'live') {
          // Try to get a fresh camera stream
          try {
            const freshCameraStream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
            });
            cameraStream = freshCameraStream;
            cameraTrack = freshCameraStream.getVideoTracks()[0];

            // Update ref with fresh camera (keep original audio)
            const originalAudioTrack = cameraStreamRef.current?.getAudioTracks()[0];
            if (originalAudioTrack && originalAudioTrack.readyState === 'live') {
              cameraStreamRef.current = new MediaStream([cameraTrack, originalAudioTrack]);
            } else {
              cameraStreamRef.current = freshCameraStream;
            }
          } catch (err) {
            actualMode = 'screen-only';
          }
        }

        // Re-enable camera track if it was disabled and use compositing
        cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack && cameraTrack.readyState === 'live') {
          cameraTrack.enabled = true;
          setIsCameraOn(true);
          // Start canvas compositing with camera stream
          trackToUse = startCompositing(screenStream, cameraStreamRef.current);
        } else {
          actualMode = 'screen-only';
        }
      }

      screenShareModeRef.current = actualMode;
      setScreenShareMode(actualMode);

      // Ensure the track is valid before replacing
      if (!trackToUse || trackToUse.readyState !== 'live') {
        throw new Error('Screen track is not available');
      }

      // Replace track in producer - ensure we have a valid producer
      if (videoProducerRef.current && !videoProducerRef.current.closed) {
        await videoProducerRef.current.replaceTrack({ track: trackToUse });
      }

      // Clone the track for preview to avoid conflicts
      const previewTrack = trackToUse.clone();
      const audioTrack = cameraStreamRef.current?.getAudioTracks()[0];
      const previewStream = new MediaStream([previewTrack, ...(audioTrack ? [audioTrack] : [])]);
      setLocalStream(previewStream);
      isScreenSharingRef.current = true;
      setIsScreenSharing(true);
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        alert('Failed to start screen share: ' + err.message);
      }
      // Cleanup on failure
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
  }, [isBroadcasting, startCompositing]);

  // Toggle camera visibility in PiP mode
  const togglePipCamera = useCallback(async () => {
    if (!isScreenSharing) return;

    if (screenShareMode === 'screen-only') {
      // Switch to screen-with-camera
      const screenStream = screenStreamRef.current;
      const screenTrack = screenStream?.getVideoTracks()[0];

      if (!screenStream || !screenTrack || screenTrack.readyState !== 'live') {
        alert('Screen stream is no longer available');
        return;
      }

      let cameraStream = cameraStreamRef.current;
      let cameraTrack = cameraStream?.getVideoTracks()[0];

      // If camera track is not available or ended, try to get a fresh one
      if (!cameraTrack || cameraTrack.readyState !== 'live') {
        try {
          const freshCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
          });
          cameraStream = freshCameraStream;
          cameraTrack = freshCameraStream.getVideoTracks()[0];

          // Update the camera stream ref with the fresh stream (keep original audio if available)
          const originalAudioTrack = cameraStreamRef.current?.getAudioTracks()[0];
          if (originalAudioTrack && originalAudioTrack.readyState === 'live') {
            cameraStreamRef.current = new MediaStream([cameraTrack, originalAudioTrack]);
          } else {
            cameraStreamRef.current = freshCameraStream;
          }
        } catch (err) {
          alert('Could not access camera. Please check permissions.');
          return;
        }
      }

      // Re-enable camera track if it was disabled
      const finalCameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
      if (finalCameraTrack) {
        finalCameraTrack.enabled = true;
        setIsCameraOn(true);
      }

      // Verify screen is still available before compositing
      const currentScreenTrack = screenStreamRef.current?.getVideoTracks()[0];
      if (currentScreenTrack?.readyState !== 'live') {
        alert('Screen share ended. Please share your screen again.');
        isScreenSharingRef.current = false;
        setIsScreenSharing(false);
        screenShareModeRef.current = 'screen-only';
        setScreenShareMode('screen-only');
        return;
      }

      const cameraStreamToUse = cameraStreamRef.current;
      const compositeTrack = startCompositing(screenStreamRef.current, cameraStreamToUse);

      if (!compositeTrack) {
        return;
      }

      try {
        await videoProducerRef.current?.replaceTrack({ track: compositeTrack });
      } catch (err) {
        return;
      }

      const audioTrack = cameraStreamRef.current?.getAudioTracks()[0];
      const previewStream = new MediaStream([compositeTrack, ...(audioTrack ? [audioTrack] : [])]);
      setLocalStream(previewStream);
      screenShareModeRef.current = 'screen-with-camera';
      setScreenShareMode('screen-with-camera');
    } else {
      // Switch back to screen-only
      stopCompositing();

      const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
      if (screenTrack && screenTrack.readyState === 'live') {
        await videoProducerRef.current?.replaceTrack({ track: screenTrack });

        const audioTrack = cameraStreamRef.current?.getAudioTracks()[0];
        const previewStream = new MediaStream([screenTrack, ...(audioTrack ? [audioTrack] : [])]);
        setLocalStream(previewStream);
        screenShareModeRef.current = 'screen-only';
        setScreenShareMode('screen-only');
      } else {
        // Screen share ended, need to stop screen sharing
        isScreenSharingRef.current = false;
        setIsScreenSharing(false);
        screenShareModeRef.current = 'screen-only';
        setScreenShareMode('screen-only');
        setLocalStream(cameraStreamRef.current);
      }
    }
  }, [isScreenSharing, screenShareMode, startCompositing, stopCompositing]);

  // Change PiP position
  const changePipPosition = useCallback((position) => {
    setPipPosition(position);
    pipPositionRef.current = position;
  }, []);

  // Change PiP size
  const changePipSize = useCallback((size) => {
    setPipSize(size);
    pipSizeRef.current = size;
  }, []);

  return {
    isBroadcasting,
    localStream,
    isCameraOn,
    isMicOn,
    isScreenSharing,
    screenShareMode,
    pipPosition,
    pipSize,
    startBroadcast,
    stopBroadcast,
    toggleCamera,
    toggleMic,
    startScreenShare,
    stopScreenShare,
    togglePipCamera,
    changePipPosition,
    changePipSize,
  };
}
