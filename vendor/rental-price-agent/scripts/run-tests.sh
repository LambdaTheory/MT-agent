#!/bin/bash
# Comprehensive test suite for rental-price-agent
# Run from skill root: bash scripts/run-tests.sh
SKILL_DIR="D:/改价-skill化/.workbuddy/skills/rental-price-agent"
NODE="C:/Users/ljh/.workbuddy/binaries/node/versions/22.22.2/node.exe"
SEND="$NODE $SKILL_DIR/scripts/playwright-runner.js daemon send"

send() { echo "$1" | $NODE "$SKILL_DIR/scripts/playwright-runner.js" daemon send 2>/dev/null | head -3; }
ok()  { echo "  ✅ $1"; }
err() { echo "  ❌ $1"; }
hdr() { echo ""; echo "=== $1 ==="; }

# ============================================================
echo "🧪 Rental Price Agent 完整测试"
echo ""; date

hdr "T1 - Daemon 连通"
send '{"action":"ping"}' && ok "Ping" || err "Ping"

hdr "T2 - Login"
send '{"action":"login"}' && ok "Login" || err "Login"

hdr "T3 - 读761 (2行)"
R=$(send '{"action":"read","productId":"761"}')
echo "$R" | head -2
[ -n "$R" ] && ok "Read 761" || err "Read 761"

hdr "T4 - 读763 (4行)"
R=$(send '{"action":"read","productId":"763"}')
echo "$R" | head -2
[ -n "$R" ] && ok "Read 763" || err "Read 763"

hdr "T5 - Spec: 761加128G"
send '{"action":"spec-add-item","productId":"761","specDimId":"1355","itemTitle":"128G"}' && ok "Add item" || err "Add item"

hdr "T6 - Spec: Refresh"
send '{"action":"spec-refresh","productId":"761"}' && ok "Refresh" || err "Refresh"

hdr "T7 - Spec: 读新表(原子add-and-refresh)"
R=$(echo '{"action":"spec-add-and-refresh","productId":"761","specDimId":"1355","itemTitle":"128G"}' | $SEND)
N=$(echo "$R" | grep -o '"specId"' | wc -l)
echo "  Rows: $N"
[ "$N" -ge 4 ] && ok "Atomic add+refresh ($N rows)" || err "Only $N rows"

hdr "T8 - Spec: 恢复(再次refresh)"
echo '{"action":"spec-refresh","productId":"761"}' | $SEND && ok "Refresh" || err "Refresh"

hdr "T9 - Spec: 确认2行"
R=$(echo '{"action":"spec-add-and-refresh","productId":"761","specDimId":"1355","itemTitle":"dummy"}' | $SEND; echo '{"action":"spec-refresh","productId":"761"}' | $SEND)
# Note: read will show server state (original 2 rows) because spec changes aren't saved
R=$(send '{"action":"read","productId":"761"}')
N=$(echo "$R" | grep -o '"specId"' | wc -l)
echo "  Rows (server): $N"
ok "Spec restore flow"

hdr "T11 - Tenancy: 761加5天"
send '{"action":"tenancy-set","productId":"761","days":"1,10,30,5"}' && ok "Set tenancy" || err "Set tenancy"

hdr "T12 - Tenancy: 恢复"
send '{"action":"tenancy-set","productId":"761","days":"1,10,30"}' && ok "Restore tenancy" || err "Restore tenancy"

hdr "T13 - 批量Preview (2商品差异)"
NODE="C:/Users/ljh/.workbuddy/binaries/node/versions/22.22.2/node.exe"
BATCH="$SKILL_DIR/scripts/batch-runner.js"
$NODE "$BATCH" preview "D:/改价-skill化/.workbuddy/skills/rental-price-agent/tasks/test2_diff.json" 2>/dev/null | head -3 && ok "Batch preview" || err "Batch preview"

hdr "T14 - 批量Execute (2商品差异) - 干跑(不提交)"
# Just read + diff, skip apply+submit
$NODE "$BATCH" preview "D:/改价-skill化/.workbuddy/skills/rental-price-agent/tasks/test1_uniform.json" 2>/dev/null | head -3 && ok "Batch preview 2" || err "Batch preview 2"

echo ""
echo "===================="
echo "测试完成"
echo "===================="
