/**
 * Estimate of the server's clock, kept over the WebSocket.
 *
 * The shared playback state says where a song was at a *server* timestamp, so a client can
 * only work out where it should be now if it knows how far its own clock is from the server's.
 * Each sample is an NTP-style round trip — send our time, get it back beside the server's —
 * and the sample with the shortest round trip in a burst wins, because a fast round trip is
 * the one least distorted by queueing in either direction.
 */
import { CLIENT } from "../../app.config";
import { subscribeSocket, sendSocket } from "./socket";

let offsetMs = 0;
/** Round-trip time of the sample `offsetMs` came from; Infinity until the first reply. */
let bestRoundTripMs = Number.POSITIVE_INFINITY;
let refreshTimer: number | undefined;

/** Now, on the server's clock, in epoch milliseconds. */
export function serverNow(): number {
	return Date.now() + offsetMs;
}

/** Round-trip time of the sample the current estimate came from, or null before the first reply. */
export function clockRoundTripMs(): number | null {
	return Number.isFinite(bestRoundTripMs) ? bestRoundTripMs : null;
}

/**
 * Sends a burst of round trips. Spread over a few hundred milliseconds so a single congested
 * moment cannot decide the estimate on its own.
 */
function sendBurst(): void {
	bestRoundTripMs = Number.POSITIVE_INFINITY;
	for (let i = 0; i < CLIENT.clock.burstSamples; i++) {
		window.setTimeout(() => sendSocket({ t: "time", c: Date.now() }), i * CLIENT.clock.burstSpacingMs);
	}
}

/** Folds one reply into the estimate, keeping the fastest round trip seen since the burst began. */
function acceptSample(clientSentAt: number, serverAt: number): void {
	const now = Date.now();
	const roundTrip = now - clientSentAt;
	if (!Number.isFinite(roundTrip) || roundTrip < 0) return; // clock stepped mid-flight
	if (roundTrip > bestRoundTripMs) return;
	bestRoundTripMs = roundTrip;
	// The server's timestamp was taken somewhere in the round trip; its midpoint is the best guess.
	offsetMs = serverAt - (clientSentAt + now) / 2;
}

subscribeSocket((event) => {
	if (event.kind === "open") {
		sendBurst();
		window.clearInterval(refreshTimer);
		refreshTimer = window.setInterval(sendBurst, CLIENT.clock.refreshIntervalMs);
		return;
	}
	if (event.kind === "closed") {
		window.clearInterval(refreshTimer);
		refreshTimer = undefined;
		return;
	}
	if (event.message.type === "time") acceptSample(event.message.c, event.message.s);
});
