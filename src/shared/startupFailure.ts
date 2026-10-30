import { redactSecrets } from './redactSecrets';

export interface StartupFailureView {
  title: string;
  message: string;
  detail: string;
  /** Text for the "copy details" button: the error and the facts a bug report needs, secrets masked. */
  report: string;
}

/** A SQLite file that cannot be read or migrated, as opposed to some other start-up failure. */
export function isDatabaseFailure(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /migration .* failed|sqlite|database|reizo\.db|SQLITE_|malformed|disk image|not a database/i.test(text);
}

/**
 * What to tell the user when the app cannot start. Says plainly that nothing was deleted, where the data is, and which
 * automatic copies exist, so the failure is a recoverable situation and not a window that silently vanishes.
 */
export function describeStartupFailure(error: unknown, ctx: { dataRoot: string; version: string; backups: readonly string[] }): StartupFailureView {
  const raw = error instanceof Error ? error.message : String(error);
  const reason = redactSecrets(raw).slice(0, 600);
  const db = isDatabaseFailure(error);
  const lines = [
    db ? '本机的对话数据库无法打开或升级。你的数据没有被删除，也没有被改动。' : 'Reizo 没能完成启动。你的数据没有被删除。',
    '',
    `数据文件夹：${ctx.dataRoot}`,
  ];
  if (ctx.backups.length) {
    lines.push('', '升级前自动留下的副本（最新的在最后）：', ...ctx.backups.map((b) => `• ${b}`));
    lines.push('', '想退回去：先关闭 Reizo，把 reizo.db 改名为 reizo.db.broken，再把上面的副本复制一份并改名为 reizo.db。');
  } else if (db) {
    lines.push('', '没有找到自动副本。请先把数据文件夹整个复制一份留存，再联系支持。');
  }
  return {
    title: db ? 'Reizo 无法打开本机数据库' : 'Reizo 启动失败',
    message: lines.join('\n'),
    detail: reason,
    report: [`Reizo ${ctx.version}`, `错误：${reason}`, `数据文件夹：${ctx.dataRoot}`, `自动副本：${ctx.backups.length ? ctx.backups.join(', ') : '无'}`].join('\n'),
  };
}
