# Story 2.3: 后端 JWT 验证中间件

## Status: review

## Story

As a 后端服务,
I want 验证所有受保护 API 请求携带的 JWT token 有效性,
So that 只有已认证用户可以调用 AI 生成等受保护接口，未授权请求被拒绝。

## Tasks

- [x] 更新 `appsettings.json` — Keycloak Authority 改为线上地址，添加 ClientId
- [x] 更新 `Program.cs` — AddAuthentication + AddJwtBearer + UseAuthentication
- [x] 创建 `Controllers/SchematicsController.cs` — 受保护测试端点 GET /api/auth/status

## Keycloak Config

```json
{
  "Keycloak": {
    "Authority": "https://auth.verdure-hiro.cn/realms/maker-community",
    "ClientId": "lceda-ai",
    "Audience": "lceda-ai"
  }
}
```

## Dev Agent Record

### Completion Notes
- JwtBearer 自动从 `{Authority}/.well-known/openid-configuration` 获取 JWKS，无需手动配置公钥
- `/api/health` 无 `[Authorize]` 属性，默认允许匿名访问（AC: GET /api/health 免认证）
- `/api/auth/status` 添加 `[Authorize]` 属性，返回当前用户 `sub` 和 `preferred_username` claim
- 实际控制器路径为 `Api/Controllers/AuthController.cs`（非 story 任务中的草案路径 `Controllers/SchematicsController.cs`）
- 补充实现：Program.cs `OnChallenge` 事件处理器，无 token 时返回统一格式 `{"success":false,"error":{"code":"AUTH_REQUIRED","message":"..."}}` 满足 AC 响应体要求

### Files Modified
- `backend/AiSchGeneratorApi/appsettings.json`
- `backend/AiSchGeneratorApi/Program.cs`
- `backend/AiSchGeneratorApi/Api/Controllers/AuthController.cs` (新增)

## Change Log

- 2026-03-06: 补充 `JwtBearerEvents.OnChallenge` 处理器，返回符合 AC 要求的 JSON 401 响应体；修正 Files Modified 实际路径（AuthController）；Status → review
