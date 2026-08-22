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
          // A deliberate, uniform 10% darken of the site's original color
          // set (which itself was pixel-matched to the live bizzux.com
          // production site — teal #14b8a6/rgb(20,184,166), blue
          // #2563eb/rgb(37,99,235)). This is now an intentional divergence
          // from that production match, not another attempt to match it —
          // richer/higher-contrast on gradient panels while staying
          // recognizably the same brand hue.
          teal: "#12a695",
          cyan: "#0d94b0",
          blue: "#2159d4",
          deep: "#1a46c2",
          lime: "#a3e635",
          // tealDark/cyanDark/blueDark were a deliberately darker "Option A"
          // gradient tried earlier in this app's life. Kept as aliases of
          // the same values as the base brand.teal/cyan/blue above so every
          // gradient class already wired into ~15 files' buttons/panels/
          // badges renders in this same palette.
          tealDark: "#12a695",
          cyanDark: "#0d94b0",
          blueDark: "#2159d4",
        },
        navy: {
          DEFAULT: "#0f1b2d",
          light: "#16233a",
          dark: "#0a1420",
        },
        ink: "#0f172a",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(90deg, #12a695 0%, #0d94b0 35%, #2159d4 75%, #1a46c2 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, rgba(18,166,149,0.12) 0%, rgba(33,89,212,0.12) 100%)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
