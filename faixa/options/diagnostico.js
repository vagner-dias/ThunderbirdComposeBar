/* Diagnóstico da Faixa: ambiente, autoteste, atalhos, teste de teclado e fontes.
 * Textos no idioma da faixa (pt-BR no código; traduções em ribbon/locales). */

import { loadConfig, saveUser } from "../lib/config.js";
import { setupPage, formatDate } from "./pagina.js";
import { TB153_KEYS } from "./tb153-keys.js";

/* global FaixaShortcuts, FaixaI18n */

const $ = id => document.getElementById(id);
const t = (key, text, vars) => FaixaI18n.t(key, text, vars);

/** O que cada tecla do Thunderbird faz (chaves tb.* nas traduções). */
const TB_ACTION = {
  cmd_bold: "Negrito",
  cmd_italic: "Itálico",
  cmd_underline: "Sublinhado",
  cmd_tt: "Largura fixa",
  cmd_indent: "Aumentar recuo",
  cmd_outdent: "Diminuir recuo",
  cmd_removeStyles: "Remover estilos de texto",
  cmd_removeLinks: "Remover links",
  cmd_removeNamedAnchors: "Remover âncoras",
  cmd_decreaseFontStep: "Diminuir fonte (tamanho relativo)",
  cmd_increaseFontStep: "Aumentar fonte (tamanho relativo)",
  cmd_link: "Inserir link",
  cmd_close: "Fechar a janela",
  cmd_saveDefault: "Salvar",
  cmd_sendWithCheck: "Enviar",
  cmd_sendLater: "Enviar depois",
  cmd_print: "Imprimir",
  cmd_pasteQuote: "Colar como citação",
  cmd_pasteNoFormatting: "Colar sem formatação",
  cmd_rewrap: "Refazer quebra de linhas",
  cmd_delete: "Excluir",
  cmd_renameAttachment: "Renomear anexo",
  cmd_reorderAttachments: "Reordenar anexos",
  cmd_find: "Localizar",
  cmd_findReplace: "Localizar e substituir",
  cmd_findNext: "Localizar próxima",
  cmd_findPrev: "Localizar anterior",
  cmd_fullZoomReduce: "Diminuir zoom",
  cmd_fullZoomEnlarge: "Aumentar zoom",
  cmd_fullZoomReset: "Zoom 100%",
  cmd_spelling: "Verificar ortografia",
  cmd_sortAttachmentsToggle: "Ordenar anexos",
  "goOpenNewMessage(null);": "Nova mensagem",
  "toggleContactsSidebar();": "Painel de contatos",
  "toMessengerWindow();": "Janela principal do e-mail",
  "moveFocusToNeighbouringArea(event);": "Mover o foco entre áreas",
  "openSupportURL();": "Ajuda",
  "handleEsc();": "Esc (fechar barra de localizar)",
  key_undo: "Desfazer",
  key_redo: "Refazer",
  key_cut: "Recortar",
  key_copy: "Copiar",
  key_paste: "Colar",
  key_selectAll: "Selecionar tudo",
  cmd_attachFile: "Anexar arquivo",
  cmd_toggleAttachmentPane: "Mostrar/ocultar o painel de anexos",
  showAddressRowTo: "Mostrar o campo Para",
  showAddressRowCc: "Mostrar o campo Cc",
  showAddressRowBcc: "Mostrar o campo Cco",
};

/** Teclas do Thunderbird que já fazem o mesmo que o Office. */
const TB_SAME = {
  cmd_bold: "bold",
  cmd_italic: "italic",
  cmd_underline: "underline",
  cmd_indent: "indent",
  cmd_outdent: "outdent",
  cmd_increaseFontStep: "growFont",
  cmd_decreaseFontStep: "shrinkFont",
  cmd_find: "find",
  cmd_findReplace: "replace",
  cmd_saveDefault: "saveDraft",
  cmd_sendWithCheck: "send",
  cmd_removeStyles: "clearChar",
  cmd_link: "insertLink",
  cmd_pasteNoFormatting: "pasteNoFormatting",
  "goOpenNewMessage(null);": "newMessage",
  "toggleContactsSidebar();": "addressBook",
  key_undo: "undo",
  key_redo: "redo",
  key_selectAll: "selectAll",
  cmd_attachFile: "attachFile",
};

const state = {
  definition: null,
  diag: null,
  config: null,
  managed: {},
  results: null,
  manifest: browser.runtime.getManifest(),
  browserInfo: null,
  keySource: "",
  keyRows: [],
  keyState: FaixaShortcuts.newKeyState(),
  keyLog: [],
};

const MODIFIER_KEYS = ["Control", "Shift", "Alt", "AltGraph", "Meta", "OS", "CapsLock"];

/** Uma linha do teste de teclado: o que chegou do sistema e como a faixa lê. */
function describeKey(e) {
  const sc = new FaixaShortcuts(state.definition, state.config.perfilAtalhos, platformKey() == "mac");
  const combo = sc.comboFromEvent(e, state.keyState);
  const entry = sc.match(e, true, state.keyState);
  const altGr = typeof e.getModifierState == "function" && e.getModifierState("AltGraph");
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", altGr && "AltGr", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean).join("+") || t("diag.none", "nenhum");
  const side = state.keyState.leftAlt ? t("diag.altLeft", "da esquerda") : state.keyState.rightAlt ? t("diag.altRight", "da direita") : t("diag.none", "nenhum");
  let result;
  const shadowed = !entry && combo ? sc.map.get(combo) : null;
  if (entry) {
    result = t("diag.key.shortcut", "atalho {combo} → {cmd}", { combo: sc.display(combo), cmd: cmdLabel(entry) });
  } else if (shadowed && e.key.length == 1) {
    result = t("diag.key.typesWins", "digita “{key}” (neste teclado o caractere vence o atalho {combo}, {cmd})", { key: e.key, combo: sc.display(combo), cmd: cmdLabel(shadowed) });
  } else if (e.key.length == 1) {
    result = t("diag.key.types", "digita “{key}”", { key: e.key }) +
      (combo && combo.includes("+") ? t("diag.key.notRibbon", " ({combo} não é atalho da faixa)", { combo: sc.display(combo) }) : "");
  } else {
    result = combo ? t("diag.key.noRibbon", "{combo}: sem atalho da faixa", { combo: sc.display(combo) }) : t("diag.key.none", "sem atalho");
  }
  return t("diag.key.line", "key “{key}” · code {code} · modificadores: {mods} · Alt {side} → {result}", { key: e.key, code: e.code || "?", mods, side, result });
}

function renderKeyLog() {
  const ol = $("keylog");
  ol.replaceChildren(...state.keyLog.map(line => el("li", { text: line })));
}

function setupKeyProbe() {
  const input = $("keyprobe");
  input.addEventListener("keydown", e => {
    FaixaShortcuts.track(state.keyState, e, true);
    if (MODIFIER_KEYS.includes(e.key) || e.key == "Tab") {
      return;
    }
    e.preventDefault();
    state.keyLog.unshift(describeKey(e));
    state.keyLog.length = Math.min(state.keyLog.length, 8);
    renderKeyLog();
  });
  input.addEventListener("keyup", e => FaixaShortcuts.track(state.keyState, e, false));
  input.addEventListener("blur", () => (state.keyState = FaixaShortcuts.newKeyState()));
}

function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) {
      continue;
    }
    if (k == "class") {
      e.className = v;
    } else if (k == "text") {
      e.textContent = v;
    } else {
      e.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c != null) {
      e.append(typeof c == "string" ? document.createTextNode(c) : c);
    }
  }
  return e;
}

function flash(text) {
  const f = $("flash");
  f.textContent = text;
  f.hidden = !text;
}

function platformKey() {
  const p = (state.diag && state.diag.app.platform) || "win";
  return p == "macosx" ? "mac" : p == "linux" ? "linux" : "win";
}

/** Mapa combinação → tecla do Thunderbird (levantamento ao vivo ou lista do código-fonte). */
function tbKeyMap() {
  const map = new Map();
  if (state.diag && Array.isArray(state.diag.keys) && state.diag.keys.length) {
    state.keySource = t("diag.keys.live", "Teclas levantadas ao vivo na janela de composição deste Thunderbird.");
    for (const k of state.diag.keys) {
      if (k.combo && !k.disabled && !map.has(k.combo)) {
        map.set(k.combo, { id: k.id, cmd: k.command });
      }
    }
    return map;
  }
  state.keySource = t("diag.keys.static", "Lista do Thunderbird 153 tirada do código-fonte. Abra uma mensagem nova e recarregue esta página para o levantamento ao vivo.");
  for (const k of TB153_KEYS[platformKey()] || []) {
    const combo = FaixaShortcuts.normalize([...k.mods, k.key].join("+"));
    if (combo && !map.has(combo)) {
      map.set(combo, { id: k.id, cmd: k.cmd });
    }
  }
  return map;
}

function tbLabel(tb) {
  const key = TB_ACTION[tb.cmd] ? tb.cmd : TB_ACTION[tb.id] ? tb.id : null;
  return key ? t("tb." + key, TB_ACTION[key]) : tb.cmd || tb.id || "?";
}

function tbSame(tb) {
  return TB_SAME[tb.cmd] || TB_SAME[tb.id] || null;
}

function cmdLabel(entry) {
  const meta = state.definition.commands[entry.cmd] || { label: entry.cmd };
  if (entry.cmd == "style" && entry.args) {
    const st = state.definition.styles.find(s => s.id == entry.args.value);
    return t("diag.style", "Estilo {name}", { name: st ? st.label : entry.args.value });
  }
  if (entry.cmd == "lineSpacing" && entry.args) {
    return t("diag.spacing", "Espaçamento {value}", { value: FaixaI18n.num(entry.args.value) });
  }
  return meta.label;
}

/** O que a tecla faz. where: "recipients" (no Para, Cc ou Cco) ou o corpo (o resto):
 * um atalho da faixa só conta no lugar dele (Ctrl+K verifica nomes no Para e continua
 * inserindo link no corpo). */
function outcome(text, wantCmd, profileMap, tbMap, where) {
  const combo = FaixaShortcuts.normalize(text);
  if (!combo) {
    return { st: "—", cls: "", text: t("diag.key.none", "sem atalho") };
  }
  const inRecipients = where == "recipients";
  let mine = profileMap.get(combo);
  if (mine && (mine.scope == "recipients") != inRecipients) {
    mine = null;
  }
  // Os atalhos do Thunderbird desta tabela são do corpo da mensagem.
  const tb = inRecipients ? null : tbMap.get(combo);
  if (mine) {
    const ok = !wantCmd || mine.cmd == wantCmd;
    let extra = "";
    if (tb) {
      extra = tbSame(tb) == mine.cmd ? t("diag.same", " (mesma função do Thunderbird)") : t("diag.instead", " — no lugar de: {action}", { action: tbLabel(tb) });
    }
    return { st: ok ? t("diag.st.ribbon", "faixa") : t("diag.st.ribbonOther", "faixa, outra ação"), cls: ok ? "ok" : "warn", text: cmdLabel(mine) + extra };
  }
  if (tb) {
    const same = wantCmd && tbSame(tb) == wantCmd;
    return { st: same ? t("diag.st.same", "igual") : t("diag.st.conflict", "conflito"), cls: same ? "ok" : "bad", text: t("diag.tb", "Thunderbird: {action}", { action: tbLabel(tb) }) };
  }
  const meta = wantCmd && state.definition.commands[wantCmd];
  if (meta && meta.phase) {
    return { st: t("diag.st.free", "livre"), cls: "warn", text: t("diag.freePhase", "tecla livre; comando previsto para a fase {n}", { n: meta.phase }) };
  }
  return { st: t("diag.st.free", "livre"), cls: "warn", text: t("diag.freeNone", "tecla livre, sem ação") };
}

function renderKeys() {
  const def = state.definition;
  const profileId = state.config.perfilAtalhos;
  const sc = new FaixaShortcuts(def, profileId, platformKey() == "mac");
  const tbMap = tbKeyMap();
  $("keys-source").textContent = state.keySource;
  const body = $("keytable").querySelector("tbody");
  body.replaceChildren();
  state.keyRows = [];
  for (const ref of def.officeReference) {
    const a = outcome(ref.office, ref.cmd, sc.map, tbMap, ref.where);
    const b = outcome(ref.officePtBr, ref.cmd, sc.map, tbMap, ref.where);
    state.keyRows.push({ ref, a, b });
    const cell = o => el("td", {}, el("span", { class: "st " + o.cls, text: o.st }), " ", o.text);
    body.append(el("tr", {},
      el("td", { text: ref.action }),
      el("td", {}, el("kbd", { text: ref.officeLabel || ref.office })),
      cell(a),
      el("td", {}, el("kbd", { text: ref.officePtBr })),
      cell(b)));
  }
}

function renderProfiles() {
  const sel = $("profile");
  sel.replaceChildren();
  for (const [id, p] of Object.entries(state.definition.shortcutProfiles)) {
    sel.append(el("option", { value: id, text: p.label }));
  }
  sel.value = state.config.perfilAtalhos;
  if (state.managed.perfilAtalhos) {
    sel.disabled = true;
    sel.title = t("diag.policy", "Definido pela política da organização");
  }
}

function renderEnv() {
  const d = state.diag;
  const dl = $("env");
  dl.replaceChildren();
  const add = (k, v) => dl.append(el("dt", { text: k }), el("dd", { text: v }));
  const bi = state.browserInfo;
  add("Thunderbird", bi ? `${bi.name} ${bi.version}${bi.buildID ? t("diag.build", " (build {id})", { id: bi.buildID }) : ""}` : `${d.app.name} ${d.app.version}`);
  add(t("diag.env.system", "Sistema e idioma"), `${d.app.platform} · ${d.app.locale}`);
  add(t("diag.env.addon", "Complemento"), `${state.manifest.name} ${state.manifest.version} · Manifest V${state.manifest.manifest_version}`);
  add(t("diag.env.experiment", "Experiment"), d.started ? t("diag.started", "iniciado") : t("diag.failed", "falhou: {reason}", { reason: d.startError || t("diag.unknownReason", "motivo desconhecido") }));
  const pref = state.config.idioma || "auto";
  add(t("diag.env.ribbonLocale", "Idioma da faixa"), t("diag.localeLine", "{locale} (preferência: {pref})", {
    locale: d.ribbonLocale || FaixaI18n.locale,
    pref: pref == "auto" ? t("diag.auto", "automática") : pref,
  }));
  const wins = d.windows || [];
  add(t("diag.env.windows", "Janelas de composição com a faixa"), wins.length
    ? wins.map(w => t("diag.win", "aba {id}: {state}{error}", {
      id: w.tabId,
      state: w.editorReady ? t("diag.win.ready", "editor pronto") : t("diag.win.loading", "editor carregando"),
      error: w.lastError ? t("diag.win.error", " — erro: {error}", { error: w.lastError }) : "",
    })).join("; ")
    : t("diag.win.none", "nenhuma aberta agora"));
  if (d.tbPrefs) {
    const fix = state.config.paragrafoSemEspaco !== false;
    add(t("diag.env.paragraph", "Formato Parágrafo do Thunderbird"), d.tbPrefs.paragraph
      ? t("diag.on", "ligado")
      : t("diag.para.off", "desligado em Configurações → Redação") + (fix ? t("diag.para.fix", "; a faixa usa parágrafos assim mesmo") : t("diag.para.br", "; Enter cria <br>")));
  }
  const major = parseInt(d.app.version, 10);
  if (major && major != 153) {
    add(t("diag.env.warn", "Atenção"), t("diag.version", "A faixa foi feita para o Thunderbird ESR 153; aqui roda o {version}.", { version: d.app.version }));
  }
}

function renderFonts() {
  const list = (state.diag.fonts && state.diag.fonts.list) || [];
  const q = $("fontfilter").value.trim().toLowerCase();
  const shown = q ? list.filter(f => f.toLowerCase().includes(q)) : list;
  $("fontcount").textContent = t("diag.fonts.count", "{n} fontes", { n: list.length }) + (q ? t("diag.fonts.filtered", ", {m} com “{q}”", { m: shown.length, q }) : "");
  const ul = $("fontlist");
  ul.replaceChildren();
  for (const name of shown.slice(0, 600)) {
    const li = el("li", { text: name, title: name });
    li.style.fontFamily = `"${name.replace(/"/g, "")}", sans-serif`;
    ul.append(li);
  }
}

/** Configuração para mostrar: das assinaturas, só nome e tamanho (o HTML pode ter imagens inteiras). */
function configForDisplay(config) {
  const out = Object.assign({}, config);
  // Assinaturas e Partes Rápidas: o tamanho do HTML, não o HTML (o relatório vai por e-mail).
  for (const key of ["assinaturas", "partesRapidas"]) {
    if (Array.isArray(out[key])) {
      out[key] = out[key].map(s => ({ id: s.id, nome: s.nome, gerenciada: !!s.gerenciada, html: t("diag.cfg.chars", "{n} caracteres", { n: FaixaI18n.num(String(s.html || "").length) }) }));
    }
  }
  return out;
}

function renderConfig() {
  const managedKeys = Object.keys(state.managed || {});
  const note = managedKeys.length
    ? "\n\n// " + t("diag.cfg.policy", "Definido pela política: {keys}", { keys: managedKeys.join(", ") })
    : "\n\n// " + t("diag.cfg.none", "Nenhuma política da organização aplicada a este complemento.");
  $("cfg").textContent = JSON.stringify(configForDisplay(state.config), null, 2) + note;
}

function renderResults() {
  const r = state.results;
  const table = $("results");
  if (!r) {
    return;
  }
  const ok = r.filter(x => x.ok).length;
  $("test-summary").textContent = t("diag.summary", "{ok} de {n} itens passaram.", { ok, n: r.length });
  const body = table.querySelector("tbody");
  body.replaceChildren();
  for (const x of r) {
    body.append(el("tr", {},
      el("td", {}, el("span", { class: "st " + (x.ok ? "ok" : "bad"), text: x.ok ? t("diag.ok", "ok") : t("diag.fail", "falhou") })),
      el("td", { text: x.label }),
      el("td", { text: x.detail })));
  }
  table.hidden = false;
}

async function refresh() {
  const [{ config, managed }, diag] = await Promise.all([loadConfig(), browser.faixa.getDiagnostics()]);
  state.config = config;
  state.managed = managed;
  state.diag = diag;
  renderEnv();
  renderProfiles();
  renderKeys();
  renderFonts();
  renderConfig();
}

async function runSelfTest() {
  const btn = $("run");
  btn.disabled = true;
  flash(t("diag.opening", "Abrindo uma mensagem de teste…"));
  let tab = null;
  try {
    tab = await browser.compose.beginNew({ isPlainText: false, subject: t("diag.subject", "Faixa de Opções — autoteste (pode fechar)") });
    flash(t("diag.running", "Executando o autoteste na mensagem de teste…"));
    state.results = await browser.faixa.runSelfTest(tab.id);
    renderResults();
    const failed = state.results.filter(x => !x.ok).length;
    flash(failed
      ? t("diag.failedN", "{n} item(ns) falharam. Use “Copiar relatório” e envie o texto.", { n: failed })
      : t("diag.allOk", "Todos os itens passaram."));
  } catch (e) {
    state.results = [{ id: "erro", label: t("diag.cantRun", "Não foi possível rodar o autoteste"), ok: false, detail: String((e && e.message) || e) }];
    renderResults();
    flash(t("diag.notRun", "O autoteste não rodou: {error}", { error: (e && e.message) || e }));
  } finally {
    if (tab) {
      try {
        await browser.tabs.remove(tab.id);
      } catch (e) {}
    }
    btn.disabled = false;
    await refresh().catch(() => {});
  }
}

function reportText() {
  const d = state.diag;
  const lines = [];
  const bi = state.browserInfo;
  const Y = v => FaixaI18n.yes(v);
  lines.push(t("diag.report.title", "Faixa de Opções — relatório de diagnóstico"));
  lines.push(t("diag.report.date", "Data: {date}", { date: formatDate(new Date()) }));
  lines.push(t("diag.report.tb", "Thunderbird: {version} · {platform} · {locale}", { version: bi ? bi.name + " " + bi.version : d.app.version, platform: d.app.platform, locale: d.app.locale }));
  lines.push(t("diag.report.addon", "Complemento: {version} · Manifest V{mv} · experiment {state}", {
    version: state.manifest.version,
    mv: state.manifest.manifest_version,
    state: d.started ? t("diag.started", "iniciado") : t("diag.report.failed", "falhou ({error})", { error: d.startError }),
  }));
  lines.push(t("diag.report.locale", "Idioma da faixa: {locale} (preferência: {pref})", { locale: d.ribbonLocale || FaixaI18n.locale, pref: state.config.idioma || "auto" }));
  if (d.tbPrefs) {
    lines.push(t("diag.report.prefs", "Preferências do Thunderbird: formato parágrafo {para} · Enter no parágrafo cria outro {crnewp}", {
      para: d.tbPrefs.paragraph ? t("diag.on", "ligado") : t("diag.off", "desligado"),
      crnewp: Y(d.tbPrefs.crNewP),
    }));
  }
  lines.push("");
  if (state.results) {
    const ok = state.results.filter(x => x.ok).length;
    lines.push(t("diag.report.test", "Autoteste: {ok}/{n}", { ok, n: state.results.length }));
    for (const x of state.results) {
      lines.push(`  [${x.ok ? t("diag.ok", "ok") : t("diag.report.FAIL", "FALHOU")}] ${x.label} — ${x.detail}`);
    }
  } else {
    lines.push(t("diag.report.noTest", "Autoteste: não executado"));
  }
  lines.push("");
  lines.push(t("diag.report.keys", "Atalhos (perfil {id}; {source})", { id: state.config.perfilAtalhos, source: state.keySource }));
  for (const { ref, a, b } of state.keyRows) {
    lines.push(`  ${ref.action}: ${ref.officeLabel || ref.office} → ${a.st}, ${a.text} | pt-BR ${ref.officePtBr} → ${b.st}, ${b.text}`);
  }
  if (state.keyLog.length) {
    lines.push("");
    lines.push(t("diag.report.keyLog", "Teste de teclado (mais recente primeiro):"));
    for (const line of state.keyLog) {
      lines.push("  " + line);
    }
  }
  lines.push("");
  const fonts = (d.fonts && d.fonts.list) || [];
  lines.push(t("diag.report.fonts", "Fontes: {n} · Calibri {calibri} · Carlito {carlito} · Aptos {aptos}", {
    n: fonts.length, calibri: Y(fonts.includes("Calibri")), carlito: Y(fonts.includes("Carlito")), aptos: Y(fonts.includes("Aptos")),
  }));
  lines.push("");
  lines.push(t("diag.report.cfg", "Configuração efetiva: {json}", { json: JSON.stringify(configForDisplay(state.config)) }));
  lines.push(t("diag.report.windows", "Janelas: {json}", { json: JSON.stringify(d.windows) }));
  return lines.join("\n");
}

async function copyReport() {
  const text = reportText();
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = el("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  flash(t("diag.copied", "Relatório copiado."));
}

async function main() {
  const page = await setupPage();
  state.definition = page.definition;
  try {
    state.browserInfo = await browser.runtime.getBrowserInfo();
  } catch (e) {}
  await refresh();
  $("run").addEventListener("click", runSelfTest);
  $("copy").addEventListener("click", copyReport);
  $("fontfilter").addEventListener("input", renderFonts);
  setupKeyProbe();
  $("profile").addEventListener("change", async e => {
    await saveUser({ perfilAtalhos: e.target.value });
    state.config.perfilAtalhos = e.target.value;
    renderKeys();
    renderConfig();
    flash(t("diag.profileSaved", "Perfil de atalhos salvo. Vale para as janelas de composição abertas e as próximas."));
  });
  // Ajuda → Atalhos de Teclado abre a página em #atalhos: com a página montada, vai até lá.
  if (location.hash == "#atalhos") {
    $("atalhos").scrollIntoView({ block: "start" });
  }
}

main().catch(e => flash(t("diag.loadFailed", "Erro ao carregar o diagnóstico: {error}", { error: (e && e.message) || e })));
