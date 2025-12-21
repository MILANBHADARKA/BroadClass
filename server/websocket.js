import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  createRoom,
  getRoom,
  deleteRoom,
  getAllRooms,
  createWebRtcTransport,
  connectWebRtcTransport,
  createProducer,
  createConsumer,
  resumeConsumer,
  getProducersInRoom,
} from './roomManager.js';
import { getRouter } from './mediasoup.js';

// Store WebSocket connections
const connections = new Map();

/**
 * Initialize WebSocket server
 */
export function initWebSocketServer(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const connectionId = uuidv4();
    connections.set(connectionId, { ws, roomId: null, participantId: null });

    console.log(`[WebSocket] New connection: ${connectionId}`);

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        await handleMessage(connectionId, ws, data);
      } catch (error) {
        console.error('[WebSocket] Error handling message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: error.message,
        }));
      }
    });

    ws.on('close', () => {
      handleDisconnect(connectionId);
    });

    ws.on('error', (error) => {
      console.error('[WebSocket] Connection error:', error);
    });

    // Send connection ID to client
    ws.send(JSON.stringify({
      type: 'connected',
      connectionId,
    }));
  });

  console.log('[WebSocket] Server initialized');
  return wss;
}

/**
 * Handle incoming WebSocket messages
 */
async function handleMessage(connectionId, ws, data) {
  const { type, payload } = data;

  switch (type) {
    case 'createRoom':
      await handleCreateRoom(connectionId, ws, payload);
      break;

    case 'joinRoom':
      await handleJoinRoom(connectionId, ws, payload);
      break;

    case 'leaveRoom':
      await handleLeaveRoom(connectionId);
      break;

    case 'getRtpCapabilities':
      await handleGetRtpCapabilities(ws);
      break;

    case 'createTransport':
      await handleCreateTransport(connectionId, ws, payload);
      break;

    case 'connectTransport':
      await handleConnectTransport(connectionId, ws, payload);
      break;

    case 'produce':
      await handleProduce(connectionId, ws, payload);
      break;

    case 'consume':
      await handleConsume(connectionId, ws, payload);
      break;

    case 'resumeConsumer':
      await handleResumeConsumer(connectionId, ws, payload);
      break;

    case 'getProducers':
      await handleGetProducers(connectionId, ws);
      break;

    case 'chatMessage':
      await handleChatMessage(connectionId, payload);
      break;

    case 'listRooms':
      await handleListRooms(ws);
      break;

    default:
      console.warn(`[WebSocket] Unknown message type: ${type}`);
  }
}

/**
 * Handle create room request
 */
async function handleCreateRoom(connectionId, ws, payload) {
  const { participantId, name } = payload;
  const room = createRoom(participantId);
  
  const connection = connections.get(connectionId);
  connection.roomId = room.id;
  connection.participantId = participantId;

  // Add instructor to room
  room.addParticipant(participantId, ws, true);

  ws.send(JSON.stringify({
    type: 'roomCreated',
    data: {
      roomId: room.id,
      participantId,
      isInstructor: true,
    },
  }));

  console.log(`[Room] Room ${room.id} created by ${participantId}`);
}

/**
 * Handle join room request
 */
async function handleJoinRoom(connectionId, ws, payload) {
  const { roomId, participantId, name } = payload;
  const room = getRoom(roomId);

  if (!room) {
    throw new Error('Room not found');
  }

  const connection = connections.get(connectionId);
  connection.roomId = roomId;
  connection.participantId = participantId;

  // Add participant to room
  room.addParticipant(participantId, ws, false);

  // Notify all participants
  broadcastToRoom(roomId, {
    type: 'participantJoined',
    data: {
      participantId,
      name,
      participantCount: room.getParticipantCount(),
    },
  }, participantId);

  ws.send(JSON.stringify({
    type: 'roomJoined',
    data: {
      roomId,
      participantId,
      isInstructor: false,
      participantCount: room.getParticipantCount(),
    },
  }));

  console.log(`[Room] Participant ${participantId} joined room ${roomId}`);
}

/**
 * Handle leave room request
 */
async function handleLeaveRoom(connectionId) {
  const connection = connections.get(connectionId);
  if (!connection) return;

  const { roomId, participantId } = connection;
  if (!roomId || !participantId) return;

  const room = getRoom(roomId);
  if (room) {
    room.removeParticipant(participantId);

    // Notify other participants
    broadcastToRoom(roomId, {
      type: 'participantLeft',
      data: {
        participantId,
        participantCount: room.getParticipantCount(),
      },
    });

    console.log(`[Room] Participant ${participantId} left room ${roomId}`);

    // Delete room if empty
    if (room.isEmpty()) {
      deleteRoom(roomId);
    }
  }

  connection.roomId = null;
  connection.participantId = null;
}

/**
 * Handle get RTP capabilities request
 */
async function handleGetRtpCapabilities(ws) {
  const router = getRouter();
  const rtpCapabilities = router.rtpCapabilities;

  ws.send(JSON.stringify({
    type: 'rtpCapabilities',
    data: { rtpCapabilities },
  }));
}

/**
 * Handle create transport request
 */
async function handleCreateTransport(connectionId, ws, payload) {
  const connection = connections.get(connectionId);
  const { roomId, participantId } = connection;

  if (!roomId || !participantId) {
    throw new Error('Not in a room');
  }

  const transportParams = await createWebRtcTransport(roomId, participantId);

  ws.send(JSON.stringify({
    type: 'transportCreated',
    data: transportParams,
  }));
}

/**
 * Handle connect transport request
 */
async function handleConnectTransport(connectionId, ws, payload) {
  const connection = connections.get(connectionId);
  const { roomId, participantId } = connection;
  const { transportId, dtlsParameters } = payload;

  if (!roomId || !participantId) {
    throw new Error('Not in a room');
  }

  await connectWebRtcTransport(roomId, participantId, transportId, dtlsParameters);

  ws.send(JSON.stringify({
    type: 'transportConnected',
    data: { transportId },
  }));
}

/**
 * Handle produce request
 */
async function handleProduce(connectionId, ws, payload) {
  const connection = connections.get(connectionId);
  const { roomId, participantId } = connection;
  const { transportId, kind, rtpParameters } = payload;

  if (!roomId || !participantId) {
    throw new Error('Not in a room');
  }

  const { id: producerId } = await createProducer(roomId, participantId, transportId, kind, rtpParameters);

  ws.send(JSON.stringify({
    type: 'produced',
    data: { producerId },
  }));
}

/**
 * Handle consume request
 */
async function handleConsume(connectionId, ws, payload) {
  const connection = connections.get(connectionId);
  const { roomId, participantId } = connection;
  const { transportId, producerId, rtpCapabilities } = payload;

  if (!roomId || !participantId) {
    throw new Error('Not in a room');
  }

  const consumerParams = await createConsumer(roomId, participantId, transportId, producerId, rtpCapabilities);

  ws.send(JSON.stringify({
    type: 'consumed',
    data: consumerParams,
  }));
}

/**
 * Handle resume consumer request
 */
async function handleResumeConsumer(connectionId, ws, payload) {
  const connection = connections.get(connectionId);
  const { roomId, participantId } = connection;
  const { consumerId } = payload;

  if (!roomId || !participantId) {
    throw new Error('Not in a room');
  }

  await resumeConsumer(roomId, participantId, consumerId);

  ws.send(JSON.stringify({
    type: 'consumerResumed',
    data: { consumerId },
  }));
}

/**
 * Handle get producers request
 */
async function handleGetProducers(connectionId, ws) {
  const connection = connections.get(connectionId);
  const { roomId, participantId } = connection;

  if (!roomId || !participantId) {
    throw new Error('Not in a room');
  }

  const producers = getProducersInRoom(roomId, participantId);

  ws.send(JSON.stringify({
    type: 'producers',
    data: { producers },
  }));
}

/**
 * Handle chat message
 */
async function handleChatMessage(connectionId, payload) {
  const connection = connections.get(connectionId);
  const { roomId, participantId } = connection;
  const { message, name } = payload;

  if (!roomId || !participantId) {
    throw new Error('Not in a room');
  }

  broadcastToRoom(roomId, {
    type: 'chatMessage',
    data: {
      participantId,
      name,
      message,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Handle list rooms request
 */
async function handleListRooms(ws) {
  const rooms = getAllRooms();

  ws.send(JSON.stringify({
    type: 'roomList',
    data: { rooms },
  }));
}

/**
 * Handle disconnect
 */
function handleDisconnect(connectionId) {
  console.log(`[WebSocket] Connection closed: ${connectionId}`);
  handleLeaveRoom(connectionId);
  connections.delete(connectionId);
}

/**
 * Broadcast message to all participants in a room
 */
function broadcastToRoom(roomId, message, excludeParticipantId = null) {
  const room = getRoom(roomId);
  if (!room) return;

  room.getAllParticipants().forEach(participant => {
    if (participant.id !== excludeParticipantId && participant.ws.readyState === 1) {
      participant.ws.send(JSON.stringify(message));
    }
  });
}
