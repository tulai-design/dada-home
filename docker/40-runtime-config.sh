#!/bin/sh
# 按环境变量生成 /config.js，页面启动时读取。没有设置的功能就不会出现在页面里。
#
#   UMAMI_WEBSITE_ID  Umami 的网站 ID（UUID）。不设置就完全不加载统计。
#   UMAMI_SRC         统计脚本地址，默认 https://cloud.umami.is/script.js；自建 Umami 填你自己的
#   UMAMI_DOMAINS     只在这些域名下统计，逗号分隔，例如 home.example.com（可不填）
set -eu

out=/usr/share/nginx/html/config.js

# 值会被写进 JS 字符串，先去掉引号、反斜杠和换行
clean() { printf '%s' "$1" | tr -d '"\\\r\n'; }

if [ -n "${UMAMI_WEBSITE_ID:-}" ]; then
  printf 'window.__DADA__ = {"umami":{"websiteId":"%s","src":"%s","domains":"%s"}};\n' \
    "$(clean "$UMAMI_WEBSITE_ID")" \
    "$(clean "${UMAMI_SRC:-https://cloud.umami.is/script.js}")" \
    "$(clean "${UMAMI_DOMAINS:-}")" > "$out"
  echo "runtime-config: umami enabled"
else
  printf 'window.__DADA__ = {};\n' > "$out"
fi
