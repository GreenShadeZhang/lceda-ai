using Microsoft.Extensions.AI;
using System.Text.Json;

namespace AiSchGeneratorApi.Agents;

/// <summary>
/// 调用 LLM 解析用户输入并生成电路 JSON。
/// 注入 <see cref="IChatClient"/>，通过 <see cref="IChatClient.CompleteAsync"/> 调用 LLM。
/// </summary>
public class CircuitParserAgent(IChatClient chatClient, ILogger<CircuitParserAgent> logger)
{
    private const string SystemPrompt = """
        你是专业的电路原理图设计助手。
        根据用户描述，生成符合规范的电路 JSON。

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
        string? lastRaw = null;
        for (int attempt = 0; attempt < 2; attempt++)
        {
            var messages = new List<ChatMessage>
            {
                new(ChatRole.System, SystemPrompt),
                new(ChatRole.User, userInput),
            };
            var response = await chatClient.GetResponseAsync(messages, cancellationToken: ct);
            lastRaw = response.Text;
            if (TryParseCircuitJson(lastRaw ?? "", out var doc))
                return doc!;
            logger.LogWarning("LLM parse attempt {Attempt} failed. Raw response: {Raw}", attempt + 1, lastRaw);
        }
        throw new LlmParseException(lastRaw ?? string.Empty);
    }

    private static bool TryParseCircuitJson(string raw, out JsonDocument? doc)
    {
        var json = raw.Trim();
        // LLM 有时会返回 ```json ... ``` 代码块，剥离后再解析
        if (json.StartsWith("```"))
        {
            var start = json.IndexOf('\n') + 1;
            var end   = json.LastIndexOf("```");
            json = end > start ? json[start..end].Trim() : json;
        }
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
