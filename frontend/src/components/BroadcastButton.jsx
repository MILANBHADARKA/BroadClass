import { useState, useRef, useEffect } from 'react';
import './BroadcastButton.css';

function BroadcastButton({ socket, device }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const localVideoRef = useRef(null);
  
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      console.log('Setting local video srcObject');
      localVideoRef.current.srcObject = localStream;
      
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

  const startBroadcast = async () => {
    if (!roomId.trim()) {
      alert('Please enter a room ID');
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Camera access is not available. On mobile devices, you must use HTTPS.\n\nTry accessing via: https://192.168.1.68:5173 (you may need to accept the security warning)');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      console.log('Got media stream:', stream.getTracks());
      
      setIsBroadcasting(true);
      
      setLocalStream(stream);

      await new Promise(resolve => setTimeout(resolve, 100));

      const transportData = await new Promise((resolve) => {
        socket.emit('createWebRtcTransport', { sender: true, roomId }, resolve);
      });

      if (transportData.error) {
        throw new Error(transportData.error);
      }

      const producerTransport = device.createSendTransport(transportData);

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

      const videoTrack = stream.getVideoTracks()[0];
      await producerTransport.produce({ 
        track: videoTrack,
        // Enable simulcast with 3 quality layers
        encodings: [
          { scaleResolutionDownBy: 4, maxBitrate: 500000 },   // Low: ~480p
          { scaleResolutionDownBy: 2, maxBitrate: 1000000 },  // Medium: ~720p
          { scaleResolutionDownBy: 1, maxBitrate: 3000000 }   // High: ~1080p
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000
        }
      });

      const audioTrack = stream.getAudioTracks()[0];
      await producerTransport.produce({ track: audioTrack });

      console.log('Broadcasting started successfully');

    } catch (error) {
      console.error('Error starting broadcast:', error);
      alert('Failed to start broadcast: ' + error.message);
      
      setIsBroadcasting(false);
      setLocalStream(null);
    }
  };

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
    setIsCameraOn(true);
    setIsMicOn(true);
    console.log('Broadcasting stopped');
  };

  const toggleCamera = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
        console.log('Camera toggled:', videoTrack.enabled);
      }
    }
  };

  const toggleMic = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
        console.log('Microphone toggled:', audioTrack.enabled);
      }
    }
  };

  return (
    <div className="broadcast-section">
      <h2>Start Broadcasting</h2>
      
      {isBroadcasting && (
        <div className="video-container">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
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
          <>
            <button onClick={stopBroadcast} className="btn btn-stop">
              Stop Broadcast
            </button>
            <div className="media-controls">
              <button 
                onClick={toggleCamera} 
                className={`btn btn-media ${isCameraOn ? 'btn-on' : 'btn-off'}`}
                title={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {isCameraOn ? 'Camera On' : 'Camera Off'}
              </button>
              <button 
                onClick={toggleMic} 
                className={`btn btn-media ${isMicOn ? 'btn-on' : 'btn-off'}`}
                title={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
              >
                {isMicOn ? 'Mic On' : 'Mic Off'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default BroadcastButton;
