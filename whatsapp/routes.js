// Rotas /api/wa/* do painel (todas exigem login; as de configuração só o CEO).
// O painel só dispara a PRIMEIRA mensagem (template); a conversa segue no WhatsApp da equipe.
const express = require('express');
const api = require('./api');
const { brDate } = require('./queue');

const inMonth = (iso, month) => !!iso && (!month || brDate(iso).slice(0, 7) === month);
const round2 = n => Math.round(n * 100) / 100;

function createRoutes({ getDb, save, uid, auth, queue }) {
  const r = express.Router();
  const lead = auth('gerente', 'ceo');
  const ceo = auth('ceo');

  const publicTemplate = t => ({ id: t.id, name: t.name, language: t.language, category: t.category, params: t.params, body: t.body, active: t.active });

  // Próximos contatos do dono do número que podem receber a primeira mensagem:
  // "A prospectar", nunca receberam template, não estão na fila e não têm bloqueio (opt-out, fixo, sem opt-in…).
  function candidates(db, number) {
    const templated = new Set(db.messages.filter(m => m.direction === 'out' && m.type === 'template').map(m => m.contactId));
    const queued = new Set(db.dispatchItems.filter(i => ['pending', 'sending'].includes(i.status)).map(i => i.contactId));
    return db.contacts
      .filter(c => c.assignedTo === number.userId && c.status === 'novo' && !c.unavailable && !templated.has(c.id) && !queued.has(c.id))
      .filter(c => !queue.blockReason(db, c, number))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  // Dados para montar as telas (nada de token ou segredo aqui).
  r.get('/config', auth(), (req, res) => {
    const db = getDb();
    const s = db.settings.whatsapp;
    const myNumber = db.waNumbers.find(n => n.userId === req.user.id && n.active) || null;
    res.json({
      configured: api.configured(),
      templates: db.waTemplates.filter(t => t.active).map(publicTemplate),
      myNumber,
      // Situação do número de quem está logado: enviadas hoje, fila, falhas e quantos ainda dá para enviar.
      myQueue: myNumber ? { ...queue.summary(db).find(q => q.phoneNumberId === myNumber.phoneNumberId), available: candidates(db, myNumber).length } : null,
      queuePaused: !!s.queuePaused, pauseReason: s.pauseReason || null, inWindow: queue.inSendWindow(s),
      sendDays: s.sendDays, sendHours: s.sendHours, minDelaySec: s.minDelaySec, maxDelaySec: s.maxDelaySec,
      allowWithoutOptIn: !!s.allowWithoutOptIn,
    });
  });

  // ---------- Templates (CEO) ----------
  r.get('/templates', lead, (req, res) => res.json(getDb().waTemplates.map(publicTemplate)));
  r.post('/templates', ceo, (req, res) => {
    const t = readTemplate(req.body);
    if (t.error) return res.status(400).json(t);
    const db = getDb();
    if (db.waTemplates.some(x => x.name === t.name && x.language === t.language)) return res.status(400).json({ error: 'Esse template já está cadastrado.' });
    const template = { id: uid(), ...t, active: true, createdAt: new Date().toISOString() };
    db.waTemplates.push(template);
    save();
    res.json(publicTemplate(template));
  });
  r.patch('/templates/:id', ceo, (req, res) => {
    const db = getDb();
    const template = db.waTemplates.find(t => t.id === req.params.id);
    if (!template) return res.status(404).json({ error: 'Template não encontrado.' });
    if (typeof req.body?.active === 'boolean' && Object.keys(req.body).length === 1) template.active = req.body.active;
    else {
      const t = readTemplate({ ...template, ...req.body });
      if (t.error) return res.status(400).json(t);
      Object.assign(template, t, typeof req.body.active === 'boolean' ? { active: req.body.active } : {});
    }
    save();
    res.json(publicTemplate(template));
  });

  // ---------- Números (CEO) ----------
  r.get('/numbers', lead, (req, res) => res.json(getDb().waNumbers));
  r.post('/numbers', ceo, (req, res) => {
    const db = getDb();
    const n = readNumber(db, req.body);
    if (n.error) return res.status(400).json(n);
    if (db.waNumbers.some(x => x.phoneNumberId === n.phoneNumberId)) return res.status(400).json({ error: 'Esse Phone Number ID já está cadastrado.' });
    if (db.waNumbers.some(x => x.userId === n.userId && x.active)) return res.status(400).json({ error: 'Essa pessoa já tem um número ativo.' });
    const number = { id: uid(), ...n, active: true, qualityRating: null, qualityCheckedAt: null };
    db.waNumbers.push(number);
    save();
    res.json(number);
  });
  r.patch('/numbers/:id', ceo, (req, res) => {
    const db = getDb();
    const number = db.waNumbers.find(n => n.id === req.params.id);
    if (!number) return res.status(404).json({ error: 'Número não encontrado.' });
    const n = readNumber(db, { ...number, ...req.body });
    if (n.error) return res.status(400).json(n);
    // O Phone Number ID não muda: os contatos ficam presos a ele.
    Object.assign(number, { displayPhone: n.displayPhone, userId: n.userId, dailyCap: n.dailyCap });
    if (typeof req.body.active === 'boolean') number.active = req.body.active;
    save();
    res.json(number);
  });
  r.post('/numbers/:id/quality', lead, async (req, res) => {
    const db = getDb();
    const number = db.waNumbers.find(n => n.id === req.params.id);
    if (!number) return res.status(404).json({ error: 'Número não encontrado.' });
    try {
      const info = await api.phoneInfo(number.phoneNumberId);
      Object.assign(number, { qualityRating: info.quality_rating || 'UNKNOWN', verifiedName: info.verified_name || null, qualityCheckedAt: new Date().toISOString() });
      save();
      res.json(number);
    } catch (err) {
      res.status(502).json({ error: `Não foi possível consultar a Meta: ${err.message}` });
    }
  });

  // ---------- Configurações da fila (CEO) ----------
  r.put('/settings', ceo, (req, res) => {
    const db = getDb();
    const s = db.settings.whatsapp;
    const b = req.body || {};
    const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
    if (b.costs) {
      for (const k of ['MARKETING', 'UTILITY', 'AUTHENTICATION']) {
        const v = num(b.costs[k], 0, 100);
        if (v == null) return res.status(400).json({ error: 'Custo inválido.' });
        s.costs[k] = v;
      }
    }
    if (b.minDelaySec !== undefined || b.maxDelaySec !== undefined) {
      const min = num(b.minDelaySec ?? s.minDelaySec, 1, 3600);
      const max = num(b.maxDelaySec ?? s.maxDelaySec, 1, 3600);
      if (min == null || max == null || max < min) return res.status(400).json({ error: 'Intervalo inválido.' });
      Object.assign(s, { minDelaySec: min, maxDelaySec: max });
    }
    if (b.sendDays) {
      const days = [...new Set(b.sendDays.map(Number))].filter(d => d >= 0 && d <= 6);
      if (!days.length) return res.status(400).json({ error: 'Escolha ao menos um dia.' });
      s.sendDays = days.sort();
    }
    if (b.sendHours) {
      const start = num(b.sendHours.start, 0, 23);
      const end = num(b.sendHours.end, 1, 24);
      if (start == null || end == null || end <= start) return res.status(400).json({ error: 'Horário inválido.' });
      s.sendHours = { start, end };
    }
    if (typeof b.allowWithoutOptIn === 'boolean') s.allowWithoutOptIn = b.allowWithoutOptIn;
    if (typeof b.queuePaused === 'boolean') { s.queuePaused = b.queuePaused; if (!b.queuePaused) s.pauseReason = null; }
    if (Array.isArray(b.optOutKeywords)) {
      const words = b.optOutKeywords.map(w => String(w).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()).filter(Boolean);
      if (words.length) s.optOutKeywords = [...new Set(words)];
    }
    save();
    res.json(s);
  });
  r.get('/settings', lead, (req, res) => res.json(getDb().settings.whatsapp));

  // ---------- Disparos ----------
  // Pega os próximos contatos "A prospectar" de um vendedor (ou de todos com número) e põe na fila.
  // Primeira mensagem para os próximos N contatos "A prospectar". O vendedor só dispara do próprio
  // número; gerente e CEO escolhem de quem (ou todos). A fila respeita intervalo, teto e horário.
  r.post('/dispatches', auth(), (req, res) => {
    const db = getDb();
    const b = req.body || {};
    const template = db.waTemplates.find(t => t.id === b.templateId && t.active);
    if (!template) return res.status(400).json({ error: 'Escolha um template.' });
    const limit = Math.min(Math.max(Number(b.limit) || 0, 1), 2000);
    const owner = req.user.role === 'vendedor' ? req.user.id : (b.userId || 'all');
    const numbers = db.waNumbers.filter(n => n.active && (owner === 'all' || n.userId === owner));
    if (!numbers.length) return res.status(400).json({ error: 'Nenhum número de WhatsApp ativo para esse vendedor.' });
    const dispatch = { id: uid(), templateId: template.id, createdBy: req.user.id, createdAt: new Date().toISOString(), userId: owner };
    let added = 0;
    for (const number of numbers) {
      const ids = candidates(db, number).slice(0, limit).map(c => c.id);
      added += queue.enqueue(db, { contactIds: ids, templateId: template.id, dispatchId: dispatch.id }).added;
    }
    if (!added) return res.status(400).json({ error: 'Nenhum contato disponível: todos de "A prospectar" já receberam mensagem, estão na fila ou estão bloqueados (opt-out, fixo, sem opt-in).' });
    dispatch.added = added;
    db.dispatches.push(dispatch);
    save();
    queue.tick();
    res.json(dispatch);
  });

  r.get('/queue', lead, (req, res) => {
    const db = getDb();
    const name = id => db.contacts.find(c => c.id === id)?.name || '(apagado)';
    const s = db.settings.whatsapp;
    res.json({
      paused: !!s.queuePaused, pauseReason: s.pauseReason || null, inWindow: queue.inSendWindow(s), configured: api.configured(),
      numbers: queue.summary(db),
      failed: db.dispatchItems.filter(i => i.status === 'failed').slice(-50).reverse()
        .map(i => ({ id: i.id, contactId: i.contactId, name: name(i.contactId), userId: i.userId, error: i.lastError, at: i.updatedAt })),
      dispatches: db.dispatches.slice(-10).reverse(),
    });
  });
  r.post('/queue/retry', lead, (req, res) => {
    const db = getDb();
    const n = queue.retryFailed(db, Array.isArray(req.body?.ids) ? req.body.ids : null);
    save();
    queue.tick();
    res.json({ retried: n });
  });
  r.post('/queue/cancel', auth(), (req, res) => {
    const db = getDb();
    const owner = req.user.role === 'vendedor' ? req.user.id : req.body?.userId;
    let n = 0;
    for (const i of db.dispatchItems) {
      if (i.status === 'pending' && (!owner || i.userId === owner)) { Object.assign(i, { status: 'skipped', skipReason: 'cancelado', updatedAt: new Date().toISOString() }); n++; }
    }
    save();
    res.json({ cancelled: n });
  });

  // ---------- Relatório de gestão ----------
  r.get('/stats', lead, (req, res) => {
    const db = getDb();
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : '';
    const costs = db.settings.whatsapp.costs;
    const templates = db.messages.filter(m => m.direction === 'out' && m.type === 'template' && inMonth(m.createdAt, month));
    const sellers = db.users.filter(u => u.active && db.waNumbers.some(n => n.userId === u.id));

    // Cobrança: template entregue (ou lido) e marcado como cobrável. Respostas na janela não entram.
    const charged = m => ['delivered', 'read'].includes(m.status) && m.pricing?.billable !== false;
    const costOf = list => round2(list.filter(charged).reduce((s, m) => s + (costs[(m.pricing?.category || m.templateCategory || 'MARKETING').toUpperCase()] || 0), 0));

    const perUser = sellers.map(u => {
      const mine = templates.filter(m => m.userId === u.id);
      const reached = [...new Set(mine.map(m => m.contactId))];
      const firstSent = new Map();
      for (const m of mine) if (!firstSent.has(m.contactId)) firstSent.set(m.contactId, m.createdAt);
      const replied = reached.filter(id => db.messages.some(m => m.contactId === id && m.direction === 'in' && m.createdAt >= firstSent.get(id))).length;
      const sales = db.contacts.filter(c => c.sold && c.soldBy === u.id && inMonth(c.soldAt, month)).length;
      return {
        userId: u.id, name: u.name, sent: mine.length,
        delivered: mine.filter(m => ['delivered', 'read'].includes(m.status)).length,
        failed: mine.filter(m => m.status === 'failed').length,
        reached: reached.length, replied, replyRate: reached.length ? round2(replied / reached.length * 100) : 0,
        sales, conversion: reached.length ? round2(sales / reached.length * 100) : 0, cost: costOf(mine),
      };
    });

    const perDay = {};
    for (const m of templates) {
      const day = brDate(m.createdAt);
      perDay[day] = perDay[day] || {};
      perDay[day][m.userId] = (perDay[day][m.userId] || 0) + 1;
    }
    res.json({
      month, perUser,
      perDay: Object.entries(perDay).sort(([a], [b]) => b.localeCompare(a)).map(([date, byUser]) => ({ date, byUser })),
      totalCost: costOf(templates), costs,
      numbers: db.waNumbers.map(n => ({ id: n.id, displayPhone: n.displayPhone, userId: n.userId, qualityRating: n.qualityRating, qualityCheckedAt: n.qualityCheckedAt, active: n.active })),
    });
  });

  return r;
}

const PARAM_OPTIONS = ['contact.name', 'contact.niche', 'contact.city', 'seller.name'];

function readTemplate(b = {}) {
  const name = String(b.name || '').trim();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) return { error: 'Nome do template: só letras minúsculas, números e _ (igual ao cadastrado na Meta).' };
  const category = String(b.category || 'MARKETING').toUpperCase();
  if (!['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(category)) return { error: 'Categoria inválida.' };
  const params = (Array.isArray(b.params) ? b.params : String(b.params || '').split(','))
    .map(p => String(p).replace(/\s*=\s*/, '=').trim()).filter(Boolean);
  const named = params.filter(p => p.includes('='));
  if (named.length && named.length !== params.length) return { error: 'Use só variáveis nomeadas (nome=contact.name) ou só na ordem (contact.name), sem misturar.' };
  if (named.some(p => !/^[a-z0-9_]+=\S+$/.test(p))) return { error: 'Variável nomeada inválida. Exemplo: nome=contact.name, vendedor=seller.name' };
  const language = String(b.language || 'pt_BR').trim();
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return { error: 'Idioma inválido (ex.: pt_BR, en_US).' };
  return { name, language, category, params, body: String(b.body || '').slice(0, 1024) };
}

function readNumber(db, b = {}) {
  const phoneNumberId = String(b.phoneNumberId || '').trim();
  if (!/^\d{6,30}$/.test(phoneNumberId)) return { error: 'Phone Number ID inválido (só números, copie do painel da Meta).' };
  const user = db.users.find(u => u.id === b.userId && u.active && u.role !== 'ceo');
  if (!user) return { error: 'Escolha o vendedor dono do número.' };
  const dailyCap = Number(b.dailyCap);
  if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 10000) return { error: 'Teto diário inválido.' };
  return { phoneNumberId, displayPhone: String(b.displayPhone || '').trim(), userId: user.id, dailyCap };
}

module.exports = { createRoutes, PARAM_OPTIONS };
