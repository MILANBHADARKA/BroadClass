import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function RecordingLibrary({ classroomId, userRole = 'STUDENT' }) {
  const { API_URL, authFetch } = useAuth();
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [editingAccessId, setEditingAccessId] = useState(null);
  const [accessUpdating, setAccessUpdating] = useState(false);

  // Fetch recordings on mount or when classroomId changes
  useEffect(() => {
    if (!classroomId) return;

    const fetchRecordings = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await authFetch(
          `${API_URL}/api/recordings/classrooms/${classroomId}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch recordings');
        }

        const data = await response.json();
        setRecordings(data.recordings || []);
      } catch (err) {
        setError(err.message);
        console.error('Error fetching recordings:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRecordings();

    // Refresh every 30 seconds for new recordings
    const interval = setInterval(fetchRecordings, 30000);
    return () => clearInterval(interval);
  }, [classroomId, API_URL, authFetch]);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const downloadRecording = async (recordingId, title) => {
    setDownloadingId(recordingId);
    setError(null);

    try {
      const response = await authFetch(
        `${API_URL}/api/recordings/${recordingId}/download`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate download link');
      }

      const data = await response.json();

      // Open download link in new tab
      window.open(data.presignedUrl, '_blank');
    } catch (err) {
      setError(err.message);
      console.error('Error downloading recording:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  const updateAccessType = async (recordingId, newAccessType) => {
    setAccessUpdating(true);
    setError(null);

    try {
      const response = await authFetch(
        `${API_URL}/api/recordings/${recordingId}/accessibility`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessType: newAccessType }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update access');
      }

      // Update local state
      setRecordings(prev =>
        prev.map(r =>
          r.id === recordingId ? { ...r, accessType: newAccessType } : r
        )
      );
      setEditingAccessId(null);
    } catch (err) {
      setError(err.message);
      console.error('Error updating access type:', err);
    } finally {
      setAccessUpdating(false);
    }
  };

  const getStatusConfig = (status) => {
    const configs = {
      RECORDING: { 
        className: 'badge-warning', 
        icon: (
          <svg className="w-3.5 h-3.5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
          </svg>
        ),
        label: 'Recording' 
      },
      PROCESSING: {
        className: 'badge bg-secondary-muted text-secondary border-secondary/20',
        icon: (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ),
        label: 'Processing',
      },
      READY: { 
        className: 'badge-success', 
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ),
        label: 'Ready' 
      },
      FAILED: { 
        className: 'badge-danger', 
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ),
        label: 'Failed' 
      },
      ARCHIVED: { 
        className: 'badge bg-surface-700 text-text-muted border-border', 
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        ),
        label: 'Archived' 
      },
    };
    return configs[status] || configs.ARCHIVED;
  };

  const getAccessConfig = (accessType) => {
    const configs = {
      PRIVATE: {
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        ),
        label: 'Private',
        description: 'Only you can access',
        className: 'badge bg-surface-700 text-text-muted border-border',
      },
      CLASSROOM: {
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        ),
        label: 'Classroom',
        description: 'All enrolled students',
        className: 'badge-accent',
      },
      PUBLIC: {
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12.75 3.03v.568c0 .334.148.65.405.864l1.068.89c.442.369.535 1.01.216 1.49l-.51.766a2.25 2.25 0 01-1.161.886l-.143.048a1.107 1.107 0 00-.57 1.664c.369.555.169 1.307-.427 1.605L9 13.125l.423 1.059a.956.956 0 01-1.652.928l-.679-.906a1.125 1.125 0 00-1.906.172L4.5 15.75l-.612.153M12.75 3.031a9 9 0 00-8.862 12.872M12.75 3.031a9 9 0 016.69 14.036m0 0l-.177-.529A2.25 2.25 0 0017.128 15H16.5l-.324-.324a1.453 1.453 0 00-2.328.377l-.036.073a1.586 1.586 0 01-.982.816l-.99.282c-.55.157-.894.702-.8 1.267l.073.438c.08.474.49.821.97.821.846 0 1.598.542 1.865 1.345l.215.643m5.276-3.67a9.012 9.012 0 01-5.276 3.67m0 0a9 9 0 01-10.275-4.835M15.75 9h-.008v.008h.008V9z" />
          </svg>
        ),
        label: 'Public',
        description: 'Anyone with link',
        className: 'badge-success',
      },
    };
    return configs[accessType] || configs.PRIVATE;
  };

  if (loading) {
    return (
      <div className="glass rounded-2xl p-12 text-center">
        <div className="w-12 h-12 rounded-xl bg-accent-muted flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
          <svg className="w-6 h-6 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <p className="text-text-muted font-medium">Loading recordings...</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m1.5-3.75C5.496 8.25 6 7.746 6 7.125v-1.5M4.875 8.25C5.496 8.25 6 8.754 6 9.375v1.5m0-5.25v5.25m0-5.25C6 5.004 6.504 4.5 7.125 4.5h9.75c.621 0 1.125.504 1.125 1.125m1.125 2.625h1.5m-1.5 0A1.125 1.125 0 0118 7.125v-1.5m1.125 2.625c-.621 0-1.125.504-1.125 1.125v1.5m2.625-2.625c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M18 5.625v5.25M7.125 12h9.75m-9.75 0A1.125 1.125 0 016 10.875M7.125 12C6.504 12 6 12.504 6 13.125m0-2.25C6 11.496 5.496 12 4.875 12M18 10.875c0 .621-.504 1.125-1.125 1.125M18 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m-12 5.25v-5.25m0 5.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125m-12 0v-1.5c0-.621-.504-1.125-1.125-1.125M18 18.375v-5.25m0 5.25v-1.5c0-.621.504-1.125 1.125-1.125M18 13.125v1.5c0 .621.504 1.125 1.125 1.125M18 13.125c0-.621.504-1.125 1.125-1.125M6 13.125v1.5c0 .621-.504 1.125-1.125 1.125M6 13.125C6 12.504 5.496 12 4.875 12m-1.5 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Recording Library</h3>
            <p className="text-sm text-text-muted">{recordings.length} recording{recordings.length !== 1 ? 's' : ''} available</p>
          </div>
        </div>
        {recordings.length > 0 && (
          <span className="badge-accent font-semibold">{recordings.length}</span>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-danger-muted border border-danger/30 text-red-300 text-sm mb-4">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* Empty State */}
      {recordings.length === 0 ? (
        <div className="py-12 text-center">
          <div className="w-20 h-20 rounded-3xl bg-surface-800 border border-border flex items-center justify-center mx-auto mb-6 animate-float">
            <svg className="w-10 h-10 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h4 className="text-lg font-semibold text-text-primary mb-2">No recordings yet</h4>
          <p className="text-text-muted text-sm max-w-sm mx-auto">
            {userRole === 'TEACHER'
              ? 'Start a broadcast and click "Start Recording" to save your session'
              : 'Recordings will appear here when your teacher records a broadcast'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {recordings.map((recording, i) => {
            const statusConfig = getStatusConfig(recording.status);
            const accessConfig = getAccessConfig(recording.accessType);
            const isEditing = editingAccessId === recording.id;

            return (
              <div
                key={recording.id}
                className="group p-4 rounded-xl bg-surface-800/50 border border-border hover:border-accent/30 hover:bg-surface-700/50 transition-all animate-fade-in"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="flex items-start gap-4">
                  {/* Thumbnail placeholder */}
                  <div className="w-24 h-16 rounded-lg bg-surface-700 border border-border flex items-center justify-center flex-shrink-0 overflow-hidden group-hover:border-accent/20 transition-colors">
                    <svg className="w-8 h-8 text-text-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h4 className="font-semibold text-text-primary truncate">
                        {recording.title}
                      </h4>
                      <span className={statusConfig.className}>
                        {statusConfig.icon}
                        {statusConfig.label}
                      </span>
                      {/* Access Type Badge (Teacher Only) */}
                      {userRole === 'TEACHER' && (
                        <div>
                          <button
                            onClick={() => setEditingAccessId(isEditing ? null : recording.id)}
                            type="button"
                            className={`${accessConfig.className} cursor-pointer hover:opacity-80 transition-opacity`}
                            title="Click to change access"
                          >
                            {accessConfig.icon}
                            {accessConfig.label}
                            <svg className={`w-3 h-3 ml-1 transition-transform ${isEditing ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-muted">
                      <span className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                        </svg>
                        {formatDate(recording.recordingStarted)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {formatDuration(recording.duration)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                        </svg>
                        {formatSize(parseInt(recording.fileSize))}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex-shrink-0">
                    {recording.status === 'READY' && (
                      <button
                        onClick={() => downloadRecording(recording.id, recording.title)}
                        disabled={downloadingId === recording.id}
                        className="btn-primary py-2 px-4 text-sm"
                      >
                        {downloadingId === recording.id ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Opening...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </>
                        )}
                      </button>
                    )}

                    {recording.status === 'PROCESSING' && (
                      <div className="badge bg-secondary-muted text-secondary border-secondary/20 py-2 px-3">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Processing
                      </div>
                    )}

                    {recording.status === 'RECORDING' && (
                      <div className="badge-danger py-2 px-3 animate-pulse">
                        <span className="w-2 h-2 rounded-full bg-red-400" />
                        Recording
                      </div>
                    )}

                    {recording.status === 'FAILED' && (
                      <div className="badge-danger py-2 px-3">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Failed
                      </div>
                    )}
                  </div>
                </div>

                {/* Expanded Access Options (Teacher Only) */}
                {userRole === 'TEACHER' && isEditing && (
                  <div className="mt-3 p-3 rounded-xl bg-surface-900 border border-border">
                    <p className="text-xs text-text-muted px-2 py-1 mb-2">Change recording access:</p>
                    <div className="grid grid-cols-3 gap-2">
                      {['PRIVATE', 'CLASSROOM', 'PUBLIC'].map((type) => {
                        const config = getAccessConfig(type);
                        const isActive = recording.accessType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              updateAccessType(recording.id, type);
                            }}
                            disabled={accessUpdating}
                            className={`flex flex-col items-center gap-2 p-3 rounded-lg transition-all cursor-pointer ${
                              isActive 
                                ? 'bg-accent/20 border border-accent/30' 
                                : 'hover:bg-surface-700 border border-transparent'
                            } ${accessUpdating ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <div className={`w-10 h-10 rounded-lg ${isActive ? 'bg-accent/30 text-accent' : 'bg-surface-700 text-text-muted'} flex items-center justify-center`}>
                              {config.icon}
                            </div>
                            <div className="text-center">
                              <p className={`text-sm font-medium ${isActive ? 'text-accent' : 'text-text-primary'}`}>
                                {config.label}
                              </p>
                              <p className="text-xs text-text-muted">{config.description}</p>
                            </div>
                            {isActive && (
                              <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Note for non-ready recordings */}
      {recordings.some((r) => r.status !== 'READY' && r.status !== 'FAILED') && (
        <div className="flex items-start gap-3 mt-4 p-4 rounded-xl bg-secondary-muted border border-secondary/20 text-secondary text-sm">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p>
            Recording files are automatically uploaded to cloud storage. Downloads will be available once processing is complete.
          </p>
        </div>
      )}
    </div>
  );
}
