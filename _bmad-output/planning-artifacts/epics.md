---
stepsCompleted: [1, 2, 3, 4]
status: 'complete'
completedAt: '2026-03-05'
inputDocuments:
  - product-brief-ai-eda-schematic-generator-2026-03-05.md
  - architecture.md
project: ai-eda-schematic-generator
date: '2026-03-05'
---

# ai-eda-schematic-generator - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for **AI EDA 原理图生成器**，decomposing the requirements from the Product Brief and Architecture into implementable stories.

---

## Requirements Inventory

### Functional Requirements

| ID | 需求描述 | 来源 |
|----|----------|------|
| FR-01 | 用户通过插件对话面板输入自然语言电路需求，无需了解元件型号 | Product Brief / Architecture |
| FR-02 | AI 解析用户需求，映射到对应电路方案，并匹配立创官方库元件（型号、引脚、封装） | Product Brief / Architecture |
| FR-03 | 自动在立创 EDA 原理图画布上放置器件并连线，生成可编辑的原理图文件 | Architecture |
| FR-04 | 生成的所有元件必须来自立创 EDA 官方库，关键元件在立创商城有实际库存 | Product Brief / Architecture |
| FR-05 | 支持基础网络标识（GND、VCC 等电源符号）的放置 | Architecture |
| FR-06 | 原理图生成完成后自动保存文档 | Architecture |
| FR-07 | 用户需通过 OIDC 登录（Keycloak）后才能使用 AI 生成功能 | Architecture (ADR-05) |
| FR-08 | AI 生成的原理图历史记录需持久化存储，用户可查询 | Architecture (ADR-04/ADR-07) |
| FR-09 | 用户的对话按「会话」分组管理，支持创建新会话、列出历史会话、在同一会话内关联多轮消息 | 用户需求 v2 |
| FR-10 | AI 普通文字回复直接追加到聊天气泡，仅当后端返回原理图结构化数据时前端才触发 EDA SDK 渲染，两种响应类型通过 SSE 事件类型区分 | 用户需求 v2 |

---

### Non-Functional Requirements

| ID | 需求描述 | 来源 |
|----|----------|------|
| NFR-01 | 安全性：LLM API 调用必须通过 IFrame 发起，插件主线程不能直接发起外部 HTTP 请求 | Architecture |
| NFR-02 | 安全性：用户 Token 只能存储在 `eda.sys_Storage`，不得使用 `localStorage`（跨 IFrame 安全隔离） | Architecture (ADR-05) |
| NFR-03 | 可靠性：元件放置失败时，必须通过 `sys_ToastMessage` 给出明确错误提示，不得静默失败 | Architecture |
| NFR-04 | 元件一致性：所有放置元件的 UUID 必须来自立创官方综合库（`ELIB_SymbolType` 官方符号），放置前通过 `lib_Device.getByLcscIds()` 验证 | Architecture |
| NFR-05 | POC 范围限定：仅支持立创 EDA 专业版（V2/V3），不考虑其他 EDA 工具 | Product Brief |
| NFR-06 | 质量红线：生成的元件在立创商城无法找到 → 不合格，引脚连接明显错误（短路等）→ 不合格 | Product Brief |
| NFR-07 | 可维护性：后端遵循 Clean Architecture 分层（Api/Services/Agents/Tools/Infrastructure），代码可测试 | Architecture |
| NFR-08 | 本地开发：通过 Docker Compose 一键启动完整开发环境（API + PostgreSQL + Keycloak + Redis 可选） | Architecture (ADR-08) |

---

### Additional Requirements

**来自 Architecture 的技术要求：**

- **启动模板**：插件侧使用官方 `pro-api-sdk`（TypeScript + ESBuild），生成 `.eext` 扩展包
- **后端框架**：ASP.NET Core (.NET 10) + Microsoft Agent Framework .NET
- **认证流程**：Keycloak 设备码授权（RFC 8628 Device Authorization Grant），IFrame 向 `/protocol/openid-connect/auth/device` 申请 `device_code`，展示 QR 码 + `user_code`，用户在浏览器完成授权后 IFrame 轮询获取 token，直接存储到 `eda.sys_Storage`，无需 `callback.html` 或 `postMessage`
- **IFrame↔主线程通信**：`eda.sys_MessageBus.publish/subscribe/subscribeOnce`，消息主题常量：`GENERATE_REQUEST`、`GENERATE_RESULT`、`GENERATE_ERROR`
- **API 风格**：REST + SSE（流式 LLM 输出），统一 `ApiResponse<T>` Wrapper
- **ORM**：EF Core + Npgsql，Code-First 迁移，`UseSnakeCaseNamingConvention()`
- **错误处理**：后端 ProblemDetails RFC 7807，前端 `sys_ToastMessage`，Agent 失败重试 1 次
- **第一实现优先级**：Plugin 基础能力优先，UI 迭代后续

**来自 Product Brief 的范围约束：**

- **首个 POC 场景**：LDO 电源模块（5V → AMS1117-3.3 → 3.3V，3~5 个元件）
- **MVP 核心路径**：自然语言输入 → AI 解析 → 原理图生成（单次会话，不含多轮修改）
- **明确 Out-of-Scope**：多 EDA 工具支持、PCB Layout、复杂电路（DDR/RF/高速）、DRC 自动修复

---

### FR Coverage Map

| FR | 所属 Epic | 说明 |
|----|-----------|------|
| FR-01 | Epic 3 | IFrame 自然语言输入 |
| FR-02 | Epic 3 | CircuitParserAgent + ComponentSearchTool |
| FR-03 | Epic 3 | schematicGenerator.ts EDA SDK 放置 |
| FR-04 | Epic 3 | componentValidator.ts 官方库验证 |
| FR-05 | Epic 3 | createNetFlag() 网络标识 |
| FR-06 | Epic 3 | eda.sch_Document.save() |
| FR-07 | Epic 2 | Keycloak 设备码登录（RFC 8628） |
| FR-08 | Epic 4 | SchematicHistory 持久化 |
| FR-09 | Epic 4 (4.3/4.4/4.5) | 会话分组管理 —— sessions 表 + 会话 CRUD API + IFrame 会话列表 UI |
| FR-10 | Epic 4 (4.5) / Epic 5 (5.1) | SSE 事件类型区分（text / schematic），智能渲染控制 |

---

## Epic List

### Epic 1: 项目脚手架与本地开发环境

**目标：** 开发者可在本地一键启动完整开发栈，并将插件成功加载到立创 EDA 中运行。

**覆盖需求：** NFR-07、NFR-08，架构技术附加需求（启动模板、Docker Compose、EF Core）

---

### Epic 2: 用户认证 — Keycloak 设备码登录

**目标：** 用户可在立创 EDA 插件 IFrame 内完成 Keycloak 设备码授权（RFC 8628）登录，IFrame 展示 QR 码供用户扫码授权，获取 JWT token 直接存储到 `eda.sys_Storage`，后端 API 能通过 JWKS 验证 token 有效性。

**覆盖需求：** FR-07、NFR-01、NFR-02

---

### Epic 3: AI 原理图生成核心能力（POC 核心）

**目标：** 用户输入自然语言（如"5V 转 3.3V 供电模块"），AI 自动在立创 EDA 画布生成包含真实官方库元件的完整原理图并保存。

**覆盖需求：** FR-01、FR-02、FR-03、FR-04、FR-05、FR-06、NFR-03、NFR-04、NFR-05、NFR-06

---

### Epic 4: 会话管理与生成历史持久化

**目标：** 用户的每次生成记录都被持久化存储，对话按会话分组，用户可查看历史会话列表、在同一会话内关联多轮消息，AI 普通文字回复与原理图结构数据走不同渲染路径。

**覆盖需求：** FR-08、FR-09、FR-10（部分）

---

## Epic 1: 项目脚手架与本地开发环境

开发者能够在本地一键启动完整开发栈（插件 + 后端 + PostgreSQL + Keycloak），并将插件成功加载到立创 EDA 中执行基础操作，验证项目骨架可用。

### Story 1.1: 搭建 EDA 插件项目结构与构建工具链

As a 开发者,
I want 搭建符合架构规范的立创 EDA 插件项目骨架（TypeScript + ESBuild + extension.json）,
So that 我可以在本地构建并将插件加载到立创 EDA 中运行，验证工具链可用。

**Acceptance Criteria:**

**Given** 开发者已安装 Node.js ≥ 20.5.0
**When** 执行 `npm install && npm run build`
**Then** 生成 `build/dist/*.eext` 文件，无构建错误

**Given** 生成的 `.eext` 文件
**When** 在立创 EDA 专业版中导入该扩展
**Then** 插件菜单项出现在 EDA 界面中，点击后无报错

**Given** `plugin/src/messageTypes.ts` 中定义的消息常量
**When** 运行 TypeScript 编译
**Then** 所有消息类型常量编译通过，无类型错误

**Given** `plugin/src/index.ts` 主线程入口
**When** 插件加载后点击菜单
**Then** 控制台输出初始化日志，IFrame 面板可打开（空白即可）

---

### Story 1.2: 搭建后端 ASP.NET Core 项目结构

As a 开发者,
I want 搭建符合架构规范的 ASP.NET Core (.NET 10) 后端项目（Clean Architecture 分层），
So that 后端能启动并通过健康检查接口验证基础配置正确。

**Acceptance Criteria:**

**Given** 已安装 .NET 10 SDK
**When** 执行 `dotnet run` 启动后端项目
**Then** 服务在配置端口启动，`GET /api/health` 返回 `{"success": true, "data": "healthy"}`

**Given** 后端项目结构
**When** 审查目录
**Then** 包含 `Api/`、`Services/`、`Agents/`、`Tools/`、`Infrastructure/`、`Models/`、`Contracts/` 分层目录，符合 ADR-01 架构规范

**Given** `Contracts/ApiResponse.cs` 统一响应 Wrapper
**When** 调用任意 API 端点
**Then** 响应格式为 `{"success": true/false, "data": {...}}` 或 `{"success": false, "error": {"code": "...", "message": "..."}}`

**Given** `appsettings.json` 配置
**When** 项目启动
**Then** 读取 Keycloak Authority、OpenAI endpoint 等配置项，无启动异常

---

### Story 1.3: 配置 Docker Compose 本地开发环境

As a 开发者,
I want 通过 `docker-compose up` 一键启动 PostgreSQL + Keycloak（+ 可选 Redis）开发环境,
So that 本地开发无需手动安装数据库和认证服务，团队成员可快速启动一致的环境。

**Acceptance Criteria:**

**Given** 已安装 Docker Desktop
**When** 执行 `docker-compose up -d`
**Then** PostgreSQL 容器在配置端口启动并健康，Keycloak 容器在配置端口启动并可访问管理界面

**Given** Docker Compose 配置
**When** 执行 `docker-compose --profile cache up -d`
**Then** Redis 容器额外启动，基础服务不受影响

**Given** `.env.example` 文件
**When** 开发者复制为 `.env` 并填入真实值
**Then** Docker Compose 正确读取环境变量（数据库密码、Keycloak admin 密码等），服务正常启动

**Given** 后端服务
**When** 使用 Docker Compose 提供的 PostgreSQL 连接字符串配置后启动
**Then** 后端能成功连接数据库，`GET /api/health` 返回 healthy

---

### Story 1.4: EF Core 初始数据库迁移与连接验证

As a 开发者,
I want 执行 EF Core Code-First 初始迁移创建基础数据库结构,
So that 数据库 `schematic_histories` 表存在并符合 snake_case 命名规范，后端可正常读写。

**Acceptance Criteria:**

**Given** Docker Compose PostgreSQL 服务已启动
**When** 执行 `dotnet ef migrations add InitialCreate && dotnet ef database update`
**Then** 迁移成功执行，数据库中出现 `schematic_histories` 表，列名为 `snake_case`（如 `user_id`、`created_at`、`circuit_json`）

**Given** `AppDbContext.cs` 配置了 `UseSnakeCaseNamingConvention()`
**When** 检查数据库表结构
**Then** 所有列名为 `snake_case`，表名为复数 `snake_case`，符合 ADR-07 规范

**Given** 后端启动时
**When** 应用启动
**Then** EF Core 能成功连接 PostgreSQL，无连接异常日志

---

## Epic 2: 用户认证 — Keycloak 设备码登录

用户可在立创 EDA 插件 IFrame 内完成 Keycloak 设备码授权（RFC 8628 Device Authorization Grant）登录，IFrame 展示 QR 码和用户码供用户在外部浏览器扫码授权，IFrame 轮询获取 token 后直接存储到 `eda.sys_Storage`，无需 `callback.html` 或 `postMessage` 中转，后端 API 能通过 JWKS 验证 token 有效性，受保护接口正常工作。

### Story 2.1: IFrame 设备码登录（Device Authorization Grant）

As a 用户,
I want 在插件 IFrame 面板中点击登录后看到 QR 码和设备码，在浏览器中完成授权后插件自动进入已登录状态,
So that 我无需在受限的 IFrame 环境内处理重定向，可通过手机扫码或在外部浏览器中安全完成登录。

**Acceptance Criteria:**

**Given** 用户打开插件 IFrame 面板且未登录
**When** 点击"登录"按钮
**Then** IFrame 向 Keycloak `/protocol/openid-connect/auth/device` 发起 POST 请求（携带 `client_id=lceda-ai`），收到含 `device_code`、`user_code`、`verification_uri`、`verification_uri_complete`、`expires_in` 的响应

**Given** 收到设备码响应
**When** IFrame 渲染登录引导界面
**Then** 界面同时展示：① QR 码图片（`verification_uri_complete` 编码，使用 `qrcode` npm 包生成并内联渲染）；② 文字用户码（如 `ABCD-1234`）；③ 可点击的验证 URL；④ 剩余有效时间倒计时

**Given** 登录引导界面展示后
**When** IFrame 轮询 Keycloak token endpoint（`grant_type=urn:ietf:params:oauth:grant-type:device_code`）
**Then** 收到 `authorization_pending` 时继续轮询（间隔 `interval` 秒，默认 5 秒）；收到 `slow_down` 时增加 5 秒间隔；收到 `access_token` 时停止轮询并进入已登录状态

**Given** 用户在外部浏览器完成账号密码授权
**When** 轮询收到成功响应（含 `access_token` 和 `refresh_token`）
**Then** IFrame 将 token 直接存储到 `eda.sys_Storage`，不使用 postMessage 或 callback.html 中转，界面切换到已登录的主应用界面

**Given** 设备码超过 `expires_in` 时间仍未授权
**When** 轮询收到 `expired_token` 或 `access_denied` 错误
**Then** 停止轮询，展示"二维码已过期，请点击重试"按钮，用户点击后重新触发设备码申请流程

---

### Story 2.2: Token 安全存储与静默刷新

As a 用户,
I want 登录成功后 token 自动保存到 EDA 安全存储，且在 token 即将过期时自动静默刷新，后续操作无需重复登录,
So that 我的会话在插件工作期间保持有效，不会中途失效。

**Acceptance Criteria:**

**Given** 设备码轮询成功获得 `access_token` 和 `refresh_token`
**When** IFrame 存储 token
**Then** 使用 `eda.sys_Storage.setExtensionUserConfig()` 将 token 存入 EDA 安全存储（key: `ai_sch_access_token`、`ai_sch_refresh_token`），不使用 `localStorage`

**Given** Token 已存储
**When** 用户关闭并重新打开插件面板
**Then** IFrame 初始化时调用 `eda.sys_Storage.getExtensionUserConfig()` 读取 token，通过解析 JWT payload 校验 `exp` 字段；若 access_token 有效则直接进入已登录状态，无需重新登录

**Given** access_token 即将过期（距 `exp` 不足 60 秒）
**When** IFrame 定时器检测到过期临近（每 30 秒检查一次）
**Then** IFrame 使用 `refresh_token` 向 Keycloak token endpoint 发起静默刷新请求，成功后直接更新 `eda.sys_Storage` 中的 token，不需要主线程介入

**Given** refresh_token 也已过期或刷新请求返回 `invalid_grant`
**When** 刷新失败
**Then** 清除 `eda.sys_Storage` 中的所有 token，IFrame 切换到登录界面，`sys_ToastMessage` 提示"登录已过期，请重新登录"

---

### Story 2.3: 后端 JWT 验证中间件

As a 后端服务,
I want 验证所有受保护 API 请求携带的 JWT token 有效性,
So that 只有已认证用户可以调用 AI 生成等受保护接口，未授权请求被拒绝。

**Acceptance Criteria:**

**Given** 请求携带有效的 Keycloak JWT Bearer token
**When** 调用受保护的 API 端点（如 `POST /api/schematics/generate`）
**Then** 请求通过验证，正常处理并返回 200 响应

**Given** 请求未携带 Authorization header
**When** 调用受保护的 API 端点
**Then** 返回 401 状态码，响应体 `{"success": false, "error": {"code": "AUTH_REQUIRED", "message": "..."}}`

**Given** 请求携带过期或签名无效的 JWT
**When** 调用受保护的 API 端点
**Then** 返回 401 状态码

**Given** JWT 验证中间件配置
**When** 服务启动
**Then** 自动从 Keycloak JWKS endpoint（`{keycloak_authority}/.well-known/openid-configuration`）获取公钥，无需手动配置公钥

**Given** `GET /api/health` 端点
**When** 无 token 调用
**Then** 返回 200（健康检查接口免认证）

---

## Epic 3: AI 原理图生成核心能力

用户在插件 IFrame 中输入自然语言电路需求，AI 解析并生成包含真实立创官方库元件的电路 JSON，插件侧调用 EDA SDK 在画布上放置器件、连线、添加网络标识并保存，完成从文字到原理图的完整端到端流程。

### Story 3.1: IFrame 对话 UI 与 SSE 流式响应展示

As a 用户,
I want 在插件 IFrame 面板中输入电路需求并看到 AI 实时流式输出响应,
So that 我能直观感受 AI 正在处理我的请求，而不是等待黑屏。

**Acceptance Criteria:**

**Given** 用户已登录，IFrame 面板已打开
**When** 用户在输入框中输入需求文字并点击"生成"
**Then** IFrame 向后端 `POST /api/schematics/generate` 发送请求，携带 `Authorization: Bearer {token}` header

**Given** 后端开始 LLM 流式处理
**When** SSE 数据流开始返回
**Then** IFrame 中出现实时文字流式展示区域，内容随 SSE 事件逐步追加显示

**Given** 后端完成处理并返回最终电路 JSON
**When** SSE 流结束（收到 `[DONE]` 事件）
**Then** IFrame 通过 `eda.sys_MessageBus.publish('GENERATE_REQUEST', circuitJson)` 向主线程发送消息，payload 包含完整的 `circuitJson`

**Given** 后端返回错误（如 LLM 解析失败）
**When** SSE 返回 error 事件
**Then** IFrame 显示错误提示文字，`sys_ToastMessage` 显示对应错误码的用户友好提示

**Given** 用户未登录直接点击生成
**When** 请求发出
**Then** IFrame 显示"请先登录"提示，跳转到登录界面

---

### Story 3.2: 后端 CircuitParserAgent 与 LLM 电路解析

As a 后端 AI 服务,
I want 使用 Microsoft Agent Framework 调用 OpenAI 兼容 LLM 将用户需求解析为符合 ADR-09 契约的电路 JSON,
So that 插件侧可以依据结构化 JSON 精确放置元件和连线。

**Acceptance Criteria:**

**Given** 收到 `POST /api/schematics/generate` 请求，body 包含 `{"userInput": "5V 转 3.3V LDO 供电模块"}`
**When** `SchematicController` 调用 `SchematicService` → `CircuitParserAgent`
**Then** Agent 调用 LLM，返回符合 ADR-09 电路 JSON 契约的结构（含 `components[]` 和 `wires[]`）

**Given** LLM 返回有效的电路 JSON
**When** Agent 输出结果
**Then** 通过 SSE 流式向客户端推送中间状态文本，最终推送完整 `circuitJson` 作为结束事件

**Given** LLM 返回无效 JSON 或解析失败
**When** 解析异常发生
**Then** Agent 重试 1 次，重试仍失败则返回 `{"success": false, "error": {"code": "LLM_PARSE_ERROR", "message": "..."}}`，记录原始 LLM 响应到后端日志

**Given** `appsettings.json` 中配置了 OpenAI endpoint 和 API Key
**When** Agent 调用 LLM
**Then** 使用 `Azure.AI.OpenAI` NuGet 包发起请求，endpoint 可通过配置切换（OpenAI / Azure OpenAI / 本地模型）

---

### Story 3.3: ComponentSearchTool 元件搜索与验证

As a AI Agent 工具,
I want 根据 LLM 生成的元件需求在立创官方库中搜索匹配元件并验证可用性,
So that 最终电路 JSON 中的元件 UUID 全部来自立创官方库，保证可放置性。

**Acceptance Criteria:**

**Given** Agent 需要查找"AMS1117-3.3 LDO 稳压器"元件
**When** `ComponentSearchTool` 被调用
**Then** 工具通过立创 EDA 官方库 API 搜索并返回匹配元件列表，包含元件 UUID、引脚信息、LCSC 编号

**Given** 搜索返回多个候选元件
**When** 工具筛选
**Then** 优先返回立创商城"基础库"或"扩展库"中的主流元件，排除停产/小众器件

**Given** 搜索无结果
**When** 工具返回空结果
**Then** 返回 `{"code": "COMPONENT_NOT_FOUND", "message": "未找到符合条件的立创库元件"}`，Agent 尝试更宽泛的搜索词重试 1 次

**Given** 找到候选元件
**When** 最终确定元件
**Then** 元件 UUID 写入电路 JSON 的 `components[].uuid` 字段，供插件侧 `getByLcscIds()` 二次验证

---

### Story 3.4: Plugin 侧 EDA SDK 放置器件、连线与保存

As a 插件主线程,
I want 接收 IFrame 传来的电路 JSON 并调用立创 EDA SDK 在画布上放置所有元件、绘制连线、添加网络标识并保存,
So that 用户能在 EDA 画布上看到完整的可编辑原理图。

**Acceptance Criteria:**

**Given** `index.ts` 通过 `eda.sys_MessageBus.subscribe('GENERATE_REQUEST', handler)` 收到消息，payload 包含合法 `circuitJson`
**When** 调用元件验证逻辑
**Then** 通过 `eda.lib_Device.getByLcscIds()` 验证所有元件 UUID 在官方库中存在，验证通过后才继续放置

**Given** 元件验证通过
**When** `schematicGenerator.ts` 遍历 `circuitJson.components[]`
**Then** 调用 `SCH_PrimitiveComponent.create()` 依次放置每个元件，元件位置坐标来自电路 JSON 的 `position` 字段

**Given** 所有元件放置完成
**When** `schematicGenerator.ts` 遍历 `circuitJson.wires[]`
**Then** 调用 `SCH_PrimitiveWire.create()` 绘制所有连线，连接正确引脚端点

**Given** 电路 JSON 包含网络标识（GND、VCC 等）
**When** 处理 `circuitJson.netFlags[]`
**Then** 调用 `SCH_PrimitiveComponent.createNetFlag()` 放置对应网络标签

**Given** 所有放置操作完成
**When** 调用保存
**Then** 执行 `eda.sch_Document.save()`，文档成功保存，`sys_ToastMessage.showMessage("原理图生成成功")` 展示，通过 `eda.sys_MessageBus.publish('GENERATE_RESULT', { placedCount })` 通知 IFrame 放置结果

**Given** 任意元件放置失败（SDK 抛出异常）
**When** 异常捕获
**Then** 通过 `eda.sys_MessageBus.publish('GENERATE_ERROR', { message })` 通知 IFrame，IFrame 展示错误提示，`sys_ToastMessage` 显示"放置失败: {元件名}"

---

### Story 3.5: LDO 端到端联调验证（POC 验收）

As a 用户（小林/阿杰角色）,
I want 输入"5V 转 3.3V LDO 供电模块"后在立创 EDA 画布上看到自动生成的完整 LDO 原理图,
So that 验证从自然语言输入到原理图生成的完整链路可用，通过 POC 验收标准。

**Acceptance Criteria:**

**Given** 用户已登录，在 IFrame 输入框中输入"5V 转 3.3V LDO 供电模块"
**When** 点击"生成"按钮
**Then** 全流程无手动干预，30 秒内在 EDA 画布生成原理图

**Given** 生成的原理图
**When** 检查元件
**Then** 包含：AMS1117-3.3（或等效 LDO）、输入滤波电容、输出滤波电容，所有元件均来自立创官方库，可在立创商城搜索到且有库存

**Given** 生成的原理图
**When** 检查连接关系
**Then** VIN → LDO 输入引脚，LDO 输出引脚 → VOUT，GND 网络标识正确连接，符合 AMS1117 数据手册推荐电路

**Given** 生成的原理图
**When** 在立创 EDA 中执行 DRC
**Then** 无"引脚未连接"或"网络错误"等严重 DRC 错误

**Given** 生成完成
**When** 用户关闭并重新打开工程文件
**Then** 原理图已持久化保存，内容与生成结果一致

---

## Epic 4: 会话管理与生成历史持久化

用户每次生成原理图的记录都持久化到 PostgreSQL，对话按「会话」分组：用户打开插件后自动加载最新会话，会话列表可点击切换，同一会话内的消息按序展示。后端 SSE 流新增事件类型字段，前端根据类型区分普通文字回复（直接追加）与原理图数据（触发 EDA SDK 渲染），不再每次生成都重新渲染整页。

### Story 4.1: 原理图生成历史写入

As a 系统,
I want 每次原理图生成成功后自动将记录写入 `schematic_histories` 表,
So that 用户的每次生成都被持久化，支持后续查询和审计。

**Acceptance Criteria:**

**Given** 用户完成一次原理图生成（端到端成功）
**When** `SchematicService` 完成生成流程
**Then** 向 `schematic_histories` 表写入一条记录，包含：`user_id`（来自 JWT）、`user_input`（原始需求文本）、`circuit_json`（生成结果）、`created_at`（UTC 时间戳）

**Given** 生成过程中发生错误（LLM 解析失败、元件未找到等）
**When** 生成失败
**Then** 不写入历史记录，失败不影响 `schematic_histories` 表数据完整性

**Given** `SchematicHistory` EF Core 实体
**When** 检查数据库
**Then** 表名 `schematic_histories`，列名全为 `snake_case`，`user_id` 有索引（`idx_schematic_histories_user_id`），符合 ADR-07 规范

**Given** 写入操作
**When** PostgreSQL 连接短暂中断
**Then** EF Core 抛出异常被捕获，生成流程返回 500 错误，不导致插件崩溃

---

### Story 4.2: 历史记录查询 API 与 IFrame 展示

As a 用户,
I want 在插件 IFrame 中查看我过去生成的原理图记录列表,
So that 我可以了解历史生成情况，后续扩展时支持重新加载历史原理图。

**Acceptance Criteria:**

**Given** 已登录用户调用 `GET /api/schematics?pageSize=10&pageIndex=1`
**When** 请求携带有效 JWT
**Then** 返回 `{"success": true, "data": {"items": [...], "total": N}}`，仅包含当前用户（`user_id` 来自 JWT）的历史记录，按 `created_at` 降序排列

**Given** 用户无历史记录
**When** 调用查询接口
**Then** 返回 `{"success": true, "data": {"items": [], "total": 0}}`，不返回 404

**Given** IFrame 对话面板中有"历史"入口
**When** 用户点击"历史"
**Then** 展示最近 10 条历史记录列表，每条显示 `user_input` 文本和 `created_at` 时间

**Given** 分页参数
**When** 调用 `GET /api/schematics?pageSize=5&pageIndex=2`
**Then** 正确返回第 2 页数据，不返回其他用户的记录（数据隔离验证）

---

### Story 4.3: 会话数据模型扩展

As a 系统,
I want 在数据库中引入 `sessions` 会话表，并将 `schematic_histories` 通过外键关联到会话,
So that 用户的每次对话可被分组为同一会话，后续支持会话维度的消息查询与多轮上下文记忆。

**Acceptance Criteria:**

**Given** 执行新 EF Core 迁移
**When** `dotnet ef database update`
**Then** 数据库出现 `sessions` 表，含 `id`（UUID PK）、`user_id`（varchar，有索引 `idx_sessions_user_id`）、`title`（varchar，默认取首条 user_input 前 50 字符）、`created_at`（UTC）、`updated_at`（UTC，每次写入新消息时更新），列名全为 `snake_case`

**Given** `schematic_histories` 表
**When** 迁移执行完成
**Then** 新增 `session_id`（UUID，可为 NULL，外键 → `sessions.id`，`ON DELETE SET NULL`），历史数据中 `session_id` 保持 NULL 以保证向后兼容

**Given** EF Core 实体 `Session` 和 `SchematicHistory`
**When** 检查关系配置
**Then** `Session` 有导航属性 `ICollection<SchematicHistory> Histories`，`SchematicHistory` 有可空导航属性 `Session? Session`，ORM 映射正确

**Given** `dotnet build`
**When** 迁移文件生成后编译
**Then** 无编译错误，现有 Story 4.1/4.2 功能行为不变

---

### Story 4.4: 会话管理 CRUD API

As a 用户,
I want 通过 API 创建、列出和获取会话，生成接口支持传入 sessionId 关联消息,
So that 前端可以管理会话生命周期，同一会话中的多次生成被正确归组。

**Acceptance Criteria:**

**Given** 已登录用户调用 `POST /api/sessions`（body 可为空）
**When** 请求携带有效 JWT
**Then** 在 `sessions` 表创建一条属于当前用户的会话，返回 `{"success": true, "data": {"id": "...", "title": "", "createdAt": "..."}}`

**Given** 已登录用户调用 `GET /api/sessions?pageSize=20&pageIndex=1`
**When** 请求携带有效 JWT
**Then** 返回当前用户的会话列表，按 `updated_at` 降序排列，每条含 `id`、`title`、`createdAt`、`updatedAt`，仅返回自己的会话（数据隔离）

**Given** 已登录用户调用 `GET /api/sessions/{sessionId}`
**When** 会话属于当前用户
**Then** 返回会话详情，含 `histories[]` 消息列表（按 `created_at` 升序），每条消息含 `id`、`userInput`、`isSuccess`、`createdAt`（不含 `circuitJson` 减少传输量）

**Given** 调用 `GET /api/sessions/{sessionId}`
**When** 会话不属于当前用户
**Then** 返回 403，不泄露其他用户数据

**Given** `POST /api/schematics/generate` 请求 body 新增可选字段 `sessionId`
**When** 传入有效 `sessionId`（属于当前用户）
**Then** 生成成功后写入 `schematic_histories` 时关联该 `session_id`，并更新 `sessions.updated_at`；若 session 的 title 仍为空，则取本次 `userInput` 前 50 字符作为 title

**Given** `POST /api/schematics/generate` 未传 `sessionId`
**When** 生成成功
**Then** `schematic_histories` 记录的 `session_id` 为 NULL，与 Story 4.1 行为一致，无破坏性变更

---

### Story 4.5: IFrame 会话列表 UI 与智能响应渲染

As a 用户,
I want 插件面板打开后自动加载最近会话，侧边栏展示会话列表可点击切换，聊天时普通文字直接追加显示，只有收到原理图数据才触发 EDA 重渲染,
So that 我可以管理多个对话上下文，普通闲聊与原理图生成不再混用同一渲染路径，体验更流畅。

**Acceptance Criteria:**

**Given** 用户已登录，插件 IFrame 打开
**When** 初始化完成
**Then** 自动调用 `GET /api/sessions?pageSize=20&pageIndex=1`，加载最近会话列表并渲染到会话侧边栏；自动选中 `updatedAt` 最新一条会话并加载其消息历史

**Given** 会话侧边栏
**When** 用户点击某条会话
**Then** 调用 `GET /api/sessions/{sessionId}` 加载消息列表，聊天区域渲染该会话所有历史消息（用户输入 + AI 回复），侧边栏高亮选中项

**Given** 会话侧边栏顶部有「新建对话」按钮
**When** 用户点击
**Then** 调用 `POST /api/sessions` 创建新会话，侧边栏追加新条目并自动选中，聊天区域清空

**Given** 用户在当前会话中输入需求并点击生成
**When** 请求发送
**Then** `POST /api/schematics/generate` body 携带当前 `sessionId`，生成完成后侧边栏对应会话的 `updatedAt` 刷新

**Given** 后端 SSE 流中每个事件携带 `eventType` 字段（值为 `"text"` 或 `"schematic"`）
**When** IFrame 收到 `eventType: "text"` 的 SSE 事件
**Then** 将文字内容直接追加到当前聊天气泡，不调用 EDA SDK，不发送 `GENERATE_REQUEST` 消息

**Given** SSE 流中收到 `eventType: "schematic"` 的事件（含完整 `circuitJson`）
**When** IFrame 处理该事件
**Then** 通过 `eda.sys_MessageBus.publish('GENERATE_REQUEST', circuitJson)` 向主线程发送消息，触发 EDA SDK 渲染；聊天气泡同步显示"原理图已生成"状态徽标

**Given** 后端 SSE 流不携带 `eventType`（旧版兼容）
**When** IFrame 解析
**Then** 降级为旧行为：流式追加文字，流结束时若 data 包含合法 `circuitJson` 则触发渲染，保持向后兼容

---

## Epic 5: 多轮对话上下文记忆（AI 智能升级）

**目标：** 在 Epic 4 建立的会话基础设施之上，让 `CircuitParserAgent` 真正「读懂」历史上下文——当用户在同一会话中发出增量修改指令时，Agent 能理解前序电路并输出增量结果，而不是重新生成全新电路。

**覆盖需求：** FR-09 扩展（多轮 AI 上下文）、FR-10 完整实现（后端 SSE eventType 字段）

**前置条件：** Epic 4 全部 Story（4.1–4.5）完成，`sessions` 表和会话 API 可用。

> **与 Epic 4 的边界：** Epic 4 负责「数据分组存储 + UI 入口」，Epic 5 负责「AI 利用历史数据做更智能的推理」。两者可独立发布：Epic 4 完成后用户已能管理会话并享受分类型渲染；Epic 5 完成后 AI 可跨轮次理解上下文。

---

### Story 5.1: 后端 SSE 协议扩展（eventType 字段）

As a 后端,
I want 在 SSE 流的每个事件中附加 `eventType` 字段以区分文字内容与原理图数据,
So that 前端可以根据事件类型走不同渲染路径，不再对所有流式输出统一处理。

**Acceptance Criteria:**

**Given** `POST /api/schematics/generate` 开始输出 SSE 流
**When** 后端推送中间文字状态
**Then** 每个 SSE 事件格式为 `data: {"eventType": "text", "content": "..."}\n\n`

**Given** Agent 完成解析，输出最终电路 JSON
**When** 推送终态事件
**Then** SSE 事件格式为 `data: {"eventType": "schematic", "circuitJson": {...}}\n\n`，随后发送 `data: [DONE]\n\n`

**Given** 生成失败（Agent 异常）
**When** 推送错误事件
**Then** SSE 事件格式为 `data: {"eventType": "error", "code": "...", "message": "..."}\n\n`

**Given** `dotnet build` 与现有 Epic 3 集成测试
**When** 改造完成
**Then** 无编译错误，LLM 调用链路、ComponentSearchTool 行为不变

---

### Story 5.2: CircuitParserAgent 多轮上下文注入

As a 后端 AI 服务,
I want CircuitParserAgent 在处理请求时从 `sessions` 关联的 `schematic_histories` 中加载历史消息，注入到 LLM 上下文,
So that 用户可以在同一会话中发出「增加一个 LED」这类增量指令，Agent 能基于上一次电路结果给出正确输出。

**Acceptance Criteria:**

**Given** 请求携带 `sessionId`，该会话已有历史消息
**When** `CircuitParserAgent` 被调用
**Then** 从数据库加载该 `sessionId` 下按 `created_at` 升序的历史记录，转换为 `ChatMessage[]`（`user` 角色含 `userInput`，`assistant` 角色含前次 `circuitJson` 摘要）注入 LLM 上下文

**Given** `sessionId` 为 null 或会话无历史
**When** Agent 调用 LLM
**Then** 以空历史运行，行为与 Epic 3 单次生成完全一致，无性能额外开销

**Given** PostgreSQL 历史加载失败
**When** 数据库异常
**Then** 捕获异常，降级为无历史模式运行，记录 `LogWarning`，不中断生成流程，返回正常生成结果

**Given** `dotnet build` + 现有单次生成流程
**When** 改造完成
**Then** Epic 3 验收用例（LDO 端到端）行为不变

---

### Story 5.3: 多轮对话端到端验证

As a 用户,
I want 在同一会话中先生成 LDO 电路，再输入「增加一个 LED 电源指示灯」后 Agent 在原电路基础上增量修改,
So that 验证多轮上下文记忆完整链路可用，AI 不会忽略历史上下文重新生成完整电路。

**Acceptance Criteria:**

**Given** 用户在会话 A 第一次请求「5V 转 3.3V LDO 供电模块」生成成功
**When** 在同一会话 A 第二次请求「在上述电路基础上增加一个 LED 电源指示灯」
**Then** LLM 收到包含第一次电路 JSON 的历史上下文，生成结果在原 LDO 电路基础上新增 LED + 限流电阻，用户无需重新描述 LDO 电路

**Given** 两次请求之间后端服务重启
**When** 第二次请求携带相同 `sessionId`
**Then** Agent 从 PostgreSQL 恢复历史上下文，不因内存重置而失效

**Given** 无效或不存在的 `sessionId`
**When** 请求携带该 `sessionId`
**Then** Agent 降级为无上下文单次生成，返回正常结果，不返回 404/500

**Given** IFrame 会话列表（Epic 4.5）完成后
**When** 多轮对话结束刷新侧边栏
**Then** 显示同一会话的多条消息，`updatedAt` 刷新，会话标题取第一条 `userInput` 前 50 字符

---

## Epic 6: Docker 镜像打包与数据库自动初始化

**目标：** 将 API 服务容器化，实现「一条命令启动完整本地环境」，并确保 PostgreSQL 数据库架构通过 EF Core Migrations 自动初始化，无需手动执行任何 SQL 脚本。

**覆盖需求：** NFR-08（Docker Compose 一键启动）、DevOps 可维护性

**前置条件：** Epic 1 脚手架完成（Dockerfile 和 docker-compose.yml 基础结构存在）。

---

### Story 6.1: Dockerfile 优化与 Alpine 镜像

As a 开发者,
I want API 镜像使用 Alpine 基础镜像并打包 HEALTHCHECK，
So that 镜像体积更小（~100MB vs ~230MB），容器编排平台可自动感知服务就绪状态。

**Acceptance Criteria:**

**Given** `docker build -t aisch-api:local -f backend/Dockerfile backend`
**When** 构建完成
**Then** 镜像使用 `mcr.microsoft.com/dotnet/aspnet:10.0-alpine` 运行时基础，镜像大小 < 150MB

**Given** 容器启动后 30s 内
**When** Docker 执行 HEALTHCHECK `wget -q -O- http://localhost:8080/healthz`
**Then** `/healthz` 端点返回 HTTP 200 `{"status":"healthy"}`，容器状态变为 `healthy`

**Given** `backend/.dockerignore` 存在
**When** 执行 docker build
**Then** `bin/`、`obj/`、`.vs/` 等构建产物不被包含在构建上下文，构建速度提升

---

### Story 6.2: EF Core Migrations 容器启动自动执行

As a 运维,
I want API 容器启动时自动执行 `Database.Migrate()`，
So that 首次部署或版本升级后无需手动 `dotnet ef database update`，数据库架构自动与代码同步。

**Acceptance Criteria:**

**Given** 全新 PostgreSQL 容器（空数据库 `aisch`）
**When** API 容器首次启动
**Then** `Database.Migrate()` 在 `app.Run()` 前执行，自动创建 `__EFMigrationsHistory`、`schematic_histories`、`schematic_sessions` 等表，API 正常响应请求

**Given** 数据库已是最新 Schema
**When** API 容器重启
**Then** `Database.Migrate()` 检测到无待执行迁移，快速跳过，启动时间开销 < 1s

**Given** PostgreSQL 容器尚未就绪（启动竞争）
**When** API 容器尝试执行 Migrate
**Then** Npgsql `EnableRetryOnFailure(maxRetry=5)` 自动重试，最终成功连接并执行迁移，无崩溃

**Given** 非 Production 环境（Development / Docker）或 `Database:AutoMigrate=true`
**When** API 启动
**Then** 执行自动迁移；Production 环境默认不自动迁移（需显式配置），避免生产事故

---

### Story 6.3: docker-compose.yml 生产级配置

As a 开发者,
I want docker-compose.yml 包含完整的环境变量、依赖健康检查和 init-db.sql 挂载，
So that `docker compose up -d` 一键启动 API + PostgreSQL + Keycloak，无需手动干预。

**Acceptance Criteria:**

**Given** `.env` 文件配置了 `OPENAI_API_KEY`
**When** 执行 `docker compose up -d` 
**Then** API 容器设置 `ASPNETCORE_ENVIRONMENT=Development`（启用 CORS），`Keycloak__RequireHttpsMetadata=false`（容器内 HTTP 通信），`ConnectionStrings__Default` 指向内部 db 服务

**Given** `db` 容器尚未通过健康检查
**When** docker compose 启动
**Then** `api` 容器通过 `depends_on: db: condition: service_healthy` 等待 PostgreSQL 就绪后再启动

**Given** `docker/init-db.sql` 挂载到 `/docker-entrypoint-initdb.d/`
**When** PostgreSQL 容器首次初始化
**Then** 自动执行 init-db.sql，为 `aisch` 数据库启用 `uuid-ossp` 扩展并确认权限

**Given** `scripts/health-check.ps1` 执行
**When** 所有容器处于运行状态
**Then** API `/healthz`、PostgreSQL `pg_isready`、Keycloak `/health/ready` 均返回健康状态

---

### Story 6.4: 管理脚本套件

As a 开发者,
I want 提供 `scripts/` 下的 PowerShell 管理脚本，
So that 不熟悉 Docker 命令的团队成员也能一键操作本地环境。

**Acceptance Criteria:**

**Given** `scripts/start-local.ps1` 执行
**When** 未找到 `.env` 文件
**Then** 自动从 `.env.example` 复制并提示填写 `OPENAI_API_KEY` 后退出

**Given** `scripts/start-local.ps1 -Build` 执行
**When** `-Build` 参数传入
**Then** 先执行 `docker compose build api` 重新构建镜像，再启动所有服务

**Given** `scripts/stop-local.ps1 -RemoveVolumes` 执行
**When** `-RemoveVolumes` 参数传入
**Then** 执行 `docker compose down -v`（提示数据将丢失）

**Given** `scripts/build-image.ps1 -Tag aisch-api:test` 执行
**When** 构建成功
**Then** 输出镜像大小与创建时间，退出码为 0
