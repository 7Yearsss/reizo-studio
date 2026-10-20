// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ConversationGuide from './ConversationGuide';

let root: Root, host: HTMLDivElement;
const choose = vi.fn(), manage = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); });
  choose.mockReset(); manage.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function button(text: string) { return [...host.querySelectorAll('button')].find((b) => b.textContent === text)!; }

it('explains on focus, opens category tools without inserting, and selects a tool explicitly', async () => {
  await act(async () => root.render(<ConversationGuide onChoose={choose} onManageSkills={manage} />));
  await act(async () => button('写作').focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('主题、读者、风格和篇幅');
  expect(choose).not.toHaveBeenCalled();
  await act(async () => button('写作').click());
  expect(choose).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="写作工具"]')).not.toBeNull();
  const card = [...host.querySelectorAll('button')].find((el) => el.textContent?.startsWith('公众号文章'));
  await act(async () => card?.click());
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({ id: 'wechat', prompt: expect.stringContaining('公众号文章') }));
  await act(async () => button('PPT').click());
  expect(host.querySelector('[aria-label="写作工具"]')).toBeNull();
  expect(host.querySelector('[aria-label="PPT工具"]')).not.toBeNull();
  expect(choose).toHaveBeenCalledTimes(1);
  await act(async () => button('PPT').click());
  expect(host.querySelector('[aria-label="PPT工具"]')).toBeNull();
});

it('exposes extra categories and the real skills management entry', async () => {
  await act(async () => root.render(<ConversationGuide onChoose={choose} onManageSkills={manage} />));
  await act(async () => { button('更多').focus(); button('更多').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.startsWith('数据分析'))!;
  expect(item).toBeTruthy();
  await act(async () => item.click());
  expect(choose).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="数据分析工具"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="管理技能"]')!.click());
  expect(manage).toHaveBeenCalledOnce();
});

it('disables guide actions while a conversation is being created', async () => {
  await act(async () => root.render(<ConversationGuide disabled onChoose={choose} onManageSkills={manage} />));
  expect([...host.querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  await act(async () => button('写作').click());
  expect(choose).not.toHaveBeenCalled();
});

it('shows only matching installed skills and retains their real skill ids', async () => {
  const skills = [
    { id: 'video-travel', name: '旅行视频', description: '旅行素材生成短片', category: 'video', prompt: '帮我做旅行短片', source: 'bundled' as const },
    { id: 'review-code', name: '代码审查技能', description: '检查代码', category: 'dev', source: 'bundled' as const },
  ];
  await act(async () => root.render(<ConversationGuide skills={skills} onChoose={choose} onManageSkills={manage} />));
  await act(async () => button('视频').click());
  expect(host.textContent).toContain('旅行视频');
  expect(host.textContent).not.toContain('代码审查技能');
  const card = [...host.querySelectorAll('button')].find((el) => el.textContent?.startsWith('旅行视频'));
  await act(async () => card?.click());
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({ skillId: 'video-travel', prompt: '帮我做旅行短片' }));
});
