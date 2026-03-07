using AiSchGeneratorApi.Contracts;

namespace AiSchGeneratorApi.Services;

public interface ISessionService
{
    Task<SessionDto> CreateAsync(string userId, CancellationToken ct = default);

    Task<PagedResult<SessionDto>> GetListAsync(
        string userId, int pageSize = 20, int pageIndex = 1, CancellationToken ct = default);

    /// <returns>null 表示不存在或不属于该用户</returns>
    Task<SessionDetailDto?> GetDetailAsync(Guid sessionId, string userId, CancellationToken ct = default);

    /// <summary>生成成功后调用：更新 updated_at，若 title 为空则自动填充前 50 字符</summary>
    Task OnGeneratedAsync(Guid sessionId, string userId, string userInput, CancellationToken ct = default);
}
