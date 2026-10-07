"""Testes da faixa no simulador (Playwright).

Uso: python3 test/harness/run_tests.py [pasta_de_capturas] [--gecko]
Sobe um servidor local na raiz do complemento e abre test/harness/compose.html.
Sem --gecko roda no Chromium; com --gecko, no Firefox do Playwright, que tem o
editor do Gecko (o mesmo motor do Thunderbird): espaços, &nbsp; e desfazer como lá.
"""
import asyncio, base64, json, os, re, sys, threading, http.server, functools, socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
GECKO = "--gecko" in sys.argv
OUT = ARGS[0] if ARGS else os.path.join(ROOT, "test", "out")
os.makedirs(OUT, exist_ok=True)
PORT = 8821 if GECKO else 8811

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

def serve():
    handler = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), handler) as httpd:
        httpd.serve_forever()

threading.Thread(target=serve, daemon=True).start()

from playwright.async_api import async_playwright

URL = f"http://127.0.0.1:{PORT}/test/harness/compose.html"
VERSION = json.load(open(os.path.join(ROOT, "manifest.json"), encoding="utf-8"))["version"]
FAILS = []

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (" — " + str(detail) if detail else ""))
    if not ok:
        FAILS.append(name)

# Sem internet: as imagens de fora dos testes (assinaturas, Partes Rápidas) recebem um PNG de 1 px.
PNG_1PX = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")

async def offline(route):
    await route.fulfill(status=200, content_type="image/png", body=PNG_1PX)

async def open_page(b, query="", width=1440, height=900):
    pg = await b.new_page(viewport={"width": width, "height": height})
    await pg.route("https://example.com/**", offline)
    logs = []
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
    await pg.goto(URL + query)
    await pg.wait_for_function("window.simReady === true || !!window.simError", timeout=10000)
    err = await pg.evaluate("window.simError || null")
    if err:
        print("SIMERROR", err)
    await pg.wait_for_function("window.controller && window.controller.engine && window.controller.engine.state.editorReady", timeout=10000)
    await pg.wait_for_timeout(200)
    return pg, logs

EDITOR = "document.getElementById('messageEditor').contentDocument"

async def body_html(pg):
    return await pg.evaluate(f"{EDITOR}.body.innerHTML")

async def select_word(pg, word):
    return await pg.evaluate("""(w) => {
      const d = document.getElementById('messageEditor').contentDocument;
      const tw = d.createTreeWalker(d.body, 4); let n;
      while ((n = tw.nextNode())) { const i = n.data.indexOf(w); if (i >= 0) {
        const r = d.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length);
        const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); return true; } }
      return false; }""", word)

async def word_rect(pg, word):
    r = await pg.evaluate("""(w) => {
      const f = document.getElementById('messageEditor'); const d = f.contentDocument;
      const tw = d.createTreeWalker(d.body, 4); let n;
      while ((n = tw.nextNode())) { const i = n.data.indexOf(w); if (i >= 0) {
        const r = d.createRange(); r.setStart(n, i); r.setEnd(n, i + w.length);
        const b = r.getBoundingClientRect(); const fb = f.getBoundingClientRect();
        return {x: fb.left + b.left, y: fb.top + b.top, w: b.width, h: b.height}; } }
      return null; }""", word)
    return r

async def computed(pg, word, prop):
    return await pg.evaluate("""([w, p]) => {
      const d = document.getElementById('messageEditor').contentDocument;
      const tw = d.createTreeWalker(d.body, 4); let n;
      while ((n = tw.nextNode())) { if (n.data.includes(w)) return getComputedStyle(n.parentElement)[p]; }
      return null; }""", [word, prop])

def chromium_bare(html):
    """Tira os restos que só o removeFormat do Chromium deixa (ver comentário no uso)."""
    html = html or ""
    for junk in (' style=""', ' style="font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt;"'):
        html = html.replace(junk, "")
    return html

async def main():
    async with async_playwright() as p:
        b = await (p.firefox if GECKO else p.chromium).launch()
        print("motor:", "Gecko (Firefox)" if GECKO else "Blink (Chromium)")

        # ---------- 1. montagem, capturas e autoteste ----------
        pg, logs = await open_page(b)
        mounted = await pg.evaluate("!!document.getElementById('faixa-root') && !!document.getElementById('faixa-send')")
        check("faixa e botão Enviar montados", mounted)
        hidden = await pg.evaluate("[document.getElementById('FormatToolbox').getBoundingClientRect().height, document.getElementById('composeToolbar2').getBoundingClientRect().height]")
        check("barras nativas ocultas", hidden == [0, 0], hidden)
        send = await pg.evaluate("(() => { const s = document.getElementById('faixa-send').getBoundingClientRect(); const r = document.getElementById('recipientsContainer').getBoundingClientRect(); return {s: [s.left, s.right, s.top, s.bottom], r: [r.left, r.top, r.bottom]}; })()")
        check("Enviar à esquerda dos destinatários", send["s"][1] <= send["r"][0] + 4 and send["s"][3] > send["r"][1], send)
        await pg.screenshot(path=os.path.join(OUT, "01_mensagem.png"))
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await pg.wait_for_timeout(200)
        await pg.screenshot(path=os.path.join(OUT, "02_formatar.png"))
        fit = await pg.evaluate("(() => { const p = document.querySelector('.fx-panel:not([hidden])'); return {sw: p.scrollWidth, cw: p.clientWidth, cls: document.getElementById('faixa-root').className}; })()")
        check("Formatar Texto cabe em 1440 px", fit["sw"] <= fit["cw"] + 1, fit)
        await pg.get_by_role("tab", name="Mensagem").click()

        results = await pg.evaluate("controller.selfTest()")
        print("--- autoteste no simulador ---")
        for r in results:
            print(("  ok    " if r["ok"] else "  FALHA ") + r["label"] + " — " + r["detail"])
        must = {"montagem", "barras", "menus", "enviar", "arquivo", "idioma", "editor", "foco", "negrito", "palavra", "estado", "fontePadrao", "tamanho",
                "maiusculas", "espaco", "pincel", "pincelTravado", "enter", "marcas", "fontes", "atalhos", "mv3", "prioridade", "controle", "acompanhamento", "nomes", "catalogo",
                "assinatura", "tabela", "inserir", "partes", "estilos", "textoPuro", "previa", "envio", "desempenho"}
        got = {r["id"]: r["ok"] for r in results}
        for k in sorted(must):
            check("autoteste: " + k, got.get(k) is True, next((r["detail"] for r in results if r["id"] == k), "ausente"))
        print("HTML após autoteste:", (await body_html(pg))[:400])
        print("LOGS", logs)
        await pg.close()

        # No Thunderbird a linha Cc começa escondida: Selecionar Nomes põe o contato
        # nela, o Thunderbird mostra a linha e leva o foco para lá. O autoteste da
        # 0.5.0 perdia o corpo nesse ponto (tabela, inserir, partes e estilos).
        pg, logs = await open_page(b, "?semcc=1")
        cc_hidden = await pg.evaluate("document.getElementById('addressRowCc').classList.contains('hidden')")
        check("sem Cc: a linha Cc começa escondida", cc_hidden is True, cc_hidden)
        results = await pg.evaluate("controller.selfTest()")
        got = {r["id"]: r["ok"] for r in results}
        bad = [(r["id"], r["detail"]) for r in results if r["id"] in must and not r["ok"]]
        check("sem Cc: autoteste passa inteiro", not bad and all(k in got for k in must), bad or [k for k in must if k not in got])
        for k in ("tabela", "inserir", "partes", "estilos"):
            check("sem Cc: autoteste " + k, got.get(k) is True, next((r["detail"] for r in results if r["id"] == k), "ausente"))
        cc_shown = await pg.evaluate("!document.getElementById('addressRowCc').classList.contains('hidden')")
        check("sem Cc: o contato do catálogo mostrou a linha Cc", cc_shown is True, cc_shown)
        check("sem Cc: sem erros no console", not logs, logs)
        await pg.close()

        # ---------- 2. interação com mouse e teclado ----------
        pg, logs = await open_page(b)
        await pg.locator("#msgSubject").click()
        await pg.keyboard.press("Tab")
        await pg.wait_for_timeout(80)
        active = await pg.evaluate("document.activeElement && (document.activeElement.id || document.activeElement.tagName)")
        check("Tab no Assunto vai para o corpo, não para o Enviar", active == "messageEditor", active)
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Prezada Mariana, segue a proposta atualizada para aprovação.")
        await pg.wait_for_timeout(100)
        # negrito pelo botão com seleção
        await select_word(pg, "proposta")
        await pg.get_by_role("button", name="Negrito", exact=True).first.click()
        await pg.wait_for_timeout(120)
        h = await body_html(pg)
        check("botão Negrito aplica <b>", "<b>proposta</b>" in h, h[:160])
        pressed = await pg.get_by_role("button", name="Negrito", exact=True).first.get_attribute("aria-pressed")
        check("botão Negrito aceso na seleção", pressed == "true", pressed)
        await frame.locator("body").press("Control+z")
        await pg.wait_for_timeout(100)
        h = await body_html(pg)
        check("Ctrl+Z desfaz o negrito de uma vez", "<b>" not in h, h[:160])
        # O desfazer do simulador troca o innerHTML e o Gecko perde o cursor: volta para "Prezada".
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const t = d.body.querySelector('p').firstChild; d.getSelection().collapse(t, 2); }})()")
        # Ctrl+E centraliza (no Firefox, Ctrl+E é da barra de pesquisa: vai um keydown sintético)
        ctrl_e = "(() => { const d = document.getElementById('messageEditor').contentDocument; d.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', ctrlKey: true, bubbles: true, cancelable: true })); })()"
        if GECKO:
            await pg.evaluate(ctrl_e)
        else:
            await frame.locator("body").press("Control+e")
        await pg.wait_for_timeout(120)
        ta = await computed(pg, "Prezada", "textAlign")
        check("Ctrl+E centraliza (atalho do Office)", ta == "center", ta)
        centerPressed = await pg.get_by_role("button", name="Centralizar").first.get_attribute("aria-pressed")
        check("Centralizar aceso", centerPressed == "true", centerPressed)
        if GECKO:
            await pg.evaluate(ctrl_e)
        else:
            await frame.locator("body").press("Control+e")
        await pg.wait_for_timeout(100)
        ta = await computed(pg, "Prezada", "textAlign")
        check("Ctrl+E de novo volta à esquerda", ta in ("left", "start"), ta)
        # fonte pela caixa
        await select_word(pg, "Mariana")
        font = pg.get_by_label("Fonte", exact=True).first
        await font.click()
        await font.fill("Georgia")
        await font.press("Enter")
        await pg.wait_for_timeout(150)
        ff = await computed(pg, "Mariana", "fontFamily")
        check("caixa Fonte aplica Georgia com substitutos", ff and ff.startswith("Georgia"), ff)
        # tamanho pela caixa
        await select_word(pg, "aprovação")
        size = pg.get_by_label("Tamanho da Fonte", exact=True).first
        await size.click()
        await size.fill("14")
        await size.press("Enter")
        await pg.wait_for_timeout(150)
        fs = await computed(pg, "aprovação", "fontSize")
        check("caixa Tamanho aplica 14 pt", fs == "18.6667px", fs)
        sval = await size.input_value()
        check("caixa Tamanho mostra 14", sval == "14", sval)
        # aumentar fonte
        await pg.get_by_role("button", name="Aumentar Tamanho da Fonte").first.click()
        await pg.wait_for_timeout(120)
        fs2 = await computed(pg, "aprovação", "fontSize")
        check("Aumentar fonte vai de 14 para 16 pt", fs2 == "21.3333px", fs2)
        # cor da fonte pela paleta
        await select_word(pg, "segue")
        await pg.get_by_role("button", name="Mais opções de Cor da Fonte").first.click()
        await pg.wait_for_timeout(120)
        await pg.screenshot(path=os.path.join(OUT, "03_paleta.png"), clip={"x": 0, "y": 0, "width": 760, "height": 420})
        await pg.get_by_role("button", name="#2F5496").first.click()
        await pg.wait_for_timeout(120)
        col = await computed(pg, "segue", "color")
        check("paleta aplica a cor do tema", col == "rgb(47, 84, 150)", col)
        # pincel: copia de "aprovação" (16pt) e aplica em "atualizada" pelo clique
        await select_word(pg, "aprovação")
        await pg.get_by_role("button", name="Pincel de Formatação").first.click()
        await pg.wait_for_timeout(100)
        hint = await pg.evaluate("!document.querySelector('.fx-hint').hidden")
        check("aviso do pincel aparece", hint)
        r = await word_rect(pg, "atualizada")
        await pg.mouse.click(r["x"] + r["w"] / 2, r["y"] + r["h"] / 2)
        await pg.wait_for_timeout(200)
        fs3 = await computed(pg, "atualizada", "fontSize")
        check("pincel aplica 16 pt na palavra clicada", fs3 == "21.3333px", fs3)
        mode = await pg.evaluate("controller.engine.painterMode")
        check("pincel desliga depois de uma aplicação", mode == 0, mode)
        # estilos
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await select_word(pg, "Prezada")
        await pg.get_by_role("option", name="Título 1").first.click()
        await pg.wait_for_timeout(150)
        tag = await pg.evaluate(f"(() => {{ const d = {EDITOR}; const t = d.body.querySelector('h1'); return t ? t.outerHTML.slice(0, 200) : null; }})()")
        check("galeria aplica Título 1 (h1 + CSS inline)", bool(tag) and "font-size: 16pt" in tag, tag)
        tile = await pg.get_by_role("option", name="Título 1").first.get_attribute("aria-pressed")
        check("galeria marca Título 1", tile == "true", tile)
        # espaçamento pelo menu
        await pg.get_by_role("button", name="Espaçamento de Linha e Parágrafo").first.click()
        await pg.wait_for_timeout(100)
        await pg.get_by_role("menuitemcheckbox", name="1,5").click()
        await pg.wait_for_timeout(100)
        lh = await pg.evaluate(f"{EDITOR}.body.querySelector('h1').style.lineHeight")
        check("espaçamento 1,5 no bloco", lh == "1.5", lh)
        # marcas
        await pg.get_by_role("button", name="Mostrar Tudo").first.click()
        await pg.wait_for_timeout(100)
        await pg.screenshot(path=os.path.join(OUT, "04_formatar_uso.png"))
        await pg.get_by_role("button", name="Mostrar Tudo").first.click()
        # dica
        await pg.get_by_role("button", name="Negrito", exact=True).last.hover()
        await pg.wait_for_timeout(800)
        tip = await pg.evaluate("(() => { const t = document.querySelector('.fx-tip'); return t ? t.innerText : null; })()")
        check("dica mostra atalho", tip and "Ctrl+B" in tip, tip)
        await pg.screenshot(path=os.path.join(OUT, "05_dica.png"), clip={"x": 0, "y": 0, "width": 900, "height": 300})
        await pg.mouse.move(700, 700)
        # menu de fontes
        await pg.get_by_role("button", name="Lista de fontes").last.click()
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=os.path.join(OUT, "06_fontes.png"), clip={"x": 0, "y": 0, "width": 760, "height": 560})
        items = await pg.evaluate("document.querySelectorAll('.fx-mfont .fx-mi').length")
        check("menu de fontes lista tema + instaladas", items >= 13, items)
        await pg.keyboard.press("Escape")
        # prioridade (background simulado)
        await pg.get_by_role("tab", name="Mensagem").click()
        await pg.get_by_role("button", name="Alta Prioridade").first.click()
        await pg.wait_for_timeout(200)
        pr = await pg.get_by_role("button", name="Alta Prioridade").first.get_attribute("aria-pressed")
        check("Alta Prioridade acende pelo estado do background", pr == "true", pr)
        # Ctrl+F1 recolhe
        await frame.locator("body").press("Control+F1")
        await pg.wait_for_timeout(100)
        col = await pg.evaluate("document.getElementById('faixa-root').classList.contains('fx-collapsed')")
        check("Ctrl+F1 recolhe a faixa", col)
        await frame.locator("body").press("Control+F1")
        # envio normaliza (cria um parágrafo comum depois do título)
        await pg.evaluate(f"""(() => {{ const d = {EDITOR}; const h = d.body.querySelector('h1'); const s = d.getSelection(); s.collapse(h, h.childNodes.length); }})()""")
        await frame.locator("body").press("End")
        await frame.locator("body").press("Enter")
        await pg.keyboard.type("Atenciosamente,")
        await pg.wait_for_timeout(80)
        snap = f"(() => {{ const d = {EDITOR}; const s = d.getSelection(); return {{ html: d.body.innerHTML, node: s.anchorNode && (s.anchorNode.data || s.anchorNode.nodeName), off: s.anchorOffset }}; }})()"
        before_send = await pg.evaluate(snap)
        h = await pg.evaluate("controller.host.send()") or ""
        # O Enter depois do título cria <p> (separador de parágrafo da faixa), que sai com margem 0 e a fonte.
        new_block = re.search(r'<p style="([^"]*)">(?:<span[^>]*>)?Atenciosamente,', h)
        check("envio: bloco novo recebe a fonte padrão explícita", bool(new_block) and "font-family: Calibri" in new_block.group(1) and "margin-top: 0px" in new_block.group(1), h[-300:])
        check("envio: sem <font> na saída", "<font" not in h, h[:300])
        print("HTML enviado:", h[-700:])
        await pg.wait_for_timeout(60)
        check("envio em curso: faixa desativada", await pg.get_by_role("button", name="Negrito", exact=True).first.is_disabled())
        if GECKO:
            await pg.evaluate(ctrl_e)
        else:
            await frame.locator("body").press("Control+e")
        await pg.wait_for_timeout(60)
        check("envio em curso: atalho da faixa não age", (await body_html(pg)) == h)
        # o servidor recusa: o corpo e o cursor voltam ao que eram
        await pg.evaluate("controller.host.finishSend(false)")
        await pg.wait_for_timeout(80)
        after_fail = await pg.evaluate(snap)
        check("envio que falha: corpo volta ao que era", after_fail["html"] == before_send["html"], after_fail["html"][-200:])
        check("envio que falha: cursor volta ao lugar", (after_fail["node"], after_fail["off"]) == (before_send["node"], before_send["off"]), [before_send["node"], before_send["off"], after_fail["node"], after_fail["off"]])
        check("envio que falha: faixa volta a funcionar", not await pg.get_by_role("button", name="Negrito", exact=True).first.is_disabled())
        # pincel travado é desligado quando o envio começa
        await pg.evaluate("(() => { const d = document.getElementById('messageEditor').contentDocument; const t = d.body.querySelector('h1').firstChild; const r = d.createRange(); r.selectNodeContents(d.body.querySelector('h1')); d.getSelection().removeAllRanges(); d.getSelection().addRange(r); controller.engine.run('painter', { mode: 'lock' }); })()")
        armed = await pg.evaluate("controller.engine.painterMode")
        await pg.evaluate("controller.host.send()")
        await pg.wait_for_timeout(40)
        check("envio desliga o pincel travado", armed == 2 and await pg.evaluate("controller.engine.painterMode") == 0, armed)
        await pg.evaluate("controller.host.finishSend(false)")
        await pg.wait_for_timeout(40)
        # janela modal aberta por outro ouvinte: a microtarefa roda com o evento ainda em despacho
        nested = await pg.evaluate("""async () => {
          const d = document.getElementById('messageEditor').contentDocument;
          const before = d.body.innerHTML;
          const ev = { eventPhase: 2 };
          controller.onSendEvent(true, ev);
          await new Promise(r => setTimeout(r, 30));
          const waited = controller.pendingSend && !controller.pendingSend.inFlight && d.body.innerHTML != before;
          window.gWindowLocked = true; ev.eventPhase = 0;
          await new Promise(r => setTimeout(r, 30));
          const inFlight = !!(controller.pendingSend && controller.pendingSend.inFlight);
          controller.host.finishSend(false);
          return { waited, inFlight, back: d.body.innerHTML == before };
        }""")
        check("modal durante o despacho: decide depois, com a janela já travada", nested == {"waited": True, "inFlight": True, "back": True}, nested)
        # outro complemento barra o envio depois do compose-send-message
        await pg.evaluate("window.addEventListener('compose-send-message', e => e.preventDefault(), { once: true })")
        barred = await pg.evaluate("controller.host.send()")
        await pg.wait_for_timeout(40)
        after_bar = await body_html(pg)
        check("envio barrado: nada fica normalizado", barred is None and after_bar == before_send["html"], after_bar[-200:])
        # envio que dá certo: a normalização fica (a janela fecharia)
        ok_html = await pg.evaluate("controller.host.send()")
        await pg.evaluate("controller.host.finishSend(true)")
        await pg.wait_for_timeout(40)
        check("envio que dá certo: nada pendente", await pg.evaluate("controller.pendingSend === null") and ok_html == await body_html(pg))
        print("LOGS", logs)
        await pg.close()

        # ---------- 3. janela estreita, tema escuro, texto puro, perfil pt-BR ----------
        for w in (1180, 980):
            pg, logs = await open_page(b, width=w)
            await pg.get_by_role("tab", name="Formatar Texto").click()
            await pg.wait_for_timeout(300)
            info = await pg.evaluate("(() => { const p = document.querySelector('.fx-panel:not([hidden])'); return {sw: p.scrollWidth, cw: p.clientWidth, cls: document.getElementById('faixa-root').className}; })()")
            print(f"largura {w}:", info)
            await pg.screenshot(path=os.path.join(OUT, f"07_formatar_{w}.png"), clip={"x": 0, "y": 0, "width": w, "height": 260})
            await pg.close()
        pg, logs = await open_page(b, query="?tema=escuro")
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await pg.wait_for_timeout(200)
        await pg.screenshot(path=os.path.join(OUT, "08_escuro.png"))
        print("LOGS escuro", logs)
        await pg.close()

        pg, logs = await open_page(b, query="?perfil=office-ptbr")
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Texto em negrito")
        await select_word(pg, "negrito")
        await frame.locator("body").press("Control+n")
        await pg.wait_for_timeout(120)
        h = await body_html(pg)
        check("perfil pt-BR: Ctrl+N aplica negrito", "<b>negrito</b>" in h, h[:120])
        await frame.locator("body").press("Control+s")
        await pg.wait_for_timeout(120)
        h = await body_html(pg)
        check("perfil pt-BR: Ctrl+S sublinha", "<u>" in h, h[:160])
        await frame.locator("body").press("Control+b")
        await pg.wait_for_timeout(80)
        log = await pg.evaluate("controller.host.nativeLog")
        check("perfil pt-BR: Ctrl+B salva o rascunho", "cmd_saveDefault" in log, log)
        await pg.close()

        pg, logs = await open_page(b, query="?conteudo=resposta")
        await pg.evaluate("window.simIsHTML = false; controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(150)
        dis = await pg.get_by_role("button", name="Negrito", exact=True).first.is_disabled()
        check("texto sem formatação: Negrito desativado", dis)
        await pg.close()

        # ---------- 4. leitura das teclas: AltGr, Ctrl+Alt da esquerda, Option, não latino ----------
        # Eventos no formato do Gecko (no Windows, Ctrl+Alt que gera caractere chega como
        # AltGraph, sem ctrlKey nem altKey), que o Chromium do simulador não produz.
        pg, logs = await open_page(b)
        got = await pg.evaluate("""() => {
          const def = controller.api.definition;
          const win = new FaixaShortcuts(def, "thunderbird-office", false);
          const mac = new FaixaShortcuts(def, "thunderbird-office", true);
          const ev = o => Object.assign({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
            getModifierState: m => m == "AltGraph" && !!o.altGraph }, o);
          const st = o => (o ? Object.assign(FaixaShortcuts.newKeyState(), o) : null);
          const m = (sc, e, s) => { const x = sc.match(ev(e), true, st(s)); return x ? x.cmd + (x.args ? ":" + x.args.value : "") : null; };
          const altgr = { rightAlt: true, ctrl: true };   // AltGr: o Windows também manda um Ctrl esquerdo falso
          const left = { leftAlt: true, ctrl: true };     // Ctrl e Alt da esquerda
          return {
            "AltGr+C digita ₢ (ABNT2)": m(win, { key: "₢", code: "KeyC", altGraph: true }, altgr),
            "Ctrl+Alt+C da esquerda copia a formatação (ABNT2)": m(win, { key: "₢", code: "KeyC", altGraph: true }, left),
            "AltGr+2 digita ² (ABNT2)": m(win, { key: "²", code: "Digit2", altGraph: true }, altgr),
            "Ctrl+Alt+2 da esquerda digita ² (ABNT2)": m(win, { key: "²", code: "Digit2", altGraph: true }, left),
            "Ctrl+Alt+2 sem caractere (US) aplica o Título 2": m(win, { key: "2", code: "Digit2", ctrlKey: true, altKey: true }, left),
            "macOS: Cmd+Option+2 aplica o Título 2": m(mac, { key: "™", code: "Digit2", metaKey: true, altKey: true }, { leftAlt: true }),
            "AltGr depois de um Ctrl+Alt preso continua digitando": m(win, { key: "²", code: "Digit2", altGraph: true }, { leftAlt: true, rightAlt: true, ctrl: true }),
            "sem saber de que lado veio o Alt, digita": m(win, { key: "₢", code: "KeyC", altGraph: true }, null),
            "AltGr+Q digita / (ABNT2)": m(win, { key: "/", code: "KeyQ", altGraph: true }, altgr),
            "Chromium: AltGr como Ctrl+Alt digita": m(win, { key: "₢", code: "KeyC", ctrlKey: true, altKey: true }, altgr),
            "Ctrl+Alt+V sem caractere cola a formatação": m(win, { key: "v", code: "KeyV", ctrlKey: true, altKey: true }, left),
            "Linux: Ctrl+Alt+C": m(win, { key: "c", code: "KeyC", ctrlKey: true, altKey: true }, left),
            "macOS: Cmd+Option+C (chega como ç)": m(mac, { key: "ç", code: "KeyC", metaKey: true, altKey: true }, { leftAlt: true }),
            "macOS: Option+C sozinho digita ç": m(mac, { key: "ç", code: "KeyC", altKey: true }, { leftAlt: true }),
            "teclado russo: Ctrl+у é Ctrl+E": m(win, { key: "у", code: "KeyE", ctrlKey: true }, { ctrl: true }),
          };
        }""")
        want = {
            "AltGr+C digita ₢ (ABNT2)": None,
            "Ctrl+Alt+C da esquerda copia a formatação (ABNT2)": "painterCopy",
            "AltGr+2 digita ² (ABNT2)": None,
            "Ctrl+Alt+2 da esquerda digita ² (ABNT2)": None,
            "Ctrl+Alt+2 sem caractere (US) aplica o Título 2": "style:h2",
            "macOS: Cmd+Option+2 aplica o Título 2": "style:h2",
            "AltGr depois de um Ctrl+Alt preso continua digitando": None,
            "sem saber de que lado veio o Alt, digita": None,
            "AltGr+Q digita / (ABNT2)": None,
            "Chromium: AltGr como Ctrl+Alt digita": None,
            "Ctrl+Alt+V sem caractere cola a formatação": "painterApply",
            "Linux: Ctrl+Alt+C": "painterCopy",
            "macOS: Cmd+Option+C (chega como ç)": "painterCopy",
            "macOS: Option+C sozinho digita ç": None,
            "teclado russo: Ctrl+у é Ctrl+E": "alignCenter",
        }
        for name, expected in want.items():
            check("tecla: " + name, got.get(name) == expected, got.get(name))
        # o estado do Alt acompanha keydown/keyup de verdade
        await pg.frame_locator("#messageEditor").locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.down("Control")
        await pg.keyboard.down("Alt")
        ks = await pg.evaluate("Object.assign({}, controller.keyState)")
        await pg.keyboard.up("Alt")
        await pg.keyboard.up("Control")
        ks2 = await pg.evaluate("Object.assign({}, controller.keyState)")
        check("estado do Alt segue as teclas", ks == {"leftAlt": True, "rightAlt": False, "ctrl": True} and ks2 == {"leftAlt": False, "rightAlt": False, "ctrl": False}, [ks, ks2])
        await pg.close()

        # ---------- 5. citação de texto puro e assinatura ficam como vieram ----------
        pg, logs = await open_page(b, query="?conteudo=resposta-texto")
        frame = pg.frame_locator("#messageEditor")
        quote_before = await pg.evaluate(f"{EDITOR}.querySelector('blockquote').outerHTML")
        sig_before = await pg.evaluate(f"{EDITOR}.querySelector('.moz-signature').outerHTML")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const s = d.getSelection(); const r = d.createRange(); r.selectNodeContents(d.body); s.removeAllRanges(); s.addRange(r); }})()")
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await pg.get_by_role("button", name="Limpar Toda a Formatação").first.click()
        await pg.wait_for_timeout(120)
        h = await body_html(pg)
        quote_after = await pg.evaluate(f"(() => {{ const q = {EDITOR}.querySelector('blockquote'); return q ? q.outerHTML : null; }})()")
        sig_after = await pg.evaluate(f"(() => {{ const q = {EDITOR}.querySelector('.moz-signature'); return q ? q.outerHTML : null; }})()")
        check("limpar tudo: título do autor vira parágrafo", "<h1" not in h and "Resposta do autor" in h, h[:200])
        # O removeFormat do Chromium deixa style="" nos blocos e empurra a fonte do <body>
        # para os blocos vizinhos do trecho limpo; o do Gecko não faz nem uma coisa nem outra.
        bare = chromium_bare
        check("limpar tudo: citação de texto puro continua <pre> com as quebras", bare(quote_after) == quote_before, quote_after)
        check("limpar tudo: assinatura intacta", bare(sig_after) == sig_before, sig_after)
        sel_text = await pg.evaluate(f"{EDITOR}.getSelection().toString().length")
        check("limpar tudo: a seleção continua cobrindo a mensagem", sel_text > 60, sel_text)
        # estilo com o cursor na citação: não converte e avisa
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const t = d.querySelector('pre').firstChild; d.getSelection().collapse(t, 3); }})()")
        await pg.get_by_role("option", name="Título 1").first.click()
        await pg.wait_for_timeout(150)
        quote_after2 = await pg.evaluate(f"{EDITOR}.querySelector('blockquote').outerHTML")
        flash_text = await pg.evaluate("(() => { const f = document.querySelector('.fx-status'); return f ? f.textContent : ''; })()")
        check("estilo na citação: nada muda e a faixa avisa", quote_after2 == quote_after and "mantêm a formatação" in flash_text, [flash_text, quote_after2])
        print("LOGS", logs)
        await pg.close()

        # ---------- 6. citação HTML e assinatura com formatação: Ctrl+A não apaga o que é alheio ----------
        pg, logs = await open_page(b, query="?conteudo=resposta-html")
        frame = pg.frame_locator("#messageEditor")
        q = lambda sel: pg.evaluate(f"(() => {{ const e = {EDITOR}.querySelector('{sel}'); return e ? e.outerHTML : null; }})()")
        quote0 = await q("blockquote")
        sig0 = await q(".moz-signature")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        select_all = f"(() => {{ const d = {EDITOR}; const r = d.createRange(); r.selectNodeContents(d.body); d.getSelection().removeAllRanges(); d.getSelection().addRange(r); }})()"
        await pg.evaluate(select_all)
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await pg.get_by_role("button", name="Limpar Toda a Formatação").first.click()
        await pg.wait_for_timeout(120)
        own = await q("p")
        bare = chromium_bare
        check("limpar tudo (HTML): texto do autor perde negrito e cor", "<b>" not in own and "color" not in own, own)
        check("limpar tudo (HTML): citação mantém negrito e cores", bare(await q("blockquote")) == quote0, await q("blockquote"))
        check("limpar tudo (HTML): assinatura mantém o negrito", bare(await q(".moz-signature")) == sig0, await q(".moz-signature"))
        # seleção só dentro da citação: escolha do usuário, vale
        await select_word(pg, "Pode enviar")
        await pg.get_by_role("button", name="Limpar Toda a Formatação").first.click()
        await pg.wait_for_timeout(120)
        qa = await q("blockquote")
        check("limpar só na citação: vale o que o usuário escolheu", "rgb(31, 73, 125)" not in qa.split("Pode enviar")[0][-80:] and "<b>De:</b>" in qa, qa)
        # pincel arrastado sobre autor + citação pinta só o autor
        await pg.keyboard.press("Control+z")
        await select_word(pg, "cor")
        await pg.evaluate("controller.engine.run('bold')")
        await select_word(pg, "cor")
        await pg.evaluate("controller.engine.run('painterCopy')")
        quote1 = await q("blockquote")
        await pg.evaluate(select_all)
        await pg.evaluate("controller.engine.run('painterApply')")
        await pg.wait_for_timeout(120)
        check("pincel sobre autor e citação: citação intacta", bare(await q("blockquote")) == bare(quote1), await q("blockquote"))
        check("pincel sobre autor e citação: autor recebe o negrito", "<b>Texto" in (await q("p")) or "font-weight" in (await q("p")), await q("p"))
        print("LOGS", logs)
        await pg.close()

        # ---------- 7. "Usar formato Parágrafo" desligado no Thunderbird (corpo com <br>) ----------
        pg, logs = await open_page(b, query="?modo=br")
        start = await pg.evaluate(f"""(() => {{ const d = {EDITOR}; const s = d.getSelection();
          return {{ html: d.body.innerHTML, inP: !!(s.anchorNode && s.anchorNode.nodeName == "P"), modified: controller.host.editor.documentModified,
                   fix: controller.engine.paragraphFix }}; }})()""")
        check("modo <br>: mensagem nova começa num parágrafo, sem <br> sobrando", start["html"].startswith('<p><br></p><div class="moz-signature">') and start["inP"] and start["fix"] == "new", start)
        check("modo <br>: a mensagem continua sem alteração", start["modified"] is False, start["modified"])
        results = await pg.evaluate("controller.selfTest()")
        got = {r["id"]: r for r in results}
        for k in ("enter", "marcas", "envio"):
            check("modo <br>: autoteste " + k, got.get(k, {}).get("ok") is True, got.get(k, {}).get("detail"))
        print("  enter:", got.get("enter", {}).get("detail"))
        # texto solto no corpo (rascunho antigo): sai com a fonte explícita e volta se o envio falhar
        await pg.evaluate(f"""(() => {{ const d = {EDITOR}; d.body.innerHTML = 'Ok, <b>obrigado</b>.<br><div class="moz-signature">-- <br>Ana Souza</div>';
          d.getSelection().collapse(d.body.firstChild, 2); }})()""")
        loose_before = await body_html(pg)
        sent = await pg.evaluate("controller.host.send()") or ""
        check("texto solto no corpo sai num <span> com a fonte padrão", sent.startswith('<span style="font-family: Calibri') and "Ok, <b>obrigado</b>.<br></span>" in sent, sent[:200])
        await pg.evaluate("controller.host.finishSend(false)")
        await pg.wait_for_timeout(40)
        check("texto solto: envio que falha devolve o corpo como era", (await body_html(pg)) == loose_before, await body_html(pg))
        print("LOGS", logs)
        await pg.close()

        # ---------- 8. Delete numa sugestão do autocompletar (como no Outlook) ----------
        pg, logs = await open_page(b)
        async def pick(email):
            return await pg.evaluate("""(email) => {
              const to = document.getElementById('to');
              to.focus(); to.value = 'vagner'; to.controller.startSearch('vagner');
              to.dataset.popup = '1';
              const i = to.controller.results.indexOf(email);
              to.popup.selectedIndex = i;
              to.value = email;   // completeselectedindex: o campo mostra a sugestão destacada
              return i; }""", email)
        state = lambda: pg.evaluate("""(() => { const to = document.getElementById('to');
          return { value: to.value, results: to.controller.results.slice(), sel: to.popup.selectedIndex,
                   collected: window.simBooks[0].emails.slice(), personal: window.simBooks[1].emails.slice(),
                   msg: document.querySelector('.fx-status').textContent }; })()""")
        await pick("vagner.s.dias.banana.teste.123.manolo@gmail.com")
        await pg.keyboard.press("Delete")
        st = await state()
        check("Delete tira dos Endereços coletados a sugestão destacada", "vagner.s.dias.banana.teste.123.manolo@gmail.com" not in st["collected"] and "vagner.s.dias.banana.teste.123.manolo@gmail.com" not in st["results"], st)
        check("Delete: o campo volta ao que foi digitado e a lista é refeita", st["value"] == "vagner" and st["sel"] == 0 and "saiu das sugestões" in st["msg"], st)
        await pick("vagner.s.dias@gmail.com")
        await pg.keyboard.press("Delete")
        st = await state()
        check("Delete: coletado que também é contato avisa que continua na lista", "vagner.s.dias@gmail.com" not in st["collected"] and "continua nas sugestões" in st["msg"] and "Catálogo pessoal" in st["msg"], st["msg"])
        await pick("vagnerdias@hotmail.com")
        await pg.keyboard.press("Delete")
        st = await state()
        check("Delete: contato do catálogo pessoal não é apagado", "vagnerdias@hotmail.com" in st["personal"] and "exclua o contato no Catálogo de Endereços" in st["msg"] and st["value"] == "vagnerdias@hotmail.com", st)
        # sem lista aberta, Delete apaga o caractere como sempre
        await pg.evaluate("(() => { const to = document.getElementById('to'); to.dataset.popup = '0'; to.value = 'abc'; to.focus(); to.setSelectionRange(0, 0); })()")
        await pg.keyboard.press("Delete")
        check("Delete sem sugestão destacada apaga o caractere", (await pg.evaluate("document.getElementById('to').value")) == "bc")
        print("LOGS", logs)
        await pg.close()

        # ---------- 9. fase 1: Arquivo, acesso rápido, Maiúsculas, espaço, anexos, foco ----------
        pg, logs = await open_page(b)
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Texto para testar a fase um.")
        await pg.wait_for_timeout(80)
        # Arquivo → Salvar como Modelo
        await pg.get_by_role("button", name="Arquivo", exact=True).click()
        await pg.wait_for_timeout(80)
        items = await pg.evaluate("[...document.querySelectorAll('.fx-mfile [role^=menuitem]')].map(b => b.textContent)")
        check("Arquivo: menu com Salvar Rascunho, Modelo, Imprimir, Opções da Faixa e Fechar",
              any("Salvar Rascunho" in i for i in items) and any("Salvar como Modelo" in i for i in items) and any("Imprimir" in i for i in items)
              and any("Opções da Faixa" in i for i in items) and any(i.startswith("Fechar") or "Fechar" in i for i in items), items)
        check("Arquivo: sem Propriedades… nem outro item previsto para outra fase", not any("Propriedades" in i or "(fase" in i for i in items), items)
        icons =await pg.evaluate("document.querySelectorAll('.fx-mfile .fx-mic').length")
        check("Arquivo: itens com ícone", icons >= 5, icons)
        await pg.screenshot(path=os.path.join(OUT, "11_arquivo.png"), clip={"x": 0, "y": 0, "width": 520, "height": 420})
        await pg.get_by_role("menuitem", name="Salvar como Modelo").click()
        await pg.wait_for_timeout(60)
        log = await pg.evaluate("controller.host.nativeLog")
        check("Arquivo: Salvar como Modelo chama cmd_saveAsTemplate", "cmd_saveAsTemplate" in log, log)
        await pg.get_by_role("button", name="Arquivo", exact=True).click()
        await pg.get_by_role("menuitem", name="Opções da Faixa…").click()
        await pg.wait_for_timeout(80)
        check("Arquivo: Opções da Faixa pede ao background para abrir as opções", "openOptions" in (await pg.evaluate("window.simCommands || []")), await pg.evaluate("window.simCommands || []"))
        # Salvar na barra de acesso rápido
        await pg.locator(".fx-qat button[aria-label='Salvar']").click()
        await pg.wait_for_timeout(40)
        log = await pg.evaluate("controller.host.nativeLog")
        check("barra de acesso rápido: Salvar grava o rascunho (cmd_saveDefault)", log.count("cmd_saveDefault") >= 1, log)
        # Maiúsculas e Minúsculas pelo menu (Formatar Texto)
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await select_word(pg, "testar")
        await pg.get_by_role("button", name="Maiúsculas e Minúsculas").click()
        await pg.wait_for_timeout(60)
        await pg.get_by_role("menuitem", name="MAIÚSCULAS").click()
        await pg.wait_for_timeout(80)
        h = await body_html(pg)
        check("Maiúsculas e Minúsculas: MAIÚSCULAS na seleção", "TESTAR" in h and "testar" not in h, h[:120])
        await frame.locator("body").press("Control+z")
        await pg.wait_for_timeout(80)
        h = await body_html(pg)
        check("Maiúsculas e Minúsculas: um Ctrl+Z desfaz", "testar" in h and "TESTAR" not in h, h[:120])
        # frase: cursor na palavra, Primeira letra da frase
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const r = d.createRange(); r.selectNodeContents(d.body.querySelector('p')); d.getSelection().removeAllRanges(); d.getSelection().addRange(r); }})()")
        await pg.get_by_role("button", name="Maiúsculas e Minúsculas").click()
        await pg.get_by_role("menuitem", name="aLTERNAR mAIÚSC./mINÚSC.").click()
        await pg.wait_for_timeout(80)
        h = await body_html(pg)
        check("Maiúsculas e Minúsculas: aLTERNAR no parágrafo inteiro", "tEXTO PARA TESTAR A FASE UM." in h, h[:120])
        await frame.locator("body").press("Control+z")
        await pg.wait_for_timeout(60)
        # Maiúsculas e Minúsculas com formatação, links, &nbsp;, <br> e ß (o texto não pode mudar de lugar)
        cases = [
            ("negrito no meio", '<p>Alfa <b>beta</b> gama</p>', "p", "upper", '<p>ALFA <b>BETA</b> GAMA</p>', "ALFA BETA GAMA"),
            ("link no meio", '<p>Veja o <a href="https://x.example/">site</a> hoje</p>', "p", "upper", '<p>VEJA O <a href="https://x.example/">SITE</a> HOJE</p>', None),
            ("só a palavra depois de &nbsp;", '<p>Prezado&nbsp;fulano</p>', "fulano", "upper", '<p>Prezado&nbsp;FULANO</p>', "FULANO"),
            ("Cada Palavra com <br>", '<p>rua das flores 10<br>são paulo</p>', "p", "title", '<p>Rua Das Flores 10<br>São Paulo</p>', None),
            ("frase com <br>", '<p>PREZADO JOÃO,<br>SEGUE O ARQUIVO. OBRIGADO.</p>', "p", "sentence", '<p>Prezado joão,<br>Segue o arquivo. Obrigado.</p>', None),
            ("ß vira SS", '<p>straße</p>', "p", "upper", '<p>STRASSE</p>', "STRASSE"),
            ("palavra no fim do negrito", '<p>Alfa <b>beta</b></p>', "p", "lower", '<p>alfa <b>beta</b></p>', None),
        ]
        for name, html, what, mode, want, want_sel in cases:
            got = await pg.evaluate("""([html, what, mode]) => {
              const d = document.getElementById('messageEditor').contentDocument;
              d.body.innerHTML = html + '<div class="moz-signature">-- <br>Ana</div>';
              const s = d.getSelection(); const r = d.createRange();
              if (what == "p") { r.selectNodeContents(d.body.querySelector('p')); }
              else { const tw = d.createTreeWalker(d.body, 4); let n; while ((n = tw.nextNode())) { const i = n.data.indexOf(what); if (i >= 0) { r.setStart(n, i); r.setEnd(n, i + what.length); break; } } }
              s.removeAllRanges(); s.addRange(r);
              const before = d.body.innerHTML;
              controller.engine.run('changeCase', { mode });
              const after = d.body.querySelector('p').outerHTML; const selText = s.toString();
              controller.host.editor.undo();
              return { after, sel: selText, undone: d.body.innerHTML == before };
            }""", [html, what, mode])
            ok = got["after"] == want and (want_sel is None or got["sel"] == want_sel) and got["undone"]
            check("Maiúsculas e Minúsculas: " + name, ok, got)
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; d.body.innerHTML = '<p>Texto para testar a fase um.</p><div class=\"moz-signature\">-- <br>Ana Souza<br>Bluecker</div>'; }})()")
        # Espaço antes do parágrafo pelo menu de espaçamento
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const t = d.body.querySelector('p').firstChild; d.getSelection().collapse(t, 3); }})()")
        await pg.wait_for_timeout(120)
        await pg.get_by_role("button", name="Espaçamento de Linha e Parágrafo").first.click()
        await pg.wait_for_timeout(60)
        await pg.get_by_role("menuitem", name="Adicionar Espaço Antes do Parágrafo").click()
        await pg.wait_for_timeout(150)
        mt = await pg.evaluate(f"{EDITOR}.body.querySelector('p').style.marginTop")
        check("Adicionar Espaço Antes do Parágrafo: 12 pt no parágrafo", mt == "12pt", mt)
        await pg.get_by_role("button", name="Espaçamento de Linha e Parágrafo").first.click()
        await pg.wait_for_timeout(60)
        labels = await pg.evaluate("[...document.querySelectorAll('.fx-popup [role^=menuitem]')].map(b => b.textContent)")
        check("menu de espaçamento: agora oferece Remover Espaço Antes", any("Remover Espaço Antes do Parágrafo" in l for l in labels) and any("Adicionar Espaço Depois do Parágrafo" in l for l in labels), labels)
        await pg.get_by_role("menuitem", name="Remover Espaço Antes do Parágrafo").click()
        await pg.wait_for_timeout(120)
        mt = await pg.evaluate(f"getComputedStyle({EDITOR}.body.querySelector('p')).marginTop")
        check("Remover Espaço Antes do Parágrafo: margem volta a 0", mt == "0px", mt)
        sent = await pg.evaluate("controller.host.send()") or ""
        await pg.evaluate("controller.host.finishSend(false)")
        await pg.wait_for_timeout(40)
        # espaço antes + envio: o lado de baixo sai com 0 explícito
        await pg.evaluate("controller.engine.run('spaceBefore')")
        await pg.wait_for_timeout(80)
        sent = await pg.evaluate("controller.host.send()") or ""
        check("envio com espaço antes: margem de cima 12 pt e a de baixo 0 explícita", 'margin-top: 12pt; margin-bottom: 0px' in sent or ('margin-top: 12pt' in sent and 'margin-bottom: 0px' in sent), sent[:200])
        await pg.evaluate("controller.host.finishSend(false)")
        await pg.wait_for_timeout(40)
        await frame.locator("body").press("Control+z")
        # Anexar Arquivo: menu com Filelink e cartão de visita
        await pg.get_by_role("tab", name="Mensagem").click()
        await pg.get_by_role("button", name="Opções de Anexar Arquivo").click()
        await pg.wait_for_timeout(60)
        att = await pg.evaluate("[...document.querySelectorAll('.fx-popup [role^=menuitem]')].map(b => b.textContent + (b.getAttribute('aria-checked') == 'true' ? ' [x]' : ''))")
        check("Anexar Arquivo: computador, Filelink (Box, WeTransfer), página, vCard e chave", len(att) == 6 and "Box…" in att[1] and "WeTransfer…" in att[2], att)
        await pg.screenshot(path=os.path.join(OUT, "12_anexar.png"), clip={"x": 0, "y": 0, "width": 900, "height": 420})
        await pg.get_by_role("menuitemcheckbox", name="Meu Cartão de Visita (vCard)").click()
        await pg.wait_for_timeout(40)
        await pg.get_by_role("button", name="Opções de Anexar Arquivo").click()
        await pg.wait_for_timeout(60)
        vc = await pg.get_by_role("menuitemcheckbox", name="Meu Cartão de Visita (vCard)").get_attribute("aria-checked")
        check("Anexar Arquivo: vCard marcado depois de escolhido", vc == "true", vc)
        await pg.get_by_role("menuitem", name="WeTransfer…").click()
        await pg.wait_for_timeout(40)
        log = await pg.evaluate("controller.host.nativeLog")
        check("Anexar Arquivo: Filelink na conta escolhida", "cloud:account2" in log, log)
        # Foco no Assunto desativa a formatação; Copiar continua
        await pg.locator("#msgSubject").click()
        await pg.wait_for_timeout(60)
        bold_off = await pg.get_by_role("button", name="Negrito", exact=True).first.is_disabled()
        copy_on = not await pg.get_by_role("button", name="Copiar", exact=True).first.is_disabled()
        font_off = await pg.get_by_label("Fonte", exact=True).first.is_disabled()
        check("foco no Assunto: formatação desativada, Copiar ativo", bold_off and copy_on and font_off, [bold_off, copy_on, font_off])
        await pg.screenshot(path=os.path.join(OUT, "13_foco_assunto.png"), clip={"x": 0, "y": 0, "width": 1000, "height": 300})
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.wait_for_timeout(60)
        check("foco de volta no corpo: formatação ativa", not await pg.get_by_role("button", name="Negrito", exact=True).first.is_disabled())
        # Esc fecha um menu aberto com o mouse (o foco continua no corpo)
        await pg.get_by_role("button", name="Arquivo", exact=True).click()
        await pg.wait_for_timeout(60)
        await frame.locator("body").press("Escape")
        await pg.wait_for_timeout(40)
        check("Esc fecha o menu aberto com o mouse", not await pg.evaluate("!!document.querySelector('.fx-popup')"))
        # Desfazer da barra de acesso rápido com o foco no Assunto vale para o Assunto
        await pg.locator("#msgSubject").click()
        await pg.wait_for_timeout(40)
        undo_on = not await pg.locator(".fx-qat button[aria-label='Desfazer']").is_disabled()
        await pg.locator(".fx-qat button[aria-label='Desfazer']").click()
        await pg.wait_for_timeout(40)
        log = await pg.evaluate("controller.host.nativeLog")
        check("Desfazer no Assunto: ativo e vai para o campo (cmd_undo)", undo_on and log[-1] == "cmd_undo", [undo_on, log[-3:]])
        await frame.locator("body").click(position={"x": 30, "y": 14})
        print("LOGS", logs)
        await pg.close()

        # ---------- 10. teclado na faixa: setas, Enter, Esc, recolher e espiar ----------
        pg, logs = await open_page(b)
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Palavra teclado aqui")
        await select_word(pg, "teclado")
        tabstops = await pg.evaluate("[...document.querySelectorAll('#faixa-root [tabindex=\"0\"]')].map(e => e.id || e.getAttribute('aria-label'))")
        check("faixa com uma parada só do Tab (a aba)", tabstops == ["fx-tab-mensagem"], tabstops)
        await pg.evaluate("controller.ui.focusRibbon()")
        active = lambda: pg.evaluate("(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute('aria-label') || a.textContent) : null; })()")
        check("entrada pelo teclado cai na aba", await active() == "fx-tab-mensagem", await active())
        await pg.keyboard.press("ArrowRight")
        sel_tab = await pg.evaluate("controller.ui.selectedTab")
        check("→ na aba passa para Inserir", await active() == "fx-tab-inserir" and sel_tab == "inserir", [await active(), sel_tab])
        await pg.keyboard.press("ArrowLeft")
        await pg.keyboard.press("ArrowDown")
        first = await active()
        check("↓ entra no primeiro comando da aba (Colar)", first == "Colar", first)
        # anda até o Negrito pela seta para baixo/direita
        for _ in range(25):
            if (await active()) == "Negrito":
                break
            await pg.keyboard.press("ArrowRight")
        reached = await active()
        check("→ anda pelos comandos até o Negrito", reached == "Negrito", reached)
        await pg.keyboard.press("ArrowUp")
        up = await active()
        check("↑ vai para o comando de cima (caixa Fonte)", up == "Fonte", up)
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(100)
        h = await body_html(pg)
        check("Enter no Negrito aplica na seleção do corpo", "<b>teclado</b>" in h, h[:120])
        check("depois do comando o foco volta ao corpo", await active() == "messageEditor", await active())
        # menu pelo teclado: ↓ no botão de menu abre com o foco no primeiro item; Esc volta ao botão
        await pg.evaluate("controller.ui.focusRibbon()")
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("ArrowDown")
        dropdown = await active()
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(60)
        in_menu = await pg.evaluate("!!document.activeElement.closest('.fx-popup')")
        check("Enter no Colar ▾ abre o menu com o foco nele", dropdown == "Opções de Colar" and in_menu, [dropdown, in_menu])
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(40)
        check("Esc fecha o menu e volta ao botão", await active() == "Opções de Colar" and not await pg.evaluate("!!document.querySelector('.fx-popup')"), await active())
        await pg.keyboard.press("Escape")
        check("Esc nos comandos volta para a aba", await active() == "fx-tab-mensagem", await active())
        await pg.keyboard.press("Escape")
        check("Esc na aba volta para o corpo da mensagem", await active() == "messageEditor", await active())
        # Arquivo pelo teclado
        await pg.evaluate("controller.ui.focusRibbon()")
        await pg.keyboard.press("ArrowLeft")
        await pg.keyboard.press("ArrowDown")
        await pg.wait_for_timeout(60)
        fitem = await pg.evaluate("(() => { const a = document.activeElement; return a && a.closest('.fx-mfile') ? a.textContent : null; })()")
        check("↓ no Arquivo abre o menu com o foco no primeiro item", fitem and "Salvar Rascunho" in fitem, fitem)
        await pg.keyboard.press("Escape")
        # cor escolhida pelo teclado: aplica e o foco volta ao corpo
        await select_word(pg, "aqui")
        await pg.evaluate("(() => { const ui = controller.ui; ui.selectTab('formatar'); const c = ui.controls.filter(c => c.cmd == 'foreColor').find(c => c.el.getClientRects().length); c.also[0].focus(); })()")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(60)
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("ArrowDown")
        swatch = await active()
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(80)
        col = await computed(pg, "aqui", "color")
        check("cor pelo teclado: aplica e o foco volta ao corpo", swatch.startswith("#") and col != "rgb(0, 0, 0)" and await active() == "messageEditor", [swatch, col, await active()])
        await pg.evaluate("controller.ui.selectTab('mensagem')")
        # recolher (Ctrl+F1): a faixa some; clicar numa aba abre por cima; um comando fecha
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await frame.locator("body").press("Control+F1")
        await pg.wait_for_timeout(80)
        cmds = await pg.evaluate("window.simCommands || []")
        check("recolher avisa o background (próximas mensagens abrem recolhidas)", "setCollapsed" in cmds, cmds)
        panel_h = await pg.evaluate("document.querySelector('.fx-panel:not([hidden])').getBoundingClientRect().height")
        check("faixa recolhida: painel escondido", panel_h == 0, panel_h)
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await pg.wait_for_timeout(80)
        peek = await pg.evaluate("(() => { const r = document.getElementById('faixa-root'); const p = document.querySelector('.fx-panel:not([hidden])').getBoundingClientRect(); const hdr = document.getElementById('MsgHeadersToolbar').getBoundingClientRect(); return { peek: r.classList.contains('fx-peek'), h: p.height, over: p.bottom > hdr.top, rootH: r.getBoundingClientRect().height }; })()")
        check("faixa recolhida: a aba clicada abre por cima da mensagem", peek["peek"] and peek["h"] > 80 and peek["over"] and peek["rootH"] < 60, peek)
        await pg.screenshot(path=os.path.join(OUT, "14_recolhida_espiada.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 260})
        await select_word(pg, "Palavra")
        await pg.get_by_role("button", name="Itálico", exact=True).last.click()
        await pg.wait_for_timeout(80)
        h = await body_html(pg)
        still = await pg.evaluate("document.getElementById('faixa-root').classList.contains('fx-peek')")
        check("faixa recolhida: o comando vale e a espiada fecha", "<i>Palavra</i>" in h and not still, [h[:100], still])
        await pg.get_by_role("tab", name="Mensagem").click()
        await pg.wait_for_timeout(40)
        await pg.mouse.click(700, 600)
        await pg.wait_for_timeout(40)
        check("faixa recolhida: clique fora fecha a espiada", not await pg.evaluate("document.getElementById('faixa-root').classList.contains('fx-peek')"))
        # recolhida: F6 (entrada pelo teclado), ↓ abre por cima, Enter no comando; a parada do Tab volta para a aba
        await pg.evaluate("controller.ui.focusRibbon()")
        await pg.keyboard.press("ArrowDown")
        await pg.wait_for_timeout(40)
        await pg.keyboard.press("Tab")
        await pg.wait_for_timeout(60)
        rov = await pg.evaluate("(() => { const r = controller.ui.roving; return [r.id || r.getAttribute('aria-label'), r.getClientRects().length > 0]; })()")
        await pg.evaluate("document.getElementById('faixa-send').focus()")
        await pg.keyboard.press("Shift+Tab")
        await pg.wait_for_timeout(40)
        back = await active()
        check("recolhida: depois da espiada, Shift+Tab do Enviar volta para a aba", rov == ["fx-tab-mensagem", True] and back == "fx-tab-mensagem", [rov, back])
        # Ctrl+F1 com o foco num comando: o foco vai para a aba, não se perde
        await pg.get_by_role("button", name="Fixar a Faixa de Opções").click()
        await pg.evaluate("controller.ui.focusRibbon()")
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("Control+F1")
        await pg.wait_for_timeout(60)
        check("Ctrl+F1 com o foco num comando: o foco vai para a aba", await active() == "fx-tab-mensagem", await active())
        await pg.get_by_role("button", name="Fixar a Faixa de Opções").click()
        await pg.wait_for_timeout(60)
        check("Fixar a Faixa de Opções volta ao normal", not await pg.evaluate("document.getElementById('faixa-root').classList.contains('fx-collapsed')"))
        print("LOGS", logs)
        await pg.close()

        # ---------- 11. inglês (en-US) e troca de idioma com a janela aberta ----------
        pg, logs = await open_page(b, query="?idioma=en-US")
        tabs = await pg.evaluate("[...document.querySelectorAll('.fx-tab')].map(t => t.textContent)")
        check("en-US: Arquivo/abas em inglês", tabs == ["File", "Message", "Insert", "Format Text", "Help"], tabs)
        groups = await pg.evaluate("[...document.querySelectorAll('.fx-panel:not([hidden]) .fx-glabel')].map(t => t.textContent)")
        check("en-US: grupos em inglês", groups[:3] == ["Clipboard", "Basic Text", "Names"], groups)
        await pg.get_by_role("button", name="Bold", exact=True).first.hover()
        await pg.wait_for_timeout(800)
        tip = await pg.evaluate("(() => { const t = document.querySelector('.fx-tip'); return t ? t.innerText : null; })()")
        check("en-US: dica em inglês com o atalho", tip and tip.startswith("Bold (Ctrl+B)") and "whole word" in tip, tip)
        await pg.mouse.move(700, 700)
        send_label = await pg.evaluate("document.getElementById('faixa-send').textContent")
        check("en-US: botão Send", send_label == "Send", send_label)
        await pg.screenshot(path=os.path.join(OUT, "15_en_mensagem.png"))
        await pg.get_by_role("tab", name="Format Text").click()
        await pg.wait_for_timeout(150)
        await pg.screenshot(path=os.path.join(OUT, "16_en_formatar.png"))
        results = await pg.evaluate("controller.selfTest()")
        bad = [r for r in results if not r["ok"]]
        check("en-US: autoteste passa", not bad, bad)
        check("en-US: autoteste em inglês", any(r["label"] == "Selection state follows the cursor" for r in results), [r["label"] for r in results][:4])
        print("  en-US:", [r["label"] + " — " + r["detail"] for r in results][:3])
        # troca para pt-BR sem fechar a janela: a faixa é refeita na mesma aba
        await pg.get_by_role("tab", name="Format Text").click()
        await pg.evaluate("simApi.applyConfig(Object.assign({}, simApi.config, { idioma: 'pt-BR' }))")
        await pg.wait_for_timeout(150)
        tabs = await pg.evaluate("[...document.querySelectorAll('.fx-tab')].map(t => t.textContent)")
        sel_tab = await pg.evaluate("controller.ui.selectedTab")
        check("troca de idioma com a janela aberta: faixa refeita em pt-BR, na mesma aba", tabs == ["Arquivo", "Mensagem", "Inserir", "Formatar Texto", "Ajuda"] and sel_tab == "formatar", [tabs, sel_tab])
        one = await pg.evaluate("[document.querySelectorAll('#faixa-root').length, document.querySelectorAll('#faixa-send').length]")
        check("troca de idioma: uma faixa e um Enviar só", one == [1, 1], one)
        await select_word(pg, "Ana")
        await pg.evaluate("controller.ui.state.focusArea = 'body'")
        await pg.get_by_role("button", name="Negrito", exact=True).last.click()
        await pg.wait_for_timeout(80)
        check("troca de idioma: faixa nova funciona", "<b>Ana</b>" in (await body_html(pg)), (await body_html(pg))[:160])
        print("LOGS", logs)
        await pg.close()

        # ---------- 12. alto contraste (cores forçadas) ----------
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, forced_colors="active")
        pg = await ctx.new_page()
        await pg.goto(URL)
        await pg.wait_for_function("window.controller && window.controller.engine && window.controller.engine.state.editorReady", timeout=10000)
        await pg.frame_locator("#messageEditor").locator("body").click(position={"x": 30, "y": 14})
        await pg.evaluate("controller.command('alignCenter')")
        await pg.wait_for_timeout(200)
        hc = await pg.evaluate("""(() => {
          const b = document.querySelector('[aria-label="Centralizar"][aria-pressed="true"]');
          const probe = document.createElement('div'); probe.style.background = 'Highlight'; document.body.append(probe);
          const hl = getComputedStyle(probe).backgroundColor; probe.remove();
          return { pressed: b ? getComputedStyle(b).backgroundColor : null, highlight: hl, fc: matchMedia('(forced-colors: active)').matches };
        })()""")
        check("alto contraste: botão aceso com a cor de destaque do sistema", hc["fc"] and hc["pressed"] == hc["highlight"], hc)
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await pg.wait_for_timeout(150)
        await pg.screenshot(path=os.path.join(OUT, "17_alto_contraste.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 300})
        await ctx.close()

        # ---------- 13. Verificar Nomes (Ctrl+K no Para) e Selecionar Nomes ----------
        PILLS = "(() => Object.fromEntries([...document.querySelectorAll('.address-row')].map(r => [r.dataset.recipienttype, { hidden: r.classList.contains('hidden'), input: r.querySelector('input').value, pills: [...r.querySelectorAll('.sim-pill')].map(p => p.dataset.address + (p.classList.contains('invalid-address') ? ' ✗' : '')) }])))()"
        DLG = "(() => { const d = document.querySelector('.fx-dialog'); return d ? { title: d.querySelector('.fx-dtitle').textContent, rows: [...d.querySelectorAll('.fx-prow')].map(r => r.querySelector('.fx-pname').textContent + ' · ' + r.querySelector('.fx-pmail').textContent), focus: document.activeElement.className, inside: d.contains(document.activeElement) } : null; })()"
        pg, logs = await open_page(b)
        await pg.locator("#to").click()
        await pg.keyboard.type("joana, joão; zzz")
        await pg.keyboard.press("Control+k")
        await pg.wait_for_timeout(250)
        dlg = await pg.evaluate(DLG)
        check("Ctrl+K no Para: dois João abrem a escolha, com o foco na lista", bool(dlg) and dlg["title"] == "Verificar Nomes" and len(dlg["rows"]) == 2 and "fx-plist" in dlg["focus"], dlg)
        await pg.screenshot(path=os.path.join(OUT, "18_verificar_nomes.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 520})
        await pg.keyboard.press("Tab")
        await pg.keyboard.press("Tab")
        await pg.keyboard.press("Tab")
        await pg.keyboard.press("Tab")
        trapped = await pg.evaluate("document.querySelector('.fx-dialog').contains(document.activeElement)")
        # Ctrl+Enter (enviar, no Thunderbird) não passa da janela da faixa
        blocked = await pg.evaluate("(() => { const e = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(e); return e.defaultPrevented; })()")
        check("janela de escolha: o Tab fica dentro dela e o Ctrl+Enter não chega ao Thunderbird", trapped and blocked, [trapped, blocked])
        await pg.locator(".fx-plist").focus()
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(250)
        st = await pg.evaluate(PILLS)
        to = st["addr_to"]["pills"]
        check("Verificar Nomes: nome resolvido, escolhido e desconhecido em vermelho",
              to == ["mariana@cliente.com.br", "Joana Prado <joana.prado@cliente.com.br>", "João Souza <joao.souza@fornecedor.com.br>", "zzz ✗"] and st["addr_to"]["input"] == "", st["addr_to"])
        flash = await pg.evaluate("document.querySelector('.fx-status').textContent")
        focus = await pg.evaluate("document.activeElement.id")
        check("Verificar Nomes: avisa o que ficou em vermelho e devolve o foco ao Para", "“zzz”" in flash and focus == "to", [flash, focus])
        # Esc na escolha: o texto fica na caixa para corrigir
        await pg.locator("#cc").click()
        await pg.keyboard.type("joão")
        await pg.keyboard.press("Control+k")
        await pg.wait_for_timeout(250)
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(150)
        st = await pg.evaluate(PILLS)
        check("Esc na escolha: nada muda e o texto fica no Cc", st["addr_cc"]["pills"] == [] and st["addr_cc"]["input"] == "joão" and not await pg.evaluate(DLG), st["addr_cc"])
        # Mostrar Mais Nomes: Selecionar Nomes com a pesquisa pronta; os dois vão para o Cco
        await pg.keyboard.press("Control+k")
        await pg.wait_for_timeout(250)
        await pg.get_by_role("button", name="Mostrar Mais Nomes…").click()
        await pg.wait_for_timeout(350)
        dlg = await pg.evaluate(DLG)
        check("Mostrar Mais Nomes abre Selecionar Nomes com a pesquisa", bool(dlg) and dlg["title"] == "Selecionar Nomes" and len(dlg["rows"]) == 2, dlg)
        await pg.locator(".fx-plist").focus()
        await pg.keyboard.press("Control+a")
        await pg.get_by_role("button", name="Cco →").click()
        await pg.get_by_role("button", name="OK").click()
        await pg.wait_for_timeout(200)
        st = await pg.evaluate(PILLS)
        check("Selecionar Nomes: os escolhidos entram no Cco, que aparece; o Cc fica limpo",
              not st["addr_bcc"]["hidden"] and st["addr_bcc"]["pills"] == ["João Silva <joao.silva@cliente.com.br>", "João Souza <joao.souza@fornecedor.com.br>"] and st["addr_cc"]["input"] == "", st)
        # Ctrl+K no corpo continua sendo o do Thunderbird (inserir link)
        await pg.frame_locator("#messageEditor").locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.press("Control+k")
        await pg.wait_for_timeout(150)
        check("Ctrl+K no corpo não abre Verificar Nomes", not await pg.evaluate(DLG))
        # Catálogo de Endereços com o foco no Cc: Enter na pesquisa vai para a lista, Enter na lista põe no Cc
        await pg.locator("#cc").click()
        await pg.get_by_role("button", name="Catálogo de Endereços").click()
        await pg.wait_for_timeout(250)
        await pg.keyboard.type("mar")
        await pg.wait_for_timeout(400)
        await pg.keyboard.press("Enter")
        await pg.keyboard.press("Enter")
        field = await pg.evaluate("document.querySelectorAll('.fx-dfield')[1].value")
        await pg.screenshot(path=os.path.join(OUT, "19_selecionar_nomes.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 640})
        await pg.get_by_role("button", name="OK").click()
        await pg.wait_for_timeout(200)
        st = await pg.evaluate(PILLS)
        check("Catálogo de Endereços: o contato vai para o campo onde o foco estava (Cc)", field == "Mariana Costa <mariana@cliente.com.br>" and st["addr_cc"]["pills"] == ["Mariana Costa <mariana@cliente.com.br>"], [field, st["addr_cc"]])
        check("nomes: sem erros no console", not logs, logs)
        await pg.close()

        # autocompletar do Thunderbird: o complemento selecionado na caixa e o blur não viram destinatário
        pg, logs = await open_page(b, "?ac=1")
        await pg.locator("#to").click()
        await pg.keyboard.type("vagner.s")
        inline = await pg.evaluate("(() => { const t = document.getElementById('to'); return [t.value, t.selectionStart, t.selectionEnd]; })()")
        await pg.keyboard.press("Control+k")
        await pg.wait_for_timeout(250)
        st = await pg.evaluate(PILLS)
        check("autocompletar: Ctrl+K usa o que foi digitado, não o complemento selecionado",
              inline[0].startswith("vagner.s.dias") and inline[1] == 8 and st["addr_to"]["pills"] == ["mariana@cliente.com.br", "Vagner Dias <vagner.s.dias@gmail.com>"], [inline, st["addr_to"]])
        await pg.locator("#to").click()
        await pg.keyboard.type("joana.prado@cliente.com.br, joão")
        await pg.keyboard.press("Control+k")
        await pg.wait_for_timeout(250)
        await pg.locator(".fx-plist").focus()
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(250)
        st = await pg.evaluate(PILLS)
        check("janela de escolha: o Para perde o foco sem o Thunderbird criar destinatários em dobro",
              st["addr_to"]["pills"] == ["mariana@cliente.com.br", "Vagner Dias <vagner.s.dias@gmail.com>", "joana.prado@cliente.com.br", "João Souza <joao.souza@fornecedor.com.br>"], st["addr_to"])
        # quem já está no Para não entra de novo; "Sobrenome, Nome <e-mail>" é um destinatário só
        await pg.locator("#to").click()
        await pg.keyboard.type("mariana; Souza, Beatriz <beatriz.souza@cliente.com.br>")
        await pg.keyboard.press("Control+k")
        await pg.wait_for_timeout(250)
        st = await pg.evaluate(PILLS)
        check("Verificar Nomes: sem repetir quem já está; “Sobrenome, Nome <e-mail>” inteiro",
              st["addr_to"]["pills"][-1] == "Souza, Beatriz <beatriz.souza@cliente.com.br>" and st["addr_to"]["pills"].count("mariana@cliente.com.br") == 1 and len(st["addr_to"]["pills"]) == 5, st["addr_to"])
        await pg.locator("#cc").click()
        await pg.get_by_role("button", name="Catálogo de Endereços").click()
        await pg.wait_for_timeout(250)
        await pg.keyboard.type("beatriz")
        await pg.wait_for_timeout(400)
        await pg.keyboard.press("Enter")
        await pg.keyboard.press("Enter")
        await pg.get_by_role("button", name="OK").click()
        await pg.wait_for_timeout(200)
        st = await pg.evaluate(PILLS)
        check("Selecionar Nomes: contato “Sobrenome, Nome” vira um destinatário válido", st["addr_cc"]["pills"] == ["Souza, Beatriz <beatriz.souza@cliente.com.br>"], st["addr_cc"])
        # enquanto a verificação espera um catálogo lento, o envio espera também (o texto saiu da caixa)
        await pg.evaluate("window.simSearchDelay = 900")
        await pg.locator("#bcc").evaluate("el => el.closest('.address-row').classList.remove('hidden')")
        await pg.locator("#bcc").click()
        await pg.keyboard.type("joão")
        await pg.keyboard.press("Control+k")
        await pg.wait_for_timeout(150)
        await pg.keyboard.press("Control+Enter")
        busy_flash = await pg.evaluate("document.querySelector('.fx-status').textContent")
        await pg.evaluate("controller.command('send')")
        prevented = await pg.evaluate("(() => { const ev = new CustomEvent('compose-send-message', { cancelable: true, detail: { msgType: 0 } }); window.dispatchEvent(ev); return ev.defaultPrevented; })()")
        sent = "send" in await pg.evaluate("controller.host.nativeLog")
        check("Verificar Nomes em curso: Ctrl+Enter, Enviar e o evento de envio esperam", "verificando os nomes" in busy_flash and prevented and not sent, [busy_flash, prevented, sent])
        await pg.wait_for_timeout(1200)
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(150)
        st = await pg.evaluate(PILLS)
        free = await pg.evaluate("(() => { const ev = new CustomEvent('compose-send-message', { cancelable: true, detail: { msgType: 1 } }); window.dispatchEvent(ev); return !ev.defaultPrevented && !controller.names.busy; })()")
        check("depois da verificação: o texto volta ao Cco e o envio segue normal", st["addr_bcc"]["input"] == "joão" and free, [st["addr_bcc"], free])
        await pg.evaluate("window.simSearchDelay = 0")
        check("autocompletar: sem erros no console", not logs, logs)
        await pg.close()

        # ---------- 14. assinaturas como no Outlook ----------
        CFG = {
            "assinaturas": [
                {"id": "corp", "nome": "Corporativa", "gerenciada": True, "html": '<div style="font-family: Arial; font-size: 10pt"><b>{nome}</b><br>{cargo}<br>{departamento} · {organizacao}<br>Tel.: {telefone}<br>Cel.: {celular}<br><a href="mailto:{email}">{email}</a></div>'},
                {"id": "pessoal", "nome": "Pessoal", "html": '<div>Abraços,<br>Ana</div><img src="https://example.com/logo.png" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a>'},
                {"id": "cli", "nome": "Cliente", "html": '<p style="margin:0">{nome} — {organizacao}</p>'},
            ],
            "assinaturaPadrao": {"@cliente.com.br": {"nova": "cli", "resposta": "cli"}, "ana@exemplo.com.br": {"nova": "pessoal", "resposta": "cli"}, "suporte@exemplo.com.br": {"nova": None}},
        }
        ORG = dict(CFG, assinaturaPadraoOrg={"*": {"nova": "corp"}})
        from urllib.parse import quote
        q = lambda cfg, extra="": "?cursor=1&cfg=" + quote(json.dumps(cfg)) + extra
        SIGS = f"[...{EDITOR}.body.children].filter(n => n.classList.contains('moz-signature')).map(n => n.innerHTML)"
        TOP = f"[...{EDITOR}.body.children].map(n => n.localName + (n.className ? '.' + n.className : '') + (n.localName == 'p' && !n.textContent.trim() ? '(vazio)' : ''))"
        pg, logs = await open_page(b, q(CFG))
        sigs = await pg.evaluate(SIGS)
        top = await pg.evaluate(TOP)
        caret = await pg.evaluate(f"(() => {{ const s = {EDITOR}.getSelection(); return s.anchorNode.nodeName + '@' + s.anchorOffset; }})()")
        undo = await pg.evaluate("controller.host.editor.undoStack.length")
        check("mensagem nova: a assinatura padrão da conta entra no lugar da do Thunderbird, limpa",
              sigs == ['<div>Abraços,<br>Ana</div><img src="https://example.com/logo.png"><a>x</a>'], sigs)
        check("mensagem nova: linha em branco antes da assinatura; cursor no lugar; fora do desfazer",
              top == ["p(vazio)", "p(vazio)", "div.moz-signature"] and caret == "P@0" and undo == 0, [top, caret, undo])
        check("mensagem nova: imagem de fora com o conteúdo remoto liberado", await pg.evaluate("controller.host.remoteContentCalls") == 1)
        # troca de conta: a padrão da conta nova (por domínio), no mesmo lugar
        await pg.evaluate("simSwitchIdentity('id2')")
        sigs = await pg.evaluate(SIGS)
        top = await pg.evaluate(TOP)
        check("troca de conta: entra a padrão da conta nova (regra do domínio)", sigs == ['<p style="margin: 0px;">Ana Souza — Cliente S.A.</p>'] and top == ["p(vazio)", "p(vazio)", "div.moz-signature"], [sigs, top])
        await pg.evaluate("simSwitchIdentity('id3')")
        check("troca de conta: “nenhuma” tira a assinatura do Thunderbird", await pg.evaluate(SIGS) == [], await pg.evaluate(TOP))
        await pg.evaluate("simSwitchIdentity('id1')")
        check("troca de conta: volta a padrão da primeira conta", len(await pg.evaluate(SIGS)) == 1 and "Abraços" in (await pg.evaluate(SIGS))[0])
        # menu Assinatura: lista, troca e Ctrl+Z
        await pg.get_by_role("button", name="Assinatura", exact=True).click()
        await pg.wait_for_timeout(120)
        items = await pg.evaluate("[...document.querySelectorAll('.fx-popup [role^=menuitem]')].map(b => b.textContent + (b.title ? ' {' + b.title + '}' : ''))")
        check("menu Assinatura: as assinaturas (a da organização marcada) e Assinaturas…",
              items == ["Corporativa {Assinatura definida pela sua organização}", "Pessoal", "Cliente", "Assinaturas…"], items)
        await pg.screenshot(path=os.path.join(OUT, "20_menu_assinatura.png"), clip={"x": 0, "y": 0, "width": 1000, "height": 360})
        await pg.get_by_role("menuitem", name="Corporativa").click()
        await pg.wait_for_timeout(120)
        sigs = await pg.evaluate(SIGS)
        check("menu Assinatura: troca a que está na mensagem, com os campos da conta",
              len(sigs) == 1 and "<b>Ana Souza</b><br>Gerente de Contas<br>Comercial · Bluecker<br>Tel.: +55 11 5555-0100<br>Cel.: +55 11 99999-0100<br>" in sigs[0] and 'href="mailto:ana@exemplo.com.br"' in sigs[0], sigs)
        # (No Gecko o foco só entra no corpo com um clique; o clique não mexe no desfazer.)
        await pg.frame_locator("#messageEditor").locator("body").click(position={"x": 30, "y": 14})
        await pg.frame_locator("#messageEditor").locator("body").press("Control+z")
        await pg.wait_for_timeout(120)
        sigs = await pg.evaluate(SIGS)
        check("menu Assinatura: um Ctrl+Z volta a anterior", len(sigs) == 1 and "Abraços" in sigs[0], sigs)
        await pg.get_by_role("button", name="Assinatura", exact=True).click()
        await pg.get_by_role("menuitem", name="Assinaturas…").click()
        await pg.wait_for_timeout(120)
        check("Assinaturas… abre a página pelo background", "openSignatures" in (await pg.evaluate("window.simCommands || []")))
        # conta sem campos: as linhas vazias saem, com o separador
        await pg.evaluate("simSwitchIdentity('id2'); controller.command('insertSignature', { id: 'corp' })")
        sigs = await pg.evaluate(SIGS)
        check("campos vazios: a linha sai; “departamento · organização” fica só com a organização",
              sigs == ['<div style="font-family: Arial; font-size: 10pt;"><b>Ana Souza</b><br>Cliente S.A.<br><a href="mailto:ana.souza@cliente.com.br">ana.souza@cliente.com.br</a></div>'], sigs)
        # no envio a assinatura recebe a fonte padrão no contêiner, como antes
        sent = await pg.evaluate("controller.host.send()")
        check("envio: o contêiner da assinatura sai com a fonte padrão", re.search(r'class="moz-signature" style="[^"]*font-family', sent or "") is not None, (sent or "")[-300:])
        check("assinaturas: sem erros no console", not logs, logs)
        await pg.close()

        # política da organização: vale acima do padrão do usuário
        pg, logs = await open_page(b, q(ORG))
        sigs = await pg.evaluate(SIGS)
        check("política: a assinatura da organização vence a do usuário na mensagem nova", len(sigs) == 1 and "<b>Ana Souza</b>" in sigs[0], sigs)
        await pg.evaluate("simSwitchIdentity('id3')")
        sigs = await pg.evaluate(SIGS)
        check("política: “*” vale também para a conta em que o usuário escolheu nenhuma", len(sigs) == 1 and "Suporte Bluecker" in sigs[0], sigs)
        await pg.close()

        # resposta: no lugar da do Thunderbird, acima da citação; encaminhar e resposta embaixo, sem a do Thunderbird
        pg, logs = await open_page(b, q(CFG, "&tipo=reply&conteudo=resposta"))
        top = await pg.evaluate(TOP)
        sigs = await pg.evaluate(SIGS)
        check("resposta por cima: a de respostas no lugar da do Thunderbird, acima da citação",
              top == ["p(vazio)", "p(vazio)", "div.moz-signature", "div.moz-cite-prefix", "blockquote"] and sigs == ['<p style="margin: 0px;">Ana Souza — Bluecker</p>'], [top, sigs])
        await pg.close()
        pg, logs = await open_page(b, q(CFG, "&tipo=forward&conteudo=encaminhada"))
        top = await pg.evaluate(TOP)
        inner = await pg.evaluate(f"{EDITOR}.querySelector('.moz-forward-container .moz-signature').outerHTML")
        check("encaminhar: a assinatura entra antes da mensagem encaminhada; a de dentro dela fica",
              top == ["p(vazio)", "p(vazio)", "div.moz-signature", "div.moz-forward-container"] and "Mariana" in inner, top)
        await pg.close()
        pg, logs = await open_page(b, q(CFG, "&tipo=reply&conteudo=resposta-fim&topo=1"))
        top = await pg.evaluate(TOP)
        check("resposta por cima com a do Thunderbird no fim: a da faixa sobe para logo abaixo do texto",
              top == ["p(vazio)", "p(vazio)", "div.moz-signature", "div.moz-cite-prefix", "blockquote"], top)
        await pg.evaluate("simSwitchIdentity('id3'); simSwitchIdentity('id1')")
        top = await pg.evaluate(TOP)
        check("troca de conta: a assinatura continua acima da citação (o Thunderbird põe a dele no fim)",
              top == ["p(vazio)", "p(vazio)", "div.moz-signature", "div.moz-cite-prefix", "blockquote"], top)
        await pg.close()
        pg, logs = await open_page(b, q(CFG, "&tipo=reply&conteudo=resposta-baixo"))
        top = await pg.evaluate(TOP)
        check("resposta embaixo da citação: a assinatura vai para o fim, depois do texto", top == ["div.moz-cite-prefix", "blockquote", "p(vazio)", "p(vazio)", "div.moz-signature"], top)
        await pg.close()
        # rascunho, texto puro e configuração que chega depois
        pg, logs = await open_page(b, q(CFG, "&tipo=other"))
        sigs = await pg.evaluate(SIGS)
        check("rascunho: fica como veio", sigs == ["-- <br>Ana Souza<br>Bluecker"], sigs)
        await pg.close()
        pg, logs = await open_page(b, q(CFG, "&texto=1"))
        sigs = await pg.evaluate(SIGS)
        dis = await pg.get_by_role("button", name="Assinatura", exact=True).is_disabled()
        check("texto sem formatação: a faixa não mexe na assinatura, e o botão fica desativado", sigs == ["-- <br>Ana Souza<br>Bluecker"] and dis, [sigs, dis])
        await pg.close()
        pg, logs = await open_page(b, q(CFG, "&semcfg=1"))
        before = await pg.evaluate(SIGS)
        await pg.evaluate("simApi.applyConfig(Object.assign({}, simApi.config))")
        after = await pg.evaluate(SIGS)
        check("configuração que chega depois do editor pronto: a assinatura padrão entra", before == ["-- <br>Ana Souza<br>Bluecker"] and len(after) == 1 and "Abraços" in after[0], [before, after])
        await pg.close()
        # sem nada configurado: fica a do Thunderbird
        pg, logs = await open_page(b, "?cursor=1")
        check("sem assinaturas da faixa: fica a do Thunderbird", await pg.evaluate(SIGS) == ["-- <br>Ana Souza<br>Bluecker"])
        await pg.get_by_role("button", name="Assinatura", exact=True).click()
        await pg.wait_for_timeout(100)
        items = await pg.evaluate("[...document.querySelectorAll('.fx-popup [role^=menuitem]')].map(b => b.textContent)")
        check("menu Assinatura sem assinaturas: só Assinaturas…", items == ["Assinaturas…"], items)
        await pg.close()

        # ---------- 15. aba Inserir ----------
        MENU = "[...document.querySelectorAll('.fx-popup .fx-mi')].map(b => b.querySelector('.fx-mlab').textContent + (b.disabled ? ' (off)' : ''))"
        LOG = "controller.host.nativeLog"
        pg, logs = await open_page(b, "?cursor=1")
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Prezada Mariana")
        await pg.get_by_role("tab", name="Inserir").click()
        await pg.wait_for_timeout(200)
        await pg.screenshot(path=os.path.join(OUT, "21_inserir.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 170})
        fit = await pg.evaluate("(() => { const p = document.querySelector('.fx-panel:not([hidden])'); return { sw: p.scrollWidth, cw: p.clientWidth, groups: [...p.querySelectorAll('.fx-group')].map(g => g.dataset.group), collapsed: [...p.querySelectorAll('.fx-gcollapsed')].length }; })()")
        check("Inserir: seis grupos como no Outlook, cabendo em 1440 px",
              fit["groups"] == ["insertInclude", "tables", "illustrations", "links", "text", "symbols"] and fit["sw"] <= fit["cw"] + 1 and fit["collapsed"] == 0, fit)
        # com o foco no Assunto, como no Outlook: o que vai no corpo fica desativado; anexar continua
        await pg.locator("#msgSubject").click()
        await pg.wait_for_timeout(80)
        dis = await pg.evaluate("Object.fromEntries(['Tabela', 'Imagens', 'Link', 'Indicador', 'Partes Rápidas', 'Data e Hora', 'Emoji', 'Símbolo', 'Linha Horizontal', 'Anexar Mensagem', 'Cartão de Visita'].map(n => [n, [...document.querySelectorAll('#fx-panel-inserir button')].find(b => b.getAttribute('aria-label') == n).disabled]))")
        check("Inserir com o foco no Assunto: tabela, imagens, texto e símbolos desativados; anexar ativo",
              all(dis[n] for n in ["Tabela", "Imagens", "Link", "Indicador", "Partes Rápidas", "Data e Hora", "Emoji", "Símbolo", "Linha Horizontal"]) and not dis["Anexar Mensagem"] and not dis["Cartão de Visita"], dis)
        await frame.locator("body").click(position={"x": 200, "y": 14})
        await pg.keyboard.press("End")
        # Tabela: a grade mostra colunas × linhas; o clique insere e o cursor vai para a primeira célula
        await pg.get_by_role("button", name="Tabela", exact=True).click()
        await pg.wait_for_timeout(150)
        items = await pg.evaluate(MENU)
        check("Tabela ▾: grade e, fora da tabela, só Inserir Tabela… ativo",
              items[0] == "Inserir Tabela…" and all(i.endswith("(off)") for i in items[1:]) and len(items) == 11 and await pg.evaluate("document.querySelectorAll('.fx-tgcell').length") == 80, items)
        await pg.locator(".fx-tgcell").nth(12).hover()
        await pg.wait_for_timeout(60)
        head = await pg.evaluate("document.querySelector('.fx-tglabel').textContent")
        lit = await pg.evaluate("document.querySelectorAll('.fx-tgcell.fx-on').length")
        await pg.screenshot(path=os.path.join(OUT, "22_tabela.png"), clip={"x": 300, "y": 40, "width": 360, "height": 560})
        check("grade: passar o mouse marca 3 × 2", head == "Tabela 3×2" and lit == 6, [head, lit])
        await pg.locator(".fx-tgcell").nth(12).click()
        await pg.wait_for_timeout(150)
        top = await pg.evaluate(f"[...{EDITOR}.body.children].map(n => n.localName + (n.className ? '.' + n.className : ''))")
        shape = await pg.evaluate(f"(() => {{ const t = {EDITOR}.querySelector('table'); return t ? [t.rows.length, t.rows[0].cells.length, t.getAttribute('style'), t.rows[0].cells[0].getAttribute('style')] : null; }})()")
        caret = await pg.evaluate(f"(() => {{ const s = {EDITOR}.getSelection(); return s.anchorNode.nodeName + ':' + ({EDITOR}.querySelector('td') == s.anchorNode); }})()")
        check("tabela 3 × 2: largura toda, bordas finas, colunas iguais; parágrafo depois; cursor na primeira célula",
              shape and shape[:2] == [2, 3] and "width: 100%" in shape[2] and "width: 33.33%" in shape[3] and "border: 1px solid" in shape[3]
              and top == ["p", "table", "p", "div.moz-signature"] and caret == "TD:true", [shape, top, caret])
        # pelo teclado: Enter no Tabela ▾, setas na grade, Enter insere 2 × 2 onde o cursor estava
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(100)
        await pg.get_by_role("button", name="Tabela", exact=True).click()
        await pg.wait_for_timeout(150)
        items = await pg.evaluate(MENU)
        check("Tabela ▾ com o cursor na tabela: inserir e excluir linhas e colunas ativos; Mesclar com célula à direita; Dividir só em célula mesclada",
              [i for i in items if i.endswith("(off)")] == ["Dividir Células (off)"] and "Mesclar Células" in items, items)
        await pg.get_by_role("menuitem", name="Inserir Linhas Abaixo").click()
        await pg.wait_for_timeout(120)
        rows = await pg.evaluate(f"{EDITOR}.querySelector('table').rows.length")
        check("Inserir Linhas Abaixo pelo comando do Thunderbird", rows == 3 and "cmd_InsertRowBelow@editor" in await pg.evaluate(LOG), rows)
        await frame.locator("body").press("Control+z")
        await frame.locator("body").press("Control+z")
        await pg.wait_for_timeout(100)
        check("dois Ctrl+Z: a linha e a tabela saem", await pg.evaluate(f"!{EDITOR}.querySelector('table')") and (await body_html(pg)).startswith("<p>Prezada Mariana</p>"), (await body_html(pg))[:160])
        await frame.locator("body").click(position={"x": 200, "y": 14})
        await pg.keyboard.press("End")
        await pg.evaluate("controller.ui.focusRibbon()")
        on_tab = await pg.evaluate("document.activeElement.id")
        await pg.keyboard.press("ArrowDown")
        for _ in range(10):
            if await pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Tabela":
                break
            await pg.keyboard.press("ArrowRight")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(100)
        await pg.keyboard.press("ArrowRight")
        await pg.keyboard.press("ArrowDown")
        await pg.wait_for_timeout(60)
        head = await pg.evaluate("document.querySelector('.fx-tglabel') && document.querySelector('.fx-tglabel').textContent")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(150)
        shape = await pg.evaluate(f"(() => {{ const t = {EDITOR}.querySelector('table'); return t ? [t.rows.length, t.rows[0].cells.length] : null; }})()")
        check("Tabela pelo teclado: Enter abre a grade, as setas marcam 2 × 2, Enter insere no corpo", on_tab == "fx-tab-inserir" and head == "Tabela 2×2" and shape == [2, 2], [on_tab, head, shape])
        await frame.locator("body").press("Control+z")
        await pg.wait_for_timeout(80)
        # Emoji e Símbolo: no ponto do cursor, um Ctrl+Z cada; o símbolo usado vai para o começo do menu
        await frame.locator("body").click(position={"x": 200, "y": 14})
        await pg.keyboard.press("End")
        await pg.get_by_role("button", name="Emoji", exact=True).click()
        await pg.wait_for_timeout(120)
        await pg.screenshot(path=os.path.join(OUT, "23_emoji.png"), clip={"x": 700, "y": 40, "width": 740, "height": 400})
        await pg.locator(".fx-glyph", has_text="👍").click()
        await pg.wait_for_timeout(80)
        await pg.get_by_role("button", name="Símbolo", exact=True).click()
        await pg.wait_for_timeout(120)
        await pg.locator(".fx-glyph", has_text="Ω").click()
        await pg.wait_for_timeout(80)
        text = await pg.evaluate(f"{EDITOR}.body.firstElementChild.textContent")
        await pg.get_by_role("button", name="Símbolo", exact=True).click()
        await pg.wait_for_timeout(120)
        firsts = await pg.evaluate("[...document.querySelectorAll('.fx-glyph')].slice(0, 3).map(b => b.textContent)")
        await pg.get_by_role("menuitem", name="Mais Símbolos…").click()
        await pg.wait_for_timeout(80)
        check("Emoji e Símbolo no ponto do cursor; o último símbolo usado vem primeiro; Mais Símbolos… é o do Thunderbird",
              text == "Prezada Mariana👍Ω" and firsts == ["Ω", "€", "£"] and "cmd_insertChars@editor" in await pg.evaluate(LOG), [text, firsts])
        await frame.locator("body").press("Control+z")
        await pg.wait_for_timeout(80)
        text = await pg.evaluate(f"{EDITOR}.body.firstElementChild.textContent")
        check("um Ctrl+Z tira só o último símbolo", text == "Prezada Mariana👍", text)
        # (No simulador o desfazer refaz o HTML e perde o cursor: volta ao fim da linha.)
        await frame.locator("body").click(position={"x": 300, "y": 14})
        await pg.keyboard.press("End")
        # Data e Hora: lista de formatos no idioma; o escolhido entra; a próxima vez começa nele
        await pg.get_by_role("button", name="Data e Hora").click()
        await pg.wait_for_timeout(150)
        await pg.screenshot(path=os.path.join(OUT, "24_data_hora.png"))
        dlg = await pg.evaluate("(() => { const d = document.querySelector('.fx-dialog'); return { title: d.querySelector('.fx-dtitle').textContent, rows: [...d.querySelectorAll('.fx-prow')].map(r => r.textContent), sel: d.querySelector('[aria-selected=true]').textContent, focus: document.activeElement.classList.contains('fx-plist') }; })()")
        want = await pg.evaluate("[new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date()), new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date())]")
        check("Data e Hora: formatos em português, o primeiro escolhido, foco na lista", dlg["title"] == "Data e Hora" and dlg["rows"][0] == want[0] and want[1] in dlg["rows"] and dlg["sel"] == want[0] and dlg["focus"] and len(dlg["rows"]) >= 8, dlg)
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("ArrowDown")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(100)
        text = await pg.evaluate(f"{EDITOR}.body.firstElementChild.textContent")
        check("Data e Hora: Enter na lista insere o formato escolhido", text == "Prezada Mariana👍" + want[1], text)
        await pg.get_by_role("button", name="Data e Hora").click()
        await pg.wait_for_timeout(150)
        again = await pg.evaluate("document.querySelector('.fx-dialog [aria-selected=true]').textContent")
        await pg.select_option(".fx-dialog select", "en-US")
        await pg.wait_for_timeout(80)
        en = await pg.evaluate("[...document.querySelectorAll('.fx-dialog .fx-prow')].map(r => r.textContent)")
        want_en = await pg.evaluate("new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date())")
        sel_en = await pg.evaluate("document.querySelector('.fx-dialog [aria-selected=true]').textContent")
        await pg.keyboard.press("Escape")
        check("Data e Hora: volta no formato usado; em inglês, a lista muda e o formato continua", again == want[1] and want_en in en and sel_en == want_en, [again, sel_en])
        # nativos do Thunderbird
        for name, cmd in [("Imagens", "cmd_image"), ("Link", "cmd_link"), ("Indicador", "cmd_anchor"), ("Linha Horizontal", "cmd_hline")]:
            await pg.get_by_role("button", name=name, exact=True).click()
            await pg.wait_for_timeout(40)
        log = await pg.evaluate(LOG)
        check("Imagens, Link, Indicador e Linha Horizontal são os do Thunderbird", all(c + "@editor" in log for c in ["cmd_image", "cmd_link", "cmd_anchor", "cmd_hline"]), log[-6:])
        # Assinatura grande no Inserir: o mesmo menu da aba Mensagem
        await pg.locator("#fx-panel-inserir").get_by_role("button", name="Assinatura").click()
        await pg.wait_for_timeout(100)
        check("Inserir → Assinatura ▾: o mesmo menu", await pg.evaluate(MENU) == ["Assinaturas…"], await pg.evaluate(MENU))
        await pg.keyboard.press("Escape")
        check("Inserir: sem erros no console", not logs, logs)
        await pg.close()

        # Tabela em cada lugar do texto: nada de parágrafo vazio invisível; sempre há onde escrever embaixo
        pg, logs = await open_page(b, "?cursor=1")
        TBL = """(cases) => {
          const d = document.getElementById('messageEditor').contentDocument;
          const eng = controller.engine;
          const out = [];
          for (const [html, plain] of cases) {
            d.body.innerHTML = html;
            const c = d.createTreeWalker(d.body, 128).nextNode();
            const r = d.createRange();
            const prev = c.previousSibling, next = c.nextSibling;
            if (prev && prev.nodeType == 3) {
              r.setStart(prev, prev.length);
              if (next && next.nodeType == 3) { prev.appendData(next.data); next.remove(); }
            } else if (next && next.nodeType == 3) {
              r.setStart(next, 0);
            } else {
              r.setStartBefore(c);
            }
            c.remove();
            r.collapse(true);
            const s = d.getSelection();
            s.removeAllRanges();
            s.addRange(r);
            const saved = eng.config.paragrafoSemEspaco;
            eng.config.paragrafoSemEspaco = !plain;
            const t = eng.run('insertTable', { cols: 2, rows: 2 });
            eng.config.paragrafoSemEspaco = saved;
            const inFirst = s.anchorNode == t.querySelector('td');
            out.push(d.body.innerHTML.replace(t.outerHTML, '[T]') + (inFirst ? '' : ' (cursor fora da 1ª célula)'));
          }
          return out;
        }"""
        SIG = '<div class="moz-signature">-- <br>Ana</div>'
        CITE = '<blockquote type="cite"><p>x</p></blockquote>'
        cases = [
            ("<p><!--c-->Prezada Mariana</p>", False, "[T]<p>Prezada Mariana</p>"),
            ("<p>Prezada<!--c--> Mariana</p>", False, "<p>Prezada</p>[T]<p> Mariana</p>"),
            ("<p>Prezada Mariana<!--c--></p>", False, "<p>Prezada Mariana</p>[T]<p><br></p>"),
            ("<p>Prezada Mariana<!--c--></p>" + SIG, False, "<p>Prezada Mariana</p>[T]<p><br></p>" + SIG),
            ("<p>Oi</p><!--c-->" + SIG, False, "<p>Oi</p>[T]<p><br></p>" + SIG),
            ("<p>Oi<!--c--></p>" + CITE, False, "<p>Oi</p>[T]<p><br></p>" + CITE),
            ("<p><!--c--><br></p>", False, "[T]<p><br></p>"),
            ("Texto<!--c-->", False, "Texto[T]<p><br></p>"),
            ("Texto<!--c-->", True, "Texto[T]<br>"),
            ("<ul><li>um<!--c--> dois</li></ul>", False, "<ul><li>um[T] dois</li></ul>"),
            ("<ul><li>um dois<!--c--></li></ul>", False, "<ul><li>um dois[T]<br></li></ul>"),
            # texto formatado pela faixa (cor em <span>, Ênfase em <em>): o pedaço de baixo fica
            # com o elemento vazio e ganha o <br> dentro dele; o de cima sai
            ('<p><span style="color: rgb(192, 0, 0);">Oi<!--c--></span></p>' + SIG, False, '<p><span style="color: rgb(192, 0, 0);">Oi</span></p>[T]<p><span style="color: rgb(192, 0, 0);"><br></span></p>' + SIG),
            ("<p><em>Oi<!--c--></em></p>", False, "<p><em>Oi</em></p>[T]<p><em><br></em></p>"),
            ("<p><b>Oi<!--c--></b></p>", False, "<p><b>Oi</b></p>[T]<p><br></p>"),
            ('<p><span style="color: rgb(192, 0, 0);"><!--c-->Oi</span></p>', False, '[T]<p><span style="color: rgb(192, 0, 0);">Oi</span></p>'),
            # linha em branco do usuário com &nbsp;, antes ou depois: fica
            ("<p>Olá,</p><p>&nbsp;</p><p><!--c--><br></p>", False, "<p>Olá,</p><p>&nbsp;</p>[T]<p><br></p>"),
            ("<p>Oi<!--c--></p><p>&nbsp;</p>", False, "<p>Oi</p>[T]<p>&nbsp;</p>"),
        ]
        got = await pg.evaluate(TBL, [[h, p] for h, p, _ in cases])
        bad = [[c[0], g] for c, g in zip(cases, got) if g != c[2]]
        check("Tabela no começo, no meio e no fim do parágrafo, antes da assinatura e da citação, num item de lista, em texto formatado: a linha de baixo existe, nenhum parágrafo invisível fica e a linha em branco do usuário continua", not bad, bad)
        # a linha de baixo tem altura: o clique embaixo da tabela põe o cursor nela
        await pg.evaluate(f"{EDITOR}.body.innerHTML = '<p>Prezada Mariana</p>' + {json.dumps(SIG)}")
        await pg.frame_locator("#messageEditor").locator("body").click(position={"x": 200, "y": 14})
        await pg.keyboard.press("End")
        await pg.evaluate("controller.engine.run('insertTable', { cols: 2, rows: 2 })")
        await pg.wait_for_timeout(80)
        box = await pg.evaluate(f"(() => {{ const t = {EDITOR}.querySelector('table'); const p = t.nextElementSibling; const r = p.getBoundingClientRect(); return [p.localName, Math.round(r.height), Math.round(r.top - t.getBoundingClientRect().bottom)]; }})()")
        check("a linha embaixo da tabela aparece (tem a altura de uma linha)", box[0] == "p" and box[1] >= 12 and box[2] >= 0, box)
        # Mesclar e Dividir Células seguem o Thunderbird: mesclar pede célula à direita; dividir, célula mesclada
        await pg.evaluate(f"{EDITOR}.body.innerHTML = '<table border=1><tbody><tr><td colspan=2>a</td></tr><tr><td>b</td><td>c</td></tr></tbody></table><p><br></p>'")
        await pg.get_by_role("tab", name="Inserir").click()
        states = []
        for word in ["a", "b", "c"]:
            await pg.evaluate(f"(() => {{ const d = {EDITOR}; const td = [...d.querySelectorAll('td')].find(c => c.textContent == {json.dumps(word)}); d.getSelection().collapse(td.firstChild, 1); }})()")
            await pg.evaluate("controller.engine.scheduleState(0)")
            await pg.wait_for_timeout(80)
            await pg.get_by_role("button", name="Tabela", exact=True).click()
            await pg.wait_for_timeout(100)
            items = await pg.evaluate(MENU)
            await pg.keyboard.press("Escape")
            states.append([i for i in items if i.startswith(("Mesclar", "Dividir"))])
        check("Mesclar e Dividir Células: como o Thunderbird permite em cada célula",
              states == [["Mesclar Células (off)", "Dividir Células"], ["Mesclar Células", "Dividir Células (off)"], ["Mesclar Células (off)", "Dividir Células (off)"]], states)
        check("tabela nos cantos: sem erros no console", not logs, logs)
        await pg.close()

        # Anexar Mensagem e Cartão de Visita
        pg, logs = await open_page(b, "?cursor=1&sel=1")
        await pg.get_by_role("tab", name="Inserir").click()
        await pg.get_by_role("button", name="Anexar Mensagem").click()
        await pg.wait_for_timeout(300)
        DLGM = "(() => { const d = document.querySelector('.fx-dialog'); return d ? { title: d.querySelector('.fx-dtitle').textContent, folder: d.querySelector('.fx-dfolder').selectedOptions[0].textContent.trim(), rows: [...d.querySelectorAll('.fx-plist .fx-prow')].map(r => r.querySelector('.fx-pname').textContent + (r.getAttribute('aria-selected') == 'true' ? ' *' : '')), note: d.querySelector('.fx-dnote').textContent } : null; })()"
        dlg = await pg.evaluate(DLGM)
        await pg.screenshot(path=os.path.join(OUT, "25_anexar_mensagem.png"))
        check("Anexar Mensagem: a pasta da janela principal, mais novas primeiro, com a selecionada lá marcada",
              dlg and dlg["title"] == "Anexar Mensagem" and dlg["folder"] == "Entrada"
              and dlg["rows"] == ["Contrato assinado", "Reunião de alinhamento *", "Proposta de renovação do contrato"] and dlg["note"] == "3 mensagens", dlg)
        await pg.locator(".fx-dialog .fx-dsearch").fill("contrato")
        await pg.wait_for_timeout(400)
        dlg = await pg.evaluate(DLGM)
        check("Anexar Mensagem: pesquisa no assunto", dlg["rows"] == ["Contrato assinado", "Proposta de renovação do contrato"], dlg)
        await pg.locator(".fx-dialog .fx-plist").focus()
        await pg.keyboard.press("Control+a")
        await pg.get_by_role("button", name="Anexar", exact=True).click()
        await pg.wait_for_timeout(200)
        att = await pg.evaluate("(window.simAttachments || []).map(a => a.name + ' ' + a.type)")
        flash = await pg.evaluate("document.querySelector('.fx-status').textContent")
        check("Anexar Mensagem: as escolhidas vão como .eml (message/rfc822)",
              att == ["Contrato assinado.eml message/rfc822", "Proposta de renovação do contrato.eml message/rfc822"] and flash == "2 mensagens anexadas.", [att, flash])
        await pg.get_by_role("button", name="Anexar Mensagem").click()
        await pg.wait_for_timeout(300)
        await pg.select_option(".fx-dialog .fx-dfolder", "imap://suporte/INBOX")
        await pg.wait_for_timeout(200)
        broken = await pg.evaluate(DLGM)
        await pg.select_option(".fx-dialog .fx-dfolder", "mailbox://ana/Inbox/Clientes")
        await pg.wait_for_timeout(200)
        sub = await pg.evaluate(DLGM)
        await pg.keyboard.press("Escape")
        check("Anexar Mensagem: pasta sem índice avisa; subpasta lista as dela", broken["rows"] == [] and "Não foi possível ler" in broken["note"] and sub["rows"] == ["Pedido de orçamento"], [broken, sub])
        # Cartão de Visita ▾
        await pg.get_by_role("button", name="Cartão de Visita").click()
        await pg.wait_for_timeout(120)
        items = await pg.evaluate(MENU)
        check("Cartão de Visita ▾: o meu e outros", items == ["Meu Cartão de Visita (vCard)", "Outros Cartões de Visita…"], items)
        await pg.get_by_role("menuitemcheckbox", name="Meu Cartão de Visita (vCard)").click()
        await pg.wait_for_timeout(60)
        await pg.get_by_role("button", name="Cartão de Visita").click()
        await pg.wait_for_timeout(120)
        checked = await pg.evaluate("document.querySelector('.fx-popup [role=menuitemcheckbox]').getAttribute('aria-checked')")
        await pg.get_by_role("menuitem", name="Outros Cartões de Visita…").click()
        await pg.wait_for_timeout(300)
        await pg.keyboard.type("joão")
        await pg.wait_for_timeout(400)
        rows = await pg.evaluate("[...document.querySelectorAll('.fx-dialog .fx-plist .fx-prow')].map(r => r.querySelector('.fx-pname').textContent)")
        await pg.keyboard.press("Enter")
        await pg.keyboard.press("Control+a")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(200)
        att = await pg.evaluate("(window.simAttachments || []).filter(a => a.type == 'text/vcard').map(a => a.name)")
        check("Meu Cartão de Visita liga o do Thunderbird; Outros Cartões de Visita anexa o vCard de cada contato",
              checked == "true" and rows == ["João Silva", "João Souza"] and att == ["João Silva.vcf", "João Souza.vcf"], [checked, rows, att])
        check("anexar: sem erros no console", not logs, logs)
        await pg.close()

        # texto sem formatação (editor de texto puro): símbolo, emoji e data valem; tabela e imagens não
        pg, logs = await open_page(b, "?texto=1")
        await pg.frame_locator("#messageEditor").locator("body").click(position={"x": 30, "y": 14})
        await pg.get_by_role("tab", name="Inserir").click()
        await pg.wait_for_timeout(120)
        dis = await pg.evaluate("Object.fromEntries(['Tabela', 'Imagens', 'Emoji', 'Símbolo', 'Data e Hora', 'Partes Rápidas'].map(n => [n, [...document.querySelectorAll('#fx-panel-inserir button')].find(b => b.getAttribute('aria-label') == n).disabled]))")
        check("texto puro: Emoji, Símbolo, Data e Hora e Partes Rápidas ativos; Tabela e Imagens não",
              dis == {"Tabela": True, "Imagens": True, "Emoji": False, "Símbolo": False, "Data e Hora": False, "Partes Rápidas": False}, dis)
        await pg.close()

        # inglês
        pg, logs = await open_page(b, "?idioma=en-US")
        await pg.get_by_role("tab", name="Insert").click()
        await pg.wait_for_timeout(120)
        labels = await pg.evaluate("[...document.querySelectorAll('#fx-panel-inserir .fx-glabel')].map(g => g.textContent)")
        btns = await pg.evaluate("[...document.querySelectorAll('#fx-panel-inserir .fx-large:not(.fx-gbtn), #fx-panel-inserir .fx-lsplit .fx-main')].map(b => b.getAttribute('aria-label'))")
        await pg.screenshot(path=os.path.join(OUT, "26_insert_en.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 170})
        check("en-US: aba Insert", labels == ["Include", "Tables", "Illustrations", "Links", "Text", "Symbols"]
              and btns == ["Attach File", "Attach Message", "Business Card", "Signature", "Table", "Pictures", "Link", "Bookmark", "Quick Parts", "Date & Time", "Emoji", "Symbol", "Horizontal Line"], [labels, btns])
        fit = await pg.evaluate("(() => { const p = document.querySelector('.fx-panel:not([hidden])'); return p.scrollWidth <= p.clientWidth + 1; })()")
        check("en-US: Insert cabe em 1440 px", fit)
        await pg.close()

        # ---------- 16. Partes Rápidas ----------
        QP = {
            "partesRapidas": [
                {"id": "org1", "nome": "Endereço da empresa", "gerenciada": True, "html": "<p>Av. Paulista, 1000 — São Paulo</p>"},
                {"id": "u1", "nome": "Contato", "html": '<b>{nome}</b> · {email}<img src="https://example.com/x.png" onerror="alert(1)"><script>alert(2)</script>'},
            ],
        }
        pg, logs = await open_page(b, "?cursor=1&cfg=" + quote(json.dumps(QP)))
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Prezada Mariana")
        await pg.get_by_role("tab", name="Inserir").click()
        await pg.get_by_role("button", name="Partes Rápidas").click()
        await pg.wait_for_timeout(150)
        await pg.screenshot(path=os.path.join(OUT, "27_partes.png"), clip={"x": 500, "y": 40, "width": 600, "height": 300})
        items = await pg.evaluate("[...document.querySelectorAll('.fx-popup .fx-mi')].map(b => b.textContent + (b.title ? ' {' + b.title + '}' : '') + (b.disabled ? ' (off)' : ''))")
        check("Partes Rápidas ▾: a galeria (nome e começo do texto; a da organização marcada), salvar sem seleção desativado",
              items == ["Endereço da empresaAv. Paulista, 1000 — São Paulo {Parte Rápida definida pela sua organização}", "Contato{nome} · {email}",
                        "Salvar Seleção na Galeria de Partes Rápidas… (off)", "Partes Rápidas…"], items)
        # o HTML que vai ao editor (o insertHTML do Chromium tiraria o script sozinho)
        await pg.evaluate("(() => { const e = controller.engine; const orig = e.insertHTML.bind(e); window.qpHTML = []; e.insertHTML = h => { window.qpHTML.push(h); return orig(h); }; })()")
        await pg.get_by_role("menuitem", name="Contato").click()
        await pg.wait_for_timeout(120)
        h = await body_html(pg)
        sent = await pg.evaluate("window.qpHTML")
        text = await pg.evaluate(f"{EDITOR}.body.firstElementChild.textContent")
        check("Parte Rápida no cursor, limpa, com os campos da conta e o conteúdo remoto liberado",
              text == "Prezada MarianaAna Souza · ana@exemplo.com.br" and re.search(r"<b[^>]*>Ana Souza</b>", h) is not None and "onerror" not in h and "<script" not in h
              and 'src="https://example.com/x.png"' in h and await pg.evaluate("controller.host.remoteContentCalls") == 1, h[:300])
        check("Parte Rápida: o HTML entregue ao editor já vem limpo (sem script nem eventos)",
              len(sent) == 1 and "<b>Ana Souza</b>" in sent[0] and not re.search(r"<script|onerror|alert\(", sent[0]) and 'src="https://example.com/x.png"' in sent[0], sent)
        await frame.locator("body").press("Control+z")
        await pg.wait_for_timeout(80)
        check("Parte Rápida: um Ctrl+Z desfaz", (await body_html(pg)).startswith("<p>Prezada Mariana</p>"), (await body_html(pg))[:120])
        # salvar a seleção na galeria
        await select_word(pg, "Prezada Mariana")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(100)
        await pg.get_by_role("button", name="Partes Rápidas").click()
        await pg.wait_for_timeout(120)
        await pg.get_by_role("menuitem", name="Salvar Seleção na Galeria de Partes Rápidas…").click()
        await pg.wait_for_timeout(150)
        dlg = await pg.evaluate("(() => { const d = document.querySelector('.fx-dialog'); return { title: d.querySelector('.fx-dtitle').textContent, value: d.querySelector('input').value, focus: document.activeElement.tagName }; })()")
        check("Salvar Seleção: o nome sugerido é o começo do texto", dlg == {"title": "Criar Novo Bloco de Construção", "value": "Prezada Mariana", "focus": "INPUT"}, dlg)
        await pg.keyboard.type("Endereço da empresa")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(100)
        err = await pg.evaluate("document.querySelector('.fx-dialog .fx-derr').textContent")
        check("Salvar Seleção: o nome de uma Parte Rápida da organização não vale", "organização" in err, err)
        await pg.keyboard.press("Control+a")
        await pg.keyboard.type("Saudação")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(200)
        args = await pg.evaluate("(window.simCommandArgs || []).filter(c => c[0] == 'saveQuickPart').map(c => c[1])")
        flash = await pg.evaluate("document.querySelector('.fx-status').textContent")
        check("Salvar Seleção: vai para o background com o HTML do trecho", len(args) == 1 and args[0]["nome"] == "Saudação" and args[0]["html"] == "Prezada Mariana" and args[0]["id"] is None and "Saudação" in flash, [args, flash])
        await pg.get_by_role("button", name="Partes Rápidas").click()
        await pg.wait_for_timeout(120)
        items = await pg.evaluate("[...document.querySelectorAll('.fx-popup .fx-mi .fx-mlab')].map(l => l.textContent)")
        await pg.keyboard.press("Escape")
        check("a Parte Rápida nova aparece na galeria", items[:3] == ["Endereço da empresa", "Contato", "Saudação"], items)
        # mesmo nome de uma parte sua: pergunta antes de substituir
        await select_word(pg, "Mariana")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(100)
        await pg.evaluate("controller.command('saveQuickPart')")
        await pg.wait_for_timeout(150)
        await pg.keyboard.press("Control+a")
        await pg.keyboard.type("contato")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(150)
        q = await pg.evaluate("document.querySelector('.fx-dialog .fx-dmsg').textContent")
        await pg.get_by_role("button", name="Substituir").click()
        await pg.wait_for_timeout(200)
        args = await pg.evaluate("(window.simCommandArgs || []).filter(c => c[0] == 'saveQuickPart').map(c => c[1])")
        check("mesmo nome: pergunta e substitui a parte do usuário", "Substituir" in q and args[-1]["id"] == "u1" and args[-1]["html"] == "Mariana", [q, args[-1]])
        # mensagem que vai como texto sem formatação: a parte entra só como texto
        await pg.evaluate("controller.setMessageState({ deliveryFormat: 'plaintext' })")
        await frame.locator("body").click(position={"x": 300, "y": 14})
        await pg.keyboard.press("End")
        sent_before = len(await pg.evaluate("window.qpHTML"))
        await pg.evaluate("controller.command('insertQuickPart', { id: 'org1' })")
        await pg.wait_for_timeout(120)
        h = await body_html(pg)
        text = await pg.evaluate(f"{EDITOR}.body.firstElementChild.textContent")
        check("mensagem em Texto sem Formatação: a Parte Rápida entra só como texto, no cursor",
              text == "Prezada MarianaAv. Paulista, 1000 — São Paulo" and len(await pg.evaluate("window.qpHTML")) == sent_before and "<p>Av." not in h, [text, h[:200]])
        await pg.evaluate("controller.setMessageState({ deliveryFormat: 'auto' })")
        check("partes rápidas: sem erros no console", not logs, logs)
        await pg.close()

        # ---------- 17. aba Ajuda ----------
        SUP = {"suporte": {"nome": "Service Desk Bluecker", "email": "suporte@bluecker.com", "telefone": "+55 11 5555-0000", "portal": "https://suporte.bluecker.com"}}
        pg, logs = await open_page(b)
        await pg.get_by_role("tab", name="Ajuda").click()
        await pg.wait_for_timeout(120)
        await pg.screenshot(path=os.path.join(OUT, "28_ajuda.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 170})
        dis = await pg.evaluate("[...document.querySelectorAll('#fx-panel-ajuda .fx-large:not(.fx-gbtn)')].map(b => b.getAttribute('aria-label') + (b.disabled ? ' (off)' : ''))")
        check("Ajuda: sem Contatar o Suporte nem Diagnóstico da Faixa na faixa",
              dis == ["Ajuda", "Atalhos de Teclado", "Opções da Faixa…", "Sobre"], dis)
        for name in ["Ajuda", "Atalhos de Teclado", "Opções da Faixa…"]:
            await pg.get_by_role("button", name=name, exact=True).click()
            await pg.wait_for_timeout(60)
        await pg.wait_for_timeout(100)
        cmds = await pg.evaluate("window.simCommands || []")
        check("Ajuda, Atalhos e Opções abrem as páginas pelo background", cmds[-3:] == ["openHelp", "openShortcuts", "openOptions"], cmds)
        await pg.get_by_role("button", name="Sobre", exact=True).click()
        await pg.wait_for_timeout(120)
        about = await pg.evaluate("document.querySelector('.fx-dialog').innerText")
        await pg.screenshot(path=os.path.join(OUT, "29_sobre.png"))
        await pg.get_by_role("button", name="Diagnóstico da Faixa").last.click()
        await pg.wait_for_timeout(100)
        check("Sobre: versões; o botão abre o diagnóstico", f"Faixa de Opções {VERSION}" in about and "Thunderbird 153" in about and (await pg.evaluate("window.simCommands"))[-1] == "openDiagnostics", about)
        await pg.close()
        pg, logs = await open_page(b, "?cfg=" + quote(json.dumps(SUP)))
        await pg.get_by_role("tab", name="Ajuda").click()
        await pg.wait_for_timeout(120)
        dis = await pg.evaluate("[...document.querySelectorAll('#fx-panel-ajuda .fx-large:not(.fx-gbtn)')].map(b => b.getAttribute('aria-label'))")
        check("Ajuda: com suporte na política, Contatar o Suporte continua fora da faixa", "Contatar o Suporte" not in dis and len(dis) == 4, dis)
        check("ajuda: sem erros no console", not logs, logs)
        await pg.close()

        # ---------- 18. estilos novos e Texto sem Formatação ----------
        pg, logs = await open_page(b, "?cursor=1")
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Alfa beta gama delta")
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await pg.wait_for_timeout(120)
        await pg.get_by_role("button", name="Todos os estilos").click()
        await pg.wait_for_timeout(120)
        names = await pg.evaluate("[...document.querySelectorAll('.fx-popup .fx-tile')].map(t => t.getAttribute('aria-label'))")
        await pg.screenshot(path=os.path.join(OUT, "31_estilos.png"), clip={"x": 700, "y": 40, "width": 740, "height": 360})
        await pg.keyboard.press("Escape")
        check("galeria: os 12 estilos, com Subtítulo, Ênfase Sutil, Ênfase, Ênfase Intensa e Forte",
              names == ["Normal", "Sem Espaçamento", "Título 1", "Título 2", "Título 3", "Título", "Subtítulo", "Ênfase Sutil", "Ênfase", "Ênfase Intensa", "Forte", "Citação"], names)
        async def apply_style(label):
            await pg.get_by_role("button", name="Todos os estilos").click()
            await pg.wait_for_timeout(100)
            await pg.locator(".fx-popup .fx-tile[aria-label='" + label + "']").click()
            await pg.wait_for_timeout(100)
        await select_word(pg, "beta")
        await apply_style("Ênfase Intensa")
        await select_word(pg, "delta")
        await apply_style("Forte")
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const tw = d.createTreeWalker(d.body, 4); let n; while ((n = tw.nextNode())) {{ const i = n.data.indexOf('beta'); if (i >= 0) {{ d.getSelection().collapse(n, i + 2); break; }} }} }})()")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(120)
        state = await pg.evaluate("controller.ui.state.styleId")
        h = await body_html(pg)
        check("Ênfase Intensa (<em> azul do tema) e Forte (<strong>); a galeria acende a do texto",
              re.search(r"<em>(<span style=\"color: rgb\(68, 114, 196\);\">beta</span>|<font color=\"#4472c4\">beta</font>)</em>|<em style=\"color: rgb\(68, 114, 196\);\">beta</em>", h, re.I) is not None and "<strong>delta</strong>" in h and state == "intenseEmphasis", [h[:300], state])
        await select_word(pg, "beta")
        await apply_style("Ênfase")
        c = await computed(pg, "beta", "color")
        check("Ênfase por cima de Ênfase Intensa: a cor do tema sai", c == "rgb(0, 0, 0)" or c == "rgb(29, 35, 48)" or c.startswith("rgb(0, 0, 0"), c)
        await select_word(pg, "gama")
        await apply_style("Subtítulo")
        sub = await pg.evaluate(f"(() => {{ const p = {EDITOR}.body.firstElementChild; return [p.localName, p.style.letterSpacing, p.style.color]; }})()")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(120)
        check("Subtítulo: parágrafo cinza com o espaçamento entre letras do Word", sub[:2] == ["p", "0.75pt"] and sub[2] in ("rgb(90, 90, 90)", "#5a5a5a"), sub)
        # Texto sem Formatação: pergunta; Cancelar não muda nada
        await pg.get_by_role("button", name="Texto sem Formatação").click()
        await pg.wait_for_timeout(120)
        q = await pg.evaluate("document.querySelector('.fx-dialog') && document.querySelector('.fx-dialog').innerText")
        await pg.screenshot(path=os.path.join(OUT, "32_texto_sem_formatacao.png"))
        await pg.get_by_role("button", name="Cancelar").click()
        await pg.wait_for_timeout(120)
        cmds = await pg.evaluate("window.simCommands || []")
        check("Texto sem Formatação: pergunta antes; Cancelar deixa tudo como estava", bool(q) and "Continuar?" in q and "formatPlain" not in cmds and "<strong>delta</strong>" in await body_html(pg), [q, cmds])
        await pg.get_by_role("button", name="Texto sem Formatação").click()
        await pg.wait_for_timeout(120)
        await pg.get_by_role("button", name="Continuar").click()
        await pg.wait_for_timeout(250)
        h = await body_html(pg)
        st = await pg.evaluate("({ note: !document.querySelector('[data-note=plainNote]').hidden, bold: document.querySelector('#fx-panel-formatar button[aria-label=Negrito]').disabled, plain: document.querySelector('#fx-panel-formatar button[aria-label=\"Texto sem Formatação\"]').getAttribute('aria-pressed') })")
        await pg.screenshot(path=os.path.join(OUT, "33_formato_texto.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 170})
        check("Continuar: a formatação sai do corpo, o formato vira texto e o grupo Formato avisa",
              "<em" not in h and "<strong" not in h and "letter-spacing" not in h and "formatPlain" in await pg.evaluate("window.simCommands") and st == {"note": True, "bold": True, "plain": "true"}, [h[:300], st])
        await frame.locator("body").click(position={"x": 300, "y": 14})
        await frame.locator("body").press("Control+z")
        await pg.wait_for_timeout(120)
        h = await body_html(pg)
        check("um Ctrl+Z traz a formatação de volta (o formato continua texto)", "<strong>delta</strong>" in h and "letter-spacing" in h, h[:300])
        await pg.get_by_role("button", name="HTML", exact=True).click()
        await pg.wait_for_timeout(200)
        st = await pg.evaluate("({ note: !document.querySelector('[data-note=plainNote]').hidden, bold: document.querySelector('#fx-panel-formatar button[aria-label=Negrito]').disabled })")
        check("HTML de novo: o aviso some e a formatação volta a valer", st == {"note": False, "bold": False}, st)
        check("estilos e texto puro: sem erros no console", not logs, logs)
        await pg.close()

        # ---------- 19. Visualização Dinâmica ----------
        SNAP = """(() => { const e = controller.host.editor; const d = document.getElementById('messageEditor').contentDocument; const s = d.getSelection();
          return { html: d.body.innerHTML, undo: e.undoStack.length, redo: e.redoStack.length,
                   sel: [s.anchorNode && s.anchorNode.nodeName, s.anchorNode && s.anchorNode.data, s.anchorOffset, s.focusOffset, s.toString()],
                   font: controller.ui.state.fontName, box: document.querySelector('#fx-panel-formatar .fx-cfont input').value }; })()"""
        PV = f"{EDITOR}.querySelectorAll('[data-faixa-preview]').length"
        pg, logs = await open_page(b, "?cursor=1")
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Prezada Mariana, segue a proposta")
        await pg.get_by_role("tab", name="Formatar Texto").click()
        # duas edições de verdade e um desfazer: há o que desfazer e o que refazer
        await select_word(pg, "proposta")
        await pg.evaluate("controller.command('italic')")
        await pg.wait_for_timeout(120)
        await select_word(pg, "segue")
        await pg.evaluate("controller.command('bold')")
        await pg.wait_for_timeout(120)
        await pg.evaluate("controller.command('undo')")
        await pg.wait_for_timeout(120)
        await select_word(pg, "Mariana")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(120)
        s0 = await pg.evaluate(SNAP)
        FONTS = pg.locator("#fx-panel-formatar .fx-cfont .fx-arrow")
        await FONTS.click()
        await pg.wait_for_timeout(300)
        await pg.locator(".fx-mfont .fx-mi", has_text="Courier New").first.hover()
        await pg.wait_for_timeout(400)
        ff = await computed(pg, "Mariana", "fontFamily")
        mid = await pg.evaluate(SNAP)
        await pg.screenshot(path=os.path.join(OUT, "40_previa_fonte.png"), clip={"x": 0, "y": 0, "width": 900, "height": 520})
        check("Visualização Dinâmica: com o mouse na fonte, o texto selecionado aparece nela",
              "Courier New" in ff and await pg.evaluate(PV) == 1, ff)
        hl = await pg.evaluate("(() => { const w = document.getElementById('messageEditor').contentWindow; const h = w.CSS.highlights.get('faixa-preview'); return h ? [...h][0].toString() : null; })()")
        check("durante a prévia: nada no desfazer nem no refazer, a caixa Fonte continua com a do texto e um cinza marca o trecho no lugar da seleção",
              [mid["undo"], mid["redo"]] == [s0["undo"], s0["redo"]] and s0["undo"] >= 1 and s0["redo"] == 1 and mid["box"] == s0["box"] and mid["font"] == s0["font"] and mid["sel"][4] == "" and hl == "Mariana", [s0, mid, hl])
        await pg.locator(".fx-mfont .fx-mi", has_text="Georgia").first.hover()
        await pg.wait_for_timeout(400)
        ff = await computed(pg, "Mariana", "fontFamily")
        check("passando para outra fonte, a prévia troca (sem sobrar a anterior)", "Georgia" in ff and "Courier" not in ff and await pg.evaluate(PV) == 1, ff)
        await pg.mouse.move(700, 800)
        await pg.wait_for_timeout(200)
        s1 = await pg.evaluate(SNAP)
        gone = await pg.evaluate("!document.getElementById('messageEditor').contentWindow.CSS.highlights.has('faixa-preview')")
        check("mouse fora do menu: o texto, a seleção, o desfazer e o refazer ficam exatamente como antes", s1 == s0 and gone, [s0, s1, gone])
        # Esc também tira a prévia
        await pg.locator(".fx-mfont .fx-mi", has_text="Georgia").first.hover()
        await pg.wait_for_timeout(400)
        on = await pg.evaluate(PV)
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(150)
        s1 = await pg.evaluate(SNAP)
        check("Esc com a prévia: tudo volta como era", on == 1 and s1 == s0 and not await pg.evaluate("!!document.querySelector('.fx-popup')"), [on, s1])
        # o clique aplica de verdade, num passo do desfazer
        await FONTS.click()
        await pg.wait_for_timeout(300)
        await pg.locator(".fx-mfont .fx-mi", has_text="Georgia").first.hover()
        await pg.wait_for_timeout(400)
        await pg.locator(".fx-mfont .fx-mi", has_text="Georgia").first.click()
        await pg.wait_for_timeout(200)
        ff = await computed(pg, "Mariana", "fontFamily")
        s2 = await pg.evaluate(SNAP)
        check("clique na fonte da prévia: aplica de verdade, um passo no desfazer",
              "Georgia" in ff and await pg.evaluate(PV) == 0 and s2["undo"] == s0["undo"] + 1 and s2["redo"] == 0 and "Georgia" in await body_html(pg), [ff, s2["undo"], s2["redo"]])
        await pg.evaluate("controller.command('undo')")
        await pg.wait_for_timeout(100)
        check("um Ctrl+Z tira a fonte aplicada", (await pg.evaluate(SNAP))["html"] == s0["html"])
        # cores: da fonte (e Automático) e do realce
        await select_word(pg, "Mariana")
        await pg.wait_for_timeout(80)
        s0 = await pg.evaluate(SNAP)
        FORE = pg.locator("#fx-panel-formatar").get_by_role("button", name="Mais opções de Cor da Fonte")
        await FORE.click()
        await pg.wait_for_timeout(150)
        await pg.locator(".fx-popup .fx-sw[aria-label='#C00000']").hover()
        await pg.wait_for_timeout(400)
        col = await computed(pg, "Mariana", "color")
        await pg.screenshot(path=os.path.join(OUT, "41_previa_cor.png"), clip={"x": 0, "y": 0, "width": 900, "height": 520})
        await pg.mouse.move(700, 800)
        await pg.wait_for_timeout(200)
        check("cor da fonte: prévia com o mouse na amostra; fora dela, volta", col == "rgb(192, 0, 0)" and await pg.evaluate(SNAP) == s0, col)
        await pg.keyboard.press("Escape")
        await FORE.click()
        await pg.wait_for_timeout(150)
        await pg.locator(".fx-popup .fx-sw[aria-label='#2F5496']").first.click()
        await pg.wait_for_timeout(150)
        await select_word(pg, "Mariana")
        await pg.wait_for_timeout(80)
        blue = await pg.evaluate(SNAP)
        await FORE.click()
        await pg.wait_for_timeout(150)
        await pg.locator(".fx-popup .fx-mi", has_text="Automático").hover()
        await pg.wait_for_timeout(400)
        auto = await computed(pg, "Mariana", "color")
        base = await pg.evaluate(f"getComputedStyle({EDITOR}.body.firstElementChild).color")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(150)
        check("Automático: a prévia mostra a cor do parágrafo; Esc volta ao azul", auto == base and auto != "rgb(47, 84, 150)" and await pg.evaluate(SNAP) == blue, [auto, base])
        await pg.evaluate("controller.command('undo')")
        await pg.wait_for_timeout(100)
        await select_word(pg, "Mariana")
        await pg.wait_for_timeout(80)
        s0 = await pg.evaluate(SNAP)
        await pg.locator("#fx-panel-formatar").get_by_role("button", name="Mais opções de Cor do Realce do Texto").click()
        await pg.wait_for_timeout(150)
        await pg.locator(".fx-popup .fx-sw[aria-label='#FFFF00']").hover()
        await pg.wait_for_timeout(400)
        bg = await computed(pg, "Mariana", "backgroundColor")
        await pg.mouse.move(700, 800)
        await pg.wait_for_timeout(200)
        check("realce: prévia amarela; fora da amostra, volta", bg == "rgb(255, 255, 0)" and await pg.evaluate(SNAP) == s0, bg)
        await pg.keyboard.press("Escape")
        # estilos: de parágrafo na galeria da faixa (o parágrafo é o mesmo elemento depois) e de caractere
        await pg.evaluate(f"window.__p = {EDITOR}.body.firstElementChild")
        await pg.locator("#fx-panel-formatar .fx-tile[aria-label='Título 1']").hover()
        await pg.wait_for_timeout(400)
        h1 = await pg.evaluate(f"(() => {{ const p = {EDITOR}.body.firstElementChild; const cs = getComputedStyle(p); return [p === window.__p, p.textContent, cs.fontSize, cs.color, {EDITOR}.querySelectorAll('h1').length]; }})()")
        await pg.screenshot(path=os.path.join(OUT, "42_previa_estilo.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 520})
        await pg.mouse.move(700, 800)
        await pg.wait_for_timeout(200)
        same_p = await pg.evaluate(f"{EDITOR}.body.firstElementChild === window.__p")
        check("estilo de parágrafo na galeria: o parágrafo (o mesmo elemento) aparece como Título 1; fora, volta como era",
              h1[0] and h1[1].startswith("Prezada Mariana") and h1[2] == "21.3333px" and h1[3] == "rgb(47, 84, 150)" and h1[4] == 0 and same_p and await pg.evaluate(SNAP) == s0, [h1, same_p])
        await pg.get_by_role("button", name="Todos os estilos").click()
        await pg.wait_for_timeout(150)
        await pg.locator(".fx-popup .fx-tile[aria-label='Ênfase Intensa']").hover()
        await pg.wait_for_timeout(400)
        em = [await computed(pg, "Mariana", "fontStyle"), await computed(pg, "Mariana", "color"), await computed(pg, "Prezada", "fontStyle")]
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(150)
        check("estilo de caractere (Ênfase Intensa): só a seleção, itálico azul; Esc volta", em == ["italic", "rgb(68, 114, 196)", "normal"] and await pg.evaluate(SNAP) == s0, em)
        # cursor numa palavra: a prévia pega a palavra, e o cursor fica onde estava
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const tw = d.createTreeWalker(d.body, 4); let n; while ((n = tw.nextNode())) {{ const i = n.data.indexOf('proposta'); if (i >= 0) {{ d.getSelection().collapse(n, i + 3); break; }} }} }})()")
        await pg.wait_for_timeout(80)
        c0 = await pg.evaluate(SNAP)
        await FONTS.click()
        await pg.wait_for_timeout(300)
        await pg.locator(".fx-mfont .fx-mi", has_text="Courier New").first.hover()
        await pg.wait_for_timeout(400)
        word = [await computed(pg, "proposta", "fontFamily"), await computed(pg, "segue", "fontFamily")]
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(150)
        check("cursor numa palavra: a prévia pega a palavra inteira; o cursor volta ao mesmo ponto", "Courier New" in word[0] and "Courier" not in word[1] and await pg.evaluate(SNAP) == c0, [word, c0["sel"]])
        # cursor fora de palavra: nada muda
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const p = d.body.firstElementChild; d.getSelection().collapse(p, p.childNodes.length); }})()")
        await pg.wait_for_timeout(80)
        c0 = await pg.evaluate(SNAP)
        await FONTS.click()
        await pg.wait_for_timeout(300)
        await pg.locator(".fx-mfont .fx-mi", has_text="Courier New").first.hover()
        await pg.wait_for_timeout(400)
        n = await pg.evaluate(PV)
        await pg.keyboard.press("Escape")
        check("cursor fora de palavra: sem prévia", n == 0 and await pg.evaluate(SNAP) == c0, n)
        # pelo teclado: abrir a lista pelo teclado e descer; a prévia segue o item com o foco
        await select_word(pg, "Mariana")
        await pg.wait_for_timeout(80)
        s0 = await pg.evaluate(SNAP)
        await pg.evaluate("document.querySelector('#fx-panel-formatar .fx-cfont .fx-arrow').click()")
        await pg.wait_for_timeout(400)
        await pg.keyboard.press("ArrowDown")
        await pg.wait_for_timeout(400)
        focused = await pg.evaluate("document.activeElement && document.activeElement.textContent")
        ffk = await computed(pg, "Mariana", "fontFamily")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(150)
        check("teclado: ↓ na lista mostra a fonte do item com o foco; Esc volta", bool(focused) and focused.split("  ")[0] in ffk and await pg.evaluate(SNAP) == s0, [focused, ffk])
        # digitar com a prévia na tela (o foco no corpo, como quando o menu abre pelo mouse): a tecla vale no texto de verdade
        await pg.evaluate("document.getElementById('messageEditor').contentWindow.focus()")
        await pg.wait_for_timeout(80)
        await FONTS.click()
        await pg.wait_for_timeout(300)
        await pg.locator(".fx-mfont .fx-mi", has_text="Georgia").first.hover()
        await pg.wait_for_timeout(400)
        on = await pg.evaluate(PV)
        await pg.keyboard.press("x")
        await pg.wait_for_timeout(150)
        h = await body_html(pg)
        check("tecla no corpo com a prévia: a prévia sai antes e a tecla substitui a seleção", on == 1 and await pg.evaluate(PV) == 0 and "Prezada x, segue" in await pg.evaluate(f"{EDITOR}.body.textContent") and "Georgia" not in h, h[:200])
        await pg.keyboard.press("Escape")
        # comando com a prévia: vale para o texto de verdade; rascunho com a prévia: grava sem ela
        await select_word(pg, "segue")
        await FONTS.click()
        await pg.wait_for_timeout(300)
        await pg.locator(".fx-mfont .fx-mi", has_text="Georgia").first.hover()
        await pg.wait_for_timeout(400)
        await pg.evaluate("controller.command('bold')")
        await pg.wait_for_timeout(150)
        h = await body_html(pg)
        check("comando com a prévia na tela: a prévia sai e o negrito vale só na seleção", "<b>segue</b>" in h and "Georgia" not in h and await pg.evaluate(PV) == 0, h[:200])
        if not await pg.evaluate("!!document.querySelector('.fx-mfont')"):
            await FONTS.click()
            await pg.wait_for_timeout(300)
        await pg.mouse.move(700, 800)
        await pg.locator(".fx-mfont .fx-mi", has_text="Courier New").first.hover()
        await pg.wait_for_timeout(400)
        on = await pg.evaluate(PV)
        await pg.evaluate("controller.onSendEvent(false, null)")
        after = await pg.evaluate(PV)
        check("rascunho (ou envio) com a prévia na tela: o corpo gravado não leva a prévia", on == 1 and after == 0 and "Georgia" not in await body_html(pg), [on, after])
        await pg.keyboard.press("Escape")
        check("Visualização Dinâmica: sem erros no console", not logs, logs)
        await pg.close()
        # casos de borda: o que o clique faz, tabelas, ordem dos atributos, negrito escolhido
        # com o cursor parado, teclas e o começo do envio, e seleções enormes
        pg, logs = await open_page(b, "?cursor=1")
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.get_by_role("tab", name="Formatar Texto").click()
        SETB = """(html) => { const d = document.getElementById('messageEditor').contentDocument; d.body.innerHTML = html; }"""
        SELALL = """(sel) => { const d = document.getElementById('messageEditor').contentDocument; const el = d.querySelector(sel); const r = d.createRange(); r.selectNodeContents(el); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); }"""
        # link inteiro na seleção: o clique pinta por fora do link, e ele continua azul
        await pg.evaluate(SETB, '<p id="l">Veja <a href="https://exemplo.com">o site</a> hoje</p>')
        await pg.evaluate(SELALL, "#l")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(100)
        link0 = await computed(pg, "o site", "color")
        await pg.evaluate("controller.preview('foreColor', { value: '#C00000' })")
        cols = [await computed(pg, "Veja", "color"), await computed(pg, "o site", "color")]
        await pg.evaluate("controller.endPreview()")
        await pg.evaluate("controller.command('foreColor', { value: '#C00000' })")
        await pg.wait_for_timeout(100)
        real = [await computed(pg, "Veja", "color"), await computed(pg, "o site", "color")]
        check("cor numa seleção com um link inteiro: a prévia mostra o que o clique faz (o link fica com a cor dele)",
              cols == real and cols[0] == "rgb(192, 0, 0)" and cols[1] == link0, [cols, real, link0])
        # Ênfase por cima de Ênfase Intensa: a cor do tema sai, como no clique
        await pg.evaluate(SETB, '<p id="e">Alfa beta gama</p>')
        await select_word(pg, "beta")
        await pg.evaluate("controller.command('style', { value: 'intenseEmphasis' })")
        await pg.wait_for_timeout(120)
        await select_word(pg, "beta")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(100)
        await pg.evaluate("controller.preview('style', { value: 'emphasis' })")
        pvc = await computed(pg, "beta", "color")
        await pg.evaluate("controller.endPreview()")
        await pg.evaluate("controller.command('style', { value: 'emphasis' })")
        await pg.wait_for_timeout(120)
        realc = await computed(pg, "beta", "color")
        check("Ênfase por cima de Ênfase Intensa: a prévia tira a cor do tema, como o clique", pvc == realc and pvc != "rgb(68, 114, 196)", [pvc, realc])
        # realce: sem o cinza por cima (ele tingiria a cor)
        await select_word(pg, "Alfa")
        await pg.evaluate("controller.preview('hilite', { value: '#FFFF00' })")
        tint = await pg.evaluate("document.getElementById('messageEditor').contentWindow.CSS.highlights.has('faixa-preview')")
        await pg.evaluate("controller.endPreview()")
        check("realce: a prévia não põe o cinza por cima", tint is False, tint)
        # tabela: o espaço entre as linhas não vira caixa (a tabela não pula)
        await pg.evaluate(SETB, '<table id="t" border="1"><tbody>\n<tr><td>um</td><td>dois</td></tr>\n<tr><td>três</td><td>quatro</td></tr>\n</tbody></table><p>fim</p>')
        await pg.evaluate(SELALL, "#t")
        h0 = await body_html(pg)
        rect0 = await pg.evaluate(f"JSON.stringify({EDITOR}.getElementById('t').getBoundingClientRect())")
        await pg.evaluate("controller.preview('fontSize', { value: 11 })")
        spans = await pg.evaluate(f"[...{EDITOR}.querySelectorAll('[data-faixa-preview]')].map(s => s.parentElement.localName)")
        rect1 = await pg.evaluate(f"JSON.stringify({EDITOR}.getElementById('t').getBoundingClientRect())")
        await pg.evaluate("controller.endPreview()")
        check("tabela: só o texto das células ganha a prévia; a tabela não muda de tamanho; volta igual",
              spans == ["td", "td", "td", "td"] and rect0 == rect1 and await body_html(pg) == h0, [spans, rect0, rect1])
        # ordem dos atributos do parágrafo: volta exatamente igual
        await pg.evaluate(SETB, '<p align="center" style="color: red;" class="x" id="a">Texto centralizado</p>')
        await pg.evaluate(SELALL, "#a")
        h0 = await body_html(pg)
        await pg.evaluate("controller.preview('style', { value: 'normal' })")
        mid = await pg.evaluate(f"[{EDITOR}.getElementById('a').getAttribute('align'), {EDITOR}.getElementById('a').getAttribute('style')]")
        await pg.evaluate("controller.endPreview()")
        check("estilo Normal num parágrafo com align e style: a prévia tira os dois; depois, o HTML volta idêntico (ordem dos atributos inclusive)",
              mid == [None, None] and await body_html(pg) == h0, [mid, (await body_html(pg))[:120], h0[:120]])
        # negrito escolhido com o cursor parado numa linha vazia: a prévia de estilo não o perde
        await pg.evaluate(SETB, '<p>Linha</p><p id="v"><br></p>')
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; d.getSelection().collapse(d.getElementById('v'), 0); }})()")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(100)
        await pg.evaluate("controller.command('bold')")
        await pg.wait_for_timeout(100)
        await pg.locator("#fx-panel-formatar .fx-tile[aria-label='Título 2']").hover()
        await pg.wait_for_timeout(400)
        shown = await pg.evaluate(f"getComputedStyle({EDITOR}.getElementById('v')).fontSize")
        await pg.mouse.move(700, 800)
        await pg.wait_for_timeout(200)
        await pg.keyboard.type("Z")
        await pg.wait_for_timeout(100)
        vz = await pg.evaluate(f"{EDITOR}.getElementById('v').innerHTML")
        check("cursor parado com Negrito escolhido: a prévia de estilo aparece e o negrito continua valendo no que se digita",
              shown == "17.3333px" and re.search(r"<(b|strong)>Z</(b|strong)>", vz) is not None, [shown, vz])
        # pelo teclado (foco num item do menu), uma tecla com Ctrl tira a prévia antes do atalho
        await pg.evaluate(SETB, '<p id="k">Prezada Mariana</p>')
        await select_word(pg, "Mariana")
        await pg.evaluate("controller.engine.scheduleState(0)")
        await pg.wait_for_timeout(100)
        await pg.evaluate("document.querySelector('#fx-panel-formatar .fx-cfont .fx-arrow').click()")
        await pg.wait_for_timeout(400)
        await pg.keyboard.press("ArrowDown")
        await pg.wait_for_timeout(400)
        on = await pg.evaluate(PV)
        await pg.keyboard.down("Control")
        off = await pg.evaluate(PV)
        await pg.keyboard.up("Control")
        await pg.keyboard.press("Escape")
        check("prévia pelo teclado: apertar Ctrl (Ctrl+Enter, Ctrl+P...) tira a prévia antes do atalho", on == 1 and off == 0, [on, off])
        # começo do envio/rascunho (compose-prepare-message-start): a prévia sai e não volta até o fim
        await select_word(pg, "Mariana")
        await pg.evaluate("controller.preview('fontName', { value: 'Georgia' })")
        on = await pg.evaluate(PV)
        await pg.evaluate("window.dispatchEvent(new CustomEvent('compose-prepare-message-start', { detail: { msgType: 0 } }))")
        off = await pg.evaluate(PV)
        blocked = await pg.evaluate("controller.preview('fontName', { value: 'Georgia' })")
        await pg.evaluate("window.dispatchEvent(new CustomEvent('compose-prepare-message-completed'))")
        await select_word(pg, "Mariana")
        again = await pg.evaluate("controller.preview('fontName', { value: 'Georgia' })")
        await pg.evaluate("controller.endPreview()")
        check("preparação do envio: a prévia sai no começo, não volta durante e volta a valer depois", on == 1 and off == 0 and blocked is False and again is True, [on, off, blocked, again])
        # seleção enorme: a prévia desiste logo (o clique continua valendo)
        await pg.evaluate(SETB, "".join(f"<p>Parágrafo <b>número</b> {i} com texto</p>" for i in range(600)))
        await pg.evaluate(f"(() => {{ const d = {EDITOR}; const r = d.createRange(); r.selectNodeContents(d.body); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); }})()")
        t = await pg.evaluate("(() => { const t0 = performance.now(); const a = controller.preview('fontName', { value: 'Georgia' }); const t1 = performance.now(); const b = controller.preview('style', { value: 'h1' }); const t2 = performance.now(); controller.endPreview(); return [a, Math.round(t1 - t0), b, Math.round(t2 - t1)]; })()")
        check("seleção enorme (600 parágrafos): sem prévia, e a resposta é rápida", t[0] is False and t[2] is False and t[1] < 250 and t[3] < 250, t)
        check("casos de borda da Visualização Dinâmica: sem erros no console", not logs, logs)
        await pg.close()

        # opção desligada: sem prévia
        pg, logs = await open_page(b, "?cursor=1&cfg=" + quote(json.dumps({"visualizacaoDinamica": False})))
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Prezada Mariana")
        await pg.get_by_role("tab", name="Formatar Texto").click()
        await select_word(pg, "Mariana")
        await pg.locator("#fx-panel-formatar .fx-cfont .fx-arrow").click()
        await pg.wait_for_timeout(300)
        await pg.locator(".fx-mfont .fx-mi", has_text="Georgia").first.hover()
        await pg.wait_for_timeout(400)
        n = await pg.evaluate(PV)
        await pg.keyboard.press("Escape")
        await pg.locator("#fx-panel-formatar .fx-tile[aria-label='Título 1']").hover()
        await pg.wait_for_timeout(400)
        n2 = await pg.evaluate(f"{EDITOR}.querySelectorAll('h1').length")
        check("Visualização Dinâmica desligada nas opções: nem fonte nem estilo mudam o texto antes do clique", n == 0 and n2 == 0, [n, n2])
        await pg.close()

        # ---------- 20. barra de menus (Arquivo, Editar, Exibir...) ----------
        MB = """(() => { const b = document.getElementById('compose-toolbar-menubar2'); const r = b.getBoundingClientRect();
          const f = document.getElementById('faixa-root').getBoundingClientRect();
          return { h: Math.round(r.height), autohide: b.hasAttribute('autohide'), inactive: b.getAttribute('inactive'), ribbonTop: Math.round(f.top),
                   cfg: simApi.config.ocultarBarraMenus, stored: Services.xulStore.map.size }; })()"""
        MORE = "Mais opções da Faixa de Opções"
        async def more_item(pg, name="Mostrar a barra de menus"):
            await pg.get_by_role("button", name=MORE).click()
            await pg.wait_for_timeout(150)
            it = pg.get_by_role("menuitemcheckbox", name=name)
            n = await it.count()
            st = [await it.get_attribute("aria-checked"), await it.is_disabled()] if n else None
            return it, st
        async def self_menus(pg):
            res = await pg.evaluate("controller.selfTest()")
            return next(([r["ok"], r["detail"]] for r in res if r["id"] == "menus"), None)

        # Padrão (0.7.1): a barra de menus começa oculta, com o item do menu ⋯ desmarcado
        pg, logs = await open_page(b, "?cursor=1")
        md = await pg.evaluate(MB)
        _, st = await more_item(pg)
        await pg.close()
        check("barra de menus: oculta por padrão, o menu ⋯ desmarcado", md["h"] == 0 and md["autohide"] and md["cfg"] is True and md["stored"] == 0 and st == ["false", False], [md, st])

        # Sem escolha (null, só por configuração explícita): fica como o Thunderbird guardou
        NOCHOICE = "cfg=" + quote(json.dumps({"ocultarBarraMenus": None}))
        pg, logs = await open_page(b, "?cursor=1&" + NOCHOICE)
        m0 = await pg.evaluate(MB)
        check("barra de menus: sem escolha na faixa, fica como o Thunderbird (visível)", m0["h"] > 0 and not m0["autohide"] and m0["cfg"] is None, m0)
        it, st = await more_item(pg)
        check("menu ⋯: Mostrar a barra de menus, marcado", st == ["true", False], st)
        await it.click()
        await pg.wait_for_timeout(200)
        m1 = await pg.evaluate(MB)
        cmds = await pg.evaluate("window.simCommandArgs || []")
        check("menu ⋯: desmarcar oculta a barra de menus e a faixa sobe", m1["h"] == 0 and m1["autohide"] and m1["inactive"] == "true" and m1["ribbonTop"] < m0["ribbonTop"], [m0, m1])
        check("menu ⋯: a escolha vai para o background (todas as janelas e as próximas), sem gravar no xulstore",
              ["setMenubar", {"visible": False}] in cmds and m1["cfg"] is True and m1["stored"] == 0, [cmds[-3:], m1])
        # Alt mostra os menus enquanto são usados
        frame = pg.frame_locator("#messageEditor")
        await frame.locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.press("Alt")
        await pg.wait_for_timeout(100)
        a1 = await pg.evaluate(MB)
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(100)
        a2 = await pg.evaluate(MB)
        await pg.keyboard.press("Alt")
        await pg.keyboard.press("Alt")
        await pg.wait_for_timeout(100)
        a3 = await pg.evaluate(MB)
        check("barra de menus oculta: o Alt mostra os menus; o Esc ou outro Alt escondem de novo", a1["h"] > 0 and a2["h"] == 0 and a3["h"] == 0, [a1, a2, a3])
        check("barra de menus oculta: o Alt não mexe no texto", "Alt" not in await body_html(pg), (await body_html(pg))[:120])
        sm = await self_menus(pg)
        check("autoteste: menus (oculta como configurada)", sm and sm[0] is True and "oculta" in sm[1] and "Alt" in sm[1], sm)
        it, st = await more_item(pg)
        check("menu ⋯: com a barra oculta, desmarcado", st == ["false", False], st)
        await it.click()
        await pg.wait_for_timeout(200)
        m2 = await pg.evaluate(MB)
        check("menu ⋯: marcar mostra a barra de menus de novo", m2["h"] > 0 and not m2["autohide"] and m2["cfg"] is False and m2["ribbonTop"] == m0["ribbonTop"], m2)
        # a opção do próprio Thunderbird (Exibir > Barras de Ferramentas > Barra de Menus) vale como escolha
        await pg.evaluate("window.simCommandArgs = []; simToggleMenubarNative()")
        await pg.wait_for_timeout(250)
        m3 = await pg.evaluate(MB)
        cmds = await pg.evaluate("window.simCommandArgs")
        check("opção do Thunderbird com escolha feita na faixa: a faixa acompanha e grava a escolha nova",
              m3["h"] == 0 and m3["cfg"] is True and cmds == [["setMenubar", {"visible": False}]], [m3, cmds])
        it, st = await more_item(pg)
        await pg.keyboard.press("Escape")
        check("menu ⋯ acompanha a opção do Thunderbird", st == ["false", False], st)
        # sem escolha (Restaurar os padrões): volta ao que o Thunderbird guardou (aqui: oculta, pela opção dele)
        await pg.evaluate("simApi.applyConfig(Object.assign({}, simApi.config, { ocultarBarraMenus: null }))")
        await pg.wait_for_timeout(100)
        m4 = await pg.evaluate(MB)
        check("sem escolha na faixa: fica o que o Thunderbird guardou", m4["h"] == 0 and m4["autohide"] and m4["cfg"] is None, m4)
        await pg.evaluate("window.simCommandArgs = []; simToggleMenubarNative()")
        await pg.wait_for_timeout(250)
        m5 = await pg.evaluate(MB)
        cmds = await pg.evaluate("window.simCommandArgs")
        check("sem escolha na faixa: a opção do Thunderbird funciona e nada é gravado na faixa", m5["h"] > 0 and m5["cfg"] is None and cmds == [], [m5, cmds])
        check("barra de menus: sem erros no console", not logs, logs)
        await pg.close()

        # oculta pela opção do Thunderbird antes da faixa: a faixa não a mostra de volta
        pg, logs = await open_page(b, "?menusTb=oculta&" + NOCHOICE)
        m = await pg.evaluate(MB)
        _, st = await more_item(pg)
        await pg.keyboard.press("Escape")
        sm = await self_menus(pg)
        check("oculta pelo Thunderbird: continua oculta, o menu ⋯ desmarcado e o autoteste diz de onde vem",
              m["h"] == 0 and m["cfg"] is None and st == ["false", False] and sm and sm[0] is True and "Thunderbird" in sm[1], [m, st, sm])
        await pg.close()

        # escolha feita na faixa: vale desde a abertura; complemento desligado devolve a barra do Thunderbird
        pg, logs = await open_page(b, "?cfg=" + quote(json.dumps({"ocultarBarraMenus": True})))
        m = await pg.evaluate(MB)
        await pg.evaluate("controller.dispose()")
        m2 = await pg.evaluate("(() => { const b = document.getElementById('compose-toolbar-menubar2'); return [Math.round(b.getBoundingClientRect().height), b.hasAttribute('autohide')]; })()")
        check("configurada oculta: some desde a abertura; ao desligar o complemento, volta como o Thunderbird guardou", m["h"] == 0 and m["autohide"] and m2[0] > 0 and m2[1] is False, [m, m2])
        await pg.close()

        # política: travada
        pg, logs = await open_page(b, "?cfg=" + quote(json.dumps({"ocultarBarraMenus": True, "gerenciadas": ["ocultarBarraMenus", "ocultarBarraThunderbird"]})))
        _, st = await more_item(pg)
        await pg.keyboard.press("Escape")
        _, st2 = await more_item(pg, "Mostrar a barra do Thunderbird")
        await pg.keyboard.press("Escape")
        await pg.evaluate("window.simCommandArgs = []; simToggleMenubarNative()")
        await pg.wait_for_timeout(250)
        m = await pg.evaluate(MB)
        cmds = await pg.evaluate("window.simCommandArgs")
        check("política: os itens do menu ⋯ ficam travados e a opção do Thunderbird não muda a barra",
              st == ["false", True] and st2 == ["false", True] and m["h"] == 0 and m["autohide"] and cmds == [], [st, st2, m, cmds])
        check("política: sem erros no console", not logs, logs)
        await pg.close()

        # macOS: os menus ficam na barra do sistema
        pg, logs = await open_page(b, "?mac=1")
        _, st = await more_item(pg)
        await pg.keyboard.press("Escape")
        sm = await self_menus(pg)
        check("macOS: sem o item no menu ⋯, e o autoteste explica", st is None and sm and sm[0] is True and "macOS" in sm[1], [st, sm])
        await pg.close()

        # ---------- 21. espanhol, italiano, alemão e francês ----------
        LANGS = {
            "es": {"tabs": ["Archivo", "Mensaje", "Insertar", "Formato de texto", "Ayuda"], "groups": ["Portapapeles", "Texto básico", "Nombres"],
                   "bold": "Negrita", "tip": "Negrita (Ctrl+B)", "send": "Enviar", "tb": "es-MX", "paste": "Ctrl+Mayús+V"},
            "it": {"tabs": ["File", "Messaggio", "Inserisci", "Formato testo", "Guida"], "groups": ["Appunti", "Testo di base", "Nomi"],
                   "bold": "Grassetto", "tip": "Grassetto (Ctrl+B)", "send": "Invia", "tb": "it-IT", "paste": "Ctrl+Maiusc+V"},
            "de": {"tabs": ["Datei", "Nachricht", "Einfügen", "Text formatieren", "Hilfe"], "groups": ["Zwischenablage", "Basistext", "Namen"],
                   "bold": "Fett", "tip": "Fett (Strg+B)", "send": "Senden", "tb": "de-AT", "paste": "Strg+Umschalt+V"},
            "fr": {"tabs": ["Fichier", "Message", "Insertion", "Format du texte", "Aide"], "groups": ["Presse-papiers", "Texte simple", "Noms"],
                   "bold": "Gras", "tip": "Gras (Ctrl+B)", "send": "Envoyer", "tb": "fr-CA", "paste": "Ctrl+Maj+V"},
        }
        FIT = "(() => { const p = document.querySelector('.fx-panel:not([hidden])'); return [p.scrollWidth, p.clientWidth, document.getElementById('faixa-root').className]; })()"
        for lang, exp in LANGS.items():
            # idioma automático: o do Thunderbird (com a região)
            pg, logs = await open_page(b, "?tb=" + exp["tb"])
            tabs = await pg.evaluate("[...document.querySelectorAll('.fx-tab')].map(t => t.textContent)")
            groups = await pg.evaluate("[...document.querySelectorAll('.fx-panel:not([hidden]) .fx-glabel')].map(t => t.textContent)")
            check(f"{lang}: automático pelo Thunderbird em {exp['tb']}: abas e grupos traduzidos", tabs == exp["tabs"] and groups[:3] == exp["groups"], [tabs, groups[:3]])
            await pg.get_by_role("button", name=exp["bold"], exact=True).first.hover()
            await pg.wait_for_timeout(800)
            tip = await pg.evaluate("(() => { const t = document.querySelector('.fx-tip'); return t ? t.innerText : null; })()")
            check(f"{lang}: dica traduzida, com o atalho escrito como no Office do idioma", bool(tip) and tip.startswith(exp["tip"]), tip)
            await pg.mouse.move(700, 700)
            send_label = await pg.evaluate("document.getElementById('faixa-send').textContent")
            keys = await pg.evaluate("controller.ui.shortcuts.display('Ctrl+Shift+V')")
            check(f"{lang}: Enviar traduzido e nomes das teclas ({keys})", send_label == exp["send"] and keys == exp["paste"], [send_label, keys])
            fits = {}
            for i, name in enumerate(exp["tabs"][1:]):
                await pg.get_by_role("tab", name=name).click()
                await pg.wait_for_timeout(200)
                fits[name] = await pg.evaluate(FIT)
                await pg.screenshot(path=os.path.join(OUT, f"30_{lang}_{i + 1}.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 260})
            check(f"{lang}: as quatro abas cabem em 1440 px", all(f[0] <= f[1] + 1 for f in fits.values()), fits)
            await pg.get_by_role("tab", name=exp["tabs"][1]).click()
            results = await pg.evaluate("controller.selfTest()")
            bad = [(r["id"], r["detail"]) for r in results if not r["ok"]]
            check(f"{lang}: autoteste passa inteiro no idioma", not bad and len(results) >= 30, bad or len(results))
            lang_item = next((r for r in results if r["id"] == "idioma"), None)
            check(f"{lang}: autoteste diz o idioma", lang_item and f" {lang} " in " " + lang_item["detail"] + " ", lang_item)
            check(f"{lang}: sem erros no console", not logs, logs)
            await pg.close()
        # Número com vírgula (fora do inglês) e a caixa de tamanho aceita 10,5
        pg, logs = await open_page(b, "?idioma=de&cursor=1")
        await pg.frame_locator("#messageEditor").locator("body").click(position={"x": 30, "y": 14})
        await pg.keyboard.type("Sehr geehrte Frau Weber")
        await select_word(pg, "Weber")
        await pg.get_by_role("tab", name="Text formatieren").click()
        box = pg.locator("#fx-panel-formatar .fx-csize input")
        await box.click()
        await box.fill("10,5")
        await box.press("Enter")
        await pg.wait_for_timeout(200)
        size = await computed(pg, "Weber", "fontSize")
        await select_word(pg, "Weber")
        await pg.wait_for_timeout(200)
        shown = await box.input_value()
        check("de: Schriftgrad 10,5 in der Box: aplicado (14 px) e mostrado com vírgula", size == "14px" and shown == "10,5", [size, shown])
        await pg.close()

        # ---------- 22. confirmações de entrega e de leitura e Acompanhamento ----------
        TRK = """(() => { const f = gMsgCompose.compFields; const p = n => { const b = document.querySelector('#faixa-root [aria-label="' + n + '"]'); return b ? b.getAttribute('aria-pressed') : null; };
          return { dsn: f.DSN, rr: f.returnReceipt, dsnMenu: document.getElementById('dsnMenu').hasAttribute('checked'), rrMenu: document.getElementById('returnReceiptMenu').hasAttribute('checked'),
                   bDsn: p('Solicitar Confirmação de Entrega'), bRr: p('Solicitar Confirmação de Leitura'), bFu: (c => c ? c.el.getAttribute('aria-pressed') : null)(controller.ui.controls.find(c => c.cmd == 'followUp')),
                   flag: f.getHeader('x-message-flag') || null, me: !!controller.followUpMe, changed: [gReceiptOptionChanged, gDSNOptionChanged] }; })()"""
        pg, logs = await open_page(b, "?cursor=1")
        t0 = await pg.evaluate(TRK)
        labels = await pg.evaluate("[...document.querySelectorAll('#faixa-root .fx-group')].filter(g => g.querySelector('.fx-glabel') && g.querySelector('.fx-glabel').textContent == 'Controle').map(g => [...g.querySelectorAll('.fx-small .fx-lbl')].map(l => l.textContent))")
        check("Controle: os dois botões na aba Mensagem, com rótulo curto e nome inteiro", labels == [["Confirmação de Entrega", "Confirmação de Leitura"]] and t0["bDsn"] == "false" and t0["bRr"] == "false", [labels, t0])
        await pg.get_by_role("button", name="Solicitar Confirmação de Entrega").click()
        await pg.get_by_role("button", name="Solicitar Confirmação de Leitura").click()
        await pg.wait_for_timeout(100)
        t1 = await pg.evaluate(TRK)
        check("Controle: os botões pedem as confirmações como o menu Opções do Thunderbird e acendem",
              t1["dsn"] and t1["rr"] and t1["dsnMenu"] and t1["rrMenu"] and t1["bDsn"] == "true" and t1["bRr"] == "true" and t1["changed"] == [True, True], t1)
        await pg.evaluate("ToggleReturnReceipt()")
        await pg.wait_for_timeout(80)
        t2 = await pg.evaluate(TRK)
        check("Controle: mudança pelo menu do Thunderbird apaga o botão da faixa", not t2["rr"] and t2["bRr"] == "false" and t2["bDsn"] == "true", t2)
        await pg.evaluate("simIdentityReceipts(true, false)")
        await pg.wait_for_timeout(80)
        t3 = await pg.evaluate(TRK)
        check("Controle: troca de conta no De: (padrão da conta) acende e apaga os botões", t3["bRr"] == "true" and t3["bDsn"] == "false", t3)
        # Acompanhamento
        await pg.get_by_role("button", name="Acompanhamento", exact=True).click()
        await pg.wait_for_timeout(80)
        f1 = await pg.evaluate(TRK)
        check("Acompanhamento: o botão liga Sinalizar para Mim e acende", f1["me"] and f1["bFu"] == "true" and f1["flag"] is None, f1)
        await pg.get_by_role("button", name="Opções de Acompanhamento").click()
        await pg.wait_for_timeout(150)
        items = await pg.evaluate("[...document.querySelectorAll('.fx-popup .fx-mi')].map(b => [b.textContent.trim(), b.getAttribute('aria-checked'), b.disabled])")
        check("Acompanhamento ▾: Sinalizar para Mim marcado, para os Destinatários desmarcado, Limpar ativo",
              items == [["Sinalizar para Mim", "true", False], ["Sinalizar para os Destinatários", "false", False], ["Limpar Sinalizador", None, False]], items)
        await pg.get_by_role("menuitemcheckbox", name="Sinalizar para os Destinatários").click()
        await pg.wait_for_timeout(80)
        f2 = await pg.evaluate(TRK)
        check("Acompanhamento: para os destinatários vira o cabeçalho X-Message-Flag (o Outlook mostra o sinalizador)", f2["flag"] == "Acompanhar" and f2["me"] and f2["bFu"] == "true", f2)
        await pg.get_by_role("button", name="Opções de Acompanhamento").click()
        await pg.wait_for_timeout(150)
        await pg.get_by_role("menuitem", name="Limpar Sinalizador").click()
        await pg.wait_for_timeout(80)
        f3 = await pg.evaluate(TRK)
        check("Acompanhamento: Limpar Sinalizador tira os dois e apaga o botão", not f3["me"] and f3["flag"] is None and f3["bFu"] == "false", f3)
        # só no menu: para os destinatários, sem para mim; o botão aceso limpa tudo
        await pg.get_by_role("button", name="Opções de Acompanhamento").click()
        await pg.wait_for_timeout(150)
        await pg.get_by_role("menuitemcheckbox", name="Sinalizar para os Destinatários").click()
        await pg.wait_for_timeout(80)
        f4 = await pg.evaluate(TRK)
        await pg.get_by_role("button", name="Acompanhamento", exact=True).click()
        await pg.wait_for_timeout(80)
        f5 = await pg.evaluate(TRK)
        check("Acompanhamento: só para os destinatários acende o botão; clicar nele limpa", f4["flag"] == "Acompanhar" and not f4["me"] and f4["bFu"] == "true" and f5["flag"] is None and f5["bFu"] == "false", [f4, f5])
        check("confirmações e Acompanhamento: sem erros no console", not logs, logs)
        await pg.close()

        # Envio: com Sinalizar para Mim, as pastas da cópia vão para a estrela: a que o Thunderbird
        # avisa, a de Opções → Enviar uma cópia para e, com Enviar mais tarde, a da cópia enviada
        # (a avisada é a Saída). Rascunho e envio sem o sinalizador, não.
        SENT = "(() => { const r = window.simFollowUp || []; window.simFollowUp = []; return r; })()"
        got = {}
        for name, query, setup, msg_type in [("sem sinalizador", "", "", 0), ("rascunho", "", "controller.command('followUp')", 4),
                                             ("enviar", "", "controller.command('followUp')", 0),
                                             ("enviar com cópia", "&fcc2=mailbox://ana/Projetos", "controller.command('followUp')", 0),
                                             ("cópia desligada no menu", "&fcc2=nocopy://", "controller.command('followUp')", 0),
                                             ("enviar mais tarde", "&fcc2=mailbox://ana/Projetos", "controller.command('followUp')", 1)]:
            pg, logs = await open_page(b, "?cursor=1" + query)
            if setup:
                await pg.evaluate(setup)
            await pg.evaluate(f"controller.host.send({msg_type})")
            await pg.wait_for_timeout(80)
            got[name] = await pg.evaluate(SENT)
            await pg.close()
        check("Sinalizar para Mim no envio: Enviados e a cópia do menu (agora); a pasta da cópia, calculada, com Enviar mais tarde; rascunho e envio sem sinalizador não", got == {
            "sem sinalizador": [], "rascunho": [],
            "enviar": [["sim1@exemplo.com.br", ["mailbox://ana/Sent"], False]],
            "enviar com cópia": [["sim1@exemplo.com.br", ["mailbox://ana/Sent", "mailbox://ana/Projetos"], False]],
            "cópia desligada no menu": [["sim1@exemplo.com.br", ["mailbox://ana/Sent"], False]],
            "enviar mais tarde": [["sim1@exemplo.com.br", ["mailbox://ana/Unsent%20Messages", "mailbox://ana/Projetos", "mailbox://ana/Sent"], True]],
        }, got)

        # A estrela: a cópia ganha o sinalizador quando aparece (agora, ou depois, até reiniciar)
        pg, logs = await open_page(b)
        res = await pg.evaluate("""(() => {
          const DAY = 86400000; let now = 1e12;
          const store = {}; const prefs = { getStringPref: (k, d) => k in store ? store[k] : d, setStringPref: (k, v) => { store[k] = v; }, clearUserPref: k => { delete store[k]; } };
          const listeners = new Set(); const mfn = { msgAdded: 1, msgsClassified: 2, addListener: l => listeners.add(l), removeListener: l => listeners.delete(l) };
          let marks = 0;
          // read: o Thunderbird grava a cópia enviada como lida; a que chega fica não lida
          const mk = (id, folder, read = true) => ({ messageId: id, folder, isFlagged: false, isRead: read });
          const folder = (uri, flags, hdrs = []) => ({ URI: uri, flags, hdrs, markMessagesFlagged(list, on) { marks++; for (const h of list) h.isFlagged = on; },
            msgDatabase: { getMsgHdrForMessageID: id => hdrs.find(h => h.messageId == id) || null } });
          const sent = folder('mailbox://ana/Sent', 0x200), outbox = folder('mailbox://ana/Unsent', 0x800), drafts = folder('mailbox://ana/Drafts', 0x400);
          const inbox = folder('mailbox://ana/Inbox', 0x1000), arch = folder('mailbox://ana/Projetos', 0);
          const folders = { [sent.URI]: sent, [outbox.URI]: outbox, [drafts.URI]: drafts, [inbox.URI]: inbox, [arch.URI]: arch,
                            'mailbox://ana/sent': sent };  // o URI das preferências pode vir escrito de outro jeito
          const timers = [];
          const run = () => timers.splice(0).forEach(fn => fn());
          const deps = { prefs, mfn, now: () => now, getFolder: u => folders[u], setTimeout: fn => timers.push(fn) };
          const fl = new FaixaFollowUpFlagger(deps);
          const out = {};
          // Enviar: a cópia entra no índice de Enviados logo depois (pasta local); a que chega na
          // Entrada (Cco para si mesmo), com o mesmo Message-ID, fica sem estrela
          const a = mk('a@x', sent); sent.hdrs.push(a);
          fl.remember('a@x', [sent.URI], false);
          run();
          const aIn = mk('a@x', inbox, false);
          for (const l of [...listeners]) l.msgAdded(aIn);
          out.agora = [a.isFlagged, aIn.isFlagged];
          // A estrela que o usuário tira não volta (nem pela busca seguinte, nem por outro aviso)
          a.isFlagged = false;
          fl.remember('a@x', [sent.URI], false);
          run();
          for (const l of [...listeners]) l.msgAdded(a);
          out.tirada = a.isFlagged;
          // Cópia de Opções → Enviar uma cópia para, avisada depois: ganha a estrela
          const a2 = mk('a@x', arch); arch.hdrs.push(a2);
          fl.remember('a@x', [arch.URI], false);
          run();
          out.copia = a2.isFlagged;
          // Cópia na Entrada (a conta grava a resposta na pasta da mensagem respondida): a que
          // chega antes (não lida) fica sem estrela; a cópia gravada (lida) ganha
          const r = mk('r@x', inbox), rIn = mk('r@x', inbox, false);
          fl.remember('r@x', [inbox.URI], false);
          run();
          for (const l of [...listeners]) l.msgAdded(rIn);
          for (const l of [...listeners]) l.msgAdded(r);
          out.entrada = [r.isFlagged, rIn.isFlagged];
          // IMAP: o cabeçalho provisório ganha a estrela; com chave falsa (servidor sem UIDPLUS) a
          // pasta espera o do servidor, que ganha a estrela também; com o UID de verdade, pronto
          const imap = folder('imap://ana@srv/Sent', 0x200); folders[imap.URI] = imap;
          const pseudo = (h, key) => Object.assign(h, { messageKey: key, getUint32Property: n => (n == 'pseudoHdr' ? 1 : 0) });
          const pFake = pseudo(mk('p@x', imap), 0xffffff80), qUid = pseudo(mk('q@x', imap), 4021);
          fl.remember('p@x', [imap.URI], false);
          fl.remember('q@x', [imap.URI], false);
          for (const l of [...listeners]) l.msgsClassified([pFake, qUid]);
          const esperando = [fl.pending.get('p@x').folders.length, fl.pending.get('q@x').folders.length];
          const pReal = Object.assign(mk('p@x', imap), { messageKey: 77, getUint32Property: () => 0 });
          for (const l of [...listeners]) l.msgAdded(pReal);
          out.provisorio = [pFake.isFlagged, qUid.isFlagged, esperando, pReal.isFlagged, fl.pending.get('p@x').folders.length];
          // Enviar mais tarde: a Saída não conta; a pasta da cópia, quando aparece (outra sessão)
          fl.remember('b@x', [outbox.URI, 'mailbox://ana/sent'], true);
          run();
          out.guardado = JSON.parse(store['extensions.faixa.acompanhamento']).map(x => [x.id, x.folders]);
          out.ouvindo = listeners.size;
          const fl2 = new FaixaFollowUpFlagger(deps);  // reinício: lê a lista da preferência
          fl.unlisten();
          const bOut = mk('b@x', outbox, false), bDraft = mk('b@x', drafts), bIn = mk('b@x', inbox, false), bSent = mk('b@x', sent), other = mk('c@x', sent);
          for (const l of [...listeners]) l.msgsClassified([bOut, bDraft, bIn, other]);
          for (const l of [...listeners]) l.msgAdded(bSent);
          out.depois = [bOut.isFlagged, bDraft.isFlagged, bIn.isFlagged, bSent.isFlagged, other.isFlagged];
          out.terminou = [listeners.size, 'extensions.faixa.acompanhamento' in store];
          // Sem pasta ("", nocopy://, só a Saída): nada
          fl2.remember('e@x', ['', 'nocopy://', outbox.URI], true);
          out.semPasta = [fl2.pending.has('e@x'), listeners.size];
          // Validade: uma semana (agora), 30 dias (mais tarde); depois some e para de ouvir
          fl2.remember('z@x', [sent.URI], false);
          fl2.remember('y@x', [sent.URI], true);
          now += 8 * DAY;
          const z = mk('z@x', sent), y = mk('y@x', sent);
          for (const l of [...listeners]) l.msgsClassified([z, y]);
          out.semana = [z.isFlagged, y.isFlagged];
          fl2.remember('w@x', [sent.URI], true);
          now += 31 * DAY;
          for (const l of [...listeners]) l.msgAdded(mk('w@x', sent));
          out.expirou = [listeners.size, 'extensions.faixa.acompanhamento' in store];
          out.marcas = marks;
          return out;
        })()""")
        check("estrela: só na cópia gravada (não na que chega, nem na Entrada), uma vez por pasta, na cópia do menu, com Enviar mais tarde depois de reiniciar; some depois do prazo",
              res == {"agora": [True, False], "tirada": False, "copia": True, "entrada": [True, False],
                      "provisorio": [True, True, [1, 0], True, 0],
                      "guardado": [["b@x", ["mailbox://ana/Sent"]]], "ouvindo": 1,
                      "depois": [False, False, False, True, False], "terminou": [0, False],
                      "semPasta": [False, 0], "semana": [False, True], "expirou": [0, False], "marcas": 8}, res)
        res = await pg.evaluate("""(() => {
          let now = 1e12; const store = {};
          const prefs = { getStringPref: (k, d) => k in store ? store[k] : d, setStringPref: (k, v) => { store[k] = v; }, clearUserPref: k => { delete store[k]; } };
          const d = new FaixaDraftFollowUps({ prefs, now: () => now });
          for (let i = 0; i < 103; i++) d.update('m' + i + '@x', { me: true }, []);
          const out = { total: d.read().length, primeiro: d.read()[0].id, ultimo: d.get('m102@x') };
          d.update('n@x', { me: false, recipients: false }, []);
          out.semSinalizador = d.get('n@x');
          now += 181 * 86400000;
          out.expirou = [d.get('m102@x'), d.read().length];
          return out;
        })()""")
        check("rascunhos: no máximo 100 guardados (os mais novos), sem sinalizador nada fica, seis meses de validade",
              res == {"total": 100, "primeiro": "m3@x", "ultimo": {"me": True, "recipients": False}, "semSinalizador": None, "expirou": [None, 0]}, res)
        await pg.close()

        # Rascunho: o Acompanhamento fica guardado pelo Message-ID e volta quando o rascunho é
        # aberto de novo (o Thunderbird não traz o X-Message-Flag de volta); enviado, é esquecido.
        from urllib.parse import quote
        DPREF = "extensions.faixa.acompanhamentoRascunhos"
        STORE = "(() => { const v = window.simPrefs.store['%s']; return v ? JSON.parse(v).map(x => [x.id, x.me, x.recipients]) : null; })()" % DPREF
        pg, logs = await open_page(b, "?cursor=1")
        await pg.evaluate("controller.command('followUp'); controller.command('followUpRecipients')")
        await pg.evaluate("controller.host.send(4); controller.host.finishSend(true)")
        d1 = await pg.evaluate(STORE)
        await pg.evaluate("controller.host.send(7); controller.host.finishSend(true)")
        d2 = await pg.evaluate(STORE)
        saved_prefs = await pg.evaluate("JSON.stringify(window.simPrefs.store)")
        check("rascunho: o Acompanhamento fica com o Message-ID da última gravação (também a automática)",
              d1 == [["sim1@exemplo.com.br", True, True]] and d2 == [["sim2@exemplo.com.br", True, True]], [d1, d2])
        check("rascunho gravado: sem erros no console", not logs, logs)
        await pg.close()
        pg, logs = await open_page(b, "?cursor=1&msgid=sim2@exemplo.com.br&prefs=" + quote(saved_prefs))
        r1 = await pg.evaluate(TRK)
        check("rascunho aberto de novo: o Acompanhamento volta (Sinalizar para Mim e o X-Message-Flag) e o botão acende",
              r1["me"] and r1["flag"] == "Acompanhar" and r1["bFu"] == "true", r1)
        await pg.evaluate("controller.command('followUpRecipients'); controller.host.send(4); controller.host.finishSend(true)")
        d3 = await pg.evaluate(STORE)
        await pg.evaluate("window.simFollowUp = []; controller.host.send(0)")
        d4 = await pg.evaluate(STORE)
        sent = await pg.evaluate(SENT)
        check("rascunho: gravar de novo troca o Message-ID guardado; enviar esquece o rascunho e a cópia vai para a estrela",
              d3 == [["sim1@exemplo.com.br", True, False]] and d4 is None and sent == [["sim2@exemplo.com.br", ["mailbox://ana/Sent"], False]], [d3, d4, sent])
        check("rascunho aberto de novo: sem erros no console", not logs, logs)
        await pg.close()
        # Conta sem cópia dos enviados: o rascunho é esquecido no fim do envio (aftersend)
        pg, logs = await open_page(b, "?cursor=1&semcopia=1&msgid=sim2@exemplo.com.br&prefs=" + quote(saved_prefs))
        await pg.evaluate("controller.host.send(0)")
        d5 = await pg.evaluate(STORE)
        await pg.evaluate("controller.host.finishSend(true)")
        d6 = await pg.evaluate(STORE)
        await pg.close()
        check("rascunho enviado sem cópia em Enviados: esquecido quando o envio termina", d5 == [["sim2@exemplo.com.br", True, True]] and d6 is None, [d5, d6])
        pg, logs = await open_page(b, "?cursor=1&msgid=outro@exemplo.com.br&prefs=" + quote(saved_prefs))
        r2 = await pg.evaluate(TRK)
        await pg.close()
        check("outro rascunho: sem Acompanhamento", not r2["me"] and r2["flag"] is None and r2["bFu"] == "false", r2)

        # Já pedidas pela conta (padrão da identidade): os botões abrem acesos; outros idiomas
        pg, logs = await open_page(b, "?leitura=1&entrega=1&idioma=de")
        st = await pg.evaluate("""(() => [...document.querySelectorAll('#faixa-root .fx-small')].filter(b => /bestätigung/.test(b.getAttribute('aria-label')))
          .map(b => [b.getAttribute('aria-label'), b.querySelector('.fx-lbl').textContent, b.getAttribute('aria-pressed')]))()""")
        check("de: Übermittlungs- und Lesebestätigung, acesos pelo padrão da conta", st == [["Übermittlungsbestätigung anfordern", "Übermittlungsbestätigung", "true"],
                                                                                    ["Lesebestätigung anfordern", "Lesebestätigung", "true"]], st)
        await pg.close()

        await b.close()
    print("\n%d falhas" % len(FAILS), FAILS)

asyncio.run(main())
sys.exit(1 if FAILS else 0)
