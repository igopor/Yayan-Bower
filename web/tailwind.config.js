import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('tailwindcss').Config} */
export default {
  // 用绝对路径，避免从仓库根启动 vite 时 glob 解析错位
  content: [path.join(here, 'index.html'), path.join(here, 'src/**/*.{vue,ts}')],
  theme: {
    extend: {
      // 颜色全部走 CSS 变量（见 src/styles/main.css），改一处全站生效。
      // 用 rgb(var(--x) / <alpha-value>) 才能让 bg-primary/10 这类透明度修饰生效
      colors: {
        primary: 'rgb(var(--c-primary) / <alpha-value>)',
        'primary-soft': 'rgb(var(--c-primary-soft) / <alpha-value>)',
        'primary-deep': 'rgb(var(--c-primary-deep) / <alpha-value>)',
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-weak': 'rgb(var(--c-ink-weak) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        ok: 'rgb(var(--c-ok) / <alpha-value>)',
        bad: 'rgb(var(--c-bad) / <alpha-value>)',
      },
      borderRadius: {
        card: 'var(--r-card)',
        btn: 'var(--r-btn)',
      },
      boxShadow: {
        card: '0 2px 12px rgba(74, 144, 217, 0.08)',
        float: '0 8px 28px rgba(44, 62, 80, 0.14)',
      },
      maxWidth: {
        page: '1040px',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
