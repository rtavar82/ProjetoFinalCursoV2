using System.Net;
using System.Text;
using MimeKit;

namespace PaCT.Api.Identity;

// The same approved text feeds both email formats; the layout does not define business rules.
internal static class AppointmentEmailLayout
{
    internal static MimeEntity Create(string subject, string body, string publicWebUrl) => new BodyBuilder {
        TextBody = Wrap(body), HtmlBody = Html(subject, body, publicWebUrl)
    }.ToMessageBody();

    internal static string Html(string subject, string body, string publicWebUrl)
    {
        static string E(string text) => WebUtility.HtmlEncode(text);
        var html = new StringBuilder("<!doctype html><html lang=\"pt-PT\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body style=\"margin:0;background:#f5f7f2;color:#234136;font-family:Arial,sans-serif\"><table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\"><tr><td style=\"padding:20px 12px\"><table role=\"presentation\" align=\"center\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:620px;background:#fff;border:1px solid #dce5db;border-radius:16px\"><tr><td style=\"padding:26px 22px;font-size:15px;line-height:1.6;overflow-wrap:anywhere\">");
        html.Append("<p style=\"font-size:22px;font-weight:bold;margin:0 0 20px\">PaCT</p><h1 style=\"font-size:21px;line-height:1.3;margin:0 0 20px\">").Append(E(subject.Replace("PaCT — ", ""))).Append("</h1>");
        foreach (var block in body.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries))
        {
            var lines = block.Split('\n'); var start = 0;
            if (lines[^1] == publicWebUrl + "/#agenda")
            {
                if (lines.Length > 1) html.Append("<p style=\"margin:0 0 12px\">").Append(string.Join("<br>", lines[..^1].Select(E))).Append("</p>");
                html.Append("<p style=\"margin:24px 0 0\"><a style=\"display:inline-block;padding:12px 20px;background:#38634f;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold\" href=\"").Append(E(lines[^1])).Append("\">Abrir a PaCT</a></p>"); continue;
            }
            if (lines[0] is "Condições de pagamento" or "Cancelamentos ou faltas" or "Forma de pagamento")
            { html.Append("<h2 style=\"font-size:16px;margin:24px 0 10px\">").Append(E(lines[0])).Append("</h2>"); start = 1; }
            var bullets = lines.Skip(start).ToArray();
            if (bullets.Length > 0 && bullets.All(line => line.StartsWith("- ")))
            {
                html.Append("<ul style=\"margin:0 0 18px;padding-left:21px\">");
                foreach (var line in bullets) html.Append("<li style=\"margin:0 0 10px\">").Append(E(line[2..])).Append("</li>");
                html.Append("</ul>");
            }
            else html.Append("<p style=\"margin:0 0 18px\">").Append(string.Join("<br>", lines.Skip(start).Select(E))).Append("</p>");
        }
        return html.Append("</td></tr></table></td></tr></table></body></html>").ToString();
    }
    internal static string Wrap(string body)
    {
        var lines = new List<string>();
        foreach (var original in body.Replace("\r\n", "\n").Split('\n'))
        {
            var line = original;
            while (line.Length > 78)
            {
                var at = line.LastIndexOf(' ', 78); if (at <= 0) break;
                lines.Add(line[..at]); line = line[(at + 1)..];
            }
            lines.Add(line);
        }
        return string.Join("\n", lines);
    }
}
