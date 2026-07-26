'use client';

import { useEffect, useState } from 'react';
import { C, R } from './theme';

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
      data-tip={theme === 'dark' ? '切换到浅色' : '切换到深色'}
      style={{
        width: 30, height: 30, fontSize: 14,
        background: 'transparent', border: `1px solid ${C.border}`, borderRadius: R.pill,
        cursor: 'pointer', color: C.sub, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
