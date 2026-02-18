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

  const transportRef = useRef(null);

  const startBroadcast = useCallback(async (roomId) => {
    if (!roomId.trim()) {
      alert('Please enter a room ID');
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Camera access is not available. On mobile, you must use HTTPS.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280, min: 1280 }, height: { ideal: 720, min: 720 }, frameRate: { ideal: 30, min: 30 } },
        audio: true,
      });

      setIsBroadcasting(true);
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
      await producerTransport.produce({
        track: stream.getVideoTracks()[0],
        encodings: [
          { scaleResolutionDownBy: 4, maxBitrate: 500_000, scalabilityMode: 'L1T3' },
          { scaleResolutionDownBy: 2, maxBitrate: 1_000_000, scalabilityMode: 'L1T3' },
          { scaleResolutionDownBy: 1, maxBitrate: 5_000_000, scalabilityMode: 'L1T3' },
        ],
        codecOptions: { videoGoogleStartBitrate: 1000 },
      });

      // Audio
      await producerTransport.produce({ track: stream.getAudioTracks()[0] });
    } catch (err) {
      console.error('Error starting broadcast:', err);
      alert('Failed to start broadcast: ' + err.message);
      setIsBroadcasting(false);
      setLocalStream(null);
    }
  }, [socket, device]);

  const stopBroadcast = useCallback((roomId) => {
    localStream?.getTracks().forEach((t) => t.stop());
    transportRef.current?.close();
    transportRef.current = null;

    socket.emit('stopBroadcast', { roomId });
    setIsBroadcasting(false);
    setLocalStream(null);
    setIsCameraOn(true);
    setIsMicOn(true);
  }, [socket, localStream]);

  const toggleCamera = useCallback(() => {
    const track = localStream?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsCameraOn(track.enabled); }
  }, [localStream]);

  const toggleMic = useCallback(() => {
    const track = localStream?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsMicOn(track.enabled); }
  }, [localStream]);

  return {
    isBroadcasting,
    localStream,
    isCameraOn,
    isMicOn,
    startBroadcast,
    stopBroadcast,
    toggleCamera,
    toggleMic,
  };
}
