namespace AiSchGeneratorApi.Agents;

/// <summary>LLM 返回无法解析为合法电路 JSON 时抛出。携带原始响应供日志记录。</summary>
public class LlmParseException(string rawResponse)
    : Exception($"LLM returned invalid circuit JSON after retries. Raw length: {rawResponse.Length}")
{
    public string RawResponse { get; } = rawResponse;
}
