/* Гугл Диск вимкнено: Читанка більше не входить у Google і не читає Диск. */
(function (root) {
  'use strict';
  function DriveSource() {
    this.kind = 'photo';
    this.needsAuth = false;
  }
  DriveSource.prototype.isSignedIn = function () { return true; };
  DriveSource.prototype.everSignedIn = function () { return false; };
  DriveSource.prototype.signIn = function () { return Promise.resolve(); };
  DriveSource.prototype.handleRedirect = function () { return null; };
  DriveSource.prototype.signOut = function () {};
  DriveSource.prototype.listBooks = function () { return Promise.resolve([]); };
  DriveSource.prototype.listFiles = function () { return Promise.resolve([]); };
  DriveSource.prototype.fetchFile = function () { return Promise.reject(new Error('drive-off')); };
  root.ChitankaDriveSource = DriveSource;
})(this);
