/**
 * A task's subtasks: a checklist of short lines that are ticked off inside the task.
 * The list is edited as a whole and handed back to the caller, because a task's checklist
 * is one field of the task (like its notes) rather than a collection of its own.
 */
import { useEffect, useRef } from "react";
import { LIMITS } from "../../../app.config";
import type { ChecklistItem } from "../../shared/types";
import { PlusIcon } from "./icons";

interface Props {
	items: ChecklistItem[];
	/** Called with the whole list whenever anything in it changes. */
	onChange: (items: ChecklistItem[]) => void;
}

export function Checklist({ items, onChange }: Props) {
	if (!Array.isArray(items)) throw new Error("items must be an array");
	if (typeof onChange !== "function") throw new Error("onChange must be a function");
	// A subtask added by this browser is typed into straight away, so it takes the focus once
	// the render that created it has put its input on the page.
	const focusId = useRef<string | null>(null);
	const inputs = useRef(new Map<string, HTMLInputElement>());
	const full = items.length >= LIMITS.checklistMaxItems;

	useEffect(() => {
		const id = focusId.current;
		if (id === null) return;
		focusId.current = null;
		inputs.current.get(id)?.focus();
	});

	function update(index: number, patch: Partial<ChecklistItem>): void {
		onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
	}

	/** Inserts an empty subtask after `index` — so Enter continues the list where the cursor is. */
	function addAfter(index: number): void {
		if (full) return;
		const item: ChecklistItem = { id: crypto.randomUUID(), text: "", done: false };
		const next = items.slice();
		next.splice(index + 1, 0, item);
		focusId.current = item.id;
		onChange(next);
	}

	function remove(index: number): void {
		if (index < 0 || index >= items.length) throw new Error(`no subtask at ${index}`);
		onChange(items.filter((_, i) => i !== index));
	}

	return (
		<div className="checklist">
			{items.length > 0 && (
				<ul className="checklist-items">
					{items.map((item, index) => (
						<li key={item.id} className={"checklist-item" + (item.done ? " done" : "")}>
							<input
								type="checkbox"
								className="checklist-tick"
								checked={item.done}
								aria-label={item.text || "Subtask"}
								onChange={(e) => update(index, { done: e.target.checked })}
							/>
							<input
								ref={(el) => {
									if (el) inputs.current.set(item.id, el);
									else inputs.current.delete(item.id);
								}}
								className="input checklist-text"
								placeholder="Subtask"
								maxLength={LIMITS.checklistItemMaxLength}
								value={item.text}
								onChange={(e) => update(index, { text: e.target.value })}
								onKeyDown={(e) => {
									if (e.key !== "Enter") return;
									e.preventDefault();
									addAfter(index);
								}}
							/>
							<button
								type="button"
								className="icon-btn"
								title="Remove subtask"
								aria-label="Remove subtask"
								onClick={() => remove(index)}
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}
			<button
				type="button"
				className="btn btn-ghost checklist-add"
				disabled={full}
				title={full ? `A task holds at most ${LIMITS.checklistMaxItems} subtasks` : undefined}
				onClick={() => addAfter(items.length - 1)}
			>
				<PlusIcon /> Add subtask
			</button>
		</div>
	);
}
