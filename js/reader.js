(function () {
  'use strict';
  var KEY = 'chitanka.pdf.v1';
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
      var raw = localStorage.getItem(KEY);
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
    return String(name || '').replace(/\.pdf$/i, '').trim() || 'Моя книжка';
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
    files = Array.prototype.filter.call(files || [], function (f) {
      var name = (f && f.name || '').toLowerCase();
      return f && (f.type === 'application/pdf' || name.endsWith('.pdf'));
    });
    if (!files.length) { toast('Обери файл PDF.'); return; }
    var status = $('status');
    status.hidden = false;
    $('filePdf').disabled = true;
    for (var i = 0; i < files.length; i++) {
      status.textContent = 'Відкриваю PDF…';
      try {
        var pages = await readPdf(files[i], function (msg) { status.textContent = msg; });
        if (!state.pages.length || state.title === 'Моя книжка') state.title = titleFromName(files[i].name);
        state.pages = state.pages.concat(pages);
        state.idx = Math.max(0, state.pages.length - pages.length);
        save();
        render();
        toast('Готово: ' + pages.length + ' стор. Можна читати або слухати.');
      } catch (e) {
        toast('Цей PDF не вдалося відкрити. Спробуй інший файл.');
      }
    }
    status.hidden = true;
    $('filePdf').disabled = false;
    $('filePdf').value = '';
  }

  $('bookTitle').addEventListener('change', function () {
    state.title = ($('bookTitle').value || 'Моя книжка').trim() || 'Моя книжка';
    save();
  });
  $('filePdf').addEventListener('change', function (e) { addFiles(e.target.files); });
  $('bPrev').addEventListener('click', function () { go(-1); });
  $('bNext').addEventListener('click', function () { go(1); });
  $('bMark').addEventListener('click', function () {
    if (!state.pages.length) { toast('Спершу додай PDF.'); return; }
    state.bookmark = state.idx;
    save();
    render();
    toast('Закладку поставлено на сторінку ' + (state.idx + 1) + '.');
  });
  $('bListen').addEventListener('click', function () {
    if (!state.pages.length) { toast('Спершу додай PDF.'); return; }
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
