/** Wire types for the Settings → Extensions page (user-level MCP servers and hooks). */

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServerEntry {
  name: string;
  transport: McpTransport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** http / sse */
  url?: string;
  headers?: Record<string, string>;
  /** Kept in the file but not connected. */
  disabled?: boolean;
}

export interface McpTestResult {
  ok: boolean;
  /** Tools the server exposes, as the agent will see them. */
  tools: Array<{ name: string; description: string }>;
  /** Why it failed, or tools withheld, etc. */
  messages: string[];
}

export interface HookEntry {
  event: 'PreToolUse' | 'PostToolUse';
  /** Regex over the tool name; empty means every tool. */
  matcher?: string;
  command: string;
  timeoutMs?: number;
}

export interface NodeEnvStatus {
  available: boolean;
  version?: string;
}

export type QuickIntegrationId =
  | 'notion'
  | 'gmail'
  | 'feishu'
  | 'wecom'
  | 'dingtalk'
  | 'yuque'
  | 'gitee'
  | 'github';

export interface QuickIntegrationsStatus {
  notion: {
    connected: boolean;
    serverName?: string;
  };
  gmail: {
    connected: boolean;
    serverName?: string;
    email?: string;
  };
  feishu: {
    connected: boolean;
    serverName?: string;
    appName?: string;
    appId?: string;
  };
  wecom: {
    connected: boolean;
    serverName?: string;
    botName?: string;
  };
  dingtalk: {
    connected: boolean;
    serverName?: string;
    botName?: string;
  };
  yuque: {
    connected: boolean;
    serverName?: string;
    userName?: string;
  };
  gitee: {
    connected: boolean;
    serverName?: string;
    userName?: string;
    login?: string;
  };
  github: {
    connected: boolean;
    serverName?: string;
    userName?: string;
    login?: string;
  };
}

export interface GoogleOAuthParams {
  clientId: string;
  clientSecret: string;
}

export interface FeishuConnectParams {
  appId: string;
  appSecret: string;
}

export interface WeComConnectParams {
  webhookUrl: string;
  botName?: string;
}

export interface DingTalkConnectParams {
  webhookUrl: string;
  secret?: string;
  botName?: string;
}

export interface YuqueConnectParams {
  token: string;
}

export interface GiteeConnectParams {
  token: string;
}

export interface GitHubConnectParams {
  token: string;
}


export interface IntegrationConnectResult {
  ok: boolean;
  error?: string;
  email?: string;
  name?: string;
  toolsCount?: number;
}

