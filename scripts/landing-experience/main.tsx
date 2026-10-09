import { installShowcaseTransport } from './transport';
import './experience.css';
import { CanvasAutoFocusContext } from '../../src/renderer/components/canvas/CanvasAutoFocusContext';

const transport = installShowcaseTransport();
document.documentElement.classList.remove('dark');
// Ordinary page scrolling must not change the sample's canvas zoom.
document.addEventListener('wheel', event => {
  if (!event.ctrlKey && (event.target as Element)?.closest('.react-flow')) event.stopPropagation();
}, { capture: true, passive: true });
// Desktop's composer autofocus must not scroll or steal focus from the landing page.
const nativeFocus = HTMLElement.prototype.focus;
let userEngaged = false;
document.addEventListener('pointerdown', () => { userEngaged = true; }, { capture: true });
document.addEventListener('keydown', () => { userEngaged = true; }, { capture: true });
HTMLElement.prototype.focus = function (options?: FocusOptions) {
  if (window.parent !== window && !userEngaged) return;
  nativeFocus.call(this, { ...options, preventScroll: true });
};

async function boot() {
  // Import only after the browser-local bridge and storage have been installed.
  const [{ createRoot }, { default: MainLayout }, { default: ErrorBoundary }, settings, chat, skills, projects, tabs, ui] = await Promise.all([
    import('react-dom/client'), import('../../src/renderer/components/layout/MainLayout'),
    import('../../src/renderer/components/ErrorBoundary'), import('../../src/renderer/state/settingsStore'),
    import('../../src/renderer/state/chatStore'), import('../../src/renderer/state/skillStore'),
    import('../../src/renderer/state/projectStore'), import('../../src/renderer/state/tabStore'), import('../../src/renderer/state/uiStore'),
  ]);
  await Promise.all([settings.loadSettings(), chat.loadSessions(), skills.loadSkills(), projects.loadProjects()]);
  const params = new URLSearchParams(window.location.search);
  document.documentElement.dataset.experienceView = params.get('view') === 'canvas' ? 'canvas' : 'workspace';
  const id = params.get('project') ?? 'commerce';
  const session = chat.getSnapshot().sessions.find(s => s.id === id) ?? chat.getSnapshot().sessions[0];
  // Start with a readable note on phones; the original editor still allows panning and fitting.
  if (window.innerWidth < 600) for (const sample of transport.data.sessions)
    localStorage.setItem(`reizo:canvas-viewport:${sample.id}`, JSON.stringify({ x: 30, y: -45, zoom: .95 }));
  else for (const sceneId of Object.keys(transport.replays)) {
    // Replayed canvases start empty, so pre-frame the area the agent will fill (~1300×800).
    const panel = params.get('view') === 'canvas' ? window.innerWidth : window.innerWidth * .55;
    const zoom = Math.min(1, Math.max(.35, Math.min((panel - 40) / 1320, (window.innerHeight - 120) / 820)));
    localStorage.setItem(`reizo:canvas-viewport:${sceneId}`, JSON.stringify({ x: 20, y: 20, zoom }));
  }
  tabs.openChatTab(session.id, session.title, true);
  ui.setMode('chat');
  ui.setSidebarWidth(192);
  ui.setRightPanelTab(params.get('view') === 'canvas' || window.innerWidth >= 600 ? 'canvas' : null);
  ui.setRightPanelWidth(Math.round(window.innerWidth * .55));
  ui.setSidebarCollapsed(true);
  ui.setRightPanelMaximized(params.get('view') === 'canvas' || window.innerWidth < 600);
  createRoot(document.getElementById('root')!).render(<div className="landing-sample"><CanvasAutoFocusContext.Provider value={false}><ErrorBoundary><MainLayout /></ErrorBoundary></CanvasAutoFocusContext.Provider></div>);
  let ready = false;
  let currentView = params.get('view');
  const announce = () => window.parent.postMessage({ type: 'reizo-experience-ready' }, window.location.origin);
  const currentProject = () => {
    const snapshot = tabs.getSnapshot();
    return snapshot.tabs.find(tab => tab.id === snapshot.activeTabId)?.sessionId;
  };
  const notifyProject = () => {
    const project = currentProject();
    if (project && transport.data.sessions.some(sample => sample.id === project))
      window.parent.postMessage({ type: 'reizo-experience-project', project }, window.location.origin);
    if (ready && visible) void playScene(project);
  };
  // Each scene starts with a sent message; only the agent's response is replayed.
  const played = new Set<string>();
  const userEdited = new Set<string>();
  let playbackPaused = false;
  let visible = false;
  const active = (id: string) => visible && !document.hidden && !playbackPaused && currentProject() === id;
  transport.setReplayActivity(active);
  document.addEventListener('input', event => {
    if (!event.isTrusted || !(event.target instanceof Element) || !event.target.closest('textarea,[contenteditable="true"]')) return;
    const id = currentProject();
    if (id) userEdited.add(id);
  }, { capture: true });
  async function playScene(id?: string) {
    if (!id || played.has(id) || userEdited.has(id) || !transport.replays[id] || !active(id)) return;
    played.add(id);
    const { prompt } = transport.replays[id];
    await chat.sendMessage(id, prompt);
  }
  // Start only once the sample is actually on screen (the iframe observes the top-level viewport).
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && ready) void playScene(currentProject());
  }, { threshold: .35 }).observe(document.documentElement);
  tabs.subscribe(notifyProject);
  const layout = () => {
    document.documentElement.dataset.experienceView = currentView === 'canvas' ? 'canvas' : 'workspace';
    ui.setRightPanelTab(currentView === 'canvas' || window.innerWidth >= 600 ? 'canvas' : null);
    ui.setRightPanelWidth(Math.round(window.innerWidth * .55));
    if (currentView === 'canvas') ui.setSidebarCollapsed(true);
    ui.setRightPanelMaximized(currentView === 'canvas' || window.innerWidth < 600);
  };
  window.addEventListener('resize', layout);
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (event.data?.type === 'reizo-experience-playback') { playbackPaused = event.data.paused === true; return; }
    if (event.data?.type === 'reizo-experience-host-ready') { if (ready) announce(); return; }
    if (event.data?.type !== 'reizo-experience-open-project') return;
    const selected = transport.data.sessions.find(sample => sample.id === event.data.project);
    if (!selected) return;
    const changed = currentProject() !== selected.id;
    if (changed) tabs.openChatTab(selected.id, selected.title);
    ui.setMode('chat');
    ui.setRightPanelTab('canvas');
    currentView = event.data.view === 'canvas' ? 'canvas' : null;
    layout();
    if (visible) void playScene(selected.id);
  });
  // Reveal once the product shell has painted. Replayed scenes start with an empty canvas,
  // so wait for the canvas surface (wide) or the composer (narrow) instead of a node.
  const root = document.getElementById('root')!;
  const observer = new MutationObserver(() => {
    const painted = currentView === 'canvas' || window.innerWidth >= 600
      ? root.querySelector('.react-flow__node, .react-flow__renderer')
      : root.querySelector('[data-message-id], textarea');
    if (!painted) return;
    observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ready = true; announce(); notifyProject();
    }));
  });
  observer.observe(root, { subtree: true, childList: true });
}
void boot().catch(error => {
  console.error('REIZO experience boot failed', error);
  const root = document.getElementById('root');
  if (root) root.textContent = '工作台加载失败，请刷新重试。';
});
