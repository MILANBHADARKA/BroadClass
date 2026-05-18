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

  return (
    <div className="glass rounded-2xl p-5 animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
          <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Smart Chat</h3>
          <p className="text-xs text-text-muted">AI-assisted Q&A using your live lecture transcript</p>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-xl bg-danger/10 border border-danger/20 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-2.5">
        <ToggleRow
          label="AI assistance"
          sublabel="Auto-answer questions that the lecture has already covered"
          checked={classroom.aiChatEnabled !== false}
          disabled={savingKey === 'aiChatEnabled'}
          onChange={(v) => flip('aiChatEnabled', v)}
        />
        <ToggleRow
          label="Live transcription"
          sublabel="Required for AI answers and the live transcript panel"
          checked={classroom.transcriptionEnabled !== false}
          disabled={savingKey === 'transcriptionEnabled'}
          onChange={(v) => flip('transcriptionEnabled', v)}
        />
      </div>

      {classroom.transcriptionEnabled === false && classroom.aiChatEnabled !== false && (
        <p className="mt-3 text-xs text-warning">
          Transcription is off — AI answers will fall through to you for any new broadcast.
        </p>
      )}
    </div>
  );
}

function ToggleRow({ label, sublabel, checked, disabled, onChange }) {
  return (
    <label
      className={`flex items-center gap-3 p-3 rounded-xl bg-surface-800/40 border border-border transition-all ${
        disabled ? 'opacity-60' : 'hover:border-border-hover cursor-pointer'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        <div className="text-xs text-text-muted">{sublabel}</div>
      </div>
      {/* Custom switch using a peer checkbox so the input stays accessible */}
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="w-10 h-6 rounded-full bg-surface-700 peer-checked:bg-accent peer-disabled:opacity-50 transition-all" />
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-all peer-checked:translate-x-4" />
      </span>
    </label>
  );
}
