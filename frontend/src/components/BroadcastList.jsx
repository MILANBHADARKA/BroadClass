import { useState, useEffect, useRef } from 'react';
import './BroadcastList.css';

/**
 * BroadcastList Component
 * Displays list of active broadcasts and allows viewing them
 */
function BroadcastList({ socket, device, broadcasts }) {
  const [viewingRoom, setViewingRoom] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const remoteVideoRef = useRef(null);

  /**
   * Update video element when remoteStream changes
   */
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(err => {
        console.error('Error playing remote video:', err);
      });
      console.log('Remote video stream set:', remoteStream.getTracks());
      console.log('Video tracks active:', remoteStream.getVideoTracks().map(t => t.enabled));
    }
  }, [remoteStream]);

  /**
   * Join and view a broadcast
   * Creates consumer transport and receives media from server
   */
  const viewBroadcast = async (roomId) => {
    try {
      // Join the broadcast room
      await new Promise((resolve) => {
        socket.emit('joinBroadcast', { roomId }, resolve);
      });

      // Create consumer transport (pass roomId so server can use correct router)
      const transportData = await new Promise((resolve) => {
        socket.emit('createWebRtcTransport', { sender: false, roomId }, resolve);
      });

      const consumerTransport = device.createRecvTransport(transportData);

      // Handle transport connection
      consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          await new Promise((resolve) => {
            socket.emit('connectTransport', {
              transportId: consumerTransport.id,
              dtlsParameters
            }, resolve);
          });
          callback();
        } catch (error) {
          errback(error);
        }
      });

      const stream = new MediaStream();

      // Consume video
      const videoConsumerData = await new Promise((resolve) => {
        socket.emit('consume', {
          roomId,
          rtpCapabilities: device.rtpCapabilities,
          kind: 'video'
        }, resolve);
      });

      if (!videoConsumerData.error) {
        const videoConsumer = await consumerTransport.consume({
          id: videoConsumerData.id,
          producerId: videoConsumerData.producerId,
          kind: videoConsumerData.kind,
          rtpParameters: videoConsumerData.rtpParameters
        });
        stream.addTrack(videoConsumer.track);
      }

      // Consume audio
      const audioConsumerData = await new Promise((resolve) => {
        socket.emit('consume', {
          roomId,
          rtpCapabilities: device.rtpCapabilities,
          kind: 'audio'
        }, resolve);
      });

      if (!audioConsumerData.error) {
        const audioConsumer = await consumerTransport.consume({
          id: audioConsumerData.id,
          producerId: audioConsumerData.producerId,
          kind: audioConsumerData.kind,
          rtpParameters: audioConsumerData.rtpParameters
        });
        stream.addTrack(audioConsumer.track);
      }

      setRemoteStream(stream);
      setViewingRoom(roomId);

      console.log('Viewing broadcast:', roomId);

    } catch (error) {
      console.error('Error viewing broadcast:', error);
      alert('Failed to view broadcast: ' + error.message);
    }
  };

  /**
   * Stop viewing current broadcast
   */
  const stopViewing = () => {
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setViewingRoom(null);
    setRemoteStream(null);
    console.log('Stopped viewing');
  };

  /**
   * Handle broadcast ended event from server
   */
  useEffect(() => {
    const handleBroadcastEnded = ({ roomId }) => {
      if (roomId === viewingRoom) {
        stopViewing();
        alert(`Broadcast ${roomId} has ended`);
      }
    };

    socket.on('broadcastEnded', handleBroadcastEnded);

    return () => {
      socket.off('broadcastEnded', handleBroadcastEnded);
    };
  }, [socket, viewingRoom]);

  return (
    <div className="broadcast-list-section">
      <h2>Active Broadcasts</h2>

      {/* Remote video display when viewing a broadcast */}
      {viewingRoom && (
        <div className="viewing-container">
          <div className="viewing-header">
            <h3>Viewing: {viewingRoom}</h3>
            <button onClick={stopViewing} className="btn btn-stop-viewing">
              Stop Viewing
            </button>
          </div>
          <div className="video-container">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              controls
              className="video-element"
            />
          </div>
        </div>
      )}

      {/* List of available broadcasts */}
      <div className="broadcasts-grid">
        {broadcasts.length === 0 ? (
          <p className="no-broadcasts">No active broadcasts</p>
        ) : (
          broadcasts.map((roomId) => (
            <div key={roomId} className="broadcast-card">
              <div className="broadcast-info">
                <h3>{roomId}</h3>
                <span className="live-badge">🔴 LIVE</span>
              </div>
              <button
                onClick={() => viewBroadcast(roomId)}
                disabled={viewingRoom === roomId}
                className="btn btn-view"
              >
                {viewingRoom === roomId ? 'Viewing' : 'View Broadcast'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default BroadcastList;
