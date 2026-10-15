import { useCallback, useEffect, useState } from 'react';
import {
  ExternalLink,
  LoaderCircle,
  Mail,
  Unlink,
  Upload,
} from 'lucide-react';
import type { QuickIntegrationsStatus } from '../../../shared/extensionConfig';
import { cn } from '../../lib/cn';
import { toast } from '../../lib/toast';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

const FIELD =
  'w-full rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent';
const LABEL = 'mb-1 block text-xs text-ink-muted';

function NotionSvg() {
  return (
    <svg className="h-9 w-9 shrink-0" viewBox="0 0 100 100" fill="currentColor">
      <path d="M60.6 14.8c-7.9-.6-29.6 1.8-40.4 9.5-3.3 2.4-4.2 5.1-4.2 9.5v44.4c0 5.4 3 8.7 8.1 9.3 11.4 1.2 38.6-1.5 50.3-8.7 4.2-2.7 5.1-5.7 5.1-10.2V24.1c0-5.7-3.6-8.7-18.9-9.3zm-13.8 62.1c-15.6 0-16.5-.9-16.5-6.6V37.2c0-3.3.9-4.8 4.2-6.6 6.3-3.6 17.7-4.8 24.6-4.8 14.7 0 16.5 1.5 16.5 6.9v33.3c0 5.1-2.4 8.7-13.5 10.5-5.1.4-10.5.4-15.3.4zm10.5-36.9c0-2.4-1.2-3.6-4.5-3.6-3 0-6.9.6-9.6 1.5-1.5.6-2.1 1.8-2.1 3.3v27.3c0 2.4 1.2 3.6 4.5 3.6 3 0 6.9-.6 9.6-1.5 1.5-.6 2.1-1.8 2.1-3.3V40z" />
    </svg>
  );
}

function GmailSvg() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
      <Mail size={20} />
    </div>
  );
}

// --- Notion Connect Modal --------------------------------------------------------------------------

function NotionConnectModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.reizo?.connectNotion?.(token.trim());
      if (res?.ok) {
        toast.success('已成功连接 Notion 工作区！', res.toolsCount ? `已载入 ${res.toolsCount} 个官方工具` : undefined);
        setToken('');
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '连接失败，请确认 Token 是否正确。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <NotionSvg />
            <div>
              <DialogTitle>连接 Notion 工作区</DialogTitle>
              <DialogDescription>
                通过 Notion 官方 MCP 服务免本地安装直连。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-paper-inset p-3 text-xs text-ink-muted">
            <p className="font-medium text-ink">30 秒获取 Token 指引：</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                点击前往{' '}
                <a
                  href="https://www.notion.so/profile/integrations"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-accent underline-offset-2 hover:underline"
                >
                  Notion 集成中心 <ExternalLink size={11} />
                </a>
              </li>
              <li>点击「+ New integration」创建一个名为 Reizo 的内部集成</li>
              <li>复制生成的「Internal Integration Secret」密钥并粘贴在下方</li>
            </ol>
          </div>

          <div>
            <label className={LABEL}>Notion Integration Token</label>
            <input
              type="password"
              className={FIELD}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="secret_... 或 ntn_..."
              autoFocus
            />
          </div>

          {error ? (
            <p className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => void handleConnect()}
              disabled={busy || !token.trim()}
            >
              {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
              连接并测试
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Google Mail OAuth Modal -----------------------------------------------------------------------

function GoogleConnectModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result ?? '');
        const json = JSON.parse(text);
        const credentials = json.installed || json.web || json;
        if (credentials.client_id) setClientId(credentials.client_id);
        if (credentials.client_secret) setClientSecret(credentials.client_secret);
        toast.info('已从 credentials.json 解析并填入凭证');
      } catch {
        toast.error('解析 JSON 失败', '请确保上传的是有效的 Google credentials.json 文件');
      }
    };
    reader.readAsText(file);
  };

  const handleStartOAuth = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setAuthorizing(true);
    setError(null);
    try {
      const res = await window.reizo?.startGoogleOAuth?.({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      if (res?.ok) {
        toast.success(
          'Google 账号授权成功！',
          res.email ? `已连接: ${res.email}` : 'Gmail 助手工具已就绪',
        );
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '授权未完成或超时，请重试。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAuthorizing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !authorizing && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <GmailSvg />
            <div>
              <DialogTitle>连接 Google Mail (Gmail)</DialogTitle>
              <DialogDescription>
                通过本地 PKCE 回环授权，直连您的 Google 邮箱。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {authorizing ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <LoaderCircle size={32} className="animate-spin text-accent" />
              <p className="mt-3 text-sm font-medium text-ink">
                正在等待浏览器授权完成…
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                已在默认浏览器中打开 Google 登录页。请登录并点击「允许」授予权限。
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-xl bg-paper-inset px-3 py-2 text-xs text-ink-muted">
                <span>有下载的 credentials.json？</span>
                <label className="inline-flex cursor-pointer items-center gap-1 font-medium text-accent hover:underline">
                  <Upload size={12} />
                  一键导入 JSON
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleJsonUpload}
                  />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className={LABEL}>Client ID</label>
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline"
                  >
                    Google Cloud 控制台 <ExternalLink size={10} />
                  </a>
                </div>
                <input
                  className={FIELD}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="...apps.googleusercontent.com"
                />
              </div>

              <div>
                <label className={LABEL}>Client Secret</label>
                <input
                  type="password"
                  className={FIELD}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-..."
                />
              </div>

              <p className="text-[11px] text-ink-muted leading-relaxed">
                Reizo 采用本地临时回环技术 (PKCE)，所有 Token 仅加密存储于您本机，不经过任何云端中转。
              </p>

              {error ? (
                <p className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2 pt-2">
                <Button size="sm" variant="ghost" onClick={onClose}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleStartOAuth()}
                  disabled={!clientId.trim() || !clientSecret.trim()}
                >
                  启动浏览器一键授权
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Quick Integrations Block ----------------------------------------------------------------------

export function QuickIntegrationsBlock({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<QuickIntegrationsStatus | null>(null);
  const [notionOpen, setNotionOpen] = useState(false);
  const [googleOpen, setGoogleOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await window.reizo?.getQuickIntegrationsStatus?.();
      if (s) setStatus(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDisconnect = async (id: 'notion' | 'gmail', name: string) => {
    if (!window.confirm(`确定断开「${name}」连接吗？`)) return;
    try {
      await window.reizo?.disconnectIntegration?.(id);
      toast.info(`已断开 ${name}`);
      await refresh();
      onChange?.();
    } catch (cause) {
      toast.error('断开连接失败', String(cause));
    }
  };

  const handleSuccess = () => {
    void refresh();
    onChange?.();
  };

  const notionConnected = Boolean(status?.notion.connected);
  const gmailConnected = Boolean(status?.gmail.connected);

  return (
    <section className="mb-10">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-medium">常用服务直连</h2>
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
          便捷连接
        </span>
      </div>
      <p className="mb-3 text-xs text-ink-muted">
        免除复杂的命令行配置，一键授权连接您的核心知识库与邮箱。
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Notion Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-paper-raised p-4">
          <div>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <NotionSvg />
                <div>
                  <h3 className="text-sm font-medium text-ink">Notion</h3>
                  <p className="text-[11px] text-ink-muted">知识库与文档管理</p>
                </div>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  notionConnected
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-paper-inset text-ink-muted',
                )}
              >
                {notionConnected ? '已连接' : '未连接'}
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-muted leading-relaxed">
              让 Agent 直接检索您的工作区文档、查询知识库以及更新 Notion 页面。
            </p>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-line/60 pt-3">
            {notionConnected ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setNotionOpen(true)}
                >
                  重新配置
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-ink-muted hover:text-danger"
                  onClick={() => void handleDisconnect('notion', 'Notion')}
                >
                  <Unlink size={12} />
                  断开
                </Button>
              </>
            ) : (
              <Button size="xs" onClick={() => setNotionOpen(true)}>
                一键连接 Notion
              </Button>
            )}
          </div>
        </div>

        {/* Gmail Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-line bg-paper-raised p-4">
          <div>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <GmailSvg />
                <div>
                  <h3 className="text-sm font-medium text-ink">Google Mail</h3>
                  <p className="text-[11px] text-ink-muted">
                    {status?.gmail.email || 'Gmail 邮箱助手'}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  gmailConnected
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-paper-inset text-ink-muted',
                )}
              >
                {gmailConnected ? '已连接' : '未连接'}
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-muted leading-relaxed">
              支持邮件智能搜索、往来阅读、标签归档以及起草邮件等全套操作。
            </p>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-line/60 pt-3">
            {gmailConnected ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setGoogleOpen(true)}
                >
                  重新授权
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-ink-muted hover:text-danger"
                  onClick={() => void handleDisconnect('gmail', 'Google Mail')}
                >
                  <Unlink size={12} />
                  断开
                </Button>
              </>
            ) : (
              <Button size="xs" onClick={() => setGoogleOpen(true)}>
                启动 Google 授权
              </Button>
            )}
          </div>
        </div>
      </div>

      <NotionConnectModal
        open={notionOpen}
        onClose={() => setNotionOpen(false)}
        onSuccess={handleSuccess}
      />
      <GoogleConnectModal
        open={googleOpen}
        onClose={() => setGoogleOpen(false)}
        onSuccess={handleSuccess}
      />
    </section>
  );
}
