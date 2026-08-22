import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        pure: "var(--bg-pure)",
        card: "var(--bg-card)",
        "card-hover": "var(--bg-card-hover)",
        "card-border": "var(--border-card)",
        primary: "var(--theme-primary)",
        secondary: "var(--theme-secondary)",
        glow: "var(--theme-glow)",
        main: "var(--text-main)",
        muted: "var(--text-muted)",
      },
      fontFamily: {
        display: ["var(--font-display)", "monospace", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      keyframes: {
        fadeRise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0px)" },
        },
        pulseGlow: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.6", transform: "scale(1.05)" },
        },
        shiftFlash: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
      },
      animation: {
        fadeRise: "fadeRise 400ms ease-out both",
        pulseGlow: "pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        shiftFlash: "shiftFlash 0.3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
