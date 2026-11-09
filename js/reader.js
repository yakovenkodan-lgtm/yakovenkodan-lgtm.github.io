(function () {
  'use strict';
  var KEY = 'chitanka.file.v1';
  var PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  var PDF_CMAP = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/';
  var $ = function (id) { return document.getElementById(id); };
  var state = { title: 'Моя книжка', pages: [], idx: 0, bookmark: 0 };
  var speak = { start: 0, pos: 0, utter: null, playing: false };

  try {
    localStorage.removeItem('chitanka.gtoken');
    localStorage.removeItem('chitanka.everSignedIn');
    localStorage.removeItem('chitanka.oauthState');
    localStorage.removeItem('chitanka.driveRoot');
  } catch (e) {}

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY) || localStorage.getItem('chitanka.pdf.v1');
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.pages)) {
        state.title = data.title || 'Моя книжка';
        state.pages = data.pages;
        state.bookmark = Math.max(0, data.bookmark | 0);
        state.idx = Math.min(state.pages.length - 1, Math.max(0, data.idx != null ? data.idx : state.bookmark));
      }
    } catch (e) {}
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        title: state.title,
        pages: state.pages.map(function (p) { return { id: p.id, text: p.text || '', createdAt: p.createdAt }; }),
        idx: state.idx,
        bookmark: state.bookmark
      }));
    } catch (e) {
      toast('На телефоні замало місця, тож збереглася тільки частина.');
    }
  }

  function toast(msg) {
    var t = $('toast');
    t.hidden = false;
    t.textContent = msg;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, 3600);
  }

  function langOf(text) {
    return /[іїєґІЇЄҐ]/.test(text) ? 'uk-UA' : (/[ыэъёЫЭЪЁ]/.test(text) ? 'ru-RU' : 'uk-UA');
  }

  function pickVoice(lang) {
    var voices = speechSynthesis.getVoices() || [];
    var pref = lang.slice(0, 2).toLowerCase();
    return voices.find(function (v) { return v.lang && v.lang.toLowerCase().indexOf(pref) === 0; }) || null;
  }

  function stopSpeak() {
    speak.playing = false;
    speak.utter = null;
    try { speechSynthesis.cancel(); } catch (e) {}
    $('bListen').textContent = 'Прослухати';
  }

  function speakFrom(start) {
    var page = state.pages[state.idx];
    var text = page && page.text ? page.text : '';
    if (!text) { toast('На цій сторінці ще немає тексту.'); return; }
    if (!window.speechSynthesis) {
      toast('На цій сторінці натисни «Прослухати» ще раз, або надішли PDF мені в чат.');
      return;
    }
    stopSpeak();
    start = Math.max(0, Math.min(text.length, start | 0));
    speak.start = start;
    speak.pos = start;
    var u = new SpeechSynthesisUtterance(text.slice(start));
    u.lang = langOf(text);
    var v = pickVoice(u.lang);
    if (v) u.voice = v;
    u.rate = 1;
    u.onboundary = function (e) {
      if (e && (e.name === 'word' || e.charIndex >= 0)) speak.pos = speak.start + (e.charIndex || 0);
    };
    u.onend = function () {
      if (speak.utter === u) { speak.playing = false; speak.pos = text.length; $('bListen').textContent = 'Прослухати'; }
    };
    u.onerror = function () {
      if (speak.utter === u) { speak.playing = false; $('bListen').textContent = 'Прослухати'; }
    };
    speak.utter = u;
    speak.playing = true;
    $('bListen').textContent = 'Пауза';
    speechSynthesis.speak(u);
  }

  function render() {
    $('bookTitle').value = state.title;
    var n = state.pages.length;
    var empty = $('emptyHint');
    var box = $('pageText');
    var img = $('preview');
    if (!n) {
      $('pageInfo').textContent = 'Сторінок ще немає';
      empty.hidden = false;
      box.textContent = '';
      img.hidden = true;
      img.removeAttribute('src');
      return;
    }
    state.idx = Math.max(0, Math.min(n - 1, state.idx));
    var page = state.pages[state.idx];
    $('pageInfo').textContent = 'Сторінка ' + (state.idx + 1) + ' з ' + n + (state.bookmark === state.idx ? ' · закладка' : '');
    empty.hidden = true;
    if (page.image) { img.src = page.image; img.hidden = false; }
    else { img.hidden = true; img.removeAttribute('src'); }
    box.textContent = '';
    if (!page.text) {
      box.appendChild(document.createTextNode('Тут не видно тексту. Ця сторінка схожа на малюнок без букв.'));
    } else {
      page.text.split(/\n\s*\n/).forEach(function (para) {
        var t = para.trim();
        if (!t) return;
        var p = document.createElement('p');
        p.textContent = t;
        box.appendChild(p);
      });
    }
  }

  function go(d) {
    if (!state.pages.length) return;
    stopSpeak();
    speak.pos = 0;
    state.idx = Math.max(0, Math.min(state.pages.length - 1, state.idx + d));
    save();
    render();
  }

  function estimateChars(sec) { return Math.round(sec * 12); }

  function itemsToText(items) {
    var lines = [];
    var buf = [];
    var lastY = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var y = it.transform ? it.transform[5] : 0;
      if (lastY != null && Math.abs(y - lastY) > 6 && buf.length) {
        lines.push(buf.join(''));
        buf = [];
      }
      var s = it.str || '';
      if (buf.length && s && !/ $/.test(buf[buf.length - 1]) && !/^ |^[,.;:!?»)\]-]/.test(s)) buf.push(' ');
      buf.push(s);
      lastY = y;
      if (it.hasEOL) {
        lines.push(buf.join(''));
        buf = [];
        lastY = null;
      }
    }
    if (buf.length) lines.push(buf.join(''));
    return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function hasText(s) {
    return /[A-Za-zА-Яа-яІіЇїЄєҐґЁёЫыЭэЪъ]{8,}/.test(s || '');
  }

  function titleFromName(name) {
    return String(name || '').replace(/\.(pdf|fb2|txt)$/i, '').trim() || 'Моя книжка';
  }

  function fileKind(file) {
    var name = ((file && file.name) || '').toLowerCase();
    if (file && (file.type === 'application/pdf' || name.endsWith('.pdf'))) return 'pdf';
    if (name.endsWith('.fb2')) return 'fb2';
    if (name.endsWith('.txt')) return 'txt';
    return '';
  }

  function pageObj(text, i) {
    return { id: Date.now() + '-' + i, text: text || '', createdAt: Date.now() };
  }

  function splitParas(paras) {
    var pages = [], chunk = [], len = 0, TARGET = 1800;
    function flush() {
      var t = chunk.join('\n\n').trim();
      if (t) pages.push(t);
      chunk = []; len = 0;
    }
    (paras || []).forEach(function (p) {
      p = (p || '').trim();
      if (!p) return;
      if (len + p.length > TARGET && chunk.length) flush();
      chunk.push(p);
      len += p.length;
    });
    flush();
    return pages;
  }

  function fb2Els(doc, tag) {
    var ns = 'http://www.gribuser.ru/xml/fictionbook/2.0';
    var a = doc.getElementsByTagNameNS(ns, tag);
    if (a && a.length) return a;
    return doc.getElementsByTagName(tag);
  }

  function parasFrom(node) {
    var out = [];
    function walk(n) {
      if (!n || n.nodeType !== 1) return;
      var tag = (n.localName || n.tagName || '').toLowerCase();
      tag = tag.replace(/^.*:/, '');
      if (tag === 'p' || tag === 'subtitle' || tag === 'v' || tag === 'text-author' || tag === 'title') {
        var t = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
        return;
      }
      if (tag === 'empty-line') { out.push(''); return; }
      var kids = n.childNodes;
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
    }
    walk(node);
    return out;
  }

  function readFb2Text(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('bad-fb2');
    var titles = fb2Els(doc, 'book-title');
    var title = titles.length ? (titles[0].textContent || '').replace(/\s+/g, ' ').trim() : '';
    var bodies = Array.prototype.filter.call(fb2Els(doc, 'body'), function (b) {
      var name = (b.getAttribute('name') || '').toLowerCase();
      return name !== 'notes' && name !== 'comments';
    });
    var texts = [];
    bodies.forEach(function (body) {
      var kids = body.children || body.childNodes;
      var sawSection = false;
      for (var i = 0; i < kids.length; i++) {
        var child = kids[i];
        if (!child || child.nodeType !== 1) continue;
        var tag = (child.localName || child.tagName || '').toLowerCase().replace(/^.*:/, '');
        if (tag === 'section') {
          sawSection = true;
          splitParas(parasFrom(child)).forEach(function (t) { texts.push(t); });
        } else if (tag === 'title' || tag === 'epigraph' || tag === 'p') {
          splitParas(parasFrom(child)).forEach(function (t) { texts.push(t); });
        }
      }
      if (!sawSection && !texts.length) splitParas(parasFrom(body)).forEach(function (t) { texts.push(t); });
    });
    if (!texts.length) throw new Error('empty-fb2');
    return { title: title, pages: texts.map(function (t, i) { return pageObj(t, i + 1); }) };
  }

  async function readFb2(file) {
    var xml = await file.text();
    return readFb2Text(xml);
  }

  async function readTxt(file) {
    var raw = await file.text();
    var parts = raw.split('\f');
    if (parts.length < 2) parts = raw.split(/\n\s*\n\s*\n/);
    var paras = [];
    parts.forEach(function (part) {
      String(part).split(/\n\s*\n/).forEach(function (p) { paras.push(p); });
    });
    var texts = splitParas(paras);
    if (!texts.length) throw new Error('empty-txt');
    return texts.map(function (t, i) { return pageObj(t, i + 1); });
  }

  async function ocrCanvas(canvas, onProgress) {
    if (!window.Tesseract) return '';
    var result = await Tesseract.recognize(canvas, 'rus+ukr', {
      logger: function (m) {
        if (m && m.status === 'recognizing text' && typeof m.progress === 'number') onProgress(m.progress);
      }
    });
    return ((result && result.data && result.data.text) || '').replace(/\u000c/g, '').trim();
  }

  async function renderPageCanvas(page, scale) {
    var viewport = page.getViewport({ scale: scale || 1.4 });
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    return canvas;
  }

  async function readPdf(file, onStatus) {
    if (!window.pdfjsLib) throw new Error('no-pdfjs');
    var buf = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({
      data: buf,
      cMapUrl: PDF_CMAP,
      cMapPacked: true
    }).promise;
    var out = [];
    for (var i = 1; i <= pdf.numPages; i++) {
      onStatus('Читаю PDF: сторінка ' + i + ' з ' + pdf.numPages + '…');
      var page = await pdf.getPage(i);
      var content = await page.getTextContent();
      var text = itemsToText(content.items || []);
      if (!hasText(text)) {
        onStatus('Розпізнаю сторінку ' + i + ' з ' + pdf.numPages + '…');
        try {
          var canvas = await renderPageCanvas(page, 1.5);
          text = await ocrCanvas(canvas, function (p) {
            onStatus('Розпізнаю сторінку ' + i + ' з ' + pdf.numPages + '… ' + Math.round(p * 100) + '%');
          });
        } catch (e) {}
      }
      out.push({
        id: Date.now() + '-' + i,
        text: text || '',
        createdAt: Date.now()
      });
    }
    return out;
  }

  async function addFiles(files) {
    files = Array.prototype.filter.call(files || [], function (f) { return !!fileKind(f); });
    if (!files.length) { toast('Обери файл книжки: PDF або FB2.'); return; }
    var status = $('status');
    status.hidden = false;
    $('fileAny').disabled = true;
    for (var i = 0; i < files.length; i++) {
      var kind = fileKind(files[i]);
      status.textContent = 'Відкриваю файл…';
      try {
        var pages, bookTitle = '';
        if (kind === 'pdf') {
          pages = await readPdf(files[i], function (msg) { status.textContent = msg; });
        } else if (kind === 'fb2') {
          status.textContent = 'Читаю FB2…';
          var fb = await readFb2(files[i]);
          pages = fb.pages;
          bookTitle = fb.title || '';
        } else {
          status.textContent = 'Читаю текст…';
          pages = await readTxt(files[i]);
        }
        if (!state.pages.length || state.title === 'Моя книжка') state.title = bookTitle || titleFromName(files[i].name);
        state.pages = state.pages.concat(pages);
        state.idx = Math.max(0, state.pages.length - pages.length);
        save();
        render();
        toast('Готово: ' + pages.length + ' стор. Можна читати або слухати.');
      } catch (e) {
        toast('Цей файл не вдалося відкрити. Спробуй PDF або FB2.');
      }
    }
    status.hidden = true;
    $('fileAny').disabled = false;
    $('fileAny').value = '';
  }

  $('bookTitle').addEventListener('change', function () {
    state.title = ($('bookTitle').value || 'Моя книжка').trim() || 'Моя книжка';
    save();
  });
  $('fileAny').addEventListener('change', function (e) { addFiles(e.target.files); });
  $('bPrev').addEventListener('click', function () { go(-1); });
  $('bNext').addEventListener('click', function () { go(1); });
  $('bMark').addEventListener('click', function () {
    if (!state.pages.length) { toast('Спершу додай файл.'); return; }
    state.bookmark = state.idx;
    save();
    render();
    toast('Закладку поставлено на сторінку ' + (state.idx + 1) + '.');
  });
  $('bListen').addEventListener('click', function () {
    if (!state.pages.length) { toast('Спершу додай файл.'); return; }
    if (speak.playing) { stopSpeak(); return; }
    speakFrom(speak.pos && speak.pos < ((state.pages[state.idx] || {}).text || '').length ? speak.pos : 0);
  });
  $('bBack').addEventListener('click', function () {
    var text = ((state.pages[state.idx] || {}).text || '');
    if (!text) return;
    speakFrom(Math.max(0, speak.pos - estimateChars(15)));
  });
  $('bFwd').addEventListener('click', function () {
    var text = ((state.pages[state.idx] || {}).text || '');
    if (!text) return;
    var next = Math.min(text.length, speak.pos + estimateChars(30));
    if (next >= text.length) { stopSpeak(); toast('Кінець сторінки.'); return; }
    speakFrom(next);
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; } catch (e) {}

  load();
  render();
})();
