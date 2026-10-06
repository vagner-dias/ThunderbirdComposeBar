/* Opções da Faixa: preferências do usuário (storage.local), salvas na hora.
 * O que a política da organização define (storage.managed) aparece travado. */

import { loadConfig, saveUser, resetUser } from "../lib/config.js";
import { setupPage } from "./pagina.js";

/* global FaixaI18n */

const $ = id => document.getElementById(id);
const t = (key, text, vars) => FaixaI18n.t(key, text, vars);

/** Descrição de cada perfil de atalhos. */
const PROFILE_HELP = {
  "thunderbird-office": () => t("opt.profile.thunderbird-office",
    "Atalhos do Office que não brigam com os do Thunderbird: Ctrl+B, Ctrl+I e Ctrl+U valem para a palavra inteira, Ctrl+E centraliza, Ctrl+Alt+C e Ctrl+Alt+V copiam e colam a formatação."),
  "office-ptbr": () => t("opt.profile.office-ptbr",
    "Como no Office em português: Ctrl+N negrito, Ctrl+S sublinhado, Ctrl+B salva, Ctrl+T seleciona tudo. No corpo da mensagem, esses atalhos substituem os do Thunderbird."),
};

let page = null; // { config, managed, usuario, definition, locale }
let fonts = [];
// Barra de menus: não existe no macOS; sem escolha na faixa, vale o que o Thunderbird guardou.
let menubar = { available: true, hidden: false };

function flash(text) {
  const f = $("flash");
  f.textContent = text;
  f.hidden = !text;
  clearTimeout(flash.timer);
  if (text) {
    flash.timer = setTimeout(() => {
      f.hidden = true;
    }, 5000);
  }
}

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

/** A organização definiu esta opção? (fontePadrao vale inteira ou por campo) */
function isManaged(key, sub) {
  const m = page.managed || {};
  if (!(key in m)) {
    return false;
  }
  return sub ? m[key] == null || typeof m[key] != "object" || sub in m[key] : true;
}

function lock(control, managed) {
  control.disabled = managed;
  control.title = managed ? t("opt.locked", "Definido pela sua organização") : "";
}

/** Cada bloco mostra o cadeado se alguma opção dele veio da organização. */
function refreshLocks() {
  for (const box of document.querySelectorAll(".field, .check, .radios")) {
    const locked = !!box.querySelector("input:disabled, select:disabled");
    box.classList.toggle("locked", locked);
  }
}

function fontStack(name) {
  const fb = (page.definition.fontFallbacks || {})[name] || "sans-serif";
  return `"${String(name).replace(/"/g, "")}", ${fb}`;
}

function renderPreview() {
  const fp = page.config.fontePadrao || {};
  const p = $("font-preview");
  p.style.fontFamily = fontStack(fp.familia || "Calibri");
  p.style.fontSize = (fp.tamanhoPt || 11) + "pt";
  const name = fp.familia || "";
  const installed = !fonts.length || fonts.some(f => f.toLowerCase() == name.toLowerCase());
  $("font-note").textContent = installed
    ? t("opt.font.help", "Vale para mensagens novas, respostas e encaminhamentos. Rascunhos e modelos continuam com a fonte com que foram salvos.")
    : t("opt.font.missing", "A fonte {name} não está instalada neste computador: aqui aparece a substituta. Quem receber a mensagem vê {name} se tiver a fonte.", { name });
}

function render() {
  const c = page.config;
  const def = page.definition;

  $("idioma").value = FaixaI18n.LOCALES.includes(c.idioma) ? c.idioma : "auto";
  lock($("idioma"), isManaged("idioma"));

  const tab = $("abaInicial");
  if (!tab.options.length) {
    tab.replaceChildren(...def.tabs.map(x => el("option", { value: x.id, text: x.label })));
  }
  tab.value = def.tabs.some(x => x.id == c.abaInicial) ? c.abaInicial : def.tabs[0].id;
  lock(tab, isManaged("abaInicial"));

  $("recolhida").checked = !!c.recolhida;
  lock($("recolhida"), isManaged("recolhida"));
  $("mostrarBarra").checked = c.ocultarBarraThunderbird === false;
  lock($("mostrarBarra"), isManaged("ocultarBarraThunderbird"));
  $("menus-box").hidden = !menubar.available;
  $("mostrarMenus").checked = typeof c.ocultarBarraMenus == "boolean" ? !c.ocultarBarraMenus : !menubar.hidden;
  lock($("mostrarMenus"), isManaged("ocultarBarraMenus"));
  $("visualizacao").checked = c.visualizacaoDinamica !== false;
  lock($("visualizacao"), isManaged("visualizacaoDinamica"));

  const fp = c.fontePadrao || {};
  if (document.activeElement != $("familia")) {
    $("familia").value = fp.familia || "";
  }
  lock($("familia"), isManaged("fontePadrao", "familia"));
  const size = $("tamanho");
  const sizes = [...new Set([...(def.fontSizes || []), fp.tamanhoPt].filter(Boolean))].sort((a, b) => a - b);
  if ([...size.options].map(o => o.value).join() != sizes.join()) {
    size.replaceChildren(...sizes.map(n => el("option", { value: String(n), text: FaixaI18n.num(n) })));
  }
  size.value = String(fp.tamanhoPt || 11);
  lock(size, isManaged("fontePadrao", "tamanhoPt"));
  renderPreview();

  $("paragrafo").checked = c.paragrafoSemEspaco !== false;
  lock($("paragrafo"), isManaged("paragrafoSemEspaco"));

  // Os botões de opção são montados uma vez só: refazer a cada mudança tiraria o foco do teclado.
  const box = $("perfis");
  const managedProfile = isManaged("perfilAtalhos");
  if (!box.childElementCount) {
    for (const [id, p] of Object.entries(def.shortcutProfiles || {})) {
      const input = el("input", { type: "radio", name: "perfil", id: "perfil-" + id, value: id, "aria-describedby": "perfil-" + id + "-help" });
      input.addEventListener("change", () => {
        if (input.checked) {
          save({ perfilAtalhos: id });
        }
      });
      const help = PROFILE_HELP[id] ? PROFILE_HELP[id]() : "";
      box.append(el("div", { class: "radio" },
        input,
        el("label", { for: input.id }, el("span", { class: "rlabel", text: p.label }), help ? el("span", { class: "help", id: "perfil-" + id + "-help", text: help }) : null)));
    }
  }
  for (const input of box.querySelectorAll("input")) {
    input.checked = c.perfilAtalhos == input.value;
    input.disabled = managedProfile;
  }
  box.title = managedProfile ? t("opt.locked", "Definido pela sua organização") : "";
  refreshLocks();

  // As assinaturas da organização aparecem (travadas) na página Assinaturas.
  $("policy").hidden = !Object.keys(page.managed || {}).some(k => !["suporte", "assinaturas", "assinaturaPadrao", "partesRapidas"].includes(k));
}

async function reload() {
  const { config, managed, usuario } = await loadConfig();
  Object.assign(page, { config, managed, usuario });
  render();
}

/** Uma gravação de cada vez: duas mudanças rápidas não se sobrepõem (cada uma lê,
 * junta e grava as preferências inteiras). */
let saving = Promise.resolve();

function save(patch, message) {
  saving = saving.then(async () => {
    try {
      await saveUser(patch);
      flash(message || t("opt.saved", "Salvo. Já vale nas mensagens abertas."));
    } catch (e) {
      flash(t("opt.saveFailed", "Não foi possível salvar: {error}", { error: (e && e.message) || e }));
    }
  });
  return saving;
}

function bind() {
  $("idioma").addEventListener("change", async e => {
    await save({ idioma: e.target.value });
    // A página muda de idioma junto com a faixa.
    location.reload();
  });
  $("abaInicial").addEventListener("change", e => save({ abaInicial: e.target.value }, t("opt.saved.next", "Salvo. Vale nas próximas mensagens.")));
  $("recolhida").addEventListener("change", e => save({ recolhida: e.target.checked }, t("opt.saved.next", "Salvo. Vale nas próximas mensagens.")));
  $("mostrarBarra").addEventListener("change", e => save({ ocultarBarraThunderbird: !e.target.checked }));
  $("mostrarMenus").addEventListener("change", e => save({ ocultarBarraMenus: !e.target.checked }));
  $("visualizacao").addEventListener("change", e => save({ visualizacaoDinamica: e.target.checked }));
  $("paragrafo").addEventListener("change", e => save({ paragrafoSemEspaco: e.target.checked }));
  const family = $("familia");
  const saveFamily = () => {
    const name = family.value.trim().replace(/^["']|["']$/g, "");
    const current = (page.config.fontePadrao || {}).familia || "";
    if (!name) {
      family.value = current;
      return;
    }
    if (name != current) {
      page.config.fontePadrao = Object.assign({}, page.config.fontePadrao, { familia: name });
      renderPreview();
      save({ fontePadrao: { familia: name } }, t("opt.saved.font", "Salvo. Vale nas próximas mensagens e nas abertas que ainda não foram mexidas."));
    }
  };
  family.addEventListener("change", saveFamily);
  family.addEventListener("keydown", e => {
    if (e.key == "Enter") {
      e.preventDefault();
      saveFamily();
    }
  });
  $("tamanho").addEventListener("change", e => {
    const n = Number(e.target.value);
    page.config.fontePadrao = Object.assign({}, page.config.fontePadrao, { tamanhoPt: n });
    renderPreview();
    save({ fontePadrao: { tamanhoPt: n } }, t("opt.saved.font", "Salvo. Vale nas próximas mensagens e nas abertas que ainda não foram mexidas."));
  });
  $("reset").addEventListener("click", async () => {
    if (!window.confirm(t("opt.reset.confirm", "Voltar todas as opções da faixa ao padrão? As suas assinaturas e Partes Rápidas continuam."))) {
      return;
    }
    await saving;
    await resetUser();
    location.reload();
  });
  // Mudança feita em outro lugar (faixa recolhida numa mensagem, barra do Thunderbird).
  browser.storage.onChanged.addListener((changes, area) => {
    if (area == "managed" || (area == "local" && changes.usuario)) {
      reload().catch(() => {});
    }
  });
}

async function main() {
  page = await setupPage();
  const manifest = browser.runtime.getManifest();
  $("version").textContent = t("opt.version", "Faixa de Opções {version}", { version: manifest.version });
  try {
    menubar = await browser.faixa.getMenubarState();
  } catch (e) {}
  render();
  bind();
  try {
    fonts = await browser.faixa.listFonts();
    $("fontes").replaceChildren(...fonts.map(name => el("option", { value: name })));
    renderPreview();
  } catch (e) {
    fonts = [];
  }
}

main().catch(e => flash(t("opt.loadFailed", "Erro ao carregar as opções: {error}", { error: (e && e.message) || e })));
