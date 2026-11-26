import { readFile } from "node:fs/promises";
import { validateEntry, type Entry, type Feed } from "../contract.js";

const anchor = Date.parse("2026-11-23");
const dayMs = 86_400_000;
const monthSeasons = [
  "winter", "spring", "spring", "spring", "summer", "summer",
  "summer", "autumn", "autumn", "autumn", "winter", "winter"
] as const;
type Season = typeof monthSeasons[number];
type Master = Pick<Entry, "translations" | "author" | "sourceUrl">;
type Backups = Record<Season, Entry["translations"][]>;

type SolarCalendar = {
  terms: string[];
  years: Record<string, { days: number[]; sourceUrl: string }>;
};

async function readCatalog<T>(name: string): Promise<T> {
  const path = new URL(`../../data/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function choose<T>(values: T[], position: number): T {
  if (!values.length) throw new Error("Empty content catalog");
  return values[(position % values.length + values.length) % values.length]!;
}

function rotation(date: string, weekend = false): number {
  const elapsed = (Date.parse(date) - anchor) / dayMs;
  const week = Math.floor(elapsed / 7);
  const weekday = elapsed - week * 7;
  return weekend ? week * 2 + weekday - 5 : week * 5 + weekday;
}

export async function seasonalContext(date: string) {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const season = monthSeasons[month - 1]!;
  const calendar = await readCatalog<SolarCalendar>("solar-terms");
  const current = calendar.years[year];
  if (!current) return { season };
  const position = (month - 1) * 2;
  const previousDay = current.days[position]!;
  const nextDay = current.days[position + 1]!;
  // The preceding Gregorian year's winter solstice is the previous term before 小寒.
  const index = day >= nextDay ? position + 1 : day >= previousDay ? position : (position + 23) % 24;
  const solarTermDay = day === previousDay || day === nextDay;
  const exactSeason = monthSeasons[Math.floor(index / 2)]!;
  return {
    season: exactSeason,
    solarTerm: calendar.terms[index]!,
    solarTermDay,
    solarTermSource: current.sourceUrl
  };
}

export async function classicEntry(date: string): Promise<Entry> {
  const rows = await readCatalog<Master[]>("masters");
  return validateEntry({
    version: 1,
    date,
    kind: "haiku",
    source: "master",
    ...choose(rows, rotation(date))
  }, "classic");
}

export async function backupEntry(date: string, season: Season): Promise<Entry> {
  const rows = await readCatalog<Backups>("backup");
  return validateEntry({
    version: 1,
    date,
    kind: "haiku",
    source: "backup",
    translations: choose(rows[season], rotation(date))
  }, "custom");
}

export async function catalogJapanesePoems(): Promise<Entry["translations"]["ja"][]> {
  const [masters, backups] = await Promise.all([
    readCatalog<Master[]>("masters"),
    readCatalog<Backups>("backup")
  ]);
  return [
    ...masters.map(master => master.translations.ja),
    ...Object.values(backups).flat().map(poem => poem.ja)
  ];
}

export async function weekendEntry(date: string, feed: Feed): Promise<Entry> {
  const rows = await readCatalog<Pick<Entry, "translations" | "sourceUrl">[]>("cocktails");
  return validateEntry({
    version: 1,
    date,
    kind: "cocktail",
    source: "recipe",
    ...choose(rows, rotation(date, true))
  }, feed);
}
