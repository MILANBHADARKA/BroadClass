/**
 *
 * Lists all past (and active) BroadcastSessions for a classroom, newest
 * first. Used by the Past Lectures panel. Re-fetches on demand and when
 * the active broadcast list changes (so a freshly-ended lecture appears
 * in the archive without a manual refresh).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function useClassroomSessions(classroomId, { refreshKey } = {}) {
  const { token, authFetch, API_URL } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!classroomId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(
        `${API_URL}/api/chat/classrooms/${classroomId}/sessions`,
      );
      if (!res.ok) {
        if (res.status === 403) {
          setSessions([]);
          return;
        }
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Sessions fetch failed (${res.status})`);
      }
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [classroomId, token, API_URL, authFetch]);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  /** Rename a session's title. Only succeeds if the user is the classroom teacher. */
  const renameSession = useCallback(
    async (sessionId, newTitle) => {
      try {
        const res = await authFetch(
          `${API_URL}/api/chat/sessions/${sessionId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle }),
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Rename failed (${res.status})`);
        }
        const data = await res.json();
        const updatedTitle = data.session?.title ?? newTitle;
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, title: updatedTitle } : s)),
        );
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      }
    },
    [API_URL, authFetch],
  );

  return { sessions, loading, error, reload, renameSession };
}
