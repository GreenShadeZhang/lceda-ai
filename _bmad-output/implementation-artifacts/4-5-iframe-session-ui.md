# Story 4.5: IFrame 会话列表 UI 与智能响应渲染

**Status**: review

## Context

**Epic 4**: 会话与历史管理
**Feature**: FR-09（会话分组管理）+ FR-10（SSE 事件类型区分）
**依赖**: Story 4.4 Session CRUD API（commit `ab61282`）

## Goal

在 IFrame 插件中添加「会话」标签页，展示用户会话列表并支持切换/新建会话；同时扩展 SSE
处理逻辑，支持现代协议中的 `eventType` 字段以区分文字回复和原理图回复。

## Acceptance Criteria

1. 插件初始化后自动调用 `GET /api/sessions?pageSize=20&pageIndex=1`，自动选中最新会话并将其历史消息渲染到聊天区域
2. 「会话」标签页展示会话列表，点击切换后调用 `GET /api/sessions/{id}` 加载历史消息，高亮选中项
3. 「新建对话」按钮调用 `POST /api/sessions`，新条目追加到列表顶部并自动选中，聊天区域清空
4. `POST /api/schematics/generate` 请求体携带 `sessionId`（有选中会话时）
5. SSE `eventType: "text"` → 文字追加聊天气泡，不触发 EDA SDK
6. SSE `eventType: "schematic"` → 触发 `notifyMainThreadToPlace`（EDA SDK 渲染）
7. 无 `eventType` 字段时（旧协议）维持原有行为（向后兼容）
8. `npm run build` 0 错误

## Implementation Notes

- 历史消息：`GET /api/sessions/{id}` 返回 `histories[]`，只有 `userInput` + `isSuccess`（无 AI 文本），AI 消息框显示成功/失败状态
- 会话面板采用与 `#history-panel` 相同的 `.visible` 切换模式
- `escapeHtml` / `appendUserMessage` / `appendAiMessageElement` 已存在，直接复用
- 后端 `eventType` 由 Story 5.1 添加；Story 4.5 完成前端处理逻辑，Story 5.1 后无缝生效

## Files Changed

- `plugin/iframe/app.js` — 会话状态变量、会话面板函数、`sendGenerateRequest`、`handleSSEStream`
- `plugin/iframe/index.html` — 「会话」Tab、`#session-panel`、`#session-indicator-bar`、CSS
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 4.5 → review

## Dev Log

- Story 4.5 created, implementation in progress
