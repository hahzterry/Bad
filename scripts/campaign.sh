#!/usr/bin/env bash
# Activation campaign review + payout helper.
#
#   ./scripts/campaign.sh list          every participant and their status
#   ./scripts/campaign.sh pay           wallets cleared for payout (past the 72h hold)
#   ./scripts/campaign.sh paid <id> <tx>   record a payout you already sent
#   ./scripts/campaign.sh reject <id> <reason>
#
# Reads CRON_SECRET from .env.local so the secret never appears in shell history.
set -euo pipefail

cd "$(dirname "$0")/.."
BASE="${CAMPAIGN_BASE:-https://www.shyft.lol}"
SECRET=$(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"'"'"'')
[ -n "$SECRET" ] || { echo "CRON_SECRET not found in .env.local"; exit 1; }

api_get()  { curl -s -H "authorization: Bearer $SECRET" "$BASE/api/campaign/admin"; }
api_post() { curl -s -X POST -H "authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d "$1" "$BASE/api/campaign/admin"; }

case "${1:-list}" in
  list)
    api_get | python3 -c "
import json,sys,datetime
d=json.load(sys.stdin)
if 'error' in d: print(d); raise SystemExit(1)
print('counts:', d['counts'], '| hold:', d['holdHours'], 'h\n')
for s in d['slots']:
    rel = s.get('payoutReleasesAt')
    when = datetime.datetime.fromtimestamp(rel/1000).strftime('%b %d %H:%M') if rel else '-'
    flag = ' <-- SHARED IP' if s['sharedIpCount'] > 1 else ''
    print(f\"{s['status']:10} {s['wallet']}  ip={s.get('ip','-'):16} releases={when}{flag}\")
    print(f\"           device={s['deviceId']}\")
"
    ;;
  pay)
    api_get | python3 -c "
import json,sys
d=json.load(sys.stdin)
pay=[s for s in d['slots'] if s['payable']]
print(f'READY TO PAY ({len(pay)}) — send \$5 of \$SHYFT to each, then run: campaign.sh paid <device> <tx>\n')
for s in pay: print(f\"{s['wallet']}   device={s['deviceId']}\")
"
    ;;
  paid)
    [ $# -ge 2 ] || { echo "usage: campaign.sh paid <deviceId> [txSignature]"; exit 1; }
    api_post "{\"deviceId\":\"$2\",\"action\":\"paid\",\"tx\":\"${3:-}\"}"; echo
    ;;
  reject)
    [ $# -ge 2 ] || { echo "usage: campaign.sh reject <deviceId> [reason]"; exit 1; }
    api_post "{\"deviceId\":\"$2\",\"action\":\"reject\",\"reason\":\"${3:-failed review}\"}"; echo
    ;;
  *) echo "usage: campaign.sh {list|pay|paid <id> <tx>|reject <id> <reason>}"; exit 1 ;;
esac
