'use client';

import { useEffect, useState } from 'react';
import { C, R } from './theme';

type Theme = 'light' | 'dark';

function themeFromDocument(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function ThemeGlyph({ theme }: { theme: Theme }) {
  return theme === 'dark' ? (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ) : (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.9 14.2A8.5 8.5 0 1 1 9.8 3.1 6.7 6.7 0 0 0 20.9 14.2Z" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(themeFromDocument());
  }, []);

  const toggle = () => {
    const next: Theme = themeFromDocument() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      style={{
        width: 30,
        height: 30,
        padding: 0,
        background: 'transparent',
        border: `1px solid ${C.border}`,
        borderRadius: R.pill,
        cursor: 'pointer',
        color: C.sub,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background .15s ease, border-color .15s ease, color .15s ease',
      }}
    >
      <ThemeGlyph theme={theme} />
    </button>
  );
}
