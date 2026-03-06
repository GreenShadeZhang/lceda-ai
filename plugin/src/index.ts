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
      const result = await placeCircuitOnCanvas(circuitJson);
      eda.sys_MessageBus.publish(MSG_GENERATE_RESULT, { placedCount: result.placedCount, log: result.log });
    } catch (e: any) {
      const msg = e?.message || String(e);
      eda.sys_ToastMessage.showMessage(`原理图放置失败: ${msg}`, 0 as any);
      eda.sys_MessageBus.publish(MSG_GENERATE_ERROR, { message: msg });
    }
  });
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

  L(`开始放置: ${components.length} 个元件, ${netFlags.length} 个网络标识`);

  // 1. 放置元件，保存创建结果用于后续引脚读取
  const compResults: Map<string, any> = new Map(); // ref → ISCH_PrimitiveComponent
  for (const comp of components) {
    const label = comp.ref || comp.value || comp.name || '未知';
    try {
      let deviceObj: any = null;
      let method = '';

      // 在拿到任何搜索结果后，用其 Pro UUID 升级为完整 ILIB_DeviceItem
      // （直接传 ILIB_DeviceSearchItem 给 create() 会报"数据不符合规范"）
      const upgradeToFull = async (searchItem: any, hint: string): Promise<any> => {
        if (!searchItem?.uuid) return searchItem;
        try {
          const full = await eda.lib_Device.get(searchItem.uuid);
          if (full) { L(`${label}: get(${hint}) → 完整 DeviceItem ✓`); return full; }
          L(`${label}: get(${hint}) 仍返回空，使用 searchItem`);
        } catch (e: any) {
          L(`${label}: get(${hint}) 异常(${e?.message || e})，使用 searchItem`);
        }
        return searchItem;
      };

      // 1. 优先用 LCSC 编号（最可靠路径：getByLcscIds → get(proUuid) → 完整 DeviceItem）
      //    注意：后端返回的 comp.uuid 来自 easyeda.com，与 Pro 的 UUID 体系不同，永远 404
      if (comp.lcsc) {
        const list = await eda.lib_Device.getByLcscIds([comp.lcsc], undefined);
        if (list && list.length > 0) {
          deviceObj = await upgradeToFull(list[0], `lcsc(${comp.lcsc})`);
          method = `lcsc(${comp.lcsc})`;
        } else {
          L(`${label}: getByLcscIds(${comp.lcsc}) 返回空，降级到搜索`);
        }
      }

      // 2. 降级：按名称/型号搜索，同样升级为完整 item
      const searchTerm = comp.name || comp.value;
      if (!deviceObj && searchTerm) {
        const list = await eda.lib_Device.search(searchTerm, undefined, undefined, undefined, 5, 1);
        if (list && list.length > 0) {
          deviceObj = await upgradeToFull(list[0], `search(${searchTerm})`);
          method = `search(${searchTerm})`;
        } else {
          L(`${label}: search(${searchTerm}) 也返回空`);
        }
      }

      if (!deviceObj) {
        E(`${label}: 所有查找方式均失败 [lcsc=${comp.lcsc ?? '-'}, term=${searchTerm ?? '-'}]`);
        eda.sys_ToastMessage.showMessage(`元件未找到：${label}，已跳过`, 0 as any);
        continue;
      }

      const createResult = await eda.sch_PrimitiveComponent.create(
        deviceObj,
        comp.x        ?? 200,
        comp.y        ?? 200,
        undefined,
        comp.rotation ?? 0,
        false,
        comp.add_to_bom !== false,
        comp.add_to_pcb !== false,
      );
      if (createResult) {
        L(`✓ ${label}: 已放置 via ${method}`);
        placedCount++;
        if (comp.ref) compResults.set(comp.ref, createResult);
      } else {
        E(`${label}: create() 返回空（via ${method}）`);
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
    const map: Record<string, string> = { ground: 'Ground', power: 'Power', netflag: 'NetFlag' };
    return map[t.toLowerCase()] ?? (t.charAt(0).toUpperCase() + t.slice(1));
  };

  for (const nf of netFlags) {
    try {
      await eda.sch_PrimitiveComponent.createNetFlag(
        normalizeNetType(nf.type ?? 'Ground'),
        nf.net  ?? 'GND',
        nf.x    ?? 200,
        nf.y    ?? 300,
      );
      L(`✓ 网络标识: ${nf.net}(${normalizeNetType(nf.type ?? 'Ground')}) @ (${nf.x},${nf.y})`);
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
    for (const [ref, compObj] of compResults) {
      try {
        const pins = await compObj.getAllPins();
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
      for (let i = 0; i < points.length - 1; i++) {
        const from = points[i];
        const to = points[i + 1];
        try {
          let wirePoints: number[];
          if (from.x === to.x || from.y === to.y) {
            // 同一行/列，直线连接
            wirePoints = [from.x, from.y, to.x, to.y];
          } else {
            // L 型: 先水平到 to.x，再垂直到 to.y
            wirePoints = [from.x, from.y, to.x, from.y, to.x, to.y];
          }
          const result = await eda.sch_PrimitiveWire.create(wirePoints);
          if (result) {
            L(`✓ 连线 ${netName}: (${from.x},${from.y})→(${to.x},${to.y})`);
          } else {
            E(`连线 ${netName}: create 返回空 (${from.x},${from.y})→(${to.x},${to.y})`);
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
        ? pts.flatMap((pt: any) => [Number(pt.x ?? 0), Number(pt.y ?? 0)])
        : pts.map(Number);

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

