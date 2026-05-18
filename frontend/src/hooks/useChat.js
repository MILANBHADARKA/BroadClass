import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

const MANAGER_URL = import.meta.env.VITE_MANAGER_URL || 'http://localhost:3000';
const HISTORY_PAGE_SIZE = 50;

/**
 * @param {string|null} broadcastId — null/empty disables the hook entirely.
 */
export default function useChat(broadcastId) {
  const { token, user, authFetch, API_URL } = useAuth();
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);

  // Ref-shadows of the props/state used inside Socket.IO callbacks so we
  // don't re-attach listeners every render.
  const socketRef = useRef(null);
  const broadcastIdRef = useRef(broadcastId);
  useEffect(() => { broadcastIdRef.current = broadcastId; }, [broadcastId]);

  // Dedup helper: chat:message fan-out reaches the sender too, so without
  // a dedupe we'd render their own message twice (once optimistic, once
  // via pubsub). We key by `id`.
  const upsertMessage = useCallback((m) => {
    setMessages((prev) => {
      const idx = prev.findIndex((x) => x.id === m.id);
      if (idx === -1) {
        // Insert in chronological order. The list is sorted oldest→newest;
        // new messages almost always belong at the end.
        const next = [...prev, m];
        next.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        return next;
      }
      const copy = prev.slice();
      copy[idx] = { ...prev[idx], ...m };
      return copy;
    });
  }, []);

  const removeOptimistic = useCallback((tempId) => {
    setMessages((prev) => prev.filter((m) => m.id !== tempId));
  }, []);

  /* ── Load history once per broadcast ───────────────────────────── */
  useEffect(() => {
    if (!broadcastId || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(
          `${API_URL}/api/chat/broadcasts/${broadcastId}/messages?limit=${HISTORY_PAGE_SIZE}`,
        );
        if (!res.ok) {
          // 403 just means the user isn't enrolled — show empty chat, no error UI
          if (res.status === 403) return;
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `History fetch failed (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) setMessages(data.messages || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [broadcastId, token, API_URL, authFetch]);

  /* ── Socket.IO connect / join-room / listen ────────────────────── */
  useEffect(() => {
    if (!broadcastId || !token) return;

    const socket = io(MANAGER_URL, {
      auth: { token },
      withCredentials: true,
    });
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit('chat:join-room', { broadcastId }, (ack) => {
        if (ack?.error) setError(ack.error);
      });
    };
    const onDisconnect = () => setConnected(false);
    const onMessage = (msg) => {
      // Only render messages for the current broadcast (defensive: rooms
      // should already filter for us, but if a stale event slips through
      // during room switch we ignore it).
      if (msg?.broadcastId !== broadcastIdRef.current) return;
      upsertMessage(msg);
    };
    const onStatusUpdate = ({ messageId, status }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, status } : m)),
      );
    };
    const onError = (msg) => setError(typeof msg === 'string' ? msg : 'Socket error');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('chat:message', onMessage);
    socket.on('chat:status-update', onStatusUpdate);
    socket.on('connect_error', onError);

    return () => {
      try { socket.emit('chat:leave-room', { broadcastId }); } catch {}
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('chat:message', onMessage);
      socket.off('chat:status-update', onStatusUpdate);
      socket.off('connect_error', onError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [broadcastId, token, upsertMessage]);

  /* ── Send action ───────────────────────────────────────────────── */
  const send = useCallback(
    async (content, { parentId, broadcastMs } = {}) => {
      const text = (content || '').trim();
      if (!text || !socketRef.current || !user || !broadcastIdRef.current) return false;

      setError(null);
      setSending(true);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Optimistic insert.
      const optimistic = {
        id: tempId,
        broadcastId: broadcastIdRef.current,
        classroomId: broadcastIdRef.current,
        role: 'VIEWER_QUESTION',
        content: text,
        parentId: parentId || null,
        status: 'VISIBLE',
        broadcastMs: broadcastMs ?? null,
        aiConfidence: null,
        sourceChunkIds: [],
        upvoteCount: 0,
        user: { id: user.id, name: user.name, role: user.role },
        createdAt: new Date().toISOString(),
        _optimistic: true,
      };
      upsertMessage(optimistic);

      try {
        const ack = await new Promise((resolve) => {
          socketRef.current.emit(
            'chat:send',
            { broadcastId: broadcastIdRef.current, content: text, parentId, broadcastMs },
            resolve,
          );
        });
        // Always remove the optimistic row — the server's ack carries the
        // real id, and the pubsub event will also deliver it. Better to
        // drop the temp and let upsert add the real row than risk a
        // duplicate.
        removeOptimistic(tempId);
        if (ack?.error) {
          setError(ack.error);
          return false;
        }
        if (ack?.message) upsertMessage(ack.message);
        return true;
      } catch (err) {
        removeOptimistic(tempId);
        setError(err.message || 'Send failed');
        return false;
      } finally {
        setSending(false);
      }
    },
    [user, upsertMessage, removeOptimistic],
  );

  /* ── Toggle upvote ─────────────────────────────────────────────── */
  const toggleUpvote = useCallback(
    async (messageId) => {
      try {
        const res = await authFetch(
          `${API_URL}/api/chat/messages/${messageId}/upvote`,
          { method: 'POST' },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Upvote failed (${res.status})`);
        }
        const data = await res.json();
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, upvoteCount: data.count } : m)),
        );
      } catch (err) {
        setError(err.message);
      }
    },
    [API_URL, authFetch],
  );

  return useMemo(
    () => ({ messages, send, toggleUpvote, sending, error, connected, clearError: () => setError(null) }),
    [messages, send, toggleUpvote, sending, error, connected],
  );
}
