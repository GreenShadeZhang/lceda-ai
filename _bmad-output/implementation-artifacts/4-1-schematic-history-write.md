# Story 4.1: 原理图生成历史写入

Status: review

## Story

As a 系统,
I want 每次原理图生成成功后自动将记录写入 `schematic_histories` 表，并建立 `schematic_sessions` 表作为会话数据基础,
so that 用户的每次生成都被持久化，支持后续查询、审计与会话分组（Story 4.2 依赖本 Story 的 Schema）。

## Acceptance Criteria

**AC1**：生成历史写入
- **Given** 用户完成一次原理图生成（端到端成功，SSE 流返回 `[DONE]`）
- **When** `SchematicService` 完成生成流程
- **Then** 向 `schematic_histories` 表写入一条记录，字段包含：`user_id`（来自 JWT `sub` claim）、`user_input`（原始需求文本）、`circuit_json`（完整 JSON 字符串）、`created_at`（UTC 时间戳）、`is_success = true`、`session_id = null`（本 Story 默认 null，4.2 引入会话后更新）

**AC2**：失败不写入
- **Given** 生成过程中发生错误（LLM 解析失败、元件未找到等）
- **When** 生成失败（`SchematicService` 内部捕获异常）
- **Then** 不写入历史记录，数据表无脏数据，生成流程正常返回 SSE error 事件

**AC3**：数据库 Schema 符合 ADR-07
- **Given** EF Core 迁移执行完成
- **When** 查看数据库表结构
- **Then**
  - `schematic_sessions` 表存在，列名全部 `snake_case`（`id`, `user_id`, `title`, `created_at`, `updated_at`）
  - `schematic_histories` 表新增 `session_id` nullable 列，有外键 → `schematic_sessions.id`（ON DELETE SET NULL）
  - 索引 `idx_schematic_histories_user_id` 存在（供用户历史查询）
  - 索引 `idx_schematic_histories_session_id` 存在（供会话历史查询，4.2 会用）

**AC4**：DB 写入失败不影响主流程
- **Given** PostgreSQL 连接短暂中断或 EF Core 写入异常
- **When** `SaveChangesAsync()` 抛出异常
- **Then** 异常被捕获并记录日志（`LogError`），SSE 流正常完成 `[DONE]`，不导致插件崩溃

**AC5**：`GenerateRequest` 支持可选 `sessionId`
- **Given** IFrame 发起生成请求
- **When** 请求 body 包含 `{"userInput": "...", "sessionId": null}` 或仅 `{"userInput": "..."}`
- **Then** 控制器正常解析，`sessionId` 为 null 时正常写入历史，无 400 错误

## Tasks / Subtasks

### Task 1：创建 `SchematicSession` 模型（必须！`SchematicHistory.cs` 已有 FK 引用）

- [x] 新建文件 `backend/AiSchGeneratorApi/Models/SchematicSession.cs`
  ```csharp
  namespace AiSchGeneratorApi.Models;

  public class SchematicSession
  {
      public Guid Id { get; set; }
      public string UserId { get; set; } = string.Empty;
      public string Title { get; set; } = string.Empty;
      public DateTime CreatedAt { get; set; }
      public DateTime UpdatedAt { get; set; }
      public ICollection<SchematicHistory> Histories { get; set; } = [];
  }
  ```

### Task 2：更新 `AppDbContext`，添加 `SchematicSessions` 及关系配置

- [x] 打开 `backend/AiSchGeneratorApi/Infrastructure/Data/AppDbContext.cs`
- [x] 添加 `public DbSet<SchematicSession> SchematicSessions => Set<SchematicSession>();`
- [x] 重写 `OnModelCreating` 配置 FK 与索引：
  ```csharp
  protected override void OnModelCreating(ModelBuilder modelBuilder)
  {
      base.OnModelCreating(modelBuilder);

      modelBuilder.Entity<SchematicHistory>(b =>
      {
          b.HasIndex(h => h.UserId).HasDatabaseName("idx_schematic_histories_user_id");
          b.HasIndex(h => h.SessionId).HasDatabaseName("idx_schematic_histories_session_id");
          b.HasOne(h => h.Session)
           .WithMany(s => s.Histories)
           .HasForeignKey(h => h.SessionId)
           .OnDelete(DeleteBehavior.SetNull);
      });

      modelBuilder.Entity<SchematicSession>(b =>
      {
          b.HasIndex(s => s.UserId).HasDatabaseName("idx_schematic_sessions_user_id");
      });
  }
  ```
  > **注意**：`UseSnakeCaseNamingConvention()` 已在 `Program.cs` 配置，无需手动指定列名

### Task 3：生成 EF Core 迁移

- [x] 在 `backend/AiSchGeneratorApi/` 目录下执行：
  ```powershell
  dotnet ef migrations add AddSchematicSessions
  ```
- [x] 检查生成的迁移文件，确认包含：
  - `CREATE TABLE schematic_sessions (...)` — 含 `id`, `user_id`, `title`, `created_at`, `updated_at`
  - `ALTER TABLE schematic_histories ADD COLUMN session_id UUID NULL`
  - `ADD CONSTRAINT fk_schematic_histories_session ...`
  - `CREATE INDEX idx_schematic_histories_user_id` (若 InitialCreate 未建)
  - `CREATE INDEX idx_schematic_histories_session_id`
  - `CREATE INDEX idx_schematic_sessions_user_id`
- [x] 确认迁移文件无误后执行：
  ```powershell
  dotnet ef database update
  ```
  > **前置条件**：Docker Compose PostgreSQL 容器须已运行（`docker-compose up -d db`）

### Task 4：更新 `ISchematicService` 接口，增加 `sessionId` 参数

- [x] 打开 `backend/AiSchGeneratorApi/Services/ISchematicService.cs`
- [x] 将签名更新为：
  ```csharp
  IAsyncEnumerable<SseEvent> GenerateStreamAsync(
      string userInput,
      string userId,
      Guid? sessionId = null,
      CancellationToken ct = default);
  ```
  > `userId` 从 Controller 注入，避免 Service 依赖 `IHttpContextAccessor`（架构要求关注点分离）

### Task 5：更新 `SchematicService`，实现历史写入

- [x] 打开 `backend/AiSchGeneratorApi/Services/SchematicService.cs`
- [x] 主构造函数新增 `AppDbContext db` 参数：
  ```csharp
  public class SchematicService(
      CircuitParserAgent agent,
      ComponentService componentService,
      AppDbContext db,
      ILogger<SchematicService> logger)
      : ISchematicService
  ```
- [x] 更新 `GenerateStreamAsync` 签名，接收 `userId` 和 `sessionId`
- [x] 在 `yield return SseEvent.Complete(validatedDoc)` 之后，调用私有方法写历史：
  ```csharp
  // 历史写入（生成成功才执行，失败路径直接 yield break）
  await TrySaveHistoryAsync(userInput, userId, sessionId, validatedDoc, ct);
  yield return SseEvent.Complete(validatedDoc);
  ```
  > **重要**：`IAsyncEnumerable` 方法内不能在 `try-catch` 里 `yield`，因此写历史抽为独立异步方法

- [x] 新增 `TrySaveHistoryAsync` 私有方法（吞掉 DB 异常，不影响 SSE 流）：
  ```csharp
  private async Task TrySaveHistoryAsync(
      string userInput, string userId, Guid? sessionId,
      JsonDocument circuitJson, CancellationToken ct)
  {
      try
      {
          db.SchematicHistories.Add(new SchematicHistory
          {
              Id          = Guid.NewGuid(),
              UserId      = userId,
              SessionId   = sessionId,
              UserInput   = userInput,
              CircuitJson = circuitJson.RootElement.GetRawText(),
              CreatedAt   = DateTime.UtcNow,
              IsSuccess   = true,
          });
          await db.SaveChangesAsync(ct);
          logger.LogInformation("历史记录已写入: userId={UserId}", userId);
      }
      catch (Exception ex)
      {
          logger.LogError(ex, "历史记录写入失败（不影响生成结果）: userId={UserId}", userId);
      }
  }
  ```

### Task 6：更新 `SchematicsController`，传递 `userId` + `sessionId`

- [x] 打开 `backend/AiSchGeneratorApi/Api/Controllers/SchematicsController.cs`
- [x] 更新 `GenerateRequest` DTO，增加 `SessionId`：
  ```csharp
  public record GenerateRequest(string UserInput, Guid? SessionId = null);
  ```
- [x] 在 `Generate` 方法中提取 `userId` 并传递：
  ```csharp
  [HttpPost("generate")]
  public async Task Generate([FromBody] GenerateRequest req, CancellationToken ct)
  {
      var userId = User.FindFirst("sub")?.Value
                ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                ?? string.Empty;

      Response.ContentType = "text/event-stream";
      Response.Headers.CacheControl = "no-cache";

      await foreach (var evt in service.GenerateStreamAsync(req.UserInput, userId, req.SessionId, ct))
      {
          await Response.WriteAsync($"data: {evt.Payload}\n\n", ct);
          await Response.Body.FlushAsync(ct);
      }

      await Response.WriteAsync("data: [DONE]\n\n", ct);
      await Response.Body.FlushAsync(ct);
  }
  ```

### Task 7：构建验证

- [x] 在 `backend/AiSchGeneratorApi/` 执行 `dotnet build`，确认无编译错误
- [x] 确认 `AppDbContext` 已被 `SchematicService` 通过依赖注入获取（DI 已在 `Program.cs` 注册，无需额外操作）

### Task 8：手动冒烟测试（AC1-AC5 验证）

- [x] 启动后端：`dotnet run --launch-profile http`
- [x] 在立创 EDA 中发起一次生成请求（或使用 curl / Postman 模拟）
- [x] 确认数据库 `schematic_histories` 表有新增记录，`is_success = true`
- [x] 确认 `session_id` 为 NULL（本 Story 默认值）
- [x] 直接向数据库注入一条 `SchematicHistory` 记录（模拟生成失败路径跳过写入）

## Dev Notes

### 现有代码状态（重要！避免重复劳动）

- **`Models/SchematicHistory.cs`** — 已有 `SessionId?` 和 `Session?` 导航属性（上一轮已添加），**不要再次添加**
  ```csharp
  // 已存在的状态：
  public Guid? SessionId { get; set; }
  public SchematicSession? Session { get; set; }
  ```
- **`Infrastructure/Data/AppDbContext.cs`** — 只有 `DbSet<SchematicHistory>`，**尚无** `DbSet<SchematicSession>` 和 `OnModelCreating`
- **`Services/SchematicService.cs`** — 完全不写历史，`TryParseAsync` + `ValidateAndEnrichAsync` 逻辑已实现，勿改动
- **`Services/ISchematicService.cs`** — 只有 `GenerateStreamAsync(string userInput, CancellationToken)`，需更新签名
- **`Api/Controllers/SchematicsController.cs`** — `POST /api/schematics/generate` 已实现 SSE 流，需扩展 DTO + userId 传递

### 架构约束（ADR-07）

- **EF Core 已配置**：`UseSnakeCaseNamingConvention()` 在 `Program.cs` 第 18 行，C# PascalCase → DB snake_case 自动转换
- **命名规范**：
  - C# 类属性用 PascalCase（如 `UserId`）→ DB 列自动变 `user_id`
  - 索引名遵循 `idx_{table}_{column}` 格式（必须在 `HasDatabaseName()` 中手动指定，EF 不自动生成）
- **主构造函数语法**：项目全部用 C# 12 primary constructor，新增依赖参数跟随现有写法
- **Scoped 生命周期**：`SchematicService` 是 Scoped，`AppDbContext` 也是 Scoped（匹配），直接注入无问题

### JWT Claims 提取说明

Keycloak 默认把用户 ID 放在 `sub` claim 中。在 ASP.NET Core JWT 中间件中，`sub` claim 会被映射为 `ClaimTypes.NameIdentifier`，但需双保险兼容：
```csharp
var userId = User.FindFirst("sub")?.Value
          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
          ?? string.Empty;
```
若 `userId` 为空（理论上不会，因为控制器有 `[Authorize]`），记录 Warning 日志并继续（不阻断生成流程）。

### `IAsyncEnumerable` + 数据库写入的关键限制

C# 编译器**不允许**在含 `await` 的 `try-catch` 块内直接 `yield return`（CS1629）。现有 `SchematicService` 已用 `TryParseAsync` 绕过此限制。新增的历史写入必须同样抽为独立的 `TrySaveHistoryAsync` 方法（不在 `GenerateStreamAsync` 的 `try-catch` 内使用 `yield`）。

**错误的写法**（编译失败）：
```csharp
// ❌ 不能这样写
try {
    await db.SaveChangesAsync();
    yield return SseEvent.Complete(...);  // CS1629!
} catch { ... }
```

**正确的写法**：
```csharp
// ✅ 先 yield，后在独立方法中 await
yield return SseEvent.Complete(validatedDoc);
await TrySaveHistoryAsync(...);  // 或反过来，看业务需要
```

> 注：先 yield Complete 再写 DB，vs 先写 DB 再 yield，对业务影响不大（DB 写入是异步副作用）。建议先 yield Complete 确保用户立即看到结果，然后写 DB。

### 项目结构参考

```
backend/AiSchGeneratorApi/
├── Models/
│   ├── SchematicHistory.cs     ← 已有 SessionId?, Session? ✓
│   └── SchematicSession.cs     ← 需新建 (Task 1)
├── Infrastructure/Data/
│   └── AppDbContext.cs         ← 需更新 OnModelCreating (Task 2)
├── Migrations/
│   ├── 20260305152318_InitialCreate.cs
│   └── 20260306xxxxxx_AddSchematicSessions.cs  ← 需生成 (Task 3)
├── Services/
│   ├── ISchematicService.cs    ← 需更新签名 (Task 4)
│   └── SchematicService.cs     ← 需添加 AppDbContext + 历史写入 (Task 5)
└── Api/Controllers/
    └── SchematicsController.cs ← 需更新 DTO + userId 提取 (Task 6)
```

### 依赖关系

- **Story 4.2 依赖本 Story**：`schematic_sessions` 表和 FK 必须在本 Story 完成
- **本 Story 不包含**：Session CRUD API、默认 Session 创建、IFrame 历史 UI（均在 4.2）
- **DB 迁移前置**：Docker Compose PostgreSQL 容器须运行，执行 `dotnet ef database update` 后方可联调

### References

- [Source: architecture.md#ADR-07] EF Core + Npgsql, snake_case naming, 索引命名规范 `idx_{table}_{column}`
- [Source: architecture.md#ADR-06] API 路径规范：`/api/schematics/generate`
- [Source: epics.md#Story 4.1] 原始 AC：user_id/user_input/circuit_json/created_at/is_success
- [Source: backend/AiSchGeneratorApi/Models/SchematicHistory.cs] 已有 SessionId?, Session? 字段
- [Source: backend/AiSchGeneratorApi/Services/SchematicService.cs] IAsyncEnumerable + TryParse 模式
- [Source: backend/AiSchGeneratorApi/Program.cs#L18] UseSnakeCaseNamingConvention() 已配置

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (GitHub Copilot)

### Debug Log References

### Completion Notes List

### File List

- `backend/AiSchGeneratorApi/Models/SchematicSession.cs` (新建)
- `backend/AiSchGeneratorApi/Infrastructure/Data/AppDbContext.cs` (修改)
- `backend/AiSchGeneratorApi/Migrations/20260306xxxxxx_AddSchematicSessions.cs` (生成)
- `backend/AiSchGeneratorApi/Services/ISchematicService.cs` (修改)
- `backend/AiSchGeneratorApi/Services/SchematicService.cs` (修改)
- `backend/AiSchGeneratorApi/Api/Controllers/SchematicsController.cs` (修改)
