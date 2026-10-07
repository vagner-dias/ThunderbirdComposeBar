/* Faixa de Opções — página de eventos (Manifest V3).
 *
 * Envia a configuração ao experiment e executa os comandos de mensagem da faixa
 * pela API compose oficial (prioridade, formato de envio). Os ouvintes são
 * registrados no topo do script: assim o Thunderbird acorda esta página quando
 * a faixa dispara um comando com o background suspenso. */

import { loadConfig, saveUser, readQuickParts, saveQuickParts, webURL, withLock, QUICK_PARTS_KEY } from "./lib/config.js";

async function pushConfig() {
  try {
    const { config } = await loadConfig();
    await browser.faixa.configure(config);
  } catch (e) {
    console.error("[Faixa] configuração", e);
  }
}

async function messageState(tabId) {
  const d = await browser.compose.getComposeDetails(tabId);
  return {
    priority: d.priority || "normal",
    deliveryFormat: d.deliveryFormat || "auto",
    returnReceipt: !!d.returnReceipt,
    dsn: !!d.deliveryStatusNotification,
    isPlainText: !!d.isPlainText,
  };
}

async function pushMessageState(tabId) {
  try {
    await browser.faixa.setMessageState(tabId, await messageState(tabId));
  } catch (e) {
    console.warn("[Faixa] estado da mensagem", tabId, e);
  }
}

/** Abre uma página do complemento numa aba da janela principal e traz essa janela
 * para a frente (o pedido vem de uma janela de composição, que ficaria por cima).
 * Sem janela principal aberta, a página abre numa janela própria. */
async function openPage(path, open) {
  let tab = null;
  try {
    tab = await open();
  } catch (e) {
    console.warn("[Faixa] abrir", path, e);
    await browser.windows.create({ url: browser.runtime.getURL(path), type: "popup", width: 980, height: 820 });
    return;
  }
  try {
    const windowId = tab && tab.windowId != null
      ? tab.windowId
      : (await browser.windows.getLastFocused({ windowTypes: ["normal"] })).id;
    await browser.windows.update(windowId, { focused: true });
  } catch (e) {}
}

async function onCommand(tabId, command, args = {}) {
  try {
    switch (command) {
      case "_ping":
        await browser.faixa.setMessageState(tabId, { _pong: args.nonce });
        return;
      case "openOptions":
        await openPage("options/opcoes.html", () => browser.runtime.openOptionsPage());
        return;
      case "openDiagnostics":
        await openPage("options/diagnostico.html", () => browser.tabs.create({ url: browser.runtime.getURL("options/diagnostico.html") }));
        return;
      case "openSignatures":
        await openPage("options/assinaturas.html", () => browser.tabs.create({ url: browser.runtime.getURL("options/assinaturas.html") }));
        return;
      case "openQuickParts":
        await openPage("options/partes.html", () => browser.tabs.create({ url: browser.runtime.getURL("options/partes.html") }));
        return;
      case "openShortcuts":
        await openPage("options/diagnostico.html#atalhos", () => browser.tabs.create({ url: browser.runtime.getURL("options/diagnostico.html#atalhos") }));
        return;
      case "openHelp": {
        // A ajuda da organização (política suporte.ajuda), no navegador do sistema; sem ela,
        // a da faixa. (O Thunderbird só recusa endereço inválido; se o navegador não abrir,
        // ele não avisa.)
        const { config } = await loadConfig();
        const url = webURL(config.suporte && config.suporte.ajuda);
        if (url) {
          try {
            await browser.windows.openDefaultBrowser(url);
            return;
          } catch (e) {
            console.warn("[Faixa] ajuda da organização", url, e);
          }
        }
        await openPage("options/ajuda.html", () => browser.tabs.create({ url: browser.runtime.getURL("options/ajuda.html") }));
        return;
      }
      case "openSupport": {
        // Só o que a política define: o e-mail ou o portal do suporte.
        const { config } = await loadConfig();
        const s = config.suporte || {};
        if (args.what == "mail" && s.email) {
          const manifest = browser.runtime.getManifest();
          await browser.compose.beginNew({ to: [String(s.email)], subject: `${manifest.name} ${manifest.version}: ` });
        } else if (args.what == "portal" && webURL(s.portal)) {
          await browser.windows.openDefaultBrowser(webURL(s.portal));
        }
        return;
      }
      case "saveQuickPart": {
        const nome = String(args.nome || "").trim();
        const html = String(args.html || "");
        if (!nome || !html) {
          return;
        }
        await withLock(QUICK_PARTS_KEY, async () => {
          const list = await readQuickParts();
          const i = args.id ? list.findIndex(p => p.id == args.id) : -1;
          if (i >= 0) {
            list[i] = Object.assign({}, list[i], { nome, html });
          } else {
            list.push({ id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nome, html });
          }
          await saveQuickParts(list);
        });
        return;
      }
      case "setTbToolbar":
        await saveUser({ ocultarBarraThunderbird: !args.visible });
        return;
      case "setMenubar":
        await saveUser({ ocultarBarraMenus: !args.visible });
        // Mesmo sem mudança gravada (a política decide), as janelas voltam ao que vale.
        await pushConfig();
        return;
      case "setCollapsed":
        // Como no Outlook: a próxima mensagem abre com a faixa como o usuário deixou.
        await saveUser({ recolhida: !!args.collapsed });
        return;
      case "priorityHigh": {
        const { priority } = await messageState(tabId);
        await browser.compose.setComposeDetails(tabId, { priority: priority == "highest" ? "normal" : "highest" });
        break;
      }
      case "priorityLow": {
        const { priority } = await messageState(tabId);
        await browser.compose.setComposeDetails(tabId, { priority: priority == "lowest" ? "normal" : "lowest" });
        break;
      }
      case "formatHTML":
        await browser.compose.setComposeDetails(tabId, { deliveryFormat: "both" });
        break;
      case "formatPlain":
        await browser.compose.setComposeDetails(tabId, { deliveryFormat: "plaintext" });
        break;
      default:
        console.warn("[Faixa] comando sem tratamento no background:", command);
        return;
    }
  } catch (e) {
    console.error("[Faixa] comando", command, e);
  }
  await pushMessageState(tabId);
}

browser.faixa.onCommand.addListener(onCommand);
browser.faixa.onComposeReady.addListener(tabId => pushMessageState(tabId));
browser.runtime.onStartup.addListener(pushConfig);
browser.runtime.onInstalled.addListener(pushConfig);
browser.storage.onChanged.addListener((changes, area) => {
  if (area == "managed" || (area == "local" && (changes.usuario || changes.assinaturas || changes.assinaturaPadrao || changes.partesRapidas))) {
    pushConfig();
  }
});

pushConfig();
