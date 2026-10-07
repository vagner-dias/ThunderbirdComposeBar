/* Faixa de Opções — Alterar Estilos: conjunto de estilos, cores e fontes do tema e
 * espaçamento entre parágrafos, como no menu Alterar Estilos do Outlook.
 *
 * A escolha vale para a mensagem e fica no atributo data-faixa-estilos do <body>: vai
 * junto no rascunho e no modelo e sai no envio (normalização). A definição efetiva é a
 * de ribbon/definition.json com o tema aplicado: os estilos (com {headings}, {accent1}...
 * trocados pelos valores do tema), a paleta Cores do Tema e as Fontes do Tema. Sem
 * escolha, o tema é o do Office e os valores são os de sempre. Não conhece o Thunderbird. */

"use strict";

var FAIXA_THEME_ATTR = "data-faixa-estilos";

var FaixaThemes = {
  PARTS: ["set", "colors", "fonts", "spacing"],
  SECTIONS: { set: "styleSets", colors: "colors", fonts: "fonts", spacing: "spacing" },
  cache: new WeakMap(),

  /** Lista de opções de uma parte (set, colors, fonts, spacing) na definição. */
  options(def, part) {
    const cs = def && def.changeStyles;
    return (cs && cs[this.SECTIONS[part]]) || [];
  },

  /** Escolha guardada no atributo ("set=word2010;colors=blue"): { set, colors, fonts,
   * spacing }, com o padrão (a primeira opção de cada parte) no que faltar ou for desconhecido. */
  parse(value, def) {
    const out = {};
    for (const part of this.PARTS) {
      const list = this.options(def, part);
      out[part] = list.length ? list[0].id : "";
    }
    for (const pair of String(value || "").split(";")) {
      const [part, id] = pair.split("=").map(x => x.trim());
      if (this.PARTS.includes(part) && this.options(def, part).some(o => o.id == id)) {
        out[part] = id;
      }
    }
    return out;
  },

  /** O valor do atributo: só as partes fora do padrão; "" quando tudo é o padrão. */
  serialize(state, def) {
    const pairs = [];
    for (const part of this.PARTS) {
      const list = this.options(def, part);
      if (state[part] && list.length && state[part] != list[0].id && list.some(o => o.id == state[part])) {
        pairs.push(part + "=" + state[part]);
      }
    }
    return pairs.join(";");
  },

  /** Definição efetiva para o tema do atributo. Sempre o mesmo objeto para a mesma
   * definição e o mesmo valor; comandos, abas e menus são os da definição original. */
  apply(def, value) {
    if (!def || !def.changeStyles) {
      return def;
    }
    let byKey = this.cache.get(def);
    if (!byKey) {
      byKey = new Map();
      this.cache.set(def, byKey);
    }
    // A faixa pede a definição a cada controle: o valor do atributo já visto vai direto.
    const raw = "=" + String(value || "");
    let eff = byKey.get(raw);
    if (!eff) {
      const state = this.parse(value, def);
      const key = this.serialize(state, def);
      eff = byKey.get(key) || this.build(def, state, key);
      byKey.set(key, eff);
      byKey.set(raw, eff);
    }
    return eff;
  },

  build(def, state, key) {
    const find = part => this.options(def, part).find(o => o.id == state[part]) || this.options(def, part)[0] || {};
    const set = find("set");
    const colors = find("colors");
    const fonts = find("fonts");
    const spacing = find("spacing");
    const tokens = this.tokens(def, colors, fonts);
    const styles = (def.styles || []).map(st => {
      const s = Object.assign({}, st, (set.styles && set.styles[st.id]) || {});
      for (const field of ["css", "preview", "color"]) {
        if (typeof s[field] == "string") {
          s[field] = this.resolve(s[field], tokens);
        }
      }
      return s;
    });
    const palettes = Object.assign({}, def.palettes);
    if (palettes.font) {
      palettes.font = Object.assign({}, palettes.font, { theme: this.palette(def, colors) });
    }
    const themeFonts = (def.themeFonts || []).map((f, i) => Object.assign({}, f, { name: (i == 0 ? fonts.major : fonts.minor) || f.name }));
    return Object.assign({}, def, {
      styles,
      palettes,
      themeFonts,
      theme: { key, state, set, colors, fonts, spacing, tokens, bodyFont: fonts.minor ? this.fontStack(fonts.minor, def.fontFallbacks) : "" },
    });
  },

  /** Valores de {headings}, {accent1}, {accent1-25}, {accent1-50} e {text2}. */
  tokens(def, colors, fonts) {
    const c = colors.colors || [];
    const accent1 = c[4] || "#4472C4";
    const fixed = colors.tokens || {};
    return {
      headings: fonts.headings || this.fontStack(fonts.major || "Calibri Light", def.fontFallbacks),
      accent1,
      "accent1-25": fixed["accent1-25"] || this.lum(accent1, 0.75, 0),
      "accent1-50": fixed["accent1-50"] || this.lum(accent1, 0.5, 0),
      text2: c[2] || "#44546A",
    };
  },

  resolve(text, tokens) {
    return String(text).replace(/\{([a-z0-9-]+)\}/gi, (m, k) => (k in tokens ? tokens[k] : m));
  },

  /** Pilha de fontes com as substitutas de fontFallbacks (Calibri → Carlito, Arial...). */
  fontStack(name, fallbacks) {
    const clean = String(name || "").trim();
    if (!clean || clean.includes(",")) {
      return clean;
    }
    const map = fallbacks || {};
    const fallback = map[clean] || map["*"] || "sans-serif";
    const quoted = /[^\w-]/.test(clean) ? '"' + clean.replace(/"/g, "") + '"' : clean;
    const rest = fallback
      .split(",")
      .map(f => f.trim())
      .filter(f => f && f.toLowerCase() != clean.toLowerCase())
      .map(f => (/[^\w-]/.test(f) && !/^["']/.test(f) ? '"' + f + '"' : f));
    return [quoted, ...rest].join(", ");
  },

  /* ---------- cores do tema ---------- */

  /** A grade Cores do Tema (6 linhas × 10 cores), como a do Office: as cores do tema e,
   * embaixo, as variações mais claras e mais escuras de cada uma. O tema Office usa a
   * grade da definição (a mesma do Office); os outros são calculados. */
  palette(def, colors) {
    const base = def.palettes && def.palettes.font && def.palettes.font.theme;
    const first = this.options(def, "colors")[0];
    const c = colors.colors;
    if (!c || c.length < 10 || (first && colors.id == first.id && base)) {
      return base;
    }
    // Ordem do Office: Plano de Fundo 1, Texto 1, Plano de Fundo 2, Texto 2, Ênfases 1 a 6.
    const order = [c[1], c[0], c[3], c[2], c[4], c[5], c[6], c[7], c[8], c[9]];
    const cols = order.map(hex => [hex.toUpperCase(), ...this.variants(hex)]);
    return [0, 1, 2, 3, 4, 5].map(r => cols.map(col => col[r]));
  },

  /** As cinco variações de uma cor na grade, pela regra do Office: branco fica mais escuro
   * (5%, 15%, 25%, 35%, 50%), preto mais claro (50%, 35%, 25%, 15%, 5%), cor muito clara
   * mais escura (10% a 90%), muito escura mais clara (90% a 10%), e as outras 80%, 60% e
   * 40% mais claras e 25% e 50% mais escuras. */
  variants(hex) {
    const [, , l] = this.hsl(hex);
    const up = h => hex.toUpperCase() == h;
    const darker = list => list.map(x => this.lum(hex, 1 - x, 0));
    const lighter = list => list.map(x => this.lum(hex, 1 - x, x));
    if (up("#FFFFFF")) {
      return darker([0.05, 0.15, 0.25, 0.35, 0.5]);
    }
    if (up("#000000")) {
      return lighter([0.5, 0.35, 0.25, 0.15, 0.05]);
    }
    if (l > 0.8) {
      return darker([0.1, 0.25, 0.5, 0.75, 0.9]);
    }
    if (l < 0.2) {
      return lighter([0.9, 0.75, 0.5, 0.25, 0.1]);
    }
    return [...lighter([0.8, 0.6, 0.4]), ...darker([0.25, 0.5])];
  },

  /** Luminosidade (HSL) × mod + off, como o lumMod/lumOff do Office. */
  lum(hex, mod, off) {
    const [h, s, l] = this.hsl(hex);
    return this.hex(this.rgb(h, s, Math.max(0, Math.min(1, l * mod + off))));
  },

  hsl(hex) {
    const m = String(hex).replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) {
      return [0, 0, 0];
    }
    const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) {
      return [0, 0, l];
    }
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max == r) {
      h = ((g - b) / d) % 6;
    } else if (max == g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    return [(h * 60 + 360) % 360, s, l];
  },

  rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map(v => v * 255);
  },

  /** Como o Office: cada canal arredondado para baixo. */
  hex(rgb) {
    return "#" + rgb.map(v => Math.max(0, Math.min(255, Math.floor(v + 1e-9))).toString(16).padStart(2, "0")).join("").toUpperCase();
  },
};
