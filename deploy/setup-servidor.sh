#!/usr/bin/env bash
# Prepara uma VM Ubuntu da Oracle Cloud para rodar o sistema da Barbosa Dev.
# Rode UMA vez no servidor, depois de enviar os arquivos com o enviar.ps1:
#   bash ~/gestao/deploy/setup-servidor.sh gestao.seudominio.com.br
# Sem domínio, rode sem argumento: o endereço fica https://<ip-com-tracos>.sslip.io
set -euo pipefail

APP_DIR="$HOME/gestao"
APP_USER="$(whoami)"
DOMAIN="${1:-}"

if [ ! -f "$APP_DIR/server.js" ]; then
  echo "Não encontrei $APP_DIR/server.js. Envie os arquivos primeiro com o enviar.ps1." >&2
  exit 1
fi

if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS https://api.ipify.org)"
  DOMAIN="$(echo "$IP" | tr . -).sslip.io"
fi
echo "==> Endereço do sistema: https://$DOMAIN"

export DEBIAN_FRONTEND=noninteractive

echo "==> Atualizando o sistema"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https netfilter-persistent iptables-persistent

echo "==> Instalando Node.js 20"
if ! command -v node >/dev/null || ! node -v | grep -q '^v20'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "==> Instalando Caddy (HTTPS automático)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi

echo "==> Instalando dependências do sistema"
cd "$APP_DIR"
mkdir -p data
npm ci --omit=dev --no-audit --no-fund

echo "==> Criando o serviço (liga sozinho quando o servidor reinicia)"
sudo tee /etc/systemd/system/gestao.service >/dev/null <<EOF
[Unit]
Description=Barbosa Dev - Gestao Comercial
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now gestao
sudo systemctl restart gestao

echo "==> Configurando HTTPS para $DOMAIN"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy localhost:3000
}
EOF
sudo systemctl enable caddy
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "==> Liberando as portas 80 e 443 no firewall do Ubuntu"
# As imagens Ubuntu da Oracle bloqueiam tudo com uma regra REJECT; as liberações entram antes dela.
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    pos="$(sudo iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')"
    sudo iptables -I INPUT "${pos:-1}" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
  fi
done
sudo netfilter-persistent save

echo "==> Agendando backup diário dos dados (03:00, guarda 30 dias)"
sudo tee /etc/cron.d/gestao-backup >/dev/null <<EOF
0 3 * * * $APP_USER mkdir -p $HOME/backups && cp $APP_DIR/data/db.json $HOME/backups/db-\$(date +\%F).json && find $HOME/backups -name 'db-*.json' -mtime +30 -delete
EOF

sleep 2
if systemctl is-active --quiet gestao; then
  echo
  echo "Pronto! Acesse: https://$DOMAIN"
  echo "(o certificado HTTPS pode levar até 1 minuto no primeiro acesso)"
else
  echo "O serviço não subiu. Veja o erro com: sudo journalctl -u gestao -n 50" >&2
  exit 1
fi
