/* Stubs mínimos para carregar implementation.js fora do Thunderbird. */
"use strict";
var ChromeUtils = {
  importESModule() {
    return { ExtensionSupport: {}, NetUtil: {}, ExtensionUtils: { ExtensionError: Error } };
  },
  generateQI() {
    return function () {
      return this;
    };
  },
};
var ExtensionAPIPersistent = class {};
var SimEmitter = class {
  constructor() {
    this.map = new Map();
  }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
  }
  off(ev, fn) {
    this.map.get(ev)?.delete(fn);
  }
  emit(ev, ...args) {
    for (const fn of this.map.get(ev) || []) fn(ev, ...args);
  }
};
var ExtensionCommon = { EventEmitter: SimEmitter, EventManager: class { api() { return {}; } } };
var AppConstants = { platform: "linux" };
var Ci = {
  nsIMsgCompDeliverMode: { Now: 0, Later: 1, Save: 2, SaveAs: 3, SaveAsDraft: 4, SaveAsTemplate: 5, SendUnsent: 6, AutoSaveAsDraft: 7, Background: 8 },
  nsIHTMLEditor: {},
};
/* xulstore em memória: url|id|atributo -> valor ("-moz-missing\n" = atributo ausente). */
var SimXulStore = class {
  constructor() {
    this.map = new Map();
  }
  hasValue(url, id, attr) {
    return this.map.has(url + "|" + id + "|" + attr);
  }
  getValue(url, id, attr) {
    return this.map.get(url + "|" + id + "|" + attr) || "";
  }
  setValue(url, id, attr, value) {
    this.map.set(url + "|" + id + "|" + attr, String(value));
  }
  removeValue(url, id, attr) {
    this.map.delete(url + "|" + id + "|" + attr);
  }
  persist(node, attr) {
    const value = node.getAttribute(attr);
    this.setValue(node.ownerDocument.documentURI, node.id, attr, value === null ? "-moz-missing\n" : value);
  }
};
var Services = { appinfo: { name: "Simulador", version: "153.0" }, locale: { appLocaleAsBCP47: "pt-BR" }, xulStore: new SimXulStore() };
