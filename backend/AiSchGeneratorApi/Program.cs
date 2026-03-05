using System.Text.Json;
using System.Text.Json.Serialization;
using AiSchGeneratorApi.Infrastructure.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
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
    });
builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseCors();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
