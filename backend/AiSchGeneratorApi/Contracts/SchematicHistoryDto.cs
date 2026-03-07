namespace AiSchGeneratorApi.Contracts;

/// <summary>历史记录列表项 DTO（不含大字段 CircuitJson）。</summary>
public record SchematicHistoryDto(
    Guid Id,
    string UserInput,
    DateTime CreatedAt,
    bool IsSuccess
);
