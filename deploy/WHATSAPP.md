# Integração com o WhatsApp (Cloud API oficial da Meta)

O painel faz só o **primeiro contato**: cada vendedor escolhe quantas pessoas quer abordar e a
fila envia um **template aprovado** para os próximos contatos de "A prospectar".
- **A conversa continua no WhatsApp da equipe.** O número precisa estar no WhatsApp Business app e na API ao mesmo tempo (coexistência).
- **As listas** (Respondidos, Interessou no exemplo…) **são movidas à mão** no painel, como sempre.
- O **webhook** registra apenas se a pessoa respondeu (para a taxa de resposta, sem guardar o texto), o **opt-out** e os status de entrega.
- A gestão acompanha envios, respostas, conversão, custo e qualidade dos números.

## Como funciona

| Parte | Arquivo | O que faz |
|---|---|---|
| Esquema | `whatsapp/schema.js` | Coleções novas no banco: números, conversas, mensagens, templates, disparos e fila |
| Webhook | `whatsapp/webhook.js` | `GET/POST /webhook/whatsapp`: verificação da Meta, assinatura `X-Hub-Signature-256`, respostas, opt-out e status de entrega |
| Fila | `whatsapp/queue.js` | Disparo dos templates com intervalo aleatório, teto diário por número e horário de envio |
| API da Meta | `whatsapp/api.js` | Envio de template e consulta da nota de qualidade |
| Rotas do painel | `whatsapp/routes.js` | `/api/wa/*`: disparo, números, templates, configurações, relatório |
| Telas | `public/whatsapp.js` | Cartão "Enviar primeira mensagem" do vendedor/gerente e cartões de gestão do CEO/gerente |

### No dia a dia
1. O vendedor abre o painel, vai em **Enviar primeira mensagem pelo WhatsApp**, escolhe o template e quantas pessoas, e clica em **Colocar na fila**. Nada sai ainda: os contatos ficam **aguardando disparo**.
2. Quando quiser começar, clica em **Disparar mensagens**. O gerente também pode disparar pelo card **Fila de disparo** (um disparo, um vendedor ou tudo).
3. A fila manda uma mensagem a cada intervalo, sem passar do teto do dia. Cada contato que recebe vai sozinho para **Mensagem enviada**.
4. Quem responde aparece no WhatsApp do vendedor. Ele conversa por lá e move o contato de lista no painel.
5. O cartão mostra quantas mensagens já saíram hoje, quantas aguardam disparo, quantas estão saindo e quantos contatos ainda estão disponíveis. **Tirar da fila** desfaz o que ainda não saiu (por disparo, por vendedor ou tudo), e esses contatos voltam a ficar disponíveis.

### Regras
- **Fila:** cada número envia um template, espera um intervalo aleatório (padrão 20–90 s) e envia o próximo.
  - Para no **teto diário** do número (gerente 80, vendedor 40, editável).
  - Só envia nos **dias e horários** configurados (padrão seg–sex, 9h–18h de Brasília).
  - O que sobrar sai sozinho no próximo dia permitido.
- **Um número por contato:** no primeiro envio, o contato fica preso ao número que o atendeu. Ele nunca sai por outro número.
  - Se for passado para outro vendedor, o painel avisa "vinculado ao número de outro vendedor".
  - O mesmo telefone cadastrado duas vezes também é barrado.
- **Só a primeira mensagem:** um contato recebe template uma vez. Quem já recebeu não entra em um novo disparo.
- **Opt-out:** se o cliente responder SAIR, PARAR, "não quero…" ou outra palavra da lista (editável), o contato vai para **Opt-out**.
  - A partir daí, nada mais é enviado e o que estava na fila é cancelado.
  - Só o CEO tira um contato do opt-out.
- **Opt-in:** cada contato guarda a origem (`google_maps`, `csv`, `formulario`…) e se autorizou receber mensagens.
  - Por padrão, **só quem tem opt-in recebe template**.
  - O vendedor pode marcar o opt-in em **Detalhes** do contato, e fica registrado quem marcou e quando.
  - O CEO pode ligar "Permitir envio para contatos sem opt-in" (veja os riscos abaixo).
- **Falhas:**
  - **Temporárias** (limite da Meta, instabilidade): o envio volta para a fila sozinho, até 3 vezes.
  - **Definitivas:** ficam em "Últimas falhas" com o motivo, e o botão **Reenviar falhas** as devolve à fila.
  - **Token inválido:** a fila é **pausada**, para não queimar a lista.
- **Status do contato:** novo = A prospectar, contatado = Mensagem enviada, respondeu = Respondidos, em negociação = Interessou no exemplo até Marcou reunião, fechado = Clientes, além de Perdido e Opt-out.

### Envio sem opt-in (Google Maps)
A política do WhatsApp exige que a pessoa tenha autorizado receber mensagens da empresa. Enviar para quem não autorizou costuma causar:
- denúncias e bloqueios por parte dos destinatários;
- queda da **nota de qualidade** do número (o cartão "Números de WhatsApp" mostra a nota);
- falhas com o erro **131049**, quando a Meta segura mensagens de marketing para não incomodar o usuário;
- limitação ou banimento do número.

Se ligar essa opção, comece com poucos envios por dia, acompanhe a nota todo dia e pause se ela ficar amarela.

## Variáveis de ambiente

| Variável | Onde pegar |
|---|---|
| `WA_TOKEN` | Token **permanente** de Usuário do Sistema (passo 3) |
| `WA_APP_SECRET` | Meta for Developers → seu app → Configurações do app → Básico → **Chave secreta do app** |
| `WA_VERIFY_TOKEN` | Você inventa (ex.: uma senha longa). O mesmo valor vai no painel da Meta (passo 4) |
| `WA_GRAPH_VERSION` | Opcional. Padrão `v23.0`. Use a versão mais recente da Graph API |

- **No Render:** serviço → **Environment** → adicione as três primeiras → **Save changes**. O `render.yaml` já declara essas variáveis.
- **No computador:** copie `.env.example` para `.env` e preencha. O `iniciar.bat` carrega o `.env` sozinho, e o `.env` não vai para o GitHub.

Os tokens ficam só no servidor: o navegador nunca recebe nenhum deles.

## Configuração na Meta, passo a passo

1. **Phone Number ID**
   - Abra Meta for Developers → seu app → **WhatsApp → Configuração da API**.
   - Copie o **Phone Number ID** de cada número. O número de teste já tem um.
2. **Destinatários de teste** (só para o número de teste)
   - Na mesma tela, em "Para", adicione e confirme até 5 celulares que vão receber os testes.
3. **Token permanente**
   - Vá em business.facebook.com → **Configurações do negócio → Usuários → Usuários do sistema → Adicionar** (função Admin).
   - Clique em **Atribuir ativos** e dê controle total ao **app** e à **conta do WhatsApp (WABA)**.
   - Clique em **Gerar novo token** → escolha o app → validade **Nunca** → marque as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
   - Copie o token e guarde em `WA_TOKEN`.
4. **Webhook**
   - Primeiro, publique o painel com as variáveis preenchidas. A Meta testa a URL na hora.
   - Vá em WhatsApp → **Configuração → Webhook → Editar**.
   - **URL de callback:** `https://SEU-SITE.onrender.com/webhook/whatsapp`.
   - **Token de verificação:** o mesmo valor de `WA_VERIFY_TOKEN`.
   - Clique em **Verificar e salvar**.
   - Em **Campos do webhook**, clique em **Assinar** na linha **messages**.
5. **No painel (CEO)**
   - Em **Números de WhatsApp**, cadastre cada Phone Number ID com o dono (gerente: teto 80, vendedor: teto 40).
   - Em **Templates aprovados**, cadastre cada template com:
     - o **mesmo nome** e o **mesmo idioma** aprovados na Meta;
     - as variáveis na ordem: `contact.name`, `contact.niche`, `contact.city`, `seller.name` ou texto fixo.
   - Em **Configurações do WhatsApp**, confira os custos, o intervalo, os dias e o horário.

## Testar com o número de teste

Sem a Meta (só o painel):
```bash
node --env-file=.env scripts/testar-whatsapp.js webhook http://localhost:3000 PHONE_NUMBER_ID 5581999999999 "Oi, tenho interesse"
```
A resposta conta na taxa de resposta do cartão "WhatsApp — resultados", e um "SAIR" manda o contato para Opt-out. Antes, cadastre o número no painel com esse PHONE_NUMBER_ID e tenha um contato com esse telefone.

Com a Meta (envio de verdade):
1. Siga os passos 1 a 5 acima, usando o número de teste.
2. No painel, cadastre o template `hello_world`, idioma `en_US`, sem variáveis. Ele já vem aprovado no número de teste.
3. Cadastre (ou importe) um contato com o celular de teste, em "A prospectar", com **opt-in**, e passe ele para o dono do número.
4. Entre como esse vendedor, vá em **Enviar primeira mensagem**, escolha `hello_world` e quantidade 1.
   - Se preferir sem o painel: `node --env-file=.env scripts/testar-whatsapp.js enviar PHONE_NUMBER_ID 5581999999999`
5. A mensagem chega no celular e o contato vai para **Mensagem enviada**.
6. Responda "SAIR" do celular e veja o contato ir para Opt-out.

## Custos (cartão "WhatsApp — resultados")
- **Custo estimado:** templates **enviados** × valor da categoria, editável em Configurações. Conta assim que a Meta aceita a mensagem; se ela falhar, sai da conta. Referência para o Brasil: marketing ≈ R$ 0,3217 e utilidade ≈ R$ 0,035.
- A categoria vem da própria Meta, no status de entrega. Se ela não vier, vale a do template cadastrado.
- O CEO vê no topo do painel as **Despesas** do período: comissões + custo estimado do WhatsApp.
- O botão **↻ Atualizar** nos cards do WhatsApp busca os números mais novos sem recarregar a página.
- Confira os valores atuais em developers.facebook.com/docs/whatsapp/pricing e atualize no painel quando mudarem.

## LGPD
- O painel guarda só o necessário:
  - nome, telefone, origem e consentimento;
  - o template enviado e o fato de a pessoa ter respondido. **O que o cliente escreve não é guardado**, porque a conversa fica no WhatsApp.
  - conversas com números que não estão na base são ignoradas.
- Os logs do servidor mostram só os 4 últimos dígitos do telefone.
- **Excluir** um contato (gerente/CEO → Detalhes → Excluir) apaga também as mensagens, a conversa e a fila dele.
- **Atenção:** com os dados no GitHub, versões antigas do `db.json` continuam no histórico do repositório `barbosadev-dados`. Para apagar de vez a pedido de alguém:
  1. Baixe o `db.json` atual.
  2. Apague o repositório e crie outro com o mesmo nome (privado).
  3. Suba o arquivo de novo.

## O que ainda precisa ser feito manualmente
1. **Verificação da empresa** no Gerenciador de Negócios (documentos da Barbosa Dev). Sem ela, o limite é de 250 contatos iniciados pela empresa a cada 24h, contando todos os números.
2. **Adicionar os números reais** na WABA, verificar por SMS ou ligação e definir o nome de exibição (passa por aprovação). Os números não podem estar em uso no app comum do WhatsApp.
3. **Criar os templates** em WhatsApp Manager → Modelos de mensagem (categoria Marketing, idioma Português (BR)), esperar a aprovação e cadastrar no painel.
4. **Forma de pagamento** na WABA (WhatsApp Manager → Configurações de pagamento). Sem ela, só o número de teste funciona.
5. **Publicar o app** (modo Ativo) em Meta for Developers. Para isso, informe a URL da política de privacidade.
6. **Gerar o token permanente** (passo 3) e trocar o token temporário de 24h, se estiver usando um.
7. **Configurar o webhook** (passo 4) e assinar o campo **messages**.
8. **Manter o site acordado:** a fila só anda com o servidor ligado. No plano grátis do Render, mantenha o monitor do UptimeRobot (RENDER.md, passo 6).

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| A Meta não verifica o webhook | `WA_VERIFY_TOKEN` diferente nos dois lados, ou o site estava dormindo/sem as variáveis |
| Eventos não chegam / 401 nos logs | `WA_APP_SECRET` errado, ou o campo **messages** não foi assinado |
| "evento de número não cadastrado" nos logs | Phone Number ID não cadastrado em **Números de WhatsApp** |
| Erro 131030 | Número de teste: o destinatário não está na lista de "Para" |
| Erro 132001 | Template com nome ou idioma diferente do aprovado |
| Erro 131049 | A Meta segurou a mensagem de marketing (excesso de mensagens para a pessoa ou baixo engajamento) |
| Fila pausada "token" | `WA_TOKEN` vencido ou sem permissão: gere outro, salve no Render e clique em **Retomar fila** |
