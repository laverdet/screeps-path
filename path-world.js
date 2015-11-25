"use strict";

//
// Replacement for RoomPosition, with no need for `roomName`
let kWorldSize = 25;
let kSimWorldOffset = kWorldSize * 2 * 50;
function WorldPosition(xx, yy) {
	if (this === undefined) {
		if (xx instanceof WorldPosition) {
			return xx;
		} else if (xx instanceof RoomPosition) {
			if (xx.roomName === 'sim') {
				return new WorldPosition(
					xx.x + kSimWorldOffset,
					xx.y
				);
			} else {
				let room = /^([WE])([0-9]+)([NS])([0-9]+)$/.exec(xx.roomName);
				if (!room) {
					throw new Error('Invalid room name');
				}
				return new WorldPosition(
					xx.x + 50 * (kWorldSize + (room[1] === 'W' ? -Number(room[2]) : Number(room[2]) + 1)),
					xx.y + 50 * (kWorldSize + (room[3] === 'N' ? -Number(room[4]) : Number(room[4]) + 1))
				);
			}
		}
	}
	this.xx = xx;
	this.yy = yy;
}

_.assign(WorldPosition, {
	kWorldSize: kWorldSize,

	// Restore a serialized WorldPosition
	deserialize: function(json) {
		return new WorldPosition(Math.floor(json / (kWorldSize * 2 * 50)), json % (kWorldSize * 2 * 50));
	},
});

_.assign(WorldPosition.prototype, {

	// Serialize a WorldPosition into something that can be JSON'd
	serialize: function() {
		return this.xx * (kWorldSize * 2 * 50) + this.yy;
	},

	// Create a standard RoomPosition
	toRoomPosition: function() {
		if (this.xx >= kSimWorldOffset) {
			return new RoomPosition(
				this.xx - kSimWorldOffset,
				this.yy,
				'sim'
			);
		} else {
			return new RoomPosition(this.xx % 50, this.yy % 50, this.getRoomName());
		}
	},

	// Return the name of the room this position is in
	getRoomName: function() {
		if (this.xx >= kSimWorldOffset) {
			return 'sim';
		}
		return (
			(this.xx <= kWorldSize * 50 + 49 ? 'W'+ (kWorldSize - Math.floor(this.xx / 50)) : 'E'+ (Math.floor(this.xx / 50) - kWorldSize - 1))+
			(this.yy <= kWorldSize * 50 + 49 ? 'N'+ (kWorldSize - Math.floor(this.yy / 50)) : 'S'+ (Math.floor(this.yy / 50) - kWorldSize - 1))
		);
	},

	// Return a new WorldPosition in the direction request
	getPositionInDirection: function(direction) {
		switch (direction) {
			case TOP:
				return new WorldPosition(this.xx, this.yy - 1);
			case TOP_RIGHT:
				return new WorldPosition(this.xx + 1, this.yy - 1);
			case RIGHT:
				return new WorldPosition(this.xx + 1, this.yy);
			case BOTTOM_RIGHT:
				return new WorldPosition(this.xx + 1, this.yy + 1);
			case BOTTOM:
				return new WorldPosition(this.xx, this.yy + 1);
			case BOTTOM_LEFT:
				return new WorldPosition(this.xx - 1, this.yy + 1);
			case LEFT:
				return new WorldPosition(this.xx - 1, this.yy);
			case TOP_LEFT:
				return new WorldPosition(this.xx - 1, this.yy - 1);
		}
	},

	// Gets the linear direction to a tile
	getDirectionTo: function(pos) {
		let dx = pos.xx - this.xx;
		let dy = pos.yy - this.yy;
		if (dx > 0) {
			if (dy > 0) {
				return BOTTOM_RIGHT;
			} else if (dy < 0) {
				return TOP_RIGHT;
			} else {
				return RIGHT;
			}
		} else if (dx < 0) {
			if (dy > 0) {
				return BOTTOM_LEFT;
			} else if (dy < 0) {
				return TOP_LEFT;
			} else {
				return LEFT;;
			}
		} else {
			if (dy > 0) {
				return BOTTOM;
			} else if (dy < 0) {
				return TOP;
			}
		}
	},

	// If this position is on the border then return the position in the next room
	getPositionInNextRoom: function() {
		let exit = new WorldPosition(this.xx, this.yy);
		if (this.yy % 50 === 0) {
			--exit.yy;
		} else if (this.yy % 50 === 49) {
			++exit.yy;
		} else if (this.xx % 50 === 0) {
			--exit.xx;
		} else if (this.xx % 50 === 49) {
			++exit.xx;
		} else {
			return undefined;
		}
		return exit;
	},

	// Equality check
	isEqualTo: function(pos) {
		pos = WorldPosition(pos);
		return this.xx === pos.xx && this.yy === pos.yy;
	},

	// Get distance to another position
	getRangeTo: function(pos) {
		pos = WorldPosition(pos);
		return Math.max(Math.abs(this.xx - pos.xx), Math.abs(this.yy - pos.yy));
	},

	// Is this position next to another position
	isNearTo: function(pos) {
		return this.getRangeTo(pos) <= 1;
	},

	// Debug prints
	toString: function() {
		let pos = this.toRoomPosition();
		return '[WorldPosition '+ pos.roomName+ '{'+ pos.x+ ', '+ pos.y+ '}]';
	},
});

//
// A WorldPosition that also has a direction and a length
class WorldLine {
	constructor(pos, dir, length) {
		this.pos = pos;
		this.dir = dir;
		this.length = length;
	}

	static deserialize(json) {
		return new WorldLine(WorldPosition.deserialize(json.p), json.d, json.l);
	}

	serialize() {
		return {
			p: this.pos.serialize(),
			d: this.dir,
			l: this.length,
		};
	}

	// Get range to a WorldPosition
	getRangeTo(pos) {
		if (this.dir === 0) {
			return Math.max(0, pos.yy - this.pos.yy - this.length, this.pos.yy - pos.yy, Math.abs(this.pos.xx - pos.xx));
		} else {
			return Math.max(0, pos.xx - this.pos.xx - this.length, this.pos.xx - pos.xx, Math.abs(this.pos.yy - pos.yy));
		}
	}

	getEndPoint() {
		if (this.dir === 0) {
			return new WorldPosition(this.pos.xx + this.length, this.pos.yy);
		} else {
			return new WorldPosition(this.pos.xx, this.pos.yy + this.length);
		}
	}

	getRoomName() {
		return this.pos.getRoomName();
	}

	toString() {
		return '[WorldLine '+ this.pos+ ':'+ this.length+ ']';
	}
}

module.exports = {
	WorldPosition,
	WorldLine,
};
