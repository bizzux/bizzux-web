import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          teal: "#14b8a6",
          cyan: "#0ea5c4",
          blue: "#2563eb",
          deep: "#1d4ed8",
          lime: "#a3e635",
        },
        navy: {
          DEFAULT: "#0f1b2d",
          light: "#16233a",
          dark: "#0a1420",
        },
        ink: "#0f172a",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(90deg, #14b8a6 0%, #0ea5c4 35%, #2563eb 75%, #1d4ed8 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, rgba(20,184,166,0.12) 0%, rgba(37,99,235,0.12) 100%)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
