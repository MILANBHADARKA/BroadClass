import { useMemo, useState } from 'react';
import useTeacherQueue from '../hooks/useTeacherQueue';


export default function TeacherQueuePanel({ sessionId, enabled }) {
  const {
    queue, answer, dismiss, markAnswered, sending, error, clearError,
  } = useTeacherQueue(sessionId, enabled);

  if (!enabled || !sessionId) return null;

  return (
    <section className="glass rounded-2xl p-3 sm:p-5 animate-fade-in overflow-hidden">
      <header className="flex items-start justify-between gap-3 mb-3 sm:mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-warning to-amber-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-warning/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            {queue.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center animate-pulse-live shadow-lg">
                {queue.length > 9 ? '9+' : queue.length}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-text-primary">
              Question Queue
            </h3>
            <p className="text-[11px] sm:text-xs text-text-muted">
              {queue.length === 0
                ? 'No pending questions yet'
                : `${queue.length} pending · sorted by upvotes`}
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/20">
          <p className="text-xs sm:text-sm text-danger flex-1 break-words">{error}</p>
          <button onClick={clearError} className="text-danger/70 hover:text-danger text-xs underline tap-44 px-1">
            dismiss
          </button>
        </div>
      )}

      {queue.length === 0 ? (
        <div className="py-10 px-4 text-center text-text-muted flex flex-col items-center gap-2">
          <svg className="w-10 h-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
          </svg>
          <p className="text-sm">Inbox zero ✦</p>
          <p className="text-[11px] opacity-75 max-w-[280px]">
            Questions the AI can't answer from the lecture will land here, sorted by upvotes.
          </p>
        </div>
      ) : (
        <ul
          className="space-y-2 sm:space-y-2.5 overflow-y-auto pr-0.5 sm:pr-1"
          style={{ maxHeight: 'min(60vh, 480px)' }}
        >
          {queue.map((q, idx) => (
            <QueueItem
              key={q.id}
              question={q}
              priorityRank={idx}
              busy={sending}
              onAnswer={(content) => answer(q.id, content)}
              onDismiss={() => dismiss(q.id)}
              onMarkAnswered={() => markAnswered(q.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueItem({ question, priorityRank, busy, onAnswer, onDismiss, onMarkAnswered }) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const time = useMemo(() => {
    try {
      return new Date(question.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }, [question.createdAt]);

  const broadcastTime = useMemo(() => {
    if (!Number.isFinite(question.broadcastMs)) return null;
    const s = Math.max(0, Math.floor(question.broadcastMs / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }, [question.broadcastMs]);

  // Top item gets the aurora treatment so it visually pops.
  const isTop = priorityRank === 0;

  const submit = async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text) return;
    const ok = await onAnswer(text);
    if (ok) {
      setDraft('');
      setComposerOpen(false);
    }
  };

  return (
    <li
      className={`rounded-xl p-3 sm:p-3.5 transition-all animate-fade-in ${
        isTop
          ? 'ai-aurora-soft'
          : 'bg-surface-800/50 border border-border hover:border-border-hover'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap text-xs">
        <span className="font-semibold text-text-primary truncate max-w-[140px] sm:max-w-none">
          {question.user?.name || 'Unknown'}
        </span>
        {question.upvoteCount > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-accent/20 text-accent font-bold text-[10px]">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
            {question.upvoteCount}
          </span>
        )}
        {isTop && question.upvoteCount > 0 && (
          <span className="badge-accent text-[10px] !py-0 !px-1.5">top</span>
        )}
        <span className="text-text-muted ml-auto text-[11px]">
          {broadcastTime && (
            <span className="font-mono">@{broadcastTime} </span>
          )}
          · {time}
        </span>
      </div>
      <p className="text-sm text-text-primary mb-2.5 break-words leading-relaxed">
        {question.content}
      </p>

      {!composerOpen ? (
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            disabled={busy}
            className="tap-44 px-3 py-1.5 rounded-lg bg-gradient-accent text-white text-xs font-semibold hover:glow-accent-sm hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all"
          >
            Answer
          </button>
          <button
            type="button"
            onClick={onMarkAnswered}
            disabled={busy}
            className="tap-44 px-3 py-1.5 rounded-lg bg-surface-700 text-text-primary text-xs font-medium hover:bg-surface-600 disabled:opacity-50 transition-all"
            title="Answered aloud — just close"
          >
            Mark answered
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="tap-44 px-3 py-1.5 rounded-lg bg-transparent text-text-muted text-xs font-medium hover:text-danger hover:bg-danger/10 disabled:opacity-50 transition-all ml-auto"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your answer…"
            rows={3}
            maxLength={4000}
            autoFocus
            disabled={busy}
            className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-border focus:border-accent/60 focus:ring-2 focus:ring-accent/20 outline-none text-text-primary placeholder:text-text-muted text-sm resize-none disabled:opacity-50"
          />
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={() => { setComposerOpen(false); setDraft(''); }}
              disabled={busy}
              className="tap-44 px-3 py-1.5 rounded-lg bg-surface-700 text-text-primary text-xs font-medium hover:bg-surface-600 disabled:opacity-50 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              className="tap-44 px-3 py-1.5 rounded-lg bg-gradient-accent text-white text-xs font-semibold hover:glow-accent-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {busy ? 'Sending…' : 'Send answer'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
