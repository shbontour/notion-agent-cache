import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function runNode(args) {
  return execFileAsync(process.execPath, args, { cwd: rootDir });
}

async function runNodeWithEnv(args, env) {
  return execFileAsync(process.execPath, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
  });
}

test("bin scripts pass node syntax checks", async () => {
  await runNode(["--check", "bin/notion-agent-cache.mjs"]);
  await runNode(["--check", "bin/notion-agent-cache-sync.mjs"]);
  await runNode(["--check", "bin/notion-agent-cache-search.mjs"]);
});

test("help output documents the portable command names", async () => {
  const { stdout: mainHelp } = await runNode([
    "bin/notion-agent-cache.mjs",
    "--help",
  ]);
  const { stdout: syncHelp } = await runNode([
    "bin/notion-agent-cache-sync.mjs",
    "--help",
  ]);
  const { stdout: searchHelp } = await runNode([
    "bin/notion-agent-cache-search.mjs",
    "--help",
  ]);

  assert.match(mainHelp, /notion-agent-cache <command>/);
  assert.match(syncHelp, /notion-agent-cache-sync/);
  assert.match(searchHelp, /notion-agent-cache-search/);
});

test("published files do not contain private workspace markers", async () => {
  const files = [
    "README.md",
    "README.ru.md",
    "config.example.json",
    "bin/notion-agent-cache.mjs",
    "bin/notion-agent-cache-sync.mjs",
    "bin/notion-agent-cache-search.mjs",
    "systemd/notion-agent-cache.service",
  ];
  const privateMarkers = [
    /\/home\/chatgpt/,
    /\/Users\/shb/,
    /shb1\.ru/,
  ];

  for (const file of files) {
    const content = await fs.readFile(path.join(rootDir, file), "utf8");
    for (const marker of privateMarkers) {
      assert.doesNotMatch(content, marker, `${file} contains ${marker}`);
    }
  }
});

test("main CLI initializes config and adds a Notion page", async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "notion-agent-home-"));
  const env = {
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    XDG_CACHE_HOME: path.join(homeDir, ".cache"),
  };
  const pageUrl =
    "https://www.notion.so/workspace/Release-checklist-00000000000000000000000000000000";

  const init = await runNodeWithEnv(["bin/notion-agent-cache.mjs", "init"], env);
  assert.match(init.stdout, /Created config/);

  const add = await runNodeWithEnv(
    ["bin/notion-agent-cache.mjs", "add", pageUrl],
    env,
  );
  assert.match(add.stdout, /Added to page_ids/);

  const configPath = path.join(
    homeDir,
    ".config",
    "notion-agent-cache",
    "config.json",
  );
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.deepEqual(config.include.page_ids, [
    "00000000-0000-0000-0000-000000000000",
  ]);
});

test("main CLI delegates search to the local snapshot search command", async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "notion-agent-cache-"));
  const pagesDir = path.join(cacheDir, "current", "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, "current", "manifest.json"),
    JSON.stringify({
      pages: [
        {
          title: "Deploy notes",
          url: "https://www.notion.so/example",
          markdown_path: "pages/deploy.md",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(pagesDir, "deploy.md"),
    "# Deploy notes\n\nProduction deploy uses the release checklist.\n",
    "utf8",
  );

  const { stdout } = await runNodeWithEnv(
    ["bin/notion-agent-cache.mjs", "search", "production"],
    { NOTION_AGENT_CACHE_DIR: cacheDir },
  );

  assert.match(stdout, /Deploy notes/);
  assert.match(stdout, /production/i);
});

test("search CLI reads a local snapshot", async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "notion-agent-cache-"));
  const pagesDir = path.join(cacheDir, "current", "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, "current", "manifest.json"),
    JSON.stringify({
      pages: [
        {
          title: "Release checklist",
          url: "https://www.notion.so/example",
          markdown_path: "pages/example.md",
        },
      ],
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(pagesDir, "example.md"),
    "# Release checklist\n\nShip the package and verify the changelog.\n",
    "utf8",
  );

  const { stdout } = await runNodeWithEnv(
    ["bin/notion-agent-cache-search.mjs", "changelog"],
    { NOTION_AGENT_CACHE_DIR: cacheDir },
  );

  assert.match(stdout, /Release checklist/);
  assert.match(stdout, /changelog/);
});
