'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { C, FS, R } from './theme';
import { ThemeToggle } from './theme-toggle';

const NAV = [
  { href: '/', label: '会话' },
  { href: '/profiles', label: '画像' },
  { href: '/prompt-review', label: '迭代' },
  { href: '/stats', label: '统计' },
];

export function Header() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // iframe 嵌入模式(?embed=1)不渲染全局 header,避免嵌套
  if (searchParams.get('embed') === '1') return null;
  return (
    <header
      className="app-header"
      style={{
        height: 'var(--header-h)',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: C.card,
        boxShadow: '0 1px 0 var(--c-borderSoft)',
        position: 'relative',
        zIndex: 10,
      }}
    >
      <Link
        href="/"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        <span
          className="app-brand-label"
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            flexShrink: 0,
            background: `linear-gradient(135deg, ${C.input}, ${C.cc})`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
          }}
        >
          A
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: C.text,
            letterSpacing: -0.2,
            whiteSpace: 'nowrap',
          }}
        >
          Agent Profile
        </span>
      </Link>
      <nav className="app-nav" style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        {NAV.map((n) => {
          const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className="app-nav-link"
              style={{
                padding: '4px 12px',
                borderRadius: R.pill,
                fontSize: FS.sm,
                textDecoration: 'none',
                color: active ? C.link : C.sub,
                fontWeight: active ? 600 : 400,
                background: active ? `${C.link}14` : 'transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div style={{ flex: 1 }} />
      <ThemeToggle />
    </header>
  );
}
