---
stepsCompleted: [1, 2, 3]
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
