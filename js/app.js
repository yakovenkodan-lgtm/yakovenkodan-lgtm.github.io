/* Читанка — мобільна версія: інтерфейс. Уся мова інтерфейсу — українська. */
(function () {
  'use strict';
  const VERSION = '1.0.0';
  const CFG = window.CHITANKA_CONFIG || {};
  const L = window.ChitankaLabels;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  let mode = CFG.mode || 'auto';
  if (params.get('demo') === '1') mode = 'demo';
  if (mode === 'auto') mode = CFG.googleClientId ? 'drive' : 'demo';
  const source = mode === 'drive' ? new window.ChitankaDriveSource(CFG) : new window.ChitankaDemoSource(CFG.demoBase || '../demo-data/');
  const lib = new window.ChitankaLibrary(source);

  const S = { books: [], book: null, pageIdx: 0, coverUrl: null, openSheet: null, cachedNames: {}, busy: false };
  const LS = (k, v) => { const key = 'chitanka.' + source.kind + '.' + k; if (v === undefined) return localStorage.getItem(key); if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, String(v)); };

  /* ---------- налаштування ---------- */
  const DEF = { fs: 22, theme: 'light', face: 'sans', autoNext: true };
  let set = Object.assign({}, DEF);
  try { Object.assign(set, JSON.parse(localStorage.getItem('chitanka.settings') || '{}')); } catch (e) {}
  function applySettings() {
    const r = document.documentElement;
    r.style.setProperty('--fs', set.fs + 'px');
    r.classList.toggle('theme-warm', set.theme === 'warm');
    r.classList.toggle('theme-dark', set.theme === 'dark');
    r.classList.toggle('face-serif', set.face === 'serif');
    if (player) player.autoNext = !!set.autoNext;
  }
  function saveSettings() { localStorage.setItem('chitanka.settings', JSON.stringify(set)); applySettings(); }

  /* ---------- програвач ---------- */
  const player = new window.ChitankaPlayer($('audio'), lib, {
    onChange: (what) => { updateMini(what); if (S.openSheet === 'sheetAudio') updateAudioSheet(what); },
    onError: (kind) => {
      toast({ download: 'Не вдалося завантажити аудіо. Перевірте інтернет і натисніть ще раз.',
        auth: 'Потрібно знову увійти в Google — натисніть «Оновити».',
        gesture: 'Натисніть ▶, щоб почати.',
        play: 'Цей файл не грає на телефоні. Попросіть Аліну зберегти його як mp3.' }[kind] || 'Помилка аудіо.');
    }
  });
  applySettings();

  /* ---------- дрібниці ---------- */
  let toastT = 0;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 3800);
  }
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
  }
  function mb(n) { n = +n || 0; return n >= 1048576 ? (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }
  function plural(n, one, few, many) { const a = n % 10, b = n % 100; return n + ' ' + (a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many); }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function icon(name) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + name); s.appendChild(u); return s; }
  function setIcon(btn, name) { const u = btn.querySelector('use'); if (u) u.setAttribute('href', '#i-' + name); }
  const online = () => navigator.onLine !== false;

  /* ---------- обкладинка-заглушка: полотняна палітурка з золотим тисненням ---------- */
  function placeholderCover(title) {
    const pal = [['#2e5c54', '#234840'], ['#7a2e2e', '#5e2222'], ['#2c3f6b', '#213052'], ['#6b4a2c', '#523820'], ['#4d3a6b', '#3a2c52']];
    let h = 0; for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [c1, c2] = pal[h % pal.length];
    const words = title.split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > 9 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) lines.push(cur);
    const shown = lines.slice(0, 4);
    const fs = shown.some((l) => l.length > 8) ? 15 : 18;
    const y0 = 62 - (shown.length - 1) * fs * 0.6;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const text = shown.map((l, i) => `<text x="60" y="${(y0 + i * fs * 1.2).toFixed(1)}" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${fs}" fill="#e8c77a">${esc(l)}</text>`).join('');
    return `<svg viewBox="0 0 120 170" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="cg${h}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      <pattern id="cl${h}" width="3" height="3" patternUnits="userSpaceOnUse"><path d="M0 0h3M0 0v3" stroke="#fff" stroke-opacity=".05"/></pattern></defs>
      <rect width="120" height="170" fill="url(#cg${h})"/><rect width="120" height="170" fill="url(#cl${h})"/>
      <rect x="9" y="9" width="102" height="152" fill="none" stroke="#e8c77a" stroke-width="1.6"/>
      <rect x="13" y="13" width="94" height="144" fill="none" stroke="#e8c77a" stroke-width=".6"/>
      ${text}
      <g transform="translate(60 128)" fill="none" stroke="#e8c77a" stroke-width="1.4"><path d="M-14 0h28M0 -9v18"/><circle r="9"/><path d="M-22 0h-6M22 0h6" stroke-linecap="round"/></g>
    </svg>`;
  }

  /* ---------- шапка / обкладинка ---------- */
  function showCover(url, kind) {
    const img = $('coverImg'), ph = $('coverPh'), btn = $('coverBtn');
    btn.classList.toggle('photo', kind === 'photo');
    if (url) { img.src = url; img.hidden = false; ph.hidden = true; }
    else { img.hidden = true; img.removeAttribute('src'); ph.hidden = false; ph.innerHTML = placeholderCover(S.book ? S.book.name : 'Читанка'); }
  }

  /* ---------- сторінка ---------- */
  function pages() { return (S.book && S.book.pages) || []; }
  function renderPage(keepScroll) {
    const ps = pages(), n = ps.length;
    $('bookTitle').textContent = S.book ? S.book.name : 'Читанка';
    const box = $('pageText'); box.textContent = '';
    if (!S.book) { $('pageInfo').textContent = ''; $('pageHead').textContent = ''; return; }
    if (!n) {
      $('pageInfo').textContent = 'Сторінок ще немає';
      $('pageHead').textContent = '';
      box.appendChild(el('p', 'empty', 'У цій книжці ще немає тексту. Коли Аліна розпізнає сторінки, натисніть «Оновити».'));
    } else {
      S.pageIdx = Math.max(0, Math.min(n - 1, S.pageIdx));
      const p = ps[S.pageIdx];
      const label = p.n === S.pageIdx + 1 ? `Сторінка ${p.n} з ${n}` : `Сторінка ${p.n} (${S.pageIdx + 1} з ${n})`;
      $('pageInfo').textContent = label;
      $('pageHead').textContent = 'Сторінка ' + p.n;
      const lang = /[іїєґІЇЄҐ]/.test(p.text) ? 'uk' : (/[ыэъё]/i.test(p.text) ? 'ru' : 'uk');
      box.lang = lang;
      if (!p.text) box.appendChild(el('p', 'empty', 'На цій сторінці ще немає тексту.'));
      else p.text.split(/\n\s*\n/).forEach((para, i) => {
        const t = para.trim(); if (!t) return;
        const isHead = i === 0 && t.length < 70 && !/[.,;:]$/.test(t) && (t === t.toUpperCase() || /^(розділ|глава|часть|частина|вступ|передмова|от )/i.test(t));
        box.appendChild(el('p', isHead ? 'h' : '', t));
      });
      LS('page.' + S.book.id, p.n);
    }
    const src = $('pageSrc');
    const has = n && S.book.audio && L.pageAudioAll(S.book.audio, ps[S.pageIdx].n).length;
    src.textContent = S.book.offline ? 'без інтернету' : (has ? 'є аудіо' : '');
    src.hidden = !src.textContent;
    src.classList.toggle('off', !!S.book.offline);
    $('bPrev').disabled = !n || S.pageIdx <= 0;
    $('bNext').disabled = !n || S.pageIdx >= n - 1;
    $('pageEnd').hidden = !n || S.pageIdx >= n - 1;
    if (!keepScroll) $('reader').scrollTop = 0;
  }
  function go(d) {
    const n = pages().length; if (!n) return;
    const i = S.pageIdx + d; if (i < 0 || i >= n) return;
    S.pageIdx = i; renderPage();
  }

  /* ---------- книжки ---------- */
  async function openBook(book, opts) {
    opts = opts || {};
    const data = await lib.loadBook(book, { force: opts.force });
    const same = S.book && S.book.id === data.id;
    S.book = data;
    LS('book', data.id);
    if (!same || opts.resetPage) {
      const want = +LS('page.' + data.id) || 0;
      const i = data.pages.findIndex((p) => p.n === want);
      S.pageIdx = i >= 0 ? i : 0;
    }
    renderPage(same);
    player.setBook(data, null);
    if (!same || opts.force) {
      showCover(null);
      const url = await lib.coverUrl(data);
      if (S.book !== data) return data;
      S.coverUrl = url;
      showCover(url, data.cover && data.cover.kind);
      window.ChitankaPlayer.artworkFrom(url).then((a) => { if (S.book === data) player.setArtwork(a); });
    }
    if (data.offline) toast('Немає інтернету — показую збережену копію.');
    return data;
  }

  async function loadLibrary(force) {
    const r = await lib.listBooks({ force });
    S.books = r.books;
    return r;
  }

  /* ---------- нижні панелі ---------- */
  function openSheet(id) {
    closeSheet(true);
    S.openSheet = id;
    $('veil').hidden = false; $(id).hidden = false; $(id).scrollTop = 0;
  }
  function closeSheet(silent) {
    if (!S.openSheet) return;
    $(S.openSheet).hidden = true; $('veil').hidden = true; S.openSheet = null;
    if (!silent) $('bListen').focus({ preventScroll: true });
  }
  $('veil').addEventListener('click', () => closeSheet());
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
    if (S.openSheet) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
  });

  /* ---------- аудіо ---------- */
  function currentPageNo() { const p = pages()[S.pageIdx]; return p ? p.n : 0; }
  function openAudio() {
    player.unlock(); // синхронно, у дотику — інакше iPhone не дасть звук
    const list = (S.book && S.book.audio) || [];
    renderAudioList();
    openSheet('sheetAudio');
    updateAudioSheet();
    // як на ПК: якщо рівно один файл саме для цієї сторінки — грає одразу
    const mine = L.pageAudioAll(list, currentPageNo());
    if (mine.length === 1 && !player.cur) player.play(mine[0]);
    list.forEach((f) => lib.isCached(f).then((ok) => { if (ok !== !!S.cachedNames[f.name]) { S.cachedNames[f.name] = ok; if (S.openSheet === 'sheetAudio') renderAudioList(); } }));
  }
  function renderAudioList() {
    const ul = $('audioList'); ul.textContent = '';
    const list = (S.book && S.book.audio) || [];
    $('audioHint').textContent = list.length ? `Аудіо Аліни: ${list.length}. Натисни на назву — почне грати.` : '';
    if (!list.length) {
      const li = el('li', 'empty-list', 'Аудіо для цієї книжки ще немає. Коли Аліна зробить аудіо, натисніть «Оновити».');
      ul.appendChild(li); return;
    }
    const mine = new Set(L.pageAudioAll(list, currentPageNo()).map((f) => f.name));
    list.forEach((f) => {
      const li = el('li');
      const b = el('button', 'arow'); b.type = 'button'; b.dataset.name = f.name;
      const isCur = player.cur && player.cur.name === f.name;
      if (isCur) b.classList.add('cur');
      const ic = el('span', 'ic'); ic.appendChild(icon(isCur ? (player.isPlaying() ? 'pause' : 'play') : (S.cachedNames[f.name] ? 'check' : 'note')));
      const tx = el('span');
      const t = el('span', 't', f.label); if (mine.has(f.name)) t.appendChild(el('span', 'chip', 'ця сторінка'));
      tx.appendChild(t);
      const bits = [];
      if (f.size) bits.push(mb(f.size));
      const pos = +(localStorage.getItem(player.posKey(f)) || 0);
      if (pos > 2 && !isCur) bits.push('продовжити з ' + fmt(pos));
      if (S.cachedNames[f.name]) bits.push('є на телефоні');
      const sub = el('span', 's', bits.join(' · ')); tx.appendChild(sub);
      if (player.loading && player.loading.entry.name === f.name) {
        const l = player.loading, pct = l.total ? Math.round(l.got * 100 / l.total) : 0;
        sub.textContent = 'Завантажую… ' + (l.total ? pct + '%' : mb(l.got));
        const pr = el('span', 'prog'); const i = el('i'); i.style.width = pct + '%'; pr.appendChild(i); tx.appendChild(pr);
      }
      b.append(ic, tx);
      b.addEventListener('click', () => {
        player.unlock();
        if (player.cur && player.cur.name === f.name && !player.loading) player.toggle();
        else player.play(f);
      });
      li.appendChild(b); ul.appendChild(li);
    });
  }
  function updateAudioSheet(what) {
    const a = $('audio'), box = $('playerBox');
    box.hidden = !player.cur;
    if (!player.cur) { if (what !== 'time') renderAudioList(); return; }
    $('plTitle').textContent = player.cur.label;
    const d = isFinite(a.duration) ? a.duration : 0;
    const seek = $('plSeek');
    if (!seek.matches(':active')) { seek.max = Math.max(1, Math.floor(d)); seek.value = Math.floor(a.currentTime || 0); }
    $('plCur').textContent = fmt(a.currentTime); $('plDur').textContent = d ? fmt(d) : (player.loading ? '…' : '0:00');
    setIcon($('plPlay'), player.isPlaying() ? 'pause' : 'play');
    if (what !== 'time') renderAudioList();
    if (what === 'progress') renderAudioList();
  }
  function updateMini() {
    const m = $('mini'), a = $('audio');
    m.hidden = !player.cur;
    $('bListen').classList.toggle('on', player.isPlaying());
    if (!player.cur) return;
    $('miniTitle').textContent = player.cur.label;
    const d = isFinite(a.duration) ? a.duration : 0;
    if (player.loading) {
      const l = player.loading;
      $('miniTime').textContent = 'Завантажую… ' + (l.total ? Math.round(l.got * 100 / l.total) + '%' : '');
      $('miniFill').style.width = (l.total ? l.got * 100 / l.total : 0) + '%';
    } else {
      $('miniTime').textContent = fmt(a.currentTime) + ' / ' + (d ? fmt(d) : '…');
      $('miniFill').style.width = (d ? a.currentTime * 100 / d : 0) + '%';
    }
    setIcon($('miniPlay'), player.isPlaying() ? 'pause' : 'play');
  }
  $('plPlay').addEventListener('click', () => player.toggle());
  $('plBack').addEventListener('click', () => player.seekBy(-15));
  $('plFwd').addEventListener('click', () => player.seekBy(30));
  $('plStop').addEventListener('click', () => { player.stop(); renderAudioList(); });
  $('plSeek').addEventListener('input', (e) => { $('plCur').textContent = fmt(+e.target.value); });
  $('plSeek').addEventListener('change', (e) => player.seekTo(+e.target.value));
  $('miniPlay').addEventListener('click', () => player.toggle());
  $('miniStop').addEventListener('click', () => player.stop());
  $('miniInfo').addEventListener('click', () => openAudio());

  /* ---------- книжки: вибір ---------- */
  async function openBooks() {
    openSheet('sheetBooks');
    renderBooks();
    if (online() && (!source.needsAuth || source.isSignedIn())) {
      try { await loadLibrary(true); if (S.openSheet === 'sheetBooks') renderBooks(); } catch (e) { handleErr(e); }
    }
  }
  function renderBooks() {
    const ul = $('bookList'); ul.textContent = '';
    if (!S.books.length) { ul.appendChild(el('li', 'empty-list', 'Книжок ще немає. На ПК у Читанці має бути ввімкнено «Зберігати на Гугл Диск».')); return; }
    S.books.forEach((bk) => {
      const li = el('li'), b = el('button', 'brow'); b.type = 'button';
      if (S.book && S.book.id === bk.id) b.classList.add('cur');
      const bc = el('span', 'bc'); bc.innerHTML = placeholderCover(bk.name);
      lib.bookCoverUrl(bk).then((u) => { if (u) { const im = new Image(); im.alt = ''; im.src = u; bc.textContent = ''; bc.appendChild(im); } });
      const tx = el('span'); tx.appendChild(el('span', 'bt', bk.name));
      const c = lib.cachedBook(bk.id);
      const sub = [];
      if (S.book && S.book.id === bk.id) sub.push('відкрита зараз');
      if (c && c.audio) sub.push(plural(c.audio.length, 'аудіофайл', 'аудіофайли', 'аудіофайлів'));
      tx.appendChild(el('span', 'bs', sub.join(' · ') || 'натисни, щоб відкрити'));
      b.append(bc, tx);
      b.addEventListener('click', async () => {
        closeSheet();
        if (S.book && S.book.id === bk.id) return;
        try { await openBook(bk, { resetPage: true }); } catch (e) { handleErr(e); }
      });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  /* ---------- оновити ---------- */
  async function refresh() {
    if (S.busy) return;
    if (!online()) { toast('Немає інтернету. Показую збережену копію.'); return; }
    if (source.needsAuth && !source.isSignedIn()) { if (player.isPlaying()) player.pause(); source.signIn({ silent: source.everSignedIn() }); return; }
    S.busy = true; $('bRefresh').classList.add('busy');
    try {
      const before = S.book ? { p: S.book.pages.length, a: S.book.audio.length, t: S.book.textFile && (S.book.textFile.md5Checksum || S.book.textFile.modifiedTime) } : null;
      await loadLibrary(true);
      let bk = S.book && S.books.find((b) => b.id === S.book.id);
      if (!bk) bk = S.books[0];
      if (bk) {
        const d = await openBook(bk, { force: true });
        const t = d.textFile && (d.textFile.md5Checksum || d.textFile.modifiedTime);
        if (before && before.p === d.pages.length && before.a === d.audio.length && before.t === t) toast('Усе вже свіже. Нового немає.');
        else toast(`Оновлено: ${plural(d.pages.length, 'сторінка', 'сторінки', 'сторінок')}, аудіо: ${d.audio.length}.`);
      } else { renderPage(); toast('Книжок ще немає.'); }
    } catch (e) { handleErr(e); }
    finally { S.busy = false; $('bRefresh').classList.remove('busy'); }
  }

  function handleErr(e) {
    console.warn(e);
    if (e && e.auth) { if (source.needsAuth && online()) { toast('Входжу в Google…'); setTimeout(() => source.signIn({ silent: true }), 600); } else toast('Потрібно увійти в Google.'); return; }
    if (e && e.noFolder) { toast('На Гугл Диску ще немає папки «Читанка». Увімкніть на ПК «Зберігати на Гугл Диск».', 6000); return; }
    toast(online() ? 'Не вдалося отримати книжку. Спробуйте «Оновити» ще раз.' : 'Немає інтернету.');
  }

  /* ---------- налаштування ---------- */
  function openSettings() {
    $('sFont').value = set.fs;
    document.querySelectorAll('#sTheme .sw').forEach((b) => b.classList.toggle('sel', b.dataset.theme === set.theme));
    document.querySelectorAll('#sFace .sw').forEach((b) => b.classList.toggle('sel', b.dataset.face === set.face));
    $('sAuto').checked = !!set.autoNext;
    const drive = source.kind === 'drive';
    $('sAccount').textContent = drive
      ? (source.isSignedIn() || source.everSignedIn() ? 'Підключено. Книжки беруться з папки «Мій диск / ' + (CFG.driveFolder || 'Читанка') + '».' : 'Ще не підключено.')
      : 'Зараз показано приклади (демо). Гугл Диск ще не підключено.';
    $('sSignOut').hidden = !drive;
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    $('sInstallCard').hidden = standalone || !/iP(hone|ad|od)/.test(navigator.userAgent);
    $('sVersion').textContent = 'Читанка для телефона · версія ' + VERSION + ' · ' + (drive ? 'Гугл Диск' : 'демо');
    updateStorage();
    openSheet('sheetSettings');
  }
  function updateStorage() {
    lib.storageInfo().then((i) => { $('sStorage').textContent = i.count ? `Файлів: ${i.count}, ${mb(i.bytes)}. Їх можна читати й слухати без інтернету.` : 'Поки нічого. Прослухані файли зберігаються самі.'; });
  }
  $('sFont').addEventListener('input', (e) => { set.fs = +e.target.value; saveSettings(); });
  $('sTheme').addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (!b) return; set.theme = b.dataset.theme; saveSettings(); openSettingsRefresh(); });
  $('sFace').addEventListener('click', (e) => { const b = e.target.closest('[data-face]'); if (!b) return; set.face = b.dataset.face; saveSettings(); openSettingsRefresh(); });
  function openSettingsRefresh() {
    document.querySelectorAll('#sTheme .sw').forEach((b) => b.classList.toggle('sel', b.dataset.theme === set.theme));
    document.querySelectorAll('#sFace .sw').forEach((b) => b.classList.toggle('sel', b.dataset.face === set.face));
  }
  $('sAuto').addEventListener('change', (e) => { set.autoNext = e.target.checked; saveSettings(); });
  $('sSaveAll').addEventListener('click', async () => {
    const list = (S.book && S.book.audio) || [];
    if (!list.length) { toast('У цій книжці ще немає аудіо.'); return; }
    if (!online()) { toast('Немає інтернету.'); return; }
    let i = 0;
    for (const f of list) {
      i++;
      try { await lib.getBlob(f, { onProgress: (g, t) => { $('sStorage').textContent = `Зберігаю ${i} з ${list.length}: ${f.label} — ${t ? Math.round(g * 100 / t) + '%' : mb(g)}`; } }); S.cachedNames[f.name] = true; }
      catch (e) { handleErr(e); break; }
    }
    updateStorage(); toast('Аудіо збережено на телефоні.');
  });
  $('sClear').addEventListener('click', async () => {
    if (!confirm('Видалити збережене на телефоні аудіо? На Гугл Диску нічого не зміниться.')) return;
    const n = await lib.clearAudio(); S.cachedNames = {}; updateStorage(); toast(n ? 'Збережене аудіо видалено.' : 'Нічого було видаляти.');
  });
  $('sSignOut').addEventListener('click', () => {
    if (!confirm('Вийти з Гугл акаунта в Читанці?')) return;
    player.stop(); source.signOut(); closeSheet(); showSignIn();
  });

  /* ---------- вхід ---------- */
  function showSignIn(err) {
    $('signin').hidden = false;
    $('signinErr').hidden = !err; $('signinErr').textContent = err || '';
  }
  $('bSignIn').addEventListener('click', () => source.signIn({ silent: false }));

  /* ---------- кнопки ---------- */
  $('bListen').addEventListener('click', openAudio);
  $('bPrev').addEventListener('click', () => go(-1));
  $('bNext').addEventListener('click', () => go(1));
  $('bNextInline').addEventListener('click', () => go(1));
  $('bBooks').addEventListener('click', openBooks);
  $('bRefresh').addEventListener('click', refresh);
  $('bSettings').addEventListener('click', openSettings);
  $('coverBtn').addEventListener('click', openBooks);

  // гортання пальцем уліво/вправо
  (function swipe() {
    let x0 = 0, y0 = 0, t0 = 0, multi = false;
    const r = $('reader');
    r.addEventListener('touchstart', (e) => { multi = e.touches.length > 1; if (multi) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); }, { passive: true });
    r.addEventListener('touchmove', (e) => { if (e.touches.length > 1) multi = true; }, { passive: true });
    r.addEventListener('touchend', (e) => {
      if (multi || !e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Date.now() - t0 < 700 && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  /* ---------- старт ---------- */
  async function start() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    let redirect = null;
    if (source.kind === 'drive') {
      redirect = source.handleRedirect();
      if (redirect && !redirect.ok) {
        sessionStorage.setItem('chitanka.silentFailed', '1');
        if (!redirect.silent && redirect.error !== 'state') { showSignIn(redirect.error === 'access_denied' ? 'Вхід скасовано. Спробуйте ще раз і натисніть «Продовжити» / «Дозволити».' : 'Не вдалося увійти. Спробуйте ще раз.'); }
      }
    }
    const lastId = LS('book');
    const cachedBooks = lib.getMeta('books') || [];
    if (source.kind === 'drive' && !CFG.googleClientId) {
      // опублікована копія до того, як з'явився OAuth-клієнт Google
      showSignIn('Читанку ще налаштовують. Скоро тут можна буде увійти.');
      $('bSignIn').disabled = true; renderPage(); return;
    }
    const needAuth = source.kind === 'drive' && !source.isSignedIn();
    if (needAuth) {
      const recentlyTried = Date.now() - (+localStorage.getItem('chitanka.silentAt') || 0) < 120000;
      const canSilent = source.everSignedIn() && online() && !sessionStorage.getItem('chitanka.silentFailed') && !recentlyTried;
      if (canSilent) { localStorage.setItem('chitanka.silentAt', String(Date.now())); source.signIn({ silent: true }); return; }
      if (!cachedBooks.length) { if ($('signin').hidden) showSignIn(); renderPage(); return; }
      S.books = cachedBooks;
      const bk = cachedBooks.find((b) => b.id === lastId) || cachedBooks[0];
      try { await openBook(bk); } catch (e) { renderPage(); }
      toast('Щоб побачити нове з Гугл Диска, натисніть «Оновити».', 5000);
      return;
    }
    try {
      await loadLibrary(online());
      if (!S.books.length) { renderPage(); $('bookTitle').textContent = 'Книжок ще немає'; toast('На Гугл Диску в папці «Читанка» ще немає книжок.', 6000); return; }
      const bk = S.books.find((b) => b.id === (params.get('book') || lastId)) || S.books[0];
      await openBook(bk);
      if (redirect && redirect.ok && !redirect.silent) toast('Готово! Тепер Читанка бачить ваші книжки.');
    } catch (e) {
      renderPage();
      handleErr(e);
    }
  }
  window.addEventListener('online', () => { if (S.book && S.book.offline) toast('Інтернет з’явився. Натисніть «Оновити».'); });
  window.__chitanka = { S, player, lib, source, go, openAudio, openBooks, openSettings, refresh };
  start();
})();
