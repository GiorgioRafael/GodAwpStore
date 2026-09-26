export function parseBrlCents(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim();
  if (!/^\d{1,4}(?:[.,]\d{1,2})?$/.test(normalized)) return null;
  const [reais, centavos = ""] = normalized.replace(",", ".").split(".");
  const value = Number(reais) * 100 + Number(centavos.padEnd(2, "0"));
  return Number.isSafeInteger(value) && value >= 80 && value <= 100_000 ? value : null;
}
