/* Idioma das páginas do complemento (Opções da Faixa e diagnóstico): o mesmo da
 * faixa. O texto em pt-BR fica no HTML; em outro idioma, cada elemento com
 * data-i18n recebe a tradução de ribbon/locales/<idioma>.json (seção "strings"). */

import { loadConfig } from "../lib/config.js";

/* global FaixaI18n */

async function readJSON(path) {
  const r = await fetch(browser.runtime.getURL(path));
  return r.json();
}

/** Carrega configuração, definição e idioma; traduz o documento. */
export async function setupPage() {
  const [loaded, base] = await Promise.all([loadConfig(), readJSON("ribbon/definition.json")]);
  const locale = FaixaI18n.pick(loaded.config.idioma, browser.i18n.getUILanguage());
  let overlay = null;
  if (locale != "pt-BR") {
    try {
      overlay = await readJSON("ribbon/locales/" + locale + ".json");
    } catch (e) {
      console.error("[Faixa] idioma", locale, e);
    }
  }
  FaixaI18n.use(locale, overlay);
  translateDocument(document);
  return Object.assign(loaded, { definition: FaixaI18n.localize(base, overlay), locale });
}

/** Troca os textos marcados (data-i18n, data-i18n-title, data-i18n-placeholder,
 * data-i18n-aria-label). Em pt-BR nada muda: o HTML já é o texto de origem. */
export function translateDocument(doc) {
  doc.documentElement.lang = FaixaI18n.locale;
  if (FaixaI18n.locale == "pt-BR") {
    return;
  }
  for (const el of doc.querySelectorAll("[data-i18n]")) {
    el.textContent = FaixaI18n.t(el.dataset.i18n, el.textContent);
  }
  // Atalhos escritos na página (Ctrl+F1...): com os nomes de tecla do idioma.
  for (const el of doc.querySelectorAll("[data-i18n-keys]")) {
    el.textContent = FaixaI18n.keys(el.textContent);
  }
  for (const [data, attr] of [["i18nTitle", "title"], ["i18nPlaceholder", "placeholder"], ["i18nAriaLabel", "aria-label"]]) {
    const sel = "[data-" + data.replace(/[A-Z]/g, c => "-" + c.toLowerCase()) + "]";
    for (const el of doc.querySelectorAll(sel)) {
      el.setAttribute(attr, FaixaI18n.t(el.dataset[data], el.getAttribute(attr) || ""));
    }
  }
}

/** Data e hora no idioma da página. */
export function formatDate(date) {
  return date.toLocaleString(FaixaI18n.locale);
}
