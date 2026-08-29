import { Plug, Plus, Trash2 } from 'lucide-react';
import { useSkillStore } from '../state/useSkillStore';
import * as skillStore from '../state/skillStore';
import * as tabStore from '../state/tabStore';
import * as chatStore from '../state/chatStore';
import * as uiStore from '../state/uiStore';

export default function PluginsPage() {
  const { skills } = useSkillStore();

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">插件</h1>
          <p className="mt-1 text-sm text-ink-muted">
            把技能当成可安装插件。可导入自己的 SKILL.md。
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs text-paper-raised"
          onClick={async () => {
            const installed = await window.reizo.installSkill();
            if (installed) await skillStore.loadSkills();
          }}
        >
          <Plus size={12} />
          安装 SKILL.md
        </button>
      </div>
      <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
        {skills.map((skill) => (
          <div key={skill.id} className="rounded-2xl border border-line bg-paper-raised p-5">
            <div className="mb-2 flex items-center gap-2">
              <Plug size={16} className="text-ink-muted" />
              <h3 className="font-semibold">{skill.name}</h3>
              <span className="rounded bg-paper-inset px-1.5 py-0.5 text-[11px] text-ink-muted">
                {skill.source === 'user' ? '用户' : '内置'}
              </span>
            </div>
            <p className="text-sm text-ink-muted">{skill.description || `/${skill.id}`}</p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                className="text-xs text-accent"
                onClick={async () => {
                  const session = await chatStore.createSession(`/${skill.id}`);
                  uiStore.setMode('chat');
                  tabStore.openChatTab(session.id, session.title);
                  void chatStore.sendMessage(session.id, `请按技能 ${skill.name} 开始工作。`, [], { skillId: skill.id });
                }}
              >
                使用
              </button>
              {skill.source === 'user' && (
                <button
                  type="button"
                  className="text-xs text-danger"
                  onClick={async () => {
                    await window.reizo.uninstallSkill(skill.id);
                    await skillStore.loadSkills();
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    <Trash2 size={12} />
                    卸载
                  </span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
