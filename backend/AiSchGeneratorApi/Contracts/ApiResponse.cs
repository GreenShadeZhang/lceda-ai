namespace AiSchGeneratorApi.Contracts;

public class ApiResponse<T>
{
    public bool Success { get; init; }
    public T? Data { get; init; }
    public ApiError? Error { get; init; }

    public static ApiResponse<T> Ok(T data) =>
        new() { Success = true, Data = data };

    public static ApiResponse<T> Fail(string code, string message, object? details = null) =>
        new() { Success = false, Error = new ApiError(code, message, details) };
}
