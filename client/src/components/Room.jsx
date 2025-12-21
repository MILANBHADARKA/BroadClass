import { useState, useRef, useEffect } from 'react';
import Chat from './Chat';
import './Room.css';

function Room({ client, roomId, isInstructor, onLeave, participantCount, messages, remoteVideos, onSendMessage }) {
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  
  const localVideoRef = useRef(null);
  const videoGridRef = useRef(null);

  useEffect(() => {
    initializeMedia();

    return () => {
      // Cleanup on unmount
      if (localVideoRef.current && localVideoRef.current.srcObject) {
        localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    console.log('[Room] Remote videos updated:', remoteVideos.size);
    remoteVideos.forEach((data, participantId) => {
      console.log(`[Room] Participant ${participantId}:`, data.stream.getTracks());
    });
  }, [remoteVideos]);

  const initializeMedia = async () => {
    try {
      // Initialize device
      await client.initializeDevice();
      
      // Get user media
      const stream = await client.getUserMedia(true, true);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      // Produce video and audio
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      
      if (videoTrack) {
        await client.produce(videoTrack);
      }
      
      if (audioTrack) {
        await client.produce(audioTrack);
      }
      
      // If student, get existing producers
      if (!isInstructor) {
        console.log('[Room] Student joined, requesting existing producers...');
        setTimeout(() => {
          client.getProducers();
        }, 1000); // Give time for transport to be ready
      } else {
        console.log('[Room] Instructor - media initialized and producing');
      }
    } catch (error) {
      console.error('Error initializing media:', error);
      alert('Failed to access camera/microphone. Please check permissions.');
    }
  };

  const handleToggleVideo = () => {
    const enabled = client.toggleVideo();
    setIsVideoEnabled(enabled);
  };

  const handleToggleAudio = () => {
    const enabled = client.toggleAudio();
    setIsAudioEnabled(enabled);
  };

  const handleSendMessage = (message) => {
    onSendMessage(message);
  };

  const handleLeave = () => {
    client.leaveRoom();
    onLeave();
  };

  return (
    <div className="room">
      <div className="room-header">
        <div className="room-info">
          <h2>{isInstructor ? 'Instructor Room' : 'Student View'}</h2>
          <span className="room-id">Room ID: {roomId}</span>
          <span className="badge">{participantCount} participant{participantCount !== 1 ? 's' : ''}</span>
        </div>
        <button className="btn btn-danger" onClick={handleLeave}>
          Leave Room
        </button>
      </div>

      <div className="room-content">
        <div className="video-container">
          <div className="video-grid" ref={videoGridRef}>
            {/* Local video */}
            <div className="video-wrapper">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
              />
              <div className="video-label">
                You ({isInstructor ? 'Instructor' : 'Student'})
              </div>
              <div className="video-controls">
                <button
                  className={`control-btn ${!isVideoEnabled ? 'disabled' : ''}`}
                  onClick={handleToggleVideo}
                  title="Toggle Video"
                >
                  <span>{isVideoEnabled ? '📹' : '🚫'}</span>
                </button>
                <button
                  className={`control-btn ${!isAudioEnabled ? 'disabled' : ''}`}
                  onClick={handleToggleAudio}
                  title="Toggle Audio"
                >
                  <span>{isAudioEnabled ? '🎤' : '🔇'}</span>
                </button>
              </div>
            </div>

            {/* Remote videos */}
            {Array.from(remoteVideos.entries()).map(([participantId, videoData]) => (
              <RemoteVideo
                key={participantId}
                participantId={participantId}
                isInstructor={videoData.isInstructor}
                stream={videoData.stream}
              />
            ))}
          </div>
        </div>

        <Chat messages={messages} onSendMessage={handleSendMessage} />
      </div>
    </div>
  );
}

function RemoteVideo({ participantId, isInstructor, stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      console.log(`[RemoteVideo] Setting stream for ${participantId}:`, stream.getTracks());
      videoRef.current.srcObject = stream;
      
      // Force play
      videoRef.current.play().catch(err => {
        console.error(`[RemoteVideo] Error playing video for ${participantId}:`, err);
      });
    }
  }, [stream, participantId]);

  return (
    <div className="video-wrapper">
      <video
        ref={videoRef}
        autoPlay
        playsInline
      />
      <div className="video-label">
        {isInstructor ? 'Instructor' : 'Student'}
      </div>
    </div>
  );
}

export default Room;
