import WebRTCClient from './webrtc.js';

// Configuration
const WS_URL = 'ws://localhost:3000';

// Global state
const client = new WebRTCClient();
let isVideoEnabled = true;
let isAudioEnabled = true;
const remoteVideos = new Map();

// DOM elements
const lobbyScreen = document.getElementById('lobby');
const roomScreen = document.getElementById('room');
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('roomId');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const roomTitle = document.getElementById('roomTitle');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const participantCount = document.getElementById('participantCount');
const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const toggleAudioBtn = document.getElementById('toggleAudioBtn');
const videoIcon = document.getElementById('videoIcon');
const audioIcon = document.getElementById('audioIcon');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');

// Event listeners
createRoomBtn.addEventListener('click', handleCreateRoom);
joinRoomBtn.addEventListener('click', handleJoinRoom);
leaveRoomBtn.addEventListener('click', handleLeaveRoom);
toggleVideoBtn.addEventListener('click', handleToggleVideo);
toggleAudioBtn.addEventListener('click', handleToggleAudio);
sendMessageBtn.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleSendMessage();
  }
});

// Setup WebRTC callbacks
client.callbacks.onRoomCreated = async (data) => {
  console.log('Room created:', data);
  showRoomScreen(data.roomId, true);
  await initializeMedia();
  addChatMessage('System', 'Room created successfully. Share the Room ID with students.', true);
};

client.callbacks.onRoomJoined = async (data) => {
  console.log('Room joined:', data);
  showRoomScreen(data.roomId, false);
  await initializeMedia();
  addChatMessage('System', 'Joined room successfully.', true);
  
  // Get existing producers
  client.getProducers();
};

client.callbacks.onParticipantJoined = (data) => {
  console.log('Participant joined:', data);
  participantCount.textContent = `${data.participantCount} participant${data.participantCount !== 1 ? 's' : ''}`;
  addChatMessage('System', `${data.name} joined the room.`, true);
};

client.callbacks.onParticipantLeft = (data) => {
  console.log('Participant left:', data);
  participantCount.textContent = `${data.participantCount} participant${data.participantCount !== 1 ? 's' : ''}`;
  
  // Remove remote video
  removeRemoteVideo(data.participantId);
};

client.callbacks.onNewProducer = async (data) => {
  console.log('New producer:', data);
  await consumeMedia(data.producerId, data.participantId, data.kind, data.isInstructor);
};

client.callbacks.onChatMessage = (data) => {
  addChatMessage(data.name, data.message, false);
};

client.callbacks.onError = (error) => {
  console.error('WebRTC error:', error);
  alert(`Error: ${error}`);
};

/**
 * Initialize the application
 */
async function init() {
  try {
    console.log('Connecting to server...');
    await client.connect(WS_URL);
    console.log('Connected to server');
  } catch (error) {
    console.error('Failed to connect:', error);
    alert('Failed to connect to server. Please make sure the server is running.');
  }
}

/**
 * Handle create room
 */
async function handleCreateRoom() {
  const username = usernameInput.value.trim();
  
  if (!username) {
    alert('Please enter your name');
    return;
  }

  try {
    await client.createRoom(username);
  } catch (error) {
    console.error('Error creating room:', error);
    alert('Failed to create room');
  }
}

/**
 * Handle join room
 */
async function handleJoinRoom() {
  const username = usernameInput.value.trim();
  const roomId = roomIdInput.value.trim();
  
  if (!username) {
    alert('Please enter your name');
    return;
  }
  
  if (!roomId) {
    alert('Please enter a room ID');
    return;
  }

  try {
    await client.joinRoom(roomId, username);
  } catch (error) {
    console.error('Error joining room:', error);
    alert('Failed to join room');
  }
}

/**
 * Handle leave room
 */
function handleLeaveRoom() {
  client.leaveRoom();
  
  // Clear remote videos
  remoteVideos.forEach((_, participantId) => {
    removeRemoteVideo(participantId);
  });
  remoteVideos.clear();
  
  // Stop local video
  if (localVideo.srcObject) {
    localVideo.srcObject.getTracks().forEach(track => track.stop());
    localVideo.srcObject = null;
  }
  
  // Reset state
  isVideoEnabled = true;
  isAudioEnabled = true;
  
  // Show lobby
  showLobbyScreen();
}

/**
 * Show lobby screen
 */
function showLobbyScreen() {
  lobbyScreen.classList.add('active');
  lobbyScreen.classList.remove('hidden');
  roomScreen.classList.remove('active');
  roomScreen.classList.add('hidden');
}

/**
 * Show room screen
 */
function showRoomScreen(roomId, isInstructor) {
  lobbyScreen.classList.remove('active');
  lobbyScreen.classList.add('hidden');
  roomScreen.classList.add('active');
  roomScreen.classList.remove('hidden');
  
  roomTitle.textContent = isInstructor ? 'Instructor Room' : 'Student View';
  roomIdDisplay.textContent = `Room ID: ${roomId}`;
  
  // Update local video label
  const localVideoLabel = document.querySelector('#localVideoWrapper .video-label');
  localVideoLabel.textContent = isInstructor ? 'You (Instructor)' : 'You (Student)';
  
  // Clear chat
  chatMessages.innerHTML = '';
}

/**
 * Initialize media (camera and microphone)
 */
async function initializeMedia() {
  try {
    // Initialize device
    await client.initializeDevice();
    
    // Get user media
    const stream = await client.getUserMedia(true, true);
    localVideo.srcObject = stream;
    
    // Produce video and audio
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];
    
    if (videoTrack) {
      await client.produce(videoTrack);
    }
    
    if (audioTrack) {
      await client.produce(audioTrack);
    }
    
    console.log('Media initialized');
  } catch (error) {
    console.error('Error initializing media:', error);
    alert('Failed to access camera/microphone. Please check permissions.');
  }
}

/**
 * Consume media from remote producer
 */
async function consumeMedia(producerId, participantId, kind, isInstructor) {
  try {
    const consumer = await client.consume(producerId);
    const track = consumer.track;
    
    // Get or create remote video element
    let videoWrapper = remoteVideos.get(participantId);
    if (!videoWrapper) {
      videoWrapper = createRemoteVideo(participantId, isInstructor);
      remoteVideos.set(participantId, videoWrapper);
    }
    
    const videoElement = videoWrapper.querySelector('video');
    
    // Add track to video element
    if (!videoElement.srcObject) {
      videoElement.srcObject = new MediaStream();
    }
    
    videoElement.srcObject.addTrack(track);
    
    console.log(`Consuming ${kind} from ${participantId}`);
  } catch (error) {
    console.error('Error consuming media:', error);
  }
}

/**
 * Create remote video element
 */
function createRemoteVideo(participantId, isInstructor) {
  const videoWrapper = document.createElement('div');
  videoWrapper.className = 'video-wrapper';
  videoWrapper.id = `remote-${participantId}`;
  
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  
  const label = document.createElement('div');
  label.className = 'video-label';
  label.textContent = isInstructor ? 'Instructor' : 'Student';
  
  videoWrapper.appendChild(video);
  videoWrapper.appendChild(label);
  videoGrid.appendChild(videoWrapper);
  
  return videoWrapper;
}

/**
 * Remove remote video element
 */
function removeRemoteVideo(participantId) {
  const videoWrapper = remoteVideos.get(participantId);
  if (videoWrapper) {
    videoWrapper.remove();
    remoteVideos.delete(participantId);
  }
}

/**
 * Handle toggle video
 */
function handleToggleVideo() {
  isVideoEnabled = client.toggleVideo();
  videoIcon.textContent = isVideoEnabled ? '📹' : '🚫';
  toggleVideoBtn.classList.toggle('disabled', !isVideoEnabled);
}

/**
 * Handle toggle audio
 */
function handleToggleAudio() {
  isAudioEnabled = client.toggleAudio();
  audioIcon.textContent = isAudioEnabled ? '🎤' : '🔇';
  toggleAudioBtn.classList.toggle('disabled', !isAudioEnabled);
}

/**
 * Handle send message
 */
function handleSendMessage() {
  const message = chatInput.value.trim();
  
  if (!message) {
    return;
  }
  
  client.sendChatMessage(message);
  chatInput.value = '';
}

/**
 * Add chat message to UI
 */
function addChatMessage(name, message, isSystem = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  
  if (isSystem) {
    messageDiv.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-message-name" style="color: #a0aec0;">${name}</span>
      </div>
      <div class="chat-message-text" style="font-style: italic;">${message}</div>
    `;
  } else {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    messageDiv.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-message-name">${name}</span>
        <span class="chat-message-time">${time}</span>
      </div>
      <div class="chat-message-text">${message}</div>
    `;
  }
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Initialize the application
init();
