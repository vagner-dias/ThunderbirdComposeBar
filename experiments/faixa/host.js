/* Faixa de Opções — integração com a janela de composição do Thunderbird 153.
 *
 * Tudo o que depende da estrutura de messengercompose.xhtml fica aqui:
 * onde a faixa entra, como as barras nativas somem (por CSS; a de menus como
 * na opção do próprio Thunderbird; nada gravado no xulstore), o botão Enviar ao lado dos
 * destinatários, os comandos nativos, as folhas de agente do editor, o zoom
 * e o levantamento das teclas de atalho da janela. */

"use strict";

var FAIXA_AGENT_SHEET = 0; // nsIDOMWindowUtils.AGENT_SHEET

var FAIXA_MENUBAR_ID = "compose-toolbar-menubar2";
/* Acompanhamento para os destinatários (o Outlook mostra como sinalizador). */
var FAIXA_FLAG_HEADER = "x-message-flag";
/* O que o xulstore guarda para "atributo ausente" (xulStore.persist, XULPersist). */
var FAIXA_XUL_MISSING = "-moz-missing\n";

/** A barra de menus da janela de composição (url) está oculta pela opção do próprio
 * Thunderbird? Sem nada guardado vale o padrão da janela: visível. */
function faixaNativeMenubarHidden(url) {
  try {
    const store = Services.xulStore;
    return store.hasValue(url, FAIXA_MENUBAR_ID, "autohide") && store.getValue(url, FAIXA_MENUBAR_ID, "autohide") != FAIXA_XUL_MISSING;
  } catch (e) {
    return false;
  }
}

var FaixaTBHost = class {
  constructor(win) {
    this.chromeWin = win;
    this.chromeDoc = win.document;
    this.sheets = new Map();
    this.styleIds = new Set();
    this.observers = [];
    this.flash = null;
  }

  /* ---------- editor ---------- */

  get editorElement() {
    return this.chromeDoc.getElementById("messageEditor");
  }

  get editorWin() {
    return this.editorElement ? this.editorElement.contentWindow : null;
  }

  get editorDoc() {
    return this.editorElement ? this.editorElement.contentDocument : null;
  }

  get editor() {
    let ed = null;
    try {
      ed = this.chromeWin.GetCurrentEditor();
    } catch (e) {}
    if (!ed) {
      const el = this.editorElement;
      try {
        ed = el.getEditor(el.contentWindow);
      } catch (e) {}
    }
    if (ed) {
      try {
        ed.QueryInterface(Ci.nsIHTMLEditor);
      } catch (e) {}
    }
    return ed;
  }

  isHTML() {
    try {
      return !!this.chromeWin.gMsgCompose && !!this.chromeWin.gMsgCompose.composeHTML;
    } catch (e) {
      return false;
    }
  }

  isEditorReady() {
    return !!this.chromeWin.composeEditorReady;
  }

  whenEditorReady() {
    if (this.isEditorReady()) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.chromeWin.addEventListener("compose-editor-ready", () => resolve(), { once: true });
    });
  }

  /** Onde está o foco agora: o documento do corpo ou o elemento da janela. */
  focusedTarget() {
    const doc = this.chromeDoc;
    const cd = doc.commandDispatcher;
    if (cd) {
      const ew = this.editorWin;
      if (ew && cd.focusedWindow == ew) {
        return this.editorDoc;
      }
      if (cd.focusedElement) {
        return cd.focusedElement;
      }
    }
    return doc.activeElement;
  }

  focusEditor() {
    try {
      if (typeof this.chromeWin.focusMsgBody == "function") {
        this.chromeWin.focusMsgBody();
      } else {
        this.editorElement.focus();
      }
    } catch (e) {
      try {
        this.editorElement.focus();
      } catch (e2) {}
    }
  }

  /* ---------- estilos ---------- */

  injectChromeStyle(id, cssText) {
    const doc = this.chromeDoc;
    let el = doc.getElementById(id);
    if (!el) {
      el = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      el.id = id;
      (doc.head || doc.documentElement).append(el);
    }
    el.textContent = cssText;
    this.styleIds.add(id);
    return el;
  }

  setMainToolbarHidden(hidden) {
    this.injectChromeStyle("faixa-hide-main", hidden ? "#composeToolbar2 { display: none !important; }\n" : "");
  }

  /* ---------- barra de menus (Arquivo, Editar, Exibir...) ----------
   * Oculta como na opção Barra de Menus do próprio Thunderbird (Exibir > Barras de
   * Ferramentas, ou o menu de contexto da barra): atributo autohide. A tecla Alt (ou
   * F10) mostra os menus enquanto são usados; quem cuida disso é o AutoHideMenubar do
   * Thunderbird. A faixa não grava nada no xulstore: sem ela, vale o que o Thunderbird
   * guardou. No macOS os menus ficam na barra do sistema: nada a fazer. */

  get menubar() {
    return AppConstants.platform == "macosx" ? null : this.chromeDoc.getElementById(FAIXA_MENUBAR_ID);
  }

  menubarHidden() {
    const bar = this.menubar;
    return !!bar && bar.hasAttribute("autohide");
  }

  /** O que o Thunderbird guardou para a barra de menus da janela de composição. */
  nativeMenubarHidden() {
    return faixaNativeMenubarHidden(this.chromeDoc.documentURI);
  }

  /** hidden true/false: a escolha feita na faixa. null: sem escolha; se a faixa tinha
   * mudado a barra, ela volta ao que o Thunderbird guardou. */
  setMenubarHidden(hidden) {
    const bar = this.menubar;
    if (!bar) {
      return false;
    }
    if (hidden == null) {
      if (this.menubarTouched) {
        this.menubarTouched = false;
        this.applyMenubar(bar, this.nativeMenubarHidden());
      }
      return true;
    }
    this.menubarTouched = true;
    this.applyMenubar(bar, !!hidden);
    return true;
  }

  applyMenubar(bar, hide) {
    if (hide != bar.hasAttribute("autohide")) {
      if (hide) {
        bar.setAttribute("autohide", "true");
        // Como o AutoHideMenubar: a barra só encolhe quando está inativa (sem menu aberto).
        bar.setAttribute("inactive", "true");
      } else {
        bar.removeAttribute("autohide");
      }
    }
    this.menubarLast = hide;
  }

  /** fn(hidden) quando a barra muda por fora da faixa (a opção do Thunderbird). */
  observeMenubar(fn) {
    const bar = this.menubar;
    if (!bar) {
      return;
    }
    this.menubarLast = bar.hasAttribute("autohide");
    const mo = new this.chromeWin.MutationObserver(() => {
      const hidden = bar.hasAttribute("autohide");
      if (hidden != this.menubarLast) {
        this.menubarLast = hidden;
        fn(hidden);
      }
    });
    mo.observe(bar, { attributes: true, attributeFilter: ["autohide"] });
    this.observers.push(mo);
  }

  /** Complemento desligado com a janela aberta: a barra volta ao que o Thunderbird guardou. */
  restoreMenubar() {
    const bar = this.menubar;
    if (bar && this.menubarTouched) {
      this.menubarTouched = false;
      this.applyMenubar(bar, this.nativeMenubarHidden());
    }
  }

  /* ---------- confirmações de entrega e de leitura ----------
   * As mesmas do menu Opções do Thunderbird (Confirmação de Leitura e Notificação de
   * Status de Entrega): os campos da mensagem e as marcas desses itens de menu. */

  get compFields() {
    try {
      return this.chromeWin.gMsgCompose ? this.chromeWin.gMsgCompose.compFields : null;
    } catch (e) {
      return null;
    }
  }

  /** returnReceipt: Disposition-Notification-To (leitura); dsn: aviso do servidor (entrega). */
  receiptState() {
    const f = this.compFields;
    return { returnReceipt: !!(f && f.returnReceipt), dsn: !!(f && f.DSN) };
  }

  /** Como Opções → Confirmação de Leitura: vale como escolha do usuário (trocar a conta no
   * De: não desfaz). Com a janela travada no envio, o comando do Thunderbird não faz nada. */
  toggleReturnReceipt() {
    this.chromeWin.goDoCommand("cmd_toggleReturnReceipt");
  }

  /** Como Opções → Notificação de Status de Entrega. */
  toggleDSN() {
    const item = this.chromeDoc.getElementById("dsnMenu");
    if (item && this.compFields && !this.chromeWin.gWindowLocked) {
      this.chromeWin.ToggleDSN(item);
    }
  }

  /** fn(estado) quando as confirmações mudam por qualquer caminho: menu Opções, troca de
   * conta no De: (o Thunderbird aplica o padrão da conta) ou a API compose. */
  observeReceipts(fn) {
    const items = ["returnReceiptMenu", "dsnMenu"].map(id => this.chromeDoc.getElementById(id)).filter(Boolean);
    if (!items.length) {
      return;
    }
    const mo = new this.chromeWin.MutationObserver(() => fn(this.receiptState()));
    for (const el of items) {
      mo.observe(el, { attributes: true, attributeFilter: ["checked"] });
    }
    this.observers.push(mo);
  }

  /* ---------- Acompanhamento ---------- */

  /** Sinalizar para os destinatários: X-Message-Flag, o cabeçalho que o Outlook mostra como
   * sinalizador de acompanhamento na mensagem recebida. "" quando não há. */
  recipientFlag() {
    const f = this.compFields;
    try {
      return f ? String(f.getHeader(FAIXA_FLAG_HEADER) || "") : "";
    } catch (e) {
      return "";
    }
  }

  setRecipientFlag(text) {
    const f = this.compFields;
    if (!f) {
      return;
    }
    if (text) {
      f.setHeader(FAIXA_FLAG_HEADER, text);
    } else {
      f.deleteHeader(FAIXA_FLAG_HEADER);
    }
  }

  /** Message-ID da mensagem, sem < >: o do rascunho aberto (o Thunderbird o mantém), vazio
   * numa mensagem nova, numa resposta ou em "editar como nova". */
  messageId() {
    const f = this.compFields;
    return f ? String(f.messageId || "").replace(/^<|>$/g, "") : "";
  }

  /** Pasta da cópia enviada, calculada como no envio do Thunderbird (MsgUtils.getFcc): a
   * escolhida no menu, a da mensagem respondida (se a conta pede) ou Enviados. Com Enviar Mais
   * Tarde é a que vai na mensagem da Saída. "" sem cópia; null quando não dá para saber. */
  sentCopyFolder() {
    const w = this.chromeWin;
    let identity = null;
    try {
      const compose = w.gMsgCompose;
      identity = w.gCurrentIdentity || compose.identity;
      const { MsgUtils } = ChromeUtils.importESModule("resource:///modules/MimeMessageUtils.sys.mjs");
      return String(MsgUtils.getFcc(identity, compose.compFields, compose.originalMsgURI, compose.type) || "");
    } catch (e) {
      console.warn("[Faixa] acompanhamento: pasta da cópia", e);
    }
    try {
      // Sem o MsgUtils: a pasta de cópias da conta.
      return identity && identity.doFcc ? String(identity.fccFolderURI || "") : "";
    } catch (e) {
      return null;
    }
  }

  /** Opções → Enviar uma cópia para: a pasta da cópia adicional desta mensagem, ou "". */
  extraCopyFolder() {
    const f = this.compFields;
    const uri = f ? String(f.fcc2 || "") : "";
    return /^nocopy:/i.test(uri) ? "" : uri;
  }

  /** fn(messageId, folderURI) para cada cópia que o Thunderbird grava de um envio ou de uma
   * gravação desta janela (Enviados, a cópia extra, a Saída com Enviar Mais Tarde, Rascunhos):
   * o onGetDraftFolderURI do envio, o mesmo que a API compose usa. Devolve a remoção. */
  onSavedCopy(fn) {
    const compose = this.chromeWin.gMsgCompose;
    if (!compose || typeof compose.addMsgSendListener != "function") {
      return () => {};
    }
    const listener = {
      QueryInterface: ChromeUtils.generateQI(["nsIMsgSendListener"]),
      onStartSending() {},
      onProgress() {},
      onStatus() {},
      onStopSending() {},
      onGetDraftFolderURI(msgID, folderURI) {
        try {
          fn(String(msgID || "").replace(/^<|>$/g, ""), String(folderURI || ""));
        } catch (e) {
          console.error("[Faixa] acompanhamento", e);
        }
      },
      onSendNotPerformed() {},
      onTransportSecurityError() {},
    };
    compose.addMsgSendListener(listener);
    return () => {
      try {
        compose.removeMsgSendListener(listener);
      } catch (e) {}
    };
  }

  /** Folha de agente no editor: afeta só a exibição, nunca o HTML enviado. */
  loadAgentSheet(id, css) {
    if (this.sheets.has(id)) {
      return;
    }
    const uri = "data:text/css;charset=utf-8," + encodeURIComponent("/* faixa: " + id + " */\n" + css);
    this.editorWin.windowUtils.loadSheetUsingURIString(uri, FAIXA_AGENT_SHEET);
    this.sheets.set(id, uri);
  }

  removeAgentSheet(id) {
    const uri = this.sheets.get(id);
    if (!uri) {
      return;
    }
    this.sheets.delete(id);
    try {
      this.editorWin.windowUtils.removeSheetUsingURIString(uri, FAIXA_AGENT_SHEET);
    } catch (e) {}
  }

  /* ---------- montagem ---------- */

  mountRibbon(root) {
    const box = this.chromeDoc.getElementById("composeContentBox");
    if (box) {
      box.before(root);
      return true;
    }
    const toolbox = this.chromeDoc.getElementById("compose-toolbox");
    if (toolbox) {
      toolbox.after(root);
      return true;
    }
    return false;
  }

  mountSendButton(button) {
    const headers = this.chromeDoc.getElementById("MsgHeadersToolbar");
    if (!headers) {
      return false;
    }
    // No começo da ordem de Tab (antes do De:). No fim, o Tab do Assunto cairia
    // no botão e o próximo Espaço enviaria a mensagem. A posição na tela vem do CSS.
    headers.prepend(button);
    return true;
  }

  sendEnabled() {
    const cmd = this.chromeDoc.getElementById("cmd_sendButton");
    return !cmd || !cmd.hasAttribute("disabled");
  }

  observeSendEnabled(fn) {
    const cmd = this.chromeDoc.getElementById("cmd_sendButton");
    if (!cmd) {
      return;
    }
    const mo = new this.chromeWin.MutationObserver(() => fn(this.sendEnabled()));
    mo.observe(cmd, { attributes: true, attributeFilter: ["disabled"] });
    this.observers.push(mo);
  }

  /* ---------- comandos nativos ---------- */

  send() {
    this.chromeWin.goDoCommand("cmd_sendButton");
  }

  /**
   * Executa um comando do Thunderbird.
   * focus "editor": comandos do editor (link, imagem, localizar...) vão direto
   * aos controladores do corpo da mensagem, com o foco no corpo. Os demais
   * seguem o elemento com foco, como na barra nativa (colar no Assunto cola no Assunto).
   */
  nativeCommand(cmd, focus) {
    if (focus == "editor") {
      this.focusEditor();
      const ew = this.editorWin;
      let ctrl = null;
      try {
        ctrl = ew.controllers.getControllerForCommand(cmd);
      } catch (e) {}
      if (ctrl) {
        if (ctrl.isCommandEnabled(cmd)) {
          ctrl.doCommand(cmd);
          return true;
        }
        return false;
      }
    }
    this.chromeWin.goDoCommand(cmd);
    return true;
  }

  /** Área de Transferência para Mesclar Formatação: { html, text }. O HTML vem como o editor
   * do Gecko o lê ao colar (HTMLEditor::InsertFromTransferableAtSelection): o CF_HTML do
   * Windows (só o trecho entre StartFragment e EndFragment) ou o text/html dos outros
   * sistemas. Sem HTML, o texto. */
  readClipboard() {
    const out = { html: "", text: "" };
    const win = this.chromeWin;
    // Como o Firefox lê a Área de Transferência: com o contexto da janela que pede.
    let loadContext = null;
    let windowContext = null;
    try {
      loadContext = win.docShell.QueryInterface(Ci.nsILoadContext);
      windowContext = win.browsingContext.currentWindowContext;
    } catch (e) {}
    const read = flavors => {
      const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
      trans.init(loadContext);
      for (const f of flavors) {
        trans.addDataFlavor(f);
      }
      Services.clipboard.getData(trans, Ci.nsIClipboard.kGlobalClipboard, windowContext);
      const flavor = {};
      const data = {};
      trans.getAnyTransferData(flavor, data);
      return { flavor: flavor.value, data: data.value };
    };
    const asString = d => {
      for (const iface of [Ci.nsISupportsString, Ci.nsISupportsCString]) {
        try {
          return { text: d.QueryInterface(iface).data, bytes: iface == Ci.nsISupportsCString };
        } catch (e) {}
      }
      return { text: "", bytes: false };
    };
    const utf8 = s => new win.TextDecoder("utf-8").decode(Uint8Array.from(s, c => c.charCodeAt(0) & 0xff));
    try {
      const { flavor, data } = read(["application/x-moz-nativehtml", "text/html"]);
      const got = asString(data);
      let html = got.text;
      if (flavor == "application/x-moz-nativehtml") {
        // CF_HTML: UTF-8, com os deslocamentos (em bytes) do trecho copiado no cabeçalho.
        const num = name => {
          const m = html.match(new RegExp(name + ":(-?\\d+)"));
          return m ? parseInt(m[1], 10) : -1;
        };
        const start = num("StartFragment");
        const end = num("EndFragment");
        html = utf8(start >= 0 && end > start ? html.slice(start, end) : html);
      } else if (got.bytes) {
        html = utf8(html);
      }
      out.html = html;
    } catch (e) {
      // Nada em HTML na Área de Transferência.
    }
    if (!out.html) {
      try {
        out.text = asString(read(["text/plain"]).data).text;
      } catch (e) {}
    }
    return out;
  }

  /** O comando do corpo da mensagem está disponível agora? Pergunta ao controlador do
   * editor, como o menu Tabela do Thunderbird (Mesclar Células precisa de uma célula à
   * direita ou de várias selecionadas; Dividir, de uma célula mesclada). */
  nativeEnabled(cmd) {
    try {
      const ctrl = this.editorWin.controllers.getControllerForCommand(cmd);
      return !!ctrl && !!ctrl.isCommandEnabled(cmd);
    } catch (e) {
      return false;
    }
  }

  toggleContacts() {
    this.chromeWin.toggleContactsSidebar();
  }

  newMessage() {
    this.chromeWin.goOpenNewMessage(null);
  }

  getZoom() {
    try {
      const w = this.chromeWin;
      return w.ZoomManager.getZoomForBrowser(w.getBrowser());
    } catch (e) {
      return 1;
    }
  }

  setZoom(value) {
    const w = this.chromeWin;
    w.ZoomManager.setZoomForBrowser(w.getBrowser(), value);
  }

  /** compose-send-message: fn(tipo, envio). envio = agora, depois ou em segundo
   * plano; falso para salvar, rascunho automático e modelo. */
  onSend(fn) {
    const modes = [Ci.nsIMsgCompDeliverMode.Now, Ci.nsIMsgCompDeliverMode.Later, Ci.nsIMsgCompDeliverMode.Background];
    const handler = event => {
      const type = event.detail && event.detail.msgType;
      try {
        fn(type, modes.includes(type), event);
      } catch (e) {
        console.error("[Faixa] normalização no envio falhou", e);
      }
    };
    this.chromeWin.addEventListener("compose-send-message", handler);
    return () => this.chromeWin.removeEventListener("compose-send-message", handler);
  }

  /** fn() quando a mensagem foi enviada (ou foi para a Saída) com sucesso: o "aftersend" do
   * GenericSendMessage, logo antes de a janela fechar. */
  onAfterSend(fn) {
    const handler = () => {
      try {
        fn();
      } catch (e) {
        console.error("[Faixa] depois do envio", e);
      }
    };
    this.chromeWin.addEventListener("aftersend", handler);
    return () => this.chromeWin.removeEventListener("aftersend", handler);
  }

  /** Fim do processo de envio/gravação (nsIMsgComposeStateListener.ComposeProcessDone). */
  onComposeProcessDone(fn) {
    const compose = this.chromeWin.gMsgCompose;
    if (!compose || typeof compose.RegisterStateListener != "function") {
      return () => {};
    }
    const listener = {
      QueryInterface: ChromeUtils.generateQI(["nsIMsgComposeStateListener"]),
      NotifyComposeFieldsReady() {},
      NotifyComposeBodyReady() {},
      SaveInFolderDone() {},
      ComposeProcessDone(result) {
        fn(!(result & 0x80000000));
      },
    };
    compose.RegisterStateListener(listener);
    return () => {
      try {
        compose.UnregisterStateListener(listener);
      } catch (e) {}
    };
  }

  /** Tipo da composição: "new", "reply", "forward" ou "other" (rascunho, modelo,
   * editar como nova, redirecionar), cujo corpo vem pronto e fica como está. */
  composeKind() {
    const T = Ci.nsIMsgCompType;
    const t = this.chromeWin.gComposeType;
    if ([T.New, T.NewsPost, T.MailToUrl, T.ForwardAsAttachment].includes(t)) {
      return "new";
    }
    if ([T.Reply, T.ReplyAll, T.ReplyToSender, T.ReplyToGroup, T.ReplyToSenderAndGroup, T.ReplyWithTemplate, T.ReplyToList].includes(t)) {
      return "reply";
    }
    return t == T.ForwardInline ? "forward" : "other";
  }

  /** Para a assinatura: "new", "reply", "forward" (também o encaminhar como anexo, que
   * no Outlook leva a assinatura de respostas e encaminhamentos) ou "other" (rascunho,
   * modelo, editar como nova, responder com modelo, redirecionar), que fica como veio.
   * reply: vale a assinatura de respostas; num rascunho, se ele responde a alguma mensagem. */
  signatureContext() {
    const T = Ci.nsIMsgCompType;
    const t = this.chromeWin.gComposeType;
    if ([T.New, T.NewsPost, T.MailToUrl].includes(t)) {
      return { kind: "new", reply: false };
    }
    if ([T.Reply, T.ReplyAll, T.ReplyToSender, T.ReplyToGroup, T.ReplyToSenderAndGroup, T.ReplyToList].includes(t)) {
      return { kind: "reply", reply: true };
    }
    if ([T.ForwardInline, T.ForwardAsAttachment].includes(t)) {
      return { kind: "forward", reply: true };
    }
    let refs = "";
    try {
      refs = this.chromeWin.gMsgCompose.compFields.references || "";
    } catch (e) {}
    return { kind: "other", reply: !!String(refs).trim() };
  }

  /** Cartão de visita (vCard) da identidade, em texto. O Thunderbird guarda escapado
   * (encodeURIComponent; perfis antigos, com escape()). */
  static vcardOf(identity) {
    const raw = (identity && identity.escapedVCard) || "";
    if (!raw) {
      return "";
    }
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      try {
        return unescape(raw);
      } catch (e2) {
        return "";
      }
    }
  }

  /** A conta responde acima da citação? (reply_on_top: 0 embaixo, 1 em cima, 2 em cima com a citação selecionada) */
  replyOnTop() {
    try {
      const id = this.chromeWin.gCurrentIdentity;
      return id ? id.replyOnTop != 0 : null;
    } catch (e) {
      return null;
    }
  }

  /** Identidade escolhida no De: { key, email, name, organization, vcard }. */
  currentIdentity() {
    const id = this.chromeWin.gCurrentIdentity;
    if (!id) {
      return null;
    }
    return { key: id.key, email: id.email || "", name: id.fullName || "", organization: id.organization || "", vcard: FaixaTBHost.vcardOf(id) };
  }

  /** Troca de conta no De: (LoadIdentity avisa com compose-from-changed, depois de trocar
   * a assinatura do Thunderbird e ainda com o desfazer desligado). */
  onIdentityChanged(fn) {
    const handler = () => {
      try {
        fn();
      } catch (e) {
        console.error("[Faixa] assinatura na troca de conta", e);
      }
    };
    this.chromeWin.addEventListener("compose-from-changed", handler);
    return () => this.chromeWin.removeEventListener("compose-from-changed", handler);
  }

  /** Assinatura com imagem de fora (http): o conteúdo remoto fica liberado nesta
   * mensagem, como o Thunderbird faz quando o usuário cola ou arrasta uma imagem. A
   * carga da imagem começa depois (numa microtarefa) e só passa com a liberação ligada;
   * o que já estava na citação foi decidido antes e continua bloqueado. */
  allowRemoteContent() {
    try {
      this.chromeWin.gMsgCompose.allowRemoteContent = true;
    } catch (e) {}
  }

  /** Preferências do Thunderbird para Enter: formato parágrafo (Configurações →
   * Redação) e Enter dentro do parágrafo criando outro. */
  tbParagraphPrefs() {
    const get = (name, dflt) => {
      try {
        return Services.prefs.getBoolPref(name, dflt);
      } catch (e) {
        return dflt;
      }
    };
    return { paragraph: get("mail.compose.default_to_paragraph", true), crNewP: get("editor.CR_creates_new_p", true) };
  }

  /* ---------- anexos ---------- */

  /** Estado do menu Anexar Arquivo, com as mesmas regras do menu do Thunderbird:
   * cartão de visita só se a identidade tem um; chave OpenPGP só com OpenPGP
   * configurado; Filelink só ligado, com conta e com o Thunderbird conectado. */
  attachState() {
    const w = this.chromeWin;
    let cloudAccounts = [];
    try {
      const cfa = w.cloudFileAccounts;
      const on = Services.prefs.getBoolPref("mail.cloud_files.enabled", true) && !Services.io.offline;
      cloudAccounts = on ? cfa.configuredAccounts.map(a => ({ id: a.accountKey, name: cfa.getDisplayName(a) })) : [];
    } catch (e) {}
    let pgp = false;
    try {
      pgp = typeof w.isPgpConfigured == "function" && !!w.isPgpConfigured();
    } catch (e) {}
    let vcardAvailable = false;
    try {
      vcardAvailable = !!(w.gCurrentIdentity && w.gCurrentIdentity.escapedVCard);
    } catch (e) {}
    return {
      attachVCard: !!(w.gMsgCompose && w.gMsgCompose.compFields && w.gMsgCompose.compFields.attachVCard),
      vcardAvailable,
      attachPublicKey: !!w.gAttachMyPublicPGPKey,
      pgp,
      cloudAccounts,
    };
  }

  /** Liga/desliga "Meu Cartão de Visita" e "Minha Chave Pública OpenPGP", pelas funções
   * do próprio Thunderbird (elas marcam o comando, que o menu Anexar dele também mostra).
   * O goUpdateCommand antes acerta a marca do comando: a da chave OpenPGP pode ter
   * ficado para trás (o Thunderbird só a atualiza quando o menu dele abre). */
  toggleAttachOption(cmd) {
    const w = this.chromeWin;
    const id = cmd == "attachVCard" ? "cmd_attachVCard" : "cmd_attachPublicKey";
    try {
      w.goUpdateCommand(id);
    } catch (e) {}
    const el = this.chromeDoc.getElementById(id);
    if (cmd == "attachVCard") {
      w.ToggleAttachVCard(el);
    } else {
      w.toggleAttachMyPublicKey(el);
    }
  }

  /** Anexar pelo Filelink na conta escolhida (abre o seletor de arquivos). */
  attachToCloud(accountKey) {
    const w = this.chromeWin;
    const account = w.cloudFileAccounts.getAccount(accountKey);
    if (account) {
      // Como o attachToCloud() do Thunderbird: o bloco do Filelink tem imagens remotas.
      w.gMsgCompose.allowRemoteContent = true;
      w.attachToCloudNew(account);
    }
  }

  /* ---------- destinatários e catálogos de endereços ---------- */

  /** Linhas de destinatário com e-mail: Para, Cc, Cco e Responder a (sem grupos de notícias). */
  recipientRows() {
    const types = ["addr_to", "addr_cc", "addr_bcc", "addr_reply"];
    return [...this.chromeDoc.querySelectorAll(".address-row[data-recipienttype]")]
      .filter(row => types.includes(row.dataset.recipienttype))
      .map(row => {
        const label = row.querySelector(".address-label-container > label");
        return {
          el: row,
          type: row.dataset.recipienttype,
          label: (label && (label.value || label.textContent)) || row.dataset.recipienttype,
          visible: !row.classList.contains("hidden"),
          input: row.querySelector(".address-row-input"),
          pills: [...row.querySelectorAll("mail-address-pill")].map(p => ({
            el: p,
            text: p.fullAddress || p.label || "",
            email: p.emailAddress || "",
            name: p.displayName || "",
            invalid: p.classList.contains("invalid-address"),
            isList: !!p.isMailList,
          })),
        };
      });
  }

  /** O elemento é a caixa de digitação de uma linha de destinatário (Para, Cc...)? */
  isRecipientInput(el) {
    if (!el || el.localName != "input" || !el.closest) {
      return false;
    }
    const row = el.closest(".address-row[data-recipienttype]");
    return !!row && ["addr_to", "addr_cc", "addr_bcc", "addr_reply"].includes(row.dataset.recipienttype);
  }

  /** "Nome <e-mail>, outro" → [{ name, email, text }], como o Thunderbird lê o campo. */
  parseAddresses(text) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    return MailServices.headerParser.makeFromDisplayAddress(text).map(a => ({ name: a.name || "", email: a.email || "", text: a.toString() }));
  }

  makeAddress(name, email) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    return MailServices.headerParser.makeMailboxObject(name || "", email || "").toString();
  }

  isListName(name) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    try {
      return !!name && MailServices.ab.mailListNameExists(name);
    } catch (e) {
      return false;
    }
  }

  /** Pílulas novas no fim da linha, pelo Thunderbird (mostra a linha se estiver escondida). */
  addRecipients(type, addresses) {
    const row = this.chromeDoc.querySelector(`.address-row[data-recipienttype="${type}"]`);
    if (row && addresses.length) {
      this.chromeWin.addressRowAddRecipientsArray(row, addresses);
    }
  }

  /** Troca uma pílula por outra com o endereço resolvido, no mesmo lugar da linha. */
  replacePill(pillEl, address) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    const row = pillEl.closest(".address-row");
    const input = row.querySelector(".address-row-input");
    const area = this.chromeDoc.getElementById("recipientsContainer");
    const [addr] = MailServices.headerParser.makeFromDisplayAddress(address);
    if (!addr) {
      return;
    }
    const pill = area.createRecipientPill(input, addr);
    pillEl.before(pill);
    pillEl.remove();
    row.querySelector(".address-container").classList.add("addressing-field-edited");
    try {
      this.chromeWin.updateAriaLabelsOfAddressRow(row);
      this.chromeWin.onRecipientsChanged();
    } catch (e) {}
  }

  removePill(pillEl) {
    const row = pillEl.closest(".address-row");
    pillEl.remove();
    try {
      this.chromeWin.updateAriaLabelsOfAddressRow(row);
      this.chromeWin.onRecipientsChanged();
    } catch (e) {}
  }

  setPendingText(input, text) {
    input.value = text;
    input.setAttribute("size", Math.max(1, text.length));
  }

  /** Tira da caixa o que o usuário digitou e devolve esse texto. Sem o complemento que
   * o autocompletar mostra selecionado nem o " >> sugestão"; as sugestões somem. Assim,
   * quando uma janela da faixa tira o foco da caixa, o Thunderbird não transforma a
   * sugestão dele (ou o texto) em destinatário por conta própria. */
  takeTyped(input) {
    if (!input) {
      return "";
    }
    let text = input.value || "";
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (typeof start == "number" && start > 0 && start < end && end == text.length) {
      text = text.slice(0, start); // complemento automático, ainda selecionado (tudo selecionado não é complemento)
    }
    const i = text.indexOf(" >> ");
    if (i >= 0) {
      text = text.slice(0, i);
    }
    input.value = "";
    input.setAttribute("size", 1);
    try {
      const ctrl = input.controller;
      if (ctrl && this.chromeDoc.activeElement == input) {
        ctrl.stopSearch();
        ctrl.resetInternalState(); // sem sugestões, o blur não completa nada
      }
    } catch (e) {}
    try {
      if (input.popupOpen) {
        input.closePopup();
      }
    } catch (e) {}
    return text.trim();
  }

  /** Catálogos de endereços: os locais (e CardDAV) listam tudo; LDAP só por busca. */
  listBooks() {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    return MailServices.ab.directories.map(d => ({
      id: d.UID,
      name: d.dirName,
      remote: !!d.isRemote || d.dirType == Ci.nsIAbManager.ASYNC_DIRECTORY_TYPE,
      collected: d.dirPrefId == "ldap_2.servers.history",
    }));
  }

  /** Contatos que casam com o texto (vazio: todos os dos catálogos locais), com a mesma
   * busca do autocompletar do Thunderbird (quick: a busca mais ampla do Catálogo de
   * Endereços, que inclui empresa e cargo). LDAP responde em até 5 s. */
  async searchContacts(text, { bookId = null, quick = false, limit = 500 } = {}) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    const { getSearchTokens, getModelQuery, generateQueryURI } = ChromeUtils.importESModule("resource:///modules/ABQueryUtils.sys.mjs");
    const words = getSearchTokens(text || "");
    const model = getModelQuery(quick ? "mail.addr_book.quicksearchquery.format" : "mail.addr_book.autocompletequery.format");
    const query = words.length ? generateQueryURI(model, words).replace(/^\?/, "") : "";
    const out = [];
    const seen = new Set();
    const push = (dir, card) => {
      if (out.length >= limit) {
        return;
      }
      const book = { bookId: dir.UID, book: dir.dirName, collected: dir.dirPrefId == "ldap_2.servers.history" };
      if (card.isMailList) {
        let desc = "";
        try {
          desc = MailServices.ab.getDirectory(card.mailListURI).description;
        } catch (e) {}
        const key = "list:" + card.displayName.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(Object.assign({ name: card.displayName, email: "", isList: true, address: this.makeAddress(card.displayName, desc || card.displayName) }, book));
        }
        return;
      }
      const name = card.displayName || [card.firstName, card.lastName].filter(Boolean).join(" ");
      let cardId = "";
      try {
        cardId = card.UID;
      } catch (e) {}
      for (const email of card.emailAddresses || []) {
        const key = dir.UID + "|" + email.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          const item = Object.assign({ name, email, isList: false, address: this.makeAddress(name, email), cardId }, book);
          // O próprio cartão, para Outros Cartões de Visita (fica fora de cópias e do JSON).
          Object.defineProperty(item, "card", { value: card });
          out.push(item);
        }
      }
    };
    const dirs = MailServices.ab.directories.filter(d => !bookId || d.UID == bookId);
    await Promise.all(dirs.map(dir => new Promise(resolve => {
      const remote = !!dir.isRemote || dir.dirType == Ci.nsIAbManager.ASYNC_DIRECTORY_TYPE;
      if (remote && !words.length) {
        resolve();
        return;
      }
      if (!query) {
        try {
          for (const card of dir.childCards) {
            push(dir, card);
          }
        } catch (e) {}
        resolve();
        return;
      }
      const timer = this.chromeWin.setTimeout(resolve, 5000);
      const listener = {
        onSearchFoundCard: card => push(dir, card),
        onSearchFinished: () => {
          this.chromeWin.clearTimeout(timer);
          resolve();
        },
      };
      try {
        if (dir.dirType == Ci.nsIAbManager.ASYNC_DIRECTORY_TYPE) {
          dir.search(null, text, listener);
        } else {
          dir.search(query, text, listener);
        }
      } catch (e) {
        this.chromeWin.clearTimeout(timer);
        resolve();
      }
    })));
    return out;
  }

  /** Catálogo de endereços temporário do autoteste, com os contatos dados. Um que
   * tenha ficado de um autoteste interrompido sai antes. Devolve a função que o apaga. */
  createTestBook(contacts, name, stale = []) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    for (const d of MailServices.ab.directories) {
      if (d.dirName == name || stale.includes(d.dirName)) {
        try {
          MailServices.ab.deleteAddressBook(d.URI);
        } catch (e) {}
      }
    }
    const prefId = MailServices.ab.newAddressBook(name, "", Ci.nsIAbManager.JS_DIRECTORY_TYPE);
    const dir = MailServices.ab.getDirectoryFromId(prefId);
    const drop = () => {
      try {
        MailServices.ab.deleteAddressBook(dir.URI);
      } catch (e) {}
    };
    try {
      for (const c of contacts) {
        const card = Cc["@mozilla.org/addressbook/cardproperty;1"].createInstance(Ci.nsIAbCard);
        card.displayName = c.name;
        card.primaryEmail = c.email;
        dir.addCard(card);
      }
    } catch (e) {
      drop();
      throw e;
    }
    return { id: dir.UID, drop };
  }

  /* ---------- Anexar Mensagem e Outros Cartões de Visita ---------- */

  /** Pastas de todas as contas, na ordem do painel de pastas: [{ id, name, depth, account }].
   * Pastas virtuais (pesquisas salvas, unificadas) e as que não guardam mensagens ficam de fora. */
  mailFolders() {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    let compare = (a, b) => a.sortOrder - b.sortOrder || a.localizedName.localeCompare(b.localizedName);
    try {
      compare = ChromeUtils.importESModule("resource:///modules/FolderUtils.sys.mjs").FolderUtils.compareFolders;
    } catch (e) {}
    const VIRTUAL = 0x20; // nsMsgFolderFlags.Virtual
    const out = [];
    for (const account of MailServices.accounts.accounts) {
      let server = null;
      try {
        server = account.incomingServer;
      } catch (e) {}
      if (!server || server.type == "im") {
        continue;
      }
      const accountName = server.prettyName;
      const walk = (folder, depth) => {
        let subs = [];
        try {
          subs = [...folder.subFolders].sort(compare);
        } catch (e) {}
        for (const sub of subs) {
          if (!sub.noSelect && !sub.getFlag(VIRTUAL)) {
            out.push({ id: sub.URI, name: sub.localizedName || sub.prettyName, depth, account: accountName });
          }
          walk(sub, depth + 1);
        }
      };
      try {
        walk(server.rootFolder, 0);
      } catch (e) {}
    }
    return out;
  }

  /** A pasta aberta na janela principal e as mensagens selecionadas nela (ids = URI da
   * mensagem). Numa pasta unificada, vale a pasta da primeira mensagem selecionada. */
  mailSelection() {
    const none = { folderId: null, selected: [] };
    try {
      const main = Services.wm.getMostRecentWindow("mail:3pane");
      const tabmail = main && main.document.getElementById("tabmail");
      let about = tabmail && tabmail.currentAbout3Pane;
      if (!about && tabmail) {
        const info = (tabmail.tabInfo || []).find(x => x.mode && x.mode.name == "mail3PaneTab");
        about = info && info.chromeBrowser ? info.chromeBrowser.contentWindow : null;
      }
      if (!about) {
        return none;
      }
      const hdrs = about.gDBView ? about.gDBView.getSelectedMsgHdrs() : [];
      let folder = about.gFolder || null;
      if (folder && folder.getFlag(0x20)) {
        folder = hdrs.length ? hdrs[0].folder : null;
      }
      if (!folder) {
        return none;
      }
      return {
        folderId: folder.URI,
        selected: hdrs.filter(h => h.folder && h.folder.URI == folder.URI).map(h => folder.getUriForMsg(h)),
      };
    } catch (e) {
      return none;
    }
  }

  /** Mensagens de uma pasta, das mais novas para as mais antigas, filtradas pelo texto
   * (assunto e remetente). Sem pesquisa, olha as 4000 mais recentes da pasta. */
  async listMessages(folderId, text = "", limit = 500) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    const folder = MailServices.folderLookup.getFolderForURL(folderId);
    if (!folder) {
      throw new Error("pasta não encontrada: " + folderId);
    }
    const db = folder.msgDatabase;
    if (!db) {
      throw new Error("pasta sem índice: " + folderId);
    }
    const norm = s => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const words = norm(text).split(/\s+/).filter(Boolean);
    const EXPUNGED = 0x8; // nsMsgMessageFlags.Expunged
    const scanMax = words.length ? 50000 : 4000;
    const found = [];
    let scanned = 0;
    let more = false;
    for (const hdr of db.reverseEnumerateMessages()) {
      if (hdr.flags & EXPUNGED) {
        continue;
      }
      if (++scanned > scanMax) {
        more = true;
        break;
      }
      const subject = hdr.mime2DecodedSubject || "";
      const author = hdr.mime2DecodedAuthor || "";
      if (words.length) {
        const hay = norm(subject + " " + author);
        if (!words.every(w => hay.includes(w))) {
          continue;
        }
      }
      found.push({ hdr, subject, author, date: hdr.date / 1000 });
    }
    found.sort((a, b) => b.date - a.date);
    const shown = found.slice(0, limit);
    const who = author => {
      try {
        const [a] = MailServices.headerParser.parseDecodedHeader(author);
        return (a && (a.name || a.email)) || author;
      } catch (e) {
        return author;
      }
    };
    return {
      items: shown.map(f => ({ id: folder.getUriForMsg(f.hdr), subject: f.subject, author: who(f.author), date: f.date, size: f.hdr.messageSize })),
      capped: more || found.length > limit,
    };
  }

  /** Anexa as mensagens (URI de cada uma) como .eml, como o Thunderbird faz quando uma
   * mensagem é arrastada para a janela de composição. Devolve quantas entraram. */
  async attachMessages(ids) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    let addExt = true;
    try {
      addExt = Services.prefs.getBoolPref("mail.forward_add_extension", true);
    } catch (e) {}
    const list = [];
    for (const uri of ids || []) {
      let hdr = null;
      try {
        hdr = MailServices.messageServiceFromURI(uri).messageURIToMsgHdr(uri);
      } catch (e) {}
      if (!hdr) {
        continue;
      }
      const a = Cc["@mozilla.org/messengercompose/attachment;1"].createInstance(Ci.nsIMsgAttachment);
      a.url = uri;
      a.name = (hdr.mime2DecodedSubject || FaixaI18n.t("msg.noSubject", "(sem assunto)")) + (addExt ? ".eml" : "");
      a.contentType = "message/rfc822";
      a.size = hdr.messageSize;
      list.push(a);
    }
    if (list.length) {
      await this.chromeWin.AddAttachments(list);
    }
    return list.length;
  }

  /** Anexa o cartão de visita (vCard) de cada contato, como um arquivo "Nome.vcf". Os
   * arquivos ficam numa pasta temporária desta janela, que entra na lista do próprio
   * Thunderbird (gTempDirsToDelete): ele a apaga quando a janela de composição fecha,
   * enviada, salva ou descartada (é o que ele faz com as mensagens anexadas). Se algo
   * falhar no meio, os arquivos já escritos saem na hora. Devolve quantos entraram. */
  async attachContactCards(items) {
    const cards = [];
    for (const it of items || []) {
      let vcard = "";
      try {
        vcard = it.card ? it.card.toVCard() : "";
      } catch (e) {}
      if (vcard) {
        const name = String(it.name || it.email || "contato").replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "contato";
        cards.push({ name, vcard });
      }
    }
    if (!cards.length) {
      return 0;
    }
    // Pasta nova, de nome imprevisível e só do usuário (0700), direto na pasta temporária:
    // o Thunderbird apaga as de gTempDirsToDelete quando a janela fecha (ComposeUnload).
    const win = this.chromeWin;
    const dirPath = await IOUtils.createUniqueDirectory(PathUtils.tempDir, "faixa-cartoes", 0o700);
    const removeDir = () => IOUtils.remove(dirPath, { recursive: true, ignoreAbsent: true }).catch(() => {});
    if (win.closed) {
      await removeDir(); // a janela fechou enquanto o usuário escolhia
      return 0;
    }
    const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    dir.initWithPath(dirPath);
    if (Array.isArray(win.gTempDirsToDelete)) {
      win.gTempDirsToDelete.push(dir);
    } else {
      win.addEventListener("unload", removeDir, { once: true });
    }
    const list = [];
    try {
      for (const c of cards) {
        const path = await IOUtils.createUniqueFile(dirPath, c.name + ".vcf", 0o600);
        await IOUtils.writeUTF8(path, c.vcard);
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(path);
        const a = Cc["@mozilla.org/messengercompose/attachment;1"].createInstance(Ci.nsIMsgAttachment);
        a.url = Services.io.newFileURI(file).spec;
        a.name = c.name + ".vcf";
        a.contentType = "text/vcard";
        a.size = file.fileSize;
        list.push(a);
      }
      if (win.closed) {
        throw new Error("janela de composição fechada");
      }
    } catch (e) {
      await removeDir();
      throw e;
    }
    await win.AddAttachments(list);
    return list.length;
  }

  /** Thunderbird e sistema, para a janela Sobre. */
  appInfo() {
    const names = { win: "Windows", macosx: "macOS", linux: "Linux" };
    return { app: Services.appinfo.name + " " + Services.appinfo.version, platform: names[AppConstants.platform] || AppConstants.platform };
  }

  /* ---------- sugestões do autocompletar de destinatários ---------- */

  /** Sugestão destacada na lista de um campo de destinatário (Para, Cc, Cco...), ou null. */
  highlightedSuggestion(event) {
    const doc = this.chromeDoc;
    const input = [event.target, doc.activeElement].find(el => el && el.matches && el.matches('input[is="autocomplete-input"].address-input'));
    if (!input || !input.popupOpen || !input.popup) {
      return null;
    }
    const index = input.popup.selectedIndex;
    if (!(index >= 0)) {
      return null;
    }
    const ctrl = input.controller;
    try {
      return { input, index, value: ctrl.getValueAt(index), typed: ctrl.searchString || "" };
    } catch (e) {
      return null;
    }
  }

  /** Tira a sugestão da lista, como no Outlook: apaga o endereço dos Endereços
   * coletados, onde o Thunderbird guarda quem já recebeu mensagens. Contatos dos
   * outros catálogos não são apagados por aqui. Refaz a busca do que foi digitado. */
  removeSuggestion(s) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    const parsed = MailServices.headerParser.makeFromDisplayAddress(s.value);
    const email = parsed.length == 1 ? parsed[0].email : "";
    const out = { email, removed: 0, collectedName: "", others: [] };
    if (!email) {
      return out; // lista de distribuição ou grupo
    }
    const books = MailServices.ab.directories;
    const collected = books.find(d => d.dirPrefId == "ldap_2.servers.history");
    if (collected) {
      out.collectedName = collected.dirName;
      for (let i = 0; i < 20; i++) {
        const card = collected.cardForEmailAddress(email);
        if (!card) {
          break;
        }
        collected.deleteCards([card]);
        out.removed++;
      }
    }
    for (const d of books) {
      if (d == collected || d.isRemote) {
        continue;
      }
      try {
        if (d.cardForEmailAddress(email)) {
          out.others.push(d.dirName);
        }
      } catch (e) {}
    }
    if (out.removed) {
      this.refreshSuggestions(s);
    }
    return out;
  }

  /** Busca de novo o que o usuário digitou, sem os resultados guardados (senão o
   * Thunderbird só filtraria a lista anterior e a sugestão apagada voltaria). */
  refreshSuggestions(s) {
    const input = s.input;
    const ctrl = input.controller;
    const typed = s.typed;
    input.value = typed;
    input.setSelectionRange(typed.length, typed.length);
    ctrl.resetInternalState();
    if (!typed) {
      return;
    }
    ctrl.startSearch(typed);
    // Com a lista refeita, a seleção fica na mesma posição (Delete seguido apaga a próxima).
    const w = this.chromeWin;
    const t0 = Date.now();
    const reselect = () => {
      const done = ctrl.searchStatus == Ci.nsIAutoCompleteController.STATUS_COMPLETE_MATCH ||
        ctrl.searchStatus == Ci.nsIAutoCompleteController.STATUS_COMPLETE_NO_MATCH;
      if (!done && Date.now() - t0 < 1500) {
        w.setTimeout(reselect, 50);
        return;
      }
      if (input.popupOpen && ctrl.matchCount > 0) {
        input.popup.selectedIndex = Math.min(s.index, ctrl.matchCount - 1);
      }
    };
    w.setTimeout(reselect, 50);
  }

  /** A janela fica como "não modificada" (usado pelo autoteste antes de fechar). */
  markUnmodified() {
    const w = this.chromeWin;
    try {
      w.gContentChanged = false;
      // As confirmações mudadas (e voltadas) pelo autoteste também contam como alteração.
      w.gReceiptOptionChanged = false;
      w.gDSNOptionChanged = false;
      if (w.gMsgCompose) {
        w.gMsgCompose.bodyModified = false;
      }
      const ed = this.editor;
      if (ed) {
        ed.resetModificationCount();
      }
    } catch (e) {}
  }

  /** Levantamento das teclas de atalho da janela: os <key> e os atalhos que o
   * Thunderbird trata num ouvinte de keydown do documento (setKeyboardShortcuts
   * em MsgComposeCommands.js), que não aparecem como <key>. */
  surveyKeys() {
    const out = [
      { combo: "Ctrl+Shift+A", id: "doc:attach", command: "cmd_attachFile", disabled: false },
      { combo: "Ctrl+Shift+M", id: "doc:attachmentPane", command: "cmd_toggleAttachmentPane", disabled: false },
      { combo: "Ctrl+Shift+T", id: "doc:showTo", command: "showAddressRowTo", disabled: false },
      { combo: "Ctrl+Shift+C", id: "doc:showCc", command: "showAddressRowCc", disabled: false },
      { combo: "Ctrl+Shift+B", id: "doc:showBcc", command: "showAddressRowBcc", disabled: false },
    ];
    for (const key of this.chromeDoc.querySelectorAll("key")) {
      const k = key.getAttribute("key");
      const kc = key.getAttribute("keycode");
      if (!k && !kc) {
        continue;
      }
      const mods = (key.getAttribute("modifiers") || "").split(/[\s,]+/).filter(Boolean);
      const combo = FaixaShortcuts.normalize([...mods, k || kc].join("+"));
      out.push({
        combo,
        id: key.id || "",
        command: key.getAttribute("command") || key.getAttribute("observes") || (key.getAttribute("oncommand") || "").slice(0, 60),
        disabled: key.getAttribute("disabled") == "true",
      });
    }
    return out;
  }

  /* ---------- limpeza ---------- */

  dispose() {
    for (const mo of this.observers) {
      mo.disconnect();
    }
    this.observers = [];
    try {
      this.restoreMenubar();
    } catch (e) {}
    for (const id of [...this.sheets.keys()]) {
      this.removeAgentSheet(id);
    }
    for (const id of this.styleIds) {
      const el = this.chromeDoc.getElementById(id);
      if (el) {
        el.remove();
      }
    }
    this.styleIds.clear();
  }
};
