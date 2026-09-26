# Плагин `selectel-ops`: скилл для работы с Selectel — дизайн

Дата: 2026-09-26

## Задача

Добавить в маркетплейс `yarikmix-plugins` второй плагин — `selectel-ops` — со скиллом, который даёт
агенту Claude Code рабочие процедуры для облака Selectel: модель доступа, карта API, чтение проектов,
флейворов, образов и DNS, диагностика ошибок и проверенные особенности стыка Selectel с Pulumi и Ansible.

Скилл для любого, кто подключит маркетплейс, включая студентов курса DevOps: никаких номеров аккаунта,
id проектов, адресов и доменов конкретного стенда; всё, что нужно для работы, читается из окружения
пользователя (`clouds.yaml` или переменные) в момент запуска.

## Что установлено на практике

Всё ниже проверено на живом аккаунте Selectel при поднятии учебного стенда (Pulumi + Ansible,
сентябрь 2026). Именно это знание скилл переносит в новые сессии; ничего непроверенного в него не входит.

### Доступ

| Факт | Следствие для скилла |
|---|---|
| Keystone: `https://cloud.api.selcloud.ru/identity/v3`. Домен Keystone = номер аккаунта Selectel (строка из цифр, видна в шапке панели) | `domainName` в `clouds.yaml`, Pulumi и `curl` — это номер аккаунта, а не имя пользователя |
| Два вида сервисных пользователей: уровня аккаунта (создаётся только в панели, пароль показывается один раз) и уровня проекта (можно создать через API/IaC, если у вызывающего есть `iam.admin`) | Панель обязательна для первого пользователя; дальше всё через API |
| Роли: `member` («Участник»), `iam.admin` («Администратор пользователей»), администратор аккаунта. `member` на аккаунт покрывает все проекты аккаунта, отдельный пользователь на проект не нужен | Один пользователь аккаунта обслуживает и Pulumi, и Ansible |
| Токен со scope `domain` (`{"scope":{"domain":{"name":"<аккаунт>"}}}`) годится для IAM и resell API; в нём видны роли (`member`, `iam.admin`, `nobody`) и работает `/auth/projects` (свои проекты). `identity:list_projects` и `identity:list_role_assignments` при этом отвечают 403 — это норма, не нехватка прав | Список проектов брать через `/auth/projects` или resell, а не `/projects` |
| `openstack project list` через CLI работает и отдаёт проекты аккаунта; сырой `GET /v3/projects` с domain-токеном отвечает 403 (`identity:list_projects`) — CLI идёт другим путём | Список проектов: CLI, `/auth/projects` или resell; не `GET /v3/projects` |
| Nova, Neutron, Cinder, Glance и DNS v2 принимают только токен со scope `project` | Флейворы, образы, сети, зоны DNS — только внутри существующего проекта |
| Запрос project-токена на несуществующий (в т.ч. удалённый) проект или без роли на него → **401** `The request you have made requires authentication`, а не 404 | 401 при верном пароле = «проекта нет или нет роли», проверять список проектов |
| resell API `https://api.selectel.ru/vpc/resell/v2/projects` с domain-токеном в `X-Auth-Token` отдаёт все проекты аккаунта (id, name, enabled) | Способ узнать id проекта без панели |
| Имена сущностей уровня аккаунта (проект, сервисный пользователь, keypair) уникальны в аккаунте; в общем аккаунте чужое имя даёт `409 already_exists` от `vpc/resell/v2/projects` | Имена задавать через конфиг с уникальным префиксом |

### Каталог и регионы

| Факт | Следствие |
|---|---|
| В каталоге Keystone эндпоинты по регионам: `ru-1/2/3/7/8/9`, `gis-1`, `kz-1`, `uz-1/2`, `ke-1`; хосты `*.cloud.api.selcloud.ru` для ru/gis и `*.servercore.com` для kz/uz/ke | Регион (пул) — `ru-9`, зона доступности — `ru-9a`; эндпоинт брать из каталога по региону, не хардкодить |
| Тип `dnsv2` в каталоге: `https://api.selectel.ru/domains/v2` (ru), `https://api.servercore.com/domains/v2` (kz/uz/ke) | DNS API один на все ru-регионы |
| Внешняя сеть в регионе одна, имя `external-network`; floating IP берётся из пула с этим именем | Искать через `network list --external`, не угадывать id |

### Флейворы, диски, образы

| Факт | Следствие |
|---|---|
| Панель Selectel не показывает ни id, ни имён флейворов (только vCPU/RAM/диск) | Единственный источник — API/CLI внутри любого проекта аккаунта |
| Публичные флейворы общие на аккаунт, id числовые (например `1013` = `SL1.2-4096`), имена стабильны | Искать флейвор по имени (`getFlavorOutput({ name })`), id в конфиг не класть |
| Семейства: `SL1.<vcpu>-<ram>[-<disk>]` (Standard Line), `PRC10/20/50.*` (shared), `CPU1.*`, `RAM1.*`, `HFL1.*` (локальный диск), `GL2.*` (GPU), `m1.*`. `DISK GB = 0` — сетевой загрузочный диск, нужен ресурс Volume | Для сервера с сетевым диском брать флейвор с `disk = 0` |
| Типы дисков `<тип>.<зона>`: `basic`, `basicssd`, `universal`, `universal2`, `fast`, `iso` (например `fast.ru-9a`) | Зона в типе диска должна совпадать с зоной сервера |
| Публичные образы ищутся по точному имени: `Ubuntu 24.04 LTS 64-bit`, `Ubuntu 22.04 LTS 64-bit`, `Ubuntu 26.04 LTS 64-bit`; в списке много прикладных образов с тем же суффиксом | Имя посимвольно, `visibility: public`, `mostRecent` |
| Образ Ubuntu ≥ 22.10 запускает sshd через `ssh.socket`: `Port` в `sshd_config` игнорируется | Смена порта ssh требует отключить socket-активацию |

### Сеть

| Факт | Следствие |
|---|---|
| `FloatingIpAssociate` до подключения подсети к роутеру с внешним шлюзом → Neutron `404 ExternalGatewayForFloatingIPNotFound` | В Pulumi привязка должна зависеть от `RouterInterface` (`dependsOn`), Pulumi сам эту зависимость не выводит |

### DNS v2

| Факт | Следствие |
|---|---|
| Зона живёт в том проекте, где зарегистрирован домен; вторую зону с тем же именем в другом проекте создать нельзя | Для поддомена в чужой зоне — rrset с `projectId` того проекта; для своего домена — зона в своём проекте + делегирование у регистратора на `a/b/c.ns.selectel.ru` |
| Имена зон и записей с точкой на конце (`example.ru.`); список зон `GET /zones`, поиск `GET /zones?filter=<name>.`, записи `GET /zones/{id}/rrset`, создание `POST /zones/{id}/rrset` с `{"name","type","ttl","records":[{"content"}]}` | Точку добавлять всегда |
| API периодически (наблюдалось 15–20 минут) отвечает `500` HTML-страницей nginx на **любой** запрос с любым токеном; затем восстанавливается само | У Pulumi это `invalid character '<' looking for beginning of value` на `getDomainsZoneV2`/`DomainsRrsetV2`; лечится ожиданием и повтором, не правкой конфига |
| Нужен project-scoped токен (domain-scoped → 401) | В Pulumi ресурс `DomainsRrsetV2` принимает `projectId`, второй провайдер не нужен |

### Pulumi

| Факт | Следствие |
|---|---|
| Провайдер Selectel — terraform-bridged: в `Pulumi.yaml` блок `packages: selectel: {source: terraform-provider, parameters: [selectel/selectel, <версия>]}`; `pulumi install` генерирует SDK в `sdks/selectel` и дописывает `"@pulumi/selectel": "file:sdks/selectel"` | `sdks/` в `.gitignore`, `pulumi install` обязателен на каждой машине |
| `pulumi install` выбирает менеджер пакетов по lock-файлу; если lock-файл в `.gitignore`, на чистом клоне возьмёт npm | Фиксировать `runtime.options.packagemanager` |
| Конфиг провайдера: `selectel:domainName` (номер аккаунта), `selectel:username`, `selectel:password` (secret), `selectel:authUrl` (`.../identity/v3/`), `selectel:authRegion` | Стандартный набор для `Pulumi.<stack>.yaml` |
| Ресурсы внутри проекта делаются провайдером `openstack` с кредами созданного тем же кодом проектного пользователя: `authUrl` без завершающего слэша, `domainName`, `tenantId: project.id`, `userName`, `password`, `region` | Один код создаёт и проект, и содержимое |
| `VpcKeypairV2` требует `userId` сервисного пользователя; `IamServiceuserV1` — `roles: [{roleName: member, scope: project, projectId}]` | Порядок: проект → пользователь → keypair |
| `ignoreChanges: ["imageId"]` на диске и сервере: обновление публичного образа иначе пересоздаёт сервер | Ставить всегда |
| Логические имена ресурсов Pulumi входят в URN: переименование пересоздаёт ресурсы | Не переименовывать после первого `up` |

### Ansible

| Факт | Следствие |
|---|---|
| `clouds.yaml`: `auth_url`, `username`, `password`, `project_id`, `user_domain_name` и `project_domain_name` — оба равны номеру аккаунта, `region_name`, `identity_api_version: 3` | Шаблон в скилле |
| Dynamic inventory `openstack.cloud.openstack`: `only_clouds`, `inventory_hostname: name`, `keyed_groups` по `openstack.metadata.role`, `expand_hostvars: false`, `fail_on_errors: true`; нужен `openstacksdk` (`pip`) и коллекция `openstack.cloud` | Группа `web` собирается по `metadata` сервера, который ставит Pulumi |
| Пустой inventory = не тот `project_id` в `clouds.yaml` или нет `metadata.role` у сервера | Первым делом `ansible-inventory --graph` |

### Окружение

| Факт | Следствие |
|---|---|
| Python 3.x с python.org на macOS без `Install Certificates.command`: `urllib` падает с `CERTIFICATE_VERIFY_FAILED ... self-signed certificate in certificate chain` на любом https | Скрипт использует `certifi`, если он импортируется |
| `openstack` CLI (`python-openstackclient`) с `--os-cloud <имя>` — самый быстрый способ смотреть флейворы, образы, типы дисков, проекты; `--os-project-id` переключает проект без правки `clouds.yaml`; `openstack token issue -f value -c id` даёт токен для `curl` | CLI необязателен, но скилл его рекомендует |

## Границы

**В скилле:** доступ и роли; Keystone, каталог, resell, DNS v2; проекты, флейворы, образы, типы дисков,
внешние сети; что делается только в панели; диагностика по кодам ответов; стык с Pulumi
(`terraform-provider-selectel`, провайдер openstack внутри проекта, DNS, гонка floating IP) и Ansible
(`clouds.yaml`, dynamic inventory).

**Не в скилле:** конкретика чьего-либо стенда (номера, id, адреса, домены, пароли); автоматизация
панели через браузер (не проверялась); S3, Managed Kubernetes, DBaaS, биллинг; всё, что относится
к настройке самого сервера (hardening, fail2ban, Docker) — это не Selectel.

## Структура плагина

```
plugins/selectel-ops/
├── README.md                    # для человека: что даёт, установка, требования; RU + короткий EN
├── LICENSE                      # MIT, копия из typescript-native-lsp
└── skills/selectel-ops/
    ├── SKILL.md                 # процедуры и развилки, ориентир 200 строк
    ├── REFERENCE.md             # карта API, тела запросов, таблица ошибок, IaC-фрагменты
    └── scripts/selectel.py      # токен, проекты, каталог, диагностика
```

Манифеста `.claude-plugin/plugin.json` нет — как у `typescript-native-lsp`, метаданные в
`marketplace.json`. Если при установке из локального клона выяснится, что для плагина со `skills/`
манифест обязателен, он добавляется минимальным (`name`, `description`, `version`).

Запись в `.claude-plugin/marketplace.json`:

```json
{
  "name": "selectel-ops",
  "description": "Работа с облаком Selectel: доступ, проекты, флейворы, DNS, диагностика, стык с Pulumi и Ansible",
  "version": "1.0.0",
  "author": { "name": "Yaroslav Mihalev" },
  "source": "./plugins/selectel-ops",
  "category": "development",
  "strict": false
}
```

Строка в корневом `README.md`:

```
| [selectel-ops](plugins/selectel-ops/README.md) | скилл для работы с облаком Selectel: доступ, API, DNS, стык с Pulumi и Ansible | `/plugin install selectel-ops@yarikmix-plugins` |
```

В сессии скилл виден как `selectel-ops:selectel-ops`.

## `SKILL.md`

Frontmatter:

```yaml
---
name: selectel-ops
description: Работа с облаком Selectel через API, openstack CLI и панель — модель доступа и роли сервисных пользователей, токены нужного scope, проекты, флейворы, образы, типы дисков, внешние сети, DNS v2, диагностика 401/403/409/500, проверенные особенности стыка с Pulumi (terraform-provider-selectel, @pulumi/selectel) и Ansible (clouds.yaml, dynamic inventory openstack.cloud). Активируется при упоминании Selectel, селектел, selcloud, cloud.api.selcloud.ru, api.selectel.ru, clouds.yaml, сервисный пользователь Selectel, облачный проект, флейвор, floating IP, DNS Selectel, terraform-provider-selectel, @pulumi/selectel, openstack.cloud inventory.
---
```

Разделы, по порядку:

1. **Чего ты никогда не делаешь.** Не печатать пароли и токены (токен — только по команде `token`,
   и только он). Не удалять проекты, серверы, зоны без явной просьбы пользователя в этой сессии.
   В общем аккаунте не создавать сущности уровня аккаунта с обобщёнными именами (`study`, `test`,
   `pulumi-*`). Не угадывать id флейворов, имена образов и сетей — только из API.
2. **Модель доступа за минуту.** Аккаунт = домен Keystone; два вида сервисных пользователей;
   роли; какой scope для чего. Ссылка на REFERENCE за телами запросов.
3. **Куда идти с какой задачей.** Таблица «задача → инструмент»: флейвор/образ/тип диска/внешняя
   сеть → `openstack` CLI или скрипт+`curl` внутри любого проекта; список проектов и их id →
   `selectel.py projects`; создать проект/пользователя → IaC (Pulumi) или панель; DNS-запись →
   IaC или `curl` к DNS v2; сервер не отвечает по ssh → консоль в панели; первый сервисный
   пользователь аккаунта → только панель.
4. **Фаза 0 — pre-flight.** До любой работы `python3 scripts/selectel.py --cloud NAME check`
   (или переменные окружения). Как читать вывод: каждый шаг OK/FAIL с расшифровкой; при FAIL —
   таблица в разделе 9.
5. **Процедуры.** Токен нужного scope (скрипт, `openstack token issue`, `curl`). Проекты. Флейворы,
   образы, типы дисков по регионам (`openstack ... --os-cloud`, `--os-project-id`). DNS: найти
   зону, посмотреть записи, создать A-запись; правило точки; зона привязана к проекту домена.
   Сети: имя внешней сети, floating IP.
6. **Только в панели.** Сервисный пользователь аккаунта и его роли (пароль один раз; при 403
   на создании проекта — роль администратора аккаунта). Консоль сервера при потере ssh.
7. **Selectel в Pulumi.** Bridged-провайдер и `packages`, `pulumi install` и `sdks/`,
   `packagemanager`, конфиг `selectel:*`, провайдер openstack внутри проекта, `getFlavorOutput`
   по имени, `dependsOn: [routerInterface]` у `FloatingIpAssociate`, `ignoreChanges: ["imageId"]`,
   DNS через `getDomainsZoneV2Output` + `DomainsRrsetV2` с `projectId` зоны или своя зона
   `DomainsZoneV2`, имена уровня аккаунта из конфига, логические имена не переименовывать.
8. **Selectel в Ansible.** `clouds.yaml` (оба domain-поля = номер аккаунта), inventory
   `openstack.cloud` по `metadata`, зависимости, `ansible-inventory --graph` как первая проверка.
9. **Когда что-то не получается.** Таблица симптом → причина → действие (см. REFERENCE §5,
   в SKILL — короткая версия): 401 при domain-scope — пароль/имя/номер аккаунта; 401 при
   project-scope с верным паролем — проекта нет или нет роли; 403 на создании проекта или
   пользователя — роли аккаунта; 403 на `identity:list_*` — норма; 409 — имя занято в аккаунте;
   500 HTML от `api.selectel.ru/domains/v2` — сбой API, ждать; `invalid character '<'` у Pulumi —
   то же; `ExternalGatewayForFloatingIPNotFound` — `dependsOn`; `Flavor not found` — имя из
   `flavor list`; пустой inventory — `project_id`/`metadata`; `Port` в sshd не действует —
   `ssh.socket`.
10. **Что отдавать наружу.** Что проверено, какой командой, какой scope; что осталось за
    пользователем (панель, `pulumi up`, деньги). Никаких токенов и паролей в ответе.

## `REFERENCE.md`

1. **Карта эндпоинтов.** Таблица: сервис, URL/тип в каталоге, требуемый scope, регион.
2. **Тела запросов Keystone** для обоих scope; чтение `X-Subject-Token` и каталога; `/auth/projects`.
   Всё как `curl`, готовое к копированию, с плейсхолдерами `<ACCOUNT>`, `<USER>`, `<PROJECT_ID>`.
3. **DNS v2.** Зоны, фильтр, rrset, создание записи, формат имён, TTL; правило
   «одна зона на имя в аккаунте».
4. **Имена сущностей.** Семейства флейворов и что значит `disk = 0`; типы дисков `<тип>.<зона>`;
   имена образов; `external-network`; зоны доступности внутри пулов.
5. **Таблица ошибок**, полная: код, где встречается, причина, действие, пример текста ошибки.
6. **Pulumi.** Фрагменты TypeScript до десяти строк: `Pulumi.yaml` `packages`; конфиг
   `selectel:*`; `openstack.Provider` на кредах проектного пользователя; `getFlavorOutput`;
   `FloatingIpAssociate` с `dependsOn`; `getDomainsZoneV2Output` + `DomainsRrsetV2`;
   `DomainsZoneV2` для своего домена.
7. **Ansible.** `clouds.yaml`, `inventory/openstack.yml`, `requirements.yml`, `requirements.txt`.
8. **Скрипт.** Подкоманды `selectel.py`, переменные окружения, примеры вывода, коды выхода.

## `scripts/selectel.py`

Один файл, Python ≥ 3.8, только стандартная библиотека. `certifi` и `PyYAML` — необязательные:
`certifi` подхватывается для TLS, если импортируется; `PyYAML` нужен только для `--cloud`
(чтение `clouds.yaml`), без него скрипт печатает понятную ошибку и предлагает переменные окружения
или `pip install pyyaml`. У пользователя с рабочим dynamic inventory `PyYAML` уже есть
(зависимость `openstacksdk`).

Источник кредов, по приоритету:

1. `--cloud NAME [--clouds-file PATH]` — запись из `clouds.yaml`; файл ищется в текущем каталоге,
   `~/.config/openstack/clouds.yaml`, `/etc/openstack/clouds.yaml`. Берутся `auth.username`,
   `auth.password`, `auth.user_domain_name` (номер аккаунта), `auth.project_id`, `auth.auth_url`,
   `region_name`.
2. Переменные `SELECTEL_ACCOUNT`, `SELECTEL_USERNAME`, `SELECTEL_PASSWORD`; необязательно
   `SELECTEL_PROJECT_ID`, `SELECTEL_REGION` (по умолчанию `ru-9`), `SELECTEL_AUTH_URL`.
3. Если пароля нет ни там, ни там и есть TTY — `getpass`. Пароль никогда не принимается аргументом
   командной строки и никогда не печатается.

Подкоманды:

| Команда | Что делает | Вывод |
|---|---|---|
| `token [--scope domain\|project] [--project ID]` | токен нужного scope; `project` без `--project` берёт id из кредов | только строка токена в stdout, ничего больше |
| `projects` | проекты аккаунта через resell v2 (domain-токен) | таблица `id name enabled`; `--json` — массив |
| `catalog [--type TYPE] [--region REGION] [--project ID]` | эндпоинты каталога из project-токена; без проекта пробует domain-токен и, если каталога в нём нет, просит указать проект | таблица `type region interface url` |
| `check [--project ID] [--region REGION]` | диагностика доступа и живости API | пошагово `OK`/`FAIL` с расшифровкой; код выхода 1 при любом FAIL |

Шаги `check`:

1. Domain-токен: пароль, имя, номер аккаунта верны → печатает роли из токена; 401 → «пароль, имя или
   номер аккаунта неверны».
2. resell `/projects`: доступ уровня аккаунта; печатает число проектов; 403 → «нет роли `member`
   на аккаунт».
3. Если проект задан (аргументом или из кредов): project-токен; 401 → «проекта нет или нет роли на
   него; список — `selectel.py projects`». Печатает, есть ли в каталоге `compute` для региона.
4. DNS v2 `GET /zones` с project-токеном: 200 → число зон; 500 с HTML-телом → «временный сбой DNS
   API Selectel, повторить позже; у Pulumi это `invalid character '<'`»; 401 → «нужен
   project-scoped токен».
5. Итог: `OK` или `FAIL` и код выхода.

Общие правила: `--json` для машиночитаемого вывода у всех команд, кроме `token`; HTML в теле ответа
(начинается с `<`) распознаётся отдельно от JSON-ошибок и показывается как «сервер вернул HTML,
код N»; таймауты 20 с; коды выхода `0` успех, `1` проверка не прошла или API ответил ошибкой,
`2` ошибка использования или конфигурации. Скрипт только читает — ни одной записывающей операции.
Глобальные опции `--cloud`, `--clouds-file`, `--json` принимаются и до, и после подкоманды.

## README плагина

Что даёт скилл (три строки), требования (Python 3, по желанию `openstack` CLI и `PyYAML`),
установка (`/plugin marketplace add`, `/plugin install`), как проверить доступ
(`python3 <путь к скиллу>/scripts/selectel.py check --cloud <имя>`), что скилл **не** делает
(записи, панель, S3/MKS/DBaaS). Русский основной, короткий английский раздел «Installation» —
как у `typescript-native-lsp`.

## Проверка

- Скрипт на живом аккаунте: `token` обоих scope, `projects`, `catalog --type dnsv2`, `check`
  с проектом и без; `check` с неверным паролем → FAIL на шаге 1 с текстом про пароль;
  `check --project <несуществующий>` → FAIL на шаге 3 с текстом про проект. Запуск на Python с
  python.org без `Install Certificates.command` — TLS через `certifi`.
- Плагин ставится из локального клона маркетплейса; `selectel-ops:selectel-ops` виден в списке
  скиллов; в новой сессии вопрос «какой флейвор взять в Selectel под 2 vCPU» вызывает скилл без
  упоминания его имени.
- `claude plugin validate` по репозиторию и `/skill-doctor` по скиллу — если доступны в текущей
  версии CLI.
- `grep` по каталогу плагина: ни номера аккаунта, ни id проектов, ни IP, ни доменов стенда,
  ни паролей.
- `SKILL.md` укладывается примерно в 200 строк; всё длинное — в `REFERENCE.md`.

## Что остаётся снаружи

Стендовые детали — в `CLAUDE.md` и README репозитория стенда. Автоматизация панели через браузер —
не описывается, пока не проверена. S3, Managed Kubernetes, DBaaS, биллинг — не входят.
