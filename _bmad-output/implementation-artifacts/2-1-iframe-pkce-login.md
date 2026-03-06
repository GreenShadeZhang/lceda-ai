# Story 2.1: IFrame 设备码登录（Device Authorization Grant）

## Status: completed

## Story

As a 用户,
I want 在插件 IFrame 面板中点击登录后看到 QR 码和设备码，在浏览器中完成授权后插件自动进入已登录状态,
So that 我无需在受限的 IFrame 环境内处理重定向，可通过手机扫码或在外部浏览器中安全完成登录。

## Tasks

- [x] 更新 `plugin/iframe/index.html`，添加 `#device-section`（QR 码 + 用户码 + 倒计时）和 `#app-section`（聊天 UI）
- [x] 实现 `plugin/iframe/app.js` — 设备码申请、QR 码渲染（`qrcode` npm 包）、轮询 token endpoint、超时重试
- [x] 更新 `plugin/build.js` — 将 `qrcode` npm 依赖内联打包进 IFrame bundle

## Keycloak Config

- Authority: `https://auth.verdure-hiro.cn/realms/maker-community`
- ClientId: `lceda-ai`
- Device auth endpoint: `{authority}/protocol/openid-connect/auth/device`
- Token endpoint: `{authority}/protocol/openid-connect/token`
- grant_type（设备码换 token）: `urn:ietf:params:oauth:grant-type:device_code`

## Dev Agent Record

### Completion Notes
- 设备码申请：POST `{authority}/protocol/openid-connect/auth/device`，body: `client_id=lceda-ai`
- 收到响应后用 `qrcode` 包将 `verification_uri_complete` 渲染为 canvas/img QR 码
- 轮询间隔：响应中 `interval` 字段（默认 5 秒），收到 `slow_down` 时 +5 秒
- 轮询时处理的错误码：`authorization_pending`（继续）、`slow_down`（增加间隔）、`expired_token`（停止，显示重试按钮）、`access_denied`（停止，显示失败提示）
- token 获取成功后直接存入 `eda.sys_Storage`，不使用 `postMessage` 或 `callback.html`
- 引导文字：展示可点击的 `verification_uri` 链接 + `user_code` 供无法扫码用户使用
- **不再需要 `callback.html`**（PKCE 遗留文件，已删除或不创建）

### Files Modified
- `plugin/iframe/index.html` — 新增 `#device-section` / `#app-section` UI 结构及 CSS
- `plugin/iframe/app.js` — 设备码授权完整实现（已替换 PKCE 版本）
- `plugin/build.js` — 添加 qrcode npm 依赖打包支持
