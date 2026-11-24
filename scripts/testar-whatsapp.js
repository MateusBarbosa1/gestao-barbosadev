// Testes rápidos da integração com o WhatsApp. Lê as variáveis do .env:
//   node --env-file=.env scripts/testar-whatsapp.js <comando> ...
//
// Comandos:
//   enviar <PHONE_NUMBER_ID> <PARA> [template] [idioma]
//       Envia um template direto pela Meta. Padrão: hello_world / en_US, que já vem
//       aprovado no número de teste. <PARA> = seu celular cadastrado como destinatário
//       de teste, ex.: 5581999999999.
//   qualidade <PHONE_NUMBER_ID>
//       Mostra a nota de qualidade e o nome verificado do número.
//   webhook <URL_DO_PAINEL> <PHONE_NUMBER_ID> <DE> "texto"
//       Simula a Meta mandando uma mensagem recebida, com assinatura válida
//       (usa WA_APP_SECRET). Ex.: webhook http://localhost:3000 123456 5581999999999 "Oi"
const crypto = require('crypto');
const api = require('../whatsapp/api');

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'enviar') {
    const [pnid, to, name = 'hello_world', language = 'en_US'] = args;
    if (!pnid || !to) return usage();
    const id = await api.sendTemplate(pnid, to.replace(/\D/g, ''), { name, language }, name === 'hello_world' ? [] : ['Teste']);
    console.log(`Enviado. ID da mensagem: ${id}`);
    console.log('Se o webhook estiver configurado, os status (sent/delivered/read) aparecem no painel.');
  } else if (cmd === 'qualidade') {
    if (!args[0]) return usage();
    console.log(await api.phoneInfo(args[0]));
  } else if (cmd === 'webhook') {
    const [url, pnid, from, text = 'Olá, tenho interesse'] = args;
    if (!url || !pnid || !from) return usage();
    if (!process.env.WA_APP_SECRET) throw new Error('Defina WA_APP_SECRET no .env (o mesmo do servidor).');
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'teste', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp', metadata: { display_phone_number: '', phone_number_id: pnid },
        contacts: [{ wa_id: from, profile: { name: 'Contato de teste' } }],
        messages: [{ id: `wamid.teste.${Date.now()}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
      } }] }],
    });
    const sig = 'sha256=' + crypto.createHmac('sha256', process.env.WA_APP_SECRET).update(raw).digest('hex');
    const res = await fetch(`${url.replace(/\/$/, '')}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: raw });
    console.log(`Painel respondeu ${res.status}${res.status === 200 ? ': a resposta conta no relatório (e "SAIR" vira opt-out).' : ''}`);
  } else usage();
}

function usage() {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(0, 15).join('\n'));
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
