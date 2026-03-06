using System.Text.Json;
using System.Text.Json.Serialization;
using AiSchGeneratorApi.Agents;
using AiSchGeneratorApi.Contracts;
using AiSchGeneratorApi.Infrastructure.Data;
using AiSchGeneratorApi.Services;
using Azure.AI.OpenAI;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// EF Core + PostgreSQL (snake_case naming via EFCore.NamingConventions)
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default"))
           .UseSnakeCaseNamingConvention());

// Controllers with camelCase JSON serialization
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.DefaultIgnoreCondition =
            JsonIgnoreCondition.WhenWritingNull;
    });

// Development CORS (for IFrame requests from EDA plugin)
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddCors(options =>
    {
        options.AddDefaultPolicy(policy =>
            policy.AllowAnyOrigin()
                  .AllowAnyMethod()
                  .AllowAnyHeader());
    });
}

// Keycloak JWT Bearer authentication (ADR-05)
// JWKS 自动从 {Authority}/.well-known/openid-configuration 获取，无需手动配置公钥
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = builder.Configuration["Keycloak:Authority"];
        options.Audience  = builder.Configuration["Keycloak:Audience"];
        options.RequireHttpsMetadata = true;

        // 返回统一格式的 401 响应体 (Story 2.3 AC)
        options.Events = new JwtBearerEvents
        {
            OnChallenge = async context =>
            {
                context.HandleResponse();
                context.Response.StatusCode  = StatusCodes.Status401Unauthorized;
                context.Response.ContentType = "application/json";
                var body = ApiResponse<object>.Fail("AUTH_REQUIRED", "Authentication is required. Provide a valid Bearer token.");
                await context.Response.WriteAsync(
                    JsonSerializer.Serialize(body, new JsonSerializerOptions
                    {
                        PropertyNamingPolicy        = JsonNamingPolicy.CamelCase,
                        DefaultIgnoreCondition      = JsonIgnoreCondition.WhenWritingNull,
                    }));
            }
        };
    });
builder.Services.AddAuthorization();

// ─────────────────────────────────────────────────────────────
// AI Chat Client (Story 3.2)
// ─────────────────────────────────────────────────────────────

// IChatClient — Singleton，系统提示由 CircuitParserAgent 在消息列表中传递
builder.Services.AddSingleton<IChatClient>(sp =>
{
    var cfg    = sp.GetRequiredService<IConfiguration>();
    var apiKey = cfg["OpenAI:ApiKey"]!;
    var model  = cfg["OpenAI:ModelName"] ?? "gpt-4o";
    var ep     = cfg["OpenAI:Endpoint"];
    var opts   = new OpenAIClientOptions();
    if (!string.IsNullOrEmpty(ep))
        opts.Endpoint = new Uri(ep);
    return new OpenAIClient(new ApiKeyCredential(apiKey), opts)
        .GetChatClient(model)
        .AsIChatClient();
});

builder.Services.AddScoped<CircuitParserAgent>();
builder.Services.AddScoped<ISchematicService, SchematicService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseCors();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
