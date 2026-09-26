#!/usr/bin/env bash
# Структура и чистота документов скилла: заголовки на месте, нет идентификаторов чужого стенда.
set -u
cd "$(dirname "$0")/../skills/selectel-ops" || exit 2
fail=0
need() { grep -qF -- "$2" "$1" || { echo "нет в $1: $2"; fail=1; }; }

for h in "## 1. Карта эндпоинтов" "## 2. Токены Keystone" "## 3. DNS v2" "## 4. Имена сущностей" \
         "## 5. Таблица ошибок" "## 6. Pulumi" "## 7. Ansible" "## 8. Скрипт selectel.py"; do
  need REFERENCE.md "$h"
done
for s in "X-Subject-Token" "vpc/resell/v2/projects" "domains/v2/zones" "external-network" \
         "ExternalGatewayForFloatingIPNotFound" "invalid character '<'" "user_domain_name" \
         "keyed_groups" "getFlavorOutput" "DomainsRrsetV2" "dependsOn"; do
  need REFERENCE.md "$s"
done

[ -f SKILL.md ] || { echo "нет SKILL.md"; fail=1; }
need SKILL.md "name: selectel-ops"
need SKILL.md "description:"
for h in "## Чего ты никогда не делаешь" "## Модель доступа за минуту" "## Куда идти с какой задачей" \
         "## Фаза 0" "## Процедуры" "## Только в панели" "## Selectel в Pulumi" "## Selectel в Ansible" \
         "## Когда что-то не получается" "## Что отдавать наружу"; do
  need SKILL.md "$h"
done
lines=$(wc -l < SKILL.md)
[ "$lines" -le 230 ] || { echo "SKILL.md длиннее 230 строк: $lines"; fail=1; }

# Утечки: IPv4, 32-hex id проектов, числа от 6 знаков (номера аккаунтов), fernet-токены.
# Без \b: BSD grep на macOS его не понимает.
leaks=$(grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-f]{32}|(^|[^0-9.])[0-9]{6,}([^0-9.]|$)|gAAAA' SKILL.md REFERENCE.md scripts/selectel.py 2>/dev/null \
        | grep -vE '127\.0\.0\.1|0{32}|<ACCOUNT>|<PROJECT_ID>' || true)
[ -z "$leaks" ] || { echo "похоже на идентификаторы стенда:"; echo "$leaks"; fail=1; }
exit $fail
