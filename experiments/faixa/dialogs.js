/* Faixa de Opções — janelas modais da faixa: Verificar Nomes (escolha entre nomes
 * parecidos) e Selecionar Nomes (Catálogo de Endereços).
 *
 * Ficam na camada da faixa (.fx-layer), por cima da janela de composição, com o
 * foco preso dentro delas até fechar, como os diálogos do Outlook. Não conhecem o
 * Thunderbird: recebem os dados e devolvem a escolha. */

"use strict";

/* global FaixaI18n */

var FaixaDialog = class {
  /**
   * @param {FaixaUI} ui
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.cls]
   * @param {Function} o.build  (dlg) => void: monta dlg.body e os botões (dlg.button)
   */
  constructor(ui, o) {
    this.ui = ui;
    this.o = o;
    this.resolve = null;
  }

  open() {
    const ui = this.ui;
    const t = FaixaI18n.t.bind(FaixaI18n);
    if (ui.dialog) {
      ui.dialog.close(null);
    }
    ui.closePopup();
    ui.hideTip();
    this.returnTo = ui.doc.activeElement;
    FaixaDialog.seq = (FaixaDialog.seq || 0) + 1;
    const titleId = "fx-dlg-title-" + FaixaDialog.seq;
    this.backdrop = ui.h("div", { class: "fx-backdrop" });
    this.el = ui.h("div", { class: ("fx-dialog " + (this.o.cls || "")).trim(), role: "dialog", "aria-modal": "true", "aria-labelledby": titleId });
    const close = ui.h("button", { class: "fx-dclose", type: "button", "aria-label": t("dialog.close", "Fechar") });
    close.append(ui.icon("x"));
    close.addEventListener("click", () => this.close(null));
    const head = ui.h("div", { class: "fx-dhead" }, ui.h("div", { class: "fx-dtitle", id: titleId, text: this.o.title }), close);
    this.body = ui.h("div", { class: "fx-dbody" });
    this.footLeft = ui.h("div", { class: "fx-dfootl" });
    this.footRight = ui.h("div", { class: "fx-dfootr" });
    this.el.append(head, this.body, ui.h("div", { class: "fx-dfoot" }, this.footLeft, this.footRight));
    this.backdrop.append(this.el);
    this.el.addEventListener("keydown", e => this.onKey(e));
    ui.layer.append(this.backdrop);
    ui.dialog = this;
    this.o.build(this);
    const first = this.initialFocus || this.focusables()[0];
    if (first) {
      first.focus();
    }
    return new Promise(resolve => (this.resolve = resolve));
  }

  /** Botão do rodapé. primary: o Enter numa caixa de texto aciona este. */
  button(label, onClick, { primary = false, left = false } = {}) {
    const b = this.ui.h("button", { class: "fx-dbtn" + (primary ? " fx-dpri" : ""), type: "button", text: label });
    b.addEventListener("click", () => onClick());
    (left ? this.footLeft : this.footRight).append(b);
    if (primary) {
      this.primary = b;
    }
    return b;
  }

  focusables() {
    return [...this.el.querySelectorAll("button, input, select, [tabindex='0']")].filter(el => !el.disabled && el.getClientRects().length > 0);
  }

  onKey(e) {
    if (e.key == "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close(null);
      return;
    }
    if (e.key == "Tab") {
      // O foco não sai da janela.
      const list = this.focusables();
      if (!list.length) {
        return;
      }
      const i = list.indexOf(this.ui.doc.activeElement);
      const next = e.shiftKey ? list[(i - 1 + list.length) % list.length] : list[(i + 1) % list.length];
      e.preventDefault();
      next.focus();
      return;
    }
    if (e.key == "Enter" && !e.defaultPrevented && e.target.localName == "input" && this.primary && !this.primary.disabled) {
      e.preventDefault();
      this.primary.click();
    }
  }

  close(result) {
    if (!this.backdrop) {
      return;
    }
    this.backdrop.remove();
    this.backdrop = null;
    if (this.ui.dialog == this) {
      this.ui.dialog = null;
    }
    const back = this.returnTo;
    if (back && back.isConnected && typeof back.focus == "function") {
      back.focus();
    }
    if (this.resolve) {
      this.resolve(result);
    }
  }
};

/** Lista com seleção pelo mouse e pelo teclado: pessoas (nome, e-mail, catálogo) ou,
 * com cells, qualquer coisa (mensagens, formatos de data). */
var FaixaPeopleList = class {
  constructor(ui, { multi = false, label, onActivate, cells = null, rowCls = "" }) {
    this.ui = ui;
    this.multi = multi;
    this.cells = cells;
    this.rowCls = rowCls;
    this.onActivate = onActivate || (() => {});
    this.items = [];
    this.selected = new Set();
    this.current = -1;
    this.anchor = -1;
    this.el = ui.h("div", { class: "fx-plist", role: "listbox", tabindex: "0", "aria-label": label });
    if (multi) {
      this.el.setAttribute("aria-multiselectable", "true");
    }
    this.el.addEventListener("keydown", e => this.onKey(e));
    this.el.addEventListener("focus", () => {
      if (this.current < 0 && this.items.length) {
        this.select(0, {});
      }
    });
  }

  setItems(items) {
    const ui = this.ui;
    this.items = items;
    this.selected.clear();
    this.current = -1;
    this.anchor = -1;
    this.rows = items.map((it, i) => {
      const cells = this.cells
        ? this.cells(it).map(c => ui.h("span", { class: c.cls || "", text: c.text == null ? "" : String(c.text) }))
        : [
          ui.h("span", { class: "fx-pname", text: it.name || it.email || "" }),
          ui.h("span", { class: "fx-pmail", text: it.isList ? FaixaI18n.t("names.list", "lista de distribuição") : it.email }),
          ui.h("span", { class: "fx-pbook", text: it.book || "" }),
        ];
      const row = ui.h("div", { class: ("fx-prow " + this.rowCls).trim(), role: "option", id: "fx-pl-" + FaixaDialog.seq + "-" + i, "aria-selected": "false" }, ...cells);
      row.addEventListener("mousedown", e => {
        e.preventDefault();
        this.el.focus();
        this.select(i, { toggle: this.multi && (e.ctrlKey || e.metaKey), extend: this.multi && e.shiftKey });
      });
      row.addEventListener("dblclick", () => this.onActivate(this.selectedItems()));
      return row;
    });
    this.el.replaceChildren(...this.rows);
    this.el.removeAttribute("aria-activedescendant");
  }

  select(i, { toggle = false, extend = false }) {
    if (i < 0 || i >= this.items.length) {
      return;
    }
    if (extend && this.anchor >= 0) {
      this.selected.clear();
      const [a, b] = this.anchor < i ? [this.anchor, i] : [i, this.anchor];
      for (let k = a; k <= b; k++) {
        this.selected.add(k);
      }
    } else if (toggle) {
      if (this.selected.has(i)) {
        this.selected.delete(i);
      } else {
        this.selected.add(i);
      }
      this.anchor = i;
    } else {
      this.selected.clear();
      this.selected.add(i);
      this.anchor = i;
    }
    this.current = i;
    this.rows.forEach((r, k) => {
      r.setAttribute("aria-selected", this.selected.has(k) ? "true" : "false");
      r.classList.toggle("fx-pcur", k == i);
    });
    this.el.setAttribute("aria-activedescendant", this.rows[i].id);
    this.rows[i].scrollIntoView({ block: "nearest" });
  }

  selectedItems() {
    return [...this.selected].sort((a, b) => a - b).map(i => this.items[i]);
  }

  onKey(e) {
    const n = this.items.length;
    if (!n) {
      return;
    }
    const page = Math.max(1, Math.floor(this.el.clientHeight / 26) - 1);
    let to = null;
    switch (e.key) {
      case "ArrowDown":
        to = Math.min(n - 1, this.current + 1);
        break;
      case "ArrowUp":
        to = Math.max(0, this.current - 1);
        break;
      case "PageDown":
        to = Math.min(n - 1, this.current + page);
        break;
      case "PageUp":
        to = Math.max(0, this.current - page);
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = n - 1;
        break;
      case " ":
        if (this.multi && this.current >= 0) {
          e.preventDefault();
          this.select(this.current, { toggle: true });
        }
        return;
      case "a":
        if (this.multi && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.items.forEach((x, k) => this.selected.add(k));
          this.rows.forEach(r => r.setAttribute("aria-selected", "true"));
        }
        return;
      case "Enter":
        if (this.selected.size) {
          e.preventDefault();
          e.stopPropagation();
          this.onActivate(this.selectedItems());
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    this.select(to, { extend: this.multi && e.shiftKey });
  }
};

var FaixaDialogs = {
  /** Verificar Nomes com mais de uma pessoa possível: devolve { item }, { more: true } ou null. */
  choose(ui, { text, items }) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const dlg = new FaixaDialog(ui, {
      title: t("names.checkTitle", "Verificar Nomes"),
      cls: "fx-dchoose",
      build(d) {
        const msg = ui.h("p", { class: "fx-dmsg", id: "fx-dlg-msg-" + FaixaDialog.seq, text: t("names.checkMore", "Há mais de um “{text}” nos catálogos de endereços. Escolha quem vai receber a mensagem:", { text }) });
        d.el.setAttribute("aria-describedby", msg.id);
        const list = new FaixaPeopleList(ui, { label: t("names.matches", "Nomes encontrados"), onActivate: () => ok() });
        list.setItems(items);
        const ok = () => {
          const [item] = list.selectedItems();
          if (item) {
            d.close({ item });
          }
        };
        d.body.append(msg, list.el);
        d.button(t("names.showMore", "Mostrar Mais Nomes…"), () => d.close({ more: true }), { left: true });
        d.button(t("dialog.ok", "OK"), ok, { primary: true });
        d.button(t("dialog.cancel", "Cancelar"), () => d.close(null));
        list.select(0, {});
        d.initialFocus = list.el;
      },
    });
    return dlg.open();
  },

  /**
   * Selecionar Nomes, como no Outlook: pesquisa nos catálogos, lista com seleção
   * múltipla e os botões Para, Cc e Cco que juntam os escolhidos em cada campo.
   * @param {object} o
   * @param {Array} o.books      [{ id, name, remote }]
   * @param {Function} o.search  (texto, bookId) => Promise<pessoas>
   * @param {Array} o.targets    [{ type, label }] (Para, Cc, Cco)
   * @param {string} [o.text]    pesquisa inicial
   * @returns {Promise<object|null>} { addr_to: "texto do campo", ... } ou null
   */
  selectNames(ui, o) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const dlg = new FaixaDialog(ui, {
      title: t("names.selectTitle", "Selecionar Nomes"),
      cls: "fx-dselect",
      build(d) {
        const h = ui.h.bind(ui);
        const search = h("input", { type: "search", class: "fx-dsearch", "aria-label": t("names.search", "Pesquisar"), placeholder: t("names.searchHint", "Nome, e-mail ou empresa"), autocomplete: "off", spellcheck: "false" });
        const book = h("select", { class: "fx-dbook", "aria-label": t("names.book", "Catálogo de Endereços") });
        book.append(h("option", { value: "", text: t("names.allBooks", "Todos os catálogos") }));
        for (const b of o.books) {
          book.append(h("option", { value: b.id, text: b.name }));
        }
        const note = h("div", { class: "fx-dnote", role: "status" });
        const fields = {};
        let lastTarget = o.first || o.targets[0].type;
        const add = (type, items) => {
          const f = fields[type];
          const have = new Set(o.parse(f.value).map(a => (a.email || a.text).toLowerCase()));
          const more = items.map(it => it.address).filter(a => {
            const [p] = o.parse(a);
            const key = p ? (p.email || p.text).toLowerCase() : a.toLowerCase();
            if (have.has(key)) {
              return false;
            }
            have.add(key);
            return true;
          });
          if (more.length) {
            f.value = [f.value.trim().replace(/[,;]\s*$/, ""), ...more].filter(Boolean).join("; ");
          }
          lastTarget = type;
        };
        const list = new FaixaPeopleList(ui, { multi: true, label: t("names.results", "Contatos"), onActivate: items => add(lastTarget, items) });
        const top = h("div", { class: "fx-drow" },
          h("label", { class: "fx-dlabel", text: t("names.search", "Pesquisar") }), search,
          h("label", { class: "fx-dlabel", text: t("names.book", "Catálogo de Endereços") }), book);
        const targetRows = h("div", { class: "fx-dtargets" });
        for (const target of o.targets) {
          const btn = h("button", { class: "fx-dbtn fx-dtarget", type: "button", text: target.label + " →" });
          const field = h("input", { type: "text", class: "fx-dfield", "aria-label": target.label, autocomplete: "off", spellcheck: "false" });
          btn.addEventListener("click", () => add(target.type, list.selectedItems()));
          fields[target.type] = field;
          targetRows.append(btn, field);
        }
        d.body.append(top, list.el, note, targetRows);
        d.button(t("dialog.ok", "OK"), () => {
          const out = {};
          for (const target of o.targets) {
            out[target.type] = fields[target.type].value;
          }
          d.close(out);
        }, { primary: true });
        d.button(t("dialog.cancel", "Cancelar"), () => d.close(null));

        let seq = 0;
        const run = async () => {
          const my = ++seq;
          const bookId = book.value || null;
          const remote = bookId && (o.books.find(b => b.id == bookId) || {}).remote;
          const text = search.value.trim();
          if (remote && !text) {
            list.setItems([]);
            note.textContent = t("names.typeToSearch", "Digite um nome para pesquisar neste catálogo.");
            return;
          }
          note.textContent = t("names.searching", "Pesquisando…");
          let items = [];
          try {
            items = await o.search(text, bookId);
          } catch (e) {
            items = [];
          }
          if (my != seq || !d.backdrop) {
            return;
          }
          const max = 300;
          list.setItems(items.slice(0, max));
          note.textContent = !items.length
            ? t("names.none", "Nenhum contato encontrado.")
            : items.length > max
              ? t("names.tooMany", "Mostrando {max} de {n}. Digite para refinar.", { max, n: items.length })
              : items.length == 1
                ? t("names.countOne", "1 contato")
                : t("names.count", "{n} contatos", { n: items.length });
        };
        let timer = 0;
        search.addEventListener("input", () => {
          ui.win.clearTimeout(timer);
          timer = ui.win.setTimeout(run, 180);
        });
        search.addEventListener("keydown", e => {
          // Enter na pesquisa pesquisa (não fecha a janela); ↓ ou Enter com resultado vai para a lista.
          if (e.key == "Enter" || e.key == "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            if (!list.items.length) {
              ui.win.clearTimeout(timer);
              run();
              return;
            }
            list.el.focus();
            if (list.current < 0) {
              list.select(0, {});
            }
          }
        });
        book.addEventListener("change", run);
        search.value = o.text || "";
        d.initialFocus = search;
        d.fields = fields;
        d.list = list;
        d.search = search;
        d.ready = run();
      },
    });
    const p = dlg.open();
    p.dialog = dlg;
    return p;
  },

  /** Pergunta com OK e Cancelar: devolve true ou false. */
  confirm(ui, { title, message, ok, cancel }) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const dlg = new FaixaDialog(ui, {
      title,
      cls: "fx-dsmall",
      build(d) {
        const msg = ui.h("p", { class: "fx-dmsg", id: "fx-dlg-msg-" + FaixaDialog.seq, text: message });
        d.el.setAttribute("aria-describedby", msg.id);
        d.body.append(msg);
        d.initialFocus = d.button(ok || t("dialog.ok", "OK"), () => d.close(true), { primary: true });
        d.button(cancel || t("dialog.cancel", "Cancelar"), () => d.close(false));
      },
    });
    return dlg.open().then(v => v === true);
  },

  /** Um nome (Salvar na galeria de Partes Rápidas): devolve o texto ou null.
   * validate(texto) devolve a mensagem de erro, ou nada se estiver certo. */
  prompt(ui, { title, message, label, value = "", validate = null }) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const dlg = new FaixaDialog(ui, {
      title,
      cls: "fx-dsmall",
      build(d) {
        const id = "fx-dlg-in-" + FaixaDialog.seq;
        const input = ui.h("input", { type: "text", class: "fx-dfield fx-dwide", id, autocomplete: "off", spellcheck: "false" });
        const err = ui.h("div", { class: "fx-derr", role: "alert" });
        if (message) {
          d.body.append(ui.h("p", { class: "fx-dmsg", text: message }));
        }
        d.body.append(ui.h("label", { class: "fx-dlabel", for: id, text: label }), input, err);
        const ok = () => {
          const v = input.value.trim();
          const problem = !v ? t("dialog.nameEmpty", "Digite um nome.") : validate ? validate(v) : null;
          if (problem) {
            err.textContent = problem;
            input.focus();
            input.select();
            return;
          }
          d.close(v);
        };
        d.button(t("dialog.ok", "OK"), ok, { primary: true });
        d.button(t("dialog.cancel", "Cancelar"), () => d.close(null));
        input.addEventListener("input", () => (err.textContent = ""));
        input.value = value;
        d.initialFocus = input;
        d.input = input;
      },
    });
    const p = dlg.open();
    if (dlg.input) {
      dlg.input.select();
    }
    p.dialog = dlg;
    return p;
  },

  /** Formatos de data e hora de Data e Hora, como no Word, no idioma dado. */
  dateFormats(date, locale) {
    const f = o => {
      try {
        return new Intl.DateTimeFormat(locale, o).format(date);
      } catch (e) {
        return "";
      }
    };
    const numeric = f({ day: "numeric", month: "numeric", year: "numeric" });
    const pad = n => String(n).padStart(2, "0");
    const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const time = f({ timeStyle: "short" });
    const list = [
      { id: "numeric", text: numeric },
      { id: "full", text: f({ dateStyle: "full" }) },
      { id: "long", text: f({ dateStyle: "long" }) },
      { id: "medium", text: f({ dateStyle: "medium" }) },
      { id: "monthYear", text: f({ month: "long", year: "numeric" }) },
      { id: "iso", text: iso },
      { id: "dateTime", text: numeric && time ? numeric + " " + time : "" },
      { id: "time", text: time },
      { id: "timeSeconds", text: f({ timeStyle: "medium" }) },
    ];
    const seen = new Set();
    return list.filter(x => x.text && !seen.has(x.text) && seen.add(x.text));
  },

  /** Data e Hora: a lista de formatos da data e hora de agora, com o idioma. Devolve o
   * texto escolhido ou null. O último formato e idioma escolhidos voltam na próxima vez. */
  dateTime(ui, { now = new Date(), locale = FaixaI18n.locale } = {}) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const last = FaixaDialogs.lastDate || { id: "numeric", locale };
    const dlg = new FaixaDialog(ui, {
      title: t("date.title", "Data e Hora"),
      cls: "fx-ddate",
      build(d) {
        const h = ui.h.bind(ui);
        const lang = h("select", { class: "fx-dbook", "aria-label": t("date.lang", "Idioma") },
          ...FaixaI18n.LOCALES.map(l => h("option", { value: l, lang: l, text: FaixaI18n.NAMES[l] })));
        lang.value = FaixaI18n.LOCALES.includes(last.locale) ? last.locale : "pt-BR";
        const list = new FaixaPeopleList(ui, { label: t("date.formats", "Formatos disponíveis"), rowCls: "fx-1col", cells: it => [{ text: it.text }], onActivate: () => ok() });
        const fill = keepId => {
          const items = FaixaDialogs.dateFormats(now, lang.value);
          list.setItems(items);
          const i = Math.max(0, items.findIndex(x => x.id == keepId));
          if (items.length) {
            list.select(i, {});
          }
        };
        const ok = () => {
          const [item] = list.selectedItems();
          if (item) {
            FaixaDialogs.lastDate = { id: item.id, locale: lang.value };
            d.close(item.text);
          }
        };
        lang.addEventListener("change", () => {
          const [cur] = list.selectedItems();
          fill(cur ? cur.id : last.id);
        });
        d.body.append(h("div", { class: "fx-dlabel", text: t("date.formats", "Formatos disponíveis") }), list.el,
          h("div", { class: "fx-drow" }, h("label", { class: "fx-dlabel", text: t("date.lang", "Idioma") }), lang));
        d.button(t("dialog.ok", "OK"), ok, { primary: true });
        d.button(t("dialog.cancel", "Cancelar"), () => d.close(null));
        fill(last.id);
        d.initialFocus = list.el;
        d.list = list;
        d.lang = lang;
      },
    });
    const p = dlg.open();
    p.dialog = dlg;
    return p;
  },

  /**
   * Anexar Mensagem (o Item do Outlook): as mensagens de uma pasta, das mais novas para
   * as mais antigas, com pesquisa por assunto e remetente. Devolve os ids escolhidos ou null.
   * @param {object} o
   * @param {Array} o.folders     [{ id, name, depth, account }]
   * @param {string} [o.folderId] pasta que abre primeiro
   * @param {Array} [o.selected]  mensagens que já vêm marcadas (as selecionadas na janela principal)
   * @param {Function} o.list     (folderId, texto) => Promise<{ items, total, capped, error }>
   */
  pickMessages(ui, o) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const dlg = new FaixaDialog(ui, {
      title: t("msg.title", "Anexar Mensagem"),
      cls: "fx-dselect fx-dmsgs",
      build(d) {
        const h = ui.h.bind(ui);
        const folder = h("select", { class: "fx-dbook fx-dfolder", "aria-label": t("msg.folder", "Pasta") });
        let group = null;
        let account = null;
        for (const f of o.folders) {
          if (f.account != account) {
            account = f.account;
            group = h("optgroup", { label: account || "" });
            folder.append(group);
          }
          group.append(h("option", { value: f.id, text: "  ".repeat(f.depth || 0) + f.name }));
        }
        if (o.folderId && o.folders.some(f => f.id == o.folderId)) {
          folder.value = o.folderId;
        }
        const search = h("input", { type: "search", class: "fx-dsearch", "aria-label": t("msg.search", "Pesquisar"), placeholder: t("msg.searchHint", "Assunto ou remetente"), autocomplete: "off", spellcheck: "false" });
        const note = h("div", { class: "fx-dnote", role: "status" });
        const when = ms => {
          try {
            return new Date(ms).toLocaleString(FaixaI18n.locale, { dateStyle: "short", timeStyle: "short" });
          } catch (e) {
            return "";
          }
        };
        const list = new FaixaPeopleList(ui, {
          multi: true,
          label: t("msg.list", "Mensagens"),
          rowCls: "fx-mrow",
          cells: m => [{ cls: "fx-pname", text: m.subject || t("msg.noSubject", "(sem assunto)") }, { cls: "fx-pmail", text: m.author }, { cls: "fx-pbook", text: when(m.date) }],
          onActivate: () => ok(),
        });
        const head = h("div", { class: "fx-prow fx-mrow fx-phead", "aria-hidden": "true" },
          h("span", { text: t("msg.col.subject", "Assunto") }), h("span", { text: t("msg.col.from", "De") }), h("span", { text: t("msg.col.date", "Recebida") }));
        d.body.append(h("div", { class: "fx-drow" },
          h("label", { class: "fx-dlabel", text: t("msg.folder", "Pasta") }), folder,
          h("label", { class: "fx-dlabel", text: t("msg.search", "Pesquisar") }), search), head, list.el, note);
        const ok = () => {
          const items = list.selectedItems();
          if (items.length) {
            d.close(items.map(m => m.id));
          }
        };
        d.button(t("msg.attach", "Anexar"), ok, { primary: true });
        d.button(t("dialog.cancel", "Cancelar"), () => d.close(null));
        let preselect = new Set(o.selected || []);
        let seq = 0;
        const run = async () => {
          const my = ++seq;
          note.textContent = t("msg.loading", "Lendo as mensagens…");
          let r = { items: [] };
          try {
            r = (await o.list(folder.value, search.value.trim())) || { items: [] };
          } catch (e) {
            r = { items: [], error: String((e && e.message) || e) };
          }
          if (my != seq || !d.backdrop) {
            return;
          }
          const items = r.items || [];
          list.setItems(items);
          const pre = items.map((m, i) => (preselect.has(m.id) ? i : -1)).filter(i => i >= 0);
          preselect = new Set();
          pre.forEach((i, k) => list.select(i, { toggle: k > 0 }));
          note.textContent = r.error
            ? t("msg.error", "Não foi possível ler esta pasta. Abra-a na janela principal do Thunderbird e tente de novo.")
            : !items.length
              ? t("msg.none", "Nenhuma mensagem.")
              : r.capped
                ? t("msg.capped", "Mostrando as {n} mais recentes. Pesquise para achar outras.", { n: items.length })
                : items.length == 1
                  ? t("msg.countOne", "1 mensagem")
                  : t("msg.count", "{n} mensagens", { n: items.length });
        };
        let timer = 0;
        search.addEventListener("input", () => {
          ui.win.clearTimeout(timer);
          timer = ui.win.setTimeout(run, 220);
        });
        search.addEventListener("keydown", e => {
          if (e.key == "Enter" || e.key == "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            if (!list.items.length) {
              ui.win.clearTimeout(timer);
              run();
              return;
            }
            list.el.focus();
            if (list.current < 0) {
              list.select(0, {});
            }
          }
        });
        folder.addEventListener("change", run);
        d.initialFocus = (o.selected || []).length ? list.el : search;
        d.list = list;
        d.folder = folder;
        d.search = search;
        d.ready = run();
      },
    });
    const p = dlg.open();
    p.dialog = dlg;
    return p;
  },

  /** Outros Cartões de Visita: contatos dos catálogos, para anexar o vCard de cada um.
   * Devolve os contatos escolhidos ou null. */
  pickContacts(ui, o) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const dlg = new FaixaDialog(ui, {
      title: t("card.title", "Inserir Cartão de Visita"),
      cls: "fx-dselect fx-dcards",
      build(d) {
        const h = ui.h.bind(ui);
        const search = h("input", { type: "search", class: "fx-dsearch", "aria-label": t("names.search", "Pesquisar"), placeholder: t("names.searchHint", "Nome, e-mail ou empresa"), autocomplete: "off", spellcheck: "false" });
        const book = h("select", { class: "fx-dbook", "aria-label": t("names.book", "Catálogo de Endereços") });
        book.append(h("option", { value: "", text: t("names.allBooks", "Todos os catálogos") }));
        for (const b of o.books) {
          book.append(h("option", { value: b.id, text: b.name }));
        }
        const note = h("div", { class: "fx-dnote", role: "status" });
        const list = new FaixaPeopleList(ui, { multi: true, label: t("names.results", "Contatos"), onActivate: () => ok() });
        d.body.append(h("div", { class: "fx-drow" },
          h("label", { class: "fx-dlabel", text: t("names.search", "Pesquisar") }), search,
          h("label", { class: "fx-dlabel", text: t("names.book", "Catálogo de Endereços") }), book),
        h("p", { class: "fx-dmsg", text: t("card.lead", "O cartão de visita (vCard) de cada contato escolhido vai anexo à mensagem.") }), list.el, note);
        const ok = () => {
          const items = list.selectedItems();
          if (items.length) {
            d.close(items);
          }
        };
        d.button(t("dialog.ok", "OK"), ok, { primary: true });
        d.button(t("dialog.cancel", "Cancelar"), () => d.close(null));
        let seq = 0;
        const run = async () => {
          const my = ++seq;
          const bookId = book.value || null;
          const remote = bookId && (o.books.find(b => b.id == bookId) || {}).remote;
          const text = search.value.trim();
          if (remote && !text) {
            list.setItems([]);
            note.textContent = t("names.typeToSearch", "Digite um nome para pesquisar neste catálogo.");
            return;
          }
          note.textContent = t("names.searching", "Pesquisando…");
          let items = [];
          try {
            items = (await o.search(text, bookId)).filter(it => !it.isList);
          } catch (e) {
            items = [];
          }
          if (my != seq || !d.backdrop) {
            return;
          }
          // Um contato com vários e-mails aparece uma vez só (é um cartão).
          const seen = new Set();
          items = items.filter(it => {
            const key = it.bookId + "|" + (it.cardId || it.email);
            return !seen.has(key) && seen.add(key);
          });
          const max = 300;
          list.setItems(items.slice(0, max));
          note.textContent = !items.length
            ? t("names.none", "Nenhum contato encontrado.")
            : items.length > max
              ? t("names.tooMany", "Mostrando {max} de {n}. Digite para refinar.", { max, n: items.length })
              : items.length == 1
                ? t("names.countOne", "1 contato")
                : t("names.count", "{n} contatos", { n: items.length });
        };
        let timer = 0;
        search.addEventListener("input", () => {
          ui.win.clearTimeout(timer);
          timer = ui.win.setTimeout(run, 180);
        });
        search.addEventListener("keydown", e => {
          if (e.key == "Enter" || e.key == "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            if (!list.items.length) {
              ui.win.clearTimeout(timer);
              run();
              return;
            }
            list.el.focus();
            if (list.current < 0) {
              list.select(0, {});
            }
          }
        });
        book.addEventListener("change", run);
        d.initialFocus = search;
        d.list = list;
        d.search = search;
        d.ready = run();
      },
    });
    const p = dlg.open();
    p.dialog = dlg;
    return p;
  },

  /** Sobre: versão da faixa e do Thunderbird. Devolve "diagnostics" se o usuário pediu o diagnóstico. */
  about(ui, { version, app, platform, language }) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const dlg = new FaixaDialog(ui, {
      title: t("about.title", "Sobre a Faixa de Opções"),
      cls: "fx-dsmall fx-dabout",
      build(d) {
        const h = ui.h.bind(ui);
        const logo = h("div", { class: "fx-dlogo" });
        logo.append(ui.icon("panels-top-left"));
        d.body.append(h("div", { class: "fx-dbrand" }, logo,
          h("div", {}, h("div", { class: "fx-dname", text: t("about.name", "Faixa de Opções {version}", { version }) }), h("div", { class: "fx-dlabel", text: "Bluecker" }))),
        h("p", { class: "fx-dmsg", text: t("about.lead", "Recria no Thunderbird a faixa de opções da janela de composição do Outlook.") }),
        h("p", { class: "fx-dmsg fx-dlabel", text: t("about.env", "{app} · {platform} · faixa em {language}", { app, platform, language }) }),
        h("p", { class: "fx-dmsg fx-dlabel", text: t("about.icons", "Ícones: Lucide (licença ISC).") }));
        d.button(t("about.diag", "Diagnóstico da Faixa"), () => d.close("diagnostics"), { left: true });
        d.initialFocus = d.button(t("dialog.ok", "OK"), () => d.close(null), { primary: true });
      },
    });
    return dlg.open();
  },

  /** Contatar o Suporte: o contato que a organização definiu por política. Devolve
   * "mail", "portal" ou null. */
  support(ui, { suporte }) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const s = suporte || {};
    const dlg = new FaixaDialog(ui, {
      title: t("support.title", "Contatar o Suporte"),
      cls: "fx-dsmall fx-dsupport",
      build(d) {
        const h = ui.h.bind(ui);
        if (s.nome) {
          d.body.append(h("div", { class: "fx-dname", text: s.nome }));
        }
        d.body.append(h("p", { class: "fx-dmsg", text: t("support.lead", "Para pedir ajuda com a faixa ou com o e-mail:") }));
        const rows = h("dl", { class: "fx-dkv" });
        const add = (label, value) => {
          if (value) {
            rows.append(h("dt", { text: label }), h("dd", { text: value }));
          }
        };
        add(t("support.email", "E-mail"), s.email);
        add(t("support.phone", "Telefone"), s.telefone);
        add(t("support.portal", "Portal"), /^https?:\/\//i.test(String(s.portal || "")) ? s.portal : "");
        d.body.append(rows);
        let first = null;
        if (s.email) {
          first = d.button(t("support.write", "Escrever para o Suporte"), () => d.close("mail"), { primary: true });
        }
        if (/^https?:\/\//i.test(String(s.portal || ""))) {
          const b = d.button(t("support.open", "Abrir o Portal"), () => d.close("portal"), { primary: !s.email });
          first = first || b;
        }
        const close = d.button(t("dialog.close", "Fechar"), () => d.close(null));
        d.initialFocus = first || close;
      },
    });
    return dlg.open();
  },
};
