/**
 * useEdgeViewer – Custom hook that manages the full viewer lifecycle:
 *   connect to edge → create recv transport → consume → resume → quality control → cleanup
 */
import { useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

export default function useEdgeViewer({ device, onJoinBroadcast, authToken }) {
  const [viewingRoom, setViewingRoom] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [simulcastEnabled, setSimulcastEnabled] = useState(false);
  const [currentQuality, setCurrentQuality] = useState('auto');
  const [edgeInfo, setEdgeInfo] = useState(null);

  // Refs survive re-renders without triggering them
  const edgeSocketRef = useRef(null);
  const consumersRef = useRef([]);

  // Connect to edge & consume
  const viewBroadcast = useCallback(async (roomId) => {
    try {
      const bestEdge = await onJoinBroadcast(roomId);
      setEdgeInfo(bestEdge);

      // Get base API URL from environment
      const apiUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
      const isSecure = apiUrl.startsWith('https://');

      // Production: Route through Nginx reverse proxy (SSL termination)
      // Development: Connect directly to edge IP:port
      let newEdgeSocket;
      if (isSecure) {
        // Connect via Nginx: https://api.broadclass.xyz/edge/3002/socket.io/
        newEdgeSocket = io(apiUrl, {
          path: `/edge/${bestEdge.port}/socket.io/`,
          auth: authToken ? { token: authToken } : undefined,
        });
      } else {
        // Direct connection for local dev
        const edgeUrl = `http://${bestEdge.ip}:${bestEdge.port}`;
        newEdgeSocket = io(edgeUrl, {
          auth: authToken ? { token: authToken } : undefined,
        });
      }

      newEdgeSocket.on('connect', async () => {
        edgeSocketRef.current = newEdgeSocket;

        try {
          // Join the room on the edge
          await new Promise((resolve) => {
            newEdgeSocket.emit('joinBroadcast', { roomId }, resolve);
          });

          // Create recv transport
          const transportData = await new Promise((resolve) => {
            newEdgeSocket.emit('createWebRtcTransport', { sender: false, roomId }, resolve);
          });

          const consumerTransport = device.createRecvTransport(transportData);

          // DTLS handshake gate – consumers resume only after this resolves
          let resolveConnected;
          const connectedPromise = new Promise((r) => { resolveConnected = r; });

          consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
              await new Promise((resolve) => {
                newEdgeSocket.emit('connectTransport', {
                  transportId: consumerTransport.id,
                  dtlsParameters,
                }, resolve);
              });
              callback();
              resolveConnected();
            } catch (err) {
              errback(err);
            }
          });

          // Consume video + audio
          const stream = new MediaStream();
          const toResume = [];

          const videoData = await new Promise((resolve) => {
            newEdgeSocket.emit('consume', {
              roomId,
              rtpCapabilities: device.rtpCapabilities,
              kind: 'video',
            }, resolve);
          });

          if (!videoData.error) {
            const videoConsumer = await consumerTransport.consume({
              id: videoData.id,
              producerId: videoData.producerId,
              kind: videoData.kind,
              rtpParameters: videoData.rtpParameters,
            });
            stream.addTrack(videoConsumer.track);
            toResume.push(videoConsumer);
            consumersRef.current.push(videoConsumer);

            if (videoData.simulcast) setSimulcastEnabled(true);
          }

          const audioData = await new Promise((resolve) => {
            newEdgeSocket.emit('consume', {
              roomId,
              rtpCapabilities: device.rtpCapabilities,
              kind: 'audio',
            }, resolve);
          });

          if (!audioData.error) {
            const audioConsumer = await consumerTransport.consume({
              id: audioData.id,
              producerId: audioData.producerId,
              kind: audioData.kind,
              rtpParameters: audioData.rtpParameters,
            });
            stream.addTrack(audioConsumer.track);
            toResume.push(audioConsumer);
            consumersRef.current.push(audioConsumer);
          }

          // Wait for DTLS, then resume on server
          await connectedPromise;
          for (const c of toResume) {
            await new Promise((resolve) => {
              newEdgeSocket.emit('resumeConsumer', { consumerId: c.id }, resolve);
            });
          }

          setRemoteStream(stream);
          setViewingRoom(roomId);
        } catch (err) {
          console.error('Error setting up stream:', err);
          newEdgeSocket.close();
        }
      });

      newEdgeSocket.on('broadcastEnded', ({ roomId: endedRoom }) => {
        if (endedRoom === roomId) stopViewing();
      });

      newEdgeSocket.on('qualityChanged', ({ quality }) => {
        setCurrentQuality(quality);
      });

      newEdgeSocket.on('disconnect', () => {
        stopViewing();
      });
    } catch (err) {
      console.error('Error viewing broadcast:', err);
    }
  }, [device, onJoinBroadcast, authToken]);

  // Stop viewing
  const stopViewing = useCallback(() => {
    remoteStream?.getTracks().forEach((t) => t.stop());

    consumersRef.current.forEach((c) => { try { c.close(); } catch (_) {} });
    consumersRef.current = [];

    edgeSocketRef.current?.close();
    edgeSocketRef.current = null;

    setViewingRoom(null);
    setRemoteStream(null);
    setSimulcastEnabled(false);
    setCurrentQuality('auto');
    setEdgeInfo(null);
  }, [remoteStream]);

  // Quality control
  const changeQuality = useCallback(async (quality) => {
    const sock = edgeSocketRef.current;
    if (!viewingRoom || !simulcastEnabled || !sock) return;

    try {
      const result = await new Promise((resolve) => {
        sock.emit('setQuality', { roomId: viewingRoom, quality }, resolve);
      });

      if (result?.error) {
        console.error('Quality change failed:', result.error);
      } else {
        setCurrentQuality(quality);
      }
    } catch (err) {
      console.error('Error setting quality:', err);
    }
  }, [viewingRoom, simulcastEnabled]);

  return {
    viewingRoom,
    remoteStream,
    simulcastEnabled,
    currentQuality,
    edgeInfo,
    viewBroadcast,
    stopViewing,
    changeQuality,
  };
}
