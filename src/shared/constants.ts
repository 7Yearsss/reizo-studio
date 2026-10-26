import { version } from '../../package.json';

export const APP_NAME = 'Reizo Studio';
export const APP_VERSION = version;

// Base port the local API server tries first. If it's taken, the server
// walks forward until it finds a free one — see main/server/listen.ts.
export const API_BASE_PORT = 47100;
export const API_PORT_SCAN_ATTEMPTS = 50;

export const IPC = {
  ACCOUNT_STATUS: 'reizo:account-status',
  ACCOUNT_LOGIN: 'reizo:account-login',
  ACCOUNT_PASSWORD_LOGIN: 'reizo:account-password-login',
  ACCOUNT_LOGOUT: 'reizo:account-logout',
  ACCOUNT_REOPEN: 'reizo:account-reopen',
  ACCOUNT_REFRESH: 'reizo:account-refresh',
  ACCOUNT_WALLET: 'reizo:account-wallet',
  ACCOUNT_TOPUP: 'reizo:account-topup',
  ACCOUNT_TOPUP_OPEN: 'reizo:account-topup-open',
  GET_API_ORIGIN: 'reizo:get-api-origin',
  WINDOW_MINIMIZE: 'reizo:window-minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'reizo:window-toggle-maximize',
  WINDOW_CLOSE: 'reizo:window-close',
  WINDOW_IS_MAXIMIZED: 'reizo:window-is-maximized',
  WORKSPACE_PICK: 'reizo:workspace-pick',
  WORKSPACE_LIST: 'reizo:workspace-list',
  WORKSPACE_READ: 'reizo:workspace-read',
  WORKSPACE_FLATTEN: 'reizo:workspace-flatten',
  WORKSPACE_RUN: 'reizo:workspace-run',
  FILE_READ_ABSOLUTE: 'reizo:file-read-absolute',
  WORKSPACE_REVEAL: 'reizo:workspace-reveal',
  OPEN_EXTERNAL: 'reizo:open-external',
  WORKSPACE_DELETE: 'reizo:workspace-delete',
  WORKSPACE_CREATE: 'reizo:workspace-create',
  WORKSPACE_GIT: 'reizo:workspace-git',
  SKILL_INSTALL: 'reizo:skill-install',
  PLUGIN_LIST: 'reizo:plugin-list',
  MCP_LIST: 'reizo:mcp-list',
  CATALOG_MCP_SEARCH: 'reizo:catalog-mcp-search',
  CATALOG_PLUGINS: 'reizo:catalog-plugins',
  CATALOG_PLUGIN_INSTALL: 'reizo:catalog-plugin-install',
  MCP_SAVE: 'reizo:mcp-save',
  MCP_TEST: 'reizo:mcp-test',
  MCP_RESET_BASELINE: 'reizo:mcp-reset-baseline',
  HOOKS_LIST: 'reizo:hooks-list',
  HOOKS_SAVE: 'reizo:hooks-save',
  PLUGIN_INSTALL: 'reizo:plugin-install',
  PLUGIN_PREVIEW: 'reizo:plugin-preview',
  APP_RELAUNCH: 'reizo:app-relaunch',
  QUICK_SUBMIT: 'reizo:quick-submit',
  QUICK_HIDE: 'reizo:quick-hide',
  QUICK_ASK: 'reizo:quick-ask',
  QUICK_RESET: 'reizo:quick-reset',
  PLUGIN_SET_CONFIG: 'reizo:plugin-set-config',
  PLUGIN_INSTALL_CONFIRMED: 'reizo:plugin-install-confirmed',
  PLUGIN_SET_ENABLED: 'reizo:plugin-set-enabled',
  PLUGIN_UNINSTALL: 'reizo:plugin-uninstall',
  SKILL_UNINSTALL: 'reizo:skill-uninstall',
  SKILLHUB_SEARCH: 'reizo:skillhub-search',
  SKILLHUB_INSTALL: 'reizo:skillhub-install',
  SKILLHUB_PREVIEW: 'reizo:skillhub-preview',
  NODE_ENV_CHECK: 'reizo:node-env-check',
  EXPORT_PDF: 'reizo:export-pdf',
  INTEGRATIONS_STATUS: 'reizo:integrations-status',
  INTEGRATIONS_CONNECT_NOTION: 'reizo:integrations-connect-notion',
  INTEGRATIONS_CONNECT_GOOGLE: 'reizo:integrations-connect-google',
  INTEGRATIONS_CONNECT_FEISHU: 'reizo:integrations-connect-feishu',
  INTEGRATIONS_CONNECT_WECOM: 'reizo:integrations-connect-wecom',
  INTEGRATIONS_CONNECT_DINGTALK: 'reizo:integrations-connect-dingtalk',
  INTEGRATIONS_CONNECT_YUQUE: 'reizo:integrations-connect-yuque',
  INTEGRATIONS_CONNECT_GITEE: 'reizo:integrations-connect-gitee',
  INTEGRATIONS_CONNECT_GITHUB: 'reizo:integrations-connect-github',
  INTEGRATIONS_DISCONNECT: 'reizo:integrations-disconnect',
} as const;


/** @deprecated use IPC.GET_API_ORIGIN */
export const IPC_GET_API_ORIGIN = IPC.GET_API_ORIGIN;

export const TITLEBAR_HEIGHT = 40;
export const READ_FILE_PREVIEW_MAX_BYTES = 1_000_000;
export const READ_FILE_TOOL_MAX_BYTES = 200_000;
export const WORKSPACE_LIST_MAX_ENTRIES = 200;
export const WORKSPACE_FLATTEN_MAX_ENTRIES = 500;
export const WORKSPACE_FLATTEN_MAX_DEPTH = 4;
export const WRITE_FILE_MAX_BYTES = 1_000_000;
export const RUN_COMMAND_TIMEOUT_MS = 30_000;
export const RUN_COMMAND_MAX_BUFFER = 512_000;
export const DROPPED_FILE_MAX_BYTES = 200_000;
