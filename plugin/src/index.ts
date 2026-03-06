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
const MSG_DEBUG_INSPECT    = 'DEBUG_INSPECT';
const MSG_DEBUG_RESULT     = 'DEBUG_RESULT';
const MSG_CLEAR_CANVAS     = 'CLEAR_CANVAS';
const MSG_CLEAR_RESULT     = 'CLEAR_RESULT';

const DEDUPE_WINDOW_MS = 8000;

// 保存 MessageBus 订阅任务，以便重新初始化时先取消旧订阅
let subscriptionTasks: Array<{ cancel: () => void }> = [];
let messageBusInitialized = false;
let isPlacementRunning = false;
let inFlightRequestId: string | null = null;
let lastCompletedRequestId: string | null = null;
let lastCompletedAt = 0;

type GenerateRequestEnvelope = {
  requestId?: string;
  circuitJson?: any;
};

function makeLegacyRequestId(circuitJson: any): string {
  try {
    const comps = Array.isArray(circuitJson?.components) ? circuitJson.components : [];
    const sample = comps.slice(0, 8).map((c: any) => `${c?.ref ?? ''}:${c?.lcsc ?? ''}:${c?.x ?? ''}:${c?.y ?? ''}`).join('|');
    return `legacy:${comps.length}:${sample}`;
  } catch {
    return 'legacy:unknown';
  }
}

function unpackGenerateRequest(payload: any): { requestId: string; circuitJson: any } {
  const envelope = payload as GenerateRequestEnvelope;
  if (envelope && typeof envelope === 'object' && envelope.circuitJson) {
    return {
      requestId: (typeof envelope.requestId === 'string' && envelope.requestId.trim())
        ? envelope.requestId
        : makeLegacyRequestId(envelope.circuitJson),
      circuitJson: envelope.circuitJson,
    };
  }

  return {
    requestId: makeLegacyRequestId(payload),
    circuitJson: payload,
  };
}

/**
 * 打开 AI 原理图生成器 IFrame 面板，并首次调用时初始化 MessageBus 订阅
 */
export function openAIPanel(): void {
  if (!messageBusInitialized) {
    messageBusInitialized = true;
    // 取消旧订阅（防止插件 reload 时遗留的订阅重复触发）
    for (const task of subscriptionTasks) {
      try { task.cancel(); } catch (_) {}
    }
    subscriptionTasks = [];
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
  const t1 = eda.sys_MessageBus.subscribe(MSG_GENERATE_REQUEST, async (payload: any) => {
    const { requestId, circuitJson } = unpackGenerateRequest(payload);
    const now = Date.now();

    if (isPlacementRunning) {
      if (inFlightRequestId === requestId) {
        eda.sys_MessageBus.publish(MSG_GENERATE_RESULT, {
          requestId,
          skipped: true,
          placedCount: 0,
          log: [`跳过重复请求：${requestId}（当前请求仍在处理中）`],
        });
        return;
      }

      eda.sys_MessageBus.publish(MSG_GENERATE_ERROR, {
        requestId,
        message: `已有绘制任务进行中（${inFlightRequestId ?? 'unknown'}），请稍后重试`,
      });
      return;
    }

    if (
      lastCompletedRequestId === requestId &&
      now - lastCompletedAt < DEDUPE_WINDOW_MS
    ) {
      eda.sys_MessageBus.publish(MSG_GENERATE_RESULT, {
        requestId,
        skipped: true,
        placedCount: 0,
        log: [`跳过重复请求：${requestId}（${DEDUPE_WINDOW_MS}ms 内已完成）`],
      });
      return;
    }

    isPlacementRunning = true;
    inFlightRequestId = requestId;
    try {
      const result = await placeCircuitOnCanvas(circuitJson);
      eda.sys_MessageBus.publish(MSG_GENERATE_RESULT, {
        requestId,
        placedCount: result.placedCount,
        log: result.log,
      });
      lastCompletedRequestId = requestId;
      lastCompletedAt = Date.now();
    } catch (e: any) {
      const msg = e?.message || String(e);
      eda.sys_ToastMessage.showMessage(`原理图放置失败: ${msg}`, 0 as any);
      eda.sys_MessageBus.publish(MSG_GENERATE_ERROR, { requestId, message: msg });
    } finally {
      isPlacementRunning = false;
      inFlightRequestId = null;
    }
  });

  const t2 = eda.sys_MessageBus.subscribe(MSG_DEBUG_INSPECT, async () => {
    try {
      const data = await inspectCanvas();
      eda.sys_MessageBus.publish(MSG_DEBUG_RESULT, data);
    } catch (e: any) {
      eda.sys_MessageBus.publish(MSG_DEBUG_RESULT, { error: e?.message || String(e) });
    }
  });

  const t3 = eda.sys_MessageBus.subscribe(MSG_CLEAR_CANVAS, async () => {
    try {
      const counts = await clearCanvas();
      eda.sys_MessageBus.publish(MSG_CLEAR_RESULT, { success: true, ...counts });
    } catch (e: any) {
      eda.sys_MessageBus.publish(MSG_CLEAR_RESULT, { success: false, error: e?.message || String(e) });
    }
  });

  subscriptionTasks.push(t1, t2, t3);
}

/**
 * 坐标归一化：将所有元件/网络标识/导线平移，使最小坐标锚定在 (200, 200) mil，
 * 避免 LLM 生成的超大坐标导致元件超出可见画布范围。
 */
function normalizeCoordinates(circuitJson: any): any {
  const allX: number[] = [];
  const allY: number[] = [];

  for (const c of circuitJson.components ?? []) {
    if (typeof c.x === 'number') allX.push(c.x);
    if (typeof c.y === 'number') allY.push(c.y);
  }
  for (const n of circuitJson.net_flags ?? []) {
    if (typeof n.x === 'number') allX.push(n.x);
    if (typeof n.y === 'number') allY.push(n.y);
  }
  for (const w of circuitJson.wires ?? []) {
    for (const pt of w.points ?? []) {
      if (typeof pt.x === 'number') allX.push(pt.x);
      if (typeof pt.y === 'number') allY.push(pt.y);
    }
  }

  if (allX.length === 0) return circuitJson;

  const ORIGIN = 200;
  const dx = ORIGIN - Math.min(...allX);
  const dy = ORIGIN - Math.min(...allY);
  if (dx === 0 && dy === 0) return circuitJson;

  const out = JSON.parse(JSON.stringify(circuitJson));
  for (const c of out.components ?? []) { c.x = (c.x ?? 0) + dx; c.y = (c.y ?? 0) + dy; }
  for (const n of out.net_flags  ?? []) { n.x = (n.x ?? 0) + dx; n.y = (n.y ?? 0) + dy; }
  for (const w of out.wires      ?? []) {
    for (const pt of w.points ?? []) { pt.x = (pt.x ?? 0) + dx; pt.y = (pt.y ?? 0) + dy; }
  }
  return out;
}

/**
 * Story 3.4: 调用 EDA SDK 将电路 JSON 放置到原理图画布
 * [Source: architecture.md#ADR-09 电路 JSON 数据契约]
 */
async function placeCircuitOnCanvas(circuitJson: any): Promise<{ placedCount: number; log: string[] }> {
  const normalized  = normalizeCoordinates(circuitJson);
  const components: any[] = normalized.components ?? [];
  const netFlags:   any[] = normalized.net_flags  ?? [];
  const wires:      any[] = normalized.wires       ?? [];

  let placedCount = 0;
  const log: string[] = [];

  const L = (msg: string) => { log.push(msg); console.log('[AI-SCH]', msg); };
  const E = (msg: string) => { log.push('❌ ' + msg); console.error('[AI-SCH]', msg); };

  // 0. 清除旧画布元素，避免重复叠加
  try {
    const cleared = await clearCanvas();
    L(`清除旧元素: ${cleared.components} 个元件, ${cleared.wires} 条导线, ${cleared.pins} 个引脚`);
  } catch (e: any) {
    E(`清除画布失败: ${e?.message || e}`);
  }

  L(`开始放置: ${components.length} 个元件, ${netFlags.length} 个网络标识`);
  // 诊断：打印收到的 JSON 摘要，便于定位重复源头
  L(`收到的 nets: ${(normalized.nets ?? []).length} 个`);
  for (const comp of components) {
    L(`  📦 JSON元件: ref=${comp.ref ?? '-'} lcsc=${comp.lcsc ?? '-'} name=${comp.name ?? comp.value ?? '-'} @(${comp.x},${comp.y})`);
  }
  console.log('[AI-SCH] 完整circuitJson:', JSON.stringify(circuitJson).slice(0, 2000));

  // 辅助：对齐到 5-mil 栅格（EDA Pro 标准栅格为 5 mil）
  // 参考: easyeda-copilot 的 to2() 函数
  const snap5 = (v: number): number => { v = Math.round(v); return v - (v % 5); };

  // 1. 放置元件，保存创建结果用于后续引脚读取
  const compResults: Map<string, { obj: any; primitiveId: string }> = new Map(); // ref → { obj, primitiveId }
  for (const comp of components) {
    const label = comp.ref || comp.value || comp.name || '未知';
    try {
      let deviceUuid: string | null = null;
      let method = '';

      // 1. 优先用 LCSC 编号，仅读取 uuid，不直接 create
      if (comp.lcsc) {
        const list = await eda.lib_Device.getByLcscIds([comp.lcsc], undefined);
        L(`${label}: getByLcscIds(${comp.lcsc}) → ${list?.length ?? 0} 结果`);
        if (list && list.length > 0) {
          const item = list[0];
          L(`${label}: SearchItem uuid=${item.uuid}, libUuid=${item.libraryUuid}, name=${item.name}`);
          deviceUuid = item?.uuid ?? null;
          method = `lcsc(${comp.lcsc})`;
        } else {
          L(`${label}: getByLcscIds(${comp.lcsc}) 返回空，降级到搜索`);
        }
      }

      // 2. 降级：按名称/型号搜索（同样只取 uuid）
      const searchTerm = comp.name || comp.value;
      if (!deviceUuid && searchTerm) {
        const list = await eda.lib_Device.search(searchTerm, undefined, undefined, undefined, 5, 1);
        L(`${label}: search(${searchTerm}) → ${list?.length ?? 0} 结果`);
        if (list && list.length > 0) {
          const item = list[0];
          deviceUuid = item?.uuid ?? null;
          method = `search(${searchTerm})`;
          L(`${label}: SearchItem uuid=${item.uuid}, libUuid=${item.libraryUuid}, name=${item.name}`);
        } else {
          L(`${label}: search(${searchTerm}) 也返回空`);
        }
      }

      if (!deviceUuid) {
        E(`${label}: 所有查找方式均失败 [lcsc=${comp.lcsc ?? '-'}, term=${searchTerm ?? '-'}]`);
        eda.sys_ToastMessage.showMessage(`元件未找到：${label}，已跳过`, 0 as any);
        continue;
      }

      // 3. 使用单一路径创建：先 get(uuid) 拿 DeviceItem，再 create 一次
      const cx = snap5(comp.x ?? 200);
      const cy = snap5(comp.y ?? 200);
      const cr = comp.rotation ?? 0;
      const bom = comp.add_to_bom !== false;
      const pcb = comp.add_to_pcb !== false;

      let createResult: any = null;
      try {
        const full = await eda.lib_Device.get(deviceUuid);
        if (!full) {
          E(`${label}: get(${deviceUuid}) 返回空`);
          continue;
        }
        L(`${label}: get(${deviceUuid}) → DeviceItem uuid=${full.uuid} lib=${full.libraryUuid}`);
        createResult = await eda.sch_PrimitiveComponent.create(full, cx, cy, undefined, cr, false, bom, pcb);
      } catch (createErr: any) {
        E(`${label}: create(DeviceItem) 失败 - ${createErr?.message || createErr}`);
      }

      if (createResult) {
        // 关键：调用 done() 将图元更改应用到画布（参考 easyeda-copilot 的 assemble.ts）
        // 不调用 done() 时，引脚位置可能尚未最终确定
        try {
          await createResult.done();
        } catch (doneErr: any) {
          L(`${label}: done() 警告 - ${doneErr?.message || doneErr}`);
        }
        const primitiveId = createResult.getState_PrimitiveId?.() ?? '';
        L(`✓ ${label}: 已放置 via ${method} + get(uuid), primitiveId=${primitiveId}`);
        placedCount++;
        if (comp.ref) compResults.set(comp.ref, { obj: createResult, primitiveId });
      } else {
        E(`${label}: create() 返回空（via ${method} + get(uuid)）`);
      }
    } catch (e: any) {
      E(`${label}: 放置异常 - ${e?.message || e}`);
      eda.sys_ToastMessage.showMessage(`放置失败: ${label} - ${e?.message || e}`, 0 as any);
    }
  }

  // 2. 放置网络标识（GND、VCC 等）
  // EDA SDK createNetFlag 的 type 参数首字母必须大写（"Ground"/"Power"/"NetFlag"）
  const normalizeNetType = (t: string): string => {
    if (!t) return 'NetFlag';
    const map: Record<string, string> = {
      ground: 'Ground',
      gnd: 'Ground',
      power: 'Power',
      vcc: 'Power',
      netflag: 'NetFlag',
    };
    return map[t.toLowerCase()] ?? (t.charAt(0).toUpperCase() + t.slice(1));
  };

  for (const nf of netFlags) {
    try {
      await eda.sch_PrimitiveComponent.createNetFlag(
        normalizeNetType(nf.type ?? 'Ground'),
        nf.net  ?? 'GND',
        snap5(nf.x ?? 200),
        snap5(nf.y ?? 300),
      );
      L(`✓ 网络标识: ${nf.net}(${normalizeNetType(nf.type ?? 'Ground')}) @ (${snap5(nf.x ?? 200)},${snap5(nf.y ?? 300)})`);
    } catch (e: any) {
      E(`网络标识放置失败: ${nf.net}(type=${nf.type}) - ${e?.message || e}`);
      eda.sys_ToastMessage.showMessage(`网络标识放置失败: ${nf.net} - ${e?.message || e}`, 0 as any);
    }
  }

  // 3. 基于 nets 数组自动连线（读取已放置元件的实际引脚坐标）
  const nets: any[] = normalized.nets ?? [];
  if (nets.length === 0 && wires.length === 0) {
    L('连线: 无（nets 和 wires 均为空，用户需手动连线）');
  }

  if (nets.length > 0) {
    // 3a. 构建引脚坐标映射: "ref.pinNumber" → {x, y}
    const pinMap: Map<string, { x: number; y: number }> = new Map();
    for (const [ref, entry] of compResults) {
      try {
        // 优先使用 getAllPinsByPrimitiveId（beta 级别，更稳定）
        // 而非 instance.getAllPins()（alpha 级别）
        // 参考: easyeda-copilot 的 search.ts getPrimitiveComponentPins()
        let pins: any[] | undefined;
        if (entry.primitiveId) {
          pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(entry.primitiveId) as any;
        }
        // 降级：使用实例方法
        if (!pins || pins.length === 0) {
          pins = await entry.obj.getAllPins() as any;
        }
        if (!pins || pins.length === 0) {
          L(`📌 ${ref}: getAllPins 返回空`);
          continue;
        }
        for (const pin of pins) {
          const pinNum = pin.getState_PinNumber();
          const px = pin.getState_X();
          const py = pin.getState_Y();
          pinMap.set(`${ref}.${pinNum}`, { x: px, y: py });
        }
        L(`📌 ${ref}: ${pins.length} 个引脚已读取`);
      } catch (e: any) {
        E(`${ref}: 读取引脚失败 - ${e?.message || e}`);
      }
    }
    L(`引脚映射: 共 ${pinMap.size} 个引脚`);

    // 3b. 对每个网络，收集引脚坐标并连线
    for (const net of nets) {
      const netName: string = net.net ?? '';
      const pinRefs: string[] = net.pins ?? [];
      const points: { x: number; y: number }[] = [];

      for (const pinRef of pinRefs) {
        const pos = pinMap.get(pinRef);
        if (pos) {
          points.push(pos);
        } else {
          E(`网络 ${netName}: 引脚 ${pinRef} 未找到坐标`);
        }
      }

      if (points.length < 2) {
        L(`网络 ${netName}: 有效引脚 ${points.length} 个，不足 2 个，跳过`);
        continue;
      }

      // 按 x 坐标排序，减少交叉
      points.sort((a, b) => a.x - b.x || a.y - b.y);

      // 逐对连线：L 型折线（水平→垂直）
      // 注意：不传 netName 给 wire.create()——SDK 会自动从连接的引脚推断网络。
      // 若显式传 netName，当引脚已有显式网络时 SDK 会报 "create failed!"。
      for (let i = 0; i < points.length - 1; i++) {
        const from = points[i];
        const to = points[i + 1];
        // 坐标取整并对齐 5-mil 栅格
        const fx = snap5(from.x), fy = snap5(from.y);
        const tx = snap5(to.x), ty = snap5(to.y);
        if (fx === tx && fy === ty) continue; // 跳过零长度线段
        try {
          let wirePoints: number[];
          if (fx === tx || fy === ty) {
            wirePoints = [fx, fy, tx, ty];
          } else {
            wirePoints = [fx, fy, tx, fy, tx, ty];
          }
          const result = await eda.sch_PrimitiveWire.create(wirePoints);
          if (result) {
            L(`✓ 连线 ${netName}: (${fx},${fy})→(${tx},${ty})`);
          } else {
            E(`连线 ${netName}: create 返回空 (${fx},${fy})→(${tx},${ty})`);
          }
        } catch (e: any) {
          E(`连线 ${netName} 失败: ${e?.message || e}`);
        }
      }
    }
  }

  // 3c. 兼容旧格式 wires（直接坐标连线）
  for (const wire of wires) {
    try {
      const pts: any[] = wire.points ?? [];
      if (pts.length < 2) { L(`连线跳过: 点数不足(${pts.length})`); continue; }

      const flatPoints: number[] = (typeof pts[0] === 'object' && pts[0] !== null)
        ? pts.flatMap((pt: any) => [snap5(Number(pt.x ?? 0)), snap5(Number(pt.y ?? 0))])
        : pts.map((v: any) => snap5(Number(v)));

      await eda.sch_PrimitiveWire.create(flatPoints);
      L(`✓ 连线: ${pts.length} 个点`);
    } catch (e: any) {
      E(`连线绘制失败: ${e?.message || e}`);
    }
  }

  // 4. 保存文档
  try {
    await eda.sch_Document.save();
    L('文档已保存');
  } catch (e: any) {
    E(`保存失败: ${e?.message || e}`);
    eda.sys_ToastMessage.showMessage(`保存失败: ${e?.message || e}`, 0 as any);
  }

  L(`完成: 成功放置 ${placedCount}/${components.length} 个元件`);
  return { placedCount, log };
}

/**
 * 清除当前画布上所有元件、导线和独立引脚
 */
async function clearCanvas(): Promise<{ components: number; wires: number; pins: number }> {
  let compCount = 0, wireCount = 0, pinCount = 0;

  // 1. 删除所有元件（包括 NetFlag/NetPort 等，它们也是 Component 类型）
  const allCompIds = await eda.sch_PrimitiveComponent.getAllPrimitiveId();
  if (allCompIds && allCompIds.length > 0) {
    await eda.sch_PrimitiveComponent.delete(allCompIds);
    compCount = allCompIds.length;
  }

  // 2. 删除所有导线
  const allWireIds = await eda.sch_PrimitiveWire.getAllPrimitiveId();
  if (allWireIds && allWireIds.length > 0) {
    await eda.sch_PrimitiveWire.delete(allWireIds);
    wireCount = allWireIds.length;
  }

  // 3. 删除所有独立引脚
  const allPinIds = await eda.sch_PrimitivePin.getAllPrimitiveId();
  if (allPinIds && allPinIds.length > 0) {
    await eda.sch_PrimitivePin.delete(allPinIds);
    pinCount = allPinIds.length;
  }

  return { components: compCount, wires: wireCount, pins: pinCount };
}

/**
 * 调试：读取当前画布上所有元件、引脚、导线、网络标识，返回结构化数据
 */
async function inspectCanvas(): Promise<any> {
  const result: any = { components: [], wires: [], netFlags: [], summary: {} };

  // 1. 读取所有元件
  const allComps = await eda.sch_PrimitiveComponent.getAll();
  for (const comp of allComps ?? []) {
    const compInfo: any = {
      id: comp.getState_PrimitiveId(),
      designator: comp.getState_Designator() ?? '',
      name: comp.getState_Name() ?? '',
      x: comp.getState_X(),
      y: comp.getState_Y(),
      rotation: comp.getState_Rotation(),
      supplierId: comp.getState_SupplierId() ?? '',
      pins: [],
    };

    // 读取每个元件的引脚
    try {
      const pins = await comp.getAllPins();
      for (const pin of pins ?? []) {
        compInfo.pins.push({
          number: pin.getState_PinNumber(),
          name: pin.getState_PinName(),
          x: pin.getState_X(),
          y: pin.getState_Y(),
        });
      }
    } catch (_) {}

    result.components.push(compInfo);
  }

  // 2. 读取所有导线
  const allWires = await eda.sch_PrimitiveWire.getAll();
  for (const wire of allWires ?? []) {
    result.wires.push({
      id: wire.getState_PrimitiveId(),
      net: wire.getState_Net(),
      line: wire.getState_Line(),
    });
  }

  // 3. 读取所有独立引脚（NetFlag 也是一种 Pin）
  const allPins = await eda.sch_PrimitivePin.getAll();
  for (const pin of allPins ?? []) {
    result.netFlags.push({
      id: pin.getState_PrimitiveId(),
      number: pin.getState_PinNumber(),
      name: pin.getState_PinName(),
      x: pin.getState_X(),
      y: pin.getState_Y(),
    });
  }

  result.summary = {
    components: result.components.length,
    wires: result.wires.length,
    netFlags: result.netFlags.length,
    totalPins: result.components.reduce((s: number, c: any) => s + c.pins.length, 0),
  };

  return result;
}

