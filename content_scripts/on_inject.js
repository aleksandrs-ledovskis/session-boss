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

// on_inject module, page injection script.
(function(scope, modulename) {

    // Imports:
    // import logger
    // import sbcfg

    let log = new logger.Logger(sbcfg.APPNAME, modulename, sbcfg.LOGLEVEL);

    log.info(window.location.href + " starts -------------------------");

    function init() {
        Promise.resolve()
            .then(() => setupMessageHandlers() )
            .then(() => setupPendingTab() )
//          .then(() => log.info(window.location.href + " init done") )
            .catch( e => log.error(e) )
    }

    function setupMessageHandlers() {
        browser.runtime.onMessage.addListener(function (msg) {
            switch (msg.cmd) {
            case "restore-url":
                log.info("onMessasge: restore-url: " + msg.url);
                setUrl(msg.url);
                break;
            case "show-msg":
                log.info("onMessasge: show-msg: " + msg.text);
                setPageMessage(msg.text);
                break;
            }
        });
    }

    function randomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randomDelayPromise(uptoDelayMS) {
        let randomDelay = randomInt(0, uptoDelayMS);
        //log.info("randomDelayPromise randomDelay: " + randomDelay);
        return new Promise( result => setTimeout(result, randomDelay) );
    }

    function retryFn(fn, uptoDelayMS, retryCount) {
        //log.info("retryFn retryCount: " + retryCount);
        return new Promise( (resolve, reject) => {
            return fn()
                .then(resolve)
                .catch( reason => {
                    if (retryCount - 1 > 0) {
                        return randomDelayPromise(uptoDelayMS)
                            .then(retryFn.bind(null, fn, uptoDelayMS, retryCount - 1))
                            .then(resolve)
                            .catch(reject);
                    }
                    return reject(reason);
                });
        });
    }

    function setupPendingTab() {
        // Pending tab is about:blank only.
        if (window.location.href == "about:blank") {
            log.info("setupPendingTab about:blank");
            retryFn(pQueryPendingTab, 1000, 5).catch(e => log.error(e));
        }
    }

    function pQueryPendingTab() {
        return browser.runtime.sendMessage({ cmd: "cs-query-pending-tab" })
            .then(response => {
                if (response && response.status == "ok") {
                    if (response.hasRestored) {
                        if (response.pendingTab) {
                            with (response) {
                                log.info("queryPendingTab tab: " + pendingTab.id + " setTitle: '" + pendingTab.title + "'");
                                setTitle(pendingTab.title);
                                log.info("queryPendingTab tab: " + pendingTab.id + " setFavIcon: '" + pendingTab.favIconUrl + "'");
                                setFavIcon(pendingTab.favIconUrl);
                                if (pendingTab.active) {
                                    log.info("queryPendingTab tab: " + pendingTab.id + " active setUrl: '" + pendingTab.url + "'");
                                    setUrl(pendingTab.url);
                                }
                            }
                        } else {
                            log.info("queryPendingTab - no pendingTab yet");
                            throw Error("queryPendingTab - no pendingTab yet"); // throw error to retry
                        }
                    } else {
                        log.info("queryPendingTab - no session being restored.");    // give up
                    }
                } else {
                    log.info("queryPendingTab - response non-ok status: ", response);
                    throw Error("queryPendingTab - response non-ok status");    // throw error to retry
                }
            }, error => {
                log.info("queryPendingTab - sendMessage error: ", error);
                throw error;    // retry
            });
    }

    function setTitle(title) {
        document.title = title;
    }

    function setUrl(url) {
        // Avoid setting the same url;
        // otherwise, the new url will be injected again and can cause an infinite loop for queryPendingTab() on "about:blank"
        if (window.location.href != url) {
            try {
                window.location.href = url;
            } catch (e) {
                log.error(e);
                showErrorMessage(e.message, url);
            }
        } else {
            log.info(url + " is same as the current url.  Not set.");
        }
    }

    function setFavIcon(favIconUrl) {
        if (favIconUrl) {
            let favicon = document.querySelector('link[rel="shortcut icon"]');
            if (!favicon) {
                favicon = document.createElement("link");
                favicon.setAttribute("rel", "shortcut icon");
                let head = document.querySelector("head");
                head.appendChild(favicon);
            }
            favicon.setAttribute("type", "image/png");
            favicon.setAttribute("href", favIconUrl);
        }
    }

    function setPageMessage(msg) {
        if (window.location.href == "about:blank") {
            let div = document.createElement("div");
            div.textContent = "msg - " + msg;
            $("body").replaceWith(div);
        }
    }

    function showErrorMessage(errmsg, url) {
        if (window.location.href == "about:blank") {
            $("head").append(`
                <style type='text/css'>
                  html {
                    font-size: 16px;
                    font-family: sans-serif;
                    line-height: 1.5;
                    background-color: #f9f9f9;
                  }
                  body {
                    color: #50596c;
                    margin: 0 auto;
                    padding: 1.75rem 2rem;
                  }
                  .text-gray {
                    color: #8c8382;
                  }
                  .warning {
                    color: #9F6000;
                    background-color: #FEEFB3;
                    margin: 6px 0px;
                    padding:12px 16px;
                  }
                  .form-input {
                    -webkit-appearance: none;
                    -moz-appearance: none;
                    appearance: none;
                    background: #fff;
                    background-image: none;
                    border: .05rem solid #caced7;
                    border-radius: .1rem;
                    color: #50596c;
                    display: block;
                    font-size: .8rem;
                    height: 1.8rem;
                    line-height: 1rem;
                    max-width: 100%;
                    outline: none;
                    padding: .35rem .4rem;
                    position: relative;
                    transition: all .2s ease;
                    width: 100%;
                  }
                  .form-input:focus {
                    border-color: #007bff; 
                    box-shadow: 0 0 0 .1rem rgba(0, 123, 255, .2);
                  }
                </style>
            `);
            // .html() is used only for the template text.  The potentially unsafe text are set via .text() and .val() below.
            $("body").html($(`
                <div class='warning'>
                  <h4 style='margin:0'>Session Boss</h4>
                  <div style='margin:4px 0 0 0'>Browser content security policy prevents opening special url from extensions.</div>
                  <small class='text-gray'>Error message: <span id='param-errmsg'>ERRMSG</span></small>
                </div>
                <div style='font-size:80%; margin:1.2rem 0 .25rem 0;'>Copy and paste the url into the address bar to open it.</div>
                <input type='text' class='form-input' readonly value='URL' id='param-url'>
            `));
            $("#param-errmsg").text(errmsg);
            $("#param-url").val(url);
            $("input:text:first").focus().select();
        }
    }

    init();

}(this, "on_inject"));    // Pass in the global scope as 'this' scope.

