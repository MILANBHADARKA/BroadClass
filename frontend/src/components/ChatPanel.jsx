import { useEffect, useMemo, useRef, useState } from 'react';
import useChat from '../hooks/useChat';
import { useAuth } from '../context/AuthContext';

// Show the cold-start banner until we have at least this many transcript
// chunks or we've seen an AI answer succeed. ~8 chunks ≈ 1–2 minutes of
// speech with the default 300-token chunk size.
const COLD_START_CHUNK_THRESHOLD = 8;

export default function ChatPanel({ sessionId }) {
  const { user } = useAuth();
  const {
    messages, send, toggleUpvote, sending, error, connected, clearError,
    chunkCount, hasAnyAiAnswer,
  } = useChat(sessionId);
  const [input, setInput] = useState('');
  const listRef = useRef(null);

  const showColdStartBanner =
    sessionId && !hasAnyAiAnswer && chunkCount < COLD_START_CHUNK_THRESHOLD;

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

  if (!sessionId) {
    return (
      <div className="glass rounded-2xl p-4 sm:p-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <AiOrb size="sm" muted />
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-text-primary">Smart Chat</h3>
            <p className="text-xs sm:text-sm text-text-muted">Chat opens when a broadcast is live</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="glass ai-mesh rounded-2xl flex flex-col gap-3 animate-fade-in overflow-hidden"
      style={{ minHeight: 'min(70vh, 520px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-3 sm:px-5 pt-3 sm:pt-5">
        <div className="flex items-center gap-3 min-w-0">
          <AiOrb />
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-text-primary flex items-center gap-2">
              <span className="text-gradient">Smart Chat</span>
              <span className="hidden sm:inline-flex badge-accent text-[10px] !py-0.5 !px-2">AI</span>
            </h3>
            <p className="text-[11px] sm:text-xs text-text-muted flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connected ? 'bg-green-400 animate-pulse-live' : 'bg-text-muted'
                }`}
              />
              {connected ? 'Live' : 'Reconnecting…'}
            </p>
          </div>
        </div>
        <span className="text-[11px] sm:text-xs text-text-muted flex-shrink-0">
          {messages.length} msg
        </span>
      </div>

      {/* Banners */}
      <div className="px-3 sm:px-5 space-y-2">
        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-danger/10 border border-danger/20">
            <p className="text-xs sm:text-sm text-danger flex-1 break-words">{error}</p>
            <button onClick={clearError} className="text-danger/70 hover:text-danger text-xs underline tap-44 px-1">
              dismiss
            </button>
          </div>
        )}

        {showColdStartBanner && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl ai-aurora-soft">
            <div className="flex-shrink-0 mt-0.5">
              <AiSparkleIcon className="w-4 h-4 text-accent animate-pulse-glow" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs sm:text-sm text-text-primary font-medium">
                AI is learning from this lecture
              </p>
              <p className="text-[11px] sm:text-xs text-text-muted mt-0.5">
                Your questions go to the teacher until enough transcript accumulates.
              </p>
            </div>
            <span className="ai-thinking-dots flex-shrink-0 mt-1.5" aria-hidden>
              <span /><span /><span />
            </span>
          </div>
        )}
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 sm:px-5 space-y-2.5 scroll-smooth"
        style={{ minHeight: 240, maxHeight: 'min(60vh, 520px)' }}
      >
        {messages.length === 0 ? (
          <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-center gap-2 text-text-muted py-6">
            <AiSparkleIcon className="w-8 h-8 opacity-50 animate-float" />
            <p className="text-sm">Ask anything about the lecture.</p>
            <p className="text-[11px] opacity-70 max-w-[260px]">
              The AI answers from this lecture's transcript. If it can't, your teacher will.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              currentUserId={user?.id}
              onUpvote={toggleUpvote}
            />
          ))
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={onSubmit}
        className="flex items-end gap-2 p-3 sm:p-4 border-t border-border bg-surface-900/40"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the lecture…"
          maxLength={2000}
          disabled={!connected || sending}
          className="flex-1 min-w-0 px-3 py-2.5 sm:py-3 rounded-xl bg-surface-800 border border-border focus:border-accent/60 focus:ring-2 focus:ring-accent/20 outline-none text-text-primary placeholder:text-text-muted text-sm transition-all disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || !connected || sending}
          className="tap-44 flex-shrink-0 px-4 py-2.5 sm:py-3 rounded-xl bg-gradient-accent text-white font-semibold text-sm hover:glow-accent-sm hover:-translate-y-0.5 disabled:bg-surface-700 disabled:text-text-muted disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all flex items-center gap-1.5"
        >
          {sending ? (
            <span className="ai-thinking-dots" aria-hidden>
              <span /><span /><span />
            </span>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.125A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.875L5.999 12zm0 0h7.5" />
              </svg>
              <span className="hidden sm:inline">Send</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
 * Message row
 * ─────────────────────────────────────────────────── */

function MessageRow({ message, currentUserId, onUpvote }) {
  const isOwn = message.user?.id === currentUserId;
  const isHidden =
    message.status === 'HIDDEN_BY_MODERATION' || message.status === 'HIDDEN_BY_TEACHER';
  const isAi = message.role === 'AI_ANSWER';
  const isAwaitingTeacher = message.status === 'AWAITING_TEACHER';
  const isTeacher = message.role === 'TEACHER_ANSWER' || message.user?.role === 'TEACHER';
  const citations = Array.isArray(message.aiCitations) ? message.aiCitations : [];
  const confidence = typeof message.aiConfidence === 'number' ? message.aiConfidence : null;

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

  // AI replies get the aurora-border treatment; everyone else is a flat card.
  if (isAi) {
    return (
      <div className="ai-aurora-soft rounded-2xl p-3 sm:p-3.5 animate-fade-in ml-2 sm:ml-6">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <AiOrb size="xs" />
            <span className="text-xs font-semibold text-gradient">AI Assistant</span>
          </span>
          <span className="badge-accent text-[10px] !py-0 !px-1.5">from this lecture</span>
          <span className="text-[11px] text-text-muted ml-auto">{time}</span>
        </div>
        <p className={`text-sm leading-relaxed break-words ${isHidden ? 'italic text-text-muted' : 'text-text-primary'}`}>
          {isHidden ? '[message hidden]' : message.content}
          {!isHidden && citations.length > 0 && <CitationChips citations={citations} />}
        </p>
        {confidence !== null && !isHidden && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">Confidence</span>
            <div className="flex-1 h-1.5 rounded-full bg-surface-800 overflow-hidden">
              <div
                className="ai-confidence h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(8, Math.min(100, confidence * 100))}%` }}
              />
            </div>
            <span className="text-[10px] text-text-muted tabular-nums">
              {Math.round(confidence * 100)}%
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`p-2.5 sm:p-3 rounded-xl border transition-all animate-fade-in ${
        isHidden
          ? 'bg-surface-900/40 border-border/40 opacity-50'
          : isTeacher
          ? 'bg-warning-muted/40 border-warning/30'
          : isOwn
          ? 'bg-accent/8 border-accent/20'
          : 'bg-surface-800/50 border-border'
      }`}
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap text-xs">
        <span className={`font-semibold ${isTeacher ? 'text-warning' : 'text-text-primary'}`}>
          {message.user?.name || 'Unknown'}
        </span>
        {isTeacher && (
          <span className="badge-warning text-[10px] !py-0 !px-1.5">TEACHER</span>
        )}
        {isAwaitingTeacher && (
          <span className="badge text-[10px] !py-0 !px-1.5 bg-secondary/15 text-secondary border border-secondary/20">
            sent to teacher
          </span>
        )}
        <span className="text-text-muted ml-auto text-[11px]">{time}</span>
      </div>
      <p className={`text-sm break-words leading-relaxed ${isHidden ? 'italic text-text-muted' : 'text-text-primary'}`}>
        {isHidden ? '[message hidden]' : message.content}
      </p>

      {!isHidden && !message.parentId && (
        <button
          onClick={() => onUpvote(message.id)}
          className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-700/60 hover:bg-accent/20 hover:text-accent text-xs text-text-muted transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
          </svg>
          <span className="tabular-nums">{message.upvoteCount || 0}</span>
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
 * AI iconography
 * ─────────────────────────────────────────────────── */

function AiOrb({ size = 'md', muted = false }) {
  const dim = size === 'xs' ? 'w-5 h-5' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const inner = size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <span
      className={`${dim} rounded-xl flex-shrink-0 flex items-center justify-center bg-gradient-accent ${muted ? 'opacity-60' : 'ai-orb glow-accent-sm'}`}
    >
      <AiSparkleIcon className={`${inner} text-white`} />
    </span>
  );
}

function AiSparkleIcon({ className = '' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────
 * Citation chips (unchanged behavior, restyled)
 * ─────────────────────────────────────────────────── */

function CitationChips({ citations }) {
  return (
    <span className="inline-flex flex-wrap gap-1 ml-1.5 align-baseline">
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
        title={`At ${timeLabel}, click to see snippet`}
        className="inline-flex items-center justify-center min-w-[22px] h-[18px] px-1.5 rounded-md bg-accent/25 hover:bg-accent/40 text-accent text-[10px] font-bold align-baseline transition-all"
      >
        <sup className="leading-none">{index}</sup>
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-20 left-0 mt-1 w-64 max-w-[85vw] p-2.5 rounded-lg bg-surface-900 border border-accent/30 shadow-xl text-xs text-text-primary whitespace-normal break-words"
          onClick={() => setOpen(false)}
        >
          <span className="block text-accent font-semibold mb-1">at {timeLabel}</span>
          <span className="block italic text-text-secondary leading-relaxed">{citation.text}</span>
        </span>
      )}
    </span>
  );
}
