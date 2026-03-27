/**
 * useBroadcaster – Custom hook that manages the broadcaster lifecycle:
 *   getUserMedia → create send transport → produce (simulcast video + audio) → stop
 * 
 * Features:
 *   - Camera + microphone broadcasting
 *   - Screen sharing (direct or with camera PiP overlay)
 *   - Simulcast encoding for adaptive quality
 */
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
    setIsScreenSharing(false);
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
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.pause();
      cameraVideoRef.current.srcObject = null;
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current.srcObject = null;
    }
    compositeStreamRef.current?.getTracks().forEach(t => t.stop());
    compositeStreamRef.current = null;
  }, []);

  // Canvas compositing for PiP mode
  const startCompositing = useCallback((screenStream, cameraStream) => {
    // Create canvas if it doesn't exist
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 1280;
      canvasRef.current.height = 720;
      canvasCtxRef.current = canvasRef.current.getContext('2d');
    }

    const canvas = canvasRef.current;
    const ctx = canvasCtxRef.current;

    // Create video elements for drawing
    if (!screenVideoRef.current) {
      screenVideoRef.current = document.createElement('video');
      screenVideoRef.current.autoplay = true;
      screenVideoRef.current.muted = true;
      screenVideoRef.current.playsInline = true;
    }
    if (!cameraVideoRef.current) {
      cameraVideoRef.current = document.createElement('video');
      cameraVideoRef.current.autoplay = true;
      cameraVideoRef.current.muted = true;
      cameraVideoRef.current.playsInline = true;
    }

    screenVideoRef.current.srcObject = screenStream;
    cameraVideoRef.current.srcObject = cameraStream;

    // Calculate PiP dimensions based on size setting
    const pipSizes = {
      small: { width: 160, height: 120 },
      medium: { width: 240, height: 180 },
      large: { width: 320, height: 240 },
    };
    const pip = pipSizes[pipSize] || pipSizes.medium;
    const padding = 20;

    // Calculate PiP position
    const getPosition = () => {
      switch (pipPosition) {
        case 'top-left': return { x: padding, y: padding };
        case 'top-right': return { x: canvas.width - pip.width - padding, y: padding };
        case 'bottom-left': return { x: padding, y: canvas.height - pip.height - padding };
        case 'bottom-right': 
        default: return { x: canvas.width - pip.width - padding, y: canvas.height - pip.height - padding };
      }
    };

    // Compositing loop
    const drawFrame = () => {
      if (!isScreenSharing || screenShareMode !== 'screen-with-camera') {
        return;
      }

      // Draw screen content (full canvas)
      if (screenVideoRef.current.readyState >= 2) {
        ctx.drawImage(screenVideoRef.current, 0, 0, canvas.width, canvas.height);
      }

      // Draw camera PiP (circular)
      if (cameraVideoRef.current.readyState >= 2) {
        const pos = getPosition();
        
        ctx.save();
        
        // Create circular clip path
        ctx.beginPath();
        const centerX = pos.x + pip.width / 2;
        const centerY = pos.y + pip.height / 2;
        const radius = Math.min(pip.width, pip.height) / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        
        // Draw camera video within circle
        // Center crop the camera feed
        const videoAspect = cameraVideoRef.current.videoWidth / cameraVideoRef.current.videoHeight;
        let sourceX = 0, sourceY = 0, sourceWidth = cameraVideoRef.current.videoWidth, sourceHeight = cameraVideoRef.current.videoHeight;
        
        if (videoAspect > 1) {
          sourceWidth = cameraVideoRef.current.videoHeight;
          sourceX = (cameraVideoRef.current.videoWidth - sourceWidth) / 2;
        } else {
          sourceHeight = cameraVideoRef.current.videoWidth;
          sourceY = (cameraVideoRef.current.videoHeight - sourceHeight) / 2;
        }
        
        ctx.drawImage(
          cameraVideoRef.current,
          sourceX, sourceY, sourceWidth, sourceHeight,
          pos.x, pos.y, pip.width, pip.height
        );
        
        ctx.restore();
        
        // Draw border around PiP
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.8)'; // Purple accent
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Add subtle glow
        ctx.shadowColor = 'rgba(139, 92, 246, 0.5)';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    // Wait for videos to be ready then start drawing
    Promise.all([
      new Promise(r => { screenVideoRef.current.onloadeddata = r; screenVideoRef.current.play(); }),
      new Promise(r => { cameraVideoRef.current.onloadeddata = r; cameraVideoRef.current.play(); }),
    ]).then(() => {
      drawFrame();
    });

    // Create stream from canvas
    const compositeStream = canvas.captureStream(30);
    compositeStreamRef.current = compositeStream;

    return compositeStream.getVideoTracks()[0];
  }, [pipPosition, pipSize, isScreenSharing, screenShareMode]);

  const stopScreenShare = useCallback(async () => {
    if (!isScreenSharing) return;

    // Stop compositing
    stopCompositing();

    let cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];

    // If the browser killed the track in the background, get a new one
    if (!cameraTrack || cameraTrack.readyState === 'ended') {
      try {
        const freshStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280, min: 1280 }, height: { ideal: 720, min: 720 }, frameRate: { ideal: 30, min: 30 } }
        });
        cameraTrack = freshStream.getVideoTracks()[0];
        cameraTrack.enabled = isCameraOn;

        const audioTrack = cameraStreamRef.current?.getAudioTracks()[0];
        cameraStreamRef.current = new MediaStream([
          cameraTrack, 
          ...(audioTrack && audioTrack.readyState === 'live' ? [audioTrack] : [])
        ]);
      } catch (err) {
        console.error('Failed to restart camera:', err);
        alert('Could not restart camera. Please check permissions.');
      }
    }

    // Replace track in Mediasoup
    if (cameraTrack && cameraTrack.readyState === 'live') {
      try {
        await videoProducerRef.current?.replaceTrack({ track: cameraTrack });
      } catch (err) {
        console.error('Error replacing track in producer:', err);
      }
    }

    // Stop the screen sharing tracks
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    
    // Update the UI
    setLocalStream(cameraStreamRef.current);
    setIsScreenSharing(false);
    setScreenShareMode('screen-only');
  }, [isScreenSharing, isCameraOn, stopCompositing]);

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
      setScreenShareMode(mode);

      screenTrack.onended = () => {
        stopScreenShare();
      };

      let trackToUse = screenTrack;

      if (mode === 'screen-with-camera') {
        // Get fresh camera stream for PiP
        let cameraStream = cameraStreamRef.current;
        const cameraTrack = cameraStream?.getVideoTracks()[0];
        
        if (!cameraTrack || cameraTrack.readyState === 'ended') {
          cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
          });
          // Update ref but don't replace main camera stream
        }

        // Start canvas compositing
        trackToUse = startCompositing(screenStream, cameraStream);
      }

      await videoProducerRef.current?.replaceTrack({ track: trackToUse });

      const audioTrack = cameraStreamRef.current?.getAudioTracks()[0];
      const previewStream = new MediaStream([trackToUse, ...(audioTrack ? [audioTrack] : [])]);
      setLocalStream(previewStream);
      setIsScreenSharing(true);
    } catch (err) {
      console.error('Error starting screen share:', err);
      if (err.name !== 'NotAllowedError') {
        alert('Failed to start screen share: ' + err.message);
      }
    }
  }, [isBroadcasting, stopScreenShare, startCompositing]);

  // Toggle camera visibility in PiP mode
  const togglePipCamera = useCallback(async () => {
    if (!isScreenSharing) return;

    if (screenShareMode === 'screen-only') {
      // Switch to screen-with-camera
      const cameraStream = cameraStreamRef.current;
      const screenStream = screenStreamRef.current;
      
      if (cameraStream && screenStream) {
        const compositeTrack = startCompositing(screenStream, cameraStream);
        await videoProducerRef.current?.replaceTrack({ track: compositeTrack });
        
        const audioTrack = cameraStream.getAudioTracks()[0];
        const previewStream = new MediaStream([compositeTrack, ...(audioTrack ? [audioTrack] : [])]);
        setLocalStream(previewStream);
        setScreenShareMode('screen-with-camera');
      }
    } else {
      // Switch back to screen-only
      stopCompositing();
      
      const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
      if (screenTrack) {
        await videoProducerRef.current?.replaceTrack({ track: screenTrack });
        
        const audioTrack = cameraStreamRef.current?.getAudioTracks()[0];
        const previewStream = new MediaStream([screenTrack, ...(audioTrack ? [audioTrack] : [])]);
        setLocalStream(previewStream);
        setScreenShareMode('screen-only');
      }
    }
  }, [isScreenSharing, screenShareMode, startCompositing, stopCompositing]);

  // Change PiP position
  const changePipPosition = useCallback((position) => {
    setPipPosition(position);
  }, []);

  // Change PiP size
  const changePipSize = useCallback((size) => {
    setPipSize(size);
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