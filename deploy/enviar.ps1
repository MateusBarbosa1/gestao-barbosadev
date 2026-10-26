# Envia o sistema do seu computador para o servidor da Oracle Cloud.
#
# Primeira vez (leva junto os usuários, senhas e contatos que já estão aqui):
#   powershell -ExecutionPolicy Bypass -File deploy\enviar.ps1 -Ip 123.45.67.89 -Chave C:\caminho\chave.key -ComDados
#
# Atualizações depois (só o código; os dados do servidor ficam como estão):
#   powershell -ExecutionPolicy Bypass -File deploy\enviar.ps1 -Ip 123.45.67.89 -Chave C:\caminho\chave.key
param(
    [Parameter(Mandatory = $true)] [string]$Ip,
    [Parameter(Mandatory = $true)] [string]$Chave,
    [string]$Usuario = 'ubuntu',
    [switch]$ComDados
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$destino = "$Usuario@$Ip"
$opts = @('-i', $Chave, '-o', 'StrictHostKeyChecking=accept-new')

function Remoto([string]$comando) {
    & ssh @opts $destino $comando
    if ($LASTEXITCODE -ne 0) { throw "Falhou no servidor: $comando" }
}

if (-not (Test-Path $Chave)) { throw "Chave não encontrada: $Chave" }

Write-Host '==> Preparando a pasta no servidor'
Remoto 'mkdir -p ~/gestao/data ~/gestao/deploy'

Write-Host '==> Enviando os arquivos do sistema'
$arquivos = @('server.js', 'package.json', 'package-lock.json', 'public', 'deploy') | ForEach-Object { Join-Path $raiz $_ }
& scp @opts -r @arquivos "${destino}:~/gestao/"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar os arquivos.' }
# Arquivos criados no Windows podem vir com fim de linha CRLF, que quebra scripts no Linux.
Remoto 'sed -i ''s/\r$//'' ~/gestao/deploy/*.sh'

if ($ComDados) {
    $db = Join-Path $raiz 'data\db.json'
    if (-not (Test-Path $db)) { throw "Não encontrei $db" }
    Write-Host '==> Enviando os dados (o que já existir no servidor vira backup antes)'
    Remoto 'if [ -f ~/gestao/data/db.json ]; then cp ~/gestao/data/db.json ~/gestao/data/db.json.antes-$(date +%Y%m%d-%H%M%S); fi'
    & scp @opts $db "${destino}:~/gestao/data/db.json"
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar os dados.' }
}

Write-Host '==> Atualizando dependências e reiniciando (se o servidor já estiver instalado)'
# (Sem aspas duplas no comando remoto: o PowerShell 5.1 as remove ao chamar o ssh.)
Remoto 'if [ -f /etc/systemd/system/gestao.service ]; then cd ~/gestao && npm ci --omit=dev --no-audit --no-fund && sudo systemctl restart gestao && echo ''Sistema reiniciado com a versao nova.''; else echo ''Servidor ainda nao instalado: rode o setup-servidor.sh (veja deploy/ORACLE.md).''; fi'

Write-Host ''
Write-Host 'Envio concluído.'
