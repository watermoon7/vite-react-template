/**
 * Reports the moment a dragged item is released. @hello-pangea/dnd keeps a drop target's
 * isDraggingOver set while the item animates into place, but the drop is decided on
 * release — so a container that highlights its drop target uses this to clear the highlight
 * then, instead of after the animation.
 */
import type { DraggableStateSnapshot } from "@hello-pangea/dnd";
import { useEffect } from "react";

/** Calls `onDropStart` when `snapshot` first reports the item's drop animation. */
export function useDropStart(snapshot: DraggableStateSnapshot, onDropStart: () => void): void {
	useEffect(() => {
		if (snapshot.isDropAnimating) onDropStart();
	}, [snapshot.isDropAnimating, onDropStart]);
}
