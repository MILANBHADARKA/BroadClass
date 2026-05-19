import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { useAuth } from '../context/AuthContext';
import BroadcastButton from '../components/BroadcastButton';
import BroadcastList from '../components/BroadcastList';
import RecordingLibrary from '../components/RecordingLibrary';
import ChatPanel from '../components/ChatPanel';
import TeacherQueuePanel from '../components/TeacherQueuePanel';
import SmartChatSettings from '../components/SmartChatSettings';
import TranscriptPanel from '../components/TranscriptPanel';
import PastLecturesPanel from '../components/PastLecturesPanel';

// System-Manager (port 3000) for APIs and real-time updates
const MANAGER_SERVER = import.meta.env.VITE_MANAGER_URL || 'http://localhost:3000';
// Origin (port 3001) for broadcaster WebRTC signaling
const ORIGIN_SERVER = import.meta.env.VITE_ORIGIN_URL || 'http://localhost:3001';

export default function ClassroomDetail() {
  const { id: classroomId } = useParams();
  const { user, token, isTeacher, API_URL, authFetch } = useAuth();
  const navigate = useNavigate();

  const [classroom, setClassroom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Socket + Device for WebRTC
  const [socket, setSocket] = useState(null);
  const [device, setDevice] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [broadcasts, setBroadcasts] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);

  // Fetch classroom details. Note: we parse the body defensively — some
  // middleware (e.g. rate-limit, helmet) can return a non-JSON body, and
  // calling res.json() on a plain-text body throws a confusing
  // "Unexpected token 'T'…" SyntaxError that leaks straight into the UI.
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/classrooms/${classroomId}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          if (res.status === 429) {
            throw new Error('Too many requests, please slow down and try again in a minute.');
          }
          throw new Error(data?.error || `Failed to load classroom (HTTP ${res.status})`);
        }
        if (!data) throw new Error('Server returned an invalid response.');
        setClassroom(data.classroom);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [classroomId, token, API_URL]);

  // Connect Socket.IO to Origin for WebRTC signaling
  useEffect(() => {
    if (!token) return;

    const newSocket = io(ORIGIN_SERVER, {
      auth: { token },
    });

    newSocket.on('viewerCount', ({ roomId, viewerCount }) => {
      if (roomId !== classroomId) return;
      setBroadcasts((prev) =>
        prev.map((b) => (b.roomId === roomId ? { ...b, viewerCount } : b)),
      );
    });

    newSocket.on('connect', async () => {
      setIsConnected(true);

      try {
        const newDevice = new Device();
        const routerRtpCapabilities = await new Promise((resolve) => {
          newSocket.emit('getRouterRtpCapabilities', resolve);
        });
        await newDevice.load({ routerRtpCapabilities });
        setDevice(newDevice);

        setCurrentServer({
          ip: new URL(ORIGIN_SERVER).hostname,
          port: parseInt(new URL(ORIGIN_SERVER).port || 3001),
          isOrigin: true,
        });

        // Get broadcasts and filter for this classroom
        newSocket.emit('getBroadcasts', (broadcastList) => {
          const filtered = broadcastList.filter((b) => b.roomId === classroomId);
          setBroadcasts(filtered);
        });
      } catch (err) {
        console.error('Error initializing device:', err);
      }
    });

    newSocket.on('disconnect', () => setIsConnected(false));

    newSocket.on('broadcastList', (broadcastList) => {
      const filtered = broadcastList.filter((b) => b.roomId === classroomId);
      setBroadcasts(filtered);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [token, classroomId]);

  /** Get best edge server for this classroom's broadcast */
  const getBestEdgeServer = useCallback(
    async (roomId) => {
      try {
        const response = await authFetch(
          `${API_URL}/api/best-edge?roomId=${roomId}`,
        );

        if (!response.ok) {
          console.warn('Could not get best edge, using origin');
          return currentServer;
        }

        const edgeData = await response.json();
        return {
          ip: edgeData.edgeIp,
          port: edgeData.edgePort,
          serverId: edgeData.serverId,
          rtcCapabilities: edgeData.rtcCapabilities,
          isOrigin: edgeData.isOrigin || false,
          load: edgeData.load,
        };
      } catch (err) {
        console.error('Error getting best edge server:', err);
        return currentServer;
      }
    },
    [token, currentServer, API_URL, authFetch],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 mesh-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-accent flex items-center justify-center glow-accent animate-pulse-glow">
            <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <p className="text-text-muted font-medium">Loading classroom...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-950 mesh-bg flex flex-col items-center justify-center gap-6 px-4">
        <div className="w-20 h-20 rounded-3xl bg-danger-muted flex items-center justify-center">
          <svg className="w-10 h-10 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-text-primary mb-2">Unable to load classroom</h2>
          <p className="text-text-muted max-w-md">{error}</p>
        </div>
        <button 
          onClick={() => navigate('/dashboard')} 
          className="btn-secondary"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to Dashboard
        </button>
      </div>
    );
  }

  const isOwner = classroom?.teacherId === user?.id;
  const studentCount = classroom?._count?.enrollments ?? classroom?.enrollments?.length ?? 0;

  return (
    <div className="min-h-screen bg-surface-950 mesh-bg">
      {/* Top Bar */}
      <nav className="sticky top-0 z-50 glass border-b border-border backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="tap-44 flex items-center gap-2 text-text-muted hover:text-text-primary transition-colors cursor-pointer group flex-shrink-0"
            aria-label="Back to dashboard"
          >
            <div className="w-9 h-9 rounded-lg bg-surface-800 border border-border flex items-center justify-center group-hover:bg-surface-700 group-hover:border-border-hover transition-all">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </div>
            <span className="text-sm font-medium hidden md:block">Dashboard</span>
          </button>

          <div className="h-6 w-px bg-border hidden sm:block" />

          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-accent flex items-center justify-center flex-shrink-0 glow-accent-sm">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-text-primary truncate">{classroom?.name}</h1>
              {classroom?.subject && (
                <p className="text-[11px] sm:text-xs text-text-muted truncate">{classroom.subject}</p>
              )}
            </div>
          </div>

          {/* Connection status pill */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className={`badge text-[10px] sm:text-xs ${isConnected ? 'badge-success' : 'bg-surface-800 text-text-muted border-border'}`}>
              <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse-live' : 'bg-text-muted'}`} />
              <span className="hidden sm:inline">{isConnected ? 'Connected' : 'Offline'}</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Classroom Info */}
        <div className="glass rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8 animate-fade-in glow-accent-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 sm:gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap mb-2 sm:mb-3">
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gradient break-words">
                  {classroom?.name}
                </h1>
                {classroom?.subject && (
                  <span className="badge-accent text-xs">{classroom.subject}</span>
                )}
              </div>
              {classroom?.description && (
                <p className="text-sm sm:text-base text-text-muted max-w-2xl">{classroom.description}</p>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {isOwner && (
                <div className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-warning-muted border border-warning/20">
                  <svg className="w-4 h-4 text-warning flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                  </svg>
                  <span className="text-warning font-mono tracking-[0.15em] text-xs sm:text-sm">{classroom?.code}</span>
                </div>
              )}
              <div className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-surface-800 border border-border">
                <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
                <span className="text-text-secondary text-xs sm:text-sm font-medium whitespace-nowrap">
                  {studentCount} {studentCount === 1 ? 'student' : 'students'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Broadcast Area */}
        <div className="mb-6 sm:mb-8">
          {!device ? (
            <div className="glass rounded-2xl p-10 sm:p-16 flex flex-col items-center justify-center gap-4 animate-fade-in">
              <div className="w-14 h-14 rounded-2xl bg-accent-muted flex items-center justify-center animate-pulse-glow">
                <svg className="w-7 h-7 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-text-primary font-medium mb-1">Initializing media device...</p>
                <p className="text-text-muted text-sm">Setting up WebRTC connection</p>
              </div>
            </div>
          ) : (
            <>
              {/* Teacher: can start broadcast in this classroom */}
              {isTeacher && isOwner && (
                <BroadcastButton
                  socket={socket}
                  device={device}
                  classroomId={classroomId}
                />
              )}

              {/* Everyone: can see/join the broadcast */}
              <BroadcastList
                socket={socket}
                device={device}
                broadcasts={broadcasts}
                onJoinBroadcast={getBestEdgeServer}
                originServer={ORIGIN_SERVER}
                authToken={token}
              />
            </>
          )}
        </div>

        {/* Smart Chat settings — owner-teacher only. Visible all the time
            (not just during a live broadcast) so the teacher can preconfigure
            before going live. */}
        {isOwner && classroom && (
          <div className="mb-4 sm:mb-6">
            <SmartChatSettings
              classroom={classroom}
              onChange={(patch) => setClassroom((c) => ({ ...c, ...patch }))}
            />
          </div>
        )}

        {/* Phase 8: derive the current lecture session id from the active
            broadcast. When the teacher starts a new lecture in the same
            classroom, this flips to a new id and all session-scoped panels
            reset (chat, transcript, queue).

            Layout: on desktop, queue (teacher) and chat sit side-by-side in a
            2-column grid; on mobile they stack. Transcript spans full width. */}
        {(() => {
          const currentSessionId = broadcasts[0]?.sessionId || null;
          if (!currentSessionId) return null;

          return (
            <>
              {classroom?.transcriptionEnabled !== false && (
                <div className="mb-4 sm:mb-6">
                  <TranscriptPanel sessionId={currentSessionId} />
                </div>
              )}

              <div className={`mb-6 sm:mb-8 grid gap-4 sm:gap-6 ${isOwner ? 'lg:grid-cols-5' : ''}`}>
                {isOwner && (
                  <div className="lg:col-span-2">
                    <TeacherQueuePanel sessionId={currentSessionId} enabled={isOwner} />
                  </div>
                )}
                <div className={isOwner ? 'lg:col-span-3' : ''}>
                  <ChatPanel sessionId={currentSessionId} />
                </div>
              </div>
            </>
          );
        })()}

        {/* Past Lectures — read-only archive of every BroadcastSession in
            this classroom. Refreshes when the active broadcast list changes
            so a freshly-ended lecture appears without manual reload. */}
        <div className="mb-4 sm:mb-6">
          <PastLecturesPanel
            classroomId={classroomId}
            isOwner={isOwner}
            refreshKey={broadcasts.length}
          />
        </div>

        {/* Recording Library */}
        <div className="mb-6 sm:mb-8">
          <RecordingLibrary
            classroomId={classroomId}
            userRole={isTeacher ? 'teacher' : 'student'}
          />
        </div>

        {/* Enrolled Students */}
        {isOwner && classroom?.enrollments?.length > 0 && (
          <div className="glass rounded-2xl p-4 sm:p-6 animate-fade-in">
            <div className="flex items-center gap-3 mb-4 sm:mb-6">
              <div className="w-10 h-10 rounded-xl bg-secondary-muted flex items-center justify-center">
                <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">Enrolled Students</h3>
                <p className="text-sm text-text-muted">{classroom.enrollments.length} students in this class</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {classroom.enrollments.map((e, i) => (
                <div 
                  key={e.id} 
                  className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl bg-surface-800 border border-border hover:border-border-hover transition-all animate-fade-in"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-accent flex items-center justify-center text-sm font-bold text-white">
                    {(e.student?.name || 'S')[0].toUpperCase()}
                  </div>
                  <span className="text-sm text-text-primary font-medium">{e.student?.name || 'Student'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
