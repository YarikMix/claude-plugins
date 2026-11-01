# phone-control

Управление физическими iPhone и Android через официальный Appium MCP.

| Скилл | Назначение |
|---|---|
| [iphone-control](skills/iphone-control/SKILL.md) | Управление готовым физическим iPhone: PNG/XML, ввод, жесты и навигация |
| [android-control](skills/android-control/SKILL.md) | Управление готовым физическим Android через embedded UiAutomator2 |
| [setup-android-control](skills/setup-android-control/SKILL.md) | Настройка Android SDK/JDK, USB-доверия и Appium MCP на Mac |

## Установка

Claude Code:

```sh
claude plugin marketplace add YarikMix/agent-utils
claude plugin install phone-control@yarikmix-plugins
```

Codex:

```sh
codex plugin marketplace add YarikMix/agent-utils
codex plugin add phone-control@yarikmix-plugins
```

Явные вызовы в Claude Code: `/phone-control:iphone-control`,
`/phone-control:android-control`, `/phone-control:setup-android-control`.
В Codex: `$phone-control:iphone-control`, `$phone-control:android-control`,
`$phone-control:setup-android-control`. Автоподбор по описанию сохраняется.

При переходе с прежнего плагина `iphone-control` отключите или удалите его в клиенте
и установите `phone-control`; имя скилла остаётся `iphone-control`, меняется префикс
плагина. Локальные симлинки скиллов и плагин одновременно создают дубли — выберите
один способ установки. Обновите маркетплейс и перезапустите клиент после перехода.

Плагин содержит инструкции и **не подключает Appium MCP автоматически**.
Первоначальная настройка iPhone и подписи WDA остаётся в отдельном плагине
[setup-iphone-control](https://github.com/YarikMix/agent-utils/tree/main/plugins/setup-iphone-control).
Разблокировку телефона, доверие компьютеру и вход в аккаунты выполняет человек.
Системные диалоги внутри порученной задачи агент обрабатывает по свежему экрану.
Эмуляторы, симуляторы и WebView/Chromedriver не входят в основной сценарий.

Границы живых проверок: [iPhone](skills/iphone-control/references/validation.md),
[Android](skills/android-control/references/validation.md). Установка на втором чистом
Mac и автоматическое обнаружение нового пакета клиентскими CLI не подтверждены.

Лицензия: [MIT](LICENSE).
