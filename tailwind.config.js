/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // D2: display font for hero / page titles. Body keeps Pretendard/Inter chain (src/index.css L170+).
        // Georgia = system serif on Win/Mac/iOS/Android — zero external dep + luxury look.
        // Upgrade path: swap to ["Instrument Serif", ...Georgia chain] once Google Fonts permission added.
        display: ['Georgia', '"Times New Roman"', '"Noto Serif KR"', 'serif'],
      },
      colors: {
        // CocoTrip brand tokens (DESIGN.md SSOT)
        // CSS vars: src/index.css :root brand vars block
        // Usage: bg-bg-base / bg-bg-card / text-cc-primary / shadow-glow-cta / rounded-cc-md
        // v4 migration: move to @theme in index.css, remove this extend section.
        bg: {
          base:     "var(--color-bg-base)",
          card:     "var(--color-bg-card)",
          elevated: "var(--color-bg-elevated)",
        },
        brand: {
          purple:         "var(--color-brand-purple)",
          "purple-hover": "var(--color-brand-purple-hover)",
          pink:           "var(--color-brand-pink)",
        },
        cc: {
          primary:   "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted:     "var(--color-text-muted)",
          disabled:  "var(--color-text-disabled)",
        },
        "cc-border": {
          default: "var(--color-border-default)",
          active:  "var(--color-border-active)",
        },
        "cc-status": {
          success: "var(--color-success)",
          warning: "var(--color-warning)",
          error:   "var(--color-error)",
        },
        // shadcn/ui semantic tokens (keep as-is)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
        "cc-sm":  "var(--radius-sm)",
        "cc-md":  "var(--radius-md)",
        "cc-lg":  "var(--radius-lg)",
        "cc-xl":  "var(--radius-xl)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "glow-cta":   "var(--shadow-glow-cta)",
        "ring-focus": "var(--ring-focus)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
