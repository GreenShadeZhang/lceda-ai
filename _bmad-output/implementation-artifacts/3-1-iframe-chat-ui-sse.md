# Story 3.1: IFrame 对话 UI 与 SSE 流式响应展示

## Status: completed

## Story

As a 用户,
I want 在插件 IFrame 面板中输入电路需求并看到 AI 实时流式输出响应,
So that 我能直观感受 AI 正在处理我的请求，而不是等待黑屏。

## Tasks

- [x] 实现 `plugin/iframe/index.html` `#app-section` 聊天界面（消息气泡列表 + 输入框 + 发送按钮 + 状态栏 `#gen-status`）
- [x] 实现 `plugin/iframe/app.js` `setupAppEventListeners()` — 绑定生成按钮 click 及 Enter 键事件，防重入
- [x] 实现 `plugin/iframe/app.js` `sendGenerateRequest(userInput)` — 携带 `Authorization: Bearer {token}` 向后端发起 `POST /api/schematics/generate`，根据 Content-Type 路由 SSE 或 JSON 处理
- [x] 实现 `plugin/iframe/app.js` `handleSSEStream(body, bubbleEl)` — 使用 `response.body.getReader()` + `TextDecoder` 手动解析 SSE 数据流，实时追加气泡文字
- [x] 实现 `plugin/iframe/app.js` `handleJsonResponse(data, bubbleEl)` — 非 SSE 降级响应处理
- [x] 实现 `plugin/iframe/app.js` `notifyMainThreadToPlace(circuitJson, bubbleEl, prevText)` — 通过 `eda.sys_MessageBus.publish(MSG_GENERATE_REQUEST, circuitJson)` 将电路 JSON 传递给主线程
- [x] 实现 `plugin/iframe/app.js` `waitForPlacementResult(bubbleEl, prevText, compCount)` — `subscribeOnce(MSG_GENERATE_RESULT)` + `subscribeOnce(MSG_GENERATE_ERROR)` + 60 秒超时，更新气泡展示放置结果
- [x] 处理未登录防护：未登录点击生成显示提示并跳转登录界面
- [x] 处理 401 响应：清除 token + `showLoginUI()`
- [x] 处理网络错误：无法连接后端时显示友好提示信息

## Acceptance Criteria

**AC1**: 已登录用户输入内容点击"生成" →
IFrame 向后端 `POST /api/schematics/generate` 发送请求，携带 `Authorization: Bearer {token}` header

**AC2**: 后端开始 SSE 流式推送 →
IFrame 出现实时文字流式展示区域，`progress` 事件内容逐步追加显示到 AI 气泡

**AC3**: SSE `complete` 事件携带 `circuitJson` + 收到 `[DONE]` 终止标志 →
IFrame 通过 `eda.sys_MessageBus.publish('GENERATE_REQUEST', circuitJson)` 通知主线程，向主线程传递完整电路 JSON

**AC4**: SSE 返回 `error` 事件 →
气泡内显示错误文字，`eda.sys_ToastMessage.showMessage()` 展示用户友好提示

**AC5**: 未登录直接点击生成 →
IFrame 显示"请先登录"提示，跳转到登录界面

## Dev Agent Record

### Architecture Notes

**为什么不用 `EventSource`**：

`EventSource` API 不支持自定义请求头，无法携带 `Authorization: Bearer`。
本项目使用 `fetch` + `response.body.getReader()` 手动解析 SSE 数据流：
```javascript
const reader  = body.getReader();
const decoder = new TextDecoder();
let   buffer  = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop(); // 保留尾部不完整行等待下一帧
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    // ... JSON 解析 payload
  }
}
```

**为什么用 `eda.sys_MessageBus` 而非 `postMessage`**：

立创 EDA 插件 IFrame 环境中，主线程侧存在 CSP 限制，`window.parent.postMessage` 无法稳定工作。
`eda.sys_MessageBus.publish/subscribe/subscribeOnce` 是 EDA runtime 提供的跨桥通信机制，由平台保证 IFrame ↔ 主线程的消息传递。

**⚠️ Architecture 文档与实际实现的差异（重要）**：
- `architecture.md` ADR-05 描述的是旧 PKCE 授权流程（callback.html + postMessage + sessionStorage code_verifier），**已废弃**，以 [2-1-iframe-pkce-login.md](2-1-iframe-pkce-login.md) 为准
- `architecture.md` 第 6 节"IFrame 与主线程通信机制"描述的是 `window.parent.postMessage`，**实际使用 `eda.sys_MessageBus`**

### Key Constants (`plugin/iframe/app.js` lines 1-60)

```javascript
const BACKEND_API           = 'http://localhost:5000'; // ⚠️ 生产前需修改为实际后端地址
const MSG_GENERATE_REQUEST  = 'GENERATE_REQUEST';      // IFrame → 主线程（传递 circuitJson）
const MSG_GENERATE_RESULT   = 'GENERATE_RESULT';       // 主线程 → IFrame（返回 placedCount）
const MSG_GENERATE_ERROR    = 'GENERATE_ERROR';        // 主线程 → IFrame（返回 message）
```

### SSE 事件协议（ADR-06）

后端向 `POST /api/schematics/generate` 响应 `Content-Type: text/event-stream`，数据格式：

| `type` 字段 | 完整 SSE 行示例 | 说明 |
|---|---|---|
| `progress` | `data: {"type":"progress","text":"正在解析元件需求..."}` | 流式文字，追加到气泡 |
| `complete`  | `data: {"type":"complete","circuitJson":{...}}` | 完整电路 JSON，触发放置流程 |
| `error`     | `data: {"type":"error","message":"LLM 解析失败"}` | 业务错误 |
| `[DONE]`   | `data: [DONE]` | 流结束标志（字面量字符串） |

非 SSE 降级（`Content-Type: application/json`）：
```json
{
  "success": true,
  "data": { "circuitJson": { ... } }
}
```

### 函数调用链

```
用户点击"生成"
  └─ setupAppEventListeners() [app.js ~310]
       └─ handleGenerate(userInput) [app.js ~325]
            └─ sendGenerateRequest(userInput) [app.js ~415]
                 ├─ fetch POST /api/schematics/generate
                 ├─ [SSE] handleSSEStream(body, bubbleEl) [app.js ~470]
                 │    └─ notifyMainThreadToPlace(circuitJson, bubbleEl, text) [app.js ~545]
                 │         ├─ eda.sys_MessageBus.publish(MSG_GENERATE_REQUEST, circuitJson)
                 │         └─ waitForPlacementResult(bubbleEl, text, count) [app.js ~560]
                 │              ├─ subscribeOnce(MSG_GENERATE_RESULT) → 更新气泡 ✅
                 │              ├─ subscribeOnce(MSG_GENERATE_ERROR) → 显示错误 ⚠️
                 │              └─ setTimeout(60s) → 超时错误
                 └─ [JSON] handleJsonResponse(data, bubbleEl) [app.js ~530]
                      └─ notifyMainThreadToPlace(...)
```

### 函数速查表

| 函数 | app.js 位置 | 说明 |
|---|---|---|
| `appendUserMessage(text)` | ~350 | 在聊天区添加用户气泡 |
| `appendAiMessageElement()` | ~355 | 创建空 AI 气泡 DOM 元素，返回引用 |
| `updateBubble(el, text, isError)` | ~360 | 更新气泡内容；`isError=true` 时样式变红 |
| `setGenStatus(msg)` | ~400 | 更新底部状态栏文字 |
| `setGeneratingState(bool)` | ~405 | 禁用/启用生成按钮，切换"生成中..."文字 |
| `sendGenerateRequest(input)` | ~415 | 完整生成请求入口 |
| `handleSSEStream(body, el)` | ~470 | ReadableStream SSE 解析 |
| `handleJsonResponse(data, el)` | ~530 | 非 SSE 降级 |
| `notifyMainThreadToPlace(...)` | ~545 | MessageBus publish + 等待结果 |
| `waitForPlacementResult(...)` | ~560 | subscribeOnce 双向 + 超时 |

### Completion Notes

- `fetch` 请求携带 `Accept: text/event-stream` header；后端应根据此字段决定响应格式
- SSE buffer 策略：`buffer += decoder.decode(value, {stream: true})`，按 `\n` 分割，`lines.pop()` 保留尾部不完整行
- `SyntaxError` 在解析器中被静默忽略（非 JSON 的 SSE 注释行等），其他 Error 重新抛出
- `subscribeOnce` 的返回值（subscription 对象）保存到 `resultTask/errorTask`，触发后调用 `cleanup()` 取消，防止重复触发
- `generateTaskCleanup` 全局变量：登出或 UI 切换时可调用以清理正在进行的生成任务
- 网络错误检测：检查 `e.message` 含 `'Failed to fetch'` / `'NetworkError'` / `'net::'` 字符串特征 → 友好提示"无法连接到后端服务（http://localhost:5000）"
- **后端尚未实现时的预期行为**：点击生成约 5 秒后网络超时，气泡显示连接失败提示

### Files Modified

- `plugin/iframe/index.html` — `#app-section` 完整聊天 UI（`chat-header` + `chat-messages` + `input-area` + `#gen-status` 状态栏）及配套 CSS
- `plugin/iframe/app.js` — 生成流程完整实现（generate state 管理、SSE 解析、MessageBus 通知、结果等待）

### Backend Dependency

Story 3.1 **插件侧已全部完成**，端到端验证依赖以下后续 Stories：

| Story | 内容 | 状态 |
|---|---|---|
| [3.2](3-2-backend-circuit-parser-agent.md) | 后端 CircuitParserAgent + LLM 电路解析 | 🟡 ready-for-dev |
| [3.3](3-3-component-search-tool.md) | ComponentSearchTool 立创库元件搜索 | 🟡 ready-for-dev |
| [3.4](3-4-eda-sdk-placement.md) | Plugin 主线程 EDA SDK 放置器件 | ✅ 已实现 |
| [3.5](3-5-ldo-e2e-validation.md) | LDO 端到端联调验证（POC 验收） | ❌ 待后端 |
