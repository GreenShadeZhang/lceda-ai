using AiSchGeneratorApi.Agents;
using System.Runtime.CompilerServices;
using System.Text.Json;

namespace AiSchGeneratorApi.Services;

/// <summary>
/// 编排 CircuitParserAgent，产生 SSE 事件流。
/// 所有错误均以 SSE <c>error</c> 事件返回，不向 Controller 层抛出异常。
/// </summary>
public class SchematicService(CircuitParserAgent agent, ILogger<SchematicService> logger)
    : ISchematicService
{
    public async IAsyncEnumerable<SseEvent> GenerateStreamAsync(
        string userInput,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        yield return SseEvent.Progress("正在分析电路需求...");
        yield return SseEvent.Progress("正在调用 AI 模型生成电路...");

        // C# 不允许在含 catch 子句的 try 块中使用 yield，因此提取为独立方法
        var (success, doc, errorEvt) = await TryParseAsync(userInput, ct);

        if (!success)
        {
            if (errorEvt is not null)
                yield return errorEvt;
            yield break;
        }

        yield return SseEvent.Complete(doc!);
    }

    private async Task<(bool Success, JsonDocument? Doc, SseEvent? Error)> TryParseAsync(
        string userInput, CancellationToken ct)
    {
        try
        {
            var doc = await agent.ParseAsync(userInput, ct);
            return (true, doc, null);
        }
        catch (OperationCanceledException)
        {
            return (false, null, null);
        }
        catch (LlmParseException ex)
        {
            logger.LogError("LLM 解析失败，原始响应: {Raw}", ex.RawResponse);
            return (false, null, SseEvent.Error("LLM_PARSE_ERROR", "LLM 返回无效的电路 JSON，请稍后重试"));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "电路生成时发生意外错误");
            return (false, null, SseEvent.Error("INTERNAL_ERROR", "服务内部错误，请稍后重试"));
        }
    }
}
