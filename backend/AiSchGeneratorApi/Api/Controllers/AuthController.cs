using AiSchGeneratorApi.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AiSchGeneratorApi.Api.Controllers;

/// <summary>
/// 受保护的认证状态端点（Story 2.3 验证用）
/// </summary>
[ApiController]
[Route("api/auth")]
[Authorize]
public class AuthController : ControllerBase
{
    /// <summary>
    /// 返回当前已认证用户的 JWT sub claim。
    /// 无 token 时返回 401（由 JwtBearer 中间件自动处理）。
    /// </summary>
    [HttpGet("status")]
    public IActionResult GetStatus()
    {
        var sub = User.FindFirst("sub")?.Value
                  ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var preferredUsername = User.FindFirst("preferred_username")?.Value;

        return Ok(ApiResponse<object>.Ok(new
        {
            sub,
            preferredUsername,
            authenticated = true,
        }));
    }
}
