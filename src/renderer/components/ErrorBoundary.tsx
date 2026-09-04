import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertCircle, RefreshCw, Trash2, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary caught error]', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleResetStorage = (): void => {
    try {
      // Clear canvas-related and UI-related local storage items that might be corrupted
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('reizo:canvas') || key.startsWith('reizo:right-panel') || key.startsWith('reizo:sidebar-mode'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  handleCopy = async (): Promise<void> => {
    const text = [
      `Error: ${this.state.error?.message ?? 'Unknown error'}`,
      `Stack: ${this.state.error?.stack ?? ''}`,
      `ComponentStack: ${this.state.errorInfo?.componentStack ?? ''}`,
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      /* ignore */
    }
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const errorMessage = this.state.error?.message || '未知渲染错误';
      const stack = this.state.error?.stack || this.state.errorInfo?.componentStack || '';

      return (
        <div className="flex h-screen w-screen items-center justify-center bg-paper p-6 text-ink select-none">
          <div className="w-full max-w-xl rounded-2xl border border-line bg-paper-raised p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-danger">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10">
                <AlertCircle size={22} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-ink">界面组件渲染异常</h2>
                <p className="text-xs text-ink-muted">已捕获未处理的运行时错误，保护应用未完全崩溃</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-line/80 bg-paper-inset/50 p-3 font-mono text-xs text-ink">
              <p className="font-semibold text-danger break-words">{errorMessage}</p>
              {stack ? (
                <pre className="mt-2 max-h-48 overflow-auto text-[11px] leading-relaxed text-ink-muted whitespace-pre-wrap">
                  {stack}
                </pre>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 active:scale-95 transition-all"
                >
                  <RefreshCw size={13} />
                  刷新界面
                </button>
                <button
                  type="button"
                  onClick={this.handleResetStorage}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper-raised px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-paper-inset hover:text-ink active:scale-95 transition-all"
                  title="清理画布本地缓存并刷新（解决脏数据导致的渲染崩溃）"
                >
                  <Trash2 size={13} />
                  重置画布缓存
                </button>
              </div>

              <button
                type="button"
                onClick={() => void this.handleCopy()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted hover:bg-paper-inset hover:text-ink transition-colors"
              >
                {this.state.copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                {this.state.copied ? '已复制' : '复制报错详情'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
