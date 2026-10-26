import { tool } from 'ai';
import { z } from 'zod';
import { pageAttachment } from '../../../shared/attachmentText';
import { redactSecrets } from '../../../shared/redactSecrets';
import type { ArtifactStore } from '../storage/artifactStore';

export const READ_ATTACHMENT_TOOL = 'read_attachment';

/**
 * Pages through a file the user attached in this conversation. Only attachments (source "attachment") of this session
 * are reachable, by the name the user sees; nothing else in the store or on disk can be named through it.
 */
export function createAttachmentTools(options: { sessionId: string; artifacts: ArtifactStore }) {
  return {
    [READ_ATTACHMENT_TOOL]: tool({
      description: 'Read more of a file the user attached to this conversation when its text was cut off ("[已截断 …]"). Pass the attachment name and the offset to continue from; returns one page and the next offset.',
      inputSchema: z.object({
        name: z.string().describe('The attachment file name.'),
        offset: z.number().int().min(0).optional().describe('Character offset to start from (default 0).'),
        length: z.number().int().min(1).optional().describe('Characters to read (default 20000, at most 40000).'),
      }),
      execute: async ({ name, offset, length }) => {
        const attachments = (await options.artifacts.listBySession(options.sessionId)).filter((a) => a.source === 'attachment');
        const wanted = attachments.filter((a) => a.name === name).sort((a, b) => b.version - a.version)[0];
        if (!wanted) return { ok: false, error: `No attachment named "${name}". Available: ${[...new Set(attachments.map((a) => a.name))].join(', ') || '(none)'}` };
        const full = await options.artifacts.get(wanted.id);
        const page = pageAttachment(full?.content ?? '', offset, length);
        return { ok: true, name, offset: page.offset, end: page.end, total: page.total, nextOffset: page.nextOffset, text: redactSecrets(page.text) };
      },
    }),
  };
}
