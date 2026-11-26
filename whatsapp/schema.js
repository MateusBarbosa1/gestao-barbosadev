// Esquema dos dados do WhatsApp dentro do db.json (cada chave funciona como uma tabela).
//
// users            (já existia)  vendedores e gestores do painel
// contacts         (já existia)  + campos do WhatsApp:
//     phoneE164        telefone normalizado, ex.: 5581999999999
//     origin           de onde veio: google_maps | csv | manual | whatsapp_inbound
//     optIn            consentimento para receber mensagens (true/false)
//     optInAt, optInSource
//     optOut           pediu para não receber mais (SAIR, PARAR…); bloqueia qualquer envio
//     optOutAt
//     waPhoneNumberId  número da empresa que atende este contato (fixado no 1º envio:
//                      um contato nunca é atendido por dois números)
//     lastInboundAt    última mensagem do cliente (abre a janela de 24h)
// waNumbers        números da empresa: { id, phoneNumberId, displayPhone, userId, dailyCap,
//                  qualityRating, qualityCheckedAt, active }
// conversations    uma por contato + número: { id, contactId, phoneNumberId, userId,
//                  lastInboundAt, lastOutboundAt, lastMessageAt }
// messages         { id, waMessageId (único), conversationId, contactId, phoneNumberId, userId,
//                  direction in|out, type (template na saída; tipo do WhatsApp na entrada),
//                  templateName, text (só do template enviado; o que o cliente escreve não é
//                  guardado: a conversa segue no WhatsApp), status queued|sent|delivered|read|failed|received,
//                  statusAt { sent, delivered, read, failed }, error { code, title },
//                  pricing { category, billable }, createdAt }
// waTemplates      templates aprovados na Meta: { id, name, language, category
//                  MARKETING|UTILITY, params ['contact.name', …], active }
// dispatches       disparos (campanhas): { id, templateId, createdBy, createdAt, status }
// dispatchItems    fila: { id, dispatchId, contactId, phoneNumberId, userId,
//                  status held (aguardando o botão Disparar)|pending|sending|sent|failed|skipped,
//                  attempts, lastError,
//                  skipReason, notBefore, messageId, updatedAt }
// waEvents         ids de eventos de status já processados (idempotência), com data,
//                  para limpar os antigos
// settings.whatsapp  custos, intervalo da fila, dias/horário de envio, palavras de opt-out

const DEFAULT_OPT_OUT = [
  'sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover', 'me remove', 'me tira',
  'nao quero', 'nao tenho interesse', 'nao me mande', 'nao mande mais', 'bloquear',
];

function defaultWhatsAppSettings() {
  return {
    // R$ por mensagem entregue (referência Brasil). Respostas dentro da janela aberta pelo cliente não são cobradas.
    costs: { MARKETING: 0.3217, UTILITY: 0.035, AUTHENTICATION: 0.035 },
    minDelaySec: 20,
    maxDelaySec: 90,
    sendDays: [1, 2, 3, 4, 5], // 0 = domingo … 6 = sábado (horário de Brasília)
    sendHours: { start: 9, end: 18 },
    // Contatos sem opt-in só entram na fila se o CEO ligar esta opção (risco de bloqueio do número).
    allowWithoutOptIn: false,
    optOutKeywords: DEFAULT_OPT_OUT,
  };
}

// Cria as coleções que faltam e completa contatos antigos. Pode rodar a cada inicialização.
function ensureWhatsAppSchema(db) {
  for (const key of ['waNumbers', 'conversations', 'messages', 'waTemplates', 'dispatches', 'dispatchItems', 'waEvents']) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  db.settings.whatsapp = { ...defaultWhatsAppSettings(), ...(db.settings.whatsapp || {}) };
  // LGPD: o texto das mensagens recebidas não é mais usado pelo painel.
  for (const m of db.messages) if (m.direction === 'in' && m.text) m.text = null;
  for (const c of db.contacts) {
    if (c.phoneE164 === undefined) c.phoneE164 = toE164(c.phone);
    if (c.origin === undefined) c.origin = c.importId ? 'google_maps' : 'manual';
    if (c.optIn === undefined) { c.optIn = false; c.optInAt = null; c.optInSource = null; }
    if (c.optOut === undefined) { c.optOut = false; c.optOutAt = null; }
    if (c.waPhoneNumberId === undefined) c.waPhoneNumberId = null;
    if (c.lastInboundAt === undefined) c.lastInboundAt = null;
  }
}

// Telefone no formato internacional usado pela API (só dígitos, com 55). null se não der para montar.
function toE164(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  return d.length >= 10 ? d : null;
}

// Chave para comparar números: o WhatsApp às vezes manda celulares brasileiros sem o 9
// (ex.: 558199999999). Tira o 55 e o 9 extra para os dois formatos baterem.
function waKey(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d;
}

module.exports = { ensureWhatsAppSchema, defaultWhatsAppSettings, toE164, waKey, DEFAULT_OPT_OUT };
