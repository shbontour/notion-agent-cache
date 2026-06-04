#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const APP_NAME = "notion-agent-cache";
const HOME_DIR = process.env.HOME || process.cwd();
const CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(HOME_DIR, ".config");
const CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(HOME_DIR, ".cache");
const DEFAULT_CONFIG_DIR = path.join(CONFIG_HOME, APP_NAME);
const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CONFIG_DIR, "config.json");
const DEFAULT_CACHE_DIR = path.join(CACHE_HOME, APP_NAME);
const DEFAULT_TOKEN_FILE = path.join(DEFAULT_CONFIG_DIR, "notion-token");
const DEFAULT_NOTION_VERSION = "2026-03-11";

const DEFAULT_CONFIG = {
  notionVersion: DEFAULT_NOTION_VERSION,
  cacheDir: DEFAULT_CACHE_DIR,
  tokenFile: DEFAULT_TOKEN_FILE,
  retentionSnapshots: 14,
  exportAllShared: false,
  include: {
    pageIds: [],
    databaseIds: [],
    dataSourceIds: [],
    searchQueries: [],
  },
  excludeTitlePatterns: [
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
  ],
  maxBlockDepth: 12,
  fetchPageSize: 100,
  requestDelayMs: 350,
  maxPages: 5000,
};

function printHelp() {
  console.log(`Usage: notion-agent-cache-sync [options]

Options:
  --config <path>  Config JSON path. Default: ${DEFAULT_CONFIG_PATH}
  --dry-run        Query Notion and build the manifest without writing a snapshot.
  --help           Show this help.

Token lookup order:
  1. NOTION_API_KEY
  2. NOTION_TOKEN
  3. config.token_file / config.tokenFile
`);
}

function parseArgs(argv) {
  const args = {
    configPath:
      process.env.NOTION_AGENT_CACHE_CONFIG ||
      process.env.NOTION_CACHE_CONFIG ||
      DEFAULT_CONFIG_PATH,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--config") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      args.configPath = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(output[key])) {
      output[key] = mergeConfig(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeConfig(config) {
  const include = config.include || {};
  return {
    notionVersion: config.notionVersion || DEFAULT_NOTION_VERSION,
    cacheDir: config.cacheDir || DEFAULT_CACHE_DIR,
    tokenFile: config.tokenFile || DEFAULT_TOKEN_FILE,
    retentionSnapshots: config.retentionSnapshots ?? 14,
    exportAllShared: config.exportAllShared ?? false,
    include: {
      pageIds: include.pageIds || [],
      databaseIds: include.databaseIds || [],
      dataSourceIds: include.dataSourceIds || [],
      searchQueries: include.searchQueries || [],
    },
    excludeTitlePatterns: config.excludeTitlePatterns || [],
    maxBlockDepth: config.maxBlockDepth ?? 12,
    fetchPageSize: config.fetchPageSize ?? 100,
    requestDelayMs: config.requestDelayMs ?? 350,
    maxPages: config.maxPages ?? 5000,
  };
}

function canonicalizeConfig(config) {
  const output = { ...config };
  if ("notion_version" in config) output.notionVersion = config.notion_version;
  if ("cache_dir" in config) output.cacheDir = config.cache_dir;
  if ("token_file" in config) output.tokenFile = config.token_file;
  if ("retention_snapshots" in config) {
    output.retentionSnapshots = config.retention_snapshots;
  }
  if ("export_all_shared" in config) output.exportAllShared = config.export_all_shared;
  if ("exclude_title_patterns" in config) {
    output.excludeTitlePatterns = config.exclude_title_patterns;
  }
  if ("max_block_depth" in config) output.maxBlockDepth = config.max_block_depth;
  if ("fetch_page_size" in config) output.fetchPageSize = config.fetch_page_size;
  if ("request_delay_ms" in config) output.requestDelayMs = config.request_delay_ms;
  if ("max_pages" in config) output.maxPages = config.max_pages;

  if (config.include) {
    output.include = { ...config.include };
    if ("page_ids" in config.include) output.include.pageIds = config.include.page_ids;
    if ("database_ids" in config.include) {
      output.include.databaseIds = config.include.database_ids;
    }
    if ("data_source_ids" in config.include) {
      output.include.dataSourceIds = config.include.data_source_ids;
    }
    if ("search_queries" in config.include) {
      output.include.searchQueries = config.include.search_queries;
    }
  }

  return output;
}

async function loadConfig(configPath) {
  const userConfig = await readJsonIfExists(configPath);
  if (!userConfig) {
    throw new Error(
      `Config not found: ${configPath}. Copy config.example.json there first.`,
    );
  }
  return normalizeConfig(mergeConfig(DEFAULT_CONFIG, canonicalizeConfig(userConfig)));
}

async function readToken(config) {
  const envToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (envToken) return envToken.trim();

  try {
    return (await fs.readFile(config.tokenFile, "utf8")).trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Notion token not found. Set NOTION_API_KEY or create ${config.tokenFile} with mode 600.`,
      );
    }
    throw error;
  }
}

function uuidFromText(value) {
  const text = String(value || "").trim();
  const collectionMatch = text.match(/^collection:\/\/([0-9a-fA-F-]{32,36})$/);
  const idText = collectionMatch ? collectionMatch[1] : text;
  const match = idText.match(
    /[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}/,
  );
  if (!match) {
    throw new Error(`Cannot find a Notion UUID in: ${value}`);
  }

  const hex = match[0].replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function shortId(id) {
  return id.replaceAll("-", "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plainRichText(items) {
  return (items || [])
    .map((item) => {
      if (typeof item?.plain_text === "string") return item.plain_text;
      if (typeof item?.text?.content === "string") return item.text.content;
      if (typeof item?.equation?.expression === "string") {
        return item.equation.expression;
      }
      return "";
    })
    .join("");
}

function richTextToMarkdown(items) {
  return (items || [])
    .map((item) => {
      let text = item?.plain_text || item?.text?.content || "";
      const href = item?.href || item?.text?.link?.url;
      if (href && text && href !== text) text = `${text} (${href})`;
      return text;
    })
    .join("");
}

function titleFromPage(page) {
  for (const property of Object.values(page.properties || {})) {
    if (property?.type === "title") {
      const title = plainRichText(property.title);
      if (title) return title;
    }
  }
  return page.id;
}

function titleFromDatabase(database) {
  return plainRichText(database.title) || database.id;
}

function titleFromDataSource(dataSource) {
  return (
    plainRichText(dataSource.title) ||
    dataSource.name ||
    dataSource.id ||
    "Untitled data source"
  );
}

function propertyToText(property) {
  if (!property || !property.type) return "";
  const value = property[property.type];

  switch (property.type) {
    case "title":
    case "rich_text":
      return plainRichText(value);
    case "number":
      return value === null || value === undefined ? "" : String(value);
    case "select":
    case "status":
      return value?.name || "";
    case "multi_select":
      return (value || []).map((item) => item.name).join(", ");
    case "date":
      return [value?.start, value?.end].filter(Boolean).join(" -> ");
    case "checkbox":
      return value ? "yes" : "no";
    case "url":
    case "email":
    case "phone_number":
      return value || "";
    case "people":
      return (value || [])
        .map((person) => person.name || person.id)
        .filter(Boolean)
        .join(", ");
    case "files":
      return (value || [])
        .map((file) => file.name || file.external?.url || file.file?.url)
        .filter(Boolean)
        .join(", ");
    case "relation":
      return (value || []).map((item) => item.id).join(", ");
    case "created_time":
    case "last_edited_time":
      return value || "";
    case "created_by":
    case "last_edited_by":
      return value?.name || value?.id || "";
    case "unique_id":
      return `${value?.prefix || ""}${value?.number ?? ""}`;
    case "formula":
      return formulaToText(value);
    case "rollup":
      return rollupToText(value);
    default:
      return "";
  }
}

function formulaToText(formula) {
  if (!formula || !formula.type) return "";
  if (formula.type === "date") {
    return [formula.date?.start, formula.date?.end].filter(Boolean).join(" -> ");
  }
  return formula[formula.type] === null || formula[formula.type] === undefined
    ? ""
    : String(formula[formula.type]);
}

function rollupToText(rollup) {
  if (!rollup || !rollup.type) return "";
  if (rollup.type === "array") {
    return (rollup.array || []).map(propertyToText).filter(Boolean).join(", ");
  }
  return rollup[rollup.type] === null || rollup[rollup.type] === undefined
    ? ""
    : String(rollup[rollup.type]);
}

function propertiesToMarkdown(properties) {
  const lines = [];
  for (const [name, property] of Object.entries(properties || {})) {
    const text = propertyToText(property);
    if (text) lines.push(`- ${name}: ${text}`);
  }
  return lines;
}

function blockText(block, field = "rich_text") {
  const data = block[block.type] || {};
  return richTextToMarkdown(data[field]);
}

function mediaUrl(data) {
  return data?.external?.url || data?.file?.url || "";
}

function blockToMarkdown(entry) {
  const { block, depth } = entry;
  const type = block.type;
  const data = block[type] || {};
  const text = blockText(block);
  const indent = "  ".repeat(Math.max(depth - 1, 0));

  switch (type) {
    case "paragraph":
      return text ? `${indent}${text}` : "";
    case "heading_1":
      return `## ${text}`;
    case "heading_2":
      return `### ${text}`;
    case "heading_3":
    case "heading_4":
      return `#### ${text}`;
    case "bulleted_list_item":
      return `${indent}- ${text}`;
    case "numbered_list_item":
      return `${indent}1. ${text}`;
    case "to_do":
      return `${indent}- [${data.checked ? "x" : " "}] ${text}`;
    case "toggle":
      return `${indent}- ${text}`;
    case "quote":
      return `${indent}> ${text}`;
    case "callout": {
      const icon = data.icon?.type === "emoji" ? `${data.icon.emoji} ` : "";
      return `${indent}> ${icon}${text}`.trimEnd();
    }
    case "code":
      return `\n\`\`\`${data.language || ""}\n${plainRichText(
        data.rich_text,
      )}\n\`\`\``;
    case "divider":
      return "---";
    case "child_page":
      return `${indent}- Child page: ${data.title || block.id} (${block.id})`;
    case "child_database":
      return `${indent}- Child database: ${data.title || block.id} (${block.id})`;
    case "bookmark":
    case "embed":
    case "link_preview":
      return `${indent}- ${type}: ${data.url || ""}`;
    case "image":
    case "video":
    case "file":
    case "pdf":
    case "audio":
      return `${indent}- ${type}: ${data.name || mediaUrl(data)}`;
    case "equation":
      return `${indent}$$${data.expression || ""}$$`;
    case "table_row":
      return `${indent}| ${(data.cells || [])
        .map((cell) => plainRichText(cell))
        .join(" | ")} |`;
    case "unsupported":
      return `${indent}- [unsupported block]`;
    default:
      return text ? `${indent}${text}` : `${indent}- [${type}]`;
  }
}

class NotionClient {
  constructor({ token, notionVersion, requestDelayMs }) {
    this.token = token;
    this.notionVersion = notionVersion;
    this.requestDelayMs = requestDelayMs;
    this.lastRequestAt = 0;
  }

  async request(method, endpoint, body = undefined) {
    const url = endpoint.startsWith("http")
      ? endpoint
      : `https://api.notion.com/v1${endpoint}`;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const now = Date.now();
      const wait = this.requestDelayMs - (now - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "Notion-Version": this.notionVersion,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (response.ok) return response.json();

      const responseText = await response.text();
      const retryAfter = Number(response.headers.get("retry-after") || "0");
      if (
        response.status === 429 ||
        [409, 500, 502, 503, 504].includes(response.status)
      ) {
        const delayMs =
          retryAfter > 0 ? retryAfter * 1000 : Math.min(12000, 800 * 2 ** attempt);
        await sleep(delayMs);
        continue;
      }

      throw new Error(
        `Notion API ${method} ${endpoint} failed with ${response.status}: ${responseText.slice(
          0,
          500,
        )}`,
      );
    }

    throw new Error(`Notion API ${method} ${endpoint} failed after retries`);
  }

  async paginatedPost(endpoint, body = {}) {
    const results = [];
    let startCursor;
    do {
      const response = await this.request("POST", endpoint, {
        ...body,
        start_cursor: startCursor,
      });
      results.push(...(response.results || []));
      startCursor = response.has_more ? response.next_cursor : undefined;
    } while (startCursor);
    return results;
  }

  async paginatedGet(endpoint, pageSize) {
    const results = [];
    let startCursor;
    do {
      const url = new URL(`https://api.notion.com/v1${endpoint}`);
      url.searchParams.set("page_size", String(pageSize));
      if (startCursor) url.searchParams.set("start_cursor", startCursor);
      const response = await this.request("GET", url.toString());
      results.push(...(response.results || []));
      startCursor = response.has_more ? response.next_cursor : undefined;
    } while (startCursor);
    return results;
  }
}

function buildExcludeMatchers(patterns) {
  return (patterns || []).map((pattern) => new RegExp(pattern, "i"));
}

function isExcludedTitle(title, matchers) {
  if (!title) return false;
  return matchers.some((matcher) => matcher.test(title));
}

function createState(config) {
  return {
    config,
    pageQueue: [],
    databaseQueue: [],
    dataSourceQueue: [],
    queuedPages: new Set(),
    queuedDatabases: new Set(),
    queuedDataSources: new Set(),
    processedPages: new Set(),
    processedDatabases: new Set(),
    processedDataSources: new Set(),
    pages: new Map(),
    databases: new Map(),
    dataSources: new Map(),
    blocksByPage: new Map(),
    excluded: [],
    errors: [],
    excludeMatchers: buildExcludeMatchers(config.excludeTitlePatterns),
  };
}

function enqueuePage(state, rawId, title = "", reason = "") {
  const id = uuidFromText(rawId);
  if (state.queuedPages.has(id) || state.processedPages.has(id)) return;
  if (isExcludedTitle(title, state.excludeMatchers)) {
    state.excluded.push({ object: "page", id, title, reason });
    return;
  }
  if (state.queuedPages.size >= state.config.maxPages) {
    state.errors.push({
      object: "page",
      id,
      title,
      error: `max_pages limit reached: ${state.config.maxPages}`,
    });
    return;
  }
  state.queuedPages.add(id);
  state.pageQueue.push({ id, title, reason });
}

function enqueueDatabase(state, rawId, title = "", reason = "") {
  const id = uuidFromText(rawId);
  if (state.queuedDatabases.has(id) || state.processedDatabases.has(id)) return;
  if (isExcludedTitle(title, state.excludeMatchers)) {
    state.excluded.push({ object: "database", id, title, reason });
    return;
  }
  state.queuedDatabases.add(id);
  state.databaseQueue.push({ id, title, reason });
}

function enqueueDataSource(state, rawId, title = "", reason = "") {
  const id = uuidFromText(rawId);
  if (state.queuedDataSources.has(id) || state.processedDataSources.has(id)) {
    return;
  }
  if (isExcludedTitle(title, state.excludeMatchers)) {
    state.excluded.push({ object: "data_source", id, title, reason });
    return;
  }
  state.queuedDataSources.add(id);
  state.dataSourceQueue.push({ id, title, reason });
}

async function seedFromSearch(client, state, query) {
  const body = query ? { query } : {};
  const results = await client.paginatedPost("/search", {
    ...body,
    page_size: state.config.fetchPageSize,
  });

  for (const result of results) {
    if (result.object === "page") {
      enqueuePage(state, result.id, titleFromPage(result), query || "search-all");
    } else if (result.object === "database") {
      enqueueDatabase(
        state,
        result.id,
        titleFromDatabase(result),
        query || "search-all",
      );
    } else if (result.object === "data_source") {
      enqueueDataSource(
        state,
        result.id,
        titleFromDataSource(result),
        query || "search-all",
      );
    }
  }
}

async function fetchChildrenRecursive(client, state, blockId, pageId, depth) {
  if (depth > state.config.maxBlockDepth) {
    state.errors.push({
      object: "block",
      id: blockId,
      page_id: pageId,
      error: `max_block_depth reached: ${state.config.maxBlockDepth}`,
    });
    return;
  }

  const children = await client.paginatedGet(
    `/blocks/${blockId}/children`,
    state.config.fetchPageSize,
  );

  const blocks = state.blocksByPage.get(pageId) || [];
  state.blocksByPage.set(pageId, blocks);

  for (const block of children) {
    blocks.push({ depth, block });

    if (block.type === "child_page") {
      enqueuePage(state, block.id, block.child_page?.title || "", "child_page");
      continue;
    }

    if (block.type === "child_database") {
      enqueueDatabase(
        state,
        block.id,
        block.child_database?.title || "",
        "child_database",
      );
      continue;
    }

    if (block.has_children) {
      await fetchChildrenRecursive(client, state, block.id, pageId, depth + 1);
    }
  }
}

async function processPage(client, state, queueItem) {
  const { id } = queueItem;
  if (state.processedPages.has(id)) return;
  state.processedPages.add(id);

  try {
    const page = await client.request("GET", `/pages/${id}`);
    const title = titleFromPage(page);
    if (isExcludedTitle(title, state.excludeMatchers)) {
      state.excluded.push({ object: "page", id, title, reason: "fetched-title" });
      return;
    }

    state.pages.set(id, page);
    state.blocksByPage.set(id, []);
    await fetchChildrenRecursive(client, state, id, id, 1);
    console.log(`page: ${title}`);
  } catch (error) {
    state.errors.push({ object: "page", id, error: error.message });
    console.error(`page error: ${id}: ${error.message}`);
  }
}

async function processDatabase(client, state, queueItem) {
  const { id } = queueItem;
  if (state.processedDatabases.has(id)) return;
  state.processedDatabases.add(id);

  try {
    const database = await client.request("GET", `/databases/${id}`);
    const title = titleFromDatabase(database);
    if (isExcludedTitle(title, state.excludeMatchers)) {
      state.excluded.push({
        object: "database",
        id,
        title,
        reason: "fetched-title",
      });
      return;
    }

    state.databases.set(id, database);
    for (const dataSource of database.data_sources || []) {
      enqueueDataSource(
        state,
        dataSource.id,
        dataSource.name || dataSource.title || "",
        "database",
      );
    }
    console.log(`database: ${title}`);
  } catch (error) {
    state.errors.push({ object: "database", id, error: error.message });
    console.error(`database error: ${id}: ${error.message}`);
  }
}

async function processDataSource(client, state, queueItem) {
  const { id } = queueItem;
  if (state.processedDataSources.has(id)) return;
  state.processedDataSources.add(id);

  try {
    const dataSource = await client.request("GET", `/data_sources/${id}`);
    const title = titleFromDataSource(dataSource);
    if (isExcludedTitle(title, state.excludeMatchers)) {
      state.excluded.push({
        object: "data_source",
        id,
        title,
        reason: "fetched-title",
      });
      return;
    }

    state.dataSources.set(id, dataSource);
    const children = await client.paginatedPost(`/data_sources/${id}/query`, {
      page_size: state.config.fetchPageSize,
    });
    for (const child of children) {
      if (child.object === "page") {
        enqueuePage(state, child.id, titleFromPage(child), `data_source:${id}`);
      } else if (child.object === "data_source") {
        enqueueDataSource(
          state,
          child.id,
          titleFromDataSource(child),
          `data_source:${id}`,
        );
      }
    }
    console.log(`data_source: ${title} (${children.length} rows)`);
  } catch (error) {
    state.errors.push({ object: "data_source", id, error: error.message });
    console.error(`data_source error: ${id}: ${error.message}`);
  }
}

function pageToMarkdown(page, blocks) {
  const title = titleFromPage(page);
  const lines = [
    `# ${title}`,
    "",
    `- Notion ID: ${page.id}`,
    `- URL: ${page.url || ""}`,
    `- Created: ${page.created_time || ""}`,
    `- Last edited: ${page.last_edited_time || ""}`,
  ];

  const propertyLines = propertiesToMarkdown(page.properties);
  if (propertyLines.length) {
    lines.push("", "## Properties", "", ...propertyLines);
  }

  const blockLines = (blocks || []).map(blockToMarkdown).filter(Boolean);
  if (blockLines.length) {
    lines.push("", "## Content", "", ...blockLines);
  }

  lines.push("");
  return lines.join("\n");
}

function manifestFromState(state, generatedAt) {
  const pageIndex = [...state.pages.values()]
    .map((page) => ({
      id: page.id,
      title: titleFromPage(page),
      url: page.url || "",
      created_time: page.created_time || "",
      last_edited_time: page.last_edited_time || "",
      markdown_path: `pages/${shortId(page.id)}.md`,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "ru"));

  return {
    generated_at: generatedAt,
    notion_version: state.config.notionVersion,
    counts: {
      pages: state.pages.size,
      databases: state.databases.size,
      data_sources: state.dataSources.size,
      excluded: state.excluded.length,
      errors: state.errors.length,
    },
    source: {
      export_all_shared: state.config.exportAllShared,
      include: state.config.include,
      exclude_title_patterns: state.config.excludeTitlePatterns,
      max_block_depth: state.config.maxBlockDepth,
    },
    pages: pageIndex,
    excluded: state.excluded,
    errors: state.errors,
  };
}

async function writeSnapshot(state) {
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  const snapshotDir = path.join(state.config.cacheDir, "snapshots", stamp);
  const pagesDir = path.join(snapshotDir, "pages");
  const rawPagesDir = path.join(snapshotDir, "raw", "pages");
  const rawBlocksDir = path.join(snapshotDir, "raw", "blocks");
  const rawDatabasesDir = path.join(snapshotDir, "raw", "databases");
  const rawDataSourcesDir = path.join(snapshotDir, "raw", "data_sources");

  await fs.mkdir(pagesDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(rawPagesDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(rawBlocksDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(rawDatabasesDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(rawDataSourcesDir, { recursive: true, mode: 0o700 });

  const manifest = manifestFromState(state, generatedAt);

  for (const page of state.pages.values()) {
    const id = shortId(page.id);
    await fs.writeFile(
      path.join(pagesDir, `${id}.md`),
      pageToMarkdown(page, state.blocksByPage.get(page.id)),
      "utf8",
    );
    await fs.writeFile(
      path.join(rawPagesDir, `${id}.json`),
      JSON.stringify(page, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(rawBlocksDir, `${id}.json`),
      JSON.stringify(state.blocksByPage.get(page.id) || [], null, 2),
      "utf8",
    );
  }

  for (const database of state.databases.values()) {
    await fs.writeFile(
      path.join(rawDatabasesDir, `${shortId(database.id)}.json`),
      JSON.stringify(database, null, 2),
      "utf8",
    );
  }

  for (const dataSource of state.dataSources.values()) {
    await fs.writeFile(
      path.join(rawDataSourcesDir, `${shortId(dataSource.id)}.json`),
      JSON.stringify(dataSource, null, 2),
      "utf8",
    );
  }

  await fs.writeFile(
    path.join(snapshotDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(snapshotDir, "README.md"), summaryMarkdown(manifest), "utf8");

  await updateCurrentSymlink(state.config.cacheDir, snapshotDir);
  await pruneSnapshots(state.config.cacheDir, state.config.retentionSnapshots);

  return { snapshotDir, manifest };
}

function summaryMarkdown(manifest) {
  const lines = [
    "# Notion cache snapshot",
    "",
    `Generated: ${manifest.generated_at}`,
    `Notion API version: ${manifest.notion_version}`,
    "",
    "## Counts",
    "",
    `- Pages: ${manifest.counts.pages}`,
    `- Databases: ${manifest.counts.databases}`,
    `- Data sources: ${manifest.counts.data_sources}`,
    `- Excluded: ${manifest.counts.excluded}`,
    `- Errors: ${manifest.counts.errors}`,
    "",
    "## Pages",
    "",
  ];

  for (const page of manifest.pages) {
    lines.push(`- [${page.title}](${page.markdown_path})`);
  }

  if (manifest.errors.length) {
    lines.push("", "## Errors", "");
    for (const error of manifest.errors) {
      lines.push(`- ${error.object || "object"} ${error.id || ""}: ${error.error}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function updateCurrentSymlink(cacheDir, snapshotDir) {
  const current = path.join(cacheDir, "current");
  const tmp = path.join(cacheDir, ".current.tmp");
  await fs.rm(tmp, { force: true, recursive: true });
  try {
    await fs.symlink(snapshotDir, tmp, "dir");
    await fs.rm(current, { force: true, recursive: true });
    await fs.rename(tmp, current);
  } catch (error) {
    await fs.rm(tmp, { force: true, recursive: true });
    if (!["EPERM", "EINVAL", "ENOTSUP"].includes(error.code)) throw error;
    await fs.rm(current, { force: true, recursive: true });
    await fs.cp(snapshotDir, current, { recursive: true });
  }
}

async function pruneSnapshots(cacheDir, retentionSnapshots) {
  const snapshotsDir = path.join(cacheDir, "snapshots");
  const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const oldDir of dirs.slice(retentionSnapshots)) {
    await fs.rm(path.join(snapshotsDir, oldDir), { recursive: true, force: true });
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = await loadConfig(args.configPath);
  const hasSeeds =
    config.exportAllShared ||
    config.include.pageIds.length ||
    config.include.databaseIds.length ||
    config.include.dataSourceIds.length ||
    config.include.searchQueries.length;

  if (!hasSeeds) {
    throw new Error(
      "Config has no export roots. Add include.page_ids/data_source_ids/database_ids/search_queries or set export_all_shared=true.",
    );
  }

  await fs.mkdir(config.cacheDir, { recursive: true, mode: 0o700 });
  await fs.chmod(config.cacheDir, 0o700).catch(() => {});

  const token = await readToken(config);
  const client = new NotionClient({
    token,
    notionVersion: config.notionVersion,
    requestDelayMs: config.requestDelayMs,
  });
  const state = createState(config);

  for (const pageId of config.include.pageIds) enqueuePage(state, pageId, "", "config");
  for (const databaseId of config.include.databaseIds) {
    enqueueDatabase(state, databaseId, "", "config");
  }
  for (const dataSourceId of config.include.dataSourceIds) {
    enqueueDataSource(state, dataSourceId, "", "config");
  }
  for (const query of config.include.searchQueries) {
    await seedFromSearch(client, state, query);
  }
  if (config.exportAllShared) {
    await seedFromSearch(client, state, "");
  }

  while (
    state.databaseQueue.length ||
    state.dataSourceQueue.length ||
    state.pageQueue.length
  ) {
    if (state.databaseQueue.length) {
      await processDatabase(client, state, state.databaseQueue.shift());
    } else if (state.dataSourceQueue.length) {
      await processDataSource(client, state, state.dataSourceQueue.shift());
    } else {
      await processPage(client, state, state.pageQueue.shift());
    }
  }

  const manifest = manifestFromState(state, new Date().toISOString());
  if (args.dryRun) {
    console.log(JSON.stringify(manifest.counts, null, 2));
    if (manifest.errors.length) {
      console.log(JSON.stringify(manifest.errors, null, 2));
    }
    return;
  }

  const written = await writeSnapshot(state);
  console.log(
    `snapshot: ${written.snapshotDir} pages=${written.manifest.counts.pages} errors=${written.manifest.counts.errors}`,
  );

  if (written.manifest.errors.length) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
