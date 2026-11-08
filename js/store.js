/* Читанка — бібліотека: книжки, текст, обкладинка, аудіо + кеш на телефоні (Cache Storage).
   Джерело даних підключається ззовні (DemoSource / DriveSource) і має лише:
     listBooks() -> [{id, name}]
     listFiles(bookId) -> [{id, name, size, modifiedTime, md5Checksum?}]
     fetchFile(file) -> Response
   Усе інше (розбір тексту, назви аудіо, обкладинка, кеш, офлайн) — тут, спільне для всіх джерел. */
(function (root) {
  'use strict';
  var L = root.ChitankaLabels;
  var FILES = 'chitanka-files-v1';
  var META = 'chitanka-meta-v1';
  var hasCaches = typeof caches !== 'undefined';

  function Library(source) {
    this.source = source;
    this.filesByBook = {};
    this.urls = {};
  }
  function key(source, part) { return new URL('./__chitanka/' + source.kind + '/' + part, location.href).href; }
  function fileVersion(f) { return String(f.md5Checksum || f.modifiedTime || f.size || '0'); }
  function fileKey(source, f) { return key(source, 'file/' + encodeURIComponent(f.id)) + '?v=' + encodeURIComponent(fileVersion(f)); }

  Library.prototype.putMeta = function (name, obj) {
    try { localStorage.setItem('chitanka.meta.' + this.source.kind + '.' + name, JSON.stringify(obj)); } catch (e) {
      if (hasCaches) caches.open(META).then(function (c) { c.put(key(this.source, 'meta/' + name), new Response(JSON.stringify(obj))); }.bind(this));
    }
  };
  Library.prototype.getMeta = function (name) {
    try { var s = localStorage.getItem('chitanka.meta.' + this.source.kind + '.' + name); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  };

  // Книжки: з джерела (якщо можна), інакше збережений список
  Library.prototype.listBooks = function (opts) {
    var self = this; opts = opts || {};
    var cached = self.getMeta('books');
    if (cached && !opts.force) return Promise.resolve({ books: cached, fromCache: true });
    return self.source.listBooks().then(function (books) {
      books.sort(function (a, b) { return a.name.localeCompare(b.name, 'uk'); });
      self.putMeta('books', books);
      return { books: books, fromCache: false };
    }, function (err) {
      if (cached) return { books: cached, fromCache: true, error: err };
      throw err;
    });
  };

  Library.prototype.listFiles = function (bookId, force) {
    var self = this;
    if (!force && self.filesByBook[bookId]) return Promise.resolve(self.filesByBook[bookId]);
    return self.source.listFiles(bookId).then(function (files) {
      files = files.filter(function (f) { return !/\.tmp$/i.test(f.name); });
      self.filesByBook[bookId] = files;
      return files;
    });
  };

  // Файл як Blob: спершу з кешу телефону, інакше завантажити (з відсотками) і зберегти
  Library.prototype.getBlob = function (file, opts) {
    var self = this; opts = opts || {};
    var k = fileKey(self.source, file);
    var type = L.mimeFor(file.name);
    var cacheP = hasCaches ? caches.open(FILES) : Promise.resolve(null);
    return cacheP.then(function (cache) {
      return (cache ? cache.match(k) : Promise.resolve(null)).then(function (hit) {
        if (hit) return hit.blob().then(function (b) { return b.type ? b : b.slice(0, b.size, type); });
        if (opts.cacheOnly) return null;
        return self.source.fetchFile(file).then(function (resp) {
          if (!resp.ok) { var e = new Error('HTTP ' + resp.status); e.status = resp.status; throw e; }
          return readWithProgress(resp, +file.size || +resp.headers.get('Content-Length') || 0, opts.onProgress);
        }).then(function (buf) {
          var blob = new Blob([buf], { type: type });
          if (cache && opts.store !== false) {
            // старі версії цього файлу — геть
            cache.keys().then(function (keys) {
              var prefix = k.split('?')[0] + '?';
              keys.forEach(function (r) { if (r.url.indexOf(prefix) === 0 && r.url !== k) cache.delete(r); });
            });
            cache.put(k, new Response(blob, { headers: { 'Content-Type': type, 'Content-Length': String(blob.size) } })).catch(function () {});
          }
          return blob;
        });
      });
    });
  };

  Library.prototype.isCached = function (file) {
    if (!hasCaches) return Promise.resolve(false);
    return caches.open(FILES).then(function (c) { return c.match(fileKey(this.source, file)); }.bind(this)).then(function (r) { return !!r; });
  };

  Library.prototype.objectUrl = function (file, opts) {
    var self = this, k = file.id + '|' + fileVersion(file);
    if (self.urls[k]) return Promise.resolve(self.urls[k]);
    return self.getBlob(file, opts).then(function (b) {
      if (!b) return null;
      self.urls[k] = URL.createObjectURL(b);
      return self.urls[k];
    });
  };

  function readWithProgress(resp, total, onProgress) {
    if (!resp.body || !resp.body.getReader || !onProgress) return resp.arrayBuffer();
    var reader = resp.body.getReader(), chunks = [], got = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(got), off = 0;
          chunks.forEach(function (c) { out.set(c, off); off += c.length; });
          return out.buffer;
        }
        chunks.push(r.value); got += r.value.length;
        try { onProgress(got, total); } catch (e) {}
        return pump();
      });
    }
    return pump();
  }

  // Повна книжка: сторінки + аудіо + обкладинка. Офлайн — зі збереженої копії (текст лежить у кеші файлів).
  Library.prototype.loadBook = function (book, opts) {
    var self = this; opts = opts || {};
    function withText(meta, cacheOnly) {
      var tf = meta.textFile;
      var p = tf ? self.getBlob(tf, { cacheOnly: cacheOnly }).then(function (b) { return b ? b.text() : ''; }) : Promise.resolve('');
      return p.then(function (txt) { meta.pages = L.parseBookText(txt); return meta; });
    }
    return self.listFiles(book.id, opts.force).then(function (files) {
      var meta = { id: book.id, name: book.name, audio: L.audioList(files), cover: L.pickCover(files),
        textFile: L.pickTextFile(files), fetchedAt: Date.now() };
      self.putMeta('book.' + book.id, meta);
      return withText(meta, false).then(function (m) { m.offline = false; return m; });
    }, function (err) {
      var cached = self.getMeta('book.' + book.id);
      if (!cached) throw err;
      return withText(cached, true).then(function (m) { m.offline = true; m.error = err; return m; });
    });
  };

  Library.prototype.cachedBook = function (bookId) { return this.getMeta('book.' + bookId); };

  Library.prototype.coverUrl = function (bookData) {
    if (!bookData || !bookData.cover) return Promise.resolve(null);
    return this.objectUrl(bookData.cover.file).catch(function () { return null; });
  };

  // обкладинки для списку книжок (легко: лише назви файлів + маленьке зображення)
  Library.prototype.bookCoverUrl = function (book) {
    var self = this;
    var cached = self.cachedBook(book.id);
    var p = cached ? Promise.resolve(cached.cover) : self.listFiles(book.id).then(function (files) { return L.pickCover(files); });
    return p.then(function (c) { return c ? self.objectUrl(c.file) : null; }).catch(function () { return null; });
  };

  Library.prototype.storageInfo = function () {
    var self = this;
    if (!hasCaches) return Promise.resolve({ count: 0, bytes: 0 });
    return caches.open(FILES).then(function (c) {
      return c.keys().then(function (keys) {
        var mine = keys.filter(function (r) { return r.url.indexOf('/__chitanka/' + self.source.kind + '/') >= 0; });
        return Promise.all(mine.map(function (r) { return c.match(r).then(function (x) { return +(x && x.headers.get('Content-Length')) || 0; }); }))
          .then(function (sizes) { return { count: mine.length, bytes: sizes.reduce(function (a, b) { return a + b; }, 0) }; });
      });
    });
  };

  Library.prototype.clearAudio = function () {
    var self = this;
    if (!hasCaches) return Promise.resolve(0);
    return caches.open(FILES).then(function (c) {
      return c.keys().then(function (keys) {
        var del = keys.filter(function (r) { return /\/__chitanka\//.test(r.url) && L.isAudioName(decodeURIComponent(r.url.split('?')[0])); });
        return Promise.all(del.map(function (r) { return c.delete(r); })).then(function () { return del.length; });
      });
    });
  };

  root.ChitankaLibrary = Library;
})(this);
