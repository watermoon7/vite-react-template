/** Account (sign out) and local backups (snapshots, download, import, restore). */
import { useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { CLIENT, DISPLAY, STYLES, THEMES } from "../../../app.config";
import type { AppState, BackupData, UserId } from "../../shared/types";
import {
	deleteSnapshot,
	downloadJson,
	isBackupStale,
	listSnapshots,
	parseBackupFile,
	subscribeSnapshots,
	takeSnapshot,
	type Snapshot,
	type SnapshotReason,
} from "../backups";
import { formatDateTime, formatRelative, userName } from "../format";
import { canDecrease, canIncrease, getScale, resetScale, stepScale, subscribeScale } from "../scale";
import { logout, restoreBackup } from "../store";
import { getStyle, setStyle, subscribeStyle, type StylePreference } from "../style";
import { getTheme, setTheme, subscribeTheme, type ThemePreference } from "../theme";
import { ConfirmButton, ConfirmPopover } from "./Confirm";
import { Segmented } from "./Segmented";

interface Props {
	user: UserId;
	data: AppState;
}

const REASON_LABEL: Record<SnapshotReason, string> = {
	periodic: "Periodic",
	"before-delete": "Before deletion",
	manual: "Manual",
};

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = THEMES.map((t) => ({
	value: t.id,
	label: t.label,
}));

const STYLE_OPTIONS: { value: StylePreference; label: string }[] = STYLES.map((s) => ({
	value: s.id,
	label: s.label,
}));

function fileStem(prefix: string, iso: string): string {
	return `${prefix}-${iso.slice(0, 16).replace(/[:T]/g, "-")}`;
}

export function SettingsPage({ user, data }: Props) {
	const snapshots = useSyncExternalStore(subscribeSnapshots, listSnapshots);
	const scale = useSyncExternalStore(subscribeScale, getScale);
	const theme = useSyncExternalStore(subscribeTheme, getTheme);
	const style = useSyncExternalStore(subscribeStyle, getStyle);
	const [message, setMessage] = useState<string | null>(null);
	// A parsed import waiting for the user to confirm restoring it (the popover sits by the Import button).
	const [pendingImport, setPendingImport] = useState<{ data: BackupData; label: string } | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	const newest = snapshots[0];
	// Only worth warning about once there is something to lose.
	const hasData = data.boards.length > 0 || data.tasks.length > 0;
	const stale = hasData && isBackupStale(snapshots);

	function backupNow(): void {
		const snap = takeSnapshot(data, "manual");
		const empty = data.boards.length === 0 && data.tasks.length === 0;
		setMessage(snap ? "Snapshot saved." : empty ? "Nothing to back up yet." : "Nothing changed since the latest snapshot.");
	}

	/** Restores `source`; callers ask for confirmation first (see ConfirmButton / pendingImport). */
	async function restore(source: BackupData): Promise<void> {
		const result = await restoreBackup(source);
		if (!result) return;
		const total = result.restoredBoards + result.restoredTasks;
		setMessage(
			total === 0
				? "Nothing to restore — everything in that backup still exists."
				: `Restored ${result.restoredBoards} board(s) and ${result.restoredTasks} task(s).`,
		);
	}

	async function importFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		try {
			setPendingImport({ data: parseBackupFile(await file.text()), label: `“${file.name}”` });
		} catch (err) {
			setMessage(`Could not read file: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	function remove(snapshot: Snapshot): void {
		deleteSnapshot(snapshot.id);
	}

	return (
		<div className="page">
			<header className="page-header">
				<h1 className="page-title">Settings</h1>
			</header>
			<div className="page-body">
				<section className="settings-section">
					<h2 className="section-title">Account</h2>
					<p>
						Signed in as <strong>{userName(user)}</strong>.
					</p>
					<button className="btn" onClick={() => void logout()}>
						Sign out
					</button>
				</section>

				<section className="settings-section">
					<h2 className="section-title">Display</h2>
					<p className="muted">
						Scales everything in the app, the same as your browser’s zoom (Ctrl +/−). Saved for this browser only,
						so it does not change what the other person sees.
					</p>
					<div className="row">
						<div className="stepper">
							<button
								className="stepper-btn"
								onClick={() => stepScale(-1)}
								disabled={!canDecrease(scale)}
								aria-label="Decrease interface scale"
							>
								−
							</button>
							<span className="stepper-value" aria-live="polite" aria-label="Interface scale">
								{Math.round(scale * 100)}%
							</span>
							<button
								className="stepper-btn"
								onClick={() => stepScale(1)}
								disabled={!canIncrease(scale)}
								aria-label="Increase interface scale"
							>
								+
							</button>
						</div>
						<button className="btn" onClick={resetScale} disabled={scale === DISPLAY.defaultScale}>
							Reset
						</button>
					</div>
					<div className="field">
						<span className="label">Style</span>
						<Segmented label="Style" options={STYLE_OPTIONS} value={style} onChange={setStyle} />
						<p className="muted small">
							“Glass” is a translucent look over a soft colour backdrop; “Classic” is the original flat look.
							Remembered for you in this browser.
						</p>
					</div>
					<div className="field">
						<span className="label">Theme</span>
						<Segmented label="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
						<p className="muted small">“System” follows your operating system’s appearance setting.</p>
					</div>
				</section>

				<section className="settings-section">
					<h2 className="section-title">Local backups</h2>
					<p className="muted">
						Snapshots of all boards and tasks are stored in this browser automatically — every{" "}
						{CLIENT.backupIntervalMinutes} minutes and whenever something is deleted (the state just before the
						deletion is kept). The newest {CLIENT.backupMaxSnapshots} are retained. Restoring re-creates missing
						boards and tasks; existing items are never changed.
					</p>
					<p className="muted">
						They live in this browser only. Safari discards them after about {CLIENT.backupStaleWarningDays} days
						without a visit, and any browser drops them when you clear site data — download a copy of anything
						you cannot afford to lose.
					</p>
					{newest && <p className="muted small">Latest snapshot: {formatRelative(newest.at)}.</p>}
					{stale && (
						<p className="notice" role="status">
							No recent local backup in this browser. Use “Download current data” to keep a copy outside it.
						</p>
					)}
					<div className="row">
						<button className="btn" onClick={backupNow}>
							Back up now
						</button>
						<button className="btn" onClick={() => downloadJson(data, fileStem("kanban", new Date().toISOString()))}>
							Download current data
						</button>
						<span className="confirm-anchor">
							<button className="btn" onClick={() => fileInput.current?.click()}>
								Import file…
							</button>
							{pendingImport && (
								<ConfirmPopover
									message={`Restore missing boards and tasks from ${pendingImport.label}?`}
									detail="Existing items are left untouched."
									confirmLabel="Restore"
									placement="below-start"
									onConfirm={() => {
										const { data } = pendingImport;
										setPendingImport(null);
										void restore(data);
									}}
									onCancel={() => setPendingImport(null)}
								/>
							)}
						</span>
						<input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e)} />
					</div>
					{message && (
						<p className="notice" role="status">
							{message}
						</p>
					)}

					{snapshots.length === 0 ? (
						<p className="muted">No snapshots yet.</p>
					) : (
						<div className="table-wrap">
							<table className="table">
								<thead>
									<tr>
										<th>When</th>
										<th>Reason</th>
										<th className="num">Boards</th>
										<th className="num">Tasks</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{snapshots.map((s) => (
										<tr key={s.id}>
											<td>{formatDateTime(s.at)}</td>
											<td>{REASON_LABEL[s.reason]}</td>
											<td className="num">{s.boards.length}</td>
											<td className="num">{s.tasks.length}</td>
											<td className="actions">
												<button className="btn btn-ghost" onClick={() => downloadJson(s, fileStem("kanban-snapshot", s.at))}>
													Download
												</button>
												<ConfirmButton
													className="btn btn-ghost"
													message={`Restore missing boards and tasks from the snapshot of ${formatDateTime(s.at)}?`}
													detail="Existing items are left untouched."
													confirmLabel="Restore"
													onConfirm={() => void restore(s)}
												>
													Restore
												</ConfirmButton>
												<button className="btn btn-ghost danger" onClick={() => remove(s)}>
													Delete
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
