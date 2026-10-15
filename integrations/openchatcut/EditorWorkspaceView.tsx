// Adapted from OpenChatCut v0.2.16, AGPL-3.0-or-later.
import { Suspense, type ComponentProps } from 'react';
import { theme } from '../theme';
import type { ChatPanel } from '../components/chat/ChatPanel';
import type { TopBar } from '../components/TopBar';
import { LibraryPanel } from '../library/LibraryPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { InspectorPanel } from '../components/InspectorPanel';
import { Timeline } from '../components/timeline/Timeline';
import { TimelineTabs } from '../components/timeline/TimelineTabs';
import { Divider } from '../components/Divider';
import { AppToastHost } from '../ui/AppToastHost';
import { ExternalProposalCard } from '../components/chat/ExternalProposalCard';
import { useExternalAgentBridge } from '../agent/useExternalAgentBridge';
import { invokeAction } from '../shortcuts/actionRegistry';
import { useReizoMediaBridge } from './reizoMediaBridge';
import { ReizoSpeechSettings } from './ReizoSpeechSettings';
import { DesignStylePanel, ExportDialog, SettingsDialog, ShortcutsDialog, VersionHistory } from './workspaceDialogs';

export interface EditorWorkspaceViewProps {
  gridTemplateColumns: string; gridTemplateRows: string;
  topBar: ComponentProps<typeof TopBar>;
  exportDialog: ComponentProps<typeof ExportDialog> | null;
  designStylePanel: ComponentProps<typeof DesignStylePanel> | null;
  versionHistory: ComponentProps<typeof VersionHistory> | null;
  shortcutsDialog: ComponentProps<typeof ShortcutsDialog> | null;
  settingsDialog: ComponentProps<typeof SettingsDialog> | null;
  chatPanel: ComponentProps<typeof ChatPanel>;
  chatCollapsed: boolean;
  onResizeChat: ComponentProps<typeof Divider>['onResize'];
  libraryPanel: ComponentProps<typeof LibraryPanel>;
  onResizeLibrary: ComponentProps<typeof Divider>['onResize'];
  previewPanel: ComponentProps<typeof PreviewPanel>;
  inspectorPanel: ComponentProps<typeof InspectorPanel> | null;
  onResizeTimeline: ComponentProps<typeof Divider>['onResize'];
  timelineTabs: ComponentProps<typeof TimelineTabs>;
  timeline: ComponentProps<typeof Timeline>;
}

export function EditorWorkspaceView(props: EditorWorkspaceViewProps) {
  const external = useExternalAgentBridge(props.chatPanel.ctx, props.chatPanel.projectId);
  useReizoMediaBridge(props, external);
  const reviewVisible = external.proposal || external.pendingGuard || external.error;
  return <div className="cc-editor-shell reizo-editor" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 24%) 4px minmax(0, 1fr)', gridTemplateRows: '38px minmax(160px, 1fr) 5px minmax(180px, 38%)', height: '100vh', overflow: 'hidden', background: theme.bg, color: theme.text }}>
    <header style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', borderBottom: `1px solid ${theme.border}`, fontSize: 12 }}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.topBar.projectName}</span>
      <button disabled={!props.topBar.canUndo} onClick={() => invokeAction('undo', undefined, 'toolbar')}>撤销</button>
      <button disabled={!props.topBar.canRedo} onClick={() => invokeAction('redo', undefined, 'toolbar')}>重做</button>
      <button onClick={() => invokeAction('open-history', undefined, 'toolbar')}>版本</button>
      <ReizoSpeechSettings />
      <button onClick={() => invokeAction('open-export', undefined, 'toolbar')}>导出回素材库</button>
    </header>
    <div style={{ gridColumn: 1, gridRow: 2, minWidth: 0, minHeight: 0, overflow: 'hidden' }}><LibraryPanel {...props.libraryPanel} /></div>
    <div className="cc-preview-workspace" style={{ gridColumn: 3, gridRow: 2, minWidth: 0, minHeight: 0 }}>
      <PreviewPanel {...props.previewPanel} />{props.inspectorPanel && <InspectorPanel {...props.inspectorPanel} />}
    </div>
    <div style={{ gridColumn: '1 / -1', gridRow: 4, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <TimelineTabs {...props.timelineTabs} /><Timeline {...props.timeline} />
    </div>
    <aside aria-label="Agent 剪辑修改" style={{ display: reviewVisible ? 'block' : 'none', position: 'fixed', right: 16, bottom: 16, zIndex: 1000, width: 'min(420px, 90vw)', maxHeight: '70vh', overflow: 'auto', padding: 12, border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.panel, boxShadow: '0 12px 40px #0006' }}>
      <ExternalProposalCard external={external} onPreviewState={props.chatPanel.onPreviewState} />
    </aside>
    <Suspense fallback={null}>
      {props.exportDialog && <ExportDialog {...props.exportDialog} />}
      {props.versionHistory && <VersionHistory {...props.versionHistory} />}
      {props.shortcutsDialog && <ShortcutsDialog {...props.shortcutsDialog} />}
    </Suspense>
    <AppToastHost />
  </div>;
}
