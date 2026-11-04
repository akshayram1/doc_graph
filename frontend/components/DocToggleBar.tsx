'use client';

import type { GraphInfo } from '@/lib/api';

type Props = {
  graphs: GraphInfo[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  disabled?: boolean;
};

/** Multi-select row of document graphs. Selected ones are filled with the document colour. */
export default function DocToggleBar({ graphs, selected, onChange, label = 'Graphs', disabled }: Props) {
  const all = graphs.length > 0 && graphs.every((g) => selected.includes(g.id));

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  return (
    <div className="doc-toggle-bar">
      <span className="doc-toggle-label">{label}</span>
      <div className="doc-toggle-list" role="group" aria-label={label}>
        {graphs.map((g) => {
          const on = selected.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              className={`doc-toggle ${on ? 'is-on' : ''}`}
              style={{ ['--doc' as string]: g.color }}
              onClick={() => toggle(g.id)}
              aria-pressed={on}
              disabled={disabled}
              title={`${on ? 'Remove' : 'Add'} “${g.name}” ${on ? 'from' : 'to'} this chat`}
            >
              <span className="doc-toggle-check" aria-hidden>
                {on ? '✓' : ''}
              </span>
              <span className="doc-toggle-name">{g.name}</span>
              <span className="doc-toggle-count">{g.node_count}</span>
            </button>
          );
        })}
        {graphs.length > 1 && (
          <button
            type="button"
            className="doc-toggle-all"
            onClick={() => onChange(all ? [] : graphs.map((g) => g.id))}
            disabled={disabled}
          >
            {all ? 'Clear' : 'Select all'}
          </button>
        )}
      </div>
    </div>
  );
}
