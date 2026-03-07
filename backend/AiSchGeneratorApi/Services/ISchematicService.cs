using AiSchGeneratorApi.Contracts;

namespace AiSchGeneratorApi.Services;

/// <summary>电路图生成服务，产生 SSE 事件流。</summary>
public interface ISchematicService
{
    /// <summary>根据用户输入通过 LLM 生成电路 JSON，以 SSE 事件异步枚举返回。</summary>
    IAsyncEnumerable<SseEvent> GenerateStreamAsync(
        string userInput,
        string userId,
        Guid? sessionId = null,
        CancellationToken ct = default);

    /// <summary>分页查询当前用户的历史记录，按创建时间倒序排列。</summary>
    Task<PagedResult<SchematicHistoryDto>> GetHistoriesAsync(
        string userId,
        int pageSize = 10,
        int pageIndex = 1,
        CancellationToken ct = default);
}
