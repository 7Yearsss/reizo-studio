import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Tooltip } from '../ui/Tooltip';
import { apiOrigin } from '../../api';
import { LocalRecognizer } from '../../lib/voice/recognizer';
import { requestVoiceRecording, type VoiceRecording } from '../../lib/voice/recording';
import { hasVoiceEnergy, VOICE_MAX_SECONDS, type VoiceModelStatus } from '../../../shared/voiceInput';

type Phase = 'idle' | 'checking' | 'setup' | 'preparing' | 'permission' | 'recording' | 'transcribing' | 'error';
let owner: symbol | undefined;

export default function VoiceInputButton({ className, onTranscript, disabled = false, active = true }: {
  className?: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const identity = useRef(Symbol('voice'));
  const abort = useRef<AbortController | null>(null);
  const recording = useRef<VoiceRecording | null>(null);
  const recognizer = useRef<LocalRecognizer | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const callback = useRef(onTranscript); callback.current = onTranscript;
  const currentPhase = useRef(phase); currentPhase.current = phase;
  const languageRef = useRef(language); languageRef.current = language;
  const enabled = useRef(active && !disabled); enabled.current = active && !disabled;

  function release() {
    abort.current?.abort(); abort.current = null;
    clearInterval(ticker.current);
    recording.current?.cancel(); recording.current = null;
    recognizer.current?.dispose(); recognizer.current = null;
    if (owner === identity.current) owner = undefined;
  }
  function cancel() { release(); setPhase('idle'); setNote(''); setSeconds(0); setLevel(0); }
  useEffect(() => {
    const hide = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); release(); };
  }, []);
  useEffect(() => { if (!active || disabled) cancel(); }, [active, disabled]);
  useEffect(() => {
    if (phase === 'idle') return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [phase]);

  function fail(error: unknown, controller: AbortController) {
    if (controller.signal.aborted) return;
    const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    const message = name === 'NotAllowedError' ? '麦克风权限未开启，请在系统隐私设置中允许 Reizo 使用麦克风。'
      : name === 'NotFoundError' ? '没有找到麦克风，请连接设备后重试。'
      : name === 'NotReadableError' ? '麦克风不可用或被占用，请检查设备后重试。'
      : error instanceof Error ? error.message : '语音输入失败，请重试';
    release(); setNote(message); setPhase('error');
  }
  async function finish() {
    const controller = abort.current, capture = recording.current, worker = recognizer.current;
    if (!controller || !capture || !worker || currentPhase.current !== 'recording') return;
    currentPhase.current = 'transcribing'; setPhase('transcribing'); clearInterval(ticker.current); setLevel(0);
    try {
      const samples = await capture.finish();
      if (recording.current === capture) recording.current = null;
      if (controller.signal.aborted) return;
      if (!hasVoiceEnergy(samples)) throw new Error('没有检测到清晰语音，请靠近麦克风重试。');
      const text = await worker.transcribe(samples, languageRef.current, controller.signal);
      if (controller.signal.aborted || !enabled.current) return;
      if (!text.trim()) throw new Error('没有识别到文字，请重新录音。');
      callback.current(text);
      cancel();
    } catch (error) { fail(error, controller); }
  }
  async function begin(download = false) {
    if (!enabled.current || abort.current) return;
    if (owner && owner !== identity.current) { setNote('另一个对话正在使用语音输入，请先结束该录音。'); setPhase('error'); return; }
    owner = identity.current;
    const controller = new AbortController(); abort.current = controller;
    setPhase('checking'); setNote('');
    const check = () => { if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
    try {
      const origin = await apiOrigin(); check();
      const response = await fetch(origin + '/api/voice/status', { signal: controller.signal });
      if (!response.ok) throw new Error('语音服务未就绪，请重启桌面应用后重试。');
      const status = await response.json() as VoiceModelStatus; check();
      if (!status.ready && !download) { release(); setPhase('setup'); return; }
      setPhase('preparing'); setNote(status.ready ? '正在加载本地语音模型…' : '正在下载语音模型，首次约 80 MB…');
      if (!status.ready) {
        let polling = false;
        const progress = setInterval(async () => {
          if (polling || controller.signal.aborted) return;
          polling = true;
          try {
            const response = await fetch(origin + '/api/voice/status', { signal: controller.signal });
            if (!response.ok) return;
            const current = await response.json() as VoiceModelStatus;
            if (!controller.signal.aborted && current.downloading) setNote(`正在下载语音模型 · ${Math.floor(current.bytes / current.total * 100)}%`);
          } catch { /* The prepare request reports failures. */ }
          finally { polling = false; }
        }, 1000);
        try {
          const ready = await fetch(origin + '/api/voice/prepare', { method: 'POST', signal: controller.signal });
          if (!ready.ok) throw new Error('语音模型下载失败，请检查网络后重试。');
        } finally { clearInterval(progress); }
        check();
      }
      const worker = new LocalRecognizer(); recognizer.current = worker;
      setNote('正在加载本地语音模型…'); await worker.load(origin, controller.signal); check();
      setPhase('permission');
      const capture = await requestVoiceRecording(controller.signal);
      if (controller.signal.aborted) { capture.cancel(); return; }
      recording.current = capture;
      await capture.start(); check();
      setSeconds(0); setPhase('recording'); currentPhase.current = 'recording';
      const started = Date.now();
      ticker.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed); setLevel(capture.level());
        if (elapsed >= VOICE_MAX_SECONDS) void finish();
      }, 100);
    } catch (error) { fail(error, controller); }
  }
  const busy = ['checking', 'preparing', 'permission', 'transcribing'].includes(phase);
  const label = phase === 'recording' ? '结束录音并转文字' : busy ? '语音处理中' : '语音输入';
  return (
    <div className="relative inline-flex shrink-0">
      {phase !== 'idle' && (
        <section aria-label="语音输入面板" className="absolute bottom-full right-0 z-50 mb-3 w-72 max-w-[calc(100vw-32px)] rounded-2xl border border-line bg-paper-raised p-4 text-left shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-ink">{phase === 'recording' ? '正在录音 · ' + seconds + 's' : phase === 'transcribing' ? '正在本地转文字…' : '本地语音输入'}</span>
            <button type="button" onClick={cancel} aria-label="取消语音输入" className="rounded-md p-1 text-ink-muted hover:bg-paper-inset focus-visible:outline-2"><X size={14} /></button>
          </div>
          {phase === 'setup' || phase === 'error' ? <>
            <p role={phase === 'error' ? 'alert' : undefined} className="text-xs leading-5 text-ink-muted">{phase === 'error' ? note : '首次下载约 80 MB 模型。录音在本机识别，不上传；文字填入草稿后由你发送。'}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <select aria-label="识别语言" value={language} onChange={e => setLanguage(e.target.value as 'zh' | 'en')} className="rounded-lg bg-paper-inset p-2 text-xs text-ink"><option value="zh">中文</option><option value="en">English</option></select>
              <button type="button" onClick={() => void begin(phase === 'setup')} className="rounded-lg bg-accent px-3 py-2 text-xs text-accent-ink">{phase === 'setup' ? '下载并开始录音' : '重试'}</button>
            </div>
          </> : phase === 'recording' ? <>
            <select aria-label="识别语言" value={language} onChange={e => setLanguage(e.target.value as 'zh' | 'en')} className="rounded-lg bg-paper-inset p-2 text-xs text-ink"><option value="zh">中文</option><option value="en">English</option></select>
            <div role="meter" aria-label="麦克风音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} className="my-3 h-1.5 overflow-hidden rounded-full bg-paper-inset"><div className="h-full rounded-full bg-accent" style={{ width: Math.max(2, level * 100) + '%' }} /></div>
            <p className="text-xs leading-5 text-ink-muted">说完点击麦克风或下方按钮。最多录音 2 分钟。</p>
            <button type="button" onClick={() => void finish()} className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-xs text-accent-ink">结束录音并转文字</button>
          </> : <p role="status" className="text-xs leading-5 text-ink-muted">{phase === 'permission' ? '正在请求麦克风权限…' : phase === 'transcribing' ? '识别结果将填入当前草稿，不会自动发送。' : note || '正在检查本地语音模型…'}</p>}
        </section>
      )}
      <Tooltip content={label} side="top" wrapperClassName="inline-flex shrink-0">
        <button type="button" aria-label={label} aria-pressed={phase === 'recording'} disabled={disabled || !active || busy}
          onClick={() => phase === 'recording' ? void finish() : void begin()}
          className={cn('flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-ink-muted transition-colors hover:bg-paper-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 disabled:opacity-50', phase === 'recording' && 'bg-danger/10 text-danger', className)}>
          {busy ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : phase === 'recording' ? <Square size={13} fill="currentColor" /> : <Mic size={16} strokeWidth={1.7} />}
        </button>
      </Tooltip>
    </div>
  );
}
