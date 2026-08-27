export default function UserMessage({ content }: { content: string }) {
  return (
    <div className="group flex justify-end">
      <div className="max-w-[75%]">
        <div className="whitespace-pre-wrap rounded-[22px] border border-line bg-paper-raised px-4 py-2.5 text-[15px] leading-relaxed text-ink">
          {content}
        </div>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(content)}
          className="mt-1 hidden text-[11px] text-ink-muted group-hover:inline hover:text-ink"
        >
          复制
        </button>
      </div>
    </div>
  );
}
