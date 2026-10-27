// Barbosa Dev — Gestão Comercial
// Servidor Express. Os dados ficam num JSON: arquivo local (data/db.json) ou,
// no Render, num repositório privado do GitHub (ver storage.js).
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto');
const path = require('path');
const { createStorage } = require('./storage');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const storage = createStorage(DB_FILE);

const STATUSES = [
  { id: 'novo', label: 'A prospectar' },
  { id: 'respondidos', label: 'Respondidos' },
  { id: 'interessou_exemplo', label: 'Interessou no exemplo' },
  { id: 'respondeu_exemplo', label: 'Respondeu o exemplo' },
  { id: 'interessou_site', label: 'Se interessou no site' },
  { id: 'follow_up', label: 'Follow up' },
  { id: 'reuniao', label: 'Marcou reunião' },
  { id: 'cliente', label: 'Clientes' },
];
const STATUS_IDS = STATUSES.map(s => s.id);

// ---------- Banco de dados ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
const uid = () => crypto.randomBytes(8).toString('hex');

function seed() {
  return {
    users: [
      { id: uid(), username: 'vendedor', name: 'Vendedor', role: 'vendedor', password: hashPassword('vendedor123'), active: true },
      { id: uid(), username: 'gerente', name: 'Gerente Comercial', role: 'gerente', password: hashPassword('gerente123'), active: true },
      { id: uid(), username: 'ceo', name: 'CEO', role: 'ceo', password: hashPassword('ceo123'), active: true },
    ],
    contacts: [],
    imports: [],
    settings: { commission: defaultCommission(), goals: defaultGoals() },
  };
}

// Metas por perfil: mensagens por dia, mensagens no mês e vendas no mês.
function defaultGoals() {
  return {
    gerente: { dailyMessages: 80, monthlyMessages: 1600, monthlySales: 8 },
    vendedor: { dailyMessages: 40, monthlyMessages: 800, monthlySales: 4 },
  };
}

// Faixas de comissão de quem fecha a venda (até "upTo" reais, inclusive; null = acima).
// Nas vendas fechadas por vendedores, o gerente recebe "gerente"% do valor da venda,
// descontado da parte da Barbosa Dev (ex.: 50% vendedor, 5% gerente, 45% Barbosa Dev).
function defaultCommission() {
  return {
    tiers: [
      { upTo: 500, pct: 50 },
      { upTo: 2000, pct: 30 },
      { upTo: null, pct: 20 },
    ],
    gerente: 5,
    managerBase: 'sale',
  };
}

function sellerPct(value, commission) {
  const tier = commission.tiers.find(t => t.upTo == null || value <= t.upTo);
  return tier ? tier.pct : 0;
}

// Calcula e congela a divisão da venda no momento em que ela é registrada.
function splitSale(value, sellerRole, commission) {
  const pct = sellerPct(value, commission);
  const seller = round2(value * pct / 100);
  const manager = sellerRole === 'vendedor' ? round2(value * commission.gerente / 100) : 0;
  return { sellerPct: pct, sellerCommission: seller, managerCommission: manager, bdShare: round2(value - seller - manager) };
}
const round2 = n => Math.round(n * 100) / 100;

let db;
async function load() {
  db = await storage.load();
  if (!db) {
    db = seed();
    console.warn('Nenhum dado encontrado: criados os usuários iniciais com as senhas padrão. Troque-as no primeiro acesso.');
    save();
  } else {
    migrate();
  }
}
// Bases antigas tinham um percentual fixo de vendedor; passa a usar faixas e recalcula vendas sem divisão gravada.
function migrate() {
  if (!db.settings.goals) db.settings.goals = defaultGoals();
  if (!db.settings.commission?.tiers) {
    db.settings.commission = defaultCommission();
  }
  // A parte do gerente passou a ser % do valor da venda (antes era % da parte da Barbosa Dev).
  const recalcManager = db.settings.commission.managerBase !== 'sale';
  db.settings.commission.managerBase = 'sale';
  for (const c of db.contacts) {
    if (!c.sold) continue;
    const role = db.users.find(u => u.id === c.soldBy)?.role;
    if (c.sellerCommission == null) {
      Object.assign(c, splitSale(c.saleValue, role, db.settings.commission));
    } else if (recalcManager) {
      c.managerCommission = role === 'vendedor' ? round2(c.saleValue * db.settings.commission.gerente / 100) : 0;
      c.bdShare = round2(c.saleValue - c.sellerCommission - c.managerCommission);
    }
  }
  save();
}
function save() {
  storage.save(db);
}

const publicUser = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active });

// ---------- Sessões ----------
// Token assinado (não fica na memória), para o login sobreviver quando o servidor
// reinicia ou o Render coloca o site para dormir. Trocar a senha invalida os tokens
// antigos daquele usuário (sessionVersion).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 30;
const sign = payload => crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');

function issueToken(user) {
  const payload = `${user.id}.${Date.now() + SESSION_DAYS * 864e5}.${user.sessionVersion || 0}`;
  return `${payload}.${sign(payload)}`;
}

function userFromToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return null;
  const [id, exp, version, sig] = parts;
  const expected = sign(`${id}.${exp}.${version}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Date.now() > Number(exp)) return null;
  const user = db.users.find(u => u.id === id && u.active);
  return user && String(user.sessionVersion || 0) === version ? user : null;
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok'));

function auth(...roles) {
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const user = userFromToken(token);
    if (!user) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'Sem permissão.' });
    req.user = user;
    req.token = token;
    next();
  };
}

// Vendedor só enxerga os próprios contatos; gerente e CEO enxergam todos.
function canSee(user, contact) {
  return user.role !== 'vendedor' || contact.assignedTo === user.id;
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(u => u.username === String(username || '').trim().toLowerCase() && u.active);
  if (!user || !checkPassword(String(password || ''), user.password)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  res.json({ token: issueToken(user), user: publicUser(user) });
});

// O token é apagado no navegador; não há nada guardado no servidor.
app.post('/api/logout', auth(), (req, res) => {
  res.json({ ok: true });
});

app.get('/api/me', auth(), (req, res) => {
  res.json({ user: publicUser(req.user), statuses: STATUSES });
});

app.post('/api/me/password', auth(), (req, res) => {
  const { current, next } = req.body || {};
  if (!checkPassword(String(current || ''), req.user.password)) return res.status(400).json({ error: 'Senha atual incorreta.' });
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 6 caracteres.' });
  req.user.password = hashPassword(String(next));
  req.user.sessionVersion = (req.user.sessionVersion || 0) + 1;
  save();
  // Desconecta os outros aparelhos, mas mantém este logado com um token novo.
  res.json({ ok: true, token: issueToken(req.user) });
});

// ---------- Usuários ----------
app.get('/api/users', auth('gerente', 'ceo'), (req, res) => {
  res.json(db.users.map(publicUser));
});

app.post('/api/users', auth('ceo'), (req, res) => {
  const { username, name, password, role } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  if (!uname || !name || !password) return res.status(400).json({ error: 'Preencha usuário, nome e senha.' });
  if (!['vendedor', 'gerente'].includes(role)) return res.status(400).json({ error: 'Perfil inválido.' });
  if (db.users.some(u => u.username === uname)) return res.status(400).json({ error: 'Esse usuário já existe.' });
  const user = { id: uid(), username: uname, name: String(name).trim(), role, password: hashPassword(String(password)), active: true };
  db.users.push(user);
  save();
  res.json(publicUser(user));
});

app.patch('/api/users/:id', auth('ceo'), (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const { name, password, active } = req.body || {};
  if (name) user.name = String(name).trim();
  if (password) {
    user.password = hashPassword(String(password));
    user.sessionVersion = (user.sessionVersion || 0) + 1;
  }
  if (typeof active === 'boolean' && user.role !== 'ceo') user.active = active;
  save();
  res.json(publicUser(user));
});

// ---------- Contatos ----------
app.get('/api/contacts', auth(), (req, res) => {
  let list = visibleContacts().filter(c => canSee(req.user, c));
  if (req.query.vendor && req.user.role !== 'vendedor') list = list.filter(c => c.assignedTo === req.query.vendor);
  res.json(list);
});

app.post('/api/contacts', auth(), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Informe o nome.' });
  const assignedTo = req.user.role === 'vendedor' ? req.user.id : (b.assignedTo || req.user.id);
  const contact = newContact({ ...b, assignedTo }, req.user.id);
  db.contacts.push(contact);
  save();
  res.json(contact);
});

function newContact(b, createdBy, importId = null) {
  return {
    id: uid(),
    name: String(b.name || '').trim(),
    niche: String(b.niche || '').trim(),
    phone: String(b.phone || '').trim(),
    site: String(b.site || '').trim(),
    maps: String(b.maps || '').trim(),
    address: String(b.address || '').trim(),
    city: String(b.city || '').trim(),
    assignedTo: b.assignedTo,
    status: 'novo',
    messaged: false,
    messagedAt: null,
    meetingAt: null,
    meetingDate: null,
    sold: false,
    saleValue: 0,
    soldAt: null,
    soldBy: null,
    notes: '',
    importId,
    createdAt: new Date().toISOString(),
    createdBy,
  };
}

app.patch('/api/contacts/:id', auth(), (req, res) => {
  const c = db.contacts.find(x => x.id === req.params.id);
  if (!c || !canSee(req.user, c)) return res.status(404).json({ error: 'Contato não encontrado.' });
  const b = req.body || {};
  const now = new Date().toISOString();

  if (typeof b.messaged === 'boolean') {
    c.messaged = b.messaged;
    c.messagedAt = b.messaged ? now : null;
  }
  if (b.status !== undefined) {
    if (!STATUS_IDS.includes(b.status)) return res.status(400).json({ error: 'Lista inválida.' });
    if (b.status === 'reuniao' && c.status !== 'reuniao') c.meetingAt = now;
    c.status = b.status;
    if (b.status !== 'novo' && !c.messaged) { c.messaged = true; c.messagedAt = now; }
  }
  // Número indisponível: o contato sai da lista de todos, mas continua guardado para barrar a reimportação.
  if (b.unavailable === true) {
    if (c.sold) return res.status(400).json({ error: 'Contato já vendido.' });
    c.unavailable = true;
    c.unavailableAt = now;
    c.unavailableBy = req.user.id;
  }
  if (b.meetingDate !== undefined) c.meetingDate = b.meetingDate || null;
  if (b.notes !== undefined) c.notes = String(b.notes);
  for (const f of ['name', 'niche', 'phone', 'site', 'maps', 'address', 'city']) if (b[f] !== undefined) c[f] = String(b[f]).trim();
  if (b.assignedTo && req.user.role !== 'vendedor') c.assignedTo = b.assignedTo;
  save();
  res.json(c);
});

app.post('/api/contacts/:id/sale', auth(), (req, res) => {
  const c = db.contacts.find(x => x.id === req.params.id);
  if (!c || !canSee(req.user, c)) return res.status(404).json({ error: 'Contato não encontrado.' });
  const value = Number(String(req.body?.value ?? '').replace(/\./g, '').replace(',', '.'));
  if (!(value > 0)) return res.status(400).json({ error: 'Informe um valor de venda válido.' });
  c.sold = true;
  c.saleValue = value;
  c.soldAt = new Date().toISOString();
  c.soldBy = c.assignedTo;
  const sellerRole = db.users.find(u => u.id === c.soldBy)?.role;
  Object.assign(c, splitSale(value, sellerRole, db.settings.commission));
  c.status = 'cliente';
  if (!c.messaged) { c.messaged = true; c.messagedAt = c.soldAt; }
  save();
  res.json(c);
});

app.delete('/api/contacts/:id/sale', auth('gerente', 'ceo'), (req, res) => {
  const c = db.contacts.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Contato não encontrado.' });
  Object.assign(c, {
    sold: false, saleValue: 0, soldAt: null, soldBy: null, status: 'follow_up',
    sellerPct: null, sellerCommission: null, managerCommission: null, bdShare: null,
  });
  save();
  res.json(c);
});

app.delete('/api/contacts/:id', auth('gerente', 'ceo'), (req, res) => {
  const i = db.contacts.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Contato não encontrado.' });
  db.contacts.splice(i, 1);
  save();
  res.json({ ok: true });
});

// ---------- Comissões ----------
app.get('/api/settings', auth(), (req, res) => res.json(db.settings));

app.put('/api/settings/goals', auth('ceo'), (req, res) => {
  const goals = {};
  for (const role of ['gerente', 'vendedor']) {
    const g = req.body?.[role] || {};
    const t = { dailyMessages: Number(g.dailyMessages), monthlyMessages: Number(g.monthlyMessages), monthlySales: Number(g.monthlySales) };
    if (!Object.values(t).every(v => Number.isInteger(v) && v >= 0)) return res.status(400).json({ error: 'As metas precisam ser números inteiros.' });
    goals[role] = t;
  }
  db.settings.goals = goals;
  save();
  res.json(db.settings);
});

// Vale para as próximas vendas; vendas já fechadas mantêm a comissão calculada na época.
app.put('/api/settings/commission', auth('ceo'), (req, res) => {
  const b = req.body || {};
  const tiers = (b.tiers || []).map(t => ({ upTo: t.upTo === null || t.upTo === '' ? null : Number(t.upTo), pct: Number(t.pct) }));
  const g = Number(b.gerente);
  const pctOk = p => p >= 0 && p <= 100;
  const limits = tiers.slice(0, -1).map(t => t.upTo);
  if (tiers.length < 1 || tiers[tiers.length - 1].upTo !== null || !tiers.every(t => pctOk(t.pct)) || !pctOk(g)
      || !limits.every((l, i) => l > 0 && (i === 0 || l > limits[i - 1]))) {
    return res.status(400).json({ error: 'Confira as faixas: valores crescentes e percentuais entre 0 e 100.' });
  }
  db.settings.commission = { tiers, gerente: g, managerBase: 'sale' };
  save();
  res.json(db.settings);
});

// ---------- Estatísticas ----------
// month = "AAAA-MM" filtra eventos (mensagens, reuniões, vendas) daquele mês; vazio = todo o período.
// Datas comparadas no fuso do servidor (AAAA-MM-DD).
const localDate = iso => new Date(iso).toLocaleDateString('sv-SE');
function inMonth(iso, month) {
  return !!iso && (!month || localDate(iso).slice(0, 7) === month);
}

// Progresso das metas: hoje + o mês escolhido (ou o mês atual quando o filtro é "Tudo").
function goalProgress(contacts, role, month) {
  const today = localDate(new Date().toISOString());
  const goalMonth = month || today.slice(0, 7);
  return {
    month: goalMonth,
    targets: db.settings.goals[role] || null,
    messagesToday: contacts.filter(c => c.messaged && c.messagedAt && localDate(c.messagedAt) === today).length,
    monthMessages: contacts.filter(c => c.messaged && inMonth(c.messagedAt, goalMonth)).length,
    monthSales: contacts.filter(c => c.sold && inMonth(c.soldAt, goalMonth)).length,
  };
}

function statsFor(contacts, month) {
  const sales = contacts.filter(c => c.sold && inMonth(c.soldAt, month));
  const byStatus = Object.fromEntries(STATUSES.map(s => [s.id, 0]));
  contacts.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
  return {
    contacts: contacts.length,
    pending: contacts.filter(c => !c.messaged).length,
    messaged: contacts.filter(c => c.messaged && inMonth(c.messagedAt, month)).length,
    meetings: contacts.filter(c => c.meetingAt && inMonth(c.meetingAt, month)).length,
    salesCount: sales.length,
    salesTotal: sum(sales, 'saleValue'),
    sellerCommission: sum(sales, 'sellerCommission'),
    managerCommission: sum(sales, 'managerCommission'),
    bdShare: sum(sales, 'bdShare'),
    byStatus,
  };
}
const sum = (list, field) => round2(list.reduce((s, c) => s + (c[field] || 0), 0));

app.get('/api/stats', auth(), (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : '';
  const pct = db.settings.commission;
  const sellers = db.users.filter(u => u.role === 'vendedor' || u.role === 'gerente');

  const contacts = visibleContacts();
  const team = statsFor(contacts, month);
  const managerCommission = team.managerCommission;
  // Gerente: comissão das próprias vendas + % da parte da Barbosa Dev nas vendas dos vendedores.
  const perUser = sellers.map(u => {
    const mine = contacts.filter(c => c.assignedTo === u.id);
    const s = statsFor(mine, month);
    const commission = s.sellerCommission + (u.role === 'gerente' ? managerCommission : 0);
    // Mensagens para números que depois se mostraram indisponíveis continuam contando na meta.
    const goal = goalProgress(db.contacts.filter(c => c.assignedTo === u.id), u.role, month);
    return { user: publicUser(u), ...s, commission: round2(commission), goal };
  });

  const meetings = db.contacts
    .filter(c => c.status === 'reuniao' || (c.meetingAt && inMonth(c.meetingAt, month)))
    .filter(c => canSee(req.user, c))
    .sort((a, b) => (a.meetingDate || a.meetingAt || '').localeCompare(b.meetingDate || b.meetingAt || ''));
  const sales = db.contacts
    .filter(c => c.sold && inMonth(c.soldAt, month) && canSee(req.user, c))
    .sort((a, b) => b.soldAt.localeCompare(a.soldAt));

  if (req.user.role === 'vendedor') {
    const mine = perUser.find(p => p.user.id === req.user.id);
    return res.json({ month, pct, me: mine, meetings, sales });
  }
  const me = req.user.role === 'gerente' ? perUser.find(p => p.user.id === req.user.id) : null;
  res.json({
    month, pct, me, team, perUser, meetings, sales,
    commissions: {
      vendedores: sum(perUser.filter(p => p.user.role === 'vendedor'), 'commission'),
      gerente: sum(perUser.filter(p => p.user.role === 'gerente'), 'commission'),
      total: round2(team.sellerCommission + team.managerCommission),
      bdShare: team.bdShare,
    },
    imports: db.imports.slice().reverse().map(i => {
      const mine = db.contacts.filter(c => c.importId === i.id);
      return { ...i, remaining: mine.length, worked: mine.filter(touched).length, sold: mine.filter(c => c.sold).length };
    }),
    hiddenDuplicates: db.contacts.filter(c => !c.unavailable).length - contacts.length,
    unavailable: db.contacts.filter(c => c.unavailable).length,
  });
});

// ---------- Importação de Excel ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Cabeçalhos aceitos: modelo em português e o padrão do extrator do Google Maps
// (title, categoryName, phone, website, address, city, url).
const HEADER_MAP = [
  ['name', ['nome', 'title', 'name', 'empresa', 'cliente', 'estabelecimento', 'razao social']],
  ['niche', ['nicho', 'categoryname', 'category', 'segmento', 'categoria', 'ramo']],
  ['phone', ['numero', 'phone', 'telefone', 'whatsapp', 'celular', 'phoneunformatted', 'fone', 'contato', 'tel']],
  ['site', ['site', 'website', 'pagina']],
  ['maps', ['google maps', 'link do google maps', 'maps', 'url', 'link maps', 'link google', 'mapa']],
  ['address', ['endereco', 'address', 'localizacao']],
  ['city', ['cidade', 'city', 'municipio']],
];
// Primeiro casa nomes exatos em todas as colunas; só depois tenta por trecho do nome.
function mapHeaders(headers) {
  const mapping = {};
  const used = new Set();
  for (const exact of [true, false]) {
    for (const [field, keys] of HEADER_MAP) {
      if (Object.values(mapping).includes(field)) continue;
      const h = headers.find(h => !used.has(h) && keys.some(k => exact ? norm(h) === k : norm(h).includes(k)));
      if (h) { mapping[h] = field; used.add(h); }
    }
  }
  return mapping;
}

// Chave do telefone para achar duplicados: só dígitos, sem o 55 do Brasil.
function phoneKey(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
}

// Chaves que identificam o mesmo estabelecimento: telefone, ou nome + cidade / nome + endereço.
function contactKeys(c) {
  const keys = [];
  const ph = phoneKey(c.phone);
  if (ph.length >= 8) keys.push('tel:' + ph);
  const name = norm(c.name).replace(/[^a-z0-9]/g, '');
  if (name) {
    const city = norm(c.city).replace(/[^a-z0-9]/g, '');
    const address = norm(c.address).replace(/[^a-z0-9]/g, '');
    if (city) keys.push('nc:' + name + '|' + city);
    if (address) keys.push('na:' + name + '|' + address);
  }
  return keys;
}

const touched = c => c.messaged || c.sold || c.status !== 'novo';

// Contatos repetidos (o mesmo estabelecimento enviado por outra planilha) que o funcionário não deve ver.
// Em cada grupo de repetidos fica visível o que já foi trabalhado (ou o mais antigo);
// os outros ficam ocultos enquanto ninguém mexeu neles.
function hiddenDuplicateIds() {
  const parent = new Map();
  const find = id => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  const owner = new Map();
  for (const c of db.contacts) {
    parent.set(c.id, c.id);
    for (const k of contactKeys(c)) {
      if (owner.has(k)) parent.set(find(c.id), find(owner.get(k)));
      else owner.set(k, c.id);
    }
  }
  const groups = new Map();
  for (const c of db.contacts) {
    const root = find(c.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(c);
  }
  const hidden = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const byAge = [...group].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const keeper = byAge.find(touched) || byAge[0];
    for (const c of group) if (c !== keeper && !touched(c)) hidden.add(c.id);
  }
  return hidden;
}

function visibleContacts() {
  const hidden = hiddenDuplicateIds();
  return db.contacts.filter(c => !hidden.has(c.id) && !c.unavailable);
}

const mapsSearch = (...parts) => {
  const q = parts.filter(Boolean).join(', ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
};

// Lê a planilha e marca cada linha como nova, duplicada (número já cadastrado) ou sem nome.
function parseSheet(buffer, filename = '') {
  let rows;
  try {
    // CSV pode vir em UTF-8 ou em Windows-1252 (padrão do Excel no Windows).
    let wb;
    if (/\.csv$/i.test(filename)) {
      let text = buffer.toString('utf8');
      if (text.includes('�')) text = buffer.toString('latin1');
      wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string' });
    } else {
      wb = XLSX.read(buffer, { type: 'buffer' });
    }
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  } catch {
    throw new Error('Não foi possível ler a planilha.');
  }
  if (!rows.length) throw new Error('A planilha está vazia.');

  const mapping = mapHeaders(Object.keys(rows[0]));
  if (!Object.values(mapping).includes('name')) {
    throw new Error('Não encontrei a coluna "Nome" (ou "title") na planilha. Use o modelo para conferir os cabeçalhos.');
  }

  // Já enviado antes (em qualquer planilha ou cadastro) ou repetido dentro da própria planilha.
  const seen = new Set(db.contacts.flatMap(contactKeys));
  const unavailablePhones = new Set(db.contacts.filter(c => c.unavailable).map(c => phoneKey(c.phone)).filter(Boolean));
  const items = rows.map(row => {
    const data = { name: '', niche: '', phone: '', site: '', maps: '', address: '', city: '' };
    for (const [h, f] of Object.entries(mapping)) data[f] = String(row[h] ?? '').trim();
    // O extrator do Google Maps não traz o link do local: monta uma busca pelo nome + endereço.
    if (!data.maps) data.maps = mapsSearch(data.name, data.address || data.city);
    const keys = contactKeys(data);
    let status = 'novo';
    if (!data.name) status = 'sem_nome';
    else if (unavailablePhones.has(phoneKey(data.phone))) status = 'indisponivel';
    else if (keys.some(k => seen.has(k))) status = 'duplicado';
    if (status === 'novo') keys.forEach(k => seen.add(k));
    return { ...data, status };
  });
  return { mapping, items };
}

// dryRun=1 só devolve a prévia; sem ele, cria os contatos para o destino escolhido.
app.post('/api/import', auth('ceo'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie um arquivo .xlsx, .xls ou .csv.' });
  let parsed;
  try { parsed = parseSheet(req.file.buffer, req.file.originalname); } catch (err) { return res.status(400).json({ error: err.message }); }
  const { mapping, items } = parsed;
  const added = items.filter(i => i.status === 'novo').length;
  const skipped = items.length - added;

  if (req.query.dryRun) return res.json({ file: req.file.originalname, columns: mapping, items, added, skipped });

  // Destino: o gerente, um vendedor específico ou "distribuir" igualmente entre os vendedores ativos.
  const target = req.body.assignTo;
  const vendors = db.users.filter(u => u.role === 'vendedor' && u.active);
  let pick, targetName;
  if (target === 'distribuir') {
    if (!vendors.length) return res.status(400).json({ error: 'Nenhum vendedor ativo.' });
    let i = 0;
    pick = () => vendors[i++ % vendors.length].id;
    targetName = 'Distribuído entre os vendedores';
  } else {
    const u = db.users.find(x => x.id === target && x.active && x.role !== 'ceo');
    if (!u) return res.status(400).json({ error: 'Escolha para quem enviar a lista.' });
    pick = () => u.id;
    targetName = u.name;
  }
  if (!added) return res.status(400).json({ error: 'Nenhum contato novo nesta planilha.' });

  const importId = uid();
  for (const item of items.filter(i => i.status === 'novo')) {
    db.contacts.push(newContact({ ...item, assignedTo: pick() }, req.user.id, importId));
  }
  db.imports.push({ id: importId, file: req.file.originalname, added, skipped, by: req.user.name, at: new Date().toISOString(), assignTo: target, assignToName: targetName });
  save();
  res.json({ added, skipped, columns: mapping, assignToName: targetName });
});

// Apaga uma lista enviada: some da equipe junto com o andamento (respondidos, follow up, reuniões…).
// Contatos vendidos ficam, para não perder o registro das vendas e comissões.
app.delete('/api/imports/:id', auth('ceo'), (req, res) => {
  const imp = db.imports.find(i => i.id === req.params.id);
  if (!imp) return res.status(404).json({ error: 'Lista não encontrada.' });
  const before = db.contacts.length;
  db.contacts = db.contacts.filter(c => c.importId !== imp.id || c.sold);
  const removed = before - db.contacts.length;
  const keptSold = db.contacts.filter(c => c.importId === imp.id).length;
  db.imports = db.imports.filter(i => i.id !== imp.id);
  save();
  res.json({ removed, keptSold });
});

app.get('/api/template.xlsx', (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Nome', 'Nicho', 'Número', 'Site', 'Google Maps'],
    ['Barbearia Exemplo', 'Barbearia', '(11) 99999-0000', 'https://exemplo.com.br', 'https://maps.google.com/?q=Barbearia+Exemplo'],
  ]);
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 30 }, { wch: 45 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contatos');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-contatos-barbosadev.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

// Só começa a atender depois de carregar os dados.
load().then(() => {
  app.listen(PORT, () => console.log(`Barbosa Dev — Gestão rodando em http://localhost:${PORT} (dados: ${storage.name})`));
}).catch(err => {
  console.error('Não foi possível carregar os dados:', err.message);
  process.exit(1);
});

// O Render avisa antes de desligar o site: envia o que estiver pendente antes de sair.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    await storage.flush();
    process.exit(0);
  });
}
