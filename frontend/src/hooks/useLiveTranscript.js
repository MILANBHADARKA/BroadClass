import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

const MANAGER_URL = import.meta.env.VITE_MANAGER_URL || 'http://localhost:3000';
const MAX_HISTORY = 200;  // keep the last N final segments in memory

/**
 * useLiveTranscript — Phase 8 session-scoped live transcript stream.
 *
 * Joins the same `chat:${sessionId}` Socket.IO room used for chat (the
 * ai-service publishes both `transcription:chunk` and chat events into
 * the same per-session room).
 *
 * @param {string|null} sessionId — BroadcastSession.id
 * @param {boolean}     enabled   — gate on UI toggle so we don't burn a
 *                                  connection when the panel is collapsed.
 */
export default function useLiveTranscript(sessionId, enabled) {
  const { token } = useAuth();
  const [committed, setCommitted] = useState([]);
  const [interim, setInterim] = useState('');
  const [connected, setConnected] = useState(false);

  // Reset all state on session change — new lecture should start with a
  // blank transcript pane.
  useEffect(() => {
    setCommitted([]);
    setInterim('');
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId || !token) return;

    const socket = io(MANAGER_URL, { auth: { token }, withCredentials: true });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('chat:join-room', { sessionId });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('transcription:chunk', (chunk) => {
      // Defensive: drop stray chunks from a different session.
      if (chunk.sessionId && chunk.sessionId !== sessionId) return;
      const text = (chunk.text || '').trim();
      if (!text) return;
      if (chunk.isFinal) {
        setCommitted((prev) => {
          const next = [...prev, text];
          return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
        });
        setInterim('');
      } else {
        setInterim(text);
      }
    });

    return () => {
      try { socket.emit('chat:leave-room', { sessionId }); } catch {}
      socket.disconnect();
    };
  }, [enabled, sessionId, token]);

  return { committed, interim, connected };
}
