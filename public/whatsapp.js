// Barbosa Dev — telas do WhatsApp (conversas do vendedor e gestão).
// Usa as funções globais de app.js: state, api, esc, toast, refresh, render, fmtDateTime,
// fmtDate, userName, statusLabel, brl, kpi, $.

const WA_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WA_QUALITY = { GREEN: ['green', 'Alta'], YELLOW: ['yellow', 'Média'], RED: ['red', 'Baixa'], UNKNOWN: ['', 'Desconhecida'] };
const WA_TYPE = { audio: 'áudio', image: 'imagem', video: 'vídeo', document: 'documento', sticker: 'figurinha', location: 'localização', contacts: 'contato', reaction: 'reação' };
const WA_TICKS = { queued: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓', failed: '⚠' };
const WA_PARAMS = { 'contact.name': 'nome do contato', 'contact.niche': 'nicho', 'contact.city': 'cidade', 'seller.name': 'nome do vendedor' };

let waChat = null; // conversa aberta: { contactId, data }

// ---------- Carregamento ----------
async function waLoad() {
  const lead = state.user.role !== 'vendedor';
  const q = state.month ? `?month=${state.month}` : '';
  const get = p => api(p).catch(() => null); // WhatsApp fora do ar não pode travar o painel
  const [config, conversations, stats, queue, numbers, templates, settings] = await Promise.all([
    get('/wa/config'), get('/wa/conversations'),
    lead ? get(`/wa/stats${q}`) : null, lead ? get('/wa/queue') : null,
    lead ? get('/wa/numbers') : null, lead ? get('/wa/templates') : null, lead ? get('/wa/settings') : null,
  ]);
  state.wa = { config, conversations: conversations || [], stats, queue, numbers: numbers || [], templates: templates || [], settings };
}

async function waReload() { await waLoad(); render(); }

// ---------- Vendedor: lista de conversas ----------
function waConversationsCard() {
  const wa = state.wa;
  if (!wa?.config) return '';
  const list = wa.conversations.filter(c => !state.vendorFilter || c.userId === state.vendorFilter);
  const unread = list.reduce((n, c) => n + c.unread, 0);
  const warn = !wa.config.configured ? 'O WhatsApp ainda não foi configurado no servidor.'
    : wa.config.queuePaused ? (wa.config.pauseReason || 'A fila de envio está pausada.')
    : state.user.role !== 'ceo' && !wa.config.myNumber ? 'Você ainda não tem um número de WhatsApp vinculado: peça ao CEO.' : '';
  return `<section class="card" id="wa-conv">
    <div class="section-head"><h2>Conversas do WhatsApp ${unread ? `<span class="badge green">${unread} nova(s)</span>` : ''}</h2>
      <span class="sub">${wa.config.myNumber ? `Meu número: ${esc(wa.config.myNumber.displayPhone)}` : ''}</span></div>
    ${warn ? `<p class="sub wa-warn">${esc(warn)}</p>` : ''}
    ${list.length ? `<div class="wa-conv-list">${list.map(c => `
      <button type="button" class="wa-conv ${c.unread ? 'unread' : ''}" data-wa-chat="${c.contactId}">
        <span class="wa-conv-main"><span class="name">${esc(c.name)}</span>
          <span class="sub">${c.lastDirection === 'out' ? 'Você: ' : ''}${esc(c.lastText)}</span></span>
        <span class="wa-conv-meta"><span class="sub">${fmtDateTime(c.lastMessageAt)}</span>
          <span>${c.optOut ? '<span class="badge">opt-out</span>' : c.windowOpen ? '<span class="badge green">janela aberta</span>' : ''}
          ${state.user.role !== 'vendedor' ? `<span class="badge">${esc(userName(c.userId))}</span>` : ''}
          ${c.unread ? `<b class="wa-unread">${c.unread}</b>` : ''}</span></span>
      </button>`).join('')}</div>` : '<p class="empty">Ninguém respondeu ainda. As respostas aparecem aqui.</p>'}
  </section>`;
}

// ---------- Conversa (histórico, template, texto, status) ----------
async function openChat(contactId) {
  waChat = { contactId, data: null };
  try {
    waChat.data = await api(`/wa/contacts/${contactId}/messages`);
  } catch (err) { waChat = null; return toast(err.message); }
  drawChat(true);
}

function closeChat() { waChat = null; $('#modal-root').innerHTML = ''; }

function chatBody(d) {
  if (!d.messages.length) return '<p class="empty">Nenhuma mensagem ainda.</p>';
  return d.messages.map(m => `
    <div class="bubble ${m.direction}">
      ${m.type === 'template' ? `<div class="bubble-tag">Template ${esc(m.templateName)}</div>` : ''}
      <div>${m.type === 'unsupported' ? `<em>[${esc(WA_TYPE[m.unsupportedType] || m.unsupportedType)} — não é exibido no painel]</em>` : esc(m.text || '').replace(/\n/g, '<br>')}</div>
      <div class="bubble-meta">${fmtDateTime(m.createdAt)} ${m.direction === 'out' ? `<span class="tick ${m.status}" title="${esc(m.error || m.status)}">${WA_TICKS[m.status] || ''}</span>` : ''}</div>
      ${m.error ? `<div class="bubble-error">${esc(m.error)}</div>` : ''}
    </div>`).join('');
}

function drawChat(scroll) {
  const d = waChat.data;
  const c = d.contact;
  const templates = state.wa?.config?.templates || [];
  const canTemplate = !d.blockReason && !d.queued && templates.length;
  const until = d.windowEndsAt ? new Date(d.windowEndsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
  const canText = d.windowOpen && !c.optOut && d.number;
  $('#modal-root').innerHTML = `<div class="modal-bg" data-wa-bg><div class="modal chat-modal">
    <div class="chat-head">
      <div><h3>${esc(c.name)}</h3>
        <div class="sub">${esc(c.phone)} · ${d.number ? `pelo número ${esc(d.number.displayPhone)} (${esc(userName(d.number.userId))})` : 'sem número vinculado'} · origem ${esc(c.origin || '—')}</div></div>
      <button type="button" class="btn sm" data-wa-close>Fechar</button>
    </div>
    <div class="chat-tools">
      <label>Status <select data-wa-status>${state.statuses.map(s => `<option value="${s.id}" ${c.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
      <label class="follow-toggle"><input type="checkbox" data-wa-optin ${c.optIn ? 'checked' : ''} ${c.optOut ? 'disabled' : ''}> Cliente autorizou receber mensagens (opt-in)</label>
    </div>
    <div class="chat-body" id="chat-body">${chatBody(d)}</div>
    <div class="chat-foot">
      <div class="chat-template">
        <select id="wa-template" ${canTemplate ? '' : 'disabled'}>${templates.map(t => `<option value="${t.id}">${esc(t.name)} (${t.category === 'UTILITY' ? 'utilidade' : t.category.toLowerCase()})</option>`).join('') || '<option>Nenhum template cadastrado</option>'}</select>
        <button type="button" class="btn" data-wa-send-template ${canTemplate ? '' : 'disabled'}>Enviar template</button>
      </div>
      <p class="sub">${d.queued ? 'Template na fila de envio.' : d.blockReason ? `Template bloqueado: ${esc(d.blockReason)}.` : 'O template entra na fila do seu número (respeita o intervalo e o teto do dia).'}</p>
      <form class="chat-text" data-wa-text>
        <textarea name="text" rows="2" maxlength="4096" placeholder="${canText ? 'Escreva uma mensagem…' : c.optOut ? 'Contato em opt-out: envio bloqueado.' : !d.number ? 'Sem número de WhatsApp vinculado.' : 'Fora da janela de 24h: só é possível enviar template.'}" ${canText ? '' : 'disabled'}></textarea>
        <button class="btn primary" ${canText ? '' : 'disabled'}>Enviar</button>
      </form>
      <p class="sub">${c.optOut ? 'Este contato pediu para não receber mensagens.' : d.windowOpen ? `Janela de 24h aberta até ${until}: texto livre liberado, sem cobrança de template.` : 'A janela abre quando o cliente responde.'}</p>
    </div>
  </div></div>`;
  if (scroll) { const b = $('#chat-body'); b.scrollTop = b.scrollHeight; }
}

// Atualiza só o histórico (não apaga o que o vendedor está digitando).
async function pollChat() {
  if (!waChat) return;
  const id = waChat.contactId;
  const d = await api(`/wa/contacts/${id}/messages`).catch(() => null);
  if (!d || !waChat || waChat.contactId !== id) return;
  const before = JSON.stringify(waChat.data.messages);
  const windowChanged = d.windowOpen !== waChat.data.windowOpen || d.queued !== waChat.data.queued;
  waChat.data = d;
  if (windowChanged) {
    const draft = $('#modal-root [name=text]')?.value || '';
    drawChat(true);
    const t = $('#modal-root [name=text]');
    if (t && !t.disabled) t.value = draft;
  } else if (JSON.stringify(d.messages) !== before) {
    const b = $('#chat-body');
    const atEnd = b.scrollTop + b.clientHeight >= b.scrollHeight - 30;
    b.innerHTML = chatBody(d);
    if (atEnd) b.scrollTop = b.scrollHeight;
  }
}

// ---------- Gestão ----------
function waManagementCards() {
  const wa = state.wa;
  if (!wa?.stats || !wa.queue) return '';
  const isCeo = state.user.role === 'ceo';
  return `${waStatsCard(wa.stats)}
    <div class="grid-2">${waQueueCard(wa.queue, wa.templates, wa.numbers, isCeo)}${waNumbersCard(wa.numbers, isCeo)}</div>
    ${isCeo ? `<div class="grid-2">${waTemplatesCard(wa.templates)}${waSettingsCard(wa.settings)}</div>` : ''}`;
}

function waStatsCard(s) {
  const sum = f => s.perUser.reduce((n, p) => n + p[f], 0);
  const reached = sum('reached');
  const replied = sum('replied');
  const sales = sum('sales');
  const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '—';
  const users = s.perUser;
  return `<section class="card">
    <div class="section-head"><h2>WhatsApp — resultados</h2><span class="sub">${periodText()}</span></div>
    <div class="kpis inner">
      ${kpi('Templates enviados', sum('sent'), `${sum('delivered')} entregues · ${sum('failed')} falhas`)}
      ${kpi('Taxa de resposta', pct(replied, reached), `${replied} de ${reached} contatados`)}
      ${kpi('Conversão em venda', pct(sales, reached), `${sales} venda(s)`)}
      ${kpi('Custo estimado', brl(s.totalCost), `marketing ${brl(s.costs.MARKETING)} · utilidade ${brl(s.costs.UTILITY)}`, true)}
    </div>
    ${users.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Vendedor</th><th class="num">Enviadas</th><th class="num">Entregues</th><th class="num">Falhas</th><th class="num">Contatados</th><th class="num">Responderam</th><th class="num">Taxa resp.</th><th class="num">Vendas</th><th class="num">Conversão</th><th class="num">Custo</th></tr></thead>
      <tbody>${users.map(p => `<tr><td class="name">${esc(p.name)}</td><td class="num">${p.sent}</td><td class="num">${p.delivered}</td><td class="num">${p.failed}</td>
        <td class="num">${p.reached}</td><td class="num">${p.replied}</td><td class="num">${p.replyRate}%</td><td class="num">${p.sales}</td><td class="num">${p.conversion}%</td><td class="num">${brl(p.cost)}</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty">Nenhum número cadastrado ainda.</p>'}
    ${s.perDay.length ? `<h3 class="mini">Mensagens (templates) por dia</h3><div class="table-wrap"><table>
      <thead><tr><th>Dia</th>${users.map(p => `<th class="num">${esc(p.name)}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${s.perDay.slice(0, 31).map(d => `<tr><td>${fmtDate(d.date + 'T12:00:00Z')}</td>${users.map(p => `<td class="num">${d.byUser[p.userId] || 0}</td>`).join('')}
        <td class="num"><b>${Object.values(d.byUser).reduce((a, b) => a + b, 0)}</b></td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    <p class="sub">Custo = templates entregues × valor por categoria (configurável). Respostas dentro da janela de 24h aberta pelo cliente não são cobradas.</p>
  </section>`;
}

function waQueueCard(q, templates, numbers, isCeo) {
  const active = templates.filter(t => t.active);
  const owners = numbers.filter(n => n.active);
  const status = !q.configured ? ['', 'servidor sem WA_TOKEN'] : q.paused ? ['red', 'pausada'] : q.inWindow ? ['green', 'enviando'] : ['yellow', 'fora do horário de envio'];
  return `<section class="card">
    <div class="section-head"><h2>Fila de disparo</h2><span class="badge ${status[0]}">${status[1]}</span></div>
    ${q.pauseReason ? `<p class="sub wa-warn">${esc(q.pauseReason)}</p>` : ''}
    <div class="list">${q.numbers.map(n => `<div class="list-item"><span><span class="name">${esc(userName(n.userId))}</span>
      <span class="sub">· hoje ${n.sentToday}/${n.dailyCap} · na fila ${n.pending}${n.failed ? ` · ${n.failed} falha(s)` : ''}</span></span>
      ${goalMeterSmall(n.sentToday, n.dailyCap)}</div>`).join('') || '<p class="empty">Cadastre um número para começar.</p>'}</div>
    <form class="wa-form" data-wa-form="dispatch">
      <h3 class="mini">Novo disparo (contatos "A prospectar" que ainda não receberam template)</h3>
      <div class="form-row">
        <label>Template<select name="templateId" required>${active.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('') || '<option value="">Cadastre um template</option>'}</select></label>
        <label>De quem<select name="userId"><option value="all">Todos os números</option>${owners.map(n => `<option value="${n.userId}">${esc(userName(n.userId))}</option>`).join('')}</select></label>
        <label>Quantidade (por número)<input name="limit" type="number" min="1" max="2000" value="${owners[0]?.dailyCap || 40}" required></label>
      </div>
      <button class="btn primary" ${active.length && owners.length ? '' : 'disabled'}>Colocar na fila</button>
    </form>
    <div class="wa-actions">
      ${isCeo ? `<button type="button" class="btn sm" data-wa-pause="${q.paused ? 'false' : 'true'}">${q.paused ? 'Retomar fila' : 'Pausar fila'}</button>` : ''}
      <button type="button" class="btn sm" data-wa-retry ${q.failed.length ? '' : 'disabled'}>Reenviar falhas (${q.failed.length})</button>
      <button type="button" class="btn sm danger" data-wa-cancel>Cancelar pendentes</button>
    </div>
    ${q.failed.length ? `<h3 class="mini">Últimas falhas</h3><div class="list">${q.failed.slice(0, 8).map(f => `
      <div class="list-item"><span><span class="name">${esc(f.name)}</span> <span class="sub">· ${esc(userName(f.userId))} · ${fmtDateTime(f.at)}</span>
        <div class="sub">${esc(f.error || '')}</div></span></div>`).join('')}</div>` : ''}
  </section>`;
}

const goalMeterSmall = (v, max) => `<div class="funnel-bar wa-meter"><i style="width:${Math.min(100, max ? v / max * 100 : 0)}%"></i></div>`;

function waNumbersCard(numbers, isCeo) {
  const people = state.users.filter(u => u.active && u.role !== 'ceo');
  return `<section class="card">
    <div class="section-head"><h2>Números de WhatsApp</h2></div>
    <div class="list">${numbers.map(n => {
      const q = WA_QUALITY[n.qualityRating] || ['', 'não consultada'];
      return `<div class="list-item"><span><span class="name">${esc(n.displayPhone || n.phoneNumberId)}</span>
        <span class="sub">· ${esc(userName(n.userId))} · teto ${n.dailyCap}/dia ${n.active ? '' : '· inativo'}</span>
        <div class="sub">ID ${esc(n.phoneNumberId)} · qualidade <span class="badge ${q[0]}">${q[1]}</span> ${n.qualityCheckedAt ? `em ${fmtDateTime(n.qualityCheckedAt)}` : ''}</div></span>
        <span class="wa-actions"><button type="button" class="btn sm" data-wa-quality="${n.id}">Atualizar nota</button>
        ${isCeo ? `<button type="button" class="btn sm" data-wa-cap="${n.id}">Teto</button>
          <button type="button" class="btn sm ${n.active ? 'danger' : ''}" data-wa-num-active="${n.id}" data-active="${!n.active}">${n.active ? 'Desativar' : 'Ativar'}</button>` : ''}</span></div>`;
    }).join('') || '<p class="empty">Nenhum número cadastrado.</p>'}</div>
    ${isCeo ? `<form class="wa-form" data-wa-form="number">
      <h3 class="mini">Cadastrar número</h3>
      <div class="form-row">
        <label>Phone Number ID<input name="phoneNumberId" inputmode="numeric" placeholder="ex.: 123456789012345" required></label>
        <label>Número (exibição)<input name="displayPhone" placeholder="+55 81 99999-9999"></label>
      </div>
      <div class="form-row">
        <label>Vendedor<select name="userId" required>${people.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label>
        <label>Teto por dia<input name="dailyCap" type="number" min="1" max="10000" value="40" required></label>
      </div>
      <button class="btn primary">Cadastrar</button>
      <p class="sub">O Phone Number ID fica em Meta for Developers → seu app → WhatsApp → Configuração da API.</p>
    </form>` : ''}
  </section>`;
}

function waTemplatesCard(templates) {
  return `<section class="card">
    <div class="section-head"><h2>Templates aprovados</h2></div>
    <div class="list">${templates.map(t => `<div class="list-item"><span><span class="name">${esc(t.name)}</span>
      <span class="sub">· ${t.language} · ${t.category === 'UTILITY' ? 'utilidade' : t.category.toLowerCase()} ${t.active ? '' : '· desativado'}</span>
      <div class="sub">${t.params.length ? `Variáveis: ${t.params.map((p, i) => `{{${i + 1}}} = ${esc(WA_PARAMS[p] || p)}`).join(', ')}` : 'Sem variáveis'}</div></span>
      <button type="button" class="btn sm ${t.active ? 'danger' : ''}" data-wa-tpl-active="${t.id}" data-active="${!t.active}">${t.active ? 'Desativar' : 'Ativar'}</button></div>`).join('') || '<p class="empty">Nenhum template cadastrado.</p>'}</div>
    <form class="wa-form" data-wa-form="template">
      <h3 class="mini">Cadastrar template (o mesmo nome aprovado na Meta)</h3>
      <div class="form-row">
        <label>Nome<input name="name" placeholder="primeiro_contato" pattern="[a-z0-9_]+" required></label>
        <label>Categoria<select name="category"><option value="MARKETING">Marketing</option><option value="UTILITY">Utilidade</option></select></label>
        <label>Idioma<input name="language" value="pt_BR" required></label>
      </div>
      <label>Variáveis, na ordem ({{1}}, {{2}}…)<input name="params" value="contact.name, seller.name"></label>
      <p class="sub">Use: contact.name (nome do contato), contact.niche (nicho), contact.city (cidade), seller.name (nome do vendedor).</p>
      <label>Texto do template (só para o histórico)<textarea name="body" rows="3" placeholder="Olá {{1}}, aqui é {{2}} da Barbosa Dev…"></textarea></label>
      <button class="btn primary">Cadastrar</button>
    </form>
  </section>`;
}

function waSettingsCard(s) {
  if (!s) return '';
  return `<section class="card">
    <div class="section-head"><h2>Configurações do WhatsApp</h2></div>
    <form class="wa-form" data-wa-form="settings">
      <h3 class="mini">Custo por mensagem entregue (R$)</h3>
      <div class="form-row">
        <label>Marketing<input name="MARKETING" type="number" step="0.0001" min="0" value="${s.costs.MARKETING}"></label>
        <label>Utilidade<input name="UTILITY" type="number" step="0.0001" min="0" value="${s.costs.UTILITY}"></label>
        <label>Autenticação<input name="AUTHENTICATION" type="number" step="0.0001" min="0" value="${s.costs.AUTHENTICATION}"></label>
      </div>
      <h3 class="mini">Fila</h3>
      <div class="form-row">
        <label>Intervalo mínimo (s)<input name="minDelaySec" type="number" min="1" value="${s.minDelaySec}"></label>
        <label>Intervalo máximo (s)<input name="maxDelaySec" type="number" min="1" value="${s.maxDelaySec}"></label>
      </div>
      <div class="form-row">
        <label>Começa às (h)<input name="start" type="number" min="0" max="23" value="${s.sendHours.start}"></label>
        <label>Para às (h)<input name="end" type="number" min="1" max="24" value="${s.sendHours.end}"></label>
      </div>
      <div class="wa-days">${WA_DAYS.map((d, i) => `<label class="follow-toggle"><input type="checkbox" name="day" value="${i}" ${s.sendDays.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
      <label>Palavras de opt-out (separe por vírgula)<textarea name="optOutKeywords" rows="2">${esc(s.optOutKeywords.join(', '))}</textarea></label>
      <label class="follow-toggle wa-risk"><input type="checkbox" name="allowWithoutOptIn" ${s.allowWithoutOptIn ? 'checked' : ''}>
        Permitir envio para contatos sem opt-in (ex.: Google Maps). Risco de denúncias, nota de qualidade baixa e bloqueio do número.</label>
      <button class="btn primary">Salvar</button>
    </form>
  </section>`;
}

// ---------- Eventos (delegados: os cards são redesenhados a cada render) ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-wa-chat], [data-wa-close], [data-wa-bg], [data-wa-send-template], [data-wa-quality], [data-wa-retry], [data-wa-cancel], [data-wa-pause], [data-wa-cap], [data-wa-num-active], [data-wa-tpl-active]');
  if (!el) return;
  if (el.matches('[data-wa-bg]') && e.target !== el) return; // clique dentro da janela
  try {
    if (el.dataset.waChat) return await openChat(el.dataset.waChat);
    if (el.matches('[data-wa-close], [data-wa-bg]')) { closeChat(); return waReload(); }
    if (el.matches('[data-wa-send-template]')) {
      el.disabled = true;
      await api(`/wa/contacts/${waChat.contactId}/template`, { method: 'POST', body: { templateId: $('#wa-template').value } });
      toast('Template colocado na fila de envio');
      return pollChat();
    }
    if (el.dataset.waQuality) {
      el.disabled = true;
      const n = await api(`/wa/numbers/${el.dataset.waQuality}/quality`, { method: 'POST' });
      toast(`Qualidade: ${(WA_QUALITY[n.qualityRating] || ['', n.qualityRating])[1]}`);
      return waReload();
    }
    if (el.matches('[data-wa-retry]')) {
      const r = await api('/wa/queue/retry', { method: 'POST', body: {} });
      toast(`${r.retried} envio(s) voltaram para a fila`);
      return waReload();
    }
    if (el.matches('[data-wa-cancel]')) {
      if (!confirm('Cancelar todos os envios que ainda estão na fila?')) return;
      const r = await api('/wa/queue/cancel', { method: 'POST', body: {} });
      toast(`${r.cancelled} envio(s) cancelados`);
      return waReload();
    }
    if (el.dataset.waPause) {
      await api('/wa/settings', { method: 'PUT', body: { queuePaused: el.dataset.waPause === 'true' } });
      return waReload();
    }
    if (el.dataset.waCap) {
      const n = state.wa.numbers.find(x => x.id === el.dataset.waCap);
      const v = prompt(`Teto diário de ${userName(n.userId)}:`, n.dailyCap);
      if (v == null) return;
      await api(`/wa/numbers/${n.id}`, { method: 'PATCH', body: { dailyCap: Number(v) } });
      return waReload();
    }
    if (el.dataset.waNumActive) {
      await api(`/wa/numbers/${el.dataset.waNumActive}`, { method: 'PATCH', body: { active: el.dataset.active === 'true' } });
      return waReload();
    }
    if (el.dataset.waTplActive) {
      await api(`/wa/templates/${el.dataset.waTplActive}`, { method: 'PATCH', body: { active: el.dataset.active === 'true' } });
      return waReload();
    }
  } catch (err) {
    toast(err.message);
    el.disabled = false;
  }
});

document.addEventListener('change', async e => {
  if (!waChat) return;
  const c = waChat.data.contact;
  try {
    if (e.target.matches('[data-wa-status]')) {
      await api(`/contacts/${c.id}`, { method: 'PATCH', body: { status: e.target.value } });
      toast(`Status: ${statusLabel(e.target.value)}`);
    } else if (e.target.matches('[data-wa-optin]')) {
      await api(`/contacts/${c.id}`, { method: 'PATCH', body: { optIn: e.target.checked } });
      toast(e.target.checked ? 'Opt-in registrado' : 'Opt-in removido');
    } else return;
    waChat.data = await api(`/wa/contacts/${c.id}/messages`);
    drawChat(false);
  } catch (err) {
    toast(err.message);
    drawChat(false);
  }
});

document.addEventListener('submit', async e => {
  const form = e.target;
  if (form.matches('[data-wa-text]')) {
    e.preventDefault();
    const btn = form.querySelector('button');
    const text = form.text.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      await api(`/wa/contacts/${waChat.contactId}/text`, { method: 'POST', body: { text } });
      form.text.value = '';
      await pollChat();
    } catch (err) { toast(err.message); }
    btn.disabled = false;
    return;
  }
  const kind = form.dataset.waForm;
  if (!kind) return;
  e.preventDefault();
  const f = new FormData(form);
  try {
    if (kind === 'dispatch') {
      const r = await api('/wa/dispatches', { method: 'POST', body: { templateId: f.get('templateId'), userId: f.get('userId'), limit: Number(f.get('limit')) } });
      const skipped = Object.entries(r.skipped || {}).map(([why, n]) => `${n} ${why}`).join(', ');
      toast(`${r.added} contato(s) na fila${skipped ? ` · fora: ${skipped}` : ''}`);
    } else if (kind === 'number') {
      await api('/wa/numbers', { method: 'POST', body: { phoneNumberId: f.get('phoneNumberId'), displayPhone: f.get('displayPhone'), userId: f.get('userId'), dailyCap: Number(f.get('dailyCap')) } });
      toast('Número cadastrado');
    } else if (kind === 'template') {
      await api('/wa/templates', { method: 'POST', body: { name: f.get('name'), category: f.get('category'), params: f.get('params'), body: f.get('body'), language: f.get('language') } });
      toast('Template cadastrado');
    } else if (kind === 'settings') {
      const allow = f.get('allowWithoutOptIn') === 'on';
      if (allow && !state.wa.settings.allowWithoutOptIn
        && !confirm('Enviar para quem não autorizou viola a política do WhatsApp e pode levar ao bloqueio do número. Continuar?')) return;
      await api('/wa/settings', {
        method: 'PUT', body: {
          costs: { MARKETING: f.get('MARKETING'), UTILITY: f.get('UTILITY'), AUTHENTICATION: f.get('AUTHENTICATION') },
          minDelaySec: Number(f.get('minDelaySec')), maxDelaySec: Number(f.get('maxDelaySec')),
          sendHours: { start: Number(f.get('start')), end: Number(f.get('end')) },
          sendDays: f.getAll('day').map(Number),
          optOutKeywords: String(f.get('optOutKeywords')).split(/[,\n]/),
          allowWithoutOptIn: allow,
        },
      });
      toast('Configurações salvas');
    }
    await waReload();
  } catch (err) { toast(err.message); }
});

// Atualiza conversas (e a conversa aberta) sem redesenhar a página inteira.
setInterval(async () => {
  if (!state.user || document.visibilityState !== 'visible') return;
  if (waChat) return pollChat();
  const list = await api('/wa/conversations').catch(() => null);
  if (!list || !state.wa) return;
  state.wa.conversations = list;
  const card = $('#wa-conv');
  if (card) card.outerHTML = waConversationsCard();
}, 20_000);
