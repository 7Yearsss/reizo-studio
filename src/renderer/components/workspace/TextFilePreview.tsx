/** Plain-text files preserve every newline and symbol instead of interpreting Markdown. */
export default function TextFilePreview({ content }: { content: string }) {
  return <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-sans text-[14px] leading-[1.8] select-text">{content}</pre>;
}
