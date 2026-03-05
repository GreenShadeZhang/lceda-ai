using System.Text.Json;

namespace AiSchGeneratorApi.Models;

public class SchematicHistory
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = string.Empty;     // 来自 Keycloak sub claim
    public string UserInput { get; set; } = string.Empty;  // 原始自然语言需求
    public string CircuitJson { get; set; } = string.Empty; // 生成的电路 JSON
    public DateTime CreatedAt { get; set; }
    public bool IsSuccess { get; set; }
}
