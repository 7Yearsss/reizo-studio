import { useId, useState, type FormEvent } from 'react';
import type { AccountPasswordLogin } from '../../../shared/accountLogin';
import { Input } from '../ui/input';

export default function AccountPasswordForm({ busy, onSubmit }: { busy: boolean; onSubmit: (input: AccountPasswordLogin) => Promise<void> }) {
  const id = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !username.trim() || !password) return;
    const input = { username: username.trim(), password };
    setPassword('');
    void onSubmit(input);
  }
  return <form onSubmit={submit} className="space-y-4" aria-label="账号密码登录">
    <div className="space-y-2"><label htmlFor={`${id}-username`} className="text-sm font-medium">用户名或邮箱</label>
      <Input id={`${id}-username`} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={320} required disabled={busy} value={username} onChange={event => setUsername(event.target.value)} placeholder="请输入用户名或邮箱" />
    </div>
    <div className="space-y-2"><label htmlFor={`${id}-password`} className="text-sm font-medium">密码</label>
      <Input id={`${id}-password`} name="password" type="password" autoComplete="current-password" maxLength={128} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} placeholder="请输入密码" />
    </div>
    <p className="text-xs leading-5 text-ink-muted">密码仅用于本次登录，不会保存到本机。</p>
    <button type="submit" disabled={busy || !username.trim() || !password} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">{busy ? '正在登录…' : '登录'}</button>
  </form>;
}
