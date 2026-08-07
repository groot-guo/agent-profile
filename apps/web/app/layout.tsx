import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Header } from './header';
import './global.css';

// 全局样式:设计 token(明暗)+ 基础元素 + 工具类 + data-tip 悬浮提示
// token 语义见 theme.ts,规范见 docs/ui-guidelines.md

export const metadata: Metadata = {
  title: 'Agent Profile',
  description: 'Agent runtime observability dashboard',
};

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
