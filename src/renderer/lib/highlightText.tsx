import { Fragment, type ReactNode } from 'react';

export function HighlightedText({ text, query }: { text: string; query?: string }): ReactNode {
  const needle = query?.trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  const lower = needle.toLowerCase();
  return parts.map((part, index) =>
    part.toLowerCase() === lower ? (
      <mark key={index} className="chat-search-mark">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

export function collectMessageMatches(
  messages: { id: string; content: string }[],
  query: string,
): { messageId: string; index: number }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: { messageId: string; index: number }[] = [];
  for (const message of messages) {
    const hay = message.content.toLowerCase();
    let from = 0;
    while (from <= hay.length) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      matches.push({ messageId: message.id, index: at });
      from = at + Math.max(needle.length, 1);
    }
  }
  return matches;
}
