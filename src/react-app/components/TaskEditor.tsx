/** Side panel for editing one task. Autosaves; local edits win until the server confirms them. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PRIORITIES, USERS } from "../../../app.config";
import type { Assignee, Board, Priority, Task, TaskPatch } from "../../shared/types";
import { formatDateTime, formatRelative, userName } from "../format";
import { routeToHash } from "../router";
import { deleteTask, updateTask } from "../store";
import { Segmented } from "./Segmented";
import { useDebouncedSave } from "../useDebouncedSave";

interface Props {
	task: Task;
	/** Focus the description on open (used for freshly created tasks). */
	autoFocus: boolean;
	onClose: () => void;
	/**
	 * The task's board, when the editor is shown somewhere the board is not otherwise visible
	 * (the calendar). The header then names the board and links to the task on it.
	 */
	board?: Board;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="field">
			<span className="label">{label}</span>
			{children}
		</div>
	);
}

/** Removes from `draft` every key whose value equals what was just saved in `saved`. */
function dropConfirmed(draft: TaskPatch, saved: TaskPatch): TaskPatch {
	const next: TaskPatch = {};
	for (const key of Object.keys(draft) as (keyof TaskPatch)[]) {
		if (!(key in saved) || saved[key] !== draft[key]) Object.assign(next, { [key]: draft[key] });
	}
	return next;
}

const PRIORITY_OPTIONS: { value: Priority | null; label: string }[] = [
	{ value: null, label: "None" },
	...PRIORITIES.map((p) => ({ value: p.id as Priority | null, label: p.label })),
];

const ASSIGNEE_OPTIONS: { value: Assignee; label: string }[] = [
	...USERS.map((u) => ({ value: u.id as Assignee, label: u.name })),
	{ value: "both", label: "Both" },
];

export function TaskEditor({ task, autoFocus, onClose, board }: Props) {
	// Local edits not yet reflected by the server; a key is dropped once the store matches it.
	const [draft, setDraft] = useState<TaskPatch>({});
	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	const { schedule, flush, status } = useDebouncedSave<TaskPatch>(
		async (patch) => {
			const ok = await updateTask(task.id, patch);
			// Keys the server now holds are dropped from the draft so later remote edits show through.
			if (ok) setDraft((d) => dropConfirmed(d, patch));
			return ok;
		},
		(pending, change) => ({ ...pending, ...change }),
	);

	useEffect(() => {
		if (autoFocus) descriptionRef.current?.focus();
	}, [autoFocus]);

	function set<K extends keyof TaskPatch>(key: K, value: TaskPatch[K]): void {
		setDraft((d) => ({ ...d, [key]: value }));
		schedule({ [key]: value });
	}

	const view = { ...task, ...draft };

	async function remove(): Promise<void> {
		if (!confirm("Delete this task?")) return;
		onClose();
		await deleteTask(task.id);
	}

	return (
		<aside className="editor" aria-label="Task details">
			<header className="editor-header">
				<span className="editor-title">
					Task
					{board && (
						<span className="editor-context">
							{" in "}
							<a href={routeToHash({ kind: "board", boardId: board.id, taskId: task.id })} title="Open on its board">
								{board.name}
							</a>
						</span>
					)}
				</span>
				<span className="save-status">
					{status === "idle" ? "" : status === "saving" ? "Saving…" : status === "error" ? "Not saved" : "Unsaved"}
				</span>
				<button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={() => void flush().then(onClose)}>
					×
				</button>
			</header>

			<div className="editor-body">
				<Field label="Description">
					<textarea
						ref={descriptionRef}
						className="input"
						rows={2}
						placeholder="What needs doing?"
						value={view.description}
						onChange={(e) => set("description", e.target.value)}
					/>
				</Field>

				<Field label="Notes">
					<textarea
						className="input"
						rows={7}
						placeholder="Details, links, context…"
						value={view.notes}
						onChange={(e) => set("notes", e.target.value)}
					/>
				</Field>

				<Field label="Priority">
					<Segmented label="Priority" options={PRIORITY_OPTIONS} value={view.priority} onChange={(v) => set("priority", v)} />
				</Field>

				<Field label="Complete by">
					<div className="row">
						<input
							className="input"
							type="date"
							value={view.dueDate ?? ""}
							onChange={(e) => set("dueDate", e.target.value || null)}
						/>
						{view.dueDate && (
							<button className="btn btn-ghost" type="button" onClick={() => set("dueDate", null)}>
								Clear
							</button>
						)}
					</div>
				</Field>

				<Field label="Who">
					<Segmented label="Assignee" options={ASSIGNEE_OPTIONS} value={view.assignee} onChange={(v) => set("assignee", v)} />
				</Field>
			</div>

			<footer className="editor-footer">
				<div className="muted small" title={`Created ${formatDateTime(task.createdAt)}`}>
					Updated {formatRelative(task.updatedAt)} by {userName(task.updatedBy)}
				</div>
				<button className="btn btn-danger" type="button" onClick={() => void remove()}>
					Delete
				</button>
			</footer>
		</aside>
	);
}
