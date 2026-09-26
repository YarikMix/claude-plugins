---
name: selectel-ops
description: Работа с облаком Selectel через API, openstack CLI и панель — модель доступа и роли сервисных пользователей, токены нужного scope, проекты, флейворы, образы, типы дисков, внешние сети, DNS v2, диагностика 401/403/409/500, проверенные особенности стыка с Pulumi (terraform-provider-selectel, @pulumi/selectel) и Ansible (clouds.yaml, dynamic inventory openstack.cloud). Активируется при упоминании Selectel, селектел, selcloud, cloud.api.selcloud.ru, api.selectel.ru, clouds.yaml, сервисный пользователь Selectel, облачный проект, флейвор, floating IP, DNS Selectel, terraform-provider-selectel, @pulumi/selectel, openstack.cloud inventory.
---

# Selectel Ops

Скилл для облака Selectel: доступ, проекты, флейворы, образы, диски, сети, DNS v2, диагностика
ошибок и проверенные особенности стыка с Pulumi и Ansible. Скрипт `scripts/selectel.py` — только
чтение, ни одной записывающей операции к API. Детали и тела запросов — в `REFERENCE.md` (ссылки
«REFERENCE §N»).

## Чего ты никогда не делаешь

1. Не печатаешь пароли и токены. Токен — только через `python3 scripts/selectel.py token`, и
   только он, ничего больше в stdout.
2. Не удаляешь проекты, серверы, зоны без явной просьбы пользователя в этой сессии.
3. В общем аккаунте не создаёшь сущности уровня аккаунта (проект, сервисный пользователь,
   keypair) с обобщёнными именами (`study`, `test`, `pulumi-*`) — имя должно быть уникальным.
4. Не угадываешь id флейворов, имена образов и сетей — только из API/CLI (REFERENCE §4).

## Модель доступа за минуту

- Аккаунт = домен Keystone: номер аккаунта Selectel — это `domainName`, а не имя пользователя.
- Два вида сервисных пользователей: уровня аккаунта (только панель, пароль один раз) и уровня
  проекта (можно через API/IaC при наличии `iam.admin`).
- Роли: `member` (на все проекты аккаунта), `iam.admin` (создание пользователей), администратор
  аккаунта.
- Scope `domain` — для IAM и resell (`/auth/projects`, список проектов); scope `project` — для
  всего внутри проекта (compute, network, image, volume, DNS v2).
- `401` на project-scope при верном пароле = проекта нет или на него нет роли — сверить список
  проектов.
- `403` на `identity:list_projects`/`identity:list_role_assignments` при domain-scope — норма,
  не нехватка прав.

Тела запросов и полный разбор — REFERENCE §2.

## Куда идти с какой задачей

| Задача | Инструмент |
|---|---|
| флейвор, образ, тип диска, внешняя сеть | `openstack --os-cloud <имя> ...` внутри любого проекта аккаунта (REFERENCE §4) |
| список проектов и их id | `python3 scripts/selectel.py --cloud <имя> projects` |
| токен для `curl` | `scripts/selectel.py token [--scope project]` или `openstack token issue -f value -c id` |
| создать проект, проектного пользователя, keypair | IaC (Pulumi, REFERENCE §6) или панель |
| DNS-запись | IaC или `curl` к DNS v2 (REFERENCE §3) |
| первый сервисный пользователь аккаунта и его роли | только панель |
| сервер не отвечает по ssh | консоль сервера в панели |

## Фаза 0 — pre-flight

Перед любой работой:

```bash
python3 scripts/selectel.py --cloud <имя> check
# либо через SELECTEL_ACCOUNT / SELECTEL_USERNAME / SELECTEL_PASSWORD [/ SELECTEL_PROJECT_ID]
```

Скилл установлен как плагин — если текущий каталог не каталог скилла, используй абсолютный путь
`<каталог этого SKILL.md>/scripts/selectel.py`.

Вывод — четыре строки `[OK]`/`[FAIL]`/`[SKIP]` по порядку: domain-токен → проекты аккаунта →
project-токен (если проект задан) → DNS v2, и итог `OK`/`FAIL`. Без `[OK]` на domain-токене
дальше не двигаться — остальные шаги от него зависят. При `[FAIL]` на любом шаге — раздел «Когда
что-то не получается» ниже по тексту сообщения.

## Процедуры

### Токен

```bash
python3 scripts/selectel.py --cloud <имя> token                    # domain-scope
python3 scripts/selectel.py --cloud <имя> token --scope project    # project-scope из кредов
openstack --os-cloud <имя> token issue -f value -c id              # альтернатива без скрипта
```

### Проекты

```bash
python3 scripts/selectel.py --cloud <имя> [--json] projects
```

### Флейворы, образы, типы дисков

```bash
openstack --os-cloud <имя> flavor list --long
openstack --os-cloud <имя> image list --public | grep -i ubuntu
openstack --os-cloud <имя> volume type list
```

Искать по точному имени, не по id (REFERENCE §4). `DISK GB = 0` у флейвора значит сетевой диск —
нужен отдельный ресурс Volume. Зона типа диска (`<тип>.<зона>`) должна совпадать с зоной сервера.

### DNS

1. Найти зону: `GET /zones?filter=<имя>.` (точка на конце — обязательна).
2. Посмотреть записи: `GET /zones/<ZONE_ID>/rrset`.
3. Создать A-запись: `POST /zones/<ZONE_ID>/rrset` с `type: A` и точкой в конце имени записи.

```bash
curl -sS 'https://api.selectel.ru/domains/v2/zones?filter=<имя>.' -H "X-Auth-Token: <TOKEN>"
```

Зона живёт в том проекте, где зарегистрирован домен — токен и `projectId` брать оттуда, вторую
зону с тем же именем в другом проекте не создать. Полные тела запросов — REFERENCE §3.

### Сети

```bash
openstack --os-cloud <имя> network list --external
```

Внешняя сеть в регионе одна, имя `external-network`; floating IP — из её пула, id не угадывать.

## Только в панели

- Первый сервисный пользователь аккаунта и его роли — создаётся только в панели, пароль
  показывается один раз. `403` при создании проекта или сервисного пользователя через API — у
  пользователя аккаунта нет роли `member` и/или `iam.admin` на аккаунт; если с этими ролями
  всё равно `403` — выдать роль «Администратор аккаунта». Роли выдаются только в панели.
- Консоль сервера — если сервер не отвечает по ssh.

## Selectel в Pulumi

1. Провайдер terraform-bridged: `packages.selectel` в `Pulumi.yaml`, `pulumi install` на каждой
   машине.
2. `sdks/` — в `.gitignore`.
3. `runtime.options.packagemanager` фиксировать явно — иначе выбор по lock-файлу может дать npm.
4. Конфиг стека: `selectel:domainName`, `selectel:username`, `selectel:password` (`--secret`),
   `selectel:authUrl`, `selectel:authRegion`.
5. Ресурсы внутри проекта — провайдер `openstack` на кредах проектного пользователя (`authUrl`
   без завершающего слэша).
6. Флейвор — `getFlavorOutput({ name })` по имени, не по id.
7. `FloatingIpAssociate` — `dependsOn: [routerInterface]`, иначе `ExternalGatewayForFloatingIPNotFound`.
8. `ignoreChanges: ["imageId"]` на диске и сервере — ставить всегда.
9. DNS: `getDomainsZoneV2Output` + `DomainsRrsetV2` с `projectId` чужой зоны, либо `DomainsZoneV2`
   для своего домена.
10. Имена уровня аккаунта — из конфига стека, не хардкодить. Логические имена ресурсов Pulumi не
    переименовывать — входят в URN, пересоздают ресурсы.

Фрагменты кода — REFERENCE §6.

## Selectel в Ansible

`clouds.yaml`: оба domain-поля (`user_domain_name`, `project_domain_name`) равны номеру
аккаунта. Dynamic inventory `openstack.cloud.openstack` группирует хосты по `openstack.metadata`
сервера (`keyed_groups`). Нужны пакет `openstacksdk` и коллекция `openstack.cloud`. Первая
проверка нового inventory — `ansible-inventory --graph`; пустой вывод — см. таблицу ниже.
Шаблоны файлов — REFERENCE §7.

## Когда что-то не получается

| Симптом | Причина | Действие |
|---|---|---|
| `401` при domain-scope | неверные пользователь, пароль или номер аккаунта | сверить `<USER>`/`<ACCOUNT>`/пароль |
| `401` при project-scope с верным паролем | проекта нет или нет роли на него | `selectel.py projects` |
| `403` на `identity:list_*` (domain-scope) | норма для этих операций | использовать `/auth/projects` или resell |
| `403` на создании проекта/пользователя | нет роли `member`/`iam.admin` на аккаунт | выдать роль в панели; повторный `403` — роль «Администратор аккаунта» |
| `409 already_exists` | имя уровня аккаунта занято | взять уникальное имя |
| `500` HTML от `api.selectel.ru/domains/v2` | временный сбой DNS v2 | подождать и повторить |
| `invalid character '<'` в Pulumi | тот же сбой DNS v2, получен HTML вместо JSON | подождать, повторить `up`/`preview` |
| `ExternalGatewayForFloatingIPNotFound` | подсеть не подключена к роутеру | `dependsOn: [routerInterface]` |
| `Flavor not found` / `could not find image` | опечатка в имени | сверить через `flavor list --long` / `image list --public` |
| пустой `ansible-inventory --graph` | не тот `project_id` или нет `metadata.role` | сверить `clouds.yaml` и metadata сервера |
| смена порта ssh не действует | `ssh.socket` игнорирует `Port` (Ubuntu ≥ 22.10) | отключить socket-активацию |

Полная таблица с текстами ошибок — REFERENCE §5.

## Что отдавать наружу

В ответе — что проверено, какой командой и с каким scope токена (например: «project-токен,
`selectel.py --cloud <имя> check` — DNS v2 доступен, N зон»). За пользователем остаются: панель
(первый сервисный пользователь, консоль сервера), запуск `pulumi up`/`pulumi preview`, оплата.
Токены и пароли в ответ не попадают.
