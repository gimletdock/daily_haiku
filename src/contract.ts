export type Feed = "classic" | "custom";
export type Language = "ja" | "zh" | "en";
export type Lines = [string, string, string];
export type Entry = {
  version: 1;
  date: string;
  kind: "haiku" | "cocktail";
  source: "master" | "model" | "backup" | "recipe";
  translations: Record<Language, Lines>;
  author?: string;
  sourceUrl?: string;
};

const shanghaiFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const languages = ["ja", "zh", "en"] as const;

export function shanghaiDate(now = new Date()): string {
  return shanghaiFormat.format(now);
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("Expected ISO date YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid calendar date");
  }
  return date;
}

export function shiftDate(date: string, offset: number): string {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const weekday = parseDate(date).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateEntry(value: unknown, feed?: Feed): Entry {
  if (!record(value) || value.version !== 1 || typeof value.date !== "string") {
    throw new Error("Invalid v1 entry envelope");
  }
  const { kind, source, date, translations, author, sourceUrl } = value;
  if (kind !== (isWeekend(date) ? "cocktail" : "haiku")) {
    throw new Error("Entry type does not match the date");
  }
  if (kind === "cocktail" ? source !== "recipe" : source !== "master" && source !== "model" && source !== "backup") {
    throw new Error("Entry source does not match its type");
  }
  if (kind === "haiku" && feed && (feed === "classic") !== (source === "master")) {
    throw new Error("Entry source does not match its feed");
  }
  if ((author !== undefined || source === "master") && (typeof author !== "string" || !author.trim())) {
    throw new Error("Missing author attribution");
  }
  if ((sourceUrl !== undefined || source === "master" || source === "recipe") && !httpsUrl(sourceUrl)) {
    throw new Error("Missing or invalid HTTPS source");
  }
  if (!record(translations)) throw new Error("Missing translations");
  for (const language of languages) {
    const lines = translations[language];
    if (!Array.isArray(lines) || lines.length !== 3) throw new Error(`Expected three ${language} lines`);
    const lengths = lines.map(line => {
      if (typeof line !== "string" || !line.trim() || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(line)) {
        throw new Error(`Invalid ${language} line`);
      }
      return Array.from(graphemes.segment(line)).length;
    });
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const shortPoem = kind === "haiku" && language === "zh";
    const maxTotal = kind === "cocktail" ? 64 : shortPoem ? 24 : 96;
    const maxLine = kind === "cocktail" ? 64 : shortPoem ? 8 : 40;
    if (total > maxTotal || lengths.some(length => length > maxLine)) {
      throw new Error(`${language} text exceeds the length limit`);
    }
  }
  return value as Entry;
}
