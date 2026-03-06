using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AiSchGeneratorApi.Migrations
{
    /// <inheritdoc />
    public partial class AddSchematicSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "session_id",
                table: "schematic_histories",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "schematic_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "text", nullable: false),
                    title = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_schematic_sessions", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "idx_schematic_histories_session_id",
                table: "schematic_histories",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "idx_schematic_histories_user_id",
                table: "schematic_histories",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "idx_schematic_sessions_user_id",
                table: "schematic_sessions",
                column: "user_id");

            migrationBuilder.AddForeignKey(
                name: "fk_schematic_histories_schematic_sessions_session_id",
                table: "schematic_histories",
                column: "session_id",
                principalTable: "schematic_sessions",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_schematic_histories_schematic_sessions_session_id",
                table: "schematic_histories");

            migrationBuilder.DropTable(
                name: "schematic_sessions");

            migrationBuilder.DropIndex(
                name: "idx_schematic_histories_session_id",
                table: "schematic_histories");

            migrationBuilder.DropIndex(
                name: "idx_schematic_histories_user_id",
                table: "schematic_histories");

            migrationBuilder.DropColumn(
                name: "session_id",
                table: "schematic_histories");
        }
    }
}
