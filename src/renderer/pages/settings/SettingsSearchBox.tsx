import { useState } from 'react';
import { Search } from 'lucide-react';
import { searchSettings } from '../../../shared/settingsSearch';
import * as uiStore from '../../state/uiStore';

const SECTION_LABEL: Record<string, string> = {
  general: '通用', providers: '模型', memory: '记忆', knowledge: '资料库', experts: '专家', extensions: '扩展',
  usage: '用量与费用', network: '网络', storage: '存储', about: '关于',
};

/** Search box at the top of the settings nav: picks a setting by title / keyword and lands on it. */
export default function SettingsSearchBox() {
  const [query, setQuery] = useState('');
  const results = searchSettings(query);
  const go = (id: string): void => {
    uiStore.openSettingsTarget(id);
    setQuery('');
  };
  return (
    <div className="relative mb-3 px-1 max-sm:hidden">
      <Search size={13} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) { e.preventDefault(); go(results[0].id); }
          if (e.key === 'Escape') setQuery('');
        }}
        placeholder="搜索设置"
        aria-label="搜索设置"
        className="h-8 w-full rounded-lg bg-paper-inset/70 pl-8 pr-2 text-xs text-ink outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-accent/50"
      />
      {query.trim() ? (
        <ul role="listbox" aria-label="搜索结果" className="absolute inset-x-1 top-9 z-20 max-h-72 overflow-y-auto rounded-lg border border-line bg-paper-raised p-1 shadow-lg">
          {results.length === 0 ? (
            <li className="px-2.5 py-2 text-xs text-ink-muted">没有匹配的设置</li>
          ) : results.map((entry) => (
            <li key={entry.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => go(entry.id)} className="flex w-full items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-paper-inset">
                <span className="truncate text-ink">{entry.title}</span>
                <span className="shrink-0 text-[11px] text-ink-muted">{SECTION_LABEL[entry.section]}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
