import { useCallback, useEffect, useState } from 'react';
import {
  ExternalLink,
  LoaderCircle,
  Unlink,
  Upload,
} from 'lucide-react';
import type {
  QuickIntegrationId,
  QuickIntegrationsStatus,
} from '../../../shared/extensionConfig';
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
import { BrandIcon } from '../../components/ui/BrandIcon';

const FIELD =
  'w-full rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent';
const LABEL = 'mb-1 block text-xs text-ink-muted';

// --- Feishu Modal -----------------------------------------------------------------------------------


function FeishuConnectModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!appId.trim() || !appSecret.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.reizo?.connectFeishu?.({
        appId: appId.trim(),
        appSecret: appSecret.trim(),
      });
      if (res?.ok) {
        toast.success(`已连接飞书应用「${res.name || '飞书助手'}」！`, res.toolsCount ? `已载入 ${res.toolsCount} 个工具` : undefined);
        setAppId('');
        setAppSecret('');
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '连接飞书失败，请检查 App ID 与 Secret。');
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
            <BrandIcon brand="feishu" />
            <div>
              <DialogTitle>连接飞书 (Feishu / Lark)</DialogTitle>

              <DialogDescription>
                支持读取飞书云文档、多维表格 (Bitable) 以及群消息收发。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-paper-inset p-3 text-xs text-ink-muted">
            <p className="font-medium text-ink">快捷接入步骤：</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                前往{' '}
                <a
                  href="https://open.feishu.cn/app"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-accent hover:underline"
                >
                  飞书开放平台 <ExternalLink size={11} />
                </a>{' '}
                创建企业自建应用；
              </li>
              <li>在「凭证与基础信息」中复制 App ID 和 App Secret；</li>
              <li>确保在「权限管理」中勾选了文档或群消息的相关读取权限。</li>
            </ol>
          </div>

          <div>
            <label className={LABEL}>App ID (以 cli_ 开头)</label>
            <input
              type="text"
              placeholder="cli_a1b2c3d4..."
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </div>

          <div>
            <label className={LABEL}>App Secret</label>
            <input
              type="password"
              placeholder="输入应用的 App Secret"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              className={FIELD}
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleConnect} disabled={busy || !appId.trim() || !appSecret.trim()}>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="mr-1.5 animate-spin" />
                  校验并连接中...
                </>
              ) : (
                '连接并测试'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- WeCom Modal ------------------------------------------------------------------------------------

function WeComConnectModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botName, setBotName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!webhookUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.reizo?.connectWeCom?.({
        webhookUrl: webhookUrl.trim(),
        botName: botName.trim() || undefined,
      });
      if (res?.ok) {
        toast.success(`已连接企业微信群机器人「${res.name || '企微助手'}」！`);
        setWebhookUrl('');
        setBotName('');
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '连接企微失败，请检查 Webhook 地址格式。');
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
            <BrandIcon brand="wecom" />
            <div>
              <DialogTitle>连接企业微信 (WeCom)</DialogTitle>

              <DialogDescription>
                通过群机器人 Webhook，Agent 可一键推送 Markdown 报告与分镜通知。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-paper-inset p-3 text-xs text-ink-muted">
            <p className="font-medium text-ink">10 秒配置指引：</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>在任意企业微信内部群聊中，点击群右上角设置；</li>
              <li>点击「添加群机器人」并创建一个自定义机器人；</li>
              <li>复制生成的 Webhook 地址（或其 key）粘贴到下方。</li>
            </ol>
          </div>

          <div>
            <label className={LABEL}>群机器人 Webhook 地址 或 Key</label>
            <input
              type="text"
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </div>

          <div>
            <label className={LABEL}>机器人标识名称 (可选)</label>
            <input
              type="text"
              placeholder="例如：技术通知群、电商运营群"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              className={FIELD}
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleConnect} disabled={busy || !webhookUrl.trim()}>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="mr-1.5 animate-spin" />
                  保存中...
                </>
              ) : (
                '保存并启用'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- DingTalk Modal ---------------------------------------------------------------------------------

function DingTalkConnectModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [botName, setBotName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!webhookUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.reizo?.connectDingTalk?.({
        webhookUrl: webhookUrl.trim(),
        secret: secret.trim() || undefined,
        botName: botName.trim() || undefined,
      });
      if (res?.ok) {
        toast.success(`已连接钉钉自定义群机器人「${res.name || '钉钉助手'}」！`);
        setWebhookUrl('');
        setSecret('');
        setBotName('');
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '连接钉钉失败，请检查 Webhook 地址或加签密钥。');
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
            <BrandIcon brand="dingtalk" />
            <div>
              <DialogTitle>连接钉钉群机器人 (DingTalk)</DialogTitle>

              <DialogDescription>
                支持向钉钉群推送富文本、Markdown 格式的自动化通知与分析。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-paper-inset p-3 text-xs text-ink-muted">
            <p className="font-medium text-ink">钉钉机器人配置指引：</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>在钉钉群设置中点击「智能群助手」→「添加机器人」→「自定义」；</li>
              <li>安全设置建议勾选「加签」，并复制以 SEC 开头的加签密钥；</li>
              <li>点击完成后，复制生成的 Webhook 地址填入下方。</li>
            </ol>
          </div>

          <div>
            <label className={LABEL}>群机器人 Webhook 地址</label>
            <input
              type="text"
              placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </div>

          <div>
            <label className={LABEL}>加签密钥 Secret (可选，推荐以提高安全性)</label>
            <input
              type="password"
              placeholder="SEC..."
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label className={LABEL}>机器人标识名称 (可选)</label>
            <input
              type="text"
              placeholder="例如：钉钉报警群、开发提醒"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              className={FIELD}
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleConnect} disabled={busy || !webhookUrl.trim()}>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="mr-1.5 animate-spin" />
                  保存中...
                </>
              ) : (
                '保存并启用'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Yuque Modal ------------------------------------------------------------------------------------

function YuqueConnectModal({
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
      const res = await window.reizo?.connectYuque?.({ token: token.trim() });
      if (res?.ok) {
        toast.success(`已连接语雀知识库 (用户: ${res.name})！`, res.toolsCount ? `已载入 ${res.toolsCount} 个工具` : undefined);
        setToken('');
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '连接语雀失败，请确认 Token 是否有效。');
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
            <BrandIcon brand="yuque" />
            <div>
              <DialogTitle>连接语雀知识库 (Yuque)</DialogTitle>
              <DialogDescription>
                检索语雀文档、结构化知识库，并支持将生成结果直接写入语雀。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>


        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-paper-inset p-3 text-xs text-ink-muted">
            <p className="font-medium text-ink">30 秒获取 Token 指引：</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                前往{' '}
                <a
                  href="https://www.yuque.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-accent hover:underline"
                >
                  语雀个人访问令牌设置 <ExternalLink size={11} />
                </a>；
              </li>
              <li>点击「新建 Token」，描述填写 Reizo，勾选 Repo 与 Doc 权限；</li>
              <li>复制生成的 Token 粘贴在下方即可。</li>
            </ol>
          </div>

          <div>
            <label className={LABEL}>语雀 Personal Access Token</label>
            <input
              type="password"
              placeholder="输入语雀个人 Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleConnect} disabled={busy || !token.trim()}>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="mr-1.5 animate-spin" />
                  校验并连接中...
                </>
              ) : (
                '连接并测试'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Gitee Modal ------------------------------------------------------------------------------------

function GiteeConnectModal({
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
      const res = await window.reizo?.connectGitee?.({ token: token.trim() });
      if (res?.ok) {
        toast.success(`已连接 Gitee 账号「${res.name || 'Gitee 用户'}」！`, res.toolsCount ? `已载入 ${res.toolsCount} 个代码与协作工具` : undefined);
        setToken('');
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '连接 Gitee 失败，请检查私人令牌权限或网络。');
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
            <BrandIcon brand="gitee" />
            <div>
              <DialogTitle>连接 Gitee (码云) 代码平台</DialogTitle>
              <DialogDescription>
                读取 Gitee 仓库源码、查询 Issue 任务与自动创建工作项。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-paper-inset p-3 text-xs text-ink-muted">
            <p className="font-medium text-ink">10 秒获取 Gitee 私人令牌 (Token) 指引：</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                前往{' '}
                <a
                  href="https://gitee.com/profile/personal_access_tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-accent hover:underline"
                >
                  Gitee 私人令牌设置 <ExternalLink size={11} />
                </a>；
              </li>
              <li>点击「+ 生成新令牌」，权限勾选 <code>projects</code> 与 <code>pull_requests</code>；</li>
              <li>复制生成的 Token 粘贴在下方即可。</li>
            </ol>
          </div>

          <div>
            <label className={LABEL}>Gitee Personal Access Token (私人令牌)</label>
            <input
              type="password"
              placeholder="输入 Gitee 私人令牌"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleConnect} disabled={busy || !token.trim()}>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="mr-1.5 animate-spin" />
                  校验并连接中...
                </>
              ) : (
                '连接并测试'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- GitHub Modal -----------------------------------------------------------------------------------

function GitHubConnectModal({
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
      const res = await window.reizo?.connectGitHub?.({ token: token.trim() });
      if (res?.ok) {
        toast.success(`已连接 GitHub 账号「${res.name || 'GitHub 用户'}」！`, res.toolsCount ? `已载入 ${res.toolsCount} 个代码与协作工具` : undefined);
        setToken('');
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '连接 GitHub 失败，请确认 Token 是否具备 repo 访问权限。');
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
            <BrandIcon brand="github" />
            <div>
              <DialogTitle>连接 GitHub 平台</DialogTitle>
              <DialogDescription>
                检索全球开源项目、读取指定代码文件并管理 Issues 与 PRs。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-paper-inset p-3 text-xs text-ink-muted">
            <p className="font-medium text-ink">10 秒获取 GitHub Token 指引：</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>
                前往{' '}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-accent hover:underline"
                >
                  GitHub Personal Access Tokens <ExternalLink size={11} />
                </a>；
              </li>
              <li>点击「Generate new token (classic)」，勾选 <code>repo</code> 权限；</li>
              <li>复制生成的 <code>ghp_...</code> 令牌粘贴在下方。</li>
            </ol>
          </div>

          <div>
            <label className={LABEL}>GitHub Personal Access Token</label>
            <input
              type="password"
              placeholder="ghp_... 或 github_pat_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleConnect} disabled={busy || !token.trim()}>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="mr-1.5 animate-spin" />
                  校验并连接中...
                </>
              ) : (
                '连接并测试'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
            <BrandIcon brand="notion" />
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
                  className="inline-flex items-center gap-0.5 text-accent hover:underline"
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
              placeholder="secret_... 或 ntn_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={FIELD}
              autoFocus
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleConnect} disabled={busy || !token.trim()}>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="mr-1.5 animate-spin" />
                  连接并测试...
                </>
              ) : (
                '连接并测试'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Google Connect Modal --------------------------------------------------------------------------

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        const creds = parsed.installed || parsed.web || parsed;
        if (creds.client_id && creds.client_secret) {
          setClientId(creds.client_id);
          setClientSecret(creds.client_secret);
          setError(null);
          toast.success('已自动解析 Google 凭据文件！');
        } else {
          setError('JSON 中未找到 client_id 或 client_secret，请检查文件。');
        }
      } catch {
        setError('无法解析该 JSON 文件，请确认为有效的 Google 凭据。');
      }
    };
    reader.readAsText(file);
  };

  const handleStartOAuth = async () => {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.reizo?.startGoogleOAuth?.({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      if (res?.ok) {
        toast.success(`Google Mail 授权成功！${res.email ? `(${res.email})` : ''}`);
        onSuccess();
        onClose();
      } else {
        setError(res?.error || '授权失败或已取消。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <BrandIcon brand="gmail" />
            <div>
              <DialogTitle>连接 Google Mail (Gmail)</DialogTitle>

              <DialogDescription>
                通过本地 PKCE 回环授权，直连您的 Google 邮箱。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between rounded-xl border border-dashed border-line bg-paper-inset/50 p-3">
            <span className="text-xs text-ink-muted">有下载的 credentials.json?</span>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-paper-raised px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-paper-inset">
              <Upload size={13} />
              <span>一键导入 JSON</span>
              <input type="file" accept=".json,application/json" onChange={handleJsonUpload} className="hidden" />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className={LABEL}>Client ID</label>
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-[11px] text-ink-muted hover:text-accent"
              >
                Google Cloud 控制台 <ExternalLink size={10} />
              </a>
            </div>
            <input
              type="text"
              placeholder="...apps.googleusercontent.com"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label className={LABEL}>Client Secret</label>
            <input
              type="password"
              placeholder="GOCSPX-..."
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              className={FIELD}
            />
          </div>

          <p className="text-[11px] text-ink-muted leading-relaxed">
            Reizo 采用本地临时回环技术 (PKCE)，所有 Token 仅加密存储于您本机，不经过任何云端中转。
          </p>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button onClick={handleStartOAuth} disabled={busy || !clientId.trim() || !clientSecret.trim()}>
              {busy ? (
                <>
                  <LoaderCircle size={14} className="mr-1.5 animate-spin" />
                  等待浏览器授权中...
                </>
              ) : (
                '启动浏览器一键授权'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Main Block Component ---------------------------------------------------------------------------

type CategoryTab = 'all' | 'domestic' | 'global';

interface IntegrationCardItem {
  id: QuickIntegrationId;
  group: 'domestic' | 'global';
  title: string;
  subtitle: string;
  desc: string;
  icon: React.ReactNode;
  connected: boolean;
  extra?: string;
  onConnect: () => void;
  btnLabel: string;
}

export function QuickIntegrationsBlock({
  onChange,
  onStateChanged,
}: {
  onChange?: () => void;
  onStateChanged?: () => void;
}) {
  const [status, setStatus] = useState<QuickIntegrationsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<CategoryTab>('all');

  // Modals state
  const [notionModal, setNotionModal] = useState(false);
  const [googleModal, setGoogleModal] = useState(false);
  const [feishuModal, setFeishuModal] = useState(false);
  const [wecomModal, setWecomModal] = useState(false);
  const [dingtalkModal, setDingtalkModal] = useState(false);
  const [yuqueModal, setYuqueModal] = useState(false);
  const [giteeModal, setGiteeModal] = useState(false);
  const [githubModal, setGitHubModal] = useState(false);

  const [disconnecting, setDisconnecting] = useState<QuickIntegrationId | null>(null);


  const loadStatus = useCallback(async () => {
    try {
      const s = await window.reizo?.getQuickIntegrationsStatus?.();
      setStatus(s ?? null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleDisconnect = async (id: QuickIntegrationId, label: string) => {
    if (!window.confirm(`确定要断开与「${label}」的连接吗？`)) return;
    setDisconnecting(id);
    try {
      const res = await window.reizo?.disconnectIntegration?.(id);
      if (res?.ok) {
        toast.info(`已断开「${label}」连接`);
        await loadStatus();
        onStateChanged?.();
        onChange?.();
      }
    } catch (cause) {
      toast.error(`断开失败: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setDisconnecting(null);
    }
  };

  const handleSuccess = () => {
    void loadStatus();
    onStateChanged?.();
    onChange?.();
  };

  const cards: IntegrationCardItem[] = [
    {
      id: 'feishu' as const,
      group: 'domestic' as const,
      title: '飞书 (Feishu)',
      subtitle: '企业协同与知识库',
      desc: '支持读写飞书云文档、检索团队多维表格 (Bitable) 以及群消息收发。',
      icon: <BrandIcon brand="feishu" />,
      connected: Boolean(status?.feishu?.connected),
      extra: status?.feishu?.appName || status?.feishu?.appId,
      onConnect: () => setFeishuModal(true),
      btnLabel: status?.feishu?.connected ? '重新配置' : '一键连接飞书',
    },
    {
      id: 'wecom' as const,
      group: 'domestic' as const,
      title: '企业微信 (WeCom)',
      subtitle: '群机器人消息通知',
      desc: '支持向企微群一键推送 Markdown 自动化报告、电商分镜成果及文本提醒。',
      icon: <BrandIcon brand="wecom" />,
      connected: Boolean(status?.wecom?.connected),
      extra: status?.wecom?.botName,
      onConnect: () => setWecomModal(true),
      btnLabel: status?.wecom?.connected ? '重新配置' : '配置企微机器人',
    },
    {
      id: 'dingtalk' as const,
      group: 'domestic' as const,
      title: '钉钉 (DingTalk)',
      subtitle: '自定义群机器人',
      desc: '支持向钉钉群推送富文本与 Markdown 卡片通知，支持安全加签验证。',
      icon: <BrandIcon brand="dingtalk" />,
      connected: Boolean(status?.dingtalk?.connected),
      extra: status?.dingtalk?.botName,
      onConnect: () => setDingtalkModal(true),
      btnLabel: status?.dingtalk?.connected ? '重新配置' : '配置钉钉机器人',
    },
    {
      id: 'yuque' as const,
      group: 'domestic' as const,
      title: '语雀 (Yuque)',
      subtitle: '云端知识库与专栏',
      desc: '检索语雀个人与团队知识库、读取文档正文，并将生成内容一键归档至知识库。',
      icon: <BrandIcon brand="yuque" />,
      connected: Boolean(status?.yuque?.connected),
      extra: status?.yuque?.userName ? `用户: ${status.yuque.userName}` : undefined,
      onConnect: () => setYuqueModal(true),
      btnLabel: status?.yuque?.connected ? '重新配置' : '一键连接语雀',
    },
    {
      id: 'gitee' as const,
      group: 'domestic' as const,
      title: 'Gitee (码云)',
      subtitle: '代码托管与项目协同',
      desc: '支持读取 Gitee 代码仓库源码、检索任务与 Issue，以及提交 Bug 工作项。',
      icon: <BrandIcon brand="gitee" />,
      connected: Boolean(status?.gitee?.connected),
      extra: status?.gitee?.userName ? `用户: ${status.gitee.userName}` : undefined,
      onConnect: () => setGiteeModal(true),
      btnLabel: status?.gitee?.connected ? '重新配置' : '一键连接 Gitee',
    },
    {
      id: 'notion' as const,
      group: 'global' as const,
      title: 'Notion',
      subtitle: '知识库与文档管理',
      desc: '让 Agent 直接检索您的工作区文档、查询知识库以及更新 Notion 页面。',
      icon: <BrandIcon brand="notion" />,
      connected: Boolean(status?.notion?.connected),
      extra: undefined,
      onConnect: () => setNotionModal(true),
      btnLabel: status?.notion?.connected ? '重新配置' : '一键连接 Notion',
    },
    {
      id: 'gmail' as const,
      group: 'global' as const,
      title: 'Google Mail',
      subtitle: 'Gmail 邮箱助手',
      desc: '支持邮件智能搜索、往来阅读、标签归档以及起草邮件等全套操作。',
      icon: <BrandIcon brand="gmail" />,
      connected: Boolean(status?.gmail?.connected),
      extra: status?.gmail?.email,
      onConnect: () => setGoogleModal(true),
      btnLabel: status?.gmail?.connected ? '重新配置' : '启动 Google 授权',
    },
    {
      id: 'github' as const,
      group: 'global' as const,
      title: 'GitHub',
      subtitle: '全球开源与代码协作',
      desc: '检索全球开源项目、读取指定分支代码文件，并管理仓库 Issues 与 PRs。',
      icon: <BrandIcon brand="github" />,
      connected: Boolean(status?.github?.connected),
      extra: status?.github?.userName ? `用户: ${status.github.userName}` : undefined,
      onConnect: () => setGitHubModal(true),
      btnLabel: status?.github?.connected ? '重新配置' : '一键连接 GitHub',
    },
  ];


  const visibleCards = cards.filter((c) => {
    if (tab === 'domestic') return c.group === 'domestic';
    if (tab === 'global') return c.group === 'global';
    return true;
  });

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-ink">常用服务直连</h2>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
              快捷应用集成
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            免除复杂的命令行配置，一键授权连接您的核心知识库、通讯与协作工具。
          </p>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex rounded-lg border border-line bg-paper-inset/60 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTab('all')}
            className={cn(
              'rounded-md px-2.5 py-1 font-medium transition-colors',
              tab === 'all' ? 'bg-paper-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            全部 ({cards.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('domestic')}
            className={cn(
              'rounded-md px-2.5 py-1 font-medium transition-colors',
              tab === 'domestic' ? 'bg-paper-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            国内办公 ({cards.filter((c) => c.group === 'domestic').length})
          </button>
          <button
            type="button"
            onClick={() => setTab('global')}
            className={cn(
              'rounded-md px-2.5 py-1 font-medium transition-colors',
              tab === 'global' ? 'bg-paper-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            海外服务 ({cards.filter((c) => c.group === 'global').length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {visibleCards.map((card) => {
          const isDisconnecting = disconnecting === card.id;

          return (
            <div
              key={card.id}
              className="flex flex-col justify-between rounded-xl border border-line bg-paper-inset/40 p-4 transition-colors hover:border-line-strong"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {card.icon}
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{card.title}</h3>
                      <p className="text-[11px] text-ink-muted">{card.subtitle}</p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0',
                      card.connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-line/40 text-ink-muted',
                    )}
                  >
                    {card.connected ? '已连接' : '未连接'}
                  </span>
                </div>

                <p className="mt-3 text-xs text-ink-muted leading-relaxed">{card.desc}</p>

                {card.extra && (
                  <p className="mt-2 truncate text-[11px] font-mono text-ink/70">
                    {card.extra}
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 pt-2 border-t border-line/40">
                {card.connected && (
                  <button
                    type="button"
                    onClick={() => handleDisconnect(card.id, card.title)}
                    disabled={isDisconnecting || loading}
                    className="flex items-center gap-1 text-xs text-ink-muted transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <Unlink size={12} />
                    <span>{isDisconnecting ? '断开中...' : '断开'}</span>
                  </button>
                )}
                <Button
                  variant={card.connected ? 'outline' : 'default'}
                  size="sm"
                  onClick={card.onConnect}
                  disabled={loading || isDisconnecting}
                >
                  {card.btnLabel}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modals */}
      <FeishuConnectModal open={feishuModal} onClose={() => setFeishuModal(false)} onSuccess={handleSuccess} />
      <WeComConnectModal open={wecomModal} onClose={() => setWecomModal(false)} onSuccess={handleSuccess} />
      <DingTalkConnectModal open={dingtalkModal} onClose={() => setDingtalkModal(false)} onSuccess={handleSuccess} />
      <YuqueConnectModal open={yuqueModal} onClose={() => setYuqueModal(false)} onSuccess={handleSuccess} />
      <GiteeConnectModal open={giteeModal} onClose={() => setGiteeModal(false)} onSuccess={handleSuccess} />
      <GitHubConnectModal open={githubModal} onClose={() => setGitHubModal(false)} onSuccess={handleSuccess} />
      <NotionConnectModal open={notionModal} onClose={() => setNotionModal(false)} onSuccess={handleSuccess} />
      <GoogleConnectModal open={googleModal} onClose={() => setGoogleModal(false)} onSuccess={handleSuccess} />
    </section>
  );
}

export default QuickIntegrationsBlock;
