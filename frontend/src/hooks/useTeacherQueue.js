import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

const MANAGER_URL = import.meta.env.VITE_MANAGER_URL || 'http://localhost:3000';

/**
 * @param {string|null} broadcastId
 * @param {boolean}     enabled — set true only for the classroom owner-teacher
 */
export default function useTeacherQueue(broadcastId, enabled) {
  const { token, authFetch, API_URL } = useAuth();
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const socketRef = useRef(null);
  const broadcastIdRef = useRef(broadcastId);
  useEffect(() => { broadcastIdRef.current = broadcastId; }, [broadcastId]);

  /* ── Sort helper — keep server's ordering: upvotes desc, then time asc ── */
  const sortQueue = useCallback((items) => {
    return [...items].sort((a, b) => {
      const u = (b.upvoteCount || 0) - (a.upvoteCount || 0);
      if (u !== 0) return u;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }, []);

  /* ── Initial load ──────────────────────────────────────────────── */
  const reload = useCallback(async () => {
    if (!enabled || !broadcastId || !token) return;
    try {
      const res = await authFetch(
        `${API_URL}/api/chat/broadcasts/${broadcastId}/queue`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Queue fetch failed (${res.status})`);
      }
      const data = await res.json();
      setQueue(sortQueue(data.queue || []));
    } catch (err) {
      setError(err.message);
    }
  }, [enabled, broadcastId, token, API_URL, authFetch, sortQueue]);

  useEffect(() => {
    reload();
  }, [reload]);

  /* ── Fetch a single message (used when status-update arrives but we
        don't have the row yet) ─────────────────────────────────────── */
  const fetchOne = useCallback(
    async (messageId) => {
      try {
        // Cheap-and-cheerful: fetch the whole history page and pick the row.
        // Reasonable because pages are small and a teacher's queue panel
        // doesn't churn fast enough for this to matter.
        const res = await authFetch(
          `${API_URL}/api/chat/broadcasts/${broadcastIdRef.current}/messages?limit=100`,
        );
        if (!res.ok) return null;
        const data = await res.json();
        return (data.messages || []).find((m) => m.id === messageId) || null;
      } catch {
        return null;
      }
    },
    [API_URL, authFetch],
  );

  /* ── Socket.IO: subscribe to live queue changes ────────────────── */
  useEffect(() => {
    if (!enabled || !broadcastId || !token) return;

    const socket = io(MANAGER_URL, { auth: { token }, withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('chat:join-room', { broadcastId }, (ack) => {
        if (ack?.error) setError(ack.error);
      });
    });

    const onStatus = async ({ messageId, status }) => {
      if (status === 'AWAITING_TEACHER') {
        setQueue((prev) => {
          if (prev.some((q) => q.id === messageId)) return prev;
          return prev;  // we'll add after the fetch below resolves
        });
        const row = await fetchOne(messageId);
        if (row && row.status === 'AWAITING_TEACHER') {
          setQueue((prev) => {
            if (prev.some((q) => q.id === messageId)) return prev;
            return sortQueue([...prev, row]);
          });
        }
      } else {
        // Any other status — remove from queue.
        setQueue((prev) => prev.filter((q) => q.id !== messageId));
      }
    };

    const onMessage = (msg) => {
      // A new TEACHER_ANSWER / AI_ANSWER threaded to a queued question
      // means the question's status has changed. The chat:status-update
      // will (and should) follow, but reacting here too makes the UI feel
      // instant and avoids the brief "still showing in queue but already
      // answered" window.
      if (
        (msg.role === 'TEACHER_ANSWER' || msg.role === 'AI_ANSWER') &&
        msg.parentId
      ) {
        setQueue((prev) => prev.filter((q) => q.id !== msg.parentId));
      }
    };

    socket.on('chat:status-update', onStatus);
    socket.on('chat:message', onMessage);
    socket.on('connect_error', (e) =>
      setError(typeof e === 'string' ? e : e?.message || 'Socket error'),
    );

    return () => {
      try { socket.emit('chat:leave-room', { broadcastId }); } catch {}
      socket.off('chat:status-update', onStatus);
      socket.off('chat:message', onMessage);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, broadcastId, token, fetchOne, sortQueue]);

  /* ── Actions ───────────────────────────────────────────────────── */
  const _post = useCallback(
    async (messageId, suffix, body) => {
      setSending(true);
      setError(null);
      try {
        const res = await authFetch(
          `${API_URL}/api/chat/messages/${messageId}${suffix}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Action failed (${res.status})`);
        }
        // Optimistic removal — the Socket.IO event will also fire but UX
        // benefits from the instant drop.
        setQueue((prev) => prev.filter((q) => q.id !== messageId));
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      } finally {
        setSending(false);
      }
    },
    [API_URL, authFetch],
  );

  const answer = useCallback(
    (messageId, content) => _post(messageId, '/answer', { content }),
    [_post],
  );
  const dismiss = useCallback((messageId) => _post(messageId, '/dismiss'), [_post]);
  const markAnswered = useCallback(
    (messageId) => _post(messageId, '/mark-answered'),
    [_post],
  );

  return useMemo(
    () => ({
      queue,
      answer,
      dismiss,
      markAnswered,
      sending,
      error,
      clearError: () => setError(null),
      reload,
    }),
    [queue, answer, dismiss, markAnswered, sending, error, reload],
  );
}
