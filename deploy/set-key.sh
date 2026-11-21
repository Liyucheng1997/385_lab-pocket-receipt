#!/usr/bin/env bash
# 在服务器上设置 AI 识别用的 Anthropic API Key（输入时不显示），然后重启服务
#   ssh -t reader-server bash /opt/apps/fattura/deploy/set-key.sh
set -euo pipefail
ENV=/opt/apps/fattura/.env
read -rsp "粘贴 API Key 后按回车（输入不会显示；直接回车 = 清除 Key）: " KEY
echo
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
if [ -n "$KEY" ] && [[ "$KEY" != sk-ant-* ]]; then
  echo "这看起来不是 Anthropic 的 Key（应以 sk-ant- 开头），没有保存。"
  exit 1
fi
# 粘贴了两遍（右键和 Ctrl+V 各贴了一次）时只取一份
HALF=$(( ${#KEY} / 2 ))
if [ -n "$KEY" ] && [ "${KEY:0:HALF}" = "${KEY:HALF}" ]; then
  KEY="${KEY:0:HALF}"
  echo "检测到 Key 被粘贴了两遍，已自动只保留一份。"
fi
if [[ "$KEY" == *sk-ant-*sk-ant-* ]]; then
  echo "里面有不止一个 Key，没有保存。请只粘贴一次再回车。"
  exit 1
fi
# 先向 Anthropic 验证一下这个 Key 能不能用
if [ -n "$KEY" ]; then
  CODE=$(curl -s -m 20 -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' || echo 000)
  if [ "$CODE" = 401 ] || [ "$CODE" = 403 ]; then
    echo "Anthropic 不认这个 Key（HTTP $CODE），没有保存。请检查是否复制完整、是否已被作废。"
    exit 1
  elif [ "$CODE" = 200 ]; then
    echo "Key 验证通过。"
  else
    echo "暂时没法验证这个 Key（HTTP $CODE），先保存。"
  fi
fi
grep -v '^ANTHROPIC_API_KEY=' "$ENV" > "$ENV.tmp" || true
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> "$ENV.tmp"
chmod 600 "$ENV.tmp" && mv "$ENV.tmp" "$ENV"
sudo systemctl restart app-fattura
sleep 1
if [ -n "$KEY" ]; then echo "已保存（结尾 …${KEY: -4}），服务已重启："; else echo "已清除 Key，服务已重启："; fi
journalctl -u app-fattura -n 6 --no-pager 2>/dev/null | grep -E "识别模型|账号模式" | sed 's/^.*node\[[0-9]*\]: //' || systemctl is-active app-fattura
