'use strict';
/* PC Orçamentos — versão 0.3.0
   Honorários de projeto (descontos, proposta, pagamentos e recibos), estrutura em betão por traço,
   alvenaria por tipo de bloco, portas e janelas, materiais por piso e mão de obra em meticais.
   Dados no próprio aparelho; exportar/importar para partilhar. */
const VERSAO = '0.4.0';
const KEY = 'pcorc.v1';
let S;            // estado
let outs = null;  // valores calculados da vista atual (atualizam enquanto escreve)
let pendIfc = null, pendJson = null;
const abertos = new Set(); // listas detalhadas abertas

/* ---------- utilitários ---------- */
const $ = (s, r = document) => r.querySelector(s);
const hoje = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmt(n, d = 2) {
  n = +n; if (!isFinite(n)) n = 0;
  const s = Math.abs(n).toFixed(d); let [i, f] = s.split('.');
  i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (n < 0 && +s !== 0 ? '−' : '') + i + (f ? ',' + f : '');
}
const fmtA = n => fmt(n, Math.abs(n - Math.round(n)) < 1e-9 ? 0 : (Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? 1 : 2)); // sem casas decimais desnecessárias
const mt = n => fmt(n, 2) + ' MT';
const mt0 = n => fmt(n, 0) + ' MT';
const numIn = v => (v === '' || v == null || isNaN(v)) ? '' : String(+(+v).toFixed(6)).replace('.', ',');
function toNum(s) { s = String(s).trim().replace(/\s/g, '').replace(',', '.'); const n = parseFloat(s); return isFinite(n) ? n : 0; }
const fData = d => d ? d.split('-').reverse().join('/') : '—';
function diasDesde(d) { if (!d) return null; return Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 864e5); }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); }
const traco = t => (t || []).map(x => numIn(x)).join(':');
const cm = v => fmtA((+v || 0) * 100);
const info = html => `<div class="info">${html}</div>`;

/* Valor por extenso (meticais) */
function extenso(v) {
  const n = Math.round((+v || 0) * 100), int = Math.floor(n / 100), cent = n % 100;
  const U = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete', 'dezoito', 'dezanove'];
  const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = x => {
    if (x === 100) return 'cem';
    const h = Math.floor(x / 100), r = x % 100, p = [];
    if (h) p.push(C[h]);
    if (r) p.push(r < 20 ? U[r] : (r % 10 ? D[Math.floor(r / 10)] + ' e ' + U[r % 10] : D[r / 10]));
    return p.join(' e ');
  };
  const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['mil milhões', 'mil milhões']];
  const full = x => {
    if (x === 0) return 'zero';
    const parts = []; let i = 0;
    while (x > 0) {
      const g = x % 1000;
      if (g) parts.unshift({ g, i, s: i === 1 ? (g === 1 ? 'mil' : ate999(g) + ' mil') : ate999(g) + (i ? ' ' + (g === 1 ? nomes[i][0] : nomes[i][1]) : '') });
      x = Math.floor(x / 1000); i++;
    }
    return parts.map((p, k) => (k === 0 ? '' : (p.g < 100 || p.g % 100 === 0 ? ' e ' : ' ')) + p.s).join('');
  };
  let s = full(int) + (int === 1 ? ' metical' : ' meticais');
  if (int >= 1e6 && int % 1e6 === 0) s = s.replace(/ (meticais)$/, ' de $1');
  if (cent) s += ' e ' + full(cent) + (cent === 1 ? ' centavo' : ' centavos');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------- valores de origem ---------- */
function defClasses() {
  // Traço em volume (cimento : areia : brita) e relação água/cimento. Editável em Definições.
  return [
    { id: 'C12/15', antiga: 'B15', traco: [1, 3, 6], ac: 0.65, uso: 'Betão de limpeza / regularização' },
    { id: 'C16/20', antiga: 'B20', traco: [1, 2, 4], ac: 0.60, uso: 'Massames, betão não estrutural' },
    { id: 'C20/25', antiga: 'B25', traco: [1, 2, 3], ac: 0.55, uso: 'Estrutura de moradia corrente' },
    { id: 'C25/30', antiga: 'B30', traco: [1, 1.5, 2.5], ac: 0.50, uso: 'Estrutura corrente' },
    { id: 'C30/37', antiga: 'B35', traco: [1, 1.5, 2], ac: 0.45, uso: 'Estrutura mais exigente' },
    { id: 'C35/45', antiga: 'B40', traco: [1, 1, 2], ac: 0.42, uso: 'Alta resistência (confirmar em laboratório)' },
    { id: 'C40/50', antiga: 'B45', traco: [1, 1, 1.5], ac: 0.40, uso: 'Alta resistência (confirmar em laboratório)' },
    { id: 'C45/55', antiga: 'B50', traco: [1, 1, 1.2], ac: 0.38, uso: 'Alta resistência (confirmar em laboratório)' }
  ];
}
function defBlocos(d) {
  return [
    { id: 'b10', nome: 'Bloco 10', comp: 40, alt: 20, esp: 10, junta: 1, preco: 28, data: d },
    { id: 'b15', nome: 'Bloco 15', comp: 40, alt: 20, esp: 15, junta: 1, preco: 35, data: d },
    { id: 'b20', nome: 'Bloco 20', comp: 40, alt: 20, esp: 20, junta: 1, preco: 45, data: d }
  ];
}
function defaults() {
  const d = hoje();
  return {
    versao: 2,
    precos: [
      { id: 'cimento', nome: 'Cimento (saco de 50 kg)', un: 'saco', preco: 550, data: d },
      { id: 'areia', nome: 'Areia', un: 'm³', preco: 1500, data: d },
      { id: 'brita', nome: 'Brita (pedra)', un: 'm³', preco: 3800, data: d },
      { id: 'aco', nome: 'Aço (varão)', un: 'kg', preco: 120, data: d },
      { id: 'agua', nome: 'Água', un: 'm³', preco: 60, data: d },
      { id: 'cofragem', nome: 'Cofragem (material, por utilização)', un: 'm²', preco: 300, data: d }
    ],
    mo: [
      { id: 'mo_betao', nome: 'Betão (fabrico e colocação)', un: 'm³', preco: 1500, data: d },
      { id: 'mo_cofr', nome: 'Cofragem (montar e desmontar)', un: 'm²', preco: 250, data: d },
      { id: 'mo_aco', nome: 'Armaduras (cortar, dobrar, montar)', un: 'kg', preco: 15, data: d },
      { id: 'mo_alv', nome: 'Alvenaria (assentamento)', un: 'm²', preco: 250, data: d },
      { id: 'mo_reb', nome: 'Reboco (por face)', un: 'm²', preco: 200, data: d }
    ],
    cfg: {
      empresa: { nome: '', nuit: '', tel: '', email: '', morada: '' },
      recibo: { proximo: 1 },
      proposta: {
        proximo: 1, validade: 30,
        prazo: '30 dias após o pagamento do sinal',
        inclui: 'Plantas de arquitetura de todos os pisos, cortes, alçados e implantação\nCálculo estrutural: fundações, pilares, vigas e lajes, com peças desenhadas\nImagens 3D (renders) do exterior\nUma revisão do projeto incluída',
        condicoes: '50 % na adjudicação (sinal)\n50 % na entrega do projeto'
      },
      honor: {
        fixo: 8000,
        escaloes: [{ ate: 150, preco: 180 }, { ate: 0, preco: 160 }],
        geminada: 50, minimo: 35000, arred: 500,
        servicos: [
          { id: 'completo', nome: 'Pacote completo (arquitetura, estruturas e 3D)', fator: 100 },
          { id: 'arq', nome: 'Só arquitetura', fator: 50 },
          { id: 'est', nome: 'Só cálculo estrutural', fator: 35 }
        ]
      },
      descontos: [
        { id: 'primeiro', nome: 'Primeiro projeto', pct: 10 },
        { id: 'habitual', nome: 'Cliente habitual', pct: 5 },
        { id: 'indicacao', nome: 'Indicação de outro cliente', pct: 5 }
      ],
      classes: defClasses(),
      betao: { seco: 1.54, dens: 1440 },
      argSeco: 1.27,
      aco: { sapata: 60, pilar: 150, viga: 130, laje: 90, outro: 80 },
      perdas: { betao: 5, aco: 10, blocos: 5, argamassa: 10 },
      saco: 50,
      assent: { traco: [1, 6] },
      reboco: { traco: [1, 4], esp: 1.5 },
      blocos: defBlocos(d),
      iva: 16,
      moM2: 3500
    },
    obras: []
  };
}

/* ---------- guardar / carregar ---------- */
function fixObra(o) {
  o.honor = Object.assign({ area: 0, casas: 1, servico: 'completo', desconto: '', descPct: 0, descValor: 0, descMotivo: '' }, o.honor || {});
  o.elementos = o.elementos || []; o.paredes = o.paredes || []; o.extras = o.extras || [];
  o.mo = Object.assign({ modo: 'm2', m2: 3500, diaria: { trab: 4, dias: 30, valor: 600 }, empreitada: 0 }, o.mo || {});
  o.mo.diaria = Object.assign({ trab: 4, dias: 30, valor: 600 }, o.mo.diaria || {});
  o.aberturas = o.aberturas || []; o.imgs = o.imgs || []; o.pagamentos = o.pagamentos || [];
  if (o.recibo) { // versão 0.2 (um só recibo) → lista de pagamentos
    const R = o.recibo;
    if (R.imgs && R.imgs.length && !o.imgs.length) o.imgs = R.imgs;
    if (R.desc && !o.descRecibo) o.descRecibo = R.desc;
    if (R.numero && !o.pagamentos.length) o.pagamentos.push({ id: uid(), numero: R.numero, data: R.data || hoje(), desc: '', valor: R.pago, forma: R.forma || 'Numerário', ref: R.ref || '' });
    delete o.recibo;
  }
  if (o.descRecibo == null) o.descRecibo = '';
  o.proposta = Object.assign({ numero: '', data: hoje(), validade: null, projeto: true, obra: false, quant: false, prazo: '', inclui: '', condicoes: '', prazoObra: '', notas: '' }, o.proposta || {});
  for (const k of ['tel', 'email', 'nuit']) if (o[k] == null) o[k] = '';
  if (o.margem == null) o.margem = 10;
  if (!o.classe) o.classe = 'C25/30';
  return o;
}
function migrate(o) {
  const d = defaults();
  o.cfg = Object.assign({}, d.cfg, o.cfg || {});
  for (const k of ['honor', 'perdas', 'aco', 'betao', 'recibo', 'proposta']) o.cfg[k] = Object.assign({}, d.cfg[k], o.cfg[k] || {});
  if (typeof o.cfg.empresa === 'string' || !o.cfg.empresa) o.cfg.empresa = Object.assign({}, d.cfg.empresa, { nome: o.cfg.empresa || '' });
  if (!(o.cfg.classes || []).every(c => Array.isArray(c.traco))) o.cfg.classes = defClasses();        // versão 0.1 → traços
  if (!o.cfg.assent || !Array.isArray(o.cfg.assent.traco)) o.cfg.assent = d.cfg.assent;
  if (!o.cfg.reboco || !Array.isArray(o.cfg.reboco.traco)) o.cfg.reboco = Object.assign({}, d.cfg.reboco, { esp: (o.cfg.reboco && o.cfg.reboco.esp) || 1.5 });
  o.cfg.blocos = (o.cfg.blocos || d.cfg.blocos).map(b => Object.assign({ comp: 40, alt: 20, junta: 1 }, b, { nome: b.nome.replace(/^Bloco de cimento (\d+) cm$/, 'Bloco $1') }));
  if (!Array.isArray(o.cfg.descontos)) o.cfg.descontos = d.cfg.descontos;
  for (const k of ['precos', 'mo']) { o[k] = o[k] || []; d[k].forEach(p => { if (!o[k].find(x => x.id === p.id)) o[k].push(p); }); }
  o.obras = (o.obras || []).map(fixObra);
  o.versao = 2;
  return o;
}
function loadState() {
  try { const t = localStorage.getItem(KEY); if (t) return migrate(JSON.parse(t)); } catch (e) { }
  return defaults();
}
// Depois de carregar: pagamentos antigos sem valor = valor total do projeto
function posMigrar() { for (const o of S.obras) for (const p of o.pagamentos) if (p.valor == null) p.valor = honor(o.honor).total; }
let tSave;
function guardarLocal() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Não foi possível guardar neste aparelho.'); } }
function saveNow() { clearTimeout(tSave); guardarLocal(); if (window.SYNC && SYNC.ativo && SYNC.ativo()) SYNC.push(); }
function save() { clearTimeout(tSave); tSave = setTimeout(saveNow, 250); }
const sincroniza = () => !!(window.SYNC && SYNC.ativo && SYNC.ativo());

/* Ligação ao módulo de sincronização (sync.js) */
let renderPendente = false;
function renderRemoto() {
  const a = document.activeElement;
  if (a && a.closest && a.closest('#app') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { renderPendente = true; refresh(); return; } // não interrompe quem está a escrever
  render();
}
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement;
  if (renderPendente && !(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { renderPendente = false; render(); }
}, 60));
function estadoSync() {
  const el = $('#sync'); if (!el) return;
  const Y = window.SYNC;
  if (!Y) { el.hidden = true; return; }
  el.hidden = false;
  const e = Y.estado ? Y.estado() : {};
  let cls = 'off', txt = 'Entrar';
  if (e.falhou) { cls = 'err'; txt = 'Sem sincronização'; }
  else if (e.email) {
    if (e.erro) { cls = 'err'; txt = 'Sem acesso'; }
    else if (!e.online) { cls = 'off'; txt = 'Sem internet'; }
    else if (e.pend || !e.verificado) { cls = 'pend'; txt = 'A sincronizar…'; }
    else { cls = 'ok'; txt = 'Sincronizado'; }
  }
  el.className = 'sync ' + cls; el.querySelector('span').textContent = txt;
  if (route()[0] === 'conta') renderRemoto();
}
window.APP = {
  S: () => S,
  remoto() { S = migrate(S); posMigrar(); guardarLocal(); renderRemoto(); },
  guardar: saveNow, renderRemoto, estadoSync, toast,
  imgLocal: k => IMG.get(k)
};
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

/* Imagens (renders) ficam no IndexedDB para não encher o armazenamento principal */
const IMG = {
  open() {
    if (!this.p) this.p = new Promise((res, rej) => { const r = indexedDB.open('pcorc', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return this.p;
  },
  async get(k) { try { const db = await this.open(); return await new Promise(res => { const q = db.transaction('img').objectStore('img').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } },
  async set(k, v, soLocal) { const db = await this.open(); await new Promise((res, rej) => { const t = db.transaction('img', 'readwrite'); t.objectStore('img').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); if (!soLocal && sincroniza()) SYNC.imgUp(k, v); },
  async del(k) { try { const db = await this.open(); db.transaction('img', 'readwrite').objectStore('img').delete(k); } catch (e) { } if (sincroniza()) SYNC.imgDel(k); }
};
async function hidratarImgs() {
  for (const el of document.querySelectorAll('img[data-img]')) {
    const id = el.dataset.img; let v = await IMG.get(id);
    if (!v && sincroniza()) { v = await SYNC.imgGet(id); if (v) IMG.set(id, v, true); }
    if (v) el.src = v; else (el.closest('.thumb, figure') || el).remove();
  }
}
function reduzirImagem(file, max = 1600, tipo = 'image/jpeg') {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      const g = c.getContext('2d'); if (tipo === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL(tipo, 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Imagem inválida')); };
    im.src = url;
  });
}

/* ---------- caminhos no estado ---------- */
function getP(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), S); }
function setP(path, v) { const ks = path.split('.'); let o = S; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
function removeAt(path) { const ks = path.split('.'); const i = +ks.pop(); const arr = getP(ks.join('.')); if (Array.isArray(arr)) arr.splice(i, 1); }

/* ---------- cálculos ---------- */
function honor(h) {
  const H = S.cfg.honor; const a = Math.max(0, +h.area || 0);
  let varP = 0, prev = 0; const det = [];
  for (let i = 0; i < H.escaloes.length; i++) {
    const e = H.escaloes[i]; const last = i === H.escaloes.length - 1;
    const lim = last ? Infinity : Math.max(prev, +e.ate || 0);
    const q = Math.max(0, Math.min(a, lim) - prev);
    if (q > 0) { varP += q * e.preco; det.push({ q, preco: +e.preco, v: q * e.preco }); }
    prev = lim; if (a <= lim) break;
  }
  const casas = Math.max(1, +h.casas || 1);
  const extra = (casas - 1) * varP * (+H.geminada || 0) / 100;
  const base = (+H.fixo || 0) + varP + extra;
  const serv = H.servicos.find(s => s.id === h.servico) || H.servicos[0] || { nome: '', fator: 100 };
  const comMin = Math.max(base, +H.minimo || 0);
  const arr = +H.arred || 0, arred = x => arr > 0 ? Math.round(x / arr) * arr : x;
  const antes = arred(comMin * (+serv.fator || 0) / 100);
  // desconto
  let dPct = 0, dVal = 0, dNome = '';
  if (h.desconto === 'outro') { dPct = +h.descPct || 0; dVal = +h.descValor || 0; dNome = h.descMotivo || 'Desconto'; }
  else if (h.desconto) { const p = S.cfg.descontos.find(x => x.id === h.desconto); if (p) { dPct = +p.pct || 0; dNome = p.nome; } }
  const desc = Math.min(antes, antes * dPct / 100 + dVal);
  const total = desc > 0 ? arred(antes - desc) : antes;
  return { a, varP, det, casas, extra, base, minimo: base < (+H.minimo || 0), serv, antes, desc: antes - total, dPct, dVal, dNome, total };
}

const TIPOS = {
  sapata: { t: 'Sapatas', add: 'Adicionar sapata', c: ['Comp. (m)', 'Larg. (m)', 'Alt. (m)'], pre: 'S', d: [1, 1, 0.4] },
  pilar: { t: 'Pilares', add: 'Adicionar pilar', c: ['a (m)', 'b (m)', 'Altura (m)'], pre: 'P', d: [0.2, 0.2, 3] },
  viga: { t: 'Vigas', add: 'Adicionar viga', c: ['Larg. (m)', 'Alt. (m)', 'Comp. (m)'], pre: 'V', d: [0.15, 0.3, 4] },
  laje: { t: 'Lajes', add: 'Adicionar laje', c: ['Área (m²)', 'Espessura (m)'], pre: 'L', d: [20, 0.12] },
  outro: { t: 'Outros elementos em betão', add: 'Adicionar elemento', c: ['Volume (m³)', 'Cofragem (m²)'], pre: 'E', d: [1, 0] }
};
function geomEl(e) {
  const x = +e.x || 0, y = +e.y || 0, z = +e.z || 0;
  switch (e.tipo) {
    case 'sapata': return { vol: x * y * z, cofr: 2 * (x + y) * z };
    case 'pilar': return { vol: x * y * z, cofr: 2 * (x + y) * z };
    case 'viga': return { vol: x * y * z, cofr: (x + 2 * y) * z };
    case 'laje': return { vol: x * y, cofr: x };
    default: return { vol: x, cofr: y };
  }
}
function dimTxt(e) {
  switch (e.tipo) {
    case 'sapata': return `${cm(e.x)} × ${cm(e.y)} cm, altura ${cm(e.z)} cm`;
    case 'pilar': return `${cm(e.x)} × ${cm(e.y)} cm, altura ${fmt(e.z, 2)} m`;
    case 'viga': return `${cm(e.x)} × ${cm(e.y)} cm, comprimento ${fmt(e.z, 2)} m`;
    case 'laje': return `${fmt(e.x, 2)} m², espessura ${cm(e.y)} cm`;
    default: return `${fmt(e.x, 2)} m³`;
  }
}
function geomPar(p) { const bruta = (+p.comp || 0) * (+p.alt || 0); return { bruta, liq: Math.max(0, bruta - (+p.vaos || 0)) }; }
const classe = id => S.cfg.classes.find(c => c.id === id) || S.cfg.classes[3] || S.cfg.classes[0];
const bloco = id => S.cfg.blocos.find(b => b.id === id) || S.cfg.blocos[0];
const preco = id => (S.precos.find(p => p.id === id) || { preco: 0 }).preco;

// Quantidades por m³ de betão a partir do traço em volume (método do volume seco)
function dosagem(cl) {
  const t = cl.traco || [1, 2, 3], soma = (+t[0] || 0) + (+t[1] || 0) + (+t[2] || 0) || 1;
  const vs = (+S.cfg.betao.seco || 1.54) / soma, dens = +S.cfg.betao.dens || 1440;
  const cim = vs * (+t[0] || 0) * dens;
  return { cim, areia: vs * (+t[1] || 0), brita: vs * (+t[2] || 0), agua: cim * (+cl.ac || 0.5) };
}
function dosArg(tr) {
  const soma = (+tr[0] || 0) + (+tr[1] || 0) || 1, vs = (+S.cfg.argSeco || 1.27) / soma;
  return { cim: vs * (+tr[0] || 0) * (+S.cfg.betao.dens || 1440), areia: vs * (+tr[1] || 0) };
}
// Blocos por m² e argamassa de assentamento a partir do tamanho do bloco e da junta
function blocoGeo(b) {
  const L = +b.comp || 40, H = +b.alt || 20, j = +b.junta || 0, e = +b.esp || 15;
  const porM2 = 10000 / ((L + j) * (H + j));
  const arg = e / 100 * (1 - (L * H) / ((L + j) * (H + j)));
  return { porM2, arg };
}

function calcObra(o) {
  const c = S.cfg, pd = c.perdas;
  const kB = 1 + pd.betao / 100, kA = 1 + pd.aco / 100, kBl = 1 + pd.blocos / 100, kArg = 1 + pd.argamassa / 100;
  const porClasse = {}; let vol = 0, cofr = 0, acoN = 0;
  for (const e of o.elementos) {
    if (e.incluir === false) continue;
    const g = geomEl(e), n = +e.n || 0, v = g.vol * n;
    vol += v; cofr += g.cofr * n; acoN += v * (+c.aco[e.tipo] || 0);
    const k = classe(e.classe).id; porClasse[k] = (porClasse[k] || 0) + v;
  }
  const classesR = Object.entries(porClasse).map(([id, v]) => {
    const cl = classe(id), ds = dosagem(cl), vv = v * kB;
    return { id, antiga: cl.antiga, traco: cl.traco, vol: v, volP: vv, cim: vv * ds.cim, areia: vv * ds.areia, brita: vv * ds.brita, agua: vv * ds.agua / 1000 };
  });
  let areaAlv = 0, areaReb = 0, argAss = 0; const porBloco = {};
  for (const p of o.paredes) {
    if (p.incluir === false) continue;
    const n = +p.n || 0, A = geomPar(p).liq * n, b = bloco(p.bloco), bg = blocoGeo(b);
    areaAlv += A; areaReb += A * (+p.faces || 0); argAss += A * bg.arg;
    const x = porBloco[b.id] || (porBloco[b.id] = { area: 0, un: 0, paredes: 0 });
    x.area += A; x.un += A * bg.porM2; x.paredes += n;
  }
  const argReb = areaReb * (+c.reboco.esp || 0) / 100;
  const dA = dosArg(c.assent.traco), dR = dosArg(c.reboco.traco);
  const ass = { vol: argAss * kArg, cim: argAss * kArg * dA.cim, areia: argAss * kArg * dA.areia };
  const reb = { vol: argReb * kArg, cim: argReb * kArg * dR.cim, areia: argReb * kArg * dR.areia };
  const cimB = classesR.reduce((a, x) => a + x.cim, 0);
  const cimKg = cimB + ass.cim + reb.cim;
  const saco = c.saco || 50;
  const sacos = Math.ceil(cimKg / saco - 1e-9);
  const areiaB = classesR.reduce((a, x) => a + x.areia, 0);
  const areia = areiaB + ass.areia + reb.areia;
  const brita = classesR.reduce((a, x) => a + x.brita, 0);
  const agua = classesR.reduce((a, x) => a + x.agua, 0);
  const aco = acoN * kA;
  const mat = [];
  const add = (nome, qtd, un, pu, nota) => { if (qtd > 0) mat.push({ nome, qtd, un, pu, tot: qtd * pu, nota }); };
  add('Cimento', sacos, 'sacos', preco('cimento'), fmt(cimKg, 0) + ' kg');
  add('Areia', Math.round(areia * 100) / 100, 'm³', preco('areia'));
  add('Brita', Math.round(brita * 100) / 100, 'm³', preco('brita'));
  add('Aço', Math.ceil(aco), 'kg', preco('aco'));
  add('Água', Math.round(agua * 100) / 100, 'm³', preco('agua'));
  add('Cofragem', Math.round(cofr * 100) / 100, 'm²', preco('cofragem'));
  for (const [id, q] of Object.entries(porBloco)) { const b = bloco(id); q.unP = Math.ceil(q.un * kBl - 1e-9); add(`${b.nome} (${cm(b.comp / 100)}×${cm(b.alt / 100)}×${cm(b.esp / 100)} cm)`, q.unP, 'un', +b.preco || 0); }
  const matTot = mat.reduce((a, x) => a + x.tot, 0);

  const area = +o.area || 0; let moL = [];
  switch (o.mo.modo) {
    case 'servicos':
      moL = [['mo_betao', vol], ['mo_cofr', cofr], ['mo_aco', acoN], ['mo_alv', areaAlv], ['mo_reb', areaReb]]
        .filter(([, q]) => q > 0).map(([id, q]) => { const m = S.mo.find(x => x.id === id) || { nome: id, un: '', preco: 0 }; return { nome: m.nome, qtd: q, un: m.un, pu: +m.preco || 0, tot: q * (+m.preco || 0) }; });
      break;
    case 'diaria': { const d = o.mo.diaria; const q = (+d.trab || 0) * (+d.dias || 0); moL = [{ nome: `${fmt(d.trab, 0)} trabalhadores × ${fmt(d.dias, 0)} dias`, qtd: q, un: 'dias', pu: +d.valor || 0, tot: q * (+d.valor || 0) }]; break; }
    case 'empreitada': moL = [{ nome: 'Empreitada (valor fechado)', qtd: 1, un: 'vg', pu: +o.mo.empreitada || 0, tot: +o.mo.empreitada || 0 }]; break;
    default: moL = [{ nome: 'Mão de obra por m² de construção', qtd: area, un: 'm²', pu: +o.mo.m2 || 0, tot: area * (+o.mo.m2 || 0) }];
  }
  const moTot = moL.reduce((a, x) => a + x.tot, 0);
  const ext = o.extras.map(x => ({ nome: x.nome || 'Outro custo', qtd: +x.qtd || 0, un: x.un || '', pu: +x.pu || 0, tot: (+x.qtd || 0) * (+x.pu || 0) }));
  const extTot = ext.reduce((a, x) => a + x.tot, 0);
  const ab = (o.aberturas || []).filter(x => x.incluir !== false).map(x => ({ nome: x.nome || (x.tipo === 'porta' ? 'Porta' : 'Janela'), qtd: +x.n || 0, un: 'un', pu: +x.preco || 0, tot: (+x.n || 0) * (+x.preco || 0) }));
  const abTot = ab.reduce((a, x) => a + x.tot, 0);
  // custo dos materiais separado em estrutura / alvenaria (para a proposta)
  const custoEstr = Math.min(matTot, cimB / saco * preco('cimento') + areiaB * preco('areia') + brita * preco('brita') + Math.ceil(aco) * preco('aco') + agua * preco('agua') + cofr * preco('cofragem'));
  const custoAlv = Math.max(0, matTot - custoEstr);
  const sub = matTot + moTot + extTot + abTot;
  const margem = sub * (+o.margem || 0) / 100;
  const semIva = sub + margem;
  const iva = o.iva ? semIva * (+c.iva || 0) / 100 : 0;
  const total = semIva + iva;
  return { vol, cofr, acoN, aco, classesR, cimB, areiaB, areaAlv, areaReb, porBloco, ass, reb, cimKg, sacos, areia, brita, agua, mat, matTot, moL, moTot, ext, extTot, ab, abTot, custoEstr, custoAlv, sub, margem, semIva, iva, total, porM2: area > 0 ? total / area : 0, area };
}
function gruposEl(list) {
  const m = new Map();
  for (const e of list) {
    if (e.incluir === false) continue;
    const cl = classe(e.classe).id;
    const k = [e.tipo, (+e.x || 0).toFixed(3), (+e.y || 0).toFixed(3), (+e.z || 0).toFixed(3), cl].join('|');
    let g = m.get(k); if (!g) m.set(k, g = { e, cl, n: 0, vol: 0, cofr: 0, pisos: new Set() });
    const n = +e.n || 0, gg = geomEl(e); g.n += n; g.vol += gg.vol * n; g.cofr += gg.cofr * n; if (e.piso) g.pisos.add(e.piso);
  }
  return [...m.values()].sort((a, b) => b.vol - a.vol);
}

// Quantidades separadas por piso (para comprar por fases)
function calcPisos(o) {
  const nomes = []; const add = p => { const k = p || ''; if (!nomes.includes(k)) nomes.push(k); };
  o.elementos.forEach(e => { if (e.incluir !== false) add(e.piso); });
  o.paredes.forEach(p => { if (p.incluir !== false) add(p.piso); });
  return nomes.map(p => ({ piso: p || 'Sem piso', r: calcObra(Object.assign({}, o, { elementos: o.elementos.filter(e => (e.piso || '') === p), paredes: o.paredes.filter(x => (x.piso || '') === p), extras: [], aberturas: [] })) }));
}
const totalPago = o => o.pagamentos.reduce((a, p) => a + (+p.valor || 0), 0);
function proximoNum(k, pre = '') { const c = S.cfg[k]; const n = Math.max(1, +c.proximo || 1); c.proximo = n + 1; return `${pre}${String(n).padStart(4, '0')}/${hoje().slice(0, 4)}`; }
function dataMais(d, dias) { const t = new Date((d || hoje()) + 'T12:00:00'); t.setDate(t.getDate() + (+dias || 0)); return t.toISOString().slice(0, 10); }
const linhas = s => String(s || '').split('\n').map(x => x.replace(/^[\s•\-–]+/, '').trim()).filter(Boolean);
const ou = (v, d) => (v != null && String(v).trim() !== '') ? v : d;

/* ---------- controlos ---------- */
function inp(path, { num = true, cls = '', ph = '', id = '', nul = false } = {}) {
  const v = getP(path);
  return `<input class="${cls}" data-b="${path}" ${num ? 'data-n inputmode="decimal"' : ''} ${nul ? 'data-z' : ''} value="${esc(num ? numIn(v) : (v ?? ''))}" placeholder="${esc(ph)}" ${id ? `id="${id}"` : ''}>`;
}
function sel(path, opts, num = false) {
  const v = String(getP(path));
  return `<select data-b="${path}" ${num ? 'data-n' : ''}>${opts.map(([k, t]) => `<option value="${esc(k)}" ${v === String(k) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
}
const chk = path => `<input type="checkbox" data-b="${path}" ${getP(path) !== false ? 'checked' : ''} aria-label="Incluir">`;
const fld = (label, ctrl, hint = '', cls = '') => `<label class="f ${cls}"><span>${label}</span>${ctrl}${hint ? `<small>${hint}</small>` : ''}</label>`;
const classOpts = () => S.cfg.classes.map(c => [c.id, `${c.id} · ${c.antiga} · ${traco(c.traco)}`]);
const blocoOpts = () => S.cfg.blocos.map(b => [b.id, `${b.nome} (${fmtA(b.comp)}×${fmtA(b.alt)}×${fmtA(b.esp)})`]);
const tracoIn = (path, n) => `<span class="tr">${Array.from({ length: n }, (_, k) => inp(`${path}.${k}`, { cls: 'w-t' })).join('<b>:</b>')}</span>`;
const FORMAS = ['Numerário', 'M-Pesa', 'e-Mola', 'mKesh', 'Transferência bancária', 'Depósito bancário', 'Cheque', 'POS / cartão'];

/* ---------- vistas ---------- */
function route() { return location.hash.replace(/^#\/?/, '').split('/'); }
function curIdx() { const [v, id] = route(); return v === 'obra' ? S.obras.findIndex(o => o.id === id) : -1; }
function curObra() { const i = curIdx(); return i >= 0 ? S.obras[i] : null; }

function render() {
  const [v, id, tab, extra] = route(); outs = null; let html;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === (v === 'obra' ? '' : (v || ''))));
  document.body.classList.toggle('modo-doc', v === 'obra' && (tab === 'recibo' || tab === 'propdoc'));
  if (v === 'obra') {
    const i = S.obras.findIndex(o => o.id === id);
    if (i < 0) { location.hash = '#/'; return; }
    html = tab === 'recibo' ? vRecibo(S.obras[i], extra) : tab === 'propdoc' ? vProposta(S.obras[i]) : vObra(i, tab || 'dados');
  } else if (v === 'precos') html = vPrecos();
  else if (v === 'definicoes') html = vDef();
  else if (v === 'conta') html = vConta();
  else html = vObras();
  $('#app').innerHTML = html;
  refresh(); hidratarImgs();
}
function refresh() {
  if (!outs) return; const m = outs();
  document.querySelectorAll('[data-o]').forEach(el => { const k = el.dataset.o; if (k in m) el.textContent = m[k]; });
  document.querySelectorAll('[data-oh]').forEach(el => { const k = el.dataset.oh; if (k in m) el.innerHTML = m[k]; });
}
function chain(extra) { const b = outs; outs = () => Object.assign(b ? b() : {}, extra()); }
const det = (k, titulo, corpo, abertoPorDefeito) => `<details data-k="${k}" ${abertos.has(k) || (abertoPorDefeito && !abertos.has('!' + k)) ? 'open' : ''}><summary>${titulo}</summary>${corpo}</details>`;

function vObras() {
  const list = S.obras.slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  return `<div class="head"><h1>Obras</h1><button class="btn" data-act="nova">+ Nova obra</button></div>
  ${info('Cada obra tem o seu orçamento: <b>honorários do projeto</b>, <b>estrutura</b> (betão), <b>alvenaria</b> (blocos), <b>mão de obra</b> e um <b>resumo</b> com o total. Toque numa obra para a abrir.')}
  ${list.length ? `<div class="cards">${list.map(o => {
    const r = calcObra(o), h = honor(o.honor);
    return `<a class="card" href="#/obra/${o.id}/dados"><b>${esc(o.nome || 'Sem nome')}</b><span>${esc([o.cliente, o.local].filter(Boolean).join(' · ') || 'Sem cliente')} · ${fData(o.data)}</span>
      <div class="kv"><span>Obra</span><b>${mt0(r.total)}</b></div>
      <div class="kv"><span>Projeto</span><b>${h.a > 0 ? mt0(h.total) : '—'}</b></div>
      ${o.pagamentos.length ? (() => { const f = h.total - totalPago(o); return `<div class="kv"><span>Pagamentos</span><b>${f > 0 ? 'falta ' + mt0(f) : 'pago'}</b></div>`; })() : ''}</a>`;
  }).join('')}</div>` : `<div class="box empty"><p><b>Ainda não há obras.</b></p><p>Crie a primeira para calcular honorários, betão, alvenaria e o custo total.</p></div>`}
  <section class="box"><h2>Cópia de segurança e partilha</h2>
  <p class="muted">Os dados ficam guardados neste aparelho. Para passar para outro aparelho ou para o seu sócio, exporte o ficheiro e importe-o no outro lado.</p>
  <div class="row"><button class="btn sec" data-act="exportar">Exportar dados</button><button class="btn sec" data-act="importar">Importar dados</button></div></section>
  <p class="muted small">PC Orçamentos ${VERSAO}</p>`;
}

const TABS = [['dados', 'Dados'], ['projeto', 'Projeto'], ['estrutura', 'Estrutura'], ['alvenaria', 'Alvenaria'], ['mo', 'Mão de obra'], ['resumo', 'Resumo'], ['proposta', 'Proposta']];
function vObra(i, tab) {
  const o = S.obras[i], P = `obras.${i}`;
  outs = () => ({ titulo: o.nome || 'Sem nome', total: mt0(calcObra(o).total) });
  const mt_ = sincroniza() && SYNC.meta(o.id);
  const alt = mt_ && mt_.por ? `<small class="muted">Última alteração: ${esc(mt_.por)}${mt_.em ? ' · ' + mt_.em.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</small>` : '';
  const head = `<div class="head"><div><a href="#/" class="back">← Obras</a><h1 data-o="titulo"></h1>${alt}</div><div class="tot"><small>Total da obra</small><b data-o="total"></b></div></div>`;
  const tabs = `<nav class="tabs">${TABS.map(([k, t]) => `<a href="#/obra/${o.id}/${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</nav>`;
  const f = { dados: tDados, projeto: tProjeto, estrutura: tEstrutura, alvenaria: tAlvenaria, mo: tMO, resumo: tResumo, proposta: tProposta }[tab] || tDados;
  return head + tabs + f(o, P);
}

/* --- Dados + recibo --- */
function tDados(o, P) {
  chain(() => { const h = honor(o.honor), pago = totalPago(o); return { rProj: h.a > 0 ? mt0(h.total) : '—', rPago: mt0(pago), rFalta: mt0(Math.max(0, h.total - pago)) }; });
  return `${info('Aqui ficam os <b>dados do cliente e da obra</b>, os <b>pagamentos com os seus recibos</b> e as imagens do projeto. A área de construção serve para o custo por m² e para a mão de obra.')}
  <section class="box"><h2>Cliente e obra</h2><div class="grid2">
  ${fld('Nome da obra', inp(P + '.nome', { num: false }))}
  ${fld('Cliente', inp(P + '.cliente', { num: false }))}
  ${fld('Telefone / WhatsApp', inp(P + '.tel', { num: false, ph: '+258 …' }))}
  ${fld('Email', inp(P + '.email', { num: false }))}
  ${fld('NUIT do cliente', inp(P + '.nuit', { num: false }))}
  ${fld('Local / morada da obra', inp(P + '.local', { num: false }))}
  ${fld('Data', `<input type="date" data-b="${P}.data" value="${esc(o.data)}">`)}
  ${fld('Área de construção (m²)', inp(P + '.area'), 'Usada no custo por m² e na mão de obra por m².')}
  ${fld('Classe de betão por defeito', sel(P + '.classe', classOpts()), 'Para os elementos novos e os importados do IFC.')}
  ${fld('Margem / lucro da obra (%)', inp(P + '.margem'))}
  <label class="f chk"><input type="checkbox" data-b="${P}.iva" ${o.iva ? 'checked' : ''}><span>Somar IVA (${fmt(S.cfg.iva, 0)} %) ao orçamento da obra</span></label>
  <label class="f full"><span>Notas</span><textarea data-b="${P}.notas">${esc(o.notas)}</textarea></label>
  </div></section>

  <section class="box"><h2>Pagamentos e recibos</h2>
  <p class="muted small">Registe cada pagamento do cliente (sinal, prestações, pagamento final). Cada pagamento tem o seu recibo, com número próprio, que pode imprimir, guardar em PDF ou enviar.</p>
  <div class="totals" style="margin-bottom:12px"><div><small>Valor do projeto</small><b data-o="rProj"></b></div><div><small>Já pago</small><b data-o="rPago"></b></div><div><small>Em falta</small><b data-o="rFalta" style="color:var(--blue)"></b></div></div>
  ${o.pagamentos.length ? `<div class="tw"><table><thead><tr><th>Recibo nº</th><th></th><th>Data</th><th>Descrição</th><th>Valor (MT)</th><th>Forma</th><th>Referência</th><th></th></tr></thead><tbody>
  ${o.pagamentos.map((p, j) => { const Q = `${P}.pagamentos.${j}`; return `<tr><td>${p.numero ? `<b>${esc(p.numero)}</b>` : '<span class="muted small" title="Recebe o número quando houver internet">provisório</span>'}</td><td><a class="btn sec sm0" href="#/obra/${o.id}/recibo/${p.id}">Ver recibo</a></td><td><input type="date" data-b="${Q}.data" value="${esc(p.data)}"></td><td>${inp(Q + '.desc', { num: false, cls: 'w-n', ph: 'Ex.: Sinal (50 %)' })}</td><td>${inp(Q + '.valor', { cls: 'w-d' })}</td><td>${sel(Q + '.forma', FORMAS.map(x => [x, x]))}</td><td>${inp(Q + '.ref', { num: false, cls: 'w-p', ph: 'Opcional' })}</td><td><button class="ic" data-act="delPag" data-id="${p.id}" aria-label="Apagar pagamento">×</button></td></tr>`; }).join('')}
  </tbody></table></div>` : '<p class="muted">Ainda não há pagamentos.</p>'}
  <button class="btn sm" data-act="addPag">+ Registar pagamento</button>
  <label class="f full" style="margin-top:14px"><span>Texto do recibo: "referente a…"</span><textarea data-b="${P}.descRecibo" placeholder="${esc(descRecibo(o, true))}">${esc(o.descRecibo)}</textarea><small>Vazio = texto automático (mostrado a cinzento).</small></label>
  </section>

  <section class="box"><h2>Imagens do projeto (opcional)</h2>
  <p class="muted small">Até 4 renders ou plantas. Aparecem na proposta (a primeira em destaque) e nos recibos.</p>
  <div class="thumbs">${o.imgs.map(id => `<div class="thumb"><img data-img="${id}" alt="Render"><button class="ic" data-act="delImg" data-id="${id}" aria-label="Remover imagem">×</button></div>`).join('')}
  ${o.imgs.length < 4 ? `<button class="thumb add" data-act="addImg">+ Imagem</button>` : ''}</div>
  </section>
  <div class="row end"><button class="btn sec" data-act="duplicarObra">Duplicar obra</button><button class="btn danger" data-act="apagarObra">Apagar obra</button></div>`;
}
function descRecibo(o, auto) {
  if (!auto && o.descRecibo) return o.descRecibo;
  const h = honor(o.honor);
  return `${h.serv.nome} — ${o.nome || 'obra'}${o.local ? ', ' + o.local : ''} (${fmtA(h.a)} m²${h.casas > 1 ? `, ${h.casas} casas iguais` : ''})`;
}
function docHead(tipo, numero, data) {
  const E = S.cfg.empresa;
  return `<header class="doc-h"><div>${E.logo ? `<img class="doc-logo" data-img="${esc(E.logo)}" alt="${esc(E.nome || 'Logotipo')}">` : ''}${E.nome || !E.logo ? `<b class="doc-emp">${esc(E.nome || 'O seu nome / empresa')}</b>` : ''}
      <div class="doc-c">${[E.nuit && 'NUIT ' + esc(E.nuit), esc(E.tel), esc(E.email), esc(E.morada)].filter(Boolean).join(' · ')}</div></div>
      <div class="doc-n"><span>${tipo}</span><b>Nº ${esc(numero || 'PROVISÓRIO')}</b><small>${fData(data)}</small></div></header>`;
}
const docAviso = () => `<p class="muted small noprint">Para enviar em PDF: toque em "Imprimir / guardar PDF" e escolha <b>Guardar como PDF</b> (no iPhone: partilhar → Guardar em Ficheiros). Depois envie o PDF.${S.cfg.empresa.nome ? '' : ' Os dados da sua empresa preenchem-se em <a href="#/definicoes">Definições</a>.'}</p>`;
function contaPag(o, p) {
  const h = honor(o.honor), idx = o.pagamentos.indexOf(p);
  const antes = o.pagamentos.slice(0, idx).reduce((a, x) => a + (+x.valor || 0), 0), valor = +p.valor || 0;
  return { h, antes, valor, pagoAte: antes + valor, falta: Math.max(0, h.total - antes - valor) };
}
function vRecibo(o, pid) {
  const p = o.pagamentos.find(x => x.id === pid);
  if (!p) return `<div class="box"><p>Este pagamento já não existe.</p><a class="btn" href="#/obra/${o.id}/dados">Voltar</a></div>`;
  const E = S.cfg.empresa, { h, antes, valor, pagoAte, falta } = contaPag(o, p);
  return `<div class="bar noprint"><a href="#/obra/${o.id}/dados" class="btn sec">← Voltar</a><button class="btn" data-act="imprimir">Imprimir / guardar PDF</button><button class="btn sec" data-act="partilharRecibo" data-id="${p.id}">Enviar por WhatsApp / email</button></div>
  ${docAviso()}
  <article class="doc">
    ${docHead('RECIBO', p.numero, p.data)}
    <p class="doc-p">Recebemos de <b>${esc(o.cliente || '—')}</b>${o.nuit ? `, NUIT ${esc(o.nuit)}` : ''}, a quantia de <b>${mt(valor)}</b> (${esc(extenso(valor))}), referente a: ${esc(descRecibo(o))}${p.desc ? ' — ' + esc(p.desc) : ''}.</p>
    <table class="doc-t"><tbody>
      <tr><td>Cliente</td><td>${esc(o.cliente || '—')}</td></tr>
      ${o.tel ? `<tr><td>Telefone</td><td>${esc(o.tel)}</td></tr>` : ''}${o.email ? `<tr><td>Email</td><td>${esc(o.email)}</td></tr>` : ''}
      <tr><td>Obra</td><td>${esc(o.nome)}${o.local ? ' — ' + esc(o.local) : ''}</td></tr>
      <tr><td>Serviço</td><td>${esc(h.serv.nome)}</td></tr>
      <tr><td>Área</td><td>${fmtA(h.a)} m²${h.casas > 1 ? ` × ${h.casas} casas iguais` : ''}</td></tr>
    </tbody></table>
    <table class="doc-t doc-v"><tbody>
      ${h.desc > 0 ? `<tr><td>Valor do projeto</td><td>${mt(h.antes)}</td></tr><tr><td>Desconto — ${esc(h.dNome)}${h.dPct ? ` (${fmtA(h.dPct)} %)` : ''}</td><td>− ${mt(h.desc)}</td></tr>` : ''}
      <tr class="s"><td>Valor total do projeto</td><td>${mt(h.total)}</td></tr>
      ${antes > 0 ? `<tr><td>Pago anteriormente</td><td>${mt(antes)}</td></tr>` : ''}
      <tr><td>Este pagamento (${esc(p.forma)}${p.ref ? ', ref. ' + esc(p.ref) : ''})</td><td>${mt(valor)}</td></tr>
      ${antes > 0 ? `<tr><td>Total pago</td><td>${mt(pagoAte)}</td></tr>` : ''}
      <tr class="${falta > 0 ? 's' : ''}"><td>${falta > 0 ? 'Em falta' : 'Situação'}</td><td>${falta > 0 ? mt(falta) : 'Pago na totalidade'}</td></tr>
    </tbody></table>
    ${o.imgs.length ? `<div class="doc-imgs n${Math.min(o.imgs.length, 4)}">${o.imgs.map(id => `<figure><img data-img="${id}" alt="Render do projeto"></figure>`).join('')}</div>` : ''}
    <footer class="doc-f"><div class="ass"><span></span><small>${esc(E.nome || 'Assinatura')}</small></div><div class="ass"><span></span><small>O cliente</small></div></footer>
    <p class="doc-r">Recibo ${esc(p.numero || '')}</p>
  </article>`;
}

/* --- Proposta --- */
function tProposta(o, P) {
  const Pr = o.proposta, D = S.cfg.proposta;
  chain(() => { const v = ou(Pr.validade, D.validade); return { pVal: `${fData(dataMais(Pr.data, v))} (${fmtA(+v)} dias)` }; });
  const cb = (k, t) => `<label class="f chk"><input type="checkbox" data-b="${P}.proposta.${k}" ${Pr[k] ? 'checked' : ''}><span>${t}</span></label>`;
  return `${info('<b>Proposta:</b> o documento que envia ao cliente <b>antes</b> de ele aceitar, com o valor do projeto e/ou da obra, o que está incluído, o prazo e as condições de pagamento. Os campos vazios usam os textos padrão (mostrados a cinzento), que se mudam em Definições.')}
  <section class="box"><h2>O que entra na proposta</h2><div class="grid2">
  ${cb('projeto', 'Honorários do projeto')}${cb('obra', 'Orçamento da obra (construção)')}${Pr.obra ? cb('quant', 'Mostrar as quantidades de materiais') : ''}
  </div></section>
  <section class="box"><h2>Dados da proposta</h2><div class="grid2">
  ${fld('Nº da proposta', inp(P + '.proposta.numero', { num: false, ph: 'Atribuído ao abrir a proposta' }))}
  ${fld('Data', `<input type="date" data-b="${P}.proposta.data" value="${esc(Pr.data)}">`)}
  ${fld('Validade (dias)', inp(P + '.proposta.validade', { nul: true, ph: numIn(D.validade) }), 'Válida até <span data-o="pVal"></span>')}
  ${Pr.projeto ? fld('Prazo de entrega do projeto', inp(P + '.proposta.prazo', { num: false, ph: D.prazo })) : ''}
  ${Pr.obra ? fld('Prazo da obra (opcional)', inp(P + '.proposta.prazoObra', { num: false, ph: 'Ex.: 6 meses' })) : ''}
  ${Pr.projeto ? `<label class="f full"><span>O projeto inclui (uma linha por item)</span><textarea data-b="${P}.proposta.inclui" placeholder="${esc(D.inclui)}" rows="4">${esc(Pr.inclui)}</textarea></label>` : ''}
  <label class="f full"><span>Condições de pagamento (uma linha por item)</span><textarea data-b="${P}.proposta.condicoes" placeholder="${esc(D.condicoes)}" rows="3">${esc(Pr.condicoes)}</textarea></label>
  <label class="f full"><span>Notas (opcional)</span><textarea data-b="${P}.proposta.notas" rows="2">${esc(Pr.notas)}</textarea></label>
  </div></section>
  ${!Pr.projeto && !Pr.obra ? '<div class="warn" style="margin-bottom:14px">Escolha pelo menos uma parte para a proposta.</div>' : ''}
  <div class="row"><a class="btn" href="#/obra/${o.id}/propdoc" data-act="abrirProposta">Abrir proposta</a></div>`;
}
function linhasObra(o, r) {
  const k = 1 + (+o.margem || 0) / 100; // a margem fica distribuída pelas linhas
  return [['Estrutura em betão (materiais)', r.custoEstr], ['Alvenaria e reboco (materiais)', r.custoAlv], ['Portas e janelas', r.abTot], ['Mão de obra', r.moTot], ...r.ext.map(x => [x.nome, x.tot])]
    .filter(x => x[1] > 0).map(([n, v]) => [n, v * k]);
}
function vProposta(o) {
  const E = S.cfg.empresa, Pr = o.proposta, D = S.cfg.proposta, h = honor(o.honor), r = calcObra(o);
  const val = ou(Pr.validade, D.validade), ate = dataMais(Pr.data, val);
  let n = 0; const sec = t => `<h3 class="doc-s">${++n}. ${t}</h3>`;
  const projeto = Pr.projeto ? `${sec('Projeto')}
    <table class="doc-t"><tbody>
      <tr><td>Serviço</td><td>${esc(h.serv.nome)}</td></tr>
      <tr><td>Área a construir</td><td>${fmtA(h.a)} m²${h.casas > 1 ? ` × ${h.casas} casas iguais` : ''}</td></tr>
      <tr><td>Prazo de entrega</td><td>${esc(ou(Pr.prazo, D.prazo))}</td></tr>
      <tr><td>Inclui</td><td><ul>${linhas(ou(Pr.inclui, D.inclui)).map(x => `<li>${esc(x)}</li>`).join('')}</ul></td></tr>
    </tbody></table>
    <table class="doc-t doc-v"><tbody>
      ${h.desc > 0 ? `<tr><td>Valor do projeto</td><td>${mt(h.antes)}</td></tr><tr><td>Desconto — ${esc(h.dNome)}${h.dPct ? ` (${fmtA(h.dPct)} %)` : ''}</td><td>− ${mt(h.desc)}</td></tr>` : ''}
      <tr class="s big"><td>Total do projeto</td><td>${mt(h.total)}</td></tr>
    </tbody></table>` : '';
  const obra = Pr.obra ? `${sec('Orçamento da obra')}
    <table class="doc-t doc-v"><tbody>
      ${linhasObra(o, r).map(([nm, v]) => `<tr><td>${esc(nm)}</td><td>${mt(v)}</td></tr>`).join('')}
      ${o.iva ? `<tr><td>IVA (${fmt(S.cfg.iva, 0)} %)</td><td>${mt(r.iva)}</td></tr>` : ''}
      <tr class="s big"><td>Valor da obra${o.iva ? ' (com IVA)' : ''}</td><td>${mt(r.total)}</td></tr>
      ${r.area > 0 ? `<tr><td>Custo por m² (${fmtA(r.area)} m²)</td><td>${mt(r.porM2)}</td></tr>` : ''}
      ${Pr.prazoObra ? `<tr><td>Prazo da obra</td><td>${esc(Pr.prazoObra)}</td></tr>` : ''}
    </tbody></table>
    ${Pr.quant && r.mat.length ? `<p class="doc-mini"><b>Principais materiais:</b> ${r.mat.map(m => `${esc(m.nome)} ${fmt(m.qtd, m.un === 'un' || m.un === 'sacos' || m.un === 'kg' ? 0 : 2)} ${esc(m.un)}`).join(' · ')}</p>` : ''}
    <p class="doc-mini">Valores estimados com os preços de mercado à data da proposta; podem variar com o preço dos materiais.</p>` : '';
  const imgs = o.imgs;
  return `<div class="bar noprint"><a href="#/obra/${o.id}/proposta" class="btn sec">← Voltar</a><button class="btn" data-act="imprimir">Imprimir / guardar PDF</button><button class="btn sec" data-act="partilharProposta">Enviar por WhatsApp / email</button></div>
  ${docAviso()}
  <article class="doc">
    ${docHead('PROPOSTA', Pr.numero, Pr.data)}
    <p class="doc-p">Exmo.(a) Sr.(a) <b>${esc(o.cliente || 'Cliente')}</b>,<br>apresentamos a nossa proposta para <b>${esc(o.nome)}</b>${o.local ? `, em ${esc(o.local)}` : ''}.</p>
    ${imgs.length ? `<figure class="doc-hero"><img data-img="${imgs[0]}" alt="Render do projeto"></figure>` : ''}
    ${projeto}${obra}
    ${sec('Condições')}
    <ul class="doc-ul">${linhas(ou(Pr.condicoes, D.condicoes)).map(x => `<li>${esc(x)}</li>`).join('')}
      <li>Proposta válida até ${fData(ate)} (${fmtA(+val)} dias).</li>
      ${linhas(Pr.notas).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${imgs.length > 1 ? `<div class="doc-imgs n${Math.min(imgs.length - 1, 4)}">${imgs.slice(1).map(id => `<figure><img data-img="${id}" alt="Render do projeto"></figure>`).join('')}</div>` : ''}
    <footer class="doc-f"><div class="ass"><span></span><small>${esc(E.nome || 'Assinatura')}</small></div><div class="ass"><span></span><small>Aceito a proposta — o cliente, data ___/___/______</small></div></footer>
    <p class="doc-r">Proposta ${esc(Pr.numero || '')}</p>
  </article>`;
}

/* --- Projeto --- */
function tabHonor(h) {
  const H = S.cfg.honor; const L = [[`Valor fixo por projeto`, mt0(H.fixo)]];
  h.det.forEach((d, i) => L.push([`${fmtA(d.q)} m² × ${fmt(d.preco, 0)} MT/m²${i === 0 && h.det.length > 1 ? ' (primeiros m²)' : i > 0 ? ' (m² seguintes)' : ''}`, mt0(d.v)]));
  if (h.casas > 1) L.push([`${h.casas - 1} casa(s) igual(is) a mais, a ${fmt(H.geminada, 0)} % da parte por m²`, mt0(h.extra)]);
  if (h.minimo) L.push([`Fica abaixo do mínimo, cobra-se o mínimo`, mt0(H.minimo)]);
  if (+h.serv.fator !== 100) L.push([`${h.serv.nome}: ${fmt(h.serv.fator, 0)} % do pacote`, '']);
  L.push([`Valor do projeto${+H.arred > 0 ? ` (arredondado a ${mt0(H.arred)})` : ''}`, mt0(h.antes), 's']);
  if (h.desc > 0) L.push([`Desconto — ${h.dNome}${h.dPct ? ` (${fmtA(h.dPct)} %)` : ''}${h.dVal ? ` + ${mt0(h.dVal)}` : ''}`, '− ' + mt0(h.desc), 'd']);
  L.push(['Total a cobrar', mt0(h.total), 't']);
  return `<table class="sum"><tbody>${L.map(([a, b, c]) => `<tr class="${c || ''}"><td>${esc(a)}</td><td>${b}</td></tr>`).join('')}</tbody></table>`;
}
function tProjeto(o, P) {
  const H = S.cfg.honor, E = H.escaloes;
  chain(() => { const h = honor(o.honor); return { hTot: h.a > 0 ? mt0(h.total) : '—', hTab: h.a > 0 ? tabHonor(h) : '<p class="muted">Indique a área para ver o cálculo.</p>' }; });
  const escTxt = E.map((e, i) => i === E.length - 1 ? (E.length > 1 ? `${fmt(e.preco, 0)} MT/m² acima de ${fmtA(E[i - 1].ate)} m²` : `${fmt(e.preco, 0)} MT/m²`) : `${fmt(e.preco, 0)} MT/m² até ${fmtA(e.ate)} m²`).join(', ');
  const ds = o.honor.desconto;
  return `${info(`<b>Como se calcula:</b> o valor do projeto depende da <b>área a construir</b>. Soma-se um valor fixo de ${mt0(H.fixo)} com um preço por cada m² (${escTxt}). Casas iguais lado a lado (geminadas) pagam só ${fmt(H.geminada, 0)} % por cada casa a mais. Se o resultado ficar abaixo de ${mt0(H.minimo)}, cobra-se esse mínimo.`)}
  <section class="box"><h2>1. Área e serviço</h2><div class="grid2">
  ${fld('Área a construir, por casa (m²)', inp(P + '.honor.area'), +o.area ? `<button type="button" class="link" data-act="areaObra">Usar a área da obra (${fmtA(o.area)} m²)</button>` : '')}
  ${fld('Casas iguais (geminadas)', sel(P + '.honor.casas', [1, 2, 3, 4, 5, 6, 8, 10].map(n => [n, n === 1 ? '1 casa' : n + ' casas']), true), `Cada casa a mais paga ${fmt(H.geminada, 0)} % da parte por m².`)}
  ${fld('Serviço', sel(P + '.honor.servico', H.servicos.map(s => [s.id, `${s.nome} (${fmt(s.fator, 0)} %)`])))}
  </div></section>
  <section class="box"><h2>2. Desconto (opcional)</h2>
  <p class="muted small">Para conversar com o cliente: escolha um motivo e o desconto entra no valor e no recibo. Os motivos e percentagens editam-se em Definições.</p>
  <div class="grid2">${fld('Desconto', sel(P + '.honor.desconto', [['', 'Sem desconto'], ...S.cfg.descontos.map(d => [d.id, `${d.nome} (${fmtA(d.pct)} %)`]), ['outro', 'Outro desconto…']]))}
  ${ds === 'outro' ? fld('Motivo', inp(P + '.honor.descMotivo', { num: false, ph: 'Ex.: pagamento a pronto' })) + fld('Percentagem (%)', inp(P + '.honor.descPct')) + fld('Ou valor fixo (MT)', inp(P + '.honor.descValor')) : ''}
  </div></section>
  <section class="box res"><small>Honorários do projeto</small><b class="big" data-o="hTot"></b><div data-oh="hTab"></div></section>
  <div class="row"><a class="btn sec" href="#/obra/${o.id}/proposta">Fazer a proposta</a><a class="btn sec" href="#/obra/${o.id}/dados">Pagamentos e recibos</a></div>`;
}

/* --- Estrutura --- */
function matEstr(r) {
  const s = S.cfg.saco || 50;
  return `<div class="totals">
    <div><small>Betão (sem perdas)</small><b>${fmt(r.vol, 2)} m³</b></div>
    <div><small>Cimento</small><b>${fmt(Math.ceil(r.cimB / s - 1e-9), 0)} sacos</b><small>${fmt(r.cimB, 0)} kg</small></div>
    <div><small>Areia</small><b>${fmt(r.areiaB, 2)} m³</b></div>
    <div><small>Brita (pedra)</small><b>${fmt(r.brita, 2)} m³</b></div>
    <div><small>Água</small><b>${fmt(r.agua * 1000, 0)} L</b></div>
    <div><small>Aço (estimativa)</small><b>${fmt(Math.ceil(r.aco), 0)} kg</b></div>
    <div><small>Cofragem</small><b>${fmt(r.cofr, 2)} m²</b></div>
  </div><p class="muted small" style="margin:10px 0 0">Com ${fmt(S.cfg.perdas.betao, 0)} % de perdas no betão e ${fmt(S.cfg.perdas.aco, 0)} % no aço.</p>`;
}
function tabGrupos(list) {
  const G = gruposEl(list);
  if (!G.length) return '<p class="muted small">Nada incluído.</p>';
  return `<div class="tw"><table class="sum grp"><thead><tr><th>Qtd</th><th>Dimensões</th><th>Classe · traço</th><th>Pisos</th><th class="num">Betão</th></tr></thead><tbody>
  ${G.map(g => { const cl = classe(g.cl); return `<tr><td><b>${fmtA(g.n)}</b></td><td>${esc(dimTxt(g.e))}</td><td>${esc(cl.antiga)} · ${traco(cl.traco)}</td><td class="muted small">${esc([...g.pisos].join(', ') || '—')}</td><td>${fmt(g.vol, 2)} m³</td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function tEstrutura(o, P) {
  chain(() => {
    const r = calcObra(o); const m = { mat: matEstr(r) };
    for (const e of o.elementos) m['v' + e.id] = fmt(geomEl(e).vol * (+e.n || 0), 3);
    for (const t in TIPOS) { const l = o.elementos.filter(e => e.tipo === t); m['s' + t] = fmt(l.filter(e => e.incluir !== false).reduce((a, e) => a + geomEl(e).vol * (+e.n || 0), 0), 2) + ' m³'; m['g' + t] = tabGrupos(l); }
    return m;
  });
  const bar = `<div class="bar"><button class="btn" data-act="ifc">Importar IFC do ArchiCAD</button>
    <span class="muted small">Classe para todos:</span>${sel(P + '.classe', classOpts())}<button class="btn sec" data-act="classeTodos">Aplicar a todos</button></div>`;
  const secs = Object.entries(TIPOS).map(([t, d]) => {
    const rows = o.elementos.map((e, j) => [e, j]).filter(([e]) => e.tipo === t);
    const lista = `<div class="tw"><table><thead><tr><th></th><th>Nome</th><th>Piso</th>${d.c.map(c => `<th>${c}</th>`).join('')}<th>Qtd</th><th>Classe</th><th class="num">Betão (m³)</th><th></th></tr></thead><tbody>
    ${rows.map(([e, j]) => {
      const Q = `${P}.elementos.${j}`;
      return `<tr class="${e.incluir === false ? 'off' : ''}"><td>${chk(Q + '.incluir')}</td><td>${inp(Q + '.nome', { num: false, cls: 'w-n' })}${e.info ? `<small>${esc(e.info)}</small>` : ''}</td><td>${inp(Q + '.piso', { num: false, cls: 'w-p' })}</td>
      ${d.c.map((_, k) => `<td>${inp(Q + '.' + 'xyz'[k], { cls: 'w-d' })}</td>`).join('')}<td>${inp(Q + '.n', { cls: 'w-q' })}</td><td>${sel(Q + '.classe', classOpts())}</td>
      <td class="num" data-o="v${e.id}"></td><td><button class="ic" data-act="del" data-p="${Q}" title="Apagar" aria-label="Apagar">×</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
    return `<section class="box"><div class="sh"><h2>${d.t} <span class="muted small">(${fmtA(rows.reduce((a, [e]) => a + (e.incluir === false ? 0 : +e.n || 0), 0))})</span></h2><span class="pill" data-o="s${t}"></span></div>
    ${rows.length ? `<div data-oh="g${t}"></div>${det('el-' + t, `Ver e editar a lista (${rows.length} linha${rows.length > 1 ? 's' : ''})`, lista, rows.length <= 6)}` : ''}
    <button class="btn sec sm" data-act="addEl" data-t="${t}">+ ${d.add}</button></section>`;
  }).join('');
  return info('<b>Estrutura em betão:</b> lance as sapatas, pilares, vigas e lajes (ou importe do ArchiCAD). Cada tabela mostra as peças <b>agrupadas por dimensões iguais</b>; abra "Ver e editar a lista" para corrigir peça a peça. A <b>classe</b> escolhida define o <b>traço</b> (ex.: B25 = 1:2:3) e daí saem o cimento, a areia e a brita.')
    + bar + `<section class="box"><h2>Materiais da estrutura</h2><div data-oh="mat"></div></section>` + secs
    + `<p class="muted small">O aço é estimado por taxa (kg por m³ de betão). Traços, taxas e perdas mudam-se em <a href="#/definicoes">Definições</a>.</p>`;
}

/* --- Alvenaria --- */
function tAlvenaria(o, P) {
  chain(() => {
    const r = calcObra(o), m = { abTot: mt0(r.abTot) };
    o.aberturas.forEach(x => m['ab' + x.id] = mt0((+x.n || 0) * (+x.preco || 0)));
    const sem = o.aberturas.filter(x => x.incluir !== false && !(+x.preco > 0)).length;
    m.abAviso = sem ? `<div class="warn small" style="margin-bottom:10px">Falta o preço em ${sem} linha(s).</div>` : '';
    return m;
  });
  const usados = [...new Set(o.paredes.filter(p => p.incluir !== false).map(p => bloco(p.bloco).id))];
  const mostrar = S.cfg.blocos.map((b, j) => [b, j]).filter(([b]) => usados.includes(b.id) || !usados.length);
  chain(() => {
    const r = calcObra(o); const s = S.cfg.saco || 50;
    const m = { aAlv: fmt(r.areaAlv, 2) + ' m²', aReb: fmt(r.areaReb, 2) + ' m²', nPar: String(o.paredes.filter(p => p.incluir !== false).length),
      argA: `${fmt(r.ass.vol, 2)} m³ → ${fmt(Math.ceil(r.ass.cim / s - 1e-9), 0)} sacos de cimento e ${fmt(r.ass.areia, 2)} m³ de areia`,
      argR: `${fmt(r.reb.vol, 2)} m³ → ${fmt(Math.ceil(r.reb.cim / s - 1e-9), 0)} sacos de cimento e ${fmt(r.reb.areia, 2)} m³ de areia` };
    for (const [b, j] of mostrar) { const g = blocoGeo(b), q = r.porBloco[b.id]; m['pm' + j] = fmt(g.porM2, 2); m['ba' + j] = q ? fmt(q.area, 2) + ' m²' : '—'; m['bu' + j] = q ? fmt(Math.ceil(q.un * (1 + S.cfg.perdas.blocos / 100) - 1e-9), 0) : '—'; }
    for (const p of o.paredes) m['a' + p.id] = fmt(geomPar(p).liq * (+p.n || 0), 2);
    return m;
  });
  const blocos = `<section class="box"><h2>Blocos</h2>
  <p class="muted small">Confirme o <b>tamanho real</b> do bloco que vai usar (ex.: 40 × 20 cm). As unidades por m² e a argamassa calculam-se a partir daqui. Mudar aqui muda para todas as obras.</p>
  <div class="tw"><table class="grp"><thead><tr><th>Bloco</th><th>Comp. (cm)</th><th>Alt. (cm)</th><th>Esp. (cm)</th><th>Junta (cm)</th><th class="num">Unid./m²</th><th class="num">Área</th><th class="num">Blocos*</th></tr></thead><tbody>
  ${mostrar.map(([b, j]) => { const Q = `cfg.blocos.${j}`; return `<tr><td><b>${esc(b.nome)}</b></td><td>${inp(Q + '.comp', { cls: 'w-q' })}</td><td>${inp(Q + '.alt', { cls: 'w-q' })}</td><td>${inp(Q + '.esp', { cls: 'w-q' })}</td><td>${inp(Q + '.junta', { cls: 'w-q' })}</td><td class="num" data-o="pm${j}"></td><td class="num" data-o="ba${j}"></td><td class="num"><b data-o="bu${j}"></b></td></tr>`; }).join('')}
  </tbody></table></div><p class="muted small" style="margin:8px 0 0">* Com ${fmt(S.cfg.perdas.blocos, 0)} % de perdas. Outros tipos de bloco acrescentam-se em Definições.</p></section>`;
  const bar = `<div class="bar"><button class="btn" data-act="ifc">Importar IFC do ArchiCAD</button>
   <span class="muted small">Altura para todas (m):</span><input id="bulkAlt" class="w-d" inputmode="decimal" placeholder="3,00"><button class="btn sec" data-act="altTodas">Aplicar</button>
   <select id="bulkBl">${blocoOpts().map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select><button class="btn sec" data-act="blTodas">Bloco para todas</button></div>`;
  const rows = o.paredes.map((p, j) => {
    const Q = `${P}.paredes.${j}`;
    return `<tr class="${p.incluir === false ? 'off' : ''}"><td>${chk(Q + '.incluir')}</td><td>${inp(Q + '.nome', { num: false, cls: 'w-n' })}${p.info ? `<small>${esc(p.info)}</small>` : ''}</td><td>${inp(Q + '.piso', { num: false, cls: 'w-p' })}</td>
    <td>${inp(Q + '.comp', { cls: 'w-d' })}</td><td>${inp(Q + '.alt', { cls: 'w-d' })}</td><td>${inp(Q + '.vaos', { cls: 'w-d' })}</td><td>${inp(Q + '.n', { cls: 'w-q' })}</td>
    <td class="num" data-o="a${p.id}"></td><td>${sel(Q + '.bloco', blocoOpts())}</td><td>${sel(Q + '.faces', [[0, 'Sem reboco'], [1, '1 face'], [2, '2 faces']], true)}</td>
    <td><button class="ic" data-act="del" data-p="${Q}" title="Apagar" aria-label="Apagar">×</button></td></tr>`;
  }).join('');
  const lista = `<div class="tw"><table><thead><tr><th></th><th>Nome</th><th>Piso</th><th>Comp. (m)</th><th>Alt. (m)</th><th>Vãos (m²)</th><th>Qtd</th><th class="num">Área líq. (m²)</th><th>Bloco</th><th>Reboco</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return info('<b>Alvenaria:</b> cada parede conta pela área líquida (comprimento × altura − portas e janelas). O resultado aparece <b>por tipo de bloco</b> (Bloco 15, Bloco 20…), com a argamassa de assentamento e o reboco. No fim, as <b>portas e janelas</b> com o preço de cada uma.')
    + bar + blocos
    + `<section class="box"><div class="sh"><h2>Paredes <span class="muted small">(<span data-o="nPar"></span> incluídas)</span></h2><span class="pill" data-o="aAlv"></span></div>
    ${o.paredes.length ? det('par', `Ver e editar as paredes (${o.paredes.length})`, lista, o.paredes.length <= 8) : '<p class="muted">Sem paredes. Importe o IFC ou adicione à mão.</p>'}
    <button class="btn sec sm" data-act="addPar">+ Adicionar parede</button></section>
    <section class="box"><h2>Argamassas</h2><div class="kv"><span>Assentamento ${traco(S.cfg.assent.traco)}</span><b data-o="argA"></b></div>
    <div class="kv" style="margin-top:8px"><span>Reboco ${traco(S.cfg.reboco.traco)}, ${fmt(S.cfg.reboco.esp, 1)} cm (<span data-o="aReb"></span>)</span><b data-o="argR"></b></div>
    <p class="muted small" style="margin:8px 0 0">Com ${fmt(S.cfg.perdas.argamassa, 0)} % de perdas.</p></section>
    <section class="box"><div class="sh"><h2>Portas e janelas <span class="muted small">(${fmtA(o.aberturas.filter(x => x.incluir !== false).reduce((a, x) => a + (+x.n || 0), 0))})</span></h2><span class="pill" data-o="abTot"></span></div>
    <p class="muted small">Preço por unidade colocada (caixilharia, vidro, ferragens). As do IFC vêm agrupadas por tamanho.</p>
    <div data-oh="abAviso"></div>
    ${o.aberturas.length ? `<div class="tw"><table><thead><tr><th></th><th>Tipo</th><th>Descrição</th><th>Qtd</th><th>Preço unit. (MT)</th><th class="num">Total</th><th></th></tr></thead><tbody>
    ${o.aberturas.map((x, j) => { const Q = `${P}.aberturas.${j}`; return `<tr class="${x.incluir === false ? 'off' : ''}"><td>${chk(Q + '.incluir')}</td><td>${sel(Q + '.tipo', [['porta', 'Porta'], ['janela', 'Janela']])}</td><td>${inp(Q + '.nome', { num: false, cls: 'w-n2' })}${x.info ? `<small>${esc(x.info)}</small>` : ''}</td><td>${inp(Q + '.n', { cls: 'w-q' })}</td><td>${inp(Q + '.preco', { cls: 'w-d' })}</td><td class="num" data-o="ab${x.id}"></td><td><button class="ic" data-act="del" data-p="${Q}" aria-label="Apagar">×</button></td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="muted">Sem portas nem janelas. Importe o IFC ou adicione à mão.</p>'}
    <button class="btn sec sm" data-act="addAb">+ Adicionar porta ou janela</button></section>`;
}

/* --- Mão de obra --- */
function tMO(o, P) {
  chain(() => { const r = calcObra(o); const m = { moTot: mt(r.moTot), exTot: mt(r.extTot) }; o.extras.forEach(x => m['x' + x.id] = mt((+x.qtd || 0) * (+x.pu || 0))); return m; });
  const r = calcObra(o); let corpo = '', expl = '';
  switch (o.mo.modo) {
    case 'servicos':
      expl = 'Cada serviço é pago pela sua quantidade: betão por m³, cofragem por m², armaduras por kg, alvenaria e reboco por m². As quantidades vêm da Estrutura e da Alvenaria; os preços estão em Preços.';
      corpo = `<div class="tw"><table class="sum"><thead><tr><th>Serviço</th><th class="num">Quantidade</th><th class="num">Preço</th><th class="num">Total</th></tr></thead><tbody>
      ${r.moL.map(l => `<tr><td>${esc(l.nome)}</td><td>${fmt(l.qtd, 2)} ${esc(l.un)}</td><td>${mt(l.pu)}/${esc(l.un)}</td><td>${mt(l.tot)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Ainda sem quantidades: preencha a Estrutura e a Alvenaria.</td></tr>'}
      </tbody></table></div><p class="muted small">Os preços por serviço mudam-se em <a href="#/precos">Preços</a>.</p>`; break;
    case 'diaria':
      expl = 'Paga-se por dia de trabalho: número de trabalhadores × dias × valor da diária.';
      corpo = `<div class="grid2">${fld('Trabalhadores', inp(P + '.mo.diaria.trab'))}${fld('Dias', inp(P + '.mo.diaria.dias'))}${fld('Valor por dia, por trabalhador (MT)', inp(P + '.mo.diaria.valor'))}</div>`; break;
    case 'empreitada':
      expl = 'Um valor fechado combinado com o empreiteiro para toda a obra.';
      corpo = `<div class="grid2">${fld('Valor da empreitada (MT)', inp(P + '.mo.empreitada'))}</div>`; break;
    default:
      expl = 'A forma principal: <b>preço por m² × área de construção</b>. Ex.: 3 500 MT/m² × 120 m² = 420 000 MT.';
      corpo = `<div class="grid2">${fld('Preço por m² de construção (MT/m²)', inp(P + '.mo.m2'))}${fld('Área de construção (m²)', inp(P + '.area'), 'É a mesma área do separador Dados.')}</div>`;
  }
  return `${info('<b>Mão de obra:</b> o custo dos trabalhadores. Escolha como o empreiteiro cobra; o valor entra no total da obra. Em baixo pode juntar <b>outros custos</b> que não estão nas tabelas.')}
  <section class="box"><div class="grid2">${fld('Como calcular a mão de obra', sel(P + '.mo.modo', [['m2', 'Por m² de construção (principal)'], ['servicos', 'Por m² de cada serviço'], ['diaria', 'Por diária'], ['empreitada', 'Por empreitada (valor fechado)']]))}</div>
  <p class="muted small" style="margin:10px 0 0">${expl}</p>
  <div style="margin-top:14px">${corpo}</div><div class="kv" style="margin-top:14px;font-size:16px"><span>Total da mão de obra</span><b data-o="moTot"></b></div></section>
  <section class="box"><h2>Outros custos</h2><p class="muted small">Cobertura, canalização, eletricidade, transporte, licenças… o que não está nas outras tabelas.</p>
  ${o.extras.length ? `<div class="tw"><table><thead><tr><th>Descrição</th><th>Qtd</th><th>Unid.</th><th>Preço unit. (MT)</th><th class="num">Total</th><th></th></tr></thead><tbody>
  ${o.extras.map((x, j) => { const Q = `${P}.extras.${j}`; return `<tr><td>${inp(Q + '.nome', { num: false, cls: 'w-n2' })}</td><td>${inp(Q + '.qtd', { cls: 'w-q' })}</td><td>${inp(Q + '.un', { num: false, cls: 'w-u' })}</td><td>${inp(Q + '.pu', { cls: 'w-d' })}</td><td class="num" data-o="x${x.id}"></td><td><button class="ic" data-act="del" data-p="${Q}" aria-label="Apagar">×</button></td></tr>`; }).join('')}
  </tbody></table></div>` : ''}<button class="btn sec sm" data-act="addExtra">+ Adicionar custo</button>
  <div class="kv" style="margin-top:14px"><span>Total de outros custos</span><b data-o="exTot"></b></div></section>`;
}

/* --- Resumo --- */
function tResumo(o) {
  const r = calcObra(o), h = honor(o.honor), c = S.cfg, s = c.saco || 50;
  const linha = l => `<tr><td>${esc(l.nome)}${l.nota ? ` <span class="muted small">(${esc(l.nota)})</span>` : ''}</td><td>${fmt(l.qtd, l.un === 'un' || l.un === 'sacos' || l.un === 'kg' ? 0 : 2)} ${esc(l.un)}</td><td>${mt(l.pu)}</td><td>${mt(l.tot)}</td></tr>`;
  const semDados = !r.mat.length && !r.moTot && !r.extTot;
  return `${info('<b>Resumo:</b> todas as quantidades (cimento, areia, brita, aço, blocos) já com perdas, os preços da tabela de Preços e o total da obra. Pode imprimir, guardar em PDF ou copiar para o WhatsApp.')}
  <div class="ph"><h2>${esc(c.empresa.nome || 'Orçamento')}</h2><p>${esc(o.nome)}${o.cliente ? ' · ' + esc(o.cliente) : ''}${o.local ? ' · ' + esc(o.local) : ''} · ${fData(o.data)}</p></div>
  <div class="kpis"><div class="box main"><small class="muted">Total da obra${o.iva ? ' (com IVA)' : ''}</small><b>${mt0(r.total)}</b></div>
  <div class="box"><small class="muted">Custo por m²</small><b>${r.area > 0 ? mt0(r.porM2) : '—'}</b>${r.area > 0 ? '' : '<small class="muted">Indique a área em Dados</small>'}</div>
  <div class="box"><small class="muted">Honorários do projeto</small><b>${h.a > 0 ? mt0(h.total) : '—'}</b><small class="muted">${esc(h.serv.nome)}${h.casas > 1 ? ` · ${h.casas} casas` : ''}${h.desc > 0 ? ` · desconto ${mt0(h.desc)}` : ''}</small></div></div>
  ${semDados ? '<div class="warn" style="margin-bottom:14px">Ainda não há quantidades. Preencha a Estrutura, a Alvenaria ou importe o IFC.</div>' : ''}
  <section class="box"><h2>Materiais</h2><p class="muted small">Inclui perdas: betão ${fmt(c.perdas.betao, 0)} %, aço ${fmt(c.perdas.aco, 0)} %, blocos ${fmt(c.perdas.blocos, 0)} %, argamassa ${fmt(c.perdas.argamassa, 0)} %.</p>
  <div class="tw"><table class="sum"><thead><tr><th>Material</th><th class="num">Quantidade</th><th class="num">Preço unit.</th><th class="num">Total</th></tr></thead><tbody>
  ${r.mat.map(linha).join('') || '<tr><td colspan="4" class="muted">—</td></tr>'}<tr class="s"><td>Total de materiais</td><td></td><td></td><td>${mt(r.matTot)}</td></tr></tbody></table></div></section>
  ${r.classesR.length ? `<section class="box"><h2>Betão por classe</h2><div class="tw"><table class="sum"><thead><tr><th>Classe</th><th class="num">Volume</th><th class="num">Com perdas</th><th class="num">Cimento</th><th class="num">Areia</th><th class="num">Brita</th><th class="num">Água</th></tr></thead><tbody>
  ${r.classesR.map(x => `<tr><td>${esc(x.id)} <span class="muted small">(${esc(x.antiga)} · ${traco(x.traco)})</span></td><td>${fmt(x.vol, 2)} m³</td><td>${fmt(x.volP, 2)} m³</td><td>${fmt(x.cim / s, 1)} sacos</td><td>${fmt(x.areia, 2)} m³</td><td>${fmt(x.brita, 2)} m³</td><td>${fmt(x.agua * 1000, 0)} L</td></tr>`).join('')}
  </tbody></table></div><p class="muted small">Cofragem: ${fmt(r.cofr, 2)} m² · Aço: ${fmt(r.acoN, 0)} kg + ${fmt(c.perdas.aco, 0)} % de perdas = ${fmt(Math.ceil(r.aco), 0)} kg</p></section>` : ''}
  ${r.areaAlv > 0 ? `<section class="box"><h2>Alvenaria e reboco</h2><div class="tw"><table class="sum"><thead><tr><th></th><th class="num">Área</th><th class="num">Argamassa</th><th class="num">Cimento</th><th class="num">Areia</th></tr></thead><tbody>
  ${Object.entries(r.porBloco).map(([id, q]) => { const b = bloco(id); return `<tr><td>${esc(b.nome)} <span class="muted small">(${fmtA(b.comp)}×${fmtA(b.alt)} cm)</span></td><td>${fmt(q.area, 2)} m²</td><td colspan="3">${fmt(q.unP, 0)} blocos</td></tr>`; }).join('')}
  <tr><td>Assentamento ${traco(c.assent.traco)}</td><td>${fmt(r.areaAlv, 2)} m²</td><td>${fmt(r.ass.vol, 2)} m³</td><td>${fmt(r.ass.cim / s, 1)} sacos</td><td>${fmt(r.ass.areia, 2)} m³</td></tr>
  <tr><td>Reboco ${traco(c.reboco.traco)} (${fmt(c.reboco.esp, 1)} cm)</td><td>${fmt(r.areaReb, 2)} m²</td><td>${fmt(r.reb.vol, 2)} m³</td><td>${fmt(r.reb.cim / s, 1)} sacos</td><td>${fmt(r.reb.areia, 2)} m³</td></tr>
  </tbody></table></div></section>` : ''}
  ${r.ab.length ? `<section class="box"><h2>Portas e janelas</h2><div class="tw"><table class="sum"><thead><tr><th></th><th class="num">Qtd</th><th class="num">Preço unit.</th><th class="num">Total</th></tr></thead><tbody>
  ${r.ab.map(linha).join('')}<tr class="s"><td>Total de portas e janelas</td><td></td><td></td><td>${mt(r.abTot)}</td></tr></tbody></table></div></section>` : ''}
  ${(() => { const PS = calcPisos(o); return PS.length > 1 ? `<section class="box"><h2>Materiais por piso</h2><p class="muted small">Para comprar por fases. Já com perdas e arredondado em cada piso, por isso a soma pode passar ligeiramente o total.</p>
  <div class="tw"><table class="sum"><thead><tr><th>Piso</th><th class="num">Betão</th><th class="num">Cimento</th><th class="num">Areia</th><th class="num">Brita</th><th class="num">Aço</th><th class="num">Blocos</th></tr></thead><tbody>
  ${PS.map(({ piso, r: x }) => `<tr><td>${esc(piso)}</td><td>${fmt(x.vol, 2)} m³</td><td>${fmt(x.sacos, 0)} sacos</td><td>${fmt(x.areia, 2)} m³</td><td>${fmt(x.brita, 2)} m³</td><td>${fmt(Math.ceil(x.aco), 0)} kg</td><td>${fmt(Object.values(x.porBloco).reduce((a, q) => a + (q.unP || 0), 0), 0)}</td></tr>`).join('')}
  </tbody></table></div></section>` : ''; })()}
  <section class="box"><h2>Total</h2><div class="tw"><table class="sum"><tbody>
  <tr><td>Materiais</td><td>${mt(r.matTot)}</td></tr>
  ${r.moL.map(l => `<tr><td>Mão de obra — ${esc(l.nome)}${o.mo.modo === 'm2' || o.mo.modo === 'servicos' ? ` <span class="muted small">(${fmt(l.qtd, 2)} ${esc(l.un)} × ${mt(l.pu)})</span>` : ''}</td><td>${mt(l.tot)}</td></tr>`).join('')}
  ${r.ext.map(l => `<tr><td>${esc(l.nome)} <span class="muted small">(${fmt(l.qtd, 2)} ${esc(l.un)} × ${mt(l.pu)})</span></td><td>${mt(l.tot)}</td></tr>`).join('')}
  ${r.abTot ? `<tr><td>Portas e janelas</td><td>${mt(r.abTot)}</td></tr>` : ''}
  <tr class="s"><td>Subtotal</td><td>${mt(r.sub)}</td></tr>
  ${+o.margem ? `<tr><td>Margem (${fmt(o.margem, 1)} %)</td><td>${mt(r.margem)}</td></tr>` : ''}
  ${o.iva ? `<tr><td>IVA (${fmt(c.iva, 0)} %)</td><td>${mt(r.iva)}</td></tr>` : ''}
  <tr class="t"><td>Total da obra</td><td>${mt(r.total)}</td></tr>
  </tbody></table></div></section>
  <div class="row"><button class="btn" data-act="imprimir">Imprimir / guardar PDF</button><button class="btn sec" data-act="copiar">Copiar para WhatsApp</button></div>`;
}

/* --- Preços --- */
function vPrecos() {
  const todos = [...S.precos, ...S.mo, ...S.cfg.blocos];
  const ult = todos.map(p => p.data).filter(Boolean).sort()[0];
  outs = () => { const m = {}; const put = (k, arr) => arr.forEach((p, j) => { const d = diasDesde(p.data); m[`d-${k}-${j}`] = fData(p.data) + (d > 0 ? ` (há ${d} dia${d > 1 ? 's' : ''})` : ' (hoje)'); }); put('precos', S.precos); put('mo', S.mo); put('cfg.blocos', S.cfg.blocos); return m; };
  const tab = (arr, key, titulo, nota) => `<section class="box"><h2>${titulo}</h2>${nota ? `<p class="muted small">${nota}</p>` : ''}<div class="tw"><table><thead><tr><th>Item</th><th>Unid.</th><th>Preço (MT)</th><th>Atualizado</th></tr></thead><tbody>
    ${arr.map((p, j) => `<tr><td>${inp(`${key}.${j}.nome`, { num: false, cls: 'w-n2' })}</td><td>${key === 'cfg.blocos' ? 'un' : inp(`${key}.${j}.un`, { num: false, cls: 'w-u' })}</td><td>${inp(`${key}.${j}.preco`, { cls: 'w-d' })}</td><td class="muted small" data-o="d-${key}-${j}"></td></tr>`).join('')}
    </tbody></table></div></section>`;
  return `<div class="head"><div><h1>Preços de mercado</h1><p class="muted small">Em meticais (MT). O preço mais antigo é de ${fData(ult)}. Ao mudar um preço, a data atualiza sozinha.</p></div>
  <button class="btn sec" data-act="hoje">Marcar todos como verificados hoje</button></div>
  ${info('<b>Preços:</b> o valor do cimento, da areia, da pedra, do aço, dos blocos e da mão de obra. Todas as obras usam esta tabela — quando o mercado mudar, atualize aqui.')}
  <div class="warn" style="margin-bottom:14px">Os preços iniciais são apenas exemplos. Substitua-os pelos preços dos seus fornecedores.</div>
  ${tab(S.precos, 'precos', 'Materiais')}
  ${tab(S.cfg.blocos, 'cfg.blocos', 'Blocos', 'Preço por unidade. O tamanho de cada bloco edita-se na Alvenaria ou em Definições.')}
  ${tab(S.mo, 'mo', 'Mão de obra por serviço', 'Usados quando a obra calcula a mão de obra "por m² de cada serviço".')}`;
}

/* --- Definições --- */
function vDef() {
  const H = S.cfg.honor, E = H.escaloes, s = S.cfg.saco || 50;
  outs = () => {
    const sv = H.servicos[0] && H.servicos[0].id;
    const ex = honor({ area: 150, casas: 1, servico: sv }), ex2 = honor({ area: 150, casas: 2, servico: sv });
    const m = { escLast: E.length > 1 ? `Acima de ${fmtA(E[E.length - 2].ate)} m²` : 'Todos os m²', ex: `Exemplo: casa de 150 m² = ${mt0(ex.total)} · 2 geminadas = ${mt0(ex2.total)}` };
    S.cfg.classes.forEach((c, j) => { const d = dosagem(c); m['cl' + j] = `${fmt(d.cim, 0)} kg (${fmt(d.cim / s, 1)} sacos) · areia ${fmt(d.areia, 2)} · brita ${fmt(d.brita, 2)} m³ · água ${fmt(d.agua, 0)} L`; });
    const a = dosArg(S.cfg.assent.traco), r = dosArg(S.cfg.reboco.traco);
    m.argA = `${fmt(a.cim, 0)} kg de cimento e ${fmt(a.areia, 2)} m³ de areia por m³`; m.argR = `${fmt(r.cim, 0)} kg de cimento e ${fmt(r.areia, 2)} m³ de areia por m³`;
    S.cfg.blocos.forEach((b, j) => { m['bp' + j] = fmt(blocoGeo(b).porM2, 2); });
    return m;
  };
  const esc_ = E.map((e, j) => `<tr><td>${j === E.length - 1 ? '<span data-o="escLast"></span>' : `Até ${inp(`cfg.honor.escaloes.${j}.ate`, { cls: 'w-d' })} m²`}</td><td>${inp(`cfg.honor.escaloes.${j}.preco`, { cls: 'w-d' })} MT/m²</td><td>${E.length > 1 ? `<button class="ic" data-act="del" data-p="cfg.honor.escaloes.${j}" aria-label="Apagar">×</button>` : ''}</td></tr>`).join('');
  return `<div class="head"><h1>Definições</h1></div>
  ${info('<b>Definições:</b> os valores que o programa usa em todas as obras — honorários, descontos, traços do betão, blocos, perdas e os dados da sua empresa para o recibo.')}
  <section class="box"><h2>A sua empresa (aparece no recibo e na proposta)</h2>
  <div class="logo-row">${S.cfg.empresa.logo ? `<div class="thumb logo"><img data-img="${esc(S.cfg.empresa.logo)}" alt="Logotipo"><button class="ic" data-act="delLogo" aria-label="Remover logotipo">×</button></div>` : '<div class="thumb logo vazio">Sem logotipo</div>'}
  <div><b>Logotipo</b><p class="muted small" style="margin:4px 0 8px">Aparece no topo dos recibos e das propostas. Imagem PNG ou JPG, de preferência com fundo branco.</p><button class="btn sec sm0" data-act="addLogo">${S.cfg.empresa.logo ? 'Trocar logotipo' : 'Escolher logotipo'}</button></div></div>
  <div class="grid2">
  ${fld('Nome / empresa', inp('cfg.empresa.nome', { num: false }))}${fld('NUIT', inp('cfg.empresa.nuit', { num: false }))}${fld('Telefone / WhatsApp', inp('cfg.empresa.tel', { num: false }))}${fld('Email', inp('cfg.empresa.email', { num: false }))}${fld('Morada', inp('cfg.empresa.morada', { num: false }))}${fld('Próximo nº de recibo', inp('cfg.recibo.proximo'))}${fld('Próximo nº de proposta', inp('cfg.proposta.proximo'))}
  </div></section>

  <section class="box"><h2>Textos padrão da proposta</h2><p class="muted small">Usados em todas as propostas, a não ser que a obra tenha um texto próprio.</p><div class="grid2">
  ${fld('Validade (dias)', inp('cfg.proposta.validade'))}${fld('Prazo de entrega do projeto', inp('cfg.proposta.prazo', { num: false }))}
  <label class="f full"><span>O projeto inclui (uma linha por item)</span><textarea data-b="cfg.proposta.inclui" rows="4">${esc(S.cfg.proposta.inclui)}</textarea></label>
  <label class="f full"><span>Condições de pagamento (uma linha por item)</span><textarea data-b="cfg.proposta.condicoes" rows="3">${esc(S.cfg.proposta.condicoes)}</textarea></label>
  </div></section>

  <section class="box"><h2>Honorários do projeto</h2>
  <div class="grid2">${fld('Valor fixo por projeto (MT)', inp('cfg.honor.fixo'))}${fld('Casa geminada / repetida: cada casa a mais paga (%)', inp('cfg.honor.geminada'))}${fld('Preço mínimo (MT)', inp('cfg.honor.minimo'))}${fld('Arredondar a (MT)', inp('cfg.honor.arred'), '0 = sem arredondamento')}</div>
  <h3>Preço por m², por escalão</h3><div class="tw"><table><tbody>${esc_}</tbody></table></div><button class="btn sec sm" data-act="addEsc">+ Adicionar escalão</button>
  <h3>Serviços</h3><div class="tw"><table><thead><tr><th>Serviço</th><th>% do valor</th><th></th></tr></thead><tbody>${H.servicos.map((sv, j) => `<tr><td>${inp(`cfg.honor.servicos.${j}.nome`, { num: false, cls: 'w-n2' })}</td><td>${inp(`cfg.honor.servicos.${j}.fator`, { cls: 'w-q' })}</td><td>${H.servicos.length > 1 ? `<button class="ic" data-act="del" data-p="cfg.honor.servicos.${j}" aria-label="Apagar">×</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
  <button class="btn sec sm" data-act="addServ">+ Adicionar serviço</button>
  <h3>Descontos</h3><div class="tw"><table><thead><tr><th>Motivo</th><th>%</th><th></th></tr></thead><tbody>${S.cfg.descontos.map((d, j) => `<tr><td>${inp(`cfg.descontos.${j}.nome`, { num: false, cls: 'w-n2' })}</td><td>${inp(`cfg.descontos.${j}.pct`, { cls: 'w-q' })}</td><td><button class="ic" data-act="del" data-p="cfg.descontos.${j}" aria-label="Apagar">×</button></td></tr>`).join('')}</tbody></table></div>
  <button class="btn sec sm" data-act="addDesc">+ Adicionar desconto</button>
  <p class="muted small" data-o="ex" style="margin-top:12px"></p></section>

  <section class="box"><h2>Classes de betão e traços</h2>
  <p class="muted small">Traço em volume <b>cimento : areia : brita</b>. As quantidades por m³ calculam-se pelo método do volume seco (coeficiente ${numIn(S.cfg.betao.seco)}) e cimento a ${fmt(S.cfg.betao.dens, 0)} kg/m³. Para classes altas (B40 ou mais), confirme o traço com ensaio.</p>
  <div class="tw"><table><thead><tr><th>Classe</th><th>Antiga</th><th>Traço</th><th>Água/cimento</th><th>Por m³ de betão</th><th>Uso</th><th></th></tr></thead><tbody>
  ${S.cfg.classes.map((c, j) => { const Q = `cfg.classes.${j}`; return `<tr><td>${inp(Q + '.id', { num: false, cls: 'w-u' })}</td><td>${inp(Q + '.antiga', { num: false, cls: 'w-u' })}</td><td>${tracoIn(Q + '.traco', 3)}</td><td>${inp(Q + '.ac', { cls: 'w-q' })}</td><td class="small" data-o="cl${j}" style="min-width:250px"></td><td>${inp(Q + '.uso', { num: false, cls: 'w-n2' })}</td><td><button class="ic" data-act="del" data-p="${Q}" aria-label="Apagar">×</button></td></tr>`; }).join('')}
  </tbody></table></div><button class="btn sec sm" data-act="addClasse">+ Adicionar classe</button>
  <div class="grid2" style="margin-top:14px">${fld('Coeficiente de volume seco do betão', inp('cfg.betao.seco'), 'Habitual: 1,52 a 1,57')}${fld('Massa volúmica do cimento (kg/m³)', inp('cfg.betao.dens'), 'Habitual: 1 440')}${fld('Peso do saco de cimento (kg)', inp('cfg.saco'))}</div></section>

  <section class="box"><h2>Argamassas</h2><div class="grid2">
  ${fld('Assentamento: traço cimento : areia', tracoIn('cfg.assent.traco', 2), '<span data-o="argA"></span>')}
  ${fld('Reboco: traço cimento : areia', tracoIn('cfg.reboco.traco', 2), '<span data-o="argR"></span>')}
  ${fld('Reboco: espessura (cm)', inp('cfg.reboco.esp'))}${fld('Coeficiente de volume seco da argamassa', inp('cfg.argSeco'), 'Habitual: 1,27 a 1,33')}
  </div></section>

  <section class="box"><h2>Tipos de bloco</h2><div class="tw"><table><thead><tr><th>Nome</th><th>Comp. (cm)</th><th>Alt. (cm)</th><th>Esp. (cm)</th><th>Junta (cm)</th><th class="num">Unid./m²</th><th></th></tr></thead><tbody>
  ${S.cfg.blocos.map((b, j) => { const Q = `cfg.blocos.${j}`; return `<tr><td>${inp(Q + '.nome', { num: false, cls: 'w-n' })}</td><td>${inp(Q + '.comp', { cls: 'w-q' })}</td><td>${inp(Q + '.alt', { cls: 'w-q' })}</td><td>${inp(Q + '.esp', { cls: 'w-q' })}</td><td>${inp(Q + '.junta', { cls: 'w-q' })}</td><td class="num" data-o="bp${j}"></td><td>${S.cfg.blocos.length > 1 ? `<button class="ic" data-act="del" data-p="${Q}" aria-label="Apagar">×</button>` : ''}</td></tr>`; }).join('')}
  </tbody></table></div><button class="btn sec sm" data-act="addBloco">+ Adicionar bloco</button><p class="muted small">O preço de cada bloco está em Preços.</p></section>

  <section class="box"><h2>Aço e perdas</h2><div class="grid2">
  ${fld('Aço em sapatas (kg/m³)', inp('cfg.aco.sapata'))}${fld('Aço em pilares (kg/m³)', inp('cfg.aco.pilar'))}${fld('Aço em vigas (kg/m³)', inp('cfg.aco.viga'))}${fld('Aço em lajes (kg/m³)', inp('cfg.aco.laje'))}${fld('Aço noutros elementos (kg/m³)', inp('cfg.aco.outro'))}
  ${fld('Perdas de betão (%)', inp('cfg.perdas.betao'))}${fld('Perdas de aço (%)', inp('cfg.perdas.aco'))}${fld('Perdas de blocos (%)', inp('cfg.perdas.blocos'))}${fld('Perdas de argamassa (%)', inp('cfg.perdas.argamassa'))}
  </div></section>

  <section class="box"><h2>Geral</h2><div class="grid2">${fld('IVA (%)', inp('cfg.iva'))}${fld('Mão de obra por m² para obras novas (MT/m²)', inp('cfg.moM2'))}</div></section>

  <section class="box"><h2>Dados</h2><div class="row"><button class="btn sec" data-act="exportar">Exportar dados</button><button class="btn sec" data-act="importar">Importar dados</button><button class="btn danger" data-act="repor">Repor definições e preços de origem</button></div>
  <p class="muted small">PC Orçamentos ${VERSAO}</p></section>`;
}

/* --- Conta e sincronização --- */
function vConta() {
  const Y = window.SYNC;
  const topo = `<div class="head"><h1>Conta e sincronização</h1></div>
  ${info('Com a conta, você e o seu sócio veem <b>as mesmas obras, preços e recibos</b> em todos os aparelhos. O programa continua a funcionar sem internet: as alterações ficam guardadas e são enviadas quando a ligação voltar.')}`;
  if (Y === undefined) return topo + '<section class="box"><p class="muted">A preparar a sincronização…</p></section>';
  if (!Y) return topo + '<section class="box"><p>A sincronização ainda não está ligada nesta versão do programa. Por agora, os dados ficam só neste aparelho.</p></section>';
  const e = Y.estado();
  if (e.falhou) return topo + `<section class="box"><p>Não foi possível carregar a sincronização. Abra o programa uma vez com internet.</p><button class="btn" data-act="recarregar">Tentar de novo</button></section>`;
  if (!e.email) return topo + `<section class="box" style="max-width:460px"><h2>Entrar</h2>
    <label class="f"><span>Email</span><input id="c-email" type="email" autocomplete="username" inputmode="email"></label>
    <label class="f" style="margin-top:10px"><span>Palavra-passe</span><input id="c-senha" type="password" autocomplete="current-password"></label>
    <p class="err small" id="c-err" hidden></p>
    <div class="row" style="margin-top:14px"><button class="btn" data-act="entrar">Entrar</button><button class="link" data-act="recuperar">Esqueci-me da palavra-passe</button></div>
    <p class="muted small" style="margin-top:14px">As contas do escritório são criadas pelo administrador; não há registo aberto ao público.</p></section>`;
  const nObras = S.obras.length;
  const est = e.erro ? `<span class="err">${esc(e.erro)}</span>` : !e.online ? 'Sem internet — as alterações ficam guardadas e são enviadas quando a ligação voltar.' : (e.pend || !e.verificado) ? 'A sincronizar…' : 'Tudo sincronizado.';
  return topo + `<section class="box"><h2>Ligado</h2>
    <div class="kv"><span>Conta</span><b>${esc(e.email)}</b></div>
    <div class="kv" style="margin-top:8px"><span>Estado</span><b>${est}</b></div>
    <div class="kv" style="margin-top:8px"><span>Última sincronização</span><b>${e.ultimaSinc ? e.ultimaSinc.toLocaleString('pt-PT') : '—'}</b></div>
    <div class="kv" style="margin-top:8px"><span>Obras neste aparelho</span><b>${nObras}</b></div>
    <div class="row" style="margin-top:16px"><button class="btn danger" data-act="sair">Sair da conta</button></div>
    <p class="muted small" style="margin-top:10px">Ao sair, os dados ficam neste aparelho mas deixam de sincronizar.</p></section>`;
}

/* ---------- novas linhas ---------- */
function novaObra() {
  return fixObra({ id: uid(), nome: 'Nova obra', cliente: '', local: '', data: hoje(), area: 0, notas: '', honor: { area: 0, casas: 1, servico: (S.cfg.honor.servicos[0] || {}).id || 'completo' }, elementos: [], paredes: [], mo: { modo: 'm2', m2: S.cfg.moM2 }, extras: [], margem: 10, iva: false, classe: 'C25/30' });
}
function novoEl(t, o) {
  const d = TIPOS[t]; const n = o.elementos.filter(e => e.tipo === t).length + 1;
  return { id: uid(), tipo: t, nome: d.pre + n, piso: '', x: d.d[0], y: d.d[1], z: d.d[2] || 0, n: 1, classe: o.classe };
}
function blocoPorEsp(esp) {
  let best = S.cfg.blocos[0], bd = Infinity;
  for (const b of S.cfg.blocos) { const dd = Math.abs(b.esp / 100 - esp); if (dd < bd) { bd = dd; best = b; } }
  return best.id;
}

/* ---------- IFC ---------- */
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="mbox" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; }
function fecharModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });

$('#f-ifc').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  modal(`<h2>A ler ${esc(f.name)}…</h2><p class="muted">Um modelo grande pode demorar alguns segundos.</p>`);
  await new Promise(r => setTimeout(r, 60));
  try { const R = IFC.analyze(await f.text()); pendIfc = { R, nome: f.name }; mostrarIfc(); }
  catch (err) { modal(`<h2>Não foi possível ler o ficheiro</h2><p>${esc(err.message)}</p><div class="row end"><button class="btn" data-act="fecharModal">Fechar</button></div>`); }
});
function mostrarIfc() {
  const { R, nome } = pendIfc; const o = curObra();
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  const linhas = [
    ['Paredes', R.paredes.length, `${fmt(sum(R.paredes, 'comp'), 1)} m · ${fmt(R.paredes.reduce((s, p) => s + Math.max(0, p.comp * p.alt - p.vaos), 0), 1)} m² líquidos`],
    ['Pilares', R.pilares.length, `${fmt(sum(R.pilares, 'vol'), 2)} m³`],
    ['Vigas', R.vigas.length, `${fmt(sum(R.vigas, 'vol'), 2)} m³`],
    ['Lajes', R.lajes.length, `${fmt(sum(R.lajes, 'area'), 1)} m² · ${fmt(sum(R.lajes, 'vol'), 2)} m³`],
    ['Sapatas', R.sapatas.length, `${fmt(sum(R.sapatas, 'vol'), 2)} m³`],
    ['Portas e janelas', R.aberturas.length, `${R.aberturas.filter(a => a.tipo === 'porta').length} portas · ${R.aberturas.filter(a => a.tipo === 'janela').length} janelas`]
  ];
  const temAntes = o.elementos.some(e => e.origem === 'ifc') || o.paredes.some(p => p.origem === 'ifc');
  modal(`<h2>Modelo lido</h2><p class="muted small">${esc(nome)} · ${esc(R.schema)} · ${R.pisos.length} piso(s) · ${R.portas} portas · ${R.janelas} janelas</p>
  <div class="tw"><table class="sum"><tbody>${linhas.map(l => `<tr><td>${l[0]}</td><td>${l[1]}</td><td>${l[2]}</td></tr>`).join('')}</tbody></table></div>
  ${R.semGeo.length ? `<p class="warn small">${R.semGeo.length} elemento(s) sem geometria legível foram ignorados.</p>` : ''}
  <div style="margin-top:14px">
  <label class="f chk"><input type="checkbox" id="ifcPar" ${R.paredes.length ? 'checked' : ''}><span>Importar paredes (alvenaria)</span></label>
  <label class="f chk"><input type="checkbox" id="ifcEst" ${R.pilares.length + R.vigas.length + R.sapatas.length ? 'checked' : ''}><span>Importar pilares, vigas e sapatas</span></label>
  <label class="f chk"><input type="checkbox" id="ifcLaj" ${R.lajes.length ? 'checked' : ''}><span>Importar lajes</span></label>
  <label class="f chk"><input type="checkbox" id="ifcAb" ${R.aberturas.length ? 'checked' : ''}><span>Importar portas e janelas (agrupadas por tamanho)</span></label>
  ${temAntes ? `<label class="f chk"><input type="checkbox" id="ifcSub" checked><span>Substituir o que foi importado antes</span></label>` : ''}
  <label class="f"><span>Classe de betão dos elementos importados</span><select id="ifcClasse">${classOpts().map(([k, t]) => `<option value="${k}" ${k === o.classe ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
  </div>
  <p class="muted small">Depois de importar, reveja as tabelas: pode desmarcar elementos, corrigir alturas e escolher o tipo de bloco de cada parede.</p>
  <div class="row end"><button class="btn sec" data-act="fecharModal">Cancelar</button><button class="btn" data-act="confirmIfc">Importar</button></div>`);
}
function aplicarIfc() {
  const o = curObra(); if (!o || !pendIfc) return fecharModal();
  const R = pendIfc.R, cl = $('#ifcClasse').value, r3 = n => Math.round(n * 1000) / 1000;
  const precoAntes = new Map(o.aberturas.filter(x => x.origem === 'ifc' && x.chave).map(x => [x.chave, x.preco]));
  if ($('#ifcSub') && $('#ifcSub').checked) { o.elementos = o.elementos.filter(e => e.origem !== 'ifc'); o.paredes = o.paredes.filter(p => p.origem !== 'ifc'); o.aberturas = o.aberturas.filter(x => x.origem !== 'ifc'); }
  const n = { par: 0, est: 0, laj: 0, ab: 0 };
  if ($('#ifcAb') && $('#ifcAb').checked) {
    const G = new Map();
    for (const a of R.aberturas) {
      const L = Math.round(a.larg * 100), H = Math.round(a.alt * 100), k = `${a.tipo}|${L}|${H}`;
      let g = G.get(k);
      if (!g) G.set(k, g = { id: uid(), tipo: a.tipo, nome: `${a.tipo === 'porta' ? 'Porta' : 'Janela'} ${L} × ${H} cm`, n: 0, preco: precoAntes.get(k) || 0, origem: 'ifc', chave: k, pisos: new Set() });
      g.n++; if (a.piso) g.pisos.add(a.piso);
    }
    for (const g of G.values()) { g.info = [...g.pisos].join(', '); delete g.pisos; o.aberturas.push(g); n.ab += g.n; }
  }
  if ($('#ifcEst').checked) {
    R.sapatas.forEach(s => { o.elementos.push({ id: uid(), tipo: 'sapata', nome: s.nome, piso: s.piso, x: r3(s.x), y: r3(s.y), z: r3(s.h), n: 1, classe: cl, origem: 'ifc' }); n.est++; });
    R.pilares.forEach(s => { o.elementos.push({ id: uid(), tipo: 'pilar', nome: s.nome, piso: s.piso, x: r3(s.a), y: r3(s.b), z: r3(s.h), n: 1, classe: cl, origem: 'ifc', info: s.nota || '' }); n.est++; });
    R.vigas.forEach(s => { o.elementos.push({ id: uid(), tipo: 'viga', nome: s.nome, piso: s.piso, x: r3(s.b), y: r3(s.h), z: r3(s.L), n: 1, classe: cl, origem: 'ifc', info: s.nota || '' }); n.est++; });
  }
  if ($('#ifcLaj').checked) R.lajes.forEach(s => { o.elementos.push({ id: uid(), tipo: 'laje', nome: s.nome, piso: s.piso, x: r3(s.area), y: r3(s.esp), z: 0, n: 1, classe: cl, origem: 'ifc', info: [s.tipo, s.material].filter(Boolean).join(' · ') }); n.laj++; });
  if ($('#ifcPar').checked) R.paredes.forEach(p => {
    const inf = [`${fmt(p.esp * 100, 0)} cm`, p.material, (p.portas || p.janelas) ? `${p.portas} porta(s), ${p.janelas} janela(s)` : ''].filter(Boolean).join(' · ');
    o.paredes.push({ id: uid(), nome: p.nome, piso: p.piso, comp: r3(p.comp), alt: r3(p.alt), vaos: Math.round(p.vaos * 100) / 100, n: 1, bloco: blocoPorEsp(p.esp), faces: 2, origem: 'ifc', info: inf }); n.par++;
  });
  pendIfc = null; fecharModal(); save(); render();
  toast(`Importado: ${n.par} paredes, ${n.est} pilares/vigas/sapatas, ${n.laj} lajes, ${n.ab} portas/janelas.`);
}

/* ---------- exportar / importar ---------- */
async function exportar() {
  saveNow();
  const ids = S.obras.flatMap(o => o.imgs || []); const imagens = {};
  for (const id of ids) { const v = await IMG.get(id); if (v) imagens[id] = v; }
  const blob = new Blob([JSON.stringify(Object.assign({}, S, { imagens }))], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `orcamentos-${hoje()}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
$('#f-json').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (!d || !Array.isArray(d.obras) || !d.cfg) throw new Error('O ficheiro não é uma cópia do PC Orçamentos.');
    const imagens = d.imagens || {}; delete d.imagens;
    for (const [k, v] of Object.entries(imagens)) await IMG.set(k, v);
    pendJson = migrate(d);
    modal(`<h2>Importar dados</h2><p>O ficheiro tem <b>${pendJson.obras.length}</b> obra(s).</p>
    <p class="muted small"><b>Juntar</b>: acrescenta as obras novas, atualiza as que já existem e fica com o preço mais recente de cada item.<br><b>Substituir</b>: apaga o que está neste aparelho e fica só com o ficheiro.${sincroniza() ? ' <b>Com a conta ligada, isto também se aplica ao seu sócio.</b>' : ''}</p>
    <div class="row end"><button class="btn sec" data-act="fecharModal">Cancelar</button><button class="btn danger" data-act="jsonSub">Substituir tudo</button><button class="btn" data-act="jsonJuntar">Juntar</button></div>`);
  } catch (err) { modal(`<h2>Não foi possível importar</h2><p>${esc(err.message)}</p><div class="row end"><button class="btn" data-act="fecharModal">Fechar</button></div>`); }
});
function juntar(d) {
  for (const o of d.obras) { const i = S.obras.findIndex(x => x.id === o.id); if (i >= 0) S.obras[i] = o; else S.obras.push(o); }
  const mix = (a, b) => { for (const p of b) { const q = a.find(x => x.id === p.id); if (!q) a.push(p); else if ((p.data || '') > (q.data || '')) Object.assign(q, p); } };
  mix(S.precos, d.precos); mix(S.mo, d.mo); mix(S.cfg.blocos, d.cfg.blocos || []);
  for (const k of ['recibo', 'proposta']) S.cfg[k].proximo = Math.max(+S.cfg[k].proximo || 1, +(d.cfg[k] && d.cfg[k].proximo) || 1);
}

/* ---------- textos para partilhar ---------- */
function textoResumo(o) {
  const r = calcObra(o), h = honor(o.honor);
  const L = [`*Orçamento — ${o.nome}*`];
  if (o.cliente) L.push(`Cliente: ${o.cliente}`); if (o.local) L.push(`Local: ${o.local}`);
  if (r.area) L.push(`Área: ${fmt(r.area, 2)} m²`);
  L.push('', '*Materiais*'); r.mat.forEach(m => L.push(`• ${m.nome}: ${fmt(m.qtd, m.un === 'un' || m.un === 'sacos' || m.un === 'kg' ? 0 : 2)} ${m.un} — ${mt(m.tot)}`));
  L.push(`Total de materiais: ${mt(r.matTot)}`, '', `Mão de obra: ${mt(r.moTot)}`);
  if (r.abTot) L.push(`Portas e janelas: ${mt(r.abTot)}`);
  if (r.extTot) L.push(`Outros custos: ${mt(r.extTot)}`);
  if (+o.margem) L.push(`Margem: ${mt(r.margem)}`); if (o.iva) L.push(`IVA: ${mt(r.iva)}`);
  L.push('', `*Total da obra: ${mt(r.total)}*`); if (r.area) L.push(`(${mt(r.porM2)} por m²)`);
  if (h.a > 0) L.push('', `Projeto (${h.serv.nome}): ${mt(h.total)}`);
  return L.join('\n');
}
function textoRecibo(o, p) {
  const E = S.cfg.empresa, { h, antes, valor, pagoAte, falta } = contaPag(o, p);
  const L = [`*RECIBO Nº ${p.numero || 'provisório'}* — ${fData(p.data)}`, E.nome ? E.nome : ''].filter(Boolean);
  L.push('', `Recebemos de *${o.cliente || '—'}*${o.nuit ? ` (NUIT ${o.nuit})` : ''} a quantia de *${mt(valor)}* (${extenso(valor)}), referente a: ${descRecibo(o)}${p.desc ? ' — ' + p.desc : ''}.`, '');
  if (h.desc > 0) L.push(`Valor do projeto: ${mt(h.antes)}`, `Desconto (${h.dNome}): − ${mt(h.desc)}`);
  L.push(`Valor total: ${mt(h.total)}`);
  if (antes > 0) L.push(`Pago anteriormente: ${mt(antes)}`);
  L.push(`Este pagamento: ${mt(valor)} (${p.forma}${p.ref ? ', ref. ' + p.ref : ''})`);
  if (antes > 0) L.push(`Total pago: ${mt(pagoAte)}`);
  L.push(falta > 0 ? `Em falta: ${mt(falta)}` : 'Pago na totalidade.');
  if (E.tel || E.email) L.push('', [E.tel, E.email].filter(Boolean).join(' · '));
  return L.join('\n');
}
function textoProposta(o) {
  const E = S.cfg.empresa, Pr = o.proposta, D = S.cfg.proposta, h = honor(o.honor), r = calcObra(o);
  const val = ou(Pr.validade, D.validade);
  const L = [`*PROPOSTA Nº ${Pr.numero}* — ${fData(Pr.data)}`, E.nome || ''].filter(Boolean);
  L.push('', `Para: ${o.cliente || '—'}`, `Obra: ${o.nome}${o.local ? ', ' + o.local : ''}`);
  if (Pr.projeto) {
    L.push('', '*Projeto*', `${h.serv.nome} — ${fmtA(h.a)} m²${h.casas > 1 ? ` × ${h.casas} casas` : ''}`);
    linhas(ou(Pr.inclui, D.inclui)).forEach(x => L.push('• ' + x));
    if (h.desc > 0) L.push(`Valor: ${mt(h.antes)} − ${h.dNome} ${mt(h.desc)}`);
    L.push(`*Valor do projeto: ${mt(h.total)}*`, `Prazo: ${ou(Pr.prazo, D.prazo)}`);
  }
  if (Pr.obra) {
    L.push('', '*Orçamento da obra*'); linhasObra(o, r).forEach(([nm, v]) => L.push(`• ${nm}: ${mt(v)}`));
    if (o.iva) L.push(`• IVA: ${mt(r.iva)}`);
    L.push(`*Valor da obra: ${mt(r.total)}*${r.area ? ` (${mt(r.porM2)}/m²)` : ''}`); if (Pr.prazoObra) L.push(`Prazo: ${Pr.prazoObra}`);
  }
  L.push('', '*Condições*'); linhas(ou(Pr.condicoes, D.condicoes)).forEach(x => L.push('• ' + x));
  L.push(`• Válida até ${fData(dataMais(Pr.data, val))}`); linhas(Pr.notas).forEach(x => L.push('• ' + x));
  if (E.tel || E.email) L.push('', [E.tel, E.email].filter(Boolean).join(' · '));
  return L.join('\n');
}
async function partilhar(titulo, texto) {
  if (navigator.share) { try { await navigator.share({ title: titulo, text: texto }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(texto); toast('Texto copiado. Cole no WhatsApp ou no email.'); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = texto; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Texto copiado.'); } catch (_) { toast('Não foi possível copiar.'); } ta.remove(); }
}

/* ---------- eventos ---------- */
function conv(el) { if (el.type === 'checkbox') return el.checked; if ('n' in el.dataset) return ('z' in el.dataset && el.value.trim() === '') ? null : toNum(el.value); return el.value; }
function stamp(p) { if (/^(precos|mo|cfg\.blocos)\.\d+\.preco$/.test(p)) getP(p.replace(/\.preco$/, '')).data = hoje(); }
document.addEventListener('input', e => {
  const el = e.target, p = el.dataset && el.dataset.b;
  if (!p || el.type === 'checkbox' || el.tagName === 'SELECT') return;
  setP(p, conv(el)); stamp(p); save(); refresh();
});
document.addEventListener('change', e => {
  const el = e.target, p = el.dataset && el.dataset.b; if (!p) return;
  if (el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date') { setP(p, conv(el)); save(); render(); }
  else if (/^cfg\.(honor\.escaloes|classes|descontos|empresa)|\.nome$/.test(p) && !/^obras/.test(p)) render();
});
document.addEventListener('toggle', e => {
  const d = e.target; if (!(d instanceof HTMLDetailsElement) || !d.dataset.k) return;
  const k = d.dataset.k; if (d.open) { abertos.add(k); abertos.delete('!' + k); } else { abertos.delete(k); abertos.add('!' + k); }
}, true);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, o = curObra();
  switch (a) {
    case 'nova': { const ob = novaObra(); S.obras.push(ob); saveNow(); location.hash = `#/obra/${ob.id}/dados`; return; }
    case 'apagarObra': if (!confirm(`Apagar a obra "${o.nome}"? Não é possível desfazer.`)) return; (o.imgs || []).forEach(id => IMG.del(id)); S.obras = S.obras.filter(x => x !== o); saveNow(); location.hash = '#/'; return;
    case 'duplicarObra': { const c = JSON.parse(JSON.stringify(o)); c.id = uid(); c.nome += ' (cópia)'; c.pagamentos = []; c.imgs = []; c.proposta.numero = ''; S.obras.push(c); saveNow(); location.hash = `#/obra/${c.id}/dados`; toast('Obra duplicada.'); return; }
    case 'areaObra': o.honor.area = +o.area || 0; break;
    case 'addEl': o.elementos.push(novoEl(b.dataset.t, o)); abertos.add('el-' + b.dataset.t); break;
    case 'addPar': o.paredes.push({ id: uid(), nome: 'Parede ' + (o.paredes.length + 1), piso: '', comp: 0, alt: 3, vaos: 0, n: 1, bloco: (S.cfg.blocos[1] || S.cfg.blocos[0]).id, faces: 2 }); abertos.add('par'); break;
    case 'addExtra': o.extras.push({ id: uid(), nome: '', qtd: 1, un: 'vg', pu: 0 }); break;
    case 'del': removeAt(b.dataset.p); break;
    case 'classeTodos': o.elementos.forEach(e => e.classe = o.classe); toast(`Classe ${o.classe} aplicada a todos os elementos.`); break;
    case 'altTodas': { const v = toNum($('#bulkAlt').value); if (!(v > 0)) { toast('Escreva uma altura.'); return; } o.paredes.forEach(p => { if (p.incluir !== false) p.alt = v; }); toast(`Altura de ${fmt(v, 2)} m aplicada às paredes incluídas.`); break; }
    case 'blTodas': { const v = $('#bulkBl').value; o.paredes.forEach(p => { if (p.incluir !== false) p.bloco = v; }); toast('Bloco aplicado às paredes incluídas.'); break; }
    case 'ifc': $('#f-ifc').click(); return;
    case 'confirmIfc': aplicarIfc(); return;
    case 'fecharModal': fecharModal(); return;
    case 'exportar': exportar(); return;
    case 'importar': $('#f-json').click(); return;
    case 'jsonSub': S = pendJson; pendJson = null; posMigrar(); fecharModal(); saveNow(); render(); toast('Dados substituídos.'); return;
    case 'jsonJuntar': juntar(pendJson); pendJson = null; posMigrar(); fecharModal(); saveNow(); render(); toast('Dados juntados.'); return;
    case 'imprimir': window.print(); return;
    case 'copiar': partilhar('Orçamento — ' + o.nome, textoResumo(o)); return;
    case 'addPag': {
      const h = honor(o.honor), falta = Math.max(0, h.total - totalPago(o));
      o.pagamentos.push({ id: uid(), numero: sincroniza() ? '' : proximoNum('recibo'), data: hoje(), desc: '', valor: falta, forma: 'Numerário', ref: '' });
      if (sincroniza()) setTimeout(() => SYNC.numerar(), 400); // número único partilhado pelos sócios
      toast('Pagamento registado. Corrija o valor se for só uma parte.'); break;
    }
    case 'delPag': {
      const p = o.pagamentos.find(x => x.id === b.dataset.id); if (!p) return;
      if (!confirm(`Apagar o pagamento do recibo ${p.numero}? Este número de recibo não volta a ser usado.`)) return;
      o.pagamentos = o.pagamentos.filter(x => x !== p); break;
    }
    case 'partilharRecibo': { const p = o.pagamentos.find(x => x.id === b.dataset.id); if (p) partilhar('Recibo ' + p.numero, textoRecibo(o, p)); return; }
    case 'abrirProposta':
      if (!o.proposta.numero) { if (sincroniza()) SYNC.numerarProposta(o.id); else { o.proposta.numero = proximoNum('proposta', 'P-'); saveNow(); } }
      return; // o link segue para a proposta
    case 'partilharProposta': partilhar('Proposta ' + o.proposta.numero, textoProposta(o)); return;
    case 'addAb': o.aberturas.push({ id: uid(), tipo: 'janela', nome: 'Janela', n: 1, preco: 0 }); break;
    case 'addImg': {
      const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.multiple = true;
      f.onchange = async () => {
        for (const file of [...f.files].slice(0, 4 - o.imgs.length)) {
          try { const url = await reduzirImagem(file); const id = 'img_' + uid(); await IMG.set(id, url); o.imgs.push(id); }
          catch (err) { toast('Não foi possível usar a imagem ' + file.name); }
        }
        saveNow(); render();
      };
      f.click(); return;
    }
    case 'delImg': { const id = b.dataset.id; o.imgs = o.imgs.filter(x => x !== id); IMG.del(id); break; }
    case 'addLogo': {
      const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
      f.onchange = async () => {
        const file = f.files[0]; if (!file) return;
        try {
          const url = await reduzirImagem(file, 900, 'image/png'); const id = 'logo_' + uid();
          await IMG.set(id, url.length > 900000 ? await reduzirImagem(file, 900) : url);
          if (S.cfg.empresa.logo) IMG.del(S.cfg.empresa.logo);
          S.cfg.empresa.logo = id; saveNow(); render(); toast('Logotipo guardado.');
        } catch (err) { toast('Não foi possível usar esta imagem.'); }
      };
      f.click(); return;
    }
    case 'delLogo': if (S.cfg.empresa.logo) IMG.del(S.cfg.empresa.logo); S.cfg.empresa.logo = ''; break;
    case 'entrar': case 'recuperar': {
      const em = $('#c-email').value, pw = $('#c-senha').value, er = $('#c-err');
      if (!em || (a === 'entrar' && !pw)) { er.textContent = a === 'entrar' ? 'Escreva o email e a palavra-passe.' : 'Escreva o seu email primeiro.'; er.hidden = false; return; }
      b.disabled = true;
      const r = a === 'entrar' ? await SYNC.entrar(em, pw) : await SYNC.recuperar(em);
      b.disabled = false;
      if (r) { er.textContent = r; er.hidden = false; } else if (a === 'recuperar') toast('Enviámos um email para mudar a palavra-passe.'); else toast('Bem-vindo! A sincronizar…');
      return;
    }
    case 'sair': if (!confirm('Sair da conta neste aparelho? Os dados ficam guardados aqui, mas deixam de sincronizar.')) return; await SYNC.sair(); render(); return;
    case 'recarregar': location.reload(); return;
    case 'hoje': [...S.precos, ...S.mo, ...S.cfg.blocos].forEach(p => p.data = hoje()); toast('Datas atualizadas.'); break;
    case 'addEsc': { const E = S.cfg.honor.escaloes; const prev = E.length > 1 ? +E[E.length - 2].ate : 0; E.splice(E.length - 1, 0, { ate: prev + 150, preco: E[E.length - 1].preco }); break; }
    case 'addServ': S.cfg.honor.servicos.push({ id: uid(), nome: 'Novo serviço', fator: 100 }); break;
    case 'addDesc': S.cfg.descontos.push({ id: uid(), nome: 'Novo desconto', pct: 5 }); break;
    case 'addClasse': S.cfg.classes.push({ id: 'C?/?', antiga: '', traco: [1, 2, 3], ac: 0.5, uso: '' }); break;
    case 'addBloco': S.cfg.blocos.push({ id: uid(), nome: 'Novo bloco', comp: 40, alt: 20, esp: 15, junta: 1, preco: 0, data: hoje() }); break;
    case 'repor': { if (!confirm('Repor todas as definições e preços de origem? As obras mantêm-se.')) return; const d = defaults(); const emp = S.cfg.empresa, rec = S.cfg.recibo; S.cfg = d.cfg; S.cfg.empresa = emp; S.cfg.recibo = rec; S.precos = d.precos; S.mo = d.mo; toast('Definições repostas.'); break; }
    default: return;
  }
  save(); render();
});
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

/* ---------- arranque ---------- */
S = loadState();
posMigrar();
render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
