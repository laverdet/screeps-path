"use strict";

//
// Keeps track of open/closed state
let list, marker;
class OpenClosed {
	constructor(size) {
		if (!list || size > list.length) {
			this.list = new Uint8Array(size);
			this.marker = 1;
		} else {
			this.list = list;
			this.marker = marker + 2;
			list = marker = undefined;
		}
	}

	release() {
		if ((!list || list.length < this.list.length) && this.marker <= 252) {
			list = this.list;
			marker = this.marker;
		}
	}

	resize(size) {
		if (this.list.length < size) {
			let list = new Uint8Array(size);
			list.set(this.list);
			this.list = list;
		}
	}

	get(index) {
		let isOpen = this.list[index];
		if (isOpen === this.marker) {
			return true;
		} else if (isOpen === this.marker + 1) {
			return false;
		} else {
			return undefined;
		}
	}

	open(index) {
		this.list[index] = this.marker;
	}

	close(index) {
		this.list[index] = this.marker + 1;
	}
}

module.exports = OpenClosed;
