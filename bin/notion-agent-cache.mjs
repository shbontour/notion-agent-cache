#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const APP_NAME = "notion-agent-cache";
const HOME_DIR = process.env.HOME || process.cwd();
const CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(HOME_DIR, ".config");
const CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(HOME_DIR, ".cache");
const DEFAULT_CONFIG_DIR = path.join(CONFIG_HOME, APP_NAME);
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CONFIG_DIR, "config.json");
const DEFAULT_CACHE_DIR = path.join(CACHE_HOME, APP_NAME);
const DEFAULT_TOKEN_FILE = path.join(DEFAULT_CONFIG_DIR, "notion-token");
const DEFAULT_NOTION_VERSION = "2026-03-11";
const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_EXCLUDE_TITLE_PATTERNS = [
  "access",
  "credential",
  "credentials",
  "password",
  "secret",
  "secrets",
  "token",
  "доступ",
  "ключ",
  "парол",
  "секрет",
  "токен",
];

function printHelp() {
  console.log(`Usage: notion-agent-cache <command> [options]

Commands:
  init                 Create the local config directory and config.json.
  add <notion-url>     Add a Notion page URL or ID to the allowlist.
  sync                 Sync allowed Notion pages into the local cache.
  search <query>       Search the local cache.
  doctor               Check config, token, allowlist, and current snapshot.

Examples:
  notion-agent-cache init
  notion-agent-cache add https://www.notion.so/workspace/Page-00000000000000000000000000000000
  notion-agent-cache sync
  notion-agent-cache search "deploy checklist"

Run "notion-agent-cache <command> --help" for command-specific options.
`);
}

function parseOptions(argv, spec = {}) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    const name = arg.replace(/^--/, "");
    if (!spec[name]) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (spec[name] === "boolean") {
      options[name] = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value`);
    options[name] = value;
    index += 1;
  }

  return { options, positionals };
}

function configPathFromEnv() {
  return (
    process.env.NOTION_AGENT_CACHE_CONFIG ||
    process.env.NOTION_CACHE_CONFIG ||
    DEFAULT_CONFIG_PATH
  );
}

function cacheDirFromEnv() {
  return process.env.NOTION_AGENT_CACHE_DIR || process.env.NOTION_CACHE_DIR || DEFAULT_CACHE_DIR;
}

function defaultConfig({ cacheDir = DEFAULT_CACHE_DIR, tokenFile = DEFAULT_TOKEN_FILE } = {}) {
  return {
    notion_version: DEFAULT_NOTION_VERSION,
    cache_dir: cacheDir,
    token_file: tokenFile,
    retention_snapshots: 14,
    export_all_shared: false,
    include: {
      page_ids: [],
      database_ids: [],
      data_source_ids: [],
      search_queries: [],
    },
    exclude_title_patterns: DEFAULT_EXCLUDE_TITLE_PATTERNS,
    max_block_depth: 12,
    fetch_page_size: 100,
    request_delay_ms: 350,
    max_pages: 5000,
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

function uuidFromText(value) {
  const text = String(value || "").trim();
  const collectionMatch = text.match(/^collection:\/\/([0-9a-fA-F-]{32,36})$/);
  const idText = collectionMatch ? collectionMatch[1] : text;
  const match = idText.match(
    /[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}/,
  );
  if (!match) throw new Error(`Cannot find a Notion UUID in: ${value}`);

  const hex = match[0].replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function ensureInclude(config) {
  const include = config.include || {};
  const pageIds = include.page_ids || include.pageIds || [];
  const databaseIds = include.database_ids || include.databaseIds || [];
  const dataSourceIds = include.data_source_ids || include.dataSourceIds || [];
  const searchQueries = include.search_queries || include.searchQueries || [];

  config.include = {
    page_ids: uniqueSorted(pageIds),
    database_ids: uniqueSorted(databaseIds),
    data_source_ids: uniqueSorted(dataSourceIds),
    search_queries: uniqueSorted(searchQueries),
  };
  return config.include;
}

function readTokenFileFromConfig(config) {
  return config.token_file || config.tokenFile || DEFAULT_TOKEN_FILE;
}

function readCacheDirFromConfig(config) {
  return config.cache_dir || config.cacheDir || DEFAULT_CACHE_DIR;
}

async function runInit(argv) {
  const { options } = parseOptions(argv, {
    config: "value",
    "cache-dir": "value",
    "token-file": "value",
    force: "boolean",
  });

  if (options.help) {
    console.log(`Usage: notion-agent-cache init [options]

Options:
  --config <path>      Config path. Default: ${DEFAULT_CONFIG_PATH}
  --cache-dir <path>   Cache directory. Default: ${DEFAULT_CACHE_DIR}
  --token-file <path>  Token file. Default: ${DEFAULT_TOKEN_FILE}
  --force              Overwrite config.json if it already exists.
`);
    return;
  }

  const configPath = options.config || configPathFromEnv();
  const cacheDir = options["cache-dir"] || DEFAULT_CACHE_DIR;
  const tokenFile = options["token-file"] || DEFAULT_TOKEN_FILE;
  const existingConfig = await readJsonIfExists(configPath);

  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.dirname(tokenFile), { recursive: true, mode: 0o700 });
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });

  if (existingConfig && !options.force) {
    console.log(`Config already exists: ${configPath}`);
  } else {
    await writeJson(configPath, defaultConfig({ cacheDir, tokenFile }));
    console.log(`Created config: ${configPath}`);
  }

  console.log(`Token file: ${tokenFile}`);
  console.log(`Cache directory: ${cacheDir}`);
  console.log("");
  console.log("Next:");
  console.log("  1. Create a Notion integration and copy its token.");
  console.log(`  2. Save the token: printf '%s\\n' '<token>' > ${tokenFile}`);
  console.log("  3. Share safe Notion pages with that integration.");
  console.log("  4. Add a page: notion-agent-cache add <notion-page-url>");
  console.log("  5. Sync: notion-agent-cache sync");
}

async function runAdd(argv) {
  const { options, positionals } = parseOptions(argv, {
    config: "value",
    page: "boolean",
    database: "boolean",
    "data-source": "boolean",
    query: "boolean",
  });

  if (options.help) {
    console.log(`Usage: notion-agent-cache add <notion-url-or-id> [options]

Options:
  --config <path>  Config path. Default: ${DEFAULT_CONFIG_PATH}
  --page           Add a page ID. This is the default.
  --database       Add a database ID.
  --data-source    Add a data source ID.
  --query          Add a Notion search query instead of a UUID.
`);
    return;
  }

  const value = positionals.join(" ").trim();
  if (!value) throw new Error("add requires a Notion URL, ID, or search query");

  const selectedTypes = [options.page, options.database, options["data-source"], options.query]
    .filter(Boolean)
    .length;
  if (selectedTypes > 1) {
    throw new Error("Choose only one of --page, --database, --data-source, or --query");
  }

  const configPath = options.config || configPathFromEnv();
  const config = await readJsonIfExists(configPath);
  if (!config) {
    throw new Error(`Config not found: ${configPath}. Run "notion-agent-cache init" first.`);
  }

  const include = ensureInclude(config);
  let key = "page_ids";
  let normalized = uuidFromText(value);

  if (options.database) key = "database_ids";
  if (options["data-source"]) key = "data_source_ids";
  if (options.query) {
    key = "search_queries";
    normalized = value;
  }

  const before = include[key].length;
  include[key] = uniqueSorted([...include[key], normalized]);
  await writeJson(configPath, config);

  if (include[key].length === before) {
    console.log(`Already present in ${key}: ${normalized}`);
  } else {
    console.log(`Added to ${key}: ${normalized}`);
  }
}

async function runDoctor(argv) {
  const { options } = parseOptions(argv, { config: "value" });
  if (options.help) {
    console.log(`Usage: notion-agent-cache doctor [options]

Options:
  --config <path>  Config path. Default: ${DEFAULT_CONFIG_PATH}
`);
    return;
  }

  const configPath = options.config || configPathFromEnv();
  const config = await readJsonIfExists(configPath);
  const checks = [];

  checks.push(["Config", Boolean(config), configPath]);
  if (!config) {
    printChecks(checks);
    console.log("");
    console.log('Run "notion-agent-cache init" to create a config.');
    process.exitCode = 1;
    return;
  }

  const include = ensureInclude(config);
  const tokenFile = readTokenFileFromConfig(config);
  const cacheDir = readCacheDirFromConfig(config);
  const rootsCount =
    include.page_ids.length +
    include.database_ids.length +
    include.data_source_ids.length +
    include.search_queries.length;
  const token = await fs.readFile(tokenFile, "utf8").catch(() => "");
  const manifestPath = path.join(cacheDir, "current", "manifest.json");
  const manifest = await readJsonIfExists(manifestPath);

  checks.push(["Token file", Boolean(token.trim()), tokenFile]);
  checks.push(["Allowed roots", rootsCount > 0, `${rootsCount} configured`]);
  checks.push(["Current snapshot", Boolean(manifest), manifestPath]);
  printChecks(checks);

  if (manifest?.counts) {
    console.log("");
    console.log(
      `Snapshot: pages=${manifest.counts.pages} excluded=${manifest.counts.excluded} errors=${manifest.counts.errors}`,
    );
  }

  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

function printChecks(checks) {
  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? "OK " : "ERR"} ${label}: ${detail}`);
  }
}

function runChild(scriptName, args) {
  const scriptPath = path.join(BIN_DIR, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`Command stopped by signal ${result.signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 0;
}

async function run() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") return runInit(args);
  if (command === "add") return runAdd(args);
  if (command === "doctor") return runDoctor(args);
  if (command === "sync") return runChild("notion-agent-cache-sync.mjs", args);
  if (command === "search") return runChild("notion-agent-cache-search.mjs", args);

  throw new Error(`Unknown command: ${command}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
