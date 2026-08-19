/** A row of mutually exclusive options rendered as one joined control. */

interface Props<T extends string | null> {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
	label: string;
	/**
	 * Optional caption fused to the start of the control (e.g. "Sort" before its modes).
	 * Purely visual: not a button, not selectable, and hidden from assistive technology,
	 * which already gets `label` on the group.
	 */
	prefix?: string;
}

export function Segmented<T extends string | null>({ options, value, onChange, label, prefix }: Props<T>) {
	return (
		<div className="seg" role="radiogroup" aria-label={label}>
			{prefix && (
				<span className="seg-label" aria-hidden="true">
					{prefix}
				</span>
			)}
			{options.map((o) => (
				<button
					key={String(o.value)}
					type="button"
					role="radio"
					aria-checked={o.value === value}
					className={"seg-btn" + (o.value === value ? " on" : "")}
					onClick={() => onChange(o.value)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
