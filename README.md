The General's pathfinder
========================

This is a custom pathfinder for use in [Screeps](https://screeps.com/). It has
support for custom cost functions (see `path-room-data.js`), can create paths
that span several rooms, and is a good deal faster than the built-in pathfinder
as well. Under the hood it's using a modified version of jump point search...
JPS by design only works on uniform-cost grids, but Screeps' grids are weighted
(plain, swamp, and road all cause different values of fatigue) so we need to
modify the original algorithm a little bit.

The code itself is fairly well documented, but you won't find any API
documentation except for looking at the code yourself.

Getting started:
```js
let path = require('path_');
let WorldPosition = path.WorldPosition;
path.find(
	WorldPosition(Game.creeps.John.pos),
	{ target: WorldPosition(Game.spawns.Spawn1.pos) }
);
```

This pathfinder uses a replacement for `RoomPosition` called `WorldPosition`.
Instead of tracking positions by coordinates and a room name, WorldPosition
unifies the entire world map into a continuous coordinate plane. This allows us
to easily calculate the distance between two positions when they aren't in the
same room. You can convert a RoomPosition into a WorldPosition via
`WorldPosition(rp)` and a WorldPosition back via `wp.toRoomPosition()`.

Returned from `find` is a `PathInfo` object which keeps around some extra data
about the path, like where the roads and swamps are. See `path-info.js`.

The first time you create a path you will need to have access to all the rooms
it touches, but after the pathfinder has seen a room it will remember its
terrain and you can search for paths through rooms in which you control no
creeps or structures. This data is all stashed in `Memory.terrain`. See
`TerrainData` in `path-room-data.js` for more information about that.

You can specify multiple targets by using the `targets` option parameter, or try
`findNearest` for a replacement of `RoomPosition.findClosestByPath` with the
added bonus of returning the path to whatever it found.
