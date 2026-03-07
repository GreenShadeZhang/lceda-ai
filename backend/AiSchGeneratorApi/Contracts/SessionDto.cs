namespace AiSchGeneratorApi.Contracts;

/// <summary>会话列表项 / 创建响应 DTO</summary>
public record SessionDto(Guid Id, string Title, DateTime CreatedAt, DateTime UpdatedAt);

/// <summary>会话详情 DTO（含消息列表）</summary>
public record SessionDetailDto(
    Guid Id,
    string Title,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IEnumerable<SessionHistoryItemDto> Histories);

/// <summary>详情中每条消息（不含 CircuitJson）</summary>
public record SessionHistoryItemDto(Guid Id, string UserInput, bool IsSuccess, DateTime CreatedAt);
