import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredModel, modelEntry } from "../build/generator/model.js";

test("OpenCode Go identifies the client and keeps one session across poem retries", async (context) => {
  const variables = {
    MODEL_API_KEY: "test-key",
    MODEL_NAME: "test-model",
    MODEL_BASE_URL: "https://opencode.ai/inference/go/openai/v1"
  };
  for (const [key, value] of Object.entries(variables)) {
    const previous = process.env[key];
    process.env[key] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const requests = [];
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), headers: new Headers(options.headers) });
    const poem = {
      ja: ["冬の朝", "川面ひかる", "鳥が鳴く"],
      zh: ["冬日清晨", "河面微光", "飞鸟鸣叫"],
      en: ["Winter morning", "Light on the river", "A bird sings"]
    };
    return Response.json({ choices: [{ message: { content: JSON.stringify(poem) } }] });
  };
  const model = configuredModel();
  const poemContext = { date: "2026-11-27", location: "Wuhan, China", season: "winter" };
  await modelEntry(model, poemContext);
  await modelEntry(model, { ...poemContext, revision: "Try again" });
  process.env.MODEL_BASE_URL = "https://opencode.ai/inference/openai/v1";
  await modelEntry(model, poemContext);

  assert.equal(requests[0].url, "https://opencode.ai/inference/go/openai/v1/chat/completions");
  assert.equal(requests[0].headers.get("user-agent"), "daily-haiku/0.1.0");
  const session = requests[0].headers.get("x-opencode-session");
  assert.match(session, /^[0-9a-f-]{36}$/u);
  assert.equal(requests[1].headers.get("x-opencode-session"), session);
  assert.equal(requests[2].headers.has("x-opencode-session"), false);
});
