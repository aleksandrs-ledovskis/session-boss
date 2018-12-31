/*
  Session Boss
  A Firefox extension to manage the browser tab sessions.
  Copyright (C) 2018  William Wong (williamw520@gmail.com)

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Setting module

(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import appcfg

    let log = new logger.Logger(sbcfg.APPNAME, modulename, sbcfg.LOGLEVEL);

    let module = function() { };        // Module object to be returned.
    if (scope && modulename)
        scope[modulename] = module;     // set module name in scope, otherwise caller sets the name with the returned module object.


    class SessionBossSettings {

        static ofLatest() {
            return new SessionBossSettings()._newVersion1();            // Bump up version as new settings are added.
        }

        static upgradeWith(jsonObj) {
            return SessionBossSettings.ofLatest()._fromObj(jsonObj);    // initialize with latest version, then override with the data object.
        }

        static loadAs(jsonObj) {
            let ttSettings = new SessionBossSettings();
            ttSettings._version = jsonObj._version;                     // preserve the version from the jsonObj
            return ttSettings._fromObj(jsonObj);
        }

        constructor() {
            this._type = "SessionBossSettings";
        }

        _fromObj(jsonObj) {
            switch (jsonObj._version) {
            case 1:
                return this._fromVersion1(jsonObj);
            case 2:
                return this._fromVersion2(jsonObj);
            default:
                throw Error("Unsupported object version " + jsonObj._version);
            }
        }

        _newVersion1() {
            this._version                   = 1;
            this.lazyTabLoadingOnRestore    = true;
            this.autoRestoreOnStartup       = false;
            this.enableScheduleBackup       = true;
            this.enableOnChangeBackup       = true;
            return this;
        }

        _fromVersion1(jsonObj) {
            this.lazyTabLoadingOnRestore    = jsonObj.hasOwnProperty("lazyTabLoadingOnRestore") ? jsonObj.lazyTabLoadingOnRestore : true;
            this.autoRestoreOnStartup       = jsonObj.hasOwnProperty("autoRestoreOnStartup") ? jsonObj.autoRestoreOnStartup : false;
            this.enableScheduleBackup       = jsonObj.hasOwnProperty("enableScheduleBackup") ? jsonObj.enableScheduleBackup : true;
            this.enableOnChangeBackup       = jsonObj.hasOwnProperty("enableOnChangeBackup") ? jsonObj.enableOnChangeBackup : true;
            return this._validate1();
        }

        _validate1() {
            return this;
        }

        _newVersion2() {
            this._newVersion1();
            this._version                   = 2;
            //this.dummyProperty            = true;
            return this;
        }

        _fromVersion2(jsonObj) {
            this._fromVersion1(jsonObj);
            //this.dummyProperty            = jsonObj.hasOwnProperty("dummyProperty") ? jsonObj.dummyProperty : true;
            return this._validate2();
        }

        _validate2() {
            return this;
        }

    }

    function pLoad() {
        return browser.storage.local.get("sessionBossSettings")
            .then( results => {
                return results && results.hasOwnProperty("sessionBossSettings") ?
                    SessionBossSettings.upgradeWith(results.sessionBossSettings) : SessionBossSettings.ofLatest();
            })
            .catch( e => {
                log.warn(e);
                return SessionBossSettings.ofLatest();
            })
    }

    function pSave(ttSettings) {
        return browser.storage.local.set({ "sessionBossSettings": ttSettings });
    }

    function pRemove() {
        return browser.storage.local.remove("sessionBossSettings");
    }

    function pUpdate(property, value) {
        return pLoad().then(ttSettings => {
            ttSettings[property] = value;
            return ttSettings;
        }).then(pSave)
    }
    

    // Module export
    module.SessionBossSettings = SessionBossSettings;
    module.pLoad = pLoad;
    module.pSave = pSave;
    module.pRemove = pRemove;
    module.pUpdate = pUpdate;

    log.info("module loaded");
    return module;

}(this, "settings"));   // Pass in the global scope as 'this' scope.

