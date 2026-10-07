/* Faixa de Opções — Partes Rápidas, como a galeria do Outlook (Inserir → Partes Rápidas).
 *
 * Trechos prontos de texto e formatação: os do usuário (storage.local, chave
 * "partesRapidas") e os da organização (política, chave "partesRapidas"), que vêm
 * primeiro e não podem ser mudados. Na mensagem entram no ponto do cursor, num passo só
 * do desfazer, com os mesmos campos das assinaturas ({nome}, {email}, {telefone}...)
 * preenchidos pela conta do De:. No texto sem formatação entra o texto.
 *
 * "Salvar Seleção na Galeria de Partes Rápidas" guarda o trecho selecionado, com a
 * formatação que ele tem na mensagem, depois de passar pelo FaixaSanitizer.
 *
 * As funções estáticas também servem à página Partes Rápidas (options/partes.html). */

"use strict";

/* global FaixaSanitizer, FaixaSignatures */

var FaixaQuickParts = class {
  /** Maior Parte Rápida aceita (o HTML, com as imagens dentro). */
  static MAX_HTML = 1024 * 1024;

  static BLOCKS = new Set([
    "address", "blockquote", "center", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5", "h6",
    "li", "ol", "p", "pre", "table", "tr", "ul",
  ]);

  /** Partes válidas da configuração: as da organização primeiro. */
  static list(config) {
    return ((config && config.partesRapidas) || []).filter(p => p && typeof p.id == "string" && p.id && typeof p.html == "string");
  }

  static byId(config, id) {
    return FaixaQuickParts.list(config).find(p => p.id == id) || null;
  }

  /** Texto de uma árvore: quebra de linha nos <br> e entre blocos; células separadas por
   * tabulação, como no texto sem formatação do Thunderbird. */
  static textOf(root) {
    let out = "";
    const walk = node => {
      for (const n of node.childNodes) {
        if (n.nodeType == 3) {
          out += n.data.replace(/[\t\n\r ]+/g, " ");
          continue;
        }
        if (n.nodeType != 1) {
          continue;
        }
        const tag = n.localName;
        if (tag == "br") {
          out += "\n";
          continue;
        }
        if (tag == "img") {
          out += n.getAttribute("alt") || "";
          continue;
        }
        const block = FaixaQuickParts.BLOCKS.has(tag);
        if (block && out && !out.endsWith("\n")) {
          out += "\n";
        }
        if ((tag == "td" || tag == "th") && n.previousElementSibling) {
          out += "\t";
        }
        walk(n);
        if (block && out && !out.endsWith("\n")) {
          out += "\n";
        }
      }
    };
    walk(root);
    return out.replace(/ +\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  }

  /** A parte pronta: <div> com o conteúdo limpo e os campos preenchidos, no documento doc
   * (win dá o DOMParser quando doc é inerte). */
  static render(doc, part, identity, win = doc.defaultView) {
    const box = doc.createElement("div");
    box.append(FaixaSanitizer.clean(part.html, doc, win));
    FaixaSignatures.fill(box, FaixaSignatures.vars(identity));
    return box;
  }

  /** Começo do texto, para a segunda linha do item no menu (montado num documento inerte:
   * as imagens da parte não carregam só para mostrar o menu). */
  static preview(win, part, max = 60) {
    const inert = FaixaSanitizer.inertDocument(win);
    const box = inert.createElement("div");
    box.append(FaixaSanitizer.clean(part.html, inert, win));
    const text = FaixaQuickParts.textOf(box).replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
  }

  /* ---------- na janela de composição ---------- */

  /**
   * @param {object} o
   * @param {object} o.host      FaixaTBHost (ou o simulado)
   * @param {Function} o.config  () => configuração efetiva
   * @param {Function} o.engine  () => FaixaEngine (ou null antes do editor pronto)
   */
  constructor(o) {
    this.host = o.host;
    this.getConfig = o.config;
    this.getEngine = o.engine;
  }

  get config() {
    return this.getConfig() || {};
  }

  /** Para o menu Partes Rápidas: [{ id, nome, gerenciada, preview }]. */
  menuList() {
    const win = this.host.editorWin || this.host.chromeWin;
    return FaixaQuickParts.list(this.config).map(p => {
      let preview = "";
      try {
        preview = FaixaQuickParts.preview(win, p);
      } catch (e) {}
      return { id: p.id, nome: p.nome || p.id, gerenciada: !!p.gerenciada, preview };
    });
  }

  /** Insere a parte no ponto do cursor. plain: a mensagem vai como texto sem formatação
   * (o editor continua HTML): entra só o texto, sem trazer formatação de volta. Devolve se inseriu. */
  insert(id, { plain = false } = {}) {
    const part = FaixaQuickParts.byId(this.config, id);
    const engine = this.getEngine();
    const doc = this.host.editorDoc;
    const win = this.host.editorWin;
    if (!part || !engine || !doc || !win) {
      return false;
    }
    // Montada num documento inerte: no editor, é o insertHTML que cria as imagens de
    // verdade, com o conteúdo remoto já liberado se a parte tiver imagem de fora.
    const inert = FaixaSanitizer.inertDocument(win);
    const box = FaixaQuickParts.render(inert, part, this.host.currentIdentity() || {}, win);
    if (plain || !this.host.isHTML()) {
      engine.insertText(FaixaQuickParts.textOf(box));
      return true;
    }
    if (FaixaSanitizer.hasRemoteImages(box)) {
      this.host.allowRemoteContent();
    }
    engine.insertHTML(box.innerHTML);
    return true;
  }

  /** A seleção do corpo, para salvar como Parte Rápida: { html, text, name } ou null.
   * Guarda também a formatação que o trecho herda (o negrito em volta, a cor do <span>). */
  selection() {
    const doc = this.host.editorDoc;
    const sel = doc && doc.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) {
      return null;
    }
    const range = sel.getRangeAt(0);
    let frag = range.cloneContents();
    const INLINE = /^(a|b|big|cite|code|em|font|i|kbd|mark|q|s|samp|small|span|strike|strong|sub|sup|tt|u|var)$/;
    let node = range.commonAncestorContainer;
    node = node.nodeType == 1 ? node : node.parentNode;
    while (node && node != doc.body && node.nodeType == 1 && INLINE.test(node.localName)) {
      const wrap = node.cloneNode(false);
      wrap.append(frag);
      frag = doc.createDocumentFragment();
      frag.append(wrap);
      node = node.parentNode;
    }
    const box = doc.createElement("div");
    box.append(frag);
    const text = FaixaQuickParts.textOf(box);
    if (!text.trim() && !box.querySelector("img")) {
      return null;
    }
    let html;
    if (this.host.isHTML()) {
      const win = this.host.editorWin;
      html = FaixaSanitizer.toHTML(box.innerHTML, FaixaSanitizer.inertDocument(win), win);
    } else {
      const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html = esc(text).replace(/\n/g, "<br>");
    }
    const words = text.replace(/\s+/g, " ").trim();
    const name = words.length > 40 ? words.slice(0, 40).replace(/\s+\S*$/, "") || words.slice(0, 40) : words;
    return { html, text, name };
  }
};
