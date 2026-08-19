/**
 * Small inline SVG icons for icon buttons. Drawn rather than typed because a text glyph's
 * placement in its box depends on the font's metrics — Inter's "+" sits 1–2px below centre,
 * the Unicode pencils come out heavy — whereas these centre exactly and match the × stroke.
 */

interface IconProps {
	/** Rendered size in px (square). */
	size?: number;
}

function assertSize(size: number): void {
	if (!Number.isFinite(size) || size <= 0) throw new Error("icon size must be a positive number");
}

/** A plus sign, for "add" and "attach" buttons. */
export function PlusIcon({ size = 14 }: IconProps) {
	assertSize(size);
	return (
		<svg
			className="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.25"
			strokeLinecap="round"
			aria-hidden="true"
		>
			<path d="M12 5v14M5 12h14" />
		</svg>
	);
}

/** A pencil, for "rename" buttons. */
export function PencilIcon({ size = 14 }: IconProps) {
	assertSize(size);
	return (
		<svg
			className="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
		</svg>
	);
}

/** Filled triangle, for "play". Filled rather than stroked so it reads at button size. */
export function PlayIcon({ size = 14 }: IconProps) {
	assertSize(size);
	return (
		<svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M8 5.5v13l11-6.5z" />
		</svg>
	);
}

/** Two bars, for "pause". */
export function PauseIcon({ size = 14 }: IconProps) {
	assertSize(size);
	return (
		<svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
		</svg>
	);
}

/** Triangle against a bar. `back` mirrors it into a "previous". */
export function SkipIcon({ size = 14, back = false }: IconProps & { back?: boolean }) {
	assertSize(size);
	return (
		<svg
			className="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			style={back ? { transform: "scaleX(-1)" } : undefined}
		>
			<path d="M6 5.5v13l10-6.5zM17 5h2.5v14H17z" />
		</svg>
	);
}

/** A microphone. `off` draws the slash through it for the muted state. */
export function MicIcon({ size = 14, off = false }: IconProps & { off?: boolean }) {
	assertSize(size);
	return (
		<svg
			className="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect x="9" y="2" width="6" height="11" rx="3" />
			<path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
			{off && <path d="M3 3l18 18" />}
		</svg>
	);
}

/** A monitor, for the screen-share buttons. */
export function ScreenIcon({ size = 14 }: IconProps) {
	assertSize(size);
	return (
		<svg
			className="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect x="2.5" y="4" width="19" height="12.5" rx="2" />
			<path d="M8.5 20.5h7M12 16.5v4" />
		</svg>
	);
}

/** An arrow leaving a doorway, for "leave the room". */
export function LeaveIcon({ size = 14 }: IconProps) {
	assertSize(size);
	return (
		<svg
			className="icon"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M17 8l4 4-4 4M21 12H10" />
		</svg>
	);
}

/** Six dots, the conventional grip for a draggable row. */
export function GripIcon({ size = 14 }: IconProps) {
	assertSize(size);
	return (
		<svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<circle cx="9" cy="6" r="1.6" />
			<circle cx="15" cy="6" r="1.6" />
			<circle cx="9" cy="12" r="1.6" />
			<circle cx="15" cy="12" r="1.6" />
			<circle cx="9" cy="18" r="1.6" />
			<circle cx="15" cy="18" r="1.6" />
		</svg>
	);
}
