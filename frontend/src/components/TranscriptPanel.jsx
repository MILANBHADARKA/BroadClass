import { useEffect, useRef, useState } from 'react';
import useLiveTranscript from '../hooks/useLiveTranscript';


export default function TranscriptPanel({ broadcastId, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  // Only subscribe when expanded — there's no point holding a Socket.IO
  // connection just to discard the stream.
  const { committed, interim, connected } = useLiveTranscript(broadcastId, open);

  const scrollRef = useRef(null);
  useEffect(() => {
    if (!open || !scrollRef.current) return;
    // Stick to the bottom when new text lands.
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, committed.length, interim]);

  if (!broadcastId) return null;

  return (
    <div className="glass rounded-2xl animate-fade-in overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 hover:bg-surface-800/30 transition-all"
      >
        <span className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-secondary-muted flex items-center justify-center">
            <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9.563C9 9.252 9.252 9 9.563 9h4.874c.311 0 .563.252.563.563v4.874c0 .311-.252.563-.563.563H9.564A.562.562 0 019 14.437V9.564z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <span className="text-left">
            <span className="block text-sm sm:text-base font-semibold text-text-primary">
              Live transcript
            </span>
            <span className="block text-xs text-text-muted">
              {open
                ? (connected ? 'Streaming…' : 'Connecting…')
                : 'Click to open'}
            </span>
          </span>
        </span>
        <svg
          className={`w-5 h-5 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-4 sm:pb-5">
          <div
            ref={scrollRef}
            className="max-h-72 overflow-y-auto p-3 rounded-xl bg-surface-900/60 border border-border text-sm leading-relaxed text-text-primary"
          >
            {committed.length === 0 && !interim ? (
              <p className="text-text-muted italic">Waiting for speech…</p>
            ) : (
              <>
                {committed.map((line, i) => (
                  <p key={i} className="mb-2 last:mb-0">{line}</p>
                ))}
                {interim && (
                  <p className="text-text-muted italic">{interim}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
