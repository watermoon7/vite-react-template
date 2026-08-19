/**
 * Voice-room audio settings: which microphone and speakers this browser uses, how hard the
 * microphone is driven, and whether the room's cues play.
 *
 * All of it is per browser rather than per account — it describes the hardware in front of
 * you, and the other person's browser has its own. The level meter is the point of the
 * sensitivity slider: it opens the microphone while it is on, so a level can be set by
 * speaking rather than by guessing, and closes it again as soon as it is turned off.
 */
import { useEffect, useState } from "react";
import { VOICE } from "../../../app.config";
import { acquireMicrophone, releaseMicrophone, subscribeMicLevel } from "../microphone";
import { setVoiceAudio, useAudioDevices, useVoiceAudio, type AudioDevice } from "../voiceAudio";
import { playCue } from "../voiceSounds";

/**
 * Whether this browser can play to a device of the user's choosing. Chrome can; Firefox and
 * Safari play everything through the system's default, so offering the choice would be a lie.
 */
const CAN_CHOOSE_OUTPUT = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

/** The <option> value standing for "follow the system", which is stored as null. */
const SYSTEM_DEFAULT = "";

interface DeviceSelectProps {
	id: string;
	label: string;
	devices: AudioDevice[];
	/** The chosen device id, or null for the system default. */
	value: string | null;
	onChange: (deviceId: string | null) => void;
	/** Names an unlabelled device, which is what browsers give before permission is granted. */
	fallbackName: string;
}

function DeviceSelect({ id, label, devices, value, onChange, fallbackName }: DeviceSelectProps) {
	// A device that has been unplugged since it was chosen is still the preference; listing it
	// keeps the control showing what will be used again once it is back.
	const missing = value !== null && !devices.some((device) => device.deviceId === value);
	return (
		<div className="field">
			<label className="label" htmlFor={id}>
				{label}
			</label>
			<select
				id={id}
				className="input select"
				value={value ?? SYSTEM_DEFAULT}
				onChange={(e) => onChange(e.target.value === SYSTEM_DEFAULT ? null : e.target.value)}
			>
				<option value={SYSTEM_DEFAULT}>System default</option>
				{devices.map((device, index) => (
					<option key={device.deviceId} value={device.deviceId}>
						{device.label || `${fallbackName} ${index + 1}`}
					</option>
				))}
				{missing && <option value={value}>Last used (not connected)</option>}
			</select>
		</div>
	);
}

export function AudioSettings() {
	const audio = useVoiceAudio();
	const devices = useAudioDevices();
	const [testing, setTesting] = useState(false);
	const [level, setLevel] = useState(0);
	const [micError, setMicError] = useState<string | null>(null);

	// The meter holds the microphone open only while it is switched on.
	useEffect(() => {
		if (!testing) return;
		let active = true;
		const stopLevels = subscribeMicLevel(setLevel);
		void acquireMicrophone("settings")
			.then(() => {
				// The panel may have been closed while the browser was asking for permission.
				if (!active) releaseMicrophone("settings");
			})
			.catch((err: unknown) => {
				if (!active) return;
				const denied = err instanceof Error && err.name === "NotAllowedError";
				setMicError(denied ? "Microphone access was denied." : err instanceof Error ? err.message : String(err));
				setTesting(false);
			});
		return () => {
			active = false;
			stopLevels();
			setLevel(0);
			releaseMicrophone("settings");
		};
	}, [testing]);

	const unlabelled = devices.inputs.some((device) => device.label === "");

	/** Turns the meter on or off; turning it on is what opens the microphone. */
	function toggleTest(): void {
		setMicError(null);
		setTesting(!testing);
	}

	function toggleSounds(enabled: boolean): void {
		setVoiceAudio({ sounds: enabled });
		// Turning them on is worth hearing straight away; turning them off should be silent.
		if (enabled) playCue("join");
	}

	return (
		<section className="settings-section">
			<h2 className="section-title">Voice &amp; audio</h2>
			<p className="muted">
				Devices and levels for the voice room. Saved for this browser only, so they do not change what the other
				person hears or how loud they are for themselves.
			</p>

			<DeviceSelect
				id="voice-input-device"
				label="Microphone"
				devices={devices.inputs}
				value={audio.inputDeviceId}
				onChange={(deviceId) => setVoiceAudio({ inputDeviceId: deviceId })}
				fallbackName="Microphone"
			/>

			{CAN_CHOOSE_OUTPUT ? (
				<DeviceSelect
					id="voice-output-device"
					label="Speakers"
					devices={devices.outputs}
					value={audio.outputDeviceId}
					onChange={(deviceId) => setVoiceAudio({ outputDeviceId: deviceId })}
					fallbackName="Speakers"
				/>
			) : (
				<p className="muted small">
					This browser always plays through your system’s default output device; choose it there instead.
				</p>
			)}

			{unlabelled && (
				<p className="muted small">Device names appear once you have let this site use your microphone.</p>
			)}

			<div className="field">
				<span className="label">Microphone sensitivity</span>
				<div className="row">
					<input
						className="audio-range"
						type="range"
						min={VOICE.micGain.min}
						max={VOICE.micGain.max}
						step={VOICE.micGain.step}
						value={audio.micGain}
						aria-label="Microphone sensitivity"
						onChange={(e) => setVoiceAudio({ micGain: Number(e.target.value) })}
					/>
					<span className="audio-value muted small">{Math.round(audio.micGain * 100)}%</span>
					<button
						className="btn"
						onClick={() => setVoiceAudio({ micGain: VOICE.micGain.default })}
						disabled={audio.micGain === VOICE.micGain.default}
					>
						Reset
					</button>
				</div>
				<p className="muted small">
					Lifts a quiet headset or pulls back a microphone that is too hot. Aim for the meter to sit around the
					middle while you talk normally, and to stay near the bottom when you do not.
				</p>
				<div className="row">
					<button className={"btn" + (testing ? " btn-primary" : "")} onClick={toggleTest}>
						{testing ? "Stop test" : "Test microphone"}
					</button>
					<div
						className={"meter" + (testing ? " on" : "")}
						role="img"
						aria-label={`Input level ${Math.round(level * 100)} percent`}
					>
						<div className="meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
					</div>
				</div>
				{micError && <p className="form-error">{micError}</p>}
			</div>

			<div className="field">
				<span className="label">Room sounds</span>
				<label className="check">
					<input type="checkbox" checked={audio.sounds} onChange={(e) => toggleSounds(e.target.checked)} />
					<span>Play a cue when someone joins, leaves, mutes or shares their screen</span>
				</label>
			</div>
		</section>
	);
}
