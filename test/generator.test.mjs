import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateEntry } from "../build/contract.js";

const project = fileURLToPath(new URL("../", import.meta.url));
const mockFetch = fileURLToPath(new URL("./fixtures/generator-fetch.mjs", import.meta.url));
const weekday = "2026-11-27";

function testDirectory(context) {
  const directory = mkdtempSync(join(tmpdir(), "daily-haiku-test-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function runGenerator(directory, date, { model, news, translations } = {}) {
  const requestLog = join(directory, "requests.log");
  const nodeArgs = model ? ["--import", mockFetch] : [];
  const cliArgs = ["build/generator/cli.js", "--date", date, "--out", directory];
  if (!model) cliArgs.push("--offline");
  if (news) {
    const newsFile = join(directory, "news.json");
    writeFileSync(newsFile, JSON.stringify(news));
    cliArgs.push("--news", newsFile);
  }
  const result = spawnSync(process.execPath, [...nodeArgs, ...cliArgs], {
    cwd: project,
    env: {
      ...process.env,
      MODEL_API_KEY: model ? "test-key" : "",
      MODEL_NAME: "test-model",
      MODEL_BASE_URL: "https://model.test/v1",
      WEATHER_API_URL: "https://weather.test/forecast",
      HAIKU_TEST_REQUEST_LOG: requestLog,
      HAIKU_TEST_MODEL: model ?? "",
      HAIKU_TEST_MODEL_REQUEST: join(directory, "model-request.json"),
      HAIKU_TEST_MODEL_TRANSLATIONS: translations ? JSON.stringify(translations) : "",
      HAIKU_TEST_WEATHER_REQUEST: join(directory, "weather-query.txt"),
    },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  if (model) assert.deepEqual(new Set(readFileSync(requestLog, "utf8").trim().split("\n")), new Set(["model", "weather"]));
}

function readFeed(directory, feed, date) {
  const file = join(directory, "api", "v1", feed, `${date}.json`);
  const bytes = readFileSync(file, "utf8");
  const entry = JSON.parse(bytes);
  assert.equal(entry.date, date);
  assert.doesNotThrow(() => validateEntry(entry, feed));
  return { bytes, entry, file };
}

test("offline weekday publishes a credited classic and a distinct, labeled backup in three languages", (context) => {
  const directory = testDirectory(context);
  runGenerator(directory, weekday);
  const classic = readFeed(directory, "classic", weekday).entry;
  const custom = readFeed(directory, "custom", weekday).entry;
  assert.equal(classic.kind, "haiku");
  assert.equal(custom.kind, "haiku");
  assert.equal(classic.source, "master");
  assert.equal(custom.source, "backup");
  assert.ok(classic.author);
  assert.equal(new URL(classic.sourceUrl).protocol, "https:");
  for (const language of ["ja", "zh", "en"]) {
    assert.notDeepEqual(classic.translations[language], custom.translations[language]);
  }
});

test("both weekend dates publish identical, attributed recipes across feeds", (context) => {
  const directory = testDirectory(context);
  for (const date of ["2026-11-28", "2026-11-29"]) {
    runGenerator(directory, date);
    const classic = readFeed(directory, "classic", date);
    const custom = readFeed(directory, "custom", date);
    assert.equal(classic.bytes, custom.bytes);
    assert.equal(classic.entry.kind, "cocktail");
    assert.equal(classic.entry.source, "recipe");
    assert.equal(new URL(classic.entry.sourceUrl).protocol, "https:");
  }
});

test("a weekend rerun reconciles a mismatched custom recipe to the already published classic edition", (context) => {
  const directory = testDirectory(context);
  const date = "2026-11-28";
  runGenerator(directory, date);
  const classic = readFeed(directory, "classic", date);
  const custom = readFeed(directory, "custom", date);
  writeFileSync(custom.file, JSON.stringify({ ...custom.entry, sourceUrl: "https://example.test/different-recipe" }));
  runGenerator(directory, date);
  assert.equal(readFeed(directory, "classic", date).bytes, classic.bytes);
  assert.equal(readFeed(directory, "custom", date).bytes, classic.bytes);
});

test("reruns leave published editions byte-identical", (context) => {
  const directory = testDirectory(context);
  runGenerator(directory, weekday);
  const first = ["classic", "custom"].map((feed) => readFeed(directory, feed, weekday).bytes);
  runGenerator(directory, weekday);
  const second = ["classic", "custom"].map((feed) => readFeed(directory, feed, weekday).bytes);
  assert.deepEqual(second, first);
});

test("online weekday uses the model and preserves that poem on a subsequent offline run", (context) => {
  const directory = testDirectory(context);
  const news = { date: weekday, sourceUrl: "https://example.test/news", fact: "A river ferry route reopened." };
  runGenerator(directory, weekday, { model: "success", news });
  const model = readFeed(directory, "custom", weekday);
  assert.equal(model.entry.source, "model");
  assert.equal(model.entry.translations.en[0], "Winter morning");
  assert.equal(readFeed(directory, "classic", weekday).entry.source, "master");

  const weatherQuery = new URLSearchParams(readFileSync(join(directory, "weather-query.txt"), "utf8"));
  assert.equal(weatherQuery.get("timezone"), "Asia/Shanghai");
  assert.equal(weatherQuery.get("start_date"), weekday);
  assert.equal(weatherQuery.get("end_date"), weekday);
  assert.ok(Math.abs(Number(weatherQuery.get("latitude")) - 30.59) < 0.1);
  assert.ok(Math.abs(Number(weatherQuery.get("longitude")) - 114.30) < 0.1);
  const messages = JSON.parse(readFileSync(join(directory, "model-request.json"), "utf8"));
  const modelContext = JSON.parse(messages.find(message => message.role === "user").content);
  assert.equal(modelContext.date, weekday);
  assert.equal(modelContext.location, "Wuhan, China");
  assert.ok(modelContext.solarTerm);
  assert.deepEqual(modelContext.weather, { condition: "clear", minC: 5, maxC: 15, precipitationProbabilityPercent: 0 });
  assert.deepEqual(modelContext.news, news);

  runGenerator(directory, weekday);
  assert.equal(readFeed(directory, "custom", weekday).bytes, model.bytes);
});

for (const modelState of ["unavailable", "invalid"]) {
  test(`weekday labels the backup when the model is ${modelState}`, (context) => {
    const directory = testDirectory(context);
    runGenerator(directory, weekday, { model: modelState });
    assert.equal(readFeed(directory, "custom", weekday).entry.source, "backup");
    assert.equal(readFeed(directory, "classic", weekday).entry.source, "master");
  });
}

test("weekday retries a repeated Japanese poem and labels the backup if the repeat persists", (context) => {
  const directory = testDirectory(context);
  const priorDate = "2026-11-26";
  runGenerator(directory, priorDate);
  const prior = readFeed(directory, "custom", priorDate);
  const japanese = ["冬の朝。", "川面　ひかる", "鳥が鳴く！"];
  prior.entry.translations.ja = japanese;
  writeFileSync(prior.file, JSON.stringify(prior.entry));

  runGenerator(directory, weekday, { model: "success" });
  const requests = readFileSync(join(directory, "requests.log"), "utf8").trim().split("\n");
  assert.equal(requests.filter(request => request === "model").length, 2);
  const messages = JSON.parse(readFileSync(join(directory, "model-request.json"), "utf8"));
  const modelContext = JSON.parse(messages.find(message => message.role === "user").content);
  assert.ok(modelContext.recentJapaneseHaiku.some(lines => lines.join("\n") === japanese.join("\n")));
  assert.equal(readFeed(directory, "custom", weekday).entry.source, "backup");
});

for (const [feed, label] of [["classic", "master"], ["custom", "backup"]]) {
  test(`weekday retries when the model copies a catalog ${label} poem and publishes a labeled backup`, (context) => {
    const directory = testDirectory(context);
    runGenerator(directory, weekday);
    const original = readFeed(directory, feed, weekday).entry;
    rmSync(readFeed(directory, "custom", weekday).file);

    const translations = { ...original.translations, en: ["Winter morning", "Light on the river", "A bird sings"] };
    runGenerator(directory, weekday, { model: "success", translations });
    const requests = readFileSync(join(directory, "requests.log"), "utf8").trim().split("\n");
    assert.equal(requests.filter(request => request === "model").length, 2);

    const custom = readFeed(directory, "custom", weekday).entry;
    assert.equal(custom.source, "backup");
    assert.notDeepEqual(custom.translations.ja, readFeed(directory, "classic", weekday).entry.translations.ja);
  });
}
