/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // 颜色全部指向 src/styles/tokens.css 里的 CSS 变量。
      // 组件里不要写死色值, 也不要写 dark: 变体, 主题由变量在暗色媒体查询里整体切换。
      colors: {
        canvas: "var(--n-canvas)",
        surface: "var(--n-surface)",
        raised: "var(--n-raised)",
        line: "var(--n-line)",
        "line-strong": "var(--n-line-strong)",
        dim: "var(--n-text-dim)",
        ink: "var(--n-text)",
        "ink-strong": "var(--n-text-strong)",
        accent: {
          DEFAULT: "var(--a)",
          tint: "var(--a-tint)",
          tint2: "var(--a-tint-2)",
          line: "var(--a-line)",
          mid: "var(--a-mid)",
          strong: "var(--a-strong)",
          ink: "var(--a-ink)",
          on: "var(--a-on)",
        },
        warn: { DEFAULT: "var(--warn)", tint: "var(--warn-tint)" },
        danger: { DEFAULT: "var(--danger)", tint: "var(--danger-tint)" },
      },
      // 圆角只有三个值。控件 8px, 面板 14px, 胶囊 full。
      borderRadius: {
        control: "var(--r-control)",
        panel: "var(--r-panel)",
      },
      fontFamily: {
        // 不引外部字体。系统栈最快, 且中文有可靠回退。
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Cascadia Mono",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      zIndex: {
        nav: "var(--z-nav)",
        overlay: "var(--z-overlay)",
        toast: "var(--z-toast)",
      },
      boxShadow: {
        // 阴影带背景色相, 不用纯黑
        panel: "0 1px 2px rgb(20 24 28 / 0.04), 0 8px 24px -12px rgb(20 24 28 / 0.10)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
