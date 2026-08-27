import { useState, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, appendTerminalLine } from '../../state/terminalStore';

export default function TerminalPanel() {
  const lines = useSyncExternalStore(subscribe, getSnapshot);
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);

  async function run() {
    const trimmed = command.trim();
    if (!trimmed || running) return;
    setRunning(true);
    try {
      const result = await window.reizo.runCommand(trimmed);
      appendTerminalLine(result);
      setCommand('');
    } catch (err) {
      appendTerminalLine({
        command: trimmed,
        stdout: '',
        stderr: (err as Error).message,
        exitCode: 1,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 && <p className="text-ink-muted">在工作区里跑命令。Agent 的 run_command 也会出现在这里。</p>}
        {lines.map((line) => (
          <div key={line.id} className="mb-3">
            <div className="text-accent">$ {line.command}</div>
            {line.stdout && <pre className="whitespace-pre-wrap text-ink">{line.stdout}</pre>}
            {line.stderr && <pre className="whitespace-pre-wrap text-danger">{line.stderr}</pre>}
            {line.exitCode !== 0 && <div className="text-ink-muted">exit {line.exitCode}</div>}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <span className="text-xs text-ink-muted">$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
          placeholder="在工作区执行…"
          className="flex-1 bg-transparent text-xs text-ink outline-none"
        />
      </div>
    </div>
  );
}
