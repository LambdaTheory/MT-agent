#!/bin/bash
# Rental Price Agent regression suite
# Run from skill root: bash scripts/run-tests.sh
SKILL_DIR="D:/改价-skill化/.workbuddy/skills/rental-price-agent"
NODE="C:/Users/ljh/.workbuddy/binaries/node/versions/22.22.2/node.exe"
SEND="$NODE $SKILL_DIR/scripts/playwright-runner.js daemon send"
BATCH="$SKILL_DIR/scripts/batch-runner.js"
UNIT="$SKILL_DIR/scripts/run-unit-tests.js"
FAILURES=0

send() { echo "$1" | $NODE "$SKILL_DIR/scripts/playwright-runner.js" daemon send 2>/dev/null | head -5; }
ok()  { echo "  ✅ $1"; }
err() { echo "  ❌ $1"; FAILURES=$((FAILURES + 1)); }
hdr() { echo ""; echo "=== $1 ==="; }

# ============================================================
echo "🧪 Rental Price Agent 回归测试"
echo ""; date

hdr "T1 - 无副作用单测"
$NODE "$UNIT" && ok "Unit tests" || err "Unit tests"

hdr "T2 - Daemon 连通"
send '{"action":"ping"}' && ok "Ping" || err "Ping"

hdr "T3 - Login"
send '{"action":"login"}' && ok "Login" || err "Login"

hdr "T4 - 读761"
R=$(send '{"action":"read","productId":"761"}')
echo "$R" | head -2
[ -n "$R" ] && ok "Read 761" || err "Read 761"

hdr "T5 - batch-read explicitFields"
R=$(send '{"action":"batch-read","productIds":["761"],"fields":["rent1day","rent10day"]}')
echo "$R" | head -3
[ -n "$R" ] && ok "Batch read explicit fields" || err "Batch read explicit fields"

hdr "T6 - 预览普通批次(仅761)"
$NODE "$BATCH" preview "D:/改价-skill化/.workbuddy/skills/rental-price-agent/tasks/batches/v14_preview_plain_761.json" 2>/dev/null | head -3 && ok "Batch preview plain" || err "Batch preview plain"

hdr "T7 - 预览阻断 form-level shared setup"
if $NODE "$BATCH" preview "D:/改价-skill化/.workbuddy/skills/rental-price-agent/tasks/batches/v14_preview_setup_shared_761.json" >/dev/null 2>/dev/null; then
  err "Shared setup preview should be blocked"
else
  ok "Shared setup preview blocked"
fi

hdr "T8 - 预览阻断 form-level item setup"
if $NODE "$BATCH" preview "D:/改价-skill化/.workbuddy/skills/rental-price-agent/tasks/batches/v14_preview_setup_item_761.json" >/dev/null 2>/dev/null; then
  err "Item setup preview should be blocked"
else
  ok "Item setup preview blocked"
fi

echo ""
echo "===================="
echo "测试完成"
echo "===================="

if [ "$FAILURES" -gt 0 ]; then
  echo "失败项: $FAILURES"
  exit 1
fi
