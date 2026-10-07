#!/usr/bin/env python3
"""Confere as traduções: tudo o que aparece em pt-BR precisa estar em cada
ribbon/locales/<idioma>.json, com as mesmas variáveis {assim}.

- textos do código: t("chave", "texto"), FaixaI18n.t(...), T(...) do autoteste
  (prefixo test.), data-i18n* das páginas e o mapa TB_ACTION do diagnóstico;
- ribbon/definition.json: comandos (label, labelOn, tip), abas, grupos, itens de
  menu com rótulo, estilos, paletas, fontes do tema, perfis, officeReference e as
  opções do Alterar Estilos.

Uso: python3 tools/check_i18n.py   (sai com erro se faltar alguma coisa)
"""
import glob, html, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CODE = sorted(os.path.relpath(f, ROOT) for f in glob.glob(os.path.join(ROOT, "experiments/faixa/*.js")) + glob.glob(os.path.join(ROOT, "options/*.js"))
              if not f.endswith(("icons.js", "tb153-keys.js")))
CALL = re.compile(r'\b(FaixaI18n\.t|t|T)\(\s*"([^"]+)"\s*,\s*"((?:[^"\\]|\\.)*)"', re.S)
VARS = re.compile(r"\{(\w+)\}")


def code_strings():
    out = {}
    for f in CODE:
        s = open(os.path.join(ROOT, f), encoding="utf-8").read()
        for fn, key, text in CALL.findall(s):
            if key == "chave":  # exemplo no comentário de FaixaI18n.t
                continue
            if fn == "T" and f.endswith("implementation.js"):
                key = "test." + key
            out[key] = json.loads('"' + text + '"')
    s = open(os.path.join(ROOT, "options/diagnostico.js"), encoding="utf-8").read()
    start = s.index("const TB_ACTION = {")
    block = s[start:s.index("};", start)]
    for m in re.finditer(r'^\s*("?[^:\n]+?"?):\s*"([^"]*)",', block, re.M):
        out["tb." + m.group(1).strip('"')] = m.group(2)
    for f in glob.glob(os.path.join(ROOT, "options/*.html")):
        s = open(f, encoding="utf-8").read()
        for key, text in re.findall(r'data-i18n="([^"]+)"[^>]*>([^<]*)<', s):
            out[key] = html.unescape(text).strip()
        for attr in ("placeholder", "title", "aria-label"):
            for tag in re.findall(r"<[^>]*data-i18n-%s=[^>]*>" % attr, s):
                key = re.search(r'data-i18n-%s="([^"]+)"' % attr, tag).group(1)
                val = re.search(r'\b%s="([^"]*)"' % attr, tag)
                out[key] = html.unescape(val.group(1)) if val else ""
    return out


def check_definition(defn, ov, problems):
    for cid, c in defn["commands"].items():
        o = ov.get("commands", {}).get(cid, {})
        for field in ("label", "labelOn", "shortLabel", "tip"):
            if field in c and field not in o:
                problems.append(f"comando {cid}: falta {field}")
    if "fileTab" in defn:
        for field in ("label", "tip"):
            if field not in ov.get("fileTab", {}):
                problems.append(f"fileTab: falta {field}")
    for tab in defn["tabs"]:
        if tab["id"] not in ov.get("tabs", {}):
            problems.append(f"aba {tab['id']}")
        for g in tab["groups"]:
            if g["id"] not in ov.get("groups", {}):
                problems.append(f"grupo {g['id']}")
    for mid, entries in defn["menus"].items():
        for i, e in enumerate(entries):
            if ("label" in e or "head" in e) and f"{mid}.{i}" not in ov.get("menus", {}):
                # Rótulos sem palavras ("50%", "1,5", "a. b. c.") valem em qualquer idioma.
                text = e.get("label", e.get("head", ""))
                if re.search(r"[^\W\d_]{4,}", text):
                    problems.append(f"menu {mid}.{i} ({text})")
    # Itens de menu vão pela posição: uma entrada nova no meio do menu desloca as outras.
    for key, text in ov.get("menus", {}).items():
        mid, _, i = key.rpartition(".")
        entries = defn["menus"].get(mid)
        e = entries[int(i)] if entries is not None and i.isdigit() and int(i) < len(entries) else None
        if not e or not ("label" in e or "head" in e):
            problems.append(f"menu {key}: sobrando (a entrada não existe ou não tem rótulo)")
    groups = {g["id"] for tab in defn["tabs"] for g in tab["groups"]}
    for section, known in (("commands", set(defn["commands"])), ("tabs", {t["id"] for t in defn["tabs"]}), ("groups", groups),
                           ("styles", {st["id"] for st in defn["styles"]})):
        for key in ov.get(section, {}):
            if key not in known:
                problems.append(f"{section} {key}: sobrando (não existe na definição)")
    for st in defn["styles"]:
        if st["id"] not in ov.get("styles", {}):
            problems.append(f"estilo {st['id']}")
    # Paletas: os campos de texto ("Automático", "Sem Cor"); as listas de cores não têm texto.
    palettes = defn.get("palettes", {})
    for pid, p in palettes.items():
        for field, value in p.items():
            if isinstance(value, str) and f"{pid}.{field}" not in ov.get("palettes", {}):
                problems.append(f"paleta {pid}.{field} ({value})")
    for key in ov.get("palettes", {}):
        pid, _, field = key.partition(".")
        if not isinstance(palettes.get(pid, {}).get(field), str):
            problems.append(f"paleta {key}: sobrando (não existe na definição)")
    # Alterar Estilos: o nome de cada opção, "seção.id" (styleSets.default, colors.blue...).
    options = {f"{section}.{o['id']}": o.get("label", "")
               for section, items in defn.get("changeStyles", {}).items() if isinstance(items, list) for o in items}
    for key, label in options.items():
        if key not in ov.get("changeStyles", {}):
            problems.append(f"Alterar Estilos {key} ({label})")
    for key in ov.get("changeStyles", {}):
        if key not in options:
            problems.append(f"Alterar Estilos {key}: sobrando (não existe na definição)")
    for f in defn.get("themeFonts", []):
        if f["name"] not in ov.get("themeFonts", {}):
            problems.append(f"fonte do tema {f['name']}")
    for pid in defn.get("shortcutProfiles", {}):
        if pid not in ov.get("shortcutProfiles", {}):
            problems.append(f"perfil {pid}")
    if len(ov.get("officeReference", [])) != len(defn.get("officeReference", [])):
        problems.append("officeReference: quantidade diferente de linhas")


def main():
    defn = json.load(open(os.path.join(ROOT, "ribbon/definition.json"), encoding="utf-8"))
    strings = code_strings()
    total = 0
    for path in sorted(glob.glob(os.path.join(ROOT, "ribbon/locales/*.json"))):
        ov = json.load(open(path, encoding="utf-8"))
        problems = []
        tr = ov.get("strings", {})
        for key, text in strings.items():
            if key not in tr:
                problems.append(f"texto {key}: “{text}”")
            elif sorted(set(VARS.findall(text))) != sorted(set(VARS.findall(tr[key]))):
                problems.append(f"texto {key}: variáveis diferentes")
        for key in tr:
            if key not in strings:
                problems.append(f"texto {key}: sobrando (não é usado)")
        check_definition(defn, ov, problems)
        name = os.path.basename(path)
        print(f"{name}: {len(strings)} textos, {len(problems)} problemas")
        for p in problems:
            print("  -", p)
        total += len(problems)
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
