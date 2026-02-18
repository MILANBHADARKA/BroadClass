import { useState, useRef, useEffect } from 'react';
import useBroadcaster from '../hooks/useBroadcaster';
import './BroadcastButton.css';

function BroadcastButton({ socket, device }) {
  const [roomId, setRoomId] = useState('');
  const localVideoRef = useRef(null);

  const {
    isBroadcasting,
    localStream,
    isCameraOn,
    isMicOn,
    startBroadcast,
    stopBroadcast,
    toggleCamera,
    toggleMic,
  } = useBroadcaster({ socket, device });

  // Attach local stream to <video> element whenever it changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

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
          <button onClick={() => startBroadcast(roomId)} className="btn btn-start">
            Start Broadcast
          </button>
        ) : (
          <>
            <button onClick={() => stopBroadcast(roomId)} className="btn btn-stop">
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
