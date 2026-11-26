// Barbosa Dev — telas do WhatsApp: disparo da primeira mensagem e gestão.
// A conversa continua no WhatsApp da equipe; as listas são movidas à mão no painel.
// Usa as funções globais de app.js: state, api, esc, toast, render, fmtDateTime,
// fmtDate, userName, brl, kpi, periodText, $.

const WA_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WA_QUALITY = { GREEN: ['green', 'Alta'], YELLOW: ['yellow', 'Média'], RED: ['red', 'Baixa'], UNKNOWN: ['', 'Desconhecida'] };
const WA_PARAMS = { 'contact.name': 'nome do contato', 'contact.niche': 'nicho', 'contact.city': 'cidade', 'seller.name': 'nome do vendedor' };

// ---------- Carregamento ----------
async function waLoad() {
  const lead = state.user.role !== 'vendedor';
  const q = state.month ? `?month=${state.month}` : '';
  const get = p => api(p).catch(() => null); // WhatsApp fora do ar não pode travar o painel
  const [config, stats, queue, numbers, templates, settings] = await Promise.all([
    get('/wa/config'),
    lead ? get(`/wa/stats${q}`) : null, lead ? get('/wa/queue') : null,
    lead ? get('/wa/numbers') : null, lead ? get('/wa/templates') : null, lead ? get('/wa/settings') : null,
  ]);
  state.wa = { config, stats, queue, numbers: numbers || [], templates: templates || [], settings };
}

async function waReload() { await waLoad(); render(); }

// ---------- Vendedor/gerente: primeira mensagem em quantidade ----------
function waFirstMessageCard() {
  const cfg = state.wa?.config;
  if (!cfg?.myNumber) return '';
  const q = cfg.myQueue;
  const leftToday = Math.max(0, q.dailyCap - q.sentToday - q.pending - q.held);
  const suggestion = Math.max(1, Math.min(q.available, leftToday || q.dailyCap));
  const days = cfg.sendDays.map(d => WA_DAYS[d]).join(', ');
  const warn = !cfg.configured ? 'O WhatsApp ainda não foi configurado no servidor.'
    : cfg.queuePaused ? (cfg.pauseReason || 'Envios pausados pelo CEO.')
    : !cfg.inWindow ? `Fora do horário de envio (${days}, ${cfg.sendHours.start}h às ${cfg.sendHours.end}h): o que você disparar sai no próximo horário.` : '';
  return `<section class="card" id="wa-first">
    <div class="section-head"><h2>Enviar primeira mensagem pelo WhatsApp</h2><span class="sub">Número ${esc(cfg.myNumber.displayPhone || cfg.myNumber.phoneNumberId)}</span></div>
    ${warn ? `<p class="sub wa-warn">${esc(warn)}</p>` : ''}
    <div class="kpis inner">
      ${kpi('Enviadas hoje', `${q.sentToday} / ${q.dailyCap}`, 'teto do dia')}
      ${kpi('Aguardando disparo', q.held, q.held ? 'aperte "Disparar mensagens"' : 'nada esperando')}
      ${kpi('Saindo', q.pending, q.pending ? 'um de cada vez' : 'nada saindo')}
      ${kpi('Disponíveis', q.available, 'em "A prospectar", nunca receberam')}
      ${q.failed ? kpi('Falharam', q.failed, 'o gerente pode reenviar') : ''}
    </div>
    <form class="wa-form wa-first-form" data-wa-form="first">
      <input type="hidden" name="userId" value="${state.user.id}">
      <label>Mensagem (template)<select name="templateId" required>${cfg.templates.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('') || '<option value="">Nenhum template cadastrado</option>'}</select></label>
      <label>Quantas pessoas<input name="limit" type="number" min="1" max="${Math.max(1, q.available)}" value="${suggestion}" required></label>
      <button class="btn" ${cfg.templates.length && q.available ? '' : 'disabled'}>Colocar na fila</button>
    </form>
    <p class="sub">"Colocar na fila" separa os próximos contatos de "A prospectar", mas nada é enviado até você apertar <b>Disparar mensagens</b>.
      Aí sai uma a cada ${cfg.minDelaySec}–${cfg.maxDelaySec} s; o que passar do teto de hoje sai no próximo dia de envio.
      Cada contato que recebe passa para "Mensagem enviada"; a conversa continua no WhatsApp e as listas você move aqui no painel.</p>
    ${q.held || q.pending ? `<div class="wa-actions">
      ${q.held ? `<button type="button" class="btn primary" data-wa-release data-label="${q.held} mensagem(ns)">Disparar mensagens (${q.held})</button>` : ''}
      <button type="button" class="btn sm danger" data-wa-cancel data-label="os ${q.held + q.pending} envios que estão na fila">Tirar da fila</button></div>` : ''}
  </section>`;
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
  const heldTotal = q.numbers.reduce((t, n) => t + n.held, 0);
  const status = !q.configured ? ['', 'servidor sem WA_TOKEN'] : q.paused ? ['red', 'pausada'] : q.inWindow ? ['green', 'enviando'] : ['yellow', 'fora do horário de envio'];
  return `<section class="card">
    <div class="section-head"><h2>Fila de disparo</h2><span class="badge ${status[0]}">${status[1]}</span></div>
    ${q.pauseReason ? `<p class="sub wa-warn">${esc(q.pauseReason)}</p>` : ''}
    <div class="list">${q.numbers.map(n => `<div class="list-item"><span><span class="name">${esc(userName(n.userId))}</span>
      <span class="sub">· enviadas hoje ${n.sentToday} de ${n.dailyCap}${n.held ? ` · aguardando disparo ${n.held}` : ''}${n.pending ? ` · saindo ${n.pending}` : ''}${n.failed ? ` · ${n.failed} falha(s)` : ''}</span></span>
      <span class="row-actions">${goalMeterSmall(n.sentToday, n.dailyCap)}
      ${n.held ? `<button type="button" class="btn sm primary" data-wa-release data-user="${n.userId}" data-label="${n.held} mensagem(ns) de ${esc(userName(n.userId))}">Disparar</button>` : ''}
      ${n.held + n.pending ? `<button type="button" class="btn sm danger" data-wa-cancel data-user="${n.userId}" data-label="os ${n.held + n.pending} envios na fila de ${esc(userName(n.userId))}">Tirar da fila</button>` : ''}</span></div>`).join('') || '<p class="empty">Cadastre um número para começar.</p>'}</div>
    ${q.dispatches.length ? `<h3 class="mini">Disparos recentes</h3><div class="list">${q.dispatches.map(d => `
      <div class="list-item"><span><span class="name">${esc(d.templateName)}</span>
        <span class="sub">· ${d.userId === 'all' ? 'todos os números' : esc(userName(d.userId))} · ${fmtDateTime(d.createdAt)} · ${d.added} contato(s): ${d.sent} enviado(s)${d.held ? `, ${d.held} aguardando disparo` : ''}${d.pending ? `, ${d.pending} saindo` : ''}${d.cancelled ? `, ${d.cancelled} tirado(s)` : ''}</span></span>
        <span class="row-actions">${d.held ? `<button type="button" class="btn sm primary" data-wa-release data-dispatch="${d.id}" data-label="${d.held} mensagem(ns) desse disparo">Disparar mensagens</button>` : ''}
        ${d.held + d.pending ? `<button type="button" class="btn sm danger" data-wa-cancel data-dispatch="${d.id}" data-label="os ${d.held + d.pending} envios que ainda estão na fila desse disparo">Tirar da fila</button>`
          : `<button type="button" class="btn sm" data-wa-del-dispatch="${d.id}">Apagar</button>`}</span></div>`).join('')}</div>` : ''}
    <form class="wa-form" data-wa-form="dispatch">
      <h3 class="mini">Novo disparo (contatos "A prospectar" que ainda não receberam template)</h3>
      <p class="sub">Fica aguardando na fila até alguém apertar "Disparar mensagens".</p>
      <div class="form-row">
        <label>Template<select name="templateId" required>${active.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('') || '<option value="">Cadastre um template</option>'}</select></label>
        <label>De quem<select name="userId"><option value="all">Todos os números</option>${owners.map(n => `<option value="${n.userId}">${esc(userName(n.userId))}</option>`).join('')}</select></label>
        <label>Quantidade (por número)<input name="limit" type="number" min="1" max="2000" value="${owners[0]?.dailyCap || 40}" required></label>
      </div>
      <button class="btn primary" ${active.length && owners.length ? '' : 'disabled'}>Colocar na fila</button>
    </form>
    <div class="wa-actions">
      ${heldTotal ? `<button type="button" class="btn sm primary" data-wa-release data-label="todas as ${heldTotal} mensagens aguardando">Disparar tudo (${heldTotal})</button>` : ''}
      ${isCeo ? `<button type="button" class="btn sm" data-wa-pause="${q.paused ? 'false' : 'true'}">${q.paused ? 'Retomar fila' : 'Pausar fila'}</button>` : ''}
      <button type="button" class="btn sm" data-wa-retry ${q.failed.length ? '' : 'disabled'}>Reenviar falhas (${q.failed.length})</button>
      <button type="button" class="btn sm danger" data-wa-cancel data-label="todos os envios que ainda estão na fila">Tirar tudo da fila</button>
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
      <div class="sub">${t.params.length ? `Variáveis: ${t.params.map((p, i) => {
        const [name, source] = p.includes('=') ? p.split('=') : [String(i + 1), p];
        return `{{${esc(name)}}} = ${esc(WA_PARAMS[source] || source)}`;
      }).join(', ')}` : 'Sem variáveis'}</div></span>
      <button type="button" class="btn sm ${t.active ? 'danger' : ''}" data-wa-tpl-active="${t.id}" data-active="${!t.active}">${t.active ? 'Desativar' : 'Ativar'}</button></div>`).join('') || '<p class="empty">Nenhum template cadastrado.</p>'}</div>
    <form class="wa-form" data-wa-form="template">
      <h3 class="mini">Cadastrar template (o mesmo nome aprovado na Meta)</h3>
      <div class="form-row">
        <label>Nome<input name="name" placeholder="primeiro_contato" pattern="[a-z0-9_]+" required></label>
        <label>Categoria<select name="category"><option value="MARKETING">Marketing</option><option value="UTILITY">Utilidade</option></select></label>
        <label>Idioma<input name="language" value="pt_BR" required></label>
      </div>
      <label>Variáveis<input name="params" value="nome=contact.name, vendedor=seller.name"></label>
      <p class="sub">Template com variáveis nomeadas ({{nome}}, {{vendedor}}): escreva <b>nome_da_variável=valor</b>, ex.: <code>nome=contact.name, vendedor=seller.name</code>.
        Template numerado ({{1}}, {{2}}): só os valores, na ordem, ex.: <code>contact.name, seller.name</code>. Sem variáveis: deixe vazio.<br>
        Valores: contact.name (nome do contato), contact.niche (nicho), contact.city (cidade), seller.name (primeiro nome do vendedor).</p>
      <label>Texto do template (só para o histórico)<textarea name="body" rows="3" placeholder="Olá, {{nome}}! Tudo bem? …"></textarea></label>
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
  const el = e.target.closest('[data-wa-quality], [data-wa-retry], [data-wa-release], [data-wa-del-dispatch], [data-wa-cancel], [data-wa-pause], [data-wa-cap], [data-wa-num-active], [data-wa-tpl-active]');
  if (!el) return;
  try {
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
    if (el.dataset.waDelDispatch) {
      if (!confirm('Apagar esse disparo do histórico? As mensagens que já saíram continuam nos contatos e no relatório.')) return;
      el.disabled = true;
      await api(`/wa/dispatches/${el.dataset.waDelDispatch}`, { method: 'DELETE' });
      toast('Disparo apagado do histórico');
      return waReload();
    }
    if (el.matches('[data-wa-release]')) {
      const { dispatch, user, label } = el.dataset;
      if (!confirm(`Disparar ${label}? Elas começam a sair agora, uma de cada vez, respeitando o intervalo, o teto do dia e o horário de envio.`)) return;
      el.disabled = true;
      const r = await api('/wa/queue/release', { method: 'POST', body: { dispatchId: dispatch, userId: user } });
      toast(`${r.released} mensagem(ns) disparada(s)`);
      return refresh();
    }
    if (el.matches('[data-wa-cancel]')) {
      const { dispatch, user, label } = el.dataset;
      if (!confirm(`Tirar da fila ${label || 'todos os envios que ainda estão na fila'}? Os contatos voltam a ficar disponíveis para um novo disparo.`)) return;
      el.disabled = true;
      const r = await api('/wa/queue/cancel', { method: 'POST', body: { dispatchId: dispatch, userId: user } });
      toast(`${r.cancelled} envio(s) tirados da fila`);
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

document.addEventListener('submit', async e => {
  const form = e.target;
  const kind = form.dataset.waForm;
  if (!kind) return;
  e.preventDefault();
  const f = new FormData(form);
  const btn = form.querySelector('button.primary');
  if (btn) btn.disabled = true;
  try {
    if (kind === 'first' || kind === 'dispatch') {
      const r = await api('/wa/dispatches', { method: 'POST', body: { templateId: f.get('templateId'), userId: f.get('userId') || undefined, limit: Number(f.get('limit')) } });
      toast(`${r.added} pessoa(s) na fila, aguardando "Disparar mensagens"`);
      await refresh();
      return;
    } else if (kind === 'number') {
      await api('/wa/numbers', { method: 'POST', body: { phoneNumberId: f.get('phoneNumberId'), displayPhone: f.get('displayPhone'), userId: f.get('userId'), dailyCap: Number(f.get('dailyCap')) } });
      toast('Número cadastrado');
    } else if (kind === 'template') {
      await api('/wa/templates', { method: 'POST', body: { name: f.get('name'), category: f.get('category'), params: f.get('params'), body: f.get('body'), language: f.get('language') } });
      toast('Template cadastrado');
    } else if (kind === 'settings') {
      const allow = f.get('allowWithoutOptIn') === 'on';
      if (allow && !state.wa.settings.allowWithoutOptIn
        && !confirm('Enviar para quem não autorizou viola a política do WhatsApp e pode levar ao bloqueio do número. Continuar?')) { btn.disabled = false; return; }
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
  } catch (err) {
    toast(err.message);
    if (btn) btn.disabled = false;
  }
});
