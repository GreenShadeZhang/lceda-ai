# Story 2.3: 后端 JWT 验证中间件

## Status: in-progress

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
- JwtBearer 自动从 `{Authority}/.well-known/openid-configuration` 获取 JWKS
- `/api/health` 无 [Authorize] 属性，默认允许匿名访问
- `/api/auth/status` 添加 [Authorize] 属性，返回当前用户 sub claim

### Files Modified
- `backend/AiSchGeneratorApi/appsettings.json`
- `backend/AiSchGeneratorApi/Program.cs`
- `backend/AiSchGeneratorApi/Controllers/SchematicsController.cs` (新增)
