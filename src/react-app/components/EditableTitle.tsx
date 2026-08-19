/** A page heading that turns into an input when clicked, for renaming boards and channels in place. */
import { useRef, useState, type KeyboardEvent } from "react";

interface Props {
	value: string;
	/** Accessible name of the input, e.g. "Board name". */
	label: string;
	/** Called with the trimmed new name; not called when the name is empty or unchanged. */
	onRename: (name: string) => void;
}

export function EditableTitle({ value, label, onRename }: Props) {
	if (!label) throw new Error("EditableTitle needs a label");
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(value);
	// Enter and the resulting blur both call commit; the ref makes the second call a no-op.
	const pendingName = useRef<string | null>(null);

	function editName(next: string): void {
		pendingName.current = next;
		setName(next);
	}

	function commit(): void {
		const pending = pendingName.current;
		pendingName.current = null;
		setEditing(false);
		if (pending === null) return;
		const trimmed = pending.trim();
		if (!trimmed || trimmed === value) {
			setName(value);
			return;
		}
		onRename(trimmed);
	}

	function onKey(e: KeyboardEvent<HTMLInputElement>): void {
		if (e.key === "Enter") commit();
		if (e.key === "Escape") {
			pendingName.current = null;
			setName(value);
			setEditing(false);
		}
	}

	function startEditing(): void {
		setName(value);
		pendingName.current = value;
		setEditing(true);
	}

	if (editing) {
		return (
			<input
				className="editable-title-input"
				autoFocus
				value={name}
				onChange={(e) => editName(e.target.value)}
				onKeyDown={onKey}
				onBlur={commit}
				aria-label={label}
			/>
		);
	}
	return (
		<h1 className="page-title editable-title" title="Click to rename" onClick={startEditing}>
			{value}
		</h1>
	);
}
