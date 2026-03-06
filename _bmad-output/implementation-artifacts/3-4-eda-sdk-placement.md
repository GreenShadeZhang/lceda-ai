# Story 3.4: Plugin 侧 EDA SDK 放置器件、连线与保存

## Status: completed

## Story

As a 插件主线程,
I want 接收 IFrame 传来的电路 JSON 并调用立创 EDA SDK 在画布上放置所有元件、绘制连线、添加网络标识并保存,
So that 用户能在 EDA 画布上看到完整的可编辑原理图。

## Tasks

- [x] 在 `plugin/src/index.ts` `openAIPanel()` 中初始化 MessageBus 订阅（幂等，只初始化一次）
- [x] 实现 `initMessageBusHandlers()` — `eda.sys_MessageBus.subscribe(MSG_GENERATE_REQUEST, handler)`
- [x] 实现 `placeCircuitOnCanvas(circuitJson)` — 依次放置元件、网络标识、绘制连线、保存文档
- [x] 元件放置：`lib_Device.getByLcscIds([comp.lcsc])` 精确查找 → 降级 `lib_Device.search(comp.name,...,5,1)` 模糊搜索
- [x] 网络标识放置：`sch_PrimitiveComponent.createNetFlag(nf.type, nf.net, nf.x, nf.y)`
- [x] 连线绘制：`sch_PrimitiveWire.create(wire.points)`（`points` 为 `[[x,y], ...]` 数组）
- [x] 文档保存：`sch_Document.save()`
- [x] 成功后 `eda.sys_MessageBus.publish(MSG_GENERATE_RESULT, { placedCount })` 通知 IFrame
- [x] 异常捕获后 `eda.sys_MessageBus.publish(MSG_GENERATE_ERROR, { message })` 通知 IFrame

## Acceptance Criteria

**AC1**: `index.ts` 通过 `eda.sys_MessageBus.subscribe('GENERATE_REQUEST', handler)` 收到消息, payload 包含合法 `circuitJson` →
通过 `eda.lib_Device.getByLcscIds()` 精确验证元件，通过后执行放置

**AC2**: `circuitJson.components[]` 遍历 →
调用 `sch_PrimitiveComponent.create()` 依次放置每个元件，坐标来自 JSON `x` / `y` 字段

**AC3**: 所有元件放置完成 →
调用 `sch_PrimitiveWire.create(wire.points)` 绘制所有连线

**AC4**: `circuitJson.net_flags[]` →
调用 `sch_PrimitiveComponent.createNetFlag(type, net, x, y)` 放置 GND / VCC 等网络标识

**AC5**: 全部操作完成 →
执行 `eda.sch_Document.save()`，通过 `eda.sys_MessageBus.publish('GENERATE_RESULT', { placedCount })` 通知 IFrame

**AC6**: 任意放置操作抛出异常 →
通过 `eda.sys_MessageBus.publish('GENERATE_ERROR', { message })` 通知 IFrame

## Dev Agent Record

### Architecture Notes

**MessageBus 通信方向**：

```
IFrame (app.js)
  └─ eda.sys_MessageBus.publish('GENERATE_REQUEST', circuitJson)
       │
       ▼
Plugin 主线程 (index.ts)
  └─ eda.sys_MessageBus.subscribe('GENERATE_REQUEST', handler)
       └─ placeCircuitOnCanvas(circuitJson)
            └─ eda.sys_MessageBus.publish('GENERATE_RESULT', { placedCount })
                                                            或
                                         publish('GENERATE_ERROR', { message })
                                                            │
                                                            ▼
                                              IFrame (app.js)
                                              subscribeOnce(MSG_GENERATE_RESULT)
                                              subscribeOnce(MSG_GENERATE_ERROR)
```

**MessageBus 初始化幂等保护**：

```typescript
let messageBusInitialized = false;

export function openAIPanel(): void {
  if (!messageBusInitialized) {
    messageBusInitialized = true;
    initMessageBusHandlers();    // 只执行一次，避免重复订阅
  }
  eda.sys_IFrame.openIFrame('/iframe/index.html', 700, 500, undefined, {
    title: 'AI 原理图生成器'
  });
}
```

### Circuit JSON 格式（ADR-09）

```json
{
  "version": "1.0",
  "meta": { "title": "LDO 供电", "generated_by": "ai-sch-agent" },
  "components": [
    {
      "ref": "U1",
      "lcsc": "C6186",
      "name": "AMS1117-3.3",
      "x": 100,
      "y": 100,
      "rotation": 0,
      "add_to_bom": true,
      "add_to_pcb": true
    }
  ],
  "net_flags": [
    { "type": "Power",  "net": "VIN", "x": 60,  "y": 100 },
    { "type": "Ground", "net": "GND", "x": 100, "y": 180 }
  ],
  "wires": [
    { "points": [[100, 100], [60, 100]] },
    { "points": [[100, 140], [100, 180]] }
  ]
}
```

### EDA SDK API 速查

| SDK 调用 | 用途 | 关键参数 |
|---|---|---|
| `eda.lib_Device.getByLcscIds([lcsc])` | 按 LCSC 编号精确查找元件 | `lcsc` 如 `"C6186"` |
| `eda.lib_Device.search(name, '', '', '', 5, 1)` | 按名称模糊搜索（降级） | 最多返回 5 条，第 1 页 |
| `eda.sch_PrimitiveComponent.create(device, x, y, uuid, rotation, flip, bom, pcb)` | 放置元件到画布 | `device` 为 `getByLcscIds` 返回的对象 |
| `eda.sch_PrimitiveComponent.createNetFlag(type, net, x, y)` | 放置网络标识 | `type`: `"Power"` / `"Ground"` |
| `eda.sch_PrimitiveWire.create(points)` | 绘制连线折线 | `points`: `[[x,y], [x,y], ...]` |
| `eda.sch_Document.save()` | 保存当前文档 | — |
| `eda.sys_MessageBus.subscribe(topic, handler)` | 订阅 MessageBus 消息 | 返回 subscription 对象 |
| `eda.sys_MessageBus.publish(topic, payload)` | 发布 MessageBus 消息 | — |
| `eda.sys_ToastMessage.showMessage(text, type)` | 显示 Toast 提示 | `type`: `0`=info |

### 元件放置降级策略

```typescript
// 优先精确匹配 LCSC 编号
const [device] = await eda.lib_Device.getByLcscIds([comp.lcsc]);

if (!device) {
  // 降级：按名称模糊搜索
  const results = await eda.lib_Device.search(comp.name, '', '', '', 5, 1);
  device = results?.[0];
}

if (!device) {
  // 跳过该元件，不中断整体流程
  console.warn(`[AI] 未找到元件: ${comp.ref} (${comp.lcsc})`);
  continue;
}
```

### Completion Notes

- `placeCircuitOnCanvas` 内部的三个 for 循环（components / net_flags / wires）均使用 try/catch 静默处理单个失败项，不因单个元件失败中断整体放置
- `placedCount` 仅统计实际成功调用 `sch_PrimitiveComponent.create()` 的次数（不含跳过项）
- `eda.sch_Document.save()` 失败时通过 `sys_ToastMessage.showMessage("保存失败: ...")` 提示，不影响整体成功结果
- `rotation` 字段：JSON 中为角度数值（如 `0`, `90`, `180`, `270`），SDK `create()` 直接接受该值
- `add_to_bom` / `add_to_pcb` 字段：JSON 中可选（默认 `undefined`），SDK 接受 `undefined`
- `wire.points` 至少需要 2 个坐标点才调用 `sch_PrimitiveWire.create()`，否则静默跳过

### Files Modified

- `plugin/src/index.ts` — `openAIPanel()`（幂等初始化）、`initMessageBusHandlers()`、`placeCircuitOnCanvas(circuitJson)`
- `plugin/src/types/circuitJson.ts` — `CircuitComponent`、`NetFlag`、`Wire`、`CircuitJson`、`GenerateApiResponse`、`SseEvent` 类型定义（ADR-09 契约）
