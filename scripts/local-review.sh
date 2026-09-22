#!/bin/bash
# 本地审查：把中转站 key 从 movie-narrator 的 settings.json 复制进 .env（不打印），起本地 MySQL 和服务
set -e
cd /Users/aoray/nihaixia-tcm-skill
python3 - <<'PY'
import json,re
s=json.load(open('/Users/aoray/movie-narrator/app/settings.json'))
key=(s.get('api_key') or '').strip()
base=(s.get('api_base') or '').strip() or 'https://api.90087.cn/v1'
model=(s.get('text_model') or '').strip()
if not model or model.startswith('__'): model='gpt-5.4'
assert key, 'settings.json 里 api_key 是空的'
env=open('.env').read()
def put(k,v):
    global env
    env=re.sub(r'^'+k+r'=.*$', k+'='+v, env, flags=re.M) if re.search(r'^'+k+'=',env,re.M) else env+'\n'+k+'='+v
put('AI_API_KEY',key); put('AI_BASE_URL',base); put('AI_MODEL',model)
open('.env','w').write(env)
print('已写入 .env：AI_BASE_URL=%s AI_MODEL=%s AI_API_KEY=***%s' % (base, model, key[-4:]))
PY
if ! mysqladmin -S /private/tmp/claude-501/-Users-aoray/32385a58-d19f-4380-820b-ded5826e0354/scratchpad/mysql/mysql.sock -uroot ping >/dev/null 2>&1; then
  (mysqld --datadir=/private/tmp/claude-501/-Users-aoray/32385a58-d19f-4380-820b-ded5826e0354/scratchpad/mysql/data --port=3307 --socket=/private/tmp/claude-501/-Users-aoray/32385a58-d19f-4380-820b-ded5826e0354/scratchpad/mysql/mysql.sock --pid-file=/private/tmp/claude-501/-Users-aoray/32385a58-d19f-4380-820b-ded5826e0354/scratchpad/mysql/mysqld.pid --log-error=/private/tmp/claude-501/-Users-aoray/32385a58-d19f-4380-820b-ded5826e0354/scratchpad/mysql/err.log --mysqlx=OFF >/dev/null 2>&1 &)
  for i in $(seq 1 30); do mysqladmin -S /private/tmp/claude-501/-Users-aoray/32385a58-d19f-4380-820b-ded5826e0354/scratchpad/mysql/mysql.sock -uroot ping >/dev/null 2>&1 && break; sleep 1; done
fi
pkill -f "node dist/boot.js" 2>/dev/null || true
set -a; . ./.env; set +a
NODE_ENV=production nohup node dist/boot.js > /tmp/nihaixia-local.log 2>&1 &
for i in $(seq 1 20); do curl -s localhost:3100/api/health >/dev/null 2>&1 && break; sleep 1; done
echo "服务已起：电脑开 http://localhost:3100  手机同一 WiFi 开 http://$(ipconfig getifaddr en0):3100  口令 TESTCODE（20次/天）或 DEMO2026（5次/天）"
