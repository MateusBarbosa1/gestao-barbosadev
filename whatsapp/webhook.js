// Webhook da WhatsApp Cloud API.
//   GET  /webhook/whatsapp  verificação da Meta (hub.mode, hub.verify_token, hub.challenge)
//   POST /webhook/whatsapp  eventos: valida X-Hub-Signature-256 com o App Secret, responde 200
//                           na hora e processa em segundo plano.
// Variáveis de ambiente: WA_VERIFY_TOKEN, WA_APP_SECRET.
const express = require('express');
const crypto = require('crypto');
const { waKey, toE164 } = require('./schema');

const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };
const EVENT_TTL_DAYS = 30;

// Logs sem dados pessoais: telefone só com os 4 últimos dígitos.
const mask = phone => (phone ? `***${String(phone).slice(-4)}` : '-');
const log = (...args) => console.log('[whatsapp]', ...args);

const normalizeText = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Opt-out: a mensagem é só a palavra-chave ("SAIR", "Parar!") ou começa com ela ("não quero mais").
function isOptOut(text, keywords) {
  const t = normalizeText(text);
  if (!t || t.length > 80) return false;
  return keywords.some(k => t === k || t.startsWith(k + ' '));
}

function validSignature(rawBody, header, secret) {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
  const received = Buffer.from(header.slice(7));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// Limite simples por IP (janela de 1 minuto) para não deixarem o webhook derrubar o servidor.
function rateLimit(max) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start > 60_000) hits.set(key, { start: now, n: 1 });
    else if (++entry.n > max) return res.sendStatus(429);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

function createWebhook({ getDb, save, uid }) {
  const router = express.Router();
  const limiter = rateLimit(600);

  router.get('/webhook/whatsapp', limiter, (req, res) => {
    const token = process.env.WA_VERIFY_TOKEN;
    if (token && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === token) {
      return res.status(200).send(String(req.query['hub.challenge'] || ''));
    }
    res.sendStatus(403);
  });

  // express.raw: a assinatura é calculada sobre o corpo exatamente como chegou.
  router.post('/webhook/whatsapp', limiter, express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const secret = process.env.WA_APP_SECRET;
    if (!secret) {
      log('WA_APP_SECRET não configurado: evento recusado.');
      return res.sendStatus(503);
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!validSignature(raw, req.get('x-hub-signature-256'), secret)) return res.sendStatus(401);
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.sendStatus(400); }
    res.sendStatus(200);
    setImmediate(() => {
      try { processPayload(payload); } catch (err) { log('erro ao processar evento:', err.message); }
    });
  });

  function processPayload(payload) {
    if (payload.object !== 'whatsapp_business_account') return;
    const db = getDb();
    let changed = false;
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages' || !change.value) continue;
        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        const number = db.waNumbers.find(n => n.phoneNumberId === phoneNumberId);
        if (!number) { log(`evento de número não cadastrado (${phoneNumberId}): ignorado`); continue; }
        const profiles = new Map((value.contacts || []).map(c => [c.wa_id, c.profile?.name]));
        for (const msg of value.messages || []) changed = handleInbound(db, number, msg, profiles.get(msg.from)) || changed;
        for (const st of value.statuses || []) changed = handleStatus(db, st) || changed;
        for (const err of value.errors || []) log(`erro da Meta ${err.code}: ${err.title}`);
      }
    }
    if (changed) { pruneEvents(db); save(); }
  }

  // Mensagem do cliente: registra, abre a janela de 24h, detecta opt-out e avança o status.
  function handleInbound(db, number, msg, profileName) {
    if (!msg.id || db.messages.some(m => m.waMessageId === msg.id)) return false; // reenvio da Meta
    const at = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();
    const key = waKey(msg.from);
    let contact = db.contacts.find(c => waKey(c.phoneE164 || c.phone) === key);
    if (!contact) {
      // Quem chama a empresa primeiro vira contato novo do vendedor dono do número.
      contact = {
        id: uid(), name: profileName || `WhatsApp ${mask(msg.from)}`, niche: '', phone: msg.from, site: '', maps: '',
        address: '', city: '', assignedTo: number.userId, status: 'respondidos', messaged: true, messagedAt: at,
        meetingAt: null, meetingDate: null, sold: false, saleValue: 0, soldAt: null, soldBy: null, notes: '',
        importId: null, createdAt: at, createdBy: null, phoneE164: toE164(msg.from), origin: 'whatsapp_inbound',
        optIn: true, optInAt: at, optInSource: 'mensagem do cliente', optOut: false, optOutAt: null,
        waPhoneNumberId: number.phoneNumberId, lastInboundAt: null,
      };
      db.contacts.push(contact);
      log(`novo contato pelo WhatsApp ${mask(msg.from)}`);
    }

    // Tipos com texto aproveitável; o resto (áudio, imagem, figurinha…) fica registrado só com o tipo.
    let type = 'text';
    let text = null;
    if (msg.type === 'text') text = msg.text?.body ?? '';
    else if (msg.type === 'button') text = msg.button?.text ?? '';
    else if (msg.type === 'interactive') text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '';
    else type = 'unsupported';

    const conv = conversationFor(db, contact, number);
    db.messages.push({
      id: uid(), waMessageId: msg.id, conversationId: conv.id, contactId: contact.id,
      phoneNumberId: number.phoneNumberId, userId: conv.userId, direction: 'in', type,
      templateName: null, text, unsupportedType: type === 'unsupported' ? msg.type : null,
      status: 'received', statusAt: {}, error: null, pricing: null, createdAt: at,
    });
    conv.lastInboundAt = at;
    conv.lastMessageAt = at;
    conv.unread = (conv.unread || 0) + 1;
    if (!contact.lastInboundAt || at > contact.lastInboundAt) contact.lastInboundAt = at;

    if (text && isOptOut(text, db.settings.whatsapp.optOutKeywords)) {
      contact.optOut = true;
      contact.optOutAt = at;
      contact.status = 'opt_out';
      contact.followUp = false;
      for (const item of db.dispatchItems) {
        if (item.contactId === contact.id && item.status === 'pending') Object.assign(item, { status: 'skipped', skipReason: 'opt_out', updatedAt: at });
      }
      log(`opt-out registrado ${mask(msg.from)}`);
    } else if (!contact.optOut && ['novo', 'mensagem_enviada'].includes(contact.status)) {
      contact.status = 'respondidos';
      if (!contact.messaged) { contact.messaged = true; contact.messagedAt = at; }
    }
    return true;
  }

  // Status de entrega de uma mensagem enviada por nós (sent, delivered, read, failed).
  function handleStatus(db, st) {
    const eventKey = `${st.id}:${st.status}`;
    if (db.waEvents.some(e => e.key === eventKey)) return false; // reenvio da Meta
    db.waEvents.push({ key: eventKey, at: new Date().toISOString() });
    const msg = db.messages.find(m => m.waMessageId === st.id);
    if (!msg) return true; // mensagem enviada fora do painel: só marca como processado
    const at = st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString();
    msg.statusAt = { ...(msg.statusAt || {}), [st.status]: at };
    if (st.status === 'failed') {
      // Falha depois de entregue não acontece na prática; se vier, mantém o "entregue/lida".
      if ((STATUS_RANK[msg.status] ?? 0) < STATUS_RANK.delivered) msg.status = 'failed';
      const e = st.errors?.[0];
      msg.error = e ? { code: e.code, title: e.title || e.message || '' } : { code: null, title: 'falha' };
      const item = db.dispatchItems.find(i => i.messageId === msg.id);
      if (item) Object.assign(item, { status: 'failed', lastError: msg.error.title, skipReason: null, updatedAt: at });
      log(`falha no envio (${msg.error.code}): ${msg.error.title}`);
    } else if ((STATUS_RANK[st.status] ?? -1) > (STATUS_RANK[msg.status] ?? 0)) {
      msg.status = st.status;
    }
    if (st.pricing) msg.pricing = { category: String(st.pricing.category || '').toUpperCase(), billable: st.pricing.billable !== false };
    return true;
  }

  function conversationFor(db, contact, number) {
    let conv = db.conversations.find(c => c.contactId === contact.id && c.phoneNumberId === number.phoneNumberId);
    if (!conv) {
      conv = {
        id: uid(), contactId: contact.id, phoneNumberId: number.phoneNumberId, userId: number.userId,
        lastInboundAt: null, lastOutboundAt: null, lastMessageAt: null, unread: 0,
      };
      db.conversations.push(conv);
    }
    return conv;
  }

  function pruneEvents(db) {
    const limit = new Date(Date.now() - EVENT_TTL_DAYS * 86400_000).toISOString();
    if (db.waEvents.length > 2000) db.waEvents = db.waEvents.filter(e => e.at >= limit);
  }

  return { router, processPayload, conversationFor };
}

module.exports = { createWebhook, isOptOut, validSignature };
