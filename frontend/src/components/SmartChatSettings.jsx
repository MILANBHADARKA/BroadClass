import { useState } from 'react';
import { useAuth } from '../context/AuthContext';


export default function SmartChatSettings({ classroom, onChange }) {
  const { authFetch, API_URL } = useAuth();
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState(null);

  const flip = async (key, nextValue) => {
    setSavingKey(key);
    setError(null);
    try {
      const res = await authFetch(`${API_URL}/api/classrooms/${classroom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: nextValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      onChange?.({ [key]: nextValue });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const aiOn = classroom.aiChatEnabled !== false;
  const sttOn = classroom.transcriptionEnabled !== false;

  return (
    <section className={`rounded-2xl p-4 sm:p-5 animate-fade-in ${aiOn ? 'ai-aurora-soft' : 'glass'}`}>
      <header className="flex items-center gap-3 mb-3 sm:mb-4">
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-accent flex items-center justify-center flex-shrink-0 shadow-lg shadow-accent/30 ai-orb">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base sm:text-lg font-semibold text-gradient">Smart Chat</h3>
          <p className="text-[11px] sm:text-xs text-text-muted">
            AI-assisted Q&A grounded in your live lecture transcript
          </p>
        </div>
        <span className={`badge ${aiOn ? 'badge-accent' : 'bg-surface-700 text-text-muted border-border'} hidden sm:inline-flex`}>
          <span className={`w-1.5 h-1.5 rounded-full ${aiOn ? 'bg-accent animate-pulse-live' : 'bg-text-muted'}`} />
          {aiOn ? 'Active' : 'Off'}
        </span>
      </header>

      {error && (
        <div className="mb-3 p-3 rounded-xl bg-danger/10 border border-danger/20 text-xs sm:text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <ToggleCard
          icon={(
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          )}
          label="AI assistance"
          sublabel="Auto-answer questions already covered in the lecture"
          checked={aiOn}
          disabled={savingKey === 'aiChatEnabled'}
          onChange={(v) => flip('aiChatEnabled', v)}
        />
        <ToggleCard
          icon={(
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          )}
          label="Live transcription"
          sublabel="Required for AI answers and the transcript panel"
          checked={sttOn}
          disabled={savingKey === 'transcriptionEnabled'}
          onChange={(v) => flip('transcriptionEnabled', v)}
        />
      </div>

      {!sttOn && aiOn && (
        <p className="mt-3 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 text-[11px] sm:text-xs text-warning flex items-center gap-2">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>Transcription is off, AI answers will fall through to you for new broadcasts.</span>
        </p>
      )}
    </section>
  );
}

function ToggleCard({ icon, label, sublabel, checked, disabled, onChange }) {
  return (
    <label
      className={`group relative flex items-start gap-3 p-3 sm:p-3.5 rounded-xl border transition-all overflow-hidden ${
        disabled
          ? 'opacity-60 cursor-wait'
          : 'cursor-pointer hover:-translate-y-0.5'
      } ${
        checked
          ? 'bg-accent/8 border-accent/30 hover:border-accent/50'
          : 'bg-surface-800/50 border-border hover:border-border-hover'
      }`}
    >
      <span
        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
          checked
            ? 'bg-gradient-accent text-white'
            : 'bg-surface-700 text-text-muted'
        }`}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text-primary">{label}</div>
        <div className="text-[11px] sm:text-xs text-text-muted leading-snug">{sublabel}</div>
      </div>
      <span className="relative inline-flex shrink-0 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="w-10 h-6 rounded-full bg-surface-700 peer-checked:bg-gradient-accent peer-disabled:opacity-50 transition-all" />
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all peer-checked:translate-x-4" />
      </span>
    </label>
  );
}
