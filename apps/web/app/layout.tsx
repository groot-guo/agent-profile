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
  html { margin: 0; padding: 0; scrollbar-gutter: stable; }
  body { margin: 0; padding: 0; }
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
  .app-nav-spinner {
    width: 9px;
    height: 9px;
    border: 1.5px solid color-mix(in srgb, var(--c-link) 28%, transparent);
    border-top-color: var(--c-link);
    border-radius: 50%;
    animation: ap-spin .65s linear infinite;
  }
  @keyframes ap-spin { to { transform: rotate(360deg); } }

  /* 行 hover(sidebar 列表/表格行/排行榜) */
  .ap-row { transition: background .12s ease; }
  .ap-row:hover { background: color-mix(in srgb, var(--c-text) 5%, transparent); }

  /* 按钮 hover 轻浮起 */
  .ap-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: var(--shadow-lift); }

  /* Home Session 检索台:筛选优先,本地数据操作次之 */
  .home-sidebar {
    width: 376px;
    min-width: 376px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--c-card);
    box-shadow: 1px 0 0 var(--c-borderSoft);
  }
  .session-filter-console {
    padding: 14px 16px 12px;
    background:
      linear-gradient(
        155deg,
        color-mix(in srgb, var(--c-link) 5%, var(--c-card)) 0%,
        var(--c-card) 48%
      );
    box-shadow: 0 1px 0 var(--c-borderSoft);
  }
  .session-filter-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }
  .session-filter-eyebrow {
    margin-bottom: 1px;
    color: var(--c-link);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .13em;
    line-height: 1.3;
    text-transform: uppercase;
  }
  .session-filter-heading h1 {
    margin: 0;
    color: var(--c-text);
    font-size: 18px;
    font-weight: 650;
    letter-spacing: -.02em;
    line-height: 1.3;
  }
  .session-filter-result {
    display: grid;
    grid-template-columns: auto auto;
    align-items: baseline;
    justify-items: end;
    column-gap: 4px;
    color: var(--c-mute);
    line-height: 1;
  }
  .session-filter-result strong {
    color: var(--c-text);
    font-size: 20px;
    font-weight: 650;
    letter-spacing: -.05em;
  }
  .session-filter-result > span { font-size: 11px; }
  .session-filter-result small {
    grid-column: 1 / -1;
    margin-top: 4px;
    font-size: 11px;
    font-weight: 500;
  }
  .session-search {
    position: relative;
    display: flex;
    align-items: center;
    height: 40px;
    margin-top: 12px;
    overflow: hidden;
    border: 1px solid var(--c-border);
    border-radius: 12px;
    background: var(--c-bg);
    color: var(--c-mute);
    transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
  }
  .session-search:focus-within {
    border-color: color-mix(in srgb, var(--c-link) 65%, var(--c-border));
    background: var(--c-card);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-link) 12%, transparent);
  }
  .session-search-icon {
    display: inline-flex;
    margin-left: 12px;
    flex: 0 0 auto;
  }
  .session-search input {
    width: 100%;
    min-width: 0;
    height: 100%;
    padding: 0 10px;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--c-text);
    font: inherit;
    font-size: 12px;
  }
  .session-search input::placeholder { color: var(--c-mute); }
  .session-search button {
    align-self: stretch;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--c-link);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
  .session-filter-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
    margin-top: 10px;
  }
  .session-filter-field {
    position: relative;
    min-width: 0;
    padding: 6px 32px 6px 10px;
    border: 1px solid var(--c-borderSoft);
    border-radius: 10px;
    background: color-mix(in srgb, var(--c-bg) 82%, var(--c-card));
    transition: border-color .15s ease, background .15s ease;
  }
  .session-filter-field:focus-within {
    border-color: color-mix(in srgb, var(--c-link) 55%, var(--c-border));
    background: var(--c-card);
  }
  .session-filter-field-wide { grid-column: 1 / -1; }
  .session-filter-field > span {
    display: block;
    margin-bottom: 1px;
    color: var(--c-mute);
    font-size: 11px;
    font-weight: 550;
    line-height: 1.3;
  }
  .session-filter-field select {
    display: block;
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    outline: 0;
    appearance: none;
    background: transparent;
    color: var(--c-text);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 550;
    line-height: 1.5;
  }
  .session-filter-chevron {
    position: absolute;
    right: 10px;
    bottom: 10px;
    color: var(--c-mute);
    pointer-events: none;
  }
  .session-filter-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin: 12px 2px 5px;
    color: var(--c-sub);
    font-size: 11px;
    font-weight: 650;
  }
  .session-filter-section-head > span:last-child {
    color: var(--c-mute);
    font-weight: 450;
  }
  .session-quick-view {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 3px;
    min-width: 0;
    margin: 0;
    padding: 3px;
    border: 1px solid var(--c-borderSoft);
    border-radius: 10px;
    background: var(--c-bg);
  }
  .session-quick-view button {
    min-width: 0;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--c-sub);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    transition: background .15s ease, color .15s ease, box-shadow .15s ease;
  }
  .session-quick-view button:hover {
    color: var(--c-text);
    background: color-mix(in srgb, var(--c-link) 7%, transparent);
  }
  .session-quick-view button[aria-pressed="true"] {
    background: var(--c-card);
    color: var(--c-link);
    box-shadow: 0 1px 3px color-mix(in srgb, var(--c-text) 9%, transparent);
    font-weight: 650;
  }
  .session-filter-clear {
    width: 100%;
    margin-top: 5px;
    padding: 2px 4px;
    border: 0;
    background: transparent;
    color: var(--c-link);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    text-align: right;
  }
  .session-agent-heading { margin-top: 10px; }
  .session-agent-filter {
    display: flex;
    gap: 4px;
    flex-wrap: nowrap;
  }
  .session-agent-filter button {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
    padding: 4px 7px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--c-bg);
    color: var(--c-sub);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    transition: background .15s ease, border-color .15s ease, color .15s ease;
  }
  .session-agent-filter button:hover {
    border-color: color-mix(in srgb, var(--agent-color) 28%, var(--c-borderSoft));
  }
  .session-agent-filter button[aria-pressed="true"] {
    border-color: color-mix(in srgb, var(--agent-color) 22%, transparent);
    background: color-mix(in srgb, var(--agent-color) 13%, var(--c-card));
    color: var(--agent-color);
    font-weight: 650;
  }
  .session-agent-filter button > span:nth-last-child(2) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-agent-filter button > span:last-child { opacity: .68; }
  .session-sidebar-operations {
    padding: 8px 16px 9px;
    background: var(--c-card);
    box-shadow: 0 1px 0 var(--c-borderSoft);
  }
  .session-operation-actions {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }
  .session-data-management-toggle {
    padding: 5px 9px;
    border: 1px solid var(--c-border);
    border-radius: 10px;
    background: transparent;
    color: var(--c-sub);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    transition: border-color .15s ease, color .15s ease, background .15s ease;
  }
  .session-data-management-toggle:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--c-link) 35%, var(--c-border));
    background: color-mix(in srgb, var(--c-link) 6%, transparent);
    color: var(--c-link);
  }
  .session-data-management-toggle:disabled { opacity: .45; cursor: not-allowed; }
  .session-list {
    flex: 1;
    min-height: 80px;
    overflow-y: auto;
    padding-bottom: 8px;
    background: var(--c-card);
  }
  .session-time-group { margin-bottom: 8px; }
  .session-time-heading {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 16px;
    background: color-mix(in srgb, var(--c-bg) 90%, transparent);
    box-shadow: 0 1px 0 var(--c-borderSoft);
    backdrop-filter: blur(10px);
    color: var(--c-mute);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: .02em;
  }
  .session-row {
    display: block;
    width: calc(100% - 24px);
    margin: 3px 12px;
    padding: 9px 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--c-text);
    cursor: pointer;
    text-align: left;
  }
  .session-row[data-selected="true"] {
    background: color-mix(in srgb, var(--c-link) 11%, var(--c-card));
    box-shadow: inset 3px 0 0 var(--c-link);
  }
  .session-list-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 16px;
    background: var(--c-card);
    box-shadow: 0 -1px 0 var(--c-borderSoft);
    color: var(--c-mute);
    font-size: 11px;
  }
  .session-list-footer strong { color: var(--c-text); font-weight: 650; }

  /* Session detail:固定摘要 + 仪器式分析视图,长证据按需展开 */
  .home-content { min-width: 0; }
  .session-detail-frame {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .session-detail-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 0 0 auto;
  }
  .session-detail-toolbar-title {
    min-width: 0;
    flex: 1 1 220px;
  }
  .session-detail-iframe {
    display: block;
    width: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1 1 0;
    border: 0;
  }
  .session-page {
    max-width: 1240px;
    margin: 0 auto;
    padding: 24px;
  }
  .session-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .session-view-nav {
    position: sticky;
    top: calc(var(--header-h) + 8px);
    z-index: 20;
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: stretch;
    gap: 8px;
    margin: 0 0 24px;
    padding: 8px;
    border: 1px solid var(--c-border);
    border-radius: 14px;
    background: color-mix(in srgb, var(--c-bg) 88%, transparent);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--c-text) 8%, transparent);
    backdrop-filter: blur(14px);
  }
  .session-view-nav[data-embedded="true"] { top: 8px; }
  .session-view-nav-label {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 10px;
    color: var(--c-mute);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: .12em;
    line-height: 1.35;
    text-transform: uppercase;
  }
  .session-view-nav-label .tnum {
    color: var(--c-link);
    font-size: 16px;
    letter-spacing: -.04em;
  }
  .session-view-tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    min-width: 0;
  }
  .session-view-tab {
    min-width: 0;
    padding: 8px 11px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--c-sub);
    cursor: pointer;
    text-align: left;
    transition: background .15s ease, color .15s ease, box-shadow .15s ease;
  }
  .session-view-tab > span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-view-tab > span:first-child {
    color: inherit;
    font-size: 13px;
    font-weight: 650;
  }
  .session-view-tab > span:last-child {
    margin-top: 1px;
    color: var(--c-mute);
    font-size: 10px;
  }
  .session-view-tab:hover { background: color-mix(in srgb, var(--c-link) 7%, transparent); }
  .session-view-tab[data-active="true"] {
    background: var(--c-card);
    color: var(--c-text);
    box-shadow: inset 0 -2px 0 var(--c-link), 0 2px 8px color-mix(in srgb, var(--c-text) 7%, transparent);
  }
  .session-view-tab[data-active="true"] > span:last-child { color: var(--c-link); }
  .session-view-panel { min-height: 320px; }
  .session-view-intro {
    display: grid;
    grid-template-columns: 112px minmax(220px, .9fr) minmax(320px, 1.4fr);
    gap: 20px;
    align-items: baseline;
    margin: 2px 4px 18px;
  }
  .session-view-intro > div {
    color: var(--c-link);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .13em;
  }
  .session-view-intro h3 {
    margin: 0;
    color: var(--c-text);
    font-size: 18px;
    font-weight: 650;
    line-height: 1.35;
  }
  .session-view-intro p {
    margin: 0;
    max-width: 680px;
    color: var(--c-sub);
    font-size: 12px;
    line-height: 1.65;
  }
  .session-card-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
    margin-bottom: 24px;
  }
  .session-analysis-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 24px;
  }
  .session-tool-param-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
    font-size: 12px;
  }
  .session-mini-stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }
  .session-token-legend {
    display: flex;
    gap: 24px;
    margin-top: 12px;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .session-commit-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 3px 6px;
    border-radius: 6px;
    font-size: 12px;
  }

  @media (max-width: 900px) {
    .session-view-intro {
      grid-template-columns: 96px minmax(200px, .9fr) minmax(260px, 1.2fr);
      gap: 14px;
    }
    .session-tool-param-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .home-shell {
      flex-direction: column;
      height: auto !important;
      min-height: calc(100vh - var(--header-h));
      overflow: visible !important;
    }
    .home-sidebar {
      width: 100% !important;
      min-width: 0 !important;
      height: min(72vh, 640px);
      min-height: 520px;
      flex: 0 0 auto;
      box-shadow: 0 1px 0 var(--c-borderSoft) !important;
    }
    .home-content {
      min-width: 0;
      min-height: calc(100vh - var(--header-h));
      flex: 0 0 auto !important;
      overflow: visible !important;
    }
    .home-content[data-selected="true"] {
      height: calc(100vh - var(--header-h));
      overflow: hidden !important;
    }
    .session-detail-toolbar { flex-wrap: wrap; }
    .session-detail-toolbar-title { flex-basis: 180px; }
    .prompt-review-grid { grid-template-columns: minmax(0, 1fr) !important; }
    .session-page { padding: 16px; }
    .session-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .session-view-nav {
      grid-template-columns: minmax(0, 1fr);
      top: calc(var(--header-h) + 4px);
      padding: 6px;
    }
    .session-view-nav[data-embedded="true"] { top: 4px; }
    .session-view-nav-label { display: none; }
    .session-view-tabs {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .session-view-tabs::-webkit-scrollbar { display: none; }
    .session-view-tab { flex: 0 0 138px; }
    .session-view-intro {
      grid-template-columns: minmax(0, 1fr);
      gap: 3px;
      margin-bottom: 14px;
    }
    .session-view-intro h3 { font-size: 16px; }
    .session-view-intro p { margin-top: 3px; }
    .session-card-grid,
    .session-analysis-grid,
    .session-tool-param-grid { grid-template-columns: minmax(0, 1fr); }
    .session-card-grid,
    .session-analysis-grid { gap: 12px; }
    .session-mini-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  }
  @media (max-width: 470px) {
    .app-header { padding-inline: 10px !important; gap: 8px !important; }
    .app-brand-label { display: none; }
    .app-nav-link { padding-inline: 9px !important; }
    .prompt-review-controls { grid-template-columns: minmax(0, 1fr) !important; }
    .session-page { padding: 12px; }
    .session-token-legend { gap: 10px 16px; }
    .session-commit-row > :last-child { display: none; }
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
        <script>{`
          (function() {
            var theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.setAttribute('data-theme', theme);
          })();
        `}</script>
        <style>{GLOBAL_CSS}</style>
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
