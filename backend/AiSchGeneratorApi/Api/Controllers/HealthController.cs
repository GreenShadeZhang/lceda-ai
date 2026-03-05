using Microsoft.AspNetCore.Mvc;
using AiSchGeneratorApi.Contracts;

namespace AiSchGeneratorApi.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok(ApiResponse<string>.Ok("healthy"));
    }
}
