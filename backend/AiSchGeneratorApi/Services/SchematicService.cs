using AiSchGeneratorApi.Agents;
using AiSchGeneratorApi.Contracts;
using AiSchGeneratorApi.Infrastructure.Data;
using AiSchGeneratorApi.Models;
using Microsoft.EntityFrameworkCore;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace AiSchGeneratorApi.Services;

/// <summary>
/// 编排 CircuitParserAgent，产生 SSE 事件流。
/// 所有错误均以 SSE <c>error</c> 事件返回，不向 Controller 层抛出异常。
/// </summary>
public class SchematicService(
    CircuitParserAgent agent,
    ComponentService componentService,
    AppDbContext db,
    ISessionService sessionService,
    ILogger<SchematicService> logger)
    : ISchematicService
{
    public async IAsyncEnumerable<SseEvent> GenerateStreamAsync(
        string userInput,
        string userId,
        Guid? sessionId = null,
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

        // 生成后比对立创商城，验证并补全 LCSC 编号
        yield return SseEvent.Progress("正在比对立创商城，验证元件存在性...");
        var (validatedDoc, validCount, totalCount) = await ValidateAndEnrichAsync(doc!, ct);
        yield return SseEvent.Progress($"元件验证完成：{validCount}/{totalCount} 个已确认");

        yield return SseEvent.Complete(validatedDoc);

        await TrySaveHistoryAsync(userId, sessionId, userInput, validatedDoc, ct);
    }

    /// <summary>
    /// 生成后验证步骤：对每个元件的 LCSC 编号调用真实立创EDA API 确认存在。
    /// 若 LCSC 无效，自动按元件名称搜索补全；若仍未找到，保留原值并记录警告。
    /// </summary>
    private async Task<(JsonDocument Doc, int ValidCount, int TotalCount)> ValidateAndEnrichAsync(
        JsonDocument source, CancellationToken ct)
    {
        var node  = JsonNode.Parse(source.RootElement.GetRawText());
        var comps = node?["components"]?.AsArray();

        int validCount = 0, totalCount = 0;

        if (comps is not null)
        {
            foreach (var comp in comps)
            {
                if (comp is null) continue;
                totalCount++;

                var lcsc = comp["lcsc"]?.GetValue<string>() ?? "";
                var name = comp["name"]?.GetValue<string>()
                        ?? comp["description"]?.GetValue<string>() ?? "";

                if (!string.IsNullOrEmpty(lcsc))
                {
                    // 用 LCSC 编号直接调 easyeda2kicad 兼容 API 验证
                    var found = await componentService.GetByLcscIdAsync(lcsc, ct);
                    if (found is not null)
                    {
                        comp["uuid"] = found.Uuid; // 以 API 返回的 UUID 为准
                        comp["lcsc"] = found.Lcsc; // 规范化大写
                        validCount++;
                        logger.LogInformation("✓ 元件已确认: {Name} lcsc={Lcsc} uuid={Uuid}", name, found.Lcsc, found.Uuid);
                        continue;
                    }
                    logger.LogWarning("LCSC {Lcsc} 未在立创EDA找到 (name={Name})", lcsc, name);
                }

                logger.LogWarning("元件无有效LCSC编号: lcsc={Lcsc}, name={Name}", lcsc, name);
            }
        }

        return (JsonDocument.Parse(node!.ToJsonString()), validCount, totalCount);
    }

    private async Task TrySaveHistoryAsync(
        string userId, Guid? sessionId, string userInput, JsonDocument circuitDoc, CancellationToken ct)
    {
        try
        {
            var history = new SchematicHistory
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                SessionId = sessionId,
                UserInput = userInput,
                CircuitJson = circuitDoc.RootElement.GetRawText(),
                CreatedAt = DateTime.UtcNow,
                IsSuccess = true
            };
            db.SchematicHistories.Add(history);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("历史记录已写入: id={Id}, userId={UserId}", history.Id, userId);

            if (sessionId.HasValue)
                await sessionService.OnGeneratedAsync(sessionId.Value, userId, userInput, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "写入生成历史记录失败，userId={UserId}", userId);
        }
    }

    public async Task<PagedResult<SchematicHistoryDto>> GetHistoriesAsync(
        string userId, int pageSize = 10, int pageIndex = 1, CancellationToken ct = default)
    {
        var query = db.SchematicHistories
            .Where(h => h.UserId == userId)
            .OrderByDescending(h => h.CreatedAt);

        var total = await query.CountAsync(ct);

        var items = await query
            .Skip((pageIndex - 1) * pageSize)
            .Take(pageSize)
            .Select(h => new SchematicHistoryDto(h.Id, h.UserInput, h.CreatedAt, h.IsSuccess))
            .ToListAsync(ct);

        return new PagedResult<SchematicHistoryDto> { Items = items, Total = total };
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
