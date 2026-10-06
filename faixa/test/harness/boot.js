/* Liga o controlador real (implementation.js) ao host simulado. */
"use strict";
(async () => {
  const params = new URLSearchParams(location.search);
  if (params.get("tema") == "escuro") document.documentElement.classList.add("dark");
  // ?semcc=1: linha Cc escondida, como numa mensagem nova do Thunderbird.
  if (params.get("semcc") == "1") document.getElementById("addressRowCc").classList.add("hidden");
  // ?menusTb=oculta: a barra de menus oculta pela opção do próprio Thunderbird (guardada no
  // xulstore e aplicada na abertura da janela, como o XULPersist faz).
  const menubar = document.getElementById("compose-toolbar-menubar2");
  if (params.get("menusTb") == "oculta") {
    Services.xulStore.setValue(document.documentURI, menubar.id, "autohide", "");
    menubar.setAttribute("autohide", "");
  }
  // AutoHideMenubar.init() do Thunderbird (fora do macOS): a barra começa inativa.
  menubar.setAttribute("inactive", "true");
  if (params.get("semcopia") == "1") window.simNoFcc = true;
  // ?mac=1: macOS (os menus ficam na barra do sistema).
  if (params.get("mac") == "1") AppConstants.platform = "macosx";
  // Preferências que a faixa grava no perfil; ?prefs={"nome":"valor"} traz as de uma sessão anterior.
  const prefStore = params.get("prefs") ? JSON.parse(params.get("prefs")) : {};
  window.simPrefs = {
    store: prefStore,
    getStringPref: (k, d) => (k in prefStore ? prefStore[k] : d),
    setStringPref: (k, v) => {
      prefStore[k] = String(v);
    },
    clearUserPref: k => {
      delete prefStore[k];
    },
  };

  // gMsgCompose do Thunderbird, o bastante para as confirmações e o Acompanhamento:
  // ?leitura=1 e ?entrega=1 fazem a conta pedir as confirmações por padrão.
  // ?msgid=: rascunho aberto de novo (o Thunderbird mantém o Message-ID dele).
  const headers = new Map();
  const compFields = {
    returnReceipt: params.get("leitura") == "1",
    DSN: params.get("entrega") == "1",
    messageId: params.get("msgid") ? "<" + params.get("msgid") + ">" : "",
    // ?fcc2=: Opções → Enviar uma cópia para.
    fcc2: params.get("fcc2") || "",
    getHeader: n => headers.get(String(n).toLowerCase()),
    setHeader: (n, v) => headers.set(String(n).toLowerCase(), v),
    deleteHeader: n => headers.delete(String(n).toLowerCase()),
    get headerNames() {
      return [...headers.keys()];
    },
  };
  const sendListeners = new Set();
  window.simSendListeners = sendListeners;
  window.gMsgCompose = {
    compFields,
    bodyModified: false,
    addMsgSendListener: l => sendListeners.add(l),
    removeMsgSendListener: l => sendListeners.delete(l),
  };
  window.gReceiptOptionChanged = false;
  window.gDSNOptionChanged = false;
  const rrMenu = document.getElementById("returnReceiptMenu");
  const dsnMenu = document.getElementById("dsnMenu");
  // Como o ComposeStartup e as funções do MsgComposeCommands.js.
  dsnMenu.toggleAttribute("checked", compFields.DSN);
  rrMenu.toggleAttribute("checked", compFields.returnReceipt);
  window.ToggleReturnReceipt = forced => {
    if (forced === undefined) {
      compFields.returnReceipt = !compFields.returnReceipt;
      window.gReceiptOptionChanged = true;
    } else {
      compFields.returnReceipt = forced;
    }
    rrMenu.toggleAttribute("checked", compFields.returnReceipt);
  };
  window.ToggleDSN = target => {
    compFields.DSN = !compFields.DSN;
    target.toggleAttribute("checked", compFields.DSN);
    window.gDSNOptionChanged = true;
  };
  window.goDoCommand = cmd => {
    if (cmd == "cmd_toggleReturnReceipt" && !window.gWindowLocked) window.ToggleReturnReceipt();
  };
  // Troca de conta no De: o Thunderbird aplica as confirmações padrão da conta nova.
  window.simIdentityReceipts = (rr, dsn) => {
    window.ToggleReturnReceipt(rr);
    compFields.DSN = dsn;
    dsnMenu.toggleAttribute("checked", dsn);
  };
  const others = FaixaI18n.LOCALES.filter(l => l != "pt-BR");
  const [definition, css, keys, manifest, ...overlayList] = await Promise.all([
    fetch("../../ribbon/definition.json").then(r => r.json()),
    fetch("../../experiments/faixa/ribbon.css").then(r => r.text()),
    import("../../options/tb153-keys.js").then(m => m.TB153_KEYS.win),
    fetch("../../manifest.json").then(r => r.json()),
    ...others.map(l => fetch("../../ribbon/locales/" + l + ".json").then(r => (r.ok ? r.json() : null))),
  ]);
  // Idioma: ?idioma=auto|pt-BR|en-US (preferência) e ?tb=en-US (idioma do Thunderbird).
  Services.locale.appLocaleAsBCP47 = params.get("tb") || "pt-BR";
  window.SIM_KEYS = keys;
  // O controlador cria "new FaixaTBHost(win)": no simulador ele vira o host simulado.
  FaixaTBHost = FaixaSimHost;

  const frame = document.getElementById("messageEditor");
  const edDoc = frame.contentDocument;
  edDoc.open();
  edDoc.write('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:8px 12px;font:13px sans-serif} blockquote[type=cite]{border-left:2px solid #1F3A5F;margin:4px 0;padding-left:10px}</style></head><body>' +
    (params.get("conteudo") == "resposta"
      ? '<p><br></p><div class="moz-signature">-- <br>Ana Souza</div><div class="moz-cite-prefix">Em 20/09/2026, Mariana escreveu:</div><blockquote type="cite"><p>Pode enviar a proposta até sexta?</p><p>Obrigada.</p></blockquote>'
      : params.get("conteudo") == "resposta-html"
        ? '<p>Texto <b>do autor</b> com <span style="color: rgb(192, 0, 0);">cor</span></p><div class="moz-cite-prefix">Em 20/09/2026, Mariana escreveu:</div><blockquote type="cite"><p><b>De:</b> Mariana</p><p><span style="font-family: Calibri; color: rgb(31, 73, 125);">Pode enviar a proposta?</span></p></blockquote><div class="moz-signature"><b>Ana Souza</b><br>Bluecker</div>'
      : params.get("conteudo") == "resposta-texto"
        ? '<h1>Resposta do autor</h1><div class="moz-cite-prefix">Em 20/09/2026, Mariana escreveu:</div><blockquote type="cite"><pre class="moz-quote-pre" wrap="">Pode enviar a proposta até sexta?\nObrigada.\n</pre></blockquote><div class="moz-signature">-- <br>Ana Souza</div>'
        : params.get("conteudo") == "encaminhada"
          // Encaminhar (sem assinatura do Thunderbird): cursor em cima, mensagem encaminhada embaixo.
          ? '<p><br></p><div class="moz-forward-container"><br><br>-------- Mensagem encaminhada --------<br><table class="moz-email-headers-table"><tbody><tr><th>Assunto:</th><td>Proposta</td></tr></tbody></table><br><p>Segue a proposta.</p><div class="moz-signature">-- <br>Mariana</div></div>'
        : params.get("conteudo") == "resposta-fim"
          // Resposta por cima com a assinatura do Thunderbird no fim (o padrão dele: abaixo da citação).
          ? '<p><br></p><div class="moz-cite-prefix">Em 20/09/2026, Mariana escreveu:</div><blockquote type="cite"><p>Pode enviar a proposta?</p></blockquote><div class="moz-signature">-- <br>Ana Souza</div>'
        : params.get("conteudo") == "resposta-baixo"
          // Resposta embaixo da citação, sem assinatura do Thunderbird.
          ? '<div class="moz-cite-prefix">Em 20/09/2026, Mariana escreveu:</div><blockquote type="cite"><p>Pode enviar a proposta?</p></blockquote><p><br></p>'
        : params.get("modo") == "br"
          // "Usar formato Parágrafo" desligado: o Thunderbird monta o corpo com <br>.
          ? '<br><div class="moz-signature">-- <br>Ana Souza<br>Bluecker</div>'
          : '<p><br></p><div class="moz-signature">-- <br>Ana Souza<br>Bluecker</div>') +
    "</body></html>");
  edDoc.close();
  edDoc.designMode = "on";
  if (params.get("modo") == "br") {
    window.simParagraphPref = false;
    edDoc.execCommand("defaultParagraphSeparator", false, "br");
    edDoc.getSelection().collapse(edDoc.body, 0);
  } else if (params.get("cursor") == "1") {
    // Como o Thunderbird deixa a mensagem: cursor no primeiro parágrafo (mensagem nova,
    // resposta por cima) ou no último (resposta embaixo da citação).
    const ps = [...edDoc.body.children].filter(n => n.localName == "p");
    const p = params.get("conteudo") == "resposta-baixo" ? ps[ps.length - 1] : ps[0];
    if (p) edDoc.getSelection().collapse(p, 0);
  }
  if (params.get("texto") == "1") window.simIsHTML = false;
  if (params.get("topo")) window.simReplyOnTop = params.get("topo") == "1";

  // Autocompletar simulado no Para: sugestões vindas de catálogos em memória.
  // emails: o que o autocompletar sugere; contacts e lists: o que a busca dos catálogos acha.
  window.simBooks = [
    { id: "hist", dirName: "Endereços coletados", collected: true, emails: ["vagner.s.dias.banana.teste.123.manolo@gmail.com", "vagner.s.dias@gmail.com"],
      contacts: [{ name: "Joana Prado", email: "joana.antiga@gmail.com" }, { name: "Paula Reis", email: "paula.reis@exemplo.org" }] },
    { id: "pab", dirName: "Catálogo pessoal", emails: ["vagner.s.dias@gmail.com", "vagnerdias@hotmail.com"],
      contacts: [
        { name: "Vagner Dias", email: "vagner.s.dias@gmail.com" },
        { name: "Joana Prado", email: "joana.prado@cliente.com.br" },
        { name: "João Silva", email: "joao.silva@cliente.com.br" },
        { name: "João Souza", email: "joao.souza@fornecedor.com.br" },
        { name: "Mariana Costa", email: "mariana@cliente.com.br" },
        { name: "Souza, Beatriz", email: "beatriz.souza@cliente.com.br" },
      ],
      lists: [{ name: "Diretoria", description: "Diretoria" }] },
  ];
  const to = document.getElementById("to");
  to.classList.add("address-input");
  to.setAttribute("is", "autocomplete-input");
  const acCtrl = {
    searchString: "",
    searchStatus: 4,
    results: [],
    get matchCount() {
      return this.results.length;
    },
    getValueAt(i) {
      return this.results[i];
    },
    resetInternalState() {
      this.results = [];
    },
    startSearch(text) {
      this.searchString = text;
      this.results = [...new Set(window.simBooks.flatMap(b => b.emails))].filter(e => e.startsWith(text));
    },
  };
  Object.defineProperty(to, "controller", { value: acCtrl });
  Object.defineProperty(to, "popup", { value: { selectedIndex: -1 } });
  Object.defineProperty(to, "popupOpen", { get: () => to.dataset.popup == "1" });
  // ?ac=1: sugestões enquanto digita no Para, com o complemento selecionado na caixa
  // (completedefaultindex do Thunderbird).
  if (params.get("ac") == "1") {
    to.addEventListener("input", e => {
      if (e.inputType && !e.inputType.startsWith("insert")) {
        acCtrl.resetInternalState();
        return;
      }
      const v = to.value;
      const cut = Math.max(v.lastIndexOf(","), v.lastIndexOf(";")) + 1;
      const typed = v.slice(cut).trimStart();
      acCtrl.startSearch(typed);
      const first = acCtrl.results[0];
      if (typed && first && first.toLowerCase().startsWith(typed.toLowerCase())) {
        const head = v.slice(0, v.length - typed.length);
        to.value = head + typed + first.slice(typed.length);
        to.setSelectionRange(head.length + typed.length, to.value.length);
      }
    });
  }
  // Como o addressInputOnBlur do Thunderbird: ao perder o foco, a caixa com sugestões
  // completa com a primeira; texto com @ vira pílula.
  for (const input of document.querySelectorAll(".address-row-input")) {
    input.addEventListener("blur", () => {
      if (document.activeElement == input || !window.controller) return;
      const text = input.value.trim();
      const type = input.closest(".address-row").dataset.recipienttype;
      if (!text) {
        input.value = "";
        return;
      }
      const ctrl = input.controller;
      if (ctrl && ctrl.matchCount >= 1) {
        window.controller.host.addRecipients(type, [ctrl.getValueAt(0)]);
        input.value = "";
        ctrl.resetInternalState();
        return;
      }
      if (text.includes("@")) {
        window.controller.host.addRecipients(type, window.controller.host.parseAddresses(text).map(a => a.text));
        input.value = "";
      }
    });
  }

  // Contas (identidades) simuladas; a primeira tem a assinatura do Thunderbird que o corpo já traz.
  window.simIdentities = {
    id1: {
      key: "id1", email: "ana@exemplo.com.br", name: "Ana Souza", organization: "Bluecker",
      vcard: "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ana Souza\r\nTITLE:Gerente de Contas\r\nORG:Bluecker;Comercial\r\nTEL;TYPE=work;VALUE=TEXT:+55 11 5555-0100\r\nTEL;TYPE=cell;VALUE=TEXT:+55 11 99999-0100\r\nURL;VALUE=URL:https://bluecker.com\r\nEND:VCARD\r\n",
      tbSig: "Ana Souza<br>Bluecker",
    },
    id2: { key: "id2", email: "ana.souza@cliente.com.br", name: "Ana Souza", organization: "Cliente S.A.", vcard: "", tbSig: "" },
    id3: { key: "id3", email: "suporte@exemplo.com.br", name: "Suporte Bluecker", organization: "", vcard: "", tbSig: "Equipe de Suporte" },
  };
  window.simIdentity = window.simIdentities[params.get("conta") || "id1"];
  // Como o SetIdentity do Thunderbird: tira a última assinatura do primeiro nível (e o <br>
  // antes dela), põe a da conta nova no fim e avisa com compose-from-changed.
  window.simSwitchIdentity = key => {
    const body = edDoc.body;
    let n = body.lastElementChild;
    while (n && !/moz-signature/i.test(n.getAttribute("class") || "")) {
      n = n.previousElementSibling;
    }
    if (n) {
      const prev = n.previousSibling;
      n.remove();
      if (prev && prev.nodeName == "BR") prev.remove();
    }
    window.simIdentity = window.simIdentities[key];
    if (window.simIdentity.tbSig) {
      const div = edDoc.createElement("div");
      div.className = "moz-signature";
      div.innerHTML = "-- <br>" + window.simIdentity.tbSig;
      body.append(div);
    }
    window.dispatchEvent(new CustomEvent("compose-from-changed"));
  };
  if (params.get("tipo")) window.simComposeKind = params.get("tipo");

  // Pastas e mensagens (Anexar Mensagem). ?sel=1: uma mensagem selecionada na janela principal.
  const at = (d, h, m) => Date.UTC(2026, 8, d, h, m);
  window.simFolders = [
    { id: "mailbox://ana/Inbox", name: "Entrada", depth: 0, account: "ana@exemplo.com.br", messages: [
      { id: "mailbox-message://ana/Inbox#1", subject: "Proposta de renovação do contrato", author: "Mariana Costa", date: at(20, 13, 5), size: 20480 },
      { id: "mailbox-message://ana/Inbox#2", subject: "Reunião de alinhamento", author: "João Silva", date: at(22, 9, 30), size: 10240 },
      { id: "mailbox-message://ana/Inbox#3", subject: "Contrato assinado", author: "Joana Prado", date: at(25, 16, 45), size: 51200 },
    ] },
    { id: "mailbox://ana/Inbox/Clientes", name: "Clientes", depth: 1, account: "ana@exemplo.com.br", messages: [
      { id: "mailbox-message://ana/Inbox/Clientes#1", subject: "Pedido de orçamento", author: "Beatriz Souza", date: at(18, 11, 0), size: 8192 },
    ] },
    { id: "mailbox://ana/Sent", name: "Enviados", depth: 0, account: "ana@exemplo.com.br", messages: [] },
    { id: "imap://suporte/INBOX", name: "Entrada", depth: 0, account: "suporte@exemplo.com.br", broken: true },
  ];
  window.simMailSelection = params.get("sel") == "1"
    ? { folderId: "mailbox://ana/Inbox", selected: ["mailbox-message://ana/Inbox#2"] }
    : { folderId: "mailbox://ana/Inbox", selected: [] };

  const background = new SimEmitter();
  const api = {
    baseDefinition: definition,
    overlays: Object.fromEntries(others.map((l, i) => [l, overlayList[i]]).filter(([, o]) => o)),
    windows: new Map(),
    css,
    // ?cfg=<JSON>: configuração extra desde o início (assinaturas, padrões...). ?semcfg=1:
    // a configuração do background ainda não chegou quando o editor fica pronto.
    configured: params.get("semcfg") != "1",
    config: Object.assign({}, FAIXA_DEFAULTS,
      params.get("perfil") ? { perfilAtalhos: params.get("perfil") } : {},
      params.get("idioma") ? { idioma: params.get("idioma") } : {},
      params.get("cfg") ? JSON.parse(params.get("cfg")) : {}),
    // Os mesmos métodos da API do experiment: idioma e configuração nova em todas as janelas.
    setLocale: faixa.prototype.setLocale,
    applyConfig: faixa.prototype.applyConfig,
    emitter: background,
    emitCommand(tabId, command, args) {
      background.emit("command", tabId, command, args);
    },
    emitReady(tabId) {
      background.emit("compose-ready", tabId);
    },
    extension: { version: manifest.version, tabManager: { getWrapper: () => ({ id: 7 }) } },
    listFonts: async () => ["Arial", "Calibri", "Calibri Light", "Cambria", "Carlito", "Consolas", "Courier New", "DejaVu Sans", "Georgia", "Segoe UI", "Tahoma", "Times New Roman", "Verdana"],
    setMainToolbarVisible(visible) {
      this.applyConfig(Object.assign({}, this.config, { ocultarBarraThunderbird: !visible }));
    },
    setMenubarVisible: faixa.prototype.setMenubarVisible,
    // Sinalizar para Mim: o que o controlador entrega à estrela (testada à parte).
    followUpSent(messageId, folders, queued) {
      window.simFollowUp = (window.simFollowUp || []).concat([[messageId, folders, queued]]);
    },
    // Acompanhamento dos rascunhos: a classe de verdade, com as preferências simuladas
    // (?prefs= traz as de uma "sessão" anterior).
    draftFollowUps: new FaixaDraftFollowUps({ prefs: window.simPrefs }),
    draftFollowUp: faixa.prototype.draftFollowUp,
    draftFollowUpSaved: faixa.prototype.draftFollowUpSaved,
  };
  api.setLocale();
  // "Background" simulado: mesma lógica do background.js para os comandos de mensagem.
  const details = { priority: "normal", deliveryFormat: "auto" };
  background.on("command", (ev, tabId, command, args) => {
    setTimeout(() => {
      if (command == "_ping") {
        controller.setMessageState({ _pong: args.nonce });
        return;
      }
      if (command == "priorityHigh") details.priority = details.priority == "highest" ? "normal" : "highest";
      if (command == "priorityLow") details.priority = details.priority == "lowest" ? "normal" : "lowest";
      if (command == "formatHTML") details.deliveryFormat = "both";
      if (command == "formatPlain") details.deliveryFormat = "plaintext";
      // Como o background: grava a escolha e manda a configuração de novo às janelas.
      if (command == "setMenubar") api.applyConfig(Object.assign({}, api.config, { ocultarBarraMenus: !args.visible }));
      if (command == "saveQuickPart") {
        // Como o background: grava a parte do usuário e manda a configuração nova às janelas.
        const own = (api.config.partesRapidas || []).filter(p => !p.gerenciada);
        const org = (api.config.partesRapidas || []).filter(p => p.gerenciada);
        const i = args.id ? own.findIndex(p => p.id == args.id) : -1;
        if (i >= 0) own[i] = Object.assign({}, own[i], { nome: args.nome, html: args.html });
        else own.push({ id: "p" + own.length, nome: args.nome, html: args.html, gerenciada: false });
        api.applyConfig(Object.assign({}, api.config, { partesRapidas: [...org, ...own] }));
      }
      window.simCommands = (window.simCommands || []).concat(command);
      window.simCommandArgs = (window.simCommandArgs || []).concat([[command, args]]);
      controller.setMessageState(Object.assign({}, details));
    }, 30);
  });
  background.on("compose-ready", () => setTimeout(() => controller.setMessageState(Object.assign({}, details)), 10));

  const controller = new FaixaComposeController(api, window);
  window.controller = controller;
  window.simApi = api;
  api.windows.set(window, controller);
  controller.start();

  // O resto do AutoHideMenubar: o Alt sozinho ativa a barra de menus (ela aparece, se estava
  // oculta) e o próximo Alt ou o Esc a desativa. E a opção Barra de Menus do Thunderbird
  // (Exibir > Barras de Ferramentas, ou o menu de contexto da barra), que grava no xulstore.
  let menubarActive = false;
  let altAlone = false;
  const setMenubarActive = on => {
    menubarActive = on;
    if (on) menubar.removeAttribute("inactive");
    else if (menubar.hasAttribute("autohide")) menubar.setAttribute("inactive", "true");
    window.simMenubarActive = on;
  };
  const onMenuKeyDown = e => {
    altAlone = e.key == "Alt";
    if (menubarActive && e.key == "Escape") setMenubarActive(false);
  };
  const onMenuKeyUp = e => {
    if (e.key == "Alt" && altAlone) setMenubarActive(!menubarActive);
    altAlone = false;
  };
  for (const w of [window, frame.contentWindow]) {
    w.addEventListener("keydown", onMenuKeyDown, true);
    w.addEventListener("keyup", onMenuKeyUp, true);
  }
  window.simToggleMenubarNative = () => {
    if (!menubar.hasAttribute("autohide")) {
      menubar.setAttribute("autohide", "");
      setTimeout(() => menubar.setAttribute("inactive", "true"), 0); // o menu de contexto fechou
    } else {
      menubar.removeAttribute("autohide");
    }
    Services.xulStore.persist(menubar, "autohide");
  };

  // No Thunderbird os eventos do corpo sobem até a janela; no iframe do Chromium não.
  const ew = frame.contentWindow;
  ew.addEventListener("keydown", e => controller.onKeyDown(e), true);
  ew.addEventListener("keyup", e => FaixaShortcuts.track(controller.keyState, e, false), true);
  ew.addEventListener("focus", () => controller.onFocusIn({ target: edDoc }), true);
  // No Thunderbird o mousedown do corpo chega ao documento da janela (menus e espiada fecham).
  edDoc.addEventListener("mousedown", () => {
    controller.ui.closePopup();
    controller.ui.endPeek();
  }, true);
  ew.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && (e.key == "z" || e.key == "y") && !e.defaultPrevented) {
      e.preventDefault();
      if (e.key == "z") controller.host.editor.undo();
      else controller.host.editor.redo();
      controller.engine && controller.engine.scheduleState(0);
    }
  }, true);

  setTimeout(() => {
    window.composeEditorReady = true;
    window.dispatchEvent(new CustomEvent("compose-editor-ready"));
    window.simReady = true;
  }, 50);
})().catch(e => {
  window.simError = String(e && e.stack || e);
  console.error(e);
});
