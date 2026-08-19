/** Splits message text into plain runs and http(s) links so links can be rendered as anchors. */

export interface TextRun {
	text: string;
	/** Present when the run is a link. */
	href?: string;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** Punctuation that usually ends a sentence rather than the URL. */
const TRAILING = /[.,;:!?'"]+$/;

/** Trims sentence punctuation and an unbalanced closing bracket off the end of a URL. */
function trimUrl(raw: string): string {
	let url = raw.replace(TRAILING, "");
	// "(see https://example.com/x)" — the ")" belongs to the sentence unless the URL opened one.
	for (let i = 0; i < 4 && url.endsWith(")"); i++) {
		const opens = url.split("(").length - 1;
		const closes = url.split(")").length - 1;
		if (closes <= opens) break;
		url = url.slice(0, -1).replace(TRAILING, "");
	}
	return url;
}

/** Returns the runs of `text` in order; concatenating their `text` reproduces the input. */
export function splitLinks(text: string): TextRun[] {
	if (!text) return [];
	const runs: TextRun[] = [];
	let cursor = 0;
	for (const match of text.matchAll(URL_PATTERN)) {
		const start = match.index;
		const href = trimUrl(match[0]);
		if (href.length === 0) continue;
		if (start > cursor) runs.push({ text: text.slice(cursor, start) });
		runs.push({ text: href, href });
		cursor = start + href.length;
	}
	if (cursor < text.length) runs.push({ text: text.slice(cursor) });
	return runs;
}
