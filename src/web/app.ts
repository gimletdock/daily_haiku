import { type Entry, type Feed, type Language, isWeekend, shanghaiDate, shiftDate, validateEntry } from '../contract.js';

const languageNames: Record<Language, string> = { ja: '日本語', zh: '中文', en: 'English' };
const nextLanguage: Record<Language, Language> = { ja: 'zh', zh: 'en', en: 'ja' };
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const fetchTimeout = 3_500;
const retryDelay = 60_000;

const feed: Feed = document.body.dataset.feed === 'classic' ? 'classic' : 'custom';
const feedName = feed === 'classic' ? '经典俳句' : '定制俳句';
const sheet = document.querySelector<HTMLElement>('.sheet')!;
const edition = document.querySelector<HTMLElement>('[data-edition]')!;
const time = document.querySelector<HTMLTimeElement>('time')!;
const fireworks = document.querySelector<HTMLElement>('.fireworks')!;
const verse = document.querySelector<HTMLParagraphElement>('.verse')!;
const lines = verse.querySelectorAll('span');
const button = document.querySelector<HTMLButtonElement>('.language')!;
const attribution = document.querySelector<HTMLElement>('.attribution')!;
const source = document.querySelector<HTMLAnchorElement>('.source')!;
const status = document.querySelector<HTMLParagraphElement>('.status')!;

const selectedDate = dateFromQuery();
let activeDate: string | undefined;
let pending: { date: string } | undefined;
let refreshTimer: number | undefined;
let shown: Entry | undefined;
let language: Language = 'ja';

function dateFromQuery(): string | undefined {
  const date = new URLSearchParams(location.search).get('date');
  if (!date || date.startsWith('0000-') || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;

  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) return date;
  return undefined;
}

function dateLabel(date: string, showYear = false): string {
  const calendarDate = new Date(`${date}T00:00:00Z`);
  const year = showYear ? `${calendarDate.getUTCFullYear()} 年 ` : '';
  return `${year}${calendarDate.getUTCMonth() + 1} 月 ${calendarDate.getUTCDate()} 日 · ${weekdays[calendarDate.getUTCDay()]}`;
}

function showDate(date: string, showYear: boolean): void {
  time.dateTime = date;
  time.textContent = dateLabel(date, showYear);
  time.hidden = false;
}

async function getEntry(date: string, kind: Entry['kind'], signal: AbortSignal): Promise<Entry | undefined> {
  try {
    const response = await fetch(`/api/v1/${feed}/${date}.json`, { signal, cache: 'no-cache' });
    if (!response.ok) return undefined;
    const entry = validateEntry(await response.json(), feed);
    if (entry.date === date && entry.kind === kind) return entry;
  } catch {
    // An unavailable release can be retried or replaced by an earlier one.
  }
  return undefined;
}

async function findEntry(date: string, kind: Entry['kind']): Promise<Entry | undefined> {
  const exact = await getEntry(date, kind, AbortSignal.timeout(fetchTimeout));
  if (exact) return exact;

  const earlierDates = Array.from({ length: 7 }, (_, index) => shiftDate(date, -index - 1))
    .filter(candidate => isWeekend(candidate) === (kind === 'cocktail'));
  const signal = AbortSignal.timeout(fetchTimeout);
  const entries = await Promise.all(earlierDates.map(candidate => getEntry(candidate, kind, signal)));
  return entries.find(entry => entry !== undefined);
}

function showTranslation(entry: Entry): void {
  const translation = entry.translations[language];
  verse.lang = language;
  lines.forEach((line, index) => { line.textContent = translation[index]; });
  button.textContent = languageNames[language];
  button.setAttribute('aria-label', `当前 ${languageNames[language]}，切换到 ${languageNames[nextLanguage[language]]}`);
}

function showCredits(entry?: Entry): void {
  attribution.textContent = entry?.author ?? '';
  attribution.hidden = !entry?.author;

  source.hidden = !entry?.sourceUrl;
  if (entry?.sourceUrl) {
    source.textContent = entry.kind === 'cocktail' ? '配方来源' : '原文来源';
    source.href = entry.sourceUrl;
  } else {
    source.textContent = '';
    source.removeAttribute('href');
  }
}

function showEntry(entry: Entry, date: string): void {
  const cocktail = entry.kind === 'cocktail';
  const earlierEntry = entry.date !== date;
  shown = entry;
  showDate(entry.date, earlierEntry || selectedDate !== undefined);
  showTranslation(entry);
  verse.hidden = false;
  button.hidden = false;
  fireworks.hidden = !cocktail;
  showCredits(entry);

  const backup = entry.source === 'backup';
  if (earlierEntry) {
    const entryName = cocktail ? '配方' : '俳句';
    status.textContent = `所选日期暂无内容，显示最近一则${backup ? '备用' : ''}${entryName}。`;
  } else {
    status.textContent = backup ? '备用俳句' : '';
  }
}

function beginDate(date: string, kind: Entry['kind']): void {
  activeDate = date;
  shown = undefined;
  if (sheet.dataset.kind !== kind) language = kind === 'cocktail' ? 'en' : 'ja';
  sheet.dataset.kind = kind;
  edition.textContent = kind === 'cocktail' ? '周末配方' : feedName;
  showDate(date, selectedDate !== undefined);
  status.textContent = '正在载入…';
  fireworks.hidden = verse.hidden = button.hidden = true;
  lines.forEach(line => { line.textContent = ''; });
  button.textContent = '';
  button.removeAttribute('aria-label');
  showCredits();
}

function scheduleRefresh(date: string): void {
  window.clearTimeout(refreshTimer);
  if (selectedDate || document.visibilityState !== 'visible') return;
  const midnight = Date.parse(`${shiftDate(date, 1)}T00:00:00+08:00`);
  const untilMidnight = Math.max(0, midnight - Date.now());
  const delay = shown?.date === date ? untilMidnight : Math.min(untilMidnight, retryDelay);
  refreshTimer = window.setTimeout(() => { void refresh(); }, delay);
}

async function refresh(): Promise<void> {
  if (!selectedDate && document.visibilityState !== 'visible') return;
  const date = selectedDate ?? shanghaiDate();
  if (pending?.date === date) return;
  if (shown?.date === date) {
    scheduleRefresh(date);
    return;
  }

  const kind = isWeekend(date) ? 'cocktail' : 'haiku';
  if (activeDate !== date) beginDate(date, kind);
  const request = { date };
  pending = request;
  scheduleRefresh(date);
  const entry = await findEntry(date, kind);

  if (pending !== request) return;
  pending = undefined;
  if (!selectedDate && shanghaiDate() !== date) {
    void refresh();
    return;
  }
  if (entry && (!shown || entry.date > shown.date)) {
    showEntry(entry, date);
  } else if (!shown) {
    status.textContent = kind === 'cocktail' ? '暂无配方，请稍后再试。' : '暂无俳句，请稍后再试。';
  }
  scheduleRefresh(date);
}

document.title = `${feedName} · 每日俳句`;
button.addEventListener('click', () => {
  if (!shown) return;
  language = nextLanguage[language];
  showTranslation(shown);
});

if (selectedDate) {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.editions a')) {
    const url = new URL(link.href);
    url.searchParams.set('date', selectedDate);
    link.href = url.href;
  }
} else {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
    else window.clearTimeout(refreshTimer);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) void refresh();
  });
}
void refresh();
