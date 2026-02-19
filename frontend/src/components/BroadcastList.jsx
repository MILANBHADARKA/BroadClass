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
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
        Active Broadcasts
      </h2>

      {viewingRoom && (
        <div className="glass rounded-2xl p-3 sm:p-5 mb-4 sm:mb-6 glow-accent-sm">
          {/* Viewing header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-red-500/90">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse-live" />
                <span className="text-white text-xs font-semibold">LIVE</span>
              </div>
              <span className="text-text-primary text-xs sm:text-sm font-medium truncate">Viewing: {viewingRoom}</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-800 text-text-muted text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                {viewingCount} watching
              </span>
              {edgeInfo && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-800 text-text-muted text-xs">
                  {edgeInfo.isOrigin ? '🌍 Origin' : '🔗 Edge'}: {edgeInfo.ip}:{edgeInfo.port}
                  {edgeInfo.load !== undefined && ` (${edgeInfo.load.toFixed(1)}%)`}
                </span>
              )}
            </div>
            <button
              onClick={stopViewing}
              className="inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-surface-800 border border-border text-text-secondary text-xs sm:text-sm hover:bg-surface-700 hover:text-text-primary transition-all cursor-pointer shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              Stop
            </button>
          </div>

          {/* Video */}
          <div className="relative rounded-xl overflow-hidden bg-surface-900 border border-border aspect-video max-h-[80vh]">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              controls
              className="w-full h-full object-contain"
            />
            {simulcastEnabled && (
              <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3">
                <span className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-xs font-semibold backdrop-blur-sm
                  ${currentQuality === 'high' ? 'bg-green-500/80 text-white' :
                    currentQuality === 'medium' ? 'bg-yellow-500/80 text-white' :
                    currentQuality === 'low' ? 'bg-orange-500/80 text-white' :
                    'bg-accent/80 text-white'}`}
                >
                  {currentQuality.toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {simulcastEnabled && (
            <div className="mt-3 sm:mt-4">
              <QualityControls
                currentQuality={currentQuality}
                onChangeQuality={changeQuality}
              />
            </div>
          )}
        </div>
      )}

      {/* Broadcasts grid */}
      {broadcasts.length === 0 ? (
        <div className="glass rounded-2xl p-12 flex flex-col items-center justify-center">
          <svg className="w-12 h-12 text-text-muted/40 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-text-muted text-sm">No active broadcasts</p>
          <p className="text-text-muted/50 text-xs mt-1">Broadcasts will appear here when a teacher goes live</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {broadcasts.map((broadcast) => (
            <div key={broadcast.roomId} className="glass rounded-xl p-4 flex items-center justify-between gap-3 hover:glass-hover transition-all">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse-live" />
                </div>
                <div className="min-w-0">
                  <p className="text-text-primary text-sm font-medium truncate">{broadcast.roomId}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-red-400 text-xs font-medium">LIVE NOW</p>
                    <span className="text-text-muted text-xs">• {broadcast.viewerCount ?? 0} watching</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => viewBroadcast(broadcast.roomId)}
                disabled={viewingRoom === broadcast.roomId}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer shrink-0
                  ${viewingRoom === broadcast.roomId
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'bg-accent text-surface-900 hover:bg-accent-light glow-accent-sm'
                  }`}
              >
                {viewingRoom === broadcast.roomId ? 'Viewing' : 'Watch'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default BroadcastList;