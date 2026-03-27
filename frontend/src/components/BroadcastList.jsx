import { useRef, useEffect } from 'react';
import useEdgeViewer from '../hooks/useEdgeViewer';
import QualityControls from './QualityControls';

function BroadcastList({ socket, device, broadcasts, onJoinBroadcast, originServer, authToken }) {
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
  } = useEdgeViewer({ device, onJoinBroadcast, authToken });

  const viewingBroadcast = broadcasts.find((b) => b.roomId === viewingRoom);
  const viewingCount = viewingBroadcast?.viewerCount ?? 0;

  // Attach remote stream to <video> element
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (video && remoteStream) {
      video.srcObject = remoteStream;
      video.play().catch(() => {});
    }
  }, [remoteStream]);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-secondary to-secondary/70 flex items-center justify-center glow-secondary-sm">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Live Classroom</h2>
          <p className="text-sm text-text-muted">
            {broadcasts.length > 0 ? `${broadcasts.length} active broadcast${broadcasts.length > 1 ? 's' : ''}` : 'Waiting for teacher to go live'}
          </p>
        </div>
      </div>

      {/* Active Viewing Panel */}
      {viewingRoom && (
        <div className="glass rounded-2xl p-4 sm:p-6 mb-6 glow-accent-sm animate-fade-in">
          {/* Viewing header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="badge-live">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse-live" />
                LIVE
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-800/80 text-text-muted text-xs">
                <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
                </svg>
                {viewingCount} watching
              </span>
              {edgeInfo && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-800/60 text-text-muted text-xs">
                  {edgeInfo.isOrigin ? '🌍' : '⚡'} {edgeInfo.isOrigin ? 'Direct' : 'Edge'}
                  {edgeInfo.load !== undefined && (
                    <span className="text-accent">({edgeInfo.load.toFixed(0)}%)</span>
                  )}
                </span>
              )}
            </div>
            <button
              onClick={stopViewing}
              className="btn-secondary text-xs sm:text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Leave
            </button>
          </div>

          {/* Video Player */}
          <div className="relative rounded-2xl overflow-hidden bg-surface-950 border border-border aspect-video max-h-[75vh]">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              controls
              className="w-full h-full object-contain bg-surface-950"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-surface-950/40 via-transparent to-transparent pointer-events-none" />
            
            {/* Quality badge */}
            {simulcastEnabled && (
              <div className="absolute bottom-3 right-3">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-sm shadow-lg
                  ${currentQuality === 'high' ? 'bg-success/90 text-white' :
                    currentQuality === 'medium' ? 'bg-warning/90 text-white' :
                    currentQuality === 'low' ? 'bg-orange-500/90 text-white' :
                    'bg-accent/90 text-white'}`}
                >
                  {currentQuality === 'high' ? 'HD' : currentQuality === 'medium' ? 'SD' : currentQuality.toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Quality Controls */}
          {simulcastEnabled && (
            <div className="mt-4 pt-4 border-t border-border">
              <QualityControls
                currentQuality={currentQuality}
                onChangeQuality={changeQuality}
              />
            </div>
          )}
        </div>
      )}

      {/* Broadcasts List */}
      {broadcasts.length === 0 ? (
        <div className="glass rounded-2xl p-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-800/50 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-text-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-text-secondary text-base font-medium mb-1">No Active Broadcast</p>
          <p className="text-text-muted text-sm max-w-xs">
            The teacher hasn't started broadcasting yet. You'll be able to watch when they go live.
          </p>
        </div>
      ) : !viewingRoom ? (
        <div className="grid grid-cols-1 gap-4">
          {broadcasts.map((broadcast) => (
            <div 
              key={broadcast.roomId} 
              className="glass rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-4 hover:glow-accent-sm transition-all duration-300 group"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-danger to-danger/70 flex items-center justify-center shrink-0">
                  <span className="w-3 h-3 rounded-full bg-white animate-pulse-live" />
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-danger rounded-full animate-ping" />
                </div>
                <div className="min-w-0">
                  <p className="text-text-primary font-semibold truncate">Live Broadcast</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="badge-live text-xs py-0.5">LIVE</span>
                    <span className="text-text-muted text-xs flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
                      </svg>
                      {broadcast.viewerCount ?? 0} watching
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => viewBroadcast(broadcast.roomId)}
                disabled={viewingRoom === broadcast.roomId}
                className="btn-primary shrink-0 group-hover:glow-accent"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
                Join Now
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default BroadcastList;