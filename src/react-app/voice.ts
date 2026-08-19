/**
 * The voice room's client half: microphone capture, one 1:1 WebRTC connection to the other
 * user, and the screen share that rides on the same connection.
 *
 * Nothing about the room is a "call": membership is shared state pushed by the Durable Object
 * over the existing WebSocket, and this module simply reacts to it — when both users are in the
 * room the two browsers negotiate a direct peer connection and the media never touches a server.
 * The Durable Object only relays SDP and ICE, so the audio and video are DTLS-SRTP end to end.
 *
 * Negotiation follows the "perfect negotiation" pattern: both sides may start an offer at any
 * time (adding a screen share does exactly that), and collisions are resolved by one side —
 * the one whose user id sorts first — being polite and rolling its own offer back.
 */
import { useSyncExternalStore } from "react";
import { VOICE } from "../../app.config";
import { otherUser, type IceServer, type UserId, type VoiceMember } from "../shared/types";
import { api } from "./api";
import { sendSocket, subscribeSocket } from "./socket";

export type VoiceStatus = "idle" | "waiting" | "connecting" | "connected" | "reconnecting" | "failed";

export interface VoiceState {
	/** Everyone currently in the room, as the server sees it. Drives the presence indicators. */
	room: VoiceMember[];
	/** True while this tab is in the room. */
	joined: boolean;
	muted: boolean;
	/** True while this tab is sharing its screen. */
	sharing: boolean;
	status: VoiceStatus;
	/** The other user's screen, once their share arrives. */
	remoteScreen: MediaStream | null;
	/** Last failure to show in the room panel, or null. */
	error: string | null;
}

/** One WebRTC signalling payload as it travels through the Durable Object. */
type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

/** Signals that arrive before the peer connection exists are held here, newest last. */
const MAX_BUFFERED_SIGNALS = 64;

let state: VoiceState = {
	room: [],
	joined: false,
	muted: false,
	sharing: false,
	status: "idle",
	remoteScreen: null,
	error: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<VoiceState>): void {
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
}

/** React hook returning the voice-room state. */
export function useVoice(): VoiceState {
	return useSyncExternalStore((listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}, () => state);
}

// ---------- Module state ----------

let me: UserId | null = null;
let peerId: UserId | null = null;
let pc: RTCPeerConnection | null = null;
let micStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let screenSenders: RTCRtpSender[] = [];
let iceServers: IceServer[] | null = null;
/** Perfect-negotiation bookkeeping. */
let makingOffer = false;
let ignoreOffer = false;
let polite = false;
let bufferedSignals: Signal[] = [];
/** Serialises signal handling: each step awaits, and SDP must be applied in order. */
let signalChain: Promise<void> = Promise.resolve();
let iceRestartTimer: number | undefined;

/** The peer's audio, played through one element created on demand. */
const remoteStream = new MediaStream();
let remoteAudio: HTMLAudioElement | null = null;

/** Tells the module who is signed in; the other user of the pair is the only possible peer. */
export function bindVoiceUser(user: UserId): void {
	if (me === user) return;
	me = user;
	peerId = otherUser(user);
	polite = peerId !== null && user < peerId;
}

function reportError(err: unknown): void {
	const message = err instanceof Error ? err.message : String(err);
	console.error(err);
	setState({ error: message });
}

export function dismissVoiceError(): void {
	setState({ error: null });
}

/** The other user's room entry, or null when they are not in the room. */
function peerMember(): VoiceMember | null {
	return state.room.find((member) => member.user !== me) ?? null;
}

function statusFor(connection: RTCPeerConnectionState | null): VoiceStatus {
	if (!state.joined) return "idle";
	if (!peerMember()) return "waiting";
	switch (connection) {
		case "connected":
			return "connected";
		case "disconnected":
			return "reconnecting";
		case "failed":
		case "closed":
			return "failed";
		default:
			return "connecting";
	}
}

function refreshStatus(): void {
	setState({ status: statusFor(pc?.connectionState ?? null) });
}

// ---------- Peer connection ----------

function sendSignal(signal: Signal): void {
	if (!peerId) return;
	sendSocket({ t: "voice-signal", to: peerId, data: signal });
}

/** Plays the peer's audio. Called from the join click, so autoplay permission is already given. */
function playRemoteAudio(): void {
	if (!remoteAudio) {
		remoteAudio = new Audio();
		remoteAudio.autoplay = true;
		remoteAudio.srcObject = remoteStream;
	}
	remoteAudio.play().catch(reportError);
}

/** Builds the peer connection and puts the microphone on it, which starts the negotiation. */
function createPeer(): RTCPeerConnection {
	const connection = new RTCPeerConnection({ iceServers: (iceServers ?? []) as RTCIceServer[] });
	connection.onicecandidate = (event) => {
		if (event.candidate) sendSignal({ candidate: event.candidate.toJSON() });
	};
	connection.onnegotiationneeded = () => {
		signalChain = signalChain.then(async () => {
			try {
				makingOffer = true;
				await connection.setLocalDescription();
				if (connection.localDescription) sendSignal({ description: connection.localDescription.toJSON() });
			} catch (err) {
				reportError(err);
			} finally {
				makingOffer = false;
			}
		});
	};
	connection.ontrack = (event) => {
		if (event.track.kind === "audio") {
			remoteStream.addTrack(event.track);
			playRemoteAudio();
			return;
		}
		setState({ remoteScreen: event.streams[0] ?? new MediaStream([event.track]) });
	};
	connection.onconnectionstatechange = () => {
		refreshStatus();
		scheduleIceRestart(connection);
	};
	if (micStream) {
		for (const track of micStream.getAudioTracks()) connection.addTrack(track, micStream);
	}
	return connection;
}

/**
 * Restarts ICE when the connection has been down for longer than the configured grace period.
 * Only the impolite peer restarts, so the two do not both re-offer into each other.
 */
function scheduleIceRestart(connection: RTCPeerConnection): void {
	window.clearTimeout(iceRestartTimer);
	const down = connection.connectionState === "disconnected" || connection.connectionState === "failed";
	if (!down || polite) return;
	iceRestartTimer = window.setTimeout(() => {
		if (pc === connection && connection.connectionState !== "connected") connection.restartIce();
	}, VOICE.iceRestartAfterMs);
}

function ensurePeer(): void {
	if (pc || !state.joined || !peerMember()) return;
	pc = createPeer();
	const queued = bufferedSignals;
	bufferedSignals = [];
	for (const signal of queued) handleSignal(signal);
	refreshStatus();
}

/** Closes the peer connection and everything that only makes sense while it exists. */
function teardownPeer(): void {
	window.clearTimeout(iceRestartTimer);
	stopScreenShare();
	if (pc) {
		pc.onicecandidate = null;
		pc.onnegotiationneeded = null;
		pc.ontrack = null;
		pc.onconnectionstatechange = null;
		pc.close();
		pc = null;
	}
	for (const track of remoteStream.getTracks()) remoteStream.removeTrack(track);
	if (remoteAudio) remoteAudio.srcObject = remoteStream;
	makingOffer = false;
	ignoreOffer = false;
	bufferedSignals = [];
	setState({ remoteScreen: null });
}

/** Applies one signalling payload, resolving an offer collision the perfect-negotiation way. */
function handleSignal(signal: Signal): void {
	if (!pc) {
		// The peer got to the room message first; keep the signal until our connection exists.
		if (bufferedSignals.length >= MAX_BUFFERED_SIGNALS) bufferedSignals.shift();
		bufferedSignals.push(signal);
		return;
	}
	const connection = pc;
	signalChain = signalChain.then(async () => {
		try {
			if (signal.description) {
				const collision =
					signal.description.type === "offer" && (makingOffer || connection.signalingState !== "stable");
				ignoreOffer = !polite && collision;
				if (ignoreOffer) return;
				await connection.setRemoteDescription(signal.description);
				if (signal.description.type === "offer") {
					await connection.setLocalDescription();
					if (connection.localDescription) sendSignal({ description: connection.localDescription.toJSON() });
				}
				return;
			}
			if (signal.candidate) await connection.addIceCandidate(signal.candidate);
		} catch (err) {
			// A candidate rejected because we ignored the offer it belongs to is expected.
			if (!ignoreOffer) reportError(err);
		}
	});
}

// ---------- Room membership ----------

/** Joins the room: asks for the microphone once, then tells the server this tab is in. */
export async function joinRoom(): Promise<void> {
	if (state.joined) return;
	setState({ error: null });
	try {
		micStream = await navigator.mediaDevices.getUserMedia({ audio: VOICE.micConstraints, video: false });
	} catch (err) {
		reportError(err instanceof Error && err.name === "NotAllowedError" ? new Error("Microphone access was denied") : err);
		return;
	}
	// Fetched once per page load; the credentials outlive any single call.
	if (!iceServers) {
		try {
			iceServers = (await api.iceServers()).iceServers;
		} catch (err) {
			reportError(err);
			iceServers = [];
		}
	}
	if (!sendSocket({ t: "voice-join" })) {
		stopMicrophone();
		reportError(new Error("Not connected — try again once the sidebar says Live"));
		return;
	}
	setState({ joined: true, muted: false });
	playRemoteAudio();
	ensurePeer();
	refreshStatus();
}

function stopMicrophone(): void {
	if (!micStream) return;
	for (const track of micStream.getTracks()) track.stop();
	micStream = null;
}

/** Leaves the room and releases the microphone. */
export function leaveRoom(): void {
	if (!state.joined) return;
	sendSocket({ t: "voice-leave" });
	teardownPeer();
	stopMicrophone();
	setState({ joined: false, muted: false, sharing: false });
	refreshStatus();
}

/** Mutes or unmutes the microphone. The track stays in place so nothing renegotiates. */
export function setMuted(muted: boolean): void {
	if (typeof muted !== "boolean") throw new Error("muted must be a boolean");
	if (!state.joined || !micStream) return;
	for (const track of micStream.getAudioTracks()) track.enabled = !muted;
	sendSocket({ t: "voice-mute", muted });
	setState({ muted });
}

// ---------- Screen sharing ----------

/**
 * Shares a screen, window or tab with the other user. The tracks join the existing peer
 * connection, so this renegotiates rather than opening anything new. Audio comes along where
 * the platform allows it — on Linux only a browser tab's own audio can be captured.
 */
export async function startScreenShare(): Promise<void> {
	if (state.sharing) return;
	if (!pc) {
		reportError(new Error("Nobody to share with — wait until the other person joins the room"));
		return;
	}
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getDisplayMedia({ video: VOICE.screenConstraints, audio: true });
	} catch (err) {
		// Dismissing the picker is a NotAllowedError too, and is not worth reporting.
		if (!(err instanceof Error) || err.name !== "NotAllowedError") reportError(err);
		return;
	}
	screenStream = stream;
	screenSenders = stream.getTracks().map((track) => pc!.addTrack(track, stream));
	// The browser's own "Stop sharing" bar ends the track without telling the app anything else.
	for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => stopScreenShare());
	sendSocket({ t: "voice-screen", sharing: true });
	setState({ sharing: true });
}

/** Stops sharing and renegotiates the connection back down to audio only. */
export function stopScreenShare(): void {
	if (screenStream) {
		for (const track of screenStream.getTracks()) track.stop();
		screenStream = null;
	}
	for (const sender of screenSenders) {
		try {
			pc?.removeTrack(sender);
		} catch {
			// The connection is already closing; nothing to remove from.
		}
	}
	screenSenders = [];
	if (!state.sharing) return;
	sendSocket({ t: "voice-screen", sharing: false });
	setState({ sharing: false });
}

// ---------- Server events ----------

/** Reacts to the room the server pushed: connect to a peer who is there, drop one who is not. */
function onRoom(room: VoiceMember[]): void {
	setState({ room });
	if (!state.joined) {
		refreshStatus();
		return;
	}
	if (peerMember()) ensurePeer();
	else teardownPeer();
	refreshStatus();
}

subscribeSocket((event) => {
	if (event.kind === "open") {
		// A reconnect leaves the server with no record of this tab; rejoin if we think we are in.
		if (state.joined) {
			sendSocket({ t: "voice-join" });
			if (state.muted) sendSocket({ t: "voice-mute", muted: true });
			if (state.sharing) sendSocket({ t: "voice-screen", sharing: true });
		}
		return;
	}
	if (event.kind === "closed") {
		setState({ room: [] });
		refreshStatus();
		return;
	}
	const message = event.message;
	if (message.type === "voice") {
		onRoom(message.room);
		return;
	}
	if (message.type === "voice-signal") {
		if (state.joined && message.from === peerId) handleSignal(message.data as Signal);
		return;
	}
	if (message.type === "voice-evicted") {
		teardownPeer();
		stopMicrophone();
		setState({ joined: false, muted: false, sharing: false, error: "You joined the room in another tab" });
		refreshStatus();
	}
});

// Closing the tab must take this user out of the room straight away for the other person.
window.addEventListener("pagehide", () => {
	if (state.joined) sendSocket({ t: "voice-leave" });
});
