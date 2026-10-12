"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  LocalParticipant,
  RemoteParticipant,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
  ConnectionState,
} from "livekit-client";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Loader2,
  User,
} from "lucide-react";

interface CallModalProps {
  myAddress: string;         // caller wallet address
  peerAddress: string;       // callee wallet address
  peerName: string;
  peerAvatar: string;
  mode: "voice" | "video";
  isIncoming: boolean;       // true = they called us
  onClose: () => void;
}

type CallStatus = "connecting" | "ringing" | "active" | "ended" | "error";

// Canonical room name: sort addresses so both sides derive same name
function getRoomName(a: string, b: string): string {
  return [a, b].sort().join("_call_");
}

export default function CallModal({
  myAddress,
  peerAddress,
  peerName,
  peerAvatar,
  mode,
  isIncoming,
  onClose,
}: CallModalProps) {
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);

  const [status, setStatus] = useState<CallStatus>("connecting");
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(mode === "voice");
  const [duration, setDuration] = useState(0);
  const [remoteJoined, setRemoteJoined] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
  }, []);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  useEffect(() => {
    let cancelled = false;

    const connect = async () => {
      try {
        // 1. Get token from our API
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identity: myAddress,
            roomName: getRoomName(myAddress, peerAddress),
          }),
        });
        if (!res.ok) throw new Error("Failed to get call token");
        const { token, url } = await res.json();
        if (cancelled) return;

        // 2. Create and connect room
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });
        roomRef.current = room;

        room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
          if (cancelled) return;
          setRemoteJoined(true);
          setStatus("active");
          startTimer();
        });

        room.on(RoomEvent.ParticipantDisconnected, () => {
          if (cancelled) return;
          setStatus("ended");
          setTimeout(() => { cleanup(); onClose(); }, 2000);
        });

        room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
          if (cancelled) return;
          if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
            track.attach(remoteVideoRef.current);
          }
          if (track.kind === Track.Kind.Audio) {
            // Create audio element dynamically for remote audio
            const audioEl = document.createElement("audio");
            audioEl.autoplay = true;
            track.attach(audioEl);
            document.body.appendChild(audioEl);
          }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach();
        });

        room.on(RoomEvent.Disconnected, () => {
          if (cancelled) return;
          setStatus("ended");
          setTimeout(() => { cleanup(); onClose(); }, 1500);
        });

        await room.connect(url, token);
        if (cancelled) { room.disconnect(); return; }

        // 3. Publish tracks
        const audioTrack = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true });
        await room.localParticipant.publishTrack(audioTrack);

        if (mode === "video") {
          const videoTrack = await createLocalVideoTrack({ facingMode: "user" });
          await room.localParticipant.publishTrack(videoTrack);
          if (localVideoRef.current) {
            videoTrack.attach(localVideoRef.current);
          }
        }

        // If someone is already in the room, we're active immediately
        if (room.remoteParticipants.size > 0) {
          setRemoteJoined(true);
          setStatus("active");
          startTimer();
        } else {
          setStatus("ringing");
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("Call error:", err);
          setStatus("error");
          setTimeout(() => { cleanup(); onClose(); }, 2500);
        }
      }
    };

    connect();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHangUp = () => {
    setStatus("ended");
    cleanup();
    setTimeout(onClose, 800);
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = !muted;
    await room.localParticipant.setMicrophoneEnabled(!enabled);
    setMuted(enabled);
  };

  const toggleVideo = async () => {
    const room = roomRef.current;
    if (!room || mode === "voice") return;
    const enabled = !videoOff;
    await room.localParticipant.setCameraEnabled(!enabled);
    setVideoOff(enabled);
  };

  const statusLabel =
    status === "connecting" ? "Connecting..."
    : status === "ringing" ? (isIncoming ? "Incoming call..." : "Calling...")
    : status === "active" ? formatDuration(duration)
    : status === "ended" ? "Call ended"
    : "Connection failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 bg-[#1A1A2E] rounded-3xl overflow-hidden shadow-2xl">
        
        {/* Remote video (full background when video call) */}
        {mode === "video" && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        )}

        {/* Main content */}
        <div className={`relative z-10 flex flex-col items-center px-6 ${mode === "video" ? "pt-10 pb-6" : "py-12"}`}>

          {/* Avatar */}
          <div className="relative mb-4">
            {peerAvatar.startsWith("http") ? (
              <img
                src={peerAvatar}
                alt={peerName}
                className={`rounded-full object-cover border-4 ${
                  status === "active" ? "border-[#16A34A]" : "border-white/20"
                } ${mode === "video" && remoteJoined ? "w-16 h-16" : "w-24 h-24"}`}
              />
            ) : (
              <div className={`rounded-full bg-gradient-to-br from-[#2563EB] to-[#7C3AED] flex items-center justify-center text-4xl border-4 ${
                status === "active" ? "border-[#16A34A]" : "border-white/20"
              } ${mode === "video" && remoteJoined ? "w-16 h-16 text-2xl" : "w-24 h-24"}`}>
                {peerAvatar || <User className="w-10 h-10 text-white" />}
              </div>
            )}
            {status === "active" && (
              <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-[#16A34A] border-2 border-[#1A1A2E]" />
            )}
          </div>

          <h2 className="text-white text-xl font-bold mb-1">{peerName}</h2>
          <div className="flex items-center gap-2 mb-8">
            {(status === "connecting" || status === "ringing") && (
              <Loader2 className="w-3.5 h-3.5 text-white/60 animate-spin" />
            )}
            <p className={`text-sm font-medium ${
              status === "active" ? "text-[#4ADE80]"
              : status === "ended" ? "text-white/40"
              : status === "error" ? "text-red-400"
              : "text-white/60"
            }`}>
              {statusLabel}
            </p>
          </div>

          {/* Local video PiP */}
          {mode === "video" && (
            <div className="absolute top-4 right-4 w-20 h-28 rounded-xl overflow-hidden border-2 border-white/20 bg-black">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-4">
            {/* Mute */}
            <button
              onClick={toggleMute}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                muted ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>

            {/* Hang up */}
            <button
              onClick={handleHangUp}
              className="w-16 h-16 rounded-full bg-[#EF4444] flex items-center justify-center hover:bg-[#DC2626] transition-all shadow-lg"
            >
              <PhoneOff className="w-7 h-7 text-white" />
            </button>

            {/* Video toggle */}
            {mode === "video" ? (
              <button
                onClick={toggleVideo}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                  videoOff ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {videoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
              </button>
            ) : (
              <div className="w-14 h-14" /> /* spacer */
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
