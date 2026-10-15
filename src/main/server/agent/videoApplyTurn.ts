import { nanoid } from 'nanoid';
import type { AgentEvent } from '../../../shared/agentEvent';
import type { SessionStore } from '../../../shared/chat';
import type { LargeValueStore } from '../storage/largeValueStore';
import { isVideoApplyCommand } from '../videoEditor/approval';
import { editorResult } from '../videoEditor/mcpClient';
import { editorObservationsFor } from '../videoEditor/observations';
import { videoEditorFor } from '../videoEditor/service';
import { isSessionTurnLive, startAgentTurn } from './session';

const starting = new Set<string>();
export interface VideoApplyTurnInput {
  sessionStore: SessionStore; sessionId: string; userText: string;
  dataRoot?: string; regenerate?: boolean; truncateAfterId?: string;
  mentions?: string[]; attachments?: unknown[]; skill?: unknown;
  largeValueStore?: LargeValueStore;
}

/** Local command, using the normal persisted/resumable turn stream without a provider. */
export async function tryVideoApplyTurn(input: VideoApplyTurnInput): Promise<Response | null> {
  if (!input.dataRoot || !isVideoApplyCommand(input.userText) || input.truncateAfterId
      || input.mentions?.length || input.attachments?.length || input.skill) return null;
  const { sessionStore, sessionId, dataRoot } = input;
  if (starting.has(sessionId) || isSessionTurnLive(sessionId)) return Response.json({ error: '当前对话仍在执行，请等待本轮结束后确认草稿。' }, { status: 409 });
  starting.add(sessionId);
  try {
    if (!input.regenerate) await sessionStore.appendMessage(sessionId, {
      id: nanoid(), role: 'user', content: input.userText, createdAt: new Date().toISOString(),
    });
    const editor = videoEditorFor(dataRoot);
    const observations = editorObservationsFor(dataRoot);
    return startAgentTurn({
      sessionStore, sessionId, largeValues: input.largeValueStore,
      translate: (chunk) => chunk.event as AgentEvent,
      onTurnTerminal: () => { starting.delete(sessionId); },
      createStream: (signal) => ({ fullStream: (async function* () {
        const event = (value: AgentEvent) => ({ type: 'local-video-command', event: value });
        if (input.regenerate) {
          yield event({ type: 'text', data: { delta: '这是上一轮的重试，未重复应用。请查看编辑器当前状态；若仍有待确认草稿，可重新发送“应用这一版”。' } });
          yield event({ type: 'done', data: {} });
          return;
        }
        const id = nanoid(), name = 'video_editor_apply', args = {};
        yield event({ type: 'tool_use', data: { id, name, args } });
        observations.record(sessionId, 'working', '正在直接应用当前剪辑提案');
        try {
          signal.throwIfAborted();
          const expected = await editor.pendingReview(sessionId, signal);
          if (!expected) throw new Error('当前没有可应用的待确认草稿。请检查剪辑面板；已应用的内容不会重复执行。');
          signal.throwIfAborted();
          const result = await editor.applyReviewed(sessionId, expected, signal);
          const info = editorResult(result);
          if (info.status !== 'applied') throw new Error('尚未收到应用成功的回执，请检查编辑器状态，不要重复提交修改。');
          observations.record(sessionId, 'applied', '当前剪辑草稿已应用，可在编辑器撤销');
          yield event({ type: 'tool_result', data: { id, name, args, result: JSON.stringify(result) } });
          yield event({ type: 'text', data: { delta: '已应用当前剪辑草稿，可在编辑器中撤销。' } });
          yield event({ type: 'done', data: {} });
        } catch (error) {
          const message = error instanceof Error ? error.message : '应用结果尚未确认，请检查剪辑面板。';
          observations.record(sessionId, signal.aborted ? 'cancelled' : 'failed', message);
          yield event({ type: 'tool_result', data: { id, name, args, error: message } });
          yield event({ type: 'text', data: { delta: `未确认应用成功：${message}` } });
          // A handled tool failure is an answered local command, not a provider
          // transport failure. Persist the explanation and never trigger model retry.
          yield event({ type: 'done', data: {} });
        }
      })() }),
    });
  } finally {
    // Once dispatched, AgentSession owns concurrent-turn exclusion and termination.
    starting.delete(sessionId);
  }
}
