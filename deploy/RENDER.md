# Colocar o sistema no ar no Render (grátis)

Resultado: o sistema fica em `https://gestao-barbosadev.onrender.com` (ou nome parecido), sem depender do seu computador. Os dados ficam num repositório **privado** do GitHub, com histórico de todas as alterações (serve de backup).

Tudo grátis e sem cartão. Tempo estimado: 20–30 minutos.

---

## 1. Criar a conta no GitHub

Acesse https://github.com/signup e crie a conta (se ainda não tiver).

## 2. Criar o repositório dos DADOS (privado)

1. Em https://github.com/new:
   - **Repository name**: `barbosadev-dados`
   - Marque **Private** ⚠️ (obrigatório: aqui ficam os contatos e as senhas criptografadas)
   - Clique em **Create repository**.
2. Na página do repositório, clique em **uploading an existing file**.
3. Arraste o arquivo `C:\GESTAO-BARBOSADEV\data\db.json` (são os usuários, senhas e contatos que vocês já têm).
4. Clique em **Commit changes**.

> Se pular o passo 3, o sistema cria os usuários com as senhas padrão (`ceo123` etc.). Nesse caso, troque todas as senhas logo no primeiro acesso, porque o site estará na internet.

## 3. Criar o token de acesso aos dados

É a "senha" que o sistema usa para ler e salvar o `db.json`. Ele só terá acesso a esse repositório.

1. Acesse https://github.com/settings/personal-access-tokens/new (Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → *Generate new token*).
2. Preencha:
   - **Token name**: `render-gestao`
   - **Expiration**: o maior prazo disponível (anote a data: quando vencer, gere outro e troque no Render, passo 6)
   - **Repository access**: *Only select repositories* → `barbosadev-dados`
   - **Permissions** → *Repository permissions* → **Contents**: `Read and write`
3. Clique em **Generate token** e **copie o token** (começa com `github_pat_`). Ele só aparece uma vez — guarde num lugar seguro.

## 4. Enviar o CÓDIGO para o GitHub

1. Crie outro repositório em https://github.com/new:
   - **Repository name**: `gestao-barbosadev`
   - **Private**
   - Não marque nenhuma opção de README/.gitignore. Clique em **Create repository**.
2. No PowerShell, na pasta do projeto (troque `SEU_USUARIO`):

```powershell
cd C:\GESTAO-BARBOSADEV
git init -b main
git add .
git commit -m "Sistema de gestão comercial Barbosa Dev"
git remote add origin https://github.com/SEU_USUARIO/gestao-barbosadev.git
git push -u origin main
```

Na primeira vez, o Windows abre uma janela para entrar na conta do GitHub. O `.gitignore` já garante que a pasta `data` (com os dados dos clientes) **não** vai junto com o código.

## 5. Criar o site no Render

1. Acesse https://dashboard.render.com e entre com **GitHub** (*Sign in with GitHub*).
2. Clique em **New +** → **Blueprint**.
3. Conecte a conta do GitHub e escolha o repositório `gestao-barbosadev`. (Se ele não aparecer: *Configure account* → dê acesso a esse repositório.)
4. O Render lê o arquivo `render.yaml` e pede dois valores:
   - **GITHUB_REPO**: `SEU_USUARIO/barbosadev-dados`
   - **GITHUB_TOKEN**: o token copiado no passo 3
5. Clique em **Apply** / **Deploy Blueprint**. Em 2–5 minutos o status fica **Live**.
6. O endereço aparece no topo da página do serviço (ex.: `https://gestao-barbosadev.onrender.com`).

Pronto: acesse e entre com os usuários e senhas de sempre.

## 6. (Opcional) Evitar que o site "durma"

No plano grátis, depois de 15 minutos sem acesso o Render desliga o site, e o próximo acesso demora ~50 segundos. Para manter acordado:

1. Crie uma conta grátis em https://uptimerobot.com.
2. **Add New Monitor** → tipo **HTTP(s)** → URL: `https://SEU-SITE.onrender.com/healthz` → intervalo **5 minutes** → **Create Monitor**.

O plano grátis do Render dá 750 horas por mês, suficiente para um site ligado o mês todo.

---

## Dia a dia

**Atualizar o sistema** (depois que eu fizer mudanças no código):

```powershell
cd C:\GESTAO-BARBOSADEV
git add .
git commit -m "Atualização"
git push
```

O Render publica a versão nova sozinho em poucos minutos. Os dados não são afetados.

**Ver ou baixar os dados**: abra o repositório `barbosadev-dados` no GitHub. O `db.json` é sempre a versão mais recente, e em **History** (ícone de relógio) estão todas as versões anteriores — dá para baixar qualquer uma.

**A partir de agora o site é o "oficial"**: o que a equipe cadastrar fica no GitHub, não no seu computador. O sistema local (`iniciar.bat`) continua funcionando, mas com os dados antigos do seu PC.

**Trocar o token quando vencer**: gere um novo (passo 3) → no Render, abra o serviço → **Environment** → edite `GITHUB_TOKEN` → **Save changes**.

## Se algo der errado

| Problema | O que fazer |
|---|---|
| Deploy falhou | Render → serviço → **Logs**: a última mensagem diz o motivo |
| "GitHub respondeu 401" nos logs | Token errado ou vencido: refaça o passo 3 e atualize no Render |
| "GitHub respondeu 404" nos logs | `GITHUB_REPO` escrito errado, ou o token não tem acesso a esse repositório |
| Entrou com senhas padrão | O `db.json` não foi enviado no passo 2: troque as senhas pelo sistema, ou envie o arquivo e reinicie em *Manual Deploy → Restart* |
| Primeiro acesso demora | Normal no plano grátis; veja o passo 6 |
