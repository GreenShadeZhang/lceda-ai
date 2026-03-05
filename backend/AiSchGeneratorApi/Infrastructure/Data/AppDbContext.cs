using AiSchGeneratorApi.Models;
using Microsoft.EntityFrameworkCore;

namespace AiSchGeneratorApi.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<SchematicHistory> SchematicHistories => Set<SchematicHistory>();
}
