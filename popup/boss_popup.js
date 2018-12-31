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

(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import sbcfg
    // import app
    // import dlg
    // import session
    // import sessiongroup
    // import sessions
    let Session  = session.Session;
    let Sessions = sessions.Sessions;

    let log = new logger.Logger(sbcfg.APPNAME, modulename, sbcfg.LOGLEVEL);

    var module = function() { };    // Module object to be returned; local reference to the package object for use below.
    if (modulename)
        scope[modulename] = module; // set module name in scope, otherwise caller sets the name with the returned module object.

    log.info("module init");

    const SESSION_TAB_IDS       = ["all-sessions", "user-sessions", "auto-sessions", "onchange-sessions"];
    const SESSION_DETAIL_CMDS   = [".cmd-replace-sess", ".cmd-restore-sess", ".cmd-toggle-win"];
    const INACTIVE_AUTO_CMDS    = [".cmd-update-sess", ".cmd-rename-sess", ".cmd-setgroup-sess", ".cmd-auto-restore", ".cmd-delete-sess",
                                   ".cmd-update-win", ".cmd-rename-win", ".cmd-delete-win", ".cmd-tab-edit-start", ".cmd-explicit-win"];
    const SORT_TYPES            = ["T", "G", "N"];     // T = by-time, G = by-group, N = by-name
    const SORT_CMDS             = [".cmd-sort-by-time", ".cmd-sort-by-group", ".cmd-sort-by-name"];
    const SORT_CMD_MAP          = SORT_TYPES.reduce( (map, st, i) => { map[st] = SORT_CMDS[i]; return map }, {} );

    // Special Firefox container types.
    const CT_FIREFOX_DEFAULT = "firefox-default";
    const CT_FIREFOX_PRIVATE = "firefox-private";
    const CT_SPECIAL_TYPES = [CT_FIREFOX_DEFAULT, CT_FIREFOX_PRIVATE];
    function is_firefox_default(id) { return id == CT_FIREFOX_DEFAULT }
    function is_firefox_private(id) { return id == CT_FIREFOX_PRIVATE }
    function is_real_container(id)  { return !is_firefox_default(id) && !is_firefox_private(id) }

    // Colors
    const COLOR_DEFAULT = "#97999d";
    const COLOR_PRIVATE = "#8D20AE";    // purple

    let uiState;
    let lastCmd = "";
    let sessionsData = Sessions.newInitSessions();
    let previousExitId = "";
    let containerById = {};         // the only map holding the Container objects
    let containerIds = [];          // track the order of the containers, id only.

    let searchTermsByTabId = SESSION_TAB_IDS.reduce( (map, stabId) => { map[stabId] = []; return map }, {} );   // { tab-id: [] }
    let sessionsGetterByTabId = {
        "all-sessions":     function(){ return [].concat.apply([], [sessionsData.userSessions, sessionsData.autoSessions, sessionsData.onchangeSessions ]) },
        "user-sessions":    function(){ return sessionsData.userSessions },
        "auto-sessions":    function(){ return sessionsData.autoSessions },
        "onchange-sessions":function(){ return sessionsData.onchangeSessions },
    }
    let sessionCounterByTabId = {
        "all-sessions":     function(){ return sessionsData.totalCount  },
        "user-sessions":    function(){ return sessionsData.userCount   },
        "auto-sessions":    function(){ return sessionsData.autoCount   },
        "onchange-sessions":function(){ return sessionsData.onchangeCount },
    }

    // Firefox's Content Security Policy for WebExtensions prohibits running any Javascript in the html page.
    // Have to wait for the page loaded event before doing anything.
    window.addEventListener("load", function(event){
        // Page is loaded and ready for the script to start.
        log.info("Popup page loaded.  Popup initialization starts.");
        Promise.resolve()
            .then(() => refreshTopBar())
            .then(() => pLoadContainers())
            .then(() => generateTabUIContent())
            .then(() => pLoadUiState())
            .then(() => monitorExitEvent())
            .then(() => pLoadSessionData())
            .then(() => pCheckCrashState())
            .then(() => pMonitorSessionDataChange())
            .then(() => setupDOMListeners())
            .then(() => activateTab(uiState.tabSelected))   // UI and data ready.  Restore the last tab selected.  Refresh dynamic content.
            .then(() => refreshGlobalCmds())
            .then(() => refreshTabBadges())
            .then(() => log.info("Popup initialization done") )
            .catch( e => log.warn(e) )
    });

    async function saveUiStateNow() {
        if (uiState) {
            await browser.storage.local.set({ "uiState": uiState }).then(() => true);
        }
    }

    let dSaveUiState = app.debounce(saveUiStateNow, 30*1000, false);    // onblur event already saves upon popup closing; save infrequently in case of crash.

    function pLoadUiState() {
        //log.info("pLoadUiState");
        return browser.storage.local.get("uiState")
            .then( objFromJson => {
                uiState = normalizeUiState(objFromJson.uiState);
                //log.info("loaded uiState ", uiState);
            })
            .catch(e => {
                uiState = normalizeUiState();
                log.error(e);
            })
    }

    function normalizeUiState(state) {
        let uiState = {};

        state = state || {};
        uiState.tabSelected         = state.tabSelected || 1;   // tab index ranges [1-4]
        uiState.sessionTabSelectedId= state.sessionTabSelectedId || {};
        uiState.windowCollapsed     = state.windowCollapsed || {};
        uiState.searchByTab         = app.defObjVal(state, "searchByTab", false);
        uiState.displayTabUrl       = app.defObjVal(state, "displayTabUrl", false);
        uiState.showActiveOnly       = app.defObjVal(state, "showActiveOnly", false);

        uiState.tabEdit             = Object.assign({}, state.tabEdit || {});
        uiState.tabEdit.sid         = app.defObjVal(uiState.tabEdit, "sid", "");
        uiState.tabEdit.wid         = app.defObjVal(uiState.tabEdit, "wid", "");
        uiState.tabEdit.tabs        = app.defObjVal(uiState.tabEdit, "tabs", []);
        uiState.tabEdit.changed     = app.defObjVal(uiState.tabEdit, "changed", {});
        uiState.tabEdit.moved       = app.defObjVal(uiState.tabEdit, "moved", {});
        uiState.tabEdit.deleted     = app.defObjVal(uiState.tabEdit, "deleted", {});

        // ["all-sessions", "user-sessions", "auto-sessions", "onchange-sessions"];
        uiState.sortState = state.sortState = Object.assign({}, state.sortState || {});
        SESSION_TAB_IDS.forEach( stabId => {
            let sortState = uiState.sortState[stabId] = state.sortState[stabId] || {};
            sortState.sortBy = sortState.sortBy || (stabId == "auto-sessions" ? "G" : "T");  // auto session sorting default to Group, all others default to Time.
            sortState.sortDirection = Object.assign({}, sortState.sortDirection || {});
            SORT_TYPES.forEach( st => sortState.sortDirection[st] = sortState.sortDirection[st] || 1 );
        });

        return uiState;
    }

    function pLoadContainers() {
        return pGetContainerInfos().then( contextualIdentities => {
            containerIds    = contextualIdentities.map( c => c.cookieStoreId );
            containerById   = contextualIdentities.reduce( (map, c) => { map[c.cookieStoreId] = c; return map }, {} );
        })
    }

    // get the containers defined in the system. 
    function pGetContainerInfos() {
        return browser.contextualIdentities.query({})
            .then( contextualIdentities => {
                contextualIdentities.unshift({
                        cookieStoreId:  CT_FIREFOX_PRIVATE,
                        name:           "Private Browsing",
                        colorCode:      COLOR_PRIVATE,
                        iconUrl:        "",
                });
                contextualIdentities.unshift({
                        cookieStoreId:  CT_FIREFOX_DEFAULT,
                        name:           "General Tabs",
                        colorCode:      COLOR_DEFAULT,
                        iconUrl:        "",
                });
                return contextualIdentities;
            });
    }

    // function containerInfo(cid) {
    //     containerById[cid]
    // }

    // Monitor the popup page is being closed.
    function monitorExitEvent() {
        window.addEventListener("blur", function(e){
            log.info("Popup page exit");
            saveUiStateNow();
        });
    }

    function $tabOf(tabIndex)   { return $("ul.tab li.tab-item:nth-child(" + tabIndex + ")") }
    function $tabActive()       { return $("ul.tab li.tab-item.active") }
    function $sessionTab(dom)   { return $(dom).closest(".sessions-tab-content") }
    function sessionTabId(dom)  { return $sessionTab(dom).attr("id") }
    function $selectedSid(dom)  { return $sessionTab(dom).find(".session-item.session-selected") }
    function selectedSid(dom)   { return $selectedSid(dom).data("sid") }    // data-sid is part of the selected .session-item div.
    function confirmDlg(msg,fn) { dlg.openDlg("#confirm-dlg", {}, {".text-msg": msg}, {}, ".modal-cancel", fn) }

    function setupDOMListeners() {
        log.info("setupDOMListeners");

        dlg.setupDlg("#confirm-dlg", true);
        dlg.setupDlg("#text-dlg", true);
        dlg.setupDlg("#single-input-dlg", false);
        dlg.setupDlg("#text-input2-dlg", false);
        dlg.setupDlg("#session-name-dlg", false);
        dlg.setupDlg("#about-dlg", true);

        // Handle click on the tabs.
        $("ul.tab li.tab-item").click(function(){
            activateTab($(this).index() + 1);
        })

        // Global menu at the top navbar
        $("#global-cmds").on("click", ".cmd-undo-snapshot", function(){ sendCmd({ cmd: "undo-snapshot" }) });
        $("#global-cmds").on("click", ".cmd-redo-snapshot", function(){ sendCmd({ cmd: "redo-snapshot" }) });
        $("#global-cmds").on("click", ".cmd-save-all",      function(){
            if (sessionsData.reachedUserMax) {
                confirmDlg("The saved user sessions have reached the maximum limit. <br><br>Saving a new one will delete the oldest user session.  Proceed?",
                           () => sendCmd({ cmd: "save-all" }) );
            } else {
                sendCmd({ cmd: "save-all" })
            }
        });
        $("#global-cmds").on("click", ".cmd-save-window",   function(){
            if (sessionsData.reachedUserMax) {
                confirmDlg("The saved user sessions have reached the maximum limit. <br><br>Saving a new one will delete the oldest user session.  Proceed?",
                           () => sendCmd({ cmd: "save-window" }) );
            } else {
                sendCmd({ cmd: "save-window" })
            }
        });
        $("#global-cmds").on("click", ".cmd-preferences",   function(){ browser.runtime.openOptionsPage(); close(); });
        $("#global-cmds").on("click", ".cmd-backup-now",    function(){ sendCmd({ cmd: "backup-now" }) });
        $("#global-cmds").on("click", ".cmd-del-all-user",  function(){ sendCmd({ cmd: "del-all-user" }) });
        $("#global-cmds").on("click", ".cmd-del-all-backup",function(){
            confirmDlg("Delete all scheduled backup sessions? <br><br><b>Note: This operation cannot be undone with Undo.</b>",
                       () => sendCmd({ cmd: "del-all-backup"    }) );
        });
        $("#global-cmds").on("click", ".cmd-del-all-onchange",function(){
            confirmDlg("Delete all on-change backup sessions? <br><br><b>Note: This operation cannot be undone with Undo.</b>",
                       () => sendCmd({ cmd: "del-all-onchange"  }) );
        });
        $("#global-cmds").on("click", ".cmd-purge-all",     function(){
            confirmDlg("Purge all session data and all change log history data for undo? <br><br><b>Note: this operation cannot be undone.</b>",
                       () => sendCmd({ cmd: "purge-all" }) );
        });
        $("#global-cmds").on("click", ".cmd-clear-crash",   function(){ previousExitId = ""; sendCmd({ cmd: "clear-crash-state" }).then(() => dRefreshUIForLastCmd()) });
        $("#global-cmds").on("click", ".cmd-about",         function(){
            let manifest = browser.runtime.getManifest();
            dlg.openDlg("#about-dlg", {
                ".app-name":    manifest.name,
                ".app-version": manifest.version,
                ".app-author":  manifest.author,
            }, {}, {}, ".modal-submit");
        });
        $("#global-cmds").on("click", ".dbg-log-tabs",      function(){ sendCmd({ cmd: "log-tabs" }) });
        $("#global-cmds").on("click", ".dbg-test",          function(){ flashSelectedItem() });
        //$("#global-cmds").on("click", ".dbg-test",          function(){ sendCmd({ cmd: "dbg-test" }) });
        
        // Search in a session list.
        $(".sessions-tab-content").on("keyup paste", ".session-search", function(){
            let stabId  = $(this).closest(".sessions-tab-content").attr("id");
            searchTermsByTabId[stabId] = $(this).val().split(" ");
            refreshTabDynamicUI(stabId);
        });
        $(".sessions-tab-content").on("click", ".session-search", function(){
            $(this).select();
        });
        $(".sessions-tab-content").on("click", ".tag-group", function(e){
            e.preventDefault();
            let stabId  = $(this).closest(".sessions-tab-content").attr("id");
            let group   = $(this).data("group");
            if (group) {
                let searchTerm = "group:" + group;
                $(".sessions-tab-content .session-search").val(searchTerm);
                searchTermsByTabId[stabId] = [searchTerm];
                refreshSessionListPane(stabId);
            }
            return false;
        });
        $(".sessions-tab-content").on("click", ".cmd-search-tabs", function(){
            let stabId  = $(this).closest(".sessions-tab-content").attr("id");
            uiState.searchByTab = !uiState.searchByTab;
            refreshSessionListPane(stabId);
        });

        // Sort each tab's session list.
        function onSortCmd(elem, sortType) {
            let stabId      = $(elem).closest(".sessions-tab-content").attr("id");
            let sortState   = uiState.sortState[stabId];
            if (sortState.sortBy == sortType)   // toggle only if sortBy is same as before
                sortState.sortDirection[sortType] = sortState.sortDirection[sortType] ? -sortState.sortDirection[sortType] : 1;
            sortState.sortBy = sortType;
            refreshSessionListPane(stabId);
        }
        SESSION_TAB_IDS.forEach( stabId => {
            SORT_TYPES.forEach( sortType => $("#" + stabId).on("click", SORT_CMD_MAP[sortType], function(){ onSortCmd(this, sortType) }) );
        });
        
        // A session in the session list is clicked.
        $(".sessions-tab-content").on("click", ".session-item", function(){
            let stabId              = sessionTabId(this);
            let clickedSessionId    = $(this).data("sid");  // data-sid is part of the .session-item div.
            uiState.sessionTabSelectedId[stabId] = clickedSessionId;
            dSaveUiState();
            $(this).addClass("session-selected").siblings().removeClass("session-selected");
            refreshSessionDetailPane(stabId, sessionsData.getSessionById(clickedSessionId));
        });

        // The session menu navbar on the individual session detail pane is clicked.
        function msgRestoreSess(elem, cmd) {
            return {
                cmd:            cmd,
                sessionId:      selectedSid(elem),
                searchTerms:    searchTermsByTabId[sessionTabId(elem)],
                searchByTab:    uiState.searchByTab,
            }
        }
        $("#main-content").on("click", ".cmd-restore-sess", function(){ sendCmd(msgRestoreSess(this, "restore-sess")) });
        $("#main-content").on("click", ".cmd-replace-sess", function(){ sendCmd(msgRestoreSess(this, "replace-sess")) });
        $("#main-content").on("click", ".cmd-update-sess",  function(){ sendCmd({ cmd: "update-sess",           sessionId: selectedSid(this) }) });
        $("#main-content").on("click", ".cmd-auto-restore", function(){ sendCmd({ cmd: "toggle-auto-resotre",   sessionId: selectedSid(this) }) });
        $("#main-content").on("click", ".cmd-copy-sess",    function(){
            let sessionId = selectedSid(this);
            if (sessionsData.reachedUserMax) {
                confirmDlg("The saved user sessions have reached the maximum limit. <br><br>Saving a new one will delete the oldest user session.  Proceed?",
                           () => sendCmd({ cmd: "copy-sess", sessionId: sessionId }) );
            } else {
                sendCmd({ cmd: "copy-sess", sessionId: sessionId });
            }
        });
        $("#main-content").on("click", ".dbg-log-sess",     function(){ sendCmd({ cmd: "log-sess",      sessionId: selectedSid(this) }) });
        $("#main-content").on("click", ".cmd-toggle-win",   function(){
            let switchCheckbox = $(this).closest(".session-detail").find(".accordion input:checkbox");
            let switchExpanded = $(this).closest(".session-detail").find(".accordion input:checked");
            if (switchCheckbox.length == switchExpanded.length)
                $(this).closest(".session-detail").find(".accordion input:checkbox").prop("checked", false).trigger("change");
            else
                $(this).closest(".session-detail").find(".accordion input:checkbox").prop("checked", true).trigger("change");
        });
        $("#main-content").on("click", ".cmd-toggle-url",   function(){
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let sess        = sessionsData.getSessionById(sessionId);
            uiState.displayTabUrl = !uiState.displayTabUrl;
            refreshSessionDetailCmdsOnUIState();
            dSaveUiState();
            refreshSessionDetailPane(stabId, sess);
        });
        $("#main-content").on("click", ".cmd-toggle-active",function(){
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let sess        = sessionsData.getSessionById(sessionId);
            uiState.showActiveOnly = !uiState.showActiveOnly;
            refreshSessionDetailCmdsOnUIState();
            dSaveUiState();
            refreshSessionDetailPane(stabId, sess);
        });
        $("#main-content").on("click", ".cmd-rename-sess, .session-detail-session-name",  function(){
            let sessionId   = selectedSid(this);
            let sess        = sessionsData.getSessionById(sessionId);
            if (sess.isAuto || sess.isOnChange)
                return;
            let $selected   = $(this).closest(".sessions-tab-content").find(".session-selected");

            dlg.openDlg("#session-name-dlg",
                        {
                            ".dlg-title":       "Rename Session",
                            ".input-label":     "New Session Name",
                            ".input-value":     sess && sess.sessionName,
                            ".input-context":   sessionId,
                        },
                        {},
                        {
                            ".input-value":     { maxlength: "80", placeholder: "max 80 characters" },
                        },
                        "input:text:first",
                        function(inputValues){
                            $selected.addClass("flash-yellow").delay(300).queue(function(){
                                $selected.removeClass("flash-yellow").dequeue();
                                sendCmd({
                                    cmd:        "rename-sess",
                                    newName:    inputValues[".input-value"],
                                    sessionId:  inputValues[".input-context"],
                                })
                            });
                        });
            $("#session-name-dlg .dlg-btn-datetime").off().on("click", function(){
                $("#session-name-dlg .input-value").val(sess.userSessionTsName);
                $("#session-name-dlg input:text:first").focus().select();
            });
            $("#session-name-dlg .dlg-btn-title").off().on("click", function(){
                $("#session-name-dlg .input-value").val(sess.focusedWindow.title);
                $("#session-name-dlg input:text:first").focus().select();
            });
        });
        $("#main-content").on("click", ".cmd-delete-sess",  function(){
            let stabId      = sessionTabId(this);
            let $items      = $sessionTab(this).find(".session-item");
            let $selected   = $selectedSid(this);
            let sessionId   = selectedSid(this);

            // Figure out the next item to select in the session list after delete.
            let $nextSess   = $items;
            $items.each(function(i){
                if ($(this).data("sid") == sessionId)
                    $nextSess = $($items.get(i + 1));
            });
            $nextSess = $nextSess.length == 0 ? $items : $nextSess;
            uiState.sessionTabSelectedId[stabId] = $nextSess.length == 0 ? null : $nextSess.data("sid");

            // Delete the item;
            $selected.addClass("flash-yellow").delay(300).queue(function(){
                $selected.removeClass("flash-yellow").dequeue();
                sendCmd({ cmd: "delete-sess",  sessionId: sessionId });
            });
        });

        // Set group on session
        function setGroupDlg(thisElem) {
            let sessionId   = selectedSid(thisElem);
            let sess        = sessionsData.getSessionById(sessionId);
            if (sess.isAuto || sess.isOnChange)
                return;
            let $selected   = $(thisElem).closest(".sessions-tab-content").find(".session-selected");
            dlg.openDlg("#single-input-dlg",
                        {
                            ".dlg-title":       "Set Group for Session",
                            ".input-label":     "Group",
                            ".input-value":     sess && sess.group,
                            ".input-context":   sessionId,
                        },
                        {},
                        {
                            ".input-value":     { maxlength: "20", placeholder: "max 20 characters" },
                        },
                        "input:text:first",
                        function(inputValues){
                            $selected.addClass("flash-yellow").delay(300).queue(function(){
                                $selected.removeClass("flash-yellow").dequeue();
                                sendCmd({
                                    cmd:        "setgroup-sess",
                                    group:      inputValues[".input-value"].replace(/\s+/g, '-'),
                                    sessionId:  inputValues[".input-context"],
                                })
                            });
                        });
        }
        $("#main-content"           ).on("click",   ".cmd-setgroup-sess",   function(){ setGroupDlg(this) });
        $(".sessions-tab-content"   ).on("click",   ".tag-group-edit",      function(){ setGroupDlg(this) });
        $(".sessions-tab-content"   ).on("click",   ".tag-group-set",       function(){ setGroupDlg(this) });

        // The window menu navbar on the individual window is clicked.
        function msgRestoreWin(elem, cmd) {
            return {
                cmd:            cmd,
                sessionId:      selectedSid(elem),
                wid:            $(elem).data("wid"),
                searchTerms:    searchTermsByTabId[sessionTabId(elem)],
                searchByTab:    uiState.searchByTab,
            }
        }
        $("#main-content").on("click", ".window-cmds",      function(e){ e.preventDefault() }); // don't propagate event up beyond the window-cmds div
        $("#main-content").on("click", ".cmd-restore-win",  function(){ sendCmd(msgRestoreWin(this, "restore-win")) });
        $("#main-content").on("click", ".cmd-append-win",   function(){ sendCmd(msgRestoreWin(this, "append-win")) });
        $("#main-content").on("click", ".cmd-replace-win",  function(){ sendCmd(msgRestoreWin(this, "replace-win")) });
        $("#main-content").on("click", ".cmd-update-win",   function(){ sendCmd({ cmd: "update-win", sessionId: selectedSid(this), wid: $(this).data("wid") }) });
        $("#main-content").on("click", ".cmd-delete-win",   function(){ sendCmd({ cmd: "delete-win", sessionId: selectedSid(this), wid: $(this).data("wid") }) });
        $("#main-content").on("click", ".cmd-explicit-win", function(){
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let wid         = $(this).data("wid");
            let sess        = sessionsData.getSessionById(sessionId);
            let win         = sess.windows.find( w => w.id == wid );
            let explicit    = !win._explicitRestore;
            //log.info("cmd-explicit-win " + win._explicitRestore + " " + explicit);
            sendCmd({ cmd: "explicit-win",  sessionId: sessionId,  wid: wid,  _explicitRestore: explicit });
        });
        $("#main-content").on("click", ".cmd-rename-win",   function(){
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let wid         = $(this).data("wid");
            let sess        = sessionsData.getSessionById(sessionId);
            let windex      = sess.windex(wid);
            if (sess.isAuto || sess.isOnChange)
                return;
            let $selected   = $(this).closest(".sessions-tab-content").find(".session-selected");
            dlg.openDlg("#single-input-dlg",
                        {
                            ".dlg-title":       "Rename Window",
                            ".input-label":     "New Window Name",
                            ".input-value":     sess.windowName(windex),
                        },
                        {},
                        {
                            ".input-value":     { maxlength: "80", placeholder: "max 80 characters" },
                        },
                        "textarea:first",
                        function(inputValues){
                            $selected.addClass("flash-yellow").delay(300).queue(function(){
                                $selected.removeClass("flash-yellow").dequeue();
                                sendCmd({
                                    cmd:        "rename-win",
                                    newName:    inputValues[".input-value"],
                                    sessionId:  sessionId,
                                    wid:        wid,
                                })
                            });
                        });
        });
        $("#main-content").on("click", ".cmd-tab-edit-start",   function(){
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let wid         = $(this).data("wid");
            let sess        = sessionsData.getSessionById(sessionId);
            uiState.tabEdit.sid  = sessionId;                   // save the session id whose tabs are being edited.
            uiState.tabEdit.wid  = wid;                         // save the window id whose tabs are being edited.
            uiState.tabEdit.tabs = sess.windowTabsClone(wid);   // tracking the tab changes in a copy of the tabs array.
            refreshSessionWindowsAndTabs(stabId, sess);
        });
        $("#main-content").on("click", ".cmd-tab-edit-cancel",  function(){
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let sess        = sessionsData.getSessionById(sessionId);
            uiState.tabEdit.sid = "";
            uiState.tabEdit.wid = "";
            uiState.tabEdit.tabs = [];
            uiState.tabEdit.changed = {};
            uiState.tabEdit.moved = {};
            uiState.tabEdit.deleted = {};
            refreshSessionWindowsAndTabs(stabId, sess);
        });
        $("#main-content").on("click", ".cmd-tab-edit-save",    function(){
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let wid         = $(this).data("wid");
            let sess        = sessionsData.getSessionById(sessionId);
            let tabsUpdated = Object.keys(uiState.tabEdit.changed).length > 0 ||
                              Object.keys(uiState.tabEdit.moved).length > 0   ||
                              Object.keys(uiState.tabEdit.deleted).length > 0;
            if (tabsUpdated) {
                sendCmd({
                    cmd:            "update-tabs",
                    sessionId:      sessionId,
                    wid:            wid,
                    changedTabs:    uiState.tabEdit.changed,
                    moved:          uiState.tabEdit.moved,
                    deleted:        uiState.tabEdit.deleted,
                    orderedIds:     uiState.tabEdit.tabs.map( t => t.id ),
                });
            }
            uiState.tabEdit.sid = "";
            uiState.tabEdit.wid = "";
            uiState.tabEdit.tabs = [];
            uiState.tabEdit.changed = {};
            uiState.tabEdit.moved = {};
            uiState.tabEdit.deleted = {};
            if (!tabsUpdated)
                refreshSessionWindowsAndTabs(stabId, sess);     // revert back to normal display if no change, otherwise, the storage updated event will redraw with new content.
        });

        // Click handler on the tab-url elements.
        $("#main-content").on("click", "a.tab-url",         function(e){
            // Stop the click event, and do a single tab restoration to the current window.
            e.preventDefault();
            sendCmd({ cmd: "restore-tab", sessionId: selectedSid(this), wid: $(this).data("wid"), tid: $(this).data("tid") });
            return false;
        });
        $("#main-content").on("click", ".cmd-tab-delete",   function(){
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let $tabline    = $(this).closest(".tab-line");
            let tabIndex    = $tabline.index();
            let tab         = uiState.tabEdit.tabs[tabIndex];
            uiState.tabEdit.deleted[tab.id] = true;
            $tabline.replaceWith(renderSessionTab(stabId, sessionId, tab, true));   // unsafe text substituted with placeholders
            fillSessionTab(stabId, sessionId, tab);                                 // fill in the placeholders

            // uiState.tabEdit.tabs.splice(tabIndex, 1);
            // $tabline.remove();
            
            // TODO: pending 
            // sendCmd({ cmd: "delete-tab",  sessionId: selectedSid(this), wid: $(this).data("wid"), tid: $(this).data("tid")})
        });
        $("#main-content").on("click", ".cmd-tab-edit-url", function(e){
            e.preventDefault();
            let stabId      = sessionTabId(this);
            let sessionId   = selectedSid(this);
            let $tabline    = $(this).closest(".tab-line");
            let tabIndex    = $tabline.index();
            let tab         = uiState.tabEdit.tabs[tabIndex];
            dlg.openDlg("#text-input2-dlg",
                        {
                            ".dlg-title":       "Edit Tab Title and URL",
                            ".input-label1":    "Tab Title",
                            ".input-value1":    tab.title,
                            ".input-label2":    "Tab URL",
                            ".input-value2":    tab.url,
                        },
                        {},
                        {
                            ".input-value1":    {rows: "1"},
                            ".input-value2":    {rows: "2"},
                        },
                        ".input-value1",
                        function(inputValues){
                            tab.title = inputValues[".input-value1"];
                            tab.url = inputValues[".input-value2"];
                            uiState.tabEdit.changed[tab.id] = tab;
                            $tabline.replaceWith(renderSessionTab(stabId, sessionId, tab, true));   // unsafe text substituted with placeholders
                            fillSessionTab(stabId, sessionId, tab);                                 // fill in the placeholders
                        });
            return false;
        });

        // The window accordion open/close switch is clicked.  Remember the switch state.
        $("#main-content").on("change", ".session-detail-windows .accordion input:checkbox", function(){
            let uiWinId = $(this).attr("id");
            uiState.windowCollapsed[uiWinId] = !$(this).is(":checked");
        });
    }

    function refreshTopBar() {
        let manifest = browser.runtime.getManifest();
        $(".logo-version").text(manifest.version);
    }
    
    function generateTabUIContent() {
        // Add in the TabUI html template fragment for each tab pane.
        // Note: .html() here adds in pure template text.  No unsafe text from tabs or windows are used.
        SESSION_TAB_IDS.forEach( stabId => $("#" + stabId + ".sessions-tab-content").html(renderTabLayout()) );
    }

    function pLoadSessionData() {
        log.info("pLoadSessionData");
        return Sessions.pLoadAllSessionsData().then( sessions => {
            sessionsData = sessions;
            log.info("Sessions data loaded.  userCount: " + sessionsData.userCount
                + ", autoCount: " + sessionsData.autoCount
                + ", onchangeCount: " + sessionsData.onchangeCount
                + ", totalCount: " + sessionsData.totalCount);
        });
    }

    function pCheckCrashState() {
        return sendCmd({ cmd: "get-prev-exit" })
            .then(response => {
                previousExitId = response.previousExitId || "";
            });
    }

    function pMonitorSessionDataChange() {
        log.info("pMonitorSessionDataChange");
        // Monitor Sessions storage change due to last command to refresh UI.
        return browser.storage.onChanged.addListener(storageChange => {
            let keys = Object.keys(storageChange);
            let hasSnapshot = keys.filter( key => Sessions.startsWithSnapshotName(key) ).length > 0;
            if (app.has(storageChange, "changeLogStore") ||
                hasSnapshot ||
                app.has(storageChange, "backupSessionStore") ||
                app.has(storageChange, "onchangeSessionStore") ||
                app.has(storageChange, "appStateStore")) {
                pLoadSessionData().then( () => dRefreshUIForLastCmd() );
            } else {
                log.info("storageChange change keys: " + keys.join(", ") + " ignored.");
            }
        });
    }


    function sendCmd(msg) {
        lastCmd = msg.cmd;
        return browser.runtime.sendMessage(msg);    // response is returned in .then( response => ... ).
    }

    let dRefreshUIForLastCmd = app.debounce(refreshUIForLastCmdNow, 250, false);
    function refreshUIForLastCmdNow() {
        log.info("refreshUIForLastCmdNow " + lastCmd);
        switch (lastCmd) {
        case "save-all":
        case "save-window":
            // New session was created.  Select it as the current selection.
            uiState.sessionTabSelectedId["all-sessions"]  = sessionsData.lastUserSavedId;
            uiState.sessionTabSelectedId["user-sessions"] = sessionsData.lastUserSavedId;
            activateTab(2); // show the user tab.
            flashSelectedItem();
            break;
        case "backup-now":
            // No need to change all-sessions tab's selected item for new backup session.
            uiState.sessionTabSelectedId["onchange-sessions"] = sessionsData.lastOnChangeSavedId;
            activateTab(4); // show the onchange tab.
            flashSelectedItem();
            break;
        case "del-all-user":
            activateTab(2); // show the user tab.
            break;
        case "del-all-backup":
            activateTab(3); // show the auto tab.
            break;
        case "del-all-onchange":
            activateTab(4); // show the onchange tab.
            break;
        case "update-sess":
            activateTab(uiState.tabSelected);
            flashSelectedItem();
            break;
        case "update-win":
            activateTab(uiState.tabSelected);
            flashSelectedItem();
            break;
        case "copy-sess":
            uiState.sessionTabSelectedId["user-sessions"] = sessionsData.lastOperationId;
            activateTab(2); // show the user tab.
            flashSelectedItem();
            break;
        case "update-tabs":
            activateTab(uiState.tabSelected);
            break;
        case "reorder-tabs":
            activateTab(uiState.tabSelected);
            flashSelectedItem();
            break;
        case "undo":
            log.info("undo " + uiState.sessionTabSelectedId["user-sessions"]);
            activateTab(uiState.tabSelected);
            break;
        case "redo":
            log.info("redo " + uiState.sessionTabSelectedId["user-sessions"]);
            activateTab(uiState.tabSelected);
            break;
        case "clear-crash-state":
            activateTab(uiState.tabSelected);
            break;
        case "get-crash-state":
            activateTab(uiState.tabSelected);
            break;
        default:
            activateTab(uiState.tabSelected);
            break;
        }
        refreshGlobalCmds();
        refreshTabBadges();
        lastCmd = "";
    }

    function refreshGlobalCmds() {
        // Clear crash cmd
        if (previousExitId) {
            $(".cmd-clear-crash").removeClass("disabled");
        } else {
            $(".cmd-clear-crash").addClass("disabled");
        }

        // Undo and redo cmds
        let undoCount = sessionsData.snapshotCursor;
        let redoCount = sessionsData.changeLog.newestIndex - sessionsData.snapshotCursor;
        if (undoCount > 0) {
            $(".cmd-undo-snapshot").removeClass("disabled").attr("data-badge", undoCount);
        } else {
            $(".cmd-undo-snapshot").addClass("disabled").attr("data-badge", "");
        }
        if (redoCount > 0) {
            $(".cmd-redo-snapshot").removeClass("disabled").attr("data-badge", redoCount);
            $("#undo-msg").text("Undo to snapshot #" + undoCount);
        } else {
            $(".cmd-redo-snapshot").addClass("disabled").attr("data-badge", "");
            $("#undo-msg").text("Undo not applied to backup sessions");
        }
    }

    function sortSessionsByTime(sessions, direction) {
        return sessions.concat().sort( (s1, s2) => direction * (s2.sessionTimeMS - s1.sessionTimeMS) );
    }

    function sortSessionsByName(sessions, direction) {
        return sessions.concat().sort( (s1, s2) => direction * (app.cmpStr(s1.sessionName, s2.sessionName)) );
    }

    function sortSessionsByGroup(sessions, direction) {
        let groups = sessions.reduce( (map, s) => {
            map[s.group] = map[s.group] || [];
            map[s.group].push(s);
            return map;
        }, {});
        let allKeys  = Object.keys(groups);
        let userKeys = allKeys
            .filter( k => !app.has(sessiongroup.BACKUP_GROUP_MAP, k) ).filter( k => k != session.GROUP_ONCHANGE )
            .sort( (k1, k2) => direction * (k1.localeCompare(k2)) );
        let autoKeys = sessiongroup.BACKUP_GROUP_TYPES.filter( k => app.has(groups, k) );
        let onchangeKeys = app.has(allKeys, session.GROUP_ONCHANGE) ? [session.GROUP_ONCHANGE] : [];
        if (direction < 0)
            autoKeys = autoKeys.reverse();
        let keys = onchangeKeys.concat(autoKeys).concat(userKeys);
        keys.forEach( k => groups[k].sort( (s1, s2) => 1 * (s2.sessionTimeMS - s1.sessionTimeMS) ) );
        return keys.reduce( (array, k) => array.concat(groups[k]), [] );
    }

    function sortSessions(stabId, sessions) {
        let state   = uiState.sortState[stabId];
        if (state.sortBy == "T")  return sortSessionsByTime(sessions, state.sortDirection["T"]);
        if (state.sortBy == "G")  return sortSessionsByGroup(sessions, state.sortDirection["G"]);
        if (state.sortBy == "N")  return sortSessionsByName(sessions, state.sortDirection["N"]);
        return sessions;
    }

    function activateTab(tabIndex) {
        let $tab        = $tabOf(tabIndex);
		let stabId      = $tab.attr("data-tab");
        let $tabContent = $("#" + stabId + ".sessions-tab-content");

		$tab.addClass("active").siblings().removeClass("active");
        $(".sessions-tab-content").hide();      // hide all tab content first.
        $tabContent.show();                     // show the active tab content next.

        let searchTerm  = searchTermsByTabId[stabId];
        $tabContent.find(".session-search").val(searchTerm);

        if (uiState.tabSelected != tabIndex) {
            uiState.tabSelected = tabIndex;
            dSaveUiState();
        }

        refreshTabDynamicUI(stabId);
    }

    function flashSelectedItem() {
        let $tab        = $tabActive();
		let stabId      = $tab.attr("data-tab");
        let $tabContent = $("#" + stabId + ".sessions-tab-content");
        let $selected   = $tabContent.find(".session-item.session-selected");

        $selected.addClass("flash-blue").delay(300).queue(function(){
            $selected.removeClass("flash-blue").dequeue();
        });
    }

    function refreshTabDynamicUI(stabId) {
        if (sessionsData.totalCount > 0) {
            $("#empty-content").addClass("hidden");
            $("#main-content" ).removeClass("hidden");
        } else {
            $("#empty-content").removeClass("hidden");
            $("#main-content" ).addClass("hidden");
        }

        // Refresh the session list
        refreshSessionListPane(stabId);

        // Refresh the session detail of the selected item in the list.
        let selectedId = $("#" + stabId + " .session-list").find(".session-item.session-selected").data("sid");
        refreshSessionDetailPane(stabId, sessionsData.getSessionById(selectedId));
    }

    function refreshTabBadges() {
        SESSION_TAB_IDS.forEach( stabId => {
            let badgeCount = sessionCounterByTabId[stabId]();
            $("ul.tab li.tab-item[data-tab='" + stabId + "'] > a").attr("data-badge", badgeCount);
        });
    }

    function refreshSessionListPane(stabId) {
        let sessions        = sessionsGetterByTabId[stabId]();
        let badgeCount      = sessionCounterByTabId[stabId]();
        let searchTerms     = searchTermsByTabId[stabId];
        let sortedSessions  = sortSessions(stabId, Session.filter(sessions, searchTerms, uiState.searchByTab));
        let $tabSessionList = $("#" + stabId + " .session-list");
        refreshListPaneButtons(stabId);
        // Note: .html() here adds in the html fragment for the session list.  Unsafe text are substituted with placeholders.
        $tabSessionList.html(renderSessionList(stabId, sortedSessions, badgeCount));
        // Fill in the placeholders for the unsafe text with html-escaped api.
        fillSessionInList($tabSessionList, sortedSessions);
    }

    function refreshListPaneButtons(stabId) {
        if (uiState.searchByTab) {
            $(".cmd-search-tabs .icon-flag").addClass("hidden");
            $(".cmd-search-tabs .icon-bookmark").removeClass("hidden");
            $(".cmd-search-tabs").attr("title", "Search the tab titles of the sessions");
            $(".session-search").attr("placeholder", "search the tab titles");
        } else {
            $(".cmd-search-tabs .icon-flag").removeClass("hidden");
            $(".cmd-search-tabs .icon-bookmark").addClass("hidden");
            $(".cmd-search-tabs").attr("title", "Search the session names");
            $(".session-search").attr("placeholder", "search names");
        }

        let sortState = uiState.sortState[stabId];
        SORT_TYPES.forEach( sortType => $("#" + stabId + " " + SORT_CMD_MAP[sortType]).removeClass("sort-selected") );
        $("#" + stabId + " " + SORT_CMD_MAP[sortState.sortBy]).addClass("sort-selected");

        SORT_TYPES.forEach( sortType => {
            if (sortState.sortDirection[sortType] > 0) {
                $("#" + stabId + " " + SORT_CMD_MAP[sortType] + " .icon-downward").addClass("hidden");
                $("#" + stabId + " " + SORT_CMD_MAP[sortType] + " .icon-upward"  ).removeClass("hidden");
            } else {
                $("#" + stabId + " " + SORT_CMD_MAP[sortType] + " .icon-downward").removeClass("hidden");
                $("#" + stabId + " " + SORT_CMD_MAP[sortType] + " .icon-upward"  ).addClass("hidden");
            }
        });

    }

    function refreshSessionDetailPane(stabId, sess) {
        if (sess) {
            $("#" + stabId + " .session-detail .panel-header").removeClass("hidden");
            $("#" + stabId + " .session-detail .panel-body").removeClass("hidden");
            $("#" + stabId + " .session-detail .empty-pane").addClass("hidden");

            $("#" + stabId + " .session-detail").addClass("sessData").data("sess", sess);

            // Note: .html() here merely adds in the html template for the menu commnads.  No unsafe text is used.
            $("#" + stabId + " .session-detail-commands").html(renderSessionDetailCommands(stabId, sess.isUser));

            // Note: .html() here adds in the html fragment for session title.  Unsafe text are substituted with placeholders.
            let $session_detail_title = $("#" + stabId + " .session-detail-title");
            $session_detail_title.html(renderSessionDetailTitle(sess));
            // Fill in the placeholders for the unsafe text with html-escaped api.
            fillSessionDetailTitle($session_detail_title, sess);

            refreshSessionWindowsAndTabs(stabId, sess);
            
            // Restore expand/collapse the states of the window switches.
            sess.windows.forEach( (window, index) => {
                let accordionId = uiWinId('acrdn', stabId, sess.sessionId, window.id);
                $("#" + accordionId).prop("checked", !uiState.windowCollapsed[accordionId]);
            });
        } else {
            $("#" + stabId + " .session-detail .panel-header").addClass("hidden");
            $("#" + stabId + " .session-detail .panel-body").addClass("hidden");
            $("#" + stabId + " .session-detail .empty-pane").removeClass("hidden");
        }
    }

    function areEditingTabs(sid, wid)   { return uiState.tabEdit.sid === sid && uiState.tabEdit.wid === wid }

    function refreshSessionWindowsAndTabs(stabId, sess) {
        let effectiveTabsOut = [];
        // Note: .html() here adds in the html fragment for the session's windows and tabs.  Unsafe text are substituted with placeholders.
        let $session_detail_windows = $("#" + stabId + " .session-detail .session-detail-windows");
        $session_detail_windows.html(renderSessionWindows(stabId, sess, effectiveTabsOut));
        // Fill in the placeholders for the unsafe text with html-escaped api.
        fillSessionWindows($session_detail_windows, stabId, sess, effectiveTabsOut);

        // User sessions has different background colors.
        if (sess.isUser) {
            $("#" + stabId + " .session-detail .panel-header").removeClass("bg-f0").addClass("bg-f4");
            $("#" + stabId + " .session-detail .session-detail-windows").removeClass("bg-f8");
        } else {
            $("#" + stabId + " .session-detail .panel-header").removeClass("bg-f4").addClass("bg-f0");
            $("#" + stabId + " .session-detail .session-detail-windows").addClass("bg-f8");
        }
        if (stabId == "user-sessions") {
            $("#" + stabId + " .session-list").removeClass("bg-f8");
        } else {
            $("#" + stabId + " .session-list").addClass("bg-f8");
        }

        sess.windows.forEach( (window, index) => {
            if (areEditingTabs(sess.sessionId, window.id)) {
                // Turn on drag and drop on the tab item list.
                let tablistId = uiWinId('tab-list', stabId, sess.sessionId, window.id);
                $("#" + tablistId).sortable({
                    start:  function(event, ui) {
                        $(this).data("startindex", ui.item.index());
                    },                   
                    update: function(event, ui) {
                        let startindex  = $(this).data("startindex");
                        let newindex    = ui.item.index();
                        let tab         = uiState.tabEdit.tabs[startindex];
                        let uiTid       = uiTabId('tabline', stabId, sess.sessionId, tab.windowId, tab.id);
                        let $tabline    = $("#" + uiTid + ".tab-line");
                        $(this).removeData("startindex");
                        app.arrayMove(uiState.tabEdit.tabs, startindex, newindex);
                        uiState.tabEdit.moved[tab.id] = true;
                        $tabline.replaceWith(renderSessionTab(stabId, sess.sessionId, tab, true));  // unsafe text substituted with placeholders
                        fillSessionTab(stabId, ssess.essionId, tab);                                // fill in the placeholders
                    },
                });
            }
        });

        refreshSessionDetailCmds(stabId, sess);
        refreshSessionDetailCmdsOnUIState();
    } 

    function refreshSessionDetailCmds(stabId, sess) {
        // Enable/disable session commands.
        if (sess.windowCount > 0) {
            SESSION_DETAIL_CMDS.forEach( cmd => $(cmd).removeClass("disabled") );
        } else {
            SESSION_DETAIL_CMDS.forEach( cmd => $(cmd).addClass("disabled") );
        }

        // Disable irrelevant commands for non user-session.
        if (sess.isUser) {
            INACTIVE_AUTO_CMDS.forEach( cmd => $(cmd).removeClass("disabled") );
        } else {
            INACTIVE_AUTO_CMDS.forEach( cmd => $(cmd).addClass("disabled") );
        }
    }

    function refreshSessionDetailCmdsOnUIState() {
        if (uiState.displayTabUrl) {
            $("a.cmd-toggle-url i").css("visibility", "visible");
        } else {
            $("a.cmd-toggle-url i").css("visibility", "hidden");
        }

        if (uiState.showActiveOnly) {
            $("a.cmd-toggle-active i").css("visibility", "visible");
        } else {
            $("a.cmd-toggle-active i").css("visibility", "hidden");
        }
    }

    function iconCss(sess)              { return sess.isUser ? "icon-people" : sess.isAuto ? "icon-time" : "icon-location" }
    function iconTitle(sess)            { return sess.isUser ? "User saved session" : sess.isAuto ? "Scheduled backup session" : "On-change backup session" }
    function groupCss(sess)             { return sess.group ? "tag-group" : "d-hide" }
    function groupEditCss(sess)         { return sess.group ? "tag-group-edit" : "tag-group-set" }
    function groupTitle(sess)           { return sess.groupTitle ? sess.groupTitle + " (click to filter)" : "" }
    function lastRestoredCss(sess)      { return sess.sessionId == sessionsData.lastRestoredId  ? "tag-restored" : "d-hide" }
    function lastSavedCss(sess)         { let l = sessionsData.lastSavedLabel(sess); return l == "current" ? "tag-current" : l == "saved" ? "tag-saved" : "d-hide" }
    function lastSavedTitle(sess)       { return sess.isUser ? "last user saved session" : sess.isAuto ? "last scheduled backup session" : "last on-change backup session" }
    function lastSavedLabel(sess)       { return sessionsData.lastSavedLabel(sess)  }
    function lastexitCss(sess)          { return previousExitId && sess.sessionId == previousExitId ? "tag-lastexit" : "d-hide" }
    function autoRestoreCss(sess)       { return sess.sessionId == sessionsData.autoRestoreSessionId ? "tag-auto-restore" : "d-hide" }
    function selectedCss(sess, selId)   { return sess.sessionId == selId ? "session-selected" : "" }
    function tabActiveCss(tab)          { return tab.active ? "text-bold" : "" }
    function tabModifiedCss(tab)        { return app.has(uiState.tabEdit.changed, tab.id) || app.has(uiState.tabEdit.moved, tab.id) ? "modified" :
                                                 app.has(uiState.tabEdit.deleted, tab.id) ? "deleted" : "" }
    function faviconUrl(tab)            { return tab["favIconUrl"] ? tab["favIconUrl"] : "/icons/empty.png" }
    function tabUrlLineCss(editingTabs) { return (uiState.displayTabUrl ? "" : "d-hide ") + (editingTabs ? "tab-editing" : "") }
    function uiWinId(pre,stabId,sid,wid)        { return pre + "-" + stabId + "-" + sid + "-" + wid }
    function uiTabId(pre,stabId,sid,wid,tid)    { return pre + "-" + stabId + "-" + sid + "-" + wid + "-" + tid }
                                                                                            
    // Return html template text for Tab pane.  No unsafe text is used.  No ${} is used.
    function renderTabLayout() {
        return `
          <!-- session list -->
          <div class="col-4">
            <div class="panel" style="border: none; height: 82vh"><!-- limit panel height to show scrollbar; body's height is the main limit. -->
              <div class="panel-header" style="margin-bottom: .3rem; padding: 0;">
                <div class="input-group">
                  <div id="searchbar" class="has-icon-left"  style="flex-grow: 1;">
                    <i class="form-icon icon icon-search" style="z-index: 9;"></i>
                    <input type="search" class="session-search form-input input-sm rounded" placeholder="search names">
                  </div>
                  <button class="cmd-search-tabs  btn btn-sm ml-0 mr-2" style="width:1.2rem; z-index: 9; margin-left:-1.25rem; padding:0"
                    title="Not include tab titles in search">
                    <i class="icon icon-flag hidden"></i><i class="icon icon-bookmark hidden"></i>
                  </button>
                  <button class="cmd-sort-by-time btn btn-sm" style="width: 1.2rem; padding: 2px 2px 0 0; position: relative;" title="Sort by time">
                    <i class="icon icon-upward hidden"></i><i class="icon icon-downward hidden"></i>
                    <span style="position: absolute; top: -4px; right: 2px; font-size: 75%">t</span>
                  </button>
                  <button class="cmd-sort-by-group btn btn-sm" style="width: 1.2rem; padding: 2px 2px 0 0; position: relative;" title="Sort by group">
                    <i class="icon icon-upward hidden"></i><i class="icon icon-downward hidden"></i>
                    <span style="position: absolute; top: -4px; right: 1px; font-size: 75%">g</span>
                  </button>
                  <button class="cmd-sort-by-name btn btn-sm" style="width: 1.2rem; padding: 2px 2px 0 0; position: relative;" title="Sort by name">
                    <i class="icon icon-upward hidden"></i><i class="icon icon-downward hidden"></i>
                    <span style="position: absolute; top: -4px; right: 1px; font-size: 75%">n</span>
                  </button>
                </div>
              </div>
              <div class="panel-body session-list" style="padding:0; border: .05rem solid #caced7;">
              </div>
            </div><!-- panel -->
          </div><!-- col-4 -->
          <!-- session detail -->
          <div class="col-8 pl-2 session-detail">
            <div class="panel" style="border: .05rem solid #caced7; height: 82vh;"><!-- limit panel height to show scrollbar; body's height is the main limit. -->
              <div class="panel-header" style="padding:0">
                <div class="session-detail-commands"></div>
                <div class="session-detail-title"></div>
              </div>
              <div class="panel-body session-detail-windows" style="padding: 1.0rem 0.3rem 0.8rem 0.3rem;">
              </div>
              <div class="empty-pane empty hidden" style="height:100%;"></div>
            </div><!-- panel -->
          </div><!-- col-8 -->
        `;
    }

    // Return the html fragment for session list.  Unsafe text are substituted with placeholders.  Other ${} are benign.
    function renderSessionList(stabId, sortedSessions, badgeCount) {
        if (badgeCount == 0) {
            return `
              <div class="empty" style="height:100%;"></div>
            `;
        } else {
            // Ensure there's always a session selected in the list.
            let selectedId = uiState.sessionTabSelectedId[stabId];
            if (sortedSessions.length > 0 && !sortedSessions.some( sess => sess.sessionId == selectedId )) {
                selectedId = uiState.sessionTabSelectedId[stabId] = sortedSessions[0].sessionId;     // select the first item be default.
            }
            return `
              ${ sortedSessions.map( (sess, index) => 
              ` ${ renderSessionInList(sess, index+1, selectedId) }
                <div class="session-list-divider"></div>
              ` 
              ).join("")}
              <div>&nbsp;</div>
            `;
        }
    }

    // Return the html fragment for a session in the list.  Unsafe text are substituted with placeholders.  Other ${} are benign.
    function renderSessionInList(sess, index, selectedId) {
        return `
          <div class="session-item tile tile-centered ptr ${selectedCss(sess, selectedId)}" style="padding:.3rem .3rem .3rem .4rem" data-sid="${sess.sessionId}">
            <div class="tile-icon" style="align-self:flex-start">
              <i class="icon list-icon ${iconCss(sess)}" title="${iconTitle(sess)}"></i>
              <div class="list-num">#${app.pad(index, 2, "0")}</div>
            </div>
            <div class="tile-content">
              <div class="tile-title">PLACEHOLDER:sess.sessionName</div>
              <div class="tile-subtitle size-85pct">${sess.subTitleInfo}</div>
              <div class="" style="width:100%; line-height:1;">
                <div class="tag ${groupCss(sess)}" title="${groupTitle(sess)}" data-group="${sess.group}">${sess.group}</div>
                <div class="tag ${lastSavedCss(sess)}" title="${lastSavedTitle(sess)}">${lastSavedLabel(sess)}</div>
                <div class="tag ${lastRestoredCss(sess)}" title="last restored session">restored</div>
                <div class="tag ${lastexitCss(sess)}" title="the last backup session before the previous browser exit (or crash).">last</div>
                <div class="tag ${autoRestoreCss(sess)}" title="this session will be automatically restored on next browser startup">auto</div>
              </div>
            </div>
          </div>
        `;
    }

    function fillSessionInList($fragment, sortedSessions) {
        sortedSessions.forEach( sess => {
            let $session_item = $fragment.find(".session-item[data-sid='" + sess.sessionId + "']");
            $session_item.find(".tile-title").text(sess.sessionName);   // sessionName can potentially be constructed from the active window's unsafe title.
        });
    }

    function renderSessionDetailCommands(stabId, sessIsUser) {
        return `
          <div class="navbar">
            <div class="navbar-section">
              <div class="session-detail-msg text-gray text-sz90">
              </div>
            </div>
            <div class="navbar-section nowrap" style="flex-grow: 0">
              <div>
                <button class="cmd-replace-sess btn btn-action btn-cmd-i btn-lv2 mr-4" title="Restore session over the existing windows, replacing them.">
                  <i class="icon icon-refresh"></i>
                </button>
                <button class="cmd-restore-sess btn btn-action btn-cmd-i btn-lv2 mr-4" title="Restore session with new windows, keeping existing windows.">
                  <i class="icon icon-share"></i>
                </button>
                <button class="cmd-toggle-win   btn btn-action btn-cmd-i btn-lv2 mr-3" title="Expand all windows or collapse all windows.">
                  <i class="icon icon-resize-vert"></i>
                </button>
                <div class="dropdown dropdown-right" style="top: .1rem; margin-right: .5rem;>
                  <div class="btn-group">
                    <a href="#" class="btn btn-link btn-dropdown dropdown-toggle" tabindex="0" style="margin-top:-0.1rem;"><i class="icon icon-more-vert"></i></a>
                    <ul class="menu" title="${!sessIsUser ? 'auto backup session cannot be modified' : ''}">
                      <li class="menu-item"> <a href="#" class="cmd-update-sess" title="Update the session with the browser windows and tab data">
                        <i class="icon icon-download"></i>&nbsp; Update Session </a> </li>
                      <li class="menu-item"> <a href="#" class="cmd-rename-sess" title="Rename the session"><i class="icon icon-edit"></i>&nbsp; Rename Session </a> </li>
                      <li class="menu-item"> <a href="#" class="cmd-setgroup-sess" title="Set the group for the session"><i class="icon icon-apps"></i>&nbsp; Set Group </a> </li>
                      <li class="menu-item"> <a href="#" class="cmd-auto-restore" title="Automatically restore the user session on browser startup">
                        <i class="icon icon-refresh" style="transform: rotate(90deg)"></i>&nbsp; Auto Restore </a> </li>
                      <li class="menu-item"> <a href="#" class="cmd-copy-sess" title="Copy session"><i class="icon icon-menu"></i>&nbsp; Copy Session </a> </li>
                      <li class="divider"></li>
                      <li class="menu-item"> <a href="#" class="cmd-toggle-url"     title="Toggle showing or hiding of tab url"><i class="icon icon-check text-warn"></i>&nbsp; Display Tab URL </a> </li>
                      <li class="menu-item"> <a href="#" class="cmd-toggle-active"  title="Toggle showing the active tab of windows only"><i class="icon icon-check text-warn"></i>&nbsp; Active Tab Only </a> </li>
                      <li class="divider"></li>
                      <li class="menu-item"> <a href="#" class="cmd-delete-sess" title="Delete the session"><i class="icon icon-delete"></i>&nbsp; Delete Session</a> </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
    }

    // Return the html fragment for the session detail's title.  Unsafe text are in placeholders.
    function renderSessionDetailTitle(sess) {
        return `
            <div class="navbar">
              <div class="navbar-section" style="flex-grow: 1;">
                <div class="session-detail-session-name" title="${sess.isUser ? '(click to edit)' : '(auto backup session cannot be modified)'}">
                  PLACEHOLDER:sess.sessionName</div>
                <div class="tag ${groupEditCss(sess)} ml-1 mr-2 mt-1" 
                     title="${sess.groupTitle} ${sess.isUser ? '(click to edit)' : ''}"
                     data-group="${sess.group}">${sess.group ? sess.group : 'xxxx'}</div>
              </div>
              <div class="navbar-section"      style="flex-grow: 0; white-space: nowrap;">
                <div class="size-85pct mt-1">${app.fmtNumWord(sess.windowCount, "window")} ${app.fmtNumWord(sess.tabCount, "tab")}, &nbsp;</div>
                <div class="size-85pct mt-1">${sess.fullTime12}</div>
              </div>
            </div>
        `        
    }

    // Fill in the unsafe text in placeholders.
    function fillSessionDetailTitle($fragment, sess) {
        $fragment.find(".session-detail-session-name").text(sess.sessionName);
    }

    // Return the html fragment for windows in a session.  Unsafe text are in placeholders.
    function renderSessionWindows(stabId, sess, effectiveTabsOut) {
        return `
          <div class="mx-1">
            ${ sess.windows.map( (window, windex) => 
              ` ${ renderSessionWindow(window, windex, stabId, sess, effectiveTabsOut) } ` 
            ).join("")}
          </div>
        `;
    }

    // Return the html fragment for a window of a session.  Unsafe text are in placeholders.
    function renderSessionWindow(window, windex, stabId, sess, effectiveTabsOut) {
        let editingTabs     = areEditingTabs(sess.sessionId, window.id);
        let searchTerms     = searchTermsByTabId[stabId];
        let filterTokens    = app.toLower(searchTerms.filter( t => !t.startsWith("group:") ));
        let tabs            = editingTabs ? uiState.tabEdit.tabs : sess.windowTabs(window.id);
        let effectiveTabs   = Session.filterTabs(tabs, searchTerms, uiState.searchByTab);
        effectiveTabsOut = effectiveTabsOut || [];
        effectiveTabsOut.push.apply(effectiveTabsOut, effectiveTabs);

        return `
          <div class="accordion" >
            <input type="checkbox" name="${'swindow-checkbox-' + stabId}" id="${uiWinId('acrdn', stabId, sess.sessionId, window.id)}" hidden checked>
            <label class="accordion-header window-underline" style="padding: .1rem 0rem" for="${uiWinId('acrdn', stabId, sess.sessionId, window.id)}">
              <div class="navbar" >
                <div class="navbar-section" style="min-width: 0;">
                  <div class="window-name-line" title="Window" id="${uiWinId('winname', stabId, sess.sessionId, window.id)}">PLACEHOLDER:sess.windowName(windex)</div>
                </div>
                <div class="navbar-section" style="flex-grow: 0">
                  ${ editingTabs ? renderSessionWindowTabEditingCommands(window) : renderSessionWindowCommands(window, sess) }
                </div>
              </div>
              <div class="window-attributes">
                <i class="icon icon-arrow-right mr-1"></i>
                <span class="tag tb-border ml-1" title="Number of tabs in the window">${app.fmtNumWord(sess.windowTabCount(window.id), "tab")}</span>
                <span class="tag tb-border ml-1 ${window.state != "" ? '' : 'd-hide'}" title="Window state">${window.state}</span>
                <span class="tag tb-border ml-1 ${window.focused     ? '' : 'd-hide'}" title="Window has focus">focused</span>
                <span class="tag tb-border ml-1 ${window._explicitRestore  ? '' : 'd-hide'}" title="Require explicit restore by user">explicit</span>
              </div>
            </label>
            <div class="accordion-body">
              <ul class="tab-list" id="${uiWinId('tab-list', stabId, sess.sessionId, window.id)}">
                 ${ effectiveTabs.map( tab => (uiState.showActiveOnly && !tab.active) ? "" : renderSessionTab(stabId, sess.sessionId, tab, editingTabs) ).join("") }
              </ul>
            </div>
          </div>
        `;
    }

    // Fill in the unsafe text in placeholders.
    function fillSessionWindows($fragment, stabId, sess, effectiveTabsOut) {
        sess.windows.forEach( (window, windex) => {
            let uiId = uiWinId('winname', stabId, sess.sessionId, window.id);
            $fragment.find("#" + uiId).text(sess.windowName(windex));
        });

        effectiveTabsOut.forEach( tab => {
            fillSessionTab(stabId, sess.sessionId, tab);
        });
    }

    // Return html fragment for the window's commands.  No unsafe text is used.  All ${} are benign.
    function renderSessionWindowCommands(window, sess) {
        return `
          <div class="window-cmds" style="margin-bottom: -0.70rem;">
            <button class="cmd-replace-win btn btn-action btn-cmd-i btn-lv3 mx-4" title="Restore the window to replace the current browser window" data-wid="${window.id}">
              <i class="icon icon-refresh" style="transform: none"></i>
            </button>
            <button class="cmd-append-win btn btn-action btn-cmd-i btn-lv3 mr-4" title="Restore and add the tabs to the current browser window" data-wid="${window.id}">
              <i class="icon icon-upload" style="transform: none"></i>
            </button>
            <button class="cmd-restore-win btn btn-action btn-cmd-i btn-lv3 mr-3" title="Restore the window as a new browser window" data-wid="${window.id}">
              <i class="icon icon-share" style="transform: none"></i>
            </button>
            <div class="dropdown dropdown-right" style="top: .1rem; margin-right: 0.0rem">
              <div class="btn-group">
                <a href="#" class="btn btn-link btn-dropdown dropdown-toggle" tabindex="0"><i class="icon icon-more-vert" style="transform: none"></i></a>
                <ul class="menu" title="${!sess.isUser ? 'auto backup session cannot be modified' : ''}">
                  <li class="menu-item">
                    <a href="#" class="cmd-update-win" title="Update the window from the current browser window" data-wid="${window.id}">
                      <i class="icon icon-download" style="transform: none"></i>&nbsp; Update Window </a>
                  </li>
                  <li class="menu-item">
                    <a href="#" class="cmd-rename-win" title="Rename window" data-wid="${window.id}">
                      <i class="icon icon-edit" style="transform: none"></i>&nbsp; Rename Window </a>
                  </li>
                  <li class="menu-item">
                    <a href="#" class="cmd-explicit-win" title="Toggle the explicit restore flag on the window" data-wid="${window.id}">
                      <i class="icon icon-minus" style="transform: none"></i>&nbsp; Toggle Explicit </a>
                  </li>
                  <li class="menu-item">
                    <a href="#" class="cmd-tab-edit-start ${sess.windowTabCount(window.id) == 0 ? 'cmd-disabled' : ''}"
                       title="Start tab editing" data-wid="${window.id}">
                       <i class="icon icon-menu" style="transform: none"></i>&nbsp; Tab Edit ... </a>
                  </li>
                  <li class="divider"></li>
                  <li class="menu-item">
                    <a href="#" class="cmd-delete-win" title="Delete the window from the session" data-wid="${window.id}">
                      <i class="icon icon-delete" style="transform: none"></i>&nbsp; Delete Window </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        `;
    }

    // Return html fragment for the tab editing commands.  No unsafe text is used.  All ${} are benign.
    function renderSessionWindowTabEditingCommands(window) {
        return `
          <div class="window-cmds" style="margin-bottom: -.70rem;">
            <button class="cmd-tab-edit-cancel btn btn-action btn-cmd-i btn-lv3 ml-4" style="margin-right:0.1rem;" title="Cancel tab editing" data-wid="${window.id}">
              <i class="icon icon-stop" style="transform99: none"></i>
            </button>
            <button class="cmd-tab-edit-save btn btn-action btn-cmd-i btn-lv3 ml-4" style="margin-right:0.1rem;" title="Save changes on tabs" data-wid="${window.id}">
              <i class="icon icon-check" style="transform: none"></i>
            </button>
          </div>
        `;
    }

    function breakUrl(urlStr) {
        try {
            let url = new URL(urlStr);
            let origin = "" + url.origin;
            let index = origin != "null" ? (urlStr.indexOf(url.origin) + url.origin.length) : 0;
            let first = urlStr.substring(0, index);
            let rest  = urlStr.substring(index);
            return [first, rest];
        } catch (e) {
            log.error("Error in parsing url: " + urlStr, e);
            return [urlStr, ""];
        }
    }

    // Return the html fragment for a tab.  Unsafe text are in placeholders.
    function renderSessionTab(stabId, sid, tab, editingTabs) {
        let container       = containerById[tab.cookieStoreId];
        let hideContainer   = is_firefox_default(container.cookieStoreId);
        return `
          <li id="${uiTabId('tabline', stabId, sid, tab.windowId, tab.id)}" class="tab-line">
            <div class="input-group">
              <div class="tab-name" style="flex-grow: 1;">
                <img class="tab-container-icon" src="PLACEHOLDER:container.iconUrl" title="PLACEHOLDER:container.name"
                     style="width:12px; height:12px; margin-right: 0.2rem; visibility: ${hideContainer ? 'hidden' : 'visible'};">
                <img class="tab-favicon" src="PLACEHOLDER:faviconUrl(tab)">
                ${
                  !editingTabs ?
                    `<a     class="tab-url" href="PLACEHOLDER:tab.url" title="PLACEHOLDER:tab.url" style="PLACEHOLDER:container"
                            data-wid="${tab.windowId}" data-tid="${tab.id}">PLACEHOLDER:tab.title</a>`
                    :
                    `<span  class="tab-url" title="Modified data pending save" style="PLACEHOLDER:container"
                            data-wid="${tab.windowId}" data-tid="${tab.id}">PLACEHOLDER:tab.title</span>`
                }
              </div>
              <div class="nowrap ${editingTabs ? '' : 'd-hide'}">
                <div class="cmd-tab-dragdrop    btn btn-link btn-sm ml-2 mr-01" title="Drag and drop to arrange order" data-wid="${tab.windowId}" data-tid="${tab.id}">
                  <i class="icon icon-menu"></i>
                </div>
                <button class="cmd-tab-edit-url btn btn-link btn-sm ml-2 mr-01" title="Edit tab url" data-wid="${tab.windowId}" data-tid="${tab.id}">
                  <i class="icon icon-edit"></i>
                </button>
                <button class="cmd-tab-delete   btn btn-link btn-sm ml-1 mr-01" title="Delete tab"   data-wid="${tab.windowId}" data-tid="${tab.id}">
                  <i class="icon icon-cross"></i>
                </button>
              </div>
            </div>
            <div class="tab-url-line ${tabUrlLineCss(editingTabs)}" title="PLACEHOLDER:tab.url">
              <span class="tab-url-origin">PLACEHOLDER:first</span><span class="tab-url-rest">PLACEHOLDER:rest</span>
            </div>
          </li>
        `;
    }

    function fillSessionTab(stabId, sid, tab) {
        let $fragment       = $("#" + uiTabId('tabline', stabId, sid, tab.windowId, tab.id));
        let [first, rest]   = breakUrl(tab.url);
        let container       = containerById[tab.cookieStoreId];
        let activeCss       = tabActiveCss(tab);
        let modifiedCss     = tabModifiedCss(tab);

        $fragment.find("a.tab-url").addClass(activeCss).attr("href", tab.url).attr("title", tab.url).text(tab.title);
        $fragment.find("span.tab-url").addClass(activeCss).addClass(modifiedCss).text(tab.title);
        $fragment.find(".tab-url-line").attr("title", tab.url);
        $fragment.find(".tab-url-origin").text(first);
        $fragment.find(".tab-url-rest").text(rest);
        $fragment.find(".tab-favicon").attr("src", faviconUrl(tab));
        $fragment.find(".tab-container-icon").attr("title", "container: " + container.name).attr("src", container.iconUrl);
        if (!is_firefox_default(container.cookieStoreId)) {
            $fragment.find(".tab-url").css("color", container.colorCode).css("border", ".02rem solid " + container.colorCode);
        }
    }

    log.info("module loaded");
    return module;

}(this, "popup"));    // Pass in the global scope as 'this' scope.


