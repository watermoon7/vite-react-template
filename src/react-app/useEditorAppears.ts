/**
 * Whether the task editor panel would be appearing if it were opened now — that is, whether
 * it is closed at this moment. The panel slides in when it appears; handed another task it
 * only swaps its contents, and replaying the slide for that would read as a glitch. A panel
 * that is already open when the view first renders (a link straight to a task) has not
 * appeared either, so it keeps still too.
 */
import { useEffect, useState } from "react";

export function useEditorAppears(open: boolean): boolean {
	if (typeof open !== "boolean") throw new Error("open must be a boolean");
	const [wasOpen, setWasOpen] = useState(open);
	useEffect(() => {
		setWasOpen(open);
	}, [open]);
	return !wasOpen;
}
