/**
 * useBroadcaster – Custom hook that manages the broadcaster lifecycle:
 *   getUserMedia → create send transport → produce (simulcast video + audio) → stop
 */
import { useState, useRef, useCallback } from 'react';

export default function useBroadcaster({ socket, device }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const transportRef = useRef(null);
  const videoProducerRef = useRef(null);
  const audioProducerRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);

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

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280, min: 1280 }, height: { ideal: 720, min: 720 }, frameRate: { ideal: 30, min: 30 } },
          audio: true,
        });
      } catch (mediaErr) {
        // Fallback: try video-only if mic access is denied
        if (mediaErr.name === 'NotAllowedError' || mediaErr.name === 'NotFoundError') {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280, min: 1280 }, height: { ideal: 720, min: 720 }, frameRate: { ideal: 30, min: 30 } },
            audio: false,
          });
        } else {
          throw mediaErr;
        }
      }

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

      // Audio (skip if mic was denied during fallback)
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const audioProducer = await producerTransport.produce({ track: audioTrack });
        audioProducerRef.current = audioProducer;
      }
    } catch (err) {
      console.error('Error starting broadcast:', err);
      alert('Failed to start broadcast: ' + err.message);
      setIsBroadcasting(false);
      setLocalStream(null);
    }
  }, [socket, device]);

  const stopBroadcast = useCallback((roomId) => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    transportRef.current?.close();
    transportRef.current = null;
    videoProducerRef.current = null;
    audioProducerRef.current = null;
    cameraStreamRef.current = null;
    screenStreamRef.current = null;

    socket.emit('stopBroadcast', { roomId });
    setIsBroadcasting(false);
    setLocalStream(null);
    setIsCameraOn(true);
    setIsMicOn(true);
    setIsScreenSharing(false);
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

  const stopScreenShare = useCallback(async () => {
    if (!isScreenSharing) return;

    let cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
    // console.log('Stopping screen share, checking camera track status...');

    // 1. If the browser killed the track in the background, get a new one!
    if (!cameraTrack || cameraTrack.readyState === 'ended') {
      // console.log('Camera track ended in background, requesting fresh camera stream...');
      try {
        const freshStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280, min: 1280 }, height: { ideal: 720, min: 720 }, frameRate: { ideal: 30, min: 30 } }
        });
        cameraTrack = freshStream.getVideoTracks()[0];
        
        // Ensure we respect the user's mute/unmute state for the camera
        cameraTrack.enabled = isCameraOn;

        // Merge the new video track with the existing audio track
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

    // 2. Safely await the track replacement in Mediasoup
    if (cameraTrack && cameraTrack.readyState === 'live') {
      try {
        await videoProducerRef.current?.replaceTrack({ track: cameraTrack });
      } catch (err) {
        console.error('Error replacing track in producer:', err);
      }
    }

    // 3. Stop the screen sharing tracks to remove the "Sharing your screen" browser banner
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    
    // 4. Update the UI
    setLocalStream(cameraStreamRef.current);
    setIsScreenSharing(false);
  }, [isScreenSharing, isCameraOn]);

  const startScreenShare = useCallback(async () => {
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

      screenTrack.onended = () => {
        stopScreenShare();
      };

      await videoProducerRef.current?.replaceTrack({ track: screenTrack });

      const audioTrack = cameraStreamRef.current?.getAudioTracks()[0];
      const previewStream = new MediaStream([screenTrack, ...(audioTrack ? [audioTrack] : [])]);
      setLocalStream(previewStream);
      setIsScreenSharing(true);
    } catch (err) {
      console.error('Error starting screen share:', err);
      alert('Failed to start screen share: ' + err.message);
    }
  }, [isBroadcasting, stopScreenShare]);

  return {
    isBroadcasting,
    localStream,
    isCameraOn,
    isMicOn,
    isScreenSharing,
    startBroadcast,
    stopBroadcast,
    toggleCamera,
    toggleMic,
    startScreenShare,
    stopScreenShare,
  };
}