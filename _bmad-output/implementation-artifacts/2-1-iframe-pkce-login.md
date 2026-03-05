# Story 2.1: IFrame OIDC PKCE 登录页面与回调处理

## Status: in-progress

## Story

As a 用户,
I want 在插件 IFrame 面板中点击登录后跳转到 Keycloak 登录页，完成登录后自动回到插件界面,
So that 我可以通过标准浏览器登录流程授权插件使用我的账号。

## Tasks

- [x] 更新 `plugin/iframe/index.html`，添加 login-section 和 app-section
- [x] 实现 `plugin/iframe/app.js` — PKCE 授权 URL 构建、登录发起、AUTH_TOKEN_SYNC 接收
- [x] 创建 `plugin/iframe/callback.html` — 接收code、换取token、postMessage AUTH_SUCCESS

## Keycloak Config

- Authority: `https://auth.verdure-hiro.cn/realms/maker-community`
- ClientId: `lceda-ai`
- Auth endpoint: `{authority}/protocol/openid-connect/auth`
- Token endpoint: `{authority}/protocol/openid-connect/token`
- REDIRECT_URI: 动态从 `window.location` 构建（与 Keycloak 客户端配置须一致）

## Dev Agent Record

### Completion Notes
- REDIRECT_URI 动态构建：`new URL('callback.html', window.location.href).toString()`
- PKCE code_verifier 存入 iframe `sessionStorage`（临时，callback.html 取用后清除）
- callback.html 换取 token 后 postMessage 再跳回 index.html
- app.js 加载时 postMessage `REQUEST_AUTH_STATUS` 向主线程请求已存 token

### Files Modified
- `plugin/iframe/index.html` — 更新 UI 结构
- `plugin/iframe/app.js` — PKCE 完整实现
- `plugin/iframe/callback.html` — 新增 OIDC 回调处理
