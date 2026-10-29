import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/screens.css";
import "./styles/refresh.css";

// Set the palette before React paints, so a saved light preference never flashes dark.
const savedAppearance = localStorage.getItem("greenroom-appearance") ?? "system";
document.documentElement.dataset.theme = savedAppearance === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : savedAppearance;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
