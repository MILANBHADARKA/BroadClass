import { useMemo, useState } from 'react';
import useTeacherQueue from '../hooks/useTeacherQueue';


export default function TeacherQueuePanel({ broadcastId, enabled }) {
  const {
    queue, answer, dismiss, markAnswered, sending, error, clearError,
  } = useTeacherQueue(broadcastId, enabled);

  if (!enabled || !broadcastId) return null;

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-warning-muted flex items-center justify-center">
            <svg className="w-5 h-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Q&A queue</h3>
            <p className="text-xs text-text-muted">
              {queue.length === 0
                ? 'No pending questions'
                : `${queue.length} pending — sorted by upvotes`}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/20">
          <p className="text-sm text-danger flex-1">{error}</p>
          <button onClick={clearError} className="text-danger/70 hover:text-danger text-xs underline">
            dismiss
          </button>
        </div>
      )}

      {queue.length === 0 ? (
        <div className="py-8 text-center text-sm text-text-muted">
          When students ask questions the AI can't answer from the lecture, they show up here.
        </div>
      ) : (
        <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {queue.map((q) => (
            <QueueItem
              key={q.id}
              question={q}
              busy={sending}
              onAnswer={(content) => answer(q.id, content)}
              onDismiss={() => dismiss(q.id)}
              onMarkAnswered={() => markAnswered(q.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueItem({ question, busy, onAnswer, onDismiss, onMarkAnswered }) {
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
    <li className="p-3 rounded-xl bg-surface-800/40 border border-border hover:border-border-hover transition-all">
      <div className="flex items-center gap-2 mb-1.5 text-xs">
        <span className="font-semibold text-text-primary">
          {question.user?.name || 'Unknown'}
        </span>
        {question.upvoteCount > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-accent/15 text-accent font-semibold">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
            {question.upvoteCount}
          </span>
        )}
        <span className="text-text-muted ml-auto">
          {broadcastTime ? `@ ${broadcastTime} · ` : ''}{time}
        </span>
      </div>
      <p className="text-sm text-text-primary mb-2 break-words">{question.content}</p>

      {!composerOpen ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Answer
          </button>
          <button
            type="button"
            onClick={onMarkAnswered}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-surface-700 text-text-primary text-xs font-medium hover:bg-surface-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            title="I answered this aloud — just close it"
          >
            Mark answered
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-transparent text-text-muted text-xs font-medium hover:text-danger hover:bg-danger/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
            className="w-full px-3 py-2 rounded-xl bg-surface-900 border border-border focus:border-accent/50 outline-none text-text-primary placeholder:text-text-muted text-sm resize-none disabled:opacity-50"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setComposerOpen(false); setDraft(''); }}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-surface-700 text-text-primary text-xs font-medium hover:bg-surface-600 disabled:opacity-50 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {busy ? 'Sending…' : 'Send answer'}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
