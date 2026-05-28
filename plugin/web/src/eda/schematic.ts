import { isEasyEda } from './utils';
import type { SchematicContext, EdaExtended } from '../types/eda';

// Helper to access eda with our custom extensions
const edaExt = () => eda as unknown as EdaExtended;

/**
 * Read components from the EDA canvas.
 * Calls plugin-registered eda.getSchematic() if available,
 * otherwise reads directly via native EDA APIs.
 */
export async function getSchematic(mode: 'selected' | 'all' = 'selected'): Promise<SchematicContext> {
  if (!isEasyEda()) {
    return { components: [], netCount: 0 };
  }

  const ext = edaExt();

  // Prefer the plugin-registered helper (more complete, includes nets)
  if (typeof ext.getSchematic === 'function') {
    const ids = mode === 'selected'
      ? await eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId().catch(() => [])
      : undefined;
    return await ext.getSchematic!(ids);
  }

  // Fallback: read component basics directly via getAll()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allComps: any[] = await eda.sch_PrimitiveComponent.getAll().catch(() => []);

  let targetComps: any[];
  if (mode === 'selected') {
    const selectedIds = new Set(
      await eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId().catch(() => [])
    );
    targetComps = allComps.filter(c => selectedIds.has((c as any).getState_PrimitiveId?.() ?? ''));
  } else {
    targetComps = allComps;
  }

  const components: SchematicContext['components'] = [];

  for (const comp of targetComps) {
    try {
      const ref   = (comp as any).getState_Designator?.() ?? '';
      const value = (comp as any).getState_Value?.() ?? (comp as any).getState_Name?.() ?? '';
      const lcsc  = (comp as any).getState_SupplierId?.() ?? '';

      if (ref) {
        components.push({ ref, name: value, value, lcsc: lcsc || undefined });
      }
    } catch { /* skip unknown components */ }
  }

  return { components, netCount: 0 };
}

/**
 * Assemble a circuit JSON onto the canvas.
 * Calls plugin-registered eda.assembleCircuit() which handles placement.
 */
export async function assembleCircuit(circuitJson: unknown): Promise<{ placedCount: number; log: string[] }> {
  if (!isEasyEda()) {
    throw new Error('不在 EDA 环境中，无法放置元件');
  }
  const ext = edaExt();
  if (typeof ext.assembleCircuit !== 'function') {
    // Fallback: publish via MessageBus (legacy compatibility)
    const requestId = `req-${Date.now()}`;
    eda.sys_MessageBus.publish('GENERATE_REQUEST', { requestId, circuitJson });
    return { placedCount: 0, log: ['已通过 MessageBus 发送放置请求'] };
  }
  return await ext.assembleCircuit!(circuitJson);
}
