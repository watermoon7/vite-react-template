/**
 * The other user's screen, filling the main pane. The video track arrives on the same
 * WebRTC connection as the voice call, so there is nothing to fetch here — the stream is
 * handed over by voice.ts and attached to the element.
 */
import { useEffect, useRef } from "react";
import type { UserId } from "../../shared/types";
import { userName } from "../format";
import { navigate } from "../router";
import { useVoice } from "../voice";

interface Props {
	user: UserId;
}

export function ScreenSharePage({ user }: Props) {
	const voice = useVoice();
	const video = useRef<HTMLVideoElement>(null);
	const peer = voice.room.find((member) => member.user !== user) ?? null;
	const stream = voice.remoteScreen;

	// srcObject is a property, not an attribute, so React cannot set it from JSX.
	useEffect(() => {
		const el = video.current;
		if (!el) return;
		el.srcObject = stream;
		// The peer's microphone is already playing through its own element; this one is only
		// for the picture, and muting it keeps a shared tab's audio from arriving twice.
		el.muted = true;
		if (stream) el.play().catch(() => undefined);
	}, [stream]);

	const sharing = peer?.sharing === true && stream !== null;

	return (
		<div className="page screen-share">
			<header className="page-header">
				<h1 className="page-title">{peer ? `${userName(peer.user)}’s screen` : "Screen share"}</h1>
				<div className="spacer" />
				<button className="btn" onClick={() => navigate({ kind: "home" })}>
					Stop watching
				</button>
			</header>
			<div className="screen-stage">
				{sharing ? (
					<video ref={video} className="screen-video" playsInline autoPlay />
				) : (
					<div className="screen-center muted">
						<div className="empty">
							<p>Nobody is sharing a screen.</p>
							<p className="small">A share appears here as soon as the other person starts one in the voice room.</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
