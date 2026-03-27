import { useState, useRef, useEffect } from 'react';
import useBroadcaster from '../hooks/useBroadcaster';
import RecordingPanel from './RecordingPanel';

function BroadcastButton({ socket, device, classroomId }) {
  const [roomId, setRoomId] = useState(classroomId || '');
  const [showScreenShareOptions, setShowScreenShareOptions] = useState(false);
  const localVideoRef = useRef(null);

  const {
    isBroadcasting,
    localStream,
    isCameraOn,
    isMicOn,
    isScreenSharing,
    screenShareMode,
    pipPosition,
    pipSize,
    startBroadcast,
    stopBroadcast,
    toggleCamera,
    toggleMic,
    startScreenShare,
    stopScreenShare,
    togglePipCamera,
    changePipPosition,
    changePipSize,
  } = useBroadcaster({ socket, device });

  // Attach local stream to <video> element whenever it changes
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowScreenShareOptions(false);
    if (showScreenShareOptions) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showScreenShareOptions]);

  const handleScreenShareClick = (e) => {
    e.stopPropagation();
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      setShowScreenShareOptions(!showScreenShareOptions);
    }
  };

  const handleSelectScreenShareMode = (mode) => {
    setShowScreenShareOptions(false);
    startScreenShare(mode);
  };

  return (
    <div className="glass rounded-2xl p-4 sm:p-6 mb-6 animate-fade-in glow-accent-sm">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-gradient-accent flex items-center justify-center glow-accent-sm">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Broadcast Studio</h2>
          <p className="text-sm text-text-muted">
            {isBroadcasting ? 'Your broadcast is live' : 'Start streaming to your students'}
          </p>
        </div>
        {isBroadcasting && (
          <div className="ml-auto badge-live animate-pulse-glow">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse-live" />
            LIVE
          </div>
        )}
      </div>

      {/* Video Preview */}
      {isBroadcasting && (
        <div className="relative rounded-2xl overflow-hidden bg-surface-900 border border-border mb-5 aspect-video max-h-[65vh]">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-contain bg-surface-950"
          />
          {/* Video overlay with gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-950/60 via-transparent to-transparent pointer-events-none" />
          
          {/* Status badges */}
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <div className="badge-live shadow-lg">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse-live" />
              LIVE
            </div>
            {isScreenSharing && (
              <div className="badge bg-secondary/90 text-white backdrop-blur-sm shadow-lg">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                </svg>
                {screenShareMode === 'screen-with-camera' ? 'Screen + Camera' : 'Screen'}
              </div>
            )}
          </div>
          
          {/* Camera/Mic status indicators */}
          <div className="absolute bottom-3 left-3 flex items-center gap-2">
            <div className={`p-2 rounded-lg backdrop-blur-sm ${isCameraOn ? 'bg-surface-800/80' : 'bg-danger/80'}`}>
              {isCameraOn ? (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-.591-10.5-10.5m0 0L2.25 6.75" />
                </svg>
              )}
            </div>
            <div className={`p-2 rounded-lg backdrop-blur-sm ${isMicOn ? 'bg-surface-800/80' : 'bg-danger/80'}`}>
              {isMicOn ? (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3ZM3.75 3.75l16.5 16.5" />
                </svg>
              )}
            </div>
          </div>

          {/* PiP Controls (when screen sharing with camera) */}
          {isScreenSharing && screenShareMode === 'screen-with-camera' && (
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              {/* Position selector */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-800/90 backdrop-blur-sm">
                {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((pos) => (
                  <button
                    key={pos}
                    onClick={() => changePipPosition(pos)}
                    className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                      pipPosition === pos ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-surface-700'
                    }`}
                    title={pos.replace('-', ' ')}
                  >
                    <div className={`w-2 h-2 rounded-full bg-current ${
                      pos === 'top-left' ? '' :
                      pos === 'top-right' ? '' :
                      pos === 'bottom-left' ? '' : ''
                    }`} style={{
                      position: 'relative',
                      ...(pos === 'top-left' && { top: '-2px', left: '-2px' }),
                      ...(pos === 'top-right' && { top: '-2px', left: '2px' }),
                      ...(pos === 'bottom-left' && { top: '2px', left: '-2px' }),
                      ...(pos === 'bottom-right' && { top: '2px', left: '2px' }),
                    }} />
                  </button>
                ))}
              </div>
              {/* Size selector */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-800/90 backdrop-blur-sm">
                {[
                  { key: 'small', label: 'S' },
                  { key: 'medium', label: 'M' },
                  { key: 'large', label: 'L' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => changePipSize(key)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                      pipSize === key ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-surface-700'
                    }`}
                    title={`${key} size`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {!classroomId && (
          <input
            type="text"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            disabled={isBroadcasting}
            className="input w-40"
          />
        )}

        {!isBroadcasting ? (
          <button
            onClick={() => startBroadcast(roomId)}
            className="btn-primary"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
            Go Live
          </button>
        ) : (
          <>
            {/* Media controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleCamera}
                disabled={isScreenSharing}
                className={`btn-icon ${!isCameraOn ? 'bg-danger-muted border-danger/30 text-red-400 hover:bg-danger/20' : ''} ${isScreenSharing ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                className={`btn-icon ${!isMicOn ? 'bg-danger-muted border-danger/30 text-red-400 hover:bg-danger/20' : ''}`}
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
              
              {/* Screen Share with dropdown */}
              <div className="relative">
                <button
                  onClick={handleScreenShareClick}
                  className={`btn-icon ${isScreenSharing ? 'bg-secondary-muted border-secondary/30 text-secondary' : ''}`}
                  title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                  </svg>
                </button>
                
                {/* Screen share options dropdown */}
                {showScreenShareOptions && !isScreenSharing && (
                  <div 
                    className="absolute bottom-full left-0 mb-2 w-64 p-2 rounded-xl glass border border-border shadow-xl z-50 animate-scale-in"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-xs text-text-muted px-2 py-1 mb-1">Screen Share Mode</p>
                    <button
                      onClick={() => handleSelectScreenShareMode('screen-only')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-700 transition-all text-left group"
                    >
                      <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary group-hover:text-white">Screen Only</p>
                        <p className="text-xs text-text-muted">Share your entire screen</p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleSelectScreenShareMode('screen-with-camera')}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-700 transition-all text-left group mt-1"
                    >
                      <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center shrink-0 relative">
                        <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                        </svg>
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-accent border-2 border-surface-800 flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                          </svg>
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary group-hover:text-white">Screen + Camera</p>
                        <p className="text-xs text-text-muted">Show your face in a circle overlay</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              {/* Toggle PiP camera visibility when screen sharing */}
              {isScreenSharing && (
                <button
                  onClick={togglePipCamera}
                  className={`btn-icon ${screenShareMode === 'screen-with-camera' ? 'bg-accent-muted border-accent/30 text-accent' : ''}`}
                  title={screenShareMode === 'screen-with-camera' ? 'Hide camera overlay' : 'Show camera overlay'}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </button>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* End broadcast button */}
            <button
              onClick={() => stopBroadcast(roomId)}
              className="btn-danger"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
              </svg>
              End Broadcast
            </button>
          </>
        )}
      </div>

      {/* Recording Panel - Only show when broadcasting */}
      {isBroadcasting && (
        <RecordingPanel 
          socket={socket} 
          classroomId={classroomId}
          broadcastId={roomId}
          isLive={isBroadcasting}
        />
      )}
    </div>
  );
}

export default BroadcastButton;