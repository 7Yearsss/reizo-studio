const norm = (p: string, caseInsensitive: boolean): string => {
  const unified = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return caseInsensitive ? unified.toLowerCase() : unified;
};

/**
 * True when `target` is one of the protected roots or inside one. These hold the app's own database, settings,
 * provider keys, hooks and backups; an agent write tool has no business there, whatever folder the user opened as
 * the workspace (opening the home directory would otherwise put them in reach).
 */
export function isProtectedPath(target: string, roots: readonly string[], caseInsensitive = process.platform === 'win32'): boolean {
  const t = norm(target, caseInsensitive);
  return roots.some((root) => {
    const r = norm(root, caseInsensitive);
    return r.length > 0 && (t === r || t.startsWith(`${r}/`));
  });
}

export const PROTECTED_WRITE_MESSAGE = '这个位置属于应用自身的数据（数据库、设置、密钥、钩子、备份），Agent 的写入工具不能修改。';
