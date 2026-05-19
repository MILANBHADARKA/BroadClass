/**
 * Modal/drawer opened from the PastLecturesPanel. Shows read-only views of
 * a completed BroadcastSession:
 *  - Transcript tab: full transcript chunks joined in time order
 *  - Chat tab: every chat message persisted for the session
 *
 * Layout: bottom-sheet on mobile (slide-up), right-side drawer on desktop
 * (slide-in-right). Both fetches are tab-scoped so we don't pay for chat
 * history when the user only wants the transcript.
 */

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBroadcastTime(ms) {
  if (ms == null) return '';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function roleLabel(role) {
  switch (role) {
    case 'AI_ANSWER': return 'AI';
    case 'TEACHER_REPLY': return 'Teacher';
    case 'TEACHER_NOTE': return 'Teacher note';
    case 'VIEWER_QUESTION': return 'Student';
    default: return role;
  }
}

function roleAccent(role) {
  switch (role) {
    case 'AI_ANSWER': return 'ai-aurora-soft';
    case 'TEACHER_REPLY':
    case 'TEACHER_NOTE': return 'bg-warning-muted border border-warning/30';
    default: return 'bg-surface-800/60 border border-border';
  }
}

export default function PastSessionViewer({ session, onClose }) {
  const { authFetch, API_URL } = useAuth();
  const [tab, setTab] = useState('transcript');

  // Transcript fetch
  const [chunks, setChunks] = useState([]);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [chunkError, setChunkError] = useState(null);

  useEffect(() => {
    if (tab !== 'transcript' || !session?.id) return;
    let cancelled = false;
    setLoadingChunks(true);
    setChunkError(null);
    (async () => {
      try {
        const res = await authFetch(
          `${API_URL}/api/chat/sessions/${session.id}/transcript`,
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Transcript fetch failed (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        setChunks(data.chunks || []);
      } catch (err) {
        if (!cancelled) setChunkError(err.message);
      } finally {
        if (!cancelled) setLoadingChunks(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, session?.id, authFetch, API_URL]);

  // Chat fetch
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [msgError, setMsgError] = useState(null);

  useEffect(() => {
    if (tab !== 'chat' || !session?.id) return;
    let cancelled = false;
    setLoadingMessages(true);
    setMsgError(null);
    (async () => {
      try {
        const res = await authFetch(
          `${API_URL}/api/chat/sessions/${session.id}/messages?limit=200`,
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Chat fetch failed (${res.status})`);
        }
        const data = await res.json();
        if (cancelled) return;
        setMessages(data.messages || []);
      } catch (err) {
        if (!cancelled) setMsgError(err.message);
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, session?.id, authFetch, API_URL]);

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const transcriptText = useMemo(
    () => chunks.map((c) => c.text).filter(Boolean).join(' '),
    [chunks],
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-stretch sm:justify-end bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="
          w-full sm:max-w-3xl
          h-[92vh] sm:h-full
          bg-surface-950 border-t sm:border-t-0 sm:border-l border-border
          shadow-2xl flex flex-col
          rounded-t-3xl sm:rounded-none
          animate-slide-up sm:animate-slide-in-right
          overflow-hidden
        "
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Mobile grab handle */}
        <div className="sm:hidden pt-2 pb-1 flex justify-center">
          <span className="w-10 h-1.5 rounded-full bg-surface-700" aria-hidden />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-3 sm:py-5 border-b border-border ai-mesh">
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-semibold text-gradient truncate">
              {session.title || 'Untitled lecture'}
            </h2>
            <p className="text-[11px] sm:text-xs text-text-muted mt-0.5 flex flex-wrap items-center gap-1.5">
              <span>{formatDate(session.startedAt)}</span>
              {session.broadcaster?.name && (
                <>
                  <span className="opacity-50">·</span>
                  <span className="truncate max-w-[140px]">{session.broadcaster.name}</span>
                </>
              )}
              <span className="opacity-50">·</span>
              <span className={`badge ${session.endedAt ? 'bg-surface-700 text-text-muted border-border' : 'badge-success'} !py-0 !px-1.5 text-[10px]`}>
                {session.endedAt ? 'Ended' : 'Live'}
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="tap-44 w-10 h-10 sm:w-9 sm:h-9 rounded-xl bg-surface-800 border border-border hover:bg-surface-700 hover:border-border-hover flex items-center justify-center text-text-muted hover:text-text-primary transition-all flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-6 border-b border-border bg-surface-900/60">
          <div className="flex gap-1">
            {[
              { id: 'transcript', label: 'Transcript', icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              ) },
              { id: 'chat', label: 'Chat', icon: (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
              ) },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-muted hover:text-text-secondary'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5">
          {tab === 'transcript' ? (
            <>
              {loadingChunks ? (
                <div className="py-10 text-center text-sm text-text-muted">Loading transcript…</div>
              ) : chunkError ? (
                <div className="px-4 py-3 rounded-xl bg-danger-muted border border-danger/30 text-sm text-danger">
                  {chunkError}
                </div>
              ) : chunks.length === 0 ? (
                <div className="py-10 text-center text-sm text-text-muted">
                  No transcript was recorded for this lecture.
                </div>
              ) : (
                <article className="text-text-secondary leading-relaxed whitespace-pre-wrap text-sm sm:text-base">
                  {transcriptText}
                </article>
              )}
            </>
          ) : (
            <>
              {loadingMessages ? (
                <div className="py-10 text-center text-sm text-text-muted">Loading chat…</div>
              ) : msgError ? (
                <div className="px-4 py-3 rounded-xl bg-danger-muted border border-danger/30 text-sm text-danger">
                  {msgError}
                </div>
              ) : messages.length === 0 ? (
                <div className="py-10 text-center text-sm text-text-muted">
                  No chat messages for this lecture.
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {messages.map((m) => (
                    <li
                      key={m.id}
                      className={`rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 ${roleAccent(m.role)}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1 text-[11px] text-text-muted">
                        <span className="font-semibold text-text-secondary truncate max-w-[160px]">
                          {m.user?.name || roleLabel(m.role)}
                        </span>
                        <span className="opacity-50">·</span>
                        <span>{roleLabel(m.role)}</span>
                        {m.broadcastMs != null && (
                          <>
                            <span className="opacity-50">·</span>
                            <span className="font-mono">{formatBroadcastTime(m.broadcastMs)}</span>
                          </>
                        )}
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words text-text-primary leading-relaxed">
                        {m.content}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-2.5 sm:py-3 border-t border-border text-[11px] text-text-muted bg-surface-900 flex items-center justify-between gap-2">
          <span className="truncate">
            Read-only archive
          </span>
          <span className="text-right truncate">
            {session.endedAt ? `Ended ${formatDate(session.endedAt)}` : 'Live session'}
          </span>
        </div>
      </div>
    </div>
  );
}
