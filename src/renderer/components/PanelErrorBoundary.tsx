import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** When this changes (another tab, another conversation) a failed panel gets a fresh try. */
  resetKey: string;
  children: ReactNode;
}

interface State { error: Error | null }

/**
 * Keeps a crash inside one side panel inside that panel: the conversation and the rest of the app stay usable,
 * and the panel offers a retry instead of the whole window falling back to the app-level error page.
 */
export default class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[panel] render failed', error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" data-ui="app.panel-error" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-ink">这个面板出错了，其他部分不受影响。</p>
        <p className="max-w-xs break-words text-xs text-ink-muted">{error.message.slice(0, 160)}</p>
        <button type="button" onClick={() => this.setState({ error: null })} className="rounded-full bg-ink px-3 py-1.5 text-xs text-paper-raised hover:opacity-85">重试</button>
      </div>
    );
  }
}
