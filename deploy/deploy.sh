#!/usr/bin/env bash
# 把当前代码发布到服务器：bash deploy/deploy.sh [ssh 主机名]
# 首次运行会创建目录、.env、systemd 服务和 nginx 站点并申请证书；之后只更新代码并重启。
# 用户数据在服务器的 /opt/apps/fattura/data，不会被覆盖。
set -euo pipefail
HOST="${1:-reader-server}"
APP=/opt/apps/fattura
DOMAIN=fattura.liyucheng.me
cd "$(dirname "$0")/.."

tar czf - server.js package.json lib public deploy | ssh "$HOST" "
  set -e
  sudo mkdir -p $APP && sudo chown \$(id -un): $APP
  rm -rf $APP/public $APP/lib $APP/deploy
  tar xzf - -C $APP
  mkdir -p $APP/data && chmod 700 $APP/data
  [ -f $APP/.env ] || { cp $APP/deploy/env.example $APP/.env; chmod 600 $APP/.env; }
  if [ ! -f /etc/systemd/system/app-fattura.service ]; then
    sudo cp $APP/deploy/app-fattura.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable app-fattura
  fi
  sudo systemctl restart app-fattura
  if [ ! -f /etc/nginx/sites-available/$DOMAIN ]; then
    sudo cp $APP/deploy/nginx.conf /etc/nginx/sites-available/$DOMAIN
    sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d $DOMAIN --non-interactive --redirect
  fi
  sleep 1
  systemctl is-active app-fattura
  curl -s http://127.0.0.1:4385/api/session
"
echo
echo "已发布：https://$DOMAIN"
