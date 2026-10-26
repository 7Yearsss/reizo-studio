/** The notice the renderer shows when the loop guard stopped a run (see chatStore's tool_loop handler). */
export const HALTED_PREFIX = '已停止：';

export function isHaltedNotice(notice: string | null | undefined): boolean {
  return Boolean(notice && notice.startsWith(HALTED_PREFIX));
}

/** What "换个办法继续" sends: the guard resets per turn, so the model needs to be told to change course, not repeat. */
export const LOOP_RECOVERY_MESSAGE = '刚才的做法一直在重复、没有进展。请换一种完全不同的方式继续完成任务；如果确实做不到，直接告诉我卡在哪里和需要我提供什么。';
