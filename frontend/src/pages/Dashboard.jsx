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

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-950 mesh-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-accent flex items-center justify-center glow-accent animate-pulse-glow">
              <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          </div>
          <p className="text-text-muted font-medium">Loading classrooms...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-950 mesh-bg">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 glass border-b border-border backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-accent flex items-center justify-center glow-accent-sm">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gradient hidden sm:block">BroadClass</span>
          </div>

          {/* User menu */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-surface-800/50 border border-border">
              <div className="w-8 h-8 rounded-full bg-gradient-accent flex items-center justify-center text-sm font-bold text-white">
                {user?.name?.[0]?.toUpperCase()}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-text-primary leading-tight">{user?.name}</p>
                <p className="text-xs text-text-muted capitalize">{user?.role?.toLowerCase()}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="btn-icon"
              title="Sign Out"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Alerts */}
        {error && (
          <div className="flex items-center gap-3 bg-danger-muted border border-danger/30 text-red-300 px-4 py-3 rounded-xl text-sm mb-6 animate-scale-in">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-300 cursor-pointer">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {joinMsg && (
          <div className="flex items-center gap-3 bg-success-muted border border-success/30 text-green-300 px-4 py-3 rounded-xl text-sm mb-6 animate-scale-in">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="flex-1">{joinMsg}</span>
            <button onClick={() => setJoinMsg('')} className="text-green-400 hover:text-green-300 cursor-pointer">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Page header + action */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold text-text-primary mb-2">
              {isTeacher ? 'Your Classrooms' : 'My Classes'}
            </h1>
            <p className="text-text-muted">
              {isTeacher
                ? `Manage your ${classrooms.length} classroom${classrooms.length !== 1 ? 's' : ''}`
                : `Enrolled in ${classrooms.length} classroom${classrooms.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {/* Teacher: toggle create */}
          {isTeacher && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className={showCreate ? 'btn-secondary' : 'btn-primary'}
            >
              {showCreate ? (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Cancel
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  New Classroom
                </>
              )}
            </button>
          )}

          {/* Student: join form */}
          {!isTeacher && (
            <form onSubmit={handleJoin} className="flex gap-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  required
                  className="w-36 px-4 py-3 rounded-xl bg-surface-800 border border-border text-text-primary placeholder-text-muted text-sm font-mono tracking-[0.3em] text-center outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 uppercase"
                />
              </div>
              <button type="submit" className="btn-primary">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                Join
              </button>
            </form>
          )}
        </div>

        {/* Teacher: create form */}
        {isTeacher && showCreate && (
          <div className="glass rounded-2xl p-6 mb-8 animate-scale-in glow-accent-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">Create New Classroom</h3>
                <p className="text-sm text-text-muted">Add a new classroom for your students</p>
              </div>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Name *</label>
                  <input 
                    type="text" 
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} 
                    required 
                    className="input" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Subject</label>
                  <input 
                    type="text" 
                    value={createForm.subject}
                    onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })} 
                    className="input" 
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-sm font-medium text-text-secondary mb-2">Description</label>
                  <input 
                    type="text" 
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} 
                    className="input" 
                  />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button type="submit" className="btn-primary">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Create Classroom
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Classrooms Grid */}
        {classrooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
            <div className="w-24 h-24 rounded-3xl bg-surface-800 border border-border flex items-center justify-center mb-6 animate-float">
              <svg className="w-12 h-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-text-primary mb-2">No classrooms yet</h3>
            <p className="text-text-muted text-center max-w-sm">
              {isTeacher 
                ? 'Create your first classroom to start teaching' 
                : 'Join a classroom with a code from your teacher to get started'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {classrooms.map((c, i) => (
              <div
                key={c.id}
                onClick={() => navigate(`/classroom/${c.id}`)}
                className="group card card-hover cursor-pointer animate-fade-in-up"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {/* Card header with gradient accent */}
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-accent flex items-center justify-center flex-shrink-0 shadow-lg group-hover:glow-accent transition-all">
                    <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-text-primary truncate group-hover:text-gradient-subtle transition-all">
                      {c.name}
                    </h3>
                    {c.subject && (
                      <span className="badge-accent mt-1">{c.subject}</span>
                    )}
                  </div>
                </div>

                {c.description && (
                  <p className="text-text-muted text-sm line-clamp-2 mb-4">{c.description}</p>
                )}

                {/* Card footer */}
                <div className="flex items-center justify-between pt-4 border-t border-border mt-auto">
                  <div className="flex items-center gap-3">
                    {isTeacher && (
                      <span className="badge-warning font-mono tracking-wider">
                        {c.code}
                      </span>
                    )}
                    {!isTeacher && c.teacher && (
                      <span className="text-text-muted text-sm flex items-center gap-1.5">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                        </svg>
                        {c.teacher.name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-text-muted text-sm">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                      </svg>
                      {c._count?.enrollments ?? 0}
                    </span>

                    <div onClick={(e) => e.stopPropagation()}>
                      {isTeacher ? (
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="p-2 rounded-lg text-danger/60 hover:bg-danger-muted hover:text-danger transition-all cursor-pointer"
                          title="Delete classroom"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleLeave(c.id)}
                          className="p-2 rounded-lg text-danger/60 hover:bg-danger-muted hover:text-danger transition-all cursor-pointer"
                          title="Leave classroom"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                          </svg>
                        </button>
                      )}
                    </div>
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
