"use strict";

var m2f = Function.prototype.bind.bind(Function.prototype.call);
var map = m2f([].map);
var forEach = m2f([].forEach);
var join = m2f([].join);

function byteToArray(b) {
	var array = [];
	var i = 8;
	while (--i >= 0) {
		array.push((b & (1 << i)) > 0 ? 1 : 0);
	}
	return array;
}

function toHex(n, pad) {
	pad = pad || 2;
	var s = n.toString(16);
	if (s.length < pad)
		s = join(new Uint8Array(pad - s.length), '') + s;
	return s;

}

var vec = {
	times: function(v, k) {
		return { x: v.x * k, y: v.y * k };
	},

	plus: function(u, v) {
		return { x: u.x + v.x, y: u.y + v.y };
	},
};

function cubicBezier(a, b, c, d) {
	return function(t) {
		var u = (1 - t);
		var u2 = u * u;
		var u3 = u2 * u;
		var t2 = t * t;
		var t3 = t2 * t;

		var r = vec.times(a, u3);
		r = vec.plus(r, vec.times(c, 3 * u2 * t));
		r = vec.plus(r, vec.times(d, 3 * u * t2));
		r = vec.plus(r, vec.times(b, t3));

		return r;
	}
}

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// CPU

var cpu = {
	frequency: 10,

	reset: function() {
		this.memory = new Uint8Array(0x1000);
		this.v = new Uint8Array(16);
		this.i = 0;
		this.delayTimer = 0;
		this.soundTimer = 0;
		this.pc = 0x200;
		this.stack = [];
		this.waitingForKeyPress = false;
		this.loadFont();
		this.cpuCycles = 0;
	},

	loadFont: function() {
		this.memory.set([
			0xf0, 0x90, 0x90, 0x90, 0xf0, // 0
			0x20, 0x60, 0x20, 0x20, 0x70, // 1
			0xf0, 0x10, 0xf0, 0x80, 0xf0, // 2
			0xf0, 0x10, 0xf0, 0x10, 0xf0, // 3
			0x90, 0x90, 0xf0, 0x10, 0x10, // 4
			0xf0, 0x80, 0xf0, 0x10, 0xf0, // 5
			0xf0, 0x80, 0xf0, 0x90, 0xf0, // 6
			0xf0, 0x10, 0x20, 0x40, 0x40, // 7
			0xf0, 0x90, 0xf0, 0x90, 0xf0, // 8
			0xf0, 0x90, 0xf0, 0x10, 0xf0, // 9
			0xf0, 0x90, 0xf0, 0x90, 0x90, // A
			0xe0, 0x90, 0xe0, 0x90, 0xe0, // B
			0xf0, 0x80, 0x80, 0x80, 0xf0, // C
			0xe0, 0x90, 0x90, 0x90, 0xe0, // D
			0xf0, 0x80, 0xf0, 0x80, 0xf0, // E
			0xf0, 0x80, 0xf0, 0x80, 0x80  // F
		]);
	},

	loadRom: function(rom) {
		this.memory.set(new Uint8Array(rom), 0x200);
	},

	step: function() {
		if (this.waitingForKeyPress) return;

		var opcode = this.memory[this.pc] << 8 | this.memory[this.pc+1];
		this.pc += 2;

		this.exec(opcode);

		++this.cpuCycles;

		if (this.cpuCycles == this.frequency) {
			this.cpuCycles = 0;
			this.sync();
		}
	},

	sync: function() {
		this.updateTimers();
		this.screen.refresh();
	},

	updateTimers: function() {
		if (this.delayTimer > 0) --this.delayTimer;
		if (this.soundTimer > 0) {
			if (!this.speaker.isPlaying())
				this.speaker.startSound();
			--this.soundTimer;
		} else if (this.speaker.isPlaying()) {
			this.speaker.stopSound();
		}
	},

	cycle: function() {
		var steps = this.frequency;
		do {
			this.step();
		} while (--steps);
	},

	exec: function(opcode) {
		var addr = opcode & 0x0fff;
		var x = (opcode & 0x0f00) >> 8;
		var y = (opcode & 0x00f0) >> 4;
		var kk = opcode & 0x00ff;

		switch (opcode & 0xf000) {
		case 0x0000:
			switch (opcode & 0x00ff) {
			case 0x00:								// 0000 - NOP?
				break;

			case 0xe0:								// 00E0 - CLS
				this.screen.clear();
				break;

			case 0xee:								// 00EE - RET
				this.pc = this.stack.pop();
				break;

			default:
				console.log('ignoring opcode', toHex(opcode, 4));
			}
			break;

		case 0x1000:								// 1nnn - JP addr
			this.pc = addr;
			break;

		case 0x2000:								// 2nnn - CALL addr
			this.stack.push(this.pc);
			this.pc = addr;
			break;

		case 0x3000:								// 3xkk - SE Vx, byte
			if (this.v[x] === kk)
				this.pc += 2;
			break;

		case 0x4000:								// 4xkk - SNE Vx, byte
			if (this.v[x] !== kk)
				this.pc += 2;
			break;

		case 0x5000:								// 5xy0 - SE Vx, Vy
			if (this.v[x] === this.v[y])
				this.pc += 2;
			break;

		case 0x6000:								// 6xkk - LD Vx, byte
			this.v[x] = kk;
			break;

		case 0x7000:								// 7xkk - ADD Vx, byte
			this.v[x] += kk;
			break;


		case 0x8000:
			switch (opcode & 0x000f) {
			case 0x0: 								// 8xy0 - LD Vx, Vy
				this.v[x] = this.v[y];
				break;

			case 0x1 :								// 8xy1 - OR Vx, Vy
				this.v[x] |= this.v[y];
				break;

			case 0x2:									// 8xy2 - AND Vx, Vy
				this.v[x] &= this.v[y];
				break;

			case 0x3:									// 8xy3 - XOR Vx, Vy
				this.v[x] ^= this.v[y];
				break;

			case 0x4:									// 8xy4 - ADD Vx, Vy
				var r = this.v[x] + this.v[y];
				this.v[0xf] = r > 0xff;
				this.v[x] = r;
				break;

			case 0x5:									// 8xy5 - SUB Vx, Vy
				var r = this.v[x] - this.v[y];
				this.v[0xf] = r > 0;
				this.v[x] = r;
				break;

			case 0x6:									// 8xy6 - SHR Vx {, Vy}
				this.v[0xf] = this.v[x] & 0x1;
				this.v[x] >>= 1;
				break;

			case 0x7:									// 8xy7 - SUBN Vx, Vy
				var r = this.v[y] - this.v[x];
				this.v[0xf] = r > 0;
				this.v[x] = r;
				break;

			case 0xe:									// 8xyE - SHL Vx {, Vy}
				this.v[0xf] = (this.v[x] & 0x80) > 0;
				this.v[x] <<= 1;
				break;

			default:
				console.log('ignoring opcode', toHex(opcode, 4));
			}
			break;

		case 0x9000:								// 9xy0 - SNE Vx, Vy
			if (this.v[x] !== this.v[y])
				this.pc += 2;
			break;

		case 0xa000:								// Annn - LD I, addr
			this.i = addr;
			break;

		case 0xb000:								// Bnnn - JP V0, addr
			this.pc = addr + this.v[0];
			break;

		case 0xc000:								// Cxkk - RND Vx, byte
			var r = Math.floor(Math.random()*256);
			this.v[x] = r & kk;
			break;

		case 0xd000:								// Dxyn - DRW Vx, Vy, nibble
			var n = opcode & 0x000f;
			var sprite = this.memory.subarray(this.i, this.i + n);
			sprite = [].concat.apply([], map(sprite, byteToArray));
			this.v[0xf] = this.screen.drawSprite(this.v[x], this.v[y], sprite);
			break;

		case 0xe000:
			switch (opcode & 0x00ff) {
			case 0x9e:								// Ex9E - SKP Vx
				if (this.keyboard.isKeyDown(this.v[x]))
					this.pc += 2;
				break;

			case 0xa1:								// ExA1 - SKNP Vx
				if (!this.keyboard.isKeyDown(this.v[x]))
					this.pc += 2;
				break;

			default:
				console.log('ignoring opcode', toHex(opcode, 4));
			}
			break;

		case 0xf000:
			switch (opcode & 0x00ff) {
			case 0x07:								// Fx07 - LD Vx, DT
				this.v[x] = this.delayTimer;
				break;

			case 0x0a:								// Fx0A - LD Vx, K
				this.waitingForKeyPress = true;
				this.keyboard.signalNextKeyPress = function(key) {
					this.waitingForKeyPress = false;
					this.v[x] = key;
				}.bind(this);
				break;

			case 0x15:								// Fx15 - LD DT, Vx
				this.delayTimer = this.v[x];
				break;

			case 0x18:								// Fx18 - LD ST, Vx
				this.soundTimer = this.v[x];
				break;

			case 0x1e:								// Fx1E - ADD I, Vx
				this.i += this.v[x];
				this.v[0xf] = this.i > 0xffff;
				this.i &= 0xffff;
				break;

			case 0x29:								// Fx29 - LD F, Vx
				this.i = this.v[x] * 5;
				break;

			case 0x33:								// Fx33 - LD B, Vx
				var h = Math.floor(this.v[x] / 100);
				var d = Math.floor((this.v[x] % 100) / 10);
				var u = this.v[x] % 10;
				this.memory[this.i] = h;
				this.memory[this.i+1] = d;
				this.memory[this.i+2] = u;
				break;

			case 0x55:								// Fx55 - LD [I], Vx
				this.memory.set(this.v.subarray(0, x + 1), this.i);
				break;

			case 0x65:								// Fx65 - LD Vx, I
				this.v.set(this.memory.subarray(this.i, this.i + x + 1));
				break;

			default:
				console.log('ignoring opcode', toHex(opcode, 4));
			}
			break;

		default:
			console.log('ignoring opcode', toHex(opcode, 4));
		}
	},

	decode: function(opcode) {
		var addr = opcode & 0x0fff;
		var x = (opcode & 0x0f00) >> 8;
		var y = (opcode & 0x00f0) >> 4;
		var kk = opcode & 0x00ff;

		switch (opcode & 0xf000) {
		case 0x0000:
			switch (opcode & 0x00ff) {
			case 0x00:								// 0000 - NOP?
				return 'NOP';

			case 0xe0:								// 00E0 - CLS
				return 'CLS';

			case 0xee:								// 00EE - RET
				return 'RET';

			default:
				return '';
			}

		case 0x1000:								// 1nnn - JP addr
			return 'JP ' + toHex(addr, 3);

		case 0x2000:								// 2nnn - CALL addr
			return 'CALL ' + toHex(addr, 3);

		case 0x3000:								// 3xkk - SE Vx, byte
			return 'SE V' + toHex(x, 1) + ', ' + toHex(kk, 2);

		case 0x4000:								// 4xkk - SNE Vx, byte
			return 'SNE V' + toHex(x, 1) + ', ' + toHex(kk, 2);

		case 0x5000:								// 5xy0 - SE Vx, Vy
			return 'SE V' + toHex(x, 1) + ', V' + toHex(y, 1);

		case 0x6000:								// 6xkk - LD Vx, byte
			return 'LD V' + toHex(x, 1) + ', ' + toHex(kk, 2);

		case 0x7000:								// 7xkk - ADD Vx, byte
			return 'ADD V' + toHex(x, 1) + ', ' + toHex(kk, 2);

		case 0x8000:
			switch (opcode & 0x000f) {
			case 0x0: 								// 8xy0 - LD Vx, Vy
				return 'LD V' + toHex(x, 1) + ', V' + toHex(y, 1);

			case 0x1 :								// 8xy1 - OR Vx, Vy
				return 'OR V' + toHex(x, 1) + ', V' + toHex(y, 1);

			case 0x2:									// 8xy2 - AND Vx, Vy
				return 'AND V' + toHex(x, 1) + ', V' + toHex(y, 1);

			case 0x3:									// 8xy3 - XOR Vx, Vy
				return 'XOR V' + toHex(x, 1) + ', V' + toHex(y, 1);

			case 0x4:									// 8xy4 - ADD Vx, Vy
				return 'ADD V' + toHex(x, 1) + ', V' + toHex(y, 1);

			case 0x5:									// 8xy5 - SUB Vx, Vy
				return 'SUB V' + toHex(x, 1) + ', V' + toHex(y, 1);

			case 0x6:									// 8xy6 - SHR Vx {, Vy}
				return 'SHR V' + toHex(x, 1);

			case 0x7:									// 8xy7 - SUBN Vx, Vy
				return 'SUBN V' + toHex(x, 1) + ', V' + toHex(y, 1);

			case 0xe:									// 8xyE - SHL Vx {, Vy}
				return 'SHL V' + toHex(x, 1);

			default:
				return '';
			}

		case 0x9000:								// 9xy0 - SNE Vx, Vy
			return 'SNE V' + toHex(x, 1) + ', V' + toHex(y, 1);

		case 0xa000:								// Annn - LD I, addr
			return 'LD I, ' + toHex(addr, 3);

		case 0xb000:								// Bnnn - JP V0, addr
			return 'JP V0, ' + toHex(addr, 3);

		case 0xc000:								// Cxkk - RND Vx, byte
			return 'RND V' + toHex(x, 1) + ', ' + toHex(kk, 2);

		case 0xd000:								// Dxyn - DRW Vx, Vy, nibble
			var n = opcode & 0x000f;
			return 'DRW V' + toHex(x, 1) + ', V' + toHex(y, 1) + ', ' + toHex(n, 1);

		case 0xe000:
			switch (opcode & 0x00ff) {
			case 0x9e:								// Ex9E - SKP Vx
				return 'SKP V' + toHex(x, 1);

			case 0xa1:								// ExA1 - SKNP Vx
				return 'SKNP V' + toHex(x, 1);

			default:
				return '';
			}

		case 0xf000:
			switch (opcode & 0x00ff) {
			case 0x07:								// Fx07 - LD Vx, DT
				return 'LD V' + toHex(x, 1) + ', DT';

			case 0x0a:								// Fx0A - LD Vx, K
				return 'LD V' + toHex(x, 1) + ', K';

			case 0x15:								// Fx15 - LD DT, Vx
				return 'LD DT, V' + toHex(x, 1);

			case 0x18:								// Fx18 - LD ST, Vx
				return 'LD ST, V' + toHex(x, 1);

			case 0x1e:								// Fx1E - ADD I, Vx
				return 'ADD I, V' + toHex(x, 1);

			case 0x29:								// Fx29 - LD F, Vx
				return 'LD F, V' + toHex(x, 1);

			case 0x33:								// Fx33 - LD B, Vx
				return 'LD B, V' + toHex(x, 1);

			case 0x55:								// Fx55 - LD [I], Vx
				return 'LD [I], V' + toHex(x, 1);

			case 0x65:								// Fx65 - LD Vx, I
				return 'LD V' + toHex(x, 1) + ', I';

			default:
				return '';
			}

		default:
			return '';
		}
	},

};

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Screen

var screen = {
	height: 32,
	width: 64,
	zoom: 24,
	pixels: [],
	previousPixels: [],
	afterglow: [
		'#546066',
		'#8EA1AA',
		'#C2DAE7',
		'#D6F1FF',
		'#D6F1FF',
		'#D6F1FF',
	],

	init: function() {
		// Scanlines

		this.effects.strokeStyle = 'hsla(60, 100%, 82%, .2)';
		for (var y = 0; y < this.height * this.zoom; ++y) {
			this.effects.beginPath();
			this.effects.moveTo(0, y*3);
			this.effects.lineTo(this.width * this.zoom, y*3);
			this.effects.stroke();
		}
	},

	clear: function() {
		this.pixels.length = 0;
	},

	drawSprite: function(x, y, sprite) {
		var width = 8;
		var height = sprite.length;

		var collision = 0;

		for (var yy = 0; yy < height; ++yy) {
			for (var xx = 0; xx < width; ++xx) {
				if (this.drawPixel(sprite[yy * width + xx], x + xx, y + yy))
					collision = 1;
			}
		}

		return collision;
	},

	drawPixel: function(p, x, y) {
		// Does not wrap around, otherwise BLITZ is unplayable.
		// x %= this.width;
		// y %= this.height;
		if (x > this.width || x < 0) return 0;
		if (y > this.height || y < 0) return 0;

		var collision = p && this.pixels[y * this.width + x] ? 1 : 0;

		this.pixels[y * this.width + x] ^= p;

		return collision;
	},

	clearCanvas: function() {
		this.ctxt.fillStyle = 'hsl(200, 10%, 15%)';
		this.ctxt.fillRect(0, 0, this.width * this.zoom, this.height * this.zoom);
	},

	refresh: function() {
		this.clearCanvas();

		this.previousPixels.push(this.pixels.slice());
		if (this.previousPixels.length > this.afterglow.length)
			this.previousPixels.shift();

		for (var pass = 0; pass < this.previousPixels.length; ++pass) {
			var pixels = this.previousPixels[pass];
			this.ctxt.fillStyle = this.afterglow[pass];
			for (var x = 0; x < this.width; ++x) {
				for (var y = 0; y < this.height; ++y) {
					var xy = y * this.width + x;
					if (pixels[xy])
						this.paintPixel(x * this.zoom, y * this.zoom);
				}
			}
		}
	},

	paintPixel: function(x, y, alpha) {
		x += (Math.random() - 0.5);
		y += (Math.random() - 0.5) / 1.5;

		this.ctxt.fillRect(x-1, y-1, this.zoom+2, this.zoom+2);
	},
};

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Speaker

var speaker = {
	note: null,
	frequency: 220,

	isPlaying: function() {
		return !!this.note;
	},

	startSound: function() {
		var osc = this.audioContext.createOscillator();
		osc.type = 1; // Square wave
		osc.frequency.value = this.frequency;
		osc.connect(this.volume);
		osc.noteOn(0);

		this.note = osc;
	},

	stopSound: function() {
		this.note.disconnect();
		this.note = null;
	},
};

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Keyboard

var keyboard = {
	reset: function() {
		this.keys = new Uint8Array(16);
	},

	keyDown: function(key) {
		this.keys[key] = 1;

		if (this.signalNextKeyPress) {
			this.signalNextKeyPress(key);
			this.signalNextKeyPress = null;
		}
	},

	keyUp: function(key) {
		this.keys[key] = 0;
	},

	isKeyDown: function(key) {
		return this.keys[key] === 1;
	},
};

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Main

function readFile(file, callback) {
	var reader = new FileReader();
	reader.onloadend = callback;
	reader.readAsArrayBuffer(file);
}

function decodeMemory(pc) {
	var opcode = cpu.memory[pc] << 8 | cpu.memory[pc+1];
	return toHex(pc, 4) + ': '
		+ toHex(opcode, 4) + ' '
		+ cpu.decode(opcode);
}

function initUI() {
	for (var i=0; i < cpu.memory.length; i+=2) {
		var option = document.createElement('option');
		option.textContent = decodeMemory(i);
		document.querySelector('#memory').appendChild(option);
	}
}

function refreshUI() {
	var $ = document.querySelector.bind(document);

	$('#pc-value').textContent = toHex(cpu.pc, 4);
	$('#v-value').textContent =
		map(cpu.v, function(v) { return toHex(v, 2); });
	$('#i-value').textContent = toHex(cpu.i, 4);
	$('#dt-value').textContent = toHex(cpu.delayTimer);
	$('#st-value').textContent = toHex(cpu.soundTimer);
	$('#keys-value').textContent =
		map(keyboard.keys, function(v) { return toHex(v, 2); });

	$('#memory').selectedIndex = cpu.pc / 2;

	var option = document.createElement('option');
	option.textContent = decodeMemory(cpu.pc);
	document.querySelector('#memory').appendChild(option);
	$('#log').appendChild(option);
	$('#log').selectedIndex = $('#log').length - 1;
}

function onChangeRom() {
	pause();

	var rom = this.result;
	cpu.reset();
	cpu.loadRom(rom);
	screen.clear();
	keyboard.reset();

	initUI();
	refreshUI();

	resume();
}

var loop;

function resume() {
	cycle();
	loop = requestAnimationFrame(resume);
}

function pause() {
	cancelAnimationFrame(loop);
}

function step() {
	cpu.step();

	refreshUI();
}

function cycle() {
	cpu.cycle();
	screen.refresh();

	//refreshUI();
}

function init() {
	// init screen
	var canvases = document.querySelectorAll('canvas');
	forEach(canvases, function(canvas) {
		canvas.width = screen.width * screen.zoom;
		canvas.height = screen.height * screen.zoom;
	});
	document.querySelector('#canvases').style.height = screen.height * screen.zoom + 'px';
	screen.ctxt = canvases[0].getContext('2d');
	screen.effects = canvases[1].getContext('2d');
	screen.init();

	// init keyboard
	var keyMapping = {
		49: 0x1,
		50: 0x2,
		51: 0x3,
		52: 0xc,
		81: 0x4,
		87: 0x5,
		70: 0x6,
		80: 0xd,
		65: 0x7,
		82: 0x8,
		83: 0x9,
		84: 0xe,
		90: 0xa,
		88: 0x0,
		67: 0xb,
		86: 0xf,
	};

	window.addEventListener('keydown', function(event) {
		if (event.which in keyMapping)
			keyboard.keyDown(keyMapping[event.which]);
	});

	window.addEventListener('keyup', function(event) {
		if (event.which in keyMapping)
			keyboard.keyUp(keyMapping[event.which]);
	});

	// init speaker
	if (window.webkitAudioContext) {
		var audioContext = new webkitAudioContext();
		var volume = audioContext.createGainNode();
		volume.connect(audioContext.destination);
		volume.gain.value = 0.1;
		speaker.audioContext = audioContext;
		speaker.volume = volume;
	}

	// init cpu
	cpu.screen = screen;
	cpu.keyboard = keyboard;

	if (window.webkitAudioContext) {
		cpu.speaker = speaker;
	} else {
		cpu.speaker = {
			isPlaying: function() { return true; },
			startSound: function() {},
			stopSound: function() {},
		}
	}

	var input = document.querySelector('#rom-file');
	input.onchange = function() { readFile(this.files[0], onChangeRom); };
	if (input.files[0]) readFile(input.files[0], onChangeRom);

	// Debugging
	window.addEventListener('keypress', function(event) {
		if (event.which === 93) // ]
			step();
	});
}

init();
