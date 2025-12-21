import { Device } from 'mediasoup-client';

class WebRTCClient {
  constructor() {
    this.ws = null;
    this.device = null;
    this.producerTransport = null;
    this.consumerTransport = null;
    this.producers = new Map();
    this.consumers = new Map();
    this.localStream = null;
    this.isInstructor = false;
    this.roomId = null;
    this.participantId = null;
    this.username = null;
    
    this.callbacks = {
      onConnected: null,
      onRoomCreated: null,
      onRoomJoined: null,
      onParticipantJoined: null,
      onParticipantLeft: null,
      onNewProducer: null,
      onChatMessage: null,
      onError: null,
    };
  }

  /**
   * Connect to the WebSocket server
   */
  connect(serverUrl) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(serverUrl);

      this.ws.onopen = () => {
        console.log('[WebRTC] Connected to server');
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error('[WebRTC] WebSocket error:', error);
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('[WebRTC] Disconnected from server');
      };

      // Wait for connection
      const checkConnection = setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
          clearInterval(checkConnection);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(data) {
    const message = JSON.parse(data);
    const { type, data: payload } = message;

    console.log('[WebRTC] Received message:', type, payload);

    switch (type) {
      case 'connected':
        if (this.callbacks.onConnected) {
          this.callbacks.onConnected(payload);
        }
        break;

      case 'roomCreated':
        this.roomId = payload.roomId;
        this.participantId = payload.participantId;
        this.isInstructor = payload.isInstructor;
        if (this.callbacks.onRoomCreated) {
          this.callbacks.onRoomCreated(payload);
        }
        break;

      case 'roomJoined':
        this.roomId = payload.roomId;
        this.participantId = payload.participantId;
        this.isInstructor = payload.isInstructor;
        if (this.callbacks.onRoomJoined) {
          this.callbacks.onRoomJoined(payload);
        }
        break;

      case 'participantJoined':
        if (this.callbacks.onParticipantJoined) {
          this.callbacks.onParticipantJoined(payload);
        }
        break;

      case 'participantLeft':
        if (this.callbacks.onParticipantLeft) {
          this.callbacks.onParticipantLeft(payload);
        }
        break;

      case 'rtpCapabilities':
        this.handleRtpCapabilities(payload.rtpCapabilities);
        break;

      case 'transportCreated':
        this.handleTransportCreated(payload);
        break;

      case 'transportConnected':
        console.log('[WebRTC] Transport connected');
        break;

      case 'produced':
        console.log('[WebRTC] Producer created:', payload.producerId);
        break;

      case 'newProducer':
        if (this.callbacks.onNewProducer) {
          this.callbacks.onNewProducer(payload);
        }
        break;

      case 'producers':
        this.handleProducers(payload.producers);
        break;

      case 'consumed':
        this.handleConsumed(payload);
        break;

      case 'consumerResumed':
        console.log('[WebRTC] Consumer resumed:', payload.consumerId);
        break;

      case 'chatMessage':
        if (this.callbacks.onChatMessage) {
          this.callbacks.onChatMessage(payload);
        }
        break;

      case 'error':
        console.error('[WebRTC] Server error:', message.error);
        if (this.callbacks.onError) {
          this.callbacks.onError(message.error);
        }
        break;

      default:
        console.warn('[WebRTC] Unknown message type:', type);
    }
  }

  /**
   * Send message to server
   */
  send(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  /**
   * Create a new room (instructor)
   */
  async createRoom(username) {
    this.username = username;
    this.participantId = this.generateId();
    this.send('createRoom', { participantId: this.participantId, name: username });
  }

  /**
   * Join an existing room (student)
   */
  async joinRoom(roomId, username) {
    this.username = username;
    this.participantId = this.generateId();
    this.send('joinRoom', { roomId, participantId: this.participantId, name: username });
  }

  /**
   * Leave the current room
   */
  leaveRoom() {
    this.send('leaveRoom', {});
    this.cleanup();
  }

  /**
   * Initialize device and load RTP capabilities
   */
  async initializeDevice() {
    try {
      this.device = new Device();
      
      // Request RTP capabilities from server
      this.send('getRtpCapabilities', {});
      
      // Wait for RTP capabilities
      return new Promise((resolve) => {
        const originalCallback = this.handleRtpCapabilities.bind(this);
        this.handleRtpCapabilities = async (rtpCapabilities) => {
          await this.device.load({ routerRtpCapabilities: rtpCapabilities });
          console.log('[WebRTC] Device loaded with RTP capabilities');
          this.handleRtpCapabilities = originalCallback;
          resolve();
        };
      });
    } catch (error) {
      console.error('[WebRTC] Error initializing device:', error);
      throw error;
    }
  }

  /**
   * Get user media (camera and microphone)
   */
  async getUserMedia(videoEnabled = true, audioEnabled = true) {
    try {
      const constraints = {
        video: videoEnabled ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        } : false,
        audio: audioEnabled ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } : false,
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[WebRTC] Got user media');
      return this.localStream;
    } catch (error) {
      console.error('[WebRTC] Error getting user media:', error);
      throw error;
    }
  }

  /**
   * Create producer transport
   */
  async createProducerTransport() {
    this.send('createTransport', {});
    
    return new Promise((resolve) => {
      const originalCallback = this.handleTransportCreated.bind(this);
      this.handleTransportCreated = async (params) => {
        this.producerTransport = this.device.createSendTransport(params);
        
        this.producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            this.send('connectTransport', {
              transportId: this.producerTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (error) {
            errback(error);
          }
        });

        this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
          try {
            this.send('produce', {
              transportId: this.producerTransport.id,
              kind,
              rtpParameters,
            });
            
            // Wait for produced message
            const waitForProduced = (event) => {
              const message = JSON.parse(event.data);
              if (message.type === 'produced') {
                this.ws.removeEventListener('message', waitForProduced);
                callback({ id: message.data.producerId });
              }
            };
            this.ws.addEventListener('message', waitForProduced);
          } catch (error) {
            errback(error);
          }
        });

        this.handleTransportCreated = originalCallback;
        resolve();
      };
    });
  }

  /**
   * Create consumer transport
   */
  async createConsumerTransport() {
    this.send('createTransport', {});
    
    return new Promise((resolve) => {
      const originalCallback = this.handleTransportCreated.bind(this);
      this.handleTransportCreated = async (params) => {
        this.consumerTransport = this.device.createRecvTransport(params);
        
        this.consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            this.send('connectTransport', {
              transportId: this.consumerTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (error) {
            errback(error);
          }
        });

        this.handleTransportCreated = originalCallback;
        resolve();
      };
    });
  }

  /**
   * Produce media (send video/audio)
   */
  async produce(track) {
    try {
      if (!this.producerTransport) {
        await this.createProducerTransport();
      }

      const producer = await this.producerTransport.produce({ track });
      this.producers.set(producer.id, producer);
      
      console.log('[WebRTC] Producing:', producer.kind);
      return producer;
    } catch (error) {
      console.error('[WebRTC] Error producing:', error);
      throw error;
    }
  }

  /**
   * Consume media (receive video/audio)
   */
  async consume(producerId) {
    try {
      if (!this.consumerTransport) {
        await this.createConsumerTransport();
      }

      this.send('consume', {
        transportId: this.consumerTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      });

      return new Promise((resolve) => {
        const originalCallback = this.handleConsumed.bind(this);
        this.handleConsumed = async (params) => {
          const consumer = await this.consumerTransport.consume(params);
          this.consumers.set(consumer.id, consumer);
          
          // Resume consumer
          this.send('resumeConsumer', { consumerId: consumer.id });
          
          console.log('[WebRTC] Consuming:', consumer.kind);
          
          this.handleConsumed = originalCallback;
          resolve(consumer);
        };
      });
    } catch (error) {
      console.error('[WebRTC] Error consuming:', error);
      throw error;
    }
  }

  /**
   * Get existing producers in the room
   */
  getProducers() {
    this.send('getProducers', {});
  }

  /**
   * Handle producers list
   */
  async handleProducers(producers) {
    for (const producer of producers) {
      if (this.callbacks.onNewProducer) {
        this.callbacks.onNewProducer(producer);
      }
    }
  }

  /**
   * Handle RTP capabilities
   */
  handleRtpCapabilities(rtpCapabilities) {
    // Placeholder - will be overridden
  }

  /**
   * Handle transport created
   */
  handleTransportCreated(params) {
    // Placeholder - will be overridden
  }

  /**
   * Handle consumed
   */
  handleConsumed(params) {
    // Placeholder - will be overridden
  }

  /**
   * Send chat message
   */
  sendChatMessage(message) {
    this.send('chatMessage', {
      message,
      name: this.username,
    });
  }

  /**
   * Toggle video track
   */
  toggleVideo() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return videoTrack.enabled;
      }
    }
    return false;
  }

  /**
   * Toggle audio track
   */
  toggleAudio() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.producers.forEach(producer => producer.close());
    this.producers.clear();

    this.consumers.forEach(consumer => consumer.close());
    this.consumers.clear();

    if (this.producerTransport) {
      this.producerTransport.close();
      this.producerTransport = null;
    }

    if (this.consumerTransport) {
      this.consumerTransport.close();
      this.consumerTransport = null;
    }

    this.roomId = null;
    this.participantId = null;
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }
}

export default WebRTCClient;
