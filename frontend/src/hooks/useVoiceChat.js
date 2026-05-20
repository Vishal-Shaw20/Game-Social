// src/hooks/useVoiceChat.js
import { useEffect, useRef, useState } from "react";
// import { Device } from "mediasoup-client";  // disabled — mediasoup removed from deps

const SPEAKING_THRESHOLD = 0.02;
console.log("[voice] useVoiceChat loaded");

/* ───────────────────────── Shared Store ───────────────────────── */
// Global store to share voice chat state across components for the same gameId
const voiceChatStore = new Map(); // gameId -> { state, refs, subscribers }

function getOrCreateVoiceChat(gameId) {
  if (!gameId) return null;
  
  if (!voiceChatStore.has(gameId)) {
    voiceChatStore.set(gameId, {
      state: {
        joined: false,
        micOn: false,
        participants: [],
      },
      refs: {
        device: null,
        sendTransport: null,
        recvTransport: null,
        micProducer: null,
        micStream: null,
        analysers: new Map(),
        consumers: new Map(),
        audioElements: new Map(),
        roomId: null,
        pendingProducers: []
      },
      subscribers: new Set(), // Components using this voice chat
    });
  }
  
  return voiceChatStore.get(gameId);
}

function notifySubscribers(gameId, updater) {
  const store = voiceChatStore.get(gameId);
  if (!store) return;
  
  if (typeof updater === 'function') {
    store.state = { ...store.state, ...updater(store.state) };
  } else {
    store.state = { ...store.state, ...updater };
  }
  
  // Notify all subscribers
  store.subscribers.forEach(callback => callback(store.state));
}

/* ───────────────────────── helpers ───────────────────────── */

function createAnalyser(stream, onLevel) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  let active = true;

  const loop = () => {
    if (!active) return;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length) / 255;
    onLevel(rms > SPEAKING_THRESHOLD);
    requestAnimationFrame(loop);
  };

  loop();
  return () => {
    active = false;
    source.disconnect();
  };
}

/* ───────────────────────── hook ───────────────────────── */

export function useVoiceChat(socket, gameId, currentUser, requireLogin) {
  // Get or create shared voice chat instance for this gameId
  const shared = gameId ? getOrCreateVoiceChat(gameId) : null;
  
  // Use shared state if available, otherwise local state
  const [localState, setLocalState] = useState(
    shared ? shared.state : { joined: false, micOn: false, participants: [] }
  );
  
  // Subscribe to shared state updates
  useEffect(() => {
    if (!shared) return;
    
    const updateState = (newState) => {
      setLocalState(newState);
    };
    
    shared.subscribers.add(updateState);
    
    return () => {
      shared.subscribers.delete(updateState);
      // Clean up store if no more subscribers and not joined
      if (shared.subscribers.size === 0 && !shared.state.joined) {
        voiceChatStore.delete(gameId);
      }
    };
  }, [gameId, shared]);
  
  const joined = localState.joined;
  const micOn = localState.micOn;
  const participants = localState.participants;
  
  // Use shared refs if available
  const refs = shared ? shared.refs : useRef({
    device: null,
    sendTransport: null,
    recvTransport: null,
    micProducer: null,
    micStream: null,
    analysers: new Map(),
    consumers: new Map(),
    audioElements: new Map(),
    roomId: null,
    pendingProducers: []
  }).current;
  
  // Helper to update shared state
  const updateSharedState = (updater) => {
    if (shared) {
      notifySubscribers(gameId, updater);
    } else {
      setLocalState(prev => typeof updater === 'function' ? updater(prev) : { ...prev, ...updater });
    }
  };

  /* ---------- socket emit helper ---------- */
  const emit = (event, data) =>
    new Promise((res, rej) => {
      if (!socket || !socket.connected) {
        rej(new Error("Socket not connected"));
        return;
      }
      
      const timeout = setTimeout(() => {
        rej(new Error(`Timeout waiting for ${event} response`));
      }, 10000); // 10 second timeout
      
      socket.emit(event, data, (resp) => {
        clearTimeout(timeout);
        if (resp?.error) {
          rej(new Error(resp.error));
        } else {
          res(resp);
        }
      });
    });

  /* ---------- participant helpers ---------- */
  const updateParticipant = (socketId, updates) => {
    updateSharedState((prev) => ({
      participants: prev.participants.map((p) =>
        p.socketId === socketId ? { ...p, ...updates } : p
      )
    }));
  };

  /* ---------- consume producer helper ---------- */
  const consumeProducer = async ({ producerId, socketId, name }) => {
    const activeRefs = shared ? shared.refs : refs;
    
    if (!activeRefs.recvTransport || !activeRefs.device || !activeRefs.roomId) {
      console.warn("[voice] cannot consume - missing transport/device/roomId, queuing");
      activeRefs.pendingProducers.push({ producerId, socketId, name });
      return;
    }

    // Skip if this is our own producer
    if (socketId === socket?.id) {
      console.log("[voice] skipping own producer", producerId);
      return;
    }

    // Skip if we already have a consumer for this producer
    if (activeRefs.consumers.has(producerId)) {
      console.log("[voice] already consuming", producerId);
      return;
    }

    try {
      console.log("[voice] consuming producer", producerId, "from", socketId);
      const { params } = await emit("consume", {
        roomId: activeRefs.roomId,
        consumerTransportId: activeRefs.recvTransport.id,
        producerId,
        rtpCapabilities: activeRefs.device.rtpCapabilities
      });

      const consumer = await activeRefs.recvTransport.consume(params);
      activeRefs.consumers.set(producerId, consumer);

      const audio = document.createElement("audio");
      audio.srcObject = new MediaStream([consumer.track]);
      audio.autoplay = true;
      audio.volume = 1;
      activeRefs.audioElements.set(socketId, audio);
      console.log("[voice] audio element created for", socketId);

      // Add participant if not already present
      updateSharedState((prev) => {
        if (prev.participants.some(p => p.socketId === socketId)) return prev;
        return {
          participants: [
            ...prev.participants,
            {
              socketId,
              name: name || "User",
              muted: false,
              speaking: false,
              volume: 1
            }
          ]
        };
      });
    } catch (err) {
      console.error("[voice] failed to consume producer", err);
    }
  };

  /* ───────────────────────── SOCKET EVENTS ───────────────────────── */
  // Register socket events only once per gameId
  useEffect(() => {
    if (!socket || !gameId || !shared) return;
    
    // Check if events are already registered for this gameId
    if (shared.refs.socketEventsRegistered) {
      console.log("[voice] socket events already registered for", gameId);
      return;
    }
    
    shared.refs.socketEventsRegistered = true;

    const onVoiceState = ({ participants }) => {
      console.log("[voice] voice-state", participants);
      updateSharedState({ participants });
    };

    const onNewProducer = async (data) => {
      console.log("[voice] new-producer event", data);
      // Use shared refs
      const sharedRefs = shared.refs;
      if (!sharedRefs.recvTransport || !sharedRefs.device || !sharedRefs.roomId) {
        console.warn("[voice] cannot consume - missing transport/device/roomId, queuing");
        sharedRefs.pendingProducers.push(data);
        return;
      }
      await consumeProducer(data);
    };

    const onVoiceLeft = ({ socketId }) => {
      console.log("[voice] voice-left", socketId);
      const sharedRefs = shared.refs;
      
      // Clean up audio element
      const audio = sharedRefs.audioElements.get(socketId);
      if (audio) {
        audio.pause();
        audio.srcObject = null;
        sharedRefs.audioElements.delete(socketId);
      }

      // Clean up consumers for this socket (find by participant)
      // We'll clean up all consumers when participant is removed
      // The backend handles the actual consumer closure

      updateSharedState((prev) => ({
        participants: prev.participants.filter(p => p.socketId !== socketId)
      }));
    };

    const onProducerClosed = ({ producerId }) => {
      console.log("[voice] producer-closed", producerId);
      const sharedRefs = shared.refs;
      
      // Find and close the consumer for this producer
      const consumer = sharedRefs.consumers.get(producerId);
      if (consumer) {
        try {
          consumer.close();
        } catch (err) {
          console.warn("[voice] error closing consumer on producer close", err);
        }
        sharedRefs.consumers.delete(producerId);
      }

      // Find participant by producerId (we need to track this better)
      // For now, the backend will emit voice-left which handles cleanup
    };

    const onSpeakingUpdate = ({ socketId, speaking }) => {
      console.log("[voice] speaking update", socketId, speaking);
      // Skip if this is our own update (we already updated locally)
      if (socketId === socket?.id) return;
      updateParticipant(socketId, { speaking });
    };

    socket.on("voice-state", onVoiceState);
    socket.on("new-producer", onNewProducer);
    socket.on("voice-left", onVoiceLeft);
    socket.on("producer-closed", onProducerClosed);
    socket.on("voice-speaking", onSpeakingUpdate);

    return () => {
      // Only unregister if this is the last subscriber
      if (shared && shared.subscribers.size <= 1) {
        socket.off("voice-state", onVoiceState);
        socket.off("new-producer", onNewProducer);
        socket.off("voice-left", onVoiceLeft);
        socket.off("producer-closed", onProducerClosed);
        socket.off("voice-speaking", onSpeakingUpdate);
        if (shared.refs) {
          shared.refs.socketEventsRegistered = false;
        }
      }
    };
  }, [socket, gameId, shared]);

  /* ───────────────────────── JOIN ───────────────────────── */

  const join = async () => {
    if (!currentUser) return requireLogin("join voice");
    if (!socket || !socket.connected) {
      console.error("[voice] cannot join - socket not connected");
      return;
    }

    const activeRefs = shared ? shared.refs : refs;

    try {
      console.log("[voice] join clicked", { gameId, socketId: socket.id });

      console.log("[voice] step 1: joining room...");
      const { roomId } = await emit("voice-join", { rawgId: gameId });
      activeRefs.roomId = roomId;
      console.log("[voice] step 1 complete: roomId =", roomId);

      console.log("[voice] step 2: getting RTP capabilities...");
      const { rtpCapabilities } = await emit("getRtpCapabilities", { roomId });
      console.log("[voice] step 2 complete: got RTP capabilities");

      console.log("[voice] step 3: loading device...");
      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      activeRefs.device = device;
      console.log("[voice] step 3 complete: device loaded");

      /* ───────────── RECV TRANSPORT (MUST BE FIRST) ───────────── */
      console.log("[voice] step 4: creating recv transport...");
      const recvData = await emit("createWebRtcTransport", { roomId });
      const recvTransport = device.createRecvTransport(recvData.params);
      activeRefs.recvTransport = recvTransport;
      console.log("[voice] step 4 complete: recv transport created", recvTransport.id);

      recvTransport.on("connect", async ({ dtlsParameters }, cb, errCb) => {
        try {
          await emit("connect-transport", {
            roomId,
            transportId: recvTransport.id,
            dtlsParameters
          });
          cb();
        } catch (err) {
          errCb(err);
        }
      });

      /* ───────────── SEND TRANSPORT ───────────── */
      console.log("[voice] step 5: creating send transport...");
      const sendData = await emit("createWebRtcTransport", { roomId });
      const sendTransport = device.createSendTransport(sendData.params);
      activeRefs.sendTransport = sendTransport;
      console.log("[voice] step 5 complete: send transport created", sendTransport.id);

      sendTransport.on("connect", async ({ dtlsParameters }, cb, errCb) => {
        try {
          await emit("connect-transport", {
            roomId,
            transportId: sendTransport.id,
            dtlsParameters
          });
          cb();
        } catch (err) {
          errCb(err);
        }
      });

      sendTransport.on("produce", async ({ kind, rtpParameters }, cb, errCb) => {
        try {
          const { id } = await emit("produce", {
            roomId,
            transportId: sendTransport.id,
            kind,
            rtpParameters
          });
          cb({ id });
        } catch (err) {
          console.error("[voice] produce error", err);
          errCb(err);
        }
      });

      sendTransport.on("connectionstatechange", (state) => {
        console.log("[voice] send transport state:", state);
        if (state === "failed" || state === "disconnected") {
          console.error("[voice] send transport connection failed");
        }
      });

      recvTransport.on("connectionstatechange", (state) => {
        console.log("[voice] recv transport state:", state);
        if (state === "failed" || state === "disconnected") {
          console.error("[voice] recv transport connection failed");
        }
      });

      /* ───────────── PRODUCE AUDIO ───────────── */
      console.log("[voice] requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      if (!stream || stream.getAudioTracks().length === 0) {
        throw new Error("Failed to get audio track from microphone");
      }
      
      const track = stream.getAudioTracks()[0];
      console.log("[voice] got audio track", track.id, track.label);

      console.log("[voice] producing audio track...");
      const producer = await sendTransport.produce({ track });
      activeRefs.micProducer = producer;
      console.log("[voice] producer created", producer.id);

      let lastSpeakingState = false;
      const stopAnalyser = createAnalyser(stream, (speaking) => {
        // Update local state
        updateParticipant(socket.id, { speaking });
        
        // Emit to other users only when state changes
        if (speaking !== lastSpeakingState && activeRefs.roomId) {
          lastSpeakingState = speaking;
          socket.emit("voice-speaking", {
            roomId: activeRefs.roomId,
            speaking
          });
        }
      });
      activeRefs.analysers.set(socket.id, stopAnalyser);
      
      // Store stream for cleanup
      activeRefs.micStream = stream;

      // Process any pending producers that arrived before transports were ready
      console.log("[voice] processing", activeRefs.pendingProducers.length, "pending producers");
      for (const pending of activeRefs.pendingProducers) {
        await consumeProducer(pending);
      }
      activeRefs.pendingProducers = [];

      updateSharedState({ joined: true, micOn: true });
      console.log("[voice] JOIN COMPLETE");
    } catch (err) {
      console.error("[voice] join failed", err);
      
      // Clean up on error
      const activeRefs = shared ? shared.refs : refs;
      try {
        if (activeRefs.micStream) {
          activeRefs.micStream.getTracks().forEach(track => track.stop());
          activeRefs.micStream = null;
        }
        if (activeRefs.micProducer) {
          activeRefs.micProducer.close();
          activeRefs.micProducer = null;
        }
        if (activeRefs.sendTransport) {
          activeRefs.sendTransport.close();
          activeRefs.sendTransport = null;
        }
        if (activeRefs.recvTransport) {
          activeRefs.recvTransport.close();
          activeRefs.recvTransport = null;
        }
        if (activeRefs.device) {
          activeRefs.device = null;
        }
        activeRefs.roomId = null;
      } catch (cleanupErr) {
        console.error("[voice] cleanup error", cleanupErr);
      }
      
      updateSharedState({ joined: false, micOn: false });
    }
  };

  /* ───────────────────────── MUTE / UNMUTE ───────────────────────── */

  const toggleMic = async () => {
    const activeRefs = shared ? shared.refs : refs;
    const producer = activeRefs.micProducer;
    if (!producer) return;

    if (producer.paused) {
      await producer.resume();
      updateSharedState({ micOn: true });
      updateParticipant(socket.id, { muted: false });
    } else {
      await producer.pause();
      updateSharedState({ micOn: false });
      updateParticipant(socket.id, { muted: true, speaking: false });
      
      // Emit speaking: false when muting
      if (activeRefs.roomId) {
        socket.emit("voice-speaking", {
          roomId: activeRefs.roomId,
          speaking: false
        });
      }
    }
  };

  /* ───────────────────────── LEAVE ───────────────────────── */

  const leave = async () => {
    console.log("[voice] leaving room");

    // Stop all analysers
    refs.analysers.forEach(stop => stop());
    refs.analysers.clear();

    // Close all audio elements
    refs.audioElements.forEach(audio => {
      audio.pause();
      audio.srcObject = null;
    });
    refs.audioElements.clear();

    // Close all consumers
    refs.consumers.forEach(consumer => {
      try {
        consumer.close();
      } catch (err) {
        console.warn("[voice] error closing consumer", err);
      }
    });
    refs.consumers.clear();

    // Stop mic stream tracks
    if (refs.micStream) {
      refs.micStream.getTracks().forEach(track => {
        track.stop();
      });
      refs.micStream = null;
    }

    // Close producer and transports
    try {
      refs.micProducer?.close();
    } catch (err) {
      console.warn("[voice] error closing producer", err);
    }

    try {
      refs.sendTransport?.close();
    } catch (err) {
      console.warn("[voice] error closing send transport", err);
    }

    try {
      refs.recvTransport?.close();
    } catch (err) {
      console.warn("[voice] error closing recv transport", err);
    }

    // Emit leave event to server
    if (socket && refs.roomId) {
      try {
        socket.emit("voice-leave", { roomId: refs.roomId });
      } catch (err) {
        console.warn("[voice] error emitting leave", err);
      }
    }

    // Clear refs
    refs.micProducer = null;
    refs.sendTransport = null;
    refs.recvTransport = null;
    refs.device = null;
    refs.roomId = null;

    updateSharedState({ joined: false, micOn: false, participants: [] });
  };

  return {
    joined,
    micOn,
    participants,
    join,
    leave,
    toggleMic
  };
}
