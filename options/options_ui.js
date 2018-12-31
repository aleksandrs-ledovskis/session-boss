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

// Options module

(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import sbcfg
    // import app
    // import settings
    let SessionBossSettings = settings.SessionBossSettings;

    let log = new logger.Logger(sbcfg.APPNAME, modulename, sbcfg.LOGLEVEL);

    var module = function() { };    // Module object to be returned; local reference to the package object for use below.
    if (modulename)
        scope[modulename] = module; // set module name in scope, otherwise caller sets the name with the returned module object.

    let orgSettings = SessionBossSettings.ofLatest();
    let sbSettings  = SessionBossSettings.ofLatest();
    let hasChanged  = false;

    // Firefox's Content Security Policy for WebExtensions prohibits running any Javascript in the html page.
    // Wait for the page loaded event before doing anything.
    window.addEventListener("load", function(event){
        // Page is loaded and ready for the script to run.
        Promise.resolve()
            .then(() => log.info("Page initialization starts") )
            .then(() => settings.pLoad().then( s => {
                orgSettings = s;
                sbSettings = Object.assign({}, orgSettings);
            } ))
            .then(() => setupDOMListeners())
            .then(() => refreshControls())
            .then(() => refreshSettings())
            .then(() => activateTab("tab-general"))
            .then(() => log.info("Page initialization done") )
            .catch( e => log.warn(e) )
    });

    function refreshControls() {
        if (hasChanged) {
            $("#saveChanges").removeClass("disabled");
            $("#undoChanges").removeClass("disabled");
        } else {
            $("#saveChanges").addClass("disabled");
            $("#undoChanges").addClass("disabled");
        }
    }

    function updateChanges() {
        hasChanged = true;
        refreshControls();
    }

    function refreshSettings() {
        $("#autoRestoreOnStartup").prop("checked", sbSettings.autoRestoreOnStartup);
        $("#lazyTabLoadingOnRestore").prop("checked", sbSettings.lazyTabLoadingOnRestore);
        $("#enableScheduleBackup").prop("checked", sbSettings.enableScheduleBackup);
        $("#enableOnChangeBackup").prop("checked", sbSettings.enableOnChangeBackup);

        $(".is-error").removeClass("is-error");
    }

    function setupDOMListeners() {
        // Handle click on the tabs.
        $("ul.tab li.tab-item").click(function(){
		    let tabid = $(this).data("tabid");
		    $(this).addClass("active").siblings().removeClass("active");
            $(".tab-body#" + tabid).show().siblings().hide();
        })

        // Input handlers
        $("#autoRestoreOnStartup").on("change",     function(){ sbSettings.autoRestoreOnStartup = this.checked; updateChanges() });
        $("#lazyTabLoadingOnRestore").on("change",  function(){ sbSettings.lazyTabLoadingOnRestore = this.checked; updateChanges() });
        $("#enableScheduleBackup").on("change",     function(){ sbSettings.enableScheduleBackup = this.checked; updateChanges() });
        $("#enableOnChangeBackup").on("change",     function(){ sbSettings.enableOnChangeBackup = this.checked; updateChanges() });

        // Button handlers
        $("#saveChanges").on("click",       function(){ settings.pSave(sbSettings).then(() => postSaving(orgSettings, sbSettings) ) });
        $("#undoChanges").on("click",       function(){ settings.pSave(orgSettings).then(() => postSaving(sbSettings, orgSettings)) });
        $("#resetToDefault").on("click",    function(){
            sbSettings = SessionBossSettings.ofLatest();
            refreshSettings();
            updateChanges();
        });

    }

    function activateTab(tabid) {
        $("ul.tab li.tab-item[data-tabid='" + tabid + "']").addClass("active").siblings().removeClass("active");
        $(".tab-body#" + tabid).show().siblings().hide();
    }

    function postSaving(oldSettings, newSettings) {
        orgSettings = Object.assign({}, newSettings);
        sbSettings  = Object.assign({}, newSettings);
        hasChanged = false;
        refreshControls();
        refreshSettings();
    }

    function stopEvent(e) {
        e.preventDefault();
        return false;
    }

    
    log.info("module loaded");
    return module;

}(this, "options_ui"));     // Pass in the global scope as 'this' scope.

