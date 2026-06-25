// Regenerates tickers.json from NASDAQ Trader's public, no-key-required symbol
// directories. Run with `npm run update-tickers` whenever you want the ticker
// validation list refreshed (new listings, delistings, etc).
//
// Note: existing users are never retroactively affected by this - App.jsx
// grandfathers whatever a user already has saved, even if this list changes.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "tickers.json");

const SOURCES = [
  {
    url: "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
    symbolIndex: 0,
    testIssueIndex: 3,
  },
  {
    url: "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
    symbolIndex: 0,
    testIssueIndex: 6,
  },
];

const fetchSymbols = async ({ url, symbolIndex, testIssueIndex }) => {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").slice(1); // skip header row

  const symbols = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length <= testIssueIndex) continue;
    const symbol = parts[symbolIndex]?.trim();
    const testIssue = parts[testIssueIndex]?.trim();
    if (!symbol || testIssue === "Y") continue;
    symbols.push(symbol.toUpperCase());
  }
  return symbols;
};

const main = async () => {
  const allSymbols = new Set();
  for (const source of SOURCES) {
    const symbols = await fetchSymbols(source);
    for (const s of symbols) allSymbols.add(s);
  }

  const sorted = Array.from(allSymbols).sort();
  await writeFile(OUTPUT_PATH, JSON.stringify(sorted));
  console.log(`Wrote ${sorted.length} tickers to ${OUTPUT_PATH}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
