import { useState, useRef, useEffect } from 'react';
import useBroadcaster from '../hooks/useBroadcaster';

function BroadcastButton({ socket, device, classroomId }) {
  const [roomId, setRoomId] = useState(classroomId || '');
  const localVideoRef = useRef(null);

  const {
    isBroadcasting,
    localStream,
    isCameraOn,
    isMicOn,
    isScreenSharing,
    startBroadcast,
    stopBroadcast,
    toggleCamera,
    toggleMic,
    startScreenShare,
    stopScreenShare,
  } = useBroadcaster({ socket, device });

  // Attach local stream to <video> element whenever it changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  return (
    <div className="glass rounded-2xl p-3 sm:p-5 lg:p-6 mb-4 sm:mb-6 animate-fade-in">
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3 sm:mb-4">
        Broadcast Studio
      </h2>

      {isBroadcasting && (
        <div className="relative rounded-xl overflow-hidden bg-surface-900 border border-border mb-3 sm:mb-4 aspect-video max-h-[75vh]">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-contain"
          />
          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 flex items-center gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-red-500/90 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse-live" />
            <span className="text-white text-xs font-semibold">LIVE</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {!classroomId && (
          <input
            type="text"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            disabled={isBroadcasting}
            className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-surface-800 border border-border text-text-primary placeholder-text-muted text-sm outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 disabled:opacity-50"
          />
        )}

        {!isBroadcasting ? (
          <button
            onClick={() => startBroadcast(roomId)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-surface-900 font-semibold text-sm hover:bg-accent-light glow-accent-sm transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
            Go Live
          </button>
        ) : (
          <>
            <button
              onClick={() => stopBroadcast(roomId)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-danger text-white font-semibold text-sm hover:bg-red-600 transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
              </svg>
              End Broadcast
            </button>

            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                className={`px-3 py-2 rounded-xl border text-xs sm:text-sm transition-all cursor-pointer
                  ${isScreenSharing
                    ? 'bg-accent/10 border-accent/30 text-accent'
                    : 'bg-surface-800 border-border text-text-primary hover:bg-surface-700'
                  }`}
                title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
              >
                {isScreenSharing ? 'Stop Share' : 'Share Screen'}
              </button>
              <button
                onClick={toggleCamera}
                className={`p-2.5 rounded-xl border text-sm transition-all cursor-pointer
                  ${isCameraOn
                    ? 'bg-surface-800 border-border text-text-primary hover:bg-surface-700'
                    : 'bg-danger-muted border-danger/30 text-red-400'
                  }`}
                title={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {isCameraOn ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-.591-10.5-10.5m0 0L2.25 6.75" />
                  </svg>
                )}
              </button>
              <button
                onClick={toggleMic}
                className={`p-2.5 rounded-xl border text-sm transition-all cursor-pointer
                  ${isMicOn
                    ? 'bg-surface-800 border-border text-text-primary hover:bg-surface-700'
                    : 'bg-danger-muted border-danger/30 text-red-400'
                  }`}
                title={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
              >
                {isMicOn ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3ZM3.75 3.75l16.5 16.5" />
                  </svg>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default BroadcastButton;