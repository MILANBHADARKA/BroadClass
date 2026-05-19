/**
 * useChat — Smart Chat client hook (Phase 8 — session-scoped).
 *
 * Connects to System-Manager's Socket.IO server, loads message history for
 * a specific `sessionId`, and subscribes to live messages + status updates
 * scoped to that session. When the active session changes (e.g. teacher
 * ends one lecture and starts another while the student stays on the page),
 * the hook tears down the old room subscription and resets local state so
 * the UI doesn't bleed old chat into the new session.
 *
 * Usage:
 *   const { messages, send, toggleUpvote, sending, error, connected } = useChat(sessionId);
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

const MANAGER_URL = import.meta.env.VITE_MANAGER_URL || 'http://localhost:3000';
const HISTORY_PAGE_SIZE = 50;

/**
 * @param {string|null} sessionId — null/empty disables the hook entirely.
 */
export default function useChat(sessionId) {
  const { token, user, authFetch, API_URL } = useAuth();
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  // Phase 8.6 — cold-start banner state. Populated once on mount via
  // /stats and updated live as new AI_ANSWERs arrive.
  const [chunkCount, setChunkCount] = useState(0);
  const [hasAnyAiAnswer, setHasAnyAiAnswer] = useState(false);

  // Ref-shadow of the current session id so async callbacks (chat:send ack,
  // deferred Redis fan-out for our own message) can tell whether they
  // arrived after the session changed and drop the late delivery.
  const socketRef = useRef(null);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Dedup helper: chat:message fan-out reaches the sender too. We dedupe
  // by id and refuse to add messages whose sessionId doesn't match the
  // current ref (defensive — Socket.IO rooms should already filter).
  const upsertMessage = useCallback((m) => {
    if (m.sessionId && m.sessionId !== sessionIdRef.current) return;
    setMessages((prev) => {
      const idx = prev.findIndex((x) => x.id === m.id);
      if (idx === -1) {
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

  /* ── Reset state whenever sessionId changes (new lecture started). ──── */
  useEffect(() => {
    setMessages([]);
    setError(null);
    setSending(false);
    setChunkCount(0);
    setHasAnyAiAnswer(false);
  }, [sessionId]);

  /* ── Fetch initial session stats for the cold-start banner. ─────────── */
  useEffect(() => {
    if (!sessionId || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/chat/sessions/${sessionId}/stats`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setChunkCount(data.chunkCount || 0);
        setHasAnyAiAnswer(!!data.anyAiAnswer);
      } catch {
        /* stats are best-effort — silent failure is fine */
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, token, API_URL, authFetch]);

  /* ── Load history once per session ─────────────────────────────── */
  useEffect(() => {
    if (!sessionId || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(
          `${API_URL}/api/chat/sessions/${sessionId}/messages?limit=${HISTORY_PAGE_SIZE}`,
        );
        if (!res.ok) {
          // 403 = not enrolled. Show empty chat, no error UI.
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
  }, [sessionId, token, API_URL, authFetch]);

  /* ── Socket.IO connect / join-room / listen ────────────────────── */
  useEffect(() => {
    if (!sessionId || !token) return;

    const socket = io(MANAGER_URL, {
      auth: { token },
      withCredentials: true,
    });
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit('chat:join-room', { sessionId }, (ack) => {
        if (ack?.error) setError(ack.error);
      });
    };
    const onDisconnect = () => setConnected(false);
    const onMessage = (msg) => {
      // Defensive: drop messages from a stale session (room filter should
      // already prevent this but we double-check on the client too).
      if (msg?.sessionId !== sessionIdRef.current) return;
      upsertMessage(msg);
      // First AI answer for this session → dismiss the cold-start banner.
      if (msg.role === 'AI_ANSWER') setHasAnyAiAnswer(true);
    };
    const onStatusUpdate = ({ messageId, status, sessionId: msgSessionId }) => {
      if (msgSessionId && msgSessionId !== sessionIdRef.current) return;
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
      try { socket.emit('chat:leave-room', { sessionId }); } catch {}
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('chat:message', onMessage);
      socket.off('chat:status-update', onStatusUpdate);
      socket.off('connect_error', onError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, token, upsertMessage]);

  /* ── Send action ───────────────────────────────────────────────── */
  const send = useCallback(
    async (content, { parentId, broadcastMs } = {}) => {
      const text = (content || '').trim();
      if (!text || !socketRef.current || !user || !sessionIdRef.current) return false;

      setError(null);
      setSending(true);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sessionAtSend = sessionIdRef.current;
      const optimistic = {
        id: tempId,
        sessionId: sessionAtSend,
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
            { sessionId: sessionAtSend, content: text, parentId, broadcastMs },
            resolve,
          );
        });
        // Late-ack safety: if session changed mid-flight, drop the optimistic
        // and don't add the real one — it belongs to a session the user is
        // no longer viewing.
        removeOptimistic(tempId);
        if (sessionAtSend !== sessionIdRef.current) return false;
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
    () => ({
      messages,
      send,
      toggleUpvote,
      sending,
      error,
      connected,
      clearError: () => setError(null),
      // Phase 8.6 — cold-start signals for the banner.
      chunkCount,
      hasAnyAiAnswer,
    }),
    [messages, send, toggleUpvote, sending, error, connected, chunkCount, hasAnyAiAnswer],
  );
}
