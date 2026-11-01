# Удаление Figma Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Оставить одно поддерживаемое имя `figma-ops` без потери его возможностей.

**Architecture:** Удаление standalone legacy-копии и её генератора; canonical runtime остаётся прежним. Один связанный шаг выполняет ведущий агент, затем свежий агент проверяет весь diff.

**Tech Stack:** Python unittest, JSON plugin manifests и marketplaces, Markdown, локальные symlinks.

**Spec:** `docs/superpowers/specs/2026-11-01-remove-figma-lookup-design.md`

## Global Constraints

- Canonical версия `1.4.1` в обоих manifests, обоих catalog entries и упаковочном тесте.
- Runtime, skill, references, API/MCP, credentials и макеты не изменяются.
- Исторические спецификации и отчёты сохраняются.
- Отдельный worktree; без push/PR/merge.
- Локальные правки памяти и двух legacy-ссылок явно разрешены пользователем; canonical ссылки сохраняются.

## Review Focus

- Каталог Codex использует object source, Claude — string source: оба ведут к canonical root.
- Автономная установка без соседнего плагина и cwd с пробелами продолжает работать.
- Не потерять реальные проверки CLI и offline asset verifier при удалении legacy-проверок.
- Локальные canonical ссылки должны остаться рабочими, заметка и индекс памяти — согласованными.
- Старые установки нуждаются в переходе: README явно описывает замену и потерю старого вызова.

### Task 1: Удалить legacy-дистрибутив и перевести активные ссылки

**Files:**
- Delete: `plugins/figma-lookup/**`, `plugins/figma-ops/scripts/sync-compat.py`.
- Modify: оба marketplace, оба canonical manifest, `README.md`, `plugins/figma-ops/README.md`, `plugins/figma-ops/tests/test_packaging.py`.
- Local: `~/.ai/skills/figma-lookup`, `~/.claude/skills/figma-lookup`, заметка `figma-lookup-required.md` и `MEMORY.md` в `~/.paiw/.claude-memory/`.

**Interfaces:**
- Consumes: canonical `figma-ops` 1.4.0 и legacy 1.5.0 из main `e19aacf`.
- Produces: единственный Figma plugin `figma-ops` 1.4.1; прежние CLI и skill без изменений.

- [x] Адаптировать существующие packaging tests для одного canonical root и версии `1.4.1`; оба catalog не содержат legacy entry. Удалить только generated parity и sync reproducibility tests.
- [x] Запустить `python3 -m unittest discover -s plugins/figma-ops/tests -p test_packaging.py -v`. Expected: FAIL из-за legacy entries/старой версии.
- [x] Удалить legacy tree и sync tool; обновить manifests, catalogs и README, сохранив явный путь перехода.
- [x] Запустить тот же packaging набор. Expected: PASS, 11 base operations, 12 CLI help calls, 6 additional CLI cases, 3 asset helper cases, 1 helper help call.
- [x] Перевести активную заметку/индекс памяти на canonical имя, удалить только проверенные legacy symlinks. Expected: canonical skill разрешается, legacy symlinks отсутствуют; нет активной ссылки на прежнюю заметку.
- [x] Запустить `python3 -m unittest discover -s plugins/figma-ops/tests -v` и `git diff --check`. Expected: полный PASS, чистый diff; runtime, skill и references без diff.
- [x] Сохранить изменения локальным коммитом, получить независимое read-only ревью по spec/plan и diff. Expected: нет незакрытых Critical/Important; без push/PR/merge.

## Результат

Packaging RED→GREEN: 4/4 PASS; полный canonical набор: 317/317 PASS. Все 16 runtime-модулей, skill и 8 references побайтово совпадают с базой. `git diff --check` чистый. Независимое read-only ревью: APPROVED, findings нет. Локальные legacy-ссылки отсутствуют в обоих клиентах; canonical ссылки и правило памяти проверены.

Фактическое обновление marketplace и discovery в живых клиентах не проверялось; для распространения удаления нужен отдельный push/PR/merge. Ветка сохранена локально.
