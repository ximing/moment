import { useEffect, useRef, useState, type FormEvent } from 'react';
import { INTENT_MAX_QUERY_CHARS } from '@moment/dto';
import { TextField } from '@/ui/field/index';

/** 时间线搜索：复用 Field type=search，不是新的 SearchBar 设计组件。 */
export function TimelineSearchField({
  onSubmit,
  onClear,
  autoFocus = false,
  compact = false,
}: {
  onSubmit: (q: string) => void;
  onClear: () => void;
  autoFocus?: boolean;
  /** 链眉展开：无可见 Label 行、无表单下边距（读屏仍用 Label）。 */
  compact?: boolean;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = q.trim().slice(0, INTENT_MAX_QUERY_CHARS);
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <form className={compact ? 'mt-3' : 'mb-4'} onSubmit={handleSubmit}>
      <TextField
        ref={inputRef}
        label="搜索时刻"
        name="timeline-search"
        type="search"
        enterKeyHint="search"
        isClearable
        placeholder="搜索时刻，例如 去年今天和外婆"
        value={q}
        onChange={(next) => {
          setQ(next);
          if (next === '') onClear();
        }}
        className={compact ? '[&>span:first-child]:sr-only' : undefined}
      />
    </form>
  );
}
