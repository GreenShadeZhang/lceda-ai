# Story 3.2: 后端 CircuitParserAgent 与 LLM 电路解析

## Status: review

## Story

As a 系统,
I want 后端通过 Microsoft Agent Framework 调用 LLM 解析用户输入并生成符合 ADR-09 的 Circuit JSON，以 SSE 流式响应返回,
So that IFrame 前端能接收实时进度事件并最终获得完整的电路 JSON 数据。

## Tasks

- [x] 安装 NuGet 包：`Azure.AI.OpenAI`（`dotnet add package Azure.AI.OpenAI`）
- [x] 创建 `Api/Controllers/SchematicsController.cs` — `[Authorize]` + `[Route("api/schematics")]`，`POST /generate` 方法，设置 `text/event-stream` Content-Type，调用 `SchematicService.GenerateStreamAsync()` 写入 SSE 事件
- [x] 创建 `Services/ISchematicService.cs` — 定义接口 `IAsyncEnumerable<SseEvent> GenerateStreamAsync(string userInput, CancellationToken ct)`
- [x] 创建 `Services/SseEvent.cs` — 简单 record 持有 `Type` 和 `Payload`（已序列化 JSON 字符串）
- [x] 创建 `Services/SchematicService.cs` — 注入 `CircuitParserAgent`，调用 agent 解析，yield SSE progress 事件、complete 事件
- [x] 创建 `Agents/CircuitParserAgent.cs` — 注入 `OpenAIClient`（Azure.AI.OpenAI），构建电路解析系统 prompt，调用 LLM chat completion，解析返回 JSON，最多重试 1 次，失败抛 `LlmParseException`
- [x] 创建 `Agents/LlmParseException.cs` — 携带 `RawResponse` 字符串，供 service 层日志记录
- [x] 在 `Program.cs` 注册：`AddOpenAIClient()`（从 appsettings 读取 Endpoint/ApiKey）、`AddScoped<CircuitParserAgent>()`、`AddScoped<ISchematicService, SchematicService>()`

## Acceptance Criteria

**AC1**: 已认证用户发送 `POST /api/schematics/generate`，Body `{"userInput":"设计一个 3.3V LDO 稳压电路"}` →
Controller 收到请求，调用 SchematicService → CircuitParserAgent → LLM，最终返回包含 ADR-09 结构 circuitJson（含 `components[]` 和 `wires[]`）的 SSE `complete` 事件

**AC2**: LLM 返回有效 JSON →
响应 Content-Type 为 `text/event-stream`，先推送至少一条 `progress` 事件（`{"type":"progress","text":"..."}`)，最终推送 `complete` 事件（`{"type":"complete","circuitJson":{...}}`），最后发送 `[DONE]` 终止标志

**AC3**: LLM 返回无效 JSON 或解析异常 →
自动重试 1 次；两次均失败则：
  - 响应体：`{"success":false,"error":{"code":"LLM_PARSE_ERROR","message":"LLM 返回无效的电路 JSON，请稍后重试"}}`
  - 后端日志记录原始 LLM 响应内容（`_logger.LogError`）

**AC4**: `appsettings.json` 中配置 `OpenAI:Endpoint`、`OpenAI:ApiKey`、`OpenAI:ModelName` →
`Azure.AI.OpenAI` `OpenAIClient` 使用该端点和 API Key 创建，切换为其他 OpenAI 兼容端点（如 Azure OpenAI）无需改代码，仅改配置

## Dev Notes

### 文件路径约定（重要）
- 新建 Controller 必须放在 `Api/Controllers/SchematicsController.cs`（与 `AuthController.cs` 同级）
- **禁止**放到根目录 `Controllers/`（已有空目录，为旧 scaffold 残留，保持空置）

### SSE 响应格式规范
所有 SSE 事件均为 `data:` 行，以 `\n\n` 结尾：
```
data: {"type":"progress","text":"正在分析电路需求..."}\n\n
data: {"type":"progress","text":"正在生成元件列表..."}\n\n
data: {"type":"complete","circuitJson":{...}}\n\n
data: [DONE]\n\n
```

Controller SSE 写入模式（避免 Response Buffering）：
```csharp
Response.ContentType    = "text/event-stream";
Response.Headers.CacheControl = "no-cache";

await foreach (var evt in _service.GenerateStreamAsync(req.UserInput, ct))
{
    await Response.WriteAsync($"data: {evt.Payload}\n\n", ct);
    await Response.Body.FlushAsync(ct);
}
await Response.WriteAsync("data: [DONE]\n\n", ct);
await Response.Body.FlushAsync(ct);
```

### NuGet 包与命名空间
```xml
<!-- AiSchGeneratorApi.csproj 需新增 -->
<PackageReference Include="Microsoft.Agents.AI.OpenAI" Version="1.0.0-rc3" />
<!-- Azure.AI.OpenAI 已有，用于 AzureOpenAIClient -->
```
```csharp
// 核心 using
using Azure.AI.OpenAI;      // AzureOpenAIClient
using Azure.Core;           // ApiKeyCredential
using Microsoft.Agents.AI;  // AIAgent, AsAIAgent() extension
```

### Program.cs 注册模式（关键：AIAgent 通过工厂方法创建，非继承）
```csharp
// 1. 注册 AzureOpenAIClient（Singleton，支持切换 endpoint 只改配置）
builder.Services.AddSingleton(sp =>
{
    var cfg      = sp.GetRequiredService<IConfiguration>();
    var endpoint = cfg["OpenAI:Endpoint"]!;   // "https://api.openai.com/v1"
    var apiKey   = cfg["OpenAI:ApiKey"]!;
    return new AzureOpenAIClient(new Uri(endpoint), new ApiKeyCredential(apiKey));
});

// 2. 注册 AIAgent（Singleton）— Agent Framework 核心 API：AsAIAgent() 扩展方法
//    AIAgent 是轻量 wrapper，不需继承任何基类
builder.Services.AddSingleton<AIAgent>(sp =>
{
    var client = sp.GetRequiredService<AzureOpenAIClient>();
    var model  = sp.GetRequiredService<IConfiguration>()["OpenAI:ModelName"] ?? "gpt-4o";
    return client
        .GetChatClient(model)
        .AsAIAgent(
            name: "CircuitParserAgent",
            instructions: """
                你是专业的电路原理图设计助手。
                根据用户描述，生成符合规范的电路 JSON。
                只返回合法 JSON，不要包含 Markdown 代码块、注释或其他文字。
                """
        );
});

// 3. 注册业务层
builder.Services.AddScoped<CircuitParserAgent>();
builder.Services.AddScoped<ISchematicService, SchematicService>();
```

### CircuitParserAgent 实现结构
`CircuitParserAgent` 是标准服务类（`Agents/CircuitParserAgent.cs`），**注入 `AIAgent`**（由 DI 提供），通过 `agent.RunAsync()` 调用 LLM：

```csharp
using AiSchGeneratorApi.Contracts;
using Microsoft.Agents.AI;
using System.Text.Json;

namespace AiSchGeneratorApi.Agents;

public class CircuitParserAgent(AIAgent agent, ILogger<CircuitParserAgent> logger)
{
    // 单次调用：非流式，等待完整 LLM 响应后解析 JSON
    // 注意：RunAsync 返回 string（完整文本），RunStreamingAsync 返回 IAsyncEnumerable<string>（token 流）
    // 电路 JSON 必须完整才能解析，因此使用 RunAsync
    public async Task<JsonDocument> ParseAsync(string userInput, CancellationToken ct = default)
    {
        string? lastRaw = null;
        for (int attempt = 0; attempt < 2; attempt++)
        {
            lastRaw = await agent.RunAsync(userInput, cancellationToken: ct);
            if (TryParseCircuitJson(lastRaw, out var doc))
                return doc!;
            logger.LogWarning("LLM parse attempt {Attempt} failed. Raw: {Raw}", attempt + 1, lastRaw);
        }
        throw new LlmParseException(lastRaw ?? string.Empty);
    }

    private static bool TryParseCircuitJson(string raw, out JsonDocument? doc)
    {
        // Strip potential markdown code fences
        var json = raw.Trim();
        if (json.StartsWith("```"))
        {
            var start = json.IndexOf('\n') + 1;
            var end   = json.LastIndexOf("```");
            json = end > start ? json[start..end].Trim() : json;
        }
        try { doc = JsonDocument.Parse(json); return true; }
        catch { doc = null; return false; }
    }
}
```

**ADR-09 Circuit JSON schema**（LLM 输出目标格式）：
```json
{
  "version": "1.0",
  "meta": { "title": "...", "description": "...", "generated_by": "ai-sch-agent" },
  "components": [{ "ref": "U1", "lcsc": "C6186", "name": "AMS1117-3.3",
                   "x": 100, "y": 100, "rotation": 0, "add_to_bom": true, "add_to_pcb": true }],
  "net_flags": [{ "type": "Power", "net": "VIN", "x": 60, "y": 100 }],
  "wires": [{ "from": {"ref":"U1","pin":"VIN"}, "to": {"net_flag":"VIN"}, "points": [[100,100],[60,100]] }]
}
```

### SchematicService 调用流（SSE 产生顺序）
```csharp
public async IAsyncEnumerable<SseEvent> GenerateStreamAsync(
    string userInput, [EnumeratorCancellation] CancellationToken ct = default)
{
    yield return SseEvent.Progress("正在分析电路需求...");

    JsonDocument circuitDoc;
    try
    {
        yield return SseEvent.Progress("正在调用 AI 模型生成电路...");
        circuitDoc = await _agent.ParseAsync(userInput, ct);
    }
    catch (LlmParseException ex)
    {
        logger.LogError("LLM 解析失败，原始响应: {Raw}", ex.RawResponse);
        yield return SseEvent.Error("LLM_PARSE_ERROR", "LLM 返回无效的电路 JSON，请稍后重试");
        yield break;
    }

    yield return SseEvent.Complete(circuitDoc);
}
```

### SseEvent record 定义（Services/SseEvent.cs）
```csharp
using System.Text.Json;

namespace AiSchGeneratorApi.Services;

public record SseEvent(string Type, string Payload)
{
    private static readonly JsonSerializerOptions _opts =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static SseEvent Progress(string text) =>
        new("progress", JsonSerializer.Serialize(new { type = "progress", text }, _opts));

    public static SseEvent Complete(JsonDocument circuitDoc) =>
        new("complete", JsonSerializer.Serialize(
            new { type = "complete", circuitJson = circuitDoc }, _opts));

    public static SseEvent Error(string code, string message) =>
        new("error", JsonSerializer.Serialize(
            new { type = "error", code, message }, _opts));
}
```

### Controller SSE 写入（SchematicsController）
SSE 头一旦发出无法切换为 JSON，所有错误均在 SSE 流内返回 `error` 事件（前端 app.js Story 3.1 AC4 已处理）：
```csharp
[Authorize]
[Route("api/schematics")]
public class SchematicsController(ISchematicService service) : ControllerBase
{
    [HttpPost("generate")]
    public async Task Generate([FromBody] GenerateRequest req, CancellationToken ct)
    {
        Response.ContentType    = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";

        await foreach (var evt in service.GenerateStreamAsync(req.UserInput, ct))
        {
            await Response.WriteAsync($"data: {evt.Payload}\n\n", ct);
            await Response.Body.FlushAsync(ct);
        }
        await Response.WriteAsync("data: [DONE]\n\n", ct);
        await Response.Body.FlushAsync(ct);
    }
}

public record GenerateRequest(string UserInput);
```

### appsettings.json 当前配置（无需改动）
```json
"OpenAI": {
  "Endpoint": "https://api.openai.com/v1",
  "ApiKey": "",
  "ModelName": "gpt-4o"
}
```
API Key 开发时在 `appsettings.Development.json` 或通过环境变量 `OpenAI__ApiKey` 注入，**不提交明文 Key**。

### ⚠️ Agent Framework API 实际调查结论（Dev Note 修正）

`Microsoft.Agents.AI.OpenAI 1.0.0-rc3` 的实际 API 与故事 Dev Notes 所描述的不同：

| Dev Notes 假设 | 实际 API |
|---|---|
| `chatClient.AsAIAgent(name, instructions)` | 该扩展方法仅存在于 `OpenAI.Assistants.AssistantClient`（OpenAI Assistants/Threads API），**不适用于** `ChatClient` |
| `agent.RunAsync(string)` → `string` | 实际返回 `AgentResponse` 类型 |

**实际实现方案**：改为使用 `Microsoft.Extensions.AI.IChatClient`（已通过 `Microsoft.Agents.AI.OpenAI` 传递依赖引入）：

```csharp
// Program.cs — 注册 IChatClient Singleton（系统 prompt 由 CircuitParserAgent 在消息列表中传递）
builder.Services.AddSingleton<IChatClient>(sp =>
{
    var apiKey = cfg["OpenAI:ApiKey"]!;
    var model  = cfg["OpenAI:ModelName"] ?? "gpt-4o";
    var ep     = cfg["OpenAI:Endpoint"];
    var opts   = new OpenAIClientOptions();
    if (!string.IsNullOrEmpty(ep)) opts.Endpoint = new Uri(ep);
    return new OpenAIClient(new ApiKeyCredential(apiKey), opts)
        .GetChatClient(model).AsIChatClient();
});
```

```csharp
// CircuitParserAgent — 使用 GetResponseAsync（v10.x 新 API，原 CompleteAsync 已改名）
var response = await chatClient.GetResponseAsync(messages, cancellationToken: ct);
lastRaw = response.Text;  // ChatResponse.Text 为整合文本属性
```

**注意**：`Microsoft.Extensions.AI` 10.x 将 `CompleteAsync` 改名为 `GetResponseAsync`，返回 `ChatResponse`（原为 `ChatCompletion`）。`ApiKeyCredential` 来自 `System.ClientModel` 包（非 `OpenAI` 或 `Azure.Core` 命名空间）。

### Agent Framework API 速查
```csharp
// ✅ 正确：通过 AsAIAgent() 工厂方法创建（非继承）
using Microsoft.Agents.AI;

// 创建 agent（Singleton 注册）
AIAgent agent = azureOpenAIClient
    .GetChatClient("gpt-4o")
    .AsAIAgent(name: "CircuitParserAgent", instructions: "...");

// 非流式调用（返回完整 string） — 用于 JSON 解析场景
string fullResponse = await agent.RunAsync(userInput, cancellationToken: ct);

// 流式调用（返回 IAsyncEnumerable<string>，每次 yield 一个 token 片段）
// ⚠️ 不适合用于需要完整 JSON 解析的场景，因为 token 是碎片化的
await foreach (var chunk in agent.RunStreamingAsync(userInput, cancellationToken: ct))
    Console.Write(chunk);

// 多轮对话（需要 session 保持上下文）
AgentSession session = await agent.CreateSessionAsync();
string r1 = await agent.RunAsync("第一轮", session);
string r2 = await agent.RunAsync("第二轮", session);   // 自动携带上下文

// Tool 注册（Story 3.3 ComponentSearchTool 将用此模式）
using Microsoft.Extensions.AI;
AIAgent agentWithTools = chatClient.AsAIAgent(
    name: "CircuitParserAgent",
    instructions: "...",
    tools: [AIFunctionFactory.Create(MyToolMethod)]
);
```

> **为何选 `RunAsync()` 而非 `RunStreamingAsync()`**：电路 JSON 必须完整才能 `JsonDocument.Parse()`。
> `RunStreamingAsync()` 按 token 碎片返回，无法中途解析为结构化数据。
> Progress SSE 事件由 `SchematicService` 在调用前后**手动 yield**，与 LLM token 流无关。

### 依赖关系
- Story 3.2 完成后，Story 3.3 可在 `CircuitParserAgent` 中注入并调用 `ComponentSearchTool`（通过 `Tools/` 目录扩展）
- Story 3.5 的 SchematicHistory 持久化可在 `SchematicService` 中新增 `_dbContext.SchematicHistories.Add(...)` 调用

## Change Log

| Date | Change |
|------|--------|
| 2026-03-06 | 初始创建 |
| 2026-07-14 | 完成实现：安装 Microsoft.Agents.AI.OpenAI 1.0.0-rc3，创建所有源文件，调查实际 API 差异后改用 IChatClient/GetResponseAsync，修复 yield-in-try 编译限制，构建通过。Status → review |
