/* Host simulado: mesma interface do FaixaTBHost, sobre um iframe em designMode. */
"use strict";

var SimEditor = class {
  constructor(doc) {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.depth = 0;
    this.pending = null;
    this.css = false;
    this.log = [];
  }
  /** O desfazer do Gecko também guarda os atributos do <body> (tema do Alterar Estilos,
   * fonte do corpo): o instantâneo leva os atributos e o conteúdo. */
  snap() {
    const body = this.doc.body;
    return JSON.stringify([[...body.attributes].map(a => [a.name, a.value]), body.innerHTML]);
  }
  restore(s) {
    const body = this.doc.body;
    const [attrs, html] = JSON.parse(s);
    for (const a of [...body.attributes]) {
      if (!attrs.some(([n]) => n == a.name)) {
        body.removeAttribute(a.name);
      }
    }
    for (const [n, v] of attrs) {
      if (body.getAttribute(n) !== v) {
        body.setAttribute(n, v);
      }
    }
    body.innerHTML = html;
  }
  beginTransaction() {
    if (this.depth++ == 0) this.pending = this.snap();
  }
  endTransaction() {
    if (--this.depth == 0) {
      if (this.undoOn !== false && this.snap() != this.pending) {
        this.undoStack.push(this.pending);
        this.redoStack = [];
      }
      this.pending = null;
    }
  }
  get documentModified() {
    return this.undoStack.length > 0;
  }
  getModificationCount() {
    return this.undoStack.length;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  undo() {
    const s = this.undoStack.pop();
    if (s == null) return;
    this.redoStack.push(this.snap());
    this.restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (s == null) return;
    this.undoStack.push(this.snap());
    this.restore(s);
  }
  setAttribute(el, n, v) {
    this.log.push(["setAttribute", el.localName, n, v]);
    el.setAttribute(n, v);
  }
  removeAttribute(el, n) {
    this.log.push(["removeAttribute", el.localName, n]);
    el.removeAttribute(n);
  }
  insertNode(n, p, i) {
    p.insertBefore(n, p.childNodes[i] || null);
  }
  deleteNode(n) {
    n.remove();
  }
  /** Como o do Gecko (InsertElementAtSelectionAsAction): um bloco (tabela, linha) no
   * meio de um parágrafo divide o parágrafo em volta dele, e os pedaços podem ficar
   * vazios (SplitAtEdges::eAllowToCreateEmptyContainer); no fim da ação o
   * RemoveEmptyNodesIn apaga os pedaços vazios, menos os que guardam um elemento vazio
   * que ele não apaga (<span>, <em>, <strong>). Tabela que fica por último no pai sem
   * divisão (corpo, item de lista, célula) ganha um <br> depois dela. */
  insertElementAtSelection(el, deleteSelection = true) {
    const sel = this.doc.getSelection();
    const r = sel.getRangeAt(0);
    if (deleteSelection) r.deleteContents();
    if (/^(table|hr|p|div|ul|ol|h[1-6]|blockquote|pre)$/.test(el.localName)) {
      let block = r.startContainer.nodeType == 1 ? r.startContainer : r.startContainer.parentNode;
      while (block && block != this.doc.body && !/^(p|div|h[1-6]|pre|address|li|td|th|blockquote)$/.test(block.localName)) block = block.parentNode;
      if (block && block != this.doc.body && /^(p|h[1-6]|pre|address)$/.test(block.localName)) {
        const tail = this.doc.createRange();
        tail.setStart(r.startContainer, r.startOffset);
        tail.setEnd(block, block.childNodes.length);
        const rest = block.cloneNode(false);
        rest.append(tail.extractContents());
        block.after(el);
        el.after(rest);
        // RemoveEmptyNodesIn: só elementos que ele sabe apagar, sem nada dentro.
        const cleans = /^(a|b|i|u|tt|s|strike|big|small|sub|sup|font|ul|ol|dl|div|p|h[1-6]|address|pre|li|blockquote)$/;
        const empty = n => (n.nodeType == 3 ? !n.data : n.nodeType == 1 && cleans.test(n.localName) && [...n.childNodes].every(empty));
        for (const piece of [block, rest]) {
          if (empty(piece)) piece.remove();
        }
        return;
      }
    }
    r.insertNode(el);
    // O Gecko não divide um texto na borda: o pedaço vazio que o insertNode do DOM deixa sai.
    for (const n of [el.previousSibling, el.nextSibling]) {
      if (n && n.nodeType == 3 && !n.data) n.remove();
    }
    if (el.localName == "table" && !el.nextSibling) el.after(this.doc.createElement("br"));
  }
  insertText(s) {
    this.doc.execCommand("insertText", false, s);
  }
  insertHTML(html) {
    this.doc.execCommand("insertHTML", false, html);
  }
  /** setInlineProperty do Gecko (em, strong): envolve a seleção no elemento. */
  setInlineProperty(tag) {
    const sel = this.doc.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const frag = r.extractContents();
    for (const inner of frag.querySelectorAll(tag)) inner.replaceWith(...inner.childNodes);
    const el = this.doc.createElement(tag);
    el.append(frag);
    r.insertNode(el);
    const nr = this.doc.createRange();
    nr.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(nr);
  }
  removeInlineProperty(prop, attr) {
    // Aproximação do Gecko: tira a cor dos elementos da seleção (e dos de fora que só
    // têm o texto selecionado, que o Gecko dividiria).
    const sel = this.doc.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const root = r.commonAncestorContainer.nodeType == 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode;
    const text = r.toString();
    const outer = [];
    for (let a = root.parentElement; a && a != this.doc.body && a.textContent == text; a = a.parentElement) outer.push(a);
    for (const el of [...outer, root, ...root.querySelectorAll("*")]) {
      if (!r.intersectsNode(el)) continue;
      if (attr == "color") {
        el.style && el.style.removeProperty("color");
        el.removeAttribute("color");
      } else {
        el.style && el.style.removeProperty("background-color");
      }
    }
  }
  get isCSSEnabled() {
    return this.css;
  }
  set isCSSEnabled(v) {
    this.css = !!v;
    this.doc.execCommand("styleWithCSS", false, !!v);
  }
  resetModificationCount() {}
  // Como no Gecko: desligar o desfazer limpa o histórico.
  enableUndo(on) {
    if (!on) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.undoOn = !!on;
  }
  createElementWithDefaults(tag) {
    return this.doc.createElement(tag);
  }
};

var FaixaSimHost = class {
  constructor(win) {
    this.chromeWin = win;
    this.chromeDoc = win.document;
    this.sheets = new Map();
    this.styleIds = new Set();
    this.observers = [];
    this.flash = null;
    this.zoom = 1;
    this.nativeLog = [];
    this._editor = null;
    // No simulador o Chromium tem seu próprio desfazer: todo comando vira lote.
    this.singleNeedsTx = true;
  }
  onComposeProcessDone(fn) {
    this.chromeWin.simComposeProcessDone = fn;
    return () => {};
  }
  get editorElement() {
    return this.chromeDoc.getElementById("messageEditor");
  }
  get editorWin() {
    return this.editorElement.contentWindow;
  }
  get editorDoc() {
    return this.editorElement.contentDocument;
  }
  get editor() {
    if (!this._editor) this._editor = new SimEditor(this.editorDoc);
    return this._editor;
  }
  isHTML() {
    return this.chromeWin.simIsHTML !== false;
  }
  isEditorReady() {
    return !!this.chromeWin.composeEditorReady;
  }
  whenEditorReady() {
    if (this.isEditorReady()) return Promise.resolve();
    return new Promise(r => this.chromeWin.addEventListener("compose-editor-ready", () => r(), { once: true }));
  }
  focusEditor() {
    this.editorWin.focus();
  }
  focusedTarget() {
    const a = this.chromeDoc.activeElement;
    return a == this.editorElement ? this.editorDoc : a;
  }
  /* Anexos simulados: cartão de visita, chave OpenPGP e duas contas do Filelink. */
  attachState() {
    const w = this.chromeWin;
    w.simAttach = w.simAttach || { attachVCard: false, attachPublicKey: false };
    return {
      attachVCard: w.simAttach.attachVCard,
      vcardAvailable: w.simVCard !== false,
      attachPublicKey: w.simAttach.attachPublicKey,
      pgp: w.simPgp !== false,
      cloudAccounts: w.simCloud || [{ id: "account1", name: "Box" }, { id: "account2", name: "WeTransfer" }],
    };
  }
  toggleAttachOption(cmd) {
    const st = this.attachState();
    this.chromeWin.simAttach[cmd] = !st[cmd];
    this.nativeLog.push(cmd);
  }
  attachToCloud(id) {
    this.nativeLog.push("cloud:" + id);
  }
  injectChromeStyle(id, css) {
    let el = this.chromeDoc.getElementById(id);
    if (!el) {
      el = this.chromeDoc.createElement("style");
      el.id = id;
      this.chromeDoc.head.append(el);
    }
    el.textContent = css;
    this.styleIds.add(id);
  }
  setMainToolbarHidden(h) {
    this.injectChromeStyle("faixa-hide-main", h ? "#composeToolbar2 { display: none !important; }" : "");
  }
  loadAgentSheet(id, css) {
    if (this.sheets.has(id)) return;
    const el = this.editorDoc.createElement("style");
    el.setAttribute("data-faixa", id);
    el.textContent = css;
    this.editorDoc.head.append(el);
    this.sheets.set(id, el);
  }
  removeAgentSheet(id) {
    const el = this.sheets.get(id);
    if (el) el.remove();
    this.sheets.delete(id);
  }
  mountRibbon(root) {
    this.chromeDoc.getElementById("composeContentBox").before(root);
    return true;
  }
  mountSendButton(b) {
    this.chromeDoc.getElementById("MsgHeadersToolbar").prepend(b);
    return true;
  }
  sendEnabled() {
    return !this.chromeDoc.getElementById("cmd_sendButton").hasAttribute("disabled");
  }
  observeSendEnabled(fn) {
    const mo = new MutationObserver(() => fn(this.sendEnabled()));
    mo.observe(this.chromeDoc.getElementById("cmd_sendButton"), { attributes: true });
  }
  /** Como o CompleteGenericSendMessage do Thunderbird: evento cancelável e, se
   * ninguém cancelar, trava a janela (desativando cmd_sendButton) e lê o corpo na
   * mesma volta. Devolve o HTML "enviado", ou null se o envio foi barrado. */
  send(msgType = 0) {
    this.nativeLog.push("send");
    this.lastSendType = msgType;
    const w = this.chromeWin;
    const ev = new CustomEvent("compose-send-message", { cancelable: true, detail: { msgType } });
    w.dispatchEvent(ev);
    if (ev.defaultPrevented) {
      return null;
    }
    w.gWindowLocked = true;
    this.chromeDoc.getElementById("cmd_sendButton").setAttribute("disabled", "true");
    this.sentHTML = this.editorDoc.body.innerHTML;
    // Fcc: o Thunderbird avisa cada cópia gravada (Enviados; Saída com Enviar Mais Tarde;
    // Rascunhos e Modelos nas gravações).
    const folder = { 0: "mailbox://ana/Sent", 1: "mailbox://ana/Unsent%20Messages", 8: "mailbox://ana/Unsent%20Messages",
      4: "mailbox://ana/Drafts", 7: "mailbox://ana/Drafts", 5: "mailbox://ana/Templates" }[msgType];
    // ?semcopia=1: a conta não guarda cópia dos enviados (Configurações da conta → Cópias e pastas).
    if (folder && !(w.simNoFcc && msgType == 0)) {
      w.simSentCount = (w.simSentCount || 0) + 1;
      for (const l of w.simSendListeners || []) l.onGetDraftFolderURI("<sim" + w.simSentCount + "@exemplo.com.br>", folder);
    }
    return this.sentHTML;
  }
  /** Fim do envio (ComposeProcessDone): o ouvinte do Thunderbird destrava primeiro. */
  finishSend(ok) {
    const w = this.chromeWin;
    w.gWindowLocked = false;
    this.chromeDoc.getElementById("cmd_sendButton").removeAttribute("disabled");
    // GenericSendMessage: "aftersend" quando o envio (agora, mais tarde, em segundo plano) deu certo.
    if (ok && [0, 1, 8].includes(this.lastSendType)) {
      w.dispatchEvent(new CustomEvent("aftersend"));
    }
    if (w.simComposeProcessDone) {
      w.simComposeProcessDone(ok);
    }
  }
  /** Área de Transferência simulada (window.simClipboard = { html, text }). */
  readClipboard() {
    const c = this.chromeWin.simClipboard || {};
    return { html: c.html || "", text: c.text || "" };
  }
  nativeCommand(cmd, focus) {
    this.nativeLog.push(cmd + (focus ? "@" + focus : ""));
    const map = { cmd_paste: "paste", cmd_cut: "cut", cmd_copy: "copy", cmd_selectAll: "selectAll" };
    if (map[cmd]) {
      this.focusEditor();
      this.editorDoc.execCommand(map[cmd]);
    }
    if (cmd == "cmd_pasteNoFormatting" && this.chromeWin.simClipboard) {
      // Como o Colar sem Formatação do Thunderbird: o texto, com a formatação do cursor.
      this.editor.beginTransaction();
      try {
        this.editorDoc.execCommand("insertText", false, this.chromeWin.simClipboard.text || "");
      } finally {
        this.editor.endTransaction();
      }
    }
    if (/^cmd_(InsertRow|InsertColumn|DeleteRow|DeleteColumn|DeleteTable)/.test(cmd)) {
      this.simTableCommand(cmd);
    }
    return true;
  }
  /** Como o isCommandEnabled do Thunderbird para Mesclar e Dividir Células. */
  nativeEnabled(cmd) {
    const sel = this.editorDoc.getSelection();
    const n = sel.rangeCount ? sel.anchorNode : null;
    const el = n && (n.nodeType == 1 ? n : n.parentElement);
    const td = el && el.closest("td, th");
    if (!td) return false;
    if (cmd == "cmd_JoinTableCells") return !!td.nextElementSibling;
    if (cmd == "cmd_SplitTableCell") return td.colSpan > 1 || td.rowSpan > 1;
    return true;
  }
  /** Os comandos de tabela do Thunderbird (GetCurrentTableEditor), o bastante para os testes. */
  simTableCommand(cmd) {
    const doc = this.editorDoc;
    const sel = doc.getSelection();
    if (!sel.rangeCount) return;
    const n = sel.anchorNode;
    const el = n.nodeType == 1 ? n : n.parentElement;
    const td = el && el.closest("td, th");
    if (!td) return;
    const tr = td.parentElement;
    const table = td.closest("table");
    const col = [...tr.children].indexOf(td);
    const blank = c => {
      c.replaceChildren(doc.createElement("br"));
      return c;
    };
    const ed = this.editor;
    ed.beginTransaction();
    try {
      switch (cmd) {
        case "cmd_InsertRowAbove":
        case "cmd_InsertRowBelow": {
          const row = tr.cloneNode(true);
          [...row.children].forEach(blank);
          if (cmd.endsWith("Above")) tr.before(row);
          else tr.after(row);
          break;
        }
        case "cmd_InsertColumnBefore":
        case "cmd_InsertColumnAfter":
          for (const r of [...table.rows]) {
            const ref = r.children[Math.min(col, r.children.length - 1)];
            const c = blank(ref.cloneNode(false));
            if (cmd.endsWith("Before")) ref.before(c);
            else ref.after(c);
          }
          break;
        case "cmd_DeleteRow":
          tr.remove();
          if (!table.rows.length) table.remove();
          break;
        case "cmd_DeleteColumn":
          for (const r of [...table.rows]) {
            if (r.children[col]) r.children[col].remove();
          }
          if (!table.rows.length || !table.rows[0].children.length) table.remove();
          break;
        case "cmd_DeleteTable":
          table.remove();
          break;
      }
    } finally {
      ed.endTransaction();
    }
  }
  toggleContacts() {
    this.nativeLog.push("toggleContacts");
  }
  newMessage() {
    this.nativeLog.push("newMessage");
  }
  getZoom() {
    return this.zoom;
  }
  setZoom(v) {
    this.zoom = v;
    this.editorDoc.documentElement.style.zoom = String(v);
  }
  onSend(fn) {
    const h = e => fn(e.detail.msgType, [0, 1, 8].includes(e.detail.msgType), e);
    this.chromeWin.addEventListener("compose-send-message", h);
    return () => this.chromeWin.removeEventListener("compose-send-message", h);
  }
  markUnmodified() {}
  /* Autocompletar simulado (boot.js): mesma interface do host do Thunderbird, com
   * catálogos em memória (window.simBooks) no lugar do MailServices.ab. */
  highlightedSuggestion(event) {
    const doc = this.chromeDoc;
    const input = [event.target, doc.activeElement].find(el => el && el.matches && el.matches('input[is="autocomplete-input"].address-input'));
    if (!input || !input.popupOpen || !(input.popup.selectedIndex >= 0)) {
      return null;
    }
    const ctrl = input.controller;
    return { input, index: input.popup.selectedIndex, value: ctrl.getValueAt(input.popup.selectedIndex), typed: ctrl.searchString || "" };
  }
  removeSuggestion(s) {
    const m = /<([^>]+)>/.exec(s.value);
    const email = (m ? m[1] : s.value).trim();
    const books = this.chromeWin.simBooks;
    const collected = books.find(b => b.collected);
    const same = e => e.toLowerCase() == email.toLowerCase();
    const out = { email, removed: 0, collectedName: collected ? collected.dirName : "", others: [] };
    if (collected) {
      const before = collected.emails.length;
      collected.emails = collected.emails.filter(e => !same(e));
      out.removed = before - collected.emails.length;
    }
    out.others = books.filter(b => b != collected && b.emails.some(same)).map(b => b.dirName);
    if (out.removed) {
      const ctrl = s.input.controller;
      s.input.value = s.typed;
      ctrl.resetInternalState();
      ctrl.startSearch(s.typed);
      s.input.popup.selectedIndex = Math.min(s.index, ctrl.matchCount - 1);
    }
    return out;
  }
  /* Destinatários simulados: linhas .address-row com pílulas <span class="sim-pill"> (compose.html). */
  static validEmail(e) {
    return /^[^\s@]+@[^\s@]+[^.,:;!?-]$/.test(e || "");
  }
  recipientRows() {
    return [...this.chromeDoc.querySelectorAll(".address-row[data-recipienttype]")].map(row => ({
      el: row,
      type: row.dataset.recipienttype,
      label: row.querySelector("label").textContent,
      visible: !row.classList.contains("hidden"),
      input: row.querySelector(".address-row-input"),
      pills: [...row.querySelectorAll(".sim-pill")].map(p => ({
        el: p, text: p.dataset.address, email: p.dataset.email || "", name: p.dataset.name || "",
        invalid: p.classList.contains("invalid-address"), isList: p.dataset.list == "1",
      })),
    }));
  }
  isRecipientInput(el) {
    return !!el && el.localName == "input" && !!el.closest && !!el.closest(".address-row[data-recipienttype]");
  }
  /** Como o makeFromDisplayAddress do Thunderbird (MimeJSComponents.sys.mjs): ponto e
   * vírgula vira vírgula; corta na vírgula que vem depois do <...> ou do @, de modo que
   * "Silva, Maria <maria@x>" é um endereço só. */
  parseAddresses(text) {
    let display = String(text || "");
    if (display.includes(";") && !/:.*;/.test(display)) {
      display = display.replace(/;(?=(?:(?:[^"]*"){2})*[^"]*$)/g, ",");
    }
    const out = [];
    while (display.length > 0) {
      const lt = display.indexOf("<");
      const gt = display.indexOf(">");
      const at = display.indexOf("@");
      let start = 0;
      if (lt != -1 && gt > lt) start = gt;
      if (at != -1) start = Math.min(start, at);
      let comma = display.indexOf(",", start);
      let addr;
      if (comma > 0) {
        addr = display.substr(0, comma);
        display = display.substr(comma + 1);
        comma = 0;
        while (/[,\s]/.test(display.charAt(comma))) comma++;
        display = display.substr(comma);
      } else {
        addr = display;
        display = "";
      }
      addr = addr.trim().replace(/^"(.*)"$/, "$1");
      if (!addr) continue;
      let name = "";
      let email = addr;
      if (/<.*>/.test(addr)) {
        const cleaned = addr.replace(/".*[<>]+.*"/g, "");
        const m = /(<([^><]*)>[^<]*)+/.exec(cleaned);
        const inner = m ? m[m.length - 1] : "";
        const idx = addr.lastIndexOf("<" + inner + ">");
        name = addr.slice(0, idx).trim();
        email = inner.trim();
      }
      out.push({ name, email, text: this.makeAddress(name, email) });
    }
    return out;
  }
  /** Como o toString() do endereço no Thunderbird: o nome vai sem aspas. */
  makeAddress(name, email) {
    return name ? name + " <" + email + ">" : email;
  }
  takeTyped(input) {
    if (!input) return "";
    let text = input.value || "";
    if (input.selectionStart > 0 && input.selectionStart < input.selectionEnd && input.selectionEnd == text.length) text = text.slice(0, input.selectionStart);
    const i = text.indexOf(" >> ");
    if (i >= 0) text = text.slice(0, i);
    input.value = "";
    if (input.controller && this.chromeDoc.activeElement == input) input.controller.resetInternalState();
    return text.trim();
  }
  isListName(name) {
    return this.chromeWin.simBooks.some(b => (b.lists || []).some(l => l.name.toLowerCase() == String(name).toLowerCase()));
  }
  simPill(address) {
    const [a] = this.parseAddresses(address);
    const pill = this.chromeDoc.createElement("span");
    pill.className = "sim-pill";
    const list = a && !a.email.includes("@") && this.isListName(a.name || a.email);
    pill.dataset.address = a ? a.text : address;
    pill.dataset.email = a ? a.email : "";
    pill.dataset.name = a ? a.name : "";
    if (list) pill.dataset.list = "1";
    if (!list && !FaixaSimHost.validEmail(a && a.email)) pill.classList.add("invalid-address");
    pill.textContent = pill.dataset.address;
    return pill;
  }
  addRecipients(type, addresses) {
    const row = this.chromeDoc.querySelector(`.address-row[data-recipienttype="${type}"]`);
    if (!row || !addresses.length) return;
    const input = row.querySelector(".address-row-input");
    // Como o addressRowAddRecipientsArray do Thunderbird: linha escondida (Cc, Cco)
    // aparece e recebe o foco (showAndFocusAddressRow).
    if (row.classList.contains("hidden")) {
      row.classList.remove("hidden");
      input.focus();
    }
    for (const a of addresses) input.before(this.simPill(a));
    this.nativeLog.push("addRecipients:" + type);
  }
  replacePill(pillEl, address) {
    pillEl.before(this.simPill(address));
    pillEl.remove();
  }
  removePill(pillEl) {
    pillEl.remove();
  }
  setPendingText(input, text) {
    input.value = text;
  }
  listBooks() {
    return this.chromeWin.simBooks.map(b => ({ id: b.id, name: b.dirName, remote: !!b.remote, collected: !!b.collected }));
  }
  async searchContacts(text, { bookId = null, limit = 500 } = {}) {
    const norm = s => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const words = norm(text).split(/[,\s]+/).filter(Boolean);
    const hit = (...fields) => words.every(w => fields.some(f => norm(f).includes(w)));
    const out = [];
    for (const b of this.chromeWin.simBooks) {
      if (bookId && b.id != bookId) continue;
      const book = { bookId: b.id, book: b.dirName, collected: !!b.collected };
      const contacts = [...(b.contacts || [])];
      for (const e of b.emails || []) {
        if (!contacts.some(c => c.email == e)) contacts.push({ name: "", email: e });
      }
      for (const c of contacts) {
        if (hit(c.name, c.email)) out.push(Object.assign({ name: c.name, email: c.email, isList: false, address: this.makeAddress(c.name, c.email), cardId: b.id + ":" + c.email }, book));
      }
      for (const l of b.lists || []) {
        if (hit(l.name)) out.push(Object.assign({ name: l.name, email: "", isList: true, address: this.makeAddress(l.name, l.description || l.name) }, book));
      }
    }
    await new Promise(r => setTimeout(r, this.chromeWin.simSearchDelay || 5)); // catálogo lento (LDAP): window.simSearchDelay
    return out.slice(0, limit);
  }
  createTestBook(contacts, name) {
    const books = this.chromeWin.simBooks;
    const book = { id: "faixa-autoteste", dirName: name, emails: [], contacts: contacts.map(c => Object.assign({}, c)) };
    books.push(book);
    return {
      id: book.id,
      drop: () => {
        const i = books.indexOf(book);
        if (i >= 0) books.splice(i, 1);
      },
    };
  }
  composeKind() {
    return this.chromeWin.simComposeKind || "new";
  }
  /* Anexar Mensagem e Outros Cartões de Visita: pastas e mensagens de window.simFolders
   * (boot.js); os anexos vão para window.simAttachments. */
  mailFolders() {
    return (this.chromeWin.simFolders || []).map(f => ({ id: f.id, name: f.name, depth: f.depth || 0, account: f.account }));
  }
  mailSelection() {
    return this.chromeWin.simMailSelection || { folderId: null, selected: [] };
  }
  async listMessages(folderId, text = "", limit = 500) {
    const f = (this.chromeWin.simFolders || []).find(x => x.id == folderId);
    await new Promise(r => setTimeout(r, 5));
    if (!f || f.broken) throw new Error("pasta sem índice");
    const norm = s => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const words = norm(text).split(/\s+/).filter(Boolean);
    const items = (f.messages || []).filter(m => words.every(w => norm(m.subject + " " + m.author).includes(w))).sort((a, b) => b.date - a.date);
    return { items: items.slice(0, limit).map(m => Object.assign({}, m)), capped: items.length > limit };
  }
  async attachMessages(ids) {
    const all = (this.chromeWin.simFolders || []).flatMap(f => f.messages || []);
    const list = ids.map(id => all.find(m => m.id == id)).filter(Boolean);
    this.chromeWin.simAttachments = (this.chromeWin.simAttachments || []).concat(list.map(m => ({ url: m.id, name: m.subject + ".eml", type: "message/rfc822" })));
    this.nativeLog.push("attachMessages:" + list.length);
    return list.length;
  }
  async attachContactCards(items) {
    const list = items.filter(it => it.cardId);
    this.chromeWin.simAttachments = (this.chromeWin.simAttachments || []).concat(list.map(it => ({
      name: (it.name || it.email) + ".vcf", type: "text/vcard", vcard: "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:" + it.name + "\r\nEMAIL:" + it.email + "\r\nEND:VCARD\r\n",
    })));
    this.nativeLog.push("attachContactCards:" + list.length);
    return list.length;
  }
  appInfo() {
    return { app: "Thunderbird 153.3.2", platform: "Linux" };
  }
  /* Assinaturas: identidade simulada (window.simIdentity) e troca de conta por
   * window.simSwitchIdentity (boot.js), que imita o SetIdentity do Thunderbird. */
  signatureContext() {
    const kind = this.chromeWin.simComposeKind || "new";
    if (kind == "new" || kind == "reply" || kind == "forward") {
      return { kind, reply: kind != "new" };
    }
    return { kind: "other", reply: !!this.chromeWin.simReferences };
  }
  replyOnTop() {
    const v = this.chromeWin.simReplyOnTop;
    return v == null ? null : !!v;
  }
  currentIdentity() {
    const id = this.chromeWin.simIdentity;
    return id ? Object.assign({}, id) : null;
  }
  onIdentityChanged(fn) {
    const h = () => fn();
    this.chromeWin.addEventListener("compose-from-changed", h);
    return () => this.chromeWin.removeEventListener("compose-from-changed", h);
  }
  allowRemoteContent() {
    this.remoteContentCalls = (this.remoteContentCalls || 0) + 1;
    this.chromeWin.simRemoteAllowed = true;
  }
  tbParagraphPrefs() {
    return { paragraph: this.chromeWin.simParagraphPref !== false, crNewP: true };
  }
  surveyKeys() {
    return (this.chromeWin.SIM_KEYS || []).map(k => ({ combo: FaixaShortcuts.normalize([...k.mods, k.key].join("+")), id: k.id, command: k.cmd, disabled: false }));
  }
  /** O MsgUtils.getFcc do Thunderbird: aqui, Enviados da conta (ou o que o teste pôs). */
  sentCopyFolder() {
    const w = this.chromeWin;
    return "simFcc" in w ? w.simFcc : "mailbox://ana/Sent";
  }
  dispose() {
    for (const mo of this.observers) mo.disconnect();
    this.observers = [];
    this.restoreMenubar();
    for (const id of [...this.sheets.keys()]) this.removeAgentSheet(id);
    for (const id of this.styleIds) this.chromeDoc.getElementById(id)?.remove();
  }
};

// A barra de menus, as confirmações e o Acompanhamento usam o código do host de verdade
// (atributos, xulstore, campos da mensagem, observadores e o ouvinte do envio).
for (const name of ["menubar", "menubarHidden", "nativeMenubarHidden", "setMenubarHidden", "applyMenubar", "observeMenubar", "restoreMenubar",
  "compFields", "receiptState", "toggleReturnReceipt", "toggleDSN", "observeReceipts", "recipientFlag", "setRecipientFlag", "onSavedCopy", "messageId", "extraCopyFolder", "onAfterSend"]) {
  Object.defineProperty(FaixaSimHost.prototype, name, Object.getOwnPropertyDescriptor(FaixaTBHost.prototype, name));
}
