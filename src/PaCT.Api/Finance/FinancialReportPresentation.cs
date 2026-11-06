using System.Globalization;
using System.IO.Compression;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using PaCT.Api.Consultations;

namespace PaCT.Api.Finance;

public sealed record FinancialReportRow(string Label, decimal Value, string Unit = "EUR");
public sealed record FinancialReportSection(string Title, FinancialReportRow[] Rows);

public static class FinancialReportPresentation
{
    private static string Origin(string? key) => key switch
    {
        "GeneralCredit" => "Crédito geral", "Consultation" => "Consultas", "Sale" => "Outras entradas ligadas a vendas",
        "EventService" => "Grupos e retiros", "Pack" => "Compras de packs", _ => "Outras entradas"
    };

    public static FinancialReportSection[] Sections(JsonObject report)
    {
        decimal Number(string key) => report[key]!.GetValue<decimal>();
        FinancialReportRow Money(string key, string label) => new(label, Number(key));
        FinancialReportRow Count(string key, string label, string unit = "registos") => new(label, Number(key), unit);
        var sections = new List<FinancialReportSection>();
        if (report["spending"] is JsonObject spending)
        {
            var rows = new List<FinancialReportRow>();
            void Add(string key, string label) { if (spending[key] is JsonNode value) rows.Add(new(label, value.GetValue<decimal>())); }
            Add("resultAfterInvestments", "Resultado do período após investimentos");
            Add("resultBeforeInvestments", "Resultado antes dos investimentos");
            Add("paid", "Pagamentos de despesas e investimentos");
            Add("operatingPayments", "Pagamentos de despesas");
            Add("investmentPayments", "Pagamentos de investimentos");
            if (spending["unclassifiedPayments"]!.GetValue<decimal>() > 0) Add("unclassifiedPayments", "Pagamentos mistos sem repartição");
            sections.Add(new("Resultado do período", rows.ToArray()));
            sections.Add(new("Gastos e investimentos registados", [
                new("Despesas registadas", spending["knownExpenses"]!.GetValue<decimal>()),
                new("Investimentos registados", spending["knownInvestments"]!.GetValue<decimal>()),
                new("Por pagar nos registos do período", spending["outstanding"]!.GetValue<decimal>()),
                ..spending["categories"]!.AsArray().Select(category => new FinancialReportRow(
                    (category!["kind"]!.GetValue<string>() == "Investment" ? "Investimento · " : "Despesa · ") + category["name"]!.GetValue<string>(),
                    category["amount"]!.GetValue<decimal>()))
            ]));
        }
        sections.Add(new("Entradas e devoluções", [
            Money("received", "Total recebido"), Money("saleReceipts", "Vendas pagas"),
            Money("anonymousEventReceipts", "Recebimentos de eventos sem ficha associada"),
            ..report["receiptOrigins"]!.AsArray().Select(row => new FinancialReportRow(Origin(row!["origin"]?.GetValue<string>()), row["amount"]!.GetValue<decimal>())),
            Money("refunded", "Total devolvido")
        ]));
        sections.Add(new("Crédito e liquidações", [
            Money("availableBalance", "Crédito disponível"), Money("netBalance", "Saldo global líquido"),
            Money("globalNegativeDebt", "Dívida global por saldo negativo"),
            Money("settled", "Crédito utilizado, após reposições"), Money("settlementReturns", "Crédito reposto de liquidações"),
            Money("creditRestored", "Outras reposições de crédito"), Money("corrections", "Correções e compensações")
        ]));
        sections.Add(new("Valores por receber ou devolver à data do apuramento", [
            Money("activeCollectionAmount", "Cobranças ativas de consultas"), Money("oldDebtAmount", "Dívidas antigas de consultas"),
            Money("totalUnpaid", "Total conhecido de consultas por pagar"), Money("unpaidPackAmount", "Compras de packs por pagar"),
            Money("unpaidEventAmount", "Participações por pagar"), Money("retreatRestitutionsPending", "Restituições de retiros pendentes"),
            Count("unpaidConsultations", "Consultas por pagar"), Count("pendingContributions", "Contribuições pendentes"),
            Count("undefinedContributions", "Contribuições sem valor definido")
        ]));
        sections.Add(new("Atividade e sessões de pack", [
            Count("paidConsultations", "Consultas do período pagas"), Count("noDebtConsultations", "Consultas sem dívida"),
            Count("freeConsultations", "Consultas gratuitas"), Count("giftConsultations", "Consultas oferecidas"),
            Count("packConsultations", "Consultas cobertas por pack"), Count("packSessionsPurchased", "Sessões em packs pagos adquiridos no período", "sessões"),
            Count("packSessionsUsed", "Sessões de pack utilizadas no período", "sessões"),
            Count("packSessionsAvailable", "Sessões de pack disponíveis à data do apuramento", "sessões")
        ]));
        return sections.ToArray();
    }

    public static string[] Notes(JsonObject report)
    {
        var notes = new List<string> { report["description"]!.GetValue<string>() };
        if (!report["businessScope"]!.GetValue<bool>())
            notes.Add("O resultado geral e as despesas ficam disponíveis sem filtros de cliente, origem ou tipo de movimento.");
        else if (report["spending"] is null)
            notes.Add("Os dados de despesas e investimentos ainda não estão disponíveis.");
        if (!report["salesPrepared"]!.GetValue<bool>())
            notes.Add("Os dados de vendas ainda não estão disponíveis. O resultado do período fica por apurar.");
        if (report["spending"]?["unclassifiedPayments"]?.GetValue<decimal>() > 0)
            notes.Add("Os pagamentos mistos entram no resultado final. O resultado antes dos investimentos fica por apurar quando não é possível separar os valores pagos.");
        if (report["legacyReceiptDates"]!.GetValue<int>() > 0)
            notes.Add("Alguns recebimentos anteriores usam a data de registo por não terem data efetiva própria.");
        return notes.ToArray();
    }

    public static byte[] Workbook(FinancialReportSection[] sections, string[] notes, DateTimeOffset now, DateTimeOffset? from,
        DateTimeOffset? to, string scope)
    {
        XNamespace sheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        static string Date(DateTimeOffset value) => AgendaRules.LocalDate(value).ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        XElement TextCell(string value) => new(sheet + "c", new XAttribute("t", "inlineStr"), new XElement(sheet + "is", new XElement(sheet + "t", value)));
        var rows = new List<XElement>
        {
            new(sheet + "row", TextCell("PaCT — Relatório financeiro")),
            new(sheet + "row", TextCell("Período"), TextCell(from is null ? "Sem início" : Date(from.Value)),
                TextCell(to is null ? "Sem fim" : Date(to.Value.AddTicks(-1)))),
            new(sheet + "row", TextCell("Apuramento"), TextCell(TimeZoneInfo.ConvertTime(now, AgendaRules.Lisbon).ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture))),
            new(sheet + "row", TextCell("Âmbito"), TextCell(scope))
        };
        foreach (var section in sections)
        {
            rows.Add(new(sheet + "row"));
            rows.Add(new(sheet + "row", TextCell(section.Title), TextCell("Valor"), TextCell("Unidade")));
            foreach (var row in section.Rows)
                rows.Add(new(sheet + "row", TextCell(row.Label), new XElement(sheet + "c", new XElement(sheet + "v", row.Value)), TextCell(row.Unit)));
        }
        rows.Add(new(sheet + "row"));
        foreach (var note in notes) rows.Add(new(sheet + "row", TextCell(note)));
        var worksheet = new XElement(sheet + "worksheet",
            new XElement(sheet + "cols", new XElement(sheet + "col", new XAttribute("min", 1), new XAttribute("max", 1), new XAttribute("width", 62), new XAttribute("customWidth", 1)),
                new XElement(sheet + "col", new XAttribute("min", 2), new XAttribute("max", 3), new XAttribute("width", 20), new XAttribute("customWidth", 1))),
            new XElement(sheet + "sheetData", rows));
        using var bytes = new MemoryStream();
        using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Add(string path, string xml)
            {
                using var writer = new StreamWriter(zip.CreateEntry(path, CompressionLevel.Fastest).Open());
                writer.Write(xml);
            }
            Add("[Content_Types].xml", """
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                </Types>
                """);
            Add("_rels/.rels", """
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>
                """);
            Add("xl/workbook.xml", """
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets>
                </workbook>
                """);
            Add("xl/_rels/workbook.xml.rels", """
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                </Relationships>
                """);
            Add("xl/worksheets/sheet1.xml", worksheet.ToString(SaveOptions.DisableFormatting));
        }
        return bytes.ToArray();
    }
}
