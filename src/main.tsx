import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Bundled fonts (offline-safe) — match the original DM Serif + Inter pairing.
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";

import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
