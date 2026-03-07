using AiSchGeneratorApi.Contracts;
using AiSchGeneratorApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace AiSchGeneratorApi.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/sessions")]
public class SessionsController(ISessionService sessions) : ControllerBase
{
    private string UserId =>
        User.FindFirst("sub")?.Value ??
        User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? string.Empty;

    /// <summary>创建新会话 (AC1)</summary>
    [HttpPost]
    public async Task<IActionResult> Create(CancellationToken ct)
    {
        var session = await sessions.CreateAsync(UserId, ct);
        return Ok(ApiResponse<SessionDto>.Ok(session));
    }

    /// <summary>列出当前用户的会话，按 updated_at 降序 (AC2)</summary>
    [HttpGet]
    public async Task<IActionResult> GetList(
        [FromQuery] int pageSize = 20,
        [FromQuery] int pageIndex = 1,
        CancellationToken ct = default)
    {
        var result = await sessions.GetListAsync(UserId, pageSize, pageIndex, ct);
        return Ok(ApiResponse<PagedResult<SessionDto>>.Ok(result));
    }

    /// <summary>获取会话详情（含消息列表）。不存在或不属于当前用户时返回 403 (AC3, AC4)</summary>
    [HttpGet("{sessionId:guid}")]
    public async Task<IActionResult> GetDetail(Guid sessionId, CancellationToken ct)
    {
        var detail = await sessions.GetDetailAsync(sessionId, UserId, ct);
        if (detail is null)
            return StatusCode(403, ApiResponse<object>.Fail("FORBIDDEN", "会话不存在或无权访问"));
        return Ok(ApiResponse<SessionDetailDto>.Ok(detail));
    }
}
