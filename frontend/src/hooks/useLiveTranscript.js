import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

const MANAGER_URL = import.meta.env.VITE_MANAGER_URL || 'http://localhost:3000';
const MAX_HISTORY = 200;  // keep the last N final segments in memory

export default function useLiveTranscript(broadcastId, enabled) {
  const { token } = useAuth();
  const [committed, setCommitted] = useState([]);
  const [interim, setInterim] = useState('');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !broadcastId || !token) return;

    const socket = io(MANAGER_URL, { auth: { token }, withCredentials: true });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('chat:join-room', { broadcastId });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('transcription:chunk', (chunk) => {
      if (chunk.broadcastId !== broadcastId) return;
      const text = (chunk.text || '').trim();
      if (!text) return;
      if (chunk.isFinal) {
        setCommitted((prev) => {
          const next = [...prev, text];
          return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
        });
        setInterim('');
      } else {
        // Replace the interim line — Deepgram emits one streaming hypothesis
        // per partial result for the same time range.
        setInterim(text);
      }
    });

    return () => {
      try { socket.emit('chat:leave-room', { broadcastId }); } catch {}
      socket.disconnect();
    };
  }, [enabled, broadcastId, token]);

  return { committed, interim, connected };
}
