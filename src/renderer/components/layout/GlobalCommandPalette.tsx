import { useEffect, useState, useMemo } from 'react';
import {
  FolderTree,
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Terminal,
  FileCode,
  Workflow,
  FolderKanban,
} from 'lucide-react';
import { CommandPalette, type CommandItem } from '../motion/command-palette';
import { useChatStore } from '../../state/useChatStore';
import { useSkillStore } from '../../state/useSkillStore';
import { useSettingsStore } from '../../state/useSettingsStore';
import * as tabStore from '../../state/tabStore';
import * as uiStore from '../../state/uiStore';
import * as api from '../../api';
import type { DirEntry } from '../../../shared/workspace';

export function openGlobalCommandPalette() {
  window.dispatchEvent(new CustomEvent('reizo:open-command-palette'));
}

export default function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const sessions = useChatStore((s) => s.sessions);
  const skills = useSkillStore().skills;
  const workspacePath = useSettingsStore((s) => s.settings.workspacePath);
  const [files, setFiles] = useState<DirEntry[]>([]);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener('reizo:open-command-palette', handleOpen);
    return () => window.removeEventListener('reizo:open-command-palette', handleOpen);
  }, []);

  useEffect(() => {
    if (!open || !workspacePath) return;
    api
      .flattenWorkspace()
      .then((entries) => setFiles(entries.filter((e) => e.kind === 'file').slice(0, 100)))
      .catch(() => setFiles([]));
  }, [open, workspacePath]);

  const items: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      // 快速操作 (Quick Actions)
      {
        id: 'action-new-chat',
        label: '新建对话 (New Chat)',
        group: '操作',
        hint: '新会话',
        icon: Plus,
        onSelect: () => {
          uiStore.setMode('chat');
          tabStore.newLauncherTab();
        },
      },
      {
        id: 'action-settings',
        label: '打开设置 (Settings)',
        group: '操作',
        icon: Settings,
        onSelect: () => uiStore.setMode('settings'),
      },
      {
        id: 'action-skills',
        label: '管理技能 (Skills & Plugins)',
        group: '操作',
        icon: Sparkles,
        onSelect: () => uiStore.setMode('skills'),
      },
      {
        id: 'action-artifacts',
        label: '作品库 (Artifacts)',
        group: '操作',
        icon: FolderKanban,
        onSelect: () => uiStore.setMode('artifacts'),
      },
      {
        id: 'action-terminal',
        label: '打开终端 (Terminal)',
        group: '操作',
        icon: Terminal,
        onSelect: () => uiStore.toggleRightPanelTab('terminal'),
      },
      {
        id: 'action-git',
        label: 'Git 变更 (Git Diff)',
        group: '操作',
        icon: GitBranch,
        onSelect: () => uiStore.toggleRightPanelTab('git'),
      },
      {
        id: 'action-files',
        label: '工作区文件 (Workspace Files)',
        group: '操作',
        icon: FolderTree,
        onSelect: () => uiStore.toggleRightPanelTab('files'),
      },
    ];

    // 会话列表 (Recent Chats)
    sessions.forEach((session) => {
      list.push({
        id: `chat-${session.id}`,
        label: session.title,
        group: '近期会话',
        hint: session.listPreview || undefined,
        icon: MessageSquare,
        onSelect: () => {
          uiStore.setMode('chat');
          tabStore.openChatTab(session.id, session.title);
        },
      });
    });

    // 技能 (Skills)
    skills.forEach((skill) => {
      list.push({
        id: `skill-${skill.id}`,
        label: `/${skill.id} · ${skill.name || skill.id}`,
        group: '技能 (Skills)',
        hint: skill.description || undefined,
        icon: Sparkles,
        onSelect: () => {
          uiStore.setMode('chat');
          tabStore.newLauncherTab();
        },
      });
    });

    // 文件 (Files)
    files.forEach((file) => {
      list.push({
        id: `file-${file.relativePath}`,
        label: file.name,
        group: '工作区文件',
        hint: file.relativePath,
        icon: FileCode,
        onSelect: () => {
          uiStore.toggleRightPanelTab('files');
        },
      });
    });

    return list;
  }, [sessions, skills, files]);

  return (
    <CommandPalette
      items={items}
      shortcut="k"
      placeholder="输入搜索会话、文件、技能或操作…"
      emptyMessage="未找到匹配项"
      open={open}
      onOpenChange={setOpen}
    />
  );
}
