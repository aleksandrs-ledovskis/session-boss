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

// session module
(function(scope, modulename) {
    "use strict";

    // Import
    // import spark-md5
    // import logger
    // import sbcfg
    // import moment
    // import app
    // import ringbuf
    // import settings
    let RingBuf = ringbuf.RingBuf;

    let log = new logger.Logger(sbcfg.APPNAME, modulename, sbcfg.LOGLEVEL);

    var module = function() { };       // Module object to be returned.
    if (scope && modulename)
        scope[modulename] = module;    // set module name in scope, otherwise caller sets the name with the returned module object.

    const USER = "user";
    const AUTO = "auto";
    const ONCHANGE = "onchange";
    const AS_ALL = "as_all";
    const AS_WIN = "as_win";
    const GROUP_ONCHANGE = "on-change";

    class Session {

        constructor(jsonObj) {
            this._type = "Session";
            this._version = 2;          // current version for the object format.
            if (jsonObj) {
                this._fromObj(jsonObj);
            } else {
                this._newVersion2();
            }
        }

        _fromObj(jsonObj) {
            switch (jsonObj._version) {
            case 1:
                return this._fromVersion1(jsonObj);
            case 2:
                return this._fromVersion2(jsonObj);
            default:
                throw Error("Unsupported session object version.");
            }
        }

        _newVersion1() {
            this.sessionId      = app.uuid();
            this.sessionTimeMS  = new Date().getTime();
            this.sessionType    = USER;
            this.savedAs        = AS_ALL;
            this.sessionName    = this.userSessionTsName;
            this.windows        = [];
            this.tabsOfWindow   = {};
            this.group          = "";       // belonging group, mainly for backup session grouping.
            this.groupTitle     = "";       // title for UI tooltip over group.
            this.tabMap         = {};       // map tabId to tab info
        }

        _fromVersion1(jsonObj) {
            this.sessionId      = jsonObj.sessionId || app.uuid();
            this.sessionTimeMS  = (jsonObj.sessionTimeMS && jsonObj.sessionTimeMS > 0) ? jsonObj.sessionTimeMS : new Date().getTime();
            this.sessionType    = jsonObj.sessionType || USER;
            this.savedAs        = jsonObj.savedAs || AS_ALL;
            this.sessionName    = jsonObj.sessionName || this.userSessionTsName;
            this.windows        = jsonObj.windows || [];
            this.tabsOfWindow   = jsonObj.tabsOfWindow || {};
            this.group          = jsonObj.group || "";
            this.groupTitle     = jsonObj.groupTitle || "";
            this.tabMap         = jsonObj.tabMap || {};
        }

        _newVersion2() {
            this._newVersion1();
            // add extra attributes for the new version of the Window object.
            this.windows.forEach( w => {
                w._explicitRestore = false;
                w._name = "";
            });
        }

        _fromVersion2(jsonObj) {
            this._fromVersion1(jsonObj);
            this.windows.forEach( w => {    // .windows has been loaded in _fromVersion1().
                w._explicitRestore = app.defObjVal(w, "_explicitRestore", false);
                w._name = app.defObjVal(w, "_name", "");
            });
        }

        clone() {
            return new Session(JSON.parse(JSON.stringify(this)));       // deep copy
        }

        iterateAllTabs(fn) {
            this.windows.forEach( w => {
                if (this.tabsOfWindow[w.id]) {
                    this.tabsOfWindow[w.id].forEach( tab => fn(tab) );
                }
            });
        }

        setSessionId(sessionId) {
            this.sessionId = sessionId;
            return this;
        }

        setSessionName(sessionName) {
            this.sessionName = sessionName;
            return this;
        }

        setGroup(group) {
            this.group = group;
            this.setGroupTitle(`group:${this.group}`);
            return this;
        }

        setGroupTitle(groupTitle) {
            this.groupTitle = groupTitle;
            return this;
        }

        setSessionType(sessionType) {
            if (!sessionType) throw Error("no sessionType");
            this.sessionType = sessionType;
            return this;
        }

        setSavedAs(savedAs) {
            if (!savedAs) throw Error("no savedAs");
            this.savedAs = savedAs || AS_ALL;
            return this;
        }

        _updateTabData() {
            this.tabMap = {};
            this.iterateAllTabs( tab => {
                this.tabMap[tab.id] = {
                    url: tab.url || "",
                };
            });
            return this;
        }

        get isUser()            { return this.sessionType == USER }
        get isAuto()            { return this.sessionType == AUTO  }
        get isOnChange()        { return this.sessionType == ONCHANGE }
        get isAsAll()           { return this.savedAs == AS_ALL }
        get isAsWin()           { return this.savedAs == AS_WIN }
        get windowCount()       { return this.windows.length }
        get tabCount()          { return Object.values(this.tabsOfWindow).reduce((count, tabs) => count + tabs.length, 0) }
        get allTabs()           { return [].concat.apply([], Object.values(this.tabsOfWindow)) }
        get shortTime()         { return moment(this.sessionTimeMS).format("MM-DD HH:mm")  }
        get fullTime()          { return moment(this.sessionTimeMS).format("YYYY-MM-DD HH:mm")  }
        get fullTime12()        { return moment(this.sessionTimeMS).format("YYYY-MM-DD HH:mma")  }
        get userSessionTsName() { return "User Session " + this.shortTime }
        get subTitleInfo()      { return `${this.windowCount}W, ${this.tabCount}T, ${moment(this.sessionTimeMS).fromNow()}` }
        get focusedWindow()     { return this.windows.find( w => w.focused ) }
        windex(winId)           { return this.windows.findIndex( w => w.id == winId ) }
        windowTabs(winId)       { return this.tabsOfWindow[winId] }
        windowTabCount(winId)   { return this.windowTabs(winId).length }
        windowTabsClone(winId)  { return this.windowTabs(winId).map( tab => Object.assign({}, tab) ) }
        findTab(winId, tabId)   { return this.windowTabs(winId).find( tab => tab.id == tabId ) }
        urlOfTab(tabId)         { return app.has(this.tabMap, tabId) ? app.defObjVal(this.tabMap[tabId], "url", "") : "" }
        windowName(windex)      { return this.windows[windex]._name ? this.windows[windex]._name :
                                  this.windows[windex].title ? this.windows[windex].title : "Window #" + (windex + 1) }

        // isReplace: bool, searchTerms: [String], searchByTab: bool, gCtx: {}
        pRestoreSession(isReplace, searchTerms, searchByTab, gCtx) {
            log.info("pRestoreSession isReplace: " + isReplace + ", searchTerms: " + searchTerms + ", searchByTab: " + searchByTab);
            let windowsToRestore = this.windows.filter( w => !w._explicitRestore );     // excludes explicitly restored windows.
            return this._pRestoreWindows(windowsToRestore, isReplace, searchTerms, searchByTab, gCtx);
        }

        // widToRestore: String, searchTerms: [String], searchByTab: bool, gCtx: {}
        pRestoreWindow(widToRestore, searchTerms, searchByTab, gCtx) {
            log.info("pRestoreWindow  widToRestore: " + widToRestore + ", searchTerms: " + searchTerms + ", searchByTab: " + searchByTab);
            let windowsToRestore = this.windows.filter( w => widToRestore == w.id );    // builds window list of one.
            return this._pRestoreWindows(windowsToRestore, false, searchTerms, searchByTab, gCtx);
        }

        _pRestoreWindows(windowsToRestore, isReplace, searchTerms, searchByTab, gCtx) {
            // log.info("_pRestoreWindows");
            let mapping = {
                newToOrgOpenerTab: {},
                orgToNewTab: {}
            };
            let windowIdsToRemove;
            return this._pGetWindwIdsToRemove(isReplace)
                .then( widsToRemove     => windowIdsToRemove = widsToRemove )
                .then( ()               => this._pCreateWindows(windowsToRestore) )
                .then( windRestoreInfos => this._pFocusRestoringWindow(windRestoreInfos) )
                .then( windRestoreInfos => Promise.all( windRestoreInfos.map( windRestoreInfo => {
                    let tabs = this._getRestoringWindowTabs(windRestoreInfo.originalWindow.id, searchTerms, searchByTab);
                    if (tabs.length == 0) {
                        windowIdsToRemove.push(windRestoreInfo.newWindow.id);  // no tab left after filtering, the window is empty; remove it.
                        return Promise.resolve([]);
                    }
                    return this._pRestoreWindowTabs(windRestoreInfo, tabs, gCtx, mapping);
                } ) ) )
                .then( tabsOfNewWindows => Promise.all( tabsOfNewWindows.map( tabs => this._pUpdateOpenerTabIds(tabs, mapping) ) ) )
                .then( ()               => this._pRemoveWindows(windowIdsToRemove) )
        }

        // Potential bug.  Focus window before restore might cause the existing tab's queryTendingTab call.
        // It's actually ok.  The focused window and tab is the newly created window and blank tab.
        _pFocusRestoringWindow(windRestoreInfos) {
            if (windRestoreInfos.length > 1)
                return browser.windows.update(windRestoreInfos[0].newWindow.id, { focused: true }).then( () => windRestoreInfos );
            else
                return Promise.resolve(windRestoreInfos);
        }
            
        pRestoreWindowToCurrentWindow(winToRestore, isReplace, searchTerms, searchByTab, gCtx) {
            log.info("pRestoreWindowToCurrentWindow");

            let mapping = {
                newToOrgOpenerTab: {},
                orgToNewTab: {}
            };
            return browser.windows.getCurrent({populate: true})
                .then( currentWindow => {
                    let tabsToRemove = [];
                    if (isReplace)
                        tabsToRemove = currentWindow.tabs.map( tab => tab.id ); // the tabs of the current window are all going to be removed.
                    let windRestoreInfo = {
                        originalWindow: winToRestore,
                        newWindow:      currentWindow,
                        tabsToRemove:   tabsToRemove,
                    };
                    let tabs = this._getRestoringWindowTabs(windRestoreInfo.originalWindow.id, searchTerms, searchByTab);
                    if (tabs.length == 0) {
                        return Promise.resolve([]);
                    }
                    return this._pRestoreWindowTabs(windRestoreInfo, tabs, gCtx, mapping);
                })
                .then( newTabsOfWindow => this._pUpdateOpenerTabIds(newTabsOfWindow, mapping) )
                .then( () => log.info("pRestoreWindowToCurrentWindow done") )
        }

        deleteWindow(winId) {
            let index = this.windows.findIndex( w => w.id == winId );
            if (index > -1) {
                this.windows.splice(index, 1);
                delete this.tabsOfWindow[winId];
                this._updateTabData();
                return true;
            }
            return false;
        }

        updateWindow(winId, newSess) {
            let index = this.windows.findIndex( w => w.id == winId );
            if (index > -1) {
                let newWin = newSess.windows[0];    // there's only one item in the window array, the current window.
                let newWinId = newWin.id;
                newWin.id = winId;                  // use the old winId, to preserve unique window id.
                this.windows[index] = newWin;
                this.tabsOfWindow[winId] = newSess.tabsOfWindow[newWinId];
                this.tabsOfWindow[winId].forEach( tab => { tab.windowId = winId });
                this._updateTabData();
                return true;
            }
            return false;
        }

        setWindowProperty(winId, propName, propValue) {
            let index = this.windows.findIndex( w => w.id == winId );
            if (index > -1) {
                this.windows[index][propName] = propValue;
                this._updateTabData();
                return true;
            }
            return false;
        }

        setWindowOrderPos(winId, newPos) {
            if (newPos < 0 || newPos >= this.windows.length)
                throw Error("The new window position " + newPos + " is out of range [0, " + this.windows.length + ")");
            let index = this.windows.findIndex( w => w.id == winId );
            if (index > -1) {
                this.windows = app.arrayMove(this.windows, index, newPos);
                return true;
            }
            return false;
        }

        pRestoreTab(gCtx, winId, tabId) {
            let tabs = this.tabsOfWindow[winId];
            if (!tabs)
                throw Error("Tabs are not found for the window " + winId + " in the session " + this.sessionName);
            let index = tabs.findIndex( tab => tab.id == tabId );
            if (index == -1)
                throw Error("Tab " + tabId + " is not found for the window " + winId + " in the session " + this.sessionName);
            let mapping = {
                newToOrgOpenerTab: {},
                orgToNewTab: {}
            };
            let originalTab = Object.assign({}, tabs[index]);
            originalTab.active = true;
            return browser.windows.getCurrent({populate: true})
                .then( currentWindow => this._pRestoreTabInWindow(originalTab, currentWindow.id, gCtx, mapping) )
                .then( newTab => this._pUpdateOpenerTabIds([newTab], mapping) )
                .then( () => log.info("pRestoreTab done") );
        }

        updateTabs(winId, changedTabs, moved, deleted, orderedIds) {
            let tabs = this.tabsOfWindow[winId];
            if (tabs) {
                // Update the url/title from changedTabs
                if (Object.keys(changedTabs).length > 0) {
                    tabs.filter( tab => app.has(changedTabs, tab.id) ).forEach( tab => {
                        tab.url   = changedTabs[tab.id].url;
                        tab.title = changedTabs[tab.id].title;
                    });
                }
                if (Object.keys(deleted).length > 0) {
                    tabs = tabs.filter( tab => !app.has(deleted, tab.id) ); // delete by omission in copying.
                }
                let tabMap = tabs.reduce( (map, tab) => { map[tab.id] = tab; return map }, {});
                tabs = orderedIds.map( tid => tabMap[tid] ).filter( tab => tab != null );
                this.tabsOfWindow[winId] = tabs;
            }
        }

        deleteTab(winId, tabId) {
            let tabs = this.tabsOfWindow[winId];
            if (tabs) {
                let index = tabs.findIndex( tab => tab.id == tabId );
                if (index > -1) {
                    tabs.splice(index, 1);
                    this._updateTabData();
                    return true;
                }
            }
            return false;
        }

        setTabProperty(winId, tabId, propName, propValue) {
            let tabs = this.tabsOfWindow[winId];
            if (tabs) {
                let tab = tabs.find( tab => tab.id == tabId );
                if (tab) {
                    tab[propName] = propValue;
                    this._updateTabData();
                    return true;
                }
            }
            return false;
        }

        reorderTabs(winId, tabIds) {
            let tabs = this.tabsOfWindow[winId];
            if (tabs) {
                let tabMapById = tabs.reduce( (map, tab) => { map[tab.id] = tab; return map }, {} );
                this.tabsOfWindow[winId] = tabIds.map( tid => tabMapById[tid] );
                this._updateTabData();
            }
        }

        _pGetWindwIdsToRemove(isReplace) {
            return isReplace ? this._pGetAllBrowserWindowIds() : Promise.resolve([]);
        }

        _pGetAllBrowserWindowIds() {
            return browser.windows.getAll({}).then( windows => windows.map(w => w.id) );
        }

        _pRemoveWindows(windowIds) {
            //log.info("_pRemoveWindows ", windowIds);
            return Promise.all( windowIds.map( wid => browser.windows.remove(wid) ) )
        }

        _prepCreateInfo(win) {
            let createInfo = {
                state:      win.state,
                type:       win.type,
                url:        "about:blank",  // the first dummy tab
            };
            // Only "normal" window state has dimension.  For the other states, let the browser decide.
            if (win.state == "normal") {
                createInfo.left     = win.left;
                createInfo.top      = win.top;
                createInfo.width    = win.width;
                createInfo.height   = win.height;
            }
            return createInfo;
        }

        _pCreateWindows(windowsToCreate) {
            //log.info("_pCreateWindows");
            return Promise.all( windowsToCreate.map( win => {
                let createInfo = this._prepCreateInfo(win);
                return browser.windows.create(createInfo).then( newWindow => {
                    let windRestoreInfo = {
                        originalWindow: win,
                        newWindow:      newWindow,
                        tabsToRemove:   [ newWindow.tabs[0].id ],   // the first dummy tab will be removed.
                    };
                    return windRestoreInfo
                })
            } ));
        }

        _getRestoringWindowTabs(winId, searchTerms, searchByTab) {
            let tabs = this.tabsOfWindow[winId];
            return this._ensureOneActiveTab(Session.filterTabs(tabs, searchTerms, searchByTab));
        }

        // User editing can remove the active tab.  Promote one if no active tab exists.
        _ensureOneActiveTab(tabs) {
            tabs = tabs.slice();
            if (tabs.length > 0 && !tabs.some(tab => tab.active)) {
                tabs[0] = Object.assign({}, tabs[0]);
                tabs[0].active = true;
            }
            return tabs;
        }

        _pRestoreWindowTabs(windRestoreInfo, tabs, gCtx, mapping) {
            //log.info("_pRestoreWindowTabs");
            let restoringTabs = tabs.map(tab => this._pRestoreTabInWindow(tab, windRestoreInfo.newWindow.id, gCtx, mapping));
            return Promise.all( restoringTabs )
                .then( newTabsOfWindow => newTabsOfWindow.filter( newTab => newTab != null ) )
                .then( newTabsOfWindow => {
                    if (newTabsOfWindow.length > 0) {
                        return browser.tabs.remove(windRestoreInfo.tabsToRemove).then(() => newTabsOfWindow);
                    } else {
                        return [];
                    }
                });
        }

        _pRestoreTabInWindow(originalTab, windowId, gCtx, mapping) {
            return this._pRestoreTabInWindowOnCapability(originalTab, windowId, gCtx, mapping).catch( e => {
                log.error(e);
                return null;
            });
        }

        _pRestoreTabInWindowOnCapability(originalTab, windowId, gCtx, mapping) {
            // log.info("_pRestoreTabInWindowOnCapability majorVersion: " + gCtx.majorVersion);
            // log.info("_pRestoreTabInWindowOnCapability sbSettings: ", gCtx.sbSettings);
            
            let hasDiscardedCapability = gCtx.majorVersion >= "63";     // Firefox version 63+ supports setting the discarded flag.
            if (!gCtx.sbSettings.lazyTabLoadingOnRestore) {
                return this._pRestoreTabInWindowAsLoaded(originalTab, windowId);
            } else if (hasDiscardedCapability) {
                return this._pRestoreTabInWindowAsDiscarded(originalTab, windowId);
            } else {
                return this._pRestoreTabInWindowAsPending(originalTab, windowId, gCtx, mapping);
            }
        }

        _pRestoreTabInWindowAsLoaded(originalTab, windowId) {
            // log.info("_pRestoreTabInWindowAsLoaded");
            return browser.tabs.create({
                windowId:       windowId,
                active:         originalTab.active,
                pinned:         originalTab.pinned,
                cookieStoreId:  originalTab.cookieStoreId,
                url:            originalTab.url,
            });
        }
        
        // Create a tab with lazy loading with the help of the discarded flag.
        _pRestoreTabInWindowAsDiscarded(originalTab, windowId) {
            // log.info("_pRestoreTabInWindowAsDiscarded");
            let discard = originalTab.active ? false : true;    // active tab won't allow discarded flag set.
            let title   = discard ? originalTab.title : null;   // setting title is only allowed on discarded tabs.
            return browser.tabs.create({
                windowId:       windowId,
                active:         originalTab.active,
                pinned:         originalTab.pinned,
                cookieStoreId:  originalTab.cookieStoreId,
                url:            originalTab.url,
                discarded:      discard,
                title:          title,
            });
        }

        // Create a tab with lazy loading with the help of the injected content script.
        _pRestoreTabInWindowAsPending(originalTab, windowId, gCtx, mapping) {
            // log.info("_pRestoreTabInWindowAsPending");
            return browser.tabs.create({
                windowId:       windowId,
                active:         originalTab.active,
                pinned:         originalTab.pinned,
                cookieStoreId:  originalTab.cookieStoreId,
                url:            "about:blank",  // let on_inject deal with the real url, to handle possible content security error.
                // these are not accepted to tabs.create().
                // incognito:      originalTab.incognito,
                // width:          originalTab.width,
                // height:         originalTab.height,
            }).then( newTab => {
                newTab.url = this._mapUrl(originalTab.url);
                newTab.title = originalTab.title;
                newTab.favIconUrl = originalTab.favIconUrl;
                // Tracking the mapping of original tab id and new id.
                mapping.newToOrgOpenerTab[newTab.id] = originalTab.openerTabId;
                mapping.orgToNewTab[originalTab.id] = newTab.id;
                // There's a race condition between saving the pending new tab here and
                // the newly created tab's on_inject.sendMessage("csquery-pending-tab") to query the pending tab info.
                // on_inject needs to retry couple times with delay when not finding the pending tab.
                return gCtx.pAddPendingTab(newTab).then(() => newTab);  // return newTab at the end.
            })
        }        

        _pUpdateOpenerTabIds(newTabs, mapping) {
            return Promise.all( newTabs.map( newTab => {
                let orgOpenerTabId = mapping.newToOrgOpenerTab[newTab.id];
                let newOpenerTabId = mapping.orgToNewTab[orgOpenerTabId];
                try {
                    return browser.tabs.update(newTab.id, { openerTabId: newOpenerTabId });     // return newerTab
                } catch(e) {
                    console.warn(e.message);    // FireFox version older than 57 doesn't support setting openerTabId.
                    return newTab;
                }
            }) )
        }

        _mapUrl(url) {
            if (url == "about:newtab") return "about:blank";
            return url;
        }

        computeTabUrlHash() {
            let md5 = new SparkMD5();
            this.iterateAllTabs( tab => { md5.append(tab.url) });
            return md5.end();
        }

        static pSnapshotSession(gCtx, tabQueryFilter) {
            return browser.tabs.query(tabQueryFilter)
                .then( tabs => tabs.filter( tab => !tab.incognito ) )   // TODO: check Setting for including/filtering out the incognito tabs.
                .then( tabs => tabs.map( tab => {
                    // Supplement tabs with the info from the pending tabs, in case the pending blank tabs being snapshotted.
                    let pendingTab = gCtx.pendingRestoredTabs[tab.id];
                    if (pendingTab) {
                        tab.url = (!tab.url || tab.url == "about:blank") ? pendingTab.url : tab.url;
                        tab.title = tab.title || pendingTab.title;
                        tab.favIconUrl = tab.favIconUrl || pendingTab.favIconUrl;
                    }
                    return tab;
                }) )
                .then( tabs => {
                    let newSess = new Session();
                    let uniqueWinIds = new Set(tabs.map( tab => tab.windowId ));
                    uniqueWinIds.forEach( winId => newSess.tabsOfWindow[winId] = [] );
                    tabs.forEach( tab => newSess.tabsOfWindow[tab.windowId].push(Session.normalizeTab(tab)) );
                    return Promise.all( [...uniqueWinIds].map( winId => browser.windows.get(winId) ) )
                        .then( windowArray => {
                            newSess.windows = windowArray;
                            return newSess;
                        } );
                } )
                .then( newSess => newSess._updateTabData() );
        }

        static normalizeTab(tab) {
            let newTab = {};
            newTab.id = tab.id;
            newTab.index = tab.index;
            newTab.windowId = tab.windowId;
            newTab.active = tab.active;
            newTab.pinned = tab.pinned;
            newTab.incognito = tab.incognito;
            newTab.width = tab.width;
            newTab.height = tab.height;
            newTab.lastAccessed = tab.lastAccessed;
            newTab.cookieStoreId = tab.cookieStoreId;
            newTab.url = tab.url;
            newTab.title = tab.title;
            newTab.favIconUrl = tab.favIconUrl;
            newTab.sessionId = tab.sessionId;

            newTab.openerTabId = tab.openerTabId;
            newTab.isArticle = tab.isArticle;
            newTab.isInReaderMode = tab.isInReaderMode;
            return newTab;
        }

        static getGroupTokens(searchTerms)  { return app.toLower(searchTerms.filter(t => t.startsWith("group:")).map(t => t.substring("group:".length))) };
        static getFilterTokens(searchTerms) { return app.toLower(searchTerms.filter(t => !t.startsWith("group:"))) };

        static filterByGroups(sessList, searchTerms) {
            let groupTokens = Session.getGroupTokens(searchTerms);
            return sessList.filter(s => groupTokens.length == 0 || app.hasAny(s.group, groupTokens));
        }

        static filterByTabs(sessList, searchTerms) {
            let filterTokens = Session.getFilterTokens(searchTerms);
            return sessList.filter( s => s.allTabs.some( t => app.hasAll(t.title, filterTokens, true) ) );
        }
                    
        static filterByNames(sessList, searchTerms) {
            let filterTokens = Session.getFilterTokens(searchTerms);
            return sessList.filter( s => app.hasAll(s.sessionName, filterTokens, true) || app.hasAll(s.subTitleInfo, filterTokens, true) );
        }

        static filter(sessList, searchTerms, searchByTab) {
            sessList = Session.filterByGroups(sessList, searchTerms);
            return searchByTab ? Session.filterByTabs(sessList, searchTerms) : Session.filterByNames(sessList, searchTerms);
        }

        // tabs: [Tab], searchTerms: [String], searchByTab: bool
        static filterTabs(tabs, searchTerms, searchByTab) {
            let filterTokens = Session.getFilterTokens(searchTerms);
            return searchByTab ? tabs.filter( t => app.hasAll(t.title, filterTokens, true) ) : tabs;
        }
                    
    }

    // Module exports 
    module.USER = USER;
    module.AUTO = AUTO;
    module.ONCHANGE = ONCHANGE;
    module.AS_ALL = AS_ALL;
    module.AS_WIN = AS_WIN;
    module.GROUP_ONCHANGE = GROUP_ONCHANGE;
    module.Session = Session;

    log.info("module loaded");
    return module;
    
}(this, "session"));    // Pass in the global scope as 'this' scope.

