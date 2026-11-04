# Microsoft Open XML compatibility check

Requires the .NET 8 SDK. The project pins Microsoft's `DocumentFormat.OpenXml` package to 3.3.0. Restore downloads the validator library; presentation contents are processed locally.

```sh
dotnet run --project tests/openxml-validator -- report.pptx portfolio.pptx
```

Pass the files downloaded by the actual browser export. The command writes one JSON result per file and exits with status 1 if any file fails. It checks:

- Office 2016 schema and package constraints for the PPTX.
- Schema constraints inside embedded chart workbooks.
- Unique `p:cNvPr` shape identifiers within each presentation part, which the SDK's schema validator does not enforce.

Use this alongside `tests/powerpoint-ui.cjs` and visual review. Passing a LibreOffice rendering check alone does not establish PowerPoint compatibility. This validator does not automate the native PowerPoint application.
