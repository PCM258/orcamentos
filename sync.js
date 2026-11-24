// Sincronização entre aparelhos e sócios (Firebase Auth + Firestore, com cache offline).
// Os dados de trabalho continuam em localStorage (app.js); este módulo envia as diferenças para a nuvem
// e aplica as alterações que chegam dos outros aparelhos. Sem configuração, não faz nada.
const V = '11.0.2', CDN = `https://www.gstatic.com/firebasejs/${V}/`;
const ESC = ['escritorios', 'principal'];

let cfgFb = null;
try { cfgFb = (await import('./firebase-config.js')).FIREBASE; } catch (e) { }

if (!cfgFb || !cfgFb.apiKey) {
  window.SYNC = null;
} else {
  try {
    const [A, U, F] = await Promise.all([import(CDN + 'firebase-app.js'), import(CDN + 'firebase-auth.js'), import(CDN + 'firebase-firestore.js')]);
    iniciar(A, U, F);
  } catch (e) {
    console.warn('Sincronização indisponível', e);
    window.SYNC = { configurado: true, ativo: () => false, estado: () => ({ configurado: true, falhou: true, online: navigator.onLine }) };
  }
}
window.APP && APP.estadoSync();

function iniciar(A, U, F) {
  const app = A.initializeApp(cfgFb);
  const auth = U.getAuth(app);
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { db = F.initializeFirestore(app, { localCache: F.memoryLocalCache() }); }

  const refEsc = F.doc(db, ...ESC);
  const colObras = F.collection(db, ...ESC, 'obras');
  const refObra = id => F.doc(db, ...ESC, 'obras', id);
  const refImg = id => F.doc(db, ...ESC, 'imagens', id);

  let user = null, unsubs = [], base = null, meta = {};
  let prontoObras = false, prontoCfg = false, verificado = false, pend = false, ultimaSinc = null, erro = '';
  // Comparação independente da ordem dos campos (o Firestore devolve os campos noutra ordem)
  const ordenar = v => Array.isArray(v) ? v.map(ordenar) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => (o[k] = ordenar(v[k]), o), {}) : v;
  const J = v => JSON.stringify(v === undefined ? null : ordenar(v));
  const limpo = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
  const quem = () => (user && (user.email || user.uid)) || '';
  const avisar = () => APP.estadoSync();

  function estado() { return { configurado: true, email: user && user.email, online: navigator.onLine, pend, pronto: prontoObras, verificado, ultimaSinc, erro }; }

  function parar() { unsubs.forEach(f => f()); unsubs = []; base = null; prontoObras = prontoCfg = verificado = false; }
  function comecar() {
    parar(); base = { cfg: {}, obras: {} }; erro = '';
    unsubs.push(F.onSnapshot(refEsc, { includeMetadataChanges: true }, snapCfg, falha));
    unsubs.push(F.onSnapshot(colObras, { includeMetadataChanges: true }, snapObras, falha));
  }
  function falha(e) {
    erro = e && e.code === 'permission-denied' ? 'Esta conta ainda não tem acesso ao escritório.' : ((e && e.message) || String(e));
    avisar();
  }

  // Definições e preços (um documento)
  function snapCfg(snap) {
    if (!base) return;
    const S0 = APP.S();
    if (!snap.exists()) {
      if (!snap.metadata.fromCache && !prontoCfg) { prontoCfg = true; push(); } // nuvem vazia: envia as deste aparelho
      return;
    }
    if (snap.metadata.hasPendingWrites) { prontoCfg = true; return; }
    const d = snap.data(); let mudou = false;
    for (const [k, v] of Object.entries(d.cfg || {})) {
      const rj = J(v), key = 'cfg.' + k;
      if (rj !== base.cfg[key]) { if (J(S0.cfg[k]) !== rj) { S0.cfg[k] = v; mudou = true; } base.cfg[key] = rj; }
    }
    for (const g of ['precos', 'mo']) for (const [id, it] of Object.entries(d[g] || {})) {
      const rj = J(it), key = g + '.' + id;
      if (rj !== base.cfg[key]) {
        const i = S0[g].findIndex(x => x.id === id);
        if (i < 0) { S0[g].push(it); mudou = true; } else if (J(S0[g][i]) !== rj) { S0[g][i] = it; mudou = true; }
        base.cfg[key] = rj;
      }
    }
    const primeira = !prontoCfg; prontoCfg = true;
    if (mudou) APP.remoto();
    if (primeira) push();
    if (!snap.metadata.fromCache) { ultimaSinc = new Date(); avisar(); }
  }

  // Obras (um documento por obra; junta campo a campo)
  function snapObras(snap) {
    if (!base) return;
    const S0 = APP.S(); let mudou = false;
    for (const ch of snap.docChanges()) {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (!ch.doc.metadata.hasPendingWrites && base.obras[id]) {
          const n = S0.obras.length; S0.obras = S0.obras.filter(o => o.id !== id);
          if (S0.obras.length !== n) mudou = true;
          delete base.obras[id];
        }
        continue;
      }
      if (ch.doc.metadata.hasPendingWrites) continue; // é o eco das nossas próprias alterações
      const r = ch.doc.data();
      meta[id] = { por: r._por || '', em: r._em && r._em.toDate ? r._em.toDate() : null };
      delete r._por; delete r._em; r.id = id;
      const b = base.obras[id] || (base.obras[id] = {});
      let o = S0.obras.find(x => x.id === id);
      if (!o) { o = { id }; S0.obras.push(o); mudou = true; }
      for (const [k, v] of Object.entries(r)) {
        const rj = J(v);
        if (rj !== b[k]) { if (J(o[k]) !== rj) { o[k] = v; mudou = true; } b[k] = rj; }
      }
    }
    const primeira = !prontoObras; prontoObras = true;
    if (!snap.metadata.fromCache) { ultimaSinc = new Date(); if (!verificado) { verificado = true; push(); numerar(); } }
    if (mudou) APP.remoto();
    if (primeira) push();
    avisar();
  }

  let tPush;
  function agendar() { clearTimeout(tPush); tPush = setTimeout(push, 300); }
  function push() {
    if (!user || !base || !prontoObras) return;
    const S0 = APP.S(); let ops = 0;
    if (prontoCfg) {
      const pay = {}; let n = 0;
      for (const k of Object.keys(S0.cfg)) { const j = J(S0.cfg[k]), key = 'cfg.' + k; if (j !== base.cfg[key]) { (pay.cfg = pay.cfg || {})[k] = limpo(S0.cfg[k]); base.cfg[key] = j; n++; } }
      for (const g of ['precos', 'mo']) for (const it of S0[g]) { const j = J(it), key = g + '.' + it.id; if (j !== base.cfg[key]) { (pay[g] = pay[g] || {})[it.id] = limpo(it); base.cfg[key] = j; n++; } }
      if (n) { ops++; F.setDoc(refEsc, Object.assign(pay, { _em: F.serverTimestamp(), _por: quem() }), { merge: true }).catch(falha); }
      const logo = pay.cfg && pay.cfg.empresa && pay.cfg.empresa.logo;
      if (logo) APP.imgLocal(logo).then(v => v && imgUp(logo, v)); // o logotipo vai com as definições
    }
    const ids = new Set();
    for (const o of S0.obras) {
      ids.add(o.id);
      const b = base.obras[o.id];
      if (!b) {
        if (!verificado) continue; // só envia obras novas depois de confirmar o que já está na nuvem
        const dados = limpo(o), nb = {};
        for (const k of Object.keys(dados)) nb[k] = J(dados[k]);
        base.obras[o.id] = nb; ops++;
        F.setDoc(refObra(o.id), Object.assign(dados, { _em: F.serverTimestamp(), _por: quem() })).catch(falha);
        (o.imgs || []).forEach(id => APP.imgLocal(id).then(v => v && imgUp(id, v)));
        continue;
      }
      const pay = {}; let n = 0;
      for (const k of Object.keys(o)) { const j = J(o[k]); if (j !== b[k]) { pay[k] = limpo(o[k]); b[k] = j; n++; } }
      for (const k of Object.keys(b)) if (!(k in o)) { pay[k] = F.deleteField(); delete b[k]; n++; }
      if (n) { ops++; F.setDoc(refObra(o.id), Object.assign(pay, { _em: F.serverTimestamp(), _por: quem() }), { merge: true }).catch(falha); }
    }
    for (const id of Object.keys(base.obras)) if (!ids.has(id)) { delete base.obras[id]; ops++; F.deleteDoc(refObra(id)).catch(falha); }
    if (ops) {
      pend = true; avisar();
      F.waitForPendingWrites(db).then(() => { pend = false; ultimaSinc = new Date(); avisar(); }).catch(() => { });
    }
  }

  // Imagens (renders): um documento por imagem
  function imgUp(id, data) {
    if (!user) return;
    if (data.length > 1000000) { APP.toast('Esta imagem é grande demais para sincronizar; fica só neste aparelho.'); return; }
    F.setDoc(refImg(id), { data, _por: quem() }).catch(() => { });
  }
  async function imgGet(id) { if (!user) return null; try { const s = await F.getDoc(refImg(id)); return s.exists() ? s.data().data : null; } catch (e) { return null; } }
  function imgDel(id) { if (user) F.deleteDoc(refImg(id)).catch(() => { }); }

  // Numeração única de recibos e propostas, partilhada pelos sócios (precisa de internet)
  async function reservar(k, pre) {
    const n = await F.runTransaction(db, async t => {
      const s = await t.get(refEsc);
      const c = Math.max(1, +(((s.data() || {}).cfg || {})[k] || {}).proximo || 1);
      t.set(refEsc, { cfg: { [k]: { proximo: c + 1 } } }, { merge: true });
      return c;
    });
    return `${pre}${String(n).padStart(4, '0')}/${new Date().toISOString().slice(0, 4)}`;
  }
  let numerando = false;
  async function numerar() {
    if (!user || !verificado || numerando || !navigator.onLine) return;
    numerando = true; let mudou = false;
    try {
      const falta = [];
      for (const o of APP.S().obras) for (const p of o.pagamentos || []) if (!p.numero) falta.push([o.id, p.id]);
      for (const [oid, pid] of falta) {
        const num = await reservar('recibo', '');
        // procura de novo: durante a espera a obra pode ter sido atualizada pela nuvem
        const o = APP.S().obras.find(x => x.id === oid), p = o && (o.pagamentos || []).find(x => x.id === pid);
        if (p && !p.numero) { p.numero = num; mudou = true; APP.guardar(); }
      }
    }
    catch (e) { console.warn('Numeração adiada', e); }
    numerando = false;
    if (mudou) { APP.guardar(); APP.renderRemoto(); }
  }
  async function numerarProposta(id) {
    const o = APP.S().obras.find(x => x.id === id);
    if (!o || o.proposta.numero || !user || !navigator.onLine) return;
    try {
      const num = await reservar('proposta', 'P-');
      const o2 = APP.S().obras.find(x => x.id === id);
      if (o2 && !o2.proposta.numero) { o2.proposta.numero = num; APP.guardar(); APP.renderRemoto(); }
    } catch (e) { console.warn('Numeração adiada', e); }
  }

  const ERROS = {
    'auth/invalid-credential': 'Email ou palavra-passe errados.', 'auth/wrong-password': 'Email ou palavra-passe errados.', 'auth/user-not-found': 'Email ou palavra-passe errados.',
    'auth/invalid-email': 'O email não é válido.', 'auth/too-many-requests': 'Demasiadas tentativas. Espere uns minutos.',
    'auth/network-request-failed': 'Sem internet. Para entrar pela primeira vez é preciso ligação.', 'auth/user-disabled': 'Esta conta foi desativada.'
  };
  const msg = e => ERROS[e && e.code] || (e && e.message) || 'Erro desconhecido.';
  async function entrar(email, senha) { try { await U.signInWithEmailAndPassword(auth, email.trim(), senha); return ''; } catch (e) { return msg(e); } }
  async function sair() { await U.signOut(auth); }
  async function recuperar(email) { try { await U.sendPasswordResetEmail(auth, email.trim()); return ''; } catch (e) { return msg(e); } }

  U.onAuthStateChanged(auth, u => { user = u; if (u) comecar(); else parar(); avisar(); });
  addEventListener('online', () => { avisar(); push(); numerar(); });
  addEventListener('offline', avisar);

  window.SYNC = {
    configurado: true, ativo: () => !!user, estado, push: agendar, imgUp, imgGet, imgDel,
    numerar, numerarProposta, entrar, sair, recuperar, meta: id => meta[id]
  };
}
