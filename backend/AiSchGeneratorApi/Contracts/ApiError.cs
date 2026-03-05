namespace AiSchGeneratorApi.Contracts;

public record ApiError(string Code, string Message, object? Details = null);
