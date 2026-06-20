import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @tauri-apps conventions: fixed port, no clearScreen so Rust logs show.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // tauri sources are watched by the Rust side, not Vite.
      ignored: ["**/src-tauri/**"],
    },
  },
});
