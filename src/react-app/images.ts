/**
 * Prepares an image chosen or pasted by the user for posting: accepted formats under the
 * size cap are sent untouched (so GIFs stay animated); anything else is scaled down and
 * re-encoded as JPEG in the browser so the upload fits CHANNELS.imageMaxBytes.
 */
import { CHANNELS } from "../../app.config";

/** Approximate decoded size of a base64 data URL, in bytes. */
export function dataUrlBytes(dataUrl: string): number {
	const comma = dataUrl.indexOf(",");
	if (comma < 0) return 0;
	const payload = dataUrl.length - comma - 1;
	const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
	return Math.floor((payload * 3) / 4) - padding;
}

function readAsDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error("Could not read the file"));
		reader.readAsDataURL(blob);
	});
}

/** Draws the image onto a canvas no larger than CHANNELS.imageMaxDimension and returns it as JPEG. */
async function reencode(file: File): Promise<string> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new Error("That file is not an image this browser can read");
	}
	const longest = Math.max(bitmap.width, bitmap.height);
	if (longest === 0) throw new Error("That image is empty");
	const scale = Math.min(1, CHANNELS.imageMaxDimension / longest);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not process the image");
	ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	return canvas.toDataURL("image/jpeg", CHANNELS.imageJpegQuality);
}

/**
 * Returns a base64 data URL ready to post, or throws an Error with a user-facing message.
 * `file` must be an image (any format the browser can decode).
 */
export async function prepareImage(file: File): Promise<string> {
	if (!file.type.startsWith("image/")) throw new Error("Only images can be attached");
	if (CHANNELS.imageTypes.includes(file.type) && file.size <= CHANNELS.imageMaxBytes) {
		return readAsDataUrl(file);
	}
	const dataUrl = await reencode(file);
	if (dataUrlBytes(dataUrl) > CHANNELS.imageMaxBytes) {
		throw new Error(`That image is too large even after resizing (limit ${Math.round(CHANNELS.imageMaxBytes / 1_000_000)} MB)`);
	}
	return dataUrl;
}

/** The first image file in a paste or drop, if any. */
export function firstImageFile(files: FileList | null | undefined): File | null {
	if (!files) return null;
	for (const file of Array.from(files)) {
		if (file.type.startsWith("image/")) return file;
	}
	return null;
}
