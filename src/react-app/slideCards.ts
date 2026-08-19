/**
 * Card movement between two renders, played as a FLIP animation: the cards are measured
 * before the change, put back where they were with a transform once it has been applied,
 * and released a frame later so the browser animates the difference.
 *
 * This is what a drop into a sorted column needs. @hello-pangea/dnd animates a released card
 * into the slot it was dropped in, but a sorted column then draws it wherever the sort puts
 * it — which, without this, happens between two frames and reads as a snap.
 */
import { CLIENT } from "../../app.config";
import { getScale } from "./scale";

/** Cards carry their task id, so the same card can be found again after the re-render. */
const CARD_SELECTOR = "[data-task-id]";

/** Movement below this many pixels is not worth animating (a manual drop lands exactly). */
const MIN_MOVE_PX = 1;

export type CardRects = Map<string, DOMRect>;

/** Where every card under `root` is right now, by task id. */
export function measureCards(root: HTMLElement | null): CardRects {
	const rects: CardRects = new Map();
	if (!root) return rects;
	for (const el of root.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
		const id = el.dataset.taskId;
		if (id) rects.set(id, el.getBoundingClientRect());
	}
	return rects;
}

/**
 * Animates every card that is no longer where `before` measured it. Call from a layout
 * effect, after the render that moved the cards and before the browser paints it.
 */
export function slideCards(root: HTMLElement | null, before: CardRects): void {
	if (!(before instanceof Map)) throw new Error("before must be a map of card rects");
	if (!root || before.size === 0) return;
	const scale = getScale();
	if (!(scale > 0)) throw new Error(`invalid interface scale: ${scale}`);
	const moved: { el: HTMLElement; dx: number; dy: number }[] = [];
	for (const el of root.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
		const id = el.dataset.taskId;
		const from = id === undefined ? undefined : before.get(id);
		if (!from) continue; // a card that was not there before has nowhere to come from
		const to = el.getBoundingClientRect();
		// A card's own zoom multiplies the lengths it is given, so the viewport pixels
		// measured here are divided by the interface scale — as dragScale.ts does for dnd.
		const dx = (from.left - to.left) / scale;
		const dy = (from.top - to.top) / scale;
		if (Math.abs(dx) < MIN_MOVE_PX && Math.abs(dy) < MIN_MOVE_PX) continue;
		moved.push({ el, dx, dy });
	}
	if (moved.length === 0) return;
	for (const { el, dx, dy } of moved) {
		el.style.transition = "none";
		el.style.transform = `translate(${dx}px, ${dy}px)`;
	}
	// Reading a layout value makes the browser work the offsets above out now. Without that
	// it would only see the round trip to the same place at the end of this function, with
	// nothing left to animate between.
	void root.offsetHeight;
	for (const { el } of moved) {
		el.style.transition = `transform ${CLIENT.cardReorderMs}ms ease`;
		el.style.transform = "";
	}
	// dnd writes the transform of a card being dragged, and a transition left on it would
	// make that card lag the pointer, so the animation takes its own styles back off.
	window.setTimeout(() => {
		for (const { el } of moved) {
			el.style.transition = "";
		}
	}, CLIENT.cardReorderMs);
}
