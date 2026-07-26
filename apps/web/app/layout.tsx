import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Header } from './header';

export const metadata: Metadata = {
  title: 'Agent Profile',
  description: 'Agent runtime observability dashboard',
};

// 全局样式:设计 token(明暗)+ 基础元素 + 工具类 + data-tip 悬浮提示
// token 语义见 theme.ts,规范见 docs/ui-guidelines.md
const GLOBAL_CSS = `
  :root, [data-theme="light"] {
    --c-bg: #F5F3F0;
    --c-card: #FEFDFC;
    --c-border: #E6E1DA;
    --c-borderSoft: #EFEBE5;
    --c-text: #2E2C28;
    --c-sub: #6F6A61;
    --c-mute: #9C958B;
    --c-link: #5F6FC0;
    --c-input: #6E7FC7;
    --c-cc: #9A7FC8;
    --c-cr: #6FA58A;
    --c-out: #C08356;
    --c-high: #C65D4E;
    --c-medium: #B08A2E;
    --c-low: #9C958B;
    --c-axis: #DDD7CE;
    --c-grid: #EFEBE5;
    --shadow-card: 0 1px 2px rgba(80,66,45,.05), 0 6px 20px rgba(80,66,45,.05);
    --shadow-lift: 0 2px 4px rgba(80,66,45,.07), 0 10px 28px rgba(80,66,45,.09);
    --tip-bg: #35322D;
    --tip-text: #F5F3F0;
  }
  [data-theme="dark"] {
    --c-bg: #1B1A18;
    --c-card: #252220;
    --c-border: #3B3733;
    --c-borderSoft: #2E2B28;
    --c-text: #E9E5E0;
    --c-sub: #A49D93;
    --c-mute: #7D7670;
    --c-link: #9AA7EC;
    --c-input: #97A3E3;
    --c-cc: #B79FE0;
    --c-cr: #86BCA2;
    --c-out: #D2A378;
    --c-high: #DE8577;
    --c-medium: #D4B05E;
    --c-low: #7D7670;
    --c-axis: #3B3733;
    --c-grid: #2E2B28;
    --shadow-card: 0 1px 2px rgba(0,0,0,.25), 0 6px 20px rgba(0,0,0,.22);
    --shadow-lift: 0 2px 4px rgba(0,0,0,.3), 0 10px 28px rgba(0,0,0,.32);
    --tip-bg: #E9E5E0;
    --tip-text: #2E2C28;
  }
  :root {
    --header-h: 54px;
    --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    --font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.55;
    background: var(--c-bg);
    color: var(--c-text);
    -webkit-font-smoothing: antialiased;
  }
  ::selection { background: color-mix(in srgb, var(--c-link) 22%, transparent); }

  /* 数字统一等宽 + 表格数字,列对齐用 */
  .tnum { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }

  /* 换行规范:默认单行截断 + title 兜底;允许两行的用 clamp2 */
  .clamp1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clamp2 {
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; word-break: break-word;
  }

  .fade-in { animation: ap-fade .25s ease; }
  @keyframes ap-fade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }

  /* 行 hover(sidebar 列表/表格行/排行榜) */
  .ap-row { transition: background .12s ease; }
  .ap-row:hover { background: color-mix(in srgb, var(--c-text) 5%, transparent); }

  /* 按钮 hover 轻浮起 */
  .ap-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: var(--shadow-lift); }

  @media (max-width: 760px) {
    .prompt-review-grid { grid-template-columns: minmax(0, 1fr) !important; }
  }
  @media (max-width: 470px) {
    .app-header { padding-inline: 10px !important; gap: 8px !important; }
    .app-brand-label { display: none; }
    .app-nav-link { padding-inline: 9px !important; }
    .prompt-review-controls { grid-template-columns: minmax(0, 1fr) !important; }
  }

  /* data-tip 悬浮提示(内容区用;overflow:hidden 容器内改用原生 title) */
  [data-tip] { position: relative; }
  [data-tip]:hover::after {
    content: attr(data-tip);
    position: absolute; left: 50%; bottom: calc(100% + 7px); transform: translateX(-50%);
    background: var(--tip-bg); color: var(--tip-text);
    font-size: 11px; font-weight: 400; line-height: 1.45; font-family: var(--font-ui);
    padding: 5px 10px; border-radius: 8px; white-space: normal; word-break: break-word;
    width: max-content; max-width: 260px; text-align: left;
    box-shadow: 0 4px 14px rgba(0,0,0,.18);
    z-index: 100; pointer-events: none; animation: ap-fade .15s ease;
  }
  /* 边缘元素防裁剪:左对齐 / 右对齐变体 */
  [data-tip-align="start"]:hover::after { left: 0; transform: none; }
  [data-tip-align="end"]:hover::after { left: auto; right: 0; transform: none; }

  :focus-visible { outline: 2px solid var(--c-link); outline-offset: 1px; border-radius: 4px; }

  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--c-border); border-radius: 6px; border: 2px solid var(--c-bg); }
  ::-webkit-scrollbar-thumb:hover { background: var(--c-mute); }
  ::-webkit-scrollbar-track { background: transparent; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
          (function() {
            var theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.setAttribute('data-theme', theme);
          })();
        `,
          }}
        />
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body>
        <Suspense fallback={null}>
          <Header />
        </Suspense>
        <main>{children}</main>
      </body>
    </html>
  );
}
