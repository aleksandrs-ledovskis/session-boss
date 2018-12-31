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

// ringbuf module, fixed size circular buffer.
(function(scope, modulename) {
    "use strict";

    var module = function() { };       // Module object to be returned.
    if (scope && modulename)
        scope[modulename] = module;    // set module name in scope, otherwise caller sets the name with the returned module object.

    class RingBuf {

        constructor(capacity, jsonObj) {
            this._type = "RingBuf";
            this._version = 1;
            if (jsonObj) {
                this._fromObj(jsonObj);
            } else {
                this._newVersion1(capacity);
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

        _newVersion1(capacity) {
            this._items     = new Array(Math.max(1, capacity || 1)).fill({});
            this._head      = 0;
            this._tail      = 0;
        }

        _fromVersion1(jsonObj) {
            this._items     = jsonObj._items;
            this._head      = jsonObj._head;
            this._tail      = jsonObj._tail;
            return this._validate();
        }

        _validate() {
            if (!this._items   || this._items.length == 0) throw Error("Invalid item array");
            if (this._tail < 0 || this._tail > this.capacity) throw Error("Invalid tail position");
            if (this._head < 0 || this._head > this.capacity * 2 || this._head < this._tail) throw Error("Invalid head position");
            return this;
        }

        get capacity()  { return this._items.length             }               // total size of the buffer.
        get length()    { return this._head - this._tail        }               // number of items saved; iterate from index 0 to length-1.
        get empty()     { return this.length == 0               }
        get full()      { return this.length == this.capacity   }
        get oldestIndex()   { return this.empty ? -1 : 0        }               // usually 0, -1 for empty.
        get newestIndex()   { return this.length - 1            }               // usually length-1, -1 for empty.

        clear()         { this._tail = this._head = 0; return this          }
        get(index)      { return this._items[this.pos(index)]               }   // get item at index between [0 to length-1]
        set(index, obj) { this._items[this.pos(index)] = obj; return this   }   // set item at index between [0 to length-1]
        oldest()        { return this.get(this.oldestIndex)                 }
        newest()        { return this.get(this.newestIndex)                 }
        pos(index)      { return (this._tail + index) % this.capacity       }   // get the array position from index
//        trimHead(index) { this._head = this.pos(index); return this         }   // set head at between [0 to length-1]

        // Push new item at the head.  Remove the oldest item at the tail if buffer is full.
        push(item) {
            if (this.full)
                this._advanceTail();    // advance tail to drop off the oldest item to make room.
            this._items[this._head++ % this.capacity] = item;
            return this;
        }

        pushItems(items) {
            items.forEach(item => this.push(item));
            return this;
        }

        // Dequeue the oldest item from the tail.
        take() {
            let item = this.oldest();
            if (!this.empty)
                this._advanceTail();
            return item;
        }

        // Dequeue the oldest items from the tail, upto the count.
        takeItems(uptoCount) {
            let array = [];
            for (let i = 0; (uptoCount == -1 || i < uptoCount) && !this.empty; i++)
                array.push(this.take());
            return array;
        }

        // Dequeue the newest item from the head.
        pop() {
            let item = this.newest();
            if (!this.empty)
                this._head--;
            return item;
        }

        // Remove the newest items from the head, upto the count.
        popItems(uptoCount) {
            let array = [];
            for (let i = 0; (uptoCount == -1 || i < uptoCount) && !this.empty; i++)
                array.push(this.pop());
            return array;
        }

        // Convert the items into an array starting from the oldest item at the tail to the newest item at the head.
        toArray() {
            let array = [];
            for (let i = 0; i < this.length; i++)
                array.push(this.get(i));
            return array;
        }

        // Convert the items into an array starting from the newest item at the head to the oldest item at the tail.
        toArrayNewest() {
            return this.toArray().reverse();
        }

        // Find the index to an item using the filterFn, iterating from oldest to newest.  Index can be used in get()/set().
        findIndex(filterFn) {
            for (let i = 0; i < this.length; i++) {
                if (filterFn(this.get(i)))
                    return i;
            }
            return -1;
        }

        // Find an item using the filterFn.
        find(filterFn) {
            let index = this.findIndex(filterFn);
            return index > -1 ? this.get(index) : null;
        }

        fillToCapacity(item) {
            for (let i = this.length; i < this.capacity; i++)
                this.set(i, item);
        }

        _advanceTail() {
            if (++this._tail == this.capacity) {
                this._tail -= this.capacity;
                this._head -= this.capacity;
            }
        }

    }

    // Module export
    module.RingBuf = RingBuf;
    return module;

}(this, "ringbuf"));    // Pass in the global scope as 'this' scope.

