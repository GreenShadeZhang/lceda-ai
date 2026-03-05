# Story 2.2: 主线程 Token 接收与安全存储

## Status: in-progress

## Story

As a 用户,
I want 登录成功后 token 自动保存到 EDA 安全存储，后续操作无需重复登录,
So that 我的会话在插件工作期间保持有效，不会中途失效。

## Tasks

- [x] 在 `messageTypes.ts` 添加 REQUEST_AUTH_STATUS 消息类型
- [x] 更新 `index.ts` 处理 AUTH_SUCCESS — 存储 token 到 eda.sys_Storage
- [x] 更新 `index.ts` 处理 REQUEST_AUTH_STATUS — 读取 token 后 postMessage AUTH_TOKEN_SYNC
- [x] 更新 `index.ts` 处理 AUTH_FAILURE — 调用 eda.sys_ToastMessage 提示登录过期
- [x] 更新 `index.ts` 处理 AUTH_TOKEN_SYNC — 更新 eda.sys_Storage 中的 token（静默刷新回写）

## Dev Agent Record

### Completion Notes
- eda.sys_Storage 为 async API，需 await
- AUTH_TOKEN_SYNC 既用于"主→iframe 同步"也处理"iframe 静默刷新后回写"
- AUTH_FAILURE 在 error=session_expired 时清除存储并弹 Toast

### Files Modified
- `plugin/src/messageTypes.ts` — 新增 REQUEST_AUTH_STATUS
- `plugin/src/index.ts` — 完善 AUTH_SUCCESS/AUTH_FAILURE/REQUEST_AUTH_STATUS/AUTH_TOKEN_SYNC 处理
