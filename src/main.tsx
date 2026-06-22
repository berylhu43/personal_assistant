import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Bundled fonts (offline-safe): DM Serif display, Inter body, Courier Prime
// for typewriter-style meta labels — the desk-memo voice.
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";

import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
