/**
 * index.ts — 插件主线程入口
 *
 * 职责：
 *   - 注册菜单点击处理函数 openAIPanel（extension.json registerFn 对应）
 *   - 打开 IFrame 对话面板
 *   - 订阅 GENERATE_REQUEST MessageBus 消息，调用 EDA SDK 放置元件
 *
 * 重要限制（来自 architecture.md ADR）：
 *   ❌ 主线程禁止发起任何外部 HTTP 请求（浏览器安全策略）
 *   ❌ EDA 插件 VM 沙箱中没有 window 对象，不能调用 window.addEventListener
 *   ✅ eda.sys_MessageBus.subscribe() 可在主线程使用（EDA 平台 API，非浏览器 API）
 *   ✅ eda.sch_PrimitiveComponent / eda.lib_Device 等原理图 API 在主线程可用
 *
 * [Source: architecture.md#立创EDA 插件 SDK 技术调研]
 */

const MSG_GENERATE_REQUEST = 'GENERATE_REQUEST';
const MSG_GENERATE_RESULT  = 'GENERATE_RESULT';
const MSG_GENERATE_ERROR   = 'GENERATE_ERROR';

let messageBusInitialized = false;

/**
 * 打开 AI 原理图生成器 IFrame 面板，并首次调用时初始化 MessageBus 订阅
 */
export function openAIPanel(): void {
  if (!messageBusInitialized) {
    messageBusInitialized = true;
    initMessageBusHandlers();
  }
  eda.sys_IFrame.openIFrame('/iframe/index.html', 700, 500, undefined, {
    title: 'AI 原理图生成器',
  });
}

/**
 * 初始化 MessageBus 订阅：接收 IFrame 发来的 GENERATE_REQUEST
 */
function initMessageBusHandlers(): void {
  eda.sys_MessageBus.subscribe(MSG_GENERATE_REQUEST, async (circuitJson: any) => {
    try {
      const placedCount = await placeCircuitOnCanvas(circuitJson);
      eda.sys_MessageBus.publish(MSG_GENERATE_RESULT, { placedCount });
    } catch (e: any) {
      const msg = e?.message || String(e);
      eda.sys_ToastMessage.showMessage(`原理图放置失败: ${msg}`, 0 as any);
      eda.sys_MessageBus.publish(MSG_GENERATE_ERROR, { message: msg });
    }
  });
}

/**
 * Story 3.4: 调用 EDA SDK 将电路 JSON 放置到原理图画布
 * [Source: architecture.md#ADR-09 电路 JSON 数据契约]
 */
async function placeCircuitOnCanvas(circuitJson: any): Promise<number> {
  const components: any[] = circuitJson?.components || [];
  const netFlags:   any[] = circuitJson?.net_flags  || [];
  const wires:      any[] = circuitJson?.wires       || [];

  let placedCount = 0;

  // 1. 放置元件
  for (const comp of components) {
    try {
      let deviceObj: any = null;

      // 优先用 LCSC 编号精确获取
      if (comp.lcsc) {
        const list = await eda.lib_Device.getByLcscIds([comp.lcsc], undefined);
        if (list && list.length > 0) deviceObj = list[0];
      }

      // 降级：按名称搜索
      if (!deviceObj && comp.name) {
        const list = await eda.lib_Device.search(comp.name, undefined, undefined, undefined, 5, 1);
        if (list && list.length > 0) deviceObj = list[0];
      }

      if (!deviceObj) {
        eda.sys_ToastMessage.showMessage(`元件未找到：${comp.ref || comp.name}，已跳过`, 0 as any);
        continue;
      }

      await eda.sch_PrimitiveComponent.create(
        deviceObj,
        comp.x        ?? 100,
        comp.y        ?? 100,
        undefined,
        comp.rotation ?? 0,
        false,
        comp.add_to_bom !== false,
        comp.add_to_pcb !== false,
      );
      placedCount++;
    } catch (e: any) {
      eda.sys_ToastMessage.showMessage(
        `放置失败: ${comp.ref || comp.name} - ${e?.message || e}`, 0 as any);
    }
  }

  // 2. 放置网络标识（GND、VCC 等）
  for (const nf of netFlags) {
    try {
      await eda.sch_PrimitiveComponent.createNetFlag(
        nf.type ?? 'Ground',
        nf.net  ?? 'GND',
        nf.x    ?? 100,
        nf.y    ?? 200,
      );
    } catch (_) {}
  }

  // 3. 绘制连线
  for (const wire of wires) {
    try {
      if (wire.points && wire.points.length >= 2) {
        await eda.sch_PrimitiveWire.create(wire.points);
      }
    } catch (_) {}
  }

  // 4. 保存文档
  try {
    await eda.sch_Document.save();
  } catch (e: any) {
    eda.sys_ToastMessage.showMessage(`保存失败: ${e?.message || e}`, 0 as any);
  }

  return placedCount;
}

