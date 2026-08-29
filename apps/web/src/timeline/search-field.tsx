import { useState, type FormEvent } from 'react';
import { INTENT_MAX_QUERY_CHARS } from '@moment/dto';
import { TextField } from '@/ui/field/index';

/** 时间线搜索：复用 Field type=search，不是新的 SearchBar 设计组件。 */
export function TimelineSearchField({
  onSubmit,
  onClear,
}: {
  onSubmit: (q: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = q.trim().slice(0, INTENT_MAX_QUERY_CHARS);
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <form className="mb-4" onSubmit={handleSubmit}>
      <TextField
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
      />
    </form>
  );
}
