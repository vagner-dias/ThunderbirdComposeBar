/* Faixa de Opções — experiment "faixa" (processo pai).
 *
 * Registra um ouvinte de janelas para messengercompose.xhtml e, em cada janela
 * de composição, monta a faixa (ui.js), liga o motor de edição (engine.js) e a
 * integração com a janela (host.js). Comandos de mensagem (prioridade, formato
 * de envio) seguem para o background por um evento persistente, que acorda a
 * página de eventos do Manifest V3 quando ela está suspensa. */

"use strict";

/* global ExtensionCommon, ExtensionAPIPersistent, Services, Cc, Ci, ChromeUtils, AppConstants */

var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
var { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
var { ExtensionUtils } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");

var FAIXA_COMPOSE_URL = "chrome://messenger/content/messengercompose/messengercompose.xhtml";
var FAIXA_PARTS = ["icons.js", "ui.js", "dialogs.js", "engine.js", "names.js", "sanitize.js", "signatures.js", "quickparts.js", "host.js"];

/* Padrões usados até o background enviar a configuração efetiva. */
/* Teclas que só andam pela faixa: não tiram a Visualização Dinâmica. */
var FAIXA_PREVIEW_NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

var FAIXA_DEFAULTS = {
  fontePadrao: { familia: "Calibri", tamanhoPt: 11 },
  ocultarBarraThunderbird: true,
  // true: a barra de menus começa oculta (Alt ou F10 mostram os menus).
  ocultarBarraMenus: true,
  paragrafoSemEspaco: true,
  perfilAtalhos: "thunderbird-office",
  abaInicial: "mensagem",
  recolhida: false,
  idioma: "auto",
  visualizacaoDinamica: true,
  suporte: null,
  assinaturas: [],
  assinaturaPadrao: {},
  assinaturaPadraoOrg: {},
  partesRapidas: [],
  gerenciadas: [], // chaves que a política define (os botões delas ficam travados)
};

/** A barra de menus pela configuração: true/false (escolha feita na faixa ou pela
 * política) ou null (o que o Thunderbird guardou). */
function faixaMenubarChoice(config) {
  return typeof config.ocultarBarraMenus == "boolean" ? config.ocultarBarraMenus : null;
}

/** A organização definiu como falar com o suporte (política "suporte")? */
function faixaHasSupport(s) {
  return !!s && typeof s == "object" && !!(s.email || s.telefone || /^https?:\/\//i.test(String(s.portal || "")));
}

function faixaReadText(extension, path) {
  return new Promise((resolve, reject) => {
    const uri = extension.rootURI.resolve(path);
    NetUtil.asyncFetch({ uri, loadUsingSystemPrincipal: true }, (stream, status) => {
      if (status & 0x80000000) {
        reject(new Error(FaixaI18n.t("error.read", "não foi possível ler {path}", { path })));
        return;
      }
      try {
        resolve(NetUtil.readInputStreamToString(stream, stream.available(), { charset: "utf-8" }));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/* Importar as assinaturas do Thunderbird (página Assinaturas). */
var FAIXA_IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

function faixaBase64(bytes) {
  return ChromeUtils.base64URLEncode(bytes, { pad: true }).replace(/-/g, "+").replace(/_/g, "/");
}

/** Texto de um arquivo de assinatura, como o Thunderbird lê (LoadDataFromFile): o
 * charset do <meta>, UTF-8, UTF-16 com BOM e, no resto, windows-1252. */
function faixaDecode(bytes) {
  let TD = typeof TextDecoder == "function" ? TextDecoder : null;
  if (!TD) {
    try {
      TD = Services.appShell.hiddenDOMWindow.TextDecoder;
    } catch (e) {}
  }
  const latin1 = b => {
    let out = "";
    for (let i = 0; i < b.length; i += 8192) {
      out += String.fromCharCode(...b.subarray(i, i + 8192));
    }
    return out;
  };
  const decode = (label, fatal) => {
    try {
      return new TD(label, { fatal }).decode(bytes);
    } catch (e) {
      return null;
    }
  };
  if (!TD) {
    return latin1(bytes);
  }
  const meta = /<meta\b[^>]*charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(latin1(bytes.subarray(0, 4096)));
  if (meta) {
    const text = decode(meta[1], false);
    if (text != null) {
      return text;
    }
  }
  if (bytes.length >= 2 && ((bytes[0] == 0xFF && bytes[1] == 0xFE) || (bytes[0] == 0xFE && bytes[1] == 0xFF))) {
    return decode(bytes[0] == 0xFF ? "utf-16le" : "utf-16be", false) || "";
  }
  return decode("utf-8", true) ?? decode("windows-1252", false) ?? latin1(bytes);
}

/** Imagens file:// da assinatura viram data:, como o Thunderbird faz ao pôr a dele
 * (ReplaceFileURLs). Arquivo que não abre, ou maior que 2 MB, fica de fora. */
async function faixaInlineFiles(html) {
  const urls = [...new Set([...String(html).matchAll(/(["'])(file:\/\/[^"']+)\1/gi)].map(m => m[2]))];
  for (const url of urls) {
    try {
      const file = Services.io.newURI(url).QueryInterface(Ci.nsIFileURL).file;
      const type = FAIXA_IMAGE_TYPES[(file.leafName.split(".").pop() || "").toLowerCase()];
      if (!type || !file.exists() || file.fileSize > 2 * 1024 * 1024) {
        continue;
      }
      html = html.split(url).join(`data:${type};base64,${faixaBase64(await IOUtils.read(file.path))}`);
    } catch (e) {}
  }
  return html;
}

/** A assinatura que o Thunderbird tem para a identidade, em HTML: o arquivo escolhido
 * nas Configurações da conta (HTML, imagem ou texto, pela extensão, como ele decide) ou,
 * sem arquivo, o texto de lá. Com "anexar arquivo" marcado e o arquivo sumido, o
 * Thunderbird não põe nada, e aqui também não. */
async function faixaTBSignature(identity) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const textToHTML = s => esc(s).replace(/\r\n|\r|\n/g, "<br>");
  try {
    if (identity.attachSignature) {
      let file = null;
      try {
        file = identity.signature;
      } catch (e) {}
      if (!file || !file.exists() || !file.isFile()) {
        return "";
      }
      const ext = (file.leafName.split(".").pop() || "").toLowerCase();
      if (FAIXA_IMAGE_TYPES[ext]) {
        if (file.fileSize > 2 * 1024 * 1024) {
          return "";
        }
        return `<img src="data:${FAIXA_IMAGE_TYPES[ext]};base64,${faixaBase64(await IOUtils.read(file.path))}" alt="">`;
      }
      if (file.fileSize > 1024 * 1024) {
        return "";
      }
      const text = faixaDecode(await IOUtils.read(file.path));
      if (ext == "htm" || ext == "html") {
        const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(text);
        return faixaInlineFiles(m ? m[1] : text);
      }
      return textToHTML(text);
    }
    const sig = identity.htmlSigText || "";
    return identity.htmlSigFormat ? faixaInlineFiles(sig) : textToHTML(sig);
  } catch (e) {
    console.warn("[Faixa] assinatura do Thunderbird", identity.key, e);
    return "";
  }
}

/* -------------------------------------------------------------------------
 * Acompanhamento: a estrela na cópia enviada
 * ----------------------------------------------------------------------- */
/* "Sinalizar para Mim", como no Outlook: depois do envio, a cópia da mensagem (Enviados, a
 * pasta escolhida nas Configurações da conta, a de Opções → Enviar uma cópia para) recebe a
 * estrela do Thunderbird. A cópia só aparece depois de gravada (numa pasta IMAP, quando o
 * Thunderbird a traz do servidor) e, com Enviar mais tarde, quando a Saída for enviada, talvez
 * depois de reiniciar. Por isso a faixa guarda o Message-ID e as pastas da cópia numa
 * preferência e põe a estrela quando a cópia aparece:
 * - só nessas pastas e só na cópia lida (o Thunderbird grava a cópia enviada como lida): a
 *   mensagem que chega para si mesmo (Para, Cc ou Cco) tem o mesmo Message-ID e fica sem
 *   estrela, como no Outlook;
 * - uma vez em cada pasta: a estrela que o usuário tirar depois não volta;
 * - nunca em Rascunhos, Modelos, Saída nem Lixeira. */
var FAIXA_FOLLOWUP_PREF = "extensions.faixa.acompanhamento";
var FAIXA_DAY_MS = 24 * 60 * 60 * 1000;

var FaixaFollowUpFlagger = class {
  /** deps (testes): mfn, getFolder(uri), prefs, setTimeout, now. Sem eles, os do Thunderbird. */
  constructor(deps = {}) {
    this.deps = deps;
    // Message-ID → { until: validade (ms), folders: pastas que ainda esperam a cópia, done: pastas já feitas }
    this.pending = new Map();
    this.listening = false;
    this.flagged = 0;
    this.load();
  }

  get now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  get prefs() {
    return this.deps.prefs || Services.prefs;
  }

  get mfn() {
    if (this.deps.mfn) {
      return this.deps.mfn;
    }
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    return MailServices.mfn;
  }

  folder(uri) {
    if (this.deps.getFolder) {
      return this.deps.getFolder(uri);
    }
    const { MailUtils } = ChromeUtils.importESModule("resource:///modules/MailUtils.sys.mjs");
    return MailUtils.getExistingFolder(uri);
  }

  later(fn, ms) {
    if (this.deps.setTimeout) {
      return this.deps.setTimeout(fn, ms);
    }
    const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
    return setTimeout(fn, ms);
  }

  /** Rascunhos, Saída, Modelos e Lixeira não recebem a estrela. */
  static skipped(folder) {
    const F = (typeof Ci != "undefined" && Ci.nsMsgFolderFlags) || {};
    const skip = (F.Drafts || 0x400) | (F.Queue || 0x800) | (F.Templates || 0x400000) | (F.Trash || 0x100);
    return !folder || !!(folder.flags & skip);
  }

  /** As pastas que recebem a cópia, com o URI como o da pasta (o das preferências pode vir
   * escrito de outro jeito), sem "nocopy://" nem a Saída. */
  targets(uris) {
    const out = [];
    for (const uri of uris || []) {
      if (!uri || /^(nocopy|anyfolder):/i.test(uri)) {
        continue;
      }
      let folder = null;
      try {
        folder = this.folder(uri);
      } catch (e) {}
      if (folder && FaixaFollowUpFlagger.skipped(folder)) {
        continue;
      }
      const canonical = (folder && folder.URI) || uri;
      if (!out.includes(canonical)) {
        out.push(canonical);
      }
    }
    return out;
  }

  /** Esta cópia é a que ganha a estrela? */
  accepts(entry, hdr) {
    const folder = hdr && hdr.folder;
    return !!folder && entry.until > this.now && !FaixaFollowUpFlagger.skipped(folder) && !!hdr.isRead && entry.folders.includes(folder.URI);
  }

  load() {
    let list = [];
    try {
      list = JSON.parse(this.prefs.getStringPref(FAIXA_FOLLOWUP_PREF, "[]"));
    } catch (e) {}
    const now = this.now;
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item.id != "string" || !(item.until > now) || !Array.isArray(item.folders)) {
        continue;
      }
      const folders = item.folders.filter(f => typeof f == "string");
      if (folders.length) {
        this.pending.set(item.id, { until: item.until, folders, done: [] });
      }
    }
    this.updateListening();
  }

  /** Grava as que ainda esperam a cópia (as já feitas só servem nesta sessão). */
  save() {
    const now = this.now;
    const list = [...this.pending].filter(([, e]) => e.until > now && e.folders.length).map(([id, e]) => ({ id, until: e.until, folders: e.folders }));
    try {
      if (list.length) {
        this.prefs.setStringPref(FAIXA_FOLLOWUP_PREF, JSON.stringify(list));
      } else {
        this.prefs.clearUserPref(FAIXA_FOLLOWUP_PREF);
      }
    } catch (e) {
      console.warn("[Faixa] acompanhamento", e);
    }
  }

  prune() {
    const now = this.now;
    let changed = false;
    for (const [id, entry] of this.pending) {
      if (entry.until <= now) {
        this.pending.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** Ouve as pastas enquanto alguma cópia é esperada. */
  updateListening() {
    if ([...this.pending.values()].some(e => e.folders.length)) {
      this.listen();
    } else {
      this.unlisten();
    }
  }

  /** Uma mensagem com Sinalizar para Mim: folders, as pastas onde o Thunderbird grava (ou vai
   * gravar) a cópia enviada. queued: Enviar mais tarde (ou envio em segundo plano): a cópia vem
   * quando a Saída for enviada. Pode vir mais de uma vez para a mesma mensagem (cada cópia
   * gravada); uma pasta já feita não volta. */
  remember(messageId, folders, queued) {
    const list = this.targets(folders);
    if (!messageId || !list.length) {
      return;
    }
    this.prune();
    const old = this.pending.get(messageId);
    const done = old ? old.done : [];
    const waiting = [...new Set([...(old ? old.folders : []), ...list.filter(u => !done.includes(u))])];
    const until = Math.max(this.now + (queued ? 30 : 7) * FAIXA_DAY_MS, old ? old.until : 0);
    this.pending.set(messageId, { until, folders: waiting, done });
    this.save();
    this.updateListening();
    // Pasta local: a cópia entra no índice logo depois da gravação; IMAP: quando o servidor
    // confirma (o Thunderbird avisa, e a busca é só uma segurança).
    for (const uri of list.filter(u => waiting.includes(u))) {
      for (const ms of [2000, 10000, 60000]) {
        this.later(() => this.tryFolder(messageId, uri), ms);
      }
    }
  }

  tryFolder(messageId, folderURI) {
    try {
      const entry = this.pending.get(messageId);
      if (!entry || !entry.folders.includes(folderURI)) {
        return;
      }
      const folder = this.folder(folderURI);
      const hdr = folder && folder.msgDatabase.getMsgHdrForMessageID(messageId);
      if (hdr && this.accepts(entry, hdr)) {
        this.flag(messageId, entry, hdr);
      }
    } catch (e) {}
  }

  /** Cabeçalho provisório do IMAP com chave falsa (servidor sem UIDPLUS, pasta guardada no
   * computador): a estrela fica só aqui, e ele é trocado pelo do servidor na sincronização. */
  static provisional(hdr) {
    try {
      return typeof hdr.getUint32Property == "function" && hdr.getUint32Property("pseudoHdr") == 1 && hdr.messageKey >= 0xff000000;
    } catch (e) {
      return false;
    }
  }

  /** A estrela nesta cópia; a pasta fica feita (com o cabeçalho provisório, continua esperando
   * o do servidor). */
  flag(messageId, entry, hdr) {
    const uri = hdr.folder.URI;
    if (!FaixaFollowUpFlagger.provisional(hdr)) {
      entry.folders = entry.folders.filter(u => u != uri);
      entry.done.push(uri);
    }
    try {
      if (!hdr.isFlagged) {
        hdr.folder.markMessagesFlagged([hdr], true);
        this.flagged++;
      }
    } catch (e) {
      console.warn("[Faixa] acompanhamento", e);
    }
    this.save();
    this.updateListening();
  }

  onHeaders(hdrs) {
    if (this.prune()) {
      this.save();
    }
    for (const hdr of hdrs) {
      const entry = hdr && this.pending.get(hdr.messageId);
      if (entry && this.accepts(entry, hdr)) {
        this.flag(hdr.messageId, entry, hdr);
      }
    }
    this.updateListening();
  }

  // nsIMsgFolderListener
  msgAdded(hdr) {
    this.onHeaders([hdr]);
  }

  msgsClassified(msgs) {
    this.onHeaders([...msgs]);
  }

  listen() {
    if (this.listening) {
      return;
    }
    const mfn = this.mfn;
    if (!this.listener) {
      this.listener = {
        QueryInterface: ChromeUtils.generateQI(["nsIMsgFolderListener"]),
        msgAdded: hdr => this.msgAdded(hdr),
        msgsClassified: msgs => this.msgsClassified(msgs),
      };
    }
    mfn.addListener(this.listener, mfn.msgAdded | mfn.msgsClassified);
    this.listening = true;
  }

  unlisten() {
    if (this.listening) {
      try {
        this.mfn.removeListener(this.listener);
      } catch (e) {}
      this.listening = false;
    }
  }
};

/* O Acompanhamento de um rascunho. O Thunderbird grava o X-Message-Flag no rascunho, mas não o
 * traz de volta quando o rascunho é aberto (só os cabeçalhos de mail.compose.other.header), e o
 * Sinalizar para Mim é da faixa. O rascunho aberto mantém o Message-ID da última gravação (cada
 * gravação gera um novo), então a faixa guarda o estado por esse Message-ID. */
var FAIXA_DRAFT_FOLLOWUP_PREF = "extensions.faixa.acompanhamentoRascunhos";
var FAIXA_DRAFT_FOLLOWUP_DAYS = 180;
var FAIXA_DRAFT_FOLLOWUP_MAX = 100;

var FaixaDraftFollowUps = class {
  /** deps (testes): prefs, now. */
  constructor(deps = {}) {
    this.deps = deps;
  }

  get prefs() {
    return this.deps.prefs || Services.prefs;
  }

  get now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  read() {
    let list = [];
    try {
      list = JSON.parse(this.prefs.getStringPref(FAIXA_DRAFT_FOLLOWUP_PREF, "[]"));
    } catch (e) {}
    const now = this.now;
    return (Array.isArray(list) ? list : []).filter(x => x && typeof x.id == "string" && x.until > now && (x.me || x.recipients));
  }

  write(list) {
    list = list.slice(-FAIXA_DRAFT_FOLLOWUP_MAX);
    try {
      if (list.length) {
        this.prefs.setStringPref(FAIXA_DRAFT_FOLLOWUP_PREF, JSON.stringify(list));
      } else {
        this.prefs.clearUserPref(FAIXA_DRAFT_FOLLOWUP_PREF);
      }
    } catch (e) {
      console.warn("[Faixa] acompanhamento do rascunho", e);
    }
  }

  /** { me, recipients } do rascunho com esse Message-ID, ou null. */
  get(messageId) {
    const item = messageId ? this.read().find(x => x.id == messageId) : null;
    return item ? { me: !!item.me, recipients: !!item.recipients } : null;
  }

  /** Rascunho gravado com o Message-ID messageId (null: nenhum, a mensagem foi enviada):
   * guarda o estado (sem sinalizador, nada) e esquece os Message-IDs das gravações anteriores
   * da mesma mensagem, que o Thunderbird substitui. */
  update(messageId, state, forget = []) {
    const drop = new Set([messageId, ...forget].filter(Boolean));
    const before = this.read();
    const list = before.filter(x => !drop.has(x.id));
    if (messageId && state && (state.me || state.recipients)) {
      list.push({ id: messageId, me: !!state.me, recipients: !!state.recipients, until: this.now + FAIXA_DRAFT_FOLLOWUP_DAYS * FAIXA_DAY_MS });
    }
    if (list.length != before.length || list.some((x, i) => x !== before[i])) {
      this.write(list);
    }
  }
};

/* -------------------------------------------------------------------------
 * Controlador de uma janela de composição
 * ----------------------------------------------------------------------- */
var FaixaComposeController = class {
  constructor(api, win) {
    this.api = api;
    this.win = win;
    this.host = new FaixaTBHost(win);
    this.engine = null;
    this.ui = null;
    this.messageState = {};
    this.pongWaiters = new Map();
    this.disposers = [];
    this.lastError = null;
    this.followUpMe = false; // Sinalizar para Mim (a estrela na cópia enviada)
    this.draftIds = []; // Message-IDs do rascunho desta mensagem com Acompanhamento guardado
    this.pendingSend = null; // normalização do envio ainda reversível: { undo, inFlight }
    this.keyState = FaixaShortcuts.newKeyState();
    this.names = new FaixaNames({ host: this.host, ui: () => this.ui });
    this.signatures = new FaixaSignatures({ host: this.host, config: () => this.api.config, engine: () => this.engine });
    this.quickParts = new FaixaQuickParts({ host: this.host, config: () => this.api.config, engine: () => this.engine });
  }

  get tabId() {
    try {
      const wrapper = this.api.extension.tabManager.getWrapper(this.win);
      return wrapper ? wrapper.id : -1;
    } catch (e) {
      return -1;
    }
  }

  start() {
    const api = this.api;
    const win = this.win;
    const doc = win.document;
    const t0 = win.performance.now();
    this.host.injectChromeStyle("faixa-css", api.css);
    this.host.setMainToolbarHidden(api.config.ocultarBarraThunderbird !== false);
    this.host.setMenubarHidden(faixaMenubarChoice(api.config));
    this.host.observeMenubar(hidden => this.onMenubarChanged(hidden));
    this.host.flash = (text, ms) => this.ui && this.ui.flash(text, ms);
    this.buildUI(Object.assign({
      editorReady: false,
      isHTML: this.host.isHTML(),
      sendEnabled: this.host.sendEnabled(),
      focusArea: "headers",
      support: faixaHasSupport(api.config.suporte),
    }, this.barsState(api.config)));
    this.mountMs = win.performance.now() - t0;
    // Ao enviar, o Thunderbird trava a janela e desativa os comandos (cmd_sendButton
    // incluído): a faixa acompanha a trava pelo mesmo sinal.
    this.host.observeSendEnabled(enabled => this.ui.setState({ sendEnabled: enabled, locked: !!win.gWindowLocked }));

    // Como no Outlook, a formatação só vale com o foco no corpo: no Para, no Assunto
    // ou nos anexos os botões de formatação ficam desativados. Mexer na faixa não muda isso.
    // "focus" também: no corpo (documento em modo de edição) o alvo pode ser a janela dele.
    const onFocusIn = e => this.onFocusIn(e);
    win.addEventListener("focusin", onFocusIn, true);
    win.addEventListener("focus", onFocusIn, true);
    this.disposers.push(() => {
      win.removeEventListener("focusin", onFocusIn, true);
      win.removeEventListener("focus", onFocusIn, true);
    });
    this.syncFocusArea();

    // Captura na janela: os keydown do corpo da mensagem (editor no mesmo processo)
    // passam aqui antes do editor e das teclas <key> do Thunderbird. Com o keydown
    // consumido, o Gecko não dispara keypress, então nada mais executa a tecla.
    // O keyup e o blur só acompanham de que lado está o Alt (AltGr × Ctrl+Alt).
    const onKeyDown = e => this.onKeyDown(e);
    const onKeyUp = e => FaixaShortcuts.track(this.keyState, e, false);
    const onBlur = e => {
      // Só quando a janela perde o foco (Alt+Tab, Ctrl+Alt+Del): os keyup não chegam.
      if (e.target == win || e.target == win.document) {
        this.keyState = FaixaShortcuts.newKeyState();
      }
    };
    win.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("keyup", onKeyUp, true);
    win.addEventListener("blur", onBlur, true);
    this.disposers.push(() => {
      win.removeEventListener("keydown", onKeyDown, true);
      win.removeEventListener("keyup", onKeyUp, true);
      win.removeEventListener("blur", onBlur, true);
    });

    this.host.whenEditorReady().then(() => this.onEditorReady()).catch(e => {
      this.lastError = e;
      console.error("[Faixa] editor", e);
    });
  }

  /** Monta a faixa e o Enviar (de novo, quando o idioma muda). */
  buildUI(state) {
    const api = this.api;
    this.ui = new FaixaUI({
      doc: this.win.document,
      definition: api.definition,
      config: api.config,
      onCommand: (cmd, args, meta) => this.command(cmd, args, meta),
      getFonts: () => api.listFonts(),
      focusEditor: () => this.host.focusEditor(),
      returnFocus: () => this.returnFocus(),
      isMac: AppConstants.platform == "macosx",
      platform: AppConstants.platform,
    });
    this.ui.onBeforeMenu = () => this.refreshMenuState();
    this.ui.onPreview = (cmd, args) => this.preview(cmd, args);
    this.ui.onPreviewEnd = () => this.endPreview();
    this.host.mountRibbon(this.ui.build());
    this.host.mountSendButton(this.ui.buildSendButton());
    this.ui.setState(state || {});
    this.ui.scheduleFit();
  }

  rebuildUI() {
    const old = this.ui;
    const state = old ? Object.assign({}, old.state) : {};
    const tab = old && old.selectedTab;
    const collapsed = !!(old && old.root && old.root.classList.contains("fx-collapsed"));
    if (old) {
      old.dispose();
    }
    this.buildUI(state);
    if (tab && this.ui.panels.has(tab)) {
      this.ui.selectTab(tab);
    }
    if (old) {
      this.ui.toggleCollapse(collapsed); // a janela fica como estava, recolhida ou não
    }
    if (this.engine) {
      this.engine.def = this.api.definition;
      this.engine.applyLabel = this.ui.shortcuts.labelsFor("painterApply")[0] || "";
      this.engine.scheduleState(0);
    }
  }

  /** Área do foco: "body" (corpo), "headers" (De, Para, Assunto, anexos) ou null
   * (a própria faixa e os menus dela, ou a janela inteira: não muda a área). */
  focusAreaOf(target) {
    const host = this.host;
    if (!target) {
      return null;
    }
    const edDoc = host.editorDoc;
    if (target == host.editorElement || (host.editorWin && target == host.editorWin) ||
      (edDoc && (target == edDoc || target.ownerDocument == edDoc))) {
      return "body";
    }
    const doc = this.win.document;
    if (target.nodeType != 1 || target == doc.documentElement || target == doc.body) {
      return null;
    }
    if (target.closest("#faixa-root, #faixa-layer, .fx-layer, #faixa-send")) {
      return null;
    }
    return "headers";
  }

  onFocusIn(e) {
    const area = this.focusAreaOf(e.target);
    if (area == "headers") {
      this.lastHeaderFocus = e.target;
    }
    if (area && this.ui && area != this.ui.state.focusArea) {
      this.ui.setState({ focusArea: area });
    }
  }

  /** Volta o foco para onde o usuário estava antes de entrar na faixa pelo teclado:
   * o campo do cabeçalho (Para, Assunto...) ou o corpo da mensagem. */
  returnFocus() {
    const el = this.lastHeaderFocus;
    if (this.ui && this.ui.state.focusArea == "headers" && el && el.isConnected && !el.disabled && typeof el.focus == "function") {
      el.focus();
    } else {
      this.host.focusEditor();
    }
  }

  /** A faixa entra no ciclo do F6 (e Ctrl+Tab) do Thunderbird, como mais uma área
   * da janela, logo antes do De:. A lista (gFocusAreas) só existe depois do
   * ComposeStartup: o registro é tentado no editor pronto e antes de cada F6. */
  registerFocusArea() {
    const areas = this.win.gFocusAreas;
    if (this.focusEntry || !Array.isArray(areas)) {
      return;
    }
    const entry = {
      root: {
        contains: el => !!el && !!this.ui && (!!(this.ui.root && this.ui.root.contains(el)) || !!(this.ui.sendButton && this.ui.sendButton.contains(el))),
      },
      focus: () => !!this.ui && !!this.ui.root && this.ui.root.isConnected && this.ui.focusRibbon(),
    };
    const i = areas.findIndex(a => a && a.root && a.root.id == "top-gradient-box");
    areas.splice(i < 0 ? 0 : i, 0, entry);
    this.focusEntry = entry;
    this.disposers.push(() => {
      const k = areas.indexOf(entry);
      if (k >= 0) {
        areas.splice(k, 1);
      }
    });
  }

  /** Área do foco lida agora (o foco pode ter entrado no corpo antes da faixa escutar). */
  syncFocusArea() {
    let target = null;
    try {
      target = this.host.focusedTarget();
    } catch (e) {}
    this.onFocusIn({ target });
  }

  /** Antes de abrir um menu: estado do que ele mostra (anexos, contas do Filelink,
   * assinaturas, Partes Rápidas). */
  refreshMenuState() {
    try {
      const inCell = !!this.ui.state.inCell;
      this.ui.state = Object.assign({}, this.ui.state, this.host.attachState(), {
        signatures: this.signatures.menuList(),
        quickParts: this.quickParts.menuList(),
        canMergeCells: inCell && this.host.nativeEnabled("cmd_JoinTableCells"),
        canSplitCell: inCell && this.host.nativeEnabled("cmd_SplitTableCell"),
      });
    } catch (e) {
      this.lastError = e;
    }
  }

  /** Assinatura padrão da conta na mensagem recém-aberta. Sem a configuração do
   * background ainda (Thunderbird acabando de abrir), espera por ela. */
  applyDefaultSignature() {
    if (!this.api.configured) {
      this.signatureWaiting = true;
      return;
    }
    this.signatureWaiting = false;
    try {
      this.signatureResult = this.signatures.applyDefault();
    } catch (e) {
      this.lastError = e;
      console.error("[Faixa] assinatura", e);
    }
  }

  onEditorReady() {
    if (this.disposed) {
      return;
    }
    this.engine = new FaixaEngine(this.host, this.api.definition, this.api.config);
    this.engine.applyLabel = this.ui.shortcuts.labelsFor("painterApply")[0] || "";
    this.engine.onState(state => this.ui.setState(state));
    this.engine.attach();
    this.applyDefaultSignature();
    this.disposers.push(this.host.onIdentityChanged(() => this.signatures.onIdentityChanged()));
    this.disposers.push(this.host.onSend((type, sending, event) => this.onSendEvent(sending, event)));
    // Confirmações e Acompanhamento: o estado vem dos campos da mensagem (o Thunderbird já pôs
    // o padrão da conta) e acompanha o menu Opções e a troca de conta no De:.
    this.host.observeReceipts(() => this.refreshTracking());
    this.disposers.push(this.host.onSend(type => {
      this.sendType = type;
      this.sendFollowUp = !!this.followUpMe;
      this.sendExtraFolder = this.host.extraCopyFolder();
    }));
    this.disposers.push(this.host.onSavedCopy((messageId, folderURI) => this.onSavedCopy(messageId, folderURI)));
    // Enviada (também sem cópia em Enviados): o rascunho sai.
    this.disposers.push(this.host.onAfterSend(() => this.forgetDraft()));
    // Rascunho aberto de novo: o Acompanhamento que ele tinha.
    this.draftIds = [];
    const draftId = this.host.messageId();
    const saved = draftId ? this.api.draftFollowUp(draftId) : null;
    if (saved) {
      this.draftIds = [draftId];
      this.setFollowUp(saved);
    }
    this.refreshTracking();
    // Envio, rascunho e modelo: o Thunderbird (e os complementos, no onBeforeSend) já leem o
    // corpo antes do compose-send-message. A prévia sai no começo e não volta até o fim.
    const onPrepare = () => {
      this.preparing = true;
      this.endPreview();
    };
    const onPrepared = () => {
      this.preparing = false;
    };
    this.win.addEventListener("compose-prepare-message-start", onPrepare);
    this.win.addEventListener("compose-prepare-message-completed", onPrepared);
    this.disposers.push(() => {
      this.win.removeEventListener("compose-prepare-message-start", onPrepare);
      this.win.removeEventListener("compose-prepare-message-completed", onPrepared);
    });
    this.disposers.push(this.host.onComposeProcessDone(ok => this.onSendDone(ok)));
    // Rede de segurança: qualquer tecla ou clique no corpo com normalização pendente
    // e sem envio em curso devolve o corpo ao que o usuário tinha antes de editar.
    const onUserAction = () => this.revertPendingSend();
    const edDoc = this.host.editorDoc;
    for (const type of ["keydown", "mousedown"]) {
      edDoc.addEventListener(type, onUserAction, true);
      this.disposers.push(() => edDoc.removeEventListener(type, onUserAction, true));
    }
    this.api.lastKeySurvey = this.host.surveyKeys();
    this.api.emitReady(this.tabId);
    this.syncFocusArea();
    this.registerFocusArea();
    this.ui.scheduleFit();
  }

  /** Visualização Dinâmica (mouse ou foco numa fonte, cor ou estilo da faixa): só com a
   * opção ligada, o comando valendo ali e nada em curso (envio, janela travada). */
  preview(cmd, args) {
    if (this.api.config.visualizacaoDinamica === false || !this.engine || this.win.gWindowLocked || this.pendingSend || this.preparing || this.disposed) {
      return false;
    }
    if (!this.ui.isEnabled(cmd)) {
      return false;
    }
    try {
      return this.engine.preview(cmd, args);
    } catch (e) {
      this.lastError = e;
      return false;
    }
  }

  endPreview() {
    if (this.ui) {
      this.ui.cancelPreviewTimer(); // um item com o mouse em cima não volta a mostrar a prévia depois
    }
    if (this.engine) {
      try {
        this.engine.endPreview();
      } catch (e) {
        this.lastError = e;
      }
    }
  }

  /** Encaminha um comando da faixa (clique ou atalho). */
  command(cmd, args, meta) {
    // O comando vale para o texto de verdade: a Visualização Dinâmica sai antes.
    this.endPreview();
    const def = this.api.definition.commands[cmd] || {};
    // Envio em curso: o Thunderbird trava a janela e desativa os próprios botões;
    // a faixa também não age (o editor.setAttribute ignoraria o somente-leitura).
    if (this.win.gWindowLocked && cmd != "collapse") {
      return;
    }
    this.revertPendingSend();
    try {
      if (def.phase) {
        return;
      }
      // Desfazer/Refazer com o foco no Para ou no Assunto valem para o campo, como no Outlook.
      if ((cmd == "undo" || cmd == "redo") && this.ui.state.focusArea == "headers") {
        this.host.nativeCommand(cmd == "undo" ? "cmd_undo" : "cmd_redo");
        return;
      }
      if (cmd == "formatPlain") {
        this.toPlainText().catch(e => this.fail(e, def));
        return;
      }
      if (def.target == "background") {
        this.api.emitCommand(this.tabId, cmd, args || {});
        return;
      }
      switch (cmd) {
        case "send":
          if (this.names.busy) {
            this.waitNames();
            return;
          }
          this.host.send();
          return;
        case "collapse": {
          // Como no Outlook: a faixa recolhida continua recolhida nas próximas mensagens.
          const collapsed = this.ui.toggleCollapse();
          this.api.emitCommand(this.tabId, "setCollapsed", { collapsed });
          return;
        }
        case "toggleTbToolbar": {
          const visible = !this.ui.state.tbToolbar;
          this.api.setMainToolbarVisible(visible);
          this.api.emitCommand(this.tabId, "setTbToolbar", { visible });
          return;
        }
        case "toggleMenubar": {
          const visible = !this.ui.state.menubar;
          this.api.setMenubarVisible(visible);
          this.api.emitCommand(this.tabId, "setMenubar", { visible });
          return;
        }
        case "followUp":
          // O botão liga Sinalizar para Mim; aceso, limpa o sinalizador (o menu tem o resto).
          this.setFollowUp(this.ui.state.followUp ? { me: false, recipients: false } : { me: true });
          return;
        case "followUpMe":
          this.setFollowUp({ me: !this.followUpMe });
          return;
        case "followUpRecipients":
          this.setFollowUp({ recipients: !this.host.recipientFlag() });
          return;
        case "followUpClear":
          this.setFollowUp({ me: false, recipients: false });
          return;
        case "deliveryReceipt":
          this.host.toggleDSN();
          this.refreshTracking();
          return;
        case "returnReceipt":
          this.host.toggleReturnReceipt();
          this.refreshTracking();
          return;
        case "openDiagnostics":
          this.api.emitCommand(this.tabId, "openDiagnostics", {});
          return;
        case "ribbonOptions":
          this.api.emitCommand(this.tabId, "openOptions", {});
          return;
        case "attachVCard":
        case "attachPublicKey":
          this.host.toggleAttachOption(cmd);
          return;
        case "attachCloud":
          this.host.attachToCloud(args && args.id);
          return;
        case "addressBook": {
          // Catálogo de Endereços: Selecionar Nomes, para o campo onde o usuário estava.
          const el = this.lastHeaderFocus;
          const row = el && this.host.isRecipientInput(el) ? el.closest(".address-row[data-recipienttype]") : null;
          this.names.selectNames({ target: row ? row.dataset.recipienttype : "addr_to" }).catch(e => this.fail(e, def));
          return;
        }
        case "checkNames":
          this.names.check().catch(e => this.fail(e, def));
          return;
        case "insertSignature":
          if (this.engine && this.ui.isEnabled(cmd)) {
            this.signatures.insert(args && args.id);
          }
          return;
        case "signatureOptions":
          this.api.emitCommand(this.tabId, "openSignatures", {});
          return;
        case "newMessage":
          this.host.newMessage();
          return;
        case "attachMessage":
          this.attachMessage().catch(e => this.fail(e, def));
          return;
        case "otherBusinessCards":
          this.otherBusinessCards().catch(e => this.fail(e, def));
          return;
        case "insertQuickPart":
          if (this.engine && this.ui.isEnabled(cmd)) {
            this.quickParts.insert(args && args.id, { plain: this.ui.state.deliveryFormat == "plaintext" });
          }
          return;
        case "saveQuickPart":
          if (this.engine && this.ui.isEnabled(cmd)) {
            this.saveQuickPart().catch(e => this.fail(e, def));
          }
          return;
        case "quickPartsOptions":
          this.api.emitCommand(this.tabId, "openQuickParts", {});
          return;
        case "dateTime":
          if (this.engine && this.ui.isEnabled(cmd)) {
            this.insertDateTime().catch(e => this.fail(e, def));
          }
          return;
        case "help":
          this.api.emitCommand(this.tabId, "openHelp", {});
          return;
        case "keyboardShortcuts":
          this.api.emitCommand(this.tabId, "openShortcuts", {});
          return;
        case "contactSupport":
          this.contactSupport().catch(e => this.fail(e, def));
          return;
        case "about":
          this.showAbout().catch(e => this.fail(e, def));
          return;
      }
      if (def.native) {
        if (def.enabled && !this.ui.isEnabled(cmd)) {
          return;
        }
        this.host.nativeCommand(def.native, def.focus);
        if (this.engine) {
          this.engine.scheduleState();
        }
        return;
      }
      if (!this.engine || !this.ui.isEnabled(cmd)) {
        return;
      }
      this.engine.run(cmd, args);
    } catch (e) {
      this.fail(e, def, cmd);
    }
  }

  /** Verificar Nomes em curso: o texto digitado está fora das caixas até acabar. */
  waitNames() {
    this.ui.flash(FaixaI18n.t("names.waitSend", "Aguarde: a faixa está verificando os nomes. Envie de novo em seguida."), 6000);
  }

  /** Texto sem Formatação, como no Outlook: pergunta antes, tira a formatação do corpo
   * (um Ctrl+Z traz de volta) e só então muda o formato de envio. */
  async toPlainText() {
    const t = FaixaI18n.t.bind(FaixaI18n);
    if (this.ui.state.deliveryFormat != "plaintext" && this.engine && this.host.isHTML()) {
      const ok = await FaixaDialogs.confirm(this.ui, {
        title: t("plain.title", "Texto sem Formatação"),
        message: t("plain.confirm", "A mensagem vai como texto sem formatação: fontes, cores, negrito e títulos saem agora do texto, e imagens e tabelas viram texto no envio. Um Ctrl+Z logo depois traz a formatação de volta. Continuar?"),
        ok: t("plain.ok", "Continuar"),
      });
      if (!ok) {
        return;
      }
      this.engine.stripFormatting();
    }
    this.api.emitCommand(this.tabId, "formatPlain", {});
  }

  /** Anexar Mensagem: a pasta aberta na janela principal, com as mensagens selecionadas lá já marcadas. */
  async attachMessage() {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const folders = this.host.mailFolders();
    if (!folders.length) {
      this.ui.flash(t("msg.noFolders", "Nenhuma pasta de e-mail encontrada neste Thunderbird."));
      return;
    }
    const sel = this.host.mailSelection();
    const ids = await FaixaDialogs.pickMessages(this.ui, {
      folders,
      folderId: sel.folderId && folders.some(f => f.id == sel.folderId) ? sel.folderId : folders[0].id,
      selected: sel.selected,
      list: (folderId, text) => this.host.listMessages(folderId, text),
    });
    if (!ids || !ids.length) {
      return;
    }
    const n = await this.host.attachMessages(ids);
    this.ui.flash(n == 1 ? t("msg.attachedOne", "1 mensagem anexada.") : t("msg.attached", "{n} mensagens anexadas.", { n }));
  }

  /** Outros Cartões de Visita: o vCard de contatos dos catálogos, como anexo. */
  async otherBusinessCards() {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const items = await FaixaDialogs.pickContacts(this.ui, {
      books: this.host.listBooks(),
      search: (text, bookId) => this.host.searchContacts(text, { bookId, quick: true }),
    });
    if (!items || !items.length) {
      return;
    }
    const n = await this.host.attachContactCards(items);
    this.ui.flash(!n
      ? t("card.none", "Não foi possível ler o cartão de visita desses contatos.")
      : n == 1
        ? t("card.attachedOne", "1 cartão de visita anexado.")
        : t("card.attached", "{n} cartões de visita anexados.", { n }));
  }

  /** Salvar Seleção na Galeria de Partes Rápidas: o nome (o começo do texto, de sugestão)
   * e, se já houver uma parte sua com esse nome, a confirmação para substituir. */
  async saveQuickPart() {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const sel = this.quickParts.selection();
    if (!sel) {
      this.ui.flash(t("qp.noSelection", "Selecione na mensagem o texto que vai virar Parte Rápida."));
      return;
    }
    if (sel.html.length > FaixaQuickParts.MAX_HTML) {
      this.ui.flash(t("qp.tooBig", "O trecho selecionado é grande demais para uma Parte Rápida (até 1 MB, com as imagens)."), 6000);
      return;
    }
    const parts = FaixaQuickParts.list(this.api.config);
    const find = name => parts.find(p => String(p.nome || "").trim().toLowerCase() == name.toLowerCase());
    const name = await FaixaDialogs.prompt(this.ui, {
      title: t("qp.saveTitle", "Criar Novo Bloco de Construção"),
      message: t("qp.saveLead", "O trecho selecionado, com a formatação, fica na galeria de Partes Rápidas (Inserir → Partes Rápidas)."),
      label: t("qp.name", "Nome"),
      value: sel.name,
      validate: v => {
        const p = find(v);
        return p && p.gerenciada ? t("qp.nameOrg", "Já existe uma Parte Rápida da sua organização com esse nome. Escolha outro.") : null;
      },
    });
    if (!name) {
      return;
    }
    const existing = find(name);
    if (existing) {
      const ok = await FaixaDialogs.confirm(this.ui, {
        title: t("qp.saveTitle", "Criar Novo Bloco de Construção"),
        message: t("qp.replace", "Já existe a Parte Rápida “{name}”. Substituir pelo trecho selecionado?", { name: existing.nome || name }),
        ok: t("qp.replaceOk", "Substituir"),
      });
      if (!ok) {
        return;
      }
    }
    this.api.emitCommand(this.tabId, "saveQuickPart", { id: existing ? existing.id : null, nome: name, html: sel.html });
    this.ui.flash(t("qp.saved", "“{name}” está na galeria de Partes Rápidas.", { name }));
  }

  /** Data e Hora: o formato escolhido, no ponto do cursor. */
  async insertDateTime() {
    const text = await FaixaDialogs.dateTime(this.ui, { locale: FaixaI18n.locale });
    if (text && this.engine && this.ui.isEnabled("dateTime")) {
      this.engine.insertText(text);
    }
  }

  /** Contatar o Suporte: o contato da política; e-mail e portal pelo background. */
  async contactSupport() {
    const s = this.api.config.suporte;
    if (!faixaHasSupport(s)) {
      return;
    }
    const r = await FaixaDialogs.support(this.ui, { suporte: s });
    if (r == "mail" || r == "portal") {
      this.api.emitCommand(this.tabId, "openSupport", { what: r });
    }
  }

  /** Sobre: versões; o botão Diagnóstico da Faixa abre a página pelo background. */
  async showAbout() {
    const info = this.host.appInfo();
    let language = FaixaI18n.locale;
    try {
      language = new Intl.DisplayNames([FaixaI18n.locale], { type: "language" }).of(FaixaI18n.locale) || language;
    } catch (e) {}
    const r = await FaixaDialogs.about(this.ui, {
      version: (this.api.extension && this.api.extension.version) || "",
      app: info.app,
      platform: info.platform,
      language,
    });
    if (r == "diagnostics") {
      this.api.emitCommand(this.tabId, "openDiagnostics", {});
    }
  }

  fail(e, def, cmd) {
    this.lastError = e;
    console.error("[Faixa] comando " + (cmd || (def && def.label) || ""), e);
    if (this.ui) {
      this.ui.flash(FaixaI18n.t("command.failed", "Não foi possível executar: {name}", { name: (def && def.label) || cmd || "?" }));
    }
  }

  onKeyDown(e) {
    FaixaShortcuts.track(this.keyState, e, true);
    // Visualização Dinâmica na tela: qualquer tecla que não seja de andar pela faixa (setas,
    // Home, End) a tira antes de agir, também as do Thunderbird (Ctrl+Enter, Ctrl+P...).
    if (this.engine && this.engine.pv && (e.ctrlKey || e.altKey || e.metaKey || !FAIXA_PREVIEW_NAV_KEYS.has(e.key))) {
      this.endPreview();
    }
    if (e.defaultPrevented || !this.ui) {
      return;
    }
    if (this.ui.dialog) {
      // Janela da faixa aberta (Selecionar Nomes...): as teclas de edição valem nas
      // caixas dela; os atalhos do Thunderbird (Ctrl+Enter envia!) e o F6 não.
      const tgt = e.target;
      const inField = !!tgt && ["input", "select"].includes(tgt.localName);
      const accel = (e.ctrlKey || e.metaKey) && !e.altKey;
      const editCombo = accel && ((inField && /^(a|c|v|x|z|y|ArrowLeft|ArrowRight|Home|End|Backspace|Delete)$/i.test(e.key)) || /^a$/i.test(e.key));
      // AltGr digita (no Gecko chega sem Ctrl e Alt); Alt+letra abriria os menus do Thunderbird.
      const altGraph = typeof e.getModifierState == "function" && e.getModifierState("AltGraph");
      if (e.key == "F6" || ((e.ctrlKey || e.metaKey || e.altKey) && !editCombo && !altGraph)) {
        if (!["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      return;
    }
    if (e.key == "F6" || (e.key == "Tab" && e.ctrlKey)) {
      this.registerFocusArea(); // antes do atalho do Thunderbird ler a lista de áreas
    }
    // Ctrl+Enter (enviar) e Ctrl+Shift+Enter (enviar depois) esperam o Verificar Nomes.
    if (this.names.busy && e.key == "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      this.waitNames();
      return;
    }
    const engine = this.engine;
    // Esc fecha um menu da faixa aberto com o mouse (o foco continuou no corpo ou no campo).
    if (e.key == "Escape" && this.ui.popup && !this.ui.popup.contains(e.target)) {
      this.ui.closePopup();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key == "Escape" && engine && engine.painterMode) {
      engine.painterStop();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.win.gWindowLocked) {
      // Envio em curso: a tecla segue para o Thunderbird, que também está travado.
      return;
    }
    // Delete numa sugestão destacada do autocompletar: tira da lista, como no Outlook.
    if (e.key == "Delete" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const suggestion = this.host.highlightedSuggestion(e);
      if (suggestion) {
        e.preventDefault();
        e.stopPropagation();
        this.removeSuggestion(suggestion);
        return;
      }
    }
    const target = e.originalTarget || e.target;
    const edDoc = this.host.editorDoc;
    const inBody = !!edDoc && !!target && (target == edDoc || target.ownerDocument == edDoc || target == this.host.editorElement);
    const inRecipients = !inBody && this.host.isRecipientInput(e.target);
    const entry = this.ui.shortcuts.match(e, { inBody, inRecipients }, this.keyState);
    if (!entry) {
      return;
    }
    const def = this.api.definition.commands[entry.cmd] || {};
    if (def.phase) {
      return;
    }
    if (entry.scope == "body" && !def.native && !(engine && this.ui.isEnabled(entry.cmd))) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.command(entry.cmd, entry.args || null, { source: "keyboard" });
  }

  /** Tira uma sugestão do autocompletar e conta ao usuário o que aconteceu. */
  removeSuggestion(suggestion) {
    let r;
    try {
      r = this.host.removeSuggestion(suggestion);
    } catch (e) {
      this.lastError = e;
      console.error("[Faixa] remover sugestão", e);
      this.ui.flash(FaixaI18n.t("suggestion.failed", "Não foi possível tirar a sugestão da lista."));
      return;
    }
    const t = FaixaI18n.t.bind(FaixaI18n);
    const vars = {
      who: r.email ? `“${r.email}”` : "",
      books: r.others.map(n => `“${n}”`).join(", "),
      collected: r.collectedName,
    };
    let text;
    if (!r.email) {
      text = t("suggestion.list", "Listas e grupos saem das sugestões pelo Catálogo de Endereços.");
    } else if (r.removed && !r.others.length) {
      text = t("suggestion.removed", "{who} saiu das sugestões.", vars);
    } else if (r.removed) {
      text = t("suggestion.removedStill", "{who} saiu dos {collected}, mas continua nas sugestões porque é um contato em {books}.", vars);
    } else if (r.others.length) {
      text = t("suggestion.contact", "{who} é um contato em {books}. Para tirar das sugestões, exclua o contato no Catálogo de Endereços.", vars);
    } else {
      text = t("suggestion.unknown", "{who} não vem de um catálogo de endereços deste Thunderbird.", vars);
    }
    this.ui.flash(text, 6000);
  }

  /* ---------- normalização no envio ----------
   * O Thunderbird dispara compose-send-message depois das perguntas (assunto,
   * anexo esquecido, ortografia) e logo antes de travar a janela e serializar o
   * corpo, sem await entre uma coisa e outra (CompleteGenericSendMessage). */

  /** compose-send-message. sending: envio de verdade (agora, depois, em segundo
   * plano). Salvar, rascunho automático e modelo gravam o que o usuário vê. */
  onSendEvent(sending, event = null) {
    // Envio, rascunho (também o automático) e modelo gravam o corpo sem nada provisório.
    this.endPreview();
    // Rede de segurança (envio por outro caminho, gravação automática): com o Verificar
    // Nomes em curso, o texto digitado ainda não voltou para os destinatários.
    if (this.names.busy && event) {
      event.preventDefault();
      if (sending) {
        this.waitNames();
      }
      return;
    }
    this.revertSend();
    if (!sending || !this.engine) {
      return;
    }
    this.engine.painterStop();
    const pending = { undo: this.engine.normalizeForSend().undo, inFlight: false };
    this.pendingSend = pending;
    // O evento é cancelável (outro complemento pode barrar o envio). Na microtarefa
    // seguinte o Thunderbird já travou a janela e leu o corpo, ou desistiu e destravou.
    // Se outro ouvinte do mesmo evento abrir uma janela modal, a microtarefa roda
    // dentro dela, com o evento ainda em despacho: aí a decisão fica para depois.
    const decide = () => {
      if (this.pendingSend !== pending) {
        return;
      }
      if (event && event.eventPhase) {
        this.win.setTimeout(decide, 0);
        return;
      }
      if (this.win.gWindowLocked) {
        pending.inFlight = true;
      } else {
        this.revertSend();
      }
    };
    Promise.resolve().then(decide);
  }

  /** Fim do envio (ComposeProcessDone). Gravações também avisam: essas não contam. */
  onSendDone(ok) {
    const pending = this.pendingSend;
    if (!pending || !pending.inFlight) {
      return;
    }
    if (ok) {
      this.pendingSend = null; // enviada: a janela vai fechar
    } else {
      this.revertSend(); // falhou: o editor volta ao que o usuário tinha, cursor incluído
    }
  }

  /** Antes de qualquer ação do usuário: sem envio em curso, nada fica normalizado. */
  revertPendingSend() {
    if (this.pendingSend && !this.win.gWindowLocked) {
      this.revertSend();
    }
  }

  revertSend() {
    const pending = this.pendingSend;
    this.pendingSend = null;
    if (pending) {
      try {
        pending.undo();
      } catch (e) {
        console.error("[Faixa] desfazer a normalização", e);
      }
    }
  }

  setMessageState(state) {
    if (state && state._pong) {
      const resolve = this.pongWaiters.get(state._pong);
      if (resolve) {
        this.pongWaiters.delete(state._pong);
        resolve();
      }
      return;
    }
    this.messageState = Object.assign({}, this.messageState, state);
    this.ui.setState(state);
  }

  applyConfig(config) {
    this.endPreview();
    this.host.setMainToolbarHidden(config.ocultarBarraThunderbird !== false);
    this.host.setMenubarHidden(faixaMenubarChoice(config));
    if (this.signatureWaiting && this.engine) {
      // A configuração chegou depois do editor pronto: a assinatura padrão entra se a
      // mensagem ainda não foi mexida.
      let untouched = false;
      try {
        untouched = !this.host.editor.documentModified;
      } catch (e) {}
      this.signatureWaiting = false;
      if (untouched) {
        this.applyDefaultSignature();
      }
    }
    this.ui.config = config;
    this.ui.shortcuts = new FaixaShortcuts(this.api.definition, config.perfilAtalhos, AppConstants.platform == "macosx");
    this.ui.setState(Object.assign({ support: faixaHasSupport(config.suporte) }, this.barsState(config)));
    if (this.engine) {
      this.engine.applyLabel = this.ui.shortcuts.labelsFor("painterApply")[0] || "";
      this.engine.applyConfig(config);
    }
  }

  /** Confirmações de entrega e de leitura e o Acompanhamento, para os botões da faixa. */
  trackingState() {
    const receipts = this.host.receiptState();
    const recipients = !!this.host.recipientFlag();
    return {
      returnReceipt: receipts.returnReceipt,
      dsn: receipts.dsn,
      followUpMe: !!this.followUpMe,
      followUpRecipients: recipients,
      followUp: !!this.followUpMe || recipients,
    };
  }

  refreshTracking() {
    if (this.ui) {
      this.ui.setState(this.trackingState());
    }
  }

  /** me: Sinalizar para Mim (a cópia enviada ganha a estrela); recipients: Sinalizar para os
   * Destinatários (X-Message-Flag, que o Outlook mostra). */
  setFollowUp({ me, recipients }) {
    if (me !== undefined) {
      this.followUpMe = !!me;
    }
    if (recipients !== undefined) {
      this.host.setRecipientFlag(recipients ? FaixaI18n.t("followUp.flagText", "Acompanhar") : "");
    }
    this.refreshTracking();
  }

  /** Cópia gravada pelo Thunderbird (onGetDraftFolderURI): de um envio com Sinalizar para Mim,
   * vai para a lista da estrela; de um rascunho, guarda o Acompanhamento. Modelos não contam.
   * A janela fecha logo depois da primeira cópia, então as outras pastas vêm dos campos da
   * mensagem: a de Opções → Enviar uma cópia para e, com Enviar mais tarde (a cópia gravada é a
   * da Saída), a da cópia enviada, calculada como o Thunderbird a escreve na mensagem da Saída. */
  onSavedCopy(messageId, folderURI) {
    const M = Ci.nsIMsgCompDeliverMode;
    if ([M.SaveAsDraft, M.AutoSaveAsDraft].includes(this.sendType)) {
      // Rascunho: o estado fica com o Message-ID desta gravação.
      this.api.draftFollowUpSaved(messageId, { me: !!this.followUpMe, recipients: !!this.host.recipientFlag() }, this.draftIds);
      this.draftIds = [messageId];
      return;
    }
    if (![M.Now, M.Later, M.Background].includes(this.sendType)) {
      return;
    }
    this.forgetDraft();
    if (this.sendFollowUp) {
      const queued = this.sendType != M.Now;
      const folders = [folderURI, this.sendExtraFolder];
      if (queued) {
        folders.push(this.host.sentCopyFolder());
      }
      this.api.followUpSent(messageId, folders.filter(Boolean), queued);
    }
  }

  /** Mensagem enviada: o Thunderbird apaga o rascunho, e o Acompanhamento guardado dele sai. */
  forgetDraft() {
    if (this.draftIds.length) {
      this.api.draftFollowUpSaved(null, null, this.draftIds);
      this.draftIds = [];
    }
  }

  /** Estado das barras do Thunderbird para o menu ⋯: o que aparece, e o que a política
   * define (esses itens ficam travados). */
  barsState(config) {
    const managed = Array.isArray(config.gerenciadas) ? config.gerenciadas : [];
    return {
      tbToolbar: config.ocultarBarraThunderbird === false,
      tbToolbarFree: !managed.includes("ocultarBarraThunderbird"),
      menubar: !this.host.menubarHidden(),
      menubarAvailable: !!this.host.menubar,
      menubarFree: !managed.includes("ocultarBarraMenus"),
    };
  }

  /** A barra de menus mudou pela opção do próprio Thunderbird (Exibir > Barras de
   * Ferramentas > Barra de Menus, ou o menu de contexto da barra). */
  onMenubarChanged(hidden) {
    const config = this.api.config;
    const choice = faixaMenubarChoice(config);
    if (choice != null && choice != hidden) {
      if (!this.barsState(config).menubarFree) {
        // Definida pela organização: volta.
        this.host.setMenubarHidden(choice);
      } else {
        // Vale como a escolha na faixa: todas as janelas, e as próximas.
        this.api.setMenubarVisible(!hidden);
        this.api.emitCommand(this.tabId, "setMenubar", { visible: !hidden });
        return;
      }
    }
    if (this.ui) {
      this.ui.setState({ menubar: !this.host.menubarHidden() });
    }
  }

  status() {
    const doc = this.win.document;
    const root = doc.getElementById("faixa-root");
    return {
      tabId: this.tabId,
      mounted: !!root,
      editorReady: !!this.engine,
      isHTML: this.host.isHTML(),
      sendButton: !!doc.getElementById("faixa-send"),
      lastError: this.lastError ? String(this.lastError) : this.engine && this.engine.lastError ? String(this.engine.lastError) : "",
    };
  }

  waitFor(pred, timeout) {
    return new Promise(resolve => {
      const t0 = Date.now();
      const tick = () => {
        let ok = false;
        try {
          ok = pred();
        } catch (e) {}
        if (ok) {
          resolve(true);
        } else if (Date.now() - t0 > timeout) {
          resolve(false);
        } else {
          this.win.setTimeout(tick, 50);
        }
      };
      tick();
    });
  }

  /** Autoteste (fases 0 e 1), rodado numa mensagem nova aberta só para isso.
   * Rótulos e detalhes no idioma da faixa (chaves test.* em ribbon/locales). */
  async selfTest() {
    const R = [];
    const T = (key, text, vars) => FaixaI18n.t("test." + key, text, vars);
    const Y = v => FaixaI18n.yes(v);
    const add = (id, label, ok, detail) => R.push({ id, label, ok: !!ok, detail: String(detail == null ? "" : detail) });
    const w = this.win;
    const doc = w.document;
    const wait = ms => new Promise(r => w.setTimeout(r, ms));
    const rect = el => (el ? el.getBoundingClientRect() : null);
    const def = this.api.definition;
    try {
      // A janela de teste na frente: sem isso, os eventos de foco (item "foco") não chegam.
      try {
        w.focus();
      } catch (e) {}
      const root = doc.getElementById("faixa-root");
      const rr = rect(root);
      add("montagem", T("montagem", "Faixa montada na janela de composição"), rr && rr.height > 60 && rr.width > 300,
        rr
          ? T("montagem.detail", "{w} × {h} px, {tabs} abas", { w: Math.round(rr.width), h: Math.round(rr.height), tabs: this.ui.tabButtons.size })
          : T("montagem.none", "não encontrada"));

      const fmt = rect(doc.getElementById("FormatToolbox"));
      const main = rect(doc.getElementById("composeToolbar2"));
      const fmtHidden = !fmt || fmt.height == 0;
      const mainHidden = !main || main.height == 0;
      const wantHidden = this.api.config.ocultarBarraThunderbird !== false;
      const shown = hidden => (hidden ? T("hidden", "oculta") : T("visible", "visível"));
      add("barras", T("barras", "Barras nativas ocultas"), fmtHidden && (mainHidden || !wantHidden),
        T("barras.detail", "formatação {fmt}; principal {main}{note}", {
          fmt: shown(fmtHidden),
          main: shown(mainHidden),
          note: wantHidden ? "" : T("barras.note", " (configurada para aparecer)"),
        }));

      // Barra de menus: como a configuração pede (ou como o Thunderbird guardou).
      const bar = this.host.menubar;
      if (!bar) {
        add("menus", T("menus", "Barra de menus como configurada"), true,
          AppConstants.platform == "macosx"
            ? T("menus.mac", "no macOS os menus ficam na barra do sistema")
            : T("menus.none", "a janela não tem barra de menus"));
      } else {
        const choice = faixaMenubarChoice(this.api.config);
        const hiddenNow = this.host.menubarHidden();
        const br = rect(bar);
        // Oculta: altura zero enquanto nenhum menu está aberto. Visível: com altura.
        const drawn = hiddenNow ? !br || br.height == 0 || bar.getAttribute("inactive") != "true" : !!br && br.height > 0;
        add("menus", T("menus", "Barra de menus como configurada"), (choice == null || choice == hiddenNow) && drawn,
          T("menus.detail", "{state}{source}", {
            state: shown(hiddenNow) + (hiddenNow ? T("menus.alt", " (Alt mostra os menus)") : ""),
            source: choice == null ? T("menus.native", "; como o Thunderbird guardou") : "",
          }));
      }

      const sr = rect(doc.getElementById("faixa-send"));
      const rc = rect(doc.getElementById("recipientsContainer"));
      add("enviar", T("enviar", "Botão Enviar ao lado dos destinatários"),
        sr && rc && sr.width >= 40 && sr.right <= rc.left + 4 && sr.bottom > rc.top && sr.top < rc.bottom,
        sr && rc
          ? T("enviar.detail", "Enviar em x={a}–{b}; destinatários a partir de x={c}", { a: Math.round(sr.left), b: Math.round(sr.right), c: Math.round(rc.left) })
          : T("enviar.none", "elemento ausente"));

      // Arquivo e barra de acesso rápido
      const fileBtn = doc.getElementById("fx-tab-file");
      const qatSave = this.ui.controls.find(c => c.cmd == "save" && c.el.closest(".fx-qat"));
      let fileItems = [];
      if (fileBtn) {
        fileBtn.click();
        await wait(20);
        fileItems = this.ui.popup ? [...this.ui.popup.querySelectorAll('[role^="menuitem"]')] : [];
        this.ui.closePopup();
      }
      const draftLabel = this.ui.meta("saveAsDraft").label;
      const hasDraft = fileItems.some(b => b.textContent.includes(draftLabel));
      add("arquivo", T("arquivo", "Menu Arquivo e Salvar na barra de acesso rápido"), fileBtn && qatSave && fileItems.length >= 5 && hasDraft,
        T("arquivo.detail", "Arquivo: {file}; {n} itens no menu, {draft}: {has}; Salvar na barra: {save}", {
          file: Y(fileBtn), n: fileItems.length, draft: draftLabel, has: Y(hasDraft), save: Y(qatSave),
        }));

      // Idioma
      const locale = FaixaI18n.locale;
      const pref = this.api.config.idioma || "auto";
      let appLocale = "";
      try {
        appLocale = Services.locale.appLocaleAsBCP47;
      } catch (e) {}
      const firstTab = def.tabs[0];
      const tabBtn = this.ui.tabButtons.get(firstTab.id);
      add("idioma", T("idioma", "Idioma da faixa"),
        !!root && root.getAttribute("lang") == locale && !!tabBtn && tabBtn.textContent == firstTab.label && locale == FaixaI18n.pick(pref, appLocale),
        T("idioma.detail", "faixa em {locale} (preferência: {pref}); Thunderbird em {app}; primeira aba: {tab}", {
          locale, pref: pref == "auto" ? T("idioma.auto", "automática") : pref, app: appLocale || "?", tab: firstTab.label,
        }));

      if (!this.engine) {
        add("editor", T("editor", "Editor HTML pronto"), false, T("editor.none", "o editor não ficou pronto"));
        return R;
      }
      const ed = this.host.editor;
      const ew = this.host.editorWin;
      const edDoc = this.host.editorDoc;
      const body = edDoc.body;
      const cs = el => ew.getComputedStyle(el);
      add("editor", T("editor", "Editor HTML pronto"), this.host.isHTML() && !!ed, this.host.isHTML() ? "HTML" : T("editor.plain", "texto sem formatação"));
      if (!this.host.isHTML()) {
        return R;
      }
      const control = pred => this.ui.controls.find(pred);
      const boldBtn = control(c => c.cmd == "bold").el;
      const copyBtn = control(c => c.cmd == "copy").el;

      // Foco: no Assunto a formatação fica desativada (como no Outlook); no corpo, volta.
      const subject = doc.getElementById("msgSubject");
      let areaH = "?";
      let boldOffH = false;
      let copyOnH = false;
      if (subject) {
        subject.focus();
        await wait(40);
        areaH = this.ui.state.focusArea;
        boldOffH = boldBtn.disabled;
        copyOnH = !copyBtn.disabled;
      }
      this.host.focusEditor();
      await wait(50);
      const areaB = this.ui.state.focusArea;
      const boldOnB = !boldBtn.disabled;
      const areaName = a => (a == "headers" ? T("area.headers", "cabeçalho") : a == "body" ? T("area.body", "corpo") : String(a));
      add("foco", T("foco", "Formatação só com o foco no corpo, como no Outlook"),
        areaH == "headers" && boldOffH && copyOnH && areaB == "body" && boldOnB,
        T("foco.detail", "no Assunto: área {a1}, Negrito desativado: {b1}, Copiar ativo: {c1}; no corpo: área {a2}, Negrito ativo: {b2}", {
          a1: areaName(areaH), b1: Y(boldOffH), c1: Y(copyOnH), a2: areaName(areaB), b2: Y(boldOnB),
        }));
      // Foco de volta no corpo antes dos itens que usam comandos do corpo pela faixa (com o
      // foco no Para, no Cc ou no Assunto, a faixa os desativa, como o Outlook).
      const toBody = async () => {
        this.host.focusEditor();
        await wait(50);
        if (this.ui.state.focusArea != "body") {
          // Sem o evento de foco (janela em segundo plano), o resto do teste segue no corpo.
          this.ui.setState({ focusArea: "body" });
        }
      };
      if (this.ui.state.focusArea != "body") {
        this.ui.setState({ focusArea: "body" });
      }

      const sel = edDoc.getSelection();
      const start = body.querySelector("p, div:not(.moz-signature)") || body;
      sel.collapse(start, 0);
      edDoc.execCommand("insertText", false, "Alfa beta gama delta épsilon zeta");
      await wait(60);
      const find = word => {
        const tw = edDoc.createTreeWalker(body, 4);
        let n;
        while ((n = tw.nextNode())) {
          const i = n.data.indexOf(word);
          if (i >= 0) {
            return { node: n, i };
          }
        }
        return null;
      };
      const selectWord = word => {
        const f = find(word);
        if (!f) {
          return false;
        }
        const r = edDoc.createRange();
        r.setStart(f.node, f.i);
        r.setEnd(f.node, f.i + word.length);
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      };
      const caretIn = (word, k) => {
        const f = find(word);
        if (f) {
          sel.collapse(f.node, f.i + k);
        }
        return !!f;
      };
      const wordEl = word => {
        const f = find(word);
        return f ? f.node.parentElement : null;
      };

      // Negrito + um Ctrl+Z
      selectWord("beta");
      let before = body.innerHTML;
      this.engine.run("bold");
      await wait(30);
      const bEl = wordEl("beta");
      const isBold = !!bEl && parseInt(cs(bEl).fontWeight, 10) >= 600;
      ed.undo();
      await wait(30);
      let restored = body.innerHTML == before;
      add("negrito", T("negrito", "Negrito pelo editor, desfeito com um único Ctrl+Z"), isBold && restored,
        T("negrito.detail", "negrito aplicado: {bold}; um desfazer restaurou o texto: {undo}", { bold: Y(isBold), undo: Y(restored) }));

      // Palavra inteira com o cursor no meio
      caretIn("gama", 2);
      before = body.innerHTML;
      this.engine.run("bold");
      await wait(30);
      const gEl = wordEl("gama");
      const gBold = !!gEl && parseInt(cs(gEl).fontWeight, 10) >= 600 && gEl.textContent == "gama";
      const caretOk = sel.isCollapsed && sel.anchorNode && sel.anchorNode.nodeType == 3 && sel.anchorNode.data == "gama" && sel.anchorOffset == 2;
      ed.undo();
      await wait(30);
      restored = body.innerHTML == before;
      add("palavra", T("palavra", "Cursor no meio da palavra: o negrito vale para a palavra inteira"), gBold && caretOk && restored,
        T("palavra.detail", "palavra inteira: {word}; cursor no mesmo lugar: {caret}; desfeito: {undo}", { word: Y(gBold), caret: Y(caretOk), undo: Y(restored) }));

      // Estado da seleção
      selectWord("delta");
      this.engine.run("bold");
      await wait(20);
      caretIn("delta", 2);
      await wait(160);
      const pressedIn = boldBtn.getAttribute("aria-pressed") == "true";
      caretIn("Alfa", 2);
      await wait(160);
      const pressedOut = boldBtn.getAttribute("aria-pressed") == "true";
      const fontValue = control(c => c.kind == "fontCombo").el.value;
      const sizeValue = control(c => c.kind == "sizeCombo").el.value;
      add("estado", T("estado", "Estado da seleção acompanha o cursor"), pressedIn && !pressedOut,
        T("estado.detail", "Negrito aceso dentro de “delta”: {in}; apagado em “Alfa”: {out}; caixas mostram {font} {size}", {
          in: Y(pressedIn), out: Y(!pressedOut), font: fontValue || "—", size: sizeValue || "—",
        }));

      // Fonte padrão
      const bcs = cs(body);
      const want = this.api.config.fontePadrao || {};
      const famOk = !want.familia || bcs.fontFamily.toLowerCase().includes(String(want.familia).toLowerCase());
      const sizeOk = !want.tamanhoPt || this.engine.pxToPt(bcs.fontSize) == want.tamanhoPt;
      add("fontePadrao", T("fontePadrao", "Fonte padrão da mensagem nova"), famOk && sizeOk,
        T("fontePadrao.detail", "{family} · {size} pt", { family: bcs.fontFamily, size: FaixaI18n.num(this.engine.pxToPt(bcs.fontSize)) }));

      // Tamanho em pt
      selectWord("épsilon");
      before = body.innerHTML;
      this.engine.run("fontSize", { value: 14 });
      await wait(30);
      const eEl = wordEl("épsilon");
      const eSize = eEl ? this.engine.pxToPt(cs(eEl).fontSize) : null;
      const noLegacy = !body.querySelector("font[size]");
      ed.undo();
      await wait(30);
      restored = body.innerHTML == before;
      add("tamanho", T("tamanho", "Tamanho em pt (14) aplicado e desfeito com um único Ctrl+Z"), eSize == 14 && noLegacy && restored,
        T("tamanho.detail", "tamanho medido: {size} pt; sem tamanho relativo: {legacy}; desfeito: {undo}", {
          size: eSize == null ? "?" : FaixaI18n.num(eSize), legacy: Y(noLegacy), undo: Y(restored),
        }));

      // Maiúsculas e Minúsculas: MAIÚSCULAS numa seleção que passa pelo negrito de "delta"
      // (o negrito e os espaços ficam como estão); Cada Palavra com o cursor na palavra.
      const nbsp = () => (body.innerHTML.match(/&nbsp;/g) || []).length;
      const g0 = find("gama");
      const e0 = find("épsilon");
      if (g0 && e0) {
        const r = edDoc.createRange();
        r.setStart(g0.node, g0.i);
        r.setEnd(e0.node, e0.i + "épsilon".length);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      before = body.innerHTML;
      const nbspBefore = nbsp();
      this.engine.run("changeCase", { mode: "upper" });
      await wait(30);
      const dEl = wordEl("DELTA");
      const upper = !!find("GAMA") && !!find("ÉPSILON") && !!dEl && parseInt(cs(dEl).fontWeight, 10) >= 600 && dEl.textContent == "DELTA";
      const spacesKept = nbsp() == nbspBefore;
      const upperSel = sel.toString();
      ed.undo();
      await wait(30);
      const upperBack = body.innerHTML == before;
      caretIn("gama", 2);
      before = body.innerHTML;
      this.engine.run("changeCase", { mode: "title" });
      await wait(30);
      const titled = !!find("Gama");
      const titleCaret = sel.isCollapsed && !!sel.anchorNode && sel.anchorNode.nodeType == 3 &&
        sel.anchorNode.data.slice(sel.anchorOffset - 2, sel.anchorOffset + 2) == "Gama";
      ed.undo();
      await wait(30);
      const titleBack = body.innerHTML == before;
      add("maiusculas", T("maiusculas", "Maiúsculas e Minúsculas; cada mudança desfeita com um Ctrl+Z"),
        upper && spacesKept && upperSel == "GAMA DELTA ÉPSILON" && upperBack && titled && titleCaret && titleBack,
        T("maiusculas.detail", "MAIÚSCULAS em “gama delta épsilon”, com negrito no meio: {upper} (seleção “{sel}”, espaços iguais: {spaces}); desfeito: {b1}; Cada Palavra com o cursor em “gama”: {title}, cursor no lugar: {caret}; desfeito: {b2}", {
          upper: Y(upper), sel: upperSel, spaces: Y(spacesKept), b1: Y(upperBack), title: Y(titled), caret: Y(titleCaret), b2: Y(titleBack),
        }));

      // Espaço antes do parágrafo: 12 pt, e o menu passa a oferecer Remover (ou o contrário).
      caretIn("Alfa", 1);
      await wait(20);
      before = body.innerHTML;
      const para = this.engine.blockOf(sel.anchorNode);
      const mtBefore = para ? parseFloat(cs(para).marginTop) : NaN;
      const had = mtBefore > 0.1;
      this.engine.run("spaceBefore");
      await wait(120);
      const mtAfter = para && para.isConnected ? parseFloat(cs(para).marginTop) : NaN;
      const toggled = had ? mtAfter < 0.1 : Math.abs(mtAfter - 16) < 0.6; // 12 pt = 16 px
      const stateOn = !!this.ui.state.spaceBefore;
      const spaceMeta = this.ui.meta("spaceBefore");
      const menuLabel = stateOn ? spaceMeta.labelOn : spaceMeta.label;
      ed.undo();
      this.engine.scheduleState(0);
      await wait(60);
      const spaceBack = body.innerHTML == before;
      add("espaco", T("espaco", "Espaço antes do parágrafo (12 pt); o menu troca Adicionar por Remover"),
        toggled && stateOn == !had && spaceBack,
        T("espaco.detail", "margem de cima: {a} → {b} px; o menu agora mostra “{label}”; desfeito: {undo}", {
          a: FaixaI18n.num(Math.round(mtBefore * 10) / 10), b: FaixaI18n.num(Math.round(mtAfter * 10) / 10), label: menuLabel, undo: Y(spaceBack),
        }));

      // Pincel (uma vez)
      selectWord("Alfa");
      this.engine.run("foreColor", { value: "#C00000" });
      this.engine.run("italic");
      this.engine.run("fontSize", { value: 16 });
      await wait(30);
      selectWord("Alfa");
      this.engine.run("painter", { mode: "toggle" });
      await wait(20);
      const armed = this.engine.painterMode == 1;
      selectWord("zeta");
      before = body.innerHTML;
      this.engine.painterMouseUp();
      await wait(40);
      const zEl = wordEl("zeta");
      const zcs = zEl ? cs(zEl) : null;
      const painted = !!zcs && zcs.color == "rgb(192, 0, 0)" && zcs.fontStyle == "italic" && this.engine.pxToPt(zcs.fontSize) == 16;
      const disarmed = this.engine.painterMode == 0;
      ed.undo();
      await wait(30);
      restored = body.innerHTML == before;
      add("pincel", T("pincel", "Pincel copia a formatação e aplica em outro trecho; um Ctrl+Z desfaz"), armed && painted && disarmed && restored,
        T("pincel.detail", "armado: {armed}; cor, itálico e 16 pt no destino: {painted}; desligou após usar: {off}; desfeito: {undo}", {
          armed: Y(armed), painted: Y(painted), off: Y(disarmed), undo: Y(restored),
        }));

      // Pincel travado e Esc
      selectWord("Alfa");
      this.engine.run("painter", { mode: "toggle" });
      this.engine.run("painter", { mode: "lock" });
      await wait(20);
      const locked = this.engine.painterMode == 2;
      const cursor = cs(body).cursor;
      selectWord("beta");
      this.engine.painterMouseUp();
      selectWord("gama");
      this.engine.painterMouseUp();
      await wait(30);
      const twoPainted = cs(wordEl("beta")).fontStyle == "italic" && cs(wordEl("gama")).fontStyle == "italic";
      this.onKeyDown(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      const stopped = this.engine.painterMode == 0;
      const ownCursor = /url\(/.test(cursor);
      add("pincelTravado", T("pincelTravado", "Pincel travado aplica várias vezes; Esc encerra"), locked && twoPainted && stopped && ownCursor,
        T("pincelTravado.detail", "travado: {locked}; aplicou duas vezes: {two}; Esc encerrou: {stopped}; cursor próprio: {cursor}", {
          locked: Y(locked), two: Y(twoPainted), stopped: Y(stopped), cursor: Y(ownCursor),
        }));

      // Enter sem espaçamento
      const last = find("zeta");
      sel.collapse(last.node, last.i + 4);
      edDoc.execCommand("insertParagraph");
      await wait(30);
      const newBlock = sel.anchorNode ? this.engine.blockOf(sel.anchorNode) : null;
      const nbcs = newBlock ? cs(newBlock) : null;
      const noSpace = !!newBlock && newBlock.localName == "p" && parseFloat(nbcs.marginTop) == 0 && parseFloat(nbcs.marginBottom) == 0;
      const tbp = this.host.tbParagraphPrefs();
      const tbNote = tbp.paragraph
        ? ""
        : T("enter.tbOff", "; formato Parágrafo do Thunderbird desligado") + (this.engine.paragraphFix ? T("enter.fixed", ", a faixa pôs o parágrafo inicial") : "");
      add("enter", T("enter", "Enter cria parágrafo sem espaçamento"), noSpace,
        (newBlock
          ? T("enter.detail", "<{tag}> com margens {top} e {bottom}", { tag: newBlock.localName, top: nbcs.marginTop, bottom: nbcs.marginBottom })
          : T("enter.none", "parágrafo não criado")) + tbNote);
      ed.undo();
      await wait(20);

      // Marcas de parágrafo
      this.engine.run("showMarks");
      await wait(20);
      const firstP = body.querySelector("p");
      const onMark = firstP ? ew.getComputedStyle(firstP, "::after").content : "";
      this.engine.run("showMarks");
      await wait(20);
      const offMark = firstP ? ew.getComputedStyle(firstP, "::after").content : "";
      const markOn = /¶/.test(onMark);
      const markOff = !/¶/.test(offMark);
      const markOut = !body.innerHTML.includes("¶");
      add("marcas", T("marcas", "Mostrar Tudo (¶) por folha de agente, fora do HTML"), markOn && markOff && markOut,
        T("marcas.detail", "marca visível: {on}; some ao desligar: {off}; fora do HTML: {out}", { on: Y(markOn), off: Y(markOff), out: Y(markOut) }));

      // Fontes instaladas
      const fonts = await this.api.listFonts();
      const inst = name => (fonts.includes(name) ? T("installed", "instalada") : T("absent", "ausente"));
      add("fontes", T("fontes", "Lista de fontes instaladas"), fonts.length > 0,
        T("fontes.detail", "{n} fontes; Calibri {calibri}; Carlito {carlito}", { n: fonts.length, calibri: inst("Calibri"), carlito: inst("Carlito") }));

      // Atalhos
      const keys = this.host.surveyKeys();
      const mac = AppConstants.platform == "macosx";
      const probe = this.ui.shortcuts.match({ key: "e", code: "KeyE", ctrlKey: !mac, altKey: false, shiftKey: false, metaKey: mac }, true);
      add("atalhos", T("atalhos", "Levantamento das teclas da janela e atalhos da faixa"), keys.length > 20 && !!probe && probe.cmd == "alignCenter",
        T("atalhos.detail", "{n} teclas definidas na janela; Ctrl+E no corpo → {cmd}", { n: keys.length, cmd: probe ? probe.cmd : T("nothing", "nada") }));

      // Evento persistente MV3 (ida e volta com o background)
      const nonce = String(Math.random()).slice(2);
      const pong = new Promise(resolve => this.pongWaiters.set(nonce, resolve));
      this.api.emitCommand(this.tabId, "_ping", { nonce });
      const gotPong = await Promise.race([pong.then(() => true), wait(5000).then(() => false)]);
      add("mv3", T("mv3", "Evento do experiment chega ao background (página de eventos MV3)"), gotPong,
        gotPong ? T("mv3.ok", "o background recebeu e respondeu") : T("mv3.none", "sem resposta em 5 s"));

      // Comando de mensagem pela API compose
      const prBtn = control(c => c.cmd == "priorityHigh").el;
      this.command("priorityHigh");
      const hi = await this.waitFor(() => this.messageState.priority == "highest", 5000);
      await wait(30);
      const lit = prBtn.getAttribute("aria-pressed") == "true";
      this.command("priorityHigh");
      const back = await this.waitFor(() => this.messageState.priority == "normal", 5000);
      add("prioridade", T("prioridade", "Alta Prioridade pela API compose, com o botão aceso"), hi && lit && back,
        T("prioridade.detail", "prioridade: {p}; botão aceso: {lit}; voltou ao normal: {back}", {
          p: hi ? "highest" : this.messageState.priority || "?", lit: Y(lit), back: Y(back),
        }));

      // Confirmações de entrega e de leitura: os botões mudam a mensagem como o menu Opções do
      // Thunderbird e acendem; o segundo clique volta como estava.
      const r0 = this.host.receiptState();
      const dsnCtl = this.ui.controls.find(c => c.cmd == "deliveryReceipt");
      const rrCtl = this.ui.controls.find(c => c.cmd == "returnReceipt");
      this.command("deliveryReceipt");
      this.command("returnReceipt");
      await wait(30);
      const r1 = this.host.receiptState();
      const pressedOf = ctl => !!ctl && ctl.el.getAttribute("aria-pressed") == "true";
      const litReceipts = pressedOf(dsnCtl) == r1.dsn && pressedOf(rrCtl) == r1.returnReceipt;
      this.command("deliveryReceipt");
      this.command("returnReceipt");
      await wait(30);
      const r2 = this.host.receiptState();
      const flipped = r1.dsn != r0.dsn && r1.returnReceipt != r0.returnReceipt;
      const receiptsBack = r2.dsn == r0.dsn && r2.returnReceipt == r0.returnReceipt;
      add("controle", T("controle", "Confirmação de Entrega e de Leitura, como no menu Opções do Thunderbird"),
        !!dsnCtl && !!rrCtl && flipped && litReceipts && receiptsBack,
        T("controle.detail", "entrega: {d0} → {d1}; leitura: {r0} → {r1}; botões acesos junto: {lit}; voltou: {back}", {
          d0: Y(r0.dsn), d1: Y(r1.dsn), r0: Y(r0.returnReceipt), r1: Y(r1.returnReceipt), lit: Y(litReceipts), back: Y(receiptsBack),
        }));

      // Acompanhamento: para mim (a estrela vem depois do envio), para os destinatários o
      // cabeçalho X-Message-Flag; Limpar Sinalizador tira os dois.
      const fuCtl = this.ui.controls.find(c => c.cmd == "followUp");
      this.command("followUp");
      await wait(30);
      const meOn = !!this.followUpMe && pressedOf(fuCtl);
      this.command("followUpRecipients");
      const flagHeader = this.host.recipientFlag();
      this.command("followUpClear");
      await wait(30);
      const fuCleared = !this.followUpMe && !this.host.recipientFlag() && !pressedOf(fuCtl);
      add("acompanhamento", T("acompanhamento", "Acompanhamento: para mim, para os destinatários e Limpar Sinalizador"),
        !!fuCtl && meOn && !!flagHeader && fuCleared,
        T("acompanhamento.detail", "para mim, com o botão aceso: {me}; X-Message-Flag: “{header}”; limpo: {clear}", {
          me: Y(meOn), header: flagHeader, clear: Y(fuCleared),
        }));

      // Verificar Nomes e Selecionar Nomes, num catálogo de endereços temporário.
      const testMails = ["zeferino.faixa@exemplo.invalid", "teste.um@exemplo.invalid", "teste.dois@exemplo.invalid"];
      let book = null;
      try {
        book = this.host.createTestBook([
          { name: "Zeferino Faixa", email: testMails[0] },
          { name: "Faixa Teste Um", email: testMails[1] },
          { name: "Faixa Teste Dois", email: testMails[2] },
        ], T("book", "Faixa de Opções — autoteste"), ["Faixa de Opções — autoteste", "Ribbon — self-test"]); // o de um teste interrompido, em qualquer idioma
        this.names.onlyBook = book.id; // sem consultar os catálogos do usuário (LDAP incluído)
        const rowOf = type => this.host.recipientRows().find(r => r.type == type);
        const to0 = rowOf("addr_to");
        const before0 = to0.pills.length;
        this.host.setPendingText(to0.input, "zeferino; faixa teste; zzfaixa-nada");
        const checking = this.names.check();
        // Dois "Faixa Teste": a janela de escolha abre, e o OK fica com o primeiro da lista.
        const chooser = await this.waitFor(() => !!this.ui.dialog, 8000);
        const choices = chooser ? this.ui.dialog.el.querySelectorAll(".fx-prow").length : 0;
        if (chooser) {
          this.ui.dialog.primary.click();
        }
        await Promise.race([checking, wait(10000)]);
        if (this.ui.dialog) {
          this.ui.dialog.close(null); // não deixa o autoteste esperando por uma janela
        }
        await checking;
        const got = rowOf("addr_to").pills.slice(before0);
        const namesOk = got.length == 3 && got[0].email == testMails[0] && !got[0].invalid && got[1].email == testMails[2] && !got[1].invalid && got[2].invalid;
        add("nomes", T("nomes", "Verificar Nomes: nome completado pelo catálogo, escolha entre parecidos, desconhecido em vermelho"), namesOk && choices == 2,
          T("nomes.detail", "pílulas: {pills}; janela de escolha com {n} nomes", { pills: got.map(p => (p.email || p.text) + (p.invalid ? " ✗" : "")).join(", ") || "—", n: choices }));

        const picking = this.names.selectNames({ text: "zeferino", target: "addr_to" });
        const dlgOpen = await this.waitFor(() => !!this.ui.dialog && !!this.ui.dialog.list, 8000);
        let listed = 0;
        if (dlgOpen) {
          const d = this.ui.dialog;
          await d.ready;
          listed = d.list.items.length;
          d.list.select(0, {});
          d.el.querySelectorAll(".fx-dtarget")[1].click(); // Cc →
          d.primary.click();
        } else if (this.ui.dialog) {
          this.ui.dialog.close(null);
        }
        const picked = await picking;
        const cc = rowOf("addr_cc");
        const ccOk = !!picked && !!cc && cc.pills.some(p => p.email == testMails[0]);
        add("catalogo", T("catalogo", "Selecionar Nomes (Catálogo de Endereços) põe o contato escolhido no Cc"), ccOk && listed == 1,
          T("catalogo.detail", "contatos na pesquisa: {n}; no Cc: {cc}", { n: listed, cc: cc ? cc.pills.map(p => p.email || p.text).join(", ") || "—" : "—" }));
      } finally {
        if (this.ui.dialog) {
          this.ui.dialog.close(null);
        }
        for (const row of this.host.recipientRows()) {
          for (const p of row.pills) {
            if (testMails.includes(p.email) || p.text == "zzfaixa-nada") {
              this.host.removePill(p.el);
            }
          }
          if (row.input && /zeferino|faixa teste|zzfaixa/i.test(row.input.value)) {
            this.host.setPendingText(row.input, "");
          }
        }
        this.names.onlyBook = null;
        if (book) {
          book.drop();
        }
      }

      // Selecionar Nomes pôs o contato no Cc: o Thunderbird mostra a linha escondida e põe o
      // foco nela (showAndFocusAddressRow). O que vem agora é no corpo.
      await toBody();

      // Assinatura: a padrão entra no lugar da do Thunderbird, sem ir para o desfazer; a do
      // menu troca a que está lá, e um Ctrl+Z volta. Configuração só deste teste.
      const sigCfg = {
        assinaturas: [
          { id: "faixa-teste-1", nome: "Teste 1", html: "<div>Faixa 1</div><div>{nome}</div>" },
          { id: "faixa-teste-2", nome: "Teste 2", html: "<div><b>Faixa 2</b></div>" },
        ],
        assinaturaPadrao: { "*": { nova: "faixa-teste-1", resposta: "faixa-teste-1" } },
        assinaturaPadraoOrg: {},
        paragrafoSemEspaco: this.api.config.paragrafoSemEspaco,
      };
      const getConfig = this.signatures.getConfig;
      this.signatures.getConfig = () => sigCfg;
      try {
        const sigsNow = () => [...body.children].filter(n => /moz-signature/i.test(n.getAttribute("class") || ""));
        ed.enableUndo(false);
        for (const old of sigsNow()) {
          ed.deleteNode(old, true);
        }
        const fake = edDoc.createElement("div");
        fake.className = "moz-signature";
        fake.append("-- ", edDoc.createElement("br"), "Thunderbird");
        ed.insertNode(fake, body, body.childNodes.length, true);
        ed.enableUndo(true);
        const identity = this.host.currentIdentity() || {};
        const r1 = this.signatures.applyDefault();
        const s1 = sigsNow();
        const text1 = s1.length ? s1[0].textContent : "";
        const lines1 = s1.length ? [...s1[0].children].map(c => c.textContent.trim()).filter(Boolean).join(" / ") : "";
        const placed = r1.done && s1.length == 1 && !text1.includes("Thunderbird") && text1.startsWith("Faixa 1") &&
          !text1.includes("{") && (!identity.name || text1.includes(identity.name));
        const silent = !ed.documentModified && !ed.canUndo;
        this.command("insertSignature", { id: "faixa-teste-2" });
        await wait(20);
        const swapped = sigsNow().length == 1 && sigsNow()[0].textContent == "Faixa 2";
        ed.undo();
        await wait(20);
        const back = sigsNow().length == 1 && sigsNow()[0].textContent.startsWith("Faixa 1");
        add("assinatura", T("assinatura", "Assinatura padrão no lugar da do Thunderbird; a do menu troca, e um Ctrl+Z volta"), placed && silent && swapped && back,
          T("assinatura.detail", "padrão: “{text}” (fora do desfazer e sem marcar a mensagem: {silent}); pelo menu: {swapped}; desfeito: {back}", {
            text: lines1, silent: Y(silent), swapped: Y(swapped), back: Y(back),
          }));
      } finally {
        this.signatures.getConfig = getConfig;
      }

      // Tabela pela grade (3 × 2) no fim do parágrafo: o cursor vai para a primeira célula;
      // Inserir Linhas Abaixo pelo comando do Thunderbird; dois Ctrl+Z desfazem.
      await toBody();
      caretIn("zeta", 4);
      before = body.innerHTML;
      const tbl = this.engine.run("insertTable", { cols: 3, rows: 2 });
      await wait(120);
      const size = t => (t && t.isConnected ? t.rows.length + "×" + (t.rows[0] ? t.rows[0].cells.length : 0) : "—");
      const size1 = size(tbl);
      const firstCell = tbl && tbl.isConnected ? tbl.querySelector("td") : null;
      const inFirst = !!firstCell && !!sel.anchorNode && (sel.anchorNode == firstCell || firstCell.contains(sel.anchorNode));
      // Embaixo da tabela, uma linha que aparece (parágrafo com <br> ou texto) para continuar escrevendo.
      const below = tbl && tbl.isConnected ? tbl.nextElementSibling : null;
      const lineBelow = !!below && below.localName == "p" && (!!below.querySelector("br") || !!below.textContent.trim());
      const cellState = !!this.ui.state.inCell;
      this.command("tableRowBelow");
      await wait(60);
      const size2 = size(tbl);
      ed.undo();
      ed.undo();
      await wait(40);
      const tableBack = body.innerHTML == before;
      add("tabela", T("tabela", "Tabela pela grade, com o cursor na primeira célula e uma linha embaixo; Inserir Linhas Abaixo; dois Ctrl+Z desfazem"),
        size1 == "2×3" && inFirst && cellState && lineBelow && size2 == "3×3" && tableBack,
        T("tabela.detail", "tabela {a} (linhas × colunas); cursor na primeira célula: {first}; linha para escrever embaixo: {below}; com a linha nova: {b}; desfeito: {undo}", {
          a: size1, first: Y(inFirst && cellState), below: Y(lineBelow), b: size2, undo: Y(tableBack),
        }));

      // Símbolo e Data e Hora no ponto do cursor, cada um num passo do desfazer.
      await toBody();
      caretIn("Alfa", 0);
      before = body.innerHTML;
      const today = FaixaDialogs.dateFormats(new Date(), FaixaI18n.locale)[0].text;
      this.command("insertSymbol", { text: "©" });
      this.engine.insertText(" " + today + " ");
      await wait(40);
      const flat = s => s.replace(/ /g, " ");
      const inserted = flat(body.textContent).includes("© " + today + " Alfa");
      ed.undo();
      ed.undo();
      await wait(30);
      const insBack = body.innerHTML == before;
      add("inserir", T("inserir", "Símbolo e Data e Hora no ponto do cursor, cada um desfeito com um Ctrl+Z"), inserted && insBack,
        T("inserir.detail", "texto “© {date}” antes de “Alfa”: {ok}; desfeito: {undo}", { date: today, ok: Y(inserted), undo: Y(insBack) }));

      // Parte Rápida com um campo: o e-mail da conta entra no lugar de {email}; um Ctrl+Z desfaz.
      const qpCfg = { partesRapidas: [{ id: "faixa-teste-qp", nome: "Teste", html: "<b>Faixa teste:</b> {email}" }] };
      const getQp = this.quickParts.getConfig;
      this.quickParts.getConfig = () => qpCfg;
      await toBody();
      try {
        const email = (this.host.currentIdentity() || {}).email || "";
        caretIn("zeta", 4);
        before = body.innerHTML;
        const listed = this.quickParts.menuList();
        this.command("insertQuickPart", { id: "faixa-teste-qp" });
        await wait(40);
        const boldPart = [...body.querySelectorAll("b")].some(b => b.textContent == "Faixa teste:");
        const filled = !!email && flat(body.textContent).includes("Faixa teste: " + email);
        ed.undo();
        await wait(30);
        const qpBack = body.innerHTML == before;
        add("partes", T("partes", "Parte Rápida no ponto do cursor, com o campo preenchido pela conta; um Ctrl+Z desfaz"),
          listed.length == 1 && listed[0].preview.startsWith("Faixa teste:") && boldPart && filled && qpBack,
          T("partes.detail", "no menu: “{preview}”; inserida com a formatação: {bold}; {email} no lugar do campo: {filled}; desfeita: {undo}", {
            preview: listed.length ? listed[0].preview : "—", bold: Y(boldPart), email: email || "?", filled: Y(filled), undo: Y(qpBack),
          }));
      } finally {
        this.quickParts.getConfig = getQp;
      }

      // Estilo de caractere Ênfase Intensa: <em> com a cor do tema, mostrado na galeria.
      await toBody();
      selectWord("beta");
      before = body.innerHTML;
      this.command("style", { value: "intenseEmphasis" });
      await wait(30);
      caretIn("beta", 2);
      await wait(160);
      const bEm = wordEl("beta");
      const emOk = !!bEm && !!bEm.closest("em") && this.engine.rgbToHex(cs(bEm).color) == "#4472C4";
      const emShown = this.ui.state.styleId == "intenseEmphasis";
      ed.undo();
      await wait(30);
      const emBack = body.innerHTML == before;
      const newStyles = ["subtitle", "subtleEmphasis", "emphasis", "intenseEmphasis", "strong"].every(id => (def.styles || []).some(s => s.id == id));
      add("estilos", T("estilos", "Estilos novos: Ênfase Intensa como no Word; a galeria mostra o estilo do texto"), newStyles && emOk && emShown && emBack,
        T("estilos.detail", "Subtítulo, Ênfase Sutil, Ênfase, Ênfase Intensa e Forte na galeria: {five}; “beta” em <em> azul: {em}; galeria acesa: {shown}; desfeito: {undo}", {
          five: Y(newStyles), em: Y(emOk), shown: Y(emShown), undo: Y(emBack),
        }));

      // Texto sem Formatação: a formatação sai do corpo inteiro num passo; um Ctrl+Z volta.
      before = body.innerHTML;
      const hadFormat = !!body.querySelector("b, i, em, font, [style]");
      this.engine.stripFormatting();
      await wait(40);
      const left = [...body.querySelectorAll("b, i, em, strong, u, font, h1, h2, h3, [style]")].filter(n => n.localName != "img");
      ed.undo();
      await wait(40);
      const plainBack = body.innerHTML == before;
      add("textoPuro", T("textoPuro", "Texto sem Formatação tira a formatação do corpo; um Ctrl+Z traz de volta"), hadFormat && !left.length && plainBack,
        T("textoPuro.detail", "formatação antes: {had}; o que sobrou: {left}; desfeito: {undo}", {
          had: Y(hadFormat), left: left.length ? left.map(n => "<" + n.localName + ">").join(" ") : T("textoPuro.none", "nada"), undo: Y(plainBack),
        }));

      // Visualização Dinâmica: fonte, cor e estilo aparecem no texto sem passar pelo
      // editor; ao sair, o corpo, a seleção e o desfazer ficam exatamente como estavam
      // (o Ctrl+Z seguinte ainda desfaz a última edição de verdade).
      {
        const beforeEdit = body.innerHTML;
        caretIn("delta", 5);
        this.engine.insertText("!");
        await wait(30);
        const withEdit = body.innerHTML;
        const mods = typeof ed.getModificationCount == "function" ? ed.getModificationCount() : -1;
        const redoBefore = !!ed.canRedo;
        selectWord("beta");
        const s0 = [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset];
        const edited = withEdit != beforeEdit;
        this.engine.preview("fontName", { value: "Courier New" });
        await wait(30);
        const bw = () => wordEl("beta");
        const fontShown = !!bw() && /courier new/i.test(cs(bw()).fontFamily);
        this.engine.preview("foreColor", { value: "#C00000" });
        await wait(30);
        const colorShown = !!bw() && this.engine.rgbToHex(cs(bw()).color) == "#C00000" && !/courier new/i.test(cs(bw()).fontFamily);
        this.engine.preview("style", { value: "h1" });
        await wait(30);
        const f = find("beta");
        const blk = f ? this.engine.blockOf(f.node) : null;
        const styleShown = !!blk && Math.round(parseFloat(cs(blk).fontSize) * 0.75) == 16 && this.engine.rgbToHex(cs(blk).color) == "#2F5496";
        this.engine.endPreview();
        await wait(30);
        const same = body.innerHTML == withEdit;
        const selSame = [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset].every((v, i) => v === s0[i]);
        const modsSame = mods < 0 || ed.getModificationCount() == mods;
        const redoSame = !!ed.canRedo == redoBefore;
        ed.undo();
        await wait(30);
        const undoOk = body.innerHTML == beforeEdit;
        add("previa", T("previa", "Visualização Dinâmica de fonte, cor e estilo, fora do desfazer"),
          edited && fontShown && colorShown && styleShown && same && selSame && modsSame && redoSame && undoOk,
          T("previa.detail", "fonte: {font}; cor: {color}; estilo: {style}; corpo igual depois: {same}; seleção igual: {sel}; desfazer intacto: {undo} (opção {on})", {
            font: Y(fontShown), color: Y(colorShown), style: Y(styleShown), same: Y(same), sel: Y(selSame), undo: Y(modsSame && redoSame && undoOk),
            on: this.api.config.visualizacaoDinamica === false ? T("previa.off", "desligada") : T("previa.on", "ligada"),
          }));
      }

      // Normalização no envio (e a volta, se o envio falhar ou for cancelado).
      // O cursor fica dentro de "Alfa", que está num <font> de 16 pt (vira <span>).
      const alfa = find("Alfa");
      if (alfa) {
        sel.collapse(alfa.node, alfa.i + 2);
      }
      before = body.innerHTML;
      const result = this.engine.normalizeForSend();
      const p0 = body.querySelector("p");
      const normOk = !!p0 && p0.style.marginTop == "0px" && p0.style.marginBottom == "0px" && !!p0.style.fontFamily;
      const sent = p0 ? p0.getAttribute("style") || T("envio.empty", "(vazio)") : T("envio.noP", "sem parágrafo");
      result.undo();
      const after = body.innerHTML;
      const reverted = after == before;
      const caretBack = !!alfa && sel.anchorNode == alfa.node && sel.anchorOffset == alfa.i + 2;
      let diff = "";
      if (!reverted) {
        let i = 0;
        while (i < before.length && before[i] == after[i]) {
          i++;
        }
        diff = T("envio.diff", " (difere em {i}: antes “{a}” / depois “{b}”)", {
          i, a: before.slice(Math.max(0, i - 40), i + 60), b: after.slice(Math.max(0, i - 40), i + 60),
        });
      }
      // Envio barrado depois do compose-send-message (janela não travou): desfaz sozinho.
      this.onSendEvent(true);
      const normalizedNow = body.innerHTML != before;
      await wait(0);
      const cancelOk = normalizedNow && body.innerHTML == before && !this.pendingSend;
      add("envio", T("envio", "Normalização no envio: margem 0 e fonte explícitas; desfeita se o envio falhar ou for cancelado"),
        normOk && reverted && caretBack && cancelOk,
        T("envio.detail", "style do primeiro parágrafo no envio: {style}; {n} ajustes; desfeito: {undo}{diff}; cursor de volta: {caret}; envio cancelado desfeito sozinho: {cancel}", {
          style: sent, n: result.changed, undo: Y(reverted), diff, caret: Y(caretBack), cancel: Y(cancelOk),
        }));

      // Desempenho: montagem da faixa (no início da janela) e leitura do estado da seleção.
      caretIn("Alfa", 2);
      const runs = 20;
      const t0 = w.performance.now();
      for (let i = 0; i < runs; i++) {
        this.engine.computeState();
      }
      const stateMs = (w.performance.now() - t0) / runs;
      const mountMs = this.mountMs || 0;
      add("desempenho", T("desempenho", "Desempenho: montagem da faixa e leitura do estado da seleção"), mountMs < 100 && stateMs < 16,
        T("desempenho.detail", "faixa montada em {mount} ms (meta: até 100); estado da seleção em {state} ms (meta: até 16)", {
          mount: FaixaI18n.num(mountMs.toFixed(1)), state: FaixaI18n.num(stateMs.toFixed(2)),
        }));
    } catch (e) {
      add("erro", T("erro", "Erro durante o autoteste"), false, String((e && e.stack) || e));
    } finally {
      this.host.markUnmodified();
    }
    return R;
  }

  dispose() {
    this.disposed = true;
    for (const d of this.disposers.splice(0)) {
      try {
        d();
      } catch (e) {}
    }
    if (this.engine) {
      try {
        this.engine.painterStop();
      } catch (e) {}
      this.engine.detach();
    }
    if (this.ui) {
      this.ui.dispose();
    }
    this.host.dispose();
  }
};

/* -------------------------------------------------------------------------
 * API
 * ----------------------------------------------------------------------- */
var faixa = class extends ExtensionAPIPersistent {
  get emitter() {
    if (!this._emitter) {
      this._emitter = new ExtensionCommon.EventEmitter();
    }
    return this._emitter;
  }

  get windows() {
    if (!this._windows) {
      this._windows = new Map();
    }
    return this._windows;
  }

  /** Eventos para o background. Enquanto ninguém escuta (início do Thunderbird,
   * antes da página de eventos subir), guarda por até 60 s e entrega depois. */
  emitCommand(tabId, command, args) {
    this.deliver("command", [tabId, command, args]);
  }

  emitReady(tabId) {
    this.deliver("compose-ready", [tabId]);
  }

  deliver(name, args) {
    const count = (this._listening && this._listening[name]) || 0;
    if (count > 0) {
      this.emitter.emit(name, ...args);
      return;
    }
    if (!this._queue) {
      this._queue = [];
    }
    this._queue.push({ name, args, at: Date.now() });
  }

  listening(name, delta) {
    if (!this._listening) {
      this._listening = {};
    }
    this._listening[name] = (this._listening[name] || 0) + delta;
    if (delta > 0 && this._queue && this._queue.length) {
      const now = Date.now();
      const due = this._queue.filter(q => q.name == name);
      this._queue = this._queue.filter(q => q.name != name);
      for (const q of due) {
        if (now - q.at < 60000) {
          Promise.resolve().then(() => this.emitter.emit(q.name, ...q.args));
        }
      }
    }
  }

  get listenerId() {
    return "faixa-ribbon-" + this.extension.id;
  }

  onStartup() {
    if (this.ready) {
      return;
    }
    this.config = Object.assign({}, FAIXA_DEFAULTS);
    this.ready = this.init();
  }

  async init() {
    try {
      for (const part of FAIXA_PARTS) {
        const url = this.extension.rootURI.resolve("experiments/faixa/" + part);
        // allowUnsafeURL: o pacote é jar:file:, e o Gecko 153 só aceita esse esquema com esta opção
        // (o próprio carregador de experiments faz o mesmo em ExtensionCommon.sys.mjs).
        Services.scriptloader.loadSubScriptWithOptions(url, { target: globalThis, ignoreCache: true, allowUnsafeURL: true });
      }
      // As traduções: uma que falte ou não leia deixa só aquele idioma em pt-BR.
      const others = FaixaI18n.LOCALES.filter(l => l != "pt-BR");
      const [definition, css, ...overlays] = await Promise.all([
        this.extension.readJSON("ribbon/definition.json"),
        faixaReadText(this.extension, "experiments/faixa/ribbon.css"),
        ...others.map(l => this.extension.readJSON("ribbon/locales/" + l + ".json").catch(e => {
          console.error("[Faixa] idioma", l, e);
          return null;
        })),
      ]);
      this.baseDefinition = definition;
      this.overlays = Object.fromEntries(others.map((l, i) => [l, overlays[i]]).filter(([, o]) => o));
      this.setLocale();
      this.css = css;
      // Mensagens enviadas com Sinalizar para Mim cuja cópia ainda não apareceu (Enviar Mais
      // Tarde, pasta IMAP ainda não sincronizada): a estrela continua esperando por elas.
      try {
        this.flagger = this.flagger || new FaixaFollowUpFlagger();
      } catch (e) {
        console.warn("[Faixa] acompanhamento", e);
      }
      ExtensionSupport.registerWindowListener(this.listenerId, {
        chromeURLs: [FAIXA_COMPOSE_URL],
        onLoadWindow: win => this.openWindow(win),
        onUnloadWindow: win => this.closeWindow(win),
      });
    } catch (e) {
      this.startError = e;
      console.error("[Faixa] falha ao iniciar", e);
    }
  }

  openWindow(win) {
    if (this.windows.has(win)) {
      return;
    }
    const controller = new FaixaComposeController(this, win);
    this.windows.set(win, controller);
    try {
      controller.start();
    } catch (e) {
      controller.lastError = e;
      console.error("[Faixa] falha ao montar a faixa", e);
    }
  }

  closeWindow(win) {
    const controller = this.windows.get(win);
    if (controller) {
      this.windows.delete(win);
      controller.dispose();
    }
  }

  onShutdown(isAppShutdown) {
    if (this.flagger) {
      this.flagger.unlisten();
    }
    if (isAppShutdown) {
      return;
    }
    try {
      ExtensionSupport.unregisterWindowListener(this.listenerId);
    } catch (e) {}
    for (const controller of this.windows.values()) {
      try {
        controller.dispose();
      } catch (e) {}
    }
    this.windows.clear();
    Services.obs.notifyObservers(null, "startupcache-invalidate");
  }

  controllerForTab(tabId) {
    const tab = this.extension.tabManager.get(tabId, null);
    return tab ? this.windows.get(tab.nativeTab) : null;
  }

  /** Idioma da faixa pela configuração (auto = o do Thunderbird). Devolve true se mudou. */
  setLocale() {
    const locale = FaixaI18n.pick(this.config.idioma, Services.locale.appLocaleAsBCP47);
    if (locale == this.locale && this.definition) {
      return false;
    }
    this.locale = locale;
    const overlay = locale == "pt-BR" ? null : this.overlays[locale] || null;
    FaixaI18n.use(locale, overlay);
    this.definition = FaixaI18n.localize(this.baseDefinition, overlay);
    return true;
  }

  applyConfig(config) {
    this.config = Object.assign({}, FAIXA_DEFAULTS, config || {});
    this.configured = true;
    const relocalized = this.baseDefinition ? this.setLocale() : false;
    for (const controller of this.windows.values()) {
      try {
        if (relocalized) {
          controller.rebuildUI();
        }
        controller.applyConfig(this.config);
      } catch (e) {
        console.error("[Faixa] configuração", e);
      }
    }
  }

  setMainToolbarVisible(visible) {
    this.applyConfig(Object.assign({}, this.config, { ocultarBarraThunderbird: !visible }));
  }

  /** Sinalizar para Mim: a estrela entra quando a cópia enviada aparecer na pasta. */
  followUpSent(messageId, folders, queued) {
    if (!this.flagger) {
      this.flagger = new FaixaFollowUpFlagger();
    }
    this.flagger.remember(messageId, folders, queued);
  }

  /** Acompanhamento dos rascunhos (guardado pelo Message-ID). */
  get draftFollowUps() {
    if (!this._draftFollowUps) {
      this._draftFollowUps = new FaixaDraftFollowUps();
    }
    return this._draftFollowUps;
  }

  draftFollowUp(messageId) {
    return this.draftFollowUps.get(messageId);
  }

  draftFollowUpSaved(messageId, state, forget) {
    this.draftFollowUps.update(messageId, state, forget);
  }

  /** Barra de menus mostrada ou oculta pela faixa: em todas as janelas de composição. */
  setMenubarVisible(visible) {
    this.applyConfig(Object.assign({}, this.config, { ocultarBarraMenus: !visible }));
  }

  /** Para a página Opções da Faixa: a barra de menus existe aqui (não no macOS) e o
   * Thunderbird a guardou oculta? */
  menubarState() {
    return AppConstants.platform == "macosx"
      ? { available: false, hidden: false }
      : { available: true, hidden: faixaNativeMenubarHidden(FAIXA_COMPOSE_URL) };
  }

  async listFonts() {
    if (!this.fontsPromise) {
      const enumerator = Cc["@mozilla.org/gfx/fontenumerator;1"].getService(Ci.nsIFontEnumerator);
      this.fontsPromise = enumerator.EnumerateAllFontsAsync().then(list => [...new Set(list)].sort((a, b) => a.localeCompare(b, "pt-BR")));
    }
    return this.fontsPromise;
  }

  /** Identidades das contas, na ordem do Thunderbird. */
  async listIdentities() {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    const out = [];
    const seen = new Set();
    for (const account of MailServices.accounts.accounts) {
      let accountName = "";
      try {
        accountName = account.incomingServer.prettyName;
      } catch (e) {}
      let defaultKey = "";
      try {
        defaultKey = account.defaultIdentity ? account.defaultIdentity.key : "";
      } catch (e) {}
      for (const id of account.identities) {
        if (!id || !id.email || seen.has(id.key)) {
          continue;
        }
        seen.add(id.key);
        const vcard = FaixaTBHost.vcardOf(id);
        out.push({
          key: id.key,
          email: id.email,
          name: id.fullName || "",
          organization: id.organization || "",
          label: id.label || "",
          accountName,
          isDefault: id.key == defaultKey,
          sigOnReply: !!id.sigOnReply,
          sigOnForward: !!id.sigOnForward,
          vcard,
          tbSignature: await faixaTBSignature(id),
        });
      }
    }
    return out;
  }

  async diagnostics() {
    let fonts = [];
    try {
      fonts = await this.listFonts();
    } catch (e) {}
    const profile = typeof FaixaShortcuts == "function" && this.definition
      ? new FaixaShortcuts(this.definition, this.config.perfilAtalhos, AppConstants.platform == "macosx")
      : { profileId: this.config.perfilAtalhos, map: new Map() };
    return {
      started: !!this.definition && !this.startError,
      startError: this.startError ? String(this.startError) : "",
      app: {
        name: Services.appinfo.name,
        version: Services.appinfo.version,
        platform: AppConstants.platform,
        locale: Services.locale.appLocaleAsBCP47,
      },
      ribbonLocale: this.locale || "",
      config: this.config,
      tbPrefs: {
        paragraph: Services.prefs.getBoolPref("mail.compose.default_to_paragraph", true),
        crNewP: Services.prefs.getBoolPref("editor.CR_creates_new_p", true),
      },
      windows: [...this.windows.values()].map(c => c.status()),
      keys: this.lastKeySurvey || null,
      profile: { id: profile.profileId, entries: [...profile.map.values()] },
      fonts: { count: fonts.length, list: fonts },
    };
  }

  PERSISTENT_EVENTS = {
    // Com o background suspenso, o contexto só existe depois de fire.wakeup().
    onCommand({ fire }) {
      const listener = async (event, tabId, command, args) => {
        if (fire.wakeup) {
          await fire.wakeup();
        }
        fire.async(tabId, command, args);
      };
      this.emitter.on("command", listener);
      this.listening("command", 1);
      return {
        unregister: () => {
          this.emitter.off("command", listener);
          this.listening("command", -1);
        },
        convert(newFire) {
          fire = newFire;
        },
      };
    },
    onComposeReady({ fire }) {
      const listener = async (event, tabId) => {
        if (fire.wakeup) {
          await fire.wakeup();
        }
        fire.async(tabId);
      };
      this.emitter.on("compose-ready", listener);
      this.listening("compose-ready", 1);
      return {
        unregister: () => {
          this.emitter.off("compose-ready", listener);
          this.listening("compose-ready", -1);
        },
        convert(newFire) {
          fire = newFire;
        },
      };
    },
  };

  getAPI(context) {
    const api = this;
    if (!api.ready) {
      api.onStartup();
    }
    const { ExtensionError } = ExtensionUtils;
    return {
      faixa: {
        async configure(config) {
          await api.ready;
          api.applyConfig(config);
          return true;
        },
        async setMessageState(tabId, state) {
          await api.ready;
          const controller = api.controllerForTab(tabId);
          if (controller) {
            controller.setMessageState(state);
          }
          return !!controller;
        },
        async getDiagnostics() {
          await api.ready;
          return api.diagnostics();
        },
        async runSelfTest(tabId) {
          await api.ready;
          const controller = api.controllerForTab(tabId);
          if (!controller) {
            throw new ExtensionError(FaixaI18n.t("error.noRibbon", "A janela de composição {id} não tem a faixa.", { id: tabId }));
          }
          if (!controller.engine) {
            await controller.waitFor(() => !!controller.engine, 8000);
          }
          return controller.selfTest();
        },
        async listFonts() {
          return api.listFonts();
        },
        async listIdentities() {
          return api.listIdentities();
        },
        async getMenubarState() {
          await api.ready; // faixaNativeMenubarHidden vem de host.js, carregado no início
          return api.menubarState();
        },
        onCommand: new ExtensionCommon.EventManager({
          context,
          module: "faixa",
          event: "onCommand",
          extensionApi: api,
        }).api(),
        onComposeReady: new ExtensionCommon.EventManager({
          context,
          module: "faixa",
          event: "onComposeReady",
          extensionApi: api,
        }).api(),
      },
    };
  }
};
