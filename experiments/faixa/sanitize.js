/* Faixa de Opções — limpeza do HTML das assinaturas.
 *
 * As assinaturas vêm do usuário, da política da organização ou do Thunderbird
 * (importadas) e entram no corpo da mensagem e no editor das Opções. Só passa o que
 * uma assinatura usa: texto, formatação, tabelas, links (http, https, mailto, tel) e
 * imagens (http, https, cid e data: de PNG, JPEG, GIF e WebP). Scripts, eventos
 * (onclick...), formulários, iframes e SVG saem. Do style ficam só as propriedades de
 * texto, cor, caixa e tabela, lidas pelo próprio CSS (escapes como u\72l( não passam),
 * e sem nenhuma função que busque arquivo (url, image-set...).
 * O sanitizador do Gecko (nsIParserUtils) tiraria também as imagens data:, que é
 * como a assinatura guarda o logotipo, por isso a lista aqui é própria.
 * Roda no documento de destino (DOMParser: nada executa nem carrega enquanto limpa). */

"use strict";

var FaixaSanitizer = {
  KEEP: new Set([
    "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
    "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd",
    "li", "mark", "ol", "p", "pre", "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "table",
    "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "var", "wbr",
  ]),
  // Saem com tudo o que têm dentro.
  DROP: new Set([
    "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "select",
    "option", "textarea", "link", "meta", "base", "svg", "math", "template", "noscript", "audio", "video", "source",
    "track", "canvas", "title", "head", "dialog", "portal", "noembed", "noframes", "xmp", "plaintext",
  ]),
  ATTRS: new Set([
    "style", "title", "dir", "lang", "align", "valign", "width", "height", "border", "cellpadding", "cellspacing",
    "colspan", "rowspan", "bgcolor", "color", "face", "size", "alt", "start", "type",
  ]),
  // Propriedades de estilo aceitas (as longas: o CSS expande margin, border, font...).
  STYLE: /^(font(-.*)?|color|background-color|text-(align|decoration.*|indent|transform|shadow)|letter-spacing|word-spacing|white-space|line-height|vertical-align|direction|unicode-bidi|margin(-.*)?|padding(-.*)?|border(-.*)?|width|height|min-width|max-width|min-height|max-height|display|float|clear|list-style-(type|position)|table-layout|border-collapse|border-spacing|caption-side|empty-cells|overflow-wrap|word-break|hyphens|column-gap)$/,
  STYLE_FN: /\b(url|image-set|-webkit-image-set|image|element|cross-fade|expression|env|var|attr|paint|src)\s*\(/i,
  DISPLAY: /^(inline|block|inline-block|table|table-row|table-cell|table-row-group|table-header-group|table-footer-group|table-column|table-column-group|table-caption|list-item|none)$/,

  /** HTML → DocumentFragment limpo, no documento doc. win: a janela que dá o DOMParser,
   * quando doc é inerte (sem janela, onde as imagens não carregam). */
  clean(html, doc, win = doc.defaultView) {
    const Parser = win.DOMParser;
    const src = new Parser().parseFromString("<!doctype html><html><body>" + String(html || "") + "</body></html>", "text/html");
    const ctx = { doc, scratch: src.createElement("span") };
    const frag = doc.createDocumentFragment();
    for (const child of [...src.body.childNodes]) {
      const n = this.node(child, ctx, 0);
      if (n) {
        frag.append(n);
      }
    }
    return frag;
  },

  /** HTML → HTML limpo (texto). */
  toHTML(html, doc, win = doc.defaultView) {
    const box = doc.createElement("div");
    box.append(this.clean(html, doc, win));
    return box.innerHTML;
  },

  /** style limpo: só as propriedades aceitas, sem funções que carregam coisas. "" se nada sobra. */
  style(value, ctx) {
    const st = ctx.scratch.style;
    st.cssText = String(value || "");
    for (const prop of [...Array.from({ length: st.length }, (x, i) => st.item(i))]) {
      const v = st.getPropertyValue(prop);
      const ok = this.STYLE.test(prop) && !this.STYLE_FN.test(v) && (prop != "display" || this.DISPLAY.test(v.trim()));
      if (!ok) {
        st.removeProperty(prop);
      }
    }
    const out = st.cssText;
    st.cssText = "";
    return out;
  },

  node(node, ctx, depth) {
    const doc = ctx.doc;
    if (node.nodeType == 3) {
      return doc.createTextNode(node.data);
    }
    if (node.nodeType != 1 || depth > 60) {
      return null;
    }
    const tag = node.localName;
    if (this.DROP.has(tag)) {
      return null;
    }
    const kids = target => {
      for (const c of [...node.childNodes]) {
        const n = this.node(c, ctx, depth + 1);
        if (n) {
          target.append(n);
        }
      }
      return target;
    };
    if (!this.KEEP.has(tag)) {
      return kids(doc.createDocumentFragment()); // tag desconhecida: fica o conteúdo
    }
    const el = doc.createElement(tag);
    for (const { name, value } of [...node.attributes]) {
      const n = name.toLowerCase();
      const v = String(value).trim();
      if (n == "href") {
        if (tag == "a" && /^(https?:|mailto:|tel:)/i.test(v)) {
          el.setAttribute("href", v);
        }
        continue;
      }
      if (n == "src") {
        if (tag == "img" && /^(https?:|cid:|data:image\/(png|jpe?g|gif|webp)(;[^;,]*)*;base64,)/i.test(v)) {
          el.setAttribute("src", v);
        }
        continue;
      }
      if (!this.ATTRS.has(n)) {
        continue;
      }
      if (n == "style") {
        const css = this.style(v, ctx);
        if (css) {
          el.setAttribute("style", css);
        }
        continue;
      }
      el.setAttribute(n, v);
    }
    if (tag == "img" && !el.hasAttribute("src")) {
      return null; // imagem sem endereço aceito não mostra nada
    }
    return kids(el);
  },

  /** Tem imagem de fora (http/https)? O Thunderbird só carrega imagem de fora na
   * composição com o conteúdo remoto liberado para a mensagem. */
  hasRemoteImages(root) {
    return [...root.querySelectorAll("img[src]")].some(img => /^https?:/i.test(img.getAttribute("src").trim()));
  },

  /** O mesmo, lendo o HTML num documento inerte (antes de criar as imagens de verdade). */
  remoteImagesIn(html, doc) {
    const Parser = doc.defaultView.DOMParser;
    return this.hasRemoteImages(new Parser().parseFromString(String(html || ""), "text/html"));
  },

  /** Documento sem janela, para montar árvores que não carregam nada (prévia, texto). */
  inertDocument(win) {
    return new win.DOMParser().parseFromString("<!doctype html><html><body></body></html>", "text/html");
  },

  /** Mesclar Formatação, como no Word: o HTML copiado sem a formatação de origem. Passa
   * pela limpeza de sempre e então ficam só o texto, os parágrafos e as quebras de linha,
   * o negrito, o itálico e o sublinhado (das marcas ou do style, como no Google Docs), os
   * links, as listas, as tabelas e as imagens. Fontes, tamanhos, cores, fundos, margens,
   * alinhamentos e classes saem; títulos, citações e outros blocos viram parágrafos.
   * Devolve { html, inline, remote }: inline quando tudo cabe numa linha (entra no meio
   * do parágrafo do cursor); remote quando há imagem de fora (http, https). */
  merge(html, win) {
    const inert = this.inertDocument(win);
    const src = this.clean(html, inert, win);
    const out = inert.createElement("div");
    const scratch = inert.createElement("span");
    const BLOCK = /^(p|div|h[1-6]|blockquote|address|center|pre|dd|dt|dl|caption)$/;
    // Ênfase de um elemento: a marca (b, strong, i, em, u, ins) e o style, que vence a marca
    // (o Google Docs embrulha tudo num <b style="font-weight: normal">).
    const emphasis = (el, f) => {
      const tag = el.localName;
      const next = { b: f.b || tag == "b" || tag == "strong", i: f.i || tag == "i" || tag == "em", u: f.u || tag == "u" || tag == "ins" };
      scratch.setAttribute("style", el.getAttribute("style") || "");
      const st = scratch.style;
      if (st.fontWeight) {
        next.b = st.fontWeight == "bold" || st.fontWeight == "bolder" || parseInt(st.fontWeight, 10) >= 600;
      }
      if (st.fontStyle) {
        next.i = /^(italic|oblique)/.test(st.fontStyle);
      }
      const line = st.textDecorationLine || st.textDecoration;
      if (line) {
        next.u = /underline/.test(line);
      }
      return next;
    };
    const wrap = (node, f, href) => {
      let n = node;
      for (const [on, tag] of [[f.u, "u"], [f.i, "i"], [f.b, "b"]]) {
        if (on) {
          const el = inert.createElement(tag);
          el.append(n);
          n = el;
        }
      }
      if (href) {
        const a = inert.createElement("a");
        a.setAttribute("href", href);
        a.append(n);
        n = a;
      }
      return n;
    };
    const image = img => {
      const el = inert.createElement("img");
      for (const name of ["src", "alt", "width", "height"]) {
        if (img.hasAttribute(name)) {
          el.setAttribute(name, img.getAttribute(name));
        }
      }
      return el;
    };
    // Conteúdo de linha (num parágrafo, item de lista ou célula): blocos de dentro viram
    // quebras de linha; listas de dentro de um item continuam listas.
    const inline = (node, target, f, href, ctx) => {
      if (node.nodeType == 3) {
        const text = node.data;
        if (ctx.pre && text.includes("\n")) {
          text.split("\n").forEach((line, k) => {
            if (k) {
              target.append(inert.createElement("br"));
            }
            if (line) {
              target.append(wrap(inert.createTextNode(line), f, href));
            }
          });
        } else if (text) {
          target.append(wrap(inert.createTextNode(text), f, href));
        }
        return;
      }
      if (node.nodeType != 1) {
        return;
      }
      const tag = node.localName;
      if (tag == "br") {
        target.append(inert.createElement("br"));
        return;
      }
      if (tag == "img") {
        target.append(wrap(image(node), {}, href));
        return;
      }
      if ((tag == "ul" || tag == "ol") && ctx.allowLists) {
        target.append(list(node, f));
        return;
      }
      if (tag == "table" || tag == "hr") {
        return; // tabela dentro de um item ou célula: só o texto (pelos filhos, abaixo)
      }
      const block = BLOCK.test(tag) || tag == "li" || tag == "ul" || tag == "ol" || tag == "tr";
      const lineBreak = () => {
        if (block && target.lastChild && target.lastChild.localName != "br") {
          target.append(inert.createElement("br"));
        }
      };
      lineBreak();
      const link = tag == "a" && node.hasAttribute("href") ? node.getAttribute("href") : href;
      const g = emphasis(node, f);
      const sub = Object.assign({}, ctx, { pre: ctx.pre || tag == "pre" });
      for (const c of [...node.childNodes]) {
        inline(c, target, g, link, sub);
      }
      lineBreak();
    };
    const list = (node, f) => {
      const el = inert.createElement(node.localName);
      if (node.localName == "ol" && /^\d+$/.test(node.getAttribute("start") || "")) {
        el.setAttribute("start", node.getAttribute("start"));
      }
      for (const c of [...node.childNodes]) {
        if (c.nodeType == 1 && c.localName == "li") {
          const li = inert.createElement("li");
          for (const k of [...c.childNodes]) {
            inline(k, li, emphasis(c, f), null, { allowLists: true });
          }
          while (li.lastChild && li.lastChild.localName == "br") {
            li.lastChild.remove();
          }
          el.append(li);
        } else if (c.nodeType == 1 && (c.localName == "ul" || c.localName == "ol")) {
          // Lista dentro de lista sem <li> (HTML de alguns programas): fica no último item.
          if (el.lastChild) {
            el.lastChild.append(list(c, f));
          }
        }
      }
      return el;
    };
    const table = node => {
      const el = inert.createElement("table");
      for (const name of ["border", "cellpadding", "cellspacing"]) {
        if (node.hasAttribute(name)) {
          el.setAttribute(name, node.getAttribute(name));
        }
      }
      const body = inert.createElement("tbody");
      for (const tr of node.querySelectorAll("tr")) {
        if (tr.closest("table") != node) {
          continue;
        }
        const row = inert.createElement("tr");
        for (const cell of tr.children) {
          if (cell.localName != "td" && cell.localName != "th") {
            continue;
          }
          const c = inert.createElement(cell.localName);
          for (const name of ["colspan", "rowspan"]) {
            if (cell.hasAttribute(name)) {
              c.setAttribute(name, cell.getAttribute(name));
            }
          }
          for (const k of [...cell.childNodes]) {
            inline(k, c, emphasis(cell, {}), null, {});
          }
          while (c.lastChild && c.lastChild.localName == "br") {
            c.lastChild.remove();
          }
          row.append(c);
        }
        body.append(row);
      }
      el.append(body);
      return el;
    };
    // Fluxo de primeiro nível: blocos viram parágrafos; texto solto entra no parágrafo atual.
    let para = null;
    const flush = () => {
      if (para) {
        while (para.lastChild && para.lastChild.localName == "br") {
          para.lastChild.remove();
        }
        const text = para.textContent;
        if (/[^ \t\n\r\f]/.test(text) || para.querySelector("img")) {
          // Linha só com &nbsp; (a linha em branco do Word): parágrafo vazio.
          if (!text.replace(/ /g, "").trim() && !para.querySelector("img")) {
            para.replaceChildren(inert.createElement("br"));
          }
          out.append(para);
        }
        para = null;
      }
    };
    const flow = (node, f, href) => {
      if (node.nodeType == 3) {
        para = para || inert.createElement("p");
        inline(node, para, f, href, {});
        return;
      }
      if (node.nodeType != 1) {
        return;
      }
      const tag = node.localName;
      if (tag == "ul" || tag == "ol") {
        flush();
        out.append(list(node, f));
        return;
      }
      if (tag == "table") {
        flush();
        out.append(table(node));
        return;
      }
      if (tag == "hr") {
        flush();
        out.append(inert.createElement("hr"));
        return;
      }
      if (BLOCK.test(tag) || tag == "li") {
        flush();
        if (tag == "pre") {
          para = inert.createElement("p");
          inline(node, para, f, href, { pre: true });
          flush();
          return;
        }
        const g = emphasis(node, f);
        for (const c of [...node.childNodes]) {
          flow(c, g, href);
        }
        flush();
        return;
      }
      if (tag == "br" || tag == "img" || !node.childNodes.length) {
        para = para || inert.createElement("p");
        inline(node, para, f, href, {});
        return;
      }
      // Elemento de linha (span, font, a, b...): os filhos seguem no fluxo com a ênfase dele.
      const link = tag == "a" && node.hasAttribute("href") ? node.getAttribute("href") : href;
      const g = emphasis(node, f);
      for (const c of [...node.childNodes]) {
        flow(c, g, link);
      }
    };
    for (const c of [...src.childNodes]) {
      flow(c, {}, null);
    }
    flush();
    const remote = this.hasRemoteImages(out);
    const only = out.children.length == 1 && out.firstElementChild.localName == "p" ? out.firstElementChild : null;
    if (only) {
      return { html: only.innerHTML, inline: true, remote };
    }
    return { html: out.innerHTML, inline: false, remote };
  },
};
