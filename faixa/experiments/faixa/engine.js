/* Faixa de Opções — motor de edição.
 *
 * Executa os comandos no editor da mensagem sempre por meio do editor
 * (execCommand e métodos transacionais do nsIHTMLEditor), dentro de
 * beginTransaction/endTransaction: cada comando da faixa vira um único passo
 * de Ctrl+Z. Nada aqui altera o DOM do corpo por fora do editor, exceto a
 * preparação inicial (fonte padrão) e a normalização no momento do envio.
 *
 * O "host" entrega: editorDoc, editorWin, editor (nsIHTMLEditor ou simulador),
 * isHTML(), loadAgentSheet(id, css), removeAgentSheet(id), nativeCommand(cmd),
 * focusEditor(), getZoom(), setZoom(n). */

"use strict";

var FAIXA_BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "address",
  "blockquote", "td", "th", "dd", "dt", "body",
]);
var FAIXA_HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
/* Elementos de bloco no primeiro nível do corpo (o resto é texto solto e inline). */
var FAIXA_TOP_BLOCKS = new Set([
  ...FAIXA_BLOCK_TAGS, "ul", "ol", "dl", "table", "hr", "figure", "section", "article", "header",
  "footer", "nav", "main", "aside", "form", "fieldset", "details", "center", "menu",
]);
/* Blocos que recebem formatação de parágrafo (limpar, pincel). Células, itens de
 * lista e citações ficam de fora: perder o style deles desmonta tabelas e listas. */
var FAIXA_PARA_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "address"]);
/* Visualização Dinâmica: acima disso, só o clique aplica (sem prévia). */
var FAIXA_PREVIEW_MAX_TEXTS = 500;
var FAIXA_PREVIEW_MAX_BLOCKS = 100;
var FAIXA_HTML_NS = "http://www.w3.org/1999/xhtml";
/* O que ocupa lugar num bloco mesmo sem texto (um parágrafo só com isso não é vazio). */
var FAIXA_VISIBLE_EMPTY = "br, img, hr, table, input, textarea, select, button, video, audio, iframe, object, embed, svg, canvas, math";
var FAIXA_FOREIGN = 'blockquote[type="cite"], .moz-forward-container, .moz-signature';
var FAIXA_WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;
var FAIXA_ZWSP = "​";

var FAIXA_PAINTER_CURSOR =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
      '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      '<g stroke="#fff" stroke-width="4"><path d="M6 5v18M3.5 5h5M3.5 23h5"/></g>' +
      '<g stroke="#fff" stroke-width="5" transform="translate(11 0) scale(0.84)"><path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/></g>' +
      '<g stroke="#111" stroke-width="1.6"><path d="M6 5v18M3.5 5h5M3.5 23h5"/></g>' +
      '<g stroke="#111" stroke-width="2" transform="translate(11 0) scale(0.84)"><path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/></g>' +
      "</g></svg>"
  );

/* Folhas de agente: só afetam a exibição no editor, nunca o HTML enviado. */
var FAIXA_SHEETS = {
  // Só nos parágrafos do autor: citação, encaminhada e assinatura ficam como vieram.
  paragraph: 'p:not(:is(blockquote[type="cite"], .moz-forward-container, .moz-signature) p) { margin-block: 0; }',
  painter: `html, html * { cursor: url("${FAIXA_PAINTER_CURSOR}") 6 14, text !important; }`,
  marks:
    ":is(p, h1, h2, h3, h4, h5, h6, li, pre, address, dd, dt)::after," +
    " div:not(:has(> :is(p, div, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6, pre)))::after" +
    ' { content: "\\00B6"; color: #2F6FD1; font: normal normal 400 11pt "Segoe UI", Arial, sans-serif;' +
    " text-decoration: none; margin-inline-start: 1px; }",
  // Visualização Dinâmica: a seleção sai da tela (a cor do sistema esconderia a cor e o
  // realce da prévia) e um cinza translúcido, como o do Word, marca o trecho.
  preview: "::highlight(faixa-preview) { background-color: rgba(120, 120, 120, 0.3); }",
};

var FaixaEngine = class {
  /** Formato copiado pelo pincel: vale entre janelas de composição. */
  static painterClipboard = null;

  constructor(host, definition, config) {
    this.host = host;
    this.def = definition;
    this.config = config || {};
    this.listeners = new Set();
    this.painterMode = 0; // 0 desligado, 1 uma vez, 2 travado
    this.marks = false;
    this.zwsp = new Set();
    this.state = { editorReady: false };
    this.timer = 0;
    this.disposers = [];
    this.lastError = null;
    this.pv = null; // Visualização Dinâmica em curso (ver preview)
  }

  get doc() {
    return this.host.editorDoc;
  }

  get win() {
    return this.host.editorWin;
  }

  get editor() {
    return this.host.editor;
  }

  /* ------------------------------------------------------------------ */
  /* ciclo de vida                                                        */
  /* ------------------------------------------------------------------ */

  attach() {
    const doc = this.doc;
    const on = (target, type, fn, capture = false) => {
      target.addEventListener(type, fn, capture);
      this.disposers.push(() => target.removeEventListener(type, fn, capture));
    };
    const soon = () => this.scheduleState();
    // Tecla, clique, colar, arrastar ou composição no corpo: a Visualização Dinâmica
    // sai antes (na captura), e a ação acontece no texto de verdade.
    const stopPreview = () => this.endPreview();
    for (const type of ["keydown", "mousedown", "paste", "drop", "dragstart", "compositionstart", "beforeinput"]) {
      on(doc, type, stopPreview, true);
    }
    // Com uma composição do IME aberta (japonês, chinês...), o texto dela não pode mudar de nó.
    on(doc, "compositionstart", () => (this.composing = true), true);
    on(doc, "compositionend", () => (this.composing = false), true);
    on(doc, "selectionchange", soon);
    on(doc, "input", soon);
    on(doc, "keyup", soon);
    on(doc, "mouseup", e => {
      soon();
      if (this.painterMode && e.button == 0) {
        this.host.chromeWin.setTimeout(() => this.painterMouseUp(), 0);
      }
    });
    if (this.host.isHTML()) {
      if (this.config.paragrafoSemEspaco !== false) {
        this.host.loadAgentSheet("paragraph", FAIXA_SHEETS.paragraph);
      }
      this.applyDefaultFont();
      this.applyParagraphMode(true);
    }
    // A API compose (ou outro complemento) pode trocar o <body> inteiro depois
    // que o editor fica pronto: reaplica a fonte padrão no corpo novo.
    this.lastBody = doc.body;
    if (this.win.MutationObserver && doc.documentElement) {
      const mo = new this.win.MutationObserver(() => {
        if (this.doc.body && this.doc.body !== this.lastBody) {
          this.lastBody = this.doc.body;
          this.zwsp.clear();
          if (this.host.isHTML()) {
            this.defaultFont = null;
            this.fontSetByUs = false;
            this.applyDefaultFont();
          }
          this.scheduleState();
        }
      });
      mo.observe(doc.documentElement, { childList: true });
      this.disposers.push(() => mo.disconnect());
    }
    this.state.editorReady = true;
    this.emitState();
  }

  detach() {
    this.endPreview();
    this.host.chromeWin.clearTimeout(this.timer);
    for (const d of this.disposers.splice(0)) {
      try {
        d();
      } catch (e) {}
    }
    for (const id of ["paragraph", "painter", "marks", "preview"]) {
      try {
        this.host.removeAgentSheet(id);
      } catch (e) {}
    }
    this.listeners.clear();
  }

  applyConfig(config) {
    const hadParagraph = this.config.paragrafoSemEspaco !== false;
    this.config = config || {};
    if (!this.state.editorReady || !this.host.isHTML()) {
      return;
    }
    const wantParagraph = this.config.paragrafoSemEspaco !== false;
    if (wantParagraph && !hadParagraph) {
      this.host.loadAgentSheet("paragraph", FAIXA_SHEETS.paragraph);
    } else if (!wantParagraph && hadParagraph) {
      this.host.removeAgentSheet("paragraph");
    }
    if (wantParagraph != hadParagraph) {
      this.applyParagraphMode(false);
    }
    // A política pode chegar depois do editor pronto: se a mensagem ainda não foi
    // mexida, a fonte padrão passa a ser a da configuração nova.
    let untouched = false;
    try {
      untouched = !this.editor.documentModified;
    } catch (e) {}
    const body = this.doc && this.doc.body;
    if (body && untouched && this.fontSetByUs) {
      body.style.removeProperty("font-family");
      body.style.removeProperty("font-size");
      this.defaultFont = null;
      this.fontSetByUs = false;
    }
    if (!this.defaultFont) {
      this.applyDefaultFont();
    }
  }

  /** Fonte padrão das mensagens novas: estilo do body, se ainda não houver. */
  applyDefaultFont() {
    const cfg = this.config.fontePadrao;
    const body = this.doc.body;
    if (!body) {
      return;
    }
    if (body.style.fontFamily) {
      // Rascunho ou modelo que já tem fonte no corpo: respeita a que veio.
      this.defaultFont = { family: body.style.fontFamily, size: body.style.fontSize };
      return;
    }
    if (!cfg || !cfg.familia) {
      return;
    }
    const family = this.fontStack(cfg.familia);
    const size = cfg.tamanhoPt ? cfg.tamanhoPt + "pt" : "";
    body.style.setProperty("font-family", family);
    if (size) {
      body.style.setProperty("font-size", size);
    }
    this.defaultFont = { family, size };
    this.fontSetByUs = true;
  }

  /** Enter cria parágrafo (<p>), como no Outlook, mesmo com "Usar formato Parágrafo"
   * desligado nas configurações do Thunderbird, que a faixa não altera. Com
   * paragrafoSemEspaco desligado, volta ao que as preferências do Thunderbird dizem.
   * initial: o corpo acabou de ser montado. No modo <br> do Thunderbird, o ponto de
   * digitação de uma mensagem nova, resposta ou encaminhada vira <p><br></p>, como o
   * próprio Thunderbird faz no modo parágrafo (NotifyComposeBodyReady*). */
  applyParagraphMode(initial) {
    const doc = this.doc;
    const ed = this.editor;
    if (!doc || !ed || !this.host.isHTML()) {
      return;
    }
    const want = this.config.paragrafoSemEspaco !== false;
    const tb = this.host.tbParagraphPrefs ? this.host.tbParagraphPrefs() : { paragraph: true, crNewP: true };
    try {
      doc.execCommand("defaultParagraphSeparator", false, want || tb.paragraph ? "p" : "br");
    } catch (e) {
      this.lastError = e;
    }
    try {
      ed.returnInParagraphCreatesNewParagraph = want || tb.crNewP;
    } catch (e) {}
    this.paragraphFix = "";
    if (!want || !initial || tb.paragraph) {
      return;
    }
    const kind = this.host.composeKind ? this.host.composeKind() : "other";
    let untouched = false;
    try {
      untouched = !ed.documentModified;
    } catch (e) {}
    const body = doc.body;
    const sel = doc.getSelection();
    if (kind == "other" || !untouched || !body) {
      return;
    }
    let k = 0;
    if (sel.rangeCount) {
      if (!sel.isCollapsed || sel.anchorNode != body) {
        return; // cursor já num bloco (ou a citação selecionada): nada a fazer
      }
      k = sel.anchorOffset;
    } else if (kind != "new") {
      return;
    }
    if (kind == "new" && this.hasOwnText(body)) {
      return; // mailto com texto: fica como veio, igual ao Thunderbird no modo parágrafo
    }
    const next = body.childNodes[k];
    ed.enableUndo(false);
    try {
      if (next && next.nodeName == "BR") {
        ed.deleteNode(next);
      }
      sel.collapse(body, Math.min(k, body.childNodes.length));
      const p = ed.createElementWithDefaults("p");
      p.appendChild(ed.createElementWithDefaults("br"));
      ed.insertElementAtSelection(p, false);
      sel.collapse(p, 0);
      this.paragraphFix = kind;
    } catch (e) {
      this.lastError = e;
    } finally {
      ed.enableUndo(true);
      ed.resetModificationCount();
    }
  }

  /** Há texto do autor no corpo (fora da assinatura)? */
  hasOwnText(root) {
    const walker = this.doc.createTreeWalker(root, 4);
    let n;
    while ((n = walker.nextNode())) {
      if (n.data.trim() && !(n.parentElement && n.parentElement.closest(".moz-signature"))) {
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* estado da seleção                                                    */
  /* ------------------------------------------------------------------ */

  onState(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  scheduleState(delay = 50) {
    if (this.pv) {
      return; // o que está na tela é provisório: o estado volta com endPreview
    }
    const w = this.host.chromeWin;
    w.clearTimeout(this.timer);
    this.timer = w.setTimeout(() => this.emitState(), delay);
  }

  emitState() {
    if (this.pv) {
      return this.state;
    }
    let s;
    try {
      s = this.computeState();
    } catch (e) {
      this.lastError = e;
      s = { editorReady: this.state.editorReady };
    }
    this.state = s;
    for (const fn of this.listeners) {
      try {
        fn(s);
      } catch (e) {
        this.lastError = e;
      }
    }
    return s;
  }

  computeState() {
    const doc = this.doc;
    const ed = this.editor;
    const s = {
      editorReady: this.state.editorReady,
      isHTML: this.host.isHTML(),
      painter: this.painterMode,
      marks: this.marks,
      zoom: Math.round((this.host.getZoom() || 1) * 100),
      canUndo: !!(ed && ed.canUndo),
      canRedo: !!(ed && ed.canRedo),
      hasSelection: false,
    };
    const sel = doc && doc.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    s.hasSelection = !!range && !sel.isCollapsed;
    if (!s.isHTML || !doc || !doc.body) {
      return s;
    }
    let el = null;
    if (range) {
      el = this.elementOf(this.firstTextNode(range) || range.startContainer, range);
    }
    if (!el || !doc.body.contains(el)) {
      // Sem cursor no corpo (antes do primeiro clique): mostra o primeiro parágrafo.
      el = doc.body.querySelector("p, div, h1, h2, h3, h4, h5, h6, li, pre") || doc.body;
    }
    const q = name => {
      try {
        return doc.queryCommandState(name);
      } catch (e) {
        return false;
      }
    };
    s.bold = q("bold");
    s.italic = q("italic");
    s.underline = q("underline");
    s.strike = q("strikeThrough");
    s.sub = q("subscript");
    s.sup = q("superscript");
    const cs = this.win.getComputedStyle(el);
    s.fontName = this.firstFamily(cs.fontFamily);
    s.fontSize = this.pxToPt(cs.fontSize);
    const block = this.blockOf(el);
    const bcs = this.win.getComputedStyle(block);
    s.align = this.normalizeAlign(bcs.textAlign, bcs.direction);
    const list = el.closest("ul, ol");
    s.list = list && doc.body.contains(list) ? list.localName : null;
    s.block = block.localName;
    s.styleId = this.charStyleAt(el, block) || this.matchStyle(block);
    const table = el.closest("table");
    s.inTable = !!table && doc.body.contains(table);
    s.inCell = s.inTable && !!el.closest("td, th");
    s.lineSpacing = this.lineSpacingOf(block);
    const isBody = block == doc.body;
    s.spaceBefore = !isBody && parseFloat(bcs.marginTop) > 0.1;
    s.spaceAfter = !isBody && parseFloat(bcs.marginBottom) > 0.1;
    return s;
  }

  firstFamily(value) {
    if (!value) {
      return "";
    }
    return value.split(",")[0].trim().replace(/^["']|["']$/g, "");
  }

  pxToPt(px) {
    const n = parseFloat(px);
    if (!Number.isFinite(n)) {
      return null;
    }
    return Math.round(n * 0.75 * 2) / 2;
  }

  normalizeAlign(value, direction) {
    const rtl = direction == "rtl";
    switch (value) {
      case "center":
      case "-moz-center":
        return "center";
      case "right":
      case "-moz-right":
        return "right";
      case "justify":
        return "justify";
      case "end":
        return rtl ? "left" : "right";
      case "start":
      default:
        return rtl ? "right" : "left";
    }
  }

  matchStyle(block) {
    const styles = (this.def.styles || []).filter(st => st.kind != "char");
    const tag = block.localName == "div" || block.localName == "body" ? "p" : block.localName;
    const cs = this.win.getComputedStyle(block);
    const props = {
      fontSize: block.style.fontSize,
      lineHeight: block.style.lineHeight,
      fontStyle: block.style.fontStyle || (cs.fontStyle == "italic" ? "italic" : ""),
      textAlign: block.style.textAlign,
      letterSpacing: block.style.letterSpacing,
    };
    const withMatch = styles.filter(st => st.match && st.tag == tag);
    for (const st of withMatch) {
      if (Object.entries(st.match).every(([k, v]) => props[k] == v)) {
        return st.id;
      }
    }
    const plain = styles.find(st => !st.match && st.tag == tag);
    return plain ? plain.id : null;
  }

  /** Estilo de caractere no ponto (Ênfase, Ênfase Sutil, Ênfase Intensa, Forte), como a
   * galeria do Word mostra: <em> pela cor, <strong>. O negrito e o itálico dos botões
   * (<b>, <i>) não são estilo. */
  charStyleAt(el, block) {
    const styles = (this.def.styles || []).filter(st => st.kind == "char");
    if (!styles.length || !el || !block) {
      return null;
    }
    const inside = tag => {
      const n = el.closest(tag);
      return !!n && n != block && block.contains(n);
    };
    if (inside("em")) {
      const color = this.rgbToHex(this.win.getComputedStyle(el).color);
      const colored = styles.find(st => st.tag == "em" && st.color && st.color.toUpperCase() == color);
      const plain = styles.find(st => st.tag == "em" && !st.color);
      return (colored || plain || {}).id || null;
    }
    if (inside("strong")) {
      return (styles.find(st => st.tag == "strong") || {}).id || null;
    }
    return null;
  }

  lineSpacingOf(block) {
    const lh = block.style.lineHeight;
    if (!lh || lh == "normal") {
      return "1.0";
    }
    const n = parseFloat(lh);
    if (!Number.isFinite(n) || /[a-z%]/i.test(lh)) {
      return null;
    }
    return n == 1.15 ? "1.15" : n.toFixed(1);
  }

  /* ------------------------------------------------------------------ */
  /* utilidades de seleção e DOM                                          */
  /* ------------------------------------------------------------------ */

  elementOf(node, range) {
    if (!node) {
      return null;
    }
    if (node.nodeType == 3) {
      return node.parentElement;
    }
    if (node.nodeType == 1) {
      if (range && node == range.startContainer && range.collapsed) {
        const child = node.childNodes[range.startOffset] || node.childNodes[range.startOffset - 1];
        if (child && child.nodeType == 1 && child.localName != "br") {
          return child;
        }
      }
      return node;
    }
    return node.parentElement;
  }

  blockOf(node) {
    let el = node && node.nodeType == 1 ? node : node && node.parentElement;
    while (el && !FAIXA_BLOCK_TAGS.has(el.localName)) {
      el = el.parentElement;
    }
    return el || this.doc.body;
  }

  /** Primeiro nó de texto com conteúdo dentro do intervalo (ou o do cursor). */
  firstTextNode(range) {
    const c = range.startContainer;
    if (c.nodeType == 3 && (range.collapsed || range.startOffset < c.length)) {
      return c;
    }
    if (range.collapsed) {
      return c.nodeType == 3 ? c : null;
    }
    const root = range.commonAncestorContainer.nodeType == 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
    const walker = this.doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) {
      if (range.intersectsNode(n) && n.data.replace(/[\s​]/g, "").length) {
        return n;
      }
    }
    return null;
  }

  /** Quantidade de caracteres do bloco antes do ponto (container, offset). */
  textOffset(block, container, offset) {
    try {
      const r = this.doc.createRange();
      r.setStart(block, 0);
      r.setEnd(container, offset);
      return r.toString().length;
    } catch (e) {
      return -1;
    }
  }

  textLength(block) {
    const r = this.doc.createRange();
    r.selectNodeContents(block);
    return r.toString().replace(/[\s​]+$/, "").length;
  }

  /** Ponto do n-ésimo caractere. Na divisa entre dois nós de texto fica no fim do
   * primeiro; com preferNext, no começo do seguinte (serve para início de seleção). */
  pointAtChar(block, n, preferNext = false) {
    const walker = this.doc.createTreeWalker(block, 4);
    let t;
    let last = null;
    while ((t = walker.nextNode())) {
      if (n < t.length || (n == t.length && !preferNext)) {
        return { node: t, offset: n };
      }
      n -= t.length;
      last = t;
    }
    return last ? { node: last, offset: last.length } : null;
  }

  /** Cursor dentro de uma palavra: seleciona a palavra (como o Word) e
   * devolve uma função que recoloca o cursor onde estava. */
  expandToWord() {
    const sel = this.doc.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) {
      return null;
    }
    const node = sel.anchorNode;
    const off = sel.anchorOffset;
    if (!node || node.nodeType != 3) {
      return null;
    }
    const text = node.data;
    const isW = ch => ch && FAIXA_WORD_CHAR.test(ch);
    if (!(off > 0 && off < text.length && isW(text[off - 1]) && isW(text[off]))) {
      return null;
    }
    let s = off;
    let e = off;
    while (s > 0 && isW(text[s - 1])) {
      s--;
    }
    while (e < text.length && isW(text[e])) {
      e++;
    }
    // Posição contada no corpo, não no bloco: limpar a formatação troca <h1> por <p>.
    const body = this.doc.body;
    const caret = this.textOffset(body, node, off);
    const r = this.doc.createRange();
    r.setStart(node, s);
    r.setEnd(node, e);
    sel.removeAllRanges();
    sel.addRange(r);
    return () => {
      const p = this.pointAtChar(body, caret);
      if (p) {
        sel.collapse(p.node, p.offset);
      }
    };
  }

  /** Blocos (os mais internos) tocados pela seleção. */
  blocksInSelection() {
    const sel = this.doc.getSelection();
    if (!sel.rangeCount) {
      return [];
    }
    const range = sel.getRangeAt(0);
    const first = this.blockOf(range.startContainer);
    if (range.collapsed) {
      return first ? [first] : [];
    }
    const rootNode = range.commonAncestorContainer.nodeType == 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
    const root = this.blockOf(rootNode);
    const found = [];
    const walker = this.doc.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
    let el = root;
    do {
      if (FAIXA_BLOCK_TAGS.has(el.localName) && el.localName != "body" && range.intersectsNode(el)) {
        // Fim do intervalo no começo de um bloco (clique triplo): esse bloco não conta.
        if (el != first && range.endContainer && this.textOffset(el, range.endContainer, range.endOffset) == 0 && !el.contains(range.startContainer)) {
          continue;
        }
        found.push(el);
      }
    } while ((el = walker.nextNode()));
    const leaves = found.filter(b => !found.some(o => o != b && b.contains(o)));
    return leaves.length ? leaves : [first];
  }

  /** O intervalo cobre parágrafos inteiros? (define se o pincel copia o parágrafo) */
  coversWholeBlocks(range) {
    if (range.collapsed) {
      return false;
    }
    const startBlock = this.blockOf(range.startContainer);
    const endBlock = this.blockOf(range.endContainer);
    const startOff = this.textOffset(startBlock, range.startContainer, range.startOffset);
    const endOff = this.textOffset(endBlock, range.endContainer, range.endOffset);
    if (endBlock != startBlock && endOff == 0) {
      return startOff == 0;
    }
    return startOff == 0 && endOff >= this.textLength(endBlock);
  }

  containsFully(range, el) {
    const r = this.doc.createRange();
    r.selectNodeContents(el);
    return range.compareBoundaryPoints(0 /* START_TO_START */, r) <= 0 && range.compareBoundaryPoints(2 /* END_TO_END */, r) >= 0;
  }

  /** Troca propriedades do atributo style por meio do editor (desfazível). */
  setStyleProps(el, props) {
    const clone = el.cloneNode(false);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === "") {
        clone.style.removeProperty(k);
      } else {
        clone.style.setProperty(k, v);
      }
    }
    const next = clone.getAttribute("style") || "";
    const cur = el.getAttribute("style") || "";
    if (next == cur) {
      return;
    }
    if (next.trim()) {
      this.editor.setAttribute(el, "style", next);
    } else if (el.hasAttribute("style")) {
      this.editor.removeAttribute(el, "style");
    }
  }

  cssToProps(css) {
    const out = {};
    const probe = this.doc.createElement("span");
    probe.setAttribute("style", css || "");
    for (let i = 0; i < probe.style.length; i++) {
      const name = probe.style.item(i);
      out[name] = probe.style.getPropertyValue(name);
    }
    return out;
  }

  exec(name, value = null) {
    return this.doc.execCommand(name, false, value);
  }

  withCSS(on, fn) {
    const ed = this.editor;
    let prev = null;
    try {
      prev = ed.isCSSEnabled;
      ed.isCSSEnabled = on;
    } catch (e) {
      prev = null;
    }
    try {
      return fn();
    } finally {
      if (prev != null) {
        try {
          ed.isCSSEnabled = prev;
        } catch (e) {}
      }
    }
  }

  /** Comando de uma única ação do editor (um execCommand): ele já é um passo
   * de desfazer sozinho. Sem lote por fora, o Gecko registra o cursor de antes e
   * de depois nessa própria ação, e o Refazer volta com o cursor no lugar. */
  once(fn) {
    if (this.host.singleNeedsTx) {
      return this.tx(fn);
    }
    try {
      return fn();
    } finally {
      this.scheduleState(0);
    }
  }

  /** Comando com várias operações = um lote = um Ctrl+Z. */
  tx(fn) {
    const ed = this.editor;
    ed.beginTransaction();
    try {
      return fn();
    } finally {
      ed.endTransaction();
      this.scheduleState(0);
    }
  }

  fontStack(name) {
    const clean = String(name || "").trim();
    if (!clean) {
      return clean;
    }
    if (clean.includes(",")) {
      return clean;
    }
    const map = this.def.fontFallbacks || {};
    const fallback = map[clean] || map["*"] || "sans-serif";
    const quoted = /[^\w-]/.test(clean) ? '"' + clean.replace(/"/g, "") + '"' : clean;
    const rest = fallback
      .split(",")
      .map(f => f.trim())
      .filter(f => f && f.toLowerCase() != clean.toLowerCase())
      .map(f => (/[^\w-]/.test(f) && !/^["']/.test(f) ? '"' + f + '"' : f));
    return [quoted, ...rest].join(", ");
  }

  /* ------------------------------------------------------------------ */
  /* comandos                                                             */
  /* ------------------------------------------------------------------ */

  run(cmd, args) {
    args = args || {};
    switch (cmd) {
      case "bold":
        return this.toggleInline("bold");
      case "italic":
        return this.toggleInline("italic");
      case "underline":
        return this.toggleInline("underline");
      case "strikethrough":
        return this.toggleInline("strikeThrough");
      case "subscript":
        return this.toggleInline("subscript");
      case "superscript":
        return this.toggleInline("superscript");
      case "fontName":
        return this.setFontName(args.value);
      case "fontSize":
        return this.setFontSizePt(args.value);
      case "growFont":
        return this.stepFont(1);
      case "shrinkFont":
        return this.stepFont(-1);
      case "foreColor":
        return this.setColor("foreColor", args.value);
      case "hilite":
        return this.setColor("hiliteColor", args.value);
      case "clearFormatting":
        return this.clearFormatting();
      case "changeCase":
        return this.changeCase(args.mode);
      case "spaceBefore":
        return this.toggleParagraphSpace("top");
      case "spaceAfter":
        return this.toggleParagraphSpace("bottom");
      case "bullets":
        return this.setList("ul", args.listStyle);
      case "numbering":
        return this.setList("ol", args.listStyle);
      case "indent":
        return this.once(() => this.withCSS(true, () => this.exec("indent")));
      case "outdent":
        return this.once(() => this.withCSS(true, () => this.exec("outdent")));
      case "alignLeft":
        return this.setAlign("left");
      case "alignCenter":
        return this.setAlign("center");
      case "alignRight":
        return this.setAlign("right");
      case "alignJustify":
        return this.setAlign("justify");
      case "lineSpacing":
        return this.setLineSpacing(args.value);
      case "style":
        return this.applyStyle(args.value);
      case "insertTable":
        return this.insertTable(args.cols, args.rows);
      case "insertEmoji":
      case "insertSymbol":
        return this.insertText(args.text);
      case "showMarks":
        return this.toggleMarks();
      case "painter":
        return this.painterButton(args.mode);
      case "painterCopy":
        return this.painterCopy(true);
      case "painterApply":
        return this.applyFormat(FaixaEngine.painterClipboard);
      case "zoom":
        this.host.setZoom(Number(args.value) / 100);
        return this.scheduleState(0);
      case "undo":
        this.editor.undo();
        return this.scheduleState(0);
      case "redo":
        this.editor.redo();
        return this.scheduleState(0);
    }
    throw new Error("comando desconhecido: " + cmd);
  }

  toggleInline(command) {
    return this.once(() => {
      const restore = this.expandToWord();
      this.withCSS(false, () => this.exec(command));
      if (restore) {
        restore();
      }
    });
  }

  setFontName(name) {
    const stack = this.fontStack(name);
    if (!stack) {
      return;
    }
    this.once(() => {
      const restore = this.expandToWord();
      this.withCSS(true, () => this.exec("fontName", stack));
      if (restore) {
        restore();
      }
    });
  }

  setColor(command, value) {
    this.once(() => {
      const restore = this.expandToWord();
      if (value) {
        this.withCSS(true, () => this.exec(command, value));
      } else if (command == "foreColor") {
        this.removeInline("font", "color");
      } else {
        this.removeInline("font", "bgcolor");
      }
      if (restore) {
        restore();
      }
    });
  }

  removeInline(property, attribute) {
    if (typeof this.editor.removeInlineProperty == "function") {
      this.withCSS(true, () => this.editor.removeInlineProperty(property, attribute));
    }
  }

  setAlign(where) {
    const current = this.state.align;
    const target = current == where && where != "left" ? "left" : where;
    const cmd = { left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull" }[target];
    this.once(() => this.withCSS(true, () => this.exec(cmd)));
  }

  setList(tag, listStyle) {
    const command = tag == "ul" ? "insertUnorderedList" : "insertOrderedList";
    if (!listStyle) {
      this.once(() => this.exec(command));
      return;
    }
    this.tx(() => {
      const sel = this.doc.getSelection();
      const startEl = sel.rangeCount ? this.elementOf(sel.getRangeAt(0).startContainer) : null;
      const current = startEl && startEl.closest("ul, ol");
      if (!current || current.localName != tag) {
        this.exec(command);
      }
      const now = sel.rangeCount ? this.elementOf(sel.getRangeAt(0).startContainer) : null;
      const list = now && now.closest("ul, ol");
      if (list) {
        const isDefault = (tag == "ul" && listStyle == "disc") || (tag == "ol" && listStyle == "decimal");
        this.setStyleProps(list, { "list-style-type": isDefault ? null : listStyle });
      }
    });
  }

  setLineSpacing(value) {
    const map = { "1.0": null, "1.15": "1.15", "1.5": "1.5", "2.0": "2", "2.5": "2.5", "3.0": "3" };
    const lh = value in map ? map[value] : value;
    this.tx(() => {
      for (const block of this.blocksInSelection()) {
        if (block.localName != "body") {
          this.setStyleProps(block, { "line-height": lh });
        }
      }
    });
  }

  applyStyle(id) {
    const style = (this.def.styles || []).find(s => s.id == id);
    if (!style) {
      return;
    }
    if (style.kind == "char") {
      return this.applyCharStyle(style);
    }
    const own = this.ownBlocksInSelection();
    if (!own.length) {
      if (this.host.flash) {
        this.host.flash(FaixaI18n.t("styles.foreign", "Citação, mensagem encaminhada e assinatura mantêm a formatação original."));
      }
      return;
    }
    const props = this.cssToProps(style.css);
    this.tx(() => {
      this.formatBlocks(own, style.tag);
      for (const block of this.blocksInSelection()) {
        if (block.localName != style.tag || !this.isParagraph(block)) {
          continue;
        }
        // O estilo substitui a formatação do parágrafo (como no Word).
        const clone = block.cloneNode(false);
        clone.removeAttribute("style");
        for (const [k, v] of Object.entries(props)) {
          clone.style.setProperty(k, v);
        }
        const next = clone.getAttribute("style") || "";
        if (next) {
          this.editor.setAttribute(block, "style", next);
        } else if (block.hasAttribute("style")) {
          this.editor.removeAttribute(block, "style");
        }
        if (block.hasAttribute("align")) {
          this.editor.removeAttribute(block, "align");
        }
      }
    });
  }

  /** Estilo de caractere, como no Word: Ênfase (<em>), Ênfase Sutil e Ênfase Intensa
   * (<em> com a cor do tema) e Forte (<strong>). Vale para a seleção ou, com o cursor
   * numa palavra, para a palavra inteira; sem palavra, para o que for digitado. Não
   * alterna: aplicar de novo mantém. Um Ctrl+Z desfaz. */
  applyCharStyle(style) {
    const ed = this.editor;
    const colors = new Set((this.def.styles || []).filter(s => s.kind == "char" && s.color).map(s => s.color.toUpperCase()));
    this.tx(() => {
      const restore = this.expandToWord();
      ed.setInlineProperty(style.tag, "", "");
      if (style.tag == "em") {
        if (style.color) {
          this.withCSS(true, () => this.exec("foreColor", style.color));
        } else {
          // Ênfase depois de Ênfase Sutil ou Intensa: a cor delas sai; outra cor fica.
          const sel = this.doc.getSelection();
          const range = sel.rangeCount ? sel.getRangeAt(0) : null;
          const el = range ? this.elementOf(this.firstTextNode(range) || range.startContainer, range) : null;
          if (el && colors.has(this.rgbToHex(this.win.getComputedStyle(el).color))) {
            this.removeInline("font", "color");
          }
        }
      }
      if (restore) {
        restore();
      }
    });
  }

  /* ---------- Visualização Dinâmica ---------- */

  /** Visualização Dinâmica, como no Office: com o mouse (ou o foco do teclado) numa
   * fonte, num tamanho, numa cor ou num estilo, o texto que o comando mudaria já aparece
   * mudado. Nada passa pelo editor: são nós e atributos provisórios no documento, fora
   * do desfazer, e endPreview() devolve os mesmos nós, o mesmo texto e os mesmos
   * atributos. O Ctrl+Z e o Refazer continuam como estavam e a mensagem não conta como
   * alterada. O alvo é o do comando: a seleção (ou a palavra do cursor) para fonte,
   * tamanho, cor, realce e estilos de caractere; os parágrafos da seleção para os de
   * parágrafo. Devolve se mostrou alguma coisa. */
  preview(cmd, args) {
    args = args || {};
    const key = cmd + "|" + JSON.stringify(args);
    if (this.pv && this.pv.key == key) {
      return true;
    }
    this.endPreview();
    const doc = this.doc;
    if (!doc || !doc.body || !this.state.editorReady || !this.host.isHTML() || this.isComposing()) {
      return false;
    }
    const sel = doc.getSelection();
    if (!sel || !sel.rangeCount) {
      return false;
    }
    const range = sel.getRangeAt(0);
    let plan = null;
    try {
      plan = this.previewPlan(cmd, args, range, sel);
    } catch (e) {
      this.lastError = e;
    }
    if (!plan) {
      return false;
    }
    const ranges = [];
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      ranges.push([r.startContainer, r.startOffset, r.endContainer, r.endOffset]);
    }
    const pv = {
      key,
      cmd,
      collapsed: range.collapsed,
      sel: { anchorNode: sel.anchorNode, anchorOffset: sel.anchorOffset, focusNode: sel.focusNode, focusOffset: sel.focusOffset, ranges },
      texts: [],
      blocks: [],
      removedSelection: false,
      highlight: false,
    };
    this.pv = pv;
    try {
      if (plan.segments) {
        this.previewText(pv, plan);
      } else {
        this.previewBlocks(pv, plan);
      }
      this.previewSelection(pv);
    } catch (e) {
      this.lastError = e;
      this.endPreview();
      return false;
    }
    return true;
  }

  /** Composição do IME aberta (japonês, chinês...): o texto dela não pode mudar de nó. */
  isComposing() {
    try {
      const c = this.editor && this.editor.composing;
      if (typeof c == "boolean") {
        return c;
      }
    } catch (e) {}
    return !!this.composing;
  }

  /** O que a Visualização Dinâmica de um comando mudaria: trechos de texto com as
   * propriedades do comando, ou parágrafos com o estilo. null: nada a mostrar (cursor
   * fora de palavra, seleção grande demais, comando sem visualização). */
  previewPlan(cmd, args, range, sel) {
    const win = this.win;
    const color = node => win.getComputedStyle(this.previewColorBase(node)).color;
    let css = null;
    let blockStyle = null;
    // Onde o comando vale: a seleção (todas as células de uma seleção de tabela) ou,
    // com o cursor numa palavra, a palavra inteira (como o expandToWord dos comandos).
    const targets = [];
    if (range.collapsed) {
      const word = this.wordRangeAt(range);
      if (word) {
        targets.push(word);
      }
    } else {
      for (let i = 0; i < ((sel && sel.rangeCount) || 1); i++) {
        const r = sel ? sel.getRangeAt(i) : range;
        if (!r.collapsed) {
          targets.push(r);
        }
      }
    }
    switch (cmd) {
      case "fontName": {
        const stack = this.fontStack(args.value);
        if (!stack) {
          return null;
        }
        css = () => ({ "font-family": stack });
        break;
      }
      case "fontSize": {
        const size = Math.max(1, Math.min(1638, Math.round(Number(args.value) * 2) / 2));
        if (!Number.isFinite(size)) {
          return null;
        }
        css = () => ({ "font-size": size + "pt" });
        break;
      }
      case "foreColor":
        // Link inteiro na seleção: o Gecko pinta por fora dele, e o link continua na cor
        // dele. Automático: a cor do parágrafo (ou do link), a que o texto teria sem cor.
        css = seg => {
          const link = seg.node.parentElement && seg.node.parentElement.closest("a[href]");
          if (link && args.value && this.containsFully(seg.range, link)) {
            return null;
          }
          return { color: args.value || color(seg.node) };
        };
        break;
      case "hilite":
        // Sem Cor: o fundo que aparece atrás do parágrafo cobre o realce que o texto tem.
        css = seg => ({ "background-color": args.value || this.previewBackdrop(seg.node) });
        break;
      case "style": {
        const style = (this.def.styles || []).find(st => st.id == args.value);
        if (!style) {
          return null;
        }
        if (style.kind != "char") {
          blockStyle = style;
          break;
        }
        const decl = style.tag == "strong" ? { "font-weight": "bolder" } : { "font-style": "italic" };
        if (style.color) {
          decl.color = style.color;
        }
        // Ênfase por cima de Ênfase Sutil ou Intensa: como no clique (applyCharStyle), a
        // cor do tema sai quando o começo do texto está nela.
        let dropTheme = false;
        if (style.tag == "em" && !style.color && targets.length) {
          const themes = new Set((this.def.styles || []).filter(st => st.kind == "char" && st.color).map(st => st.color.toUpperCase()));
          const first = targets[0];
          const el = this.elementOf(this.firstTextNode(first) || first.startContainer, first);
          dropTheme = !!el && themes.has(this.rgbToHex(win.getComputedStyle(el).color));
        }
        css = seg => (dropTheme ? Object.assign({ color: color(seg.node) }, decl) : decl);
        break;
      }
      default:
        return null;
    }
    if (blockStyle) {
      if (!this.fewBlocks(range, FAIXA_PREVIEW_MAX_BLOCKS)) {
        return null;
      }
      const blocks = this.ownBlocksInSelection().filter(b => b != this.doc.body && b.isConnected && !b.closest('[contenteditable="false"]'));
      return blocks.length && blocks.length <= FAIXA_PREVIEW_MAX_BLOCKS ? { style: blockStyle, blocks } : null;
    }
    const seen = new Set();
    const segments = [];
    for (const target of targets) {
      const segs = this.textSegments(target, FAIXA_PREVIEW_MAX_TEXTS);
      if (!segs) {
        return null; // grande demais: só o clique
      }
      for (const seg of segs) {
        if (!seen.has(seg.node) && this.previewable(seg)) {
          seen.add(seg.node);
          seg.range = target;
          segments.push(seg);
        }
      }
    }
    return segments.length && segments.length <= FAIXA_PREVIEW_MAX_TEXTS ? { segments, css } : null;
  }

  /** Até max blocos no intervalo? (contados sem medir texto: a seleção de uma mensagem
   * enorme não trava a faixa a cada item com o mouse em cima) */
  fewBlocks(range, max) {
    const root = range.commonAncestorContainer.nodeType == 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
    const walker = this.doc.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
    let n = 0;
    let el = root;
    do {
      if (FAIXA_BLOCK_TAGS.has(el.localName) && range.intersectsNode(el) && ++n > max) {
        return false;
      }
    } while ((el = walker.nextNode()));
    return true;
  }

  /** A palavra do cursor, como a que os comandos de formatação pegam (expandToWord),
   * sem mexer na seleção. null fora de palavra. */
  wordRangeAt(range) {
    const node = range.startContainer;
    const off = range.startOffset;
    if (node.nodeType != 3) {
      return null;
    }
    const text = node.data;
    const isW = ch => ch && FAIXA_WORD_CHAR.test(ch);
    if (!(off > 0 && off < text.length && isW(text[off - 1]) && isW(text[off]))) {
      return null;
    }
    let s = off;
    let e = off;
    while (s > 0 && isW(text[s - 1])) {
      s--;
    }
    while (e < text.length && isW(text[e])) {
      e++;
    }
    const r = this.doc.createRange();
    r.setStart(node, s);
    r.setEnd(node, e);
    return r;
  }

  /** Trecho que vale a pena mostrar: texto editável de HTML, fora de <style> e afins, e
   * não o espaço de formatação do código entre blocos, linhas de tabela ou itens de lista
   * (embrulhado, ele viraria uma caixa e a tabela pularia). */
  previewable(seg) {
    const n = seg.node;
    const parent = n.parentElement;
    if (!parent || parent.namespaceURI != FAIXA_HTML_NS || parent.closest('[contenteditable="false"]')) {
      return false;
    }
    if (/^(script|style|title|textarea|option|select|table|thead|tbody|tfoot|tr|colgroup|col|ul|ol|dl)$/.test(parent.localName)) {
      return false;
    }
    const text = n.data.slice(seg.start, seg.end);
    if (!text.replace(/​/g, "")) {
      return false;
    }
    if (!/[^ \t\n\r\f]/.test(text) && [n.previousSibling, n.nextSibling].some(x => x && x.nodeType == 1 && FAIXA_TOP_BLOCKS.has(x.localName))) {
      return false;
    }
    return true;
  }

  previewColorBase(node) {
    const block = this.blockOf(node);
    const link = node.parentElement && node.parentElement.closest("a[href]");
    return link && block.contains(link) ? link : block;
  }

  previewBackdrop(node) {
    const win = this.win;
    for (let el = this.blockOf(node); el; el = el.parentElement) {
      const bg = win.getComputedStyle(el).backgroundColor;
      if (bg && bg != "transparent" && !/^rgba\(.*,\s*0\)$/.test(bg)) {
        return bg;
      }
    }
    return "Canvas";
  }

  /** Cada trecho num <span> provisório com as propriedades (!important, para valer por
   * cima do que o texto já tem). O nó de texto é dividido só nas bordas da seleção. As
   * propriedades são calculadas antes de mexer no documento (sem recalcular estilos a
   * cada trecho). */
  previewText(pv, plan) {
    const doc = this.doc;
    const decls = plan.segments.map(seg => plan.css(seg));
    plan.segments.forEach((seg, i) => {
      const decl = decls[i];
      if (!decl) {
        return;
      }
      const node = seg.node;
      const rec = { node, target: node, after: [], wrap: null };
      if (seg.end < node.length) {
        rec.after.push(node.splitText(seg.end));
      }
      if (seg.start > 0) {
        rec.target = node.splitText(seg.start);
        rec.after.unshift(rec.target);
      }
      const wrap = doc.createElement("span");
      wrap.setAttribute("data-faixa-preview", "");
      for (const [k, v] of Object.entries(decl)) {
        wrap.style.setProperty(k, v, "important");
      }
      rec.target.before(wrap);
      wrap.append(rec.target);
      rec.wrap = wrap;
      pv.texts.push(rec);
    });
  }

  /** Estilo de parágrafo: o parágrafo aparece como o clique o deixaria (o style do
   * estilo no lugar do dele, sem align), sem trocar o elemento nem mover nós: o cursor
   * fica onde está (e o negrito escolhido com o cursor parado, também). Quando o clique
   * troca a marca (<p> ↔ <h1>), o que a marca antiga punha por conta própria é desfeito
   * no style provisório. */
  previewBlocks(pv, plan) {
    const doc = this.doc;
    const style = plan.style;
    const props = this.cssToProps(style.css);
    const pMargin = this.config.paragrafoSemEspaco !== false ? "0px" : "1em";
    for (const block of plan.blocks) {
      pv.blocks.push({ block, attrs: [...block.attributes].map(a => [a.name, a.value]) });
      const probe = doc.createElement(style.tag);
      for (const [k, v] of Object.entries(props)) {
        probe.style.setProperty(k, v);
      }
      if (block.localName != style.tag) {
        for (const [k, v] of [["font-family", "inherit"], ["font-size", "inherit"], ["font-weight", "inherit"], ["font-style", "inherit"], ["white-space", "normal"]]) {
          if (!probe.style.getPropertyValue(k)) {
            probe.style.setProperty(k, v);
          }
        }
        if (style.tag == "p" && !probe.style.getPropertyValue("margin-top")) {
          probe.style.setProperty("margin-top", pMargin);
          probe.style.setProperty("margin-bottom", pMargin);
        }
      }
      const css = probe.getAttribute("style") || "";
      if (css) {
        block.setAttribute("style", css);
      } else {
        block.removeAttribute("style");
      }
      block.removeAttribute("align");
    }
  }

  /** Com texto selecionado, a seleção sai da tela durante a visualização: a cor de
   * seleção do sistema cobriria a cor e o estilo da prévia. No lugar dela, um cinza
   * translúcido (como o do Word) marca o que muda, pela API de destaques do CSS (menos no
   * realce, que ele tingiria). Com o cursor parado, a seleção fica como está, a não ser
   * na palavra embrulhada, e volta em endPreview. */
  previewSelection(pv) {
    const doc = this.doc;
    const win = this.win;
    const sel = doc.getSelection();
    if (pv.collapsed) {
      if (pv.texts.length) {
        sel.removeAllRanges(); // a palavra mudou de nó: o cursor volta no fim
        pv.removedSelection = true;
      }
      return;
    }
    const registry = win.CSS && win.CSS.highlights;
    if (pv.cmd != "hilite" && registry && typeof win.Highlight == "function") {
      try {
        const ranges = [];
        if (pv.texts.length) {
          for (const rec of pv.texts) {
            const r = doc.createRange();
            r.selectNodeContents(rec.wrap);
            ranges.push(r);
          }
        } else {
          for (const [sc, so, ec, eo] of pv.sel.ranges) {
            const r = doc.createRange();
            r.setStart(sc, so);
            r.setEnd(ec, eo);
            ranges.push(r);
          }
        }
        if (ranges.length) {
          this.host.loadAgentSheet("preview", FAIXA_SHEETS.preview);
          registry.set("faixa-preview", new win.Highlight(...ranges));
          pv.highlight = true;
        }
      } catch (e) {
        this.lastError = e;
      }
    }
    sel.removeAllRanges();
    pv.removedSelection = true;
  }

  /** Tira a Visualização Dinâmica: os mesmos nós de antes, com o mesmo texto e os
   * mesmos atributos (na mesma ordem), e a seleção de antes, quando ela saiu da tela
   * (o Chromium do simulador põe um cursor sozinho no lugar dela). Devolve se havia uma. */
  endPreview() {
    const pv = this.pv;
    if (!pv) {
      return false;
    }
    this.pv = null;
    const doc = this.doc;
    if (pv.highlight) {
      try {
        this.win.CSS.highlights.delete("faixa-preview");
      } catch (e) {}
    }
    for (const rec of pv.texts.slice().reverse()) {
      try {
        if (rec.wrap.parentNode) {
          rec.wrap.replaceWith(...rec.wrap.childNodes);
        }
        if (rec.after.length) {
          // appendData: o que outros guardam no começo do nó (verificação ortográfica,
          // outros complementos) continua no lugar.
          rec.node.appendData(rec.after.map(n => n.data).join(""));
          for (const n of rec.after) {
            n.remove();
          }
        }
      } catch (e) {
        this.lastError = e;
      }
    }
    for (const rec of pv.blocks.slice().reverse()) {
      try {
        const el = rec.block;
        const now = [...el.attributes].map(a => [a.name, a.value]);
        if (JSON.stringify(now) != JSON.stringify(rec.attrs)) {
          for (const [name] of now) {
            el.removeAttribute(name);
          }
          for (const [name, value] of rec.attrs) {
            el.setAttribute(name, value);
          }
        }
      } catch (e) {
        this.lastError = e;
      }
    }
    try {
      // Rede de segurança: nada provisório fica no corpo.
      for (const el of doc.querySelectorAll("span[data-faixa-preview]")) {
        el.replaceWith(...el.childNodes);
      }
      const sel = doc.getSelection();
      const s = pv.sel;
      const alive = n => !!n && n.isConnected;
      if (pv.removedSelection) {
        sel.removeAllRanges();
        if (s.ranges.length == 1 && alive(s.anchorNode) && alive(s.focusNode)) {
          sel.setBaseAndExtent(s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset);
        } else {
          for (const [sc, so, ec, eo] of s.ranges) {
            if (alive(sc) && alive(ec)) {
              const r = doc.createRange();
              r.setStart(sc, so);
              r.setEnd(ec, eo);
              sel.addRange(r);
            }
          }
        }
      }
    } catch (e) {
      this.lastError = e;
    }
    this.scheduleState(0);
    return true;
  }

  /* ---------- inserir ---------- */

  /** Texto no ponto do cursor (emoji, símbolo, data): um passo do desfazer. Vale no
   * editor HTML e no de texto puro; a formatação em volta continua. */
  insertText(text) {
    const s = String(text || "");
    if (!s) {
      return;
    }
    this.once(() => {
      const ed = this.editor;
      if (typeof ed.insertText == "function") {
        ed.insertText(s);
      } else {
        this.exec("insertText", s);
      }
    });
  }

  /** HTML já limpo no ponto do cursor (Partes Rápidas), num passo do desfazer. */
  insertHTML(html) {
    this.tx(() => {
      const ed = this.editor;
      if (typeof ed.insertHTML == "function") {
        ed.insertHTML(html);
      } else {
        this.exec("insertHTML", html);
      }
    });
  }

  /** Tabela como a do Word ("Grade da Tabela"): largura toda, bordas finas pretas,
   * colunas iguais. Entra no ponto do cursor e o cursor vai para a primeira célula.
   * Como no Word, sempre há uma linha para escrever embaixo dela. Um Ctrl+Z desfaz.
   *
   * O Gecko divide o parágrafo do cursor em volta da tabela e, no fim, apaga os pedaços
   * vazios (RemoveEmptyNodesIn), menos os que têm um <span>, <em> ou <strong> vazio
   * dentro (texto formatado pela faixa): esses ficam invisíveis, sem altura. No fim de um
   * bloco que não se divide (corpo sem parágrafos, item de lista, célula), ele põe um
   * <br> depois da tabela. A arrumação (lineAfterTable) cuida do resto. */
  insertTable(cols, rows) {
    const nc = Math.max(1, Math.min(63, Math.round(Number(cols) || 0)));
    const nr = Math.max(1, Math.min(500, Math.round(Number(rows) || 0)));
    const doc = this.doc;
    const ed = this.editor;
    const sel = doc.getSelection();
    if (!doc.body || !sel) {
      return null;
    }
    const width = (Math.floor(10000 / nc) / 100) + "%";
    const table = doc.createElement("table");
    table.setAttribute("border", "1");
    table.setAttribute("cellspacing", "0");
    table.setAttribute("cellpadding", "0");
    table.setAttribute("style", "border-collapse: collapse; width: 100%;");
    const tbody = doc.createElement("tbody");
    for (let r = 0; r < nr; r++) {
      const tr = doc.createElement("tr");
      for (let c = 0; c < nc; c++) {
        const td = doc.createElement("td");
        td.setAttribute("style", `width: ${width}; border: 1px solid #000000; padding: 0 5.4pt; vertical-align: top;`);
        td.append(doc.createElement("br"));
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    this.tx(() => {
      if (!sel.rangeCount) {
        sel.collapse(doc.body, 0);
      } else if (!sel.isCollapsed) {
        sel.collapseToEnd(); // o texto selecionado fica; a tabela vem depois dele
      }
      ed.insertElementAtSelection(table, true);
      if (!table.isConnected || !table.parentNode) {
        return;
      }
      this.lineAfterTable(table);
      const first = table.querySelector("td, th");
      if (first) {
        sel.collapse(first, 0);
      }
    });
    return table;
  }

  /** Arrumação em volta da tabela recém-inserida (ver insertTable). Roda dentro de tx().
   * Só mexe no que não aparece: um parágrafo sem texto e sem <br>, imagem ou outro
   * elemento que ocupe lugar. Linha em branco do usuário (<p><br></p>, <p>&nbsp;</p>)
   * fica como está.
   * - Parágrafo invisível logo acima: sai (é o pedaço que a divisão deixou).
   * - Parágrafo invisível logo abaixo: ganha o <br> e vira a linha seguinte, dentro da
   *   formatação que sobrou nele (o que se digitar ali sai com a mesma cor e fonte).
   * - O <br> que o Gecko põe depois da tabela no corpo vira parágrafo (no modo parágrafo).
   * - Nada depois, ou logo antes de assinatura, citação, lista ou outra tabela: um
   *   parágrafo novo. Texto, elemento de linha ou parágrafo com conteúdo: já é a linha. */
  lineAfterTable(table) {
    const doc = this.doc;
    const ed = this.editor;
    const parent = table.parentNode;
    const index = n => Array.prototype.indexOf.call(parent.childNodes, n);
    // Só espaço ASCII é vazio: o &nbsp; (linha em branco digitada, HTML do Outlook) é conteúdo.
    const nothing = text => !/[^ \t\n\r\f]/.test(text);
    const blank = n => !!n && n.nodeType == 3 && nothing(n.data);
    const invisible = n => !!n && n.nodeType == 1 && this.isParagraph(n) && nothing(n.textContent) && !n.querySelector(FAIXA_VISIBLE_EMPTY);
    let prev = table.previousSibling;
    while (blank(prev)) {
      prev = prev.previousSibling;
    }
    if (invisible(prev)) {
      ed.deleteNode(prev);
    }
    let next = table.nextSibling;
    while (blank(next)) {
      next = next.nextSibling;
    }
    const newLine = before => {
      const at = before ? index(before) : parent.childNodes.length;
      if (this.config.paragrafoSemEspaco !== false || parent != doc.body) {
        const p = ed.createElementWithDefaults("p");
        p.appendChild(ed.createElementWithDefaults("br"));
        ed.insertNode(p, parent, at, true);
      } else {
        ed.insertNode(ed.createElementWithDefaults("br"), parent, at, true);
      }
    };
    if (invisible(next)) {
      let at = next;
      while (at.lastElementChild && at.lastElementChild.localName != "a") {
        at = at.lastElementChild;
      }
      ed.insertNode(ed.createElementWithDefaults("br"), at, at.childNodes.length, true);
    } else if (next && next.nodeType == 1 && next.localName == "br" && parent == doc.body && this.config.paragrafoSemEspaco !== false) {
      newLine(next);
      ed.deleteNode(next);
    } else if (!next) {
      newLine(null);
    } else if (next.nodeType == 1 && next.localName != "br" && FAIXA_TOP_BLOCKS.has(next.localName) && !this.isParagraph(next)) {
      newLine(next);
    }
  }

  /** Texto sem Formatação, como no Outlook: a formatação sai da mensagem inteira (a do
   * autor, a da citação e a da assinatura) num passo só do desfazer; títulos viram
   * parágrafos. Listas, citações, tabelas, links e imagens ficam: o Thunderbird os
   * converte em texto na hora do envio. O cursor fica onde estava. */
  stripFormatting() {
    const doc = this.doc;
    const body = doc && doc.body;
    if (!body || !this.host.isHTML()) {
      return false;
    }
    const sel = doc.getSelection();
    const mark = this.bookmark();
    const ed = this.editor;
    this.tx(() => {
      const all = doc.createRange();
      all.selectNodeContents(body);
      sel.removeAllRanges();
      sel.addRange(all);
      this.exec("removeFormat");
      const heads = [...body.querySelectorAll("h1, h2, h3, h4, h5, h6, address")].filter(h => !h.closest("pre"));
      for (const h of heads) {
        if (!h.isConnected) {
          continue;
        }
        const r = doc.createRange();
        r.selectNodeContents(h);
        sel.removeAllRanges();
        sel.addRange(r);
        this.exec("formatBlock", "p");
      }
      for (const el of [...body.querySelectorAll("[style], [align], [color], [face], [size], [bgcolor]")]) {
        if (el.localName == "img" || !el.isConnected) {
          continue;
        }
        for (const attr of ["style", "align", "color", "face", "size", "bgcolor"]) {
          if (el.hasAttribute(attr)) {
            ed.removeAttribute(el, attr);
          }
        }
      }
      this.restoreBookmark(mark, new Map(), true);
    });
    return true;
  }

  /* ---------- maiúsculas e minúsculas ---------- */

  /** Maiúsculas e Minúsculas, como no Word: sentence (Primeira letra da frase),
   * lower, upper, title (Cada Palavra) e toggle (aLTERNAR). A formatação de cada
   * trecho fica; o texto alheio (citação, assinatura) só muda se a seleção estiver
   * toda nele. Um Ctrl+Z desfaz. */
  changeCase(mode) {
    if (!["sentence", "lower", "upper", "title", "toggle"].includes(mode)) {
      return;
    }
    this.tx(() => {
      const doc = this.doc;
      const sel = doc.getSelection();
      const restore = this.expandToWord();
      if (!sel.rangeCount || sel.isCollapsed) {
        return;
      }
      const range = sel.getRangeAt(0);
      let segs = this.textSegments(range);
      const own = segs.filter(s => !(s.node.parentElement && s.node.parentElement.closest(FAIXA_FOREIGN)));
      if (own.length) {
        segs = own;
      }
      if (!segs.length) {
        return;
      }
      const mark = this.bookmark();
      const out = this.caseOf(segs, mode);
      // ß vira SS: o fim da seleção anda junto com a diferença de tamanho.
      let delta = 0;
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        const old = s.node.data.slice(s.start, s.end);
        if (out[i] != old) {
          this.replaceTextNode(s.node, s.node.data.slice(0, s.start) + out[i] + s.node.data.slice(s.end));
          delta += out[i].length - old.length;
        }
      }
      if (restore) {
        restore();
      } else if (mark) {
        mark.end.chars += delta;
        this.restoreBookmark(mark, new Map(), true);
      }
    });
  }

  /** Trechos de texto (nó, início, fim) cobertos pelo intervalo, em ordem.
   * lineBefore: há uma quebra de linha (<br>) entre este trecho e o anterior. */
  textSegments(range, limit = Infinity) {
    const root = range.commonAncestorContainer.nodeType == 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
    const out = [];
    const walker = this.doc.createTreeWalker(root, 1 | 4 /* SHOW_ELEMENT | SHOW_TEXT */);
    let n;
    let lineBreak = false;
    while ((n = walker.nextNode())) {
      if (!range.intersectsNode(n)) {
        continue;
      }
      if (n.nodeType == 1) {
        if (n.localName == "br") {
          lineBreak = true;
        }
        continue;
      }
      const start = n == range.startContainer ? range.startOffset : 0;
      const end = n == range.endContainer ? range.endOffset : n.length;
      if (end > start) {
        out.push({ node: n, start, end, block: this.blockOf(n), lineBefore: lineBreak });
        lineBreak = false;
        if (out.length > limit) {
          return null;
        }
      }
    }
    return out;
  }

  /** Texto novo de cada trecho. Frase e palavra olham o que vem antes, inclusive
   * fora da seleção; cada parágrafo (e cada linha depois de um <br>) começa uma frase. */
  caseOf(segs, mode) {
    const locale = FaixaI18n.locale;
    const isWord = ch => !!ch && FAIXA_WORD_CHAR.test(ch);
    const isLetter = ch => /\p{L}/u.test(ch);
    const first = segs[0];
    const lead = this.textBefore(first.block, first.node, first.start);
    let prev = lead.slice(-1);
    let sentenceStart = !lead.trim() || /[.!?…]["'”’)\]]*\s+$/.test(lead);
    let block = first.block;
    return segs.map((s, i) => {
      if (s.block != block || (i > 0 && s.lineBefore)) {
        block = s.block;
        sentenceStart = true;
        prev = "";
      }
      let r = "";
      for (const ch of s.node.data.slice(s.start, s.end)) {
        const up = ch.toLocaleUpperCase(locale);
        const low = ch.toLocaleLowerCase(locale);
        let c = ch;
        switch (mode) {
          case "lower":
            c = low;
            break;
          case "upper":
            c = up;
            break;
          case "toggle":
            c = ch == up ? low : up;
            break;
          case "title":
            c = isLetter(ch) ? (isWord(prev) ? low : up) : ch;
            break;
          case "sentence":
            if (isLetter(ch)) {
              c = sentenceStart ? up : low;
              sentenceStart = false;
            } else if (/[.!?…]/.test(ch)) {
              sentenceStart = true;
            } else if (sentenceStart && /\p{N}/u.test(ch)) {
              sentenceStart = false;
            }
            break;
        }
        r += c;
        prev = ch;
      }
      return r;
    });
  }

  /** Texto da linha antes do ponto (nó, offset): do começo do bloco, ou do último
   * <br> antes do ponto. */
  textBefore(block, node, offset) {
    try {
      const r = this.doc.createRange();
      r.setStart(block, 0);
      r.setEnd(node, offset);
      let from = null;
      for (const br of block.querySelectorAll("br")) {
        if (r.intersectsNode(br)) {
          from = br;
        }
      }
      if (from) {
        r.setStartAfter(from);
      }
      return r.toString();
    } catch (e) {
      return "";
    }
  }

  /** Troca um nó de texto por outro com o texto novo, pelo editor (desfazível).
   * Diferente do insertText, não mexe nos espaços em volta (o Gecko troca espaço
   * por &nbsp; e pode tirar o texto de dentro do negrito ou do link). */
  replaceTextNode(node, data) {
    const parent = node.parentNode;
    const fresh = this.doc.createTextNode(data);
    const index = Array.prototype.indexOf.call(parent.childNodes, node);
    this.editor.insertNode(fresh, parent, index, true);
    this.editor.deleteNode(node, true);
    if (this.zwsp.has(node)) {
      this.zwsp.delete(node);
      this.zwsp.add(fresh);
    }
    return fresh;
  }

  /* ---------- espaço antes e depois do parágrafo ---------- */

  /** Adicionar/Remover Espaço Antes (top) ou Depois (bottom) do Parágrafo: 12 pt,
   * como no Word. Quem decide entre adicionar e remover é o primeiro parágrafo da
   * seleção; itens de lista também valem. Citação e assinatura ficam como vieram. */
  toggleParagraphSpace(side) {
    const prop = side == "top" ? "margin-top" : "margin-bottom";
    const key = side == "top" ? "marginTop" : "marginBottom";
    const body = this.doc.body;
    const blocks = this.blocksInSelection().filter(b => b != body && !b.closest(FAIXA_FOREIGN) &&
      !["td", "th", "blockquote"].includes(b.localName) && !b.classList.contains("moz-cite-prefix"));
    if (!blocks.length) {
      if (this.host.flash) {
        this.host.flash(FaixaI18n.t("styles.foreign", "Citação, mensagem encaminhada e assinatura mantêm a formatação original."));
      }
      return;
    }
    const has = b => parseFloat(this.win.getComputedStyle(b)[key]) > 0.1;
    const on = has(blocks[0]);
    this.tx(() => {
      for (const block of blocks) {
        if (on) {
          this.setStyleProps(block, { [prop]: null });
          if (has(block)) {
            this.setStyleProps(block, { [prop]: "0" });
          }
        } else {
          this.setStyleProps(block, { [prop]: "12pt" });
        }
      }
    });
  }

  /** Trechos da seleção fora de citação, encaminhada e assinatura, em ordem.
   * null: a seleção não toca em nada alheio. Vazio: está inteira num trecho alheio. */
  rangesOutsideForeign(range) {
    const roots = [...this.doc.body.querySelectorAll(FAIXA_FOREIGN)].filter(
      el => !(el.parentElement && el.parentElement.closest(FAIXA_FOREIGN)) && range.intersectsNode(el));
    if (!roots.length) {
      return null;
    }
    const out = [];
    let cur = range.cloneRange();
    for (const f of roots) {
      if (!f.contains(cur.startContainer)) {
        const before = cur.cloneRange();
        before.setEndBefore(f);
        if (!before.collapsed) {
          out.push(before);
        }
      }
      if (f.contains(range.endContainer)) {
        cur = null;
        break;
      }
      cur.setStartAfter(f);
    }
    if (cur && !cur.collapsed) {
      out.push(cur);
    }
    return out;
  }

  /** removeFormat sem tocar no que é alheio: numa seleção que mistura o texto do
   * autor com citação, encaminhada ou assinatura, só o texto do autor perde a
   * formatação. Seleção só dentro desses trechos: o usuário escolheu, vale. */
  removeFormatOwn() {
    const sel = this.doc.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) {
      this.exec("removeFormat");
      return;
    }
    const parts = this.rangesOutsideForeign(sel.getRangeAt(0));
    if (!parts || !parts.length) {
      this.exec("removeFormat");
      return;
    }
    const mark = this.bookmark();
    // Do fim para o começo: mexer num trecho não desloca os pontos dos anteriores.
    for (const r of parts.reverse()) {
      sel.removeAllRanges();
      sel.addRange(r);
      this.exec("removeFormat");
    }
    // O removeFormat não muda o texto, mas pode dividir nós: volta pela posição de caractere.
    this.restoreBookmark(mark, new Map(), true);
  }

  clearFormatting() {
    this.tx(() => {
      const restore = this.expandToWord();
      this.removeFormatOwn();
      // Título, <pre> e endereço do autor voltam a parágrafo Normal. Citação,
      // encaminhada e assinatura ficam como vieram.
      const convert = this.ownBlocksInSelection().filter(b => FAIXA_HEADING_TAGS.has(b.localName) || b.localName == "pre" || b.localName == "address");
      this.formatBlocks(convert, "p");
      for (const block of this.blocksInSelection()) {
        if (!this.isParagraph(block)) {
          continue;
        }
        if (block.hasAttribute("style")) {
          this.editor.removeAttribute(block, "style");
        }
        if (block.hasAttribute("align")) {
          this.editor.removeAttribute(block, "align");
        }
      }
      if (restore) {
        restore();
      }
    });
  }

  /** Parágrafo do autor: recebe formatação de parágrafo (limpar, estilos, pincel).
   * Nada dentro de citação, mensagem encaminhada ou assinatura. */
  isParagraph(block) {
    return !!block && FAIXA_PARA_TAGS.has(block.localName) && !block.closest(FAIXA_FOREIGN) &&
      !block.classList.contains("moz-cite-prefix");
  }

  /** Blocos da seleção que aceitam formatação de parágrafo. Texto solto direto no
   * corpo (fora de qualquer bloco) aparece como o próprio body. */
  ownBlocksInSelection() {
    const body = this.doc.body;
    return this.blocksInSelection().filter(b => b == body || this.isParagraph(b));
  }

  /** formatBlock só nos blocos dados, um de cada vez. Na seleção inteira o
   * formatBlock desceria em citações e na assinatura: o <pre> de uma citação de
   * texto puro viraria <p> e perderia as quebras de linha. Roda dentro de tx(). */
  formatBlocks(blocks, tag) {
    const doc = this.doc;
    const body = doc.body;
    const sel = doc.getSelection();
    if (blocks.length == 1 && blocks[0] == body) {
      // Texto solto no corpo: o formatBlock da seleção cria o bloco em volta dele.
      this.exec("formatBlock", tag);
      return;
    }
    const todo = blocks.filter(b => b != body && b.localName != tag && b.isConnected);
    if (!todo.length || !sel.rangeCount) {
      return;
    }
    const range = sel.getRangeAt(0);
    if (todo.length == 1 && todo[0].contains(range.startContainer) && todo[0].contains(range.endContainer)) {
      // Seleção inteira num bloco só: o formatBlock da própria seleção, que o editor
      // já sabe preservar.
      this.exec("formatBlock", tag);
      return;
    }
    const mark = this.bookmark();
    const replaced = new Map();
    for (const block of todo) {
      if (!block.isConnected) {
        continue;
      }
      const parent = block.parentNode;
      const next = block.nextSibling;
      const r = doc.createRange();
      r.selectNodeContents(block);
      sel.removeAllRanges();
      sel.addRange(r);
      this.exec("formatBlock", tag);
      if (!block.isConnected) {
        // O editor põe o bloco novo no lugar do antigo e muda os filhos para ele.
        const nb = next && next.parentNode == parent ? next.previousSibling : parent.lastChild;
        if (nb && nb.nodeType == 1) {
          replaced.set(block, nb);
        }
      }
    }
    this.restoreBookmark(mark, replaced);
  }

  /** Guarda a seleção: os pontos como estão (nós de texto sobrevivem ao
   * formatBlock) e, de reserva, como posição de caractere no corpo. */
  bookmark() {
    const sel = this.doc.getSelection();
    if (!sel.rangeCount) {
      return null;
    }
    const r = sel.getRangeAt(0);
    const body = this.doc.body;
    return {
      start: { node: r.startContainer, offset: r.startOffset, chars: this.textOffset(body, r.startContainer, r.startOffset) },
      end: { node: r.endContainer, offset: r.endOffset, chars: this.textOffset(body, r.endContainer, r.endOffset) },
      collapsed: r.collapsed,
    };
  }

  restoreBookmark(mark, replaced = new Map(), byChars = false) {
    if (!mark) {
      return;
    }
    const body = this.doc.body;
    const exact = p => {
      const node = p.node.isConnected ? p.node : replaced.get(p.node);
      if (!node || !node.isConnected) {
        return null;
      }
      const max = node.nodeType == 3 ? node.length : node.childNodes.length;
      return { node, offset: Math.min(p.offset, max) };
    };
    let a = byChars ? null : exact(mark.start);
    let b = byChars ? null : mark.collapsed ? a : exact(mark.end);
    if (!a || !b) {
      a = mark.start.chars >= 0 ? this.pointAtChar(body, mark.start.chars, true) : null;
      b = mark.collapsed ? a : mark.end.chars >= 0 ? this.pointAtChar(body, mark.end.chars) : null;
    }
    if (!a || !b) {
      return;
    }
    const r = this.doc.createRange();
    try {
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
    } catch (e) {
      return;
    }
    const sel = this.doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  toggleMarks() {
    this.marks = !this.marks;
    if (this.marks) {
      this.host.loadAgentSheet("marks", FAIXA_SHEETS.marks);
    } else {
      this.host.removeAgentSheet("marks");
    }
    this.scheduleState(0);
  }

  /* ---------- tamanho em pt ---------- */

  stepFont(dir) {
    const sizes = this.def.fontSizes;
    const cur = this.state.fontSize || this.config.fontePadrao?.tamanhoPt || 11;
    let next;
    if (dir > 0) {
      next = sizes.find(s => s > cur) ?? Math.min(1638, Math.ceil(cur / 10) * 10 + 10);
    } else {
      next = [...sizes].reverse().find(s => s < cur) ?? Math.max(1, cur - 1);
    }
    return this.setFontSizePt(next);
  }

  setFontSizePt(pt) {
    const size = Math.max(1, Math.min(1638, Math.round(Number(pt) * 2) / 2));
    if (!Number.isFinite(size)) {
      return;
    }
    this.tx(() => {
      const sel = this.doc.getSelection();
      const restore = this.expandToWord();
      if (sel.isCollapsed) {
        this.insertSizedCaret(size);
        return;
      }
      const changed = this.sizeSelection(size);
      if (restore) {
        restore();
      } else if (changed.length && sel.isCollapsed) {
        const r = this.doc.createRange();
        r.setStart(changed[0], 0);
        const last = changed[changed.length - 1];
        r.setEnd(last, last.childNodes.length);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    });
  }

  /** Aplica o tamanho à seleção não vazia. Deve rodar dentro de tx(). */
  sizeSelection(size) {
    const doc = this.doc;
    const sel = doc.getSelection();
    const range = sel.getRangeAt(0);
    // Tamanhos já definidos dentro da seleção dariam prioridade ao antigo.
    const root = range.commonAncestorContainer.nodeType == 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
    for (const el of [root, ...root.querySelectorAll("[style*='font-size'], font[size]")]) {
      if (!el.isConnected || el == doc.body || !this.containsFully(range, el)) {
        continue;
      }
      if (el.style && el.style.fontSize) {
        this.setStyleProps(el, { "font-size": null });
      }
      if (el.localName == "font" && el.hasAttribute("size")) {
        this.editor.removeAttribute(el, "size");
      }
    }
    const marker = "font[size='7'], span[style*='xxx-large']";
    const before = new Set(doc.querySelectorAll(marker));
    this.withCSS(false, () => this.exec("fontSize", "7"));
    const created = [...doc.querySelectorAll(marker)].filter(el => !before.has(el));
    return created.map(el => this.convertSizeElement(el, size));
  }

  /** <font size="7"> recebe font-size em pt no lugar do tamanho relativo.
   * A troca é só de atributos (setAttribute/removeAttribute do editor), sem mover
   * nós, para não disparar as limpezas do editor no meio da transação. O <font>
   * que sobrar só com style vira <span> na normalização do envio. */
  convertSizeElement(el, size) {
    const ed = this.editor;
    const clone = el.cloneNode(false);
    clone.removeAttribute("size");
    clone.style.setProperty("font-size", size + "pt");
    ed.setAttribute(el, "style", clone.getAttribute("style"));
    if (el.hasAttribute("size")) {
      ed.removeAttribute(el, "size");
    }
    return el;
  }

  /** Cursor sem seleção fora de palavra: o que for digitado já sai no tamanho. */
  insertSizedCaret(size) {
    const doc = this.doc;
    const span = doc.createElement("span");
    span.setAttribute("style", "font-size: " + size + "pt;");
    const zw = doc.createTextNode(FAIXA_ZWSP);
    span.append(zw);
    this.editor.insertElementAtSelection(span, false);
    const sel = doc.getSelection();
    if (zw.isConnected) {
      sel.collapse(zw, 1);
      this.zwsp.add(zw);
    }
  }

  /* ------------------------------------------------------------------ */
  /* pincel de formatação                                                 */
  /* ------------------------------------------------------------------ */

  painterButton(mode) {
    if (mode == "lock") {
      if (!this.painterMode && !this.painterCopy(false)) {
        return;
      }
      this.painterMode = 2;
    } else if (this.painterMode) {
      this.painterStop();
      return;
    } else {
      if (!this.painterCopy(false)) {
        return;
      }
      this.painterMode = 1;
    }
    this.host.loadAgentSheet("painter", FAIXA_SHEETS.painter);
    this.scheduleState(0);
  }

  painterStop() {
    if (!this.painterMode) {
      return false;
    }
    this.painterMode = 0;
    this.host.removeAgentSheet("painter");
    this.scheduleState(0);
    return true;
  }

  painterCopy(announce) {
    const fmt = this.captureFormat();
    if (!fmt) {
      return false;
    }
    FaixaEngine.painterClipboard = fmt;
    if (announce && this.host.flash) {
      this.host.flash(this.applyLabel
        ? FaixaI18n.t("painter.copiedKey", "Formatação copiada. Use {key} para aplicar.", { key: this.applyLabel })
        : FaixaI18n.t("painter.copied", "Formatação copiada. Use Colar Formatação para aplicar."));
    }
    return true;
  }

  painterMouseUp() {
    // Envio em curso: o editor está somente leitura, mas editor.setAttribute não
    // respeita isso; o pincel espera a janela destravar.
    if (!this.painterMode || this.host.chromeWin.gWindowLocked) {
      return;
    }
    this.applyFormat(FaixaEngine.painterClipboard);
    if (this.painterMode == 1) {
      this.painterStop();
    }
  }

  /** Lê a formatação no início da seleção (ou no cursor). */
  captureFormat() {
    const sel = this.doc.getSelection();
    if (!sel || !sel.rangeCount || !this.host.isHTML()) {
      return null;
    }
    const range = sel.getRangeAt(0);
    const node = this.firstTextNode(range) || range.startContainer;
    const el = this.elementOf(node, range);
    if (!el || !this.doc.body.contains(el)) {
      return null;
    }
    const block = this.blockOf(el);
    const fmt = { char: this.charFormatOf(el, block), para: null, source: el.localName };
    if (range.collapsed || this.coversWholeBlocks(range)) {
      if (block && block.localName != "body") {
        fmt.para = {
          tag: FAIXA_HEADING_TAGS.has(block.localName) || ["p", "div", "pre"].includes(block.localName) ? block.localName : null,
          style: block.getAttribute("style") || "",
        };
      }
    }
    return fmt;
  }

  charFormatOf(el, block) {
    const w = this.win;
    const cs = w.getComputedStyle(el);
    let underline = false;
    let strike = false;
    let background = null;
    let vertical = null;
    for (let n = el; n && n != block.parentElement; n = n.parentElement) {
      const ncs = w.getComputedStyle(n);
      const line = ncs.textDecorationLine || ncs.textDecoration || "";
      if (/underline/.test(line) || n.localName == "u" || n.localName == "ins") {
        underline = true;
      }
      if (/line-through/.test(line) || ["s", "strike", "del"].includes(n.localName)) {
        strike = true;
      }
      if (!vertical) {
        if (ncs.verticalAlign == "sub" || n.localName == "sub") {
          vertical = "sub";
        } else if (ncs.verticalAlign == "super" || n.localName == "sup") {
          vertical = "super";
        }
      }
      if (!background && n != block) {
        const bg = ncs.backgroundColor;
        if (bg && bg != "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) {
          background = bg;
        }
      }
      if (n == block) {
        break;
      }
    }
    return {
      fontFamily: cs.fontFamily,
      fontSizePt: this.pxToPt(cs.fontSize),
      bold: parseInt(cs.fontWeight, 10) >= 600,
      italic: cs.fontStyle == "italic" || String(cs.fontStyle).startsWith("oblique"),
      underline,
      strike,
      color: cs.color,
      background,
      vertical,
    };
  }

  sameFamily(a, b) {
    const norm = v => String(v || "").replace(/["']/g, "").replace(/\s*,\s*/g, ",").trim().toLowerCase();
    return norm(a) == norm(b);
  }

  rgbToHex(color) {
    const m = String(color).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (!m) {
      return color;
    }
    return "#" + [m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  /** Aplica o formato copiado: substitui a formatação do destino (não soma). */
  applyFormat(fmt) {
    if (!fmt || !this.host.isHTML()) {
      return false;
    }
    const doc = this.doc;
    const sel = doc.getSelection();
    if (!sel.rangeCount) {
      return false;
    }
    this.tx(() => {
      let restore = null;
      if (sel.isCollapsed) {
        restore = this.expandToWord();
      }
      if (!sel.isCollapsed) {
        const whole = sel.getRangeAt(0).cloneRange();
        // Um sub-intervalo por bloco: cada parágrafo tem sua formatação de base.
        // Arrastar sobre o texto do autor e a citação pinta só o texto do autor.
        const all = this.blocksInSelection();
        const mine = all.filter(b => !b.closest(FAIXA_FOREIGN));
        const parts = [];
        for (const block of mine.length ? mine : all) {
          const r = doc.createRange();
          r.selectNodeContents(block);
          if (whole.compareBoundaryPoints(0, r) > 0) {
            r.setStart(whole.startContainer, whole.startOffset);
          }
          if (whole.compareBoundaryPoints(2, r) < 0) {
            r.setEnd(whole.endContainer, whole.endOffset);
          }
          if (!r.collapsed && r.toString().replace(/[\s​]/g, "").length) {
            parts.push(r);
          }
        }
        for (const r of parts) {
          sel.removeAllRanges();
          sel.addRange(r);
          this.applyCharFormat(fmt.char);
        }
        sel.removeAllRanges();
        const again = doc.createRange();
        again.setStart(whole.startContainer, whole.startOffset);
        again.setEnd(whole.endContainer, whole.endOffset);
        sel.addRange(again);
      }
      if (fmt.para) {
        this.applyParaFormat(fmt.para);
      }
      if (restore) {
        restore();
      }
    });
    return true;
  }

  applyCharFormat(c) {
    const doc = this.doc;
    const sel = doc.getSelection();
    this.exec("removeFormat");
    const range = sel.getRangeAt(0);
    const node = this.firstTextNode(range);
    if (!node) {
      return;
    }
    const el = node.parentElement;
    const base = this.charFormatOf(el, this.blockOf(el));
    this.withCSS(true, () => {
      if (c.bold != base.bold) {
        this.exec("bold");
      }
      if (c.italic != base.italic) {
        this.exec("italic");
      }
      if (c.underline != base.underline) {
        this.exec("underline");
      }
      if (c.strike != base.strike) {
        this.exec("strikeThrough");
      }
      if (c.vertical != base.vertical) {
        if (c.vertical == "sub" || (!c.vertical && base.vertical == "sub")) {
          this.exec("subscript");
        }
        if (c.vertical == "super" || (!c.vertical && base.vertical == "super")) {
          this.exec("superscript");
        }
      }
      if (!this.sameFamily(c.fontFamily, base.fontFamily)) {
        this.exec("fontName", c.fontFamily);
      }
      if (c.color && c.color != base.color) {
        this.exec("foreColor", this.rgbToHex(c.color));
      }
      if (c.background && c.background != base.background) {
        this.exec("hiliteColor", this.rgbToHex(c.background));
      }
    });
    if (c.fontSizePt && c.fontSizePt != base.fontSizePt && !sel.isCollapsed) {
      this.sizeSelection(c.fontSizePt);
    }
  }

  applyParaFormat(p) {
    const blocks = this.blocksInSelection().filter(b => this.isParagraph(b));
    if (!blocks.length) {
      return;
    }
    if (p.tag) {
      this.formatBlocks(blocks.filter(b => ["p", "div", "pre", "h1", "h2", "h3", "h4", "h5", "h6"].includes(b.localName)), p.tag);
    }
    for (const block of this.blocksInSelection()) {
      if (!this.isParagraph(block)) {
        continue;
      }
      const cur = block.getAttribute("style") || "";
      if (cur == p.style) {
        continue;
      }
      if (p.style) {
        this.editor.setAttribute(block, "style", p.style);
      } else if (block.hasAttribute("style")) {
        this.editor.removeAttribute(block, "style");
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* envio                                                                */
  /* ------------------------------------------------------------------ */

  /** Ajusta o HTML que sai: parágrafos sem espaço e fonte padrão explícitos,
   * sem marcas do complemento. Só roda no envio (não em rascunhos).
   * Citações, mensagens encaminhadas e <pre> ficam intocados. Da assinatura, só o
   * contêiner recebe a fonte padrão (é como o editor já a mostra); o que ela
   * define por conta própria continua valendo.
   * Devolve undo(): se o envio falhar, o DOM volta exatamente ao que era. */
  normalizeForSend() {
    const doc = this.doc;
    const body = doc && doc.body;
    const log = [];
    let undone = false;
    // Mover os filhos do <font> para o <span> tira o cursor do lugar (o intervalo
    // da seleção sai do nó movido): o undo devolve o cursor exatamente onde estava.
    const sel = doc && doc.getSelection();
    const caret = sel && sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
    const result = {
      changed: 0,
      undo: () => {
        if (undone) {
          return;
        }
        undone = true;
        this.revertLog(log);
        if (caret && caret[0] && caret[2] && caret[0].isConnected && caret[2].isConnected) {
          try {
            sel.setBaseAndExtent(caret[0], caret[1], caret[2], caret[3]);
          } catch (e) {
            this.lastError = e;
          }
        }
      },
    };
    if (!body || !this.host.isHTML()) {
      return result;
    }
    const w = this.win;
    const setStyle = (el, props) => {
      log.push({ type: "attr", el, name: "style", old: el.getAttribute("style") });
      for (const [k, v] of Object.entries(props)) {
        el.style.setProperty(k, v);
      }
      result.changed++;
    };
    // 1. Espaço de largura zero do tamanho escolhido sem texto selecionado.
    for (const zw of this.zwsp) {
      if (zw.isConnected && zw.data.includes(FAIXA_ZWSP)) {
        log.push({ type: "text", node: zw, old: zw.data });
        zw.data = zw.data.split(FAIXA_ZWSP).join("");
        result.changed++;
      }
    }
    // 2. <font> que só tem style (vindo do tamanho em pt) sai como <span>.
    for (const font of [...body.querySelectorAll("font")]) {
      if (![...font.attributes].every(a => a.name == "style")) {
        continue;
      }
      const span = doc.createElement("span");
      if (font.hasAttribute("style")) {
        span.setAttribute("style", font.getAttribute("style"));
      }
      const kids = [...font.childNodes];
      span.append(...kids);
      font.replaceWith(span);
      log.push({ type: "swap", from: font, to: span, kids });
      result.changed++;
    }
    // 3. Parágrafos do autor: o lado sem margem definida (0 na tela, pela folha de
    // agente) sai com margem 0 explícita. Um espaço antes de 12 pt continua; o lado
    // de baixo não pode herdar a margem padrão de 1em do leitor.
    if (this.config.paragrafoSemEspaco !== false) {
      for (const p of body.querySelectorAll("p")) {
        if (p.closest(FAIXA_FOREIGN)) {
          continue;
        }
        const cs = w.getComputedStyle(p);
        const props = {};
        if (!p.style.marginTop && parseFloat(cs.marginTop) == 0) {
          props["margin-top"] = "0";
        }
        if (!p.style.marginBottom && parseFloat(cs.marginBottom) == 0) {
          props["margin-bottom"] = "0";
        }
        if (Object.keys(props).length) {
          setStyle(p, props);
        }
      }
    }
    // 4. Fonte padrão explícita nos blocos de primeiro nível: o Gmail descarta o
    // estilo do <body>, e o Outlook usa Times New Roman quando não há fonte.
    const dflt = this.defaultFont || {};
    const family = body.style.fontFamily || dflt.family || "";
    const size = body.style.fontSize || dflt.size || "";
    if (family || size) {
      const probe = doc.createElement("span");
      probe.style.setProperty("font-size", size || "medium");
      body.append(probe);
      const targetPx = parseFloat(w.getComputedStyle(probe).fontSize);
      probe.remove();
      const skipTop = 'blockquote[type="cite"], .moz-forward-container, pre, br, style, script, meta, link, title';
      // Texto solto direto no corpo (rascunho antigo, modo <br> do Thunderbird): cada
      // trecho vai num <span>, que recebe a fonte padrão logo abaixo.
      const inline = n => n.nodeType == 3 || (n.nodeType == 1 && !FAIXA_TOP_BLOCKS.has(n.localName) && !n.matches(skipTop.replace(", br", "")));
      let run = [];
      const flush = () => {
        if (run.some(n => (n.nodeType == 3 ? n.data.trim() : n.localName != "br"))) {
          const span = doc.createElement("span");
          run[0].before(span);
          span.append(...run);
          log.push({ type: "wrap", span, nodes: run });
          result.changed++;
        }
        run = [];
      };
      for (const n of [...body.childNodes]) {
        if (inline(n)) {
          run.push(n);
        } else {
          flush();
        }
      }
      flush();
      for (const child of [...body.children]) {
        if (child.matches(skipTop)) {
          continue;
        }
        const props = {};
        if (family && !child.style.fontFamily) {
          props["font-family"] = family;
        }
        if (size && !child.style.fontSize && Math.abs(parseFloat(w.getComputedStyle(child).fontSize) - targetPx) < 0.2) {
          props["font-size"] = size;
        }
        if (Object.keys(props).length) {
          setStyle(child, props);
        }
      }
    }
    return result;
  }

  revertLog(log) {
    for (const op of log.slice().reverse()) {
      try {
        if (op.type == "attr") {
          if (op.old == null) {
            op.el.removeAttribute(op.name);
            // O Blink (simulador) sincroniza o atributo style só quando alguém o lê:
            // o primeiro remove esvazia a declaração e sobra style="". O Gecko remove de primeira.
            if (op.el.hasAttribute(op.name)) {
              op.el.removeAttribute(op.name);
            }
          } else {
            op.el.setAttribute(op.name, op.old);
          }
        } else if (op.type == "text") {
          op.node.data = op.old;
        } else if (op.type == "swap") {
          op.from.append(...op.kids);
          op.to.replaceWith(op.from);
        } else if (op.type == "wrap") {
          op.span.before(...op.nodes);
          op.span.remove();
        }
      } catch (e) {
        this.lastError = e;
      }
    }
  }
};
