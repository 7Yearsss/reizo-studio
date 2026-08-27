export const APP_NAME = 'Reizo Studio';
export const APP_VERSION = '0.1.0';

// Base port the local API server tries first. If it's taken, the server
// walks forward until it finds a free one — see main/server/listen.ts.
export const API_BASE_PORT = 47100;
export const API_PORT_SCAN_ATTEMPTS = 50;

export const IPC = {
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
  WORKSPACE_DELETE: 'reizo:workspace-delete',
  WORKSPACE_CREATE: 'reizo:workspace-create',
  WORKSPACE_GIT: 'reizo:workspace-git',
  SKILL_INSTALL: 'reizo:skill-install',
  SKILL_UNINSTALL: 'reizo:skill-uninstall',
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
