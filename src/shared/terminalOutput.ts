/* eslint-disable no-control-regex */
/**
 * Strip terminal control sequences from command output before it is shown,
 * stored, searched, copied, or handed to a model. Ported from cindy's
 * `terminal-output.ts`. Also normalises CRLF and drops non-newline C0
 * controls. Returns the input unchanged when it contains nothing to strip.
 */

// OSC: ESC ] ... (BEL | ESC \)   and the 8-bit form  0x9d ... (BEL | 0x9c)
const OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
const OSC_8BIT = /\x9d[\s\S]*?(?:\x07|\x9c)/g;
// DCS / PM / APC: ESC (P | ^ | _) ... ESC \
const DCS_PM_APC = /\x1b[P\^_][\s\S]*?\x1b\\/g;
// CSI: ESC [ params intermediates final
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// Any remaining bare ESC sequence (ESC + one byte in 0x40..0x5f range, etc.)
const BARE_ESC = /\x1b[@-Z\\-_]/g;
// C0 controls except \n and \t
const C0_NON_NEWLINE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const HAS_CONTROL = /[\r\x00-\x08\x0b-\x1f\x7f\x9b-\x9d]/;

export function stripTerminalControlSequences(input: string): string {
  if (!input || !HAS_CONTROL.test(input)) return input;
  return input
    .replace(OSC, '')
    .replace(OSC_8BIT, '')
    .replace(DCS_PM_APC, '')
    .replace(CSI, '')
    .replace(BARE_ESC, '')
    .replace(/\r\n?/g, '\n')
    .replace(C0_NON_NEWLINE, '');
}

/**
 * Environment overrides that ask a child process to emit plain text in the
 * first place. `PSStyle__OutputRendering=PlainText` matters on Windows /
 * PowerShell, which is Reizo's dev platform.
 */
export function plainTextTerminalEnv(): Record<string, string> {
  return {
    NO_COLOR: '1',
    CLICOLOR: '0',
    CLICOLOR_FORCE: '0',
    FORCE_COLOR: '0',
    TERM: 'dumb',
    PSStyle__OutputRendering: 'PlainText',
  };
}
