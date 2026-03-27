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
  const [showPassword, setShowPassword] = useState(false);

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

  return (
    <div className="min-h-screen flex bg-surface-950 mesh-bg">
      {/* Left side - Branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Animated gradient orbs */}
        <div className="absolute top-1/3 right-1/4 w-96 h-96 rounded-full bg-secondary/20 blur-[100px] animate-float" />
        <div className="absolute bottom-1/3 left-1/4 w-80 h-80 rounded-full bg-accent/20 blur-[100px] animate-float" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-1/2 right-1/3 w-64 h-64 rounded-full bg-accent/10 blur-[80px] animate-float" style={{ animationDelay: '0.5s' }} />
        
        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-16 xl:px-24">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-12">
            <div className="w-14 h-14 rounded-2xl bg-gradient-accent flex items-center justify-center shadow-lg glow-accent">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-3xl font-bold text-gradient">BroadClass</span>
          </div>
          
          <h1 className="text-5xl xl:text-6xl font-bold text-text-primary leading-tight mb-6">
            Start your
            <span className="block text-gradient">learning journey</span>
          </h1>
          
          <p className="text-xl text-text-secondary max-w-md leading-relaxed mb-12">
            Join many teachers and students in our interactive virtual classroom platform.
          </p>
        </div>
      </div>
      
      {/* Right side - Register Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-8">
        {/* Decorative orbs for mobile */}
        <div className="lg:hidden fixed top-[-15%] right-[-10%] w-[350px] h-[350px] rounded-full bg-secondary/10 blur-[100px] pointer-events-none" />
        <div className="lg:hidden fixed bottom-[-15%] left-[-10%] w-[300px] h-[300px] rounded-full bg-accent/10 blur-[100px] pointer-events-none" />
        
        <div className="relative w-full max-w-md animate-fade-in-up">
          {/* Mobile brand (hidden on desktop) */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-accent flex items-center justify-center shadow-lg glow-accent-sm">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-2xl font-bold text-gradient">BroadClass</span>
            </div>
          </div>

          {/* Card */}
          <div className="glass rounded-3xl p-8 lg:p-10 glow-accent-sm">
            <div className="mb-6">
              <h1 className="text-2xl lg:text-3xl font-bold text-text-primary mb-2">Create account</h1>
              <p className="text-text-muted">Join as a teacher or student</p>
            </div>

            {error && (
              <div className="flex items-center gap-3 bg-danger-muted border border-danger/30 text-red-300 px-4 py-3 rounded-xl text-sm mb-5 animate-scale-in">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Full Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-2">
                  Full Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <input 
                    id="name" 
                    type="text" 
                    placeholder="Name" 
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })} 
                    required 
                    className="input pl-12" 
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-text-secondary mb-2">
                  Email address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input 
                    id="email" 
                    type="email" 
                    placeholder="you@example.com" 
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })} 
                    required 
                    className="input pl-12" 
                  />
                </div>
              </div>

              {/* Password fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-text-secondary mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <input 
                      id="password" 
                      type={showPassword ? 'text' : 'password'} 
                      placeholder="Min 6 chars" 
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })} 
                      required 
                      className="input pl-12" 
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-secondary mb-2">
                    Confirm
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <input 
                      id="confirmPassword" 
                      type={showPassword ? 'text' : 'password'} 
                      placeholder="Re-enter" 
                      value={form.confirmPassword}
                      onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} 
                      required 
                      className="input pl-12" 
                    />
                  </div>
                </div>
              </div>
              
              {/* Show password toggle */}
              <label className="flex items-center gap-2 cursor-pointer text-sm text-text-muted hover:text-text-secondary transition-colors">
                <input 
                  type="checkbox" 
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="w-4 h-4 rounded border-border bg-surface-800 text-accent focus:ring-accent/20 cursor-pointer"
                />
                Show passwords
              </label>

              {/* Role selector */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-3">
                  I am a
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, role: 'STUDENT' })}
                    className={`relative py-4 px-4 rounded-xl border text-sm font-semibold transition-all cursor-pointer group
                      ${form.role === 'STUDENT'
                        ? 'bg-accent-muted border-accent/40 text-accent glow-accent-sm'
                        : 'bg-surface-800 border-border text-text-secondary hover:border-border-hover hover:bg-surface-700'
                      }`}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${form.role === 'STUDENT' ? 'bg-accent/20' : 'bg-surface-700 group-hover:bg-surface-600'}`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                        </svg>
                      </div>
                      <span>Student</span>
                    </div>
                    {form.role === 'STUDENT' && (
                      <div className="absolute top-2 right-2">
                        <svg className="w-5 h-5 text-accent" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, role: 'TEACHER' })}
                    className={`relative py-4 px-4 rounded-xl border text-sm font-semibold transition-all cursor-pointer group
                      ${form.role === 'TEACHER'
                        ? 'bg-accent-muted border-accent/40 text-accent glow-accent-sm'
                        : 'bg-surface-800 border-border text-text-secondary hover:border-border-hover hover:bg-surface-700'
                      }`}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${form.role === 'TEACHER' ? 'bg-accent/20' : 'bg-surface-700 group-hover:bg-surface-600'}`}>
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                        </svg>
                      </div>
                      <span>Teacher</span>
                    </div>
                    {form.role === 'TEACHER' && (
                      <div className="absolute top-2 right-2">
                        <svg className="w-5 h-5 text-accent" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3.5 text-base mt-2"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creating account...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    Create Account
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-surface-800 text-text-muted">Already have an account?</span>
              </div>
            </div>

            <Link 
              to="/login" 
              className="btn-secondary w-full justify-center py-3"
            >
              Sign in instead
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
