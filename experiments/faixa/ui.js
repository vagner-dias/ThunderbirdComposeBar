/* Faixa de Opções — interface: abas, grupos, controles, menus, dicas e atalhos.
 *
 * Não conhece o Thunderbird. Recebe o documento onde vai morar, a definição
 * declarativa (ribbon/definition.json) e um callback onCommand(cmd, args, meta).
 * Roda igual no documento privilegiado da janela de composição e no simulador
 * de testes (test/harness). */

"use strict";

var FAIXA_NS_HTML = "http://www.w3.org/1999/xhtml";
var FAIXA_NS_SVG = "http://www.w3.org/2000/svg";
/* Visualização Dinâmica: espera (ms) com o mouse ou o foco num item antes de mostrar. */
var FAIXA_PREVIEW_DELAY = 150;

/* Bordas, como os ícones do Word: o quadrado pontilhado com as bordas escolhidas cheias. */
var FAIXA_BORDER_DOTS = { "stroke-dasharray": "0 3" };
var FAIXA_BORDER_BOX = "M3 3h18v18H3z";
var FAIXA_BORDER_CROSS = "M12 3v18M3 12h18";
var faixaBorderIcon = (dotted, solid) => [
  ...dotted.map(d => ["path", Object.assign({ d }, FAIXA_BORDER_DOTS)]),
  ...solid.map(d => ["path", { d }]),
];

/* Ícones que não vieram do sprite do mockup. */
var FAIXA_EXTRA_ICONS = {
  ellipsis: [
    ["circle", { cx: "5", cy: "12", r: "1" }],
    ["circle", { cx: "12", cy: "12", r: "1" }],
    ["circle", { cx: "19", cy: "12", r: "1" }],
  ],
  "border-bottom": faixaBorderIcon([FAIXA_BORDER_BOX], ["M3 21h18"]),
  "border-top": faixaBorderIcon([FAIXA_BORDER_BOX], ["M3 3h18"]),
  "border-left": faixaBorderIcon([FAIXA_BORDER_BOX], ["M3 3v18"]),
  "border-right": faixaBorderIcon([FAIXA_BORDER_BOX], ["M21 3v18"]),
  "border-none": faixaBorderIcon([FAIXA_BORDER_BOX, FAIXA_BORDER_CROSS], []),
  "border-all": faixaBorderIcon([], [FAIXA_BORDER_BOX, FAIXA_BORDER_CROSS]),
  "border-outside": faixaBorderIcon([FAIXA_BORDER_CROSS], [FAIXA_BORDER_BOX]),
  "border-inside-h": faixaBorderIcon([FAIXA_BORDER_BOX, "M12 3v18"], ["M3 12h18"]),
};

/* ---------------------------------------------------------------------------
 * Idiomas: pt-BR é o texto de origem (no código e em ribbon/definition.json);
 * as outras línguas vêm de ribbon/locales/<idioma>.json por cima.
 * ------------------------------------------------------------------------- */
var FaixaI18n = {
  locale: "pt-BR",
  strings: {},
  keyNames: null,

  /** Idiomas da faixa. O texto de origem é o pt-BR; os outros vêm de
   * ribbon/locales/<idioma>.json. */
  LOCALES: ["pt-BR", "en-US", "es", "it", "de", "fr"],

  /** O nome de cada idioma nele mesmo, para as listas de idioma. */
  NAMES: {
    "pt-BR": "Português (Brasil)",
    "en-US": "English (United States)",
    es: "Español",
    it: "Italiano",
    de: "Deutsch",
    fr: "Français",
  },

  /** Idioma da faixa: a preferência (um de LOCALES) ou, em "auto", o do Thunderbird
   * (português → pt-BR, espanhol → es, italiano → it, alemão → de, francês → fr;
   * qualquer outro → en-US). */
  pick(pref, appLocale) {
    if (this.LOCALES.includes(pref)) {
      return pref;
    }
    const lang = String(appLocale || "").toLowerCase().split(/[-_]/)[0];
    return { pt: "pt-BR", es: "es", it: "it", de: "de", fr: "fr" }[lang] || "en-US";
  },

  use(locale, overlay) {
    this.locale = locale;
    const o = locale != "pt-BR" && overlay ? overlay : null;
    this.strings = (o && o.strings) || {};
    // Nomes das teclas como no Office do idioma (Strg e Umschalt em alemão, Maj em francês...).
    this.keyNames = (o && o.keyNames) || null;
  },

  /** Um atalho escrito com os nomes de tecla do idioma: "Ctrl+Shift+V" → "Strg+Umschalt+V". */
  keys(text) {
    const names = this.keyNames;
    if (!names || !text) {
      return text;
    }
    return String(text).replace(/(^|\+|\/ ?|\s)(Ctrl|Shift|Alt|Delete|Enter|Space|Esc|Tab|Backspace)(?=$|\+|\s|\/|,|\))/g,
      (m, pre, key) => pre + (names[key] || key));
  },

  /** t("chave", "texto em pt-BR com {var}", { var }) */
  t(key, text, vars) {
    let s = Object.prototype.hasOwnProperty.call(this.strings, key) ? this.strings[key] : text;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    }
    return s;
  },

  /** Número com a vírgula ou o ponto decimal do idioma (ponto só em inglês). */
  num(n) {
    const s = String(n);
    return this.locale == "en-US" ? s : s.replace(".", ",");
  },

  yes(v) {
    return v ? this.t("common.yes", "sim") : this.t("common.no", "não");
  },

  /** Cópia da definição (pt-BR) com a tradução por cima. */
  localize(def, overlay) {
    const d = JSON.parse(JSON.stringify(def));
    if (!overlay) {
      return d;
    }
    for (const [id, o] of Object.entries(overlay.commands || {})) {
      if (d.commands[id]) {
        Object.assign(d.commands[id], o);
      }
    }
    if (overlay.fileTab && d.fileTab) {
      Object.assign(d.fileTab, overlay.fileTab);
    }
    for (const tab of d.tabs || []) {
      if (overlay.tabs && overlay.tabs[tab.id]) {
        tab.label = overlay.tabs[tab.id];
      }
      for (const g of tab.groups) {
        if (overlay.groups && overlay.groups[g.id]) {
          g.label = overlay.groups[g.id];
        }
      }
    }
    for (const [key, text] of Object.entries(overlay.menus || {})) {
      const [menu, i] = key.split(".");
      const e = d.menus && d.menus[menu] && d.menus[menu][Number(i)];
      if (e) {
        if ("head" in e) {
          e.head = text;
        } else {
          e.label = text;
        }
      }
    }
    for (const s of d.styles || []) {
      if (overlay.styles && overlay.styles[s.id]) {
        s.label = overlay.styles[s.id];
      }
    }
    for (const [key, text] of Object.entries(overlay.palettes || {})) {
      const [p, field] = key.split(".");
      if (d.palettes && d.palettes[p]) {
        d.palettes[p][field] = text;
      }
    }
    for (const f of d.themeFonts || []) {
      if (overlay.themeFonts && overlay.themeFonts[f.name]) {
        f.note = overlay.themeFonts[f.name];
      }
    }
    for (const [id, label] of Object.entries(overlay.shortcutProfiles || {})) {
      if (d.shortcutProfiles && d.shortcutProfiles[id]) {
        d.shortcutProfiles[id].label = label;
      }
    }
    (overlay.officeReference || []).forEach((action, i) => {
      if (d.officeReference && d.officeReference[i]) {
        d.officeReference[i].action = action;
      }
    });
    // Alterar Estilos: "colors.blue" → o nome do tema de cores Azul, e assim por diante.
    for (const [key, text] of Object.entries(overlay.changeStyles || {})) {
      const [section, id] = key.split(".");
      const item = d.changeStyles && (d.changeStyles[section] || []).find(o => o.id == id);
      if (item) {
        item.label = text;
      }
    }
    return d;
  },
};

/* ---------------------------------------------------------------------------
 * Atalhos de teclado
 * ------------------------------------------------------------------------- */
var FaixaShortcuts = class {
  /**
   * @param {object} definition  definição completa (usa shortcutProfiles)
   * @param {string} profileId   "thunderbird-office" ou "office-ptbr"
   * @param {boolean} isMac      no macOS "Ctrl" das definições vira Cmd
   */
  constructor(definition, profileId, isMac = false) {
    this.isMac = isMac;
    this.profiles = definition.shortcutProfiles || {};
    this.profileId = this.profiles[profileId] ? profileId : "thunderbird-office";
    this.entries = this._resolve(this.profileId, new Set());
    this.map = new Map();
    for (const entry of this.entries) {
      const combo = FaixaShortcuts.normalize(entry.keys);
      if (combo) {
        this.map.set(combo, { ...entry, combo });
      }
    }
  }

  _resolve(id, seen) {
    const profile = this.profiles[id];
    if (!profile || seen.has(id)) {
      return [];
    }
    seen.add(id);
    const base = profile.extends ? this._resolve(profile.extends, seen) : [];
    const own = profile.keys || [];
    const ownCombos = new Set(own.map(e => FaixaShortcuts.normalize(e.keys)));
    return [...base.filter(e => !ownCombos.has(FaixaShortcuts.normalize(e.keys))), ...own];
  }

  /** Forma canônica: modificadores na ordem Ctrl, Alt, Shift, Meta + tecla.
   * Shift só aparece com letras, números e teclas nomeadas: em "Ctrl+Shift+>"
   * o símbolo já diz que o Shift foi usado, e cada teclado chega a ele de um jeito. */
  static normalize(text) {
    if (!text || typeof text != "string") {
      return null;
    }
    let key;
    let mods;
    if (text.endsWith("++")) {
      key = "+";
      mods = text.slice(0, -2).split("+").filter(Boolean);
    } else {
      const parts = text.split("+");
      key = parts.pop();
      mods = parts;
    }
    key = FaixaShortcuts.canonicalKey(key);
    if (!key) {
      return null;
    }
    const alias = { control: "Ctrl", ctrl: "Ctrl", accel: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta", cmd: "Meta", os: "Meta" };
    const set = new Set(mods.map(m => alias[m.trim().toLowerCase()] || m.trim()));
    const named = key.length > 1;
    if (!named && !/^[A-Z0-9]$/.test(key)) {
      set.delete("Shift");
    }
    const order = ["Ctrl", "Alt", "Shift", "Meta"];
    return [...order.filter(m => set.has(m)), key].join("+");
  }

  static canonicalKey(key) {
    if (key == null) {
      return null;
    }
    if (key === " " || /^(space|espaço|espaco)$/i.test(key)) {
      return "Space";
    }
    const k = key.replace(/^VK_/, "");
    const names = {
      RETURN: "Enter", ENTER: "Enter", ESCAPE: "Esc", ESC: "Esc", BACK: "Backspace", BACKSPACE: "Backspace",
      DELETE: "Delete", TAB: "Tab", LEFT: "Left", RIGHT: "Right", UP: "Up", DOWN: "Down", HOME: "Home",
      END: "End", PAGE_UP: "PageUp", PAGE_DOWN: "PageDown", INSERT: "Insert",
    };
    if (names[k.toUpperCase()]) {
      return names[k.toUpperCase()];
    }
    if (/^f\d{1,2}$/i.test(k)) {
      return k.toUpperCase();
    }
    if (k.length == 1) {
      return /^[a-z]$/i.test(k) ? k.toUpperCase() : k;
    }
    return k;
  }

  /** Estado das teclas modificadoras, por janela: de que lado veio o Alt. */
  static newKeyState() {
    return { leftAlt: false, rightAlt: false, ctrl: false };
  }

  /** Atualiza o estado com um keydown (down=true) ou keyup. */
  static track(state, event, down) {
    if (!state) {
      return;
    }
    switch (event.code) {
      case "AltLeft":
        state.leftAlt = down;
        return;
      case "AltRight":
        state.rightAlt = down;
        return;
      case "ControlLeft":
      case "ControlRight":
        state.ctrl = down;
        return;
    }
    if (down) {
      // Keyup perdido (o foco saiu com a tecla presa): uma tecla comum sem o
      // modificador corrige o estado.
      const altGraph = typeof event.getModifierState == "function" && event.getModifierState("AltGraph");
      if (!event.altKey && !altGraph) {
        state.leftAlt = false;
        state.rightAlt = false;
      }
      if (!event.ctrlKey && !altGraph) {
        state.ctrl = false;
      }
    }
  }

  /** Converte um KeyboardEvent na forma canônica, ou null.
   * keyState (de newKeyState/track) diz se o Alt pressionado é o da esquerda. */
  comboFromEvent(event, keyState = null) {
    if (event.isComposing || event.repeat && event.key == "Escape") {
      return null;
    }
    let key = event.key;
    if (!key || key == "Unidentified" || key == "Dead" || key == "Process") {
      return null;
    }
    if (["Control", "Shift", "Alt", "Meta", "OS", "AltGraph", "CapsLock"].includes(key)) {
      return null;
    }
    const accel = this.isMac ? event.metaKey : event.ctrlKey;
    const macCtrl = this.isMac && event.ctrlKey;
    let ctrl = accel;
    let alt = event.altKey;
    const named = {
      Enter: "Enter", Escape: "Esc", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
      ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Home: "Home",
      End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert",
    };
    let shift = false;
    if (key.length == 1) {
      const nonAscii = !/^[\x20-\x7e]$/.test(key);
      const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code || "");
      const physical = m ? m[1] || m[2] : null;
      const altGraph = !this.isMac && typeof event.getModifierState == "function" && event.getModifierState("AltGraph");
      if (!this.isMac && (altGraph || (event.ctrlKey && event.altKey && nonAscii))) {
        // Windows: Ctrl+Alt que gera caractere chega como AltGr (no Gecko, sem ctrlKey
        // nem altKey). O AltGr de verdade (Alt da direita) sempre digita: ¹ ² ³ ₢ no
        // ABNT2, © no US-Internacional. Só Ctrl + Alt da esquerda vira atalho da faixa.
        const s = keyState || {};
        if (!physical || !s.leftAlt || s.rightAlt || !s.ctrl) {
          return null;
        }
        ctrl = true;
        alt = true;
        key = physical;
      } else if (physical && (this.isMac ? event.metaKey && event.altKey : nonAscii && !event.altKey)) {
        // macOS: Cmd+Option chega com o caractere que o Option daria ("ç" em Cmd+Option+C).
        // Teclados não latinos: Ctrl+E chega como "у". Vale a tecla física.
        key = physical;
      }
      key = FaixaShortcuts.canonicalKey(key);
      shift = event.shiftKey && (/^[A-Z0-9]$/.test(key) || key == "Space");
    } else if (named[key] || /^F\d{1,2}$/.test(key)) {
      key = named[key] || key;
      shift = event.shiftKey;
    } else {
      return null;
    }
    const mods = [];
    if (ctrl) {
      mods.push("Ctrl");
    }
    if (alt) {
      mods.push("Alt");
    }
    if (shift) {
      mods.push("Shift");
    }
    if (macCtrl) {
      mods.push("MacCtrl");
    }
    if (event.metaKey && !this.isMac) {
      mods.push("Meta");
    }
    return [...mods, key].join("+");
  }

  /** Procura o atalho do evento. Escopo da entrada: "body" (foco no corpo),
   * "recipients" (foco no Para, Cc ou Cco) ou "window". where: true/false (foco no
   * corpo, como antes) ou { inBody, inRecipients }. */
  match(event, where, keyState = null) {
    const inBody = typeof where == "object" && where ? !!where.inBody : !!where;
    const inRecipients = typeof where == "object" && where ? !!where.inRecipients : false;
    const combo = this.comboFromEvent(event, keyState);
    if (!combo) {
      return null;
    }
    const entry = this.map.get(combo);
    if (!entry) {
      return null;
    }
    // Atalho marcado com typingWins numa combinação que, neste teclado, digita um
    // caractere (Ctrl+Alt+2 é ² no ABNT2, também com Ctrl e Alt da esquerda): o
    // caractere vence, como vence qualquer tecla que já tem dono.
    if (entry.typingWins && this.isCharChord(event)) {
      return null;
    }
    if (entry.scope == "body" && !inBody) {
      return null;
    }
    if (entry.scope == "recipients" && !inRecipients) {
      return null;
    }
    return entry;
  }

  /** A combinação gera caractere? (Windows/Linux: AltGr, ou Ctrl+Alt que o Windows
   * transforma em AltGr.) No macOS o Cmd impede a digitação. */
  isCharChord(event) {
    if (this.isMac || !event.key || event.key.length != 1) {
      return false;
    }
    const altGraph = typeof event.getModifierState == "function" && event.getModifierState("AltGraph");
    return !!altGraph || (event.ctrlKey && event.altKey && !/^[\x20-\x7e]$/.test(event.key));
  }

  /** Rótulos de atalho para a dica de um comando (perfil ativo). */
  labelsFor(cmd, args) {
    const out = [];
    for (const entry of this.map.values()) {
      if (entry.cmd != cmd || entry.hidden) {
        continue;
      }
      if (args && entry.args && JSON.stringify(entry.args) != JSON.stringify(args)) {
        continue;
      }
      if (!args && entry.args) {
        continue;
      }
      out.push(this.display(entry.label || entry.keys));
    }
    return out;
  }

  display(text) {
    if (!this.isMac) {
      return FaixaI18n.keys(text);
    }
    return text.replace(/\bCtrl\b/g, "⌘").replace(/\bAlt\b/g, "⌥");
  }
};

/* ---------------------------------------------------------------------------
 * Interface
 * ------------------------------------------------------------------------- */
var FaixaUI = class {
  /** Símbolos usados por último (menu Símbolo): valem em todas as janelas de composição. */
  static recentSymbols = [];

  /**
   * @param {object} o
   * @param {Document} o.doc          documento que recebe a faixa
   * @param {object} o.definition     ribbon/definition.json
   * @param {object} o.config         configuração efetiva
   * @param {Function} o.onCommand    (cmd, args, meta) => void
   * @param {Function} o.getFonts     () => Promise<string[]>
   * @param {Function} [o.focusEditor]
   * @param {boolean} [o.isMac]
   */
  constructor(o) {
    this.doc = o.doc;
    this.win = o.doc.defaultView;
    this.def = o.definition;
    this.config = o.config || {};
    // Um comando da faixa recolhida (aberta só para escolher) fecha a espiada, como no Office.
    this.onCommand = (cmd, args, meta) => {
      if (cmd != "collapse") {
        this.endPeek();
      }
      return o.onCommand(cmd, args, meta);
    };
    this.getFonts = o.getFonts || (() => Promise.resolve([]));
    this.focusEditor = o.focusEditor || (() => {});
    // Volta para onde o usuário estava antes de entrar na faixa pelo teclado (corpo ou Para).
    this.returnFocus = o.returnFocus || (() => this.focusEditor());
    this.isMac = !!o.isMac;
    this.platform = o.platform || (this.isMac ? "macosx" : "");
    this.icons = Object.assign({}, typeof FAIXA_ICONS == "undefined" ? {} : FAIXA_ICONS, FAIXA_EXTRA_ICONS);
    this.shortcuts = new FaixaShortcuts(this.def, this.config.perfilAtalhos, this.isMac);
    this.controls = [];
    this.state = {};
    this.lastColor = {};
    this.popup = null;
    this.popupAnchor = null;
    this.tipTimer = 0;
    this.tipEl = null;
    this.fitLevel = 0;
    this.galleryOffset = 0;
    this.disposers = [];
    this.roving = null; // o controle da faixa que recebe o Tab (tabindex móvel)
    // Visualização Dinâmica: o controlador liga onPreview(cmd, args) e onPreviewEnd().
    this.onPreview = null;
    this.onPreviewEnd = null;
    this.previewTimer = 0;
    this.selectedTab = this.def.tabs.some(t => t.id == this.config.abaInicial) ? this.config.abaInicial : this.def.tabs[0].id;
    for (const [cmd, meta] of Object.entries(this.def.commands)) {
      if (meta.type == "color") {
        this.lastColor[cmd] = meta.default;
      }
    }
  }

  /* ---------- utilidades de DOM ---------- */

  h(tag, attrs, ...children) {
    const el = this.doc.createElementNS(FAIXA_NS_HTML, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) {
          continue;
        }
        if (k == "class") {
          el.className = v;
        } else if (k == "text") {
          el.textContent = v;
        } else if (k == "style" && typeof v == "object") {
          for (const [p, pv] of Object.entries(v)) {
            el.style.setProperty(p, pv);
          }
        } else if (k.startsWith("on") && typeof v == "function") {
          el.addEventListener(k.slice(2), v);
        } else {
          el.setAttribute(k, v === true ? "" : String(v));
        }
      }
    }
    for (const child of children.flat()) {
      if (child == null || child === false) {
        continue;
      }
      el.append(typeof child == "string" ? this.doc.createTextNode(child) : child);
    }
    return el;
  }

  icon(name, cls = "") {
    const svg = this.doc.createElementNS(FAIXA_NS_SVG, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", ("fx-ic " + cls).trim());
    svg.setAttribute("aria-hidden", "true");
    for (const [tag, attrs] of this.icons[name] || this.icons.square || []) {
      const node = this.doc.createElementNS(FAIXA_NS_SVG, tag);
      for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, v);
      }
      svg.append(node);
    }
    return svg;
  }

  /** Definição efetiva: a da faixa com o tema da mensagem (Alterar Estilos), que o motor
   * manda no estado (theme). Sem motor ainda, o tema padrão. */
  get def() {
    return FaixaThemes.apply(this.baseDef, this.state && this.state.theme);
  }

  set def(definition) {
    this.baseDef = definition;
  }

  meta(cmd) {
    return this.def.commands[cmd] || { label: cmd };
  }

  /* ---------- montagem ---------- */

  build() {
    const doc = this.doc;
    const t = FaixaI18n.t.bind(FaixaI18n);
    const root = this.h("div", {
      id: "faixa-root",
      role: "region",
      lang: FaixaI18n.locale,
      "aria-label": t("ribbon.name", "Faixa de Opções"),
    });
    this.root = root;

    // Barra das abas: barra de acesso rápido (Salvar, Desfazer, Refazer), Arquivo e as abas.
    const tabbar = this.h("div", { class: "fx-tabbar" });
    this.tabbar = tabbar;
    const qat = this.h("div", { class: "fx-qat", role: "toolbar", "aria-label": t("ribbon.qat", "Barra de Ferramentas de Acesso Rápido") });
    for (const cmd of this.def.qat || ["undo", "redo"]) {
      const meta = this.meta(cmd);
      const b = this.h("button", { class: "fx-qb", type: "button", "aria-label": meta.label });
      b.append(this.icon(meta.icon));
      this.bindButton(b, cmd);
      this.attachTip(b, meta, cmd);
      this.register({ cmd, el: b, kind: "button" });
      qat.append(b);
    }
    tabbar.append(qat, this.h("div", { class: "fx-vsep" }));
    if (this.def.fileTab) {
      const ft = this.def.fileTab;
      const file = this.h("button", { class: "fx-tab fx-filetab", type: "button", id: "fx-tab-file", "aria-haspopup": "menu", "aria-expanded": "false", text: ft.label });
      this.bindMenu(file, () => this.def.menus[ft.menu], { cls: "fx-mfile", icons: true });
      this.attachTip(file, { label: ft.label, tip: ft.tip });
      this.fileButton = file;
      tabbar.append(file);
    }
    const tabs = this.h("div", { class: "fx-tabs", role: "tablist", "aria-label": t("ribbon.tabs", "Abas da faixa") });
    this.tabButtons = new Map();
    for (const tab of this.def.tabs) {
      const b = this.h("button", {
        class: "fx-tab",
        type: "button",
        role: "tab",
        id: "fx-tab-" + tab.id,
        "aria-controls": "fx-panel-" + tab.id,
        "aria-selected": tab.id == this.selectedTab ? "true" : "false",
        text: tab.label,
      });
      b.addEventListener("click", () => this.selectTab(tab.id, { toggle: true }));
      b.addEventListener("dblclick", () => this.onCommand("collapse", null, { source: b }));
      this.tabButtons.set(tab.id, b);
      tabs.append(b);
    }
    tabbar.append(tabs, this.h("div", { class: "fx-spacer" }));
    this.statusEl = this.h("div", { class: "fx-status", role: "status" });
    tabbar.append(this.statusEl);
    const more = this.h("button", { class: "fx-qb", type: "button", "aria-label": t("ribbon.more", "Mais opções da Faixa de Opções"), "aria-haspopup": "menu", "aria-expanded": "false" });
    more.append(this.icon("ellipsis"));
    this.bindMenu(more, () => this.def.menus.more, { cls: "fx-mmore" });
    this.attachTip(more, { label: t("ribbon.moreTip.label", "Mais opções"), tip: t("ribbon.moreTip.tip", "Barra de ferramentas e barra de menus do Thunderbird, opções da faixa, diagnóstico e recolher a faixa.") });
    const collapse = this.h("button", { class: "fx-qb", type: "button", "aria-label": t("ribbon.collapse", "Recolher a Faixa de Opções") });
    collapse.append(this.icon("chevron-up"));
    collapse.addEventListener("click", () => this.onCommand("collapse", null, { source: collapse }));
    this.collapseBtn = collapse;
    this.collapseTip = {
      label: t("ribbon.collapse", "Recolher a Faixa de Opções"),
      keys: ["Ctrl+F1"],
      tip: t("ribbon.collapseTip", "Mostra só os nomes das abas. Clique numa aba para abrir a faixa de novo."),
    };
    this.attachTip(collapse, this.collapseTip);
    tabbar.append(more, collapse);
    root.append(tabbar);

    // Painéis
    this.panels = new Map();
    this.groupsByTab = new Map();
    for (const tab of this.def.tabs) {
      this.currentTabGroups = [];
      this.groupsByTab.set(tab.id, this.currentTabGroups);
      const panel = this.h("div", {
        class: "fx-panel",
        role: "tabpanel",
        id: "fx-panel-" + tab.id,
        "aria-labelledby": "fx-tab-" + tab.id,
      });
      panel.hidden = tab.id != this.selectedTab;
      for (const group of tab.groups) {
        panel.append(this.renderGroup(group));
      }
      this.panels.set(tab.id, panel);
      root.append(panel);
    }

    // Camada de menus, dicas e aviso do pincel.
    this.layer = this.h("div", { class: "fx-layer", id: "faixa-layer" });
    this.hintEl = this.h("div", { class: "fx-hint", role: "status" });
    this.hintEl.hidden = true;
    this.layer.append(this.hintEl);
    root.append(this.layer);

    // O clique na faixa não tira o foco do corpo da mensagem (exceto nas caixas de texto
    // e nas janelas da faixa, como Selecionar Nomes).
    root.addEventListener("mousedown", e => {
      if (!e.target.closest("input, select, .fx-dialog")) {
        e.preventDefault();
      }
      this.hideTip();
    });

    const onDocDown = e => {
      // Um clique fora do item da prévia tira a Visualização Dinâmica (no item, o clique
      // aplica em seguida, sem o texto voltar no meio).
      if (!(e.target && e.target.closest && e.target.closest("[data-fx-preview]"))) {
        this.endPreview();
      }
      if (this.popup && !this.popup.contains(e.target) && !(this.popupAnchor && this.popupAnchor.contains(e.target))) {
        this.closePopup();
      }
      // Faixa recolhida aberta para escolher um comando: um clique fora fecha.
      if (!root.contains(e.target)) {
        this.endPeek();
      }
    };
    doc.addEventListener("mousedown", onDocDown, true);
    this.disposers.push(() => doc.removeEventListener("mousedown", onDocDown, true));
    const onBlur = () => {
      this.closePopup();
      this.hideTip();
    };
    this.win.addEventListener("blur", onBlur);
    this.disposers.push(() => this.win.removeEventListener("blur", onBlur));
    const onResize = () => {
      this.closePopup();
      this.scheduleFit();
    };
    this.win.addEventListener("resize", onResize);
    this.disposers.push(() => this.win.removeEventListener("resize", onResize));

    if (this.win.ResizeObserver) {
      const ro = new this.win.ResizeObserver(() => this.scheduleFit());
      ro.observe(root);
      this.disposers.push(() => ro.disconnect());
    }

    // Teclado: a faixa é uma parada só do Tab; as setas andam dentro dela.
    for (const el of root.querySelectorAll("button, input")) {
      el.setAttribute("tabindex", "-1");
    }
    this.setRoving(this.tabButtons.get(this.selectedTab));
    root.addEventListener("keydown", e => this.onRibbonKey(e));
    root.addEventListener("focusin", e => {
      if (this.zoneOf(e.target)) {
        this.setRoving(e.target);
      }
    });
    root.addEventListener("focusout", e => {
      // O foco saiu da faixa pelo teclado (F6, Tab): a espiada da faixa recolhida fecha.
      if (!e.relatedTarget || !root.contains(e.relatedTarget)) {
        this.win.setTimeout(() => {
          if (!root.contains(this.doc.activeElement)) {
            this.endPeek();
          }
        }, 0);
      }
    });
    if (this.config.recolhida) {
      this.toggleCollapse(true);
    }
    return root;
  }

  /** Botão Enviar para o cabeçalho (fora da raiz da faixa). */
  buildSendButton() {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const label = this.meta("send").label;
    const b = this.h("button", { id: "faixa-send", type: "button", "aria-label": label + " (Ctrl+Enter)" });
    b.append(this.icon("send-horizontal"), this.h("span", { text: label }));
    b.addEventListener("mousedown", e => e.preventDefault());
    b.addEventListener("click", () => this.onCommand("send", null, { source: b }));
    this.attachTip(b, { label, keys: ["Ctrl+Enter"], tip: t("send.tip", "Envia a mensagem para os destinatários.") });
    this.sendButton = b;
    return b;
  }

  renderGroup(group) {
    const g = this.h("div", {
      class: "fx-group" + (group.compact ? " fx-compactgroup" : ""),
      role: "group",
      "aria-label": group.label,
      "data-group": group.id,
    });
    const body = this.h("div", { class: "fx-gbody" });
    for (const item of group.items) {
      const el = this.renderItem(item);
      if (el) {
        body.append(el);
      }
    }
    // Janela estreita: o grupo vira um botão que abre o conteúdo num menu (como no Office).
    const gbtn = this.h("button", { class: "fx-large fx-gbtn", type: "button", "aria-label": group.label, "aria-haspopup": "true" });
    gbtn.append(this.icon(group.icon || this.firstIconOf(group) || "square", "fx-lg"));
    const lbl = this.h("span", { class: "fx-lbl" });
    lbl.append(this.h("span", { text: group.label }), this.icon("chevron-down", "fx-chev"));
    gbtn.append(lbl);
    gbtn.addEventListener("click", e => this.openGroupPopup(g, gbtn, body, e.detail == 0));
    g.append(gbtn, body, this.h("div", { class: "fx-glabel", text: group.label }));
    if (this.currentTabGroups) {
      this.currentTabGroups.push({ id: group.id, el: g, body, gbtn });
    }
    return g;
  }

  firstIconOf(group) {
    const walk = items => {
      for (const it of items) {
        if (it.items) {
          const r = walk(it.items);
          if (r) {
            return r;
          }
        } else if (it.rows) {
          for (const row of it.rows) {
            const r = walk(row);
            if (r) {
              return r;
            }
          }
        } else if (it.cmd && this.meta(it.cmd).icon) {
          return this.meta(it.cmd).icon;
        }
      }
      return null;
    };
    return walk(group.items);
  }

  openGroupPopup(g, anchor, body, kb = false) {
    if (this.popupAnchor == anchor && this.popup) {
      this.closePopup();
      return;
    }
    this.closePopup();
    const holder = this.h("div", { class: "fx-gpop", role: "group", "aria-label": g.getAttribute("aria-label") });
    holder.append(body);
    const pop = this.openPopup(anchor, holder, "fx-mgroup");
    if (!pop) {
      g.insertBefore(body, g.lastElementChild);
      return;
    }
    this.onPopupClose = () => g.insertBefore(body, g.lastElementChild);
    if (kb) {
      this.focusInPopup(pop);
    }
  }

  renderItem(item) {
    switch (item.type) {
      case "stack": {
        const col = this.h("div", { class: "fx-col" });
        for (const sub of item.items) {
          col.append(this.renderItem(sub));
        }
        return col;
      }
      case "rows": {
        const rows = this.h("div", { class: "fx-rows" });
        for (const row of item.rows) {
          const r = this.h("div", { class: "fx-row" });
          for (const sub of row) {
            r.append(this.renderItem(sub));
          }
          rows.append(r);
        }
        return rows;
      }
      case "sep":
        return this.h("div", { class: "fx-rsep", role: "separator" });
      case "large":
      case "largeMenu":
        return this.renderLarge(item);
      case "largeSplit":
        return this.renderLargeSplit(item);
      case "small":
      case "smallMenu":
        return this.renderSmall(item);
      case "icon":
      case "iconMenu":
        return this.renderIcon(item);
      case "iconSplit":
        return this.renderIconSplit(item);
      case "color":
        return this.renderColor(item);
      case "fontCombo":
        return this.renderFontCombo(item);
      case "sizeCombo":
        return this.renderSizeCombo(item);
      case "gallery":
        return this.renderGallery(item);
      case "note":
        return this.renderNote(item);
    }
    return null;
  }

  /** Aviso curto dentro de um grupo, visível só no estado dado (when), como o
   * "Formatação desativada" do grupo Formato no modo texto sem formatação. */
  renderNote(item) {
    const text = this.noteText(item.id);
    const el = this.h("div", { class: "fx-note", role: "note", "data-note": item.id });
    el.append(this.icon(item.icon || "info"), this.h("span", { class: "fx-lbl", text: text.label }));
    el.hidden = !this.matches(item.when);
    this.attachTip(el, { label: text.label, tip: text.tip });
    this.controls.push({ cmd: null, el, kind: "note", when: item.when });
    return el;
  }

  noteText(id) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    if (id == "plainNote") {
      return {
        label: t("format.plainNote", "Formatação desativada"),
        tip: t("format.plainNoteTip", "A mensagem vai como texto sem formatação. Para formatar de novo, escolha HTML."),
      };
    }
    return { label: id, tip: "" };
  }

  /** Liga clique → comando, com tratamento especial do pincel (duplo clique trava).
   * Pelo teclado (Enter ou Espaço, click com detail 0) o foco volta primeiro para onde
   * o usuário estava: o comando vale ali (Colar no Para cola no Para), como no Office. */
  bindButton(el, cmd, args) {
    el.addEventListener("click", e => {
      if (el.disabled) {
        return;
      }
      const inPopup = this.popup && this.popup.contains(el);
      const kb = e.detail == 0;
      if (kb) {
        this.returnFocus();
      }
      if (cmd == "painter") {
        this.onCommand("painter", { mode: e.detail >= 2 ? "lock" : "toggle" }, { source: el, keyboard: kb });
      } else {
        this.onCommand(cmd, args || null, { source: el, keyboard: kb });
      }
      if (inPopup && cmd != "painter") {
        this.closePopup();
      }
    });
  }

  /** Botão que abre um menu. Pelo teclado, o foco vai para o primeiro item. */
  bindMenu(el, entries, opts = {}) {
    el.addEventListener("click", e => {
      if (!el.disabled) {
        this.openMenu(el, entries(), Object.assign({}, opts, { focusFirst: e.detail == 0 }));
      }
    });
  }

  register(ctrl) {
    this.controls.push(ctrl);
    const meta = this.meta(ctrl.cmd);
    if (meta.phase) {
      ctrl.el.classList.add("fx-phase");
    }
    return ctrl;
  }

  renderLarge(item) {
    const meta = this.meta(item.cmd);
    const b = this.h("button", { class: "fx-large", type: "button", "aria-label": meta.label });
    b.append(this.icon(meta.icon, "fx-lg"));
    const lbl = this.h("span", { class: "fx-lbl" });
    // shortLabel: rótulo mais curto para o botão grande, quando a tradução é longa
    // demais para duas linhas (o nome acessível e a dica ficam com o rótulo inteiro).
    const text = this.h("span", { text: meta.shortLabel || meta.label });
    lbl.append(text);
    if (item.type == "largeMenu") {
      // A seta fica dentro do rótulo: embaixo dele (CSS) ou, na faixa estreita, logo depois
      // da última palavra, sem passar da altura do botão.
      text.append(this.icon("chevron-down", "fx-chev"));
      b.setAttribute("aria-haspopup", "menu");
      this.bindMenu(b, () => this.def.menus[meta.menu], { icons: true });
    } else {
      this.bindButton(b, item.cmd);
    }
    b.append(lbl);
    this.attachTip(b, meta, item.cmd);
    this.register({ cmd: item.cmd, el: b, kind: "button" });
    return b;
  }

  renderLargeSplit(item) {
    const meta = this.meta(item.cmd);
    const wrap = this.h("div", { class: "fx-lsplit" });
    const main = this.h("button", { class: "fx-main", type: "button", "aria-label": meta.label });
    main.append(this.icon(meta.icon, "fx-lg"));
    this.bindButton(main, item.cmd);
    const drop = this.h("button", { class: "fx-drop", type: "button", "aria-label": FaixaI18n.t("ribbon.optionsOf", "Opções de {name}", { name: meta.label }), "aria-haspopup": "menu" });
    drop.append(this.h("span", { text: meta.shortLabel || meta.label }, this.icon("chevron-down", "fx-chev")));
    this.bindMenu(drop, () => this.def.menus[item.menu], { icons: true });
    wrap.append(main, drop);
    this.attachTip(wrap, meta, item.cmd);
    this.register({ cmd: item.cmd, el: main, kind: "button", also: [drop] });
    return wrap;
  }

  renderSmall(item) {
    const meta = this.meta(item.cmd);
    const b = this.h("button", {
      // keepLabel: o rótulo fica mesmo com a janela estreita (o ícone sozinho não diz o que é).
      class: "fx-small" + (item.iconOnly ? " fx-icononly" : "") + (item.keepLabel ? " fx-keeplabel" : ""),
      type: "button",
      "aria-label": meta.label,
    });
    b.append(this.icon(meta.icon || "square"), this.h("span", { class: "fx-lbl", text: meta.shortLabel || meta.label }));
    if (item.type == "smallMenu") {
      b.append(this.icon("chevron-down", "fx-chev"));
      b.setAttribute("aria-haspopup", "menu");
      this.bindMenu(b, () => this.def.menus[meta.menu], { icons: true });
    } else {
      this.bindButton(b, item.cmd);
    }
    this.attachTip(b, meta, item.cmd);
    this.register({ cmd: item.cmd, el: b, kind: "button" });
    return b;
  }

  renderIcon(item) {
    const meta = this.meta(item.cmd);
    const b = this.h("button", { class: "fx-icon", type: "button", "aria-label": meta.label });
    b.append(this.icon(meta.icon || "square"));
    if (item.type == "iconMenu") {
      b.classList.add("fx-wide");
      b.append(this.icon("chevron-down", "fx-chev"));
      b.setAttribute("aria-haspopup", "menu");
      this.bindMenu(b, () => this.def.menus[meta.menu], { icons: true });
    } else {
      this.bindButton(b, item.cmd);
    }
    this.attachTip(b, meta, item.cmd);
    this.register({ cmd: item.cmd, el: b, kind: "button" });
    return b;
  }

  renderIconSplit(item) {
    const meta = this.meta(item.cmd);
    const wrap = this.h("div", { class: "fx-split" });
    const b = this.h("button", { class: "fx-icon", type: "button", "aria-label": meta.label });
    b.append(this.icon(meta.icon));
    this.bindButton(b, item.cmd);
    // A seta tem nome próprio: o título do menu ("Biblioteca de Marcadores") ou, sem
    // título, "Mais opções de Bordas"; o nome do botão sozinho repetiria o do lado.
    const arrowLabel = this.menuTitle(meta.menu) || FaixaI18n.t("ribbon.moreOf", "Mais opções de {name}", { name: meta.label });
    const arrow = this.h("button", { class: "fx-arrow", type: "button", "aria-label": arrowLabel, "aria-haspopup": "menu" });
    arrow.append(this.icon("chevron-down", "fx-chev"));
    this.bindMenu(arrow, () => this.def.menus[meta.menu], { icons: true });
    wrap.append(b, arrow);
    this.attachTip(wrap, meta, item.cmd);
    this.register({ cmd: item.cmd, el: b, kind: "button", also: [arrow] });
    return wrap;
  }

  menuTitle(menuId) {
    const head = (this.def.menus[menuId] || []).find(e => e.head);
    return head ? head.head : null;
  }

  renderColor(item) {
    const meta = this.meta(item.cmd);
    const wrap = this.h("div", { class: "fx-split" });
    const b = this.h("button", { class: "fx-icon fx-hasbar", type: "button", "aria-label": meta.label });
    b.append(this.icon(meta.icon));
    const bar = this.h("i", { class: "fx-cbar" });
    bar.style.setProperty("background", this.lastColor[item.cmd]);
    b.append(bar);
    b.addEventListener("click", () => {
      if (!b.disabled) {
        this.onCommand(item.cmd, { value: this.lastColor[item.cmd] }, { source: b });
      }
    });
    const arrow = this.h("button", { class: "fx-arrow", type: "button", "aria-label": FaixaI18n.t("ribbon.moreOf", "Mais opções de {name}", { name: meta.label }), "aria-haspopup": "dialog" });
    arrow.append(this.icon("chevron-down", "fx-chev"));
    arrow.addEventListener("click", e => this.openColorMenu(arrow, item.cmd, e.detail == 0));
    wrap.append(b, arrow);
    this.attachTip(wrap, meta, item.cmd);
    this.register({ cmd: item.cmd, el: b, kind: "color", bar, also: [arrow] });
    return wrap;
  }

  renderFontCombo(item) {
    const meta = this.meta(item.cmd);
    const box = this.h("div", { class: "fx-combo fx-cfont" });
    const input = this.h("input", { type: "text", "aria-label": meta.label, spellcheck: "false", autocomplete: "off" });
    const arrow = this.h("button", { class: "fx-arrow", type: "button", "aria-label": FaixaI18n.t("font.list", "Lista de fontes"), "aria-haspopup": "listbox" });
    arrow.append(this.icon("chevron-down", "fx-chev"));
    arrow.addEventListener("click", e => this.openFontMenu(arrow, input, e.detail == 0));
    this.bindComboInput(input, value => {
      const name = value.trim().replace(/^["']|["']$/g, "");
      if (name) {
        this.onCommand("fontName", { value: name }, { source: input });
      }
    });
    box.append(input, arrow);
    this.attachTip(box, meta, item.cmd);
    this.register({ cmd: item.cmd, el: input, kind: "fontCombo", box, also: [arrow] });
    return box;
  }

  renderSizeCombo(item) {
    const meta = this.meta(item.cmd);
    const box = this.h("div", { class: "fx-combo fx-csize" });
    const input = this.h("input", { type: "text", "aria-label": meta.label, inputmode: "decimal", autocomplete: "off" });
    const arrow = this.h("button", { class: "fx-arrow", type: "button", "aria-label": FaixaI18n.t("font.sizeList", "Lista de tamanhos"), "aria-haspopup": "listbox" });
    arrow.append(this.icon("chevron-down", "fx-chev"));
    arrow.addEventListener("click", e => this.openSizeMenu(arrow, input, e.detail == 0));
    this.bindComboInput(input, value => {
      const n = parseFloat(String(value).replace(",", "."));
      if (Number.isFinite(n) && n >= 1 && n <= 1638) {
        this.onCommand("fontSize", { value: Math.round(n * 2) / 2 }, { source: input });
      } else {
        this.updateControls();
      }
    });
    box.append(input, arrow);
    this.attachTip(box, meta, item.cmd);
    this.register({ cmd: item.cmd, el: input, kind: "sizeCombo", box, also: [arrow] });
    return box;
  }

  bindComboInput(input, apply) {
    input.addEventListener("focus", () => {
      input.select();
      this.hideTip();
    });
    // Modo de edição (as setas movem o cursor do texto): depois de digitar ou clicar.
    input.addEventListener("input", () => (this.textMode = input));
    input.addEventListener("mousedown", () => (this.textMode = input));
    input.addEventListener("blur", () => {
      if (this.textMode == input) {
        this.textMode = null;
      }
    });
    input.addEventListener("keydown", e => {
      if (e.key == "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.closePopup();
        const value = input.value;
        this.focusEditor();
        apply(value);
      } else if (e.key == "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.closePopup();
        this.updateControls(true);
        this.focusEditor();
      }
    });
    input.addEventListener("blur", () => this.win.setTimeout(() => this.updateControls(), 0));
  }

  renderGallery(item) {
    const meta = this.meta(item.cmd);
    const box = this.h("div", { class: "fx-gallery", role: "listbox", "aria-label": meta.label });
    const tiles = this.h("div", { class: "fx-tiles" });
    tiles.addEventListener("mouseleave", () => this.endPreview());
    this.galleryTiles = [];
    for (const style of this.def.styles) {
      const t = this.makeStyleTile(style);
      this.galleryTiles.push(t);
      tiles.append(t);
    }
    const nav = this.h("div", { class: "fx-gnav" });
    const up = this.h("button", { type: "button", "aria-label": FaixaI18n.t("styles.prevRow", "Linha anterior de estilos") });
    up.append(this.icon("chevron-up", "fx-chev"));
    const down = this.h("button", { type: "button", "aria-label": FaixaI18n.t("styles.nextRow", "Próxima linha de estilos") });
    down.append(this.icon("chevron-down", "fx-chev"));
    const all = this.h("button", { type: "button", "aria-label": FaixaI18n.t("styles.all", "Todos os estilos"), "aria-haspopup": "listbox" });
    all.append(this.icon("square-arrow-out-down-right", "fx-chev"));
    up.addEventListener("click", () => this.scrollGallery(-1));
    down.addEventListener("click", () => this.scrollGallery(1));
    all.addEventListener("click", e => this.openStylesMenu(all, e.detail == 0));
    nav.append(up, down, all);
    box.append(tiles, nav);
    this.galleryNav = { up, down };
    this.register({ cmd: item.cmd, el: box, kind: "gallery", also: [up, down, all] });
    this.win.setTimeout(() => this.scrollGallery(0), 0);
    return box;
  }

  makeStyleTile(style) {
    const t = this.h("button", { class: "fx-tile", type: "button", role: "option", "aria-label": style.label, "data-style": style.id });
    const prev = this.h("span", { class: "fx-tprev", text: "AaBbCc" });
    this.applyPreviewCss(prev, style.preview);
    t.append(prev, this.h("span", { class: "fx-tname", text: style.label }));
    t.addEventListener("click", e => {
      if (!t.disabled) {
        const kb = e.detail == 0 && this.doc.activeElement == t;
        this.closePopup();
        if (kb) {
          this.returnFocus();
        }
        this.onCommand("style", { value: style.id }, { source: t });
      }
    });
    this.bindPreview(t, "style", { value: style.id });
    const tip = style.kind == "char"
      ? FaixaI18n.t("styles.applyCharTip", "Aplica o estilo {name} ao texto selecionado (com o cursor numa palavra, à palavra inteira).", { name: style.label })
      : FaixaI18n.t("styles.applyTip", "Aplica o estilo {name} ao parágrafo.", { name: style.label });
    this.attachTip(t, { label: style.label, tip }, "style", { value: style.id });
    return t;
  }

  scrollGallery(delta) {
    if (!this.galleryTiles) {
      return;
    }
    const perPage = this.fitLevel >= 2 ? 3 : 4;
    const max = Math.max(0, this.galleryTiles.length - perPage);
    this.galleryOffset = Math.min(max, Math.max(0, this.galleryOffset + delta * perPage));
    this.galleryTiles.forEach((t, i) => {
      t.hidden = i < this.galleryOffset || i >= this.galleryOffset + perPage;
    });
    if (this.galleryNav) {
      this.galleryNav.up.disabled = this.galleryOffset == 0;
      this.galleryNav.down.disabled = this.galleryOffset >= max;
    }
  }

  /* ---------- abas e recolher ---------- */

  /** Troca de aba. Com a faixa recolhida, o clique (toggle) abre a aba por cima da
   * mensagem só para escolher um comando, como no Office; clicar de novo fecha. */
  selectTab(id, opts = {}) {
    const root = this.root;
    if (root.classList.contains("fx-collapsed") && (opts.toggle || opts.peek)) {
      if (opts.toggle && root.classList.contains("fx-peek") && id == this.selectedTab) {
        this.endPeek();
        return;
      }
      root.classList.add("fx-peek");
    }
    this.selectedTab = id;
    for (const [tid, b] of this.tabButtons) {
      b.setAttribute("aria-selected", tid == id ? "true" : "false");
    }
    for (const [tid, p] of this.panels) {
      p.hidden = tid != id;
    }
    // A parada do Tab fica na aba (um controle da aba anterior some junto com ela).
    if (!this.roving || !this.tabbar.contains(this.roving)) {
      this.setRoving(this.tabButtons.get(id));
    }
    this.closePopup();
    this.scheduleFit();
  }

  endPeek() {
    if (this.root && this.root.classList.contains("fx-peek")) {
      this.root.classList.remove("fx-peek");
      this.closePopup();
      this.ensureRoving();
    }
  }

  /** Recolhe ou fixa a faixa. Devolve se ficou recolhida. */
  toggleCollapse(force) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const collapsed = force ?? !this.root.classList.contains("fx-collapsed");
    const panel = this.panels.get(this.selectedTab);
    const focusInPanel = collapsed && !!panel && panel.contains(this.doc.activeElement);
    this.root.classList.toggle("fx-collapsed", collapsed);
    this.root.classList.remove("fx-peek");
    this.collapseBtn.replaceChildren(this.icon(collapsed ? "pin" : "chevron-up"));
    const label = collapsed ? t("ribbon.pin", "Fixar a Faixa de Opções") : t("ribbon.collapse", "Recolher a Faixa de Opções");
    this.collapseBtn.setAttribute("aria-label", label);
    if (this.collapseTip) {
      this.collapseTip.label = label;
      this.collapseTip.tip = collapsed
        ? t("ribbon.pinTip", "Deixa a faixa sempre aberta, com os comandos à mostra.")
        : t("ribbon.collapseTip", "Mostra só os nomes das abas. Clique numa aba para abrir a faixa de novo.");
    }
    this.closePopup();
    this.scheduleFit();
    if (focusInPanel) {
      this.tabButtons.get(this.selectedTab).focus(); // o controle com o foco sumiu junto com a faixa
    }
    this.ensureRoving();
    return collapsed;
  }

  /* ---------- teclado, como no Office ----------
   * A faixa é uma parada só do Tab (tabindex móvel). Na linha das abas, ← → andam
   * (e trocam de aba) e ↓ entra nos comandos da aba. Nos comandos, ← → seguem a
   * ordem da faixa e ↑ ↓ vão para o comando de cima ou de baixo; ↑ na primeira linha
   * volta para a aba. Esc volta um nível: dos comandos para a aba, da aba para onde
   * o usuário estava. F6 do Thunderbird passa pela faixa (ver o controlador). */

  /** "bar" (acesso rápido, Arquivo, abas), "panel" (comandos da aba) ou null. */
  zoneOf(el) {
    if (!el || !this.root) {
      return null;
    }
    if (this.tabbar && this.tabbar.contains(el)) {
      return "bar";
    }
    const panel = this.panels && this.panels.get(this.selectedTab);
    return panel && panel.contains(el) ? "panel" : null;
  }

  /** Controles que o teclado alcança na zona, na ordem da faixa. */
  focusables(zone) {
    const scope = zone == "bar" ? this.tabbar : this.panels.get(this.selectedTab);
    if (!scope) {
      return [];
    }
    return [...scope.querySelectorAll("button, input")].filter(el => !el.disabled && el.getClientRects().length > 0);
  }

  setRoving(el) {
    if (!el) {
      return;
    }
    if (this.roving && this.roving != el) {
      this.roving.setAttribute("tabindex", "-1");
    }
    this.roving = el;
    el.setAttribute("tabindex", "0");
  }

  /** Entrada na faixa pelo F6, como no Office: na aba escolhida. */
  focusRibbon() {
    const tab = this.tabButtons.get(this.selectedTab);
    tab.focus();
    if (this.doc.activeElement != tab) {
      // Gecko: com o foco num documento filho (o corpo), às vezes o foco só vem
      // depois que a própria janela recebe o foco.
      this.win.focus();
      tab.focus();
    }
    return this.doc.activeElement == tab;
  }

  /** A parada do Tab num controle que sumiu (faixa recolhida, grupo recolhido,
   * desativado) volta para a aba escolhida; se o foco estava nele, vai junto. */
  ensureRoving() {
    const r = this.roving;
    if (r && r.isConnected && !r.disabled && r.getClientRects().length > 0) {
      return;
    }
    const tab = this.tabButtons && this.tabButtons.get(this.selectedTab);
    if (!tab) {
      return;
    }
    const hadFocus = !!r && (this.doc.activeElement == r || !this.doc.activeElement || this.doc.activeElement == this.doc.body);
    this.setRoving(tab);
    if (hadFocus && r && this.root.contains(r)) {
      tab.focus();
    }
  }

  onRibbonKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey) {
      return;
    }
    const t = e.target;
    const zone = this.zoneOf(t);
    if (!zone) {
      return; // menus: onPopupKey
    }
    // Caixa de texto (Fonte, Tamanho) alcançada pelas setas: as setas continuam andando
    // pela faixa. Depois de digitar ou clicar nela, as setas movem o cursor do texto.
    const inputEl = t.localName == "input";
    const isInput = inputEl && this.textMode == t;
    const go = el => {
      e.preventDefault();
      if (el) {
        el.focus();
      }
    };
    if (e.altKey) {
      // Alt+↓ abre a lista da caixa (Fonte, Tamanho) ou o menu do botão.
      if (e.key == "ArrowDown") {
        const opener = inputEl ? t.parentElement.querySelector(".fx-arrow") : t.hasAttribute("aria-haspopup") ? t : null;
        if (opener && !opener.disabled) {
          e.preventDefault();
          opener.click();
        }
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        if (inputEl) {
          return; // a caixa de texto cuida (volta ao corpo)
        }
        e.preventDefault();
        if (zone == "panel") {
          this.tabButtons.get(this.selectedTab).focus();
        } else {
          this.endPeek();
          this.returnFocus();
        }
        return;
      case "ArrowLeft":
      case "ArrowRight": {
        if (isInput) {
          return;
        }
        const items = this.focusables(zone);
        if (!items.length) {
          return;
        }
        const rtl = this.win.getComputedStyle(this.root).direction == "rtl";
        const step = (e.key == "ArrowRight") != rtl ? 1 : -1;
        const next = items[(items.indexOf(t) + step + items.length) % items.length];
        go(next);
        if (next.getAttribute("role") == "tab") {
          this.selectTab(next.id.replace(/^fx-tab-/, ""));
        }
        return;
      }
      case "ArrowDown":
        if (zone == "bar") {
          if (t.getAttribute("role") == "tab") {
            if (this.root.classList.contains("fx-collapsed")) {
              this.selectTab(this.selectedTab, { peek: true });
            }
            go(this.focusables("panel")[0]);
          } else if (t.hasAttribute("aria-haspopup")) {
            e.preventDefault();
            t.click();
          }
          return;
        }
        if (!isInput && t.hasAttribute("aria-haspopup")) {
          e.preventDefault();
          t.click();
          return;
        }
        go(this.nearest(this.focusables("panel"), t, 1));
        return;
      case "ArrowUp":
        if (zone == "panel") {
          go(this.nearest(this.focusables("panel"), t, -1) || this.tabButtons.get(this.selectedTab));
        }
        return;
      case "Home":
      case "End": {
        if (isInput) {
          return;
        }
        const items = this.focusables(zone);
        go(e.key == "Home" ? items[0] : items[items.length - 1]);
        return;
      }
      case "Tab": {
        // Nos botões o Tab sai da faixa; nas caixas de texto passa ao controle seguinte.
        if (!inputEl) {
          return;
        }
        const items = this.focusables(zone);
        const next = items[items.indexOf(t) + (e.shiftKey ? -1 : 1)];
        if (next) {
          go(next);
        }
        return;
      }
    }
  }

  /** O controle de cima (dir -1) ou de baixo (dir 1), no mesmo grupo: na linha mais
   * perto, o que começa mais perto da mesma coluna (da caixa Fonte, ↓ vai ao Negrito). */
  nearest(list, from, dir) {
    const r0 = from.getBoundingClientRect();
    const group = from.closest(".fx-group, .fx-popup");
    const cands = [];
    for (const el of list) {
      if (el == from || (group && !group.contains(el))) {
        continue;
      }
      const r = el.getBoundingClientRect();
      const dy = dir > 0 ? r.top - r0.bottom : r0.top - r.bottom;
      if (dy >= -3) {
        cands.push({ el, r, dy });
      }
    }
    if (!cands.length) {
      return null;
    }
    const minDy = Math.min(...cands.map(c => c.dy));
    const row = cands.filter(c => c.dy <= minDy + 6);
    row.sort((a, b) => Math.abs(a.r.left - r0.left) - Math.abs(b.r.left - r0.left));
    return row[0].el;
  }

  /** Foco no item atual (ou no primeiro) de um menu aberto pelo teclado. */
  focusInPopup(pop, current = null) {
    const el = (current && pop.contains(current) && !current.disabled ? current : null) ||
      [...pop.querySelectorAll("button, input")].find(b => !b.disabled && b.getClientRects().length > 0);
    if (el) {
      el.focus();
    }
  }

  /** Depois de fechar um menu pelo teclado: o foco volta para o botão que o abriu. */
  focusAnchor(anchor) {
    if (anchor && anchor.isConnected && !anchor.disabled && anchor.getClientRects().length > 0) {
      anchor.focus();
      return;
    }
    const gbtn = anchor && anchor.closest(".fx-group") && anchor.closest(".fx-group").querySelector(".fx-gbtn");
    if (gbtn && gbtn.getClientRects().length > 0) {
      gbtn.focus();
    } else {
      this.returnFocus();
    }
  }

  /* ---------- ajuste à largura ---------- */

  scheduleFit() {
    if (this.fitPending) {
      return;
    }
    this.fitPending = true;
    this.win.requestAnimationFrame(() => {
      this.fitPending = false;
      this.fit();
    });
  }

  fit() {
    if (!this.root || !this.root.isConnected) {
      return;
    }
    if (this.onPopupClose) {
      // Um grupo recolhido está aberto num menu: reajusta quando o menu fechar.
      this.fitAfterPopup = true;
      return;
    }
    const panel = this.panels.get(this.selectedTab);
    if (!panel || panel.hidden) {
      return;
    }
    const root = this.root;
    root.classList.remove("fx-c1", "fx-c2", "fx-scroll");
    const groups = this.groupsByTab.get(this.selectedTab) || [];
    for (const g of groups) {
      g.el.classList.remove("fx-gcollapsed");
    }
    this.fitLevel = 0;
    const over = () => panel.scrollWidth > panel.clientWidth + 1;
    for (const cls of ["fx-c1", "fx-c2"]) {
      if (!over()) {
        break;
      }
      root.classList.add(cls);
      this.fitLevel++;
    }
    const tab = this.def.tabs.find(t => t.id == this.selectedTab);
    const order = (tab && tab.collapseOrder) || groups.map(g => g.id).reverse().slice(0, -1);
    for (const id of order) {
      if (!over()) {
        break;
      }
      const g = groups.find(x => x.id == id);
      if (g) {
        g.el.classList.add("fx-gcollapsed");
        this.fitLevel = 3;
      }
    }
    if (over()) {
      root.classList.add("fx-scroll");
      this.fitLevel = 4;
    }
    this.scrollGallery(0);
    this.ensureRoving();
  }

  /* ---------- estado ---------- */

  setState(state) {
    const theme = this.state.theme || "";
    this.state = Object.assign({}, this.state, state);
    if ((this.state.theme || "") != theme) {
      this.refreshStyleTiles();
    }
    this.updateControls();
  }

  /** As amostras da galeria de estilos com o tema atual (Alterar Estilos, Ctrl+Z, rascunho). */
  refreshStyleTiles() {
    for (const t of this.galleryTiles || []) {
      const style = this.def.styles.find(st => st.id == t.getAttribute("data-style"));
      const prev = t.querySelector(".fx-tprev");
      if (style && prev) {
        prev.removeAttribute("style");
        this.applyPreviewCss(prev, style.preview);
      }
    }
  }

  applyPreviewCss(el, css) {
    for (const decl of String(css || "").split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) {
        el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
      }
    }
  }

  isEnabled(cmd) {
    const meta = this.meta(cmd);
    const s = this.state;
    if (meta.phase) {
      return false;
    }
    // Enquanto a mensagem é enviada o Thunderbird trava a janela; a faixa também.
    if (s.locked && cmd != "collapse") {
      return false;
    }
    // Como no Outlook: com o foco no Para, no Assunto ou nos anexos, a formatação fica desativada.
    const inHeaders = s.focusArea == "headers";
    const html = !!(s.editorReady && s.isHTML && s.deliveryFormat != "plaintext" && (!inHeaders || meta.anyFocus));
    switch (meta.enabled) {
      case "html":
        return html;
      case "inTable":
        return html && !!s.inTable;
      case "inCell":
        return html && !!s.inCell;
      case "htmlEditor":
        return !!(s.editorReady && s.isHTML);
      case "editor":
        return !!s.editorReady;
      case "text":
        // Inserir texto (símbolo, emoji, data, partes rápidas): no corpo, em HTML ou texto puro.
        return !!(s.editorReady && !inHeaders);
      case "selectionBody":
        return !!(s.editorReady && !inHeaders && s.hasSelection);
      case "support":
        return !!s.support;
      case "selection":
        // Nos cabeçalhos, Recortar e Copiar valem para o campo com o foco (o Thunderbird decide).
        return inHeaders || !!s.hasSelection;
      case "canUndo":
        // No Para ou no Assunto, Desfazer vale para o campo (o Thunderbird decide se há o que desfazer).
        return inHeaders || !!s.canUndo;
      case "canRedo":
        return inHeaders || !!s.canRedo;
    }
    return true;
  }

  matches(rule) {
    if (!rule) {
      return false;
    }
    const s = this.state;
    if (typeof rule == "string") {
      return rule == "painter" ? s.painter > 0 : !!s[rule];
    }
    return Object.entries(rule).every(([k, v]) => (Array.isArray(v) ? v.includes(s[k]) : s[k] === v));
  }

  updateControls(forceInputs = false) {
    const s = this.state;
    let refit = false;
    for (const c of this.controls) {
      if (c.kind == "note") {
        const hide = !this.matches(c.when);
        if (c.el.hidden != hide) {
          c.el.hidden = hide;
          refit = true;
        }
        continue;
      }
      const meta = this.meta(c.cmd);
      const enabled = this.isEnabled(c.cmd);
      switch (c.kind) {
        case "button": {
          c.el.disabled = !enabled;
          for (const a of c.also || []) {
            a.disabled = !enabled;
          }
          if (meta.pressed) {
            c.el.setAttribute("aria-pressed", this.matches(meta.pressed) ? "true" : "false");
          }
          // Ícone que segue o estado (Bordas mostra a borda que o botão repete).
          if (meta.iconBy && c.el.classList.contains("fx-icon")) {
            const name = meta.iconBy.icons[s[meta.iconBy.state]] || meta.icon;
            if (c.iconName != name) {
              c.iconName = name;
              c.el.replaceChildren(this.icon(name));
            }
          }
          break;
        }
        case "color": {
          c.el.disabled = !enabled;
          for (const a of c.also) {
            a.disabled = !enabled;
          }
          c.bar.style.setProperty("background", this.lastColor[c.cmd] || "transparent");
          break;
        }
        case "fontCombo":
        case "sizeCombo": {
          c.el.disabled = !enabled;
          c.box.classList.toggle("fx-disabled", !enabled);
          for (const a of c.also) {
            a.disabled = !enabled;
          }
          const focused = this.doc.activeElement == c.el;
          if (!focused || forceInputs) {
            if (c.kind == "fontCombo") {
              c.el.value = enabled ? s.fontName || "" : "";
            } else {
              c.el.value = enabled && s.fontSize ? FaixaI18n.num(s.fontSize) : "";
            }
          }
          break;
        }
        case "gallery": {
          for (const t of this.galleryTiles || []) {
            t.disabled = !enabled;
            t.setAttribute("aria-pressed", enabled && s.styleId == t.getAttribute("data-style") ? "true" : "false");
          }
          for (const a of c.also) {
            a.disabled = !enabled;
          }
          if (enabled) {
            this.scrollGallery(0);
          }
          break;
        }
      }
    }
    if (this.sendButton) {
      this.sendButton.disabled = s.sendEnabled === false;
    }
    if (refit && this.root) {
      this.scheduleFit(); // o aviso que apareceu (ou sumiu) muda a largura do grupo
    }
    // A parada do Tab num controle que ficou desativado (foco no Para, envio) volta para a aba.
    if (this.roving && (this.roving.disabled || !this.roving.isConnected)) {
      this.ensureRoving();
    }
    const hint = s.painter == 2
      ? FaixaI18n.t("painter.lockedHint", "Pincel travado: clique ou arraste sobre o texto quantas vezes quiser. Esc encerra.")
      : s.painter == 1
        ? FaixaI18n.t("painter.activeHint", "Pincel ativo: clique numa palavra ou arraste sobre o texto. Esc cancela.")
        : "";
    this.setHint(hint);
  }

  setHint(text) {
    if (!this.hintEl) {
      return;
    }
    if (!text) {
      this.hintEl.hidden = true;
      return;
    }
    this.hintEl.replaceChildren(this.icon("paintbrush"), this.h("span", { text }));
    this.hintEl.hidden = false;
  }

  /** Mensagem curta na barra das abas (some sozinha). */
  flash(text, ms = 4000) {
    this.statusEl.textContent = text;
    this.win.clearTimeout(this.flashTimer);
    this.flashTimer = this.win.setTimeout(() => {
      this.statusEl.textContent = "";
    }, ms);
  }

  /* ---------- dicas ---------- */

  attachTip(el, meta, cmd, args) {
    el.addEventListener("mouseenter", () => {
      this.win.clearTimeout(this.tipTimer);
      this.tipTimer = this.win.setTimeout(() => this.showTip(el, meta, cmd, args), 550);
    });
    el.addEventListener("mouseleave", () => this.hideTip());
  }

  showTip(anchor, meta, cmd, args) {
    if (this.popup || !anchor.isConnected) {
      return;
    }
    this.hideTip();
    const keys = (meta.keys || []).map(k => this.shortcuts.display(k));
    if (cmd) {
      for (const k of this.keysFor(cmd, args)) {
        if (!keys.includes(k)) {
          keys.push(k);
        }
      }
    }
    const tip = this.h("div", { class: "fx-tip", role: "tooltip" });
    const title = this.h("div", { class: "fx-tt1", text: meta.label });
    if (keys.length) {
      title.append(this.h("span", { class: "fx-tk", text: " (" + keys.join(", ") + ")" }));
    }
    tip.append(title);
    if (meta.tip) {
      tip.append(this.h("div", { text: meta.tip }));
    }
    if (meta.phase) {
      tip.append(this.h("div", { class: "fx-tm", text: FaixaI18n.t("phase.tip", "Previsto para a fase {n} do projeto.", { n: meta.phase }) }));
    }
    this.layer.append(tip);
    const r = anchor.getBoundingClientRect();
    const w = tip.offsetWidth || 300;
    const left = Math.max(8, Math.min(r.left, this.win.innerWidth - w - 8));
    tip.style.setProperty("left", left + "px");
    tip.style.setProperty("top", Math.round(r.bottom + 6) + "px");
    this.tipEl = tip;
  }

  /** Atalhos de um comando para dicas e menus: os do perfil ativo (e do comando
   * equivalente, sameAs) e os do Thunderbird que o perfil não usa para outra coisa
   * (no perfil do Office em português, Ctrl+S sublinha: Salvar mostra Ctrl+B). */
  keysFor(cmd, args) {
    const meta = this.meta(cmd);
    const out = [...this.shortcuts.labelsFor(cmd, args)];
    if (meta.sameAs) {
      out.push(...this.shortcuts.labelsFor(meta.sameAs));
    }
    for (const k of meta.tbKeys || []) {
      const mine = this.shortcuts.map.get(FaixaShortcuts.normalize(k));
      if (mine && mine.cmd != cmd && mine.cmd != meta.sameAs) {
        continue;
      }
      const label = this.shortcuts.display(k);
      if (!out.includes(label)) {
        out.push(label);
      }
    }
    return out;
  }

  hideTip() {
    this.win.clearTimeout(this.tipTimer);
    if (this.tipEl) {
      this.tipEl.remove();
      this.tipEl = null;
    }
  }

  /* ---------- Visualização Dinâmica ---------- */

  /** Com o mouse ou o foco do teclado no item, o texto mostra o resultado do comando;
   * saindo, volta. Um pequeno atraso evita piscar ao passar por vários itens, e a troca
   * de um item para o vizinho não volta ao original no meio. */
  bindPreview(el, cmd, args) {
    el.setAttribute("data-fx-preview", cmd);
    const start = () => this.schedulePreview(cmd, args, el);
    const stop = () => this.schedulePreviewEnd();
    el.addEventListener("mouseenter", start);
    el.addEventListener("focus", start);
    el.addEventListener("mouseleave", stop);
    el.addEventListener("blur", stop);
  }

  schedulePreview(cmd, args, el) {
    if (!this.onPreview || (el && el.disabled) || !this.isEnabled(cmd)) {
      return;
    }
    this.win.clearTimeout(this.previewTimer);
    this.previewTimer = this.win.setTimeout(() => {
      this.previewTimer = 0;
      if (!el || (el.isConnected && !el.disabled)) {
        this.onPreview(cmd, args);
      }
    }, FAIXA_PREVIEW_DELAY);
  }

  schedulePreviewEnd() {
    this.win.clearTimeout(this.previewTimer);
    this.previewTimer = this.win.setTimeout(() => {
      this.previewTimer = 0;
      if (this.onPreviewEnd) {
        this.onPreviewEnd();
      }
    }, FAIXA_PREVIEW_DELAY);
  }

  /** Termina já (clique, Esc, menu fechado, mouse fora). */
  endPreview() {
    this.cancelPreviewTimer();
    if (this.onPreviewEnd) {
      this.onPreviewEnd();
    }
  }

  /** Prévia ou fim de prévia agendados não acontecem mais (um comando veio antes). */
  cancelPreviewTimer() {
    this.win.clearTimeout(this.previewTimer);
    this.previewTimer = 0;
  }

  /* ---------- menus ---------- */

  openPopup(anchor, content, cls = "") {
    if (this.popupAnchor == anchor && this.popup) {
      this.closePopup();
      return null;
    }
    const r = anchor.getBoundingClientRect();
    this.closePopup();
    this.hideTip();
    const pop = this.h("div", { class: ("fx-popup " + cls).trim() });
    pop.append(content);
    pop.addEventListener("mousedown", e => {
      if (!e.target.closest("input")) {
        e.preventDefault();
      }
    });
    pop.addEventListener("keydown", e => this.onPopupKey(e));
    // Mouse fora do menu: o texto volta na hora (entre dois itens, a troca espera um pouco).
    pop.addEventListener("mouseleave", () => this.endPreview());
    this.layer.append(pop);
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.left;
    if (left + w > this.win.innerWidth - 6) {
      left = Math.max(6, this.win.innerWidth - w - 6);
    }
    let top = r.bottom + 2;
    if (top + h > this.win.innerHeight - 6 && r.top - h - 2 > 6) {
      top = r.top - h - 2;
    }
    pop.style.setProperty("left", Math.round(left) + "px");
    pop.style.setProperty("top", Math.round(top) + "px");
    this.popup = pop;
    this.popupAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    return pop;
  }

  closePopup() {
    this.endPreview();
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
    if (this.onPopupClose) {
      const restore = this.onPopupClose;
      this.onPopupClose = null;
      restore();
    }
    if (this.popupAnchor) {
      this.popupAnchor.setAttribute("aria-expanded", "false");
      this.popupAnchor = null;
    }
    if (this.fitAfterPopup) {
      this.fitAfterPopup = false;
      this.scheduleFit();
    }
  }

  onPopupKey(e) {
    const pop = this.popup;
    if (!pop || e.ctrlKey || e.metaKey) {
      return;
    }
    const active = this.doc.activeElement;
    const inside = pop.contains(active);
    switch (e.key) {
      case "Escape": {
        e.preventDefault();
        e.stopPropagation();
        const anchor = this.popupAnchor;
        this.closePopup();
        if (inside) {
          this.focusAnchor(anchor);
        } else {
          this.focusEditor();
        }
        return;
      }
      case "Tab": {
        if (!inside) {
          return;
        }
        e.preventDefault();
        const anchor = this.popupAnchor;
        this.closePopup();
        this.focusAnchor(anchor);
        return;
      }
      case "ArrowDown":
      case "ArrowUp":
      case "ArrowLeft":
      case "ArrowRight":
      case "Home":
      case "End": {
        if (active && active.localName == "input" && pop.contains(active)) {
          return;
        }
        const items = [...pop.querySelectorAll("button")].filter(b => !b.disabled && b.getClientRects().length > 0);
        if (!items.length) {
          return;
        }
        // Paletas, estilos, grupos abertos e as grades de tabela, emoji e símbolo:
        // ↑ ↓ andam por linha, ← → pelo item.
        const grid = /\bfx-m(color|styles|group|grid)\b/.test(pop.className);
        if (!grid && (e.key == "ArrowLeft" || e.key == "ArrowRight")) {
          return;
        }
        e.preventDefault();
        const i = items.indexOf(active);
        let next;
        if (e.key == "Home") {
          next = items[0];
        } else if (e.key == "End") {
          next = items[items.length - 1];
        } else if (i < 0) {
          next = items[0];
        } else if (grid && (e.key == "ArrowDown" || e.key == "ArrowUp")) {
          next = this.nearest(items, active, e.key == "ArrowDown" ? 1 : -1);
        } else {
          const fwd = e.key == "ArrowDown" || e.key == "ArrowRight";
          next = items[(i + (fwd ? 1 : -1) + items.length) % items.length];
        }
        if (next) {
          next.focus();
        }
      }
    }
  }

  menuItem({ label, keys, checked, disabled, onPick, labelStyle, cls, title, icon, sub, preview }) {
    const b = this.h("button", { class: ("fx-mi " + (cls || "")).trim(), type: "button", role: checked == null ? "menuitem" : "menuitemcheckbox", title });
    if (checked != null) {
      b.setAttribute("aria-checked", checked ? "true" : "false");
    }
    const ck = this.h("span", { class: "fx-mck" });
    if (checked) {
      ck.append(this.icon("check", "fx-chev"));
    } else if (icon) {
      ck.append(this.icon(icon, "fx-mic"));
    }
    const lab = this.h("span", { class: "fx-mlab", text: label });
    if (labelStyle) {
      lab.style.setProperty("font-family", labelStyle);
    }
    if (sub) {
      // Segunda linha (o começo do texto de uma Parte Rápida), como a prévia da galeria do Outlook.
      b.classList.add("fx-mi2");
      b.append(ck, this.h("span", { class: "fx-mtwo" }, lab, this.h("span", { class: "fx-msub", text: sub })));
    } else {
      b.append(ck, lab);
    }
    if (keys) {
      b.append(this.h("span", { class: "fx-mkey", text: keys }));
    }
    b.disabled = !!disabled;
    if (preview) {
      this.bindPreview(b, preview.cmd, preview.args);
    }
    b.addEventListener("click", e => {
      if (!b.disabled) {
        // Escolhido pelo teclado: o foco estava no menu, que some; volta para onde o usuário estava.
        const kb = e.detail == 0 && b.contains(this.doc.activeElement);
        this.closePopup();
        if (kb) {
          this.returnFocus();
        }
        onPick();
      }
    });
    return b;
  }

  openMenu(anchor, entries, opts = {}) {
    if (!entries) {
      return;
    }
    // O controlador atualiza o estado que o menu mostra (anexos, contas do Filelink...).
    if (this.onBeforeMenu) {
      this.onBeforeMenu(entries);
    }
    const frag = this.doc.createDocumentFragment();
    let lastSep = true;
    const addSep = () => {
      if (!lastSep) {
        frag.append(this.h("div", { class: "fx-msep", role: "separator" }));
        lastSep = true;
      }
    };
    for (const entry of entries) {
      if (entry.head) {
        frag.append(this.h("div", { class: "fx-mhead", text: entry.head }));
        lastSep = true;
        continue;
      }
      if (entry.sep) {
        addSep();
        continue;
      }
      if (entry.when && !this.state[entry.when]) {
        continue;
      }
      if (entry.dynamic) {
        for (const item of this.dynamicItems(entry.dynamic, anchor)) {
          if (item.note) {
            frag.append(this.h("div", { class: "fx-mnote", text: item.note }));
          } else {
            frag.append(this.menuItem(Object.assign(item, { icon: opts.icons ? item.icon : null })));
          }
          lastSep = false;
        }
        continue;
      }
      if (entry.custom) {
        const part = this.customPart(entry.custom, anchor);
        if (part) {
          frag.append(part);
          lastSep = false;
        }
        continue;
      }
      const meta = this.meta(entry.cmd);
      const keys = entry.keys ? this.shortcuts.display(entry.keys) : this.keysFor(entry.cmd, entry.args)[0];
      const checked = entry.checked ? this.matches(entry.checked) : null;
      const phase = meta.phase ? FaixaI18n.t("phase.menu", " (fase {n})", { n: meta.phase }) : "";
      // Comando que alterna (Adicionar/Remover Espaço...): o rótulo segue o estado.
      let label = meta.state && meta.labelOn && this.state[meta.state] ? meta.labelOn : entry.label || meta.label;
      if (entry.cmd == "collapse" && this.root.classList.contains("fx-collapsed")) {
        label = FaixaI18n.t("ribbon.pin", "Fixar a Faixa de Opções");
      }
      frag.append(this.menuItem({
        label: label + phase,
        keys: keys || null,
        checked,
        icon: opts.icons ? entry.icon || meta.icon : null,
        disabled: !this.isEnabled(entry.cmd) || (!!entry.enabledWhen && !this.state[entry.enabledWhen]),
        onPick: () => this.onCommand(entry.cmd, entry.args || null, { source: anchor }),
      }));
      lastSep = false;
    }
    if (lastSep && frag.lastChild && frag.lastChild.classList && frag.lastChild.classList.contains("fx-msep")) {
      frag.lastChild.remove();
    }
    // Menu com grade (tabela, emoji, símbolo): as setas andam pela grade.
    const grid = entries.some(e => e.custom) ? " fx-mgrid" : "";
    const pop = this.openPopup(anchor, frag, (opts.cls || "") + grid);
    if (pop) {
      pop.setAttribute("role", "menu");
      if (opts.focusFirst) {
        const first = pop.querySelector("button:not(:disabled)");
        if (first) {
          first.focus();
        }
      }
    }
  }

  /** Itens de menu montados na hora (contas do Filelink, assinaturas). */
  dynamicItems(kind, anchor) {
    if (kind == "cloud") {
      return (this.state.cloudAccounts || []).map(acc => ({
        label: acc.name + "…",
        icon: this.meta("attachCloud").icon,
        disabled: !this.isEnabled("attachCloud"),
        onPick: () => this.onCommand("attachCloud", { id: acc.id }, { source: anchor }),
      }));
    }
    if (kind == "signatures") {
      // Como no Outlook: só os nomes; as da organização com a dica de onde vieram.
      return (this.state.signatures || []).map(s => ({
        label: s.nome,
        title: s.gerenciada ? FaixaI18n.t("signature.managed", "Assinatura definida pela sua organização") : null,
        disabled: !this.isEnabled("insertSignature"),
        onPick: () => this.onCommand("insertSignature", { id: s.id }, { source: anchor }),
      }));
    }
    if (kind == "quickParts") {
      // A galeria: o nome e o começo do texto de cada parte; as da organização marcadas.
      const parts = this.state.quickParts || [];
      if (!parts.length) {
        return [{ note: FaixaI18n.t("qp.none", "Ainda não há Partes Rápidas. Selecione um texto na mensagem e salve-o na galeria.") }];
      }
      return parts.map(p => ({
        label: p.nome,
        sub: p.preview || null,
        title: p.gerenciada ? FaixaI18n.t("qp.managed", "Parte Rápida definida pela sua organização") : null,
        disabled: !this.isEnabled("insertQuickPart"),
        onPick: () => this.onCommand("insertQuickPart", { id: p.id }, { source: anchor }),
      }));
    }
    return [];
  }

  /* ---------- grades dos menus: tabela, emoji e símbolo ---------- */

  customPart(kind, anchor) {
    switch (kind) {
      case "changeStyles":
        return this.changeStylesPart(anchor);
      case "tableGrid":
        return this.tableGrid(anchor);
      case "emojiGrid":
        return this.glyphGrid(anchor, "insertEmoji", this.emojiGroups(), true);
      case "symbolGrid":
        return this.glyphGrid(anchor, "insertSymbol", [{ items: this.symbolList() }], false);
    }
    return null;
  }

  /** Alterar Estilos: as quatro partes do tema lado a lado, como os submenus do Outlook:
   * Conjunto de Estilos, Cores (com as cores de cada tema), Fontes (o nome na fonte dos
   * títulos, e as duas fontes embaixo) e Espaçamento entre Parágrafos (com os valores). A
   * escolha da mensagem vem marcada. As setas andam pela grade. */
  changeStylesPart(anchor) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const cs = this.def.changeStyles || {};
    const theme = this.def.theme || {};
    const state = theme.state || {};
    const enabled = this.isEnabled("changeStyles");
    const box = this.h("div", { class: "fx-csgrid" });
    const column = (part, head, items, extra) => {
      const col = this.h("div", { class: "fx-cscol", role: "group", "aria-label": head });
      col.append(this.h("div", { class: "fx-mhead", text: head }));
      for (const [i, o] of (items || []).entries()) {
        const more = extra ? extra(o, i) : {};
        const b = this.menuItem(Object.assign({
          label: o.label,
          checked: state[part] == o.id,
          disabled: !enabled,
          onPick: () => this.onCommand("changeStyles", { part, id: o.id }, { source: anchor }),
        }, more));
        if (more.strip) {
          b.querySelector(".fx-mlab").before(more.strip);
        }
        col.append(b);
      }
      box.append(col);
    };
    column("set", t("changeStyles.set", "Conjunto de Estilos"), cs.styleSets);
    column("colors", t("changeStyles.colors", "Cores"), cs.colors, o => {
      const strip = this.h("span", { class: "fx-csstrip", "aria-hidden": "true" });
      for (const c of (o.colors || []).slice(2)) {
        strip.append(this.h("i", { style: { background: c } }));
      }
      return { strip };
    });
    // As do Office (o padrão) deixam o corpo na fonte padrão das Opções da Faixa.
    const defaultBody = (this.config.fontePadrao && this.config.fontePadrao.familia) || "";
    column("fonts", t("changeStyles.fonts", "Fontes"), cs.fonts, (o, i) => ({
      labelStyle: FaixaThemes.fontStack(o.major, this.def.fontFallbacks),
      sub: t("changeStyles.fontPair", "Títulos: {major} · Corpo: {minor}", { major: o.major, minor: (i == 0 && defaultBody) || o.minor }),
    }));
    column("spacing", t("changeStyles.spacing", "Espaçamento entre Parágrafos"), cs.spacing, o => {
      if (o.after == null) {
        return { sub: t("changeStyles.spacingDefault", "Como nas Opções da Faixa") };
      }
      return {
        sub: t("changeStyles.spacingValues", "Depois: {after} pt · Entre linhas: {line}", {
          after: FaixaI18n.num(o.after),
          line: FaixaI18n.num(o.line ? (o.line == 1.15 ? "1.15" : Number(o.line).toFixed(1)) : "1.0"),
        }),
      };
    });
    return box;
  }

  /** Escolha feita numa grade (clique ou Enter): fecha o menu e, pelo teclado, devolve
   * o foco para onde o usuário estava antes de executar. */
  pickFromGrid(e, run) {
    const kb = !!e && e.detail == 0 && !!this.popup && this.popup.contains(this.doc.activeElement);
    this.closePopup();
    if (kb) {
      this.returnFocus();
    }
    run();
  }

  /** Grade de Tabela, como no Word: passar o mouse (ou as setas) marca colunas × linhas;
   * o clique (ou Enter) insere a tabela desse tamanho. */
  tableGrid(anchor) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const size = this.def.tableGrid || {};
    const cols = size.cols || 10;
    const rows = size.rows || 8;
    const enabled = this.isEnabled("insertTable");
    const head = this.h("div", { class: "fx-mhead fx-tglabel", text: t("table.gridHead", "Inserir Tabela") });
    const grid = this.h("div", { class: "fx-tablegrid" });
    grid.style.setProperty("--fx-tgcols", String(cols));
    const cells = [];
    const mark = (c, r) => {
      for (const cell of cells) {
        cell.el.classList.toggle("fx-on", cell.c <= c && cell.r <= r);
      }
      head.textContent = c && r ? t("table.size", "Tabela {cols}×{rows}", { cols: c, rows: r }) : t("table.gridHead", "Inserir Tabela");
    };
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const b = this.h("button", { class: "fx-tgcell", type: "button", role: "menuitem", "aria-label": t("table.size", "Tabela {cols}×{rows}", { cols: c, rows: r }) });
        b.disabled = !enabled;
        b.addEventListener("mouseenter", () => mark(c, r));
        b.addEventListener("focus", () => mark(c, r));
        b.addEventListener("click", e => {
          if (!b.disabled) {
            this.pickFromGrid(e, () => this.onCommand("insertTable", { cols: c, rows: r }, { source: anchor }));
          }
        });
        cells.push({ el: b, c, r });
        grid.append(b);
      }
    }
    grid.addEventListener("mouseleave", () => {
      if (!grid.contains(this.doc.activeElement)) {
        mark(0, 0);
      }
    });
    const box = this.h("div", { class: "fx-tgbox" });
    box.append(head, grid);
    return box;
  }

  /** Emojis por grupo, com os nomes no idioma da faixa. */
  emojiGroups() {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const names = {
      faces: () => t("emoji.faces", "Carinhas"),
      gestures: () => t("emoji.gestures", "Gestos"),
      objects: () => t("emoji.objects", "Símbolos e objetos"),
    };
    return (this.def.emoji || []).map(g => ({ head: names[g.id] ? names[g.id]() : "", items: g.items || [] }));
  }

  /** Símbolos do menu, como no Word: os usados por último primeiro, depois os de sempre. */
  symbolList() {
    const base = this.def.symbols || [];
    const recent = FaixaUI.recentSymbols || [];
    return [...recent, ...base.filter(s => !recent.includes(s))].slice(0, Math.max(20, base.length));
  }

  glyphGrid(anchor, cmd, groups, emoji) {
    const t = FaixaI18n.t.bind(FaixaI18n);
    const frag = this.doc.createDocumentFragment();
    const enabled = this.isEnabled(cmd);
    for (const g of groups) {
      if (g.head) {
        frag.append(this.h("div", { class: "fx-mhead", text: g.head }));
      }
      const grid = this.h("div", { class: "fx-glyphs" + (emoji ? " fx-emojis" : "") });
      for (const ch of g.items) {
        const b = this.h("button", { class: "fx-glyph", type: "button", role: "menuitem", "aria-label": ch, title: ch, text: ch });
        b.disabled = !enabled;
        b.addEventListener("click", e => {
          if (b.disabled) {
            return;
          }
          this.pickFromGrid(e, () => {
            if (!emoji) {
              FaixaUI.recentSymbols = [ch, ...(FaixaUI.recentSymbols || []).filter(x => x != ch)].slice(0, 20);
            }
            this.onCommand(cmd, { text: ch }, { source: anchor });
          });
        });
        grid.append(b);
      }
      frag.append(grid);
    }
    if (emoji) {
      // Os outros emojis ficam no seletor do sistema, que também funciona no corpo da mensagem.
      const hint = this.platform == "win"
        ? t("emoji.more.win", "Mais emojis: tecla do Windows + . (ponto)")
        : this.platform == "macosx"
          ? t("emoji.more.mac", "Mais emojis: Control + Command + Espaço")
          : "";
      if (hint) {
        frag.append(this.h("div", { class: "fx-mnote", text: hint }));
      }
    }
    return frag;
  }

  openColorMenu(anchor, cmd, kb = false) {
    const meta = this.meta(cmd);
    const palettes = this.def.palettes || {};
    const frag = this.doc.createDocumentFragment();
    const pick = (color, e) => {
      // Escolhida pelo teclado: o foco estava na amostra, que some com o menu.
      const kb = !!e && e.detail == 0 && !!this.popup && this.popup.contains(this.doc.activeElement);
      this.closePopup();
      if (kb) {
        this.returnFocus();
      }
      if (color) {
        this.lastColor[cmd] = color;
      }
      this.onCommand(cmd, { value: color || null }, { source: anchor });
      this.updateControls();
    };
    if (meta.palette == "highlight") {
      const p = palettes.highlight;
      const grid = this.h("div", { class: "fx-hgrid" });
      for (const c of p.colors) {
        const sw = this.h("button", { class: "fx-sw fx-swlg", type: "button", "aria-label": c, title: c });
        sw.style.setProperty("background", c);
        sw.addEventListener("click", e => pick(c, e));
        this.bindPreview(sw, cmd, { value: c });
        grid.append(sw);
      }
      frag.append(grid, this.h("div", { class: "fx-msep" }));
      frag.append(this.menuItem({ label: p.none, onPick: () => pick(null), preview: { cmd, args: { value: null } } }));
      const hpop = this.openPopup(anchor, frag, "fx-mcolor");
      if (hpop && kb) {
        this.focusInPopup(hpop);
      }
      return;
    }
    const p = palettes.font;
    // Cor da Fonte começa por Automático; Sombreamento, por Sem Cor (como no Word).
    const none = meta.palette == "shading" ? (palettes.shading || {}).none || p.automatic : p.automatic;
    frag.append(this.menuItem({ label: none, onPick: () => pick(null), preview: { cmd, args: { value: null } } }));
    frag.append(this.h("div", { class: "fx-mhead", text: FaixaI18n.t("color.theme", "Cores do Tema") }));
    const tgrid = this.h("div", { class: "fx-tgrid" });
    p.theme.forEach((row, i) => {
      const r = this.h("div", { class: "fx-trow" + (i == 0 ? " fx-base" : "") });
      for (const c of row) {
        const sw = this.h("button", { class: "fx-sw", type: "button", "aria-label": c, title: c });
        sw.style.setProperty("background", c);
        sw.addEventListener("click", e => pick(c, e));
        this.bindPreview(sw, cmd, { value: c });
        r.append(sw);
      }
      tgrid.append(r);
    });
    frag.append(tgrid, this.h("div", { class: "fx-mhead", text: FaixaI18n.t("color.standard", "Cores Padrão") }));
    const srow = this.h("div", { class: "fx-trow", style: { padding: "2px 6px 6px" } });
    for (const c of p.standard) {
      const sw = this.h("button", { class: "fx-sw", type: "button", "aria-label": c, title: c });
      sw.style.setProperty("background", c);
      sw.addEventListener("click", e => pick(c, e));
      this.bindPreview(sw, cmd, { value: c });
      srow.append(sw);
    }
    frag.append(srow, this.h("div", { class: "fx-msep" }));
    frag.append(this.menuItem({
      label: FaixaI18n.t("color.more", "Mais Cores…"),
      onPick: () => this.pickCustomColor(cmd, pick),
    }));
    const pop = this.openPopup(anchor, frag, "fx-mcolor");
    if (pop && kb) {
      this.focusInPopup(pop);
    }
  }

  pickCustomColor(cmd, pick) {
    const input = this.h("input", { type: "color", value: this.lastColor[cmd] || "#000000", style: { position: "fixed", left: "-100px", top: "0" } });
    this.layer.append(input);
    input.addEventListener("change", () => {
      pick(input.value.toUpperCase());
      input.remove();
    });
    input.addEventListener("blur", () => this.win.setTimeout(() => input.remove(), 1000));
    input.click();
  }

  async openFontMenu(anchor, input, kb = false) {
    const frag = this.doc.createDocumentFragment();
    const current = (this.state.fontName || "").toLowerCase();
    const add = (name, note) => {
      const item = this.menuItem({
        label: note ? name + "  (" + note + ")" : name,
        labelStyle: '"' + name.replace(/"/g, "") + '", sans-serif',
        cls: name.toLowerCase() == current ? "fx-current" : "",
        preview: { cmd: "fontName", args: { value: name } },
        onPick: () => {
          this.focusEditor();
          this.onCommand("fontName", { value: name }, { source: anchor });
        },
      });
      frag.append(item);
    };
    frag.append(this.h("div", { class: "fx-mhead", text: FaixaI18n.t("font.theme", "Fontes do Tema") }));
    for (const f of this.def.themeFonts || []) {
      add(f.name, f.note);
    }
    frag.append(this.h("div", { class: "fx-mhead", text: FaixaI18n.t("font.all", "Todas as Fontes") }));
    const loading = this.h("div", { class: "fx-mnote", text: FaixaI18n.t("font.loading", "Carregando as fontes instaladas…") });
    frag.append(loading);
    const pop = this.openPopup(anchor, frag, "fx-mfont");
    if (!pop) {
      return;
    }
    pop.setAttribute("role", "menu");
    if (kb) {
      this.focusInPopup(pop, pop.querySelector(".fx-current"));
    }
    let fonts = [];
    try {
      fonts = await this.getFonts();
    } catch (e) {
      fonts = [];
    }
    if (this.popup != pop) {
      return;
    }
    const list = this.doc.createDocumentFragment();
    const seen = new Set();
    for (const name of fonts) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const item = this.menuItem({
        label: name,
        labelStyle: '"' + name.replace(/"/g, "") + '", sans-serif',
        cls: name.toLowerCase() == current ? "fx-current" : "",
        preview: { cmd: "fontName", args: { value: name } },
        onPick: () => {
          this.focusEditor();
          this.onCommand("fontName", { value: name }, { source: anchor });
        },
      });
      list.append(item);
    }
    if (!seen.size) {
      loading.textContent = FaixaI18n.t("font.none", "Nenhuma fonte encontrada.");
      return;
    }
    const hadFocus = pop.contains(this.doc.activeElement);
    loading.replaceWith(list);
    const cur = pop.querySelector(".fx-current");
    if (cur) {
      cur.scrollIntoView({ block: "center" });
      if (kb && !hadFocus) {
        cur.focus();
      }
    }
  }

  openSizeMenu(anchor, input, kb = false) {
    const frag = this.doc.createDocumentFragment();
    const cur = this.state.fontSize;
    for (const size of this.def.fontSizes) {
      frag.append(this.menuItem({
        label: FaixaI18n.num(size),
        cls: size == cur ? "fx-current" : "",
        preview: { cmd: "fontSize", args: { value: size } },
        onPick: () => {
          this.focusEditor();
          this.onCommand("fontSize", { value: size }, { source: anchor });
        },
      }));
    }
    const pop = this.openPopup(anchor, frag, "fx-msize");
    if (!pop) {
      return;
    }
    pop.setAttribute("role", "menu");
    const c = pop.querySelector(".fx-current");
    if (c) {
      c.scrollIntoView({ block: "center" });
    }
    if (kb) {
      this.focusInPopup(pop, c);
    }
  }

  openStylesMenu(anchor, kb = false) {
    const grid = this.h("div", { class: "fx-sgrid" });
    for (const style of this.def.styles) {
      const t = this.makeStyleTile(style);
      t.setAttribute("aria-pressed", this.state.styleId == style.id ? "true" : "false");
      grid.append(t);
    }
    const pop = this.openPopup(anchor, grid, "fx-mstyles");
    if (pop && kb) {
      this.focusInPopup(pop, grid.querySelector('[aria-pressed="true"]'));
    }
  }

  /* ---------- limpeza ---------- */

  dispose() {
    if (this.dialog) {
      this.dialog.close(null);
    }
    this.closePopup();
    this.endPreview();
    this.onPreview = null;
    this.onPreviewEnd = null;
    this.hideTip();
    for (const d of this.disposers) {
      try {
        d();
      } catch (e) {}
    }
    this.disposers = [];
    this.win.clearTimeout(this.flashTimer);
    if (this.root) {
      this.root.remove();
    }
    if (this.sendButton) {
      this.sendButton.remove();
    }
  }
};
