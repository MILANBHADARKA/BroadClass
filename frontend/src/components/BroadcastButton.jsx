import { useState, useRef, useEffect } from 'react';
import './BroadcastButton.css';

/**
 * BroadcastButton Component
 * Allows user to start/stop broadcasting their camera and microphone
 */
function BroadcastButton({ socket, device }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const localVideoRef = useRef(null);

  /**
   * Update video element when localStream changes
   */
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log('Setting local video srcObject');
      localVideoRef.current.srcObject = localStream;
      
      // Ensure video plays
      localVideoRef.current.play()
        .then(() => {
          console.log('Local video playing successfully');
        })
        .catch(err => {
          console.error('Error playing local video:', err);
        });
      
      console.log('Local video stream tracks:', localStream.getTracks().map(t => ({
        kind: t.kind,
        enabled: t.enabled,
        readyState: t.readyState
      })));
    } else {
      if (!localVideoRef.current) console.log('Video ref not available');
      if (!localStream) console.log('Local stream not available');
    }
  }, [localStream]);

  /**
   * Start broadcasting to a room
   * Creates producer transport and sends media to server
   */
  const startBroadcast = async () => {
    if (!roomId.trim()) {
      alert('Please enter a room ID');
      return;
    }

    try {
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Camera access is not available. On mobile devices, you must use HTTPS.\n\nTry accessing via: https://192.168.1.68:5173 (you may need to accept the security warning)');
        return;
      }

      // Get user media (camera and microphone)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      console.log('Got media stream:', stream.getTracks());
      
      // Set broadcasting state first to render video element
      setIsBroadcasting(true);
      
      // Then set the stream - useEffect will attach it to the video element
      setLocalStream(stream);

      // Wait a bit for React to render the video element
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create producer transport (pass roomId so server creates router)
      const transportData = await new Promise((resolve) => {
        socket.emit('createWebRtcTransport', { sender: true, roomId }, resolve);
      });

      // Check if server returned an error (room already in use)
      if (transportData.error) {
        throw new Error(transportData.error);
      }

      const producerTransport = device.createSendTransport(transportData);

      // Handle transport connection
      producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await new Promise((resolve) => {
            socket.emit('connectTransport', {
              transportId: producerTransport.id,
              dtlsParameters
            }, resolve);
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      // Handle when media is produced
      producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
        try {
          const { producerId } = await new Promise((resolve) => {
            socket.emit('startBroadcast', { roomId, rtpParameters, kind }, resolve);
          });
          callback({ id: producerId });
        } catch (error) {
          errback(error);
        }
      });

      // Produce video track
      const videoTrack = stream.getVideoTracks()[0];
      await producerTransport.produce({ track: videoTrack });

      // Produce audio track
      const audioTrack = stream.getAudioTracks()[0];
      await producerTransport.produce({ track: audioTrack });

      console.log('Broadcasting started successfully');

    } catch (error) {
      console.error('Error starting broadcast:', error);
      alert('Failed to start broadcast: ' + error.message);
      
      // Clean up on error
      setIsBroadcasting(false);
      setLocalStream(null);
    }
  };

  /**
   * Stop broadcasting
   * Stops all media tracks and notifies server
   */
  const stopBroadcast = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    socket.emit('stopBroadcast', { roomId });
    setIsBroadcasting(false);
    setLocalStream(null);
    console.log('Broadcasting stopped');
  };

  return (
    <div className="broadcast-section">
      <h2>Start Broadcasting</h2>
      
      {/* Local video preview when broadcasting */}
      {isBroadcasting && (
        <div className="video-container">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            controls
            className="video-element"
          />
        </div>
      )}

      <div className="broadcast-controls">
        <input
          type="text"
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          disabled={isBroadcasting}
          className="room-input"
        />
        
        {!isBroadcasting ? (
          <button onClick={startBroadcast} className="btn btn-start">
            Start Broadcast
          </button>
        ) : (
          <button onClick={stopBroadcast} className="btn btn-stop">
            Stop Broadcast
          </button>
        )}
      </div>
    </div>
  );
}

export default BroadcastButton;
