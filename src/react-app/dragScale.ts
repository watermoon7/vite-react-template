/**
 * Makes drag-and-drop agree with the interface scale.
 *
 * @hello-pangea/dnd measures in viewport pixels — getBoundingClientRect() and pointer
 * events — but writes its results as inline CSS lengths on the draggable: `translate(x, y)`
 * while dragging, and `top/left/width/height` for the lifted card. Those lengths are then
 * multiplied by the app root's `zoom` on the way to the screen, so at 125% the card drifts
 * from the pointer at 1.25× speed and is drawn 1.25× too large. Dividing the lengths by the
 * scale first cancels that; at scale 1 the style passes through untouched.
 */
import type { DraggableProvidedDraggableProps } from "@hello-pangea/dnd";
import { getScale } from "./scale";

type DragStyle = DraggableProvidedDraggableProps["style"];

/** The `translate(Xpx, Ypx)` dnd emits, possibly followed by other functions (e.g. scale()). */
const TRANSLATE = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/;

function divideTranslate(transform: string, scale: number): string {
	return transform.replace(TRANSLATE, (_match, x: string, y: string) => {
		const dx = Number(x) / scale;
		const dy = Number(y) / scale;
		if (!Number.isFinite(dx) || !Number.isFinite(dy)) return _match;
		return `translate(${dx}px, ${dy}px)`;
	});
}

/**
 * Returns dnd's draggable style with every viewport-pixel length divided by the current
 * interface scale. Handles both shapes dnd hands out: the lifted card (position: fixed with
 * a box) and the siblings shifting out of its way (a translate only).
 */
export function unzoomDragStyle(style: DragStyle): DragStyle {
	const scale = getScale();
	if (!style || scale === 1) return style;
	if (!(scale > 0)) throw new Error(`invalid interface scale: ${scale}`);
	if ("position" in style && style.position === "fixed") {
		return {
			...style,
			top: style.top / scale,
			left: style.left / scale,
			width: style.width / scale,
			height: style.height / scale,
			transform: style.transform === undefined ? undefined : divideTranslate(style.transform, scale),
		};
	}
	if (style.transform === undefined) return style;
	return { ...style, transform: divideTranslate(style.transform, scale) };
}
