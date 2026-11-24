'use strict';
// Leitor de IFC (STEP, IFC2x3 / IFC4) para orçamentos: paredes, pilares, vigas, lajes e sapatas.
// Lê a geometria "SweptSolid" (extrusões) exportada pelo ArchiCAD; não precisa das Base Quantities.
(function (g) {
  function decode(s) {
    return s
      .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (m, h) => { let o = ''; for (let i = 0; i + 4 <= h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o; })
      .replace(/\\X\\([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\S\\(.)/g, (m, c) => String.fromCharCode(c.charCodeAt(0) + 128));
  }

  function parseArgs(s) {
    let p = 0; const n = s.length;
    const ws = () => { while (p < n && (s[p] === ' ' || s[p] === '\n' || s[p] === '\r' || s[p] === '\t')) p++; };
    function val() {
      ws(); const c = s[p];
      if (c === "'") {
        p++; let out = '';
        while (p < n) { const ch = s[p]; if (ch === "'") { if (s[p + 1] === "'") { out += "'"; p += 2; continue; } p++; break; } out += ch; p++; }
        return decode(out);
      }
      if (c === '#') { p++; const st = p; while (p < n && s[p] >= '0' && s[p] <= '9') p++; return { r: +s.slice(st, p) }; }
      if (c === '(') {
        p++; const arr = []; ws();
        if (s[p] === ')') { p++; return arr; }
        while (p < n) { arr.push(val()); ws(); if (s[p] === ',') { p++; continue; } if (s[p] === ')') { p++; break; } p++; }
        return arr;
      }
      if (c === '$' || c === '*') { p++; return null; }
      if (c === '.') { p++; const st = p; while (p < n && s[p] !== '.') p++; const e = s.slice(st, p); p++; return { e }; }
      if (/[A-Za-z]/.test(c)) {
        const st = p; while (p < n && /[A-Za-z0-9_]/.test(s[p])) p++; ws();
        if (s[p] === '(') { p++; const v = val(); ws(); if (s[p] === ')') p++; return v; }
        return s.slice(st, p);
      }
      const st = p; while (p < n && /[0-9eE+\-.]/.test(s[p])) p++;
      return parseFloat(s.slice(st, p));
    }
    const out = []; ws();
    while (p < n) { out.push(val()); ws(); if (s[p] === ',') p++; else break; }
    return out;
  }

  function load(text) {
    const i0 = text.indexOf('DATA;');
    if (i0 < 0) throw new Error('Este ficheiro não parece ser um IFC (falta a secção DATA).');
    const i1 = text.lastIndexOf('ENDSEC;');
    const body = text.slice(i0 + 5, i1 > i0 ? i1 : text.length);
    const raw = new Map(), byType = new Map();
    const re = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*;(?=\s*(?:#|$))/g;
    let m;
    while ((m = re.exec(body))) {
      const id = +m[1], t = m[2].toUpperCase();
      raw.set(id, { t, a: m[3] });
      let l = byType.get(t); if (!l) byType.set(t, l = []); l.push(id);
    }
    const cache = new Map();
    const get = id => {
      if (id == null) return null;
      if (typeof id === 'object') id = id.r;
      const r = raw.get(id); if (!r) return null;
      let v = cache.get(id);
      if (!v) { v = { id, t: r.t, a: parseArgs(r.a) }; cache.set(id, v); }
      return v;
    };
    const all = t => (byType.get(t) || []).map(get);
    const schema = (text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/) || [])[1] || '?';
    return { get, all, schema, count: raw.size };
  }

  function analyze(text) {
    const M = load(text), { get, all } = M;
    if (!M.count) throw new Error('Não foram encontrados elementos no ficheiro.');

    // Unidade de comprimento (ArchiCAD costuma exportar em milímetros)
    let f = null;
    const escala = u => { const pre = u.a[2] && u.a[2].e; return pre === 'MILLI' ? 0.001 : pre === 'CENTI' ? 0.01 : pre === 'DECI' ? 0.1 : pre === 'KILO' ? 1000 : 1; };
    const proj = all('IFCPROJECT')[0];
    const ua = proj && get(proj.a[8]);
    for (const U of (ua && ua.a[0]) || []) {
      const u = get(U);
      if (!u) continue;
      if (u.t === 'IFCSIUNIT' && u.a[1] && u.a[1].e === 'LENGTHUNIT') f = escala(u);
      else if (u.t === 'IFCCONVERSIONBASEDUNIT' && u.a[1] && u.a[1].e === 'LENGTHUNIT') { const mw = get(u.a[3]); const v = mw && mw.a[0]; const base = mw && get(mw.a[1]); if (v) f = (+v) * (base ? escala(base) : 1); }
    }
    if (f == null) { const u = all('IFCSIUNIT').find(x => x.a[1] && x.a[1].e === 'LENGTHUNIT'); f = u ? escala(u) : 1; }

    // Pisos
    const piso = new Map(); const pisos = new Set();
    for (const r of all('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
      const s = get(r.a[5]); if (!s) continue;
      const nm = s.a[2] || s.a[7] || 'Piso'; pisos.add(nm);
      for (const e of r.a[4] || []) if (e) piso.set(e.r, nm);
    }

    // Materiais e espessura das camadas
    const espMat = new Map(), nomeMat = new Map();
    for (const r of all('IFCRELASSOCIATESMATERIAL')) {
      const m = get(r.a[5]); if (!m) continue;
      let set = null; let esp = 0; const nomes = [];
      if (m.t === 'IFCMATERIALLAYERSETUSAGE') set = get(m.a[0]);
      else if (m.t === 'IFCMATERIALLAYERSET') set = m;
      if (set) {
        for (const L of set.a[0] || []) { const l = get(L); if (!l) continue; esp += +l.a[1] || 0; const mm = get(l.a[0]); if (mm && mm.a[0]) nomes.push(mm.a[0]); }
      } else if (m.t === 'IFCMATERIAL') nomes.push(m.a[0]);
      else if (m.t === 'IFCMATERIALLIST') for (const x of m.a[0] || []) { const mm = get(x); if (mm) nomes.push(mm.a[0]); }
      for (const o of r.a[4] || []) { if (!o) continue; if (esp > 0) espMat.set(o.r, esp); if (nomes.length) nomeMat.set(o.r, [...new Set(nomes)].join(' + ')); }
    }

    // Vãos (aberturas) e o que os preenche (portas/janelas)
    const vaosDe = new Map();
    for (const r of all('IFCRELVOIDSELEMENT')) {
      const w = r.a[4] && r.a[4].r, o = r.a[5] && r.a[5].r; if (!w || !o) continue;
      if (!vaosDe.has(w)) vaosDe.set(w, []); vaosDe.get(w).push(o);
    }
    const preench = new Map();
    for (const r of all('IFCRELFILLSELEMENT')) { if (r.a[4] && r.a[5]) preench.set(r.a[4].r, get(r.a[5])); }

    // Geometria
    function reps(prod, ident) {
      const pds = get(prod.a[6]); if (!pds) return [];
      const out = [];
      for (const R of pds.a[2] || []) { const r = get(R); if (!r) continue; if (ident && r.a[1] !== ident) continue; for (const it of r.a[3] || []) out.push(get(it)); }
      return out;
    }
    function pts(curve) {
      if (!curve) return null;
      if (curve.t === 'IFCPOLYLINE') return (curve.a[0] || []).map(p => { const c = get(p); return c ? c.a[0] : [0, 0]; });
      if (curve.t === 'IFCINDEXEDPOLYCURVE') { const pl = get(curve.a[0]); return pl ? pl.a[0] : null; }
      return null;
    }
    function polyArea(P) { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
    function bbox(P) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const q of P) { if (q[0] < a) a = q[0]; if (q[0] > c) c = q[0]; if (q[1] < b) b = q[1]; if (q[1] > d) d = q[1]; } return [c - a, d - b]; }
    function profile(p) {
      if (!p) return null;
      switch (p.t) {
        case 'IFCRECTANGLEPROFILEDEF': { const x = +p.a[3], y = +p.a[4]; return { x, y, A: x * y, ret: true }; }
        case 'IFCCIRCLEPROFILEDEF': { const r = +p.a[3]; return { x: 2 * r, y: 2 * r, A: Math.PI * r * r, circ: true }; }
        case 'IFCARBITRARYCLOSEDPROFILEDEF': { const P = pts(get(p.a[2])); if (!P || P.length < 3) return null; const [x, y] = bbox(P); return { x, y, A: polyArea(P) }; }
        case 'IFCARBITRARYPROFILEDEFWITHVOIDS': { const P = pts(get(p.a[2])); if (!P || P.length < 3) return null; const [x, y] = bbox(P); let A = polyArea(P); for (const v of p.a[3] || []) { const Q = pts(get(v)); if (Q) A -= polyArea(Q); } return { x, y, A }; }
      }
      return null;
    }
    function solids(item, out) {
      if (!item) return out;
      switch (item.t) {
        case 'IFCEXTRUDEDAREASOLID': { const pr = profile(get(item.a[0])); if (pr) out.push(Object.assign(pr, { d: +item.a[3] || 0 })); break; }
        case 'IFCBOOLEANCLIPPINGRESULT': case 'IFCBOOLEANRESULT': solids(get(item.a[1]), out); break;
        case 'IFCMAPPEDITEM': { const map = get(item.a[0]); const rep = map && get(map.a[1]); for (const it of (rep && rep.a[3]) || []) solids(get(it), out); break; }
      }
      return out;
    }
    const body = prod => { const out = []; for (const it of reps(prod, 'Body')) solids(it, out); return out; };
    const maior = S => S.reduce((a, s) => (s.A > a.A ? s : a), S[0]);
    const volume = S => S.reduce((a, s) => a + s.A * s.d, 0);
    function axisLen(prod) {
      let L = 0;
      for (const it of reps(prod, 'Axis')) { const P = pts(it); if (P) for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); }
      return L;
    }
    const f2 = f * f, f3 = f2 * f;
    const semGeo = [];

    // Paredes
    const paredes = [];
    for (const t of ['IFCWALLSTANDARDCASE', 'IFCWALL', 'IFCWALLELEMENTEDCASE']) for (const w of all(t)) {
      const S = body(w); if (!S.length) { semGeo.push(w.a[2] || t); continue; }
      const h = Math.max(...S.map(s => s.d)); const vol = volume(S); const big = maior(S);
      let esp = espMat.get(w.id) || 0; if (!esp) esp = Math.min(big.x, big.y);
      let L = axisLen(w); if (!L) L = esp > 0 && h > 0 ? vol / (esp * h) : Math.max(big.x, big.y);
      let vaos = 0, portas = 0, janelas = 0;
      for (const oid of vaosDe.get(w.id) || []) {
        const o = get(oid); if (!o) continue;
        for (const s of body(o)) {
          const dims = [s.x, s.y, s.d]; let k = 0, best = Infinity;
          dims.forEach((v, i) => { const dd = Math.abs(v - esp); if (dd < best) { best = dd; k = i; } });
          const rest = dims.filter((_, i) => i !== k);
          vaos += (k === 2 ? s.A : rest[0] * rest[1]);
        }
        const fil = preench.get(oid);
        if (fil) { if (/DOOR/.test(fil.t)) portas++; else if (/WINDOW/.test(fil.t)) janelas++; }
      }
      paredes.push({ nome: w.a[2] || 'Parede', piso: piso.get(w.id) || '', material: nomeMat.get(w.id) || '', comp: L * f, alt: h * f, esp: esp * f, vaos: Math.min(vaos * f2, L * h * f2), vol: vol * f3, portas, janelas });
    }

    // Pilares
    const pilares = [];
    for (const c of all('IFCCOLUMN')) {
      const S = body(c); if (!S.length) { semGeo.push(c.a[2] || 'Pilar'); continue; }
      const s = maior(S); let a = s.x, b = s.y, nota = '';
      if (!s.ret) { nota = s.circ ? 'circular Ø' + Math.round(s.x * f * 100) + ' cm' : 'secção irregular'; a = b = Math.sqrt(s.A); }
      pilares.push({ nome: c.a[2] || 'Pilar', piso: piso.get(c.id) || '', a: a * f, b: b * f, h: s.d * f, vol: volume(S) * f3, nota, material: nomeMat.get(c.id) || '' });
    }

    // Vigas
    const vigas = [];
    for (const v of all('IFCBEAM')) {
      const S = body(v); if (!S.length) { semGeo.push(v.a[2] || 'Viga'); continue; }
      const s = maior(S); let b = Math.min(s.x, s.y), h = Math.max(s.x, s.y), nota = '';
      if (!s.ret) { nota = 'secção irregular'; b = Math.sqrt(s.A); h = b; }
      vigas.push({ nome: v.a[2] || 'Viga', piso: piso.get(v.id) || '', b: b * f, h: h * f, L: s.d * f, vol: volume(S) * f3, nota });
    }

    // Lajes
    const lajes = [];
    for (const l of all('IFCSLAB')) {
      const S = body(l); if (!S.length) { semGeo.push(l.a[2] || 'Laje'); continue; }
      const A = S.reduce((a, s) => a + s.A, 0); const vol = volume(S); const esp = A > 0 ? vol / A : 0;
      const tipo = l.a[8] && l.a[8].e;
      lajes.push({ nome: l.a[2] || 'Laje', piso: piso.get(l.id) || '', area: A * f2, esp: esp * f, vol: vol * f3, tipo: tipo === 'ROOF' ? 'cobertura' : tipo === 'BASESLAB' ? 'laje térrea' : '', material: nomeMat.get(l.id) || '' });
    }

    // Sapatas
    const sapatas = [];
    for (const s0 of all('IFCFOOTING')) {
      const S = body(s0); if (!S.length) { semGeo.push(s0.a[2] || 'Sapata'); continue; }
      const s = maior(S);
      sapatas.push({ nome: s0.a[2] || 'Sapata', piso: piso.get(s0.id) || '', x: s.x * f, y: s.y * f, h: s.d * f, vol: volume(S) * f3 });
    }

    // Portas e janelas (OverallHeight / OverallWidth; piso pela parede onde estão, se preciso)
    const pisoAb = new Map();
    for (const [w, ops] of vaosDe) for (const op of ops) { const fil = preench.get(op); if (fil) pisoAb.set(fil.id, piso.get(w)); }
    const aberturas = [];
    for (const [t, tipo] of [['IFCDOOR', 'porta'], ['IFCWINDOW', 'janela']]) for (const d of all(t)) {
      let h = +d.a[8] || 0, w = +d.a[9] || 0;
      if (!(h > 0 && w > 0)) { const S = body(d); if (S.length) { const s = maior(S); w = Math.max(s.x, s.y); h = s.d; } }
      aberturas.push({ tipo, nome: d.a[2] || '', larg: w * f, alt: h * f, piso: piso.get(d.id) || pisoAb.get(d.id) || '' });
    }

    return {
      schema: M.schema, pisos: [...pisos], paredes, pilares, vigas, lajes, sapatas, aberturas, semGeo,
      portas: all('IFCDOOR').length, janelas: all('IFCWINDOW').length
    };
  }

  g.IFC = { analyze };
})(typeof window !== 'undefined' ? window : globalThis);
