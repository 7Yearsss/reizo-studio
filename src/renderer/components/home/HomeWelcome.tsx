import { useEffect, useState } from 'react';
import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';

function welcomeAt(hour: number) {
  if (hour >= 5 && hour < 11) return { greeting: '早上好', icon: Sunrise };
  if (hour >= 11 && hour < 14) return { greeting: '中午好', icon: Sun };
  if (hour >= 14 && hour < 18) return { greeting: '下午好', icon: Sunset };
  return { greeting: '晚上好', icon: Moon };
}

export default function HomeWelcome({ active }: { active: boolean }) {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    if (!active) return;
    const update = () => setHour(new Date().getHours());
    update();
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [active]);
  const { greeting, icon: Icon } = welcomeAt(hour);
  return (
    <header className="w-full text-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
      <div className="mb-4 inline-flex items-center gap-2 text-ink-muted">
        <Icon size={18} strokeWidth={1.5} aria-hidden />
        <span className="text-base font-semibold tracking-[-0.03em]">Reizo</span>
      </div>
      <h1 className="text-balance text-[clamp(24px,2.5vw,32px)] font-medium leading-[1.45] tracking-[-0.025em] text-ink">
        {greeting}，今天想创作些什么？
      </h1>
      <p className="mt-3 text-balance text-sm leading-6 text-ink-muted">从一个想法开始，一起把它变成作品。</p>
    </header>
  );
}
