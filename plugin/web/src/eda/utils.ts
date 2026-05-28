/** True when running inside EasyEDA Pro's iframe context */
export function isEasyEda(): boolean {
  try {
    return typeof eda !== 'undefined' && typeof eda.sys_Message !== 'undefined';
  } catch {
    return false;
  }
}

export function showToast(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const typeMap = { info: 1, success: 2, error: 0, warning: 3 } as const;
  try {
    if (isEasyEda()) {
      eda.sys_Message.showToastMessage(message, typeMap[type] as any);
      return;
    }
  } catch { /* ignore */ }
  console.log(`[Toast ${type}]`, message);
}
