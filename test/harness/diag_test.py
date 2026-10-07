"""Fumaça das páginas do complemento (Opções da Faixa e diagnóstico) com uma API browser.* simulada.

Uso: python3 test/harness/diag_test.py [pasta_de_capturas] [--gecko]
"""
import asyncio, json, os, sys, threading, http.server, functools, socketserver
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
GECKO = "--gecko" in sys.argv
OUT = ARGS[0] if ARGS else os.path.join(ROOT, "test", "out")
PORT = 8823 if GECKO else 8813
os.makedirs(OUT, exist_ok=True)
FAILS = []
VERSION = json.load(open(os.path.join(ROOT, "manifest.json"), encoding="utf-8"))["version"]


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(Q, directory=ROOT)) as h:
        h.serve_forever()


threading.Thread(target=serve, daemon=True).start()
from playwright.async_api import async_playwright


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (" — " + str(detail) if detail else ""))
    if not ok:
        FAILS.append(name)


# window.__store fica no sessionStorage: sobrevive ao location.reload() da página de opções.
MOCK = r"""
(() => {
  const load = () => { try { return JSON.parse(sessionStorage.getItem("store") || "{}"); } catch (e) { return {}; } };
  const save = s => sessionStorage.setItem("store", JSON.stringify(s));
  const listeners = [];
  window.__managed = JSON.parse(sessionStorage.getItem("managed") || "null");
  window.__uiLang = sessionStorage.getItem("uiLang") || "pt-BR";
  window.browser = {
    runtime: {
      getManifest: () => ({ name: "Faixa de Opções", version: "__VERSION__", manifest_version: 3 }),
      getURL: p => "/" + p,
      getBrowserInfo: async () => ({ name: "Thunderbird", version: "153.3.1", buildID: "20260920101010" }),
    },
    i18n: { getUILanguage: () => window.__uiLang },
    storage: {
      managed: { get: async () => { if (!window.__managed) throw new Error("Managed storage manifest not found"); return window.__managed; } },
      local: {
        get: async k => { const s = load(); return Object.fromEntries((Array.isArray(k) ? k : [k]).filter(x => x in s).map(x => [x, s[x]])); },
        set: async o => { const s = Object.assign(load(), o); save(s); const ch = Object.fromEntries(Object.keys(o).map(x => [x, { newValue: s[x] }])); listeners.forEach(fn => fn(ch, "local")); },
        remove: async k => { const s = load(); delete s[k]; save(s); listeners.forEach(fn => fn({ [k]: {} }, "local")); },
      },
      onChanged: { addListener: fn => listeners.push(fn) },
    },
    faixa: {
      listFonts: async () => ["Arial", "Calibri", "Cambria", "Segoe UI", "Times New Roman"],
      getMenubarState: async () => JSON.parse(sessionStorage.getItem("menubar") || '{"available": true, "hidden": false}'),
      listIdentities: async () => [
        { key: "id1", email: "ana@exemplo.com.br", name: "Ana Souza", organization: "Bluecker", accountName: "Bluecker", isDefault: true, sigOnReply: true, sigOnForward: false,
          vcard: "BEGIN:VCARD\r\nVERSION:4.0\r\nTITLE:Gerente de Contas\r\nORG:Bluecker;Comercial\r\nTEL;TYPE=work;VALUE=TEXT:+55 11 5555-0100\r\nEND:VCARD\r\n",
          tbSignature: "-- <br>Ana Souza<br><b>Bluecker</b>" },
        { key: "id2", email: "ana.souza@cliente.com.br", name: "Ana Souza", organization: "Cliente S.A.", accountName: "Cliente", isDefault: true, sigOnReply: false, sigOnForward: false,
          vcard: "", tbSignature: "Ana — Cliente" },
        { key: "id3", email: "suporte@exemplo.com.br", name: "Suporte", organization: "", accountName: "Bluecker", isDefault: false, sigOnReply: true, sigOnForward: false,
          vcard: "", tbSignature: "" },
      ],
      getDiagnostics: async () => ({
        started: true, startError: "", ribbonLocale: window.__uiLang,
        app: { name: "Thunderbird", version: "153.3.1", platform: "win", locale: window.__uiLang },
        config: {}, windows: [{ tabId: 9, mounted: true, editorReady: true, isHTML: true, sendButton: true, lastError: "" }],
        tbPrefs: { paragraph: true, crNewP: true },
        keys: null, profile: { id: "thunderbird-office", entries: [] },
        fonts: { count: 5, list: ["Arial", "Calibri", "Cambria", "Segoe UI", "Times New Roman"] },
      }),
      runSelfTest: async () => [
        { id: "montagem", label: "Faixa montada na janela de composição", ok: true, detail: "1280 × 139 px, 2 abas" },
        { id: "negrito", label: "Negrito pelo editor, desfeito com um único Ctrl+Z", ok: false, detail: "negrito aplicado: sim; um desfazer restaurou o texto: não" },
      ],
    },
    compose: { beginNew: async () => ({ id: 9 }) },
    tabs: { remove: async () => {}, create: async () => {} },
  };
  window.confirm = () => true;
})();
""".replace("__VERSION__", VERSION)


async def main():
    async with async_playwright() as p:
        b = await (p.firefox if GECKO else p.chromium).launch()
        print("motor:", "Gecko (Firefox)" if GECKO else "Blink (Chromium)")

        # ---------- diagnóstico ----------
        pg = await b.new_page(viewport={"width": 1200, "height": 1400})
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/diagnostico.html")
        await pg.wait_for_timeout(800)
        await pg.get_by_role("button", name="Executar autoteste").click()
        await pg.wait_for_timeout(500)
        rows = await pg.evaluate("document.querySelectorAll('#keytable tbody tr').length")
        conflicts = await pg.evaluate("[...document.querySelectorAll('#keytable .st.bad')].length")
        summary = await pg.evaluate("document.getElementById('test-summary').textContent")
        check("diagnóstico: tabela de atalhos e resumo do autoteste", rows > 30 and summary == "1 de 2 itens passaram.", [rows, summary])
        await pg.screenshot(path=os.path.join(OUT, "09_diagnostico.png"), full_page=True)
        await pg.select_option("#profile", "office-ptbr")
        await pg.wait_for_timeout(200)
        conflicts2 = await pg.evaluate("[...document.querySelectorAll('#keytable .st.bad')].length")
        await pg.locator("#keyprobe").click()
        await pg.keyboard.press("Control+Alt+c")
        await pg.keyboard.press("a")
        probe = await pg.evaluate("[...document.querySelectorAll('#keylog li')].map(li => li.textContent)")
        check("diagnóstico: teste de teclado", len(probe) == 2 and "Copiar Formatação" in probe[1] and "digita “a”" in probe[0], probe)
        await pg.locator("#keyprobe").locator("xpath=..").screenshot(path=os.path.join(OUT, "10_teclado.png"))
        print("linhas", rows, "conflitos perfil1", conflicts, "conflitos perfil2", conflicts2, "|", summary)
        check("diagnóstico: sem erros no console", not logs, logs)
        await pg.close()

        # ---------- diagnóstico em inglês (Thunderbird em en-US) ----------
        pg = await b.new_page(viewport={"width": 1200, "height": 1400})
        logs = []
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("sessionStorage.setItem('uiLang', 'en-US');")
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/diagnostico.html")
        await pg.wait_for_timeout(800)
        h1 = await pg.evaluate("document.querySelector('h1').textContent")
        env = await pg.evaluate("document.getElementById('env').innerText")
        await pg.get_by_role("button", name="Run self-test").click()
        await pg.wait_for_timeout(400)
        summary = await pg.evaluate("document.getElementById('test-summary').textContent")
        res = await pg.evaluate("document.querySelector('#keytable tbody tr').innerText")
        check("diagnóstico en-US: título, ambiente e resumo em inglês", h1 == "Ribbon Diagnostics" and "System and language" in env and summary == "1 of 2 items passed.", [h1, summary])
        check("diagnóstico en-US: tabela de atalhos em inglês", res.startswith("Bold") and ("ribbon" in res or "same" in res), res)
        check("diagnóstico en-US: lang do documento", await pg.evaluate("document.documentElement.lang") == "en-US")
        await pg.screenshot(path=os.path.join(OUT, "18_diagnostico_en.png"), full_page=True)
        check("diagnóstico en-US: sem erros", not logs, logs)
        await pg.close()

        # ---------- Opções da Faixa ----------
        pg = await b.new_page(viewport={"width": 900, "height": 1100})
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/opcoes.html")
        await pg.wait_for_timeout(600)
        vals = await pg.evaluate("""({ idioma: document.getElementById('idioma').value, aba: document.getElementById('abaInicial').value,
          fam: document.getElementById('familia').value, tam: document.getElementById('tamanho').value,
          para: document.getElementById('paragrafo').checked, barra: document.getElementById('mostrarBarra').checked,
          previa: document.getElementById('visualizacao').checked,
          menus: [document.getElementById('mostrarMenus').checked, !document.getElementById('menus-box').hidden],
          perfis: [...document.querySelectorAll('#perfis input')].map(i => i.value + (i.checked ? '*' : '')), fonts: document.querySelectorAll('#fontes option').length })""")
        check("opções: padrões na tela (Visualização Dinâmica ligada, barra de menus oculta)", vals == {"idioma": "auto", "aba": "mensagem", "fam": "Calibri", "tam": "11", "para": True, "barra": False,
                                                  "previa": True, "menus": [False, True], "perfis": ["thunderbird-office*", "office-ptbr"], "fonts": 5}, vals)
        await pg.screenshot(path=os.path.join(OUT, "19_opcoes.png"), full_page=True)
        await pg.get_by_label("Office em português").check()
        await pg.wait_for_timeout(100)
        await pg.get_by_label("Mostrar também a barra de ferramentas do Thunderbird").check()
        await pg.get_by_label("Habilitar Visualização Dinâmica").uncheck()
        await pg.get_by_label("Mostrar a barra de menus (Arquivo, Editar, Exibir, Inserir, Formatar…)").check()
        await pg.select_option("#tamanho", "12")
        await pg.fill("#familia", "Aptos")
        await pg.press("#familia", "Enter")
        await pg.wait_for_timeout(150)
        store = await pg.evaluate("JSON.parse(sessionStorage.getItem('store'))")
        check("opções: cada mudança salva na hora", store.get("usuario") == {"perfilAtalhos": "office-ptbr", "ocultarBarraThunderbird": False, "visualizacaoDinamica": False,
                                                                            "ocultarBarraMenus": False, "fontePadrao": {"tamanhoPt": 12, "familia": "Aptos"}}, store)
        note = await pg.evaluate("document.getElementById('font-note').textContent")
        check("opções: fonte que não está instalada é avisada", "Aptos" in note and "não está instalada" in note, note)
        flash = await pg.evaluate("document.getElementById('flash').textContent")
        check("opções: aviso de salvo", flash.startswith("Salvo."), flash)
        # idioma: a página muda junto
        await pg.select_option("#idioma", "en-US")
        await pg.wait_for_timeout(900)
        h1 = await pg.evaluate("document.querySelector('h1').textContent")
        lang = await pg.evaluate("document.getElementById('idioma').value")
        tab = await pg.evaluate("document.getElementById('abaInicial').selectedOptions[0].textContent")
        check("opções: idioma inglês salva e a página muda", h1 == "Ribbon Options" and lang == "en-US" and tab == "Message", [h1, lang, tab])
        await pg.screenshot(path=os.path.join(OUT, "20_opcoes_en.png"), full_page=True)
        # restaurar padrões
        await pg.get_by_role("button", name="Restore defaults").click()
        await pg.wait_for_timeout(900)
        store = await pg.evaluate("JSON.parse(sessionStorage.getItem('store'))")
        h1 = await pg.evaluate("document.querySelector('h1').textContent")
        check("opções: restaurar padrões limpa as preferências", "usuario" not in store and h1 == "Opções da Faixa", [store, h1])
        # com assinaturas: restaurar os padrões mantém as assinaturas
        await pg.evaluate("sessionStorage.setItem('store', JSON.stringify({ usuario: { perfilAtalhos: 'office-ptbr' }, assinaturas: [{ id: 'x', nome: 'X', html: 'x' }], assinaturaPadrao: { 'a@b.c': { nova: 'x' } }, partesRapidas: [{ id: 'p', nome: 'P', html: 'p' }] }))")
        await pg.reload()
        await pg.wait_for_timeout(600)
        await pg.get_by_role("button", name="Restaurar os padrões").click()
        await pg.wait_for_timeout(900)
        store = await pg.evaluate("JSON.parse(sessionStorage.getItem('store'))")
        check("opções: restaurar os padrões mantém as assinaturas e as Partes Rápidas", store == {"assinaturas": [{"id": "x", "nome": "X", "html": "x"}], "assinaturaPadrao": {"a@b.c": {"nova": "x"}}, "partesRapidas": [{"id": "p", "nome": "P", "html": "p"}]}, store)
        link = await pg.evaluate("[document.querySelector('a[href=\"assinaturas.html\"]').textContent, document.querySelector('a[href=\"partes.html\"]').textContent, document.querySelector('a[href=\"ajuda.html\"]').textContent]")
        check("opções: links para Assinaturas, Partes Rápidas e Ajuda", link == ["Assinaturas…", "Partes Rápidas…", "Ajuda"], link)
        check("opções: sem erros", not logs, logs)
        await pg.close()

        # ---------- Opções com política da organização ----------
        pg = await b.new_page(viewport={"width": 900, "height": 1100})
        logs = []
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("sessionStorage.setItem('managed', JSON.stringify({ perfilAtalhos: 'office-ptbr', fontePadrao: { familia: 'Arial' }, visualizacaoDinamica: false }));")
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/opcoes.html")
        await pg.wait_for_timeout(600)
        st = await pg.evaluate("""({ policy: !document.getElementById('policy').hidden, fam: document.getElementById('familia').disabled,
          famv: document.getElementById('familia').value, tam: document.getElementById('tamanho').disabled,
          perfis: [...document.querySelectorAll('#perfis input')].map(i => i.disabled), perfil: document.querySelector('#perfis input:checked').value,
          idioma: document.getElementById('idioma').disabled,
          previa: [document.getElementById('visualizacao').checked, document.getElementById('visualizacao').disabled] })""")
        check("opções com política: travadas só as opções definidas (Visualização Dinâmica desligada pela organização)", st == {"policy": True, "fam": True, "famv": "Arial", "tam": False,
                                                                         "perfis": [True, True], "perfil": "office-ptbr", "idioma": False, "previa": [False, True]}, st)
        await pg.screenshot(path=os.path.join(OUT, "21_opcoes_politica.png"), full_page=True)
        check("opções com política: sem erros", not logs, logs)
        await pg.close()

        # ---------- Opções: barra de menus ----------
        MENUS = "[document.getElementById('mostrarMenus').checked, document.getElementById('mostrarMenus').disabled, !document.getElementById('menus-box').hidden]"
        got = {}
        for name, init in [("padrão: oculta, mesmo com o Thunderbird mostrando", "sessionStorage.setItem('menubar', JSON.stringify({ available: true, hidden: false }));"),
                           ("oculta pelo Thunderbird", "sessionStorage.setItem('menubar', JSON.stringify({ available: true, hidden: true }));"),
                           ("escolha da faixa vale mais", "sessionStorage.setItem('menubar', JSON.stringify({ available: true, hidden: true })); sessionStorage.setItem('store', JSON.stringify({ usuario: { ocultarBarraMenus: false } }));"),
                           ("macOS", "sessionStorage.setItem('menubar', JSON.stringify({ available: false, hidden: false }));"),
                           ("política", "sessionStorage.setItem('managed', JSON.stringify({ ocultarBarraMenus: true }));")]:
            pg = await b.new_page(viewport={"width": 900, "height": 1100})
            logs = []
            pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
            await pg.add_init_script(init)
            await pg.add_init_script(MOCK)
            await pg.goto(f"http://127.0.0.1:{PORT}/options/opcoes.html")
            await pg.wait_for_timeout(500)
            got[name] = await pg.evaluate(MENUS)
            if logs:
                got[name + " (erros)"] = logs
            await pg.close()
        check("opções: barra de menus oculta por padrão, a escolha da faixa vale mais, macOS (sem a opção) e política (travada)",
              got == {"padrão: oculta, mesmo com o Thunderbird mostrando": [False, False, True], "oculta pelo Thunderbird": [False, False, True], "escolha da faixa vale mais": [True, False, True], "macOS": [False, False, False], "política": [False, True, True]}, got)

        # ---------- páginas em espanhol, italiano, alemão e francês ----------
        pg = await b.new_page(viewport={"width": 900, "height": 1100})
        logs = []
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("sessionStorage.setItem('uiLang', 'de-DE');")
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/opcoes.html")
        await pg.wait_for_timeout(600)
        st = await pg.evaluate("""({ h1: document.querySelector('h1').textContent, lang: document.documentElement.lang,
          opts: [...document.getElementById('idioma').options].map(o => o.value), val: document.getElementById('idioma').value,
          menus: document.querySelector('label[for=mostrarMenus]').textContent })""")
        check("opções: Thunderbird em alemão → página em alemão, com os seis idiomas na lista",
              st["h1"] == "Menüband-Optionen" and st["lang"] == "de" and st["opts"] == ["auto", "pt-BR", "en-US", "es", "it", "de", "fr"] and st["val"] == "auto"
              and st["menus"].startswith("Menüleiste anzeigen"), st)
        await pg.screenshot(path=os.path.join(OUT, "31_opcoes_de.png"), full_page=True)
        await pg.select_option("#idioma", "fr")
        await pg.wait_for_timeout(900)
        st = await pg.evaluate("({ h1: document.querySelector('h1').textContent, lang: document.documentElement.lang, val: document.getElementById('idioma').value, saved: JSON.parse(sessionStorage.getItem('store')).usuario.idioma })")
        check("opções: escolher Français salva e a página muda para francês", st == {"h1": "Options du ruban", "lang": "fr", "val": "fr", "saved": "fr"}, st)
        check("opções em outros idiomas: sem erros", not logs, logs)
        await pg.close()
        pages = {}
        for lang, path in [("de", "ajuda.html"), ("it", "diagnostico.html"), ("es", "assinaturas.html"), ("fr", "partes.html")]:
            pg = await b.new_page(viewport={"width": 1200, "height": 1400})
            logs = []
            pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
            await pg.add_init_script(f"sessionStorage.setItem('uiLang', '{lang}');")
            if path == "assinaturas.html":
                # Com uma assinatura: a tabela de campos acompanha a assinatura aberta.
                await pg.add_init_script("sessionStorage.setItem('store', JSON.stringify({ assinaturas: [{ id: 'x', nome: 'Firma', html: '<p>{nombre}</p>' }] }));")
            await pg.add_init_script(MOCK)
            await pg.goto(f"http://127.0.0.1:{PORT}/options/{path}")
            await pg.wait_for_timeout(800)
            info = {"h1": await pg.evaluate("document.querySelector('h1').textContent"), "lang": await pg.evaluate("document.documentElement.lang")}
            if path == "ajuda.html":
                info["keys"] = await pg.evaluate("[...document.querySelectorAll('[data-i18n-keys]')].map(e => e.textContent)")
            if path == "assinaturas.html":
                info["fields"] = await pg.evaluate("[...document.querySelectorAll('.sig-field')].map(e => e.textContent).slice(0, 3)")
            if logs:
                info["errors"] = logs
            pages[path] = info
            await pg.screenshot(path=os.path.join(OUT, f"32_{lang}_{path.replace('.html', '')}.png"), full_page=True)
            await pg.close()
        check("páginas em alemão, italiano, espanhol e francês (ajuda com Strg, campos de assinatura em espanhol)", pages == {
            "ajuda.html": {"h1": "Hilfe zum Menüband", "lang": "de", "keys": ["Strg+F1", "Strg+K", "Strg+Alt+C / Strg+Alt+V"]},
            "diagnostico.html": {"h1": "Diagnostica della barra multifunzione", "lang": "it"},
            "assinaturas.html": {"h1": "Firmas", "lang": "es", "fields": ["{nombre}", "{email}", "{cargo}"]},
            "partes.html": {"h1": "Composants QuickPart", "lang": "fr"},
        }, pages)

        # ---------- Assinaturas ----------
        STORE = "JSON.parse(sessionStorage.getItem('store') || '{}')"
        pg = await b.new_page(viewport={"width": 1200, "height": 1500})
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/assinaturas.html")
        await pg.wait_for_timeout(700)
        st = await pg.evaluate("({ empty: !document.getElementById('empty').hidden, edit: !document.getElementById('edit').hidden, rows: document.querySelectorAll('#defaults tbody tr').length })")
        check("assinaturas: começa vazia, com as contas na tabela de padrões", st == {"empty": True, "edit": False, "rows": 3}, st)
        await pg.get_by_role("button", name="Importar assinaturas do Thunderbird").click()
        await pg.wait_for_timeout(300)
        u = await pg.evaluate(STORE)
        sigs = u.get("assinaturas", [])
        ids = {x["nome"]: x["id"] for x in sigs}
        check("importar: uma assinatura por conta que tem, sem o “-- ” do Thunderbird",
              [x["nome"] for x in sigs] == ["ana@exemplo.com.br", "ana.souza@cliente.com.br"] and sigs[0]["html"] == "Ana Souza<br><b>Bluecker</b>", sigs)
        check("importar: padrões das contas (respostas só onde o Thunderbird punha)",
              u.get("assinaturaPadrao") == {"ana@exemplo.com.br": {"nova": ids.get("ana@exemplo.com.br"), "resposta": ids.get("ana@exemplo.com.br")},
                                            "ana.souza@cliente.com.br": {"nova": ids.get("ana.souza@cliente.com.br"), "resposta": None}}, u.get("assinaturaPadrao"))
        await pg.get_by_role("button", name="Importar assinaturas do Thunderbird").click()
        await pg.wait_for_timeout(200)
        again = await pg.evaluate(STORE)
        check("importar de novo não duplica", len(again.get("assinaturas", [])) == 2, len(again.get("assinaturas", [])))
        # nova assinatura, com campos e formatação
        await pg.get_by_role("button", name="Nova", exact=True).click()
        await pg.keyboard.press("Control+a")
        await pg.keyboard.type("Comercial")
        await pg.locator("#editor").click()
        await pg.keyboard.type("Atenciosamente,")
        await pg.keyboard.press("Enter")
        await pg.select_option("#t-field", "nome")
        await pg.keyboard.press("Enter")
        await pg.select_option("#t-field", "cargo")
        await pg.keyboard.press("Enter")
        await pg.keyboard.type("Cel.: ")
        await pg.select_option("#t-field", "celular")
        await pg.evaluate("""(() => { const ed = document.getElementById('editor'); const tw = document.createTreeWalker(ed, 4); let n;
          while ((n = tw.nextNode())) { const i = n.data.indexOf('{nome}'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 6);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r); break; } } })()""")
        await pg.keyboard.press("Control+b")
        await pg.select_option("#t-size", "14")
        await pg.wait_for_timeout(900)
        u = await pg.evaluate(STORE)
        mine = [x for x in u.get("assinaturas", []) if x["nome"] == "Comercial"]
        html = mine[0]["html"] if mine else ""
        check("nova assinatura: nome, texto, campos, negrito e tamanho em pt salvos",
              bool(mine) and "{nome}" in html and "{cargo}" in html and "Cel.: {celular}" in html and "font-size: 14pt" in html and ("bold" in html or "<b>" in html), html)
        prev = await pg.evaluate("document.getElementById('preview').innerText")
        check("pré-visualização: campos da conta; linha sem celular sai", "Ana Souza" in prev and "Gerente de Contas" in prev and "Cel.:" not in prev and "{" not in prev, prev)
        await pg.screenshot(path=os.path.join(OUT, "22_assinaturas.png"), full_page=True)
        # colar HTML com script: entra limpo
        await pg.locator("#editor").click()
        # (O Firefox não deixa um ClipboardEvent sintético levar dados: o evento leva um clipboardData de mentira.)
        await pg.evaluate("""(() => { const html = '<p class="MsoNormal" style="mso-line-height-rule:exactly;color:#1F3864">Colado<script>alert(1)</script><img src="x" onerror="alert(2)"></p>';
          const ev = new Event('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(ev, 'clipboardData', { value: { files: [], getData: t => (t == 'text/html' ? html : '') } });
          document.getElementById('editor').dispatchEvent(ev); })()""")
        await pg.wait_for_timeout(800)
        edhtml = await pg.evaluate("document.getElementById('editor').innerHTML")
        u = await pg.evaluate(STORE)
        saved = [x for x in u.get("assinaturas", []) if x["nome"] == "Comercial"][0]["html"]
        check("colar: sem script, evento, imagem sem endereço aceito nem estilo mso- do Word", "Colado" in saved and "script" not in saved and "onerror" not in saved and "mso-" not in saved and "<img" not in saved and "<script" not in edhtml, saved)
        # padrão da conta de suporte
        await pg.select_option("#defaults tbody tr:nth-child(3) td:nth-child(2) select", label="Comercial")
        await pg.wait_for_timeout(200)
        u = await pg.evaluate(STORE)
        check("padrão por conta: escolha salva na hora", u["assinaturaPadrao"].get("suporte@exemplo.com.br") == {"nova": mine[0]["id"]}, u["assinaturaPadrao"])
        # excluir a assinatura que é padrão: a conta volta a seguir o Thunderbird
        await pg.locator("#list").focus()
        await pg.keyboard.press("Delete")
        await pg.wait_for_timeout(300)
        u = await pg.evaluate(STORE)
        check("excluir: sai da lista e dos padrões", not any(x["nome"] == "Comercial" for x in u["assinaturas"]) and "suporte@exemplo.com.br" not in u["assinaturaPadrao"], u)
        # duplicar
        await pg.get_by_role("button", name="Duplicar").click()
        await pg.wait_for_timeout(300)
        names = await pg.evaluate("[...document.querySelectorAll('.sig-opt .nm')].map(n => n.textContent)")
        check("duplicar: cópia com nome próprio", names[-1].startswith("Cópia de "), names)
        check("assinaturas: sem erros", not logs, logs)
        await pg.close()

        # ---------- Assinaturas com política ----------
        pg = await b.new_page(viewport={"width": 1200, "height": 1500})
        logs = []
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("""sessionStorage.setItem('managed', JSON.stringify({ assinaturas: [{ id: 'corp', nome: 'Corporativa', html: '<b>{nome}</b><br>{organizacao}' }],
          assinaturaPadrao: { '*': { nova: 'corp' } } }));""")
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/assinaturas.html")
        await pg.wait_for_timeout(700)
        st = await pg.evaluate("""({ policy: !document.getElementById('policy').hidden,
          list: [...document.querySelectorAll('.sig-opt')].map(o => o.textContent),
          editable: document.getElementById('editor').contentEditable, name: document.getElementById('name').disabled,
          del: document.getElementById('del').disabled, note: !document.getElementById('managed').hidden,
          nova: [...document.querySelectorAll('#defaults tbody tr')].map(tr => { const s = tr.querySelectorAll('select'); return [s[0].disabled, s[0].selectedOptions[0].textContent, s[1].disabled]; }),
          preview: document.getElementById('preview').innerText })""")
        check("política: assinatura da organização travada, padrão de mensagens novas travado; respostas livres",
              st["policy"] and st["list"] == ["Corporativaorganização"] and st["editable"] == "false" and st["name"] and st["del"] and st["note"]
              and st["nova"] == [[True, "Corporativa (organização)", False]] * 3 and "Ana Souza" in st["preview"] and "Bluecker" in st["preview"], st)
        await pg.screenshot(path=os.path.join(OUT, "23_assinaturas_politica.png"), full_page=True)
        check("assinaturas com política: sem erros", not logs, logs)
        await pg.close()

        # ---------- Assinaturas em inglês ----------
        pg = await b.new_page(viewport={"width": 1200, "height": 1200})
        logs = []
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("sessionStorage.setItem('uiLang', 'en-US');")
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/assinaturas.html")
        await pg.wait_for_timeout(700)
        st = await pg.evaluate("""({ h1: document.querySelector('h1').textContent, th: [...document.querySelectorAll('#defaults th')].map(t => t.textContent),
          field: document.getElementById('t-field').options[1].textContent, bold: document.getElementById('t-bold').getAttribute('aria-label') })""")
        check("assinaturas en-US: textos e campos em inglês", st["h1"] == "Signatures" and st["th"] == ["Account", "New messages", "Replies and forwards"]
              and "{name}" in st["field"] and st["bold"] == "Bold (Ctrl+B)", st)
        check("assinaturas en-US: sem erros", not logs, logs)
        await pg.close()

        # ---------- Partes Rápidas ----------
        pg = await b.new_page(viewport={"width": 1200, "height": 1300})
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("sessionStorage.setItem('store', JSON.stringify({ assinaturas: [{ id: 's1', nome: 'Minha', html: 'x' }] }));")
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/partes.html")
        await pg.wait_for_timeout(700)
        st = await pg.evaluate("""({ h1: document.querySelector('h1').textContent, empty: !document.getElementById('empty').hidden,
          defaults: !!document.getElementById('defaults'), imp: !!document.getElementById('import'), list: document.querySelectorAll('.sig-opt').length })""")
        check("Partes Rápidas: página própria, vazia, sem padrões por conta nem importação", st == {"h1": "Partes Rápidas", "empty": True, "defaults": False, "imp": False, "list": 0}, st)
        await pg.get_by_role("button", name="Nova", exact=True).click()
        await pg.wait_for_timeout(100)
        first = await pg.evaluate("document.getElementById('name').value")
        await pg.keyboard.press("Control+a")
        await pg.keyboard.type("Endereço")
        await pg.locator("#editor").click()
        await pg.keyboard.type("Av. Paulista, 1000 — ")
        await pg.select_option("#t-field", "organizacao")
        await pg.wait_for_timeout(900)
        u = await pg.evaluate(STORE)
        parts = u.get("partesRapidas", [])
        prev = await pg.evaluate("document.getElementById('preview').innerText")
        check("Partes Rápidas: nova parte com campo, salva na hora na chave própria (as assinaturas ficam)",
              first == "Nova Parte Rápida" and len(parts) == 1 and parts[0]["nome"] == "Endereço" and "Av. Paulista, 1000" in parts[0]["html"] and "{organizacao}" in parts[0]["html"]
              and u.get("assinaturas") == [{"id": "s1", "nome": "Minha", "html": "x"}], [first, parts, u.get("assinaturas")])
        check("Partes Rápidas: pré-visualização com os campos da conta", "Av. Paulista, 1000 — Bluecker" in prev, prev)
        await pg.screenshot(path=os.path.join(OUT, "24_partes.png"), full_page=True)
        await pg.locator("#list").focus()
        await pg.keyboard.press("Delete")
        await pg.wait_for_timeout(300)
        u = await pg.evaluate(STORE)
        flash = await pg.evaluate("document.getElementById('flash').textContent")
        check("Partes Rápidas: excluir", u.get("partesRapidas") == [] and flash == "Parte Rápida “Endereço” excluída.", [u.get("partesRapidas"), flash])
        check("Partes Rápidas: sem erros", not logs, logs)
        await pg.close()

        # com política e em inglês
        pg = await b.new_page(viewport={"width": 1200, "height": 1300})
        logs = []
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("sessionStorage.setItem('uiLang', 'en-US'); sessionStorage.setItem('managed', JSON.stringify({ partesRapidas: [{ id: 'org', nome: 'Company address', html: '<p>Av. Paulista, 1000</p>' }] }));")
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/partes.html")
        await pg.wait_for_timeout(700)
        st = await pg.evaluate("""({ h1: document.querySelector('h1').textContent, policy: !document.getElementById('policy').hidden,
          list: [...document.querySelectorAll('.sig-opt')].map(o => o.textContent), editable: document.getElementById('editor').contentEditable,
          del: document.getElementById('del').disabled })""")
        check("Partes Rápidas com política, em inglês: a da organização travada", st == {"h1": "Quick Parts", "policy": True, "list": ["Company addressorganization"], "editable": "false", "del": True}, st)
        check("Partes Rápidas com política: sem erros", not logs, logs)
        await pg.close()

        # outra janela grava as Partes Rápidas com a página aberta (Salvar Seleção na Galeria)
        pg = await b.new_page(viewport={"width": 1200, "height": 1300})
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("sessionStorage.setItem('store', JSON.stringify({ partesRapidas: [{ id: 'p1', nome: 'Endereço', html: 'Av. Paulista' }] }));")
        await pg.add_init_script(MOCK)
        # durante a carga (a configuração já lida, a página ainda não pronta)
        await pg.add_init_script("window.addEventListener('DOMContentLoaded', () => { const s = JSON.parse(sessionStorage.getItem('store')); browser.storage.local.set({ partesRapidas: [...s.partesRapidas, { id: 'cedo', nome: 'Na carga', html: 'Olá' }] }); });")
        await pg.goto(f"http://127.0.0.1:{PORT}/options/partes.html")
        await pg.wait_for_timeout(800)
        NAMES = "[...document.querySelectorAll('.sig-opt .nm')].map(n => n.textContent)"
        IDS = "(JSON.parse(sessionStorage.getItem('store')).partesRapidas || []).map(p => p.id + ': ' + p.html)"
        names = await pg.evaluate(NAMES)
        check("Partes Rápidas: o que outra janela grava durante a carga aparece", names == ["Endereço", "Na carga"], names)
        # digitando aqui; lá, uma parte nova é salva antes da gravação desta página
        await pg.locator("#editor").click()
        await pg.keyboard.press("Control+End")
        await pg.keyboard.type(", 1000")
        await pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('store')); return browser.storage.local.set({ partesRapidas: [...s.partesRapidas, { id: 'ext', nome: 'Saudação', html: 'Prezada' }] }); })()")
        await pg.wait_for_timeout(150)
        mid = [await pg.evaluate("document.getElementById('editor').textContent"), await pg.evaluate(NAMES)]
        await pg.wait_for_timeout(900)
        ids = await pg.evaluate(IDS)
        names = await pg.evaluate(NAMES)
        check("Partes Rápidas: a criada em outra janela aparece sem perder o que se digita aqui; as duas ficam gravadas",
              mid == ["Av. Paulista, 1000", ["Endereço", "Na carga", "Saudação"]] and ids == ["p1: Av. Paulista, 1000", "cedo: Olá", "ext: Prezada"] and names == ["Endereço", "Na carga", "Saudação"], [mid, ids, names])
        # gravação de fora cujo aviso ainda não chegou: esta página lê antes de gravar e não apaga a de lá
        await pg.locator("#editor").click()
        await pg.keyboard.press("Control+End")
        await pg.keyboard.type(" — SP")
        await pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('store')); s.partesRapidas.push({ id: 'ext2', nome: 'Rodapé', html: 'Obrigado' }); sessionStorage.setItem('store', JSON.stringify(s)); })()")
        await pg.wait_for_timeout(1000)
        ids = await pg.evaluate(IDS)
        names = await pg.evaluate(NAMES)
        check("Partes Rápidas: gravar aqui lê a lista antes (a de lá fica) e mostra a nova",
              ids == ["p1: Av. Paulista, 1000 — SP", "cedo: Olá", "ext: Prezada", "ext2: Obrigado"] and names == ["Endereço", "Na carga", "Saudação", "Rodapé"], [ids, names])
        # excluída lá: some daqui (e não volta na gravação desta página)
        await pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('store')); return browser.storage.local.set({ partesRapidas: s.partesRapidas.filter(p => p.id != 'cedo') }); })()")
        await pg.wait_for_timeout(200)
        await pg.locator("#editor").click()
        await pg.keyboard.press("Control+End")
        await pg.keyboard.type("!")
        await pg.wait_for_timeout(1000)
        ids = await pg.evaluate(IDS)
        check("Partes Rápidas: a excluída em outra janela não volta", ids == ["p1: Av. Paulista, 1000 — SP!", "ext: Prezada", "ext2: Obrigado"] and await pg.evaluate(NAMES) == ["Endereço", "Saudação", "Rodapé"], ids)
        # grande demais (mais de 1 MB com as imagens): não grava e avisa; menor, grava
        await pg.evaluate("(() => { const ed = document.getElementById('editor'); ed.focus(); ed.innerHTML = '<p>' + 'x'.repeat(1100000) + '</p>'; ed.dispatchEvent(new Event('input', { bubbles: true })); })()")
        await pg.wait_for_timeout(1200)
        ids = await pg.evaluate(IDS)
        flash = await pg.evaluate("document.getElementById('flash').hidden ? '' : document.getElementById('flash').textContent")
        check("Partes Rápidas: acima de 1 MB não grava e avisa", ids[0] == "p1: Av. Paulista, 1000 — SP!" and "passou de 1 MB" in flash, [ids[0][:60], flash])
        await pg.evaluate("(() => { const ed = document.getElementById('editor'); ed.innerHTML = 'Av. Paulista, 1000'; ed.dispatchEvent(new Event('input', { bubbles: true })); })()")
        await pg.wait_for_timeout(1000)
        ids = await pg.evaluate(IDS)
        check("Partes Rápidas: de volta ao tamanho normal, grava", ids[0] == "p1: Av. Paulista, 1000", ids[0][:60])
        # a que está no editor é excluída em outra janela: o editor passa para a seguinte, sem levar o texto
        await pg.locator("#editor").click()
        await pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('store')); return browser.storage.local.set({ partesRapidas: s.partesRapidas.filter(p => p.id != 'p1') }); })()")
        await pg.wait_for_timeout(200)
        shown = await pg.evaluate("[document.getElementById('name').value, document.getElementById('editor').textContent]")
        await pg.locator("#editor").click()
        await pg.keyboard.press("Control+End")
        await pg.keyboard.type("!")
        await pg.wait_for_timeout(1000)
        ids = await pg.evaluate(IDS)
        check("Partes Rápidas: a que estava no editor foi excluída em outra janela: o editor mostra a seguinte e o texto não vai para ela",
              shown == ["Saudação", "Prezada"] and ids == ["ext: Prezada!", "ext2: Obrigado"], [shown, ids])
        check("Partes Rápidas com outra janela gravando: sem erros", not logs, logs)
        await pg.close()

        # ---------- Ajuda ----------
        pg = await b.new_page(viewport={"width": 900, "height": 1400})
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/ajuda.html")
        await pg.wait_for_timeout(600)
        st = await pg.evaluate("({ h1: document.querySelector('h1').textContent, sup: !document.getElementById('suporte').hidden, links: [...document.querySelectorAll('a.btn')].map(a => a.getAttribute('href')) })")
        check("Ajuda: guia da faixa; sem suporte definido, a seção do suporte não aparece",
              st["h1"] == "Ajuda da Faixa de Opções" and not st["sup"] and "diagnostico.html#atalhos" in st["links"] and "partes.html" in st["links"], st)
        await pg.screenshot(path=os.path.join(OUT, "25_ajuda.png"), full_page=True)
        check("Ajuda: sem erros", not logs, logs)
        await pg.close()
        pg = await b.new_page(viewport={"width": 900, "height": 1400})
        logs = []
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.add_init_script("sessionStorage.setItem('uiLang', 'en-US'); sessionStorage.setItem('managed', JSON.stringify({ suporte: { nome: 'Service Desk', email: 'suporte@bluecker.com', telefone: '+55 11 5555-0000', portal: 'https://suporte.bluecker.com', ajuda: 'javascript:alert(1)' } }));")
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/ajuda.html")
        await pg.wait_for_timeout(600)
        st = await pg.evaluate("({ h1: document.querySelector('h1').textContent, rows: [...document.querySelectorAll('#sup-list dt')].map(d => d.textContent + ': ' + d.nextElementSibling.textContent), hrefs: [...document.querySelectorAll('#sup-list a')].map(a => a.getAttribute('href')) })")
        check("Ajuda com suporte, em inglês: contato da política com links de e-mail, telefone e portal",
              st["h1"] == "Ribbon Help" and st["rows"] == ["Support team: Service Desk", "Email: suporte@bluecker.com", "Phone: +55 11 5555-0000", "Portal: https://suporte.bluecker.com/"]
              and st["hrefs"] == ["mailto:suporte@bluecker.com", "tel:+551155550000", "https://suporte.bluecker.com/"], st)
        check("Ajuda com suporte: sem erros", not logs, logs)
        await pg.close()

        # Atalhos de Teclado: o diagnóstico abre na tabela de atalhos
        pg = await b.new_page(viewport={"width": 1200, "height": 900})
        await pg.add_init_script(MOCK)
        await pg.goto(f"http://127.0.0.1:{PORT}/options/diagnostico.html#atalhos")
        await pg.wait_for_timeout(900)
        top = await pg.evaluate("Math.round(document.getElementById('atalhos').getBoundingClientRect().top)")
        check("diagnóstico#atalhos: a página abre na seção de atalhos", abs(top) < 40, top)
        await pg.close()

        # ---------- background: os comandos da faixa que o background executa ----------
        pg = await b.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.goto(f"http://127.0.0.1:{PORT}/test/harness/background.html")
        await pg.wait_for_function("window.bgReady || window.bgError", timeout=5000)
        err = await pg.evaluate("window.bgError || null")
        first = await pg.evaluate("window.calls.map(c => c[0])")
        check("background: ao carregar, manda a configuração à faixa", not err and first == ["configure"], [err, first])
        # Salvar Seleção na Galeria de Partes Rápidas
        calls = await pg.evaluate("command('saveQuickPart', { nome: ' Saudação ', html: '<p>Prezada</p>' })")
        parts = await pg.evaluate("store.partesRapidas")
        pushed = [c[1]["partesRapidas"] for c in calls if c[0] == "configure"]
        check("background: Salvar Seleção grava a parte nova do usuário e manda a configuração nova à faixa",
              len(parts) == 1 and parts[0]["nome"] == "Saudação" and parts[0]["html"] == "<p>Prezada</p>" and parts[0]["id"].startswith("p")
              and len(pushed) == 1 and [(q["id"], q["nome"], q["gerenciada"]) for q in pushed[0]] == [(parts[0]["id"], "Saudação", False)], [parts, calls])
        pid = parts[0]["id"]
        await pg.evaluate("command('saveQuickPart', { id: %s, nome: 'Saudação', html: 'Oi' })" % json.dumps(pid))
        await pg.evaluate("command('saveQuickPart', { nome: '  ', html: 'x' })")
        await pg.evaluate("command('saveQuickPart', { nome: 'Vazia', html: '' })")
        parts = await pg.evaluate("store.partesRapidas")
        check("background: com o id, substitui; sem nome ou sem conteúdo, não grava", parts == [{"id": pid, "nome": "Saudação", "html": "Oi"}], parts)
        await pg.evaluate("window.managed = { partesRapidas: [{ id: 'org', nome: 'Endereço', html: 'Av. Paulista' }, { id: %s, nome: 'Da política', html: 'P' }] }" % json.dumps(pid))
        calls = await pg.evaluate("command('saveQuickPart', { nome: 'Rodapé', html: 'Obrigado' })")
        pushed = [c[1]["partesRapidas"] for c in calls if c[0] == "configure"]
        check("background: na configuração, as da política primeiro (id repetido vale o da política)",
              pushed and [(q["nome"], q["gerenciada"]) for q in pushed[-1]] == [("Endereço", True), ("Da política", True), ("Rodapé", False)], pushed)
        # Ajuda
        await pg.evaluate("window.managed = null")
        calls = await pg.evaluate("command('openHelp')")
        check("background: Ajuda sem política abre a ajuda da faixa, na janela principal", calls == [["tabs.create", "moz-extension://faixa/options/ajuda.html"], ["windows.update", 3, {"focused": True}]], calls)
        await pg.evaluate("window.managed = { suporte: { email: 'suporte@bluecker.com', portal: 'javascript:alert(1)', ajuda: 'https://ajuda.bluecker.com/faixa' } }")
        calls = await pg.evaluate("command('openHelp')")
        check("background: Ajuda da organização (política suporte.ajuda) no navegador do sistema", calls == [["openDefaultBrowser", "https://ajuda.bluecker.com/faixa"]], calls)
        await pg.evaluate("window.failBrowser = true")
        calls = await pg.evaluate("command('openHelp')")
        await pg.evaluate("window.failBrowser = false")
        check("background: se o Thunderbird recusar o endereço da ajuda, a da faixa",
              [c[0] for c in calls] == ["openDefaultBrowser", "tabs.create", "windows.update"] and calls[1][1].endswith("/options/ajuda.html"), calls)
        # Contatar o Suporte
        calls = await pg.evaluate("command('openSupport', { what: 'mail' })")
        check("background: Escrever para o Suporte: mensagem nova para o suporte, com a versão no assunto",
              calls == [["beginNew", {"to": ["suporte@bluecker.com"], "subject": f"Faixa de Opções {VERSION}: "}]], calls)
        calls = await pg.evaluate("command('openSupport', { what: 'portal' })")
        check("background: portal que não é http(s) não abre", calls == [], calls)
        await pg.evaluate("window.managed = { suporte: { portal: 'https://suporte.bluecker.com', ajuda: 'javascript:alert(1)' } }")
        calls = await pg.evaluate("command('openSupport', { what: 'portal' })")
        calls2 = await pg.evaluate("command('openSupport', { what: 'mail' })")
        calls3 = await pg.evaluate("command('openHelp')")
        check("background: Abrir o Portal no navegador do sistema; sem e-mail na política, nada; ajuda que não é http(s), a da faixa",
              calls == [["openDefaultBrowser", "https://suporte.bluecker.com/"]] and calls2 == [] and [c[0] for c in calls3] == ["tabs.create", "windows.update"], [calls, calls2, calls3])
        # páginas do complemento e comandos de mensagem
        opened = []
        for cmd in ["openShortcuts", "openQuickParts", "openSignatures", "openDiagnostics"]:
            opened += [c[1] for c in await pg.evaluate(f"command('{cmd}')") if c[0] == "tabs.create"]
        check("background: Atalhos de Teclado, Partes Rápidas…, Assinaturas… e Diagnóstico abrem as páginas certas",
              opened == ["moz-extension://faixa/options/diagnostico.html#atalhos", "moz-extension://faixa/options/partes.html", "moz-extension://faixa/options/assinaturas.html", "moz-extension://faixa/options/diagnostico.html"], opened)
        # Barra de menus: a escolha feita na faixa vale para todas as janelas; com política, vale a política
        await pg.evaluate("window.managed = null")
        calls = await pg.evaluate("command('setMenubar', { visible: false })")
        pushed = [c[1] for c in calls if c[0] == "configure"]
        user = await pg.evaluate("store.usuario")
        check("background: Mostrar a barra de menus grava a escolha e manda a configuração às janelas",
              user.get("ocultarBarraMenus") is True and pushed and pushed[-1]["ocultarBarraMenus"] is True and pushed[-1]["gerenciadas"] == [], [user, pushed])
        await pg.evaluate("window.managed = { ocultarBarraMenus: false, perfilAtalhos: 'office-ptbr' }")
        calls = await pg.evaluate("command('setMenubar', { visible: false })")
        pushed = [c[1] for c in calls if c[0] == "configure"]
        check("background: com a barra de menus na política, as janelas recebem a da política e a lista do que ela define",
              pushed and pushed[-1]["ocultarBarraMenus"] is False and pushed[-1]["gerenciadas"] == ["ocultarBarraMenus", "perfilAtalhos"], pushed)
        await pg.evaluate("window.managed = null")
        calls = await pg.evaluate("command('priorityHigh')")
        check("background: Prioridade Alta pela API compose e o estado de volta à faixa",
              calls[0] == ["setComposeDetails", 7, {"priority": "highest"}] and calls[-1][0] == "setMessageState" and calls[-1][2]["priority"] == "highest", calls)
        check("background: sem erros", not logs, logs)
        await pg.close()
        await b.close()
    print("\n%d falhas" % len(FAILS), FAILS)


asyncio.run(main())
sys.exit(1 if FAILS else 0)
