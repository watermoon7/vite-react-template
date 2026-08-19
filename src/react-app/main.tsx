import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Registers the "Inter Variable" @font-face rules used by the glass style. The font file is
// only fetched once something on the page uses that family, so the classic style pays nothing.
import "@fontsource-variable/inter";
import "./app.css";
import { initScale } from "./scale";
import { initStyle } from "./style";
import { initTheme } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

initScale();
initTheme();
initStyle();

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
