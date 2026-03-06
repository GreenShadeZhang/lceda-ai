# Story 2.2: Token 安全存储与静默刷新

## Status: completed

## Story

As a 用户,
I want 登录成功后 token 自动保存到 EDA 安全存储，且在 token 即将过期时自动静默刷新，后续操作无需重复登录,
So that 我的会话在插件工作期间保持有效，不会中途失效。

## Tasks

- [x] 在 `plugin/iframe/app.js` 实现 `saveTokens()` — 使用 `eda.sys_Storage.setExtensionUserConfig()` 存储 access_token 和 refresh_token
- [x] 在 `plugin/iframe/app.js` 实现 `getStoredTokens()` — 初始化时读取并校验 JWT `exp` 字段
- [x] 在 `plugin/iframe/app.js` 实现 `doSilentRefresh()` — 使用 refresh_token 请求新 access_token，成功后更新存储
- [x] 在 `plugin/iframe/app.js` 实现 `clearStoredTokens()` — 清除 `eda.sys_Storage` 中的 token，IFrame 切回登录界面
- [x] 在 `plugin/iframe/app.js` 注册定时器（每 30 秒）检查 access_token 剩余有效期，不足 60 秒时触发静默刷新

## Storage Keys

- access_token: `ai_sch_access_token`
- refresh_token: `ai_sch_refresh_token`

## Dev Agent Record

### Completion Notes
- `eda.sys_Storage.setExtensionUserConfig / getExtensionUserConfig` 为 async API，需 await
- JWT 有效期检查：`JSON.parse(atob(token.split('.')[1])).exp * 1000 < Date.now() + 60000`
- 静默刷新失败（`invalid_grant` / 网络错误）时执行 `clearStoredTokens()` 并切换到登录界面
- **无需 `messageTypes.ts` 或主线程 postMessage 参与**，全部逻辑在 IFrame 内自洽完成
- `eda.sys_ToastMessage.showMessage("登录已过期，请重新登录")` 在刷新失败时调用

### Files Modified
- `plugin/iframe/app.js` — saveTokens / getStoredTokens / doSilentRefresh / clearStoredTokens / 定时检查
