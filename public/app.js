// Barbosa Dev — Gestão Comercial (frontend)
const state = {
  token: localStorage.getItem('bd_token'),
  user: null,
  statuses: [],
  contacts: [],
  users: [],
  stats: null,
  settings: null,
  month: new Date().toISOString().slice(0, 7),
  tab: 'novo',
  search: '',
  vendorFilter: '',
};

const ROLE_LABEL = { vendedor: 'Vendedor', gerente: 'Gerente Comercial', ceo: 'CEO' };
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const statusLabel = id => state.statuses.find(s => s.id === id)?.label || id;
const userName = id => state.users.find(u => u.id === id)?.name || (id === state.user?.id ? state.user.name : '—');
const url = u => !u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`;
const sellerPct = (value, c = state.settings.commission) => c.tiers.find(t => t.upTo == null || value <= t.upTo)?.pct ?? 0;
const tierText = (c = state.settings.commission) => c.tiers
  .map((t, i) => t.upTo == null ? `${t.pct}% acima de ${brl(c.tiers[i - 1]?.upTo ?? 0)}` : `${t.pct}% até ${brl(t.upTo)}`)
  .join(' · ');
const parseMoney = s => Number(String(s || '').replace(/\./g, '').replace(',', '.'));
const waLink = phone => {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}`;
};

// ---------- API ----------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { logout(true); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'Erro inesperado.');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Login ----------
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-error').textContent = '';
  try {
    const { token, user } = await api('/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    state.token = token;
    localStorage.setItem('bd_token', token);
    state.user = user;
    e.target.reset();
    await start();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

function logout(silent) {
  if (!silent && state.token) api('/logout', { method: 'POST' }).catch(() => {});
  state.token = null;
  state.user = null;
  localStorage.removeItem('bd_token');
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}
$('#btn-logout').onclick = () => logout();

$('#month').addEventListener('change', e => { state.month = e.target.value; refresh(); });
$('#btn-all-time').onclick = () => { state.month = ''; $('#month').value = ''; refresh(); };
$('#btn-password').onclick = openPasswordModal;

async function start() {
  try {
    const me = await api('/me');
    state.user = me.user;
    state.statuses = me.statuses;
  } catch {
    return logout(true);
  }
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#role-label').textContent = ROLE_LABEL[state.user.role];
  $('#who').textContent = state.user.name;
  $('#month').value = state.month;
  state.tab = 'novo';
  await refresh();
}

async function refresh() {
  const q = state.month ? `?month=${state.month}` : '';
  const isLead = state.user.role !== 'vendedor';
  const [contacts, stats, settings, users] = await Promise.all([
    api('/contacts'),
    api(`/stats${q}`),
    api('/settings'),
    isLead ? api('/users') : Promise.resolve([]),
  ]);
  Object.assign(state, { contacts, stats, settings, users });
  render();
}

// ---------- Render ----------
function render() {
  const role = state.user.role;
  const main = $('#main');
  if (role === 'vendedor') main.innerHTML = vendedorView();
  else if (role === 'gerente') main.innerHTML = gerenteView();
  else main.innerHTML = ceoView();
  bindContactTable();
  if (role === 'ceo') bindCeo();
}

const periodText = () => state.month
  ? new Date(state.month + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  : 'todo o período';

function kpi(label, value, note = '', accent = false) {
  return `<div class="kpi ${accent ? 'accent' : ''}"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;
}

function vendedorView() {
  const { me, pct, meetings } = state.stats;
  return `
    <section class="kpis">
      ${kpi('A prospectar', me.pending, 'contatos sem mensagem')}
      ${kpi('Mensagens enviadas', me.messaged, periodText())}
      ${kpi('Reuniões marcadas', me.meetings, periodText())}
      ${kpi('Vendas', me.salesCount, periodText())}
      ${kpi('Total vendido', brl(me.salesTotal), periodText())}
      ${kpi('Minha comissão', brl(me.commission), tierText(pct), true)}
    </section>
    ${goalsCard(me, 'Minhas metas')}
    ${meetingsCard(meetings)}
    ${contactsSection(false)}`;
}

function gerenteView() {
  const { me, team, pct, perUser, meetings } = state.stats;
  return `
    <section class="kpis">
      ${kpi('Contatos da equipe', team.contacts, `${team.pending} a prospectar`)}
      ${kpi('Mensagens enviadas', team.messaged, periodText())}
      ${kpi('Reuniões', team.meetings, periodText())}
      ${kpi('Vendas', team.salesCount, periodText())}
      ${kpi('Total vendido', brl(team.salesTotal), periodText())}
      ${kpi('Minha comissão', brl(me?.commission), `${brl(me?.sellerCommission)} das minhas vendas + ${brl(me?.commission - me?.sellerCommission)} (${pct.gerente}% das vendas dos vendedores)`, true)}
    </section>
    ${me ? goalsCard(me, 'Minhas metas') : ''}
    <section class="card">
      <div class="section-head"><h2>Resultados dos vendedores</h2><span class="sub">${periodText()}</span></div>
      ${sellersTable(perUser.filter(p => p.user.id !== state.user.id))}
    </section>
    <div class="grid-2">
      ${meetingsCard(meetings)}
      <section class="card"><div class="section-head"><h2>Funil da equipe</h2></div>${funnel(team.byStatus)}</section>
    </div>
    ${contactsSection(true)}`;
}

function ceoView() {
  const { team, pct, perUser, meetings, sales, commissions } = state.stats;
  return `
    <section class="kpis">
      ${kpi('Total vendido', brl(team.salesTotal), periodText(), true)}
      ${kpi('Parte Barbosa Dev', brl(commissions.bdShare), 'vendido menos comissões')}
      ${kpi('Comissões a pagar', brl(commissions.total), `vendedores ${brl(commissions.vendedores)} · gerente ${brl(commissions.gerente)}`)}
      ${kpi('Vendas fechadas', team.salesCount, periodText())}
      ${kpi('Reuniões', team.meetings, periodText())}
      ${kpi('Mensagens enviadas', team.messaged, periodText())}
      ${kpi('Contatos na base', team.contacts, `${team.pending} ainda sem mensagem`)}
    </section>

    ${importCard()}

    <section class="card">
      <div class="section-head"><h2>Resultados por pessoa</h2><span class="sub">${periodText()}</span></div>
      ${sellersTable(perUser)}
    </section>

    <div class="grid-2">
      ${meetingsCard(meetings)}
      <section class="card">
        <div class="section-head"><h2>Vendas</h2><span class="sub">${periodText()}</span></div>
        ${sales.length ? `<div class="list">${sales.map(c => `
          <div class="list-item"><span><span class="name">${esc(c.name)}</span> <span class="sub">· ${esc(userName(c.soldBy))} · ${fmtDate(c.soldAt)}</span>
            <div class="sub">Comissão ${brl(c.sellerCommission)} (${c.sellerPct}%)${c.managerCommission ? ` · gerente ${brl(c.managerCommission)}` : ''} · Barbosa Dev ${brl(c.bdShare)}</div></span>
          <strong>${brl(c.saleValue)}</strong></div>`).join('')}</div>` : '<p class="empty">Nenhuma venda no período.</p>'}
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="section-head"><h2>Comissões</h2><span class="sub">valem para as próximas vendas</span></div>
        <form id="commission-form" class="commission-form">
          <p class="sub">Quem fecha a venda (vendedor ou gerente) recebe pela faixa do valor do site:</p>
          ${pct.tiers.map((t, i) => `
            <div class="form-row tier">
              ${t.upTo == null
                ? `<label>Acima de<input value="${brl(pct.tiers[i - 1]?.upTo ?? 0)}" disabled></label>`
                : `<label>Sites até (R$)<input name="upTo" type="number" min="1" step="1" value="${t.upTo}" required></label>`}
              <label>Comissão (%)<input name="pct" type="number" min="0" max="100" step="0.1" value="${t.pct}" required></label>
            </div>`).join('')}
          <label>Gerente comercial (% do valor das vendas dos vendedores, sai da parte da Barbosa Dev)<input name="gerente" type="number" min="0" max="100" step="0.1" value="${pct.gerente}" required></label>
          <p class="sub">Exemplo numa venda de R$ 500 feita por vendedor: vendedor ${sellerPct(500)}% · gerente ${pct.gerente}% · Barbosa Dev ${100 - sellerPct(500) - pct.gerente}%.</p>
          <button class="btn primary" type="submit">Salvar comissões</button>
        </form>
      </section>
      ${goalsForm()}
    </div>

    <div class="grid-2">
      ${usersCard()}
      <section class="card"><div class="section-head"><h2>Funil geral</h2></div>${funnel(team.byStatus)}</section>
    </div>`;
}

const IMPORT_STATUS = { novo: ['green', 'Novo'], duplicado: ['yellow', 'Já enviado antes'], sem_nome: ['', 'Sem nome'] };

function importCard() {
  const p = state.importPreview;
  const gerentes = state.users.filter(u => u.role === 'gerente' && u.active);
  const vendedores = state.users.filter(u => u.role === 'vendedor' && u.active);
  const imports = state.stats.imports;
  return `<section class="card" id="import">
    <div class="section-head">
      <h2>Enviar lista de contatos</h2>
      <a href="/api/template.xlsx">Baixar planilha modelo</a>
    </div>
    ${!p ? `
      <label class="dropzone">
        <input type="file" id="import-file" accept=".xlsx,.xls,.csv">
        <strong>Escolher planilha do Excel</strong>
        <span class="sub">.xlsx, .xls ou .csv — modelo da Barbosa Dev ou exportação do extrator do Google Maps</span>
      </label>` : `
      <form id="import-form" class="import-bar">
        <div><strong>${esc(p.file)}</strong>
          <div class="sub"><span class="badge green">${p.added} novos</span> ${p.skipped ? `<span class="badge">${p.skipped} serão ignorados</span>` : ''}</div></div>
        <label>Enviar para
          <select name="assignTo" required>
            <option value="">Escolha…</option>
            ${gerentes.length ? `<optgroup label="Gerente comercial">${gerentes.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</optgroup>` : ''}
            ${vendedores.length ? `<optgroup label="Vendedor">${vendedores.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</optgroup>` : ''}
            ${vendedores.length > 1 ? `<option value="distribuir">Dividir entre todos os vendedores</option>` : ''}
          </select>
        </label>
        <div class="import-actions">
          <button type="button" class="btn" id="import-cancel">Cancelar</button>
          <button class="btn primary" ${p.added ? '' : 'disabled'}>Enviar ${p.added} contatos</button>
        </div>
      </form>
      <div class="table-wrap preview">
        <table>
          <thead><tr><th>Nome</th><th>Nicho</th><th>Cidade</th><th>Número</th><th>Site</th><th>Google Maps</th><th>Situação</th></tr></thead>
          <tbody>${p.items.map(i => `<tr>
            <td class="name">${esc(i.name) || '—'}</td><td>${esc(i.niche)}</td><td>${esc(i.city)}</td><td>${esc(i.phone) || '<span class="sub">sem número</span>'}</td>
            <td>${i.site ? `<a href="${esc(url(i.site))}" target="_blank" rel="noopener">${esc(i.site)}</a>` : ''}</td>
            <td>${i.maps ? `<a href="${esc(url(i.maps))}" target="_blank" rel="noopener">Abrir</a>` : ''}</td>
            <td><span class="badge ${IMPORT_STATUS[i.status][0]}">${IMPORT_STATUS[i.status][1]}</span></td></tr>`).join('')}</tbody>
        </table>
      </div>`}
    ${imports.length ? `<h3 class="mini">Listas enviadas</h3><div class="list">${imports.map(i => `
      <div class="list-item"><span>${esc(i.file)} <span class="sub">· para ${esc(i.assignToName || userName(i.assignTo))} · ${fmtDateTime(i.at)}</span></span>
      <span><span class="badge green">+${i.added}</span> ${i.skipped ? `<span class="badge">${i.skipped} ignorados</span>` : ''}
        <span class="badge">${i.remaining} na lista · ${i.worked} trabalhados</span>
        <button type="button" class="btn sm danger" data-del-import="${i.id}">Apagar lista</button></span></div>`).join('')}</div>` : ''}
    ${state.stats.hiddenDuplicates ? `<p class="sub">${state.stats.hiddenDuplicates} contato(s) repetido(s) de planilhas anteriores estão ocultos da lista da equipe.</p>` : ''}
  </section>`;
}

function sellersTable(perUser) {
  const rows = perUser.filter(p => p.user.active);
  if (!rows.length) return '<p class="empty">Nenhum vendedor cadastrado.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Nome</th><th class="num">Contatos</th><th class="num">A prospectar</th><th class="num">Mensagens</th><th class="num">Respondidos+</th><th class="num">Reuniões</th><th class="num">Vendas</th><th class="num">Total vendido</th><th class="num">Comissão</th><th>Meta hoje</th><th>Meta msgs (mês)</th><th>Meta vendas (mês)</th></tr></thead>
    <tbody>${rows.map(p => {
      const engaged = p.contacts - p.byStatus.novo;
      return `<tr>
        <td><span class="name">${esc(p.user.name)}</span> <span class="badge">${ROLE_LABEL[p.user.role]}</span></td>
        <td class="num">${p.contacts}</td><td class="num">${p.pending}</td><td class="num">${p.messaged}</td>
        <td class="num">${engaged}</td><td class="num">${p.meetings}</td><td class="num">${p.salesCount}</td>
        <td class="num">${brl(p.salesTotal)}</td><td class="num">${brl(p.commission)}</td>
        <td>${goalCell(p.goal.messagesToday, p.goal.targets?.dailyMessages)}</td>
        <td>${goalCell(p.goal.monthMessages, p.goal.targets?.monthlyMessages)}</td>
        <td>${goalCell(p.goal.monthSales, p.goal.targets?.monthlySales)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

// ---------- Metas ----------
const pctOf = (v, t) => t ? Math.min(100, Math.round(v / t * 100)) : 0;
const monthName = m => new Date(m + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

function goalCell(value, target) {
  if (!target) return '<span class="sub">—</span>';
  const p = pctOf(value, target);
  return `<div class="goal-cell"><span>${value}/${target}</span><div class="funnel-bar ${p >= 100 ? 'hit' : ''}"><i style="width:${p}%"></i></div></div>`;
}

function goalMeter(label, value, target) {
  const p = pctOf(value, target);
  return `<div class="meter">
    <div class="meter-top"><span>${label}</span><strong>${value} <span class="sub">/ ${target}</span></strong></div>
    <div class="funnel-bar ${p >= 100 ? 'hit' : ''}"><i style="width:${p}%"></i></div>
    <small class="sub">${p >= 100 ? 'Meta batida! ✅' : `${p}% · faltam ${target - value}`}</small>
  </div>`;
}

function goalsCard(p, title) {
  const g = p.goal;
  if (!g?.targets) return '';
  return `<section class="card">
    <div class="section-head"><h2>${title}</h2><span class="sub">${monthName(g.month)}</span></div>
    <div class="meters">
      ${goalMeter('Mensagens hoje', g.messagesToday, g.targets.dailyMessages)}
      ${goalMeter('Mensagens no mês', g.monthMessages, g.targets.monthlyMessages)}
      ${goalMeter('Vendas no mês', g.monthSales, g.targets.monthlySales)}
    </div>
  </section>`;
}

function goalsForm() {
  const goals = state.settings.goals;
  const row = (role, label) => `
    <h3 class="mini">${label}</h3>
    <div class="form-row">
      <label>Mensagens por dia<input name="${role}.dailyMessages" type="number" min="0" step="1" value="${goals[role].dailyMessages}" required></label>
      <label>Mensagens no mês<input name="${role}.monthlyMessages" type="number" min="0" step="1" value="${goals[role].monthlyMessages}" required></label>
      <label>Vendas no mês<input name="${role}.monthlySales" type="number" min="0" step="1" value="${goals[role].monthlySales}" required></label>
    </div>`;
  return `<section class="card">
    <div class="section-head"><h2>Metas</h2><span class="sub">aparecem no painel de cada um</span></div>
    <form id="goals-form" class="commission-form">
      ${row('gerente', 'Gerente comercial')}
      ${row('vendedor', 'Vendedor')}
      <button class="btn primary" type="submit">Salvar metas</button>
    </form>
  </section>`;
}

function meetingsCard(meetings) {
  const upcoming = meetings.filter(c => c.status === 'reuniao');
  return `<section class="card">
    <div class="section-head"><h2>Reuniões marcadas</h2><span class="sub">${upcoming.length} em aberto</span></div>
    ${upcoming.length ? `<div class="list">${upcoming.map(c => `
      <div class="list-item"><span><span class="name">${esc(c.name)}</span> <span class="sub">· ${esc(c.niche)}${state.user.role !== 'vendedor' ? ' · ' + esc(userName(c.assignedTo)) : ''}</span></span>
      <span>${c.meetingDate ? `<span class="badge yellow">${fmtDateTime(c.meetingDate)}</span>` : '<span class="sub">sem data</span>'}
      <button class="btn sm" data-edit="${c.id}">Abrir</button></span></div>`).join('')}</div>`
      : '<p class="empty">Nenhuma reunião marcada.</p>'}
  </section>`;
}

function funnel(byStatus) {
  const max = Math.max(1, ...Object.values(byStatus));
  return `<div class="funnel">${state.statuses.map(s => `
    <div class="funnel-row"><span>${s.label}</span><div class="funnel-bar"><i style="width:${(byStatus[s.id] || 0) / max * 100}%"></i></div><strong class="num">${byStatus[s.id] || 0}</strong></div>`).join('')}</div>`;
}

function usersCard() {
  return `<section class="card">
    <div class="section-head"><h2>Usuários</h2><button class="btn sm" id="btn-add-user">+ Novo usuário</button></div>
    <div class="list">${state.users.map(u => `
      <div class="list-item"><span><span class="name">${esc(u.name)}</span> <span class="sub">· ${esc(u.username)} · ${ROLE_LABEL[u.role]}</span> ${u.active ? '' : '<span class="badge">inativo</span>'}</span>
      <button class="btn sm" data-user="${u.id}">Editar</button></div>`).join('')}</div>
  </section>`;
}

// ---------- Lista de contatos ----------
function filteredContacts() {
  const q = state.search.trim().toLowerCase();
  return state.contacts.filter(c => {
    if (state.tab === 'todos') { /* sem filtro de lista */ }
    else if (state.tab === 'mensagem') { if (c.messaged) return false; }
    else if (c.status !== state.tab) return false;
    if (state.vendorFilter && c.assignedTo !== state.vendorFilter) return false;
    if (q && ![c.name, c.niche, c.phone, c.site, c.city, c.address].some(v => String(v).toLowerCase().includes(q))) return false;
    return true;
  });
}

function contactsSection(isLead) {
  const base = state.vendorFilter ? state.contacts.filter(c => c.assignedTo === state.vendorFilter) : state.contacts;
  const count = id => base.filter(c => c.status === id).length;
  const tabs = [
    ...state.statuses.map(s => ({ id: s.id, label: s.id === 'novo' ? 'Próximos contatos' : s.label, n: count(s.id) })),
    { id: 'todos', label: 'Todos', n: base.length },
  ];
  const list = filteredContacts();
  const people = state.users.filter(u => u.role !== 'ceo');

  return `<section class="card" id="contacts">
    <div class="section-head">
      <h2>${isLead ? 'Contatos' : 'Minha lista de prospecção'}</h2>
      <button class="btn sm" id="btn-new-contact">+ Adicionar contato</button>
    </div>
    <div class="tabs">${tabs.map(t => `<button class="tab ${state.tab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}<b>${t.n}</b></button>`).join('')}</div>
    <div class="toolbar">
      <input id="search" placeholder="Buscar por nome, nicho, número…" value="${esc(state.search)}">
      ${isLead ? `<select id="vendor-filter"><option value="">Todos os vendedores</option>${people.map(u => `<option value="${u.id}" ${state.vendorFilter === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th title="Mensagem enviada">Msg</th><th>Nome</th><th>Nicho</th><th>Número</th><th>Links</th>
        ${isLead ? '<th>Vendedor</th>' : ''}<th>Lista</th><th>Venda</th><th></th>
      </tr></thead>
      <tbody>${list.length ? list.map(c => contactRow(c, isLead)).join('') : `<tr><td colspan="9" class="empty">Nenhum contato nesta lista.</td></tr>`}</tbody>
    </table></div>
  </section>`;
}

function contactRow(c, isLead) {
  const wa = waLink(c.phone);
  return `<tr class="${c.messaged ? 'done' : ''}" data-id="${c.id}">
    <td><input type="checkbox" data-msg ${c.messaged ? 'checked' : ''} title="Marcar mensagem enviada"></td>
    <td><span class="name">${esc(c.name)}</span>${c.notes ? `<div class="sub">${esc(c.notes.slice(0, 60))}</div>` : ''}</td>
    <td>${esc(c.niche)}${c.city ? `<div class="sub">${esc(c.city)}</div>` : ''}</td>
    <td class="phone">${c.phone ? `${esc(c.phone)}${wa ? `<br><a href="${wa}" target="_blank" rel="noopener" title="Abrir no WhatsApp">WhatsApp</a>` : ''}` : ''}</td>
    <td><div class="links">
      ${c.site ? `<a href="${esc(url(c.site))}" target="_blank" rel="noopener">Site</a>` : ''}
      ${c.maps ? `<a href="${esc(url(c.maps))}" target="_blank" rel="noopener">Maps</a>` : ''}
    </div></td>
    ${isLead ? `<td>${esc(userName(c.assignedTo))}</td>` : ''}
    <td><select data-status>${state.statuses.map(s => `<option value="${s.id}" ${c.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
      ${c.status === 'reuniao' && c.meetingDate ? `<div class="sub">${fmtDateTime(c.meetingDate)}</div>` : ''}</td>
    <td>${c.sold ? `<span class="badge green">${brl(c.saleValue)}</span>` : `<button class="btn sm success" data-sale>Vendeu</button>`}</td>
    <td><button class="btn sm ghost" data-edit="${c.id}">Detalhes</button></td>
  </tr>`;
}

function bindContactTable() {
  const main = $('#main');
  main.onclick = async e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; return render(); }
    const edit = e.target.closest('[data-edit]');
    if (edit) return openContactModal(state.contacts.find(c => c.id === edit.dataset.edit));
    if (e.target.closest('[data-sale]')) return openSaleModal(rowContact(e.target));
    if (e.target.id === 'btn-new-contact') return openContactModal(null);
    if (e.target.id === 'btn-add-user') return openUserModal(null);
    const u = e.target.closest('[data-user]');
    if (u) return openUserModal(state.users.find(x => x.id === u.dataset.user));
  };
  main.onchange = async e => {
    if (e.target.matches('[data-msg]')) {
      await updateContact(rowContact(e.target).id, { messaged: e.target.checked });
      toast(e.target.checked ? 'Mensagem marcada como enviada' : 'Marcação removida');
    } else if (e.target.matches('[data-status]')) {
      const c = rowContact(e.target);
      const status = e.target.value;
      if (status === 'cliente' && !c.sold) { e.target.value = c.status; return openSaleModal(c); }
      if (status === 'reuniao') return openMeetingModal(c);
      await updateContact(c.id, { status });
      toast(`Movido para "${statusLabel(status)}"`);
    } else if (e.target.id === 'vendor-filter') {
      state.vendorFilter = e.target.value;
      render();
    }
  };
  const search = $('#search');
  if (search) search.oninput = e => {
    state.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = $('#search');
    s.focus();
    s.setSelectionRange(pos, pos);
  };
}

const rowContact = el => state.contacts.find(c => c.id === el.closest('tr').dataset.id);

async function updateContact(id, body) {
  try {
    await api(`/contacts/${id}`, { method: 'PATCH', body });
    await refresh();
  } catch (err) { toast(err.message); }
}

// ---------- CEO ----------
function bindCeo() {
  $('#commission-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const limits = f.getAll('upTo');
    const tiers = f.getAll('pct').map((p, i) => ({ upTo: limits[i] ?? null, pct: p }));
    try {
      await api('/settings/commission', { method: 'PUT', body: { tiers, gerente: f.get('gerente') } });
      toast('Comissões atualizadas');
      refresh();
    } catch (err) { toast(err.message); }
  };
  $('#goals-form').onsubmit = async e => {
    e.preventDefault();
    const body = { gerente: {}, vendedor: {} };
    for (const [k, v] of new FormData(e.target)) {
      const [role, field] = k.split('.');
      body[role][field] = Number(v);
    }
    try {
      await api('/settings/goals', { method: 'PUT', body });
      toast('Metas atualizadas');
      refresh();
    } catch (err) { toast(err.message); }
  };
  // Passo 1: lê a planilha e mostra a prévia. Passo 2: escolhe o destino e envia.
  const fileInput = $('#import-file');
  if (fileInput) fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      state.importPreview = await api('/import?dryRun=1', { method: 'POST', body });
      state.importFile = file;
      render();
    } catch (err) {
      toast(err.message);
      fileInput.value = '';
    }
  };
  document.querySelectorAll('[data-del-import]').forEach(btn => btn.onclick = async () => {
    const imp = state.stats.imports.find(i => i.id === btn.dataset.delImport);
    const toDelete = imp.remaining - imp.sold;
    let msg = `Apagar a lista "${imp.file}"?\n\n${toDelete} contato(s) vão sumir do painel de ${imp.assignToName || userName(imp.assignTo)}`;
    if (imp.worked) msg += `, inclusive os que já estão em respondidos, follow up, reunião etc.`;
    if (imp.sold) msg += `\n\n${imp.sold} contato(s) vendido(s) serão mantidos para não perder as vendas e comissões.`;
    if (!confirm(msg + '\n\nIsso não pode ser desfeito.')) return;
    btn.disabled = true;
    try {
      const r = await api(`/imports/${imp.id}`, { method: 'DELETE' });
      toast(`Lista apagada: ${r.removed} contato(s) removido(s)` + (r.keptSold ? `, ${r.keptSold} vendido(s) mantido(s)` : ''));
      refresh();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
  const cancel = $('#import-cancel');
  if (cancel) cancel.onclick = () => { state.importPreview = state.importFile = null; render(); };
  const form = $('#import-form');
  if (form) form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button.primary');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    const body = new FormData(form);
    body.append('file', state.importFile);
    try {
      const r = await api('/import', { method: 'POST', body });
      toast(`${r.added} contatos enviados para ${r.assignToName}`);
      state.importPreview = state.importFile = null;
      refresh();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = 'Enviar';
    }
  };
}

// ---------- Modais ----------
function modal(html, onSubmit) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg"><form class="modal">${html}</form></div>`;
  const form = root.querySelector('form');
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.modal-bg').onclick = e => { if (e.target.classList.contains('modal-bg')) close(); };
  form.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      await onSubmit(new FormData(form), e.submitter);
      close();
    } catch (err) { toast(err.message); }
  };
  form.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  return form;
}

function openSaleModal(c) {
  modal(`
    <h3>Venda fechada — ${esc(c.name)}</h3>
    <label>Valor da venda (R$)<input name="value" inputmode="decimal" placeholder="Ex.: 1.500,00" required></label>
    <p class="sub" id="sale-preview">${tierText()}</p>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn success">Registrar venda</button></div>`,
    async f => {
      await api(`/contacts/${c.id}/sale`, { method: 'POST', body: { value: f.get('value') } });
      toast('Venda registrada! 🎉');
      await refresh();
    });
  $('#modal-root [name=value]').oninput = e => {
    const v = parseMoney(e.target.value);
    const p = sellerPct(v);
    $('#sale-preview').textContent = v > 0 ? `Comissão de quem fechou: ${brl(v * p / 100)} (${p}%)` : tierText();
  };
}

function openMeetingModal(c) {
  modal(`
    <h3>Reunião — ${esc(c.name)}</h3>
    <label>Data e hora (opcional)<input name="meetingDate" type="datetime-local" value="${c.meetingDate ? c.meetingDate.slice(0, 16) : ''}"></label>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Marcar reunião</button></div>`,
    async f => {
      await api(`/contacts/${c.id}`, { method: 'PATCH', body: { status: 'reuniao', meetingDate: f.get('meetingDate') } });
      toast('Reunião marcada');
      await refresh();
    });
  // Cancelar devolve o select ao valor anterior.
  $('#modal-root [data-close]').addEventListener('click', render);
}

function openContactModal(c) {
  const isLead = state.user.role !== 'vendedor';
  const people = state.users.filter(u => u.role !== 'ceo' && u.active);
  const v = c || { name: '', niche: '', phone: '', site: '', maps: '', address: '', city: '', notes: '', assignedTo: state.user.id };
  modal(`
    <h3>${c ? esc(c.name) : 'Novo contato'}</h3>
    <label>Nome<input name="name" value="${esc(v.name)}" required></label>
    <div class="form-row">
      <label>Nicho<input name="niche" value="${esc(v.niche)}"></label>
      <label>Número<input name="phone" value="${esc(v.phone)}"></label>
    </div>
    <label>Site<input name="site" value="${esc(v.site)}"></label>
    <label>Link do Google Maps<input name="maps" value="${esc(v.maps)}"></label>
    <div class="form-row">
      <label>Endereço<input name="address" value="${esc(v.address || '')}"></label>
      <label>Cidade<input name="city" value="${esc(v.city || '')}"></label>
    </div>
    ${c && c.status === 'reuniao' ? `<label>Data da reunião<input name="meetingDate" type="datetime-local" value="${c.meetingDate ? c.meetingDate.slice(0, 16) : ''}"></label>` : ''}
    ${isLead ? `<label>Vendedor responsável<select name="assignedTo">${people.map(u => `<option value="${u.id}" ${v.assignedTo === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : ''}
    <label>Observações<textarea name="notes" rows="3">${esc(v.notes)}</textarea></label>
    ${c?.sold ? `<p class="sub">Venda de ${brl(c.saleValue)} em ${fmtDate(c.soldAt)}</p>` : ''}
    <div class="modal-actions">
      ${c && isLead ? `<button type="submit" class="btn danger" value="delete" formnovalidate>Excluir</button>` : ''}
      ${c?.sold && isLead ? `<button type="submit" class="btn" value="unsale" formnovalidate>Desfazer venda</button>` : ''}
      <button type="button" class="btn" data-close>Cancelar</button>
      <button class="btn primary" value="save">Salvar</button>
    </div>`,
    async (f, submitter) => {
      const action = submitter?.value || 'save';
      if (action === 'delete') {
        if (!confirm(`Excluir "${c.name}"?`)) throw new Error('Exclusão cancelada');
        await api(`/contacts/${c.id}`, { method: 'DELETE' });
        toast('Contato excluído');
      } else if (action === 'unsale') {
        await api(`/contacts/${c.id}/sale`, { method: 'DELETE' });
        toast('Venda desfeita');
      } else {
        const body = Object.fromEntries(f.entries());
        if (c) await api(`/contacts/${c.id}`, { method: 'PATCH', body });
        else await api('/contacts', { method: 'POST', body });
        toast('Contato salvo');
      }
      await refresh();
    });
}

function openUserModal(u) {
  modal(`
    <h3>${u ? `Editar ${esc(u.name)}` : 'Novo usuário'}</h3>
    ${u ? '' : `<label>Usuário (login)<input name="username" required></label>`}
    <label>Nome<input name="name" value="${esc(u?.name || '')}" required></label>
    ${u ? '' : `<label>Perfil<select name="role"><option value="vendedor">Vendedor</option><option value="gerente">Gerente Comercial</option></select></label>`}
    <label>${u ? 'Nova senha (deixe em branco para manter)' : 'Senha'}<input name="password" type="password" minlength="6" ${u ? '' : 'required'}></label>
    ${u && u.role !== 'ceo' ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Ativo</label>` : ''}
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div>`,
    async f => {
      const body = Object.fromEntries(f.entries());
      if (u) {
        if (u.role !== 'ceo') body.active = f.has('active');
        if (!body.password) delete body.password;
        await api(`/users/${u.id}`, { method: 'PATCH', body });
      } else {
        await api('/users', { method: 'POST', body });
      }
      toast('Usuário salvo');
      await refresh();
    });
}

function openPasswordModal() {
  modal(`
    <h3>Trocar minha senha</h3>
    <label>Senha atual<input name="current" type="password" required></label>
    <label>Nova senha<input name="next" type="password" minlength="6" required></label>
    <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Salvar</button></div>`,
    async f => {
      const { token } = await api('/me/password', { method: 'POST', body: { current: f.get('current'), next: f.get('next') } });
      // Os outros aparelhos são desconectados; este continua logado com o token novo.
      state.token = token;
      localStorage.setItem('bd_token', token);
      toast('Senha alterada');
    });
}

// ---------- Início ----------
if (state.token) start();
else $('#login').classList.remove('hidden');
