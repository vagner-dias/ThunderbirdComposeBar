#!/usr/bin/env python3
"""Gera experiments/faixa/icons.js a partir de um sprite SVG (símbolos Lucide).

Uso: python3 tools/gen_icons.py caminho/sprite.svg
Cada ícone vira uma lista de elementos [tag, {atributos}], criada depois com
createElementNS (sem innerHTML, que em documentos privilegiados passa por filtro).
"""
import json, re, sys
from html.parser import HTMLParser

class P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons = {}
        self.cur = None
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'symbol':
            self.cur = a['id'][2:] if a['id'].startswith('i-') else a['id']
            self.icons[self.cur] = []
        elif self.cur is not None:
            self.icons[self.cur].append([tag, a])
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
    def handle_endtag(self, tag):
        if tag == 'symbol':
            self.cur = None

TARGET = 'experiments/faixa/icons.js'

def write(icons):
    out = ['/* Ícones Lucide (ISC), ver LICENSES/lucide-ISC.txt. Gerado por tools/gen_icons.py. */',
           '"use strict";',
           'var FAIXA_ICONS = {']
    for name in sorted(icons):
        out.append('  %s: %s,' % (json.dumps(name), json.dumps(icons[name], ensure_ascii=False, separators=(',', ':'))))
    out.append('};')
    open(TARGET, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print(len(icons), 'ícones')

if sys.argv[1] == '--add':
    # Uso: python3 tools/gen_icons.py --add icon-nodes.json nome1 nome2 ...
    # (icon-nodes.json vem do pacote lucide-static; mantém os ícones que já existem)
    nodes = json.load(open(sys.argv[2], encoding='utf-8'))
    icons = {}
    for line in open(TARGET, encoding='utf-8'):
        m = re.match(r'\s*("[^"]+"):\s*(\[.*\]),\s*$', line)
        if m:
            icons[json.loads(m.group(1))] = json.loads(m.group(2))
    for name in sys.argv[3:]:
        if name not in nodes:
            sys.exit('ícone não encontrado: ' + name)
        icons[name] = nodes[name]
    write(icons)
else:
    src = open(sys.argv[1], encoding='utf-8').read()
    p = P(); p.feed(src)
    write(p.icons)
