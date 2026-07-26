import type { Metadata } from 'next';
import { ThemeToggle } from './theme-toggle';

export const metadata: Metadata = {
  title: 'Agent Profile',
  description: 'Agent runtime observability dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.setAttribute('data-theme', theme);
          })();
        `}} />
        <style dangerouslySetInnerHTML={{ __html: `
          :root, [data-theme="light"] {
            --c-bg: #f6f8fa;
            --c-card: #ffffff;
            --c-border: #d0d7de;
            --c-borderSoft: #eaeef2;
            --c-text: #1f2328;
            --c-sub: #656d76;
            --c-mute: #8c959f;
            --c-link: #0969da;
            --c-input: #0969da;
            --c-cc: #8250df;
            --c-cr: #1a7f37;
            --c-out: #bc4c00;
            --c-high: #cf222e;
            --c-medium: #9a6700;
            --c-low: #8c959f;
            --c-axis: #d0d7de;
            --c-grid: #eaeef2;
          }
          [data-theme="dark"] {
            --c-bg: #0d1117;
            --c-card: #161b22;
            --c-border: #30363d;
            --c-borderSoft: #21262d;
            --c-text: #e6edf3;
            --c-sub: #8b949e;
            --c-mute: #6e7681;
            --c-link: #58a6ff;
            --c-input: #58a6ff;
            --c-cc: #a371f7;
            --c-cr: #3fb950;
            --c-out: #d2991d;
            --c-high: #f85149;
            --c-medium: #d2991d;
            --c-low: #8b949e;
            --c-axis: #30363d;
            --c-grid: #21262d;
          }
        `}} />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          background: 'var(--c-bg)',
          color: 'var(--c-text)',
        }}
      >
        <header
          style={{ padding: '16px 24px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Agent Profile</h1>
          <ThemeToggle />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
