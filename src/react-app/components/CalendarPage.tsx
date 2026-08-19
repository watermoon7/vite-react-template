/**
 * Month calendar of every task that has a due date, across all boards, plus the task editor
 * panel. Each day is a drop target and each chip a draggable: dropping a chip on another day
 * moves the task's due date there.
 */
import {
	DragDropContext,
	Draggable,
	Droppable,
	type DraggableProvided,
	type DraggableStateSnapshot,
	type DropResult,
} from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { unzoomDragStyle } from "../dragScale";
import { todayIso } from "../format";
import { replaceRoute } from "../router";
import { rescheduleTask } from "../store";
import { useDropStart } from "../useDropStart";
import { TaskEditor } from "./TaskEditor";

interface Props {
	boards: Board[];
	tasks: Task[];
	/** Task whose editor is open, taken from the route. */
	selectedId: string | null;
}

const WEEKDAYS = weekdayLabels(CALENDAR.weekStartsOn);

interface ChipProps {
	task: Task;
	className: string;
	title: string;
	provided: DraggableProvided;
	snapshot: DraggableStateSnapshot;
	onSelect: (taskId: string) => void;
	/** Called once the chip has been released and is animating into place. */
	onDropStart: () => void;
}

/** One task chip inside a Draggable; a plain click opens it, a drag moves it to another day. */
function Chip({ task, className, title, provided, snapshot, onSelect, onDropStart }: ChipProps) {
	useDropStart(snapshot, onDropStart);
	return (
		<button
			ref={provided.innerRef}
			{...provided.draggableProps}
			{...provided.dragHandleProps}
			style={unzoomDragStyle(provided.draggableProps.style)}
			type="button"
			className={className + (snapshot.isDragging ? " dragging" : "")}
			title={title}
			onClick={() => onSelect(task.id)}
		>
			{task.description.trim() || "Untitled task"}
		</button>
	);
}

interface DayProps {
	day: CalendarDay;
	/** Tasks due on this day, already sorted. */
	tasks: Task[];
	boardNames: Map<string, string>;
	selectedId: string | null;
	/** Today as YYYY-MM-DD; earlier days with open tasks are overdue. */
	today: string;
	/** True from a chip's release until dnd reports the drop; the target stops highlighting then. */
	dropping: boolean;
	onSelect: (taskId: string) => void;
	onDropStart: () => void;
}

/** One day: a drop target holding that day's chips in order. */
function DayCell({ day, tasks, boardNames, selectedId, today, dropping, onSelect, onDropStart }: DayProps) {
	const overdue = day.iso < today;
	return (
		<Droppable droppableId={day.iso}>
			{(provided, snapshot) => (
				<div
					ref={provided.innerRef}
					{...provided.droppableProps}
					className={
						"cal-day" +
						(day.inMonth ? "" : " outside") +
						(day.isToday ? " today" : "") +
						(snapshot.isDraggingOver && !dropping ? " over" : "")
					}
				>
					<time className="cal-day-num" dateTime={day.iso}>
						{day.day}
					</time>
					{tasks.map((task, index) => {
						const done = isDone(task);
						const board = boardNames.get(task.boardId) ?? "";
						const classes =
							"cal-task" +
							(task.priority ? ` cal-prio-${task.priority}` : "") +
							(done ? " done" : overdue ? " overdue" : "") +
							(task.id === selectedId ? " selected" : "");
						return (
							// The chip is a <button>; dnd would otherwise refuse to start a drag from one.
							<Draggable key={task.id} draggableId={task.id} index={index} disableInteractiveElementBlocking>
								{(p, s) => (
									<Chip
										task={task}
										className={classes}
										title={done ? `${board} · completed` : board}
										provided={p}
										snapshot={s}
										onSelect={onSelect}
										onDropStart={onDropStart}
									/>
								)}
							</Draggable>
						);
					})}
					{provided.placeholder}
				</div>
			)}
		</Droppable>
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

	// See DayProps.dropping: the day highlight goes on release, not after the drop animation.
	const [dropping, setDropping] = useState(false);
	const onDropStart = useCallback(() => setDropping(true), []);

	/** A chip dropped on another day moves the task's due date there; the same day is a no-op. */
	function onDragEnd({ source, destination, draggableId }: DropResult): void {
		setDropping(false);
		if (!destination || destination.droppableId === source.droppableId) return;
		void rescheduleTask(draggableId, destination.droppableId);
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
					<DragDropContext onDragStart={() => setDropping(false)} onDragEnd={onDragEnd}>
						<div className="cal-grid">
							{days.map((day) => (
								<DayCell
									key={day.iso}
									day={day}
									tasks={byDate.get(day.iso) ?? []}
									boardNames={boardNames}
									selectedId={selectedId}
									today={today}
									dropping={dropping}
									onSelect={select}
									onDropStart={onDropStart}
								/>
							))}
						</div>
					</DragDropContext>
				</div>

				{selected && (
					<TaskEditor key={selected.id} task={selected} board={selectedBoard} autoFocus={false} onClose={() => select(null)} />
				)}
			</div>
		</>
	);
}
