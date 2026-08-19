/** Month calendar of every task that has a due date, across all boards, plus the task editor panel. */
import { useEffect, useMemo, useState } from "react";
import { CALENDAR } from "../../../app.config";
import type { Board, Task } from "../../shared/types";
import {
	currentMonth,
	formatMonth,
	isDone,
	monthGrid,
	shiftMonth,
	tasksByDueDate,
	weekdayLabels,
	type CalendarDay,
} from "../calendar";
import { todayIso } from "../format";
import { replaceRoute } from "../router";
import { TaskEditor } from "./TaskEditor";

interface Props {
	boards: Board[];
	tasks: Task[];
	/** Task whose editor is open, taken from the route. */
	selectedId: string | null;
}

const WEEKDAYS = weekdayLabels(CALENDAR.weekStartsOn);

interface DayProps {
	day: CalendarDay;
	/** Tasks due on this day, already sorted. */
	tasks: Task[];
	boardNames: Map<string, string>;
	selectedId: string | null;
	/** Today as YYYY-MM-DD; earlier days with open tasks are overdue. */
	today: string;
	onSelect: (taskId: string) => void;
}

function DayCell({ day, tasks, boardNames, selectedId, today, onSelect }: DayProps) {
	const overdue = day.iso < today;
	return (
		<div className={"cal-day" + (day.inMonth ? "" : " outside") + (day.isToday ? " today" : "")}>
			<time className="cal-day-num" dateTime={day.iso}>
				{day.day}
			</time>
			{tasks.map((task) => {
				const done = isDone(task);
				const board = boardNames.get(task.boardId) ?? "";
				const classes =
					"cal-task" +
					(task.priority ? ` cal-prio-${task.priority}` : "") +
					(done ? " done" : overdue ? " overdue" : "") +
					(task.id === selectedId ? " selected" : "");
				return (
					<button
						key={task.id}
						type="button"
						className={classes}
						title={done ? `${board} · completed` : board}
						onClick={() => onSelect(task.id)}
					>
						{task.description.trim() || "Untitled task"}
					</button>
				);
			})}
		</div>
	);
}

export function CalendarPage({ boards, tasks, selectedId }: Props) {
	const [cursor, setCursor] = useState(currentMonth);
	const today = todayIso();
	const days = useMemo(() => monthGrid(cursor, CALENDAR.weekStartsOn, today), [cursor, today]);
	const byDate = useMemo(() => tasksByDueDate(tasks), [tasks]);
	const boardNames = useMemo(() => new Map(boards.map((b) => [b.id, b.name])), [boards]);
	// If the selected task was deleted (possibly by the other user) the editor closes.
	const selected = tasks.find((t) => t.id === selectedId) ?? null;
	const selectedBoard = selected ? boards.find((b) => b.id === selected.boardId) : undefined;
	const dueThisMonth = days.reduce((n, d) => n + (d.inMonth ? (byDate.get(d.iso)?.length ?? 0) : 0), 0);

	/** Opens or closes a task. Selection is not navigation, so it replaces the entry. */
	function select(taskId: string | null): void {
		replaceRoute(taskId ? { kind: "calendar", taskId } : { kind: "calendar" });
	}

	useEffect(() => {
		function onKey(e: globalThis.KeyboardEvent): void {
			if (e.key !== "Escape") return;
			replaceRoute({ kind: "calendar" });
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	return (
		<>
			<header className="page-header">
				<h1 className="page-title">Calendar</h1>
				<span className="cal-month">{formatMonth(cursor)}</span>
				<span className="muted small">{dueThisMonth === 1 ? "1 task due" : `${dueThisMonth} tasks due`}</span>
				<div className="spacer" />
				<div className="cal-nav">
					<button className="btn" type="button" aria-label="Previous month" onClick={() => setCursor((c) => shiftMonth(c, -1))}>
						‹
					</button>
					<button className="btn" type="button" onClick={() => setCursor(currentMonth())}>
						Today
					</button>
					<button className="btn" type="button" aria-label="Next month" onClick={() => setCursor((c) => shiftMonth(c, 1))}>
						›
					</button>
				</div>
			</header>

			<div className="calendar-body">
				<div className="calendar" aria-label={formatMonth(cursor)}>
					<div className="cal-weekdays">
						{WEEKDAYS.map((label) => (
							<span key={label}>{label}</span>
						))}
					</div>
					<div className="cal-grid">
						{days.map((day) => (
							<DayCell
								key={day.iso}
								day={day}
								tasks={byDate.get(day.iso) ?? []}
								boardNames={boardNames}
								selectedId={selectedId}
								today={today}
								onSelect={select}
							/>
						))}
					</div>
				</div>

				{selected && (
					<TaskEditor key={selected.id} task={selected} board={selectedBoard} autoFocus={false} onClose={() => select(null)} />
				)}
			</div>
		</>
	);
}
