"use strict";
// Copyright 2015, Marcel Laverdet - all rights reserved
var Heap = require('path-heap');
var OpenClosed = require('path-open-closed');
let worldLib = require('path-world');
var WorldPosition = worldLib.WorldPosition;
let WorldLine = worldLib.WorldLine;
var PathInfo = require('path-info');
var RoomData = require('path-room-data');
var RoomPortal = RoomData.RoomPortal;
var TerrainData = RoomData.TerrainData;
var EntityData = RoomData.EntityData;
var DangerData = RoomData.DangerData;
var DestructionData = RoomData.DestructionData;
var kWorldSize = WorldPosition.kWorldSize;
var planPath = require('path-plan');

//
// Cost calculation function
var currentCostContextId;
var terrainData, entityData, dangerData, destructionData;
var plainCost, swampCost, roadCost, entityBits;
var avoidCreeps;
var terrainDataInstances, entityDataInstances, dangerDataInstances, destructionDataInstances;
function switchTerrainContext(roomId) {
	if (roomId >= Math.pow(kWorldSize * 2, 2) + 1) {
		return false;
	}
	var roomIndex = reverseRooms[roomId];
	if (roomIndex === 0) {
		return false;
	}
	terrainData = terrainDataInstances[roomIndex - 1];
	entityData = entityDataInstances[roomIndex - 1];
	dangerData = dangerDataInstances[roomIndex - 1];
	destructionData = destructionDataInstances[roomIndex - 1];
	currentCostContextId = roomId;
}

function look(xx, yy) {

	// Check to see if we're in the right room
	let roomId = Math.floor(xx / 50) * kWorldSize * 2 + Math.floor(yy / 50);
	if (roomId !== currentCostContextId) {
		if (switchTerrainContext(roomId) === false) {
			return Infinity;
		}
	}

	// Calculate cost
	let lx = xx % 50, ly = yy % 50;
	let cost;
	switch (terrainData.look(lx, ly)) {
		case TerrainData.PLAIN:
			cost = plainCost;
			break;
		case TerrainData.WALL:
			return Infinity;
		case TerrainData.SWAMP:
			cost = swampCost;
			break;
		case TerrainData.ROAD:
			cost = roadCost;
			break;
	}
	if (entityData !== undefined) {
		let bits = entityData.look(lx, ly);
		if (avoidCreeps && (bits & EntityData.FRIENDLY_CREEP || bits & EntityData.HOSTILE_CREEP)) {
			cost += 10;
		} else if (entityBits & entityData.look(lx, ly)) {
			return Infinity;
		}
	}

	if (dangerData !== undefined) {
		cost += dangerData.look(lx, ly);
	}
	if (destructionData !== undefined) {
		cost += destructionData.look(lx, ly);
	}

	if (lx === 0 || lx === 49 || ly === 0 || ly === 49) {
		// Special for portal tiles to prevent JPS from jumping into rooms without the proper portal
		// checks
		return cost + 1;
	}

	return cost;
}

//
// Lots of crazy unrolled JPS stuff
function jumpX(cost, xx, yy, dx) {
	let tmp = look(xx, yy + 1);
	let prevIteration = (tmp !== cost ? 0x01 : 0) | (tmp === Infinity ? 0x02 : 0);
	tmp = look(xx, yy - 1);
	prevIteration |= (tmp !== cost ? 0x04 : 0) | (tmp === Infinity ? 0x08 : 0);
	while (true) {
		let jumpCost = look(xx, yy);
		if (jumpCost === Infinity) {
			return;
		} else if (jumpCost !== cost) {
			return new WorldPosition(xx - dx, yy);
		} else if (checkDestination(xx, yy)) {
			return new WorldPosition(xx, yy);
		}

		let tmp = look(xx + dx, yy + 1);
		let thisIteration = (tmp !== cost ? 0 : 0x01) | (tmp === Infinity ? 0 : 0x02);
		if (prevIteration & thisIteration) {
			return new WorldPosition(xx, yy);
		}
		tmp = look(xx + dx, yy - 1);
		thisIteration |= (tmp !== cost ? 0 : 0x04) | (tmp === Infinity ? 0 : 0x08);
		if (prevIteration & thisIteration) {
			return new WorldPosition(xx, yy);
		}
		prevIteration = ~thisIteration;
		xx += dx;
	}
}

function jumpY(cost, xx, yy, dy) {
	let tmp = look(xx + 1, yy);
	let prevIteration = (tmp !== cost ? 0x01 : 0) | (tmp === Infinity ? 0x02 : 0);
	tmp = look(xx - 1, yy);
	prevIteration |= (tmp !== cost ? 0x04 : 0) | (tmp === Infinity ? 0x08 : 0);
	while (true) {
		let jumpCost = look(xx, yy);
		if (jumpCost === Infinity) {
			return;
		} else if (jumpCost !== cost) {
			return new WorldPosition(xx, yy - dy);
		} else if (checkDestination(xx, yy)) {
			return new WorldPosition(xx, yy);
		}

		tmp = look(xx + 1, yy + dy);
		let thisIteration = (tmp !== cost ? 0 : 0x01) | (tmp === Infinity ? 0 : 0x02);
		if (prevIteration & thisIteration) {
			return new WorldPosition(xx, yy);
		}
		tmp = look(xx - 1, yy + dy);
		thisIteration |= (tmp !== cost ? 0 : 0x04) | (tmp === Infinity ? 0 : 0x08);
		if (prevIteration & thisIteration) {
			return new WorldPosition(xx, yy);
		}
		prevIteration = ~thisIteration;
		yy += dy;
	}
}

function jumpXY(cost, xx, yy, dx, dy) {
	let jumpCost = look(xx, yy);
	if (jumpCost === Infinity) {
		return;
	} else if (jumpCost !== cost || checkDestination(xx, yy)) {
		return new WorldPosition(xx, yy);
	}

	while (true) {

		// Check diagonal neighbors
		let lookX = look(xx + dx, yy - dy);
		let lookY = look(xx - dx, yy + dy);
		let prevIterationX = lookX !== cost ? 0x01 : 0;
		let prevIterationY = lookY !== cost ? 0x01 : 0;
		if (checkDestination(xx + dx, yy - dy) || checkDestination(xx - dx, yy + dy)) {
			return new WorldPosition(xx, yy);
		}
		if (
			(prevIterationY === 0 && look(xx - dx, yy) !== cost) ||
			(prevIterationX === 0 && look(xx, yy - dy) !== cost)
		) {
			return new WorldPosition(xx, yy);
		}

		// Unrolled horizontal check, reusing look()'s from above
		let xx2 = xx + dx;
		// Except this part, this is preventing an extra look() at each iteration of the main loop
		jumpCost = look(xx2, yy + dy);
		prevIterationX |= (jumpCost !== cost ? 0x04 : 0) | (jumpCost === Infinity ? 0x08 : 0);
		while (true) {
			let jumpCost2 = look(xx2, yy);
			if (jumpCost2 === Infinity) {
				break;
			} else if (jumpCost2 !== cost || checkDestination(xx2, yy)) {
				return new WorldPosition(xx, yy);
			}

			let tmp = look(xx2 + dx, yy - dy);
			let thisIteration = (tmp !== cost ? 0 : 0x01) | (tmp === Infinity ? 0 : 0x02);
			if (prevIterationX & thisIteration) {
				return new WorldPosition(xx, yy);
			}
			tmp = look(xx2 + dx, yy + dy);
			thisIteration |= (tmp !== cost ? 0 : 0x04) | (tmp === Infinity ? 0 : 0x08);
			if (prevIterationX & thisIteration) {
				return new WorldPosition(xx, yy);
			}
			prevIterationX = ~thisIteration;
			xx2 += dx;
		}

		// Unrolled vertical check, reusing look()'s from above
		let yy2 = yy + dy;
		prevIterationY |= (jumpCost !== cost ? 0x04 : 0) | (jumpCost === Infinity ? 0x08 : 0);
		while (true) {
			let jumpCost2 = look(xx, yy2);
			if (jumpCost2 === Infinity) {
				break;
			} else if (jumpCost2 !== cost || checkDestination(xx, yy2)) {
				return new WorldPosition(xx, yy);
			}

			let tmp = look(xx - dx, yy2 + dy);
			let thisIteration = (tmp !== cost ? 0 : 0x01) | (tmp === Infinity ? 0 : 0x02);
			if (prevIterationY & thisIteration) {
				return new WorldPosition(xx, yy);
			}
			tmp = look(xx + dx, yy2 + dy);
			thisIteration |= (tmp !== cost ? 0 : 0x04) | (tmp === Infinity ? 0 : 0x08);
			if (prevIterationY & thisIteration) {
				return new WorldPosition(xx, yy);
			}
			prevIterationY = ~thisIteration;
			yy2 += dy;
		}
		xx += dx;
		yy += dy;

		// jumpCost was calculated in the horizontal check
		if (jumpCost === Infinity) {
			return;
		} else if (jumpCost !== cost || checkDestination(xx, yy)) {
			return new WorldPosition(xx, yy);
		}
	}
}

function jump(cost, xx, yy, dx, dy) {
	if (dx !== 0) {
		if (dy !== 0) {
			return jumpXY(cost, xx, yy, dx, dy);
		} else {
			return jumpX(cost, xx, yy, dx);
		}
	} else {
		return jumpY(cost, xx, yy, dy);
	}
}

//
// Handles converting WorldPositions back and forth from heap indexes
function indexFromPos(pos) {
	var roomId = Math.floor(pos.xx / 50) * kWorldSize * 2 + Math.floor(pos.yy / 50);
	var roomIndex = reverseRooms[roomId];
	if (roomIndex === 0) {
		throw new Error('Honk');
	} else {
		roomIndex = reverseRooms[roomId];
	}
	return (roomIndex - 1) * 50 * 50 + pos.xx % 50 * 50 + pos.yy % 50;
}

function posFromIndex(index) {
	var roomIndex = Math.floor(index / (50 * 50));
	var roomId = rooms[roomIndex];
	var coord = index - roomIndex * 50 * 50;
	return new WorldPosition(Math.floor(coord / 50) + Math.floor(roomId / (kWorldSize * 2)) * 50, coord % 50 + roomId % (kWorldSize * 2) * 50);
}

//
// JPS helper function
function jumpNeighbor(pos, index, nx, ny, parentGCost, cost, neighborCost) {
	let fcost, neighborIndex, neighbor;
	if (neighborCost !== cost) {
		if (neighborCost === Infinity) {
			return;
		}
		neighbor = new WorldPosition(nx, ny);
		neighborIndex = indexFromPos(neighbor);
		fcost = parentGCost + neighborCost + heuristic(neighbor.xx, neighbor.yy);
	} else {
		neighbor = jump(neighborCost, nx, ny, nx - pos.xx, ny - pos.yy);
		if (!neighbor) {
			return;
		}
		neighborIndex = indexFromPos(neighbor);
		fcost = parentGCost + neighborCost * (pos.getRangeTo(neighbor) - 1) + look(neighbor.xx, neighbor.yy) + heuristic(neighbor.xx, neighbor.yy);
	}

	// Add open nodes to the heap
	let isOpen = openClosed.get(neighborIndex);
	if (isOpen === true) {
		if (heap.costs[neighborIndex] > fcost) {
			//console.log('update', String(neighbor), 'g('+ (fcost - heuristic(neighbor.xx, neighbor.yy))+ ') + h('+ heuristic(neighbor.xx, neighbor.yy)+ ') = f('+ fcost+ ')');
			heap.update(neighborIndex, fcost);
			parents[neighborIndex] = index;
		}
	} else if (isOpen === undefined) {
		openClosed.open(neighborIndex);
		//console.log('add', String(neighbor), 'g('+ (fcost - heuristic(neighbor.xx, neighbor.yy))+ ') + h('+ heuristic(neighbor.xx, neighbor.yy)+ ') = f('+ fcost+ ')');
		heap.add(neighborIndex, fcost);
		parents[neighborIndex] = index;
	}
}

//
// Distance & destination functions
let heuristicContextId, heuristicFn, destinationFn;
let heuristicWeight;
function switchHeuristicContext(roomId) {

	// Switch context
	if (roomId >= Math.pow(kWorldSize * 2, 2) + 1) {
		return false;
	}
	let roomIndex = reverseRooms[roomId];
	if (roomIndex === 0) {
		return false;
	}
	let plan = roomPlan[roomIndex - 1];
	if (plan.portal === undefined) {
		if (plan.targets.length === 1) {
			if (targetFlee) {
				heuristicFn = 4;
				destinationFn = checkDestinationFlee;
			} else if (targetRange) {
				heuristicFn = 1;
				destinationFn = checkDestinatonRange;
			} else {
				heuristicFn = 1;
				destinationFn = checkDestinationSingle;
			}
		} else {
			heuristicFn = 2;
			destinationFn = checkDestinationMulti;
		}
	} else {
		portal = plan.portal;
		portalHeuristic = plan.heuristic;
		hoffset = plan.hoffset;
		heuristicFn = 3;
		if (plan.hoffset === 0) {
			destinationFn = checkDestinationHeuristic;
		} else {
			destinationFn = checkDestinationFalse;
		}
	}
	heuristicContextId = roomId;
}

function heuristic(xx, yy) {
	let roomId = Math.floor(xx / 50) * kWorldSize * 2 + Math.floor(yy / 50);
	if (heuristicContextId !== roomId) {
		if (switchHeuristicContext(roomId) === false) {
			return Infinity;
		}
	}
	switch (heuristicFn) {
		case 1:
			return Math.floor(heuristicSingle(xx, yy, target) * heuristicWeight);
		case 2:
			return Math.floor(heuristicMulti(xx, yy) * heuristicWeight);
		case 3:
			return Math.floor(heuristicPortal(xx, yy) * heuristicWeight);
		case 4:
			return Math.floor(heuristicFlee(xx, yy) * heuristicWeight);
	}
}

function checkDestination(xx, yy) {
	let roomId = Math.floor(xx / 50) * kWorldSize * 2 + Math.floor(yy / 50);
	if (heuristicContextId !== roomId) {
		if (switchHeuristicContext(roomId) === false) {
			return false;
		}
	}
	return destinationFn(xx, yy);
}

// Distance to single in same room
var target;
function heuristicSingle(xx, yy, target) {
	return Math.max(Math.abs(target.xx - xx), Math.abs(target.yy - yy));
}
function checkDestinationSingle(xx, yy) {
	return target.xx === xx && target.yy === yy;
}

// Distance to multiple targets in same room
function heuristicMulti(xx, yy) {
	let min = Infinity;
	for (let tt of target) {
		min = Math.min(min, heuristicSingle(xx, yy, tt));
	}
	return min;
}
function checkDestinationMulti(xx, yy) {
	for (var ii = 0; ii < target.length; ++ii) {
		if (target[ii].xx === xx && target[ii].yy === yy) {
			return true;
		}
	}
	return false;
}

// Distance to desired portal
var portal, portalHeuristic, hoffset;
function heuristicPortal(xx, yy) {
	if (portalHeuristic instanceof WorldPosition) {
		return hoffset + Math.max(Math.abs(portalHeuristic.xx - xx), Math.abs(portalHeuristic.yy - yy));
	} else {
		return hoffset + portalHeuristic.getRangeTo(new WorldPosition(xx, yy));
	}
}
function checkDestinationFalse() {
	return false;
}
function checkDestinationHeuristic(xx, yy) {
	return heuristic(xx, yy) === 0;
}

// Check destination in range
var targetRange;
function checkDestinatonRange(xx, yy) {
	return targetRange >= Math.max(Math.abs(target.xx - xx), Math.abs(target.yy - yy));
}

// Distance + destination for flee
var targetFlee;
function heuristicFlee(xx, yy) {
	return Math.min(0, targetFlee - Math.max(Math.abs(target.xx - xx), Math.abs(target.yy - yy)));
}
function checkDestinationFlee(xx, yy) {
	return Math.max(Math.abs(target.xx - xx), Math.abs(target.yy - yy)) >= targetFlee;
}

//
// Simple utility used while reconstructing paths
function checkRoadAndSwamp(pos, ii, roads, swamps) {
	let roomId = Math.floor(pos.xx / 50) * kWorldSize * 2 + Math.floor(pos.yy / 50);
	if (roomId !== currentCostContextId) {
		if (switchTerrainContext(roomId) === false) {
			return;
		}
	}
	switch (terrainData.look(pos.xx % 50, pos.yy % 50)) {
		case TerrainData.ROAD:
			roads.push(ii);
			break;
		case TerrainData.SWAMP:
			swamps.push(ii);
			break;
	}
}

// Data structures for the search
var heap, openClosed;
var parents = new Uint16Array(2500);
var rooms = new Uint16Array(15);
var reverseRooms = new Uint8Array(Math.pow(kWorldSize * 2, 2) + 1);
var roomPlan;

//
// Here it is.
function find(start, options) {

	// Sanity check
	if (!(start instanceof WorldPosition)) {
		throw new Error('Must use WorldPosition in pathfinder');
	}

	// Build a high-level plan of rooms to search
	let targets = options.targets ? options.targets : [ options.target ];
	targetFlee = options.flee;
	targetRange = options.range;
	let maxCost = options.maxCost || 1000;
	if (!options.flee) {
		roomPlan = planPath(start, targets, parents, options);
		if (!roomPlan) {
			return;
		}
	} else {
		if (targets.length !== 1) {
			throw new Error('Can\'t flee or range from multiple targets');
		}
		roomPlan = [ {
			targets: targets,
			position: start,
			roomName: start.getRoomName(),
		} ];
	}

	// Initialize heap and open/close list
	heap = new Heap(roomPlan.length * 2500);
	openClosed = new OpenClosed(roomPlan.length * 2500);
	if (parents.length < roomPlan.length * 2500) {
		parents = new Uint16Array(roomPlan.length * 2500);
	}

	// Initialize cost functions
	currentCostContextId = -1;
	heuristicContextId = -1;
	avoidCreeps = Boolean(options.avoidCreeps);
	entityBits = (
		((options.ignoreCreeps || avoidCreeps) ? 0 : EntityData.FRIENDLY_CREEP | EntityData.HOSTILE_CREEP) |
		((options.ignoreHostileStructures || options.destructive) ? 0 : EntityData.HOSTILE_STRUCTURE)
	);
	if (options.weightRatio <= 0.2) {
		roadCost = 2;
		plainCost = 1;
		swampCost = 1;
	} else if (options.weightRatio > 1) {
		roadCost = 1;
		plainCost = 2;
		swampCost = 10;
	} else {
		roadCost = 2;
		plainCost = 1;
		swampCost = 5;
	}
	if (options.roadCost) {
		roadCost = options.roadCost;
	}
	if (options.swampCost) {
		swampCost = options.swampCost;
	}
	if (options.plainCost) {
		plainCost = options.plainCost;
	}
	terrainDataInstances = new Array(roomPlan.length);
	entityDataInstances = new Array(roomPlan.length);
	dangerDataInstances = new Array(roomPlan.length);
	destructionDataInstances = new Array(roomPlan.length);
	target = undefined;
	roomPlan.forEach(function(plan, ii) {
		let pos = plan.position || (plan.heuristic instanceof WorldLine ? plan.heuristic.pos : plan.heuristic);
		if (plan.targets) {
			if (plan.targets.length === 1) {
				target = plan.targets[0];
			} else {
				target = plan.targets;
			}
		}
		let roomId = Math.floor(pos.xx / 50) * kWorldSize * 2 + Math.floor(pos.yy / 50);
		rooms[ii] = roomId;
		reverseRooms[roomId] = ii + 1;
		terrainDataInstances[ii] = TerrainData.factory(plan.roomName);
		if (options.safe) {
			dangerDataInstances[ii] = DangerData.factory(plan.roomName);
		}
		if (ii === roomPlan.length - 1) {
			// Don't bother with extra data if it's not the current room
			let room = Game.rooms[plan.roomName];
			if (room) {
				if (entityBits) {
					entityDataInstances[ii] = EntityData.factory(room, options.ignoreTask);
				}
				if (options.destructive) {
					destructionDataInstances[ii] = DestructionData.factory(room);
				}
			}
		}
	});

	// Other stuff
	var opsRemaining;
	if (options.maxOps) {
		opsRemaining = options.maxOps;
	} else {
		opsRemaining = Math.min(1000, heuristic(start.xx, start.yy) * 200);
	}
	opsRemaining = options.maxOps || 1000;
	var minNodeCost = Infinity;
	var minNode;
	heuristicWeight = Math.min(roadCost, plainCost, swampCost) * 1.2;

	// Make sure destination tiles are walkable. This also inializes `indexFromPos` via `look`
	let alteredData = [];
	!options.skipWalkable && !options.flee && target && (Array.isArray(target) ? target : [ target ]).forEach(function(target) {
		if (look(target.xx, target.yy) === Infinity) {
			let xx = target.xx % 50, yy = target.yy % 50;
			let tmp = terrainData.look(xx, yy);
			if (tmp === TerrainData.WALL) {
				alteredData.push([ terrainData, xx, yy, tmp ]);
				terrainData.poke(xx, yy, TerrainData.PLAIN);
			}
			if (entityData) {
				tmp = entityData.look(xx, yy);
				if (tmp & entityBits) {
					alteredData.push([ entityData, xx, yy, tmp ]);
					entityData.poke(xx, yy, 0);
				}
			}
		}
	});

	// Mark unwalkable tiles
	if (options.avoid) {
		options.avoid.forEach(function(pos) {
			let tmp = look(pos.xx, pos.yy);
			alteredData.push([ terrainData, pos.xx % 50, pos.yy % 50, tmp ]);
			terrainData.poke(pos.xx % 50, pos.yy % 50, TerrainData.WALL);
		});
	}

	// First iteration of A* done upfront w/ no JPS
	var index = indexFromPos(start);
	openClosed.close(index);
	// heap.add(index, heuristic(start.xx, start.yy)); (uncomment for basic A*)
	for (var dir = 1; dir <= 8; ++dir) {
		var neighbor = start.getPositionInDirection(dir);

		// Check for portal nodes on start
		if (start.xx % 50 === 49) {
			if (neighbor.xx % 50 === 0 && start.yy !== neighbor.yy) {
				continue;
			}
		} else if (start.xx % 50 === 0) {
			if (neighbor.xx % 50 === 49 && start.yy !== neighbor.yy) {
				continue;
			}
		} else if (start.yy % 50 === 49) {
			if (neighbor.yy % 50 === 0 && start.xx !== neighbor.xx) {
				continue;
			}
		} else if (start.yy % 50 === 0) {
			if (neighbor.yy % 50 === 49 && start.xx !== neighbor.xx) {
				continue;
			}
		}

		// Add all neighbors to heap
		var cost = look(neighbor.xx, neighbor.yy);
		if (cost === Infinity) {
			continue;
		}
		var neighborIndex = indexFromPos(neighbor);
		heap.add(neighborIndex, cost + heuristic(neighbor.xx, neighbor.yy));
		openClosed.open(neighborIndex);
		parents[neighborIndex] = index;
	}

	// Begin JPS A*
	let lastRoomIndex = undefined;
	while (heap.length() && --opsRemaining) {
		++global.pf;

		// Pull cheapest open node off the (c)heap
		var index = heap.min();
		var fcost = heap.minCost();
		if (fcost > maxCost) {
			break;
		}

		// Close this node
		heap.remove()
		openClosed.close(index);

		// Calculate costs
		var pos = posFromIndex(index);
		var hcost = heuristic(pos.xx, pos.yy);
		var gcost = fcost - hcost;
		var cost = look(pos.xx, pos.yy);
		// console.log(String(pos), 'g('+ gcost+ ') + h('+ hcost+ ') = f('+ fcost+ ')');

		// New room? Throw away the heap
		let roomIndex = Math.floor(index / (50 * 50));
		if (lastRoomIndex === undefined) {
			lastRoomIndex = roomIndex;
		} else if (lastRoomIndex > roomIndex) {
			heap.release();
			heap = new Heap(roomPlan.length * 2500);
			lastRoomIndex = roomIndex;
		}

		// Reached destination?
		if (checkDestination(pos.xx, pos.yy, true)) {
			minNode = index;
			minNodeCost = 0;
			break;
		} else if (hcost < minNodeCost) {
			minNodeCost = hcost;
			minNode = index;
		}

		// Check for special room portal rules
		let borderNeighbors;
		let parent = posFromIndex(parents[index]);
		let dx = pos.xx > parent.xx ? 1 : (pos.xx < parent.xx ? -1 : 0);
		let dy = pos.yy > parent.yy ? 1 : (pos.yy < parent.yy ? -1 : 0);
		if (pos.xx % 50 === 0) {
			if (dx === -1) {
				borderNeighbors = [ new WorldPosition(pos.xx - 1, pos.yy) ];
			} else if (dx === 1) {
				borderNeighbors = [
					new WorldPosition(pos.xx + 1, pos.yy - 1),
					new WorldPosition(pos.xx + 1, pos.yy),
					new WorldPosition(pos.xx + 1, pos.yy + 1),
				];
			}
		} else if (pos.xx % 50 === 49) {
			if (dx === 1) {
				borderNeighbors = [ new WorldPosition(pos.xx + 1, pos.yy) ];
			} else if (dx === -1) {
				borderNeighbors = [
					new WorldPosition(pos.xx - 1, pos.yy - 1),
					new WorldPosition(pos.xx - 1, pos.yy),
					new WorldPosition(pos.xx - 1, pos.yy + 1),
				];
			}
		} else if (pos.yy % 50 === 0) {
			if (dy === -1) {
				borderNeighbors = [ new WorldPosition(pos.xx, pos.yy - 1) ];
			} else if (dy === 1) {
				borderNeighbors = [
					new WorldPosition(pos.xx - 1, pos.yy + 1),
					new WorldPosition(pos.xx, pos.yy + 1),
					new WorldPosition(pos.xx + 1, pos.yy + 1),
				];
			}
		} else if (pos.yy % 50 === 49) {
			if (dy === 1) {
				borderNeighbors = [ new WorldPosition(pos.xx, pos.yy + 1) ];
			} else if (dy === -1) {
				borderNeighbors = [
					new WorldPosition(pos.xx - 1, pos.yy - 1),
					new WorldPosition(pos.xx, pos.yy - 1),
					new WorldPosition(pos.xx + 1, pos.yy - 1),
				];
			}
		}
		if (borderNeighbors) {
			for (let neighbor of borderNeighbors) {
				let ncost = look(neighbor.xx, neighbor.yy);
				if (ncost === Infinity) {
					continue;
				}
				let neighborIndex = indexFromPos(neighbor);
				let isOpen = openClosed.get(neighborIndex);
				if (isOpen === false) {
					continue;
				}
				let fcost = gcost + ncost + heuristic(neighbor.xx, neighbor.yy);
				if (isOpen === true) {
					if (heap.costs[neighborIndex] > fcost) {
						heap.update(neighborIndex, fcost);
						parents[neighborIndex] = index;
					}
				} else {
					openClosed.open(neighborIndex);
					heap.add(neighborIndex, fcost);
					parents[neighborIndex] = index;
				}
			}
			continue;
		}

		// Regular search
		if (false) {

			// Basic A*
			for (var dir = 1; dir <= 8; ++dir) {
				var neighbor = pos.getPositionInDirection(dir);
				var acost = look(neighbor.xx, neighbor.yy);
				if (acost === Infinity) {
					continue;
				}
				var neighborIndex = indexFromPos(neighbor);
				let isOpen = openClosed.get(neighborIndex);
				if (isOpen === false) {
					continue;
				}
				let ncost = gcost + acost + heuristic(neighbor.xx, neighbor.yy);
				if (isOpen === true) {
					if (heap.costs[neighborIndex] > ncost) {
						heap.update(neighborIndex, ncost);
						parents[neighborIndex] = index;
					}
				} else {
					openClosed.open(neighborIndex);
					heap.add(neighborIndex, ncost);
					parents[neighborIndex] = index;
				}
			}
		} else {

			// JPS
			var parentGCost = fcost - heuristic(pos.xx, pos.yy);
			var tmp;
			if (dx !== 0) {
				if (dy !== 0) {
					tmp = look(pos.xx, pos.yy + dy);
					if (tmp !== Infinity) {
						jumpNeighbor(pos, index, pos.xx, pos.yy + dy, parentGCost, cost, tmp);
					}
					tmp = look(pos.xx + dx, pos.yy);
					if (tmp !== Infinity) {
						jumpNeighbor(pos, index, pos.xx + dx, pos.yy, parentGCost, cost, tmp);
					}
					tmp = look(pos.xx + dx, pos.yy + dy);
					if (tmp !== Infinity) {
						jumpNeighbor(pos, index, pos.xx + dx, pos.yy + dy, parentGCost, cost, tmp);
					}
					if (look(pos.xx - dx, pos.yy) !== cost) {
						jumpNeighbor(pos, index, pos.xx - dx, pos.yy + dy, parentGCost, cost, look(pos.xx - dx, pos.yy + dy));
					}
					if (look(pos.xx, pos.yy - dy) !== cost) {
						jumpNeighbor(pos, index, pos.xx + dx, pos.yy - dy, parentGCost, cost, look(pos.xx + dx, pos.yy - dy));
					}
				} else {
					tmp = look(pos.xx + dx, pos.yy);
					if (tmp !== Infinity) {
						jumpNeighbor(pos, index, pos.xx + dx, pos.yy, parentGCost, cost, tmp);
					}
					if (look(pos.xx, pos.yy + 1) !== cost) {
						jumpNeighbor(pos, index, pos.xx + dx, pos.yy + 1, parentGCost, cost, look(pos.xx + dx, pos.yy + 1));
					}
					if (look(pos.xx, pos.yy - 1) !== cost) {
						jumpNeighbor(pos, index, pos.xx + dx, pos.yy - 1, parentGCost, cost, look(pos.xx + dx, pos.yy - 1));
					}
				}
			} else {
				tmp = look(pos.xx, pos.yy + dy);
				if (tmp !== Infinity) {
					jumpNeighbor(pos, index, pos.xx, pos.yy + dy, parentGCost, cost, tmp);
				}
				if (look(pos.xx + 1, pos.yy) !== cost) {
					jumpNeighbor(pos, index, pos.xx + 1, pos.yy + dy, parentGCost, cost, look(pos.xx + 1, pos.yy + dy));
				}
				if (look(pos.xx - 1, pos.yy) !== cost) {
					jumpNeighbor(pos, index, pos.xx - 1, pos.yy + dy, parentGCost, cost, look(pos.xx - 1, pos.yy + dy));
				}
			}
		}
	}

	// Reconstruct path from A* graph
	let ret;
	if (minNode && (minNodeCost === 0 || !options.strict)) {
		let index = minNode;
		let pos = posFromIndex(index);
		let ii = 0;
		let path = [], roads = [], swamps = [];
		while (!pos.isEqualTo(start)) {
			path.push(pos);
			checkRoadAndSwamp(pos, ii++, roads, swamps);
			index = parents[index];
			var next = posFromIndex(index);
			if (!next.isNearTo(pos)) {
				var dir = pos.getDirectionTo(next);
				do {
					pos = pos.getPositionInDirection(dir);
					path.push(pos);
					checkRoadAndSwamp(pos, ii++, roads, swamps);
				} while (!pos.isNearTo(next));
			}
			pos = next;
		}
		ret = new PathInfo(path, swamps, roads);
		ret.reverse();
	} else {
		ret = false;
	}

	// Cleanup
	alteredData.forEach(function(data) {
		data[0].poke(data[1], data[2], data[3]);
	});
	for (let ii = 0; ii < roomPlan.length; ++ii) {
		reverseRooms[rooms[ii]] = 0;
	}

	// TODO: This is a hack which clears out the reverse room lookup table every time you search for a
	// path. This shouldn't be needed because the above loop clears it out, but very rarely it doesn't
	// work and causes weird errors on the next path search. I have no idea why!
	reverseRooms = new Uint8Array(Math.pow(kWorldSize * 2, 2) + 1);

	heap.release();
	openClosed.release();
	return ret;
}

//
// Find the cheapest path to a number of targets and return the target & path
function findNearest(start, targets, options) {
	options = options || {};
	options.strict = true;
	var positions = options.positions || targets.map(function(target) {
		return WorldPosition(target.pos);
	});
	options.targets = positions;
	var path = find(start, options);
	if (!path) {
		return;
	}
	var pos = path.path[path.length - 1];
	var ii = _.findIndex(positions, function(targetPosition) {
		return pos.isEqualTo(targetPosition);
	});
	return targets[ii] && {
		target: targets[ii],
		index: ii,
		path: path,
	};
}

module.exports = {
	WorldPosition: WorldPosition,
	PathInfo: PathInfo,
	find: find,
	findNearest: findNearest,
	TerrainData: TerrainData,
	EntityData: EntityData,
	DangerData: DangerData,
	DestructionData: DestructionData,
};
