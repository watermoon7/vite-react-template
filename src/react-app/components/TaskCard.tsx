/** Compact card shown in a column. */
import { PRIORITIES } from "../../../app.config";
import { DONE_COLUMN, type Task } from "../../shared/types";
import { formatDueDate, isOverdue, userName } from "../format";

/**
 * The meta line under a task's title: priority, due date (red when overdue), assignee,
 * how many subtasks are ticked off, notes marker.
 */
export function TaskMeta({ task }: { task: Task }) {
	const priority = PRIORITIES.find((p) => p.id === task.priority);
	const overdue = task.dueDate !== null && task.status !== DONE_COLUMN && isOverdue(task.dueDate);
	const doneSubtasks = task.checklist.filter((item) => item.done).length;
	return (
		<div className="card-meta">
			{priority && <span className={`tag prio-${priority.id}`}>{priority.label}</span>}
			{task.dueDate && (
				<span className={"card-due" + (overdue ? " overdue" : "")} title={overdue ? "Overdue" : "Due"}>
					{formatDueDate(task.dueDate)}
				</span>
			)}
			<span className="card-assignee">{userName(task.assignee)}</span>
			{task.checklist.length > 0 && (
				<span
					className={"card-subtasks" + (doneSubtasks === task.checklist.length ? " all-done" : "")}
					title="Subtasks done"
				>
					✓ {doneSubtasks}/{task.checklist.length}
				</span>
			)}
			{task.notes && (
				<span className="card-notes" title="Has notes" aria-label="Has notes">
					≡
				</span>
			)}
		</div>
	);
}

export function TaskCard({ task }: { task: Task }) {
	return (
		<>
			<div className={"card-title" + (task.description ? "" : " placeholder")}>
				{task.description || "Untitled task"}
			</div>
			<TaskMeta task={task} />
		</>
	);
}
