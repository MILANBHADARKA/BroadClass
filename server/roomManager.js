import { v4 as uuidv4 } from 'uuid';
import { getRouter } from './mediasoup.js';
import { config } from './config.js';

// Store all rooms
const rooms = new Map();

/**
 * Room class to manage video call rooms
 */
class Room {
  constructor(id, instructorId) {
    this.id = id;
    this.instructorId = instructorId;
    this.participants = new Map(); // Map of participantId -> Participant object
    this.createdAt = new Date();
  }

  addParticipant(participantId, ws, isInstructor = false) {
    const participant = {
      id: participantId,
      ws,
      isInstructor,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      rtpCapabilities: null,
    };
    this.participants.set(participantId, participant);
    return participant;
  }

  removeParticipant(participantId) {
    const participant = this.participants.get(participantId);
    if (participant) {
      // Close all transports
      participant.transports.forEach(transport => transport.close());
      // Close all producers
      participant.producers.forEach(producer => producer.close());
      // Close all consumers
      participant.consumers.forEach(consumer => consumer.close());
      
      this.participants.delete(participantId);
    }
  }

  getParticipant(participantId) {
    return this.participants.get(participantId);
  }

  getAllParticipants() {
    return Array.from(this.participants.values());
  }

  getParticipantCount() {
    return this.participants.size;
  }

  isEmpty() {
    return this.participants.size === 0;
  }
}

/**
 * Create a new room
 */
export function createRoom(instructorId) {
  const roomId = uuidv4();
  const room = new Room(roomId, instructorId);
  rooms.set(roomId, room);
  console.log(`[Room] Created room ${roomId} by instructor ${instructorId}`);
  return room;
}

/**
 * Get a room by ID
 */
export function getRoom(roomId) {
  return rooms.get(roomId);
}

/**
 * Delete a room
 */
export function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    // Clean up all participants
    room.getAllParticipants().forEach(participant => {
      room.removeParticipant(participant.id);
    });
    rooms.delete(roomId);
    console.log(`[Room] Deleted room ${roomId}`);
  }
}

/**
 * Get all rooms
 */
export function getAllRooms() {
  return Array.from(rooms.values()).map(room => ({
    id: room.id,
    instructorId: room.instructorId,
    participantCount: room.getParticipantCount(),
    createdAt: room.createdAt,
  }));
}

/**
 * Create WebRTC transport for a participant
 */
export async function createWebRtcTransport(roomId, participantId) {
  try {
    const router = getRouter();
    const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);

    const room = getRoom(roomId);
    const participant = room.getParticipant(participantId);
    participant.transports.set(transport.id, transport);

    console.log(`[Transport] Created transport ${transport.id} for participant ${participantId}`);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  } catch (error) {
    console.error('[Transport] Error creating transport:', error);
    throw error;
  }
}

/**
 * Connect WebRTC transport
 */
export async function connectWebRtcTransport(roomId, participantId, transportId, dtlsParameters) {
  try {
    const room = getRoom(roomId);
    const participant = room.getParticipant(participantId);
    const transport = participant.transports.get(transportId);

    if (!transport) {
      throw new Error('Transport not found');
    }

    await transport.connect({ dtlsParameters });
    console.log(`[Transport] Connected transport ${transportId} for participant ${participantId}`);
  } catch (error) {
    console.error('[Transport] Error connecting transport:', error);
    throw error;
  }
}

/**
 * Create producer for sending media
 */
export async function createProducer(roomId, participantId, transportId, kind, rtpParameters) {
  try {
    const room = getRoom(roomId);
    const participant = room.getParticipant(participantId);
    const transport = participant.transports.get(transportId);

    if (!transport) {
      throw new Error('Transport not found');
    }

    const producer = await transport.produce({ kind, rtpParameters });
    participant.producers.set(producer.id, producer);

    console.log(`[Producer] Created ${kind} producer ${producer.id} for participant ${participantId}`);

    // Notify other participants about new producer
    notifyNewProducer(roomId, participantId, producer.id, kind);

    return {
      id: producer.id,
    };
  } catch (error) {
    console.error('[Producer] Error creating producer:', error);
    throw error;
  }
}

/**
 * Create consumer for receiving media
 */
export async function createConsumer(roomId, participantId, transportId, producerId, rtpCapabilities) {
  try {
    const router = getRouter();
    const room = getRoom(roomId);
    const participant = room.getParticipant(participantId);
    const transport = participant.transports.get(transportId);

    if (!transport) {
      throw new Error('Transport not found');
    }

    // Check if we can consume
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume');
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Start paused
    });

    participant.consumers.set(consumer.id, consumer);

    console.log(`[Consumer] Created consumer ${consumer.id} for participant ${participantId}`);

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  } catch (error) {
    console.error('[Consumer] Error creating consumer:', error);
    throw error;
  }
}

/**
 * Resume consumer
 */
export async function resumeConsumer(roomId, participantId, consumerId) {
  try {
    const room = getRoom(roomId);
    const participant = room.getParticipant(participantId);
    const consumer = participant.consumers.get(consumerId);

    if (!consumer) {
      throw new Error('Consumer not found');
    }

    await consumer.resume();
    console.log(`[Consumer] Resumed consumer ${consumerId}`);
  } catch (error) {
    console.error('[Consumer] Error resuming consumer:', error);
    throw error;
  }
}

/**
 * Get all producers in a room except for a specific participant
 */
export function getProducersInRoom(roomId, excludeParticipantId) {
  const room = getRoom(roomId);
  if (!room) return [];

  const producers = [];
  room.getAllParticipants().forEach(participant => {
    if (participant.id !== excludeParticipantId) {
      participant.producers.forEach((producer, producerId) => {
        producers.push({
          producerId,
          participantId: participant.id,
          kind: producer.kind,
          isInstructor: participant.isInstructor,
        });
      });
    }
  });

  return producers;
}

/**
 * Notify other participants about new producer
 */
function notifyNewProducer(roomId, participantId, producerId, kind) {
  const room = getRoom(roomId);
  if (!room) return;

  const producer = room.getParticipant(participantId);
  
  room.getAllParticipants().forEach(participant => {
    if (participant.id !== participantId && participant.ws.readyState === 1) {
      participant.ws.send(JSON.stringify({
        type: 'newProducer',
        data: {
          producerId,
          participantId,
          kind,
          isInstructor: producer.isInstructor,
        },
      }));
    }
  });
}
