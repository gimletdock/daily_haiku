import { readFile } from "node:fs/promises";

export type Weather = {
  condition: string;
  minC: number;
  maxC: number;
  precipitationProbabilityPercent: number;
};

export type News = { date: string; sourceUrl: string; fact: string };

const weatherConditions = new Map<number, string>([
  [0, "clear"], [1, "mostly clear"], [2, "partly cloudy"], [3, "overcast"],
  [45, "fog"], [48, "rime fog"], [51, "light drizzle"], [53, "drizzle"],
  [55, "heavy drizzle"], [56, "light freezing drizzle"], [57, "heavy freezing drizzle"],
  [61, "light rain"], [63, "rain"], [65, "heavy rain"], [66, "light freezing rain"],
  [67, "heavy freezing rain"], [71, "light snow"], [73, "snow"], [75, "heavy snow"],
  [77, "snow grains"], [80, "light showers"], [81, "showers"], [82, "heavy showers"],
  [85, "light snow showers"], [86, "heavy snow showers"], [95, "thunderstorms"],
  [96, "thunderstorms with light hail"], [99, "thunderstorms with heavy hail"]
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dailyNumber(value: unknown, index: number): number {
  if (!Array.isArray(value) || typeof value[index] !== "number" || !Number.isFinite(value[index])) {
    throw new Error("Incomplete forecast data");
  }
  return value[index];
}

export async function wuhanWeather(date: string): Promise<Weather> {
  const url = new URL(process.env.WEATHER_API_URL?.trim() || "https://api.open-meteo.com/v1/forecast");
  const parameters = {
    latitude: "30.59",
    longitude: "114.30",
    timezone: "Asia/Shanghai",
    start_date: date,
    end_date: date,
    daily: "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max"
  };
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error("Weather service unavailable");
  const payload: unknown = await response.json();
  if (!record(payload) || !record(payload.daily) || !Array.isArray(payload.daily.time)) {
    throw new Error("Invalid forecast response");
  }
  const daily = payload.daily;
  const index = payload.daily.time.indexOf(date);
  const condition = weatherConditions.get(dailyNumber(daily.weather_code, index));
  const minC = dailyNumber(daily.temperature_2m_min, index);
  const maxC = dailyNumber(daily.temperature_2m_max, index);
  const precipitationProbabilityPercent = dailyNumber(daily.precipitation_probability_max, index);
  if (!condition || minC > maxC || precipitationProbabilityPercent < 0 || precipitationProbabilityPercent > 100) {
    throw new Error("Invalid forecast values");
  }
  return { condition, minC, maxC, precipitationProbabilityPercent };
}

export async function suppliedNews(file: string, date: string): Promise<News> {
  const payload: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!record(payload) || payload.date !== date || typeof payload.sourceUrl !== "string"
      || typeof payload.fact !== "string" || !payload.fact.trim() || payload.fact.length > 600) {
    throw new Error("Invalid news context");
  }
  const source = new URL(payload.sourceUrl);
  if (source.protocol !== "https:" || source.username || source.password) {
    throw new Error("Invalid news source");
  }
  return { date, sourceUrl: source.href, fact: payload.fact.trim() };
}
