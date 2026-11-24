// Fila de disparo de templates (primeiro contato).
// - Cada número da empresa tem sua vez: envia uma mensagem, espera um intervalo aleatório
//   (minDelaySec–maxDelaySec) e passa para a próxima.
// - Teto diário por número (waNumbers.dailyCap). Batido o teto, o que sobrou fica na fila e
//   sai sozinho no próximo dia/horário permitido (sendDays + sendHours, horário de Brasília).
// - Um contato só é enviado pelo número que já o atende (contacts.waPhoneNumberId).
// - Pula opt-out, telefone inválido e (se o CEO não liberou) quem não tem opt-in.
// - Falhas temporárias (limite da Meta, instabilidade) voltam para a fila até 3 vezes;
//   as demais ficam como "failed" para reenvio controlado pelo painel.
const api = require('./api');
const { waKey } = require('./schema');

const TZ = 'America/Sao_Paulo';
const MAX_ATTEMPTS = 3;
const TICK_MS = Number(process.env.WA_QUEUE_TICK_MS || 5000);

const brDate = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
function brNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hour12: false })
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), hour: Number(parts.hour) % 24 };
}

function createQueue({ getDb, save, uid, conversationFor, phoneType, log }) {
  const nextAt = new Map(); // phoneNumberId -> quando pode enviar de novo
  const busy = new Set();
  let timer = null;

  const numberById = (db, pnid) => db.waNumbers.find(n => n.phoneNumberId === pnid && n.active);

  // Número que atende o contato: o já fixado nele ou o do vendedor responsável.
  function numberFor(db, contact) {
    if (contact.waPhoneNumberId) return numberById(db, contact.waPhoneNumberId) || null;
    return db.waNumbers.find(n => n.userId === contact.assignedTo && n.active) || null;
  }

  // Motivo para NÃO enviar (ou null se pode).
  function blockReason(db, contact, number) {
    if (!contact) return 'contato apagado';
    if (contact.optOut) return 'opt-out';
    if (contact.sold || contact.status === 'perdido') return 'contato encerrado';
    if (!contact.phoneE164 || phoneType(contact.phone) !== 'celular') return 'telefone inválido ou fixo';
    if (!contact.optIn && !db.settings.whatsapp.allowWithoutOptIn) return 'sem opt-in';
    if (!number) return 'vendedor sem número de WhatsApp';
    if (contact.waPhoneNumberId && contact.waPhoneNumberId !== number.phoneNumberId) return 'atendido por outro número';
    // Contato passou para outro vendedor, mas já conversou pelo número antigo: não troca de número.
    if (number.userId !== contact.assignedTo) return 'contato vinculado ao número de outro vendedor';
    const key = waKey(contact.phoneE164);
    const other = db.contacts.find(c => c.id !== contact.id && c.waPhoneNumberId && c.waPhoneNumberId !== number.phoneNumberId
      && waKey(c.phoneE164 || c.phone) === key);
    if (other) return 'atendido por outro número';
    return null;
  }

  // Coloca contatos na fila. Devolve quantos entraram e o motivo de cada um que ficou de fora.
  function enqueue(db, { contactIds, templateId, dispatchId = null, priority = false }) {
    const added = [];
    const skipped = [];
    const now = new Date().toISOString();
    for (const id of contactIds) {
      const contact = db.contacts.find(c => c.id === id);
      const number = contact && numberFor(db, contact);
      const reason = blockReason(db, contact, number)
        || (db.dispatchItems.some(i => i.contactId === id && ['pending', 'sending'].includes(i.status)) ? 'já está na fila' : null);
      if (reason) { skipped.push({ contactId: id, name: contact?.name, reason }); continue; }
      const item = {
        id: uid(), dispatchId, templateId, contactId: id, phoneNumberId: number.phoneNumberId, userId: number.userId,
        status: 'pending', priority, attempts: 0, lastError: null, skipReason: null, notBefore: null,
        messageId: null, createdAt: now, updatedAt: now,
      };
      db.dispatchItems.push(item);
      added.push(item);
    }
    return { added: added.length, skipped };
  }

  const sentToday = (db, pnid) => {
    const today = brDate(new Date().toISOString());
    return db.messages.filter(m => m.direction === 'out' && m.type === 'template' && m.phoneNumberId === pnid && m.createdAt && brDate(m.createdAt) === today).length;
  };

  function inSendWindow(s) {
    const { weekday, hour } = brNow();
    return s.sendDays.includes(weekday) && hour >= s.sendHours.start && hour < s.sendHours.end;
  }

  function tick() {
    const db = getDb();
    const s = db.settings.whatsapp;
    if (s.queuePaused || !api.configured() || !inSendWindow(s)) return;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    for (const number of db.waNumbers.filter(n => n.active)) {
      const pnid = number.phoneNumberId;
      if (busy.has(pnid) || now < (nextAt.get(pnid) || 0)) continue;
      if (sentToday(db, pnid) >= number.dailyCap) continue;
      const item = db.dispatchItems
        .filter(i => i.phoneNumberId === pnid && i.status === 'pending' && (!i.notBefore || i.notBefore <= nowIso))
        .sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || a.createdAt.localeCompare(b.createdAt))[0];
      if (!item) continue;
      busy.add(pnid);
      sendItem(db, number, item)
        .then(sent => {
          const delay = sent ? (s.minDelaySec + Math.random() * Math.max(0, s.maxDelaySec - s.minDelaySec)) * 1000 : 0;
          nextAt.set(pnid, Date.now() + delay);
        })
        .catch(err => log(`erro inesperado na fila: ${err.message}`))
        .finally(() => busy.delete(pnid));
    }
  }

  // Envia um item. Devolve true se uma mensagem saiu (aí o número espera o intervalo).
  async function sendItem(db, number, item) {
    const now = () => new Date().toISOString();
    const contact = db.contacts.find(c => c.id === item.contactId);
    const reason = blockReason(db, contact, number);
    if (reason) {
      Object.assign(item, { status: 'skipped', skipReason: reason, updatedAt: now() });
      save();
      return false;
    }
    const template = db.waTemplates.find(t => t.id === item.templateId && t.active);
    if (!template) {
      Object.assign(item, { status: 'failed', lastError: 'template desativado ou apagado', updatedAt: now() });
      save();
      return false;
    }
    const seller = db.users.find(u => u.id === number.userId);
    // "nome=contact.name" vira variável nomeada {{nome}}; "contact.name" sozinho é posicional ({{1}}…).
    const params = (template.params || []).map(p => {
      const [name, source] = p.includes('=') ? p.split('=').map(s => s.trim()) : [null, p];
      return { name, text: paramValue(source, contact, seller) };
    });
    Object.assign(item, { status: 'sending', attempts: item.attempts + 1, updatedAt: now() });
    try {
      const wamid = await api.sendTemplate(number.phoneNumberId, contact.phoneE164, template, params);
      recordOutbound(db, { contact, number, type: 'template', template, text: renderTemplate(template, params), wamid });
      Object.assign(item, { status: 'sent', sentAt: now(), messageId: db.messages[db.messages.length - 1].id, lastError: null, updatedAt: now() });
      save();
      return true;
    } catch (err) {
      if (err.auth) {
        // Token inválido/vencido: pausa tudo até alguém corrigir, sem gastar as tentativas.
        Object.assign(item, { status: 'pending', attempts: item.attempts - 1, updatedAt: now() });
        db.settings.whatsapp.queuePaused = true;
        db.settings.whatsapp.pauseReason = `Fila pausada: ${err.message}`;
        log('fila pausada: problema com o token da Meta');
      } else if (err.retryable && item.attempts < MAX_ATTEMPTS) {
        Object.assign(item, { status: 'pending', lastError: err.message, notBefore: new Date(Date.now() + 15 * 60_000 * item.attempts).toISOString(), updatedAt: now() });
      } else {
        Object.assign(item, { status: 'failed', lastError: err.message, updatedAt: now() });
      }
      log(`envio falhou (${err.code ?? 'sem código'})`);
      save();
      return false;
    }
  }

  // Registra uma mensagem enviada e atualiza contato e conversa.
  function recordOutbound(db, { contact, number, type, template = null, text, wamid }) {
    const at = new Date().toISOString();
    const conv = conversationFor(db, contact, number);
    const msg = {
      id: uid(), waMessageId: wamid || null, conversationId: conv.id, contactId: contact.id,
      phoneNumberId: number.phoneNumberId, userId: number.userId, direction: 'out', type,
      templateName: template?.name || null, templateCategory: template?.category || null, text,
      unsupportedType: null, status: 'queued', statusAt: { queued: at }, error: null, pricing: null, createdAt: at,
    };
    db.messages.push(msg);
    conv.lastOutboundAt = at;
    conv.lastMessageAt = at;
    contact.waPhoneNumberId = number.phoneNumberId;
    if (!contact.messaged) { contact.messaged = true; contact.messagedAt = at; }
    if (contact.status === 'novo') contact.status = 'mensagem_enviada';
    return msg;
  }

  // Reenvio controlado: devolve para a fila os itens que falharam (ou só os escolhidos).
  function retryFailed(db, ids = null) {
    let n = 0;
    for (const item of db.dispatchItems) {
      if (item.status !== 'failed' || (ids && !ids.includes(item.id))) continue;
      Object.assign(item, { status: 'pending', attempts: 0, lastError: null, notBefore: null, updatedAt: new Date().toISOString() });
      n++;
    }
    return n;
  }

  function summary(db) {
    return db.waNumbers.map(n => {
      const items = db.dispatchItems.filter(i => i.phoneNumberId === n.phoneNumberId);
      const count = st => items.filter(i => i.status === st).length;
      return {
        phoneNumberId: n.phoneNumberId, userId: n.userId, dailyCap: n.dailyCap, sentToday: sentToday(db, n.phoneNumberId),
        pending: count('pending') + count('sending'), failed: count('failed'), skipped: count('skipped'),
        nextAt: nextAt.get(n.phoneNumberId) || null,
      };
    });
  }

  return {
    start() { if (!timer) { timer = setInterval(tick, TICK_MS); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
    tick, enqueue, retryFailed, summary, recordOutbound, numberFor, blockReason, inSendWindow,
  };
}

// Variáveis do template: contact.name, contact.niche, contact.city, seller.name ou um texto fixo.
function paramValue(param, contact, seller) {
  const firstName = s => String(s || '').trim().split(/\s+/)[0];
  switch (param) {
    case 'contact.name': return contact.name;
    case 'contact.niche': return contact.niche || 'seu negócio';
    case 'contact.city': return contact.city || 'sua cidade';
    case 'seller.name': return firstName(seller?.name) || 'Barbosa Dev';
    default: return param;
  }
}

// Texto aproximado do que foi enviado, para o histórico (o corpo real fica na Meta).
function renderTemplate(template, params) {
  const body = template.body || `[template ${template.name}]`;
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (/^\d+$/.test(key) ? params[Number(key) - 1] : params.find(p => p.name === key))?.text ?? m);
}

module.exports = { createQueue, brDate };
