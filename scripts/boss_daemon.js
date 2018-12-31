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

// module boss_daemon, background script.
(function(scope, modulename) {
    "use strict";

    // Import:
    // import logger
    // import sbcfg
    // import app
    // import settings
    // import session
    // import sessions
    let SessionBossSettings = settings.SessionBossSettings;
    let Session  = session.Session;
    let Sessions = sessions.Sessions;

   let log = new logger.Logger(sbcfg.APPNAME, modulename, sbcfg.LOGLEVEL);

 
    var module = function() { };       // Module object to be returned.
    if (scope && modulename)
        scope[modulename] = module;    // set module name in scope, otherwise caller sets the name with the returned module object.

    // Global state
    let gCtx = {
        atLeastOneSessionRestored:  false,
        lastRestoringTime:          0,
        pendingRestoredTabs:        {},
        sessions:                   Sessions.newInitSessions(),
        previousExitId:             "",
        initialWindowCount:         0,
        windowCount:                0,
        majorVersion:               "0",            // major browser version.
        justInstalled:              false,          // extension restarts because it was just installed/upgraded.
        sbSettings:                 SessionBossSettings.ofLatest(),
        alreadyAutoRestored:        false,
        lastGC:                     Date.now(),     // push the GC schedule one interval away at startup.
    };

    gCtx.pAddPendingTab = function(tab) {
        gCtx.atLeastOneSessionRestored = true;
        gCtx.pendingRestoredTabs[tab.id] = tab;
        return gCtx._pSavePendingTabs();
    }

    gCtx._prepPendingTabStore = function(saveParams) {
        saveParams["pendingTabStore"] = {
            atLeastOneSessionRestored:  gCtx.atLeastOneSessionRestored,
            pendingRestoredTabs:        gCtx.pendingRestoredTabs,
        };
        return saveParams;
    }

    // Note: This is a bad idea.  Tab id is not consistent across extension running sessions.
    // An old saved tab id can be mapped to a different tab in the next running.
    gCtx._pSavePendingTabs = function() {
        log.info("gCtx._pSavePendingTabs.  Removed.");
        return browser.storage.local.remove("pendingTabStore");
        // return browser.storage.local.set(gCtx._prepPendingTabStore({}));
    }

    gCtx.pLoadPendingTabs = function() {
        return Promise.resolve();
        // return browser.storage.local.get("pendingTabStore")
        //     .then( loadedMap => {
        //         if (loadedMap && loadedMap["pendingTabStore"]) {
        //             gCtx.atLeastOneSessionRestored  = app.defObjVal(loadedMap["pendingTabStore"], "atLeastOneSessionRestored", false);
        //             gCtx.pendingRestoredTabs        = app.defObjVal(loadedMap["pendingTabStore"], "pendingRestoredTabs", {});
        //         } else {
        //             console.warn("The pendingTabStore does not exist.");
        //         }
        //     } )
        //     .catch( e => log.warn("Failed to load pendingTabStore. ", e) )
    }

    const GC_INTERVAL_MS = 11 * 60 * 1000;  // Garbage collect the pendingTabs once in a while.  Make it interleave with the backup schedule.
    gCtx.gcPendingTabs = function() {
        let nowMS = Date.now();
        if (nowMS - gCtx.lastGC > GC_INTERVAL_MS) {
            let survivingPendingRestoredTabs = {};      // copying garbage collection.
            browser.tabs.query({})
                .then( tabs => tabs.forEach( tab => {
                    if (app.has(gCtx.pendingRestoredTabs, tab.id)) {
                        survivingPendingRestoredTabs[tab.id] = gCtx.pendingRestoredTabs[tab.id];
                    }
                }))
                .then( () => {
                    gCtx.pendingRestoredTabs = survivingPendingRestoredTabs;
                })
            gCtx.lastGC = nowMS;
        }
    }
    // Global state end

    
    // init() is called at the end of script definition, before the callbacks.
    function init() {
        Promise.resolve()
            .then(() => log.info("boss_daemon init ===================================================== ") )
            .then(() => browser.runtime.getBrowserInfo().then(info => gCtx.majorVersion = app.defObjVal(info, "version", "0").split(".")[0]) )
            .then(() => browser.runtime.onInstalled.addListener(() => gCtx.justInstalled = true))
            .then(() => pInitialWindowCounts() )
            .then(() => settings.pLoad().then( s => gCtx.sbSettings = s ) )
            .then(() => Sessions.pLoadAllSessionsData().then( sessions => gCtx.sessions = sessions) )
          //.then(() => log.info("Sessions loaded ", gCtx.sessions) )
            .then(() => checkPreviousExit() )
            .then(() => gCtx.pLoadPendingTabs() )
            .then(() => browser.storage.onChanged.addListener(storage_onChanged) )
            .then(() => browser.windows.onCreated.addListener(windows_onCreated) )
            .then(() => browser.windows.onRemoved.addListener(windows_onRemoved) )
            .then(() => browser.tabs.onActivated.addListener(tabs_onActivated) )
            .then(() => browser.tabs.onAttached.addListener(tabs_onAttached) )
            .then(() => browser.tabs.onDetached.addListener(tabs_onDetached) )
            .then(() => browser.tabs.onMoved.addListener(tabs_onMoved) )
            .then(() => browser.tabs.onRemoved.addListener(tabs_onRemoved) )
            .then(() => browser.tabs.onUpdated.addListener(tabs_onUpdated) )
            .then(() => pSetupMessageHandlers() )
            .then(() => setupAlarms() )
            .then(() => log.info("boss_daemon init done ----------------------------------------------- ") )
            .catch( e => log.warn(e) )
    }
    
    function pInitialWindowCounts() {
        return browser.windows.getAll().then( windows => gCtx.windowCount = gCtx.initialWindowCount = windows.length );
    }

    function checkPreviousExit() {
        gCtx.previousExitId = gCtx.sessions.autoSavedIdOnCrash || "";
    }

    function storage_onChanged(storageChange) {
        // Monitor sessionBossSettings storage change.
        if (app.has(storageChange, "sessionBossSettings")) {
            gCtx.sbSettings = SessionBossSettings.upgradeWith(storageChange.sessionBossSettings.newValue);
        }
    }

    function windows_onCreated() {
        gCtx.windowCount++;
    }

    function windows_onRemoved() {
        gCtx.windowCount--;
        if (gCtx.windowCount <= 0 ) {
            log.info("windows_onRemoved browser shutdown detected");
            // 
            // gCtx.sessions.pClearCrashStore();
        }
    }

    function tabs_onActivated(activeInfo) {
        let pendingTab = gCtx.pendingRestoredTabs[activeInfo.tabId];
        if (pendingTab) {
            if (!pendingTab.active) {
                log.info("tabs_onActivated tab " + activeInfo.tabId + " win " + activeInfo.windowId + " restore url " + pendingTab.url);
                browser.tabs.sendMessage(activeInfo.tabId, {
                    cmd:    "restore-url",
                    url:    pendingTab.url,
                }).then(() => {
                    // Only delete the pending tab after a successful send.
                    delete gCtx.pendingRestoredTabs[activeInfo.tabId];
                }).catch(e => {
                    // A tab could be clicked/activated before its on_inject script has started listening for the msg.
                    // The on_inject script would call cs-query-pending-tab later to get the pending tab.
                    console.error(`catch tab ${pendingTab.id}: ${e}`)
                })
            } else {
                log.info("tabs_onActivated tab " + activeInfo.tabId + " win " + activeInfo.windowId + ", the pendingTab is active.  The tab will refresh itself.");
            }
        } else {
            // No pending tab in the list for the activated tab id.
            // 1. Other tabs opened by the user and not restored by Session Boss.
            // 2. Pending tabs that have been filled out when activated/clicked would be removed from the pending list,
            //    and not be found again in the subsequent activations.
            // 3. The active tab when first restored will fire an onActivated event, which can be before the pending list
            //    has been set up, due to race condition between the tab restoration code and the onActivated event.
            //    It's ok since the active tab's on_inject will handle active tab url in pQueryPendingTab().
            // 4. The extension being reloaded would wipe out the pending list.  Can't do much in the case.
            log.info("tabs_onActivated tab " + activeInfo.tabId + " win " + activeInfo.windowId + " not a pendingTab");
        }
    }

    // Batch up events for some times before doing the backup.
    let dBackupSessionOnEvents30 = app.debounce(function(){
        // Cancel backup if the tab changes came within 60 seconds of the last restore.
        if (Date.now() - gCtx.lastRestoringTime < 60*1000) {
            // log.info("dBackupSessionOnEvents30 cancelled due to too close to the last restore time.");
            return;
        }
        // log.info("dBackupSessionOnEvents30");
        gCtx.sessions.pBackupSessionOnChange(gCtx);
    }, 30*1000, false);

    function backupSessionOnEvents30() {
        // log.info("backupSessionOnEvents30");
        dBackupSessionOnEvents30();
    }

    let dBackupSessionOnEvents60 = app.debounce(function(){
        // log.info("dBackupSessionOnEvents60");
        gCtx.sessions.pBackupSessionOnChange(gCtx);
    }, 60*1000, true);

    function backupSessionOnEvents60() {
        // log.info("backupSessionOnEvents60");
        dBackupSessionOnEvents60();
    }

    function tabs_onAttached(tabId, attachInfo) {
        // log.info("tabs_onAttached " + tabId, attachInfo);
        backupSessionOnEvents30();
    }

    function tabs_onDetached(tabId, detachInfo) {
        // log.info("tabs_onDetached " + tabId, detachInfo);
        backupSessionOnEvents30();
    }

    function tabs_onMoved(tabId, moveInfo) {
        // log.info("tabs_onMoved " + tabId, moveInfo);
        backupSessionOnEvents30();
    }

    function tabs_onRemoved(tabId, removeInfo) {
        // log.info("tabs_onRemoved " + tabId, removeInfo);
        if (removeInfo.isWindowClosing) {
            // Don't save the session for closed window immediately.  The user is probably just rapidly closing tabs to quit the browser.
            log.info("tabs_onRemoved, isWindowClosing, wait 60s");
            backupSessionOnEvents60();
        } else {
            // Don't save the session for closed tabs immediately, which would overwrite the old current session without the closed tab.
            // Wait some time make sure closing tabs is really what the user wants.
            // log.info("tabs_onRemoved, wait 60s");
            backupSessionOnEvents60();
        }
    }

    function tabs_onUpdated(tabId, changeInfo, tab) {
        // log.info("tabs_onUpdated " + tabId, changeInfo);
        if (app.defObjVal(changeInfo, "status", "") == "complete") {        // status "complete" is triggered for the tab has completely loaded.
            // log.info("tabs_onUpdated completed " + tabId);
            let mostRecentSession = gCtx.sessions.mostRecentSession;
            if (!mostRecentSession || mostRecentSession.urlOfTab(tabId) != tab.url) {
                backupSessionOnEvents30();
            } else {
                // log.info("tabs_onUpdated completed " + tabId + " is duplicate as last one.  Ignored.");
            }
        }
    }


    function pSetupMessageHandlers() {
        // log.info("pSetupMessageHandlers");
        return browser.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
            //log.info("onMessage() ", msg);
            switch (msg.cmd) {
            case "cs-log":
                log.info("cs-log: ", msg.obj);
                return;
            case "cs-query-pending-tab":
                if (sender && sender.tab) {
                    let pendingTab = gCtx.pendingRestoredTabs[sender.tab.id];
                    log.info("cs-query-pending-tab " + sender.tab.id + " win " + sender.tab.windowId + ", atLeastOneSessionRestored: " + gCtx.atLeastOneSessionRestored + ", pendingTab: " + pendingTab);
                    if (pendingTab && pendingTab.active) {
                        // The active pending tab will be restored upon returning to on_inject queryPendingTab().  Clean up the pending tab.
                        delete gCtx.pendingRestoredTabs[pendingTab.id];
                    }
                    sendResponse({
                        status:         "ok",
                        hasRestored:    gCtx.atLeastOneSessionRestored,
                        pendingTab:     pendingTab,
                    });
                }
                return;
            case "undo-snapshot":
                gCtx.sessions.pUndoSnapshot(gCtx);
                break;
            case "redo-snapshot":
                gCtx.sessions.pRedoSnapshot(gCtx);
                break;
            case "save-all":
                gCtx.sessions.pSaveAllWindows(gCtx);
                break;
            case "save-window":
                gCtx.sessions.pSaveCurrentWindow(gCtx);
                break;
            case "update-sess":
                gCtx.sessions.pUpdateSession(gCtx, msg.sessionId);
                break;
            case "delete-sess":
                gCtx.sessions.pDeleteSession(msg.sessionId);
                break;
            case "toggle-auto-resotre":
                gCtx.sessions.pToggleAutoRestore(msg.sessionId);
                break;
            case "backup-now":
                gCtx.sessions.pBackupSessionOnChange(gCtx);
                break;
            case "del-all-user":
                gCtx.sessions.pDeleteAllUserSessions();
                //gCtx.sessions = Sessions.newInitSessions();
                break;
            case "del-all-backup":
                gCtx.sessions.pDeleteAllBackupSessions();
                break;
            case "del-all-onchange":
                gCtx.sessions.pDeleteAllOnChangeSessions();
                break;
            case "purge-all":
                gCtx.sessions.pPurgeAllData();
                break;
            case "replace-sess":
                gCtx.sessions.pRestoreSessionAsReplacement(msg.sessionId, msg.searchTerms, msg.searchByTab, gCtx)
                    .then(  ()  => sendResponse({ status: "ok",     message: "Restoring"}) )
                    .catch( err => sendResponse({ status: "error",  message: err}) );
                break;
            case "restore-sess":
                gCtx.sessions.pRestoreSessionAsAddition(msg.sessionId, msg.searchTerms, msg.searchByTab, gCtx)
                    .then(  ()  => sendResponse({ status: "ok",     message: "Restoring"}) )
                    .catch( err => sendResponse({ status: "error",  message: err}) );
                break;
            case "replace-win":
                gCtx.sessions.pRestoreWindowAsCurrentReplacement(msg.sessionId, msg.wid, msg.searchTerms, msg.searchByTab, gCtx)
                    .then(  ()  => sendResponse({ status: "ok",     message: "Restoring"}) )
                    .catch( err => sendResponse({ status: "error",  message: err}) );
                break;
            case "append-win":
                gCtx.sessions.pRestoreWindowAsCurrentAddition(msg.sessionId, msg.wid, msg.searchTerms, msg.searchByTab, gCtx)
                    .then(  ()  => sendResponse({ status: "ok",     message: "Restoring"}) )
                    .catch( err => sendResponse({ status: "error",  message: err}) );
                break;
            case "restore-win":
                gCtx.sessions.pRestoreWindowAsNew(msg.sessionId, msg.wid, msg.searchTerms, msg.searchByTab, gCtx)
                    .then(  ()  => sendResponse({ status: "ok",     message: "Restoring"}) )
                    .catch( err => sendResponse({ status: "error",  message: err}) );
                break;
            case "delete-win":
                gCtx.sessions.pDeleteWindow(msg.sessionId, msg.wid);
                break;
            case "update-win":
                gCtx.sessions.pUpdateWindow(gCtx, msg.sessionId, msg.wid);
                break;
            case "explicit-win":
                gCtx.sessions.pSetWindowProperty(msg.sessionId, msg.wid, "_explicitRestore", msg._explicitRestore);
                break;
            case "rename-win":
                gCtx.sessions.pSetWindowProperty(msg.sessionId, msg.wid, "_name", msg.newName);
                break;
            case "restore-tab":
                gCtx.sessions.pRestoreTab(gCtx, msg.sessionId, msg.wid, msg.tid);
                break;
            case "delete-tab":
                gCtx.sessions.pDeleteTab(msg.sessionId, msg.wid, msg.tid);
                break;
            case "set-tab-url":
                gCtx.sessions.pSetTabProperty(msg.sessionId, msg.wid, msg.tid, "url", msg.url);
                break;
            case "reorder-tabs":
                gCtx.sessions.pReorderTabs(msg.sessionId, msg.wid, msg.tabIds);
                break;
            case "update-tabs":
                gCtx.sessions.pUpdateTabs(msg.sessionId, msg.wid, msg.changedTabs, msg.moved, msg.deleted, msg.orderedIds);
                break;
            case "copy-sess":
                gCtx.sessions.pCopyToUser(msg.sessionId);
                break;
            case "rename-sess":
                gCtx.sessions.pRenameSession(msg.sessionId, msg.newName);
                break;
            case "setgroup-sess":
                gCtx.sessions.pSetSessionGroup(msg.sessionId, msg.group);
                break;
            case "get-prev-exit":
                sendResponse({
                    previousExitId: gCtx.previousExitId,
                });
                break;
            case "log-tabs":
                Sessions.pDumpTabs({});
                break;
            case "log-sess":
                gCtx.sessions.pDumpSession(msg.sessionId);
                break;
            case "dbg-test":
                //gCtx.sessions.pPurgeAllData();

                gCtx.sessions.pForceBackuppForceScheduledBackup();
                
                // broadcastToTabs((tab) => ({
                //     cmd:    "show-msg",
                //     text:   `foobar id: ${tab.id}, url: ${tab.url} `
                // }));
                break;
            default:
                log.info("onMessage() unknown cmd: ", msg);
                break;
            }
        });
    }

    function setupAlarms() {
        const nowTS = Date.now();
        browser.alarms.create("boss-scheduled-backup",  { periodInMinutes: 5 });
        browser.alarms.create("boss-gc",                { periodInMinutes: 3 });
        browser.alarms.create("boss-auto-restore1",     { when: nowTS + 250  });    // have alarms with increasing delays to handle faster to slower startups.
        browser.alarms.create("boss-auto-restore2",     { when: nowTS + 500  });
        browser.alarms.create("boss-auto-restore3",     { when: nowTS + 1000 });
        browser.alarms.create("boss-auto-restore4",     { when: nowTS + 2000 });    // restoring after 2 seconds is a unpleasant UX for the user; just abort.
        const restoreIds = [ "boss-auto-restore1", "boss-auto-restore2", "boss-auto-restore3", "boss-auto-restore4" ];

        browser.alarms.onAlarm.addListener(function(alarmInfo){
            if (alarmInfo.name == "boss-scheduled-backup") {
                if (gCtx.sbSettings.enableScheduleBackup) {
                    gCtx.sessions.runScheduledBackup(gCtx);
                } else {
                    log.info("Schedule Backup has been disabled via Preferences.");
                }
            } else if (alarmInfo.name == "boss-gc") {
                // log.info("boss-gc timer");
                gCtx.gcPendingTabs();
            } else if (!gCtx.alreadyAutoRestored && restoreIds.indexOf(alarmInfo.name) != -1) {
                // log.info("Auto restore timer fired " + alarmInfo.name);
                autoRestoreOnStartup();
            }
        });
    }

    function autoRestoreOnStartup() {
        log.info("autoRestoreOnStartup " +
                 "  settings.autoRestoreOnStartup: " + gCtx.sbSettings.autoRestoreOnStartup +
                 ", gCtx.alreadyAutoRestored: " + gCtx.alreadyAutoRestored +
                 ", gCtx.justInstalled: " + gCtx.justInstalled +
                 ", initialWindowCount: " + gCtx.initialWindowCount +
                 ", autoRestoreSessionId: " + gCtx.sessions.autoRestoreSessionId);

        if (!gCtx.sbSettings.autoRestoreOnStartup) {
            log.info("Skipped.  Auto-restore has been disabled via the Preferences page.");
            return;
        }
        if (gCtx.alreadyAutoRestored) {
            log.info("Skipped.  Auto-restore has already run.");
            return;
        }
        gCtx.alreadyAutoRestored = true;    // Auto-restore has already been attempted.  Prevent re-run.
        if (gCtx.justInstalled) {
            log.info("Skipped.  Extension has just been installed, not a real startup.");
            return;
        }
        if (gCtx.initialWindowCount > 1) {
            log.info("Skipped, initialWindowCount is greater than 1.");
            return;
        }
        if (!gCtx.sessions.autoRestoreSessionId) {
            log.info("Skipped,  No autoRestoreSessionId is set.");
            return;
        }

        browser.tabs.query({}).then( tabs => {
            if (tabs.length > 1) {
                log.info("Skipped, tab count is greater than 1.");
                return;
            }

            log.info("Doing autoRestore " + gCtx.sessions.autoRestoreSessionId);
            gCtx.sessions.pRestoreSessionAsReplacement(gCtx.sessions.autoRestoreSessionId, [], false, gCtx)
                .then(()  => log.info("autoRestore done"))
                .catch(() => log.error("autoRestore failed"))
        })
    }

    function broadcastToTabs(msgDataGetter) {
        return browser.tabs.query({})
            .then( tabs =>
                   Promise.all(
                       tabs.map( tab => {
                           if (!tab.incognito) {
                               log.info(`sendMessage to ${tab.id} ${tab.url}`);
                               let msg = msgDataGetter(tab);
                               return browser.tabs.sendMessage(tab.id, msg)
                                   .catch(e => console.error(`error on tab ${tab.id}, ${tab.url}: ${e}`));
                           }
                       })) );
    }

    init();

    log.info("module loaded");
    return module;

}(this, "boss_daemon"));    // Pass in the global scope as 'this' scope.

