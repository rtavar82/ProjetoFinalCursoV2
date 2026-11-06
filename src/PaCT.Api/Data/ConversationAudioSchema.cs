using MySql.Data.MySqlClient;
using PaCT.Api.Configuration;

namespace PaCT.Api.Data;

public static class ConversationAudioSchema
{
    internal const string CreateSql = """
        CREATE TABLE IF NOT EXISTS consultation_message_audio (
          message_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
          content LONGBLOB NOT NULL,
          FOREIGN KEY (message_id) REFERENCES consultation_messages(id) ON DELETE RESTRICT
        ) ENGINE=InnoDB
        """;

    public static async Task PrepareAsync(DatabaseConnectionSettings settings, CancellationToken ct)
    {
        await using var connection = settings.CreateConnection();
        await connection.OpenAsync(ct);
        await using var command = new MySqlCommand(CreateSql, connection);
        await command.ExecuteNonQueryAsync(ct);
    }
}
