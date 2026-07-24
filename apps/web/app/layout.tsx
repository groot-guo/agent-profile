import type { Metadata } from 'next';
import { C } from './theme';

export const metadata: Metadata = {
  title: 'Agent Profile',
  description: 'Agent runtime observability dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          background: C.bg,
          color: C.text,
        }}
      >
        <header
          style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}`, background: C.card }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Agent Profile</h1>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
