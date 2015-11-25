"use strict";
let Heap = require('path-heap');
let OpenClosed = require('path-open-closed');
let worldLib = require('path-world');
let WorldPosition = worldLib.WorldPosition;
let WorldLine = worldLib.WorldLine;

//
// Descriptor of a room exit
class RoomPortal {
	constructor(roomName, ii, edge, exit) {
		this.roomName = roomName;
		this.ii = ii;
		this.edge = edge;
		this.exit = exit;
		if (this.edge.pos.yy % 50 === 0) {
			this.dir = 1;
		} else if (this.edge.pos.xx % 50 === 49) {
			this.dir = 2;
		} else if (this.edge.pos.yy % 50 === 49) {
			this.dir = 3;
		} else if (this.edge.pos.xx % 50 == 0) {
			this.dir = 4;
		} else {
			throw new Error('Invalid portal');
		}
	}

	static deserialize(roomName, json) {
		return new RoomPortal(
			roomName,
			json.ii,
			WorldLine.deserialize(json.edge),
			json.exit
		);
	}

	serialize() {
		return {
			ii: this.ii,
			edge: this.edge.serialize(),
			exit: this.exit,
		};
	}

	neighbor() {
		let terrainData = TerrainData.factory(this.exit);
		if (terrainData) {
			let dir = (this.dir + 1) % 4;
			return terrainData.edges[dir][this.ii];
		}
	}

	toString() {
		let dir;
		switch (this.dir) {
			case 1:
				dir = 'TOP';
				break;
			case 2:
				dir = 'RIGHT';
				break;
			case 3:
				dir = 'BOTTOM';
				break;
			case 4:
				dir = 'LEFT';
				break;
		}
		return '[RoomPortal '+ this.roomName+ ' -> '+ dir+ ':'+ this.ii+ ']';
	}
}

//
// Maintains a map of terrain data of this room for quick access. This never changes in a room.
function TerrainData(terrain, edges, controller, sources, keeperLairs) {
	this.terrain = terrain;
	this.edges = edges;
	this.controller = controller;
	this.sources = sources;
	this.keeperLairs = keeperLairs;
}

_.assign(TerrainData, {
	PLAIN: 0,
	WALL: 1,
	SWAMP: 2,
	ROAD: 3,

	instances: {},

	factory: function(roomName) {

		// Check for cached instances
		var instance = TerrainData.instances[roomName];
		if (instance) {
			return instance;
		}

		// Check memory for saved room state
		let room = Game.rooms[roomName];
		let terrainMemory = Memory.rooms[roomName] && Memory.rooms[roomName].terrain;
		let structureCount;
		if (room) {
			structureCount = room.find(FIND_STRUCTURES).length + room.find(FIND_CONSTRUCTION_SITES).length * 10 + 1;
			if (terrainMemory && terrainMemory.structures !== structureCount) {
				terrainMemory = undefined;
			}
		} else if (!terrainMemory) {
			return;
		}

		let terrain;
		let edges;
		if (terrainMemory && (!room || room.mode !== 'simulation')) {

			// Recreate the Uint8Array from JSON data
			terrain = new Uint8Array(new Uint32Array(terrainMemory.terrain).buffer);
			edges = terrainMemory.edges.map(function(portals) {
				return portals.map(function(portal) {
					return RoomPortal.deserialize(roomName, portal);
				});
			});
		} else {

			// Generate terrain data from fresh game state
			terrain = new Uint8Array(50 * 50 / 4 + 3); // add 3 so this can be converted to a Uint32Array
			let tiles = room.lookAtArea(0, 0, 49, 49);
			let my = room.controller && room.controller.my;
			let totalPlain = 0, totalSwamps = 0, totalRoads = 0;
			for (var ii in tiles) {
				for (var jj in tiles[ii]) {
					var wall = false, swamp = false, road = false;
					tiles[ii][jj].forEach(function(tile) {
						switch (tile.type) {
							case 'structure':
								if (tile.structure.structureType === STRUCTURE_ROAD) {
									road = true;
								} else if (
									ii != 0 && ii != 49 && jj != 0 && jj != 49 &&
									my && tile.structure.structureType !== STRUCTURE_RAMPART
								) {
									wall = true;
								}
								return;
							case 'constructionSite':
								if (
									my &&
									tile.constructionSite.structureType !== STRUCTURE_RAMPART &&
									tile.constructionSite.structureType !== STRUCTURE_ROAD
								) {
									wall = true;
								}
								return;
							case 'terrain':
								switch (tile.terrain) {
									case 'wall':
										wall = true;
										return;
									case 'swamp':
										swamp = true;
										return;
								}
								return;
						}
					});
					var bit;
					if (wall) {
						bit = TerrainData.WALL;
					} else if (road) {
						++totalRoads;
						bit = TerrainData.ROAD;
					} else if (swamp) {
						++totalSwamps;
						bit = TerrainData.SWAMP;
					} else {
						++totalPlain;
						bit = TerrainData.PLAIN;
					}
					var index = Number(jj) * 50 + Number(ii);
					terrain[(index / 4) | 0] |= bit << (index % 4 * 2);
				}
			}

			// Fix broken sim room data
			if (room.name === 'sim') {
				for (var ii = 0; ii < 50; ++ii) {
					var type = (ii > 16 && ii < 33) ? TerrainData.PLAIN : TerrainData.WALL;
					TerrainData.set(terrain, ii, 0, type);
					TerrainData.set(terrain, ii, 49, type);
					TerrainData.set(terrain, 0, ii, type);
					TerrainData.set(terrain, 49, ii, type);
				}
			}

			// Calculate distances from exits
			edges = [
				TerrainData.findExits(roomName, terrain, 0, 0, 1, 0),
				TerrainData.findExits(roomName, terrain, 49, 0, 0, 1),
				TerrainData.findExits(roomName, terrain, 0, 49, 1, 0),
				TerrainData.findExits(roomName, terrain, 0, 0, 0, 1),
			];

			// Memoize which squares the keepers attack so we can avoid those
			let sources = room.find(FIND_SOURCES);
			let keeperLairs = room.find(FIND_STRUCTURES).filter(function(structure) {
				return structure.structureType === STRUCTURE_KEEPER_LAIR;
			});
			let keeperDanger;
			if (keeperLairs.length) {

				// Get paths of all keepers
				let keeperTileMap = {};
				keeperLairs.forEach(function(keeper) {
					let source = _.find(sources, function(source) {
						return keeper.pos.inRangeTo(source.pos, 5);
					});
					if (source) {
						let path = keeper.pos.findPathTo(source.pos, { ignoreCreeps: true });
						if (path && path.length) {

							path.pop(); // last tile is the source
							path.push({ // first tile, the keeper lair, is not included in path
								x: keeper.pos.x,
								y: keeper.pos.y,
							});
							path.forEach(function(tile) {
								for (let ii = 1; ii <= 3; ++ii) {
									tilesWithRange(tile, ii, function(tile) {
										keeperTileMap[tile.x * 50 + tile.y] = true;
									});
								}
							});
						}
					}
				});

				// Create static danger map
				keeperDanger = new Uint8Array(2500);
				for (let ii in keeperTileMap) {
					keeperDanger[Number(ii)] = 0xff;
				}
			}

			// Save terrain data to Memory since it will never change
			terrainMemory = room.memory.terrain = {
				terrain: Array.prototype.slice.apply(new Uint32Array(terrain.buffer)),
				edges: edges.map(function(portals) {
					return portals.map(function(portal) {
						return portal.serialize();
					});
				}),
				structures: structureCount,
				controller: room.controller && {
					id: room.controller.id,
					pos: WorldPosition(room.controller.pos).serialize(),
				},
				sources: room.find(FIND_SOURCES).map(function(source) {
					return {
						id: source.id,
						pos: WorldPosition(source.pos).serialize(),
					};
				}),
				keeperDanger: keeperDanger && Array.prototype.slice.apply(new Uint32Array(keeperDanger.buffer)),
				keeperLairs: keeperLairs.map(function(keeperLair) {
					return {
						id: keeperLair.id,
						pos: WorldPosition(keeperLair.pos).serialize(),
					};
				}),
			};
		}
		return TerrainData.instances[roomName] = new TerrainData(terrain, edges, terrainMemory.controller, terrainMemory.sources, terrainMemory.keeperLairs);
	},

	// Stupid utility function
	set: function(terrain, xx, yy, val) {
		var index = xx * 50 + yy;
		terrain[(index / 4) | 0] = (terrain[(index / 4) | 0] & ~(0x03 << (index % 4 * 2))) | val << (index % 4 * 2);
	},
	get: function(terrain, xx, yy) {
		var index = xx * 50 + yy;
		return 0x03 & terrain[(index / 4) | 0] >> (index % 4 * 2);
	},

	// Get a list of all exits along an axis
	findExits: function(roomName, terrain, xx, yy, dx, dy) {

		// Get room name to where this portal goes
		let exitRoomName;
		try {
			let roomExits = Game.map.describeExits(roomName);
			if (xx === 49) {
				exitRoomName = roomExits[RIGHT];
			} else if (yy === 49) {
				exitRoomName = roomExits[BOTTOM];
			} else if (dx !== 0) {
				exitRoomName = roomExits[TOP];
			} else {
				exitRoomName = roomExits[LEFT];
			}
		} catch (err) {
			if (roomName !== 'sim') {
				throw err;
			}
		}

		// Search for portals in terrain
		let exits = [];
		let exit = undefined;
		let wp = WorldPosition(new RoomPosition(0, 0, roomName));
		for (var ii = 0; ii <= 50; ++ii) {
			if (ii < 50 && TerrainData.get(terrain, xx, yy) !== TerrainData.WALL) {
				if (exit === undefined) {
					exit = ii;
				}
			} else if (exit !== undefined) {
				let edge;
				if (dy) {
					edge = new WorldLine(new WorldPosition(wp.xx + xx, wp.yy + exit), 0, yy - exit - 1);
				} else {
					edge = new WorldLine(new WorldPosition(wp.xx + exit, wp.yy + yy), 1, xx - exit - 1);
				}
				exits.push(new RoomPortal(roomName, exits.length, edge, exitRoomName));
				exit = undefined;
			}
			xx += dx;
			yy += dy;
		}
		return exits;
	},
});

_.assign(TerrainData.prototype, {
	// Return the type of terrain
	look: function(xx, yy) {
		var index = xx * 50 + yy;
		return 0x03 & this.terrain[(index / 4) | 0] >> (index % 4 * 2);
	},

	poke: function(xx, yy, val) {
		TerrainData.set(this.terrain, xx, yy, val);
	},
});

//
// Maintains a map of creeps and structures in a room
function EntityData(entities) {
	this.entities = entities;
}

_.assign(EntityData, {
	FRIENDLY_CREEP: 1 << 0,
	HOSTILE_CREEP: 1 << 1,
	HOSTILE_STRUCTURE: 1 << 2,

	instances: undefined,

	factory: function(room, ignoreTask) {
		// Try to get cached entity map
		let key = room.name+ ':'+ ignoreTask;
		var instances = EntityData.instances[key];
		if (instances) {
			return instances;
		}

		// Build from scratch
		var entities = new Uint8Array(50 * 50 / 2);
		room.find(FIND_CREEPS).forEach(function(creep) {
			var index = creep.pos.x * 50 + creep.pos.y;
			if (!creep.my) {
				entities[(index / 2) | 0] |= EntityData.HOSTILE_CREEP << (index % 2 * 4);
			} else if (!ignoreTask || creep.name.charAt(0) !== ignoreTask) {
				entities[(index / 2) | 0] |= EntityData.FRIENDLY_CREEP << (index % 2 * 4);
			}
		});
		let my = room.controller && room.controller.my;
		!my && room.find(FIND_STRUCTURES).forEach(function(structure) {
			if (structure.structureType !== STRUCTURE_ROAD) {
				var index = structure.pos.x * 50 + structure.pos.y;
				entities[(index / 2) | 0] |= EntityData.HOSTILE_STRUCTURE << (index % 2 * 4);
			}
		});

		return EntityData.instances[key] = new EntityData(entities);
	},

	set: function(entities, xx, yy, val) {
		var index = xx * 50 + yy;
		entities[(index / 2) | 0] = (entities[(index / 2) | 0] & ~(0x0f << (index % 2 * 4))) | val << (index % 2 * 4);
	},
});

_.assign(EntityData.prototype, {
	// Return a bitmask of entities
	look: function(xx, yy) {
		var index = xx * 50 + yy;
		return 0x0f & this.entities[(index / 2) | 0] >> (index % 2 * 4);
	},

	poke: function(xx, yy, val) {
		EntityData.set(this.entities, xx, yy, val);
	},
});

//
// Map of total damage which can be inflicted to us by hostile creeps
function DangerData(danger, max) {
	this.danger = danger;
	this.max = max;
}

function checkMovement(pos, damage, range, terrain, ramparts) {
	let x1 = Math.min(Math.max(pos.x - 1, damage.x - range), damage.x + range);
	let x2 = Math.max(Math.min(pos.x + 1, damage.x + range), damage.x - range);
	let y1 = Math.min(Math.max(pos.y - 1, damage.y - range), damage.y + range);
	let y2 = Math.max(Math.min(pos.y + 1, damage.y + range), damage.y - range);
	for (let xx = x1; xx <= x2; ++xx) {
		for (let yy = y1; yy <= y2; ++yy) {
			if (
				terrain.look(xx, yy) !== TerrainData.WALL &&
				ramparts[xx * 50 + yy] === undefined
			) {
				return true;
			}
		}
	}
	return false;
}

function tilesWithRange(pos, range, fn) {
	if (!range) {
		return fn(pos);
	}
	var count = range * 8;
	var tick = count / 4;
	var xx = pos.x - range, yy = pos.y - range;
	var dx, dy;
	for (var ii = 0; ii < count; ++ii) {
		if (!(ii % tick)) {
			switch (ii / tick) {
				case 0:
					dx = 1;
					dy = 0;
					break;
				case 1:
					dx = 0;
					dy = 1;
					break;
				case 2:
					dx = -1;
					dy = 0;
					break;
				case 3:
					dx = 0;
					dy = -1;
					break;
			}
		}
		xx += dx;
		yy += dy;
		if (xx > 0 && xx < 50 && yy > 0 && yy < 50) {
			if (fn(new RoomPosition(xx, yy, pos.roomName)) === false) {
				return false;
			}
		}
	}
}


_.assign(DangerData, {
	instances: undefined,

	factory: function(roomName) {

		// Check for cached instances
		let instance = DangerData.instances[roomName];
		if (instance !== undefined) {
			return instance || undefined;
		}

		let room = Game.rooms[roomName];
		if (room !== undefined) {

			// If we can see the room we know the actual danger
			let danger = new Uint16Array(50 * 50);
			let sources;
			let max = 0;
			let terrainData, rampartMap;
			room.find(FIND_HOSTILE_CREEPS).forEach(function(enemy) {
				// Break early for non-aggressive creeps
				let ranged = enemy.getActiveBodyparts(RANGED_ATTACK);
				let attack = enemy.getActiveBodyparts(ATTACK);
				if (ranged === 0 && attack === 0) {
					return;
				}

				// The source keeper doesn't move if it's next to a source
				let mayMove = !enemy.fatigue;
				if (mayMove && enemy.owner.username === 'Source Keeper') {
					if (!sources) {
						sources = room.find(FIND_SOURCES);
					}
					mayMove = !sources.some(function(source) {
						return enemy.pos.isNearTo(source.pos);
					});
				}

				// Load up data for movement checks
				if (mayMove) {
					if (terrainData === undefined) {
						terrainData = TerrainData.factory(roomName);
						rampartMap = Object.create(null);
						room.find(FIND_MY_STRUCTURES).forEach(function(structure) {
							rampartMap[structure.pos.x * 50 + structure.pos.y] = true;
						});
					}
				}

				// Account for ranged attackers
				if (ranged !== 0) {
					for (let ii = mayMove ? 4 : 3; ii >= 1; --ii) {
						tilesWithRange(enemy.pos, ii, function(tile) {
							let bonus = ii === 1 ? 1 : 0; // Try to avoid ranged mass attack
							if (ii <= 3 || checkMovement(enemy.pos, tile, 3, terrainData, rampartMap)) {
								let damage = danger[tile.x * 50 + tile.y] + ranged * RANGED_ATTACK_POWER + bonus;
								danger[tile.x * 50 + tile.y] = damage;
								if (damage > max) {
									max = damage;
								}
							}
						});
					}
				}

				// Account for melee attackers
				if (attack !== 0) {
					for (var ii = mayMove ? 2 : 1; ii >= 1; --ii) {
						tilesWithRange(enemy.pos, ii, function(tile) {
							if (ii === 1 || checkMovement(enemy.pos, tile, 1, terrainData, rampartMap)) {
								let damage = danger[tile.x * 50 + tile.y] + attack * ATTACK_POWER;
								danger[tile.x * 50 + tile.y] = damage;
								if (damage > max) {
									max = damage;
								}
							}
						});
					}
				}
			});

			// Create danger on keeper lairs that are about to spawn
			room.find(FIND_HOSTILE_STRUCTURES).forEach(function(structure) {
				if (structure.owner.username === 'Source Keeper' && structure.ticksToSpawn && structure.ticksToSpawn < 25) {
					if (!sources) {
						sources = room.find(FIND_SOURCES);
					}
					let source = _.find(sources, function(source) {
						return structure.pos.inRangeTo(source.pos, 5);
					});
					let path = structure.pos.findPathTo(source.pos, { ignoreCreeps: true });
					if (path && path.length) {

						path.pop(); // last tile is the source
						path.push({ // first tile, the keeper lair, is not included in path
							x: structure.pos.x,
							y: structure.pos.y,
						});
						let keeperTileMap = {};
						path.forEach(function(tile) {
							for (let ii = 1; ii <= 3; ++ii) {
								tilesWithRange(tile, ii, function(tile) {
									keeperTileMap[tile.x * 50 + tile.y] = true;
								});
							}
						});
						for (let ii in keeperTileMap) {
							let damage = danger[Number(ii)] + ATTACK_POWER * 10 + RANGED_ATTACK_POWER + 10;
							danger[Number(ii)] = damage;
							if (damage > max) {
								max = damage;
							}
						}
					}
				}
			});

			// Zero out ramparts, those are always safe
			room.find(FIND_MY_STRUCTURES).forEach(function(structure) {
				if (structure.structureType === STRUCTURE_RAMPART) {
					danger[structure.pos.x * 50 + structure.pos.y] = 0;
				}
			});

			// Memoize instances
			if (max) {
				return DangerData.instances[roomName] = new DangerData(danger, max);
			} else {
				return (DangerData.instances[roomName] = false) || undefined;
			}
		} else {

			// Otherwise we have to use static data about only the keepers
			let terrainMemory = Memory.rooms[roomName] && Memory.rooms[roomName].terrain;
			if (terrainMemory && terrainMemory.keeperDanger) {
				let danger = new Uint8Array(new Uint32Array(terrainMemory.keeperDanger).buffer);
				return DangerData.instances[roomName] = new DangerData(danger, 0xff);
			}
		}
	},

	// Convenience method
	checkDanger: function(pos) {

		// If this is a border position we need to check both sides (maybe only the other side?)
		let borderPos = pos.getPositionInNextRoom();
		if (borderPos) {
			let dangerData = DangerData.factory(borderPos.getRoomName());
			if (dangerData) {
				let look = dangerData.look(borderPos.xx % 50, borderPos.yy % 50);
				if (look) {
					return look;
				}
			}
		}

		let dangerData = DangerData.factory(pos.getRoomName());
		if (dangerData) {
			return dangerData.look(pos.xx % 50, pos.yy % 50);
		}
	},
});

_.assign(DangerData.prototype, {
	look: function(xx, yy) {
		let danger = Math.ceil((this.danger[xx * 50 + yy] / this.max) * 10);
		return danger ? danger + 25 : 0;
	},
});

//
// Map of obstacles which should be destroyed
function DestructionData(hits, max) {
	this.hits = hits;
	this.max = max;
}

_.assign(DestructionData, {
	instances: undefined,
	kMaxHits: Math.max(WALL_HITS_MAX, RAMPART_HITS_MAX[8]),

	factory: function(room) {

		// Check for cached instances
		let instance = DestructionData.instances[room.name];
		if (instance) {
			return instance;
		}

		// Calculate structure obstacles
		let hits = new Uint8Array(50 * 50);
		let hitAdjustment = DestructionData.kMaxHits / 0xffff;
		let max = 1;
		room.find(FIND_HOSTILE_CREEPS).forEach(function(enemy) {
			let adjustedHits = Math.min(0xffff, Math.ceil(enemy.hits / hitAdjustment));
			hits[enemy.pos.x * 50 + enemy.pos.y] = adjustedHits;
			max = Math.max(max, adjustedHits);
		});
		room.find(FIND_STRUCTURES).forEach(function(structure) {
			if (structure.structureType !== STRUCTURE_KEEPER_LAIR && structure.structureType !== STRUCTURE_CONTROLLER) {
				let adjustedHits = Math.min(0xffff, Math.ceil(structure.hits / hitAdjustment));
				hits[structure.pos.x * 50 + structure.pos.y] = adjustedHits;
				max = Math.max(max, adjustedHits);
			}
		});

		// Memoize instances
		return DestructionData.instances[room.name] = new DestructionData(hits, max);
	},
});

_.assign(DestructionData.prototype, {
	look: function(xx, yy) {
		let hits = Math.ceil(this.hits[xx * 50 + yy] / this.max * 10);
		return hits ? hits + 10 : 0;
	},
});

// nb: Run this every tick if using main-loop
EntityData.instances = {};
DangerData.instances = {};
DestructionData.instances = {};

module.exports = {
	RoomPortal,
	TerrainData,
	EntityData,
	DangerData,
	DestructionData,
};
