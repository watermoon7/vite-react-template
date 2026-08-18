import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";
import { initScale } from "./scale";
import { initTheme } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

initScale();
initTheme();

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
