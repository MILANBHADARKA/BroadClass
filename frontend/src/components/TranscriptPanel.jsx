import { useEffect, useMemo, useRef, useState } from 'react';
import useLiveTranscript from '../hooks/useLiveTranscript';


export default function TranscriptPanel({ sessionId, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  // Only subscribe when expanded — there's no point holding a Socket.IO
  // connection just to discard the stream.
  const { committed, interim, connected } = useLiveTranscript(sessionId, open);

  const scrollRef = useRef(null);
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, committed.length, interim]);

  // 9 bar phases for the wave indicator — fixed delays so they don't reshuffle.
  const barDelays = useMemo(
    () => ['-0.9s', '-0.6s', '-0.3s', '-0.7s', '-0.1s', '-0.5s', '-0.2s', '-0.8s', '-0.4s'],
    [],
  );

  if (!sessionId) return null;

  const wordCount = useMemo(
    () => committed.reduce((n, line) => n + line.split(/\s+/).filter(Boolean).length, 0),
    [committed],
  );

  return (
    <div className="glass rounded-2xl animate-fade-in overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-3 sm:p-5 hover:bg-surface-800/30 transition-all text-left"
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-secondary to-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-secondary/30">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            {open && connected && (
              <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-green-400 border-2 border-surface-950 animate-pulse-live" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-sm sm:text-base font-semibold text-text-primary">
              Live Transcript
            </span>
            <span className="block text-[11px] sm:text-xs text-text-muted flex items-center gap-2">
              {open ? (
                connected ? (
                  <>
                    <span className="wave-bars" aria-hidden>
                      {barDelays.map((d, i) => (
                        <span key={i} style={{ animationDelay: d }} />
                      ))}
                    </span>
                    <span>Streaming · {wordCount} words</span>
                  </>
                ) : (
                  <span>Connecting…</span>
                )
              ) : (
                <span>Tap to follow along</span>
              )}
            </span>
          </span>
        </span>
        <svg
          className={`w-5 h-5 text-text-muted transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="px-3 sm:px-5 pb-3 sm:pb-5">
          <div
            ref={scrollRef}
            className="overflow-y-auto p-3 sm:p-4 rounded-xl bg-surface-900/70 border border-border text-sm leading-relaxed text-text-secondary scroll-smooth"
            style={{ maxHeight: 'min(40vh, 320px)' }}
          >
            {committed.length === 0 && !interim ? (
              <p className="text-text-muted italic flex items-center gap-2">
                <span className="wave-bars" aria-hidden>
                  {barDelays.slice(0, 5).map((d, i) => (
                    <span key={i} style={{ animationDelay: d }} />
                  ))}
                </span>
                Waiting for speech…
              </p>
            ) : (
              <>
                {committed.map((line, i) => (
                  <p key={i} className="mb-2 last:mb-0">{line}</p>
                ))}
                {interim && (
                  <p className="text-accent/70 italic">{interim}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
