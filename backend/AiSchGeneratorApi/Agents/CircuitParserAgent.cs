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
        根据用户描述，利用元件数据手册中的典型应用电路知识生成完整电路 JSON。

        **设计原则（行业标准）：**
        - 有 datasheet 就有电路：每款芯片数据手册都含有"典型应用电路"，以此为设计依据
        - 先确定核心芯片，再按数据手册补全全部外围元件（旁路电容、滤波电容、分压电阻等）
        - LDO 典型外围：输入端 100nF 陶瓷去耦电容（接 GND），输出端 10µF 电容 + 100nF 陶瓷（均接 GND）

        **LCSC 编号使用规则（必须遵守）：**
        工具 SearchComponentAsync 接受 LCSC 编号（如 C6186），不接受元件名称搜索。
        你必须先根据训练数据知识选定 LCSC 编号，再调用工具验证并获取 UUID。

        常用元件 LCSC 编号参考（可直接使用）：
        - AMS1117-3.3（SOT-223）→ C6186
        - AMS1117-5.0（SOT-223）→ C6187
        - 100nF 陶瓷电容 0402 → C21190
        - 100nF 陶瓷电容 0603 → C57112
        - 10µF 陶瓷电容 0805 → C17024
        - 1µF 陶瓷电容 0402 → C52923
        - 10kΩ 电阻 0402 → C25744
        - 100Ω 电阻 0402 → C25076
        - 2P 2.54mm 插件连接器 → C58404
        - LED 0805 红色 → C84256
        - 1N4148 二极管 → C81598
        - NPN S8050 三极管 → C6902
        - USB Type-C 16P → C165948

        调用规则：
        1. 对每个元件按上表选定 LCSC 编号，调用 SearchComponentAsync(lcscId) 验证并获取 UUID
        2. 若 COMPONENT_NOT_FOUND，尝试相近型号重试一次
        3. 两次均未找到时，lcsc 和 uuid 字段留空 ""
        4. lcsc、uuid 字段只能使用工具返回的值，不得编造

        **输出格式要求（严格遵守）：**
        - 只返回合法 JSON，不包含代码块标记、注释或任何说明文字
        - JSON 必须含 version、meta、components、net_flags、nets 字段
        - components[].lcsc 必须是工具返回的真实 C 编号（如 C6186）
        - components[].uuid 使用工具返回的 UUID
        - components[].ref 必须唯一（如 U1、C1、C2、R1），供 nets 引用
        - 坐标单位：mil（毫英寸），布局整洁，元件间距 ≥ 200 mil

        **nets 网络连接定义（关键）：**
        - nets 数组定义所有电气连接关系，插件据此自动连线
        - 每个网络: {"net": "网络名", "pins": ["ref.pinNumber", ...]}
        - pins 中的 ref 对应 components[].ref，pinNumber 对应数据手册引脚编号
        - 示例: {"net": "GND", "pins": ["U1.1", "C1.2", "C2.2", "C3.2"]}
        - 示例: {"net": "VOUT", "pins": ["U1.2", "C2.1", "C3.1"]}
        - 每个网络至少包含 2 个引脚
        - 所有有电气连接的引脚都必须出现在某个 net 中
        - 常见 AMS1117-3.3 引脚编号: 1=GND/ADJ, 2=VOUT, 3=VIN (SOT-223 tab=1)
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
