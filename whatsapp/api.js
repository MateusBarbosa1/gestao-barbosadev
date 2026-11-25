// Cliente da WhatsApp Cloud API (Graph API da Meta).
// Variáveis de ambiente:
//   WA_TOKEN          token permanente de Usuário do Sistema (nunca vai para o navegador)
//   WA_GRAPH_VERSION  versão da Graph API (padrão v23.0)
//   WA_GRAPH_BASE     só para testes: troca https://graph.facebook.com por um servidor falso

class WhatsAppError extends Error {
  constructor(message, { code = null, status = 0, retryable = false, auth = false } = {}) {
    super(message);
    Object.assign(this, { code, status, retryable, auth });
  }
}

// Erros que valem tentar de novo mais tarde (limite de envio, instabilidade).
const RETRYABLE = new Set([4, 80007, 130429, 131000, 131016, 131056, 133004]);
const AUTH = new Set([190, 10, 200]);

const configured = () => !!process.env.WA_TOKEN;
const base = () => `${process.env.WA_GRAPH_BASE || 'https://graph.facebook.com'}/${process.env.WA_GRAPH_VERSION || 'v23.0'}`;

async function graph(path, { method = 'GET', body } = {}) {
  if (!configured()) throw new WhatsAppError('WA_TOKEN não configurado no servidor.', { auth: true });
  let res;
  try {
    res = await fetch(`${base()}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new WhatsAppError(`Sem conexão com a Meta: ${err.message}`, { retryable: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    const code = e.code ?? null;
    const detail = e.error_data?.details ? ` (${e.error_data.details})` : '';
    throw new WhatsAppError(`${e.message || `Meta respondeu ${res.status}`}${detail}`, {
      code, status: res.status,
      retryable: res.status >= 500 || RETRYABLE.has(code),
      auth: res.status === 401 || AUTH.has(code),
    });
  }
  return data;
}

// Template aprovado. params: variáveis do corpo, na ordem. Cada uma é um texto ({{1}}, {{2}}…)
// ou { name, text } para templates com variáveis nomeadas ({{nome}}, {{vendedor}}…).
async function sendTemplate(phoneNumberId, to, template, params = []) {
  const components = params.length
    ? [{
      type: 'body',
      parameters: params.map(p => {
        const { name, text } = typeof p === 'object' && p ? p : { name: null, text: p };
        // NFC garante o acento num caractere só; Array.from corta sem partir acento ou emoji ao meio.
        const value = Array.from(String(text || '-').normalize('NFC')).slice(0, 1000).join('');
        return { type: 'text', ...(name ? { parameter_name: name } : {}), text: value };
      }),
    }]
    : [];
  const data = await graph(`${phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
      template: { name: template.name, language: { code: template.language || 'pt_BR' }, components },
    },
  });
  return data.messages?.[0]?.id;
}

// Nota de qualidade (GREEN, YELLOW, RED ou UNKNOWN) e dados do número.
async function phoneInfo(phoneNumberId) {
  return graph(`${phoneNumberId}?fields=quality_rating,display_phone_number,verified_name`);
}

module.exports = { sendTemplate, phoneInfo, configured, WhatsAppError };
