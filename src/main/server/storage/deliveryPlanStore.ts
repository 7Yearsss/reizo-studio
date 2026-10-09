import { nanoid } from 'nanoid';
import type { DbHandle } from '../db/client';
import type { DeliveryManifest, DeliveryPlan, SkillContract, SavedDeliveryPlan } from '../../../shared/skillContract';

export type { SavedDeliveryPlan } from '../../../shared/skillContract';
interface Row { id: string; canvas_id: string; skill_id: string; contract_json: string; plan_json: string; manifest_json: string;
  complete: number; issues_json: string; created_at: number; updated_at: number }
const convert = (row: Row): SavedDeliveryPlan => ({ id: row.id, canvasId: row.canvas_id, skillId: row.skill_id,
  contract: JSON.parse(row.contract_json), plan: JSON.parse(row.plan_json), manifest: JSON.parse(row.manifest_json),
  complete: Boolean(row.complete), issues: JSON.parse(row.issues_json), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });

export function createDeliveryPlanStore(handle: DbHandle) {
  const raw = handle.raw;
  return {
    create(canvasId: string, skillId: string, contract: SkillContract, plan: DeliveryPlan, id = nanoid()) {
      const previous = raw.prepare('SELECT * FROM delivery_plans WHERE id = ?').get(id) as unknown as Row | undefined;
      if (previous) {
        if (previous.canvas_id !== canvasId || previous.skill_id !== skillId || previous.plan_json !== JSON.stringify(plan)) throw new Error('交付计划 ID 已被其他内容使用');
        return convert(previous);
      }
      const now = Date.now();
      raw.prepare("INSERT INTO delivery_plans (id, canvas_id, skill_id, contract_json, plan_json, manifest_json, complete, issues_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', 0, '[]', ?, ?)")
        .run(id, canvasId, skillId, JSON.stringify(contract), JSON.stringify(plan), now, now);
      return this.get(id);
    },
    get(id: string): SavedDeliveryPlan | null {
      const row = raw.prepare('SELECT * FROM delivery_plans WHERE id = ?').get(id) as unknown as Row | undefined;
      return row ? convert(row) : null;
    },
    list(canvasId: string) {
      return (raw.prepare('SELECT * FROM delivery_plans WHERE canvas_id = ? ORDER BY updated_at DESC LIMIT 100').all(canvasId) as unknown as Row[]).map(convert);
    },
    finish(id: string, manifest: DeliveryManifest, issues: string[]) {
      raw.prepare('UPDATE delivery_plans SET manifest_json = ?, complete = ?, issues_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(manifest), issues.length ? 0 : 1, JSON.stringify(issues), Date.now(), id);
      return this.get(id);
    },
  };
}
