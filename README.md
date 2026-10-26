# Barbosa Dev — Gestão Comercial

Dashboard comercial com login para **Vendedor**, **Gerente Comercial** e **CEO**.

## Como rodar

1. Instale o [Node.js](https://nodejs.org) (versão 18 ou superior).
2. Dê dois cliques em `iniciar.bat` (ou rode `npm install` e depois `npm start`).
3. Acesse http://localhost:3000

Para outras pessoas da rede acessarem, use o IP desta máquina (ex.: `http://192.168.0.10:3000`).

## Usuários iniciais

| Perfil | Usuário | Senha |
|---|---|---|
| Vendedor | `vendedor` | `vendedor123` |
| Gerente Comercial | `gerente` | `gerente123` |
| CEO | `ceo` | `ceo123` |

Troque as senhas no primeiro acesso (botão **Senha** no topo). O CEO pode criar novos vendedores e redefinir senhas em **Usuários**.

## O que cada perfil vê

- **Vendedor**: lista de próximos contatos (nome, nicho, número com link do WhatsApp, site, Google Maps), checkbox de "mensagem enviada", mover para listas (Respondidos, Interessou no exemplo, Respondeu o exemplo, Se interessou no site, Follow up, Marcou reunião, Clientes), botão **Vendeu** com valor, e a própria comissão.
- **Gerente Comercial**: resultados de cada vendedor, funil da equipe, reuniões, a mesma lista de contatos (com filtro por vendedor) e a própria comissão.
- **CEO**: não prospecta. Vê valores vendidos, parte da Barbosa Dev, comissões a pagar, vendas, reuniões e contatos; define as comissões; sobe a planilha Excel, confere a prévia e envia para o gerente comercial ou para um vendedor.

## Comissões

Quem fecha a venda (vendedor ou gerente) recebe pela faixa do valor do site:

| Valor do site | Comissão |
|---|---|
| Até R$ 500 | 50% |
| De R$ 500,01 a R$ 2.000 | 30% |
| Acima de R$ 2.000 | 20% |

Nas vendas fechadas por vendedores, o gerente recebe 5% do valor da venda, descontados da parte da Barbosa Dev
(ex.: venda de R$ 400 → vendedor 50%, gerente 5%, Barbosa Dev 45%). Quando o próprio gerente fecha, fica 50% para ele e 50% para a Barbosa Dev.
O CEO pode alterar as faixas; a mudança vale para as próximas vendas.

## Planilha Excel

Aceita dois formatos:

- **Modelo da Barbosa Dev** (baixe no painel do CEO): Nome, Nicho, Número, Site, Google Maps.
- **Exportação do extrator do Google Maps** (`dataset_crawler-google-places_*.csv`): usa `title` como nome, `categoryName` como nicho, `phone`, `website`, `address` e `city`. Como essa exportação não traz o link do local, o sistema monta um link de busca no Google Maps com o nome + endereço.

Números já cadastrados são ignorados (o mesmo número escrito com ou sem +55, parênteses ou traço conta como repetido).

## Dados

No computador, tudo fica salvo em `data/db.json`. Faça backup desse arquivo.

## Colocar na internet

- **Render (grátis)**: passo a passo em [deploy/RENDER.md](deploy/RENDER.md). Os dados ficam num repositório privado do GitHub (variáveis `GITHUB_REPO` e `GITHUB_TOKEN`).
- **Servidor próprio (Oracle, Hostinger, Contabo…)**: [deploy/ORACLE.md](deploy/ORACLE.md).
