import { useEffect, useMemo, useRef, useState } from 'react';
import useChat from '../hooks/useChat';
import { useAuth } from '../context/AuthContext';


export default function ChatPanel({ broadcastId }) {
  const { user } = useAuth();
  const { messages, send, toggleUpvote, sending, error, connected, clearError } =
    useChat(broadcastId);
  const [input, setInput] = useState('');
  const listRef = useRef(null);

  // Auto-scroll to bottom when a new message arrives, but only if the user
  // is already near the bottom — otherwise respect their scroll position
  // (they're probably reading history).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onSubmit = async (e) => {
    e.preventDefault();
    const ok = await send(input);
    if (ok) setInput('');
  };

  if (!broadcastId) {
    return (
      <div className="glass rounded-2xl p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Live Chat</h3>
            <p className="text-sm text-text-muted">Chat opens when a broadcast is live</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 flex flex-col gap-3 animate-fade-in" style={{ minHeight: 420 }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.068.157 2.148.279 3.238.364.466.037.893.281 1.153.671L12 21l2.652-3.978c.26-.39.687-.634 1.153-.67 1.09-.086 2.17-.208 3.238-.365 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Live Chat</h3>
            <p className="text-xs text-text-muted">
              {connected ? 'Connected' : 'Reconnecting…'}
            </p>
          </div>
        </div>
        <span className="text-xs text-text-muted">{messages.length} message{messages.length === 1 ? '' : 's'}</span>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/10 border border-danger/20">
          <p className="text-sm text-danger flex-1">{error}</p>
          <button onClick={clearError} className="text-danger/70 hover:text-danger text-xs underline">
            dismiss
          </button>
        </div>
      )}

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-[280px] max-h-[480px]"
      >
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-text-muted text-sm">
            No messages yet. Be the first to ask.
          </div>
        )}
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            currentUserId={user?.id}
            onUpvote={toggleUpvote}
          />
        ))}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 pt-2 border-t border-border">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          maxLength={2000}
          disabled={!connected || sending}
          className="flex-1 px-3 py-2.5 rounded-xl bg-surface-800 border border-border focus:border-accent/50 outline-none text-text-primary placeholder:text-text-muted text-sm transition-all disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || !connected || sending}
          className="px-4 py-2.5 rounded-xl bg-accent text-white font-medium text-sm hover:bg-accent-hover disabled:bg-surface-700 disabled:text-text-muted disabled:cursor-not-allowed transition-all"
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

function MessageRow({ message, currentUserId, onUpvote }) {
  const isOwn = message.user?.id === currentUserId;
  const isHidden =
    message.status === 'HIDDEN_BY_MODERATION' || message.status === 'HIDDEN_BY_TEACHER';
  const isAi = message.role === 'AI_ANSWER';
  const isAwaitingTeacher = message.status === 'AWAITING_TEACHER';
  const isTeacher = message.role === 'TEACHER_ANSWER' || message.user?.role === 'TEACHER';
  const citations = Array.isArray(message.aiCitations) ? message.aiCitations : [];

  const time = useMemo(() => {
    try {
      return new Date(message.createdAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }, [message.createdAt]);

  return (
    <div
      className={`p-2.5 rounded-xl border transition-all ${
        isHidden
          ? 'bg-surface-900/40 border-border/40 opacity-50'
          : isAi
          ? 'bg-accent/5 border-accent/20 ml-4'   // indent AI replies
          : isOwn
          ? 'bg-surface-800/60 border-border'
          : 'bg-surface-800/30 border-border/60'
      }`}
    >
      <div className="flex items-center gap-2 mb-1 text-xs">
        {isAi ? (
          <span className="inline-flex items-center gap-1 font-semibold text-accent">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
            AI Assistant
          </span>
        ) : (
          <span className={`font-semibold ${isTeacher ? 'text-warning' : 'text-text-primary'}`}>
            {message.user?.name || 'Unknown'}
          </span>
        )}
        {isAi && (
          <span className="px-1.5 py-0.5 rounded bg-accent/20 text-accent text-[10px] font-semibold">
            from this lecture
          </span>
        )}
        {isTeacher && !isAi && (
          <span className="px-1.5 py-0.5 rounded bg-warning/20 text-warning text-[10px] font-semibold">TEACHER</span>
        )}
        {isAwaitingTeacher && !isAi && (
          <span className="px-1.5 py-0.5 rounded bg-secondary/20 text-secondary text-[10px] font-semibold">
            sent to teacher
          </span>
        )}
        <span className="text-text-muted ml-auto">{time}</span>
      </div>
      <p className={`text-sm break-words ${isHidden ? 'italic text-text-muted' : 'text-text-primary'}`}>
        {isHidden ? '[message hidden]' : message.content}
        {isAi && citations.length > 0 && (
          <CitationChips citations={citations} />
        )}
      </p>

      {/* Upvote — students upvote questions to bubble them up to teacher queue (Phase 4).
          Only on top-level questions (no parentId), not on AI/teacher replies. */}
      {!isHidden && !isAi && !message.parentId && (
        <button
          onClick={() => onUpvote(message.id)}
          className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-700/50 hover:bg-surface-700 text-xs text-text-muted hover:text-text-primary transition-all"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          </svg>
          {message.upvoteCount || 0}
        </button>
      )}
    </div>
  );
}

/**
 * Inline citation chips for AI answers. Each chip is a clickable <sup>
 * that shows the chunk timestamp on hover (full text via `title`) and the
 * snippet on click. Phase 5 will wire these to seek the recording player.
 */
function CitationChips({ citations }) {
  return (
    <span className="inline-flex flex-wrap gap-1 ml-1 align-baseline">
      {citations.map((c, i) => (
        <CitationChip key={c.id} index={i + 1} citation={c} />
      ))}
    </span>
  );
}

function CitationChip({ index, citation }) {
  const [open, setOpen] = useState(false);
  const timeLabel = useMemo(() => {
    const s = Math.max(0, Math.floor(citation.startMs / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }, [citation.startMs]);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`At ${timeLabel} — click to see snippet`}
        className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded bg-accent/20 hover:bg-accent/30 text-accent text-[10px] font-semibold align-baseline transition-all"
      >
        <sup>{index}</sup>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-10 left-0 mt-1 w-64 max-w-[80vw] p-2 rounded-lg bg-surface-900 border border-accent/30 shadow-lg text-xs text-text-primary whitespace-normal break-words"
          onClick={() => setOpen(false)}
        >
          <span className="block text-accent font-semibold mb-1">at {timeLabel}</span>
          <span className="block italic text-text-secondary">{citation.text}</span>
        </span>
      )}
    </span>
  );
}
