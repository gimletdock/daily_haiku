import { randomUUID } from "node:crypto";
import { link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isWeekend, shanghaiDate, shiftDate, validateEntry, type Entry, type Feed } from "../contract.js";
import { backupEntry, catalogJapanesePoems, classicEntry, seasonalContext, weekendEntry } from "./catalog.js";
import { suppliedNews, wuhanWeather } from "./context.js";
import { configuredModel, InvalidModelPoem, modelEntry } from "./model.js";

const defaultOutput = fileURLToPath(new URL("../../public", import.meta.url));

function outputPath(directory: string, feed: Feed, date: string): string {
  return join(directory, "api", "v1", feed, `${date}.json`);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

async function existingEntry(file: string, feed: Feed, date: string): Promise<Entry | "invalid" | undefined> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  try {
    const entry = validateEntry(JSON.parse(content), feed);
    return entry.date === date ? entry : "invalid";
  } catch {
    return "invalid";
  }
}

function sameRecipe(first: Entry, second: Entry): boolean {
  return first.sourceUrl === second.sourceUrl && first.author === second.author
    && (["ja", "zh", "en"] as const).every(language =>
      first.translations[language].every((line, index) => line === second.translations[language][index])
    );
}

async function publishEntry(file: string, feed: Feed, entry: Entry, synchronizeRecipe = false): Promise<Entry> {
  validateEntry(entry, feed);
  await mkdir(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.${entry.date}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(entry, null, 2) + "\n", { flag: "wx" });
  try {
    // Linking a complete temporary file preserves a concurrent publisher's edition.
    try {
      await link(temporary, file);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const existing = await existingEntry(file, feed, entry.date);
      if (existing && existing !== "invalid" && (!synchronizeRecipe || sameRecipe(existing, entry))) return existing;
      await rename(temporary, file);
    }
    console.log(`${feed} ${entry.date} ${entry.source}`);
    return entry;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function recentPoems(directory: string, date: string): Promise<Entry[]> {
  const names = await readdir(directory).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  });
  const dates = names
    .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/u.test(name) && name.slice(0, 10) < date)
    .map(name => name.slice(0, 10))
    .sort()
    .reverse();
  const previous: Entry[] = [];
  for (const previousDate of dates) {
    const entry = await existingEntry(join(directory, `${previousDate}.json`), "custom", previousDate);
    if (entry && entry !== "invalid" && entry.kind === "haiku") previous.push(entry);
    if (previous.length === 30) break;
  }
  return previous;
}

function normalizePoem(lines: Entry["translations"]["ja"]): string {
  return lines.join("").normalize("NFKC").replace(/[\p{White_Space}\p{P}]/gu, "").toLowerCase();
}

async function customEntry(file: string, date: string, offline: boolean, newsFile?: string): Promise<Entry> {
  const seasonal = await seasonalContext(date);
  const model = offline ? undefined : configuredModel();
  if (model) {
    const [weather, news, recent, originals] = await Promise.all([
      wuhanWeather(date).catch(() => {
        console.warn("Wuhan forecast unavailable. Continuing with calendar context.");
        return undefined;
      }),
      newsFile
        ? suppliedNews(newsFile, date).catch(() => {
            console.warn("News file is invalid for this date. Continuing without news.");
            return undefined;
          })
        : undefined,
      recentPoems(dirname(file), date),
      catalogJapanesePoems()
    ]);
    const recentJapanese = recent.map(poem => poem.translations.ja);
    const recentJapaneseHaiku = recentJapanese.slice(0, 5);
    const seenJapanese = new Set([...originals, ...recentJapanese].map(normalizePoem));
    const context = { date, location: "Wuhan, China" as const, ...seasonal, weather, news, recentJapaneseHaiku };
    const requestPoem = async (revision?: string) => {
      const entry = await modelEntry(model, { ...context, revision });
      if (seenJapanese.has(normalizePoem(entry.translations.ja))) {
        throw new InvalidModelPoem("The Japanese poem repeats catalog or published text");
      }
      return entry;
    };
    try {
      try {
        return await requestPoem();
      } catch (error) {
        if (!(error instanceof InvalidModelPoem)) throw error;
        return await requestPoem("Write a new scene with original wording and the required three-language JSON format.");
      }
    } catch {
      console.warn("Model unavailable or response invalid. Publishing a backup haiku.");
    }
  }
  return backupEntry(date, seasonal.season);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      date: { type: "string" },
      out: { type: "string" },
      offline: { type: "boolean", default: false },
      news: { type: "string" },
      help: { type: "boolean" }
    }
  });
  if (values.help) {
    console.log("Usage: npm run generate -- [--date YYYY-MM-DD] [--out DIR] [--offline] [--news FILE]");
    return;
  }
  const date = values.date ?? shiftDate(shanghaiDate(), 1);
  const weekend = isWeekend(date);
  const directory = values.out === undefined ? defaultOutput : resolve(values.out);
  const classicFile = outputPath(directory, "classic", date);
  const customFile = outputPath(directory, "custom", date);
  const [classic, custom] = await Promise.all([
    existingEntry(classicFile, "classic", date),
    existingEntry(customFile, "custom", date)
  ]);

  if (weekend) {
    const catalogEntry = classic && classic !== "invalid" ? classic
      : custom && custom !== "invalid" ? custom
      : await weekendEntry(date, "classic");
    const shared = classic && classic !== "invalid" ? classic : await publishEntry(classicFile, "classic", catalogEntry);
    if (!custom || custom === "invalid" || !sameRecipe(shared, custom)) {
      await publishEntry(customFile, "custom", shared, true);
    }
    return;
  }
  if (!classic || classic === "invalid") {
    await publishEntry(classicFile, "classic", await classicEntry(date));
  }
  if (!custom || custom === "invalid") {
    await publishEntry(customFile, "custom", await customEntry(customFile, date, values.offline, values.news));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Generation failed");
  process.exitCode = 1;
});
