using AiSchGeneratorApi.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace AiSchGeneratorApi.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<SchematicHistory> SchematicHistories => Set<SchematicHistory>();
    public DbSet<SchematicSession> SchematicSessions => Set<SchematicSession>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        base.OnConfiguring(optionsBuilder);
        optionsBuilder.ConfigureWarnings(w => w.Ignore(RelationalEventId.PendingModelChangesWarning));
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<SchematicHistory>(e =>
        {
            e.HasOne(h => h.Session)
             .WithMany(s => s.Histories)
             .HasForeignKey(h => h.SessionId)
             .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(h => h.UserId).HasDatabaseName("idx_schematic_histories_user_id");
            e.HasIndex(h => h.SessionId).HasDatabaseName("idx_schematic_histories_session_id");
        });

        modelBuilder.Entity<SchematicSession>(e =>
        {
            e.HasIndex(s => s.UserId).HasDatabaseName("idx_schematic_sessions_user_id");
        });
    }
}
