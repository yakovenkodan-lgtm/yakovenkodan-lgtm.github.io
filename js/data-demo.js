/* Демо-джерело: приклади з demo-data/index.json (така сама структура, як папка «Читанка» на Гугл Диску). */
(function (root) {
  'use strict';
  function DemoSource(base) {
    this.kind = 'demo';
    this.title = 'Демо';
    this.needsAuth = false;
    this.base = new URL(base, location.href).href;
    this._index = null;
  }
  DemoSource.prototype.isSignedIn = function () { return true; };
  DemoSource.prototype.index = function () {
    var self = this;
    if (self._index) return Promise.resolve(self._index);
    return fetch(self.base + 'index.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('demo index ' + r.status);
      return r.json();
    }).then(function (j) { self._index = j; return j; });
  };
  DemoSource.prototype.listBooks = function () {
    return this.index().then(function (j) { return j.books.map(function (b) { return { id: b.id, name: b.name }; }); });
  };
  DemoSource.prototype.listFiles = function (bookId) {
    this._index = null; // «Оновити» перечитує
    return this.index().then(function (j) {
      var b = j.books.filter(function (x) { return x.id === bookId; })[0];
      if (!b) throw new Error('no book');
      return b.files.slice();
    });
  };
  DemoSource.prototype.fetchFile = function (file) {
    return fetch(this.base + file.url.split('/').map(encodeURIComponent).join('/'));
  };
  root.ChitankaDemoSource = DemoSource;
})(this);
