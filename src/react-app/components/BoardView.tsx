/** One board: three drag-and-drop columns plus the task editor panel. */
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { COLUMNS, TASK_SORTS } from "../../../app.config";
import type { Board, ColumnId, ColumnOrder, Task } from "../../shared/types";
import { replaceRoute } from "../router";
import { createTask, renameBoard, reorderTasks } from "../store";
import { compareTasks, getTaskSort, setTaskSort, subscribeTaskSort, type TaskSort } from "../taskSort";
import { EditableTitle } from "./EditableTitle";
import { Segmented } from "./Segmented";
import { TaskCard } from "./TaskCard";
import { TaskEditor } from "./TaskEditor";

interface Props {
	board: Board;
	tasks: Task[];
	/** Task whose editor is open, taken from the route. */
	selectedId: string | null;
}

/** Tasks of one board grouped by column, each in the chosen sort order (manual = position). */
function groupByColumn(tasks: Task[], sort: TaskSort): Record<ColumnId, Task[]> {
	const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as Task[]])) as Record<ColumnId, Task[]>;
	for (const t of tasks) groups[t.status].push(t);
	const compare = compareTasks(sort);
	for (const list of Object.values(groups)) list.sort(compare);
	return groups;
}

const SORT_OPTIONS: { value: TaskSort; label: string }[] = TASK_SORTS.map((s) => ({ value: s.id, label: s.label }));

export function BoardView({ board, tasks, selectedId }: Props) {
	const [newTaskId, setNewTaskId] = useState<string | null>(null);
	const sort = useSyncExternalStore(subscribeTaskSort, getTaskSort);
	const byColumn = useMemo(() => groupByColumn(tasks, sort), [tasks, sort]);
	// If the selected task was deleted (possibly by the other user) the editor closes.
	const selected = tasks.find((t) => t.id === selectedId) ?? null;

	/** Opens or closes a task. Selection is not navigation, so it replaces the entry. */
	function select(taskId: string | null): void {
		replaceRoute(taskId ? { kind: "board", boardId: board.id, taskId } : { kind: "board", boardId: board.id });
	}

	useEffect(() => {
		function onKey(e: globalThis.KeyboardEvent): void {
			if (e.key !== "Escape") return;
			replaceRoute({ kind: "board", boardId: board.id });
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [board.id]);

	async function addTask(): Promise<void> {
		const id = await createTask(board.id);
		if (!id) return;
		setNewTaskId(id);
		select(id);
	}

	function onDragEnd({ source, destination, draggableId }: DropResult): void {
		if (!destination) return;
		if (source.droppableId === destination.droppableId && source.index === destination.index) return;
		const from = source.droppableId as ColumnId;
		const to = destination.droppableId as ColumnId;
		const fromIds = byColumn[from].map((t) => t.id);
		const toIds = from === to ? fromIds : byColumn[to].map((t) => t.id);
		fromIds.splice(source.index, 1);
		toIds.splice(destination.index, 0, draggableId);
		const columns: ColumnOrder = from === to ? { [from]: fromIds } : { [from]: fromIds, [to]: toIds };
		void reorderTasks(board.id, columns);
	}

	return (
		<>
			<header className="board-header">
				<EditableTitle
					key={board.id + board.name}
					value={board.name}
					label="Board name"
					onRename={(name) => void renameBoard(board.id, name)}
				/>
				<span className="muted small">{tasks.length === 1 ? "1 task" : `${tasks.length} tasks`}</span>
				<div className="board-sort">
					<span className="muted small">Sort</span>
					<Segmented label="Sort tasks" options={SORT_OPTIONS} value={sort} onChange={setTaskSort} />
				</div>
				<div className="spacer" />
				<button className="btn btn-primary" onClick={() => void addTask()}>
					+ Add task
				</button>
			</header>

			<div className="board-body">
				<DragDropContext onDragEnd={onDragEnd}>
					<div className="columns">
						{COLUMNS.map((col) => (
							<section className="column" key={col.id}>
								<header className="column-header">
									<span>{col.label}</span>
									<span className="count">{byColumn[col.id].length}</span>
								</header>
								<Droppable droppableId={col.id}>
									{(provided, snapshot) => (
										<div
											ref={provided.innerRef}
											{...provided.droppableProps}
											className={"column-list" + (snapshot.isDraggingOver ? " over" : "")}
										>
											{byColumn[col.id].map((task, index) => (
												<Draggable key={task.id} draggableId={task.id} index={index}>
													{(p, s) => (
														<div
															ref={p.innerRef}
															{...p.draggableProps}
															{...p.dragHandleProps}
															className={
																"card" + (task.id === selectedId ? " selected" : "") + (s.isDragging ? " dragging" : "")
															}
															onClick={() => select(task.id)}
														>
															<TaskCard task={task} />
														</div>
													)}
												</Draggable>
											))}
											{provided.placeholder}
										</div>
									)}
								</Droppable>
							</section>
						))}
					</div>
				</DragDropContext>

				{selected && (
					<TaskEditor
						key={selected.id}
						task={selected}
						autoFocus={selected.id === newTaskId}
						onClose={() => select(null)}
					/>
				)}
			</div>
		</>
	);
}
