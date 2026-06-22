/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1C1C1E",
        cream: "#F5F0E8",
        gold: "#D4A853",
        "gold-deep": "#B8902F",
        done: "#1D9E75",
        paper: "#FBF7EF",
      },
      fontFamily: {
        serif: ["'DM Serif Display'", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'Courier Prime'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        memo: "0 1px 2px rgba(44, 33, 16, 0.06), 0 8px 24px -12px rgba(44, 33, 16, 0.18)",
        lift: "0 2px 4px rgba(44, 33, 16, 0.08), 0 14px 30px -16px rgba(44, 33, 16, 0.28)",
      },
    },
  },
  plugins: [],
};
