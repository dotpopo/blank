/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#18352d",
        muted: "#78837d",
        brand: {
          DEFAULT: "#245b47",
          dark: "#194735",
        },
        mint: "#e9f2ec",
        paper: "#f8f9f6",
        line: "#e8ebe6",
      },
      boxShadow: {
        soft: "0 12px 36px rgba(27, 55, 43, .07)",
        modal: "0 25px 70px rgba(0, 0, 0, .17)",
      },
      borderRadius: {
        xl2: "1.125rem",
      },
    },
  },
  plugins: [],
};
