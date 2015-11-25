"use strict";
let WorldPosition = require('path-world').WorldPosition;

//
// Helper for working with precomputed paths
class PathInfo {
	constructor(path, swamps, roads) {
		this.path = path;
		this.swamps = swamps;
		this.roads = roads;
		this.length = path.length;
	}

	// Restore a serialized path
	static deserialize(json) {
		var path = new Array(json.p ? json.p.length + 1 : 1);
		var current = path[0] = new WorldPosition(json.x, json.y);
		for (var ii = 1; ii < path.length; ++ii) {
			if (!json.p[ii - 1]) {
				console.log('Weird path found', JSON.stringify(json));
				return;
			}
			path[ii] = current = current.getPositionInDirection(json.p[ii - 1]);
		}
		return new PathInfo(path, json.s, json.r);
	}

	// Serialize a path into JSON
	serialize() {
		var path;
		if (this.path.length === 0) {
			return;
		} else if (this.path.length > 1) {
			path = new Array(this.path.length - 1);
			for (var ii = 1; ii < this.path.length; ++ii) {
				path[ii - 1] = this.path[ii - 1].getDirectionTo(this.path[ii]);
			}
		}
		return {
			p: path,
			s: this.swamps,
			r: this.roads,
			x: this.path[0].xx,
			y: this.path[0].yy,
		};
	}

	// Use flags to visualize a path
	draw() {
		let flags = Memory.debugFlags || (Memory.debugFlags = []);
		let flagIndex = {};
		flags.forEach(function(flag, ii) {
			flagIndex[flag.pos] = ii;
		});
		let ii = 0;
		if (flags.length !== 0) {
			ii = flags[flags.length - 1].ii + 1;
		}
		for (let pos of this.path) {
			let rp = pos.toRoomPosition();
			if (Game.rooms.sim) {
				rp.roomName = 'sim';
			}
			let index = flagIndex[pos.serialize()];
			if (index !== undefined) {
				flags[index].time = Game.time + 5;
				continue;
			}
			let room = Game.rooms[rp.roomName];
			if (room) {
				let name = 'd'+ ii.toString(36);
				flags.push({
					ii: ii,
					time: Game.time + 5,
					flag: name,
					pos: pos.serialize(),
				});
				++ii;
				room.createFlag(rp, name, COLOR_GREY);
			}
		}
	}

	// Return number of turns it takes to walk this path
	cost(weightRatio) {
		if (weightRatio === 0) {
			return this.path.length;
		} else {
			return (this.path.length + this.swamps.length * 4) * Math.ceil(weightRatio || 1) - Math.floor(1 / weightRatio) * this.roads.length;
		}
	}

	// Remove the first step on this path and return the WorldPosition
	shift() {
		--this.length;
		if (this.swamps[0] === 0) {
			this.swamps.shift();
		}
		if (this.roads[0] === 0) {
			this.roads.shift();
		}
		this.swamps = this.swamps.map(function(swamp) {
			return swamp - 1;
		});
		this.roads = this.roads.map(function(road) {
			return road - 1;
		});
		return this.path.shift();
	}

	// Remove the last step on this path and return the WorldPosition
	pop() {
		--this.length;
		if (this.swamps[this.swamps.length - 1] === this.length) {
			this.swamps.pop();
		}
		if (this.roads[this.roads.length - 1] === this.length) {
			this.roads.pop();
		}
		return this.path.pop();
	}

	// Push a new position onto this path
	push(position) {
		this.path.push(position);
	}

	// In-place reverse
	reverse() {
		let length = this.length;
		this.swamps = this.swamps.map(function(swamp) {
			return length - swamp - 1;
		});
		this.roads = this.roads.map(function(road) {
			return length - road - 1;
		});
		this.path.reverse();
	}

	// Concat another path onto this path
	merge(path) {
		this.path.push.apply(this.path, path.path);
		let oldLength = this.length;
		this.length += path.length;
		this.roads.push.apply(this.roads, path.roads.map(function(road) {
			return oldLength + road;
		}));
		this.swamps.push.apply(this.swamps, path.swamps.map(function(swamp) {
			return oldLength + swamp;
		}));
	}

	// Return a copy of the path
	copy() {
		return new PathInfo(this.path.slice(), this.swamps.slice(), this.roads.slice());
	}

	// Get index of current position on this path
	indexOf(pos) {
		pos = WorldPosition(pos);
		return _.findIndex(this.path, function(square) {
			return pos.xx === square.xx && pos.yy === square.yy;
		});
	}

	// Pretty debug strings
	toString() {
		if (this.path.length === 0) {
			return ('[PathInfo: near]');
		}
		var pos1 = this.path[0].toRoomPosition();
		var pos2 = this.path[this.path.length - 1].toRoomPosition();
		return (
			'[PathInfo: '+
			pos1.roomName+ '{'+ pos1.x+ ', '+ pos1.y+ '}'+
			' -> {'+ (this.path.length - 2)+ '} -> '+
			pos2.roomName+ '{'+ pos2.x+ ', '+ pos2.y+ '}'+
			']'
		);
	}
}

// Clear out old draw() flags
// nb: Run this every tick if using main-loop
if (Memory.debugFlags) {
	let flags = Memory.debugFlags.filter(function(info) {
		let flag = Game.flags[info.flag];
		if (!flag) {
			return;
		} else if (info.time < Game.time) {
			flag.remove();
			return;
		}
		return true;
	});
	if (flags.length === 0) {
		delete Memory.debugFlags;
	}
}

module.exports = PathInfo;
