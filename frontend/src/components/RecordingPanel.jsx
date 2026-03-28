import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function RecordingPanel({ socket, classroomId, broadcastId, isLive }) {
  const { API_URL, authFetch } = useAuth();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingId, setRecordingId] = useState(null);
  const [duration, setDuration] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedMB, setUploadedMB] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [accessType, setAccessType] = useState('CLASSROOM');
  const [showAccessOptions, setShowAccessOptions] = useState(false);

  const accessOptions = [
    {
      value: 'PRIVATE',
      label: 'Private',
      description: 'Only you can access',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
    },
    {
      value: 'CLASSROOM',
      label: 'Classroom',
      description: 'All enrolled students',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      ),
    },
    // {
    //   value: 'PUBLIC',
    //   label: 'Public',
    //   description: 'Anyone with link',
    //   icon: (
    //     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    //       <path strokeLinecap="round" strokeLinejoin="round" d="M12.75 3.03v.568c0 .334.148.65.405.864l1.068.89c.442.369.535 1.01.216 1.49l-.51.766a2.25 2.25 0 01-1.161.886l-.143.048a1.107 1.107 0 00-.57 1.664c.369.555.169 1.307-.427 1.605L9 13.125l.423 1.059a.956.956 0 01-1.652.928l-.679-.906a1.125 1.125 0 00-1.906.172L4.5 15.75l-.612.153M12.75 3.031a9 9 0 00-8.862 12.872M12.75 3.031a9 9 0 016.69 14.036m0 0l-.177-.529A2.25 2.25 0 0017.128 15H16.5l-.324-.324a1.453 1.453 0 00-2.328.377l-.036.073a1.586 1.586 0 01-.982.816l-.99.282c-.55.157-.894.702-.8 1.267l.073.438c.08.474.49.821.97.821.846 0 1.598.542 1.865 1.345l.215.643m5.276-3.67a9.012 9.012 0 01-5.276 3.67m0 0a9 9 0 01-10.275-4.835M15.75 9h-.008v.008h.008V9z" />
    //     </svg>
    //   ),
    // },
  ];

  // Timer for recording duration
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording]);

  // Listen to recording progress updates
  useEffect(() => {
    if (!socket) return;

    const handleProgress = (data) => {
      if (data.recordingId === recordingId) {
        const mb = (data.uploadedBytes / (1024 * 1024)).toFixed(1);
        setUploadedMB(mb);
        // Estimate progress (rough calculation based on time)
        const estimatedProgress = Math.min(95, (duration * 15) % 95);
        setUploadProgress(estimatedProgress);
      }
    };

    const handleStatus = (data) => {
      if (data.recordingId === recordingId) {
        if (data.status === 'recording_started') {
          setIsRecording(true);
          setError(null);
        } else if (data.status === 'recording_completed') {
          setIsRecording(false);
          setUploadProgress(100);
          setSuccess(`Recording completed! (${data.duration}s)`);
          setTimeout(() => setSuccess(null), 5000);
        }
      }
    };

    socket.on('recording:progress', handleProgress);
    socket.on('recording:status', handleStatus);

    return () => {
      socket.off('recording:progress', handleProgress);
      socket.off('recording:status', handleStatus);
    };
  }, [socket, recordingId, duration]);

  const formatTime = (seconds) => {
    const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  const startRecording = async () => {
    if (!classroomId || !broadcastId) {
      setError('Classroom ID and Broadcast ID are required');
      return;
    }

    if (!isLive) {
      setError('Start broadcasting first to record');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await authFetch(`${API_URL}/api/recordings/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          classroomId,
          roomId: broadcastId,
          title: `Classroom Recording - ${new Date().toLocaleString()}`,
          description: 'Auto-recorded broadcast',
          accessType,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start recording');
      }

      const data = await response.json();
      setRecordingId(data.recordingId);
      setIsRecording(true);
      setDuration(0);
      setUploadProgress(0);
      setUploadedMB(0);

      console.log('✅ Recording started:', data.recordingId);
    } catch (err) {
      setError(err.message);
      console.error('Error starting recording:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const stopRecording = async () => {
    if (!recordingId) {
      setError('No active recording');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Notify backend to stop recording
      const response = await authFetch(`${API_URL}/api/recordings/${recordingId}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          duration,
          fileSize: uploadedMB * 1024 * 1024,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to stop recording');
      }

      const data = await response.json();
      setIsRecording(false);
      setSuccess('Recording stopped and saved!');
      setTimeout(() => setSuccess(null), 5000);

      console.log('✅ Recording stopped:', data.recordingId);
    } catch (err) {
      setError(err.message);
      console.error('Error stopping recording:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-5 pt-5 border-t border-border animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isRecording ? 'bg-danger/20' : 'bg-surface-800'}`}>
            <svg className={`w-4 h-4 ${isRecording ? 'text-danger' : 'text-text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Recording</h3>
            <p className="text-xs text-text-muted">
              {isRecording ? 'Recording in progress' : 'Record your broadcast'}
            </p>
          </div>
        </div>
        {isRecording && (
          <div className="badge-live animate-pulse-glow">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse-live" />
            REC
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-danger/10 border border-danger/20 flex items-start gap-3">
          <svg className="w-5 h-5 text-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="mb-4 p-3 rounded-xl bg-success/10 border border-success/20 flex items-start gap-3">
          <svg className="w-5 h-5 text-success shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="text-sm text-success">{success}</p>
        </div>
      )}

      {/* Recording Active Panel */}
      {isRecording && (
        <div className="mb-4 p-4 rounded-xl bg-surface-800/50 border border-danger/20">
          {/* Duration Timer */}
          <div className="text-center mb-4">
            <div className="text-4xl font-mono text-white font-bold tracking-wider tabular-nums">
              {formatTime(duration)}
            </div>
            <p className="text-xs text-text-muted mt-1">Duration</p>
          </div>

          {/* Upload Progress */}
          <div className="mb-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-text-muted">Uploading to cloud</span>
              <span className="text-xs font-semibold text-accent tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-accent rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            {uploadedMB > 0 && (
              <p className="text-xs text-text-muted mt-1.5 text-right">{uploadedMB} MB</p>
            )}
          </div>
        </div>
      )}

      {/* Control Buttons */}
      <div className="space-y-3">
        {/* Access Type Selector (before recording) */}
        {!isRecording && isLive && (
          <div>
            <button
              onClick={() => setShowAccessOptions(!showAccessOptions)}
              type="button"
              className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-surface-800/50 border border-border hover:border-accent/30 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center text-accent">
                  {accessOptions.find(opt => opt.value === accessType)?.icon}
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-text-primary">
                    {accessOptions.find(opt => opt.value === accessType)?.label}
                  </p>
                  <p className="text-xs text-text-muted">
                    {accessOptions.find(opt => opt.value === accessType)?.description}
                  </p>
                </div>
              </div>
              <svg className={`w-4 h-4 text-text-muted transition-transform ${showAccessOptions ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Expanded Options (inline, not absolute) */}
            {showAccessOptions && (
              <div className="mt-2 p-2 rounded-xl bg-surface-900 border border-border">
                <p className="text-xs text-text-muted px-2 py-1 mb-1">Who can access recording?</p>
                {accessOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setAccessType(option.value);
                      setShowAccessOptions(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left cursor-pointer ${
                      accessType === option.value 
                        ? 'bg-accent/20 border border-accent/30' 
                        : 'hover:bg-surface-700 border border-transparent'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg ${accessType === option.value ? 'bg-accent/30 text-accent' : 'bg-surface-700 text-text-muted'} flex items-center justify-center`}>
                      {option.icon}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${accessType === option.value ? 'text-accent' : 'text-text-primary'}`}>
                        {option.label}
                      </p>
                      <p className="text-xs text-text-muted">{option.description}</p>
                    </div>
                    {accessType === option.value && (
                      <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={!isLive || isLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-danger text-white font-semibold text-sm hover:bg-red-600 disabled:bg-surface-700 disabled:text-text-muted disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Starting...
              </>
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
                Start Recording
              </>
            )}
          </button>
        ) : (
          <button
            onClick={stopRecording}
            disabled={isLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-surface-700 text-white font-semibold text-sm hover:bg-surface-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Stopping...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z" />
                </svg>
                Stop Recording
              </>
            )}
          </button>
        )}
        </div>
      </div>

      {/* Info Text */}
      {!isRecording && !isLive && (
        <p className="text-xs text-text-muted mt-3 text-center">
          Start broadcasting first to enable recording
        </p>
      )}
    </div>
  );
}
