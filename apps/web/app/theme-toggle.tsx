'use client';

import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<string>('light');

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  return (
    <button
      onClick={toggle}
      style={{
        padding: '4px 12px',
        fontSize: 13,
        background: 'var(--c-card)',
        border: '1px solid var(--c-border)',
        borderRadius: 6,
        cursor: 'pointer',
        color: 'var(--c-text)',
      }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
