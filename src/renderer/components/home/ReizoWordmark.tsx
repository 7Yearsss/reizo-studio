import { TextScramble } from '../motion/text-scramble';

export default function ReizoWordmark({
  active,
  onSettled,
}: {
  active: boolean;
  onSettled?: () => void;
}) {
  return (
    <h1
      aria-label="Reizo"
      className="relative whitespace-nowrap text-[56px] font-semibold tracking-tight text-ink select-none"
    >
      <TextScramble
        text="Reizo"
        duration={580}
        triggerOnMount={active}
        onSettled={onSettled}
      />
    </h1>
  );
}
