/**
 * A tiny bus around the one WebSocket owned by `store.ts`, so features that need the socket
 * for something other than state — the clock round trip and the voice room — can use it
 * without reaching into the connection logic (or importing the store and creating a cycle).
 */
import type { ClientMessage, ServerMessage } from "../shared/types";

export type SocketEvent =
	| { kind: "open" }
	| { kind: "closed" }
	| { kind: "message"; message: ServerMessage };

type Listener = (event: SocketEvent) => void;

const listeners = new Set<Listener>();
let transport: ((message: ClientMessage) => void) | null = null;

/** Subscribes to socket events. Returns the unsubscribe function. */
export function subscribeSocket(listener: Listener): () => void {
	if (typeof listener !== "function") throw new Error("listener must be a function");
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Called by the store when the socket opens, closes, or delivers a frame. */
export function emitSocketEvent(event: SocketEvent): void {
	if (!event || typeof event.kind !== "string") throw new Error("invalid socket event");
	for (const listener of listeners) {
		try {
			listener(event);
		} catch (err) {
			// One broken subscriber must not stop the others (or the connection).
			console.error(err);
		}
	}
}

/** Called by the store to hand over (or withdraw) the open socket's send function. */
export function bindSocketTransport(send: ((message: ClientMessage) => void) | null): void {
	transport = send;
}

/** Sends a command to the server. Returns false when the socket is not open. */
export function sendSocket(message: ClientMessage): boolean {
	if (!message || typeof message.t !== "string") throw new Error("invalid client message");
	if (!transport) return false;
	try {
		transport(message);
		return true;
	} catch {
		return false; // socket closed between the check and the send
	}
}
