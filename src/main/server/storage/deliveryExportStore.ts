import { nanoid } from 'nanoid';
import type { DbHandle } from '../db/client';
import type { DeliveryExport } from '../../../shared/canvasPresentation';
interface Row { id: string; plan_id: string; artifact_id: string; artifact_version: number; format: 'pptx'; job_id: string;
  source_asset_ids_json: string; page_count: number; content_hash: string; created_at: number }
const convert = (row: Row): DeliveryExport => ({ id: row.id, planId: row.plan_id, artifactId: row.artifact_id, artifactVersion: row.artifact_version,
  format: row.format, jobId: row.job_id, sourceAssetIds: JSON.parse(row.source_asset_ids_json), pageCount: row.page_count, contentHash: row.content_hash, createdAt: new Date(row.created_at).toISOString() });
export function createDeliveryExportStore(handle: DbHandle) {
  const raw = handle.raw;
  return {
    list(planId: string): DeliveryExport[] { return (raw.prepare('SELECT * FROM delivery_exports WHERE plan_id = ? ORDER BY created_at DESC, id DESC').all(planId) as unknown as Row[]).map(convert); },
    register(input: Omit<DeliveryExport, 'id' | 'createdAt'>): DeliveryExport {
      const existing = raw.prepare('SELECT * FROM delivery_exports WHERE job_id = ?').get(input.jobId) as unknown as Row | undefined;
      if (existing) return convert(existing);
      const artifact = raw.prepare('SELECT session_id FROM artifacts WHERE id = ?').get(input.artifactId) as { session_id: string } | undefined;
      const plan = raw.prepare('SELECT c.session_id FROM delivery_plans p JOIN canvases c ON c.id = p.canvas_id WHERE p.id = ?').get(input.planId) as { session_id: string } | undefined;
      const version = raw.prepare('SELECT content_digest, storage FROM artifact_versions WHERE artifact_id = ? AND n = ?').get(input.artifactId, input.artifactVersion) as { content_digest: string; storage: string } | undefined;
      if (!plan || !artifact || plan.session_id !== artifact.session_id || !version || version.storage !== 'blob' || version.content_digest !== input.contentHash)
        throw new Error('交付文件与计划/会话/版本不匹配');
      const id = nanoid(); const now = Date.now();
      raw.prepare('INSERT INTO delivery_exports (id, plan_id, artifact_id, artifact_version, format, job_id, source_asset_ids_json, page_count, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.planId, input.artifactId, input.artifactVersion, input.format, input.jobId, JSON.stringify(input.sourceAssetIds), input.pageCount, input.contentHash, now);
      return convert(raw.prepare('SELECT * FROM delivery_exports WHERE id = ?').get(id) as unknown as Row);
    },
  };
}
