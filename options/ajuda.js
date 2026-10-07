/* Ajuda da Faixa de Opções: o guia (no HTML, traduzido por data-i18n) e o contato do
 * suporte que a organização definiu por política (suporte: nome, e-mail, telefone, portal). */

import { setupPage } from "./pagina.js";
import { webURL } from "../lib/config.js";

/* global FaixaI18n */

const $ = id => document.getElementById(id);
const t = (key, text, vars) => FaixaI18n.t(key, text, vars);

function showSupport(s) {
  if (!s || typeof s != "object") {
    return;
  }
  const list = $("sup-list");
  const add = (label, value, href) => {
    if (!value) {
      return;
    }
    const dd = document.createElement("dd");
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = value;
      a.target = "_blank";
      a.rel = "noopener";
      dd.append(a);
    } else {
      dd.textContent = value;
    }
    const dt = document.createElement("dt");
    dt.textContent = label;
    list.append(dt, dd);
  };
  add(t("support.name", "Quem atende"), s.nome);
  add(t("support.email", "E-mail"), s.email, s.email ? "mailto:" + s.email : null);
  add(t("support.phone", "Telefone"), s.telefone, s.telefone ? "tel:" + String(s.telefone).replace(/[^\d+]/g, "") : null);
  const portal = webURL(s.portal);
  add(t("support.portal", "Portal"), portal, portal);
  $("suporte").hidden = !list.children.length;
}

async function main() {
  const loaded = await setupPage();
  $("version").textContent = t("opt.version", "Faixa de Opções {version}", { version: browser.runtime.getManifest().version });
  showSupport(loaded.config.suporte);
}

main().catch(e => console.error("[Faixa] ajuda", e));
