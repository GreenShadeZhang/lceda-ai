import { isEasyEda, showToast } from './utils';

let lastContent: string | null = null;
let hasUnsavedCheckpoint = false;

/** Save the current schematic state as a restorable checkpoint */
export async function saveCheckpoint(): Promise<boolean> {
  if (!isEasyEda()) return false;
  try {
    const content = await eda.sys_FileManager.getDocumentSource();
    if (!content) return false;
    lastContent = content;
    hasUnsavedCheckpoint = true;
    return true;
  } catch (e) {
    console.warn('[checkpoint] save failed:', e);
    return false;
  }
}

/** Restore the last saved checkpoint */
export async function restoreCheckpoint(): Promise<void> {
  if (!lastContent) throw new Error('暂无检查点');
  if (!isEasyEda()) throw new Error('不在 EDA 环境中');
  try {
    // Try to reload the document source
    await (eda.sys_FileManager as any).setDocumentSource?.(lastContent);
    lastContent = null;
    hasUnsavedCheckpoint = false;
    showToast('已撤销上一次 AI 修改', 'success');
  } catch (e) {
    throw new Error('恢复失败：' + (e instanceof Error ? e.message : String(e)));
  }
}

export function hasCheckpoint(): boolean {
  return hasUnsavedCheckpoint && lastContent !== null;
}

export function clearCheckpoint(): void {
  lastContent = null;
  hasUnsavedCheckpoint = false;
}
