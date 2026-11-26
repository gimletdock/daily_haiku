import { appendFileSync, writeFileSync } from "node:fs";

globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  switch (url.origin) {
    case "https://weather.test":
      appendFileSync(process.env.HAIKU_TEST_REQUEST_LOG, "weather\n");
      writeFileSync(process.env.HAIKU_TEST_WEATHER_REQUEST, url.searchParams.toString());
      return Response.json({
        daily: {
          time: ["2026-11-27"],
          weather_code: [0],
          temperature_2m_min: [5],
          temperature_2m_max: [15],
          precipitation_probability_max: [0],
        },
      });
    case "https://model.test": {
      if (url.pathname !== "/v1/chat/completions" || options?.method !== "POST") {
        throw new Error(`Unexpected model request ${options?.method} ${url.pathname}`);
      }
      appendFileSync(process.env.HAIKU_TEST_REQUEST_LOG, "model\n");
      const body = JSON.parse(options.body);
      writeFileSync(process.env.HAIKU_TEST_MODEL_REQUEST, JSON.stringify(body.messages));
      if (process.env.HAIKU_TEST_MODEL === "unavailable") return Response.json({}, { status: 503 });
      const translations = process.env.HAIKU_TEST_MODEL_TRANSLATIONS ? JSON.parse(process.env.HAIKU_TEST_MODEL_TRANSLATIONS) : {
        ja: ["冬の朝", "川面ひかる", "鳥が鳴く"],
        zh: ["冬日清晨", "河面微光", "飞鸟鸣叫"],
        en: ["Winter morning", "Light on the river", "A bird sings"],
      };
      if (process.env.HAIKU_TEST_MODEL === "invalid") translations.zh[0] = "江".repeat(9);
      return Response.json({ choices: [{ message: { content: JSON.stringify(translations) } }] });
    }
    default:
      throw new Error(`Unexpected test request to ${url.origin}`);
  }
};
