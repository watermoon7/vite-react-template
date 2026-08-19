/**
 * In-app confirmation, shown as a small popover next to the control that started it —
 * replaces the browser's confirm() dialog. The popover is a sibling of the trigger inside
 * a positioned wrapper (`.confirm-anchor`), so it lives in the same zoomed, styled DOM as
 * everything else and needs no coordinate maths; the wrapper decides where it opens.
 */
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
} from "react";

/**
 * Preferred vertical side of the trigger the popover opens on, and which edge it aligns
 * to. The side flips if the preferred one has no room inside the nearest scrolling ancestor
 * (a popover clipped by a scroll container is unusable).
 */
export type Placement = "below-end" | "below-start" | "above-end" | "above-start";
type Side = "above" | "below";

/** Gap between trigger and popover; keep in step with .confirm-pop.above/.below in app.css. */
const GAP_PX = 6;

/** The box a popover must stay within: its nearest ancestor that clips overflow, else the viewport. */
function clipBox(from: Element): { top: number; bottom: number } {
	for (let el = from.parentElement; el; el = el.parentElement) {
		const overflowY = getComputedStyle(el).overflowY;
		if (overflowY !== "visible") return el.getBoundingClientRect();
	}
	return { top: 0, bottom: window.innerHeight };
}

interface PopoverProps {
	message: string;
	/** Optional second line, shown muted. */
	detail?: string;
	confirmLabel: string;
	/** Style the confirming button as destructive. */
	danger?: boolean;
	placement: Placement;
	onConfirm: () => void;
	onCancel: () => void;
}

/**
 * The popover itself. Focuses its confirm button on open (as the native dialog does),
 * cancels on Escape or on a pointer press outside its `.confirm-anchor`.
 */
export function ConfirmPopover({ message, detail, confirmLabel, danger = false, placement, onConfirm, onCancel }: PopoverProps) {
	if (!message) throw new Error("ConfirmPopover needs a message");
	if (!confirmLabel) throw new Error("ConfirmPopover needs a confirmLabel");
	const root = useRef<HTMLDivElement>(null);
	const confirmButton = useRef<HTMLButtonElement>(null);
	const [preferredSide, align] = placement.split("-") as [Side, "start" | "end"];
	/** Side actually used, decided once from the room available on first layout. */
	const decidedSide = useRef<Side | null>(null);

	// Before paint: if the preferred side would be clipped, open on whichever side has more
	// room. Applied straight to the element (not via state) and re-applied after every
	// render, since the rendered class name only knows the preferred side.
	useLayoutEffect(() => {
		const el = root.current;
		const anchor = el?.closest(".confirm-anchor");
		if (!el || !anchor) return;
		if (decidedSide.current === null) {
			const clip = clipBox(anchor);
			const anchorBox = anchor.getBoundingClientRect();
			const needed = el.getBoundingClientRect().height + GAP_PX;
			const roomBelow = clip.bottom - anchorBox.bottom;
			const roomAbove = anchorBox.top - clip.top;
			const fits = preferredSide === "below" ? roomBelow >= needed : roomAbove >= needed;
			decidedSide.current = fits ? preferredSide : roomBelow >= roomAbove ? "below" : "above";
		}
		el.classList.toggle("above", decidedSide.current === "above");
		el.classList.toggle("below", decidedSide.current === "below");
	});

	useEffect(() => {
		confirmButton.current?.focus();
	}, []);

	useEffect(() => {
		function onPointerDown(e: PointerEvent): void {
			const anchor = root.current?.closest(".confirm-anchor") ?? root.current;
			if (anchor && e.target instanceof Node && !anchor.contains(e.target)) onCancel();
		}
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [onCancel]);

	function onKey(e: KeyboardEvent<HTMLDivElement>): void {
		if (e.key !== "Escape") return;
		// Stops the board's own Escape handler (which closes the open task) from firing too.
		e.preventDefault();
		e.stopPropagation();
		onCancel();
	}

	return (
		<div ref={root} className={`confirm-pop ${preferredSide} ${align}`} role="alertdialog" aria-label={message} onKeyDown={onKey}>
			<p className="confirm-message">{message}</p>
			{detail && <p className="confirm-detail muted small">{detail}</p>}
			<div className="confirm-actions">
				<button type="button" className="btn btn-ghost" onClick={onCancel}>
					Cancel
				</button>
				<button ref={confirmButton} type="button" className={"btn " + (danger ? "btn-danger" : "btn-primary")} onClick={onConfirm}>
					{confirmLabel}
				</button>
			</div>
		</div>
	);
}

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
	message: string;
	detail?: string;
	confirmLabel: string;
	danger?: boolean;
	placement?: Placement;
	/** Runs once the user confirms. */
	onConfirm: () => void;
	children: ReactNode;
}

/**
 * A button that asks for confirmation before acting: renders the button (all ordinary
 * button props pass through) inside a `.confirm-anchor` and opens a ConfirmPopover
 * beside it when clicked. Clicking the button again while open closes the popover.
 */
export function ConfirmButton({
	message,
	detail,
	confirmLabel,
	danger = false,
	placement = "below-end",
	onConfirm,
	children,
	...buttonProps
}: ButtonProps) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);

	function cancel(): void {
		setOpen(false);
		trigger.current?.focus();
	}

	function confirm(): void {
		setOpen(false);
		onConfirm();
	}

	return (
		<span className="confirm-anchor">
			<button {...buttonProps} ref={trigger} type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
				{children}
			</button>
			{open && (
				<ConfirmPopover
					message={message}
					detail={detail}
					confirmLabel={confirmLabel}
					danger={danger}
					placement={placement}
					onConfirm={confirm}
					onCancel={cancel}
				/>
			)}
		</span>
	);
}
