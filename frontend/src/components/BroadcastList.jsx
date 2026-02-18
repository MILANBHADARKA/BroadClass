import { useRef, useEffect } from 'react';
import useEdgeViewer from '../hooks/useEdgeViewer';
import QualityControls from './QualityControls';
import './BroadcastList.css';

function BroadcastList({ socket, device, broadcasts, onJoinBroadcast, originServer }) {
  const remoteVideoRef = useRef(null);

  const {
    viewingRoom,
    remoteStream,
    simulcastEnabled,
    currentQuality,
    edgeInfo,
    viewBroadcast,
    stopViewing,
    changeQuality,
  } = useEdgeViewer({ device, onJoinBroadcast });

  // Attach remote stream to <video> element
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (video && remoteStream) {
      video.srcObject = remoteStream;
      video.play().catch(() => {});
    }
  }, [remoteStream]);

  return (
    <div className="broadcast-list-section">
      <h2>Active Broadcasts</h2>

      {viewingRoom && (
        <div className="viewing-container">
          <div className="viewing-header">
            <h3>Viewing: {viewingRoom}</h3>
            {edgeInfo && (
              <span className="edge-info">
                {edgeInfo.isOrigin ? '🌍 Origin' : '🔗 Edge'}: {edgeInfo.ip}:{edgeInfo.port}
                {edgeInfo.load !== undefined && ` (${edgeInfo.load.toFixed(1)}% load)`}
              </span>
            )}
            <button onClick={stopViewing} className="btn btn-stop-viewing">
              Stop Viewing
            </button>
          </div>

          <div className="video-container">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
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
            <QualityControls
              currentQuality={currentQuality}
              onChangeQuality={changeQuality}
            />
          )}
        </div>
      )}

      <div className="broadcasts-grid">
        {broadcasts.length === 0 ? (
          <p className="no-broadcasts">No active broadcasts</p>
        ) : (
          broadcasts.map((broadcast) => (
            <div key={broadcast.roomId} className="broadcast-card">
              <div className="broadcast-info">
                <h3>{broadcast.roomId}</h3>
                <span className="live-badge">🔴 LIVE</span>
              </div>
              <button
                onClick={() => viewBroadcast(broadcast.roomId)}
                disabled={viewingRoom === broadcast.roomId}
                className="btn btn-view"
              >
                {viewingRoom === broadcast.roomId ? 'Viewing' : 'View Broadcast'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default BroadcastList;