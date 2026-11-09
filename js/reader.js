(function () {
  'use strict';
  var KEY = 'chitanka.photo.v1';
  var $ = function (id) { return document.getElementById(id); };
  var state = { title: 'Моя книжка', pages: [], idx: 0, bookmark: 0 };
  var speak = { start: 0, pos: 0, utter: null, playing: false };

  try {
    localStorage.removeItem('chitanka.gtoken');
    localStorage.removeItem('chitanka.everSignedIn');
    localStorage.removeItem('chitanka.oauthState');
    localStorage.removeItem('chitanka.driveRoot');
  } catch (e) {}

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
        pages: state.pages,
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
      toast('Надішли фото мені в чат — прочитаю вголос.');
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
      box.appendChild(document.createTextNode('Тут не видно тексту. Надішли це фото мені в чат — розпізнаю і прочитаю вголос.'));
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
    state.idx = Math.max(0, Math.min(state.pages.length - 1, state.idx + d));
    save();
    render();
  }

  function estimateChars(sec) { return Math.round(sec * 12); }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {}
    }
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); ok(im); };
      im.onerror = function () { URL.revokeObjectURL(url); bad(new Error('image')); };
      im.src = url;
    });
  }

  function drawSized(source, max) {
    var w = source.width, h = source.height;
    if (!w || !h) return null;
    var scale = Math.min(1, max / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d').drawImage(source, 0, 0, cw, ch);
    return canvas;
  }

  async function recognize(file, onProgress) {
    var bmp = await loadBitmap(file);
    var work = drawSized(bmp, 1600);
    var preview = drawSized(bmp, 720);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    var image = preview ? preview.toDataURL('image/jpeg', 0.7) : '';
    var text = '';
    if (window.Tesseract && work) {
      var result = await Tesseract.recognize(work, 'rus+ukr', {
        logger: function (m) {
          if (m && m.status === 'recognizing text' && typeof m.progress === 'number') onProgress(m.progress);
        }
      });
      text = ((result && result.data && result.data.text) || '').replace(/\u000c/g, '').trim();
    }
    return { text: text, image: image };
  }

  async function addFiles(files) {
    files = Array.prototype.filter.call(files || [], function (f) { return f && f.type && f.type.indexOf('image/') === 0; });
    if (!files.length) { toast('Обери фото сторінки.'); return; }
    var status = $('status');
    status.hidden = false;
    $('filePages').disabled = true;
    for (var i = 0; i < files.length; i++) {
      status.textContent = 'Розпізнаю ' + (i + 1) + ' з ' + files.length + '…';
      try {
        var page = await recognize(files[i], function (p) {
          status.textContent = 'Розпізнаю ' + (i + 1) + ' з ' + files.length + '… ' + Math.round(p * 100) + '%';
        });
        state.pages.push({ id: Date.now() + '-' + i, text: page.text, image: page.image, createdAt: Date.now() });
        state.idx = state.pages.length - 1;
        save();
        render();
      } catch (e) {
        state.pages.push({ id: Date.now() + '-' + i, text: '', image: '', createdAt: Date.now() });
        state.idx = state.pages.length - 1;
        save();
        render();
        toast('Цю сторінку не вдалося розпізнати. Надішли фото мені в чат.');
      }
    }
    status.hidden = true;
    $('filePages').disabled = false;
    $('filePages').value = '';
    if (state.pages.length) toast('Готово. Можна читати або слухати.');
  }

  $('bookTitle').addEventListener('change', function () {
    state.title = ($('bookTitle').value || 'Моя книжка').trim() || 'Моя книжка';
    save();
  });
  $('filePages').addEventListener('change', function (e) { addFiles(e.target.files); });
  $('bPrev').addEventListener('click', function () { go(-1); });
  $('bNext').addEventListener('click', function () { go(1); });
  $('bMark').addEventListener('click', function () {
    if (!state.pages.length) { toast('Спершу додай фото сторінки.'); return; }
    state.bookmark = state.idx;
    save();
    render();
    toast('Закладку поставлено на сторінку ' + (state.idx + 1) + '.');
  });
  $('bListen').addEventListener('click', function () {
    if (!state.pages.length) { toast('Спершу додай фото сторінки.'); return; }
    if (speak.playing) { stopSpeak(); return; }
    speakFrom(speak.pos && speak.pos < ((state.pages[state.idx] || {}).text || '').length ? speak.pos : 0);
  });
  $('bBack').addEventListener('click', function () {
    var text = ((state.pages[state.idx] || {}).text || '');
    if (!text) return;
    var next = Math.max(0, (speak.playing ? speak.pos : speak.pos) - estimateChars(15));
    speakFrom(next);
  });
  $('bFwd').addEventListener('click', function () {
    var text = ((state.pages[state.idx] || {}).text || '');
    if (!text) return;
    var next = Math.min(text.length, (speak.playing ? speak.pos : speak.pos) + estimateChars(30));
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
