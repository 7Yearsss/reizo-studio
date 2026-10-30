import { effectiveRules } from '../../../shared/permissionRules';
import type { PermissionMode } from '../../../shared/settings';

/** What the permission mode really does, per kind of action — computed by the same function the agent runtime uses. */
export default function EffectivePermissions({ mode }: { mode: PermissionMode }) {
  return (
    <details className="mt-3 max-w-3xl text-sm">
      <summary className="cursor-pointer text-ink-muted hover:text-ink">当前模式下每类操作怎么处理</summary>
      <ul className="mt-2 space-y-1.5">
        {effectiveRules(mode).map((rule) => (
          <li key={rule.group} className="rounded-lg bg-paper-inset/60 px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink">{rule.group}</span>
              <span className={rule.effect === 'ask' ? 'shrink-0 text-xs font-medium text-ink' : 'shrink-0 text-xs text-ink-muted'}>{rule.effect === 'ask' ? '询问你' : '直接运行'}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">{rule.because}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
