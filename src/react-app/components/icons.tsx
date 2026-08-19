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
