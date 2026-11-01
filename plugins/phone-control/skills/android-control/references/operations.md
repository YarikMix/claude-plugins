# Операции Android

Схемы сверены с Appium MCP 1.97.1; при расхождении используй зарегистрированную схему. `S` — ID своей выбранной сессии, `U` — выбранный serial, `E` — свежий elementId. Это переменные примеров, не готовые значения.

## Устройство и сессия

`select_device({platform:"android"})` обнаруживает и физические устройства, и эмуляторы. Для явного выбора — `deviceUdid:U`. Если тип неясен, проверь `adb devices -l` и `adb -s "$ANDROID_TASK_SERIAL" shell getprop ro.kernel.qemu` (`1` — emulator); отсутствие `1` само по себе не доказывает нужный телефон. Сверь USB/model/serial с выбором пользователя. ADB используй из того же SDK, что задан MCP; каждая команда устройству — с `-s`.

Создание локальной сессии:

```js
appium_session_management({
  action: "create", platform: "android",
  capabilities: JSON.stringify({
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:udid": U,
    "appium:noReset": true,
    "appium:fullReset": false,
    "appium:autoGrantPermissions": false
  })
})
```

`remoteServerUrl` опущен. Не назначай общий фиксированный `systemPort` нескольким сессиям. `noReset` сохраняет данные; первая сессия может установить служебные Appium Settings/UiAutomator2 APK. `autoGrantPermissions:false` перекрывает разрешающий default MCP.

`list` показывает managed sessions; `select` выбирает `sessionId:S`. Привязка к U должна быть известна из создания/передачи сессии или фактических capabilities. `appium_mobile_device_info({action:"info",sessionId:S})` подтверждает model/OS, но Android `androidId` **не равен ADB serial**, и одной модели недостаточно для выбора среди одинаковых телефонов. Если привязка чужой сессии не установлена, не отправляй в неё ввод и не удаляй её.

## Наблюдение

- `appium_context({action:"list",sessionId:S})`; при необходимости `action:"switch",context:"NATIVE_APP"`. Ошибка switch требует диагностики; WebView/Chromedriver не настраивай ради native XML.
- `appium_screenshot({sessionId:S,returnRawBase64:false})` возвращает путь PNG. Открой файл image viewer; не делай вывод по имени файла. Путь принадлежит хосту MCP; если он недоступен, используй доступное средство просмотра/передачи и явно назови ограничение.
- `appium_get_page_source({sessionId:S,saveToFile:true})` возвращает JSON с `filepath` и `bytes`. Прочитай XML; опциональные `pattern` (подстрока) и `selector` (XPath) возвращают summary совпадений. Пустой summary не доказывает отсутствие цели вне экрана. Android XML может иметь теги классов, а не `<node>`.
- `appium_get_window_size({sessionId:S})` даёт реальные width/height; уменьшенный PNG не задаёт координаты устройства. После поворота размеры проверить заново.
- Исходный foreground, если неясен по XML: `adb -s "$ANDROID_TASK_SERIAL" shell dumpsys activity activities` с локальным фильтром `topResumedActivity|mResumedActivity`. Не публикуй полный dump.

## Поиск, tap, ввод

```js
appium_find_element({sessionId:S,strategy:"id",selector:"<package>:id/<resource>"})
appium_gesture({sessionId:S,action:"tap",elementUUID:E})
```

Возвращаемый `elementId` передаётся как `elementUUID`. `accessibility id` соответствует `content-desc`; `id` — полному `resource-id`. Затем `-android uiautomator` с `new UiSelector().text("<наблюдённый текст>")`; XPath последним. Общий `android:id/title` обычно не уникален. `appium_find_elements` помогает проверить неоднозначность. Не угадывай локализованные подписи — бери их из свежего XML.

`appium_set_value({sessionId:S,elementUUID:E,text:<текст>})` вводит текст. Проверяй итоговую строку целиком по XML/атрибуту и PNG. Tool может вернуть текст в логе — не передавай секреты. Не считай `text:""` гарантией очистки: setValue может дописывать. Очисти собственный ввод наблюдённой кнопкой поля и проверь пустоту; placeholder может находиться в `text`, тогда проверь также `hint`/`showing-hint`. Не нажимай «Очистить всё» для удаления одного тестового запроса. Если тест оставил историю, удали только свою запись.

`w3cActions:true` в `appium_set_value` посылает ввод текущему фокусу без elementUUID; сначала докажи фокус. Кириллица проверена обычным set_value на одном Samsung, не гарантирована для каждой клавиатуры/поля.

## Жесты и навигация

- `appium_gesture({sessionId:S,action:"scroll",direction:"down"})`; `up|down|left|right`. Проверяй смещение по следующему PNG/XML: успех на границе списка не означает движение.
- Для цели вне экрана: `appium_gesture({sessionId:S,action:"scroll_to_element",strategy:"id",selector:<цель>,direction:"down",maxScrollAttempts:3})`. Допустим `scrollDistancePreset:"small"|"medium"|"large"`. Остановись на цели/неизменном экране/лимите; после лимита переоцени экран, не запускай бесконечный повтор.
- Координатная прокрутка: `action:"scroll",x,y,endX,endY`; не передавай одновременно `direction`, он имеет приоритет. Для `swipe` доступны те же координаты либо direction; это жест для перелистывания/смахивания, не универсальная замена scroll.
- `appium_mobile_press_key({sessionId:S,key:"BACK"})` — системный Back (сначала может закрыть клавиатуру). `key:"HOME"` — главный экран. Результат каждого перехода проверить.
- `appium_app_lifecycle({sessionId:S,action:"activate",id:<package>})` открывает установленное приложение. Settings: `com.android.settings`. `query_state` с тем же id: `4` означает foreground, но нужный экран доказывает PNG/XML. Поиск Samsung Settings может иметь отдельный package `com.android.settings.intelligence`.
- `clear`, `uninstall`, `install`, `terminate` изменяют приложение/данные и не являются обычным восстановлением экрана. При несовместимой подписи APK не удаляй пользовательское приложение автоматически.
