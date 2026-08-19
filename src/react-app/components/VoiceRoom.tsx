/**
 * The voice room in the left panel: who is in it right now, a way in and out, and — once
 * you are in — the mute / screen-share / leave strip.
 *
 * The room always exists and nothing ever rings: this panel is a window onto shared state,
 * so seeing the other person's dot lit is the whole invitation.
 */
import { USERS } from "../../../app.config";
import { otherUser, type UserId, type VoiceMember } from "../../shared/types";
import { userName } from "../format";
import { navigate, type Route } from "../router";
import {
	dismissVoiceError,
	joinRoom,
	leaveRoom,
	setMuted,
	startScreenShare,
	stopScreenShare,
	useVoice,
	type VoiceStatus,
} from "../voice";
import { setVoiceAudio, useVoiceAudio } from "../voiceAudio";
import { LeaveIcon, MicIcon, ScreenIcon } from "./icons";

interface Props {
	route: Route;
	user: UserId;
}

/**
 * What "with audio" means where the app is running. This is a browser limit rather than
 * anything the app chooses: on Linux only a browser tab's own audio can be captured, and on
 * macOS whole-screen audio needs a recent Chrome on a recent macOS.
 */
const SHARE_AUDIO_HINT = navigator.userAgent.includes("Linux")
	? "Sharing your screen. On Linux only a browser tab’s own audio can be captured. "
	: "Sharing your screen. ";

/** What the in-call strip says about the peer connection. */
const STATUS_LABEL: Record<VoiceStatus, string> = {
	idle: "",
	waiting: "Waiting for the other person",
	connecting: "Connecting…",
	connected: "Connected",
	reconnecting: "Reconnecting…",
	failed: "Connection lost",
};

/** One name with a live presence dot: filled while that user is sitting in the room. */
function RoomMember({ id, member, isMe }: { id: UserId; member: VoiceMember | undefined; isMe: boolean }) {
	const present = member !== undefined;
	const title = present
		? `${userName(id)} is in the room${member.muted ? " (muted)" : ""}`
		: `${userName(id)} is not in the room`;
	return (
		<li className="voice-member" title={title}>
			<span className={"status-dot" + (present ? " on" : "")} />
			<span className={present ? "" : "muted"}>
				{userName(id)}
				{isMe ? " (you)" : ""}
			</span>
			{present && member.muted && <MicIcon size={12} off />}
			{present && member.sharing && <ScreenIcon size={12} />}
		</li>
	);
}

export function VoiceRoom({ route, user }: Props) {
	const voice = useVoice();
	const audio = useVoiceAudio();
	const other = otherUser(user);
	const byUser = new Map(voice.room.map((member) => [member.user, member]));
	const peer = voice.room.find((member) => member.user !== user);
	const watching = route.kind === "screen";

	return (
		<section className="sidebar-section voice" aria-label="Voice room">
			<div className="sidebar-heading">
				<span>Voice room</span>
			</div>
			<ul className="voice-members">
				{USERS.map((u) => (
					<RoomMember key={u.id} id={u.id} member={byUser.get(u.id)} isMe={u.id === user} />
				))}
			</ul>

			{!voice.joined ? (
				<button className="btn btn-block voice-join" onClick={() => void joinRoom()}>
					Join room
				</button>
			) : (
				<>
					<div className="voice-status muted small" role="status">
						{STATUS_LABEL[voice.status]}
					</div>
					<div className="voice-controls">
						<button
							className={"icon-btn voice-btn" + (voice.muted ? " on" : "")}
							title={voice.muted ? "Unmute" : "Mute"}
							aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}
							aria-pressed={voice.muted}
							onClick={() => setMuted(!voice.muted)}
						>
							<MicIcon size={16} off={voice.muted} />
						</button>
						<button
							className={"icon-btn voice-btn" + (voice.sharing ? " on" : "")}
							title={voice.sharing ? "Stop sharing your screen" : "Share your screen"}
							aria-label={voice.sharing ? "Stop sharing your screen" : "Share your screen"}
							aria-pressed={voice.sharing}
							disabled={voice.status !== "connected" && !voice.sharing}
							onClick={() => (voice.sharing ? stopScreenShare() : void startScreenShare())}
						>
							<ScreenIcon size={16} />
						</button>
						<button
							className="icon-btn voice-btn voice-leave"
							title="Leave the room"
							aria-label="Leave the room"
							onClick={leaveRoom}
						>
							<LeaveIcon size={16} />
						</button>
					</div>
					{other && (
						<div className="voice-volume">
							<label className="muted small" htmlFor="voice-peer-volume">
								{userName(other)}’s volume
							</label>
							<div className="voice-volume-row">
								<input
									id="voice-peer-volume"
									className="voice-range"
									type="range"
									min={0}
									max={1}
									step={0.01}
									value={audio.peerVolume}
									onChange={(e) => setVoiceAudio({ peerVolume: Number(e.target.value) })}
								/>
								<span className="voice-volume-value muted small">{Math.round(audio.peerVolume * 100)}%</span>
							</div>
						</div>
					)}
				</>
			)}

			{peer?.sharing && (
				<button
					className="btn btn-block voice-watch"
					onClick={() => navigate(watching ? { kind: "home" } : { kind: "screen" })}
				>
					{watching ? "Stop watching" : `Watch ${userName(peer.user)}’s screen`}
				</button>
			)}

			{voice.sharing && (
				<p className="voice-hint muted small">
					{SHARE_AUDIO_HINT}
					<button className="link-btn" onClick={stopScreenShare}>
						Stop sharing
					</button>
				</p>
			)}

			{voice.error && (
				<div className="voice-error form-error" role="alert">
					<span>{voice.error}</span>
					<button className="icon-btn" aria-label="Dismiss" onClick={dismissVoiceError}>
						×
					</button>
				</div>
			)}
		</section>
	);
}
