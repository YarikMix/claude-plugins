# Selectel: справочник

Детали для `SKILL.md`. Плейсхолдеры: `<ACCOUNT>` — номер аккаунта, `<USER>` — сервисный
пользователь, `<PROJECT_ID>`, `<ZONE_ID>`, `<TOKEN>`.

## 1. Карта эндпоинтов

| Сервис | Где | Scope токена | Примечание |
|---|---|---|---|
| Identity (Keystone) | `https://cloud.api.selcloud.ru/identity/v3` | любой | выдаёт токены domain и project, каталог эндпоинтов лежит в теле ответа на `/auth/tokens` |
| resell (проекты аккаунта) | `https://api.selectel.ru/vpc/resell/v2` | domain | список и создание проектов аккаунта, не требует существующего project-токена |
| compute / network / image / volumev3 (Nova / Neutron / Glance / Cinder) | из каталога Keystone, по региону `ru-N`; хосты `<region>.cloud.api.selcloud.ru` для `ru`/`gis`, `*.servercore.com` для `kz`/`uz`/`ke` | project | флейворы, образы, сети, диски — только внутри существующего проекта |
| dnsv2 (DNS v2) | `https://api.selectel.ru/domains/v2` (ru); `https://api.servercore.com/domains/v2` (kz, uz, ke) | project | один эндпоинт на все ru-регионы, второй провайдер/регион не нужен |

Регион (пул) — вида `ru-9`, зона доступности внутри пула — вида `ru-9a`. Эндпоинт для каждого
сервиса всегда брать из каталога Keystone по фактическому региону, не хардкодить URL.

## 2. Токены Keystone

```bash
# domain-scope: IAM, resell, /auth/projects
curl -sS -i https://cloud.api.selcloud.ru/identity/v3/auth/tokens -H 'Content-Type: application/json' \
  -d '{"auth":{"identity":{"methods":["password"],"password":{"user":{"name":"<USER>","domain":{"name":"<ACCOUNT>"},"password":"<PASSWORD>"}}},"scope":{"domain":{"name":"<ACCOUNT>"}}}}' \
  | awk -F': ' 'tolower($1)=="x-subject-token"{print $2}' | tr -d '\r'

# project-scope: Nova, Neutron, Cinder, Glance, DNS v2
curl -sS -i https://cloud.api.selcloud.ru/identity/v3/auth/tokens -H 'Content-Type: application/json' \
  -d '{"auth":{"identity":{"methods":["password"],"password":{"user":{"name":"<USER>","domain":{"name":"<ACCOUNT>"},"password":"<PASSWORD>"}}},"scope":{"project":{"id":"<PROJECT_ID>"}}}}' \
  | awk -F': ' 'tolower($1)=="x-subject-token"{print $2}' | tr -d '\r'
```

Сам токен возвращается не в теле, а в заголовке ответа `X-Subject-Token` — оба `curl` выше вытаскивают
его через `awk` (без учёта регистра, поэтому `tolower($1)`).

Свои проекты (domain-токен): `GET https://cloud.api.selcloud.ru/identity/v3/auth/projects` с
заголовком `X-Auth-Token: <TOKEN>`.

Все проекты аккаунта (domain-токен, не требует роли на конкретный проект):
`GET https://api.selectel.ru/vpc/resell/v2/projects` с `X-Auth-Token: <TOKEN>`.

Каталог эндпоинтов приходит в теле ответа на `/auth/tokens` (или на повторный `token issue`) —
`.token.catalog[]`, каждый элемент — `type`, `name`, `endpoints[].region` и `endpoints[].url`.

`openstack --os-cloud <имя-облака> token issue -f value -c id` — токен без ручного `curl`;
`--os-project-id <PROJECT_ID>` переключает проект для одной команды, без правки `clouds.yaml`.

Факты:
- Домен Keystone — это номер аккаунта Selectel (строка из цифр, видна в шапке панели), а не имя
  пользователя; `domainName` в `clouds.yaml`, Pulumi и `curl` — всегда номер аккаунта.
- Два вида сервисных пользователей: уровня аккаунта (создаётся только в панели, пароль показывается
  один раз) и уровня проекта (можно создать через API/IaC при наличии `iam.admin`).
- Роли: `member` («Участник»), `iam.admin` («Администратор пользователей»), администратор
  аккаунта. `member` на аккаунт покрывает все проекты аккаунта — отдельный пользователь на проект
  не нужен.
- Токен со scope `domain` годится для IAM и resell API, в нём видны роли (`member`, `iam.admin`,
  `nobody`), работает `/auth/projects`. `403` на `identity:list_projects` и на
  `identity:list_role_assignments` — норма, не нехватка прав.
- Nova, Neutron, Cinder, Glance и DNS v2 принимают только токен со scope `project`.
- Запрос project-токена на несуществующий (в т. ч. удалённый) проект или без роли на него → **401**
  `The request you have made requires authentication`, а не 404. 401 на project-scope при верном
  пароле = «проекта нет или нет роли», проверять список проектов (`GET
  vpc/resell/v2/projects`).
- Имена сущностей уровня аккаунта (проект, сервисный пользователь, keypair) уникальны в аккаунте; в
  общем аккаунте чужое имя даёт `409 already_exists` от `vpc/resell/v2/projects`.

## 3. DNS v2

```bash
# список зон
curl -sS https://api.selectel.ru/domains/v2/zones -H "X-Auth-Token: <TOKEN>"

# поиск зоны по имени
curl -sS 'https://api.selectel.ru/domains/v2/zones?filter=<имя>.' -H "X-Auth-Token: <TOKEN>"

# записи зоны
curl -sS https://api.selectel.ru/domains/v2/zones/<ZONE_ID>/rrset -H "X-Auth-Token: <TOKEN>"

# создание A-записи
curl -sS -X POST https://api.selectel.ru/domains/v2/zones/<ZONE_ID>/rrset \
  -H "X-Auth-Token: <TOKEN>" -H 'Content-Type: application/json' \
  -d '{"name":"<host>.<zone>.","type":"A","ttl":60,"records":[{"content":"<IP>"}]}'
```

Все запросы — с project-scoped токеном (`<TOKEN>` из раздела 2, scope `project`); domain-токен на
DNS v2 отвечает 401.

Правила:
- Имена зон и записей — с точкой на конце (`example.ru.`), точку добавлять всегда.
- Зона живёт в том проекте, где зарегистрирован домен; вторую зону с тем же именем в другом проекте
  создать нельзя — одна зона на имя в аккаунте.
- Для поддомена в чужой зоне — rrset создаётся с `projectId` того проекта, где зона; для своего
  домена — своя зона в своём проекте плюс делегирование у регистратора домена на серверы имён
  `a.ns.selectel.ru`, `b.ns.selectel.ru`, `c.ns.selectel.ru`.
- API периодически (наблюдался флап на 15–20 минут) отвечает `500` HTML-страницей nginx на любой
  запрос с любым токеном, затем восстанавливается само. У Pulumi это выглядит как ошибка
  `invalid character '<' looking for beginning of value` на `getDomainsZoneV2`/`DomainsRrsetV2` —
  лечится ожиданием и повтором, не правкой конфига.

## 4. Имена сущностей

Панель Selectel не показывает ни id, ни имён флейворов (только vCPU/RAM/диск) — единственный
источник точных имён и id — API/CLI внутри любого проекта аккаунта. Публичные флейворы общие на
аккаунт, id числовые (например `1013` = `SL1.2-4096`), имена стабильны; искать флейвор по имени
(`getFlavorOutput({ name })` в Pulumi), id в конфиг не класть.

Семейства флейворов:
- `SL1.<vcpu>-<ram>[-<disk>]` — Standard Line, например `SL1.2-4096` (2 vCPU, 4096 МБ RAM,
  сетевой диск).
- `PRC10.*`, `PRC20.*`, `PRC50.*` — shared vCPU разных уровней производительности.
- `CPU1.*`, `RAM1.*`, `m1.*`.
- `HFL1.*` — локальный (не сетевой) диск.
- `GL2.*` — GPU.

`DISK GB = 0` в описании флейвора значит сетевой загрузочный диск — серверу с таким флейвором
нужен отдельный ресурс Volume.

Типы дисков — `<тип>.<зона>`: `basic`, `basicssd`, `universal`, `universal2`, `fast`, `iso`
(например `fast.ru-9a`); зона в типе диска должна совпадать с зоной доступности сервера.

Публичные образы ищутся по точному имени, посимвольно: `Ubuntu 24.04 LTS 64-bit`,
`Ubuntu 22.04 LTS 64-bit`, `Ubuntu 26.04 LTS 64-bit`; в списке много прикладных образов с тем же
суффиксом, поэтому нужны точное имя, `visibility: public` и выбор самого нового (`mostRecent`).
Образ Ubuntu версии 22.10 и новее запускает `sshd` через `ssh.socket` — `Port` в `sshd_config`
игнорируется, смена порта ssh требует отдельно отключить socket-активацию.

Внешняя сеть в регионе одна, имя `external-network`; floating IP берётся из пула с этим именем —
искать через `network list --external`, не угадывать id.

CLI:

```bash
openstack --os-cloud <имя> flavor list --long          # ID, Name, RAM, Disk, VCPUs
openstack --os-cloud <имя> image list --public | grep -i ubuntu
openstack --os-cloud <имя> volume type list
openstack --os-cloud <имя> network list --external
openstack --os-cloud <имя> project list
```

## 5. Таблица ошибок

| Код/текст | Где | Причина | Действие |
|---|---|---|---|
| `401 The request you have made requires authentication` (domain-scope) | Keystone `/auth/tokens` | неверные имя пользователя, пароль или номер аккаунта (`domainName`) | сверить `<USER>`/`<ACCOUNT>`/пароль |
| `401 The request you have made requires authentication` (project-scope) | Keystone `/auth/tokens` | проекта нет, он удалён, или у пользователя нет роли на него | `GET vpc/resell/v2/projects` — сверить `<PROJECT_ID>` из списка |
| `403` на `identity:list_projects` / `identity:list_role_assignments` | Keystone, domain-токен | норма для этих операций на domain-scope, не нехватка прав | использовать `/auth/projects` или resell вместо `/projects` |
| `403` на создании проекта или сервисного пользователя | resell / IAM | не хватает роли уровня аккаунта (`member` для проекта, `iam.admin` для пользователя) | проверить роли токена; при необходимости — администратор аккаунта |
| `409 already_exists` | `vpc/resell/v2/projects` (создание проекта) | имя уровня аккаунта уже занято — имена проектов, сервисных пользователей и keypair уникальны в аккаунте | взять уникальное имя (например с префиксом) |
| `500` HTML-страница nginx | `api.selectel.ru/domains/v2/*` | временный сбой DNS v2 API (наблюдался флап 15–20 минут) | подождать и повторить, не менять конфиг |
| `invalid character '<' looking for beginning of value` | Pulumi, `getDomainsZoneV2`/`DomainsRrsetV2` | тот же флап DNS v2, Pulumi получил HTML вместо JSON | подождать и повторить `pulumi up`/`preview` |
| `ExternalGatewayForFloatingIPNotFound` (404 Neutron) | привязка floating IP к порту | подсеть ещё не подключена к роутеру с внешним шлюзом | в Pulumi — `dependsOn: [routerInterface]` у `FloatingIpAssociate` |
| `Flavor not found` / `No suitable flavor` | Nova, `getFlavorOutput`/`flavor list` | опечатка в имени флейвора или флейвор недоступен в проекте/регионе | сверить точное имя через `openstack flavor list --long` |
| `could not find image` | Glance, поиск образа по имени | имя образа не совпадает посимвольно или образ непубличный | сверить точное имя через `openstack image list --public` |
| пустой `ansible-inventory --graph` | dynamic inventory `openstack.cloud.openstack` | не тот `project_id` в `clouds.yaml`, либо у серверов нет `metadata.role` | проверить `project_id` и `metadata` у серверов, задаваемые Pulumi |
| `CERTIFICATE_VERIFY_FAILED ... self-signed certificate in certificate chain` | Python с python.org на macOS, любой `https` | не выполнен `Install Certificates.command` | выполнить команду или использовать Python со своим доверенным хранилищем сертификатов (например через `certifi`) |
| смена порта ssh не действует | `sshd_config`, Ubuntu 22.10 и новее | `Port` игнорируется при socket-активации `ssh.socket` | отключить socket-активацию перед сменой порта |

Пример id для запроса к несуществующему/недоступному проекту (иллюстрация формата, не реальный
id): `00000000000000000000000000000000`.

## 6. Pulumi

Провайдер Selectel — terraform-bridged:

```yaml
# Pulumi.yaml
runtime:
  name: nodejs
  options:
    typescript: true
    packagemanager: bun          # иначе выбор по lock-файлу
packages:
  selectel:
    source: terraform-provider
    parameters: [selectel/selectel, "8.3.1"]
```

`pulumi install` генерирует SDK в `sdks/selectel` и дописывает
`"@pulumi/selectel": "file:sdks/selectel"` в `package.json`; `sdks/` — в `.gitignore`,
`pulumi install` обязателен на каждой машине. `pulumi install` выбирает менеджер пакетов по
lock-файлу — если lock-файл в `.gitignore`, на чистом клоне возьмёт npm, поэтому
`runtime.options.packagemanager` фиксируется явно.

Конфиг провайдера:

```bash
pulumi config set selectel:domainName <ACCOUNT>
pulumi config set selectel:username   <USER>
pulumi config set selectel:password   --secret
pulumi config set selectel:authUrl    https://cloud.api.selcloud.ru/identity/v3/
pulumi config set selectel:authRegion ru-9
```

Ресурсы внутри проекта — через провайдер `openstack`, на кредах проектного пользователя, которого
создаёт тот же код:

```ts
const os = new openstack.Provider("project", {
  authUrl: "https://cloud.api.selcloud.ru/identity/v3", domainName,
  tenantId: project.id, userName: serviceUser.name, password: password.result, region: pool,
});
const flavor = openstack.compute.getFlavorOutput({ name: flavorName }, { provider: os });
new openstack.networking.FloatingIpAssociate("server", { portId: port.id, floatingIp: fip.address },
  { provider: os, dependsOn: [routerInterface] });   // иначе ExternalGatewayForFloatingIPNotFound
const zone = selectel.getDomainsZoneV2Output({ name: "example.ru.", projectId: dnsProjectId });
new selectel.DomainsRrsetV2("gateway", { zoneId: zone.id, projectId: dnsProjectId,
  name: "app.example.ru.", type: "A", ttl: 60, records: [{ content: fip.address }] });
```

Заметка: `authUrl` провайдера `openstack` — без завершающего слэша, в отличие от
`selectel:authUrl`.

Ещё по одной строке:
- `VpcKeypairV2` требует `userId` сервисного пользователя.
- `IamServiceuserV1` — роли `[{roleName: "member", scope: "project", projectId}]`.
- `ignoreChanges: ["imageId"]` на диске и сервере ставить всегда — иначе обновление публичного
  образа пересоздаёт сервер.
- Логические имена ресурсов Pulumi входят в URN — переименование после первого `up` пересоздаёт
  ресурсы, не переименовывать.
- Имена уровня аккаунта (проект, сервисный пользователь, keypair) брать из конфига стека, не
  хардкодить в коде.
- Для своего домена зона создаётся ресурсом `DomainsZoneV2({ name, projectId: project.id })` в
  своём проекте.
- Порядок ресурсов: проект → сервисный пользователь → keypair.

## 7. Ansible

`clouds.yaml` (оба domain-поля равны номеру аккаунта):

```yaml
clouds:
  <имя-облака>:
    auth:
      auth_url: https://cloud.api.selcloud.ru/identity/v3
      username: <USER>
      password: <PASSWORD>
      project_id: <PROJECT_ID>
      user_domain_name: <ACCOUNT>
      project_domain_name: <ACCOUNT>
    region_name: ru-9
    identity_api_version: 3
```

`inventory/openstack.yml`:

```yaml
plugin: openstack.cloud.openstack
only_clouds: [<имя-облака>]
inventory_hostname: name
fail_on_errors: true
expand_hostvars: false
all_projects: false
keyed_groups:
  - key: openstack.metadata.role   # role=web -> группа web
    prefix: ""
    separator: ""
```

`requirements.yml`:

```yaml
collections:
  - name: openstack.cloud
    version: ">=2.0.0"
```

`requirements.txt`:

```
openstacksdk>=1.0.0
```

Первая проверка dynamic inventory — `ansible-inventory --graph`. Пустой inventory значит: не тот
`project_id` в `clouds.yaml`, либо у серверов нет `metadata.role` (его ставит Pulumi при создании
сервера).

## 8. Скрипт selectel.py

Путь: `scripts/selectel.py` (относительно каталога скилла). Только чтение — ни одной
записывающей операции к API.

Источник кредов, по приоритету:
1. `--cloud NAME [--clouds-file PATH]` — запись из `clouds.yaml` (ищется в текущем каталоге,
   `~/.config/openstack/clouds.yaml`, `/etc/openstack/clouds.yaml`); берутся `auth.username`,
   `auth.password`, `auth.user_domain_name` (номер аккаунта), `auth.project_id`, `auth.auth_url`,
   `region_name`.
2. Переменные окружения `SELECTEL_ACCOUNT`, `SELECTEL_USERNAME`, `SELECTEL_PASSWORD`;
   необязательно `SELECTEL_PROJECT_ID`, `SELECTEL_REGION` (по умолчанию `ru-9`),
   `SELECTEL_AUTH_URL`.
3. Если пароля нет ни там, ни там, и есть TTY — интерактивный `getpass`. Пароль никогда не
   принимается аргументом командной строки и никогда не печатается.

Подкоманды:

| Команда | Что делает | Вывод |
|---|---|---|
| `token [--scope domain\|project] [--project ID]` | токен нужного scope; `project` без `--project` берёт id из кредов | только строка токена в stdout, ничего больше |
| `projects` | проекты аккаунта через resell v2 (domain-токен) | таблица `id name enabled`; `--json` — массив |
| `catalog [--type TYPE] [--region REGION] [--project ID]` | эндпоинты каталога из project-токена; без проекта пробует domain-токен и, если каталога в нём нет, просит указать проект | таблица `type region interface url` |
| `check [--project ID] [--region REGION]` | диагностика доступа и живости API | пошагово `OK`/`FAIL` с расшифровкой; код выхода 1 при любом `FAIL` |

Пример вывода `check` (успех, с явным корректным проектом):
```
[OK] domain-токен: роли: <role1>, member, <role3>
[OK] проекты аккаунта (resell): N шт.
[OK] project-токен <PROJECT_ID>: compute в ru-9: есть
[OK] DNS v2: зон в проекте: N
ИТОГ: OK
```

Пример вывода `check` (неверный пароль):
```
[FAIL] domain-токен: пароль, имя пользователя или номер аккаунта неверны
ИТОГ: FAIL
```

Пример вывода `check` (несуществующий/недоступный project id):
```
[OK] domain-токен: роли: <role1>, member, <role3>
[OK] проекты аккаунта (resell): N шт.
[FAIL] project-токен <PROJECT_ID>: проекта нет или у пользователя нет роли на него; список: selectel.py projects
[SKIP] DNS v2: нужен project-токен
ИТОГ: FAIL
```

Пример вывода `projects`:
```
id                                name               enabled
<PROJECT_ID>                      <PROJECT_NAME>     True
<PROJECT_ID_2>                    <PROJECT_NAME_2>   True
```

Пример вывода `catalog --type dnsv2` (первые строки):
```
type   region  interface  url
dnsv2  ke-1    public     https://api.servercore.com/domains/v2
dnsv2  kz-1    public     https://api.servercore.com/domains/v2
dnsv2  ru-1    public     https://api.selectel.ru/domains/v2
...
```

Общие правила: `--json` для машиночитаемого вывода у всех команд, кроме `token`; ответ,
начинающийся с `<` (HTML), распознаётся отдельно от JSON-ошибок и показывается как «сервер вернул
HTML, код N»; таймаут запроса — 20 с. Коды выхода: `0` — успех, `1` — проверка не прошла или API
ответил ошибкой, `2` — ошибка использования или конфигурации.
