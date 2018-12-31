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

// app module

(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import sbcfg

    let log = new logger.Logger(sbcfg.APPNAME, modulename, sbcfg.LOGLEVEL);

    var app = function() { };       // Module object to be returned; local reference to the package object for use below.
    if (scope && modulename)
        scope[modulename] = app;    // set module name in scope, otherwise caller sets the name with the returned module object.

    var GS = scope;                 // global scope
    var SP = String.prototype;
    var AP = Array.prototype;
    var OP = Object.prototype;

    // util
    app.noop        = function() {};
    app.identity    = function(obj) { return obj };
    app.json        = function(obj) { return JSON.stringify(obj, null, 4) };
    app.has         = function(obj, key) { return obj != null && obj.hasOwnProperty(key) };
    app.isDef       = function(val) { return typeof val !== "undefined" };
    app.isStr       = function(obj) { return (typeof obj == "string" || obj instanceof String) };
    app.isArray     = Array.isArray || function(obj) { return OP.toString.call(obj) === "[object Array]" };
    app.isFn        = function(obj) { return typeof obj === "function" };
    app.isObj       = function(obj) { return typeof obj === "object" };
    app.isNum       = function(obj) { return typeof obj === "number" };
    app.isDate      = function(obj) { return obj instanceof Date || OP.toString.call(obj) === "[object Date]" };
    app.dump        = function(arg) { return "[" + [].map.call((app.isArray(arg) ? arg : arguments), function(a){ return app.json(a) }).join(", ") + "]" };
    app.dumpArgs    = function()    { return app.dump(Array.prototype.slice.call(arguments)) };
    app.alert       = function()    { alert(app.dump(Array.prototype.slice.call(arguments))) };
    app.log         = function()    { console.log(app.dump(Array.prototype.slice.call(arguments))) };
    app.ensureFn    = function(orgFn, defFn){ return app.isFn(orgFn) ? orgFn : defFn };
    app.defval      = function(val, dfVal)  { return typeof val === "undefined" ? dfVal : val }  // return default only if val undefined.  Return 0 or null correctly.
    app.ensureVal   = function(val, dfVal)  { return typeof val === "undefined" || val == null ? dfVal : val } // return default if val is undefined or null.
    app.defObjVal   = function(o, k, dfVal) { return app.has(o, k) ? app.ensureVal(o[k], dfVal) : dfVal };     // return default if val is undefined or null.
    app.setObjVal   = function(o, k, val)   { o[k] = val; return o }
    app.defer       = function(obj, fn)     { var args = AP.slice.call(arguments, 2); setTimeout(function() { fn.apply(obj, args) }, 0); };
    
    // enhance String
    if (typeof SP.ltrim != "function")      SP.ltrim = function() { return this.replace(/^\s+/,'') };
    if (typeof SP.rtrim != "function")      SP.rtrim = function() { return this.replace(/\s+$/,'') };
    if (typeof SP.startsWith != "function") SP.startsWith = function(prefix) { return this.lastIndexOf(prefix, 0) === 0 };
    if (typeof SP.endsWith != "function")   SP.endsWith = function(suffix) { return this.indexOf(suffix, this.length - suffix.length) !== -1 };
    if (typeof SP.toNum != "function")      SP.toNum = function(defv) { var num = parseFloat(this); return isNaN(num) ? (defv ? defv : 0) : num; };
    if (typeof SP.indexOfRx != "function")  SP.indexOfRx = function(regex, startPos) {
        var indexOf = this.substring(startPos || 0).search(regex);
        return (indexOf >= 0) ? (indexOf + (startPos || 0)) : indexOf;
    }

    // enhance Array
    if (typeof AP.first != "function")      AP.first    = function() { return this.length > 0 ? this[0] : null };
    if (typeof AP.second != "function")     AP.second   = function() { return this.length > 1 ? this[1] : null };
    if (typeof AP.third != "function")      AP.third    = function() { return this.length > 2 ? this[2] : null };
    if (typeof AP.last != "function")       AP.last     = function() { return this.length > 0 ? this[this.length - 1] : null };

    app.arrayMove   = function(array, from, to) { array.splice(to, 0, array.splice(from, 1)[0]); return array };
    app.flatten     = function(array) { return [].concat.apply([], array) };

    app.debounce = function(operationFunc, waitMS, resetWaitTime, context) {
        var timeoutId = null;
        var operationArgs = null;           // closure share variable to pass the arguments of the operationProxy.
        var onTimeoutCallback = function() {
            timeoutId = null;
            operationFunc.apply(context, operationArgs);
        }
        var operationProxy = function() {   // the operationProxy can be called repeatedly, and only the last one goes through.
            operationArgs = arguments;      // parameters of the last called proxy operation are passed to operationFunc.
            if (resetWaitTime && !timeoutId) {
                clearTimeout(timeoutId);    // reset the timer every time operationProxy is called to wait for the full waitMS again.
                timeoutId = null;
            }
            if (timeoutId == null)
                timeoutId = setTimeout(onTimeoutCallback, waitMS);
        }
        return operationProxy;
    }

    app.uuid = function() {
        var d = new Date().getTime();
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            d += performance.now();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = (d + Math.random() * 16) % 16 | 0;
            d = Math.floor(d / 16);
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    app.fmtPlural = function(count, baseWord, pluralWord) {
        return count <= 1 ? baseWord : (pluralWord ? pluralWord : baseWord + "s");
    }

    app.fmtNumWord = function(count, baseWord, pluralWord) {
        return count + " " + app.fmtPlural(count, baseWord, pluralWord);
    }

    app.padDigit5 = function(number) {
        return number <= 99999 ? ("0000"+number).slice(-5) : number;
    }

    app.pad = function(str, width=2, ch="0") {
        return (String(ch).repeat(width) + String(str)).slice(String(str).length)
    }

    app.hasAll = function(str, tokens, asLowerCase) {
        str = str || "";
        if (asLowerCase)
            str = str.toLowerCase();
        return tokens.every(token => token.length == 0 || str.indexOf(token) !== -1);
    }

    app.hasAny = function(str, tokens) {
        return tokens.some(token => token.length == 0 || str.indexOf(token) !== -1);
    }

    app.matchAny = function(str, tokens) {
        return tokens.some(token => token.length == 0 || str == token);
    }

    app.cmpStr = function(s1, s2) {
        if (s1 < s2) return -1;
        if (s1 > s2) return 1;
        return 0;
    }

    app.cmpArray = function(a1, a2) {
        if (a1 == null && a2 == null)
            return true;
        if (a1 == null || a2 == null)
            return false;
        return (a1.length == a2.length) && a1.every( (v,i) => v === a2[i] );
    }

    app.toLower = function(tokens) {
        return tokens.map( token => token.toLowerCase() );
    }

    log.info("module loaded");
    return app;

}(this, "app"));    // Pass in the global scope as 'this' scope.

