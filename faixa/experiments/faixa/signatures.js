/* Faixa de Opções — assinaturas como no Outlook.
 *
 * Várias assinaturas; para cada conta (identidade), uma padrão para mensagens novas e
 * outra para respostas e encaminhamentos. A organização pode definir assinaturas e
 * padrões por política (storage.managed), que valem acima dos do usuário.
 *
 * Na mensagem, a assinatura é um <div class="moz-signature">, como a do Thunderbird:
 * ao trocar a conta no De:, o Thunderbird tira a assinatura que estiver lá (a dele ou
 * a da faixa) e põe a da conta nova; a faixa então põe a padrão da conta nova no lugar.
 * Conta sem padrão definido na faixa fica como o Thunderbird deixar.
 *
 * Os campos {nome}, {email}, {cargo}... vêm da identidade e do cartão de visita (vCard)
 * dela. Linha cujos campos ficaram todos vazios sai inteira: "Cel.: {celular}" sem
 * celular não deixa "Cel.:" sozinho.
 *
 * As funções estáticas também servem à página Assinaturas (options/assinaturas.js). */

"use strict";

/* global FaixaSanitizer */

var FaixaSignatures = class {
  /** Campos. names: como cada um se escreve em cada idioma da faixa (o id é o do pt-BR);
   * o nome em qualquer idioma vale em todos (aliases, sem acento e em minúsculas). */
  static FIELDS = [
    { id: "nome", names: { en: "name", es: "nombre", it: "nome", de: "name", fr: "nom" }, aliases: ["nome", "name", "fullname", "nombre", "nom"] },
    { id: "email", names: { en: "email", es: "email", it: "email", de: "email", fr: "email" }, aliases: ["email", "e-mail", "mail", "correo", "courriel"] },
    { id: "cargo", names: { en: "title", es: "cargo", it: "ruolo", de: "position", fr: "fonction" },
      aliases: ["cargo", "title", "jobtitle", "job-title", "puesto", "ruolo", "qualifica", "position", "funktion", "fonction", "poste"] },
    { id: "departamento", names: { en: "department", es: "departamento", it: "reparto", de: "abteilung", fr: "service" },
      aliases: ["departamento", "setor", "department", "reparto", "dipartimento", "abteilung", "service", "departement"] },
    { id: "organizacao", names: { en: "company", es: "empresa", it: "azienda", de: "firma", fr: "société" },
      aliases: ["organizacao", "empresa", "organization", "company", "organizacion", "azienda", "societa", "firma", "unternehmen", "societe", "entreprise", "organisation"] },
    { id: "telefone", names: { en: "phone", es: "teléfono", it: "telefono", de: "telefon", fr: "téléphone" },
      aliases: ["telefone", "fone", "phone", "tel", "telefono", "telefon", "telephone"] },
    { id: "celular", names: { en: "mobile", es: "móvil", it: "cellulare", de: "mobil", fr: "portable" },
      aliases: ["celular", "mobile", "cell", "movil", "cellulare", "mobil", "handy", "portable"] },
    { id: "site", names: { en: "website", es: "web", it: "sito", de: "website", fr: "site" },
      aliases: ["site", "website", "url", "web", "sitio", "sito", "webseite"] },
  ];

  static TOKEN = /\{\s*([\p{L}-]{2,24})\s*\}/gu;

  static BLOCKS = new Set([
    "address", "blockquote", "caption", "center", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5", "h6",
    "li", "ol", "p", "pre", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
  ]);

  static norm(s) {
    return String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  }

  /** Nome escrito entre chaves → id do campo ({Organização} → organizacao), ou null. */
  static fieldOf(name) {
    const n = FaixaSignatures.norm(name);
    const f = FaixaSignatures.FIELDS.find(x => x.aliases.includes(n));
    return f ? f.id : null;
  }

  /** O campo como se escreve no idioma da página (pt-BR: {nome}; en-US: {name}; es: {nombre}...). */
  static token(id, locale) {
    const f = FaixaSignatures.FIELDS.find(x => x.id == id);
    const lang = String(locale || "").toLowerCase().split(/[-_]/)[0];
    return "{" + ((f && f.names[lang]) || id) + "}";
  }

  /* ---------- configuração ---------- */

  /** Assinaturas válidas da configuração: as da organização primeiro. */
  static list(config) {
    return ((config && config.assinaturas) || []).filter(s => s && typeof s.id == "string" && s.id && typeof s.html == "string");
  }

  static byId(config, id) {
    return FaixaSignatures.list(config).find(s => s.id == id) || null;
  }

  /** Padrão de uma conta. which: "nova" ou "resposta". A política vence o usuário campo
   * a campo; em cada um vale o e-mail exato, depois o domínio ("@empresa.com.br"),
   * depois "*" (todas as contas).
   * id: undefined = a faixa não mexe (fica a do Thunderbird); null = nenhuma; texto = a assinatura. */
  static defaultFor(config, email, which) {
    const e = FaixaSignatures.norm(email);
    const at = e.lastIndexOf("@");
    const keys = [e, at > 0 ? e.slice(at) : "", "*"].filter(Boolean);
    const layers = [[config && config.assinaturaPadraoOrg, true], [config && config.assinaturaPadrao, false]];
    for (const [layer, managed] of layers) {
      if (!layer || typeof layer != "object") {
        continue;
      }
      const byKey = new Map(Object.entries(layer).map(([k, v]) => [FaixaSignatures.norm(k), v]));
      for (const key of keys) {
        const entry = byKey.get(key);
        if (entry && typeof entry == "object" && Object.prototype.hasOwnProperty.call(entry, which)) {
          const v = entry[which];
          return { id: v == null || v === "" ? null : String(v), managed, key };
        }
      }
    }
    return { id: undefined, managed: false, key: null };
  }

  /* ---------- campos ---------- */

  /** vCard (3.0 ou 4.0, como o Thunderbird guarda o da identidade) → campos usados. */
  static parseVCard(text) {
    const out = {};
    if (!text) {
      return out;
    }
    const unesc = s => String(s).replace(/\\n/gi, " ").replace(/\\([,;:\\])/g, "$1").trim();
    const lines = String(text).replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, "").split(/\r\n|\n|\r/);
    let workTel = "";
    let anyTel = "";
    for (const line of lines) {
      const i = line.indexOf(":");
      if (i <= 0) {
        continue;
      }
      const head = line.slice(0, i).split(";");
      const name = head[0].replace(/^[^.]*\./, "").toUpperCase();
      const params = head.slice(1).join(";").toLowerCase();
      const value = line.slice(i + 1);
      switch (name) {
        case "FN":
          out.fn = out.fn || unesc(value);
          break;
        case "EMAIL":
          out.email = out.email || unesc(value);
          break;
        case "TITLE":
          out.title = out.title || unesc(value);
          break;
        case "ORG": {
          const parts = value.split(/(?<!\\);/).map(unesc);
          out.org = out.org || parts[0] || "";
          out.dept = out.dept || parts.slice(1).filter(Boolean).join(", ");
          break;
        }
        case "TEL": {
          const v = unesc(value).replace(/^tel:/i, "");
          if (!v) {
            break;
          }
          if (/\b(cell|mobile)\b/.test(params)) {
            out.cell = out.cell || v;
          } else if (/\bwork\b/.test(params)) {
            workTel = workTel || v;
          } else if (!/\b(fax|pager)\b/.test(params)) {
            anyTel = anyTel || v;
          }
          break;
        }
        case "URL":
          out.url = out.url || unesc(value);
          break;
      }
    }
    out.tel = workTel || anyTel;
    return out;
  }

  /** Valores dos campos para uma identidade { email, name, organization, vcard }. */
  static vars(identity) {
    const id = identity || {};
    const v = FaixaSignatures.parseVCard(id.vcard);
    const one = s => String(s || "").replace(/\s+/g, " ").trim();
    return {
      nome: one(id.name || v.fn),
      email: one(id.email || v.email),
      cargo: one(v.title),
      departamento: one(v.dept),
      organizacao: one(id.organization || v.org),
      telefone: one(v.tel),
      celular: one(v.cell),
      site: one(v.url),
    };
  }

  /** Preenche os campos (no texto e nos atributos) de uma árvore já limpa. */
  static fill(root, vars) {
    const TOKEN = FaixaSignatures.TOKEN;
    const valueOf = name => {
      const id = FaixaSignatures.fieldOf(name);
      return id == null ? null : vars[id] || "";
    };
    // Atributos: link (mailto:{email}), título e texto alternativo.
    for (const el of root.querySelectorAll("[href], [title], [alt]")) {
      for (const attr of ["href", "title", "alt"]) {
        const v = el.getAttribute(attr);
        if (!v || !v.includes("{")) {
          continue;
        }
        const out = v.replace(TOKEN, (m, name) => {
          const value = valueOf(name);
          if (value == null) {
            return m;
          }
          return attr == "href" && /^tel:/i.test(v) ? value.replace(/[^\d+]/g, "") : value;
        });
        if (attr == "href" && (!/^(https?:|mailto:|tel:)/i.test(out.trim()) || /^(mailto:|tel:)\s*$/i.test(out.trim()))) {
          el.removeAttribute("href"); // mailto: vazio ou endereço que deixou de valer
        } else {
          el.setAttribute(attr, out);
        }
      }
    }
    // Texto, em linhas: cada bloco, cortado nos <br>.
    const doc = root.ownerDocument;
    const blockOf = n => {
      let e = n.parentNode;
      while (e && e != root && !(e.nodeType == 1 && FaixaSignatures.BLOCKS.has(e.localName))) {
        e = e.parentNode;
      }
      return e || root;
    };
    const lines = [];
    let cur = null;
    const walker = doc.createTreeWalker(root, 1 | 4);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType == 1) {
        if (n.localName == "br") {
          if (cur && cur.block == blockOf(n)) {
            cur.br = n;
          }
          cur = null;
        } else if (n.localName == "img") {
          const b = blockOf(n);
          if (!cur || cur.block != b) {
            cur = { block: b, texts: [], br: null, img: false };
            lines.push(cur);
          }
          cur.img = true;
        }
        continue;
      }
      const b = blockOf(n);
      if (!cur || cur.block != b) {
        cur = { block: b, texts: [], br: null, img: false };
        lines.push(cur);
      }
      cur.texts.push(n);
    }
    const empty = el => !el.textContent.trim() && !el.querySelector("img, hr");
    for (const line of lines) {
      let tokens = 0;
      let filled = 0;
      for (const t of line.texts) {
        t.data.replace(TOKEN, (m, name) => {
          const value = valueOf(name);
          if (value != null) {
            tokens++;
            if (value) {
              filled++;
            }
          }
          return m;
        });
      }
      if (tokens && !filled && !line.img) {
        // Linha só de campos vazios: sai, com o <br> dela (ou o de antes, se for a última do bloco).
        for (const t of line.texts) {
          let p = t.parentNode;
          t.remove();
          while (p && p != line.block && p != root && p.nodeType == 1 && empty(p) && !p.querySelector("br")) {
            const up = p.parentNode;
            p.remove();
            p = up;
          }
        }
        if (line.br) {
          line.br.remove();
        } else {
          const prev = lines[lines.indexOf(line) - 1];
          if (prev && prev.block == line.block && prev.br && root.contains(prev.br)) {
            prev.br.remove();
          }
        }
        // Bloco que ficou vazio sai também (numa tabela, a linha inteira se todas as células ficaram vazias).
        // (A árvore pode estar fora do documento: vale estar dentro da raiz.)
        let b = line.block;
        while (b && b != root && root.contains(b) && empty(b) && !b.querySelector("br")) {
          if (b.localName == "td" || b.localName == "th") {
            const tr = b.parentNode;
            if (tr && tr.localName == "tr" && [...tr.children].every(empty)) {
              b = tr;
              continue;
            }
            break;
          }
          const up = b.parentNode;
          b.remove();
          b = up;
        }
        continue;
      }
      for (const t of line.texts) {
        if (t.data.includes("{")) {
          t.data = FaixaSignatures.fillText(t.data, valueOf);
        }
      }
    }
    return root;
  }

  /** Troca os campos de um texto. Campo vazio leva junto o separador ao lado:
   * "{cargo} · {departamento}" sem departamento fica só "Gerente". */
  static fillText(text, valueOf) {
    const MARK = "\u0001";
    let out = text.replace(FaixaSignatures.TOKEN, (m, name) => {
      const value = valueOf(name);
      return value == null ? m : value || MARK;
    });
    if (!out.includes(MARK)) {
      return out;
    }
    const sep = "[ \\t\\u00a0]*[·|•–—/,;-][ \\t\\u00a0]*";
    out = out.replace(new RegExp(sep + MARK, "g"), "").replace(new RegExp(MARK + sep, "g"), "");
    return out.split(MARK).join("").replace(/ {2,}/g, " ");
  }

  /** A assinatura pronta para a mensagem: <div class="moz-signature"> no documento doc. */
  static render(doc, sig, identity) {
    const box = doc.createElement("div");
    box.className = "moz-signature";
    box.append(FaixaSanitizer.clean(sig.html, doc));
    FaixaSignatures.fill(box, FaixaSignatures.vars(identity));
    return box;
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
    this.where = null; // onde a assinatura da faixa ficou: "beforeQuote" ou "end"
    this.applied = false;
    this.mine = new WeakSet(); // as que a faixa pôs (o resto é do Thunderbird ou veio no rascunho)
  }

  get config() {
    return this.getConfig() || {};
  }

  /** Para o menu Assinatura: [{ id, nome, gerenciada }]. */
  menuList() {
    return FaixaSignatures.list(this.config).map(s => ({ id: s.id, nome: s.nome || s.id, gerenciada: !!s.gerenciada }));
  }

  /** A assinatura que está no corpo: o último elemento do primeiro nível com a classe
   * moz-signature (o mesmo que o Thunderbird procura ao trocar a conta). */
  current() {
    const body = this.host.editorDoc && this.host.editorDoc.body;
    for (let n = body ? body.lastElementChild : null; n; n = n.previousElementSibling) {
      if (/moz-signature/i.test(n.getAttribute("class") || "")) {
        return n;
      }
    }
    return null;
  }

  /** Assinatura padrão da conta atual, para esta mensagem: { sig, id, managed } ou null (a faixa não mexe). */
  resolveDefault(reply) {
    const identity = this.host.currentIdentity();
    if (!identity) {
      return null;
    }
    const d = FaixaSignatures.defaultFor(this.config, identity.email, reply ? "resposta" : "nova");
    if (d.id === undefined) {
      return null;
    }
    const sig = d.id ? FaixaSignatures.byId(this.config, d.id) : null;
    if (d.id && !sig) {
      return null; // assinatura apagada: fica como o Thunderbird deixou
    }
    return { sig, identity, id: d.id, managed: d.managed };
  }

  /** A assinatura pronta, marcada como da faixa. Com imagem de fora, o conteúdo remoto é
   * liberado antes de criar a imagem (a de cache carrega na hora). */
  make(sig, identity) {
    if (FaixaSanitizer.remoteImagesIn(sig.html, this.host.editorDoc)) {
      this.host.allowRemoteContent();
    }
    const box = FaixaSignatures.render(this.host.editorDoc, sig, identity);
    this.mine.add(box);
    return box;
  }

  /** Tira uma assinatura. withBr: também o <br> logo antes dela, que o Thunderbird põe
   * junto com a dele no modo sem parágrafos (na mensagem recém-aberta ele é a linha
   * onde se digita, e fica). */
  remove(el, withBr) {
    const ed = this.host.editor;
    const prev = el.previousSibling;
    ed.deleteNode(el, true);
    if (withBr && prev && prev.nodeType == 1 && prev.localName == "br") {
      ed.deleteNode(prev, true);
    }
  }

  /** Editor pronto: a assinatura padrão entra (no lugar da do Thunderbird, se houver).
   * Rascunhos, modelos e "editar como nova" ficam como vieram. Não entra no desfazer
   * nem marca a mensagem como modificada. Devolve o que fez (para o autoteste). */
  applyDefault() {
    const host = this.host;
    this.applied = true;
    if (!host.isHTML()) {
      return { done: false, reason: "plain" };
    }
    const ctx = host.signatureContext();
    if (ctx.kind == "other") {
      return { done: false, reason: "kind" };
    }
    const d = this.resolveDefault(ctx.reply);
    if (!d) {
      return { done: false, reason: "none" };
    }
    const ed = host.editor;
    ed.enableUndo(false);
    try {
      this.place(d.sig, d.identity, true);
    } finally {
      ed.enableUndo(true);
      ed.resetModificationCount();
    }
    return { done: true, id: d.id };
  }

  /** Troca de conta no De: o Thunderbird já tirou a assinatura anterior e pôs a dele
   * (se a conta nova tiver); aqui entra a padrão da conta nova, num passo só do desfazer
   * (o Thunderbird também deixa a troca dele no desfazer). */
  onIdentityChanged() {
    const host = this.host;
    if (!this.applied || !host.isHTML()) {
      return;
    }
    const d = this.resolveDefault(host.signatureContext().reply);
    if (!d) {
      return;
    }
    const ed = host.editor;
    ed.beginTransaction();
    try {
      this.place(d.sig, d.identity, false);
    } finally {
      ed.endTransaction();
    }
  }

  /** Põe a assinatura (ou tira a que houver, com sig null). initial: mensagem recém-aberta.
   * A da faixa que já está no corpo é trocada no mesmo lugar. A do Thunderbird sai, e a da
   * faixa vai para o lugar dela: logo abaixo do texto de quem escreve (acima da citação
   * ou da mensagem encaminhada, com o cursor em cima delas), como no Outlook. O Thunderbird
   * põe a dele no fim, abaixo da citação, a menos que a conta diga o contrário. */
  place(sig, identity, initial) {
    const ed = this.host.editor;
    const body = this.host.editorDoc.body;
    const old = this.current();
    if (!sig) {
      if (old) {
        this.remove(old, !initial);
      }
      return null;
    }
    const box = this.make(sig, identity);
    if (old && this.mine.has(old)) {
      ed.insertNode(box, body, [...body.childNodes].indexOf(old), true);
      ed.deleteNode(old, true);
    } else {
      this.putInPlace(box, old);
    }
    this.where = this.quoteAfter(box) ? "beforeQuote" : "end";
    if (initial) {
      this.addSpacer(box);
    }
    return box;
  }

  /** A da faixa no lugar dela, tirando a do Thunderbird (old) se houver. O <br> que o
   * Thunderbird põe antes da dele (modo sem parágrafos) só sai quando a assinatura sobe
   * de baixo da citação para cima dela; no mesmo lugar, ele é a linha onde se digita. */
  putInPlace(box, old) {
    const ed = this.host.editor;
    const body = this.host.editorDoc.body;
    const quote = this.firstQuote();
    const before = !!quote && (this.where ? this.where == "beforeQuote" : this.startsAbove(quote));
    if (old) {
      this.remove(old, before && !this.quoteAfter(old));
    }
    ed.insertNode(box, body, before ? [...body.childNodes].indexOf(quote) : body.childNodes.length, true);
  }

  /** Citação (resposta) ou mensagem encaminhada no primeiro nível do corpo. */
  firstQuote() {
    const body = this.host.editorDoc.body;
    return [...body.children].find(n => n.matches('.moz-cite-prefix, blockquote[type="cite"], .moz-forward-container')) || null;
  }

  quoteAfter(el) {
    for (let n = el.nextElementSibling; n; n = n.nextElementSibling) {
      if (n.matches('.moz-cite-prefix, blockquote[type="cite"], .moz-forward-container')) {
        return true;
      }
    }
    return false;
  }

  /** Quem escreve começa acima da citação? Encaminhar: sim (a mensagem encaminhada vai
   * embaixo). Resposta: como a conta manda responder (Configurações da conta → Redação e
   * endereçamento); sem essa informação, pelo cursor. */
  startsAbove(quote) {
    if (this.host.signatureContext().kind == "forward") {
      return true;
    }
    const top = this.host.replyOnTop();
    return top == null ? this.caretBefore(quote) : top;
  }

  /** O cursor está acima do elemento? (resposta por cima: a assinatura vai logo abaixo do texto) */
  caretBefore(el) {
    const sel = this.host.editorDoc.getSelection();
    if (!sel || !sel.rangeCount) {
      return false;
    }
    try {
      return sel.getRangeAt(0).comparePoint(el, 0) > 0;
    } catch (e) {
      return false;
    }
  }

  /** Como no Outlook: uma linha em branco entre o texto e a assinatura, na mensagem
   * recém-aberta (com o Enter do Outlook; no modo do Thunderbird a margem do parágrafo já separa). */
  addSpacer(box) {
    if (this.config.paragrafoSemEspaco === false) {
      return;
    }
    const prev = box.previousElementSibling;
    const direct = box.previousSibling == prev;
    if (!prev || !direct || prev.localName != "p") {
      return;
    }
    // O parágrafo de antes é onde se digita (tem o cursor, ou ainda não há cursor e é o
    // primeiro do corpo) ou tem texto: a linha vazia entra. Parágrafo vazio sem o cursor já é a linha vazia.
    const sel = this.host.editorDoc.getSelection();
    const noCaret = !sel || !sel.rangeCount;
    const typing = noCaret ? prev == this.host.editorDoc.body.firstElementChild : prev.contains(sel.getRangeAt(0).startContainer);
    if (!typing && !prev.textContent.trim()) {
      return;
    }
    const ed = this.host.editor;
    const p = ed.createElementWithDefaults("p");
    p.appendChild(ed.createElementWithDefaults("br"));
    const body = this.host.editorDoc.body;
    ed.insertNode(p, body, [...body.childNodes].indexOf(box), true);
  }

  /** Menu Assinatura: insere a escolhida. Com uma assinatura no corpo, fica no lugar
   * dela (como no Outlook); sem, entra logo depois do parágrafo do cursor. Um Ctrl+Z desfaz. */
  insert(id) {
    const sig = FaixaSignatures.byId(this.config, id);
    const engine = this.getEngine();
    if (!sig || !engine) {
      return false;
    }
    const host = this.host;
    const identity = host.currentIdentity() || {};
    engine.tx(() => {
      const doc = host.editorDoc;
      const body = doc.body;
      const ed = host.editor;
      const old = this.current();
      const box = this.make(sig, identity);
      if (old && this.mine.has(old)) {
        ed.insertNode(box, body, [...body.childNodes].indexOf(old), true);
        ed.deleteNode(old, true);
        return;
      }
      if (old) {
        this.putInPlace(box, old); // a do Thunderbird: a escolhida vai para o lugar da faixa
        this.where = this.quoteAfter(box) ? "beforeQuote" : "end";
        return;
      }
      const sel = doc.getSelection();
      let index = body.childNodes.length;
      if (sel && sel.rangeCount) {
        let node = sel.getRangeAt(0).endContainer;
        if (node == body) {
          index = sel.getRangeAt(0).endOffset;
        } else {
          while (node && node.parentNode != body) {
            node = node.parentNode;
          }
          if (node) {
            index = [...body.childNodes].indexOf(node) + 1;
          }
        }
      }
      ed.insertNode(box, body, index, true);
    });
    return true;
  }
};
