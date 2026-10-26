# Colocar o sistema no ar na Oracle Cloud (Always Free)

Resultado: o sistema roda 24h num servidor gratuito da Oracle, com endereço `https://…`, backup diário e religando sozinho se o servidor reiniciar.

Tempo estimado: 30–40 minutos na primeira vez.

---

## 1. Criar a conta

1. Acesse https://www.oracle.com/cloud/free/ e clique em **Start for free**.
2. Preencha os dados. O cartão de crédito é só para verificação (pode aparecer uma cobrança temporária de ~US$ 1 que é estornada). Enquanto você usar só recursos "Always Free", não há cobrança.
3. **Home Region**: escolha **Brazil East (São Paulo)** ou **Brazil Southeast (Vinhedo)**. ⚠️ Não dá para trocar depois, e os recursos grátis só existem nela.

## 2. Criar o servidor (VM)

No painel da Oracle: menu ☰ → **Compute** → **Instances** → **Create instance**.

| Campo | O que escolher |
|---|---|
| Name | `gestao-barbosadev` |
| Image | **Canonical Ubuntu 22.04** (ou 24.04) — clique em *Change image* |
| Shape | *Change shape* → **Ampere** → `VM.Standard.A1.Flex` com **1 OCPU e 6 GB** de memória (grátis). Se der "Out of capacity", use **AMD** → `VM.Standard.E2.1.Micro` (também grátis) |
| Networking | Deixe criar uma rede nova (*Create new virtual cloud network*) com **subnet pública** e **Assign a public IPv4 address** marcado |
| Add SSH keys | **Generate a key pair for me** → clique em **Save private key** (salva um arquivo `.key`) |

Clique em **Create**. Em 1–2 minutos o status fica **Running**. Anote o **Public IP address** (ex.: `150.230.10.20`).

> Guarde o arquivo `.key` em um lugar seguro, por exemplo `C:\Users\Dell\.ssh\oracle-gestao.key`. Sem ele você não consegue acessar o servidor.

## 3. Liberar as portas 80 e 443 (site)

Na página da instância: aba **Networking** (ou *Primary VNIC*) → clique no nome da **Subnet** → **Security** / **Security Lists** → abra a *Default Security List* → **Add Ingress Rules**:

| Source CIDR | IP Protocol | Destination Port Range |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

(Pode adicionar as duas regras na mesma tela com *+ Another Ingress Rule*.)

## 4. Domínio (opcional)

- **Com domínio** (ex.: `barbosadev.com.br`): no painel onde o domínio está registrado (Registro.br, Cloudflare, Hostinger…), crie um registro **A** com nome `gestao` apontando para o IP do servidor. O endereço fica `https://gestao.barbosadev.com.br`.
- **Sem domínio**: o script usa automaticamente `https://150-230-10-20.sslip.io` (o seu IP com traços). Funciona com HTTPS, só não é um nome bonito. Dá para trocar por um domínio depois.

## 5. Ajustar a permissão da chave (Windows)

O Windows recusa chaves que outros usuários podem ler. No PowerShell (troque o caminho):

```powershell
icacls "C:\Users\Dell\.ssh\oracle-gestao.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

## 6. Enviar o sistema

Na pasta do projeto (`C:\GESTAO-BARBOSADEV`), no PowerShell. O `-ComDados` leva junto os usuários, senhas e contatos que já estão no seu computador — **use só nesta primeira vez**:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\enviar.ps1 -Ip 150.230.10.20 -Chave C:\Users\Dell\.ssh\oracle-gestao.key -ComDados
```

Na primeira conexão ele pode perguntar se confia no servidor — é normal.

## 7. Instalar no servidor (uma vez só)

Entre no servidor:

```powershell
ssh -i C:\Users\Dell\.ssh\oracle-gestao.key ubuntu@150.230.10.20
```

Já dentro do servidor, rode (com o seu domínio, ou sem nada depois do `.sh` para usar o sslip.io):

```bash
bash ~/gestao/deploy/setup-servidor.sh gestao.barbosadev.com.br
```

Ele instala Node.js, o HTTPS (Caddy), cria o serviço, libera o firewall e agenda o backup. No final mostra o endereço. Digite `exit` para sair do servidor.

Pronto: acesse o endereço e entre com os mesmos usuários e senhas que vocês já usam.

---

## Dia a dia

**Atualizar o sistema** (depois que eu fizer mudanças no código): rode o mesmo comando do passo 6 **sem** o `-ComDados`. Os dados do servidor não são tocados.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\enviar.ps1 -Ip 150.230.10.20 -Chave C:\Users\Dell\.ssh\oracle-gestao.key
```

**Baixar uma cópia dos dados** para o seu computador:

```powershell
scp -i C:\Users\Dell\.ssh\oracle-gestao.key ubuntu@150.230.10.20:~/gestao/data/db.json .\backup-db.json
```

Os backups automáticos ficam no servidor em `~/backups` (um por dia, últimos 30 dias).

**A partir de agora o computador local deixa de ser o "oficial"**: o que a equipe cadastrar fica no servidor. Não rode mais o `-ComDados`, ou você sobrescreve os dados do servidor com os do seu PC (o script faz uma cópia de segurança antes, mas evite).

## Se algo der errado

| Problema | O que fazer |
|---|---|
| "Out of capacity" ao criar a VM | Tente outro *Availability Domain*, tente mais tarde, ou use o shape `VM.Standard.E2.1.Micro` |
| Site não abre | Confira as regras do passo 3. No servidor: `sudo systemctl status gestao caddy` |
| Erro de certificado HTTPS | O domínio precisa apontar para o IP (passo 4) e as portas 80/443 abertas; espere alguns minutos |
| Ver erros do sistema | No servidor: `sudo journalctl -u gestao -n 50` |
| "UNPROTECTED PRIVATE KEY FILE" | Refaça o passo 5 |

## Aviso importante da Oracle

A Oracle pode **recuperar VMs grátis que ficam ociosas** (uso de CPU muito baixo por 7 dias seguidos). Um sistema pequeno como este pode cair nessa regra. Para evitar: em **Billing → Upgrade and Manage Payment**, mude a conta para **Pay As You Go**. Os recursos Always Free continuam grátis; você só paga se criar algo além do limite gratuito. Mantenha também os backups em dia.
