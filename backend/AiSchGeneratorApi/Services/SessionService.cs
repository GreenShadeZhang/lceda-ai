using AiSchGeneratorApi.Contracts;
using AiSchGeneratorApi.Infrastructure.Data;
using AiSchGeneratorApi.Models;
using Microsoft.EntityFrameworkCore;

namespace AiSchGeneratorApi.Services;

public class SessionService(AppDbContext db, ILogger<SessionService> logger) : ISessionService
{
    public async Task<SessionDto> CreateAsync(string userId, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        var session = new SchematicSession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Title = string.Empty,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.SchematicSessions.Add(session);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("会话已创建: id={Id}, userId={UserId}", session.Id, userId);
        return new SessionDto(session.Id, session.Title, session.CreatedAt, session.UpdatedAt);
    }

    public async Task<PagedResult<SessionDto>> GetListAsync(
        string userId, int pageSize = 20, int pageIndex = 1, CancellationToken ct = default)
    {
        var query = db.SchematicSessions
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.UpdatedAt);

        var total = await query.CountAsync(ct);
        var items = await query
            .Skip((pageIndex - 1) * pageSize)
            .Take(pageSize)
            .Select(s => new SessionDto(s.Id, s.Title, s.CreatedAt, s.UpdatedAt))
            .ToListAsync(ct);

        return new PagedResult<SessionDto> { Items = items, Total = total };
    }

    public async Task<SessionDetailDto?> GetDetailAsync(
        Guid sessionId, string userId, CancellationToken ct = default)
    {
        var session = await db.SchematicSessions
            .Include(s => s.Histories.OrderBy(h => h.CreatedAt))
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.UserId == userId, ct);

        if (session is null) return null;

        var histories = session.Histories
            .Select(h => new SessionHistoryItemDto(h.Id, h.UserInput, h.IsSuccess, h.CreatedAt));

        return new SessionDetailDto(session.Id, session.Title, session.CreatedAt, session.UpdatedAt, histories);
    }

    public async Task OnGeneratedAsync(
        Guid sessionId, string userId, string userInput, CancellationToken ct = default)
    {
        var session = await db.SchematicSessions
            .FirstOrDefaultAsync(s => s.Id == sessionId && s.UserId == userId, ct);

        if (session is null)
        {
            logger.LogWarning("OnGeneratedAsync: 会话不存在或不属于当前用户, sessionId={Id}", sessionId);
            return;
        }

        session.UpdatedAt = DateTime.UtcNow;
        if (string.IsNullOrEmpty(session.Title))
            session.Title = userInput.Length <= 50 ? userInput : userInput[..50];

        await db.SaveChangesAsync(ct);
    }
}
