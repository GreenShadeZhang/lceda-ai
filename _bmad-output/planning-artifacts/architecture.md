---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - product-brief-ai-eda-schematic-generator-2026-03-05.md
workflowType: 'architecture'
project_name: 'ai-eda-schematic-generator'
user_name: 'Gil'
date: '2026-03-05'
---

# Architecture Decision Document: AI EDA 原理图生成器

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

---

## Project Context Analysis

### Requirements Overview

**功能性需求（Functional Requirements）：**

| # | 需求 | 架构含义 |
|---|------|----------|
| FR-01 | 用户通过自然语言对话输入电路需求 | 需要对话 UI 面板（IFrame）+ LLM API 集成 |
| FR-02 | AI 解析需求并匹配立创官方库元件 | 需要 LLM + 元件搜索 API（`eda.lib_Device.search()`） |
| FR-03 | 自动在原理图画布上放置器件并连线 | 需要调用 `SCH_PrimitiveComponent.create()` + `SCH_PrimitiveWire.create()` |
| FR-04 | 生成的元件必须来自立创官方库，且可在立创商城购买 | 元件查询必须通过 `eda.lib_Device.getByLcscIds()` 或 `search()` 验证 |
| FR-05 | 支持基础网络标识（GND、VCC 等电源符号） | 调用 `SCH_PrimitiveComponent.createNetFlag()` |
| FR-06 | 生成后自动保存原理图 | 调用 `eda.sch_Document.save()` |

**非功能性需求（Non-Functional Requirements）：**

- **安全性**：外部 LLM API 调用必须通过 IFrame（主线程不允许外部 HTTP 请求）
- **可靠性**：元件放置失败时需提供明确错误提示（`SYS_ToastMessage`）
- **POC 范围**：仅支持立创EDA专业版（V2/V3），不考虑其他 EDA 工具
- **元件一致性**：所有放置元件的 UUID 必须来自立创官方综合库（`ELIB_SymbolType` 官方符号）

**规模与复杂度评估：**

- 主要技术域：EDA 插件（前端 TypeScript）+ 外部 AI 服务（后端）
- 复杂度等级：**中等**（POC 阶段，单电路场景，LDO 模块为第一目标）
- 预估架构组件数：4个核心组件（Plugin UI、Plugin Main、Backend AI Service、EDA Canvas）
- 实时交互：IFrame ↔ Plugin 主线程之间的消息通信
- 立创商城集成：POC 阶段以搜索 API 验证为主，不做自动下单

---

### 立创EDA 插件 SDK 技术调研

> 本节归纳自官方文档：https://prodocs.lceda.cn/cn/api/guide/

#### 1. 开发环境与构建工作流

```
开发依赖：VSCode + Git + Node.js ≥ 20.5.0
SDK来源：github.com/easyeda/pro-api-sdk（或 gitee.com/jlceda/pro-api-sdk）

构建流程：
  npm install          → 安装依赖（含 @jlceda/pro-api-types）
  编辑 /src/index.ts   → 业务逻辑入口
  npm run build        → ESBuild 编译打包
  /build/dist/*.eext  → 扩展包文件（ZIP格式）

导入EDA：
  V2: 设置 → 扩展 → 导入本地扩展
  V3: 高级 → 扩展管理器 → 导入
```

#### 2. 插件项目结构

```
pro-api-sdk/
├── src/
│   └── index.ts          # 主线程入口（注册菜单、触发逻辑）
├── iframe/
│   └── index.html        # IFrame 对话 UI（AI 对话面板）
│   └── app.js / app.ts   # IFrame 内 JS（可调用外部 HTTP）
├── extension.json         # 插件配置文件
├── build/
│   └── dist/
│       └── *.eext        # 编译后的扩展包
└── package.json
```

#### 3. extension.json 配置关键字段

```json
{
  "name": "ai-sch-generator",
  "uuid": "<唯一UUID>",
  "displayName": "AI 原理图生成器",
  "version": "0.1.0",
  "entry": "./dist/index",
  "categories": "Schematic",
  "headerMenus": [
    {
      "menuId": "sch",
      "menus": [
        {
          "menuName": "AI 生成原理图",
          "registerFn": "openAIPanel"
        }
      ]
    }
  ],
  "activationEvents": ["onStartup"]
}
```

- `categories: "Schematic"` → 插件出现在原理图编辑器扩展列表
- `headerMenus[menuId="sch"]` → 在原理图编辑器顶部菜单栏注册菜单项
- `registerFn: "openAIPanel"` → 对应 `index.ts` 中 `export function openAIPanel()`

#### 4. eda 全局对象与 API 调用约定

```typescript
// eda 对象在每个扩展运行时预先实例化，直接调用即可
// 命名规则：类名去掉前缀大写 → 全小写，保留下划线
// 例：SYS_ToastMessage → eda.sys_ToastMessage

// 显示提示消息
eda.sys_ToastMessage.showMessage('消息内容', ESYS_ToastMessageType.Info);

// 打开 IFrame 对话面板（500x700px）
eda.sys_IFrame.openIFrame('/iframe/index.html', 700, 500);
```

**重要限制：**
- 主线程（index.ts）**不能**发起外部 HTTP 请求（浏览器安全策略限制）
- 外部 LLM API 调用**必须**在 IFrame 内的 JS 中发起
- IFrame 内的 JS 可以通过 `window.parent.postMessage()` 将结果传回主线程

#### 5. 原理图核心操作 API

**5.1 搜索并获取立创官方库元件**

```typescript
// 按关键词搜索器件
const results = await eda.lib_Device.search(
  'AMS1117-3.3',          // 搜索关键词
  undefined,               // libraryUuid（undefined = 搜索所有库）
  undefined,               // classification
  undefined,               // symbolType
  10,                      // 每页数量
  1                        // 页码
);

// 按立创 C 编号精确获取
const device = await eda.lib_Device.getByLcscIds(
  ['C6186'],               // 立创商城 C 编号数组
  undefined                // libraryUuid
);
```

**5.2 在原理图上放置器件**

```typescript
// create(component, x, y, subPartName?, rotation?, mirror?, addIntoBom?, addIntoPcb?)
await eda.sch_PrimitiveComponent.create(
  componentObject,   // 从 lib_Device 获取的器件对象
  100,               // x 坐标（mil 单位）
  100,               // y 坐标
  undefined,         // 子部件名（多部件器件用）
  0,                 // 旋转角度（0/90/180/270）
  false,             // 是否镜像
  true,              // 加入 BOM
  true               // 同步到 PCB
);
```

**5.3 创建电源/地网络标识**

```typescript
// createNetFlag(identification, net, x, y, rotation?, mirror?)
// identification: 'Ground' | 'Power' | 'AnalogGround' | 'ProtectGround'
await eda.sch_PrimitiveComponent.createNetFlag('Ground', 'GND', 150, 50);
await eda.sch_PrimitiveComponent.createNetFlag('Power', 'VCC', 100, 200);
```

**5.4 创建连接导线**

```typescript
// create(line, net?, color?, lineWidth?, lineType?)
// line: [[x1,y1],[x2,y2]] 坐标数组
await eda.sch_PrimitiveWire.create(
  [[100, 150], [150, 150]],   // 连线坐标（mil单位）
  'VCC'                        // 网络名（可选）
);
```

**5.5 自动布局与保存**

```typescript
// 自动布局（BETA）
await eda.sch_Document.autoLayout({});

// 保存文档
await eda.sch_Document.save();
```

#### 6. IFrame 与主线程通信机制

IFrame 是唯一可以发起外部 HTTP 请求的地方，通信通过 `postMessage` 实现：

```
用户在 IFrame 输入需求
     ↓
IFrame 内 JS 调用 LLM API（fetch/axios）
     ↓
LLM 返回 JSON 电路描述
     ↓
iframe.js: window.parent.postMessage({ type: 'GENERATE_SCH', circuit: {...} }, '*')
     ↓
index.ts 监听 message 事件，调用 EDA SDK APIs
     ↓
SCH_PrimitiveComponent.create() × N（放置器件）
SCH_PrimitiveWire.create() × N（连接导线）
sch_Document.save()
```

#### 7. 调试方法

```
方法一：URL 参数调试
  在立创EDA编辑器 URL 末尾加 ?cll=debug → F12 打开开发者工具

方法二：独立脚本（开发期快速测试）
  无需打包 .eext，在编辑器内直接运行 TypeScript/JavaScript 代码片段
```

---

### Technical Constraints & Dependencies

| 约束项 | 说明 | 对架构的影响 |
|--------|------|-------------|
| 主线程无网络权限 | 插件主线程禁止 DOM/HTTP/文件系统访问 | AI 服务调用**必须**通过 IFrame |
| 元件来源限制 | 必须使用立创官方库元件 | 组件查询必须验证 deviceUuid 来自官方库 |
| TypeScript 运行时 | 每个扩展独立作用域，无跨扩展共享 | 无 DI 容器，使用模块化导出函数 |
| 坐标单位 | 原理图坐标使用 mil（毫英寸）为单位 | AI 输出的 JSON 需包含归一化坐标，由插件转换 |
| EDA 版本 | 仅支持立创EDA专业版 V2/V3 | 不考虑嘉立创EDA标准版 API 兼容 |
| Node.js 版本 | 构建环境要求 ≥ 20.5.0 | CI 构建需指定 Node 版本 |

### Cross-Cutting Concerns Identified

1. **错误处理**：元件搜索无结果、LLM 返回无效 JSON、坐标冲突 → 统一用 `sys_ToastMessage` 告知用户
2. **状态管理**：IFrame UI 状态与主线程 EDA 状态需通过 postMessage 同步
3. **元件验证**：所有 AI 推荐元件必须经过 `lib_Device.search()` / `getByLcscIds()` 二次验证，防止幻觉元件被放置
4. **坐标算法**：自动布局坐标算法（或依赖 `sch_Document.autoLayout()`）确保元件不重叠
5. **网络连接正确性**：导线端点必须精确对齐元件引脚坐标，否则不会形成有效电气连接

---

## Starter Template & Technology Foundation

### ADR-01：后端服务语言 — .NET (ASP.NET Core)

**决策**：使用 .NET (C#) 实现后端 AI 服务

**权衡分析：**

| 选项 | 优势 | 劣势 | 决策 |
|------|------|------|------|
| **.NET (C#)** | 强类型、高性能、Microsoft Agent Framework 原生支持、ASP.NET Core 企业级成熟度 | 部署镜像相对较大 | ✅ 选用 |
| Node.js | 与 Plugin 同语言生态 | 弱类型，Agent 框架成熟度不足 | ❌ |
| Python | AI/ML 生态最丰富 | 与 Microsoft Agent Framework .NET 不对齐 | ❌ |

**理由**：团队有 .NET 经验，Microsoft Agent Framework 提供原生 .NET 10 支持，`Azure.AI.OpenAI` NuGet 包与 OpenAI 兼容 SDK 完整对齐。

---

### ADR-02：LLM 接入方式 — OpenAI 兼容 SDK

**决策**：使用 OpenAI 兼容 SDK（`Azure.AI.OpenAI` / `OpenAI` NuGet 包）

**关键优势**：
- 统一接口覆盖：OpenAI GPT-4o、Azure OpenAI、本地模型（Ollama + OpenAI 兼容层）
- 模型切换零成本：只改 endpoint + model name，代码不变
- POC 阶段可先用 OpenAI API，生产可切换至 Azure OpenAI 满足数据合规要求

```csharp
// 标准 OpenAI 兼容调用示例
var client = new OpenAIClient(new Uri(endpoint), new ApiKeyCredential(apiKey));
var chat = client.GetChatClient(modelName);
var response = await chat.CompleteChatAsync(messages);
```

---

### ADR-03：Agent 编排框架 — Microsoft Agent Framework (.NET)

**决策**：使用 [Microsoft Agent Framework .NET](https://github.com/microsoft/agent-framework/tree/main/dotnet)

**框架能力：**
- 基于 .NET 10，活跃维护（最近提交：11小时前）
- 支持单 Agent / 多 Agent 协作 / 工作流编排
- 内置 `Azure.AI.OpenAI` + `OpenAI.Responses` 集成
- 提供 Workflow Samples（多 Agent 模式）

**POC 阶段 Agent 设计：**
```
单 Agent（电路解析器）
  输入：用户自然语言需求
  工具：搜索立创器件库、生成电路 JSON
  输出：结构化电路描述 JSON → 返回给 Plugin
```

**后续迭代扩展方向：**
```
多 Agent 协作模式（未来）
  ├── 需求解析 Agent   → 理解用户意图
  ├── 元件搜索 Agent   → 查询立创商城可购买器件
  ├── 布局规划 Agent   → 生成合理坐标布局
  └── 验证 Agent       → 检查连接正确性
```

---

### ADR-04：数据存储 — PostgreSQL + Redis

**决策**：PostgreSQL 主存储，Redis 按需缓存

| 存储层 | 用途 | 引入时机 |
|--------|------|----------|
| **PostgreSQL** | 电路模板库、用户历史对话、生成记录 | Sprint 1（核心功能） |
| **Redis** | LLM 响应缓存（相同需求避免重复调用）、会话状态缓存 | 按需引入（性能优化阶段） |

---

### 完整技术栈总览

```
┌─────────────────────────────────────────────────────────┐
│                   立创 EDA 专业版 Pro                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │         EDA 插件（.eext 扩展包）                   │   │
│  │                                                   │   │
│  │  src/index.ts          iframe/index.html          │   │
│  │  ─────────────         ──────────────────         │   │
│  │  EDA SDK API 调用       AI 对话 UI（HTML/JS）       │   │
│  │  sch_PrimitiveComponent  fetch → Backend API      │   │
│  │  sch_PrimitiveWire       postMessage ←→ 主线程     │   │
│  │  lib_Device.search()                              │   │
│  │                                                   │   │
│  │  构建：TypeScript + ESBuild → *.eext               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────┬───────────────────────────────────────┘
                  │ HTTP (from IFrame)
                  ▼
┌─────────────────────────────────────────────────────────┐
│              后端 AI 服务（ASP.NET Core）                  │
│                                                         │
│  ┌─────────────────────────────────────────────┐        │
│  │   Microsoft Agent Framework (.NET 10)        │        │
│  │   └── 电路解析 Agent                         │        │
│  │       ├── Tool: 立创器件库搜索                │        │
│  │       └── Tool: 电路 JSON 生成               │        │
│  └─────────────────────────────────────────────┘        │
│                    │                                     │
│  OpenAI 兼容 SDK   │   PostgreSQL    Redis               │
│  (Azure.AI.OpenAI) │   (电路模板/历史) (缓存/会话)         │
└────────────────────┼─────────────────────────────────────┘
                     │
                     ▼
            LLM（OpenAI / Azure OpenAI / 自托管）
```

### Plugin 侧启动模板

- **模板来源**：官方 `pro-api-sdk`（`github.com/easyeda/pro-api-sdk`）
- **IFrame UI**：POC 阶段使用原生 HTML/CSS/JS → 迭代期引入 Vue 3（按需）
- **类型支持**：`@jlceda/pro-api-types`（NPM）

### 开发优先级原则

> **优先插件基础能力**：先跑通"对话输入 → 生成原理图"核心链路；UI 交互和控件细节随功能迭代逐步完善。

| 阶段 | 重点 | UI 要求 |
|------|------|---------|
| POC | 插件主线程 + IFrame 通信 + EDA SDK 放置器件 | 最简文本输入框 |
| Sprint 1 | 后端 API + Agent + LLM 接入 + 元件搜索 | 基础对话 UI |
| Sprint 2+ | 多轮对话、元件验证、错误提示、自动布局 | 完善交互控件 |

---

## Core Architectural Decisions

### 决策优先级分析

**关键决策（阻塞实现）：**
- 认证方案：Keycloak OIDC Authorization Code Flow
- API 风格：REST + SSE（流式）
- ORM：EF Core + Npgsql
- 电路 JSON 规范：定义插件与后端的数据契约

**重要决策（影响架构）：**
- 本地开发环境：Docker Compose
- Token 存储：`eda.sys_Storage`（EDA 插件内置存储）

**延后决策（Post-MVP）：**
- 云部署方案（Azure Container Apps / App Service）
- Redis 缓存策略（性能优化阶段引入）
- 多租户支持

---

### ADR-05：认证方案 — Keycloak OIDC Authorization Code Flow

**决策**：使用 Keycloak 作为身份提供商，OIDC Authorization Code（PKCE）模式

**认证流程：**

```
[用户在 EDA 插件内点击「登录」]
          ↓
[IFrame 打开 Keycloak 登录页（redirect / popup）]
          ↓
[用户输入账号密码，Keycloak 验证]
          ↓
[Keycloak 携带 authorization_code 重定向回 iframe/callback.html]
          ↓
[callback.html 用 code + code_verifier 换取 access_token + refresh_token]
          ↓
[postMessage 将 token 传回 index.ts 主线程]
          ↓
[主线程调用 eda.sys_Storage.setItem('access_token', token)]
          ↓
[后续所有 fetch 请求附加 Authorization: Bearer <token>]
          ↓
[ASP.NET Core 后端通过 Keycloak JWKS 验证 JWT 签名]
```

**插件侧关键实现点：**

```typescript
// index.ts — 从 EDA 内置存储读取 token
const token = await eda.sys_Storage.getItem('access_token');

// iframe/app.js — 初始化时检查 token，无则引导登录
if (!localStorage.getItem('access_token')) {
  // 构建 PKCE code_verifier + code_challenge
  // 跳转 Keycloak 授权端点
  window.location.href = buildKeycloakAuthUrl(codeChallenge);
}

// iframe/callback.html — 收到 code，换 token
const params = new URLSearchParams(window.location.search);
const code = params.get('code');
const tokenRes = await fetch(`${KEYCLOAK_URL}/token`, {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    code_verifier: sessionStorage.getItem('code_verifier'),
    redirect_uri: REDIRECT_URI,
  }),
});
const { access_token, refresh_token } = await tokenRes.json();
window.parent.postMessage({ type: 'AUTH_SUCCESS', access_token, refresh_token }, '*');
```

**后端侧 JWT 验证（ASP.NET Core）：**

```csharp
// Program.cs
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = "https://<keycloak-host>/realms/<realm>";
        options.Audience = "ai-sch-backend";
        options.RequireHttpsMetadata = true;
    });

builder.Services.AddAuthorization();
```

**Token 存储策略：**

| 存储位置 | 内容 | 说明 |
|----------|------|------|
| `eda.sys_Storage`（主线程） | `access_token` | EDA 插件内置 KV 存储，跨会话持久 |
| IFrame `sessionStorage` | `code_verifier`、临时状态 | 仅 PKCE 流程中间态，登录完成后清除 |
| 内存（IFrame JS） | `refresh_token` | 用于静默刷新，不持久化 |

**Token 刷新策略：**
- access_token 过期前 60 秒，IFrame 后台静默请求 `/token` 端点刷新
- refresh_token 失效时，重新引导用户登录

---

### ADR-06：API 设计 — REST + SSE 流式输出

**决策**：后端采用 RESTful API，LLM 流式响应使用 Server-Sent Events (SSE)

**API 端点规划（POC）：**

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/schematic/generate` | 提交电路需求，返回电路 JSON（非流式） |
| `POST` | `/api/schematic/generate/stream` | 提交需求，SSE 流式返回生成进度 |
| `GET` | `/api/components/search?q=AMS1117` | 搜索立创元件（代理立创库查询） |
| `GET` | `/api/health` | 健康检查 |

**请求/响应鉴权：**
```
Authorization: Bearer <access_token>   // 每个请求必携带
```

**SSE 优于 WebSocket 的理由（POC 阶段）：**
- SSE 是单向服务端推送，LLM 流式生成场景完美匹配
- HTTP 协议原生支持，无需额外握手
- IFrame 内 `EventSource` API 原生支持，无需额外库
- WebSocket 留待未来多轮实时协作场景

---

### ADR-07：数据库访问层 — EF Core + Npgsql

**决策**：使用 Entity Framework Core + Npgsql 驱动访问 PostgreSQL

**理由**：
- Code-First 迁移，与 .NET 开发工作流无缝集成
- Npgsql 对 PostgreSQL 特性（JSONB、全文搜索）支持完善
- 初期数据模型简单，ORM 开销可接受

**核心数据模型（初版）：**

```csharp
// 生成历史记录
public class SchematicHistory
{
    public Guid Id { get; set; }
    public string UserId { get; set; }        // 来自 Keycloak sub claim
    public string UserInput { get; set; }     // 原始自然语言需求
    public JsonDocument CircuitJson { get; set; } // 生成的电路 JSON（JSONB）
    public DateTime CreatedAt { get; set; }
    public bool IsSuccess { get; set; }
}
```

---

### ADR-08：本地开发环境 — Docker Compose

**决策**：使用 Docker Compose 统一开发环境

```yaml
# docker-compose.yml（开发环境）
services:
  api:
    build: ./backend
    ports: ["5000:8080"]
    environment:
      - ConnectionStrings__Default=Host=db;Database=aisch;Username=dev;Password=dev
      - Keycloak__Authority=http://keycloak:8080/realms/aisch
      - OpenAI__Endpoint=${OPENAI_ENDPOINT}
      - OpenAI__ApiKey=${OPENAI_API_KEY}
    depends_on: [db, keycloak]

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: aisch
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    ports: ["5432:5432"]

  keycloak:
    image: quay.io/keycloak/keycloak:26
    command: start-dev
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports: ["8080:8080"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    profiles: ["cache"]   # 按需启动：docker compose --profile cache up
```

> Redis 使用 `profiles: ["cache"]` 按需启用，不影响基础开发流程。

---

### ADR-09：电路 JSON 数据契约

**决策**：定义插件与后端 AI 服务之间的电路描述标准格式

```json
{
  "version": "1.0",
  "meta": {
    "description": "LDO 5V 转 3.3V 电源模块",
    "generated_by": "ai-sch-agent"
  },
  "components": [
    {
      "ref": "U1",
      "lcsc": "C6186",
      "name": "AMS1117-3.3",
      "x": 100,
      "y": 100,
      "rotation": 0,
      "add_to_bom": true,
      "add_to_pcb": true
    },
    {
      "ref": "C1",
      "lcsc": "C19702",
      "name": "100nF 0402",
      "x": 200,
      "y": 80,
      "rotation": 0
    }
  ],
  "net_flags": [
    { "type": "Power", "net": "VIN",  "x": 60,  "y": 100 },
    { "type": "Ground", "net": "GND", "x": 100, "y": 180 }
  ],
  "wires": [
    {
      "from": { "ref": "U1", "pin": "VIN" },
      "to":   { "net_flag": "VIN" },
      "points": [[100, 100], [60, 100]]
    },
    {
      "from": { "ref": "U1", "pin": "GND" },
      "to":   { "net_flag": "GND" },
      "points": [[100, 140], [100, 180]]
    }
  ]
}
```

**字段说明：**
- `components[].lcsc`：立创商城 C 编号，插件侧通过 `eda.lib_Device.getByLcscIds()` 验证
- `components[].x/y`：mil 单位坐标，由 AI 生成合理值或后端布局算法计算
- `wires[].points`：折线路径坐标数组，映射为 `sch_PrimitiveWire.create()` 调用

---

### 决策影响分析

**实现顺序（基于依赖关系）：**

```
1. Docker Compose 环境搭建（Keycloak + PostgreSQL + API）
2. Keycloak Realm 配置（Client、PKCE、Redirect URIs）
3. ASP.NET Core 项目初始化（EF Core + JWT 验证 + OpenAI SDK）
4. EDA 插件 OIDC 登录流程（IFrame callback + token 存储）
5. 后端 /api/schematic/generate 端点 + Agent 电路解析
6. 插件主线程消费电路 JSON → EDA SDK 放置器件
7. 联调端到端（自然语言 → 原理图）
```

**跨组件依赖：**

| 依赖关系 | 说明 |
|----------|------|
| IFrame → Keycloak | 登录 / Token 刷新 |
| IFrame → Backend API | 携带 Bearer Token 调用生成接口 |
| Backend → Keycloak JWKS | JWT 签名验证 |
| Backend → OpenAI | LLM 电路解析 |
| Plugin 主线程 → EDA SDK | 放置器件 / 连线 / 保存 |
| Plugin 主线程 ↔ IFrame | postMessage 双向通信（token 同步、电路 JSON 传递） |
