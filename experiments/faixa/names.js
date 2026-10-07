/* Faixa de Opções — Verificar Nomes e Selecionar Nomes, como no Outlook.
 *
 * Verificar Nomes (Ctrl+K no Para, Cc ou Cco) resolve pelos catálogos de endereços o
 * que foi digitado e ainda não virou pílula, e as pílulas inválidas (em vermelho):
 * um nome só vira destinatário; mais de um abre a escolha; nenhum fica em vermelho.
 * Selecionar Nomes (Catálogo de Endereços) escolhe destinatários para Para, Cc e Cco.
 *
 * O que depende do Thunderbird (linhas, pílulas, busca nos catálogos) vem do host. */

"use strict";

/* global FaixaI18n, FaixaDialogs */

var FaixaNames = class {
  /**
   * @param {object} o
   * @param {object} o.host     FaixaTBHost (ou o simulado)
   * @param {Function} o.ui     () => FaixaUI atual (a faixa é refeita quando o idioma muda)
   */
  constructor(o) {
    this.host = o.host;
    this.getUI = o.ui;
    this.busy = false;
    this.onlyBook = null; // autoteste: pesquisa só no catálogo temporário
  }

  get ui() {
    return this.getUI();
  }

  static norm(s) {
    return String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  }

  static validEmail(e) {
    return /^[^\s@]+@[^\s@]+[^.,:;!?-]$/.test(e || "");
  }

  /** Endereços de um texto. O ponto e vírgula (o separador do Outlook) sempre separa;
   * cada pedaço é lido como o Thunderbird lê o campo, em que "Silva, Maria <maria@x>" é
   * um endereço só e as outras vírgulas separam. */
  parseField(text) {
    const parts = [];
    let cur = "";
    let quote = false;
    for (const ch of String(text || "")) {
      if (ch == '"') {
        quote = !quote;
      }
      if (ch == ";" && !quote) {
        parts.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    parts.push(cur);
    return parts.filter(p => p.trim()).flatMap(p => this.host.parseAddresses(p));
  }

  /** Quem casa com o texto, do mais provável para o menos: igual ao nome ou ao e-mail;
   * palavras que começam como o texto; o resto. Um e-mail aparece uma vez só (vale o de
   * um catálogo de verdade, não o dos Endereços coletados). */
  rank(text, found) {
    const q = FaixaNames.norm(text);
    const words = q.split(/[\s,]+/).filter(Boolean);
    const byKey = new Map();
    for (const f of found) {
      const key = f.isList ? "list:" + FaixaNames.norm(f.name) : FaixaNames.norm(f.email);
      const prev = byKey.get(key);
      if (!prev || (prev.collected && !f.collected) || (!prev.name && f.name)) {
        byKey.set(key, f);
      }
    }
    let list = [...byKey.values()];
    const exact = list.filter(f => FaixaNames.norm(f.name) == q || FaixaNames.norm(f.email) == q);
    if (exact.length) {
      list = exact;
    } else {
      const prefix = list.filter(f => {
        const parts = [...FaixaNames.norm(f.name).split(/[\s.,'"()-]+/), ...FaixaNames.norm(f.email).split(/[@._+-]+/)].filter(Boolean);
        return words.every(w => parts.some(p => p.startsWith(w)));
      });
      if (prefix.length) {
        list = prefix;
      }
    }
    if (list.some(f => !f.collected)) {
      list = list.filter(f => !f.collected);
    }
    const locale = FaixaI18n.locale;
    return list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, locale));
  }

  /** Um trecho digitado: { status: "ok", address } | { status: "ambiguous", matches } | { status: "none" }. */
  async resolve(text) {
    const [a] = this.host.parseAddresses(text);
    if (a && FaixaNames.validEmail(a.email)) {
      return { status: "ok", address: a.text };
    }
    const query = (a && (a.name || a.email)) || text;
    const found = this.rank(query, await this.host.searchContacts(query, { bookId: this.onlyBook }));
    if (found.length == 1) {
      return { status: "ok", address: found[0].address, match: found[0] };
    }
    if (found.length > 1) {
      return { status: "ambiguous", matches: found };
    }
    return { status: "none" };
  }

  /** Mais de um nome possível: a janela de escolha. Devolve o endereço, "more" ou null. */
  async choose(text, matches) {
    const r = await FaixaDialogs.choose(this.ui, { text, items: matches });
    if (!r) {
      return null;
    }
    if (r.more) {
      return "more";
    }
    return r.item.address;
  }

  /** Verificar Nomes em todas as linhas de destinatário. Devolve o resumo mostrado.
   * Enquanto roda (busy), a faixa segura o envio: o texto digitado saiu das caixas. */
  async check() {
    if (this.busy) {
      return null;
    }
    this.busy = true;
    const t = FaixaI18n.t.bind(FaixaI18n);
    const report = { resolved: 0, unresolved: [], pending: 0 };
    const rows = this.host.recipientRows();
    // Antes de qualquer espera ou janela: o que foi digitado sai das caixas. Senão, quando
    // a janela de escolha tira o foco do Para, o autocompletar do Thunderbird põe a
    // sugestão dele (ou o texto) como destinatário, além do que o usuário escolher.
    const typed = new Map(rows.map(row => [row, this.host.takeTyped(row.input)]));
    const done = new Set();
    let slow = 0;
    try {
      // As pesquisas saem todas juntas (catálogos LDAP respondem em até 5 s cada).
      const pending = new Map();
      const lookup = text => {
        if (!pending.has(text)) {
          pending.set(text, this.resolve(text));
        }
        return pending.get(text);
      };
      for (const row of rows) {
        for (const pill of row.pills.filter(p => p.invalid && !p.isList)) {
          lookup(pill.name || pill.email || pill.text);
        }
        for (const tok of this.parseField(typed.get(row))) {
          lookup(tok.text);
        }
      }
      slow = this.ui.win.setTimeout(() => this.ui.flash(t("names.checking", "Verificando os nomes nos catálogos de endereços…"), 8000), 400);
      Promise.allSettled([...pending.values()]).then(() => this.ui.win.clearTimeout(slow));
      for (const row of rows) {
        // Pílulas inválidas (em vermelho): o texto delas vai para os catálogos.
        for (const pill of row.pills.filter(p => p.invalid && !p.isList)) {
          const text = pill.name || pill.email || pill.text;
          const r = await lookup(text);
          let address = r.status == "ok" ? r.address : null;
          if (r.status == "ambiguous") {
            const pick = await this.choose(text, r.matches);
            if (pick == "more") {
              // Escolheu no Catálogo de Endereços: a pílula em vermelho sai.
              if (await this.selectNames({ text, target: row.type })) {
                this.host.removePill(pill.el);
                report.resolved++;
              }
            } else {
              address = pick;
            }
          }
          if (address) {
            this.host.replacePill(pill.el, address);
            report.resolved++;
          } else if (r.status == "none") {
            report.unresolved.push(text);
          }
        }
        // Texto digitado que ainda não virou pílula.
        const text = typed.get(row);
        if (!text) {
          done.add(row);
          continue;
        }
        const addresses = [];
        const keep = [];
        for (const tok of this.parseField(text).map(a => a.text)) {
          const r = await lookup(tok);
          if (r.status == "ok") {
            addresses.push(r.address);
            report.resolved++;
          } else if (r.status == "ambiguous") {
            const pick = await this.choose(tok, r.matches);
            if (pick == "more") {
              const added = await this.selectNames({ text: tok, target: row.type });
              if (!added) {
                keep.push(tok);
              }
            } else if (pick) {
              addresses.push(pick);
              report.resolved++;
            } else {
              keep.push(tok); // cancelou: fica na caixa para o usuário corrigir
            }
          } else {
            // Sem resultado: vira pílula em vermelho, como o Thunderbird mostra endereço inválido.
            addresses.push(tok);
            report.unresolved.push(tok);
          }
        }
        // Quem já está na linha não entra de novo.
        const present = new Set(this.host.recipientRows().find(r => r.type == row.type).pills.map(p => FaixaNames.norm(p.email || p.text)));
        const fresh = addresses.filter(a => {
          const [p] = this.parseField(a);
          const key = FaixaNames.norm(p ? p.email || p.text : a);
          if (present.has(key)) {
            return false;
          }
          present.add(key);
          return true;
        });
        this.host.addRecipients(row.type, fresh);
        // O que ficou (cancelado na escolha) volta para a caixa, antes do que tenha sido digitado nesse meio-tempo.
        this.host.setPendingText(row.input, [...keep, row.input.value.trim()].filter(Boolean).join("; "));
        report.pending += keep.length;
        done.add(row);
      }
    } finally {
      this.ui.win.clearTimeout(slow);
      // Erro no meio: o texto das linhas que não terminaram volta para a caixa.
      for (const row of rows) {
        if (!done.has(row) && typed.get(row) && row.input) {
          this.host.setPendingText(row.input, [typed.get(row), row.input.value.trim()].filter(Boolean).join("; "));
        }
      }
      this.busy = false;
    }
    const ui = this.ui;
    if (report.unresolved.length) {
      const names = report.unresolved.map(n => `“${n}”`).join(", ");
      ui.flash(report.unresolved.length == 1
        ? t("names.notFoundOne", "{names} não está nos catálogos de endereços e ficou em vermelho.", { names })
        : t("names.notFoundMany", "Não estão nos catálogos de endereços e ficaram em vermelho: {names}.", { names }), 6000);
    } else if (report.resolved) {
      ui.flash(report.resolved == 1 ? t("names.resolvedOne", "1 nome verificado.") : t("names.resolvedMany", "{n} nomes verificados.", { n: report.resolved }));
    } else if (!report.pending) {
      ui.flash(t("names.nothing", "Não há nomes para verificar."));
    }
    return report;
  }

  /** Selecionar Nomes. text: pesquisa inicial. Devolve true se algum destinatário entrou. */
  async selectNames({ text = "", target = "addr_to" } = {}) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const host = this.host;
    const rows = host.recipientRows();
    const label = type => {
      const row = rows.find(r => r.type == type);
      return (row && row.label.replace(/:\s*$/, "")) || type;
    };
    const targets = ["addr_to", "addr_cc", "addr_bcc"].map(type => ({ type, label: label(type) }));
    const books = host.listBooks().sort((a, b) => a.collected - b.collected);
    const r = await FaixaDialogs.selectNames(this.ui, {
      books,
      targets,
      // Enter e duplo clique na lista mandam para o campo onde o usuário estava.
      first: targets.some(x => x.type == target) ? target : "addr_to",
      text,
      parse: s => this.parseField(s),
      search: async (q, bookId) => {
        const found = await host.searchContacts(q, { bookId: bookId || this.onlyBook, quick: true, limit: 2000 });
        const locale = FaixaI18n.locale;
        return found.sort((a, b) => a.collected - b.collected || (a.name || a.email).localeCompare(b.name || b.email, locale));
      },
    });
    if (!r) {
      return false;
    }
    let added = 0;
    for (const type of ["addr_to", "addr_cc", "addr_bcc"]) {
      const row = host.recipientRows().find(x => x.type == type);
      const present = new Set((row ? row.pills : []).map(p => FaixaNames.norm(p.email || p.text)));
      const list = this.parseField(r[type] || "").filter(a => {
        const key = FaixaNames.norm(a.email || a.text);
        if (present.has(key)) {
          return false;
        }
        present.add(key);
        return true;
      });
      if (list.length) {
        host.addRecipients(type, list.map(a => a.text));
        added += list.length;
      }
    }
    if (added) {
      this.ui.flash(added == 1 ? t("names.addedOne", "1 destinatário incluído.") : t("names.addedMany", "{n} destinatários incluídos.", { n: added }));
    }
    return added > 0;
  }
};
