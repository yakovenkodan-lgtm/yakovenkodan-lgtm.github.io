(function () {
  'use strict';
  var KEY = 'chitanka.file.v1';
  var PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  var PDF_CMAP = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/';
  var $ = function (id) { return document.getElementById(id); };
  var state = { title: 'Моя книжка', pages: [], idx: 0, bookmark: 0 };
  var speak = { start: 0, pos: 0, utter: null, playing: false, token: 0, audio: null, url: null, engine: '', chunks: [], chunkIdx: 0, nextBlob: null };

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

  var ORT_JS = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.wasm.min.js';
  var ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/';
  var PHON_JS = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.js';
  var PHON_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
  var VOICE_CACHE = 'chitanka-voice-v1';
  var PIPER_VOICES = {
    'uk-UA': {
      key: 'uk_UA-ukrainian_tts-medium',
      url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/uk/uk_UA/ukrainian_tts/medium/uk_UA-ukrainian_tts-medium.onnx',
      speaker: 0,
      label: 'Лада'
    },
    'ru-RU': {
      key: 'ru_RU-irina-medium',
      url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx',
      speaker: 0,
      label: 'Ірина'
    }
  };
  var piper = { scripts: false, sessions: {}, lock: Promise.resolve() };

  function pickVoice(lang) {
    var voices = [];
    try { voices = speechSynthesis.getVoices() || []; } catch (e) { voices = []; }
    var pref = String(lang || 'uk-UA').slice(0, 2).toLowerCase();
    var scored = voices.map(function (v) {
      var l = (v.lang || '').toLowerCase();
      var n = (v.name || '').toLowerCase();
      var score = 0;
      if (l.indexOf(pref) === 0) score += 100;
      else if (l.indexOf('uk') === 0 || l.indexOf('ru') === 0) score += 25;
      if (/neural|premium|enhanced|natural|online|wavenet|studio/.test(n)) score += 50;
      if (/lesya|леся|polina|ostap|irina|milena|katya|lada|tetiana|solomiia|oksana/.test(n)) score += 30;
      if (v.localService === false) score += 8;
      if (/espeak|compact|dummy|robot/.test(n)) score -= 80;
      return { v: v, score: score };
    }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score; });
    return scored.length ? scored[0].v : null;
  }

  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!speak.ctx) speak.ctx = new AC();
        if (speak.ctx.state === 'suspended') speak.ctx.resume();
      }
    } catch (e) {}
    if (!speak.audio) speak.audio = new Audio();
    if (!speak.unlocked) {
      speak.unlocked = true;
      try {
        speak.audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
        var p = speak.audio.play();
        if (p && p.then) p.then(function () { try { speak.audio.pause(); } catch (e2) {} }).catch(function () {});
      } catch (e3) {}
    }
  }

  function haltAudio() {
    speak.utter = null;
    try { speechSynthesis.cancel(); } catch (e) {}
    if (speak.audio) {
      try {
        speak.audio.onended = null;
        speak.audio.onerror = null;
        speak.audio.pause();
      } catch (e2) {}
    }
    if (speak.url) {
      try { URL.revokeObjectURL(speak.url); } catch (e3) {}
      speak.url = null;
    }
  }

  function stopSpeak() {
    speak.playing = false;
    speak.token = (speak.token || 0) + 1;
    speak.nextBlob = null;
    haltAudio();
    var btn = $('bListen');
    if (btn) btn.textContent = 'Прослухати';
    var st = $('status');
    if (st && /голос|Готую|Завантаж/i.test(st.textContent || '')) st.hidden = true;
  }

  function setListen(on) {
    var btn = $('bListen');
    if (btn) btn.textContent = on ? 'Пауза' : 'Прослухати';
  }

  function voiceStatus(msg) {
    var st = $('status');
    if (!st) return;
    if (!msg) { st.hidden = true; return; }
    st.hidden = false;
    st.textContent = msg;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var found = document.querySelector('script[data-chitanka="' + src + '"]');
      if (found) {
        if (found.getAttribute('data-ok') === '1') return resolve();
        found.addEventListener('load', function () { resolve(); });
        found.addEventListener('error', function () { reject(new Error('script')); });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.setAttribute('data-chitanka', src);
      s.onload = function () { s.setAttribute('data-ok', '1'); resolve(); };
      s.onerror = function () { reject(new Error('script')); };
      document.head.appendChild(s);
    });
  }

  function pcmToWav(floatData, sampleRate) {
    var n = floatData.length;
    var view = new DataView(new ArrayBuffer(44 + n * 2));
    function four(at, str) {
      for (var i = 0; i < 4; i++) view.setUint8(at + i, str.charCodeAt(i));
    }
    four(0, 'RIFF');
    view.setUint32(4, 36 + n * 2, true);
    four(8, 'WAVE');
    four(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    four(36, 'data');
    view.setUint32(40, n * 2, true);
    var o = 44;
    for (var i = 0; i < n; i++) {
      var s = floatData[i];
      if (s > 1) s = 1;
      if (s < -1) s = -1;
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      o += 2;
    }
    return view.buffer;
  }

  async function cachedFetch(url, onProgress) {
    var cache = null;
    try { cache = await caches.open(VOICE_CACHE); } catch (e) { cache = null; }
    if (cache) {
      try {
        var hit = await cache.match(url);
        if (hit) return await hit.blob();
      } catch (e2) {}
    }
    var res = await fetch(url);
    if (!res.ok) throw new Error('voice-fetch');
    var blob;
    if (onProgress && res.body && res.body.getReader) {
      var reader = res.body.getReader();
      var total = +(res.headers.get('Content-Length') || 0);
      var loaded = 0;
      var parts = [];
      while (true) {
        var step = await reader.read();
        if (step.done) break;
        parts.push(step.value);
        loaded += step.value.length;
        onProgress(loaded, total);
      }
      blob = new Blob(parts);
    } else {
      blob = await res.blob();
    }
    if (cache) {
      try {
        await cache.put(url, new Response(blob, {
          headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' }
        }));
      } catch (e3) {}
    }
    return blob;
  }

  function splitSpeakChunks(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    var parts = [];
    var re = /[^.!?…]+[.!?…]+\s*|[^.!?…]+$/g;
    var m;
    while ((m = re.exec(text))) {
      var p = m[0].trim();
      if (p) parts.push(p);
    }
    if (!parts.length) parts = [text];
    var chunks = [];
    var cur = '';
    parts.forEach(function (p) {
      if (cur && cur.length + 1 + p.length > 240) {
        chunks.push(cur);
        cur = p;
      } else {
        cur = cur ? cur + ' ' + p : p;
      }
    });
    if (cur) chunks.push(cur);
    return chunks;
  }

  async function ensureScripts() {
    if (piper.scripts) return;
    await loadScript(ORT_JS);
    await loadScript(PHON_JS);
    if (!window.ort || !window.createPiperPhonemize) throw new Error('no-engine');
    window.ort.env.allowLocalModels = false;
    window.ort.env.wasm.numThreads = 1;
    window.ort.env.wasm.proxy = false;
    window.ort.env.wasm.wasmPaths = ORT_WASM;
    piper.scripts = true;
  }

  function idsFromPhonemeLine(line) {
    var raw = String(line || '').trim();
    if (!raw) return null;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {
      var m = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (!m) return null;
      try { parsed = JSON.parse(m[1]); } catch (e2) { return null; }
    }
    if (parsed && parsed.phoneme_ids && parsed.phoneme_ids.length) return parsed.phoneme_ids;
    if (Array.isArray(parsed)) {
      for (var i = 0; i < parsed.length; i++) {
        if (parsed[i] && parsed[i].phoneme_ids && parsed[i].phoneme_ids.length) return parsed[i].phoneme_ids;
      }
    }
    return null;
  }

  function tensorI64(values, dims) {
    var arr = Array.isArray(values) ? values : [values];
    var data;
    try {
      data = BigInt64Array.from(arr.map(function (n) { return BigInt(n); }));
    } catch (e) {
      data = arr;
    }
    return new window.ort.Tensor('int64', data, dims);
  }

  async function phonemeIds(text, espeakVoice) {
    var payload = JSON.stringify([{ text: String(text || '').trim() }]);
    return await new Promise(function (resolve, reject) {
      var done = false;
      var loadTimer = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error('phoneme-load'));
        }
      }, 60000);
      window.createPiperPhonemize({
        print: function (line) {
          if (done) return;
          var ids = idsFromPhonemeLine(line);
          if (ids) {
            done = true;
            clearTimeout(loadTimer);
            resolve(ids);
          }
        },
        printErr: function () {},
        locateFile: function (name) {
          if (String(name).endsWith('.wasm')) return PHON_BASE + '.wasm';
          if (String(name).endsWith('.data')) return PHON_BASE + '.data';
          return name;
        }
      }).then(function (mod) {
        if (done) return;
        mod.callMain(['-l', espeakVoice || 'uk', '--input', payload, '--espeak_data', '/espeak-ng-data']);
        setTimeout(function () {
          if (!done) {
            done = true;
            clearTimeout(loadTimer);
            reject(new Error('phoneme-timeout'));
          }
        }, 20000);
      }).catch(function (err) {
        if (done) return;
        done = true;
        clearTimeout(loadTimer);
        reject(err);
      });
    });
  }

  async function ensureVoice(lang, onStatus) {
    await ensureScripts();
    var spec = PIPER_VOICES[lang] || PIPER_VOICES['uk-UA'];
    if (piper.sessions[spec.key]) return piper.sessions[spec.key];
    if (onStatus) onStatus('Завантажую голос ' + spec.label + '…');
    var cfgBlob = await cachedFetch(spec.url + '.json');
    var cfg = JSON.parse(await cfgBlob.text());
    var modelBlob = await cachedFetch(spec.url, function (loaded, total) {
      if (!onStatus) return;
      if (total) onStatus('Завантажую голос ' + spec.label + '… ' + Math.min(99, Math.round(loaded * 100 / total)) + '%');
      else onStatus('Завантажую голос ' + spec.label + '…');
    });
    if (onStatus) onStatus('Готую голос ' + spec.label + '…');
    var session = await window.ort.InferenceSession.create(await modelBlob.arrayBuffer(), {
      executionProviders: ['wasm']
    });
    if (onStatus) onStatus('Читаю голосом ' + spec.label + '…');
    var packed = { spec: spec, cfg: cfg, session: session };
    piper.sessions[spec.key] = packed;
    return packed;
  }

  function runPiper(text, lang, onStatus) {
    var job = piper.lock.then(async function () {
      var packed = await ensureVoice(lang, onStatus);
      var ids = await phonemeIds(text, (packed.cfg.espeak && packed.cfg.espeak.voice) || 'uk');
      var inf = packed.cfg.inference || {};
      if (!ids || !ids.length) throw new Error('phoneme-empty');
      var feeds = {
        input: tensorI64(ids, [1, ids.length]),
        input_lengths: tensorI64([ids.length], [1]),
        scales: new window.ort.Tensor('float32', Float32Array.from([
          inf.noise_scale != null ? inf.noise_scale : 0.667,
          inf.length_scale != null ? inf.length_scale : 1,
          inf.noise_w != null ? inf.noise_w : 0.8
        ]), [3])
      };
      var map = packed.cfg.speaker_id_map || {};
      if (map && Object.keys(map).length) {
        feeds.sid = tensorI64([packed.spec.speaker || 0], [1]);
      }
      var out = await packed.session.run(feeds);
      var tensor = out.output || out.audio || out[Object.keys(out)[0]];
      var wav = pcmToWav(tensor.data, (packed.cfg.audio && packed.cfg.audio.sample_rate) || 22050);
      return new Blob([wav], { type: 'audio/wav' });
    });
    piper.lock = job.then(function () {}, function () {});
    return job;
  }

  function playBlob(blob, token) {
    return new Promise(function (resolve, reject) {
      if (!speak.playing || token !== speak.token) return resolve();
      if (!speak.audio) speak.audio = new Audio();
      if (speak.url) {
        try { URL.revokeObjectURL(speak.url); } catch (e) {}
      }
      speak.url = URL.createObjectURL(blob);
      speak.audio.src = speak.url;
      speak.audio.onended = function () { resolve(); };
      speak.audio.onerror = function () { reject(new Error('audio')); };
      var p = speak.audio.play();
      if (p && p.catch) p.catch(reject);
    });
  }

  function goNextPageKeepPlaying() {
    if (state.idx >= state.pages.length - 1) return false;
    state.idx += 1;
    speak.start = 0;
    speak.pos = 0;
    save();
    render();
    return true;
  }

  function pageTextAt() {
    var page = state.pages[state.idx];
    return page && page.text ? page.text : '';
  }

  function speakWebFrom(start, token) {
    var text = pageTextAt();
    if (!text) {
      if (goNextPageKeepPlaying()) return speakWebFrom(0, token);
      stopSpeak();
      return;
    }
    if (!window.speechSynthesis) {
      toast('На цій сторінці натисни «Прослухати» ще раз.');
      stopSpeak();
      return;
    }
    start = Math.max(0, Math.min(text.length, start | 0));
    speak.start = start;
    speak.pos = start;
    speak.engine = 'web';
    var u = new SpeechSynthesisUtterance(text.slice(start));
    u.lang = langOf(text);
    var v = pickVoice(u.lang);
    if (v) u.voice = v;
    u.rate = 1;
    u.onboundary = function (e) {
      if (e && (e.name === 'word' || e.charIndex >= 0)) speak.pos = speak.start + (e.charIndex || 0);
    };
    u.onend = function () {
      if (speak.utter !== u || token !== speak.token || !speak.playing) return;
      if (goNextPageKeepPlaying()) speakWebFrom(0, token);
      else stopSpeak();
    };
    u.onerror = function () {
      if (speak.utter === u && token === speak.token) stopSpeak();
    };
    speak.utter = u;
    speechSynthesis.speak(u);
  }

  async function speakPiperLoop(token) {
    while (speak.playing && token === speak.token) {
      if (speak.chunkIdx >= speak.chunks.length) {
        if (goNextPageKeepPlaying()) {
          var nxt = pageTextAt();
          speak.chunks = splitSpeakChunks(nxt);
          speak.chunkIdx = 0;
          speak.nextBlob = null;
          if (!speak.chunks.length) continue;
        } else {
          stopSpeak();
          return;
        }
      }
      var chunk = speak.chunks[speak.chunkIdx];
      var lang = langOf(chunk);
      try {
        var blob = speak.nextBlob;
        speak.nextBlob = null;
        if (!blob) blob = await runPiper(chunk, lang, speak.chunkIdx === 0 ? voiceStatus : null);
        if (!speak.playing || token !== speak.token) return;
        voiceStatus('');
        var prefetchIdx = speak.chunkIdx + 1;
        if (prefetchIdx < speak.chunks.length) {
          runPiper(speak.chunks[prefetchIdx], langOf(speak.chunks[prefetchIdx]), null).then(function (b) {
            if (speak.playing && token === speak.token && speak.chunkIdx + 1 === prefetchIdx) speak.nextBlob = b;
          }).catch(function () {});
        }
        await playBlob(blob, token);
        if (!speak.playing || token !== speak.token) return;
        speak.chunkIdx += 1;
        speak.pos = speak.start + 1;
      } catch (e) {
        if (!speak.playing || token !== speak.token) return;
        voiceStatus('Не вийшло запустити голос Лада, читаю голосом телефону.');
        toast('Не вийшло запустити голос Лада, читаю голосом телефону.');
        speakWebFrom(0, token);
        return;
      }
    }
  }

  function speakFrom(start) {
    var text = pageTextAt();
    if (!text) { toast('На цій сторінці ще немає тексту.'); return; }
    unlockAudio();
    speak.token = (speak.token || 0) + 1;
    haltAudio();
    var token = speak.token;
    start = Math.max(0, Math.min(text.length, start | 0));
    speak.start = start;
    speak.pos = start;
    speak.playing = true;
    speak.nextBlob = null;
    setListen(true);
    speak.chunks = splitSpeakChunks(text.slice(start));
    speak.chunkIdx = 0;
    speak.engine = 'piper';
    speakPiperLoop(token);
  }

  function skipSeconds(sec) {
    if (!speak.playing) return false;
    if (speak.engine === 'piper' && speak.audio && speak.audio.src && speak.url) {
      var dur = speak.audio.duration || 0;
      var t = (speak.audio.currentTime || 0) + sec;
      if (t < 0) {
        if (speak.chunkIdx > 0) {
          speak.chunkIdx -= 1;
          speak.nextBlob = null;
          var token = ++speak.token;
          haltAudio();
          speak.playing = true;
          setListen(true);
          speakPiperLoop(token);
        } else {
          try { speak.audio.currentTime = 0; } catch (e) {}
        }
        return true;
      }
      if (dur && t >= dur - 0.15) {
        speak.chunkIdx += 1;
        speak.nextBlob = null;
        var token2 = ++speak.token;
        haltAudio();
        speak.playing = true;
        setListen(true);
        speakPiperLoop(token2);
        return true;
      }
      try { speak.audio.currentTime = Math.max(0, t); } catch (e2) {}
      return true;
    }
    return false;
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
    var type = ((file && file.type) || '').toLowerCase();
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.fb2') || name.endsWith('.fb2.xml') || type.indexOf('fictionbook') !== -1) return 'fb2';
    if (name.endsWith('.txt') || type === 'text/plain') return 'txt';
    if (name.endsWith('.xml') || type === 'text/xml' || type === 'application/xml') return 'maybe';
    return 'maybe';
  }

  function sniffHead(buf) {
    var head = '';
    try { head = new TextDecoder('utf-8').decode(buf); } catch (e) {
      head = String.fromCharCode.apply(null, new Uint8Array(buf));
    }
    if (head.indexOf('%PDF') === 0) return 'pdf';
    if (/FictionBook/i.test(head) || /<FictionBook\b/i.test(head)) return 'fb2';
    return '';
  }

  async function detectKind(file) {
    var kind = fileKind(file);
    if (kind === 'pdf' || kind === 'fb2' || kind === 'txt') return kind;
    try {
      var buf = await file.slice(0, 4096).arrayBuffer();
      return sniffHead(buf) || '';
    } catch (e) {
      return '';
    }
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

  function stripFb2Binaries(xml) {
    return String(xml || '').replace(/<binary\b[^>]*>[\s\S]*?<\/binary>/gi, '');
  }

  async function readFb2(file, onStatus) {
    if (onStatus) onStatus('Читаю файл…');
    var xml = await file.text();
    if (onStatus) onStatus('Готую книжку…');
    xml = stripFb2Binaries(xml);
    if (onStatus) onStatus('Розбираю текст…');
    try {
      return readFb2Text(xml);
    } catch (e) {
      // деякі старі FB2 у кодуванні Windows
      if (file.arrayBuffer) {
        var buf = await file.arrayBuffer();
        var bytes = new Uint8Array(buf);
        var decoded = '';
        try {
          if (typeof TextDecoder !== 'undefined') decoded = new TextDecoder('windows-1251').decode(bytes);
        } catch (e2) { decoded = ''; }
        if (decoded && /FictionBook/i.test(decoded)) {
          return readFb2Text(stripFb2Binaries(decoded));
        }
      }
      throw e;
    }
  }

  async function readTxt(file) {
    var raw = await file.text();
    var parts = raw.split('\f');
    if (parts.length < 2) parts = raw.split(/\n\s*\n\s*\n/);
    var texts = [];
    parts.forEach(function (part) {
      var paras = [];
      String(part).split(/\n\s*\n/).forEach(function (para) { paras.push(para); });
      splitParas(paras).forEach(function (t) { texts.push(t); });
    });
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
    files = Array.prototype.slice.call(files || []);
    if (!files.length) { toast('Обери файл книжки: PDF або FB2.'); return; }
    var status = $('status');
    status.hidden = false;
    var input = $('fileAny');
    if (input) input.disabled = true;
    var opened = 0;
    for (var i = 0; i < files.length; i++) {
      status.textContent = 'Відкриваю файл…';
      try {
        var kind = await detectKind(files[i]);
        if (!kind) { toast('Цей формат Читанка ще не читає. Обери PDF, FB2 або звичайний текст.'); continue; }
        var pages, bookTitle = '';
        if (kind === 'pdf') {
          pages = await readPdf(files[i], function (msg) { status.textContent = msg; });
        } else if (kind === 'fb2') {
          var fb = await readFb2(files[i], function (msg) { status.textContent = msg; });
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
        opened += 1;
        toast('Готово: ' + pages.length + ' стор. Можна читати або слухати.');
      } catch (e) {
        toast('Цей файл не вдалося відкрити. Спробуй PDF або FB2.');
      }
    }
    status.hidden = true;
    if (input) { input.disabled = false; input.value = ''; }
    if (!opened && files.length) { /* toast already shown */ }
  }

  $('bookTitle').addEventListener('change', function () {
    state.title = ($('bookTitle').value || 'Моя книжка').trim() || 'Моя книжка';
    save();
  });
  var fileInput = $('fileAny');
  if (fileInput) {
    fileInput.addEventListener('change', function (e) { addFiles(e.target.files); });
  }
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
    if (skipSeconds(-15)) return;
    speakFrom(Math.max(0, speak.pos - estimateChars(15)));
  });
  $('bFwd').addEventListener('click', function () {
    var text = ((state.pages[state.idx] || {}).text || '');
    if (!text) return;
    if (skipSeconds(30)) return;
    var next = Math.min(text.length, speak.pos + estimateChars(30));
    if (next >= text.length) {
      if (state.idx < state.pages.length - 1) {
        state.idx += 1;
        speak.pos = 0;
        save();
        render();
        speakFrom(0);
      } else {
        stopSpeak();
        toast('Кінець сторінки.');
      }
      return;
    }
    speakFrom(next);
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = function () {}; } catch (e) {}

  load();
  render();
})();
