import type { ReizoBridge } from '../../shared/window';
import type { DirEntry } from '../../shared/workspace';
import type { QuickIntegrationsStatus } from '../../shared/extensionConfig';

/**
 * Initializes a resilient web fallback bridge when the app is accessed in a web browser
 * (e.g. at http://localhost:46173) or during early mount before Electron preload initializes.
 */
export function ensureReizoBridge(): ReizoBridge {
  if (typeof window === 'undefined') {
    return {} as ReizoBridge;
  }
  if (window.reizo) {
    return window.reizo;
  }

  const defaultIntegrationsStatus: QuickIntegrationsStatus = {
    notion: { connected: false },
    gmail: { connected: false },
    feishu: { connected: false },
    wecom: { connected: false },
    dingtalk: { connected: false },
    yuque: { connected: false },
    gitee: { connected: false },
    github: { connected: false },
  };

  const webBridge: ReizoBridge = {
    accountWallet: async () => { throw new Error('请在 Reizo Studio 客户端使用钱包与充值。'); },
    accountTopup: async () => { throw new Error('请在 Reizo Studio 客户端充值。'); },
    accountTopupOpen: async () => { throw new Error('请在 Reizo Studio 客户端打开收银台。'); },
    platform: 'win32' as NodeJS.Platform,
    getApiOrigin: async () => 'http://127.0.0.1:47100',
    windowMinimize: async () => {},
    windowToggleMaximize: async () => false,
    windowClose: async () => {},
    windowIsMaximized: async () => false,
    pickFolder: async () => null,
    listWorkspace: async (): Promise<DirEntry[]> => [],
    readWorkspaceFile: async (relativePath: string) => ({ relativePath, content: '', truncated: false }),
    flattenWorkspace: async (): Promise<DirEntry[]> => [],
    runCommand: async () => ({
      command: '',
      cwd: '',
      stdout: '',
      stderr: 'Web browser environment does not support terminal commands',
      exitCode: 1,
    }),
    readDroppedFile: async () => ({ name: '', content: '', truncated: false }),
    revealInFolder: async () => {},
    deleteWorkspacePath: async (p: string) => ({ path: p }),
    createWorkspaceEntry: async (p: string, kind: 'file' | 'dir') => ({ path: p, kind }),
    gitStatus: async () => ({ available: false, branch: null, dirty: false, porcelain: '', recent: '' }),
    installSkill: async () => null,
    listPlugins: async () => [],
    searchMcpCatalog: async () => ({ items: [] }),
    listPluginCatalog: async () => ({ marketplace: '', items: [] }),
    installCatalogPlugin: async () => {
      throw new Error('浏览器网页端暂不支持安装桌面扩展包，请在 Reizo Studio 桌面端运行');
    },
    listMcpServers: async () => [],
    saveMcpServers: async () => {},
    testMcpServer: async () => ({
      ok: false,
      tools: [],
      messages: ['Web browser environment does not support local process execution'],
    }),
    resetMcpBaseline: async () => {},
    listHooks: async () => [],
    saveHooks: async () => {},
    relaunchApp: async () => undefined,
    quickSubmit: async () => false,
    quickHide: async () => undefined,
    onQuickAsk: () => () => undefined,
    onDeepLink: () => () => undefined,
    onScreenshot: () => () => undefined,
    reportAttention: () => undefined,
    onQuickReset: () => () => undefined,
    installPlugin: async () => null,
    setPluginConfig: async () => undefined,
    previewPlugin: async () => null,
    installPreviewedPlugin: async () => { throw new Error('not available in the browser'); },
    setPluginEnabled: async () => {},
    uninstallPlugin: async () => {},
    uninstallSkill: async () => {},
    searchSkillHub: async () => ({ items: [], total: 0 }),
    installSkillHubSkill: async () => {
      throw new Error('浏览器网页端不支持安装技能');
    },
    previewSkillHubSkill: async () => '',
    exportPdf: async () => '',
    checkNodeEnvironment: async () => ({ available: true, version: 'v20.0.0' }),
    getQuickIntegrationsStatus: async () => defaultIntegrationsStatus,
    connectNotion: async () => ({ ok: false, error: 'Web browser environment does not support direct connect' }),
    startGoogleOAuth: async () => ({ ok: false, error: 'Web browser environment does not support direct connect' }),
    connectFeishu: async () => ({ ok: false, error: 'Web browser environment does not support direct connect' }),
    connectWeCom: async () => ({ ok: false, error: 'Web browser environment does not support direct connect' }),
    connectDingTalk: async () => ({ ok: false, error: 'Web browser environment does not support direct connect' }),
    connectYuque: async () => ({ ok: false, error: 'Web browser environment does not support direct connect' }),
    connectGitee: async () => ({ ok: false, error: 'Web browser environment does not support direct connect' }),
    connectGitHub: async () => ({ ok: false, error: 'Web browser environment does not support direct connect' }),
    disconnectIntegration: async () => ({ ok: false }),
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    accountStatus: async () => ({ status: 'signed-out' as const, webOrigin: '' }),
    accountLogin: async () => ({ status: 'signed-out' as const, webOrigin: '' }),
    accountPasswordLogin: async () => ({ status: 'signed-out' as const, webOrigin: '', message: '请在桌面客户端中使用账号密码登录。' }),
    accountLogout: async () => ({ status: 'signed-out' as const, webOrigin: '' }),
    accountReopen: async () => ({ status: 'signed-out' as const, webOrigin: '' }),
    accountRefresh: async () => ({ status: 'signed-out' as const, webOrigin: '' }),
  };

  window.reizo = webBridge;
  return webBridge;
}
