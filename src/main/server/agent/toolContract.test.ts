import { createKnowledgeTools } from './knowledgeTools';
import { createKnowledgeStore } from '../storage/knowledgeStore';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Skill } from '../../skills';
import { createAskUserTool, createWorkspaceTools } from './workspaceTools';
import { createScheduleTools } from './scheduleTools';
import { createWebTools } from './webTools';
import { createVideoAnalysisTools } from './videoAnalysisTools';
import { createPersonalMemoryTools } from './personalMemory';
import { createSkillTools } from './skillTools';
import { createBatchTool, createSubagentTool } from './subagentTools';
import { createComputerTools } from './computerTools';
import { createDocumentTools } from './documentTools';
import { createPresentationTools } from './presentationTools';
import { createFileTools } from './fileTools';
import { createAttachmentTools } from './attachmentTools';
import { createSkillDraftTools } from './skillDraftTools';

/**
 * Regression guard for what the model sees: every tool's name, description and input contract. Changing a
 * tool description or parameter silently changes how the agent behaves, so it must show up in review —
 * if this fails on purpose, run `npx vitest run toolContract -u` and read the snapshot diff.
 */

interface ToolLike { description?: string; inputSchema?: unknown }

function contract(tools: Record<string, unknown>): Record<string, { description: string; input: unknown }> {
  const out: Record<string, { description: string; input: unknown }> = {};
  for (const name of Object.keys(tools).sort()) {
    const tool = tools[name] as ToolLike;
    let input: unknown = null;
    try {
      const json = z.toJSONSchema(tool.inputSchema as z.ZodType) as { properties?: Record<string, unknown>; required?: string[] };
      input = { properties: Object.fromEntries(Object.entries(json.properties ?? {}).sort(([a], [b]) => a.localeCompare(b))), required: [...(json.required ?? [])].sort() };
    } catch { input = 'unreadable schema'; }
    out[name] = { description: tool.description ?? '', input };
  }
  return out;
}

const none = (): void => undefined;
const skill = { id: 'demo', name: 'Demo', description: 'd', body: 'b', source: 'bundled', dir: '.', autoInvoke: true } as unknown as Skill;
const stub = {} as never;

describe('tool contract snapshots', () => {
  it('workspace tools', () => {
    const { tools } = createWorkspaceTools({ sessionId: 's', workspacePath: os.tmpdir(), permissionMode: 'ask', emit: none, todos: [] });
    expect(contract(tools)).toMatchSnapshot();
  });
  it('ask_user', () => expect(contract({ ask_user: createAskUserTool('s') })).toMatchSnapshot());
  it('automations', () => expect(contract(createScheduleTools({ scheduleStore: stub, sessionId: 's' }))).toMatchSnapshot());
  it('web', () => expect(contract(createWebTools({ sessionId: 's', permissionMode: 'ask' }).tools)).toMatchSnapshot());
  it('video analysis', () => expect(contract(createVideoAnalysisTools({ sessionId: 's', dataRoot: os.tmpdir(), permissionMode: 'ask' }).tools)).toMatchSnapshot());
  it('personal memory', () => expect(contract(createPersonalMemoryTools({ sessionId: 's', dataRoot: os.tmpdir(), permissionMode: 'ask', emit: none }).tools)).toMatchSnapshot());
  it('propose_skill', () => expect(contract(createSkillDraftTools({ dataRoot: os.tmpdir(), getSkills: () => [] }))).toMatchSnapshot());
  it('knowledge_search', () => expect(contract(createKnowledgeTools({ store: createKnowledgeStore(os.tmpdir()) }))).toMatchSnapshot());
  it('read_attachment', () => expect(contract(createAttachmentTools({ sessionId: 's', artifacts: stub }))).toMatchSnapshot());
  it('use_skill', () => expect(contract(createSkillTools({ skills: [skill] }))).toMatchSnapshot());
  it('sub-agents', () => {
    const opts = { getModel: () => stub, tools: {} };
    expect(contract({ ...createSubagentTool(opts), ...createBatchTool(opts) })).toMatchSnapshot();
  });
  it('computer', () => expect(contract(createComputerTools({ sessionId: 's', dataRoot: os.tmpdir(), permissionMode: 'ask', emit: none }).tools)).toMatchSnapshot());
  it('documents', () => expect(contract(createDocumentTools({ sessionId: 's', artifacts: stub, reviews: stub }))).toMatchSnapshot());
  it('presentations', () => expect(contract(createPresentationTools({ sessionId: 's', artifacts: stub, reviews: stub }))).toMatchSnapshot());
  it('file generation', () => expect(contract(createFileTools({ sessionId: 's', artifactStore: stub }))).toMatchSnapshot());

  it('every tool has a description and a readable input schema', () => {
    const all = {
      ...createWorkspaceTools({ sessionId: 's', workspacePath: os.tmpdir(), permissionMode: 'ask', emit: none, todos: [] }).tools,
      ...createScheduleTools({ scheduleStore: stub, sessionId: 's' }),
      ...createWebTools({ sessionId: 's', permissionMode: 'ask' }).tools,
    };
    for (const [name, entry] of Object.entries(contract(all))) {
      expect(entry.description.length, `${name} needs a description`).toBeGreaterThan(20);
      expect(entry.input, `${name} schema`).not.toBe('unreadable schema');
    }
  });
});
