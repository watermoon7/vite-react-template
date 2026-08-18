import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Desktop support floor. Keep in step with the vendor prefixes hand-written in app.css.
 * Firefox 126 rather than the Vite baseline's 104: the interface-scale feature relies on
 * the `zoom` property, which Firefox only implemented in 126.
 */
const BROWSER_TARGETS = ["chrome107", "edge107", "firefox126", "safari16"];

export default defineConfig({
	plugins: [react(), cloudflare()],
	build: {
		target: BROWSER_TARGETS,
		cssTarget: BROWSER_TARGETS,
	},
});
