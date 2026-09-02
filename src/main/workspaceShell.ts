import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { RUN_COMMAND_MAX_BUFFER, RUN_COMMAND_TIMEOUT_MS } from '../shared/constants';
import { plainTextTerminalEnv, stripTerminalControlSequences } from '../shared/terminalOutput';

const clean = (s: string): string => stripTerminalControlSequences(s);

const execAsync = promisify(exec);

export interface CommandResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runWorkspaceCommand(cwd: string, command: string): Promise<CommandResult> {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('command is required');
  try {
    const { stdout, stderr } = await execAsync(trimmed, {
      cwd,
      timeout: RUN_COMMAND_TIMEOUT_MS,
      maxBuffer: RUN_COMMAND_MAX_BUFFER,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        LANG: process.env.LANG,
        PATHEXT: process.env.PATHEXT,
        COMSPEC: process.env.COMSPEC,
        SystemRoot: process.env.SystemRoot,
        GIT_PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0',
        PAGER: 'cat',
        ...plainTextTerminalEnv(),
      },
    });
    return {
      command: trimmed,
      cwd,
      stdout: clean(stdout).slice(0, 20_000),
      stderr: clean(stderr).slice(0, 8_000),
      exitCode: 0,
    };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      command: trimmed,
      cwd,
      stdout: clean(String(error.stdout ?? '')).slice(0, 20_000),
      stderr: clean(String(error.stderr || error.message || err)).slice(0, 8_000),
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}
