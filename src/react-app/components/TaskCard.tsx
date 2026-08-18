/** Compact card shown in a column. */
import { COLUMNS, PRIORITIES } from "../../../app.config";
import type { Task } from "../../shared/types";
import { formatDueDate, isOverdue, userName } from "../format";

/** The last column counts as done; overdue styling is suppressed there. */
const DONE_COLUMN = COLUMNS[COLUMNS.length - 1].id;

export function TaskCard({ task }: { task: Task }) {
	const priority = PRIORITIES.find((p) => p.id === task.priority);
	const overdue = task.dueDate !== null && task.status !== DONE_COLUMN && isOverdue(task.dueDate);
	return (
		<>
			<div className={"card-title" + (task.description ? "" : " placeholder")}>
				{task.description || "Untitled task"}
			</div>
			<div className="card-meta">
				{priority && <span className={`tag prio-${priority.id}`}>{priority.label}</span>}
				{task.dueDate && (
					<span className={"card-due" + (overdue ? " overdue" : "")} title={overdue ? "Overdue" : "Due"}>
						{formatDueDate(task.dueDate)}
					</span>
				)}
				<span className="card-assignee">{userName(task.assignee)}</span>
				{task.notes && (
					<span className="card-notes" title="Has notes" aria-label="Has notes">
						≡
					</span>
				)}
			</div>
		</>
	);
}
