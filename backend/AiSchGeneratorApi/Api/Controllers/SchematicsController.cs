using AiSchGeneratorApi.Contracts;
using AiSchGeneratorApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace AiSchGeneratorApi.Api.Controllers;

/// <summary>电路原理图生成端点（ADR-06 SSE 流式响应）。</summary>
[ApiController]
[Authorize]
[Route("api/schematics")]
public class SchematicsController(ISchematicService service) : ControllerBase
{
    /// <summary>
    /// 提交电路需求，返回 SSE 流式生成进度与最终电路 JSON。
    /// Content-Type: text/event-stream；所有错误均以 SSE error 事件返回。
    /// </summary>
    [HttpPost("generate")]
    public async Task Generate([FromBody] GenerateRequest req, CancellationToken ct)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";

        var userId = User.FindFirst("sub")?.Value
                  ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                  ?? string.Empty;

        await foreach (var evt in service.GenerateStreamAsync(req.UserInput, userId, req.SessionId, ct))
        {
            await Response.WriteAsync($"data: {evt.Payload}\n\n", ct);
            await Response.Body.FlushAsync(ct);
        }

        await Response.WriteAsync("data: [DONE]\n\n", ct);
        await Response.Body.FlushAsync(ct);
    }

    /// <summary>
    /// 分页查询当前用户的历史记录，按创建时间倒序排列。
    /// GET /api/schematics?pageSize=10&amp;pageIndex=1
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetHistories(
        [FromQuery] int pageSize = 10,
        [FromQuery] int pageIndex = 1,
        CancellationToken ct = default)
    {
        var userId = User.FindFirst("sub")?.Value
                  ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                  ?? string.Empty;

        var result = await service.GetHistoriesAsync(userId, pageSize, pageIndex, ct);
        return Ok(ApiResponse<PagedResult<SchematicHistoryDto>>.Ok(result));
    }
}

/// <summary>生成请求 DTO。</summary>
public record GenerateRequest(string UserInput, Guid? SessionId = null);
