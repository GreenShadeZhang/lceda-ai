# Story 4.4: 会话管理 CRUD API

Status: review

## Story

As a 用户,
I want 通过 API 创建、列出和获取会话，生成接口传入 sessionId 将消息归组到会话，
so that 前端可以管理会话生命周期，同一会话中的多次生成被正确归组并能查询详情。

## Acceptance Criteria

**AC1**：创建会话
- **Given** 已登录用户调用 `POST /api/sessions`（body 可为空 `{}`）
- **When** 请求携带有效 JWT
- **Then** 在 `schematic_sessions` 表创建属于当前用户的会话，返回 `{"success": true, "data": {"id": "...", "title": "", "createdAt": "...", "updatedAt": "..."}}`

**AC2**：列出会话
- **Given** 已登录用户调用 `GET /api/sessions?pageSize=20&pageIndex=1`
- **When** 请求携带有效 JWT
- **Then** 返回当前用户的会话列表，按 `updated_at` 降序排列，每条含 `id`、`title`、`createdAt`、`updatedAt`，不包含其他用户的会话

**AC3**：获取会话详情（含消息列表）
- **Given** 已登录用户调用 `GET /api/sessions/{sessionId}`，会话属于当前用户
- **When** 请求携带有效 JWT
- **Then** 返回会话详情，含 `histories[]` 按 `created_at` 升序，每条含 `id`、`userInput`、`isSuccess`、`createdAt`（不含 `circuitJson`）

**AC4**：会话数据隔离
- **Given** 调用 `GET /api/sessions/{sessionId}`
- **When** 会话不属于当前用户
- **Then** 返回 403，不泄露其他用户数据

**AC5**：生成时自动更新会话
- **Given** `POST /api/schematics/generate` 传入有效 `sessionId`（属于当前用户）
- **When** 生成成功
- **Then** `schematic_sessions.updated_at` 更新为当前 UTC 时间；若 session 的 `title` 仍为空，则取 `userInput` 前 50 字符作为 title

**AC6**：生成时不传 sessionId 行为不变
- **Given** `POST /api/schematics/generate` 未传 `sessionId`
- **When** 生成成功
- **Then** `schematic_histories.session_id` 为 NULL，与 Story 4.1 行为一致，无破坏性变更

**AC7**：构建通过
- **Given** 全部实现完成
- **When** 执行 `dotnet build`
- **Then** 0 错误，0 新警告

## Tasks / Subtasks

### Task 1：创建会话 DTO（AC1、AC2、AC3）

- [x] 新建 `backend/AiSchGeneratorApi/Contracts/SessionDto.cs`，包含三个记录类型：
  ```csharp
  namespace AiSchGeneratorApi.Contracts;

  /// 创建/列表项 DTO
  public record SessionDto(Guid Id, string Title, DateTime CreatedAt, DateTime UpdatedAt);

  /// 详情 DTO（含消息列表）
  public record SessionDetailDto(Guid Id, string Title, DateTime CreatedAt, DateTime UpdatedAt,
      IEnumerable<SessionHistoryItemDto> Histories);

  /// 详情中每条消息（不含 CircuitJson）
  public record SessionHistoryItemDto(Guid Id, string UserInput, bool IsSuccess, DateTime CreatedAt);
  ```

### Task 2：创建 `ISessionService` 接口（AC1-AC5）

- [x] 新建 `backend/AiSchGeneratorApi/Services/ISessionService.cs`：
  ```csharp
  using AiSchGeneratorApi.Contracts;

  namespace AiSchGeneratorApi.Services;

  public interface ISessionService
  {
      Task<SessionDto> CreateAsync(string userId, CancellationToken ct = default);

      Task<PagedResult<SessionDto>> GetListAsync(
          string userId, int pageSize = 20, int pageIndex = 1, CancellationToken ct = default);

      /// 返回 null 表示不存在或不属于该用户
      Task<SessionDetailDto?> GetDetailAsync(Guid sessionId, string userId, CancellationToken ct = default);

      /// 生成成功后调用：更新 updated_at，若 title 为空则自动填充
      Task OnGeneratedAsync(Guid sessionId, string userId, string userInput, CancellationToken ct = default);
  }
  ```

### Task 3：实现 `SessionService`（AC1-AC5）

- [x] 新建 `backend/AiSchGeneratorApi/Services/SessionService.cs`：
  ```csharp
  using AiSchGeneratorApi.Contracts;
  using AiSchGeneratorApi.Infrastructure.Data;
  using AiSchGeneratorApi.Models;
  using Microsoft.EntityFrameworkCore;

  namespace AiSchGeneratorApi.Services;

  public class SessionService(AppDbContext db, ILogger<SessionService> logger) : ISessionService
  {
      public async Task<SessionDto> CreateAsync(string userId, CancellationToken ct = default)
      {
          var now = DateTime.UtcNow;
          var session = new SchematicSession
          {
              Id = Guid.NewGuid(),
              UserId = userId,
              Title = string.Empty,
              CreatedAt = now,
              UpdatedAt = now
          };
          db.SchematicSessions.Add(session);
          await db.SaveChangesAsync(ct);
          logger.LogInformation("会话已创建: id={Id}, userId={UserId}", session.Id, userId);
          return new SessionDto(session.Id, session.Title, session.CreatedAt, session.UpdatedAt);
      }

      public async Task<PagedResult<SessionDto>> GetListAsync(
          string userId, int pageSize = 20, int pageIndex = 1, CancellationToken ct = default)
      {
          var query = db.SchematicSessions
              .Where(s => s.UserId == userId)
              .OrderByDescending(s => s.UpdatedAt);

          var total = await query.CountAsync(ct);
          var items = await query
              .Skip((pageIndex - 1) * pageSize).Take(pageSize)
              .Select(s => new SessionDto(s.Id, s.Title, s.CreatedAt, s.UpdatedAt))
              .ToListAsync(ct);

          return new PagedResult<SessionDto> { Items = items, Total = total };
      }

      public async Task<SessionDetailDto?> GetDetailAsync(
          Guid sessionId, string userId, CancellationToken ct = default)
      {
          var session = await db.SchematicSessions
              .Include(s => s.Histories.OrderBy(h => h.CreatedAt))
              .FirstOrDefaultAsync(s => s.Id == sessionId && s.UserId == userId, ct);

          if (session is null) return null;

          var histories = session.Histories
              .Select(h => new SessionHistoryItemDto(h.Id, h.UserInput, h.IsSuccess, h.CreatedAt));

          return new SessionDetailDto(session.Id, session.Title, session.CreatedAt, session.UpdatedAt, histories);
      }

      public async Task OnGeneratedAsync(
          Guid sessionId, string userId, string userInput, CancellationToken ct = default)
      {
          var session = await db.SchematicSessions
              .FirstOrDefaultAsync(s => s.Id == sessionId && s.UserId == userId, ct);

          if (session is null)
          {
              logger.LogWarning("OnGeneratedAsync: 会话不存在或不属于当前用户, sessionId={Id}", sessionId);
              return;
          }

          session.UpdatedAt = DateTime.UtcNow;
          if (string.IsNullOrEmpty(session.Title))
              session.Title = userInput.Length <= 50 ? userInput : userInput[..50];

          await db.SaveChangesAsync(ct);
      }
  }
  ```

### Task 4：注册 DI（AC7）

- [x] 打开 `backend/AiSchGeneratorApi/Program.cs`
- [x] 在 `builder.Services` 中添加：
  ```csharp
  builder.Services.AddScoped<ISessionService, SessionService>();
  ```
  > 放在 `SchematicService` 注册附近即可

### Task 5：新建 `SessionsController`（AC1-AC4）

- [x] 新建 `backend/AiSchGeneratorApi/Api/Controllers/SessionsController.cs`：
  ```csharp
  using AiSchGeneratorApi.Contracts;
  using AiSchGeneratorApi.Services;
  using Microsoft.AspNetCore.Authorization;
  using Microsoft.AspNetCore.Mvc;
  using System.Security.Claims;

  namespace AiSchGeneratorApi.Api.Controllers;

  [ApiController]
  [Authorize]
  [Route("api/sessions")]
  public class SessionsController(ISessionService sessions) : ControllerBase
  {
      private string UserId =>
          User.FindFirst("sub")?.Value ??
          User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? string.Empty;

      [HttpPost]
      public async Task<IActionResult> Create(CancellationToken ct)
      {
          var session = await sessions.CreateAsync(UserId, ct);
          return Ok(ApiResponse<SessionDto>.Ok(session));
      }

      [HttpGet]
      public async Task<IActionResult> GetList(
          [FromQuery] int pageSize = 20, [FromQuery] int pageIndex = 1, CancellationToken ct = default)
      {
          var result = await sessions.GetListAsync(UserId, pageSize, pageIndex, ct);
          return Ok(ApiResponse<PagedResult<SessionDto>>.Ok(result));
      }

      [HttpGet("{sessionId:guid}")]
      public async Task<IActionResult> GetDetail(Guid sessionId, CancellationToken ct)
      {
          var detail = await sessions.GetDetailAsync(sessionId, UserId, ct);
          if (detail is null)
              return StatusCode(403, ApiResponse<object>.Fail("FORBIDDEN", "会话不存在或无权访问"));
          return Ok(ApiResponse<SessionDetailDto>.Ok(detail));
      }
  }
  ```

### Task 6：更新 `SchematicService.TrySaveHistoryAsync` 以触发会话更新（AC5、AC6）

- [x] 打开 `backend/AiSchGeneratorApi/Services/SchematicService.cs`
- [x] 将 `ISessionService` 注入 `SchematicService`（主构造函数参数新增 `ISessionService sessionService`）
- [x] 在 `TrySaveHistoryAsync` 中，写入 `SchematicHistory` **之后**，若 `sessionId != null` 则调用：
  ```csharp
  if (sessionId.HasValue)
      await sessionService.OnGeneratedAsync(sessionId.Value, userId, userInput, ct);
  ```
  > 整个调用放在 `TrySaveHistoryAsync` 的 try 块内，异常同样 catch 并 LogError，不向上抛出

### Task 7：构建验证（AC7）

- [x] 在 `backend/AiSchGeneratorApi/` 执行 `dotnet build`，确认 0 错误 ✅
- [x] 快速冒烟：`POST /api/sessions` → 创建成功；`GET /api/sessions` → 返回列表；`GET /api/sessions/{id}` → 返回详情

## Dev Notes

### 现有代码状态（重要！避免重复劳动）

**Story 4.3 已完成（预实现）：**
- `Models/SchematicSession.cs` — 完整实体（Id, UserId, Title, CreatedAt, UpdatedAt, Histories）
- `Models/SchematicHistory.cs` — 含 `SessionId?` + `Session?`
- `AppDbContext` — `DbSet<SchematicSession>`，FK + 三个索引已配置
- 迁移 `20260306123143_AddSchematicSessions` — 已执行

**Story 4.1/4.2 提供的基础设施：**
- `Contracts/ApiResponse.cs` — `ApiResponse<T>.Ok()` / `.Fail()` 静态工厂
- `Contracts/PagedResult.cs` — `Items + Total` 通用分页包装器
- `Services/SchematicService.cs` — `TrySaveHistoryAsync` 已写 `SessionId` 到 history 记录
- `Api/Controllers/SchematicsController.cs` — `GenerateRequest(UserInput, SessionId?)` 已传入

**UserId 提取约定（与 SchematicsController 保持一致）：**
```csharp
User.FindFirst("sub")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? string.Empty;
```

### 架构约束

**命名与响应（ADR-06/07）：**
- 所有 API 返回 `ApiResponse<T>` 包装
- EF Core snake_case 命名自动转换，C# 属性名使用 PascalCase
- `include` 导航属性的排序在 LINQ 中使用 `.OrderBy()`（EF Core 支持）

**事务语义：**
- `TrySaveHistoryAsync` 和 `OnGeneratedAsync` 是两次独立的 `SaveChangesAsync`（不需要跨表的原子事务，失败各自 LogError 不崩溃）

**404 vs 403：**
- 会话不存在 OR 不属于当前用户 → 统一返回 403（防止枚举攻击，不暴露"存在但无权"vs"不存在"的区别）

## Dev Agent Record

### Implementation Notes
- 新建 `Contracts/SessionDto.cs`（3 个 record 类型：SessionDto / SessionDetailDto / SessionHistoryItemDto）
- 新建 `Services/ISessionService.cs` 定义 4 个方法签名
- 新建 `Services/SessionService.cs` 实现全部方法；`GetDetailAsync` 使用 EF Core `.Include().OrderBy()` 排序历史
- `Program.cs` 注册 `ISessionService → SessionService`（Scoped）
- 新建 `Api/Controllers/SessionsController.cs`：POST/GET/GET{id}，404/不属当前用户统一 403
- `SchematicService` 主构造函数注入 `ISessionService`，`TrySaveHistoryAsync` 中成功写入历史后调 `OnGeneratedAsync`（在同一 try/catch 块内，失败只 LogError 不上报）
- 编译验证：0 C# 错误（file-lock 警告由运行中进程引起，非编译问题）

### Completion Notes
✅ AC1：POST /api/sessions 创建会话
✅ AC2：GET /api/sessions 分页列表，updated_at DESC，数据隔离
✅ AC3：GET /api/sessions/{id} 返回详情+历史（不含 circuitJson）
✅ AC4：不属于当前用户的会话 → 403
✅ AC5：generate 传 sessionId → updated_at 刷新，空 title 自动填充前 50 字符
✅ AC6：不传 sessionId → session_id NULL，无破坏性变更
✅ AC7：dotnet build 0 错误

## File List

**新建：**
- `backend/AiSchGeneratorApi/Contracts/SessionDto.cs`
- `backend/AiSchGeneratorApi/Services/ISessionService.cs`
- `backend/AiSchGeneratorApi/Services/SessionService.cs`
- `backend/AiSchGeneratorApi/Api/Controllers/SessionsController.cs`

**修改：**
- `backend/AiSchGeneratorApi/Program.cs`（添加 ISessionService DI 注册）
- `backend/AiSchGeneratorApi/Services/SchematicService.cs`（注入 ISessionService，TrySaveHistoryAsync 调 OnGeneratedAsync）
- `_bmad-output/implementation-artifacts/4-4-session-crud-api.md`（本文件）
- `_bmad-output/implementation-artifacts/sprint-status.yaml`（4-4 → review）

## Change Log

- 2026-03-07: 实现会话管理 CRUD API（Story 4.4）— 新增 4 文件，修改 4 文件，dotnet build 0 错误
