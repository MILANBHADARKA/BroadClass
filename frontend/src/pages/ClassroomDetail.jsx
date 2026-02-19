import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { useAuth } from '../context/AuthContext';
import BroadcastButton from '../components/BroadcastButton';
import BroadcastList from '../components/BroadcastList';

const ORIGIN_SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

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

  // Fetch classroom details
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/classrooms/${classroomId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setClassroom(data.classroom);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [classroomId, token, API_URL]);

  // Connect Socket.IO with auth token
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
          `${ORIGIN_SERVER}/api/best-server?roomId=${roomId}`,
        );

        if (!response.ok) {
          console.warn('Could not get best edge, using origin');
          return currentServer;
        }

        const edgeData = await response.json();
        return {
          ip: edgeData.edgeIp,
          port: edgeData.edgePort,
          rtcCapabilities: edgeData.rtcCapabilities,
          isOrigin: edgeData.isOrigin || false,
          load: edgeData.load,
        };
      } catch (err) {
        console.error('Error getting best edge server:', err);
        return currentServer;
      }
    },
    [token, currentServer],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 mesh-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-text-muted">
          <svg className="animate-spin w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Loading classroom...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-surface-900 mesh-bg flex flex-col items-center justify-center gap-4 px-4">
        <div className="bg-danger-muted border border-danger/30 text-red-300 px-6 py-4 rounded-xl text-sm max-w-md text-center">
          {error}
        </div>
        <button onClick={() => navigate('/dashboard')} className="px-5 py-2.5 rounded-xl bg-surface-800 border border-border text-text-secondary text-sm hover:bg-surface-700 transition-all cursor-pointer">
          &larr; Back to Dashboard
        </button>
      </div>
    );
  }

  const isOwner = classroom?.teacherId === user?.id;
  const studentCount = classroom?._count?.enrollments ?? classroom?.enrollments?.length ?? 0;

  return (
    <div className="min-h-screen bg-surface-900 mesh-bg">
      {/* ── Top Bar ───────────────────────────── */}
      <nav className="sticky top-0 z-50 glass border-b border-border backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-4">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1.5 text-text-muted hover:text-text-primary text-sm transition-colors cursor-pointer">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
            Dashboard
          </button>
          <div className="h-5 w-px bg-border" />
          <span className="text-sm font-semibold text-text-primary truncate">{classroom?.name}</span>

          {/* Connection status pill */}
          <div className="ml-auto flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${isConnected ? 'bg-success-muted text-green-400' : 'bg-surface-800 text-text-muted'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse-live' : 'bg-text-muted'}`} />
              {isConnected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* ── Classroom Info ──────────────────── */}
        <div className="glass rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-text-primary">{classroom?.name}</h1>
                {classroom?.subject && (
                  <span className="px-3 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-medium">
                    {classroom.subject}
                  </span>
                )}
              </div>
              {classroom?.description && (
                <p className="text-text-muted text-sm mt-2 max-w-2xl">{classroom.description}</p>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0 flex-wrap">
              {isOwner && (
                <span className="px-3 py-1.5 rounded-lg bg-warning-muted text-warning text-xs font-mono tracking-wider border border-warning/20">
                  {classroom?.code}
                </span>
              )}
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-800 border border-border text-text-secondary text-xs">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
                {studentCount} student{studentCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* ── Broadcast Area ─────────────────── */}
        <div className="mb-8">
          {!device ? (
            <div className="glass rounded-2xl p-12 flex flex-col items-center justify-center gap-3 animate-fade-in">
              <svg className="animate-spin w-6 h-6 text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              <p className="text-text-muted text-sm">Initializing media device...</p>
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

        {/* ── Enrolled Students ──────────────── */}
        {isOwner && classroom?.enrollments?.length > 0 && (
          <div className="glass rounded-2xl p-6 animate-fade-in">
            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
              Enrolled Students ({classroom.enrollments.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {classroom.enrollments.map((e) => (
                <div key={e.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-800 border border-border text-sm text-text-primary">
                  <div className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center text-[10px] font-bold text-accent uppercase">
                    {(e.student?.name || 'S')[0]}
                  </div>
                  {e.student?.name || 'Student'}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
