/* Читанка — програвач аудіо Аліни.
   Справжній <audio> (грає у фоні й на заблокованому екрані iPhone), Media Session (назва, обкладинка,
   пауза/перемотка/наступний), позиція кожного файлу в localStorage, наступний файл — сам. */
(function (root) {
  'use strict';
  var SILENCE = 'audio/silence.mp3';

  function Player(audioEl, library, hooks) {
    this.a = audioEl;
    this.lib = library;
    this.hooks = hooks || {};
    this.book = null;      // {id, name, audio:[...]}
    this.cur = null;       // поточний запис списку
    this.loading = null;   // {entry, got, total}
    this.artwork = null;
    this.autoNext = true;
    this.unlocked = false;
    this._saveT = 0;
    this._seq = 0;
    var self = this, a = this.a;
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    ['play', 'pause', 'loadedmetadata', 'durationchange', 'waiting', 'playing'].forEach(function (ev) {
      a.addEventListener(ev, function () { self.emit(); self.updatePositionState(); });
    });
    a.addEventListener('pause', function () { self.savePos(); });
    a.addEventListener('seeked', function () { self.savePos(); });
    a.addEventListener('timeupdate', function () {
      if (!self.cur || self._isSilence()) return;
      var now = Date.now();
      if (now - self._saveT > 3000) { self._saveT = now; self.savePos(); }
      self.emit('time');
    });
    a.addEventListener('ended', function () {
      if (self._isSilence() || !self.cur) return;
      self.clearPos(self.cur);
      var nx = self.neighbour(1);
      if (self.autoNext && nx) self.play(nx, { auto: true });
      else self.emit();
    });
    a.addEventListener('error', function () {
      if (self._isSilence() || !self.cur) return;
      self.hooks.onError && self.hooks.onError('play');
    });
    window.addEventListener('pagehide', function () { self.savePos(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) self.savePos(); });
    this.initMediaSession();
  }

  Player.prototype._isSilence = function () { return (this.a.currentSrc || this.a.src || '').indexOf(SILENCE) >= 0; };
  Player.prototype.emit = function (what) { if (this.hooks.onChange) this.hooks.onChange(what || 'state'); };
  Player.prototype.posKey = function (e) { return 'chitanka.pos.' + (this.book ? this.book.id : '') + '.' + e.name; };
  Player.prototype.getPos = function (e) { return +(localStorage.getItem(this.posKey(e)) || 0); };
  Player.prototype.savePos = function () {
    if (!this.cur || this._isSilence()) return;
    var t = this.a.currentTime || 0, d = this.a.duration || 0;
    if (d && t > d - 3) { this.clearPos(this.cur); return; }
    if (t > 1) localStorage.setItem(this.posKey(this.cur), String(Math.floor(t)));
  };
  Player.prototype.clearPos = function (e) { localStorage.removeItem(this.posKey(e)); };

  Player.prototype.setBook = function (book, artworkUrl) {
    if (this.book && book && this.book.id === book.id) { this.book = book; return; }
    this.stop();
    this.book = book;
    this.artwork = artworkUrl || null;
  };
  Player.prototype.setArtwork = function (url) { this.artwork = url; this.updateMetadata(); };

  Player.prototype.neighbour = function (d) {
    if (!this.book || !this.cur) return null;
    var list = this.book.audio, i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].name === this.cur.name) i = k;
    return list[i + d] || null;
  };

  // Викликати СИНХРОННО в обробнику дотику: iOS дозволяє звук лише після жесту користувача.
  Player.prototype.unlock = function () {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      if (!this.a.src) { this.a.src = SILENCE; var p = this.a.play(); if (p && p.catch) p.catch(function () {}); }
    } catch (e) {}
  };

  Player.prototype.play = function (entry, opts) {
    var self = this, seq = ++self._seq; opts = opts || {};
    self.unlock();
    if (self.cur && self.cur.name === entry.name && self.a.src && !self._isSilence()) {
      var p0 = self.a.play(); if (p0 && p0.catch) p0.catch(function () {});
      return Promise.resolve();
    }
    self.savePos();
    self.cur = entry;
    self.loading = { entry: entry, got: 0, total: +entry.size || 0 };
    self.emit();
    self.updateMetadata();
    return self.lib.objectUrl(entry, {
      onProgress: function (got, total) { if (seq === self._seq) { self.loading = { entry: entry, got: got, total: total }; self.emit('progress'); } }
    }).then(function (url) {
      if (seq !== self._seq) return;
      self.loading = null;
      if (navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) {} }
      self.a.src = url;
      var start = self.getPos(entry);
      var seekOnce = function () {
        self.a.removeEventListener('loadedmetadata', seekOnce);
        if (start > 2 && (!self.a.duration || start < self.a.duration - 3)) { try { self.a.currentTime = start; } catch (e) {} }
      };
      self.a.addEventListener('loadedmetadata', seekOnce);
      var p = self.a.play();
      if (p && p.catch) p.catch(function (err) { self.emit(); if (err && err.name === 'NotAllowedError' && self.hooks.onError) self.hooks.onError('gesture'); });
      self.updateMetadata();
      self.emit();
      self.prefetchNext();
    }, function (err) {
      if (seq !== self._seq) return;
      self.loading = null;
      self.emit();
      if (self.hooks.onError) self.hooks.onError(err && err.auth ? 'auth' : 'download', err);
    });
  };

  // наступний файл завантажуємо заздалегідь — щоб на заблокованому екрані не чекати інтернет
  Player.prototype.prefetchNext = function () {
    var nx = this.neighbour(1);
    if (nx && this.autoNext) this.lib.getBlob(nx).catch(function () {});
  };

  Player.prototype.toggle = function () {
    this.unlock();
    if (!this.cur) return;
    if (this.a.paused) { var p = this.a.play(); if (p && p.catch) p.catch(function () {}); } else this.a.pause();
  };
  Player.prototype.pause = function () { this.a.pause(); };
  Player.prototype.stop = function () {
    this._seq++;
    this.savePos();
    this.a.pause();
    this.cur = null; this.loading = null;
    this.a.removeAttribute('src'); try { this.a.load(); } catch (e) {}
    if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
    this.emit();
  };
  Player.prototype.seekBy = function (s) {
    if (!this.cur || !isFinite(this.a.duration)) return;
    this.a.currentTime = Math.max(0, Math.min(this.a.duration - 0.5, this.a.currentTime + s));
    this.savePos();
  };
  Player.prototype.seekTo = function (t) {
    if (!this.cur || !isFinite(this.a.duration)) return;
    this.a.currentTime = Math.max(0, Math.min(this.a.duration - 0.5, t));
    this.savePos();
  };
  Player.prototype.next = function () { var n = this.neighbour(1); if (n) this.play(n); };
  Player.prototype.prev = function () {
    if (this.a.currentTime > 5) { this.seekTo(0); return; }
    var n = this.neighbour(-1); if (n) this.play(n); else this.seekTo(0);
  };
  Player.prototype.isPlaying = function () { return !!this.cur && !this.a.paused && !this._isSilence(); };

  Player.prototype.updateMetadata = function () {
    if (!('mediaSession' in navigator) || !this.cur) return;
    var art = [];
    if (this.artwork) art.push({ src: this.artwork, sizes: '512x512', type: 'image/jpeg' });
    art.push({ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' });
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.cur.label, artist: this.book ? this.book.name : 'Читанка', album: 'Читанка — аудіо Аліни', artwork: art
      });
    } catch (e) {}
  };
  Player.prototype.updatePositionState = function () {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = this.cur ? (this.a.paused ? 'paused' : 'playing') : 'none';
      if (this.cur && isFinite(this.a.duration) && this.a.duration > 0 && navigator.mediaSession.setPositionState)
        navigator.mediaSession.setPositionState({ duration: this.a.duration, playbackRate: this.a.playbackRate || 1, position: Math.min(this.a.currentTime, this.a.duration) });
    } catch (e) {}
  };
  Player.prototype.initMediaSession = function () {
    if (!('mediaSession' in navigator)) return;
    var self = this, ms = navigator.mediaSession;
    var h = {
      play: function () { var p = self.a.play(); if (p && p.catch) p.catch(function () {}); },
      pause: function () { self.a.pause(); },
      stop: function () { self.stop(); },
      seekbackward: function (d) { self.seekBy(-((d && d.seekOffset) || 15)); },
      seekforward: function (d) { self.seekBy((d && d.seekOffset) || 30); },
      seekto: function (d) { if (d && typeof d.seekTime === 'number') self.seekTo(d.seekTime); },
      previoustrack: function () { self.prev(); },
      nexttrack: function () { self.next(); }
    };
    Object.keys(h).forEach(function (k) { try { ms.setActionHandler(k, h[k]); } catch (e) {} });
  };

  // обкладинка -> маленька JPEG data: URL (iOS показує її на заблокованому екрані надійніше, ніж blob:)
  Player.artworkFrom = function (url) {
    return new Promise(function (resolve) {
      if (!url) return resolve(null);
      var img = new Image();
      img.onload = function () {
        try {
          var s = 512, c = document.createElement('canvas'); c.width = s; c.height = s;
          var g = c.getContext('2d'); g.fillStyle = '#fdf6ec'; g.fillRect(0, 0, s, s);
          var r = Math.min(s / img.width, s / img.height), w = img.width * r, hh = img.height * r;
          g.drawImage(img, (s - w) / 2, (s - hh) / 2, w, hh);
          resolve(c.toDataURL('image/jpeg', 0.85));
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  };

  root.ChitankaPlayer = Player;
})(this);
