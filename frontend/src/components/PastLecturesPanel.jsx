/**
 * Lists every BroadcastSession (live or ended) for a classroom, newest
 * first. Live sessions show a pulsing "Live now" badge; ended sessions are
 * clickable rows that open the PastSessionViewer drawer with read-only
 * transcript + chat tabs.
 *
 * Owner-teachers can inline-rename a session's title.
 */

import { useMemo, useState, useCallback } from 'react';
import useClassroomSessions from '../hooks/useClassroomSessions';
import PastSessionViewer from './PastSessionViewer';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(startedAt, endedAt) {
  if (!startedAt) return '';
  const end = endedAt ? new Date(endedAt) : new Date();
  const ms = Math.max(0, end - new Date(startedAt));
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${totalSec}s`;
}

export default function PastLecturesPanel({ classroomId, isOwner = false, refreshKey }) {
  const { sessions, loading, error, reload, renameSession } = useClassroomSessions(
    classroomId,
    { refreshKey },
  );
  const [openSessionId, setOpenSessionId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  const liveCount = useMemo(
    () => sessions.filter((s) => !s.endedAt).length,
    [sessions],
  );

  const openSession = useCallback((s) => {
    if (editingId === s.id) return;
    setOpenSessionId(s.id);
  }, [editingId]);

  const beginRename = useCallback((e, s) => {
    e.stopPropagation();
    setEditingId(s.id);
    setDraftTitle(s.title || '');
  }, []);

  const cancelRename = useCallback((e) => {
    if (e) e.stopPropagation();
    setEditingId(null);
    setDraftTitle('');
  }, []);

  const commitRename = useCallback(async (e, s) => {
    if (e) e.stopPropagation();
    const next = draftTitle.trim();
    if (!next || next === s.title) {
      cancelRename();
      return;
    }
    setSavingRename(true);
    const ok = await renameSession(s.id, next);
    setSavingRename(false);
    if (ok) {
      setEditingId(null);
      setDraftTitle('');
    }
  }, [draftTitle, renameSession, cancelRename]);

  const openSession_full = sessions.find((s) => s.id === openSessionId) || null;

  return (
    <section className="glass rounded-2xl p-4 sm:p-6 animate-fade-in">
      <header className="flex items-start justify-between gap-3 mb-4 sm:mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-secondary to-accent flex items-center justify-center flex-shrink-0 shadow-lg shadow-accent/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-text-primary">Past Lectures</h3>
            <p className="text-[11px] sm:text-xs text-text-muted">
              {sessions.length === 0
                ? 'No lectures yet'
                : `${sessions.length} lecture${sessions.length === 1 ? '' : 's'}${liveCount ? ` · ${liveCount} live` : ''}`}
            </p>
          </div>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="tap-44 inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-surface-800 border border-border text-text-muted hover:text-text-primary hover:border-border-hover transition-all disabled:opacity-50"
          title="Refresh past lectures"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.355m0 4.993l-3.181-3.183a8.25 8.25 0 00-13.803 3.7M3.985 14.652H-1.007v4.992m0-4.992l3.181 3.183a8.25 8.25 0 0013.803-3.7" />
          </svg>
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </header>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-danger-muted border border-danger/30 text-xs sm:text-sm text-danger">
          {error}
        </div>
      )}

      {loading && sessions.length === 0 ? (
        <div className="py-10 flex items-center justify-center text-text-muted text-sm">
          Loading lectures…
        </div>
      ) : sessions.length === 0 ? (
        <div className="py-10 flex flex-col items-center justify-center gap-2 text-text-muted">
          <svg className="w-10 h-10 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-sm">No past lectures yet</p>
          <p className="text-xs opacity-75 text-center max-w-[260px]">
            Lectures will appear here once a broadcast ends.
          </p>
        </div>
      ) : (
        <ol className="relative space-y-2.5 sm:space-y-3">
          {/* Timeline rail (hidden on mobile to save space) */}
          <span className="hidden sm:block absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden />
          {sessions.map((s) => {
            const isLive = !s.endedAt;
            const isEditing = editingId === s.id;
            return (
              <li key={s.id} className="relative sm:pl-7">
                {/* Timeline dot */}
                <span
                  className={`hidden sm:flex absolute left-0 top-5 w-3.5 h-3.5 rounded-full border-2 border-surface-950 items-center justify-center ${
                    isLive ? 'bg-green-400 animate-pulse-live' : 'bg-accent/70'
                  }`}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => openSession(s)}
                  disabled={isLive || isEditing}
                  className={`w-full text-left rounded-xl border transition-all p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${
                    isLive
                      ? 'bg-accent-muted/40 border-accent/30 cursor-default'
                      : 'bg-surface-800/60 border-border hover:border-accent/30 hover:bg-surface-700/60 hover:-translate-y-0.5 cursor-pointer'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(e, s);
                            if (e.key === 'Escape') cancelRename(e);
                          }}
                          autoFocus
                          maxLength={120}
                          className="flex-1 min-w-0 bg-surface-900 border border-border-hover rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => commitRename(e, s)}
                            disabled={savingRename}
                            className="tap-44 flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-gradient-accent text-white text-xs font-semibold disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelRename}
                            className="tap-44 flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-surface-700 text-text-primary text-xs font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm sm:text-[15px] font-semibold text-text-primary truncate max-w-full">
                          {s.title || 'Untitled lecture'}
                        </span>
                        {isLive && (
                          <span className="badge badge-success">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-live" />
                            Live
                          </span>
                        )}
                        {s.hasRecording && (
                          <span className="badge bg-surface-700 text-text-muted border-border text-[10px]">
                            ▶ Recorded
                          </span>
                        )}
                        {isOwner && !isLive && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => beginRename(e, s)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') beginRename(e, s);
                            }}
                            className="text-[11px] text-text-muted hover:text-accent transition-colors cursor-pointer underline-offset-2 hover:underline"
                            title="Rename lecture"
                          >
                            Rename
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] sm:text-xs text-text-muted">
                      <span>{formatDate(s.startedAt)}</span>
                      <span className="opacity-50">·</span>
                      <span>{formatDuration(s.startedAt, s.endedAt)}</span>
                      {s.broadcaster?.name && (
                        <>
                          <span className="opacity-50">·</span>
                          <span className="truncate max-w-[160px]">{s.broadcaster.name}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0 text-[11px] sm:text-xs text-text-muted self-start sm:self-center">
                    <div className="flex items-center gap-1" title="Chat messages">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                      </svg>
                      <span className="tabular-nums">{s.messageCount ?? 0}</span>
                    </div>
                    <div className="flex items-center gap-1" title="Transcript chunks">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                      </svg>
                      <span className="tabular-nums">{s.chunkCount ?? 0}</span>
                    </div>
                    {!isLive && !isEditing && (
                      <svg className="w-4 h-4 text-text-muted/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {openSession_full && (
        <PastSessionViewer
          session={openSession_full}
          onClose={() => setOpenSessionId(null)}
        />
      )}
    </section>
  );
}
