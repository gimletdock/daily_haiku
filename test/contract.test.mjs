import assert from "node:assert/strict";
import { test } from "node:test";
import { isWeekend, shanghaiDate, shiftDate, validateEntry } from "../build/contract.js";

const translations = {
  ja: ["冬の朝", "川面ひかる", "鳥が鳴く"],
  zh: ["冬日清晨", "河面微光", "飞鸟鸣叫"],
  en: ["Winter morning", "Light on the river", "A bird sings"],
};

function weekdayEntry(overrides = {}) {
  return { version: 1, date: "2026-11-27", kind: "haiku", source: "backup", translations, ...overrides };
}

test("Wuhan calendar rolls over at 16:00 UTC", () => {
  assert.equal(shanghaiDate(new Date("2026-11-27T15:59:59.999Z")), "2026-11-27");
  assert.equal(shanghaiDate(new Date("2026-11-27T16:00:00.000Z")), "2026-11-28");
  assert.equal(shanghaiDate(new Date("2026-11-29T15:59:59.999Z")), "2026-11-29");
  assert.equal(shanghaiDate(new Date("2026-11-29T16:00:00.000Z")), "2026-11-30");
  assert.equal(isWeekend("2026-11-27"), false);
  assert.equal(isWeekend("2026-11-28"), true);
  assert.equal(isWeekend("2026-11-29"), true);
  assert.equal(isWeekend("2026-11-30"), false);
  assert.equal(shiftDate("2028-03-01", -1), "2028-02-29");
  assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
});

test("entry contract enforces actual dates, weekday and weekend content, and attribution", () => {
  const master = weekdayEntry({ source: "master", author: "松尾芭蕉", sourceUrl: "https://example.test/haiku" });
  const recipe = weekdayEntry({
    date: "2026-11-28",
    kind: "cocktail",
    source: "recipe",
    sourceUrl: "https://example.test/recipe",
  });

  assert.doesNotThrow(() => validateEntry(weekdayEntry()));
  assert.doesNotThrow(() => validateEntry(master, "classic"));
  assert.doesNotThrow(() => validateEntry(recipe, "classic"));
  assert.doesNotThrow(() => validateEntry(recipe, "custom"));
  assert.throws(() => validateEntry(master, "custom"));
  assert.throws(() => validateEntry(weekdayEntry(), "classic"));
  for (const invalid of [
    weekdayEntry({ date: "2026-02-30" }),
    weekdayEntry({ date: "2026-2-27" }),
    weekdayEntry({ date: "2026-11-29" }),
    { ...recipe, date: "2026-11-30" },
    { ...master, author: undefined },
    { ...master, sourceUrl: undefined },
    { ...master, sourceUrl: "javascript:alert(1)" },
    { ...recipe, sourceUrl: undefined },
    weekdayEntry({ source: "recipe" }),
    { ...recipe, source: "backup" },
  ]) {
    assert.throws(() => validateEntry(invalid), JSON.stringify(invalid));
  }
});

test("entry contract requires three nonblank lines per language and respects grapheme limits", () => {
  const verse = { ...translations, zh: ["江".repeat(8), "桥".repeat(8), "灯".repeat(8)] };
  assert.doesNotThrow(() => validateEntry(weekdayEntry({ translations: verse })));
  assert.doesNotThrow(() => validateEntry(weekdayEntry({
    translations: { ...verse, zh: ["e\u0301".repeat(8), ...verse.zh.slice(1)] },
  })));

  for (const invalid of [
    { ...verse, zh: ["江".repeat(9), ...verse.zh.slice(1)] },
    { ...verse, zh: ["江", "桥", "  "] },
    { ...verse, ja: ["川", "橋"] },
    { ...verse, en: undefined },
  ]) {
    assert.throws(() => validateEntry(weekdayEntry({ translations: invalid })), JSON.stringify(invalid));
  }

  const recipe = weekdayEntry({
    date: "2026-11-29",
    kind: "cocktail",
    source: "recipe",
    sourceUrl: "https://example.test/recipe",
  });
  const recipeText = ["a".repeat(22), "b".repeat(21), "c".repeat(21)];
  assert.doesNotThrow(() => validateEntry({ ...recipe, translations: { ...translations, en: recipeText } }));
  assert.throws(() => validateEntry({
    ...recipe,
    translations: { ...translations, en: [...recipeText.slice(0, 2), `${recipeText[2]}c`] },
  }));
});
