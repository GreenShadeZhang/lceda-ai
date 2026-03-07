# Story 4.2: 历史记录查询 API 与 IFrame 展示

Status: ready-for-dev

## Story

As a 用户,
I want 在插件 IFrame 中查看我过去生成的原理图记录列表,
so that 我可以了解历史生成情况，后续扩展时支持重新加载历史原理图。

## Acceptance Criteria

**AC1**：分页查询 API
- **Given** 已登录用户调用 `GET /api/schematics?pageSize=10&pageIndex=1`
- **When** 请求携带有效 JWT
- **Then** 返回 `{"success": true, "data": {"items": [...], "total": N}}`，仅包含当前用户（`user_id` 来自 JWT `sub` claim）的历史记录，按 `created_at` 降序排列

**AC2**：空列表不返回 404
- **Given** 用户无历史记录
- **When** 调用查询接口
- **Then** 返回 `{"success": true, "data": {"items": [], "total": 0}}`，不返回 404

**AC3**：IFrame 历史面板
- **Given** IFrame 对话面板中有"历史"入口
- **When** 用户点击"历史"
- **Then** 展示最近 10 条历史记录列表，每条显示 `user_input` 文本和 `created_at` 时间（本地化格式）

**AC4**：分页与数据隔离
- **Given** 分页参数 `pageSize=5&pageIndex=2`
- **When** 调用 `GET /api/schematics?pageSize=5&pageIndex=2`
- **Then** 正确返回第 2 页数据（跳过前 5 条），不返回其他用户的记录

## Tasks / Subtasks

### Task 1：创建响应 DTO（AC1）

- [ ] 新建 `backend/AiSchGeneratorApi/Contracts/PagedResult.cs`：
  ```csharp
  namespace AiSchGeneratorApi.Contracts;

  public class PagedResult<T>
  {
      public IEnumerable<T> Items { get; init; } = [];
      public int Total { get; init; }
  }
  ```
- [ ] 新建 `backend/AiSchGeneratorApi/Contracts/SchematicHistoryDto.cs`：
  ```csharp
  namespace AiSchGeneratorApi.Contracts;

  public record SchematicHistoryDto(
      Guid Id,
      string UserInput,
      DateTime CreatedAt,
      bool IsSuccess
  );
  ```
  > 列表接口**不返回** `CircuitJson`（字段大，对列表展示无用），若后续需要详情接口再单独开 `GET /api/schematics/{id}`

### Task 2：扩展 `ISchematicService` 接口（AC1）

- [ ] 打开 `backend/AiSchGeneratorApi/Services/ISchematicService.cs`
- [ ] 新增方法签名：
  ```csharp
  Task<PagedResult<SchematicHistoryDto>> GetHistoriesAsync(
      string userId,
      int pageSize = 10,
      int pageIndex = 1,
      CancellationToken ct = default);
  ```
  > 注意 `using AiSchGeneratorApi.Contracts;` 引入

### Task 3：在 `SchematicService` 中实现查询（AC1、AC2、AC4）

- [ ] 打开 `backend/AiSchGeneratorApi/Services/SchematicService.cs`
- [ ] 实现 `GetHistoriesAsync`：
  ```csharp
  public async Task<PagedResult<SchematicHistoryDto>> GetHistoriesAsync(
      string userId, int pageSize = 10, int pageIndex = 1, CancellationToken ct = default)
  {
      var query = db.SchematicHistories
          .Where(h => h.UserId == userId)
          .OrderByDescending(h => h.CreatedAt);

      var total = await query.CountAsync(ct);

      var items = await query
          .Skip((pageIndex - 1) * pageSize)
          .Take(pageSize)
          .Select(h => new SchematicHistoryDto(h.Id, h.UserInput, h.CreatedAt, h.IsSuccess))
          .ToListAsync(ct);

      return new PagedResult<SchematicHistoryDto> { Items = items, Total = total };
  }
  ```
  > `CountAsync`、`ToListAsync` 来自 `Microsoft.EntityFrameworkCore`（已引用，无需新增 NuGet 包）

### Task 4：新增 `GET /api/schematics` 端点（AC1-AC4）

- [ ] 打开 `backend/AiSchGeneratorApi/Api/Controllers/SchematicsController.cs`
- [ ] 新增 GET 端点（放在 `Generate` 方法之后）：
  ```csharp
  [HttpGet]
  public async Task<IActionResult> GetHistories(
      [FromQuery] int pageSize = 10,
      [FromQuery] int pageIndex = 1,
      CancellationToken ct = default)
  {
      var userId = User.FindFirst("sub")?.Value
                ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? string.Empty;

      var result = await service.GetHistoriesAsync(userId, pageSize, pageIndex, ct);
      return Ok(ApiResponse<PagedResult<SchematicHistoryDto>>.Ok(result));
  }
  ```
  > 注意 `SchematicsController` 已注入 `ISchematicService service`（primary constructor），直接调用即可
  > 需添加 `using AiSchGeneratorApi.Contracts;`

### Task 5：IFrame 历史面板（AC3）

- [ ] 打开 `plugin/iframe/app.js`
- [ ] 在主界面底部或侧边增加"历史"按钮（HTML 元素追加）
- [ ] 实现 `loadHistory()` 函数：
  ```js
  async function loadHistory() {
    const token = await getToken(); // 复用已有 token 读取函数
    const resp = await fetch(`${API_BASE}/api/schematics?pageSize=10&pageIndex=1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await resp.json();
    if (!json.success) { showError(json.error?.message); return; }
    renderHistoryList(json.data.items);
  }

  function renderHistoryList(items) {
    const container = document.getElementById('history-list');
    if (!items.length) {
      container.innerHTML = '<p class="empty">暂无历史记录</p>';
      return;
    }
    container.innerHTML = items.map(item => `
      <div class="history-item">
        <span class="history-input">${escapeHtml(item.userInput)}</span>
        <span class="history-time">${formatDate(item.createdAt)}</span>
      </div>
    `).join('');
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }
  ```
- [ ] 在 HTML 中添加对应的 `<div id="history-list">` 容器和"历史"按钮
- [ ] 确保 `API_BASE` 常量已在 `app.js` 中定义（复用 Story 3.1 已有值）

### Task 6：构建验证

- [ ] 后端：在 `backend/AiSchGeneratorApi/` 执行 `dotnet build`，确认 0 错误、0 警告
- [ ] 前端：在 `plugin/` 执行 `npm run build`，确认无 TypeScript/ESBuild 错误

### Task 7：冒烟测试（AC1-AC4 验证）

- [ ] 启动后端（`dotnet run --launch-profile http`），Docker PostgreSQL 已运行
- [ ] 执行 `GET /api/schematics?pageSize=10&pageIndex=1`（携带有效 JWT），确认：
  - 响应格式为 `{"success": true, "data": {"items": [...], "total": N}}`
  - 仅返回当前用户的记录
  - 按 `created_at` 降序排列
- [ ] 用不同 userId 的 token 调用，确认无数据交叉
- [ ] 无历史记录的用户调用，确认返回 `{"items": [], "total": 0}` 而非 404
- [ ] 测试分页：`pageIndex=2&pageSize=3`，结果与预期一致

## Dev Notes

### 现有代码状态（重要！避免重复劳动）

**Story 4.1 已完成的工作：**
- `Models/SchematicHistory.cs` — 已有全部字段：`Id`, `UserId`, `SessionId?`, `UserInput`, `CircuitJson`, `CreatedAt`, `IsSuccess`, `Session?`
- `Models/SchematicSession.cs` — 已创建
- `Infrastructure/Data/AppDbContext.cs` — 已有 `DbSet<SchematicHistory>` + `DbSet<SchematicSession>`，已配置 `OnConfiguring`（suppress EF Core 10 warning）和 `OnModelCreating`（3 个索引 + FK）
- `Services/SchematicService.cs` — 构造函数已有 `AppDbContext db` 参数，可直接使用
- `Services/ISchematicService.cs` — 已有 `GenerateStreamAsync(string userInput, string userId, Guid? sessionId = null, CancellationToken ct = default)`
- `Api/Controllers/SchematicsController.cs` — 已有 `POST /api/schematics/generate` + userId 提取逻辑，`[Authorize]` 已加在类级别

**不要重复添加的内容：**
- 不要再次修改 `AppDbContext.OnConfiguring`（已有 warning 抑制）
- 不要改变 `GenerateStreamAsync` 签名
- 不要修改 `SchematicHistory` 或 `SchematicSession` 模型（无需新迁移）

### 架构约束

**命名规范（ADR-07）：**
- C# PascalCase → DB snake_case 自动转换（`UseSnakeCaseNamingConvention()` 已在 `Program.cs` 配置）
- 查询无需手动指定列名，直接使用 C# 属性

**响应格式（ADR-06 / Contracts）：**
- 所有 API 均返回 `ApiResponse<T>`：`{"success": true/false, "data": {...}, "error": {...}}`
- `ApiResponse<T>.Ok(data)` 静态工厂已在 `Contracts/ApiResponse.cs` 定义，直接调用
- 控制器返回 `Ok(ApiResponse<...>.Ok(result))` 即可（200 + JSON）

**分页约定：**
- `pageIndex` 从 1 开始（1-based），`Skip((pageIndex - 1) * pageSize)`
- `pageSize` 默认 10，无硬上限（业务上合理即可，POC 阶段不加 MaxPageSize 限制）

**EF Core 查询注意事项：**
- `db.SchematicHistories` 是 `Scoped` DbContext，线程安全（每个请求独立实例）
- `CountAsync` 和查询分两次执行（两条 SQL），对 POC 数据量可接受
- 若未来需要优化，可改为单次 `SELECT COUNT(*) OVER()` 窗口函数，当前不需要

**userId 提取（与 Story 4.1 完全一致）：**
```csharp
var userId = User.FindFirst("sub")?.Value
          ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
          ?? string.Empty;
```

**IFrame 注意事项：**
- `API_BASE` 常量应已在 `app.js` 中存在（Story 3.1 实现），复用即可
- `getToken()` 函数已在 Story 2.x 实现，直接调用
- `escapeHtml()` 若不存在需新建（防 XSS）：
  ```js
  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  ```

### 项目结构——本 Story 新增/修改文件

```
backend/AiSchGeneratorApi/
├── Contracts/
│   ├── ApiResponse.cs              ← 已有，不改
│   ├── ApiError.cs                 ← 已有，不改
│   ├── PagedResult.cs              ← 【新建 Task 1】
│   └── SchematicHistoryDto.cs      ← 【新建 Task 1】
├── Services/
│   ├── ISchematicService.cs        ← 【修改 Task 2】新增 GetHistoriesAsync
│   └── SchematicService.cs         ← 【修改 Task 3】实现 GetHistoriesAsync
└── Api/Controllers/
    └── SchematicsController.cs     ← 【修改 Task 4】新增 GET 端点

plugin/
└── iframe/
    └── app.js                      ← 【修改 Task 5】新增历史面板
```

### 依赖关系

- 本 Story 依赖 Story 4.1（`schematic_histories` 表已存在、`AppDbContext.SchematicHistories` 已注册）
- 无新 EF Core 迁移（仅查询已有表）
- 无新 NuGet 包（所有依赖已安装）

### Story 4.1 关键约定延续

- **主构造函数语法**：`public class SchematicService(AppDbContext db, ..., ILogger<SchematicService> logger)`，Task 3 实现直接使用已有 `db`
- **EF Core 10 Breaking Change**：`PendingModelChangesWarning` 已在 `AppDbContext.OnConfiguring` 中永久抑制，新查询方法无需任何额外处理

### References

- Story 4.1: [_bmad-output/implementation-artifacts/4-1-schematic-history-write.md](_bmad-output/implementation-artifacts/4-1-schematic-history-write.md)
- Architecture ADR-07（EF Core + Npgsql）: [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md#ADR-07)
- Architecture ADR-06（REST + ApiResponse Wrapper）: [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md#ADR-06)
- Epics Story 4.2: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-5

### Debug Log References

### Completion Notes List

### File List
