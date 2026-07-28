'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterProjectPickerOptions,
  type ProjectPickerGroup,
  type ProjectPickerOption,
} from './session-navigation';

const GROUP_LABELS: Record<ProjectPickerGroup, string> = {
  records: '会话记录',
  recent: '最近使用',
  other: '其他项目',
};

export function ProjectPicker({
  options,
  totalCount,
  value,
  onChange,
}: {
  options: ProjectPickerOption[];
  totalCount: number;
  value: string;
  onChange: (project: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = options.find((option) => option.project === value);
  const filtered = useMemo(() => filterProjectPickerOptions(options, query), [options, query]);
  const grouped = useMemo(
    () =>
      (['records', 'recent', 'other'] as ProjectPickerGroup[])
        .map((group) => ({ group, options: filtered.filter((option) => option.group === group) }))
        .filter((entry) => entry.options.length > 0),
    [filtered],
  );
  const optionIndex = useMemo(
    () => new Map(filtered.map((option, index) => [option.project, index + 1])),
    [filtered],
  );
  const optionCount = filtered.length + 1;
  const activeId = activeIndex === 0 ? 'project-option-all' : `project-option-${activeIndex}`;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId, open]);

  const openPicker = () => {
    setQuery('');
    setActiveIndex(value ? (options.findIndex((option) => option.project === value) ?? -1) + 1 : 0);
    setOpen(true);
  };

  const closePicker = (restoreFocus = true) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectProject = (project: string) => {
    onChange(project);
    closePicker();
  };

  const moveActive = (direction: 1 | -1) => {
    setActiveIndex((current) => (current + direction + optionCount) % optionCount);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectProject(activeIndex === 0 ? '' : (filtered[activeIndex - 1]?.project ?? ''));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePicker();
    }
  };

  return (
    <div className="project-picker" ref={rootRef}>
      <span className="project-picker-label">项目范围</span>
      <button
        ref={triggerRef}
        className="project-picker-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closePicker(false) : openPicker())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openPicker();
          }
        }}
      >
        <span className="project-picker-trigger-copy">
          <strong>{selected?.name ?? (value || '全部项目')}</strong>
          <small title={selected?.parentPath || undefined}>
            {selected ? selected.parentPath || '会话记录分类' : `${options.length} 个项目分类`}
          </small>
        </span>
        {selected && <span className="project-picker-trigger-count tnum">{selected.count}</span>}
        <PickerChevron />
      </button>

      {open && (
        <div className="project-picker-popover">
          <label className="project-picker-search">
            <SearchGlyph />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="搜索项目"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="project-picker-options"
              aria-activedescendant={activeId}
              placeholder="搜索项目名称或路径"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清除项目搜索">
                清除
              </button>
            )}
          </label>

          <div id="project-picker-options" className="project-picker-options" role="listbox">
            <button
              id="project-option-all"
              type="button"
              role="option"
              aria-selected={!value}
              data-active={activeIndex === 0 ? 'true' : 'false'}
              onMouseEnter={() => setActiveIndex(0)}
              onClick={() => selectProject('')}
            >
              <span className="project-picker-option-copy">
                <strong>全部项目</strong>
                <small>不限制项目范围</small>
              </span>
              <span className="project-picker-option-count tnum">{totalCount}</span>
            </button>

            {grouped.map((entry) => (
              <section key={entry.group} className="project-picker-group">
                <div className="project-picker-group-label">{GROUP_LABELS[entry.group]}</div>
                {entry.options.map((option) => {
                  const index = optionIndex.get(option.project) ?? 0;
                  return (
                    <button
                      id={`project-option-${index}`}
                      key={option.project}
                      type="button"
                      role="option"
                      aria-selected={option.project === value}
                      data-active={activeIndex === index ? 'true' : 'false'}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectProject(option.project)}
                    >
                      <span className="project-picker-option-copy">
                        <strong>{option.name}</strong>
                        <small title={option.parentPath || option.project}>
                          {option.parentPath || '非文件系统项目分类'}
                        </small>
                      </span>
                      <span className="project-picker-option-count tnum">{option.count}</span>
                    </button>
                  );
                })}
              </section>
            ))}

            {filtered.length === 0 && (
              <div className="project-picker-empty">
                没有匹配的项目；可以继续使用上方 Session 搜索。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PickerChevron() {
  return (
    <svg
      className="project-picker-chevron"
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="m7 10 5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
