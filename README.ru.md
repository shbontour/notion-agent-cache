# Notion Agent Cache

[English](README.md) | Русский

[![Tests](https://github.com/shbontour/notion-agent-cache/actions/workflows/test.yml/badge.svg)](https://github.com/shbontour/notion-agent-cache/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Локальный read-only кэш Notion в Markdown для Codex, Claude Code, Cursor и
других coding agents.

Local read-only Notion snapshots for coding agents and command-line search.

`notion-agent-cache` синхронизирует выбранные страницы, базы данных и data
sources из Notion в локальный Markdown-кэш. После этого coding agents могут
искать проектный контекст обычными файловыми инструментами без обращения к
Notion API на каждом шаге.

Кэш не является резервной копией Notion или источником истины. Каноническая
версия остается в Notion.

## Зачем

Agent workflows часто требуют постоянный проектный контекст: runbooks,
дизайн-заметки, решения по релизам, инфраструктурные документы и заметки встреч.
Если все это лежит только в Notion, появляются три проблемы:

- агенту нужен сетевой доступ и Notion token для каждого поиска;
- повторные API-чтения медленные и шумные;
- широкий доступ к Notion может открыть агенту страницы, которые он не должен
  читать.

Этот инструмент держит модель доступа узкой. Вы делитесь с Notion integration
только безопасными страницами, синхронизируете их в приватный локальный кэш и
даете агентам локальный поиск.

## Что с этим можно сделать

Используйте `notion-agent-cache`, если важные знания по проекту лежат в Notion,
но вы не хотите давать coding agent полный live-доступ ко всему workspace.

После синхронизации можно просить агента работать по реальным документам
команды:

- "Найди production deploy checklist и обнови release workflow."
- "Посмотри architecture decision по auth перед изменением этого модуля."
- "Используй support runbook и составь план исправления инцидента."
- "Проверь onboarding notes и объясни, как должен запускаться этот сервис."
- "Найди прошлые release notes перед написанием changelog."

Агент читает локальные Markdown-файлы, а не весь Notion workspace.

## Типичный путь пользователя

1. У maintainer уже есть проектные документы в Notion: runbooks, release
   checklists, architecture decisions, onboarding notes и meeting summaries.
2. Он создает отдельную Notion integration с read-only access.
3. Он расшаривает на эту integration только безопасные страницы или базы.
4. Он запускает `notion-agent-cache sync`.
5. Инструмент пишет локальный snapshot в
   `~/.cache/notion-agent-cache/current`.
6. Codex, Claude Code, Cursor или другой coding agent теперь может искать по
   этой папке обычными filesystem-инструментами.

До:

```text
"Как у нас деплоить production?"
Агент не знает и просит вставить Notion page вручную.
```

После:

```text
"Найди production deploy checklist и обнови GitHub Action по нему."
Агент ищет в локальном Notion cache и работает по документам команды.
```

## Что делать дальше

Если описание выглядит полезным, практический путь такой:

1. Вы выбираете, какие страницы Notion безопасно дать агентам для чтения.
   Например: project docs, release checklists, runbooks, architecture decisions,
   onboarding notes.
2. Вы создаете отдельную Notion integration для этого инструмента.
   Это как read-only ключ к небольшой выбранной части вашего Notion workspace.
3. Вы расшариваете на эту integration только безопасные страницы.
   Инструмент не сможет прочитать страницы, которыми вы с ним не поделились.
4. Вы устанавливаете `notion-agent-cache` на компьютер или сервер.
5. Вы кладете Notion integration token в приватный локальный файл.
   Token не коммитится в Git и не показывается агенту.
6. Вы добавляете разрешенные Notion pages командой
   `notion-agent-cache add <notion-url>`.
7. Вы запускаете `notion-agent-cache sync`.
   Инструмент создает локальные Markdown-файлы из выбранных Notion pages.
8. Coding agent теперь может искать по этим локальным файлам.
   Можно просить: "используй наш release checklist" или "проверь решение по
   auth перед изменением этого кода."
9. Позже синхронизацию можно запускать повторно или поставить на ночное
   расписание.

Документы не нужно переносить из Notion. Инструмент просто создает локальную
копию тех страниц, которые вы явно разрешили читать агенту.

## Возможности

- Экспортирует Notion pages в Markdown.
- Пишет manifest с названиями страниц, URL, timestamps, счетчиками, exclusions
  и ошибками синхронизации.
- Сохраняет raw JSON для pages, blocks, databases и data sources для отладки.
- Обходит child pages и child databases, найденные внутри экспортируемых
  страниц.
- Поддерживает Notion data sources из новой database API.
- По умолчанию работает через allowlist: явные page IDs, database IDs, data
  source IDs или search queries.
- Исключает страницы с secret-looking названиями через настраиваемые regex
  patterns.
- Хранит timestamped snapshots и обновляет указатель `current`.
- Включает маленький CLI для локального поиска.
- Не имеет runtime npm-зависимостей.

## Требования

- Node.js 18.17 или новее.
- Notion internal integration с read-content access.
- Выбранные Notion pages или databases, расшаренные на эту integration.

Версия Notion API по умолчанию: `2026-03-11`. Data source endpoints доступны в
Notion API начиная с `2025-09-03`.

## Установка из исходников

```bash
git clone https://github.com/shbontour/notion-agent-cache.git
cd notion-agent-cache
npm link
```

После публикации пакета установка может выглядеть так:

```bash
npm install -g notion-agent-cache
```

## Быстрый старт

Создайте локальный config:

```bash
notion-agent-cache init
```

Создайте Notion integration, скопируйте token и сохраните его локально:

```bash
printf '%s\n' '<notion integration token>' > ~/.config/notion-agent-cache/notion-token
chmod 600 ~/.config/notion-agent-cache/notion-token
```

Расшарьте безопасные Notion pages на эту integration, затем добавьте URL страниц:

```bash
notion-agent-cache add https://www.notion.so/your-workspace/Release-checklist-00000000000000000000000000000000
```

Если нужно добавить не page:

```bash
notion-agent-cache add --database <notion-database-url-or-id>
notion-agent-cache add --data-source <notion-data-source-url-or-id>
notion-agent-cache add --query "release checklist"
```

Сначала запустите dry run:

```bash
notion-agent-cache sync --dry-run
```

Запишите первый snapshot:

```bash
notion-agent-cache sync
```

Проверьте настройку:

```bash
notion-agent-cache doctor
```

Ищите локально:

```bash
notion-agent-cache search "release checklist"
```

Старые прямые команды тоже остаются доступны:

```bash
notion-agent-cache-sync
notion-agent-cache-search "release checklist"
```

Можно использовать и обычные shell-инструменты:

```bash
rg "release checklist" ~/.cache/notion-agent-cache/current/pages
```

## Конфигурация

Пути по умолчанию:

- Config: `~/.config/notion-agent-cache/config.json`
- Token: `~/.config/notion-agent-cache/notion-token`
- Cache: `~/.cache/notion-agent-cache`

Environment overrides:

- `NOTION_API_KEY` или `NOTION_TOKEN`: значение token.
- `NOTION_AGENT_CACHE_CONFIG`: путь к config.
- `NOTION_AGENT_CACHE_DIR`: путь к cache для search CLI.
- `XDG_CONFIG_HOME` и `XDG_CACHE_HOME`: base directories для путей по умолчанию.

Config keys поддерживают и snake_case, и camelCase. Пример использует
snake_case.

Важные ключи:

- `export_all_shared`: экспортировать все страницы, видимые integration.
  Держите `false`, если integration имеет доступ не только к безопасным
  страницам.
- `include.page_ids`: конкретные Notion page IDs или URLs.
- `include.database_ids`: database container IDs.
- `include.data_source_ids`: data source IDs.
- `include.search_queries`: Notion search terms, используемые как export roots.
- `exclude_title_patterns`: case-insensitive regex strings, проверяемые перед
  добавлением page, database или data source в очередь.
- `retention_snapshots`: сколько timestamped snapshots хранить.
- `max_pages`: guardrail против случайного слишком широкого экспорта.

## Структура snapshot

```text
~/.cache/notion-agent-cache/
  current -> snapshots/<timestamp>/
  snapshots/
    <timestamp>/
      README.md
      manifest.json
      pages/
        <page-id>.md
      raw/
        pages/
        blocks/
        databases/
        data_sources/
```

На платформах, где directory symlinks недоступны, `current` копируется как
обычная директория.

## systemd Timer

Для user-level nightly sync:

```bash
install -d -m 700 ~/.config/systemd/user
cp systemd/notion-agent-cache.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now notion-agent-cache.timer
```

Проверка статуса:

```bash
systemctl --user list-timers notion-agent-cache.timer
systemctl --user status notion-agent-cache.service
journalctl --user -u notion-agent-cache.service -n 80
```

Если CLI не установлен глобально, отредактируйте
`~/.config/systemd/user/notion-agent-cache.service` и укажите в `ExecStart`
локальный путь к скрипту.

## Security model

Проект read-only с точки зрения Notion, но локальный кэш все равно может
содержать приватные данные.

- Используйте отдельную Notion integration.
- Делитесь только страницами, которые агентам можно читать.
- По умолчанию держите `export_all_shared=false`.
- Храните tokens вне repository.
- Держите token и cache files приватными для пользователя.
- Расширьте `exclude_title_patterns` под naming секретных страниц вашей
  организации.
- Не коммитьте generated snapshots.

## Разработка

```bash
npm run check
```

Проверка запускает syntax validation для обоих CLI scripts и Node test suite.

## Ограничения

- Markdown conversion намеренно простой и оптимизирован для поиска, а не для
  pixel-perfect рендера Notion.
- File attachments записываются как names или URLs; сами файлы не скачиваются.
- Linked data sources требуют, чтобы оригинальная source database была
  расшарена на Notion integration.
- Search использует легкий substring scoring, не semantic search.

## License

MIT
