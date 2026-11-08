/* Читанка — назви аудіофайлів і розбір текстового файлу.
   Порт Get-AudioEntryInfo / Resolve-AudioToPlay / Find-PageAudioAll з Chitanka.ps1 (PROTOCOL.md §7). */
(function (root) {
  'use strict';
  var DASH = '\u2013';
  var AUDIO_EXT = ['.mp3', '.m4a', '.wav', '.ogg', '.opus', '.wma', '.aac'];
  var IMAGE_EXT = ['.jpg', '.jpeg', '.png'];

  function ext(name) {
    var i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i).toLowerCase() : '';
  }
  function baseName(name) {
    var i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  function audioEntryInfo(fileName) {
    var base = baseName(fileName);
    var b = base.toLowerCase();
    var o = { kind: 'other', from: 0, to: 0, label: base, sortKey: '' };
    var m;
    if ((m = /^(glavy|glavi|glava|chapters?|глави|глава)[ _-]*0*(\d{1,4})(?:\s*[-_–]\s*0*(\d{1,4}))?$/.exec(b))) {
      o.kind = 'chapter'; o.from = +m[2]; o.to = m[3] ? +m[3] : +m[2];
      o.label = o.to > o.from ? ('Глави ' + o.from + DASH + o.to) : ('Глава ' + o.from);
      o.sortKey = '1|' + pad(o.from, 6) + '|' + pad(o.to, 6);
    } else if ((m = /^(storinky|storinki|pages|сторінки)[ _-]*0*(\d{1,6})\s*[-_–]\s*0*(\d{1,6})$/.exec(b))) {
      o.kind = 'pages'; o.from = +m[2]; o.to = +m[3];
      o.label = 'Сторінки ' + o.from + DASH + o.to;
      o.sortKey = '2|' + pad(o.from, 6) + '|' + pad(o.to, 6);
    } else if ((m = /^page_0*(\d{1,6})$/.exec(b))) {
      o.kind = 'page'; o.from = +m[1]; o.to = o.from;
      o.label = 'Сторінка ' + o.from;
      o.sortKey = '2|' + pad(o.from, 6) + '|' + pad(o.from, 6);
    } else if ((m = /(глави|главы|glavy|chapters?)\D{0,3}0*(\d{1,4})\s*[-_–]\s*0*(\d{1,4})/.exec(b))) {
      o.kind = 'chapter'; o.from = +m[2]; o.to = +m[3];
      o.sortKey = '1|' + pad(o.from, 6) + '|' + pad(o.to, 6) + '|' + b;
    } else if ((m = /(сторінки|страницы|storinky|pages)\D{0,3}0*(\d{1,6})\s*[-_–]\s*0*(\d{1,6})/.exec(b))) {
      o.kind = 'pages'; o.from = +m[2]; o.to = +m[3];
      o.sortKey = '2|' + pad(o.from, 6) + '|' + pad(o.to, 6) + '|' + b;
    } else {
      o.sortKey = '3|' + b.replace(/\d+/g, function (d) { return pad(d, 8); });
    }
    return o;
  }

  function isAudioName(name) {
    return AUDIO_EXT.indexOf(ext(name)) >= 0 && !/\.tmp$/i.test(name) && !/\.part$/i.test(name);
  }

  // files: [{name, size, ...}] -> audio entries sorted like the desktop list
  function audioList(files) {
    var out = [];
    (files || []).forEach(function (f) {
      if (!isAudioName(f.name)) return;
      if (f.size !== undefined && f.size !== null && +f.size <= 0) return;
      var i = audioEntryInfo(f.name);
      out.push(Object.assign({}, f, i));
    });
    out.sort(function (a, b) {
      if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
      return a.name.localeCompare(b.name, 'uk');
    });
    return out;
  }

  function pageAudioAll(list, page) {
    var out = [];
    if (!(page > 0)) return out;
    list.forEach(function (f) { if (f.kind === 'page' && f.from === page) out.push(f); });
    list.forEach(function (f) { if (f.kind === 'pages' && page >= f.from && page <= f.to) out.push(f); });
    return out;
  }

  // «<книжка> — текст.txt»: «Сторінка N» + порожній рядок + текст. Повертає [{n, text}].
  function parseBookText(txt) {
    txt = String(txt || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var lines = txt.split('\n');
    var pages = [], cur = null, buf = [];
    function flush() {
      if (cur !== null) {
        var t = buf.join('\n').replace(/^\n+|\s+$/g, '');
        if (t === '(тексту ще немає)') t = '';
        pages.push({ n: cur, text: t });
      }
    }
    for (var i = 0; i < lines.length; i++) {
      var m = /^\s*Сторінка\s+(\d{1,6})\s*$/.exec(lines[i]);
      var prevBlank = i === 0 || lines[i - 1].trim() === '';
      if (m && prevBlank) { flush(); cur = +m[1]; buf = []; continue; }
      if (cur === null) { if (lines[i].trim() === '') continue; cur = 1; buf = []; }
      buf.push(lines[i]);
    }
    flush();
    return pages;
  }

  // Обкладинка: cover.jpg/.png > фото першої сторінки (page_NNNN з найменшим номером) > null
  function pickCover(files) {
    var byName = {};
    (files || []).forEach(function (f) { byName[f.name.toLowerCase()] = f; });
    var c = byName['cover.jpg'] || byName['cover.jpeg'] || byName['cover.png'];
    if (c) return { file: c, kind: 'cover' };
    var best = null, bestN = Infinity;
    (files || []).forEach(function (f) {
      var m = /^page_0*(\d{1,6})\.(jpg|jpeg|png)$/i.exec(f.name);
      if (m && +m[1] < bestN) { bestN = +m[1]; best = f; }
    });
    return best ? { file: best, kind: 'photo' } : null;
  }

  function pickTextFile(files) {
    var txt = (files || []).filter(function (f) { return ext(f.name) === '.txt' && !/\.tmp$/i.test(f.name) && !/\.speak\.txt$/i.test(f.name); });
    var main = txt.filter(function (f) { return / — текст\.txt$/i.test(f.name); });
    return (main[0] || txt[0]) || null;
  }

  function mimeFor(name) {
    var e = ext(name);
    return ({ '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.opus': 'audio/ogg', '.wma': 'audio/x-ms-wma', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.txt': 'text/plain; charset=utf-8' })[e] || 'application/octet-stream';
  }

  var api = { audioEntryInfo: audioEntryInfo, audioList: audioList, pageAudioAll: pageAudioAll, parseBookText: parseBookText,
    pickCover: pickCover, pickTextFile: pickTextFile, isAudioName: isAudioName, mimeFor: mimeFor, ext: ext, IMAGE_EXT: IMAGE_EXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ChitankaLabels = api;
})(this);
