using System.Text.Json;

namespace AiSchGeneratorApi.Services;

/// <summary>SSE 单条事件，持有已序列化的 JSON payload 字符串。</summary>
public record SseEvent(string Type, string Payload)
{
    private static readonly JsonSerializerOptions _opts =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static SseEvent Progress(string text) =>
        new("progress", JsonSerializer.Serialize(new { type = "progress", text }, _opts));

    public static SseEvent Complete(JsonDocument circuitDoc) =>
        new("complete", JsonSerializer.Serialize(
            new { type = "complete", circuitJson = circuitDoc }, _opts));

    public static SseEvent Error(string code, string message) =>
        new("error", JsonSerializer.Serialize(
            new { type = "error", code, message }, _opts));
}
