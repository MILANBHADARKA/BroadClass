import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { user, token, logout, isTeacher, API_URL, authFetch } = useAuth();
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create classroom state (teacher)
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', subject: '' });

  // Join classroom state (student)
  const [joinCode, setJoinCode] = useState('');
  const [joinMsg, setJoinMsg] = useState('');

  const fetchClassrooms = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/classrooms`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setClassrooms(data.classrooms);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [API_URL, authFetch]);

  useEffect(() => {
    fetchClassrooms();
  }, [fetchClassrooms]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await authFetch(`${API_URL}/api/classrooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setClassrooms((prev) => [data.classroom, ...prev]);
      setCreateForm({ name: '', description: '', subject: '' });
      setShowCreate(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    setError('');
    setJoinMsg('');
    try {
      const res = await authFetch(`${API_URL}/api/classrooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: joinCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJoinMsg(data.message);
      setJoinCode('');
      fetchClassrooms();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (classroomId) => {
    if (!confirm('Delete this classroom? All enrollments will be removed.')) return;
    try {
      const res = await authFetch(`${API_URL}/api/classrooms/${classroomId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setClassrooms((prev) => prev.filter((c) => c.id !== classroomId));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLeave = async (classroomId) => {
    if (!confirm('Leave this classroom?')) return;
    try {
      const res = await authFetch(`${API_URL}/api/classrooms/${classroomId}/leave`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setClassrooms((prev) => prev.filter((c) => c.id !== classroomId));
    } catch (err) {
      setError(err.message);
    }
  };

  const inputClass =
    'w-full px-4 py-2.5 rounded-xl bg-surface-800 border border-border text-text-primary placeholder-text-muted text-sm outline-none transition-all focus:border-accent/50 focus:ring-2 focus:ring-accent/10';

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 mesh-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-text-muted">
          <svg className="animate-spin w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          Loading classrooms...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-900 mesh-bg">
      {/* ── Navbar ───────────────────────────────── */}
      <nav className="sticky top-0 z-50 glass border-b border-border backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-lg font-bold text-gradient hidden sm:block">BroadClass</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-xs font-bold text-accent uppercase">
                {user?.name?.[0]}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-text-primary leading-tight">{user?.name}</p>
                <p className="text-xs text-text-muted">{user?.role?.toLowerCase()}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="px-3 py-1.5 rounded-lg border border-border text-text-secondary text-sm hover:bg-surface-700 hover:text-text-primary transition-all cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main Content ────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Alerts */}
        {error && (
          <div className="bg-danger-muted border border-danger/30 text-red-300 px-4 py-3 rounded-xl text-sm mb-6 animate-fade-in flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 ml-4 cursor-pointer">&times;</button>
          </div>
        )}
        {joinMsg && (
          <div className="bg-success-muted border border-success/30 text-green-300 px-4 py-3 rounded-xl text-sm mb-6 animate-fade-in flex items-center justify-between">
            <span>{joinMsg}</span>
            <button onClick={() => setJoinMsg('')} className="text-green-400 hover:text-green-300 ml-4 cursor-pointer">&times;</button>
          </div>
        )}

        {/* Page header + action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              {isTeacher ? 'Your Classrooms' : 'My Classes'}
            </h1>
            <p className="text-text-muted text-sm mt-1">
              {isTeacher
                ? `${classrooms.length} classroom${classrooms.length !== 1 ? 's' : ''} created`
                : `${classrooms.length} classroom${classrooms.length !== 1 ? 's' : ''} enrolled`}
            </p>
          </div>

          {/* Teacher: toggle create */}
          {isTeacher && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer
                ${showCreate
                  ? 'bg-surface-700 border border-border text-text-secondary'
                  : 'bg-accent text-surface-900 hover:bg-accent-light glow-accent-sm'
                }`}
            >
              {showCreate ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  Cancel
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  New Classroom
                </>
              )}
            </button>
          )}

          {/* Student: join form */}
          {!isTeacher && (
            <form onSubmit={handleJoin} className="flex gap-2">
              <input
                type="text"
                placeholder="Enter code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                maxLength={6}
                required
                className="w-32 px-3 py-2.5 rounded-xl bg-surface-800 border border-border text-text-primary placeholder-text-muted text-sm font-mono tracking-widest text-center outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 uppercase"
              />
              <button type="submit" className="px-5 py-2.5 rounded-xl bg-accent text-surface-900 font-semibold text-sm hover:bg-accent-light glow-accent-sm transition-all cursor-pointer">
                Join
              </button>
            </form>
          )}
        </div>

        {/* Teacher: create form */}
        {isTeacher && showCreate && (
          <div className="glass rounded-2xl p-6 mb-8 animate-fade-in glow-accent-sm">
            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Create Classroom</h3>
            <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <input type="text" placeholder="Classroom name *" value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required className={inputClass} />
              <input type="text" placeholder="Subject (optional)" value={createForm.subject}
                onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })} className={inputClass} />
              <input type="text" placeholder="Description (optional)" value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} className={inputClass} />
              <div className="sm:col-span-3 flex justify-end">
                <button type="submit" className="px-6 py-2.5 rounded-xl bg-accent text-surface-900 font-semibold text-sm hover:bg-accent-light transition-all cursor-pointer">
                  Create
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Classrooms Grid ───────────────────── */}
        {classrooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
            <div className="w-20 h-20 rounded-2xl bg-surface-800 border border-border flex items-center justify-center mb-6">
              <svg className="w-10 h-10 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <p className="text-text-muted text-lg font-medium">No classrooms yet</p>
            <p className="text-text-muted/60 text-sm mt-1">
              {isTeacher ? 'Create your first classroom to get started' : 'Join a classroom with a code from your teacher'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {classrooms.map((c, i) => (
              <div
                key={c.id}
                onClick={() => navigate(`/classroom/${c.id}`)}
                className="group glass rounded-2xl p-5 cursor-pointer transition-all hover:glass-hover hover:glow-accent-sm hover:-translate-y-0.5 animate-fade-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-text-primary truncate group-hover:text-accent transition-colors">
                      {c.name}
                    </h3>
                    {c.subject && (
                      <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-medium">
                        {c.subject}
                      </span>
                    )}
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-accent/5 border border-accent/10 flex items-center justify-center shrink-0 ml-3 group-hover:bg-accent/10 transition-colors">
                    <svg className="w-5 h-5 text-accent/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                    </svg>
                  </div>
                </div>

                {c.description && (
                  <p className="text-text-muted text-sm line-clamp-2 mb-4">{c.description}</p>
                )}

                {/* Card footer */}
                <div className="flex items-center justify-between pt-3 border-t border-border">
                  <div className="flex items-center gap-3">
                    {isTeacher && (
                      <span className="px-2 py-1 rounded-md bg-warning-muted text-warning text-xs font-mono tracking-wider">
                        {c.code}
                      </span>
                    )}
                    {!isTeacher && c.teacher && (
                      <span className="text-text-muted text-xs">by {c.teacher.name}</span>
                    )}
                    <span className="flex items-center gap-1 text-text-muted text-xs">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                      </svg>
                      {c._count?.enrollments ?? 0}
                    </span>
                  </div>

                  <div onClick={(e) => e.stopPropagation()}>
                    {isTeacher ? (
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="px-2.5 py-1 rounded-lg text-xs text-danger/70 hover:bg-danger-muted hover:text-danger transition-all cursor-pointer"
                      >
                        Delete
                      </button>
                    ) : (
                      <button
                        onClick={() => handleLeave(c.id)}
                        className="px-2.5 py-1 rounded-lg text-xs text-danger/70 hover:bg-danger-muted hover:text-danger transition-all cursor-pointer"
                      >
                        Leave
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
