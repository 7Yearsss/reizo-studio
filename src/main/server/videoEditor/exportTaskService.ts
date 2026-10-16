import type { CanvasStore } from '../storage/canvasStore';
import { VideoExportTasks } from './exportTasks';
import { videoEditorFor } from './service';
import { editorMediaFor } from './mediaExchange';

const managers = new Map<string, VideoExportTasks>();
export function videoExportTasksFor(root: string, store: CanvasStore) {
  let manager = managers.get(root);
  if (!manager) {
    const engine = videoEditorFor(root);
    const media = editorMediaFor(root, store);
    manager = new VideoExportTasks(root, {
      request: (method, id, body, signal) => engine.renderRequest(method, id, body, signal),
      output: (file, signal) => engine.renderOutput(file, signal),
      save: (sessionId, projectId, name, bytes) => media.saveExport(sessionId, projectId, name, bytes),
    });
    const tasks = manager;
    engine.addBusyProbe(() => tasks.hasActive());
    managers.set(root, manager);
  }
  return manager;
}
export function stopVideoExportTasks(root: string) {
  managers.get(root)?.stop();
  managers.delete(root);
}
