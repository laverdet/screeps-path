"use strict";

//
// A simple binary heap
let freeHeap, freeCosts;
class Heap {
	constructor(size) {
		if (!freeHeap || size + 1 > freeHeap.length) {
			this.heap = new Uint16Array(size + 1);
			this.costs = new Uint16Array(size + 1);
		} else {
			this.heap = freeHeap;
			this.costs = freeCosts;
			freeHeap = freeCosts = undefined;
		}
		this.nextMin = undefined;
		this.size = 0;
	}

	release() {
		if (!freeHeap || this.heap.length > freeHeap.length) {
			freeHeap = this.heap;
			freeCosts = this.costs;
		}
	}

	resize(size) {
		if (this.heap.length < size + 1) {
			let heap = new Uint16Array(size + 1);
			let costs = new Uint16Array(size + 1);
			heap.set(this.heap);
			costs.set(this.costs);
			this.heap = heap;
			this.costs = costs;
		}
	}

	min() {
		if (this.nextMin !== undefined) {
			return this.nextMin;
		}
		return this.heap[1];
	}

	minCost() {
		if (this.nextMin !== undefined) {
			return this.costs[this.nextMin];
		}
		return this.costs[this.heap[1]];
	}

	length() {
		if (this.nextMin !== undefined) {
			return this.size + 1;
		}
		return this.size;
	}

	add(val, cost) {
		this.costs[val] = cost;
		if (this.nextMin !== undefined) {
			if (this.costs[this.nextMin] > cost) {
				let ii = ++this.size;
				this.heap[ii] = this.nextMin;
				this.bubbleUp(ii);
				this.nextMin = val;
				return;
			}
		} else if (this.size === 0 || this.costs[this.heap[1]] >= cost) {
			this.nextMin = val;
			return;
		}
		let ii = ++this.size;
		this.heap[ii] = val;
		this.bubbleUp(ii);
	}

	update(val, cost) {
		if (val === this.nextMin) {
			this.costs[val] = cost;
			return;
		}
		for (let ii = this.size; ii > 0; --ii) {
			if (this.heap[ii] === val) {
				this.costs[val] = cost;
				this.bubbleUp(ii);
			}
		}
	}

	remove() {
		if (this.nextMin !== undefined) {
			this.nextMin = undefined;
			return;
		}
		this.heap[1] = this.heap[this.size];
		--this.size;
		let vv = 1;
		do {
			let uu = vv;
			if ((uu << 1) + 1 <= this.size) {
				if (this.costs[this.heap[uu]] >= this.costs[this.heap[uu << 1]]) {
					vv = uu << 1;
				}
				if (this.costs[this.heap[vv]] >= this.costs[this.heap[(uu << 1) + 1]]) {
					vv = (uu << 1) + 1;
				}
			} else if (uu << 1 <= this.size) {
				if (this.costs[this.heap[uu]] >= this.costs[this.heap[uu << 1]]) {
					vv = uu << 1;
				}
			}
			if (uu !== vv) {
				let tmp = this.heap[uu];
				this.heap[uu] = this.heap[vv];
				this.heap[vv] = tmp;
			} else {
				return;
			}
		} while(true);
	}

	bubbleUp(ii) {
		while (ii !== 1) {
			if (this.costs[this.heap[ii]] <= this.costs[this.heap[ii >>> 1]]) {
				let tmp = this.heap[ii];
				this.heap[ii] = this.heap[ii >>> 1];
				this.heap[ii = ii >>> 1] = tmp;
			} else {
				return;
			}
		}
	}
}

module.exports = Heap;
