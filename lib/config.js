/* Configuração da Faixa de Opções.
 * Precedência: política (storage.managed, via policies.json → 3rdparty)
 * > preferências do usuário (storage.local) > padrões abaixo.
 *
 * As assinaturas do usuário ficam em chaves próprias do storage.local ("assinaturas" e
 * "assinaturaPadrao"), fora de "usuario": gravar uma opção da faixa não regrava as
 * assinaturas (e vice-versa), e Restaurar os padrões não as apaga.
 * Na configuração efetiva: as da política (assinaturas) vêm antes das do usuário e não
 * podem ser mudadas; os padrões da política ficam em assinaturaPadraoOrg e vencem os do
 * usuário campo a campo (nova, resposta). Ver FaixaSignatures.defaultFor.
 *
 * As Partes Rápidas seguem a mesma ideia: as do usuário na chave "partesRapidas" do
 * storage.local; as da política (chave "partesRapidas") vêm primeiro, marcadas
 * (gerenciada) e sem poder ser mudadas; um id repetido vale o da política. */

export const DEFAULTS = {
  fontePadrao: { familia: "Calibri", tamanhoPt: 11 },
  ocultarBarraThunderbird: true,
  // true: a barra de menus começa oculta (Alt ou F10 mostram os menus); o usuário ou a
  // política podem mostrá-la.
  ocultarBarraMenus: true,
  paragrafoSemEspaco: true,
  perfilAtalhos: "thunderbird-office",
  abaInicial: "mensagem",
  recolhida: false,
  idioma: "auto",
  visualizacaoDinamica: true,
  suporte: null,
  assinaturas: [],
  assinaturaPadrao: {},
  assinaturaPadraoOrg: {},
  partesRapidas: [],
};

/* Chaves do storage.local com as assinaturas do usuário. */
export const SIGNATURE_KEYS = ["assinaturas", "assinaturaPadrao"];

/* Chave do storage.local com as Partes Rápidas do usuário. */
export const QUICK_PARTS_KEY = "partesRapidas";

function isObject(v) {
  return v && typeof v == "object" && !Array.isArray(v);
}

/** Endereço http(s) válido, ou "". */
export function webURL(value) {
  try {
    const u = new URL(String(value || "").trim());
    return u.protocol == "https:" || u.protocol == "http:" ? u.href : "";
  } catch (e) {
    return "";
  }
}

/** Contato do suporte (política "suporte"), já conferido: portal e ajuda só http(s),
 * e-mail com @. null se não sobrar nada. Faixa, página Ajuda e background usam este. */
export function supportConfig(s) {
  if (!isObject(s)) {
    return null;
  }
  const text = v => (typeof v == "string" || typeof v == "number" ? String(v).trim() : "");
  const email = text(s.email);
  const out = {
    nome: text(s.nome),
    email: /^[^\s@<>,;]+@[^\s@<>,;]+$/.test(email) ? email : "",
    telefone: text(s.telefone),
    portal: webURL(s.portal),
    ajuda: webURL(s.ajuda),
  };
  return out.email || out.telefone || out.portal || out.ajuda ? out : null;
}

export function merge(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!isObject(layer)) {
      continue;
    }
    for (const [k, v] of Object.entries(layer)) {
      out[k] = isObject(v) && isObject(out[k]) ? merge(out[k], v) : v;
    }
  }
  return out;
}

/** Itens válidos (assinaturas, Partes Rápidas) de uma lista, com a marca de quem define
 * (gerenciada: política). */
function itemsOf(list, managed) {
  return (Array.isArray(list) ? list : [])
    .filter(s => isObject(s) && typeof s.id == "string" && s.id.trim() && typeof s.html == "string")
    .map(s => Object.assign({}, s, { id: s.id.trim(), nome: String(s.nome || s.id).trim(), gerenciada: managed }));
}

/** As da política primeiro; um id repetido vale o da política. */
function mergeItems(org, own) {
  const ids = new Set();
  const out = [];
  for (const s of [...itemsOf(org, true), ...itemsOf(own, false)]) {
    if (!ids.has(s.id)) {
      ids.add(s.id);
      out.push(s);
    }
  }
  return out;
}

/** Assinaturas da configuração efetiva: as da organização primeiro; um id repetido vale a da organização.
 * own: { assinaturas, assinaturaPadrao } do usuário. */
export function signatureConfig(managed, own) {
  return {
    assinaturas: mergeItems(managed && managed.assinaturas, own && own.assinaturas),
    assinaturaPadrao: isObject(own && own.assinaturaPadrao) ? own.assinaturaPadrao : {},
    assinaturaPadraoOrg: isObject(managed && managed.assinaturaPadrao) ? managed.assinaturaPadrao : {},
  };
}

export async function readManaged() {
  try {
    return (await browser.storage.managed.get(null)) || {};
  } catch (e) {
    // Sem política instalada o Thunderbird rejeita a leitura: não é erro.
    return {};
  }
}

export async function readUser() {
  const { usuario } = await browser.storage.local.get("usuario");
  return usuario || {};
}

/** Assinaturas do usuário: { assinaturas: [], assinaturaPadrao: {} }. */
export async function readSignatures() {
  const got = await browser.storage.local.get(SIGNATURE_KEYS);
  return {
    assinaturas: Array.isArray(got.assinaturas) ? got.assinaturas : [],
    assinaturaPadrao: isObject(got.assinaturaPadrao) ? got.assinaturaPadrao : {},
  };
}

/** Partes Rápidas do usuário: [{ id, nome, html }]. */
export async function readQuickParts() {
  const got = await browser.storage.local.get(QUICK_PARTS_KEY);
  return Array.isArray(got[QUICK_PARTS_KEY]) ? got[QUICK_PARTS_KEY] : [];
}

export function saveQuickParts(list) {
  return browser.storage.local.set({ [QUICK_PARTS_KEY]: list });
}

/** Uma gravação de cada vez numa chave do storage.local, entre o background e as páginas
 * do complemento (a mesma origem): quem lê, muda e grava a lista não apaga o que outro
 * gravou no meio (Salvar Seleção na Galeria com a página Partes Rápidas aberta). */
export function withLock(key, fn) {
  const locks = globalThis.navigator && globalThis.navigator.locks;
  return locks ? locks.request("faixa:" + key, () => fn()) : fn();
}

export async function loadConfig() {
  const [managed, usuario, own, parts] = await Promise.all([readManaged(), readUser(), readSignatures(), readQuickParts()]);
  const config = Object.assign(merge(DEFAULTS, usuario, managed), signatureConfig(managed, own), {
    partesRapidas: mergeItems(managed && managed.partesRapidas, parts),
    suporte: supportConfig(managed && managed.suporte),
    // O que a política define: na faixa, os botões dessas opções ficam travados.
    gerenciadas: Object.keys(isObject(managed) ? managed : {}).sort(),
  });
  own.partesRapidas = parts;
  return { config, managed, usuario, own };
}

export async function saveUser(patch) {
  const usuario = await readUser();
  await browser.storage.local.set({ usuario: merge(usuario, patch) });
}

/** Grava as assinaturas do usuário (a lista inteira e/ou os padrões inteiros), sem ler antes. */
export function saveSignatures(patch) {
  const out = {};
  for (const k of SIGNATURE_KEYS) {
    if (k in patch) {
      out[k] = patch[k];
    }
  }
  return browser.storage.local.set(out);
}

/** Volta às opções padrão (o que a política define continua valendo). As assinaturas ficam. */
export async function resetUser() {
  await browser.storage.local.remove("usuario");
}
