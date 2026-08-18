/** Debounced autosave: batches changes and saves after CLIENT.saveDebounceMs; flushes on unmount. */
import { useCallback, useEffect, useRef, useState } from "react";
import { CLIENT } from "../../app.config";

export type SaveStatus = "idle" | "pending" | "saving" | "error";

export interface DebouncedSave<T> {
	/** Queue a change; it is merged into whatever is pending and saved after the debounce delay. */
	schedule: (change: T) => void;
	/** Save whatever is pending right now. */
	flush: () => Promise<void>;
	status: SaveStatus;
}

export function useDebouncedSave<T>(
	save: (pending: T) => Promise<boolean>,
	merge: (pending: T | null, change: T) => T,
): DebouncedSave<T> {
	const pendingRef = useRef<T | null>(null);
	const timerRef = useRef<number | undefined>(undefined);
	const saveRef = useRef(save);
	const mergeRef = useRef(merge);
	saveRef.current = save;
	mergeRef.current = merge;
	const [status, setStatus] = useState<SaveStatus>("idle");

	const flush = useCallback(async () => {
		window.clearTimeout(timerRef.current);
		const pending = pendingRef.current;
		if (pending === null) return;
		pendingRef.current = null;
		setStatus("saving");
		let ok = false;
		try {
			ok = await saveRef.current(pending);
		} finally {
			setStatus(pendingRef.current !== null ? "pending" : ok ? "idle" : "error");
		}
	}, []);

	const schedule = useCallback(
		(change: T) => {
			pendingRef.current = mergeRef.current(pendingRef.current, change);
			setStatus("pending");
			window.clearTimeout(timerRef.current);
			timerRef.current = window.setTimeout(() => void flush(), CLIENT.saveDebounceMs);
		},
		[flush],
	);

	// Flush on unmount so closing an editor never loses the last keystrokes.
	useEffect(() => () => void flush(), [flush]);

	return { schedule, flush, status };
}
