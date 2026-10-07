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
};
