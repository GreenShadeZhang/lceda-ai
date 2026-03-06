# Story 3.5: LDO 端到端联调验证（POC 验收）

Status: ready-for-dev

## Story

As a 用户（小林/阿杰角色）,
I want 输入"5V 转 3.3V LDO 供电模块"后在立创 EDA 画布上看到自动生成的完整 LDO 原理图,
So that 验证从自然语言输入到原理图生成的完整链路可用，通过 POC 验收标准。

## Acceptance Criteria

**AC1**: 用户已登录，在 IFrame 输入框中输入"5V 转 3.3V LDO 供电模块"，点击"生成" →
全流程无手动干预，**30 秒内**在 EDA 画布生成原理图

**AC2**: 生成的原理图包含 →
AMS1117-3.3（或等效 LDO）、输入滤波电容（100nF）、输出电容，**所有元件均来自立创官方库**，可在立创商城搜索到且有库存

**AC3**: 生成的原理图连接关系 →
VIN 网络标识 → LDO VIN 引脚，LDO VOUT 引脚 → VOUT 网络标识，GND 网络标识正确连接，符合 AMS1117 数据手册推荐电路

**AC4**: 生成的原理图在立创 EDA 中执行 DRC →
无"引脚未连接"或"网络错误"等严重 DRC 错误

**AC5**: 生成完成后用户关闭并重新打开工程文件 →
原理图已持久化保存，内容与生成结果一致

## Tasks / Subtasks

- [ ] 修复 BACKEND_API 端口不匹配（AC1）
  - [ ] 修改 `plugin/iframe/app.js` 第 22 行: `const BACKEND_API = 'http://localhost:5267'`（原 5000，实际端口为 5267，见 `launchSettings.json`）

- [ ] 配置 OpenAI API Key（AC1 - 阻塞项）
  - [ ] 在 `backend/AiSchGeneratorApi/` 下创建 `appsettings.Development.json`，填入真实 API Key：
    ```json
    {
      "OpenAI": {
        "ApiKey": "<your-openai-api-key>",
        "ModelName": "gpt-4o",
        "Endpoint": "https://api.openai.com/v1"
      }
    }
    ```
  - [ ] 或通过 dotnet user-secrets 配置: `dotnet user-secrets set "OpenAI:ApiKey" "<key>"`
  - [ ] 将 `appsettings.Development.json` 加入 `.gitignore`（已有 `*.Development.json` 可能需要确认）

- [ ] 启动本地开发环境（AC1）
  - [ ] 执行 `docker-compose up -d` 启动 PostgreSQL（端口 5432）+ Keycloak（端口 8080）
  - [ ] 等待容器健康：`docker-compose ps` 确认 health status
  - [ ] 执行 `dotnet run` 启动后端（Cwd: `backend/AiSchGeneratorApi`）
  - [ ] 验证: `curl http://localhost:5267/api/health` 返回 `{"success":true,"data":"healthy"}`

- [ ] 构建并导入插件（AC1）
  - [ ] 执行 `npm install && npm run build`（Cwd: `plugin/`）
  - [ ] 在立创 EDA 专业版中导入 `plugin/build/dist/*.eext`
  - [ ] 在原理图编辑器菜单中找到"AI 生成原理图"菜单项，点击后 IFrame 面板打开

- [ ] 执行 Keycloak 设备码登录（AC1 前置）
  - [ ] 在 IFrame 中点击"登录"
  - [ ] 验证：QR 码、用户码（如 `ABCD-1234`）、验证 URL 均正确展示
  - [ ] 在外部浏览器中完成 Keycloak 授权，IFrame 自动进入 app-section

- [ ] 执行 LDO 端到端测试（AC1-AC5）
  - [ ] 在 IFrame 输入框中输入"5V 转 3.3V LDO 供电模块"，点击"生成"
  - [ ] 验证 SSE 进度事件实时展示在 AI 气泡中（正在分析... / 正在调用 AI 模型...）
  - [ ] 30 秒内：气泡显示"原理图已生成！共放置 N 个元件"，`sys_ToastMessage` 显示"生成成功！"
  - [ ] 验证画布上存在 AMS1117-3.3 或等效 LDO 元件（LCSC C6186 或类似）
  - [ ] 验证输入/输出滤波电容（100nF, 10uF）存在
  - [ ] 验证 VIN / GND / VOUT 网络标识正确放置并连线
  - [ ] 在立创 EDA 中执行 DRC（工具 → 电气规则检查），确认无严重 DRC 错误
  - [ ] 按 Ctrl+S 或确认 `sch_Document.save()` 已自动保存
  - [ ] 关闭并重新打开工程文件，验证原理图内容保持一致

- [ ] 修复联调中发现的问题（按需）
  - [ ] 若 LLM 生成无效 LCSC 编号 → 增强 `CircuitParserAgent.SystemPrompt`，在系统提示中提供 AMS1117-3.3 (C6186) / 100nF (C14663) / 10uF (C19702) 等真实 LCSC 示例
  - [ ] 若元件放置坐标重叠 → 在 SystemPrompt 中明确坐标间距要求（建议相邻元件间距 ≥ 200 mil）
  - [ ] 若 SSE 连接失败（CORS 或网络错误）→ 检查 `Program.cs` CORS 配置及前端 `BACKEND_API` 地址
  - [ ] 若 Keycloak 登录失败 → 确认 `lceda-ai` Keycloak client 已启用 Device Authorization Flow

## Dev Notes

### 当前代码状态（以代码为准）

所有组件均已实现，本 Story 为**纯联调验证 + 修复**Story，不需要新增功能代码，只需打通环境并修复联调中发现的问题。

| 组件 | 文件 | 状态 |
|------|------|------|
| IFrame 对话 UI + SSE 处理 | `plugin/iframe/app.js` | ✅ 实现完毕 |
| MessageBus 通信 | `plugin/iframe/app.js` `notifyMainThreadToPlace()` | ✅ 实现完毕 |
| 主线程 EDA SDK 放置 | `plugin/src/index.ts` `placeCircuitOnCanvas()` | ✅ 实现完毕 |
| 后端 SSE 端点 | `SchematicsController.cs` `POST /api/schematics/generate` | ✅ 实现完毕 |
| LLM 电路解析 Agent | `CircuitParserAgent.cs` | ✅ 实现完毕 |
| 元件搜索工具 | `ComponentSearchTool.cs` + `ComponentService.cs` | ✅ Mock 实现 |

### ⚠️ 已知必须修复项

#### 1. BACKEND_API 端口不匹配（阻塞性 Bug）

**文件**: `plugin/iframe/app.js` 第 22 行  
**当前**: `const BACKEND_API = 'http://localhost:5000';`  
**应改为**: `const BACKEND_API = 'http://localhost:5267';`  
**来源**: `backend/AiSchGeneratorApi/Properties/launchSettings.json` — `http` profile `applicationUrl: "http://localhost:5267"`

```javascript
// plugin/iframe/app.js 第22行
const BACKEND_API = 'http://localhost:5267';  // ← 修改 5000 → 5267
```

#### 2. OpenAI API Key 为空

`appsettings.json` 中 `"OpenAI:ApiKey": ""` — **后端启动后第一次调用 LLM 会抛出 401 Unauthorized**。

推荐方式（不提交 Key 到 git）：

```bash
# 方式 1: dotnet user-secrets（推荐）
cd backend/AiSchGeneratorApi
dotnet user-secrets set "OpenAI:ApiKey" "sk-xxxx"

# 方式 2: appsettings.Development.json（确保 .gitignore 排除）
# backend/AiSchGeneratorApi/appsettings.Development.json
{
  "OpenAI": {
    "ApiKey": "sk-xxxx"
  }
}
```

### ComponentService Mock 说明

`ComponentService` 当前为 POC Mock 实现：
- 搜索词含 `"AMS1117"`（大小写不敏感）→ 返回 `C6186 AMS1117-3.3`
- 其他 → 返回空列表（`ComponentSearchTool` 返回 `COMPONENT_NOT_FOUND`）

**这不影响端到端验收的核心路径**：

```
ComponentSearchTool.SearchComponentAsync("AMS1117-3.3") 
  → ComponentService.SearchAsync("AMS1117-3.3") 
  → 因含 "AMS1117" → 返回 C6186 AMS1117-3.3
  → 工具返回 JSON 含 lcsc="C6186", uuid="60ce3fd5ef5cc800e53b2e6e"
  → LLM 将 lcsc/uuid 写入 circuit JSON
  → plugin index.ts: eda.lib_Device.getByLcscIds(["C6186"]) → 获取真实设备对象
  → eda.sch_PrimitiveComponent.create(...) ✅
```

**对于电容（100nF, 10uF）**，ComponentService Mock 返回空结果（因不含"AMS1117"）。LLM 可能生成正确 LCSC 编号（C14663 / C19702）或留空 uuid。插件侧按 LCSC 精确查找，只要 LCSC 编号正确就能找到元件。

**如果 LLM 生成的电容 LCSC 不准确**，需要在 `CircuitParserAgent.SystemPrompt` 中增加示例：

```csharp
// CircuitParserAgent.cs 中 SystemPrompt 建议增加（如需）：
"""
常用 LDO 电路元件 LCSC 参考（可直接使用）：
- AMS1117-3.3 LDO: C6186
- 100nF 0402 电容（输入滤波）: C14663
- 10uF 0805 电容（输出稳定）: C19702
- GND 网络: type="Ground", net="GND"
- 5V VIN 网络: type="Power", net="VIN"
- 3.3V VOUT 网络: type="Power", net="VOUT"
"""
```

### 关键文件与配置速查

| 项目 | 文件/路径 | 关键内容 |
|------|-----------|---------|
| 后端端口 | `backend/AiSchGeneratorApi/Properties/launchSettings.json` | `http` profile: `5267`, `https` profile: `7136;5267` |
| OpenAI 配置 | `backend/AiSchGeneratorApi/appsettings.json` | `OpenAI:Endpoint`, `ApiKey`(空), `ModelName: gpt-4o` |
| Keycloak 配置 | `backend/AiSchGeneratorApi/appsettings.json` | `Authority: auth.verdure-hiro.cn/realms/maker-community` |
| 前端 API 地址 | `plugin/iframe/app.js` Line 22 | `BACKEND_API = 'http://localhost:5267'`（修复后） |
| Keycloak 端点 | `plugin/iframe/app.js` Lines 25-26 | `auth.verdure-hiro.cn/realms/maker-community` |
| JWT 验证元数据 | `backend/AiSchGeneratorApi/Program.cs` Line ~52 | `RequireHttpsMetadata = true`（Keycloak 为 HTTPS，无需调整） |
| Docker Compose | `docker-compose.yml` | PostgreSQL 5432, Keycloak 8080 |
| 数据库连接串 | `appsettings.json` | `Host=localhost;Database=aisch;Username=dev;Password=dev` |

### 端到端调用链（完整）

```
用户在 IFrame 输入 "5V 转 3.3V LDO 供电模块" → 点击"生成"
  ↓ app.js: sendGenerateRequest(text)
  ↓ fetch POST http://localhost:5267/api/schematics/generate
    Authorization: Bearer <keycloak-jwt>
    Body: { "userInput": "5V 转 3.3V LDO 供电模块" }
  ↓
ASP.NET Core SchematicsController.Generate()
  ↓ JwtBearer 验证 (JWKS from auth.verdure-hiro.cn)
  ↓ SchematicService.GenerateStreamAsync()
    → SSE: data: {"type":"progress","text":"正在分析电路需求..."}
    → SSE: data: {"type":"progress","text":"正在调用 AI 模型生成电路..."}
  ↓ CircuitParserAgent.ParseAsync()
    → IChatClient.GetResponseAsync(messages, options{Tools=[SearchComponentAsync]})
    → LLM 调用 SearchComponentAsync("AMS1117-3.3") → ComponentService Mock → C6186
    → LLM 调用 SearchComponentAsync("100nF") → ComponentService Mock → COMPONENT_NOT_FOUND
    → LLM 生成电路 JSON（含 C6186 等 LCSC 编号）
  ↓ SSE: data: {"type":"complete","circuitJson":{...}}
  ↓ SSE: data: [DONE]
  ↓
app.js: handleSSEStream()
  → 解析 complete 事件，获取 circuitJson
  → notifyMainThreadToPlace(circuitJson)
  → eda.sys_MessageBus.publish('GENERATE_REQUEST', circuitJson)
  ↓
index.ts: placeCircuitOnCanvas(circuitJson)
  → lib_Device.getByLcscIds(["C6186"]) → AMS1117-3.3 设备对象
  → sch_PrimitiveComponent.create(device, x=100, y=100, ...)
  → sch_PrimitiveComponent.createNetFlag("Power", "VIN", 60, 100)
  → sch_PrimitiveComponent.createNetFlag("Ground", "GND", 100, 180)
  → sch_PrimitiveWire.create([[100,100],[60,100]])
  → sch_Document.save()
  → eda.sys_MessageBus.publish('GENERATE_RESULT', { placedCount: N })
  ↓
app.js: waitForPlacementResult()
  → subscribeOnce('GENERATE_RESULT') → 更新气泡"✅ 原理图已生成！"
  → showEdaToast("生成成功！放置了 N 个元件")
```

### SSE 事件协议（后端 → IFrame）

后端 `SseEvent.cs` 定义：

| 类型 | Payload 示例 | IFrame 处理 |
|------|-------------|------------|
| `progress` | `{"type":"progress","text":"正在分析电路需求..."}` | 追加到 AI 气泡 |
| `complete` | `{"type":"complete","circuitJson":{...}}` | 触发 MessageBus publish |
| `error` | `{"type":"error","code":"LLM_PARSE_ERROR","message":"..."}` | 展示错误，Toast 提示 |
| `[DONE]` | `[DONE]`（字面量） | 流结束，退出读取循环 |

### ADR-09 电路 JSON 样例（LDO 5V → 3.3V）

预期 LLM 输出（供联调验证参考）：

```json
{
  "version": "1.0",
  "meta": {
    "description": "LDO 5V 转 3.3V 电源模块",
    "generated_by": "ai-sch-agent"
  },
  "components": [
    { "ref": "U1", "lcsc": "C6186",  "name": "AMS1117-3.3", "x": 200, "y": 200, "rotation": 0, "add_to_bom": true, "add_to_pcb": true },
    { "ref": "C1", "lcsc": "C14663", "name": "100nF 0402",  "x": 100, "y": 200, "rotation": 0, "add_to_bom": true, "add_to_pcb": true },
    { "ref": "C2", "lcsc": "C19702", "name": "10uF 0805",   "x": 300, "y": 200, "rotation": 0, "add_to_bom": true, "add_to_pcb": true }
  ],
  "net_flags": [
    { "type": "Power",  "net": "VIN",  "x": 60,  "y": 200 },
    { "type": "Power",  "net": "VOUT", "x": 360, "y": 200 },
    { "type": "Ground", "net": "GND",  "x": 200, "y": 280 }
  ],
  "wires": [
    { "points": [[200, 200], [60,  200]] },
    { "points": [[200, 200], [100, 200]] },
    { "points": [[200, 200], [300, 200]] },
    { "points": [[200, 200], [360, 200]] },
    { "points": [[200, 240], [200, 280]] },
    { "points": [[100, 240], [100, 280], [200, 280]] },
    { "points": [[300, 240], [300, 280], [200, 280]] }
  ]
}
```

### 已知 ComponentService Mock 影响的电容查询

| 搜索词 | Mock 结果 | 实际 LCSC |
|--------|-----------|---------|
| `"AMS1117-3.3"` | C6186 ✅ | C6186 |
| `"100nF"` | 空（COMPONENT_NOT_FOUND） | C14663 |
| `"10uF"` | 空（COMPONENT_NOT_FOUND） | C19702 |
| `"LDO"` | 空（COMPONENT_NOT_FOUND） | — |

**解决策略**：如联调时 LLM 无法为电容生成正确 LCSC，在 `SystemPrompt` 中补充上述真实编号示例。

### 开发环境启动顺序

```bash
# 1. 启动依赖服务
docker-compose up -d

# 2. 启动后端（新终端）
cd backend/AiSchGeneratorApi
dotnet run
# 监听: http://localhost:5267

# 3. 构建插件（另一新终端）
cd plugin
npm install
npm run build
# 输出: plugin/build/dist/*.eext

# 4. 在立创 EDA 中导入 .eext
# 5. 在插件面板中测试
```

### 潜在风险与对策

| 风险 | 可能原因 | 对策 |
|------|----------|------|
| LLM 生成 JSON 格式错误 | Prompt 不够清晰 | `CircuitParserAgent` 已有自动重试 1 次的机制；如仍失败，增强 SystemPrompt 中的格式说明 |
| LLM 生成无效 LCSC 编号 | 模型幻觉 | 在 SystemPrompt 中明确提供 AMS1117-3.3 (C6186) 等示例编号 |
| EDA SDK 元件放置坐标重叠 | 坐标算法不足 | `SystemPrompt` 中要求合理间距（≥ 200 mil），或调整连线 `points` 坐标 |
| Keycloak 设备码登录失败 | Client 未配置 Device Flow | 在 Keycloak 管理界面确认 `lceda-ai` client 已启用 OAuth 2.0 Device Authorization Grant |
| SSE 连接被 CORS 阻断 | 开发环境 CORS 配置 | `Program.cs` 已为 `IsDevelopment()` 配置 AllowAnyOrigin，确认环境变量 `ASPNETCORE_ENVIRONMENT=Development` |
| 数据库连接失败 | PostgreSQL 未启动 | 先 `docker-compose up -d` 再 `dotnet run` |

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6

### Debug Log References

### Completion Notes List

### File List
