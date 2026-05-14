/**
 * Classroom access middleware
 *
 * Resolves the requesting user's relationship to a classroom (owner-teacher
 * vs. enrolled student) and rejects with 403/404/503 if they have neither.
 *
 * Use after verifyToken. Attaches:
 *   req.classroom              – the Classroom row
 *   req.userAccess.isTeacher   – true if req.user owns the classroom
 *   req.userAccess.isStudent   – true if req.user has an enrollment row
 *   req.userAccess.enrollment  – the Enrollment row, if any
 *
 * @param {(req: import('express').Request) => string} getClassroomId
 *   Resolver that returns the classroom id given the request — typically
 *   `(req) => req.params.classroomId` or `(req) => req.body.classroomId`.
 */
import prisma from '../services/prisma.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('classroom-access');

export function verifyClassroomAccess(getClassroomId) {
  return async function (req, res, next) {
    try {
      const classroomId = getClassroomId(req);
      if (!classroomId) {
        return res.status(400).json({ error: 'classroomId is required' });
      }

      const classroom = await prisma.classroom.findUnique({
        where: { id: classroomId },
      });
      if (!classroom) {
        return res.status(404).json({ error: 'Classroom not found' });
      }

      const isTeacher = classroom.teacherId === req.user.id;
      let enrollment = null;
      if (!isTeacher) {
        enrollment = await prisma.enrollment.findUnique({
          where: {
            classroomId_studentId: {
              classroomId,
              studentId: req.user.id,
            },
          },
        });
      }
      const isStudent = !!enrollment;

      if (!isTeacher && !isStudent) {
        return res.status(403).json({ error: 'Access denied' });
      }

      req.classroom = classroom;
      req.userAccess = { isTeacher, isStudent, enrollment };
      next();
    } catch (err) {
      // Fail closed on DB outages — same posture as the inline checks this
      // middleware replaces (see /api/best-edge, /api/best-server).
      log.error('Classroom access check failed:', err.message);
      return res.status(503).json({ error: 'Access check temporarily unavailable, please retry' });
    }
  };
}

export default verifyClassroomAccess;
