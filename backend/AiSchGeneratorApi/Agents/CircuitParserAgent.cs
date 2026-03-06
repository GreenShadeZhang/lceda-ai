using AiSchGeneratorApi.Tools;
using Microsoft.Extensions.AI;
using System.Text.Json;

namespace AiSchGeneratorApi.Agents;

/// <summary>
/// 调用 LLM 解析用户输入并生成电路 JSON。
/// 注入 <see cref="IChatClient"/> + <see cref="ComponentSearchTool"/>，在调用时通过 <see cref="ChatOptions"/> 注册工具。
/// </summary>
public class CircuitParserAgent(IChatClient chatClient, ComponentSearchTool searchTool, ILogger<CircuitParserAgent> logger)
{
    private const string SystemPrompt = """
        你是专业的电路原理图设计助手。
        根据用户描述，生成符合规范的电路 JSON。

        **元件查找规则（必须遵守）：**
        1. 使用 SearchComponentAsync 工具查找每个元件的 UUID
        2. 收到 COMPONENT_NOT_FOUND 时，用更宽泛的搜索词重试 1 次（例：AMS1117-3.3 → AMS1117 LDO）
        3. 两次均未找到时，将该元件的 uuid 字段留空 ""
        4. 将工具返回的 uuid 写入 components[].uuid 字段

        输出格式要求（严格遵守）：
        - 只返回合法 JSON，不要包含 Markdown 代码块、注释或任何其他文字
        - JSON 必须包含 version、meta、components、net_flags、wires 字段
        - components[].lcsc 必须是真实的立创商城 C 编号（如 C6186）
        - 坐标单位为 mil（毫英寸），合理布局避免元件重叠
        """;

    /// <summary>
    /// 解析用户自然语言输入，返回符合 ADR-09 格式的电路 JSON。
    /// 最多自动重试 1 次；两次均失败则抛 <see cref="LlmParseException"/>。
    /// </summary>
    public async Task<JsonDocument> ParseAsync(string userInput, CancellationToken ct = default)
    {
        var tool    = AIFunctionFactory.Create(searchTool.SearchComponentAsync);
        var options = new ChatOptions { Tools = [tool] };
        string? lastRaw = null;
        var messages = new List<ChatMessage>
        {
            new(ChatRole.System, SystemPrompt),
            new(ChatRole.User, userInput),
        };
        for (int attempt = 0; attempt < 2; attempt++)
        {
            var response = await chatClient.GetResponseAsync(messages, options, cancellationToken: ct);
            lastRaw = response.Text;
            logger.LogInformation("LLM attempt {Attempt} raw response: {Raw}", attempt + 1, lastRaw);
            if (TryParseCircuitJson(lastRaw ?? "", out var doc))
                return doc!;
            logger.LogWarning("LLM parse attempt {Attempt} failed. Raw response: {Raw}", attempt + 1, lastRaw);
            // 将失败响应加入上下文，告知 LLM 纠错
            messages.Add(new ChatMessage(ChatRole.Assistant, lastRaw ?? ""));
            messages.Add(new ChatMessage(ChatRole.User, "你的响应包含非 JSON 内容导致解析失败。请只返回纯 JSON 对象，不要包含任何说明文字或代码块标记。"));
        }
        throw new LlmParseException(lastRaw ?? string.Empty);
    }

    private static bool TryParseCircuitJson(string raw, out JsonDocument? doc)
    {
        var json = raw.Trim();

        // 1. 剥离 ```json ... ``` 代码块
        if (json.Contains("```"))
        {
            var fenceStart = json.IndexOf("```");
            var newline    = json.IndexOf('\n', fenceStart);
            var fenceEnd   = json.LastIndexOf("```");
            if (newline >= 0 && fenceEnd > newline)
                json = json[(newline + 1)..fenceEnd].Trim();
        }

        // 2. 提取最外层 JSON 对象（跳过前后的解释文字）
        var startBrace = json.IndexOf('{');
        var endBrace   = json.LastIndexOf('}');
        if (startBrace >= 0 && endBrace > startBrace)
            json = json[startBrace..(endBrace + 1)];

        try
        {
            doc = JsonDocument.Parse(json);
            return true;
        }
        catch
        {
            doc = null;
            return false;
        }
    }
}
