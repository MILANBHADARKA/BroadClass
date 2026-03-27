import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'STUDENT',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      return setError('Passwords do not match');
    }
    if (form.password.length < 6) {
      return setError('Password must be at least 6 characters');
    }
    if (!/[A-Z]/.test(form.password)) {
      return setError('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(form.password)) {
      return setError('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(form.password)) {
      return setError('Password must contain at least one number');
    }

    setLoading(true);
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
      });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-xl bg-surface-800 border border-border text-text-primary placeholder-text-muted text-sm outline-none transition-all focus:border-accent/50 focus:ring-2 focus:ring-accent/10';

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-900 mesh-bg px-4 py-8">
      {/* Decorative orbs */}
      <div className="fixed top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-500/5 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-15%] left-[-10%] w-[400px] h-[400px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-md animate-fade-in">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-2xl font-bold text-gradient">BroadClass</span>
          </div>
          <p className="text-text-muted text-sm">Create your account</p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-8 glow-accent-sm">
          <h1 className="text-xl font-bold text-text-primary mb-1">Get started</h1>
          <p className="text-text-muted text-sm mb-6">Join as a teacher or student</p>
          <p className="text-red-600 text-sm mb-6">NOTE: Right now backend instaces are stopped, so if you want to test system then please contact admins.</p>

          {error && (
            <div className="bg-danger-muted border border-danger/30 text-red-300 px-4 py-3 rounded-xl text-sm mb-5 animate-fade-in">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
                Full Name
              </label>
              <input id="name" type="text" placeholder="Enter Your Name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} />
            </div>

            <div>
              <label htmlFor="email" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
                Email
              </label>
              <input id="email" type="email" placeholder="Enter Your Email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} required className={inputClass} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="password" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
                  Password
                </label>
                <input id="password" type="password" placeholder="Min 6 chars, A-z, 0-9" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} required className={inputClass} />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
                  Confirm
                </label>
                <input id="confirmPassword" type="password" placeholder="Re-enter" value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required className={inputClass} />
              </div>
            </div>

            {/* Role selector */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-2 uppercase tracking-wider">
                I am a
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, role: 'STUDENT' })}
                  className={`relative py-3 px-4 rounded-xl border text-sm font-semibold transition-all cursor-pointer
                    ${form.role === 'STUDENT'
                      ? 'bg-accent/10 border-accent/40 text-accent glow-accent-sm'
                      : 'bg-surface-800 border-border text-text-secondary hover:border-border-hover'
                    }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                    </svg>
                    Student
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, role: 'TEACHER' })}
                  className={`relative py-3 px-4 rounded-xl border text-sm font-semibold transition-all cursor-pointer
                    ${form.role === 'TEACHER'
                      ? 'bg-accent/10 border-accent/40 text-accent glow-accent-sm'
                      : 'bg-surface-800 border-border text-text-secondary hover:border-border-hover'
                    }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                    </svg>
                    Teacher
                  </div>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-accent text-surface-900 font-semibold text-sm cursor-pointer transition-all hover:bg-accent-light hover:glow-accent disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Creating account...
                </span>
              ) : 'Create Account'}
            </button>
          </form>

          <p className="text-center mt-6 text-text-muted text-sm">
            Already have an account?{' '}
            <Link to="/login" className="text-accent font-semibold hover:text-accent-light transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
