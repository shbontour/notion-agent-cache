#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const APP_NAME = "notion-agent-cache";
const HOME_DIR = process.env.HOME || process.cwd();
const CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(HOME_DIR, ".cache");
const DEFAULT_CACHE_DIR = path.join(CACHE_HOME, APP_NAME);

function usage() {
  console.log(`Usage: notion-agent-cache-search <query>

Environment:
  NOTION_AGENT_CACHE_DIR  Cache directory. Default: ${DEFAULT_CACHE_DIR}
  NOTION_CACHE_DIR        Backward-compatible cache directory override.
`);
}

function normalize(text) {
  return String(text || "").toLowerCase();
}

function snippet(content, query) {
  const lower = normalize(content);
  const index = lower.indexOf(normalize(query));
  if (index === -1) return content.slice(0, 220).replace(/\s+/g, " ").trim();
  const start = Math.max(0, index - 100);
  const end = Math.min(content.length, index + query.length + 140);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function countOccurrences(content, query) {
  const lower = normalize(content);
  const term = normalize(query);
  let count = 0;
  let offset = 0;
  while (term && true) {
    const index = lower.indexOf(term, offset);
    if (index === -1) break;
    count += 1;
    offset = index + term.length;
  }
  return count;
}

async function run() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query || query === "--help" || query === "-h") {
    usage();
    return;
  }

  const cacheDir =
    process.env.NOTION_AGENT_CACHE_DIR || process.env.NOTION_CACHE_DIR || DEFAULT_CACHE_DIR;
  const currentDir = path.join(cacheDir, "current");
  const manifest = JSON.parse(
    await fs.readFile(path.join(currentDir, "manifest.json"), "utf8"),
  );

  const matches = [];
  for (const page of manifest.pages || []) {
    const absolutePath = path.join(currentDir, page.markdown_path);
    const content = await fs.readFile(absolutePath, "utf8");
    const titleScore = countOccurrences(page.title, query) * 5;
    const bodyScore = countOccurrences(content, query);
    const score = titleScore + bodyScore;
    if (score > 0) {
      matches.push({
        score,
        title: page.title,
        url: page.url,
        path: absolutePath,
        snippet: snippet(content, query),
      });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ru"));

  for (const match of matches.slice(0, 20)) {
    console.log(`\n${match.title}`);
    console.log(`score=${match.score}`);
    console.log(match.url);
    console.log(match.path);
    console.log(match.snippet);
  }

  if (!matches.length) console.log("No matches");
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
