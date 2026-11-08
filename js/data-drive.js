/* Джерело «Гугл Диск»: папка «Мій диск/Читанка/<книжка>/» через Drive REST v3.
   Вхід — звичайний OAuth 2.0 для веб-застосунків без сервера (response_type=token, переадресація
   в тому самому вікні — працює і в іконці на екрані «Додому» на iPhone, де спливаючі вікна не повертаються).
   Токен (1 год) лежить лише на телефоні (localStorage). Жодного сервера, жодних сторонніх скриптів. */
(function (root) {
  'use strict';
  var API = 'https://www.googleapis.com/drive/v3/';
  var SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  var TOKEN_KEY = 'chitanka.gtoken';
  var STATE_KEY = 'chitanka.oauthState';
  var FOLDER = 'application/vnd.google-apps.folder';

  function AuthError(msg) { var e = new Error(msg || 'auth'); e.auth = true; return e; }

  function DriveSource(cfg) {
    this.kind = 'drive';
    this.title = 'Гугл Диск';
    this.needsAuth = true;
    this.cfg = cfg;
    this.redirectUri = cfg.redirectUri || (location.origin + location.pathname.replace(/index\.html$/, ''));
  }

  DriveSource.prototype.token = function () {
    try {
      var t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.access_token && t.exp > Date.now() + 60000) return t.access_token;
    } catch (e) {}
    return null;
  };
  DriveSource.prototype.isSignedIn = function () { return !!this.token(); };
  DriveSource.prototype.everSignedIn = function () { return localStorage.getItem('chitanka.everSignedIn') === '1'; };

  // silent: prompt=none — без жодних вікон, якщо Google вже пам'ятає Данила і його згоду
  DriveSource.prototype.signIn = function (opts) {
    opts = opts || {};
    var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(STATE_KEY, JSON.stringify({ s: state, silent: !!opts.silent, t: Date.now() }));
    var p = {
      client_id: this.cfg.googleClientId, redirect_uri: this.redirectUri, response_type: 'token',
      scope: SCOPE, include_granted_scopes: 'true', state: state
    };
    if (opts.silent) p.prompt = 'none';
    if (this.cfg.loginHint) p.login_hint = this.cfg.loginHint;
    var q = Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
  };

  // Викликати на старті: забирає токен з #access_token=… після повернення від Google
  DriveSource.prototype.handleRedirect = function () {
    var h = location.hash || '';
    if (h.indexOf('access_token=') < 0 && h.indexOf('error=') < 0) return null;
    var params = {};
    h.replace(/^#/, '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });
    history.replaceState(null, '', location.pathname + location.search);
    var st = null; try { st = JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch (e) {}
    localStorage.removeItem(STATE_KEY);
    if (!st || st.s !== params.state) return { ok: false, error: 'state' };
    if (params.error) return { ok: false, error: params.error, silent: st.silent };
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: params.access_token, exp: Date.now() + (+params.expires_in || 3600) * 1000 }));
    localStorage.setItem('chitanka.everSignedIn', '1');
    return { ok: true, silent: st.silent };
  };

  DriveSource.prototype.signOut = function () {
    var t = this.token();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('chitanka.everSignedIn');
    localStorage.removeItem('chitanka.driveRoot');
    if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST', mode: 'no-cors' }).catch(function () {});
  };

  DriveSource.prototype.req = function (path, params) {
    var t = this.token();
    if (!t) return Promise.reject(AuthError('no token'));
    var q = params ? '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&') : '';
    return fetch(API + path + q, { headers: { Authorization: 'Bearer ' + t } }).then(function (r) {
      if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); throw AuthError('401'); }
      return r;
    });
  };
  DriveSource.prototype.list = function (q, fields) {
    var self = this, out = [];
    function page(tok) {
      var p = { q: q, fields: 'nextPageToken,files(' + fields + ')', pageSize: 1000, orderBy: 'name', spaces: 'drive' };
      if (tok) p.pageToken = tok;
      return self.req('files', p).then(function (r) {
        if (!r.ok) throw new Error('Drive ' + r.status);
        return r.json();
      }).then(function (j) { out = out.concat(j.files || []); return j.nextPageToken ? page(j.nextPageToken) : out; });
    }
    return page(null);
  };
  function qs(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

  DriveSource.prototype.rootFolder = function () {
    var self = this, cached = localStorage.getItem('chitanka.driveRoot');
    if (cached) return Promise.resolve(cached);
    var base = 'name = ' + qs(self.cfg.driveFolder || 'Читанка') + " and mimeType = '" + FOLDER + "' and trashed = false";
    return self.list(base + " and 'root' in parents", 'id,name').then(function (f) {
      return f.length ? f : self.list(base, 'id,name');
    }).then(function (f) {
      if (!f.length) { var e = new Error('nofolder'); e.noFolder = true; throw e; }
      localStorage.setItem('chitanka.driveRoot', f[0].id);
      return f[0].id;
    });
  };
  DriveSource.prototype.listBooks = function () {
    var self = this;
    return self.rootFolder().then(function (rootId) {
      return self.list(qs(rootId) + " in parents and mimeType = '" + FOLDER + "' and trashed = false", 'id,name,modifiedTime');
    }).then(function (f) { return f.map(function (x) { return { id: x.id, name: x.name }; }); }, function (e) {
      if (!e.auth) localStorage.removeItem('chitanka.driveRoot');
      throw e;
    });
  };
  DriveSource.prototype.listFiles = function (bookId) {
    return this.list(qs(bookId) + " in parents and trashed = false and mimeType != '" + FOLDER + "'", 'id,name,mimeType,size,modifiedTime,md5Checksum');
  };
  DriveSource.prototype.fetchFile = function (file) {
    return this.req('files/' + encodeURIComponent(file.id), { alt: 'media' });
  };

  root.ChitankaDriveSource = DriveSource;
})(this);
