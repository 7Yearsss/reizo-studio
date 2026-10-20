import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { drainMemoryJobs, formatLessonBody, scheduleMemoryExtraction } from './memoryJobs';
import { readMemoryEntry } from './workspaceMemoryDir';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

describe('memoryJobs lesson extraction and trajectory', () => {
  it('formats structured cue/lesson/evidence/confidence lesson bodies and persists them', async () => {
    const body = formatLessonBody({
      type: 'lesson',
      cue: 'When running PDF conversion in this workspace',
      lesson: 'In this workspace, pdftoppm is not installed; use built-in document tools instead.',
      evidence: 'run_command pdftoppm failed with command not found',
      confidence: 'high',
    });
    expect(body).toContain('- **Cue**: When running PDF conversion');
    expect(body).toContain('- **Lesson**: In this workspace, pdftoppm is not installed');
    expect(body).toContain('- **Evidence**: run_command pdftoppm failed');
    expect(body).toContain('- **Confidence**: high');

    const root = await mkdtemp(path.join(os.tmpdir(), 'mem-job-'));
    try {
      let seenPrompt = '';
      const model = new MockLanguageModelV3({
        doGenerate: async (params) => {
          seenPrompt = JSON.stringify(params.prompt);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  memories: [
                    {
                      name: 'workspace-no-pdftoppm',
                      description: 'When converting PDFs in this workspace',
                      type: 'lesson',
                      cue: 'Converting PDF pages',
                      lesson: 'In this workspace, pdftoppm is unavailable.',
                      evidence: '[ERROR 1] command not found: pdftoppm',
                      confidence: 'high',
                    },
                  ],
                  deletions: [],
                }),
              },
            ],
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage,
            warnings: [],
          };
        },
      });

      scheduleMemoryExtraction({
        workspaceRoot: root,
        model,
        userText: 'check the pdf',
        assistantText: 'done',
        turnTrajectory: '[ACTION 1] run_command({"command":"pdftoppm"})\n[ERROR 1] command not found: pdftoppm',
      });
      await drainMemoryJobs();

      expect(seenPrompt).toContain('Tool Trajectory');
      expect(seenPrompt).toContain('pdftoppm');
      const saved = await readMemoryEntry(root, 'workspace-no-pdftoppm.md');
      expect(saved?.type).toBe('lesson');
      expect(saved?.body).toContain('In this workspace, pdftoppm is unavailable.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
