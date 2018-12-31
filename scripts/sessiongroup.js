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

// sessiongroup module for backup session group.
(function(scope, modulename) {
    "use strict";

    // Import:
    // import logger
    // import sbcfg
    // import moment
    // import app
    let Session = session.Session;
    
    let log = new logger.Logger(sbcfg.APPNAME, modulename, sbcfg.LOGLEVEL);

    var module = function() { };       // Module object to be returned.
    if (scope && modulename)
        scope[modulename] = module;    // set module name in scope, otherwise caller sets the name with the returned module object.

    const BACKUP_15MIN   = 0;   // index to the BACKUP_GROUP_CFGS
    const BACKUP_HOURLY  = 1;
    const BACKUP_DAILY   = 2;
    const BACKUP_WEEKLY  = 3;
    const BACKUP_MONTHLY = 4;
    const BACKUP_GROUP_CFGS = [
        { groupType: "15-minute",   intervalCount: 4,   timeUnit: "minute",     units: 15,  duration: moment.duration(15, "minutes")    },
        { groupType: "hourly",      intervalCount: 4,   timeUnit: "hour",       units: 1,   duration: moment.duration(1,  "hours")      },
        { groupType: "daily",       intervalCount: 4,   timeUnit: "day",        units: 1,   duration: moment.duration(1,  "days")       },
        { groupType: "weekly",      intervalCount: 4,   timeUnit: "week",       units: 1,   duration: moment.duration(1,  "weeks")      },
        { groupType: "monthly",     intervalCount: 4,   timeUnit: "month",      units: 1,   duration: moment.duration(1,  "months")     },
    ];
    const BACKUP_GROUP_MAP = BACKUP_GROUP_CFGS.reduce( (map, cfg) => { map[cfg.groupType] = cfg; return map }, {} );
    const BACKUP_GROUP_TYPES = BACKUP_GROUP_CFGS.map( cfg => cfg.groupType );

    // Class for a group of sessions for a time range type,
    // e.g. the group of sessions for the 15-minute range type, or the group for the daily range type.
    class SessionGroup {

        constructor(groupType, jsonObj) {
            this._type = "SessionGroup";
            this._version = 1;
            if (jsonObj) {
                this._fromObj(jsonObj);
            } else {
                this._newVersion1(groupType);
            }
        }

        _fromObj(jsonObj) {
            switch (jsonObj._version) {
            case 1:
                return this._fromVersion1(jsonObj);
            default:
                throw Error("Unsupported object version " + jsonObj._version);
            }
        }

        _newVersion1(groupType) {
            let cfg = BACKUP_GROUP_MAP[groupType];
            if (!cfg)
                throw Error("Invalid groupType " + groupType);
            this.groupType = groupType;
            this._sessions = new Array(cfg.intervalCount).fill(null);
        }

        _fromVersion1(jsonObj) {
            let cfg = BACKUP_GROUP_MAP[jsonObj.groupType];
            if (!cfg)
                throw Error("Missing or invalid groupType field in jsonObj");
            this.groupType = cfg.groupType;
            this._sessions = new Array(cfg.intervalCount).fill(null);
            let jsonSessions = jsonObj._sessions || [];
            let count = Math.min(jsonSessions.length, this.length);
            for (let i = 0; i < count; i++)
                this._sessions[i] = jsonSessions[i] ? new Session(jsonSessions[i]) : null;
            this._validateVersion1();
        }

        _validateVersion1() {
            if (!BACKUP_GROUP_MAP[this.groupType])
                throw Error("Unsupported groupType " + this.groupType);
        }

        get length()        { return this._sessions.length }
        get sessions()      { return this._sessions }
        get newest()        { return this._sessions[0] }    // index 0th has the most recent session.
        set newest(sess)    { this._sessions[0] = sess.setGroup(this.groupType); }
        get uiSessions()    { return (this.groupType == "15-minute" ? this._sessions.slice(0) : this._sessions.slice(1)).filter(s => s) }
        get uiSessionCount(){ return this.uiSessions.length }

        propagateSessions(nowIntervalRange) {
            log.info("propagateSessions " + this.groupType);
            // log.info("nowIntervalRange" +
            //     " earlyBeginTime: " + nowIntervalRange.earlyBeginTime.format("M/D/YYYY h:mm:ss a") +
            //     " laterEndTime: " + nowIntervalRange.laterEndTime.format("M/D/YYYY h:mm:ss a"));
            let needRedo = false;
            let needSave = false;
            let cfg = BACKUP_GROUP_MAP[this.groupType];
            let earliestBeginTime = moment(nowIntervalRange.earlyBeginTime).subtract((this.length - 1) * cfg.units, cfg.timeUnit);
            //log.info("earliestBeginTime: " + earliestBeginTime.format("M/D/YYYY h:mm:ss a"));
            do {
                needRedo = false;
                // Start from the earliest interval, at highest index.  Index 0 has the most recent session.
                for (let i = this.length - 1; i >= 0; i--) {
                    let sess = this.sessions[i];
                    if (sess) {
                        let intervalBeginTime = moment(nowIntervalRange.earlyBeginTime).subtract(i * cfg.units, cfg.timeUnit);
                        // log.info(this.groupType + " intervalBeginTime: " + moment(intervalBeginTime).format("M/D/YYYY h:mm:ss a"));
                        // log.info(this.groupType + " " + i + ": sessionTimeMS: " + moment(sess.sessionTimeMS).format("M/D/YYYY h:mm:ss a") +
                        //     " .isBefore(intervalBeginTime): " + moment(sess.sessionTimeMS).isBefore(intervalBeginTime));
                        // The session time is completely earlier than the interval range.
                        if (moment(sess.sessionTimeMS).isBefore(intervalBeginTime)) {
                            if (i < this.length - 1) {
                                this.sessions[i + 1] = sess;    // move sess to the next earlier interval.
                                this.sessions[i] = null;        // clear the moved interval; might be filled in by the next moving interval.
                                needRedo = true;
                                needSave = true;
                            } else {
                                this.sessions[i] = null;        // session older than interval range and no where to move; remove it at this point.
                            }
                        }
                    }
                }
            } while (needRedo);     // reprocess the list until no more session being moved.
            this.updateSessionGroupInfo();
            return needSave;
        }

        updateSessionGroupInfo() {
            this.sessions.forEach( (s, i) => {
                if (s) {
                    s.setGroupTitle(`group:${s.group} backup interval${i > 0 ? ' ' + i : ''}`);
                    s.setSessionName("backup " + s.shortTime + " " + this.groupType);
                }
            });
        }

    }

    function createBackupGroups() {
        return BACKUP_GROUP_CFGS.map(cfg => new SessionGroup(cfg.groupType));
    }

    function _roundToInterval(momentTime, intervalDuration) {
        return moment(Math.floor((+momentTime) / (+intervalDuration)) * (+intervalDuration));
    }

    function _intervalRangeOfGroup(cfg, time) {
        let earlyBeginTime  = cfg.groupType == "15-minute" ? _roundToInterval(time, cfg.duration) : moment(time).startOf(cfg.timeUnit);
        let laterEndTime    = moment(earlyBeginTime).add(cfg.units, cfg.timeUnit);
        return { earlyBeginTime: earlyBeginTime, laterEndTime: laterEndTime };
    }

    function currentIntervalRangeMap() {
        let now = moment();
        return BACKUP_GROUP_CFGS.reduce( (map, cfg) => app.setObjVal(map, cfg.groupType, _intervalRangeOfGroup(cfg, now)), {} );
    }

    // Module export
    module.BACKUP_15MIN             = BACKUP_15MIN;
    module.BACKUP_HOURLY            = BACKUP_HOURLY;
    module.BACKUP_DAILY             = BACKUP_DAILY;
    module.BACKUP_WEEKLY            = BACKUP_WEEKLY;
    module.BACKUP_MONTHLY           = BACKUP_MONTHLY;
    module.BACKUP_GROUP_CFGS        = BACKUP_GROUP_CFGS;
    module.BACKUP_GROUP_MAP         = BACKUP_GROUP_MAP;
    module.BACKUP_GROUP_TYPES       = BACKUP_GROUP_TYPES;
    module.SessionGroup             = SessionGroup;
    module.createBackupGroups       = createBackupGroups;
    module.currentIntervalRangeMap  = currentIntervalRangeMap;

    log.info("module loaded");
    return module;

}(this, "sessiongroup"));   // Pass in the global scope as 'this' scope.

