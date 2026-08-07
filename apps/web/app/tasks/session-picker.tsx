'use client';

import type { SessionDiscoveryItem } from '@agent-profile/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API } from '../config';
import { sessionDisplayTitle } from '../session-navigation';
import { C, FS, R } from '../theme';
import { SoftButton } from '../ui';
import { searchTaskSessions } from './task-session-search';

const SEARCH_DEBOUNCE_MS = 250;

export function SessionPicker({
  excludeIds,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  excludeIds: ReadonlySet<string>;
  value: SessionDiscoveryItem | null;
  onChange: (session: SessionDiscoveryItem | null) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<SessionDiscoveryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [matched, setMatched] = useState(0);
  const requestSeq = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(
    async (cursor: string | undefined, preserve: boolean) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(false);
      try {
        const result = await searchTaskSessions(API, query, cursor);
        if (seq !== requestSeq.current) return;
        setSessions((current) => (preserve ? [...current, ...result.sessions] : result.sessions));
        setHasMore(result.hasMore);
        setNextCursor(result.nextCursor);
        setMatched(result.matched);
      } catch {
        if (seq !== requestSeq.current) return;
        setSessions(preserve ? (current) => current : []);
        setHasMore(false);
        setNextCursor(null);
        setError(true);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    if (!open) return;
    if (query.trim() === '') {
      loadPage(undefined, false).catch(() => {});
      return;
    }
    const timer = setTimeout(() => void loadPage(undefined, false), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [loadPage, open]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const visibleSessions = sessions.filter((session) => !excludeIds.has(session.id));

  return (
    <div ref={rootRef} style={{ position: 'relative', minWidth: 0 }}>
      <input
        style={fieldStyle}
        value={value ? sessionDisplayTitle(value) : query}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          if (value) {
            setQuery('');
            onChange(null);
          }
          if (!value && query.trim() === '') {
            loadPage(undefined, false).catch(() => {});
          }
        }}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (value) onChange(null);
        }}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 20,
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 260,
            overflowY: 'auto',
            border: `1px solid ${C.border}`,
            borderRadius: R.md,
            background: C.card,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
            padding: 6,
          }}
        >
          {loading && !hasMore && (
            <div style={{ color: C.mute, fontSize: FS.cap, padding: '8px 10px' }}>正在搜索…</div>
          )}
          {error && (
            <div style={{ color: C.high, fontSize: FS.cap, padding: '8px 10px' }}>
              Session 搜索失败
            </div>
          )}
          {!loading && !error && visibleSessions.length === 0 && (
            <div style={{ color: C.mute, fontSize: FS.cap, padding: '8px 10px' }}>
              无匹配 Session
            </div>
          )}
          {visibleSessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                onChange(session);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                border: 'none',
                borderRadius: R.sm,
                background: 'transparent',
                color: C.text,
                cursor: 'pointer',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = C.borderSoft;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent';
              }}
            >
              <div className="clamp1" style={{ fontSize: FS.sm }}>
                {sessionDisplayTitle(session)}
              </div>
              <div className="tnum" style={{ color: C.mute, fontSize: FS.cap }}>
                {session.id}
              </div>
            </button>
          ))}
          {(hasMore || (matched > visibleSessions.length && !loading)) && (
            <div style={{ padding: '6px 4px 2px' }}>
              <SoftButton
                disabled={loading}
                onClick={() => void loadPage(nextCursor ?? undefined, true)}
              >
                {loading ? '加载中…' : '加载更多'}
              </SoftButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  height: 36,
  padding: '0 10px',
  border: `1px solid ${C.border}`,
  borderRadius: R.md,
  background: C.bg,
  color: C.text,
  font: 'inherit',
};
