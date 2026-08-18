/** Shared or personal notes: a single autosaving text area. */
import { useState } from "react";
import type { NotesScope } from "../../shared/types";
import { saveNotes } from "../store";
import { useDebouncedSave } from "../useDebouncedSave";

interface Props {
	scope: NotesScope;
	/** Latest server content. */
	content: string;
}

export function NotesPage({ scope, content }: Props) {
	// null = follow the server content; a string = local edits not yet confirmed by the server.
	const [draft, setDraft] = useState<string | null>(null);
	const { schedule, status } = useDebouncedSave<string>(
		async (text) => {
			const ok = await saveNotes(scope, text);
			// Once the server has this exact text, follow the server again (so remote edits show).
			if (ok) setDraft((d) => (d === text ? null : d));
			return ok;
		},
		(_pending, change) => change,
	);

	const statusText =
		status === "saving" ? "Saving…" : status === "pending" ? "Unsaved" : status === "error" ? "Not saved — retrying on next edit" : "Saved";

	return (
		<div className="page">
			<header className="page-header">
				<h1 className="page-title">{scope === "shared" ? "Shared notes" : "Personal notes"}</h1>
				<span className="muted small">{scope === "shared" ? "Visible to both of you" : "Only visible to you"}</span>
				<div className="spacer" />
				<span className="save-status">{statusText}</span>
			</header>
			<textarea
				className="notes-editor"
				value={draft ?? content}
				placeholder="Write anything…"
				spellCheck
				onChange={(e) => {
					setDraft(e.target.value);
					schedule(e.target.value);
				}}
			/>
		</div>
	);
}
