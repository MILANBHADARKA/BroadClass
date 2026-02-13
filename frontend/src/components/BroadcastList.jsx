import { useState, useEffect, useRef } from 'react';
import './BroadcastList.css';

function BroadcastList({ socket, device, broadcasts }) {
  const [viewingRoom, setViewingRoom] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [simulcastEnabled, setSimulcastEnabled] = useState(true);
  const [currentQuality, setCurrentQuality] = useState('auto');
  const remoteVideoRef = useRef(null);


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

  const viewBroadcast = async (roomId) => {
    try {
      await new Promise((resolve) => {
        socket.emit('joinBroadcast', { roomId }, resolve);
      });

      const transportData = await new Promise((resolve) => {
        socket.emit('createWebRtcTransport', { sender: false, roomId }, resolve);
      });

      const consumerTransport = device.createRecvTransport(transportData);

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
        
        // Check if simulcast is enabled
        if (videoConsumerData.simulcast) {
          setSimulcastEnabled(true);
          console.log('Simulcast enabled - Auto-adaptive quality active');
        }
      }

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


  const stopViewing = () => {
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setViewingRoom(null);
    setRemoteStream(null);
    setSimulcastEnabled(false);
    setCurrentQuality('auto');
    console.log('Stopped viewing');
  };

  /**
   * Manually set video quality
   */
  const setQuality = async (quality) => {
    if (!viewingRoom || !simulcastEnabled) return;

    try {
      const result = await new Promise((resolve) => {
        socket.emit('setQuality', { roomId: viewingRoom, quality }, resolve);
      });

      if (result.error) {
        console.error('Error setting quality:', result.error);
        alert('Failed to change quality: ' + result.error);
      } else {
        setCurrentQuality(quality);
        console.log(`Manual quality set to: ${quality}`);
      }
    } catch (error) {
      console.error('Error setting quality:', error);
    }
  };

  useEffect(() => {
    const handleBroadcastEnded = ({ roomId }) => {
      if (roomId === viewingRoom) {
        stopViewing();
        alert(`Broadcast ${roomId} has ended`);
      }
    };

    const handleQualityChanged = ({ quality }) => {
      console.log(`Quality auto-changed to: ${quality}`);
      setCurrentQuality(quality);
    };

    socket.on('broadcastEnded', handleBroadcastEnded);
    socket.on('qualityChanged', handleQualityChanged);

    return () => {
      socket.off('broadcastEnded', handleBroadcastEnded);
      socket.off('qualityChanged', handleQualityChanged);
    };
  }, [socket, viewingRoom]);

  return (
    <div className="broadcast-list-section">
      <h2>Active Broadcasts</h2>

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
            {simulcastEnabled && (
              <div className="quality-overlay">
                <div className="quality-indicator">
                  <span className="quality-label">Quality:</span>
                  <span className={`quality-badge quality-${currentQuality}`}>
                    {currentQuality.toUpperCase()}
                  </span>
                </div>
              </div>
            )}
          </div>
          {simulcastEnabled && (
            <div className="quality-controls">
              <label>Video Quality:</label>
              <div className="quality-buttons">
                <button 
                  onClick={() => setQuality('auto')} 
                  className={`btn btn-quality ${currentQuality === 'auto' ? 'active' : ''}`}
                >
                  Auto
                </button>
                <button 
                  onClick={() => setQuality('low')} 
                  className={`btn btn-quality ${currentQuality === 'low' ? 'active' : ''}`}
                >
                  Low (480p)
                </button>
                <button 
                  onClick={() => setQuality('medium')} 
                  className={`btn btn-quality ${currentQuality === 'medium' ? 'active' : ''}`}
                >
                  Medium (720p)
                </button>
                <button 
                  onClick={() => setQuality('high')} 
                  className={`btn btn-quality ${currentQuality === 'high' ? 'active' : ''}`}
                >
                  High (1080p)
                </button>
              </div>
              <p className="quality-hint">
                Auto mode adapts quality based on your network speed
              </p>
            </div>
          )}
        </div>
      )}

      <div className="broadcasts-grid">
        {broadcasts.length === 0 ? (
          <p className="no-broadcasts">No active broadcasts</p>
        ) : (
          broadcasts.map((broadcast) => (
            console.log('Rendering broadcast room:', broadcast.roomId),
            <div key={broadcast.roomId} className="broadcast-card">
              <div className="broadcast-info">
                <h3>{broadcast.roomId}</h3>
                <span className="live-badge">🔴 LIVE</span>
              </div>
              <button
                onClick={() => viewBroadcast(broadcast.roomId)}
                disabled={viewingRoom === broadcast}
                className="btn btn-view"
              >
                {viewingRoom === broadcast ? 'Viewing' : 'View Broadcast'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default BroadcastList;
