# Story 3.3: ComponentSearchTool 元件搜索与验证

## Status: ready-for-dev

## Story

As a AI Agent 工具,
I want 根据 LLM 生成的元件需求在立创官方库中搜索匹配元件并验证可用性,
So that 最终电路 JSON 中的元件 UUID 全部来自立创官方库，保证可放置性。

## Tasks

- [ ] **[Spike]** 研究立创EDA Pro 组件库搜索 HTTP API（参考文档：https://prodocs.lceda.cn/cn/api/guide/，抓包验证 endpoint）；POC 期间可先用 Mock 实现（见 Dev Notes）
- [ ] 创建 `Services/ComponentService.cs` — 注入 `HttpClient`，实现 `SearchAsync(string query, CancellationToken ct)` 方法，返回 `List<ComponentResult>`，含候选筛选逻辑（基础库优先，排除停产）
- [ ] 创建 `Tools/ComponentSearchTool.cs` — `[Description]` 装饰的实例方法 `SearchComponentAsync(string componentName)`，注入 `ComponentService`，将搜索结果序列化为 JSON 字符串返回给 LLM；无结果时返回 `COMPONENT_NOT_FOUND` JSON
- [ ] 创建 `Api/Controllers/ComponentsController.cs` — `GET /api/components/search?q=` 端点（`[Authorize]`），代理立创库查询，供前端直接调试用
- [ ] 修改 `Agents/CircuitParserAgent.cs` — 构造函数注入 `ComponentSearchTool`，存为字段备用（实际注册在 Program.cs 的工厂方法中）
- [ ] 修改 `Program.cs` — 注册 `ComponentService`（`AddHttpClient`）、`ComponentSearchTool`（`AddSingleton`），更新 `AIAgent` DI Singleton 工厂，在 `AsAIAgent()` 的 `tools:` 参数内注册 `AIFunctionFactory.Create(searchTool.SearchComponentAsync)`

## Acceptance Criteria

**AC1**: Agent 需要查找"AMS1117-3.3 LDO 稳压器"元件 →
`ComponentSearchTool.SearchComponentAsync("AMS1117-3.3")` 被调用，通过 `ComponentService` 调用立创官方库 HTTP API，返回包含元件 UUID、引脚信息、LCSC 编号的 JSON 字符串供 LLM 读取

**AC2**: 搜索返回多个候选元件 →
`ComponentService` 筛选后优先返回 `Library="基础库"` 或 `"扩展库"` 的主流元件，`IsActive=false`（停产）的元件被排除，最多返回 Top 3 候选

**AC3**: 搜索无结果 →
`SearchComponentAsync` 返回字符串 `{"code":"COMPONENT_NOT_FOUND","message":"未找到符合条件的立创库元件"}`；`CircuitParserAgent` 的 System Prompt 中包含指令：收到此错误码时，自动用更宽泛的搜索词重试 1 次（如 "AMS1117-3.3" → "AMS1117 LDO"）

**AC4**: 找到候选元件 →
LLM 将 `ComponentSearchTool` 返回的 UUID 写入生成的电路 JSON `components[].uuid` 字段，该字段供插件侧 `eda.lib_Device.getByLcscIds()` 二次验证时使用

## Dev Notes

### 文件路径约定
- `Tools/ComponentSearchTool.cs` — Agent 工具类（`AIFunctionFactory.Create()` 注册目标）
- `Services/ComponentService.cs` — HTTP 搜索业务逻辑（不直接暴露给 LLM）
- `Api/Controllers/ComponentsController.cs` — REST 代理端点，与 `SchematicsController` 同级

### AIFunctionFactory.Create() 工具注册模式

```csharp
// Tools/ComponentSearchTool.cs
using Microsoft.Agents.AI;
using System.ComponentModel;
using System.Text.Json;

namespace AiSchGeneratorApi.Tools;

public class ComponentSearchTool(ComponentService componentService)
{
    // [Description] 内容供 LLM 决定何时/如何调用此工具
    [Description("按元件名称或型号在立创官方综合库中搜索可用元件，返回元件 UUID 和 LCSC 编号的 JSON。无结果时返回 COMPONENT_NOT_FOUND 错误码。")]
    public async Task<string> SearchComponentAsync(
        [Description("元件名称或型号，如 'AMS1117-3.3'、'100nF 0402 电容'、'NPN 通用三极管'")] string componentName,
        CancellationToken cancellationToken = default)
    {
        var results = await componentService.SearchAsync(componentName, cancellationToken);

        if (results.Count == 0)
            return """{"code":"COMPONENT_NOT_FOUND","message":"未找到符合条件的立创库元件"}""";

        return JsonSerializer.Serialize(results, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });
    }
}
```

```csharp
// Program.cs 注册更新（在 Story 3.2 registrations 基础上扩展）
builder.Services.AddHttpClient<ComponentService>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["LcedaApi:BaseUrl"]!);
    client.Timeout = TimeSpan.FromSeconds(10);
});

builder.Services.AddSingleton<ComponentSearchTool>();  // 与 AIAgent Singleton 生命周期匹配

// 更新 AIAgent 工厂（替换 Story 3.2 中未带 tools 的版本）
builder.Services.AddSingleton<AIAgent>(sp =>
{
    var client     = sp.GetRequiredService<AzureOpenAIClient>();
    var model      = sp.GetRequiredService<IConfiguration>()["OpenAI:ModelName"] ?? "gpt-4o";
    var searchTool = sp.GetRequiredService<ComponentSearchTool>();

    return client
        .GetChatClient(model)
        .AsAIAgent(
            name: "CircuitParserAgent",
            instructions: """
                你是专业的电路原理图设计助手。
                根据用户描述生成符合规范的电路 JSON。

                **元件查找规则（必须遵守）：**
                1. 使用 SearchComponentAsync 工具查找每个元件
                2. 收到 COMPONENT_NOT_FOUND 时，用更宽泛的搜索词重试 1 次（例：AMS1117-3.3 → AMS1117 LDO）
                3. 两次均未找到时，将该元件的 uuid 字段留空 ""
                4. 将工具返回的 uuid 写入 components[].uuid 字段

                只返回合法 JSON，不要包含 Markdown 代码块、注释或其他文字。
                """,
            tools: [AIFunctionFactory.Create(searchTool.SearchComponentAsync)]
        );
});
```

### ComponentService 实现结构

```csharp
// Services/ComponentService.cs
using AiSchGeneratorApi.Models;

namespace AiSchGeneratorApi.Services;

public class ComponentService(HttpClient httpClient, ILogger<ComponentService> logger)
{
    public async Task<List<ComponentResult>> SearchAsync(
        string query, CancellationToken ct = default)
    {
        // ⚠️ Spike 待确认：实际 endpoint 需抓包立创EDA Pro 验证
        // 候选 endpoint（参见 Dev Notes - 立创EDA API 调研）
        var url = $"/api/devices?q={Uri.EscapeDataString(query)}&page=1&perPage=10";

        try
        {
            using var response = await httpClient.GetAsync(url, ct);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync(ct);
            var raw  = JsonSerializer.Deserialize<LcedaSearchResponse>(json);

            return raw?.Result
                ?.Where(r => r.IsActive)                              // 排除停产
                .OrderByDescending(r => LibraryPriority(r.Library))   // 基础库优先
                .Take(3)
                .Select(r => new ComponentResult(r.Lcsc, r.Name, r.Uuid, r.Library, r.IsActive))
                .ToList() ?? [];
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "立创库搜索失败，query={Query}", query);
            return [];
        }
    }

    private static int LibraryPriority(string library) => library switch
    {
        "基础库" => 3,
        "扩展库" => 2,
        _        => 1
    };
}
```

### ComponentResult DTO 设计

```csharp
// Models/ComponentResult.cs
namespace AiSchGeneratorApi.Models;

/// <summary>从立创官方库搜索返回的元件信息。</summary>
public record ComponentResult(
    string Lcsc,       // "C6186"        — 立创商城 C 编号
    string Name,       // "AMS1117-3.3"  — 元件型号/名称
    string Uuid,       // 立创官方库 UUID（供插件侧 getByLcscIds() 验证）
    string Library,    // "基础库" | "扩展库" | "用户库"
    bool   IsActive    // false = 停产，筛选时应排除
);
```

### Circuit JSON uuid 字段（Story 3.2 ADR-09 扩展）

Story 3.3 完成后，ADR-09 Circuit JSON `components[]` 新增 `uuid` 字段：

```json
{
  "components": [
    {
      "ref":        "U1",
      "lcsc":       "C6186",
      "uuid":       "abc123-uuid-from-tool",  // ← 新增，由 ComponentSearchTool 填充
      "name":       "AMS1117-3.3",
      "x":          100,
      "y":          100,
      "rotation":   0,
      "add_to_bom": true,
      "add_to_pcb": true
    }
  ]
}
```

插件侧（Story 3.4）优先用 `lcsc` 字段调用 `eda.lib_Device.getByLcscIds(['C6186'])` 精确验证，`uuid` 字段作为备用降级路径。

### 立创EDA 组件库 HTTP API — Spike 研究指引

> ⚠️ 当前 architecture.md 中未记录后端可调用的立创库搜索 HTTP endpoint，此为 Story 3.3 开发前必须完成的 Spike。

**Spike 研究步骤：**

1. 打开立创EDA Pro（浏览器或桌面端），打开 DevTools Network 面板
2. 在元件库搜索框中搜索 "AMS1117-3.3"，观察 XHR/Fetch 请求
3. 记录：endpoint、query params、response JSON 结构、是否需要 Cookie/session

**已知候选 endpoint（待验证）：**
```
# 立创EDA Pro 内部搜索 API（常见模式）
GET https://pro.easyeda.com/api/devices?q=AMS1117&page=1&perPage=10

# 或官方开放 API
GET https://easyeda.com/api/components?q=AMS1117
```

**POC 期间 Mock 实现（立即可用，绕过 Spike）：**

无需真实 HTTP 调用，`ComponentService` 先返回硬编码结果用于验证整体 Agent Tool 流程：

```csharp
// Services/ComponentService.cs — Mock 版本（仅用于 POC 验证 Tool 注册流程）
public Task<List<ComponentResult>> SearchAsync(string query, CancellationToken ct = default)
{
    // 包含 "AMS1117" 时返回已知真实元件数据
    if (query.Contains("AMS1117", StringComparison.OrdinalIgnoreCase))
    {
        return Task.FromResult(new List<ComponentResult>
        {
            new("C6186", "AMS1117-3.3", "60ce3fd5ef5cc800e53b2e6e", "基础库", true)
        });
    }
    return Task.FromResult(new List<ComponentResult>());  // 其他查询返回空，触发 COMPONENT_NOT_FOUND
}
```

Mock UUID `60ce3fd5ef5cc800e53b2e6e` 参考自立创EDA Pro 真实库，可用于验证插件侧 `getByLcscIds(['C6186'])` 流程。

### ComponentsController 设计（代理端点）

```csharp
// Api/Controllers/ComponentsController.cs
[ApiController]
[Authorize]
[Route("api/components")]
public class ComponentsController(ComponentService componentService) : ControllerBase
{
    [HttpGet("search")]
    public async Task<IActionResult> Search(
        [FromQuery] string q, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q))
            return BadRequest(new { error = "参数 q 不能为空" });

        var results = await componentService.SearchAsync(q, ct);
        return Ok(results);
    }
}
```

### 依赖关系与前置条件

| 依赖项 | 来源 Story | 说明 |
|--------|-----------|------|
| `AzureOpenAIClient` DI 注册 | Story 3.2 | `Program.cs` 中已注册，本 story 复用 |
| `AIAgent` DI 工厂 | Story 3.2 | 本 story 需更新工厂添加 `tools:` 参数 |
| `CircuitParserAgent` 构造函数 | Story 3.2 | 无需修改 `ParseAsync` 逻辑，仅 DI 工厂层变化 |

### Agent Framework API 速查（Tool 相关）

```csharp
// using Microsoft.Agents.AI;
// using System.ComponentModel;

// 1. 将实例方法转换为 AIFunction（自动读取 [Description] 属性作为工具描述）
AIFunction tool = AIFunctionFactory.Create(instance.MethodAsync);

// 2. 多工具注册
AIAgent agent = chatClient.AsAIAgent(
    name: "...",
    instructions: "...",
    tools: [tool1, tool2, tool3]
);

// 3. Tool 方法返回类型：string（LLM 直接读取）
// 4. 参数类型：基础类型（string、int、bool）+ [Description] 注解
// 5. CancellationToken 参数被 Agent Framework 自动透传（不计入 LLM function schema）
```

## Change Log

| Date | Version | Description |
|------|---------|-------------|
| 2026-06-xx | 1.0 | 初版创建 |
