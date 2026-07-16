import type { InventoryImportFormat } from "./schemas";

export interface InventoryImportEntry {
  lineNumber: number;
  secret: string;
}
export interface InventoryImportDuplicate {
  firstLine: number;
  duplicateLine: number;
}

export type InventoryImportIssueCode =
  | "empty_file"
  | "missing_secret_column"
  | "empty_secret"
  | "malformed_csv";

export interface InventoryImportIssue {
  code: InventoryImportIssueCode;
  lineNumber: number | null;
  message: string;
}

export interface InventoryImportResult {
  format: InventoryImportFormat;
  entries: InventoryImportEntry[];
  duplicates: InventoryImportDuplicate[];
  issues: InventoryImportIssue[];
  valid: boolean;
}

interface CsvRow {
  fields: string[];
  lineNumber: number;
}

interface CsvRowsResult {
  rows: CsvRow[];
  issues: InventoryImportIssue[];
}

function stripBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function findDuplicates(entries: InventoryImportEntry[]): InventoryImportDuplicate[] {
  const firstLines = new Map<string, number>();
  const duplicates: InventoryImportDuplicate[] = [];

  for (const entry of entries) {
    const firstLine = firstLines.get(entry.secret);
    if (firstLine === undefined) {
      firstLines.set(entry.secret, entry.lineNumber);
    } else {
      duplicates.push({ firstLine, duplicateLine: entry.lineNumber });
    }
  }

  return duplicates;
}

function finishResult(
  format: InventoryImportFormat,
  entries: InventoryImportEntry[],
  issues: InventoryImportIssue[],
): InventoryImportResult {
  if (entries.length === 0 && !issues.some((issue) => issue.code === "empty_file")) {
    issues.push({
      code: "empty_file",
      lineNumber: null,
      message: "O arquivo não contém unidades de estoque.",
    });
  }

  const duplicates = findDuplicates(entries);
  return {
    format,
    entries,
    duplicates,
    issues,
    valid: issues.length === 0 && duplicates.length === 0 && entries.length > 0,
  };
}

export function parseTxtInventory(content: string): InventoryImportResult {
  const entries: InventoryImportEntry[] = [];
  const normalized = stripBom(content).replace(/\r\n?/g, "\n");

  for (const [index, rawLine] of normalized.split("\n").entries()) {
    const secret = rawLine.trim();
    if (secret.length > 0) {
      entries.push({ lineNumber: index + 1, secret });
    }
  }

  return finishResult("txt", entries, []);
}

function parseCsvRows(content: string): CsvRowsResult {
  const rows: CsvRow[] = [];
  const issues: InventoryImportIssue[] = [];
  const input = stripBom(content);
  let fields: string[] = [];
  let field = "";
  let rowLineNumber = 1;
  let currentLine = 1;
  let inQuotes = false;
  let afterClosingQuote = false;

  const pushRow = () => {
    fields.push(field);
    rows.push({ fields, lineNumber: rowLineNumber });
    fields = [];
    field = "";
    afterClosingQuote = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        field += character;
        if (character === "\n") currentLine += 1;
      }
      continue;
    }

    if (afterClosingQuote) {
      if (character === ",") {
        fields.push(field);
        field = "";
        afterClosingQuote = false;
        continue;
      }
      if (character === "\r" || character === "\n") {
        pushRow();
        if (character === "\r" && input[index + 1] === "\n") index += 1;
        currentLine += 1;
        rowLineNumber = currentLine;
        continue;
      }
      if (/\s/.test(character)) continue;

      issues.push({
        code: "malformed_csv",
        lineNumber: currentLine,
        message: `CSV inválido na linha ${currentLine}: conteúdo após aspas de fechamento.`,
      });
      afterClosingQuote = false;
      field += character;
      continue;
    }

    if (character === '"') {
      if (field.trim().length === 0) {
        field = "";
        inQuotes = true;
      } else {
        issues.push({
          code: "malformed_csv",
          lineNumber: currentLine,
          message: `CSV inválido na linha ${currentLine}: aspas em campo não delimitado.`,
        });
        field += character;
      }
    } else if (character === ",") {
      fields.push(field.trim());
      field = "";
    } else if (character === "\r" || character === "\n") {
      pushRow();
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      currentLine += 1;
      rowLineNumber = currentLine;
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    issues.push({
      code: "malformed_csv",
      lineNumber: rowLineNumber,
      message: `CSV inválido na linha ${rowLineNumber}: campo com aspas não foi fechado.`,
    });
  }

  if (field.length > 0 || fields.length > 0 || afterClosingQuote) pushRow();

  return { rows, issues };
}

export function parseCsvInventory(content: string): InventoryImportResult {
  const parsed = parseCsvRows(content);
  const rows = parsed.rows.filter((row) => row.fields.some((field) => field.trim().length > 0));
  const issues = [...parsed.issues];

  if (rows.length === 0) return finishResult("csv", [], issues);

  const header = rows[0];
  if (header === undefined) return finishResult("csv", [], issues);

  const secretIndex = header.fields.findIndex(
    (field) => field.trim().toLocaleLowerCase("pt-BR") === "secret",
  );

  if (secretIndex < 0) {
    issues.push({
      code: "missing_secret_column",
      lineNumber: header.lineNumber,
      message: 'O CSV deve conter uma coluna chamada "secret".',
    });
    return finishResult("csv", [], issues);
  }

  const entries: InventoryImportEntry[] = [];
  for (const row of rows.slice(1)) {
    const rawSecret = row.fields[secretIndex];
    const secret = rawSecret?.trim() ?? "";
    if (secret.length === 0) {
      issues.push({
        code: "empty_secret",
        lineNumber: row.lineNumber,
        message: `A linha ${row.lineNumber} não possui um secret.`,
      });
    } else {
      entries.push({ lineNumber: row.lineNumber, secret });
    }
  }

  return finishResult("csv", entries, issues);
}

export function parseInventoryImport(
  content: string,
  format: InventoryImportFormat,
): InventoryImportResult {
  return format === "txt" ? parseTxtInventory(content) : parseCsvInventory(content);
}

export function maskSecret(secret: string, visibleCharacters = 4): string {
  if (!Number.isInteger(visibleCharacters) || visibleCharacters < 0) {
    throw new RangeError("A quantidade de caracteres visíveis deve ser um inteiro não negativo.");
  }
  if (secret.length === 0) return "";
  if (secret.length <= visibleCharacters) return "•".repeat(secret.length);
  return `${"•".repeat(Math.max(8, secret.length - visibleCharacters))}${secret.slice(-visibleCharacters)}`;
}
