import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#fff8e6", 100: "#ffefc2", 500: "#c99a2e", 600: "#a87d1f", 700: "#86621a", 900: "#3d2d0b" },
        ink: { DEFAULT: "#1c1f26", soft: "#4a5160", mute: "#7a8190" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
