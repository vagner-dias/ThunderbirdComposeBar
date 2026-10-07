/* Assinaturas: as do usuário (storage.local, chave "assinaturas") e a padrão de cada
 * conta (chave "assinaturaPadrao"). As da organização (storage.managed) aparecem
 * travadas. Cada mudança é salva na hora; o texto, logo que o usuário para de digitar
 * (e na saída da página, sem esperar).
 * O HTML passa sempre pelo FaixaSanitizer: o que fica guardado é só o que uma
 * assinatura usa (sem scripts, eventos nem estilos com url()).
 *
 * Outra janela pode gravar a mesma lista com a página aberta (Salvar Seleção na Galeria
 * de Partes Rápidas, outra aba desta página). Por isso a página guarda o que mudou aqui
 * (dirty, removed) e, ao gravar, lê a lista atual e aplica só isso por cima: o que foi
 * criado lá continua, o que foi mudado aqui vale. Um aviso de mudança de fora recarrega
 * a lista sem perder o que ainda não foi gravado.
 *
 * A mesma página serve às Partes Rápidas (partes.html, <html data-pagina="partes">):
 * chave "partesRapidas", sem padrões por conta nem importação; lista, editor, campos e
 * pré-visualização são os mesmos. */

import { loadConfig, readSignatures, saveSignatures, readQuickParts, saveQuickParts, withLock } from "../lib/config.js";
import { setupPage } from "./pagina.js";

/* global FaixaI18n, FaixaSanitizer, FaixaSignatures, FaixaQuickParts, FAIXA_ICONS */

const $ = id => document.getElementById(id);
const t = (key, text, vars) => FaixaI18n.t(key, text, vars);

const PARTS = document.documentElement.dataset.pagina == "partes";
const M = PARTS
  ? {
    key: "partesRapidas",
    list: cfg => FaixaQuickParts.list(cfg),
    read: () => readQuickParts(),
    write: list => saveQuickParts(list),
    // Parte Rápida pode ter imagem maior (produto, mapa); o todo vai até o limite da faixa.
    img: { w: 1000, h: 1000, inline: 400 * 1024 },
    maxHTML: FaixaQuickParts.MAX_HTML,
    tooBig: name => t("qp.page.tooBig", "A Parte Rápida “{name}” passou de 1 MB (com as imagens) e não foi salva. Use imagens menores ou divida o conteúdo.", { name }),
    render: (doc, item, identity) => FaixaQuickParts.render(doc, item, identity),
    newName: () => t("qp.newName", "Nova Parte Rápida"),
    delConfirm: name => t("qp.del.confirm", "Excluir a Parte Rápida “{name}”?", { name }),
    deleted: name => t("qp.deleted", "Parte Rápida “{name}” excluída.", { name }),
    emptyPreview: () => t("qp.preview.empty", "(Parte Rápida vazia)"),
    loadFailed: error => t("qp.loadFailed", "Erro ao carregar as Partes Rápidas: {error}", { error }),
  }
  : {
    key: "assinaturas",
    list: cfg => FaixaSignatures.list(cfg),
    read: () => readSignatures().then(own => own.assinaturas),
    write: list => saveSignatures({ assinaturas: list }),
    img: { w: 600, h: 300, inline: 300 * 1024 }, // logotipo, faixa
    maxHTML: Infinity,
    tooBig: () => "",
    render: (doc, item, identity) => FaixaSignatures.render(doc, item, identity),
    newName: () => t("sig.newName", "Nova assinatura"),
    delConfirm: name => t("sig.del.confirm", "Excluir a assinatura “{name}”?", { name }),
    deleted: name => t("sig.deleted", "Assinatura “{name}” excluída.", { name }),
    emptyPreview: () => t("sig.preview.empty", "(assinatura vazia)"),
    loadFailed: error => t("sig.loadFailed", "Erro ao carregar as assinaturas: {error}", { error }),
  };

/* Imagem maior que M.img.w × M.img.h é reduzida ao entrar; acima de M.img.inline bytes,
 * recomprimida. */

/* Conta de exemplo para a pré-visualização quando não dá para ler as contas. */
function sample() {
  const org = t("sig.sample.org", "Empresa");
  return {
    key: "",
    email: "ana.souza@example.com",
    name: "Ana Souza",
    organization: org,
    vcard: "BEGIN:VCARD\r\nVERSION:4.0\r\nTITLE:" + t("sig.sample.title", "Gerente de Contas") + "\r\nORG:" + org + ";" +
      t("sig.sample.dept", "Comercial") + "\r\nTEL;TYPE=work:+55 11 5555-0100\r\nTEL;TYPE=cell:+55 11 99999-0100\r\nURL:https://www.example.com\r\nEND:VCARD\r\n",
  };
}

const FIELD_SOURCES = {
  nome: () => t("sig.src.nome", "Seu nome, na identidade (Configurações da conta)"),
  email: () => t("sig.src.email", "Endereço de e-mail da identidade"),
  cargo: () => t("sig.src.cargo", "Cartão de visita (vCard) da identidade: cargo"),
  departamento: () => t("sig.src.departamento", "Cartão de visita: departamento"),
  organizacao: () => t("sig.src.organizacao", "Organização da identidade (ou a do cartão de visita)"),
  telefone: () => t("sig.src.telefone", "Cartão de visita: telefone comercial (ou o primeiro)"),
  celular: () => t("sig.src.celular", "Cartão de visita: celular"),
  site: () => t("sig.src.site", "Cartão de visita: site"),
};
const FIELD_LABELS = {
  nome: () => t("sig.f.nome", "Nome"),
  email: () => t("sig.f.email", "E-mail"),
  cargo: () => t("sig.f.cargo", "Cargo"),
  departamento: () => t("sig.f.departamento", "Departamento"),
  organizacao: () => t("sig.f.organizacao", "Organização"),
  telefone: () => t("sig.f.telefone", "Telefone"),
  celular: () => t("sig.f.celular", "Celular"),
  site: () => t("sig.f.site", "Site"),
};

const state = {
  page: null, // { config, managed, usuario, definition, locale }
  identities: [],
  own: [], // do usuário: [{ id, nome, html }], com o que ainda não foi gravado
  dirty: new Set(), // ids criados ou mudados aqui e ainda não gravados
  removed: new Set(), // ids excluídos aqui e ainda não gravados
  defaults: {}, // do usuário: { "email": { nova, resposta } }
  selected: null,
  savedSigs: "", // o que esta página gravou por último (o aviso de mudança dela mesma é ignorado)
  savedDefaults: "",
  defaultsPending: 0, // gravações dos padrões ainda na fila (um aviso de fora não os desfaz)
  range: null, // última seleção dentro do editor
};

/* ---------- utilidades ---------- */

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) {
      continue;
    }
    if (k == "text") {
      e.textContent = v;
    } else if (k == "class") {
      e.className = v;
    } else {
      e.setAttribute(k, v === true ? "" : v);
    }
  }
  e.append(...children.filter(c => c != null));
  return e;
}

function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of FAIXA_ICONS[name] || []) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      n.setAttribute(k, v);
    }
    svg.append(n);
  }
  return svg;
}

function flash(text) {
  const f = $("flash");
  f.textContent = text;
  f.hidden = !text;
  clearTimeout(flash.timer);
  if (text) {
    flash.timer = setTimeout(() => {
      f.hidden = true;
    }, 6000);
  }
}

function setStatus(text) {
  $("status").textContent = text;
}

const escText = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = s => escText(s).replace(/"/g, "&quot;");

function newId() {
  return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normKeys(map) {
  const out = {};
  for (const [k, v] of Object.entries(map && typeof map == "object" ? map : {})) {
    if (v && typeof v == "object") {
      out[String(k).trim().toLowerCase()] = Object.assign({}, v);
    }
  }
  return out;
}

function plainSigs(list) {
  return (list || []).filter(s => s && typeof s.id == "string" && typeof s.html == "string").map(s => ({ id: s.id, nome: String(s.nome || ""), html: s.html }));
}

function fontStack(name) {
  const clean = String(name || "").trim().replace(/^["']|["']$/g, "");
  if (!clean || clean.includes(",")) {
    return clean;
  }
  const map = (state.page.definition.fontFallbacks) || {};
  const fb = map[clean] || map["*"] || "sans-serif";
  const quoted = /[^\w-]/.test(clean) ? `"${clean.replace(/"/g, "")}"` : clean;
  const rest = fb.split(",").map(f => f.trim()).filter(f => f && f.toLowerCase() != clean.toLowerCase())
    .map(f => (/[^\w-]/.test(f) && !/^["']/.test(f) ? `"${f}"` : f));
  return [quoted, ...rest].join(", ");
}

/* ---------- estado ---------- */

/** Da organização (política): vêm na configuração efetiva, marcadas. */
function orgSigs() {
  return M.list(state.page.config).filter(s => s.gerenciada);
}

function all() {
  const org = orgSigs();
  const ids = new Set(org.map(s => s.id));
  return [...org, ...state.own.filter(s => !ids.has(s.id))];
}

function current() {
  return all().find(s => s.id == state.selected) || null;
}

/** Configuração para ler os padrões como a faixa lê. */
function effective() {
  return {
    assinaturas: all(),
    assinaturaPadrao: state.defaults,
    assinaturaPadraoOrg: (state.page.managed && state.page.managed.assinaturaPadrao) || {},
  };
}

function uniqueName(base) {
  const names = new Set(all().map(s => (s.nome || "").toLowerCase()));
  if (!names.has(base.toLowerCase())) {
    return base;
  }
  for (let i = 2; ; i++) {
    const n = `${base} (${i})`;
    if (!names.has(n.toLowerCase())) {
      return n;
    }
  }
}

/* ---------- gravação ---------- */

let saving = Promise.resolve();

/** Grava pela fila: write() devolve a promessa da gravação. */
function persist(write) {
  saving = saving.then(async () => {
    try {
      await write();
      setStatus(t("sig.saved", "Salvo"));
    } catch (e) {
      setStatus("");
      if (!(e && e.shown)) {
        flash(t("sig.saveFailed", "Não foi possível salvar: {error}", { error: (e && e.message) || e }));
      }
    }
  });
  return saving;
}

/** Mudou aqui: vai na próxima gravação, por cima do que estiver guardado. */
function touch(id) {
  state.dirty.add(id);
  state.removed.delete(id);
}

/** A lista guardada com o que mudou aqui por cima: os mudados aqui valem, os excluídos
 * aqui saem, os criados aqui entram no fim. Para gravar (tooBig é uma lista), os grandes
 * demais (M.maxHTML) ficam como estavam guardados e tooBig recebe os nomes deles; na
 * memória da página, ficam como o usuário deixou. */
function withLocal(stored, tooBig = null) {
  const mine = id => state.dirty.has(id) && state.own.find(x => x.id == id);
  const fits = s => !tooBig || (s.html || "").length <= M.maxHTML || (tooBig.push(s.nome || s.id), false);
  const out = stored.filter(s => !state.removed.has(s.id)).map(s => {
    const m = mine(s.id);
    return m && fits(m) ? plainSigs([m])[0] : s;
  });
  for (const id of state.dirty) {
    const m = mine(id);
    if (m && !out.some(s => s.id == id) && fits(m)) {
      out.push(plainSigs([m])[0]);
    }
  }
  return out;
}

/** O que a lista mostra (ids e nomes): muda quando outra janela cria ou exclui. */
const listKey = () => JSON.stringify(all().map(s => [s.id, s.nome]));

function saveSigs() {
  clearTimeout(saveSigs.timer);
  saveSigs.timer = 0;
  return persist(async () => {
    const tooBig = [];
    const before = listKey();
    // Ler, aplicar e gravar sem ninguém gravar no meio (o background, outra aba).
    const list = await withLock(M.key, async () => {
      let stored;
      try {
        stored = plainSigs(await M.read());
      } catch (e) {
        stored = JSON.parse(state.savedSigs || "[]"); // a última lista conhecida
      }
      const merged = withLocal(stored, tooBig);
      state.savedSigs = JSON.stringify(merged);
      await M.write(merged);
      return merged;
    });
    // Gravado deixa de ser pendente; o que mudou durante a gravação (ou não coube) continua.
    for (const id of [...state.dirty]) {
      const now = state.own.find(x => x.id == id);
      const kept = list.find(x => x.id == id);
      if (!now || (kept && JSON.stringify(plainSigs([now])[0]) == JSON.stringify(kept))) {
        state.dirty.delete(id);
      }
    }
    for (const id of [...state.removed]) {
      if (!list.some(x => x.id == id)) {
        state.removed.delete(id);
      }
    }
    state.own = withLocal(list);
    if (listKey() != before) {
      renderList(); // criada ou excluída em outra janela
      renderDefaults();
    }
    if (tooBig.length) {
      flash(M.tooBig(tooBig.join(", ")));
      throw Object.assign(new Error(M.tooBig(tooBig.join(", "))), { shown: true });
    }
  });
}

function saveSigsSoon() {
  setStatus(t("sig.saving", "Salvando…"));
  clearTimeout(saveSigs.timer);
  saveSigs.timer = setTimeout(saveSigs, 600);
}

function saveDefaults() {
  const d = normKeys(state.defaults);
  state.savedDefaults = JSON.stringify(d);
  state.defaultsPending++;
  return persist(() => saveSignatures({ assinaturaPadrao: d })).finally(() => {
    state.defaultsPending--;
  });
}

function setDefault(email, which, value) {
  const key = String(email).trim().toLowerCase();
  const entry = Object.assign({}, state.defaults[key]);
  if (value === undefined) {
    delete entry[which];
  } else {
    entry[which] = value;
  }
  if (Object.keys(entry).length) {
    state.defaults[key] = entry;
  } else {
    delete state.defaults[key];
  }
}

/* ---------- lista ---------- */

function renderList() {
  const box = $("list");
  const items = all();
  box.replaceChildren(...items.map((s, i) => {
    const opt = el("div", { class: "sig-opt", role: "option", id: "sig-opt-" + i, "aria-selected": s.id == state.selected ? "true" : "false" },
      el("span", { class: "nm", text: s.nome || t("sig.noName", "Sem nome") }),
      s.gerenciada ? el("span", { class: "badge", text: t("sig.orgBadge", "organização") }) : null);
    opt.addEventListener("mousedown", e => {
      e.preventDefault();
      box.focus();
      select(s.id);
    });
    return opt;
  }));
  const i = items.findIndex(s => s.id == state.selected);
  if (i >= 0) {
    box.setAttribute("aria-activedescendant", "sig-opt-" + i);
  } else {
    box.removeAttribute("aria-activedescendant");
  }
  $("empty").hidden = items.length > 0;
  $("edit").hidden = !items.length;
  const s = current();
  $("dup").disabled = !s;
  $("del").disabled = !s || !!s.gerenciada;
}

function select(id) {
  if (saveSigs.timer) {
    saveSigs(); // o que foi digitado na anterior vai antes
  }
  state.selected = id;
  state.range = null;
  renderList();
  const opt = $("list").querySelector('[aria-selected="true"]');
  if (opt) {
    opt.scrollIntoView({ block: "nearest" });
  }
  loadEditor();
  renderPreview();
}

function onListKey(e) {
  const items = all();
  const i = items.findIndex(s => s.id == state.selected);
  let next = null;
  switch (e.key) {
    case "ArrowDown":
      next = items[Math.min(items.length - 1, i + 1)];
      break;
    case "ArrowUp":
      next = items[Math.max(0, i - 1)];
      break;
    case "Home":
      next = items[0];
      break;
    case "End":
      next = items[items.length - 1];
      break;
    case "Delete":
      e.preventDefault();
      removeSig();
      return;
    case "F2":
      e.preventDefault();
      if (!$("name").disabled) {
        $("name").focus();
        $("name").select();
      }
      return;
    default:
      return;
  }
  e.preventDefault();
  if (next && next.id != state.selected) {
    select(next.id);
  }
}

function newSig() {
  const s = { id: newId(), nome: uniqueName(M.newName()), html: "" };
  state.own.push(s);
  touch(s.id);
  saveSigs();
  renderDefaults();
  select(s.id);
  $("name").focus();
  $("name").select();
}

function duplicateSig() {
  const s = current();
  if (!s) {
    return;
  }
  const copy = { id: newId(), nome: uniqueName(t("sig.copyOf", "Cópia de {name}", { name: s.nome || s.id })), html: s.html };
  state.own.push(copy);
  touch(copy.id);
  saveSigs();
  renderDefaults();
  select(copy.id);
  $("name").focus();
  $("name").select();
}

function removeSig() {
  const s = current();
  if (!s || s.gerenciada) {
    return;
  }
  if (!window.confirm(M.delConfirm(s.nome || s.id))) {
    return;
  }
  const items = all();
  const i = items.findIndex(x => x.id == s.id);
  state.own = state.own.filter(x => x.id != s.id);
  state.dirty.delete(s.id);
  state.removed.add(s.id);
  // Conta que usava a excluída volta a seguir o Thunderbird.
  let touched = false;
  for (const entry of Object.values(state.defaults)) {
    for (const which of ["nova", "resposta"]) {
      if (entry[which] === s.id) {
        delete entry[which];
        touched = true;
      }
    }
  }
  for (const [k, v] of Object.entries(state.defaults)) {
    if (!Object.keys(v).length) {
      delete state.defaults[k];
    }
  }
  saveSigs();
  if (touched) {
    saveDefaults();
  }
  const rest = all();
  state.selected = rest.length ? rest[Math.min(i, rest.length - 1)].id : null;
  renderDefaults();
  select(state.selected);
  flash(M.deleted(s.nome || s.id));
  $("list").focus();
}

/* ---------- editor ---------- */

function loadEditor() {
  const s = current();
  const ed = $("editor");
  if (!s) {
    ed.replaceChildren();
    return;
  }
  ed.replaceChildren(FaixaSanitizer.clean(s.html, document));
  const managed = !!s.gerenciada;
  ed.contentEditable = managed ? "false" : "true";
  ed.setAttribute("aria-readonly", managed ? "true" : "false");
  $("name").value = s.nome || "";
  $("name").disabled = managed;
  for (const c of $("toolbar").querySelectorAll("button, input, select")) {
    c.disabled = managed;
  }
  $("managed").hidden = !managed;
  updateToolbar();
}

/** O HTML do editor, limpo. Editor sem texto nem imagem é assinatura vazia. */
function serialize() {
  const ed = $("editor");
  if (!ed.textContent.trim() && !ed.querySelector("img")) {
    return "";
  }
  return FaixaSanitizer.toHTML(ed.innerHTML, document);
}

function changed() {
  const s = current();
  if (!s || s.gerenciada) {
    return;
  }
  const own = state.own.find(x => x.id == s.id);
  if (!own) {
    return;
  }
  own.html = serialize();
  touch(own.id);
  if (!own.html && $("editor").childNodes.length) {
    $("editor").replaceChildren(); // volta a mostrar a dica do editor vazio
  }
  saveSigsSoon();
  renderPreviewSoon();
  updateToolbar();
}

function editorHasRange() {
  const sel = document.getSelection();
  return !!sel && sel.rangeCount > 0 && $("editor").contains(sel.getRangeAt(0).commonAncestorContainer);
}

/** Antes de um comando da barra: o foco volta ao editor, com a seleção de antes. */
function restoreSelection() {
  const ed = $("editor");
  ed.focus();
  const sel = document.getSelection();
  if (editorHasRange()) {
    return;
  }
  sel.removeAllRanges();
  if (state.range && ed.contains(state.range.startContainer) && ed.contains(state.range.endContainer)) {
    sel.addRange(state.range);
  } else {
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    sel.addRange(r);
  }
}

function exec(cmd, value = null, css = true) {
  const s = current();
  if (!s || s.gerenciada) {
    return;
  }
  restoreSelection();
  document.execCommand("styleWithCSS", false, css);
  document.execCommand(cmd, false, value);
  changed();
}

/** Cursor numa palavra sem seleção: a palavra inteira, como na faixa. */
function wordAtCaret() {
  const sel = document.getSelection();
  if (!sel.isCollapsed || !sel.rangeCount) {
    return !sel.isCollapsed;
  }
  const node = sel.anchorNode;
  const off = sel.anchorOffset;
  if (!node || node.nodeType != 3) {
    return false;
  }
  const word = /[\p{L}\p{N}\p{M}_{}@.+-]/u;
  let a = off;
  let b = off;
  while (a > 0 && word.test(node.data[a - 1])) {
    a--;
  }
  while (b < node.data.length && word.test(node.data[b])) {
    b++;
  }
  if (a == b) {
    return false;
  }
  const r = document.createRange();
  r.setStart(node, a);
  r.setEnd(node, b);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

/** Fonte ou cor: pelo próprio editor (um Ctrl+Z desfaz). Cursor numa palavra: a palavra
 * inteira; fora de palavra, vale para o que for digitado em seguida. */
function applyInline(cmd, value) {
  const s = current();
  if (!s || s.gerenciada) {
    return;
  }
  restoreSelection();
  wordAtCaret();
  document.execCommand("styleWithCSS", false, true);
  document.execCommand(cmd, false, value);
  changed();
}

/** Tamanho em pt na seleção, por cima do que houver dentro dela (o editor só conhece os
 * tamanhos 1 a 7). Sem seleção nem palavra, vale para o que for digitado em seguida. */
function applySize(pt) {
  const s = current();
  if (!s || s.gerenciada) {
    return;
  }
  const prop = "font-size";
  const value = pt + "pt";
  restoreSelection();
  const sel = document.getSelection();
  if (!wordAtCaret()) {
    // Sem texto para formatar: um <span> com espaço de largura zero recebe a digitação.
    const span = el("span");
    span.style.setProperty(prop, value);
    span.textContent = "​";
    const r = sel.getRangeAt(0);
    r.insertNode(span);
    sel.collapse(span.firstChild, 1);
    changed();
    return;
  }
  // O marcador de fonte vira o estilo pedido (os dois motores criam <font face>).
  const MARK = "faixa-marca-" + Math.random().toString(36).slice(2, 8);
  document.execCommand("styleWithCSS", false, false);
  document.execCommand("fontName", false, MARK);
  const ed = $("editor");
  const marked = [...ed.querySelectorAll("font[face], span[style]")].filter(n =>
    n.localName == "font" ? n.getAttribute("face") == MARK : (n.style.fontFamily || "").replace(/["']/g, "") == MARK);
  const done = [];
  for (const n of marked) {
    let span = n;
    if (n.localName == "font") {
      span = el("span");
      if (n.getAttribute("style")) {
        span.setAttribute("style", n.getAttribute("style"));
      }
      if (n.getAttribute("color")) {
        span.style.setProperty("color", n.getAttribute("color"));
      }
      span.append(...n.childNodes);
      n.replaceWith(span);
    }
    span.style.removeProperty("font-family");
    span.style.setProperty(prop, value);
    // O que vinha de dentro com o mesmo estilo deixa de valer por cima do novo.
    for (const d of span.querySelectorAll("[style]")) {
      d.style.removeProperty(prop);
      if (!d.getAttribute("style")) {
        d.removeAttribute("style");
      }
    }
    span.querySelectorAll("font[size]").forEach(f => f.removeAttribute("size"));
    done.push(span);
  }
  if (done.length) {
    const r = document.createRange();
    r.setStartBefore(done[0]);
    r.setEndAfter(done[done.length - 1]);
    sel.removeAllRanges();
    sel.addRange(r);
    state.range = r.cloneRange();
  }
  changed();
}

function updateToolbar() {
  const s = current();
  const managed = !s || !!s.gerenciada;
  const inEditor = editorHasRange();
  for (const b of $("toolbar").querySelectorAll("[data-cmd]")) {
    let on = false;
    if (inEditor && !managed) {
      try {
        on = document.queryCommandState(b.dataset.cmd);
      } catch (e) {}
    }
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (!inEditor) {
    // Sem cursor no editor: a fonte e o tamanho da mensagem (a assinatura herda os dela).
    const fp = state.page.config.fontePadrao || {};
    if (document.activeElement != $("t-font")) {
      $("t-font").value = fp.familia || "Calibri";
    }
    if (document.activeElement != $("t-size")) {
      setSizeBox(fp.tamanhoPt || 11);
    }
    return;
  }
  const sel = document.getSelection();
  let node = sel.anchorNode;
  if (node && node.nodeType == 1 && node.childNodes[sel.anchorOffset]) {
    node = node.childNodes[sel.anchorOffset]; // seleção que começa antes de um elemento
  }
  while (node && node.nodeType == 1 && node.firstChild && !sel.isCollapsed && node.localName != "img") {
    node = node.firstChild; // o texto de dentro é o que mostra a fonte e o tamanho
  }
  if (node && node.nodeType == 3) {
    node = node.parentElement;
  }
  if (!node || !$("editor").contains(node)) {
    return;
  }
  const cs = getComputedStyle(node);
  if (document.activeElement != $("t-font")) {
    $("t-font").value = (cs.fontFamily.split(",")[0] || "").replace(/["']/g, "").trim();
  }
  if (document.activeElement != $("t-size")) {
    setSizeBox(Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2);
  }
}

function setSizeBox(pt) {
  const size = $("t-size");
  if (![...size.options].some(o => Number(o.value) == pt)) {
    size.append(el("option", { value: String(pt), text: FaixaI18n.num(pt) }));
  }
  size.value = String(pt);
}

/* ---------- link, imagem, campos ---------- */

function normalizeLink(v) {
  const s = String(v || "").trim();
  if (!s) {
    return "";
  }
  if (/^(https?:\/\/|mailto:|tel:)\S/i.test(s)) {
    return s;
  }
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)) {
    return "mailto:" + s;
  }
  if (/^\+?[\d\s().-]{8,}$/.test(s)) {
    return "tel:" + s.replace(/[^\d+]/g, "");
  }
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) {
    return "https://" + s;
  }
  return null;
}

function linkAtSelection() {
  const sel = document.getSelection();
  let n = sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
  while (n && n != $("editor")) {
    if (n.nodeType == 1 && n.localName == "a") {
      return n;
    }
    n = n.parentNode;
  }
  return null;
}

function openLink() {
  const s = current();
  if (!s || s.gerenciada) {
    return;
  }
  restoreSelection();
  state.range = document.getSelection().getRangeAt(0).cloneRange();
  const a = linkAtSelection();
  $("link-url").value = a ? a.getAttribute("href") || "" : "";
  $("link-error").hidden = true;
  $("link-dlg").returnValue = "";
  $("link-dlg").showModal();
  $("link-url").select();
}

function applyLink(value) {
  restoreSelection();
  const url = normalizeLink(value);
  if (url === "") {
    const a = linkAtSelection();
    if (a) {
      const r = document.createRange();
      r.selectNodeContents(a);
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    document.execCommand("unlink");
    changed();
    return;
  }
  const sel = document.getSelection();
  const a = linkAtSelection();
  if (a) {
    a.setAttribute("href", url);
  } else if (sel.isCollapsed) {
    const text = url.replace(/^(mailto:|tel:)/i, "");
    document.execCommand("insertHTML", false, `<a href="${escAttr(url)}">${escText(text)}</a>`);
  } else {
    document.execCommand("createLink", false, url);
  }
  changed();
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Imagem para a assinatura: data: (vai junto com a mensagem), reduzida se for grande. */
async function prepareImage(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
    throw new Error(t("sig.img.type", "Use uma imagem PNG, JPEG, GIF ou WebP."));
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error(t("sig.img.big", "A imagem tem mais de 10 MB."));
  }
  const data = await readAsDataURL(file);
  const img = new Image();
  img.src = data;
  await img.decode();
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const scale = Math.min(1, M.img.w / W, M.img.h / H);
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  if (scale == 1 && data.length <= M.img.inline) {
    return { src: data, w, h }; // como veio (GIF animado continua animado)
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  let src = file.type == "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.9) : canvas.toDataURL("image/png");
  if (src.length > M.img.inline && file.type != "image/jpeg") {
    // Sem transparência, JPEG fica bem menor.
    const px = ctx.getImageData(0, 0, w, h).data;
    let opaque = true;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 255) {
        opaque = false;
        break;
      }
    }
    if (opaque) {
      src = canvas.toDataURL("image/jpeg", 0.88);
    }
  }
  return { src, w, h };
}

async function insertImageFile(file) {
  const s = current();
  if (!s || s.gerenciada) {
    return;
  }
  try {
    const img = await prepareImage(file);
    const alt = String(file.name || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    restoreSelection();
    document.execCommand("insertHTML", false, `<img src="${img.src}" width="${img.w}" height="${img.h}" alt="${escAttr(alt)}">`);
    changed();
  } catch (e) {
    flash(t("sig.img.failed", "Não foi possível usar a imagem: {error}", { error: (e && e.message) || e }));
  }
}

/** Colar: o HTML passa pela limpeza; parágrafo sem margem própria fica sem margem,
 * como no Word e no Outlook (o padrão do navegador daria uma linha a mais). */
function pastedHTML(html) {
  const frag = FaixaSanitizer.clean(html, document);
  for (const n of frag.querySelectorAll("[style]")) {
    const kept = n.getAttribute("style").split(";").map(x => x.trim()).filter(x => x && !/^mso-/i.test(x));
    if (kept.length) {
      n.setAttribute("style", kept.join("; "));
    } else {
      n.removeAttribute("style");
    }
  }
  for (const p of frag.querySelectorAll("p")) {
    if (!/margin/i.test(p.getAttribute("style") || "")) {
      p.style.setProperty("margin", "0");
    }
  }
  const box = el("div");
  box.append(frag);
  return box.innerHTML;
}

function insertField(id) {
  const s = current();
  if (!s || s.gerenciada || !id) {
    return;
  }
  restoreSelection();
  document.execCommand("insertText", false, FaixaSignatures.token(id, FaixaI18n.locale));
  changed();
}

/* ---------- pré-visualização e campos ---------- */

function whoIdentity() {
  const key = $("who").value;
  return state.identities.find(i => i.key == key) || state.identities[0] || sample();
}

function applyBodyFont(node) {
  const fp = state.page.config.fontePadrao || {};
  node.style.fontFamily = fontStack(fp.familia || "Calibri");
  node.style.fontSize = (fp.tamanhoPt || 11) + "pt";
}

function renderPreview() {
  clearTimeout(renderPreview.timer);
  const s = current();
  const box = $("preview");
  if (!s) {
    box.replaceChildren();
    return;
  }
  const sig = s.gerenciada ? s : state.own.find(x => x.id == s.id) || s;
  box.replaceChildren(sig.html ? M.render(document, sig, whoIdentity()) : el("span", { class: "muted", text: M.emptyPreview() }));
  renderFields();
}

function renderPreviewSoon() {
  clearTimeout(renderPreview.timer);
  renderPreview.timer = setTimeout(renderPreview, 250);
}

function renderWho() {
  const who = $("who");
  const keep = who.value;
  const list = state.identities.length ? state.identities : [sample()];
  who.replaceChildren(...list.map(i => el("option", {
    value: i.key,
    text: (i.name ? `${i.name} <${i.email}>` : i.email) + (i.key ? "" : t("sig.sample", " (exemplo)")),
  })));
  if (list.some(i => i.key == keep)) {
    who.value = keep;
  }
}

function renderFields() {
  const tbody = $("fields").querySelector("tbody");
  const vars = FaixaSignatures.vars(whoIdentity());
  tbody.replaceChildren(...FaixaSignatures.FIELDS.map(f => el("tr", {},
    el("td", {}, el("span", { class: "sig-field", text: FaixaSignatures.token(f.id, FaixaI18n.locale) }), " ", el("span", { class: "muted", text: FIELD_LABELS[f.id]() })),
    el("td", { text: FIELD_SOURCES[f.id]() }),
    el("td", { text: vars[f.id] || t("sig.value.empty", "(vazio)"), class: vars[f.id] ? "" : "muted" }))));
}

/* ---------- padrões por conta ---------- */

function renderDefaults() {
  if (PARTS) {
    return; // Partes Rápidas não têm padrão por conta
  }
  const tbody = $("defaults").querySelector("tbody");
  const cfg = effective();
  const sigs = all();
  $("noid").hidden = state.identities.length > 0;
  $("defaults").hidden = !state.identities.length;
  tbody.replaceChildren();
  for (const id of state.identities) {
    const who = id.name ? `${id.name} <${id.email}>` : id.email;
    const tr = el("tr", {}, el("td", { class: "acc" }, el("span", { class: "who", text: who }), el("span", { class: "acct", text: id.accountName || "" })));
    for (const which of ["nova", "resposta"]) {
      const d = FaixaSignatures.defaultFor(cfg, id.email, which);
      const label = which == "nova" ? t("sig.col.new", "Mensagens novas") : t("sig.col.reply", "Respostas e encaminhamentos");
      const select = el("select", { "aria-label": `${label}: ${who}` },
        el("option", { value: "__tb", text: t("sig.opt.tb", "Do Thunderbird") }),
        el("option", { value: "__none", text: t("sig.opt.none", "(nenhuma)") }),
        ...sigs.map(s => el("option", { value: "s:" + s.id, text: (s.nome || s.id) + (s.gerenciada ? t("sig.opt.org", " (organização)") : "") })));
      const known = d.id && sigs.some(s => s.id == d.id);
      select.value = d.id === undefined || (d.id && !known) ? "__tb" : d.id === null ? "__none" : "s:" + d.id;
      const td = el("td", {}, select);
      if (d.managed) {
        select.disabled = true;
        select.title = t("opt.locked", "Definido pela sua organização");
        td.classList.add("locked");
      }
      select.addEventListener("change", () => {
        const v = select.value;
        setDefault(id.email, which, v == "__tb" ? undefined : v == "__none" ? null : v.slice(2));
        saveDefaults();
      });
      tr.append(td);
    }
    tbody.append(tr);
  }
}

/* ---------- importar do Thunderbird ---------- */

/** Imagem data: grande (logotipo trazido do Thunderbird) reduzida como as que entram pelo editor. */
async function shrinkImages(frag) {
  for (const img of frag.querySelectorAll('img[src^="data:"]')) {
    const src = img.getAttribute("src");
    try {
      const type = /^data:(image\/[\w+.-]+);/.exec(src)[1];
      const blob = await (await fetch(src)).blob();
      const out = await prepareImage(new File([blob], img.getAttribute("alt") || "imagem", { type }));
      if (out.src != src) {
        img.setAttribute("src", out.src);
        img.setAttribute("width", out.w);
        img.setAttribute("height", out.h);
      }
    } catch (e) {
      img.remove(); // imagem que não abre não vai para a assinatura
    }
  }
  return frag;
}

async function importedHTML(html) {
  const frag = await shrinkImages(FaixaSanitizer.clean(html, document));
  // O separador "-- " do Thunderbird (quem o digitou na assinatura) não é do Outlook.
  const first = frag.firstChild;
  if (first && first.nodeType == 3 && /^\s*--\s*$/.test(first.data) && first.nextSibling && first.nextSibling.nodeName == "BR") {
    first.nextSibling.remove();
    first.remove();
  }
  const box = el("div");
  box.append(frag);
  return box.innerHTML.trim();
}

async function importTB() {
  if (!state.identities.length) {
    flash(t("sig.noIdentities", "Não foi possível ler as contas do Thunderbird."));
    return;
  }
  const hasContent = html => {
    const box = el("div");
    box.append(FaixaSanitizer.clean(html || "", document));
    return !!box.textContent.trim() || !!box.querySelector("img");
  };
  const found = state.identities.filter(i => hasContent(i.tbSignature));
  if (!found.length) {
    flash(t("sig.import.none", "Nenhuma conta do Thunderbird tem assinatura nas Configurações da conta."));
    return;
  }
  let created = 0;
  let linked = 0;
  let first = null;
  for (const i of found) {
    const html = await importedHTML(i.tbSignature);
    let sig = state.own.find(s => s.html == html);
    if (!sig) {
      sig = { id: newId(), nome: uniqueName(i.email), html };
      state.own.push(sig);
      touch(sig.id);
      created++;
    }
    first = first || sig;
    const cfg = effective();
    for (const which of ["nova", "resposta"]) {
      const d = FaixaSignatures.defaultFor(cfg, i.email, which);
      if (d.id === undefined && !d.managed) {
        // Respostas: só se o Thunderbird punha a assinatura nelas (ou nos encaminhamentos).
        const on = which == "nova" || i.sigOnReply !== false || i.sigOnForward === true;
        setDefault(i.email, which, on ? sig.id : null);
        linked++;
      }
    }
  }
  await saveSigs();
  if (linked) {
    await saveDefaults();
  }
  renderDefaults();
  select(first.id);
  flash(!created
    ? t("sig.import.same", "As assinaturas do Thunderbird já estavam aqui.")
    : created == 1
      ? t("sig.import.doneOne", "1 assinatura trazida do Thunderbird. As contas que seguiam o Thunderbird passaram a usá-la.")
      : t("sig.import.doneMany", "{n} assinaturas trazidas do Thunderbird. As contas que seguiam o Thunderbird passaram a usá-las.", { n: created }));
}

/* ---------- carga ---------- */

function adopt(loaded) {
  state.page = Object.assign(state.page || {}, loaded);
  const own = loaded.own || {};
  const stored = plainSigs(PARTS ? own.partesRapidas : own.assinaturas);
  state.own = withLocal(stored); // o que ainda não foi gravado aqui continua
  if (!state.defaultsPending) {
    state.defaults = PARTS ? {} : normKeys(own.assinaturaPadrao);
    state.savedDefaults = JSON.stringify(state.defaults);
  }
  state.savedSigs = JSON.stringify(stored);
  const m = loaded.managed || {};
  $("policy").hidden = PARTS
    ? !(Array.isArray(m.partesRapidas) && m.partesRapidas.length)
    : !(Array.isArray(m.assinaturas) && m.assinaturas.length) && !(m.assinaturaPadrao && Object.keys(m.assinaturaPadrao).length);
}

function renderAll(keepEditor = false) {
  const was = state.selected;
  if (!all().some(s => s.id == state.selected)) {
    state.selected = all().length ? all()[0].id : null;
  }
  renderList();
  // O editor aberto só fica se ainda é o da mesma assinatura: o texto de uma que outra
  // janela excluiu não pode ir parar em outra.
  if (!keepEditor || state.selected != was) {
    loadEditor();
  }
  renderWho();
  renderPreview();
  renderDefaults();
}

async function reload() {
  const loaded = await loadConfig();
  adopt(loaded);
  // Com o cursor no editor, ele fica como está se o texto dele ainda é o desta assinatura
  // (ou tem mudança por gravar); se outra janela mudou a assinatura, ele recarrega.
  const s = current();
  const keep = document.activeElement == $("editor") && !!s && (state.dirty.has(s.id) || serialize() == (s.html || ""));
  renderAll(keep);
}

function bind() {
  const ed = $("editor");
  $("list").addEventListener("keydown", onListKey);
  $("new").addEventListener("click", newSig);
  $("dup").addEventListener("click", duplicateSig);
  $("del").addEventListener("click", removeSig);
  $("name").addEventListener("input", () => {
    const s = current();
    const own = s && state.own.find(x => x.id == s.id);
    if (!own) {
      return;
    }
    own.nome = $("name").value;
    touch(own.id);
    renderList();
    saveSigsSoon();
  });
  $("name").addEventListener("change", () => {
    const own = state.own.find(x => x.id == state.selected);
    if (own && !own.nome.trim()) {
      own.nome = uniqueName(t("sig.noName", "Sem nome"));
      touch(own.id);
      $("name").value = own.nome;
      renderList();
    }
    renderDefaults();
    saveSigs();
  });
  ed.addEventListener("input", changed);
  // Ctrl+B, Ctrl+I e Ctrl+U pela barra (o Thunderbird pode ter outra função para a tecla).
  ed.addEventListener("keydown", e => {
    const accel = navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey;
    const cmd = { b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()];
    if (accel && !e.altKey && !e.shiftKey && cmd) {
      e.preventDefault();
      e.stopPropagation();
      exec(cmd);
    }
  });
  document.addEventListener("selectionchange", () => {
    if (editorHasRange()) {
      state.range = document.getSelection().getRangeAt(0).cloneRange();
      updateToolbar();
    }
  });
  ed.addEventListener("paste", e => {
    const s = current();
    if (!s || s.gerenciada) {
      return;
    }
    const dt = e.clipboardData;
    const file = [...(dt.files || [])].find(f => /^image\//.test(f.type));
    if (file) {
      e.preventDefault();
      insertImageFile(file);
      return;
    }
    const html = dt.getData("text/html");
    if (html) {
      e.preventDefault();
      document.execCommand("insertHTML", false, pastedHTML(html));
      changed();
    }
  });
  ed.addEventListener("drop", e => {
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    if (!files.length) {
      return;
    }
    e.preventDefault();
    const file = files.find(f => /^image\//.test(f.type));
    if (!file) {
      return;
    }
    const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
    if (pos && ed.contains(pos.offsetNode)) {
      const r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      state.range = r;
      document.getSelection().removeAllRanges();
    }
    insertImageFile(file);
  });
  // Barra de formatação: o mousedown não tira a seleção do editor.
  for (const b of $("toolbar").querySelectorAll("button")) {
    b.addEventListener("mousedown", e => e.preventDefault());
  }
  for (const b of $("toolbar").querySelectorAll("[data-cmd]")) {
    b.addEventListener("click", () => exec(b.dataset.cmd));
  }
  const font = $("t-font");
  const applyFont = () => {
    const name = font.value.trim();
    if (name) {
      applyInline("fontName", fontStack(name));
    }
  };
  font.addEventListener("change", applyFont);
  font.addEventListener("keydown", e => {
    if (e.key == "Enter") {
      e.preventDefault();
      applyFont();
    }
  });
  $("t-size").addEventListener("change", e => applySize(Number(e.target.value)));
  $("t-color").addEventListener("change", e => applyInline("foreColor", e.target.value.toUpperCase()));
  $("t-link").addEventListener("click", openLink);
  $("t-image").addEventListener("click", () => $("t-file").click());
  $("t-file").addEventListener("change", e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) {
      insertImageFile(file);
    }
  });
  $("t-field").addEventListener("change", e => {
    const id = e.target.value;
    e.target.value = "";
    insertField(id);
  });
  $("t-clear").addEventListener("click", () => exec("removeFormat", null, false));
  const form = $("link-dlg").querySelector("form");
  form.addEventListener("submit", e => {
    if (e.submitter && e.submitter.value == "ok" && normalizeLink($("link-url").value) === null) {
      e.preventDefault();
      $("link-error").textContent = t("sig.link.bad", "Endereço não reconhecido. Use um site (https://…), um e-mail ou um telefone.");
      $("link-error").hidden = false;
      $("link-url").focus();
    }
  });
  $("link-dlg").addEventListener("close", () => {
    if ($("link-dlg").returnValue == "ok") {
      applyLink($("link-url").value);
    } else {
      restoreSelection();
    }
  });
  $("who").addEventListener("change", renderPreview);
  if ($("import")) {
    $("import").addEventListener("click", () => importTB().catch(e => flash(String((e && e.message) || e))));
  }
  // Saindo da página com texto ainda por gravar: grava já, sem esperar a fila (depois da
  // saída, uma continuação pendente não roda mais).
  // A lista que a página conhece já tem o que as outras janelas gravaram (aviso de
  // mudança); aqui não dá para ler antes.
  window.addEventListener("pagehide", () => {
    if (saveSigs.timer) {
      clearTimeout(saveSigs.timer);
      saveSigs.timer = 0;
      const list = withLocal(JSON.parse(state.savedSigs || "[]"), []);
      state.savedSigs = JSON.stringify(list);
      try {
        M.write(list);
      } catch (e) {}
    }
  });
}

/* Registrado antes da primeira espera da página: uma gravação de outra janela durante a
 * carga não passa sem ser vista. */
let pageReady = false;
let staleWhileLoading = false;
browser.storage.onChanged.addListener((changes, area) => {
  if (area != "managed") {
    const keys = PARTS ? [M.key] : [M.key, "assinaturaPadrao"];
    if (area != "local" || !keys.some(k => changes[k])) {
      return; // outras opções da faixa não mexem nesta página
    }
    const same = (key, norm, saved) => !changes[key] || JSON.stringify(norm(changes[key].newValue)) == saved;
    if (pageReady && same(M.key, plainSigs, state.savedSigs) && (PARTS || same("assinaturaPadrao", normKeys, state.savedDefaults))) {
      return; // gravação desta página
    }
  }
  if (!pageReady) {
    staleWhileLoading = true;
    return;
  }
  reload().catch(() => {});
});

function setupToolbar() {
  const icons = {
    "t-bold": "bold", "t-italic": "italic", "t-underline": "underline", "t-left": "text-align-start",
    "t-center": "text-align-center", "t-right": "text-align-end", "t-link": "link", "t-image": "image", "t-clear": "remove-formatting",
  };
  for (const [id, name] of Object.entries(icons)) {
    const b = $(id);
    b.append(icon(name));
    b.setAttribute("aria-label", b.title);
  }
  $("t-color-icon").append(icon("baseline"));
  const sizes = state.page.definition.fontSizes || [8, 9, 10, 11, 12, 14, 16, 18, 20, 24];
  $("t-size").replaceChildren(...sizes.map(n => el("option", { value: String(n), text: FaixaI18n.num(n) })));
  $("t-field").replaceChildren(
    el("option", { value: "", text: t("sig.field.pick", "Inserir campo…") }),
    ...FaixaSignatures.FIELDS.map(f => el("option", { value: f.id, text: `${FIELD_LABELS[f.id]()}  ${FaixaSignatures.token(f.id, FaixaI18n.locale)}` })));
  const ed = $("editor");
  applyBodyFont(ed);
  applyBodyFont($("preview"));
  try {
    document.execCommand("defaultParagraphSeparator", false, "div");
    document.execCommand("enableObjectResizing", false, true);
  } catch (e) {}
}

async function main() {
  const loaded = await setupPage();
  state.page = loaded;
  adopt(loaded);
  $("version").textContent = t("opt.version", "Faixa de Opções {version}", { version: browser.runtime.getManifest().version });
  setupToolbar();
  try {
    state.identities = await browser.faixa.listIdentities();
  } catch (e) {
    state.identities = [];
  }
  renderAll();
  bind();
  pageReady = true;
  if (staleWhileLoading) {
    await reload();
  }
  try {
    const fonts = await browser.faixa.listFonts();
    $("fonts").replaceChildren(...fonts.map(name => el("option", { value: name })));
  } catch (e) {}
}

main().catch(e => flash(M.loadFailed((e && e.message) || e)));
