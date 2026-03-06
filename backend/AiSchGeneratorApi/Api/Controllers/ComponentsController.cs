using AiSchGeneratorApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AiSchGeneratorApi.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/components")]
public class ComponentsController(ComponentService componentService) : ControllerBase
{
    /// <summary>代理立创库元件搜索，供前端直接调试用。</summary>
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string q, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q))
            return BadRequest(new { error = "参数 q 不能为空" });

        var results = await componentService.SearchAsync(q, ct);
        return Ok(results);
    }
}
