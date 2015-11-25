"use strict";
let Heap = require('path-heap');
let OpenClosed = require('path-open-closed');
let worldLib = require('path-world');
let WorldPosition = worldLib.WorldPosition;
let WorldLine = worldLib.WorldLine;
let RoomData = require('path-room-data');
let RoomPortal = RoomData.RoomPortal;
let TerrainData = RoomData.TerrainData;

let openClosed, heap;
let indexSize, indexMap, reverseIndexMap;
const kHighwayDiscount = 0.5;

// Converts from WorldPosition or RoomPortal to indexes used in A*
function indexFromEntity(entity) {
	let index = reverseIndexMap.get(entity);
	if (index === undefined) {
		index = ++indexSize;
		reverseIndexMap.set(entity, index);
		indexMap[index] = entity;
	}
	return index;
}

function entityFromIndex(index) {
	return indexMap[index];
}

// Guesses how far a position is to the closest target
function heuristic(position, targets) {
	if (position instanceof WorldPosition) {
		let min = Infinity;
		for (let target of targets) {
			min = Math.min(min, position.getRangeTo(target));
		}
		return min;
	} else if (position instanceof WorldLine) {
		// Heuristic should be the same for all points on the line
		return heuristic(position.pos, targets);
	} else if (position instanceof RoomPortal) {
		let min = Infinity;
		for (let target of targets) {
			min = Math.min(min, position.edge.getRangeTo(target));
		}
		return min;
	} else {
		throw new Error('I don\'t know what this is');
	}
}

function calculateExitPosition(portal, start, targets) {
	if (start instanceof WorldPosition) {
		// There's probably a way to do this in constant time using math but I'm stupid
		let distance = portal.edge.getRangeTo(start);
		let hcost = Infinity;
		let dx, dy;
		if (portal.edge.dir === 0) {
			dx = 0;
			dy = 1;
		} else {
			dx = 1;
			dy = 0;
		}
		let wp = new WorldPosition(portal.edge.pos.xx, portal.edge.pos.yy);
		let rangePoint;
		for (let ii = 0; ii <= portal.edge.length; ++ii, (portal.edge.dir === 0 ? ++wp.yy : ++wp.xx)) {
			let tmp = start.getRangeTo(wp);
			if (tmp === distance) {
				let exitCost = heuristic(wp, targets);
				if (exitCost < hcost) {
					hcost = exitCost;
					rangePoint = new WorldPosition(wp.xx, wp.yy);
				} else if (exitCost > hcost) {
					break;
				}
			}
		}
		wp.xx -= dx;
		wp.yy -= dy;
		if (wp.isEqualTo(rangePoint)) {
			return wp;
		} else {
			if (portal.edge.dir === 0) {
				return new WorldLine(rangePoint, 0, wp.yy - rangePoint.yy);
			} else {
				return new WorldLine(rangePoint, 1, wp.xx - rangePoint.xx);
			}
		}
	} else {
		let ep = start.getEndPoint();
		return calculateExitPosition(
			portal,
			portal.edge.getRangeTo(start.pos) < portal.edge.getRangeTo(ep) ? start.pos : ep,
			targets
		);
	}
}

function visit(index, fcost) {
	let isOpen = openClosed.get(index);
	if (fcost === Infinity) {
		return;
	}
	if (isOpen === true) {
		if (heap.costs[index] > fcost) {
			heap.update(index, fcost);
			return true;
		}
	} else if (isOpen === undefined) {
		openClosed.open(index);
		heap.add(index, fcost);
		return true;
	}
}

// Takes a WorldPosition that is on the border of a room and returns a new WorldPosition that is in
// the next room
function moveToNextRoom(exitPosition) {
	if (exitPosition instanceof WorldLine) {
		return new WorldLine(
			moveToNextRoom(exitPosition.pos),
			exitPosition.dir,
			exitPosition.length
		);
	} else {
		let entryPosition = new WorldPosition(exitPosition.xx, exitPosition.yy).getPositionInNextRoom();
		if (entryPosition === undefined) {
			throw new Error('You lied to me when you told me this was a portal');
		}
		return entryPosition;
	}
}

function plan(start, targets, parents, options) {

	// Init state
	heap = new Heap(2500);
	openClosed = new OpenClosed(2500);
	indexSize = 0;
	indexMap = {};
	reverseIndexMap = new Map();
	let maxCost = options.maxCost || 1000;

	// Start node must be visible
	if (TerrainData.factory(start.getRoomName()) === undefined) {
		return;
	}

	// Initial A* node
	heap.add(indexFromEntity(start), heuristic(start, targets));

	// Do it
	let minNode;
	let minCost = Infinity;
	search: while (heap.length()) {

		// Pull a node off the heap
		let index = heap.min();
		let entity = entityFromIndex(index);
		let gcost = heap.minCost(); // not yet gcost, but will be adjusted below
		heap.remove();
		if (gcost > maxCost) {
			continue;
		}
		let hcost = heuristic(entity, targets);
		openClosed.close(index);

		// Convert whatever is on the heap to a WorldPosition
		let roomName;
		let entryPosition;
		if (entity instanceof WorldPosition) {
			// The first and last iteration will be a WorldPosition
			gcost -= hcost;
			roomName = entity.getRoomName();
			entryPosition = entity;
			for (let target of targets) {
				if (target === entity) {
					// Found a target
					minNode = index;
					break search;
				}
			}
		} else {
			// If it's a RoomPortal we need to calculate where we left the last room from now
			gcost -= hcost - 1;
			let neighbor = entity.neighbor();
			if (!neighbor) {
				// Try to explore room portals when incomplete map data is encountered
				if (minCost > hcost) {
					minCost = hcost;
					minNode = index;
				}
				continue;
			}
			roomName = neighbor.roomName;
			entryPosition = moveToNextRoom(calculateExitPosition(entity, entityFromIndex(parents[index]), targets));

			// This injects the entry position into the parent chain
			let entryPositionIndex = indexFromEntity(entryPosition);
			parents[entryPositionIndex] = index;
			index = entryPositionIndex;
		}

		// If any of the targets are in this room we can add them to the heap
		for (let target of targets) {
			if (target.getRoomName() === roomName) {
				let targetIndex = indexFromEntity(target);
				if (visit(targetIndex, gcost + entryPosition.getRangeTo(target))) { // heuristic() is 0 since these are all targets
					parents[targetIndex] = index;
				}
			}
		}

		// Now add all the room portals to the heap
		let terrainData = TerrainData.factory(roomName);
		for (let edge of terrainData.edges) {
			for (let portal of edge) {
				let neighbor = portal.neighbor();
				if (neighbor) {
					openClosed.close(indexFromEntity(neighbor));
				}
				let portalIndex = indexFromEntity(portal);
				let exitCost;
				if (entryPosition instanceof WorldLine) {
					// Exit cost should be the same for the whole exit line
					exitCost = portal.edge.getRangeTo(entryPosition.pos);
				} else {
					exitCost = portal.edge.getRangeTo(entryPosition);
				}
				if (terrainData.controller !== undefined || terrainData.sources.length !== 0) {
					exitCost = Math.floor(exitCost / kHighwayDiscount);
				}
				let fcost = gcost + exitCost + heuristic(portal, targets);
				if (visit(portalIndex, fcost)) {
					parents[portalIndex] = index;
				}
			}
		}
	}

	// Reconstruct plan
	let rooms;
	let entity = entityFromIndex(minNode);
	let lastPosition;
	let hoffset = 0;
	if (entity instanceof RoomPortal) { // incomplete path due to unknown terrain
		let entry = entityFromIndex(parents[minNode]);
		let entryPosition = calculateExitPosition(entity, entry, targets);
		lastPosition = entryPosition;
		if (options.strict) {
			return;
		}
		rooms = [ {
			portal: entity,
			heuristic: entryPosition,
			hoffset: 0,
			roomName: entry.getRoomName(),
		} ];
	} else {
		lastPosition = entity;
		rooms = [ {
			targets: targets.filter(function(target) {
				return target.getRoomName() === entity.getRoomName();
			}),
			position: entity,
			roomName: entity.getRoomName(),
		} ];
	}
	let index = parents[minNode];
	entity = entityFromIndex(index);
	while (entity !== start) {
		index = parents[index];
		let portal = entityFromIndex(index);
		let lastPortal = portal.neighbor();
		if (lastPosition instanceof WorldPosition) {
			hoffset += lastPortal.edge.getRangeTo(lastPosition) + 1;
		} else if (lastPosition instanceof WorldLine) {
			hoffset += lastPortal.edge.getRangeTo(lastPosition.pos) + 1;
		} else {
			throw new Error('Rogue RoomPortal?');
		}
		lastPosition = moveToNextRoom(entity);
		rooms.push({
			portal: portal,
			heuristic: lastPosition,
			hoffset: hoffset,
			roomName: portal.roomName,
		});
		index = parents[index];
		entity = entityFromIndex(index);
	}

	// Cleanup
	heap.release();
	openClosed.release();
	indexMap = reverseIndexMap = undefined;
	return rooms;
}

module.exports = plan;
