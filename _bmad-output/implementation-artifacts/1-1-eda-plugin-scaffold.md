# Story 1.1: 搭建 EDA 插件项目结构与构建工具链

Status: review

## Story

As a 开发者,
I want 搭建符合架构规范的立创 EDA 插件项目骨架（TypeScript + ESBuild + extension.json）,
so that 我可以在本地构建并将插件加载到立创 EDA 中运行，验证工具链可用。

## Acceptance Criteria

1. **Given** 开发者已安装 Node.js ≥ 20.5.0  
   **When** 执行 `npm install && npm run build`  
   **Then** 生成 `build/dist/*.eext` 文件，无构建错误

2. **Given** 生成的 `.eext` 文件  
   **When** 在立创 EDA 专业版中导入该扩展  
   **Then** 插件菜单项出现在 EDA 界面中，点击后无报错

3. **Given** `plugin/src/messageTypes.ts` 中定义的消息常量  
   **When** 运行 TypeScript 编译  
   **Then** 所有消息类型常量编译通过，无类型错误

4. **Given** `plugin/src/index.ts` 主线程入口  
   **When** 插件加载后点击菜单  
   **Then** 控制台输出初始化日志，IFrame 面板可打开（空白即可）

## Tasks / Subtasks

- [x] Task 1: 克隆官方 pro-api-sdk 模板并初始化 plugin 目录结构 (AC: 1, 2)
  - [x] 1.1 从 `github.com/easyeda/pro-api-sdk`（或 gitee.com/jlceda/pro-api-sdk）克隆/下载模板
  - [x] 1.2 在项目根目录创建 `plugin/` 子目录，将模板内容复制到 `plugin/`
  - [x] 1.3 确认项目结构：`plugin/src/index.ts`, `plugin/iframe/index.html`, `plugin/extension.json`, `plugin/package.json`, `plugin/tsconfig.json`

- [x] Task 2: 配置 extension.json (AC: 1, 2)
  - [x] 2.1 设置 `name: "ai-sch-generator"`, `displayName: "AI 原理图生成器"`, `version: "0.1.0"`
  - [x] 2.2 生成随机 UUID 填入 `uuid` 字段
  - [x] 2.3 设置 `categories: "Schematic"`, `entry: "./dist/index"`, `activationEvents: ["onStartup"]`
  - [x] 2.4 配置 `headerMenus`: `menuId: "sch"`, `menuName: "AI 生成原理图"`, `registerFn: "openAIPanel"`

- [x] Task 3: 创建 messageTypes.ts 消息常量模块 (AC: 3)
  - [x] 3.1 创建 `plugin/src/messageTypes.ts`
  - [x] 3.2 定义 6 个消息类型常量（见 Dev Notes 完整列表）
  - [x] 3.3 导出 `MSG` const 对象和 payload interface 类型定义
  - [x] 3.4 运行 `npx tsc --noEmit` 验证类型编译通过

- [x] Task 4: 实现 index.ts 主线程入口 (AC: 4)
  - [x] 4.1 实现 `export function openAIPanel()` 函数
  - [x] 4.2 在 openAIPanel 中调用 `eda.sys_IFrame.openIFrame('/iframe/index.html', 700, 500)`
  - [x] 4.3 打印初始化日志：`console.log('[ai-sch-generator] openAIPanel triggered')`
  - [x] 4.4 注册 `window.addEventListener('message', onMessage)` 监听 IFrame postMessage（空实现即可，为后续故事预留）
  - [x] 4.5 导出 `onMessage` 处理函数骨架

- [x] Task 5: 创建 IFrame 占位页面 (AC: 2, 4)
  - [x] 5.1 创建 `plugin/iframe/index.html`，包含基础 HTML 结构
  - [x] 5.2 页面显示 "AI 原理图生成器"标题和占位文本（"功能开发中..."）
  - [x] 5.3 引入 `app.js`（空文件即可）

- [x] Task 6: 验证构建与导入 (AC: 1, 2)
  - [x] 6.1 在 `plugin/` 目录执行 `npm install` 安装依赖
  - [x] 6.2 执行 `npm run build` 确认 `build/dist/*.eext` 生成无错误
  - [x] 6.3 在 `plugin/package.json` 的 scripts 中确认有 `"build"` 命令（ESBuild）
  - [x] 6.4 检查 `.eext` 文件体积 > 0 字节

## Dev Notes

### 架构规范（MUST FOLLOW）

**来源：** [architecture.md](../planning-artifacts/architecture.md)

#### 项目目录结构

本项目包含两个子项目：EDA 插件 (`plugin/`) 和后端 (`backend/`)。Story 1.1 只涉及 `plugin/`：

```
lceda-ai/                         ← 项目根目录
├── plugin/                       ← EDA 插件（本故事范围）
│   ├── src/
│   │   ├── index.ts              ← 主线程入口（注册菜单、监听 postMessage）
│   │   ├── messageTypes.ts       ← 消息类型常量（ALL 6 消息类型）
│   │   └── types/
│   │       └── circuitJson.ts    ← CircuitJson 类型定义（可为空文件，为 Story 3 预留）
│   ├── iframe/
│   │   ├── index.html            ← IFrame 对话 UI（本故事为占位页）
│   │   └── app.js                ← IFrame JS（本故事为空文件）
│   ├── extension.json            ← 插件配置
│   ├── package.json
│   ├── tsconfig.json
│   └── build/
│       └── dist/
│           └── *.eext            ← 构建输出（gitignore）
├── backend/                      ← ASP.NET Core 后端（Story 1.2 范围）
├── docker-compose.yml            ← Story 1.3 范围
└── README.md
```

#### 官方启动模板

- **模板来源：** `github.com/easyeda/pro-api-sdk`（国内备用：`gitee.com/jlceda/pro-api-sdk`）
- **依赖包：** `@jlceda/pro-api-types`（TypeScript 类型定义，通过 npm 安装）
- **构建工具：** ESBuild（模板自带，不要替换为 webpack/vite）
- **Node.js 版本要求：** ≥ 20.5.0

#### extension.json 完整规范

```json
{
  "name": "ai-sch-generator",
  "uuid": "<生成一个 UUID>",
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

**关键说明：**
- `categories: "Schematic"` → 插件出现在原理图编辑器扩展列表（不是 PCB）
- `headerMenus[menuId="sch"]` → 菜单项出现在原理图编辑器顶部
- `registerFn: "openAIPanel"` → **必须**与 `index.ts` 导出函数名完全一致
- `activationEvents: ["onStartup"]` → EDA 启动时自动激活插件

#### messageTypes.ts 完整定义（MUST IMPLEMENT EXACTLY）

```typescript
// plugin/src/messageTypes.ts
// 消息方向说明：
//   IFrame → 主线程：AUTH_SUCCESS, AUTH_FAILURE, GENERATE_REQUEST
//   主线程 → IFrame：AUTH_TOKEN_SYNC, GENERATE_RESULT, GENERATE_ERROR

export const MSG = {
  // IFrame → 主线程
  AUTH_SUCCESS:     'AUTH_SUCCESS',
  AUTH_FAILURE:     'AUTH_FAILURE',
  GENERATE_REQUEST: 'GENERATE_REQUEST',
  // 主线程 → IFrame
  AUTH_TOKEN_SYNC:  'AUTH_TOKEN_SYNC',
  GENERATE_RESULT:  'GENERATE_RESULT',
  GENERATE_ERROR:   'GENERATE_ERROR',
} as const;

export type MsgType = typeof MSG[keyof typeof MSG];

// Payload 接口定义（为后续故事预留类型安全）
export interface AuthSuccessMessage {
  type: typeof MSG.AUTH_SUCCESS;
  accessToken: string;
  refreshToken: string;
}

export interface AuthFailureMessage {
  type: typeof MSG.AUTH_FAILURE;
  error: string;
}

export interface GenerateRequestMessage {
  type: typeof MSG.GENERATE_REQUEST;
  userInput: string;
  authToken: string;
}

export interface AuthTokenSyncMessage {
  type: typeof MSG.AUTH_TOKEN_SYNC;
  accessToken: string;
  refreshToken: string;
}

export interface GenerateResultMessage {
  type: typeof MSG.GENERATE_RESULT;
  circuitJson: unknown; // Story 3 中替换为 CircuitJson 类型
}

export interface GenerateErrorMessage {
  type: typeof MSG.GENERATE_ERROR;
  error: string;
}
```

#### index.ts 实现规范

```typescript
// plugin/src/index.ts
import { MSG } from './messageTypes';

// 注意：eda 对象在运行时由 EDA 平台预先注入，全局可用
// 命名规则：类名去掉前缀大写 → 全小写，保留下划线
// 例：SYS_ToastMessage → eda.sys_ToastMessage

export function openAIPanel(): void {
  console.log('[ai-sch-generator] openAIPanel triggered');
  // IFrame 尺寸（宽700, 高500），单位 px
  eda.sys_IFrame.openIFrame('/iframe/index.html', 700, 500);
}

export function onMessage(event: MessageEvent): void {
  // Story 2/3 将填充具体实现
  // 本故事只需注册监听器，空实现即可
  const { type } = event.data || {};
  console.log('[ai-sch-generator] received message:', type);
}

// 注册 postMessage 监听器
window.addEventListener('message', onMessage);
```

**重要限制（来自架构 ADR）：**
- 主线程（index.ts）**禁止**发起任何外部 HTTP 请求（浏览器安全策略）
- Token 只能存入 `eda.sys_Storage`，**不得**使用 `localStorage`（Story 2 实现）
- IFrame 内的 JS 才可以调用外部 fetch（Story 3 实现）

#### TypeScript 命名规范（来自 architecture.md）

| 元素 | 规范 | 示例 |
|------|------|------|
| 变量、函数 | camelCase | `openAIPanel()`, `accessToken` |
| 类、接口、类型 | PascalCase | `CircuitJson`, `IComponentItem` |
| 常量（值不变） | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 文件名 | camelCase | `schematicGenerator.ts`, `messageTypes.ts` |
| 消息类型常量 | SCREAMING_SNAKE_CASE | `AUTH_SUCCESS`, `GENERATE_REQUEST` |

#### ESBuild 构建说明

pro-api-sdk 模板已预置 ESBuild 配置。注意：
- 构建输出为 `build/dist/*.eext`，`.eext` 本质是 ZIP 文件
- `tsconfig.json` 中 `target` 通常为 `ES2020`，与 EDA 内嵌 V8 兼容
- `build/` 目录应加入 `.gitignore`，不提交到 git

#### EDA 调试方法

```
方法一（推荐）：在立创EDA编辑器 URL 添加 ?cll=debug → F12 打开开发者工具
方法二（开发期快速测试）：无需打包，在EDA编辑器内直接运行 TypeScript/JS 代码片段
```

### 本故事不涉及的内容（禁止超范围实现）

- ❌ 后端 API 调用（Story 3 范围）
- ❌ Keycloak 认证（Story 2 范围）
- ❌ EDA SDK 原理图操作（Story 3.4 范围）
- ❌ Docker Compose 配置（Story 1.3 范围）
- ❌ .NET 后端代码（Story 1.2 范围）
- ❌ IFrame 实际 AI 对话功能（Story 3.1 范围）

### Project Structure Notes

- `plugin/` 目录放置在项目根，与 `backend/` 并列（统一 monorepo 结构）
- `plugin/build/` 加入根目录 `.gitignore`（构建产物不提交）
- `plugin/src/types/circuitJson.ts` 创建为空导出文件，为 Story 3 占位

### References

- [Source: architecture.md#立创EDA 插件 SDK 技术调研]
- [Source: architecture.md#Plugin 侧启动模板]
- [Source: architecture.md#ADR-09：电路 JSON 数据契约]
- [Source: architecture.md#TypeScript（EDA 插件）命名规范]
- [Source: architecture.md#IFrame ↔ Plugin 主线程消息规范]
- [Source: epics.md#Story 1.1]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

- `tsc --noEmit` 零错误通过（AC:3 验证）
- `npm run build` 成功：ESBuild 编译 1.1kb JS，ZIP 打包为 2501 bytes .eext（AC:1 验证）
- `.eext` 内部结构确认：`extension.json` + `dist/index.js` + `iframe/app.js` + `iframe/index.html`（AC:2 验证）
- `@jlceda/pro-api-types@0.2.15` 成功安装提供 `eda` 全局对象类型支持

### Completion Notes List

- 已创建完整 plugin/ 骨架，结构符合 architecture.md 规范
- `messageTypes.ts` 定义了全部 6 个消息类型常量及 payload 接口，类型安全
- `index.ts` 实现了 `openAIPanel()` + `onMessage()` + message 监听，预留了 Story 2/3 的 TODO 注释
- `extension.json` 中 `registerFn: "openAIPanel"` 与 `index.ts` 导出函数名严格对应
- `plugin/src/types/circuitJson.ts` 作为占位文件为 Story 3 预留 CircuitJson 类型定义
- `.gitignore` 已更新排除 `plugin/node_modules/` 和 `plugin/build/`
- 构建产物 `build/dist/ai-sch-generator-0.1.0.eext`（2501 bytes）可直接导入立创 EDA 进行 AC:2/AC:4 人工验证

### File List

- plugin/package.json
- plugin/tsconfig.json
- plugin/build.js
- plugin/extension.json
- plugin/src/index.ts
- plugin/src/messageTypes.ts
- plugin/src/types/circuitJson.ts
- plugin/iframe/index.html
- plugin/iframe/app.js
- .gitignore（更新：添加 plugin/node_modules/ 和 plugin/build/）

### Change Log

- 2026-03-05: Story 1.1 实现完成 — 创建 EDA 插件项目骨架（TypeScript + ESBuild + extension.json + messageTypes.ts）
