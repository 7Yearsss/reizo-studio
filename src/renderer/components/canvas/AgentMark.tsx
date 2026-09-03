/**
 * A `✦` badge on a node the agent just wrote (within ~8s). Distinguishes an
 * agent edit from the user's own. The parent already stops rendering it after
 * the window; the CSS just fades it.
 */
export default function AgentMark({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span
      className="agent-mark pointer-events-none absolute -right-1.5 -top-1.5 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] leading-none text-accent-ink shadow"
      title="Agent 刚修改了这个节点"
      aria-hidden
    >
      ✦
    </span>
  );
}
