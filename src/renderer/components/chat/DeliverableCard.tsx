import { Download, FileCode2, FileText, Presentation, Sheet, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { ToolCallPart } from '../../../shared/chat';
import { cn } from '../../lib/cn';
import { useTabStore } from '../../state/useTabStore';
import { useUiStore } from '../../state/useUiStore';
import { useArtifactStore } from '../../state/useArtifactStore';
import * as uiStore from '../../state/uiStore';
import { selectDocument } from '../../state/documentWorkspace';
import { selectPresentation } from '../../state/presentationWorkspace';
import { selectWorkbook } from '../../state/sheetWorkspace';
import { openArtifact } from '../../state/artifactStore';
import { downloadArtifactFile } from '../../api';
import { toast } from '../../lib/toast';

interface Kind {
  label: string;
  Icon: LucideIcon;
  tab: uiStore.RightPanelTab;
  select(sessionId: string, id: string): void;
}

const KINDS: Record<string, Kind> = {
  generate_file: { label: '文件', Icon: FileText, tab: 'artifacts', select: (sessionId, id) => { void openArtifact(sessionId, id); } },
  generate_document: { label: '文档', Icon: FileText, tab: 'documents', select: selectDocument },
  generate_presentation: { label: '演示文稿', Icon: Presentation, tab: 'presentations', select: selectPresentation },
  generate_sheet: { label: '表格', Icon: Sheet, tab: 'sheets', select: selectWorkbook },
};

export interface Deliverable {
  artifactId: string;
  name: string;
  version?: number;
}

/** The file a generate_* tool just produced, or null while running / on failure / for other tools. */
export function deliverableOf(part: ToolCallPart): Deliverable | null {
  if (!KINDS[part.name] || !part.result || part.error) return null;
  try {
    const r = JSON.parse(part.result) as { ok?: boolean; error?: unknown; artifactId?: unknown; name?: unknown; version?: unknown };
    if (r.error || r.ok === false || typeof r.artifactId !== 'string' || typeof r.name !== 'string') return null;
    return { artifactId: r.artifactId, name: r.name, version: typeof r.version === 'number' ? r.version : undefined };
  } catch {
    return null;
  }
}

/** A produced file as a card in the chat; clicking opens it in the right-hand work surface. */
export default function DeliverableCard({ part, file }: { part: ToolCallPart; file: Deliverable }) {
  const [downloading, setDownloading] = useState(false);
  const kind = KINDS[part.name];
  const sessionId = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.sessionId);
  const rightTab = useUiStore((s) => s.rightPanelTab);
  const selectedId = useArtifactStore((s) => s.selectedIdBySession[sessionId ?? '']);
  const open = rightTab === kind.tab && (part.name !== 'generate_file' || selectedId === file.artifactId);
  const { Icon } = kind;

  const card = (
    <button
      type="button"
      onClick={() => {
        if (sessionId) kind.select(sessionId, file.artifactId);
        uiStore.setRightPanelTab(kind.tab);
      }}
      aria-pressed={open}
      className={cn(
        // Settled messages use paint containment: an outer shadow at the left
        // message edge gets clipped. Keep the entire card outline inside it.
        'my-1 flex w-full items-center gap-3 rounded-2xl bg-paper-raised px-3.5 py-3 text-left transition-shadow focus-visible:outline-2 focus-visible:outline-[var(--link)] focus-visible:-outline-offset-4',
        open ? 'shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--ink-muted)]',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-paper-inset text-ink">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="chat-file-link truncate text-sm leading-5">{file.name}</span>
        <span className="text-xs leading-4 text-ink-muted">
          {kind.label}
          {file.version ? ` · 版本 ${file.version}` : ''}
          {open ? ' · 正在右侧打开' : ' · 点击在右侧打开'}
        </span>
      </span>
    </button>
  );
  if (part.name !== 'generate_file') return card;
  return <div className="my-1">
    {card}
    <button type="button" disabled={downloading} className="chat-file-link mt-1 inline-flex items-center gap-1.5 text-xs disabled:opacity-50" onClick={async () => {
      setDownloading(true);
      try {
        const blob = await downloadArtifactFile(file.artifactId, file.version);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { toast.error(error instanceof Error ? error.message : '下载失败'); }
      finally { setDownloading(false); }
    }}><Download size={13} />{downloading ? '正在下载…' : `下载 ${file.name}`}</button>
  </div>;
}
