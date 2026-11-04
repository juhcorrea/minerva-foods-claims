using System.Text.Json;
using System.Xml.Linq;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

// Validate the exported package using Microsoft's official Office 2016 schema,
// including embedded chart workbooks. LibreOffice accepting a file is not a
// substitute for these schema checks. Shape-ID uniqueness is checked separately
// because the SDK does not report that PowerPoint-specific repair condition.
if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: dotnet run --project tests/openxml-validator -- file.pptx [other.pptx ...]");
    return 2;
}

var failed = false;
foreach (var file in args)
{
    var issues = new List<ValidationIssue>();
    var workbookCount = 0;
    try
    {
        using var deck = PresentationDocument.Open(file, false);
        ValidateSchema(deck, "presentation", issues);
        foreach (var part in AllParts(deck))
        {
            if (part.ContentType.EndsWith("+xml", StringComparison.Ordinal))
                ValidateShapeIds(part, issues);
            if (part is not EmbeddedPackagePart embedded ||
                embedded.ContentType != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                continue;
            using var source = embedded.GetStream(FileMode.Open, FileAccess.Read);
            using var buffer = new MemoryStream();
            source.CopyTo(buffer);
            buffer.Position = 0;
            using var workbook = SpreadsheetDocument.Open(buffer, false);
            workbookCount++;
            ValidateSchema(workbook, embedded.Uri.ToString(), issues);
        }
    }
    catch (Exception error)
    {
        issues.Add(new ValidationIssue("PackageOpenError", "package", "", error.Message));
    }
    failed |= issues.Count > 0;
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        file,
        sdk = "DocumentFormat.OpenXml 3.3.0",
        target = "Office2016",
        embeddedWorkbooks = workbookCount,
        errorCount = issues.Count,
        errors = issues
    }));
}
return failed ? 1 : 0;

static void ValidateSchema(OpenXmlPackage package, string scope, List<ValidationIssue> issues)
{
    var validator = new OpenXmlValidator(FileFormatVersions.Office2016) { MaxNumberOfErrors = 500 };
    foreach (var error in validator.Validate(package))
        issues.Add(new ValidationIssue(error.Id, scope + ":" + error.Part?.Uri, error.Path?.XPath ?? "", error.Description));
}

static IEnumerable<OpenXmlPart> AllParts(OpenXmlPackage package)
{
    var visited = new HashSet<Uri>();
    var pending = new Stack<OpenXmlPart>(package.Parts.Select(pair => pair.OpenXmlPart));
    while (pending.Count > 0)
    {
        var part = pending.Pop();
        if (!visited.Add(part.Uri)) continue;
        yield return part;
        foreach (var child in part.Parts) pending.Push(child.OpenXmlPart);
    }
}

static void ValidateShapeIds(OpenXmlPart part, List<ValidationIssue> issues)
{
    using var stream = part.GetStream(FileMode.Open, FileAccess.Read);
    var xml = XDocument.Load(stream);
    XNamespace ns = "http://schemas.openxmlformats.org/presentationml/2006/main";
    foreach (var duplicate in xml.Descendants(ns + "cNvPr")
                 .Select(element => element.Attribute("id")?.Value)
                 .Where(id => id != null).GroupBy(id => id)
                 .Where(group => group.Count() > 1))
        issues.Add(new ValidationIssue("DuplicateShapeId", part.Uri.ToString(), "p:cNvPr/@id", $"ID {duplicate.Key} occurs {duplicate.Count()} times in the same slide part."));
}

record ValidationIssue(string Id, string Part, string Path, string Description);
