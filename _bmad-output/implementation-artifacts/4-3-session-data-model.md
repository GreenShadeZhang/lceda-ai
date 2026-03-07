# Story 4.3: 会话数据模型扩展

Status: done

## Story

As a 系统,
I want 在数据库中引入 `schematic_sessions` 会话表，并将 `schematic_histories` 通过外键关联到会话,
so that 用户的每次对话可被分组为同一会话，后续支持会话维度的消息查询与多轮上下文记忆。

## Acceptance Criteria

**AC1**：`schematic_sessions` 表结构正确
- **Given** 执行 EF Core 迁移
- **When** `dotnet ef database update`
- **Then** 数据库存在 `schematic_sessions` 表，含 `id`（UUID PK）、`user_id`（text，索引 `idx_schematic_sessions_user_id`）、`title`（text）、`created_at`、`updated_at`，列名全为 `snake_case`

**AC2**：`schematic_histories` 新增 session_id FK
- **Given** 迁移执行完成
- **When** 检查 `schematic_histories` 表结构
- **Then** 存在 `session_id`（UUID nullable，FK → `schematic_sessions.id`，`ON DELETE SET NULL`），索引 `idx_schematic_histories_session_id`

**AC3**：EF Core 实体关系正确
- **Given** EF Core 实体 `SchematicSession` 和 `SchematicHistory`
- **When** 检查关系配置
- **Then** `SchematicSession` 有导航属性 `ICollection<SchematicHistory> Histories`，`SchematicHistory` 有可空 `Session?`，ORM 映射正确

**AC4**：现有功能不受影响
- **Given** `dotnet build` 执行
- **When** 迁移文件生成后编译
- **Then** 0 错误，Story 4.1/4.2 生成与查询功能行为不变

## Tasks / Subtasks

### Task 1：实体模型（AC3）— ✅ 已在 Story 4.1 完成

- [x] `backend/AiSchGeneratorApi/Models/SchematicSession.cs` 已创建：
  - `Id`（Guid PK）、`UserId`（string）、`Title`（string）
  - `CreatedAt`（DateTime）、`UpdatedAt`（DateTime）
  - `Histories`（`ICollection<SchematicHistory>`）

- [x] `backend/AiSchGeneratorApi/Models/SchematicHistory.cs` 已添加：
  - `SessionId`（`Guid?`）
  - `Session`（`SchematicSession?`）

### Task 2：AppDbContext 配置（AC3）— ✅ 已在 Story 4.1 完成

- [x] `AppDbContext` 已添加 `DbSet<SchematicSession> SchematicSessions`
- [x] `OnModelCreating` 已配置 FK（`SetNull`）、两个索引（`idx_schematic_histories_user_id`、`idx_schematic_histories_session_id`）
- [x] `OnModelCreating` 已配置 `idx_schematic_sessions_user_id`

### Task 3：EF Core 迁移（AC1、AC2）— ✅ 已在 Story 4.1 完成

- [x] 迁移文件 `20260306123143_AddSchematicSessions.cs` 已生成并执行：
  - 新建 `schematic_sessions` 表
  - 向 `schematic_histories` 添加 `session_id` 列
  - 添加 FK `fk_schematic_histories_schematic_sessions_session_id`（`ON DELETE SET NULL`）
  - 添加三个索引

### Task 4：验证（AC4）

- [x] `dotnet build` — 0 错误 ✅（已在 Story 4.2 Task 6 验证）

## Dev Notes

### 实现说明

本 Story 的所有数据库层工作已作为 Story 4.1「原理图生成历史写入」的一部分提前实现：

- **原因**：Story 4.1 在实现 `SchematicHistory` 写入时，已同步创建了 `SchematicSession` 实体和关联迁移，以便 `SchematicHistory.SessionId` 外键引用合法目标表。
- **结果**：`schematic_sessions` 表和 `session_id` FK 在数据库中均已就绪。

**关键文件（无需修改）：**
- `Models/SchematicSession.cs` — 完整实体
- `Models/SchematicHistory.cs` — 含 `SessionId?` 和 `Session?`
- `Infrastructure/Data/AppDbContext.cs` — 完整 ORM 配置
- `Migrations/20260306123143_AddSchematicSessions.cs` — 已执行迁移

**注意事项（Story 4.4 开发参考）：**
- 实际表名为 `schematic_sessions`（非 `sessions`），由 `UseSnakeCaseNamingConvention()` + EF Core 复数规范自动生成
- `POST /api/schematics/generate` 的 `GenerateRequest` 已包含 `SessionId?` 参数
- `TrySaveHistoryAsync` 已将 `SessionId` 写入 `schematic_histories`，但**尚未更新** `sessions.updated_at` 或自动设置 `title`——这是 Story 4.4 的任务

## Dev Agent Record

- **实现 Agent**：（Story 4.1 实现，本 Story 为归档确认）
- **完成时间**：2026-03-06
- **说明**：所有代码已在 Story 4.1 commit `8a6a39e` 中提交，本文件作为 Sprint 4.3 的正式归档
