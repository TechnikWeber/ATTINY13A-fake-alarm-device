// FAD web flasher – core: Intel HEX, settings block, ISP programmers.
// No dependencies. Works with WebUSB (USBasp, USBtinyISP, AVRISP mkII) and
// Web Serial (STK500v2, Arduino as ISP).

export const FLASH_SIZE = 1024;   // ATtiny13A
export const PAGE_SIZE = 32;
export const SIGNATURE = [0x1e, 0x90, 0x07];
export const TICK_MS = 16;
export const FACTORY_FUSES = { low: 0x6a, high: 0xff };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (b) => b.toString(16).padStart(2, "0").toUpperCase();
export const hexBytes = (a) => Array.from(a, hex2).join(" ");

// ---------------------------------------------------------------- Intel HEX

export function parseHex(text, size = FLASH_SIZE) {
  const image = new Uint8Array(size).fill(0xff);
  let used = 0, base = 0, eof = false;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [n, line] of lines.entries()) {
    if (line[0] !== ":") throw new Error(`HEX line ${n + 1}: missing ':'`);
    const bytes = line.slice(1).match(/../g).map((h) => parseInt(h, 16));
    if (bytes.some(Number.isNaN)) throw new Error(`HEX line ${n + 1}: not hex`);
    const len = bytes[0];
    if (bytes.length !== len + 5) throw new Error(`HEX line ${n + 1}: wrong length`);
    if (bytes.reduce((s, b) => (s + b) & 0xff, 0) !== 0) throw new Error(`HEX line ${n + 1}: checksum`);
    const addr = (bytes[1] << 8) | bytes[2], type = bytes[3], data = bytes.slice(4, 4 + len);
    if (type === 0) {
      const a = base + addr;
      if (a + len > size) throw new Error(`HEX: address 0x${a.toString(16)} beyond ${size} bytes flash`);
      image.set(data, a);
      used = Math.max(used, a + len);
    } else if (type === 1) { eof = true; break; }
    else if (type === 2) base = ((data[0] << 8) | data[1]) << 4;
    else if (type === 4) base = ((data[0] << 8) | data[1]) << 16;
    // 3 and 5 (start address) are irrelevant for AVR
  }
  if (!eof) throw new Error("HEX: no end-of-file record");
  return { image, used };
}

export function toHex(image, used) {
  const out = [];
  for (let a = 0; a < used; a += 16) {
    const chunk = Array.from(image.subarray(a, Math.min(a + 16, used)));
    const rec = [chunk.length, (a >> 8) & 0xff, a & 0xff, 0, ...chunk];
    const cs = (0x100 - (rec.reduce((s, b) => s + b, 0) & 0xff)) & 0xff;
    out.push(":" + [...rec, cs].map(hex2).join(""));
  }
  out.push(":00000001FF");
  return out.join("\n") + "\n";
}

// ------------------------------------------------------- settings block (V3)

const MAGIC = [0x46, 0x41, 0x44, 0x43, 0x46, 0x47]; // "FADCFG"

export function findConfig(image) {
  outer: for (let i = 0; i + 18 <= image.length; i++) {
    for (let j = 0; j < MAGIC.length; j++) if (image[i + j] !== MAGIC[j]) continue outer;
    if (image[i + 6] === 1) return i;
  }
  return -1;
}

const u16 = (img, o) => img[o] | (img[o + 1] << 8);
const put16 = (img, o, v) => { img[o] = v & 0xff; img[o + 1] = (v >> 8) & 0xff; };

export function readConfig(image, off) {
  return {
    flashes: image[off + 7],
    onTime: u16(image, off + 8),       // 0.1 ms
    gap: u16(image, off + 10),         // ticks
    interval: u16(image, off + 12),    // ticks
    ledPin: image[off + 14],
    activeHigh: !!(image[off + 15] & 1),
    bootFlashes: image[off + 16],
  };
}

export function writeConfig(image, off, c) {
  const img = new Uint8Array(image);
  img[off + 7] = c.flashes;
  put16(img, off + 8, c.onTime);
  put16(img, off + 10, c.gap);
  put16(img, off + 12, c.interval);
  img[off + 14] = c.ledPin;
  img[off + 15] = c.activeHigh ? 1 : 0;
  img[off + 16] = c.bootFlashes;
  return img;
}

// ---------------------------------------------------------- programmers

// Known USB IDs (VID:PID, hex). `kind` selects the driver.
export const KNOWN_USB = [
  { vid: 0x16c0, pid: 0x05dc, kind: "usbasp", name: "USBasp (also Diamex ISP-Prog-NG in USBasp mode)" },
  { vid: 0x03eb, pid: 0xc7b4, kind: "usbasp", name: "USBasp (old ID)" },
  { vid: 0x1781, pid: 0x0c9f, kind: "usbtiny", name: "USBtinyISP / Pocket AVR Programmer" },
  { vid: 0x03eb, pid: 0x2104, kind: "mkii", name: "AVRISP mkII (or compatible)" },
];

export function parseUsbId(s) {
  const m = String(s).trim().match(/^(?:0x)?([0-9a-f]{1,4})\s*[:/ ]\s*(?:0x)?([0-9a-f]{1,4})$/i);
  return m ? { vid: parseInt(m[1], 16), pid: parseInt(m[2], 16) } : null;
}
export const fmtUsbId = (vid, pid) =>
  `${vid.toString(16).padStart(4, "0")}:${pid.toString(16).padStart(4, "0")}`;

async function openUsb(dev, log) {
  if (!dev.opened) await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  try { await dev.claimInterface(0); }
  catch (e) { log?.(`Hinweis: Interface 0 nicht übernommen (${e.message}) – versuche es trotzdem.`); }
}

// Base: everything built from the 4-byte ISP instruction (`cmd`).
class IspBase {
  constructor(log) { this.log = log || (() => {}); }
  async signature() {
    const s = [];
    for (let i = 0; i < 3; i++) s.push((await this.cmd([0x30, 0, i, 0]))[3]);
    return s;
  }
  async readFuses() {
    return { low: (await this.cmd([0x50, 0, 0, 0]))[3], high: (await this.cmd([0x58, 0x08, 0, 0]))[3] };
  }
  async writeFuse(which, v) {
    await this.cmd([0xac, which === "low" ? 0xa0 : 0xa8, 0, v]);
    await sleep(15);
  }
  async erase() {
    await this.cmd([0xac, 0x80, 0, 0]);
    await sleep(25);
  }
  async writeFlash(image, len, progress) {
    const pages = Math.ceil(len / PAGE_SIZE);
    for (let p = 0; p < pages; p++) {
      const a0 = p * PAGE_SIZE;
      const page = image.subarray(a0, a0 + PAGE_SIZE);
      if (page.every((b) => b === 0xff)) continue;
      for (let i = 0; i < PAGE_SIZE; i++) {
        const w = (a0 + i) >> 1;
        await this.cmd([i & 1 ? 0x48 : 0x40, (w >> 8) & 0xff, w & 0xff, page[i]]);
      }
      const pw = a0 >> 1;
      await this.cmd([0x4c, (pw >> 8) & 0xff, pw & 0xff, 0]);
      await sleep(10);
      progress?.((p + 1) / pages);
    }
  }
  async readFlash(len, progress) {
    const out = new Uint8Array(len);
    for (let a = 0; a < len; a++) {
      const w = a >> 1;
      out[a] = (await this.cmd([a & 1 ? 0x28 : 0x20, (w >> 8) & 0xff, w & 0xff, 0]))[3];
      if ((a & 31) === 31 || a === len - 1) progress?.((a + 1) / len);
    }
    return out;
  }
}

// ---- USBasp (WebUSB, vendor control transfers)
const USBASP = { CONNECT: 1, DISCONNECT: 2, TRANSMIT: 3, ENABLEPROG: 5, SETISPSCK: 10 };
export const USBASP_SCK = { normal: 8 /* 93.75 kHz */, slow: 6 /* 16 kHz */, slowest: 3 /* 2 kHz */ };

export class UsbAsp extends IspBase {
  constructor(dev, { sck = "normal", log } = {}) { super(log); this.dev = dev; this.sck = sck; }
  async ctrl(req, b = [0, 0, 0, 0], len = 4) {
    const r = await this.dev.controlTransferIn({
      requestType: "vendor", recipient: "device", request: req,
      value: (b[1] << 8) | b[0], index: (b[3] << 8) | b[2],
    }, len);
    if (r.status !== "ok") throw new Error(`USB-Übertragung: ${r.status}`);
    return new Uint8Array(r.data ? r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + r.data.byteLength) : []);
  }
  async open() {
    await openUsb(this.dev, this.log);
    try {
      const r = await this.ctrl(USBASP.SETISPSCK, [USBASP_SCK[this.sck], 0, 0, 0]);
      if (r.length === 0) this.log("USBasp-Firmware kennt keine Takteinstellung (alt) – Standardtakt.");
      else if (r[0] !== 0) this.log("USBasp hat den ISP-Takt nicht übernommen – Standardtakt.");
    } catch { this.log("ISP-Takt nicht gesetzt – Standardtakt."); }
    for (let i = 0; i < 4; i++) {
      await this.ctrl(USBASP.CONNECT);
      await sleep(100);
      const r = await this.ctrl(USBASP.ENABLEPROG);
      if (r.length >= 1 && r[0] === 0) return;
      await this.ctrl(USBASP.DISCONNECT).catch(() => {});
      await sleep(100);
    }
    throw new Error("Chip antwortet nicht (Programmiermodus). Verkabelung, Stromversorgung und ISP-Takt prüfen.");
  }
  cmd(c) { return this.ctrl(USBASP.TRANSMIT, c, 4); }
  async close() {
    await this.ctrl(USBASP.DISCONNECT).catch(() => {});
    try { await this.dev.close(); } catch {}
  }
}

// ---- USBtinyISP (WebUSB, vendor control transfers)
const USBTINY = { POWERUP: 5, POWERDOWN: 6, SPI: 7 };
export const USBTINY_SCK = { normal: 10 /* µs period, 100 kHz */, slow: 60, slowest: 250 };

export class UsbTiny extends IspBase {
  constructor(dev, { sck = "normal", log } = {}) { super(log); this.dev = dev; this.sck = sck; }
  async out(req, value = 0, index = 0) {
    const r = await this.dev.controlTransferOut({ requestType: "vendor", recipient: "device", request: req, value, index });
    if (r.status !== "ok") throw new Error(`USB-Übertragung: ${r.status}`);
  }
  async cmd(c) {
    const r = await this.dev.controlTransferIn({
      requestType: "vendor", recipient: "device", request: USBTINY.SPI,
      value: (c[1] << 8) | c[0], index: (c[3] << 8) | c[2],
    }, 4);
    if (r.status !== "ok" || r.data.byteLength < 4) throw new Error("USBtiny: keine Antwort");
    return new Uint8Array(r.data.buffer.slice(r.data.byteOffset, r.data.byteOffset + 4));
  }
  async open() {
    await openUsb(this.dev, this.log);
    for (let i = 0; i < 4; i++) {
      await this.out(USBTINY.POWERUP, USBTINY_SCK[this.sck], 0);
      await sleep(50);
      const r = await this.cmd([0xac, 0x53, 0, 0]);
      if (r[2] === 0x53) return;
      await this.out(USBTINY.POWERDOWN).catch(() => {});
      await sleep(100);
    }
    throw new Error("Chip antwortet nicht (Programmiermodus). Verkabelung, Stromversorgung und ISP-Takt prüfen.");
  }
  async close() {
    await this.out(USBTINY.POWERDOWN).catch(() => {});
    try { await this.dev.close(); } catch {}
  }
}

// ---- Web Serial helper
export class SerialLink {
  constructor(port) { this.port = port; this.buf = []; this.wake = null; }
  async open(baudRate) {
    await this.port.open({ baudRate, bufferSize: 4096 });
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this.loop = (async () => {
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          for (const b of value) this.buf.push(b);
          const w = this.wake; this.wake = null; w?.();
        }
      } catch { /* port closed */ }
    })();
  }
  async read(n, timeout = 1000) {
    const end = Date.now() + timeout;
    while (this.buf.length < n) {
      const left = end - Date.now();
      if (left <= 0) throw new Error("Zeitüberschreitung – keine Antwort vom Programmer");
      await new Promise((r) => { this.wake = r; setTimeout(r, Math.min(left, 50)); });
    }
    return this.buf.splice(0, n);
  }
  flush() { this.buf.length = 0; }
  write(bytes) { return this.writer.write(new Uint8Array(bytes)); }
  async close() {
    try { await this.reader.cancel(); } catch {}
    try { this.reader.releaseLock(); } catch {}
    try { this.writer.releaseLock(); } catch {}
    await Promise.race([this.loop, sleep(500)]).catch(() => {});
    try { await this.port.close(); } catch {}
  }
}

// ---- Arduino as ISP (STK500v1 over serial, 19200 baud)
const STK = { OK: 0x10, INSYNC: 0x14, EOP: 0x20 };

export class ArduinoIsp extends IspBase {
  constructor(port, { log, baud = 19200 } = {}) { super(log); this.link = new SerialLink(port); this.baud = baud; }
  async tx(bytes, nData = 0, timeout = 1000) {
    await this.link.write([...bytes, STK.EOP]);
    const [s] = await this.link.read(1, timeout);
    if (s !== STK.INSYNC) throw new Error(`Arduino as ISP: nicht synchron (0x${hex2(s)})`);
    const data = nData ? await this.link.read(nData, timeout) : [];
    const [ok] = await this.link.read(1, timeout);
    if (ok !== STK.OK) throw new Error(`Arduino as ISP: Fehler 0x${hex2(ok)}`);
    return data;
  }
  async open() {
    await this.link.open(this.baud);
    // Auto-reset: pulse DTR/RTS, then wait for the bootloader to hand over.
    try {
      await this.link.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      await sleep(100);
      await this.link.port.setSignals({ dataTerminalReady: true, requestToSend: true });
    } catch {}
    await sleep(2000);
    let synced = false;
    for (let i = 0; i < 10 && !synced; i++) {
      this.link.flush();
      await this.link.write([0x30, STK.EOP]);
      try {
        const r = await this.link.read(2, 300);
        synced = r[0] === STK.INSYNC && r[1] === STK.OK;
      } catch {}
    }
    if (!synced) throw new Error("Arduino as ISP antwortet nicht. Läuft der ArduinoISP-Sketch? Richtiger Port?");
    this.link.flush();
    // STK_SET_DEVICE: ArduinoISP needs page size (32), EEPROM size (64), flash size (1024)
    await this.tx([0x42, 0, 0, 0, 1, 1, 1, 1, 2, 0xff, 0xff, 0xff, 0xff, 0x00, 0x20, 0x00, 0x40, 0, 0, 0x04, 0x00]);
    await this.tx([0x45, 4, 4, 0, 0, 0]);   // SET_DEVICE_EXT (ignored by ArduinoISP)
    await this.tx([0x50], 0, 2000);         // ENTER_PROGMODE
  }
  async cmd(c) { const [r] = await this.tx([0x56, ...c], 1); return [0, 0, 0, r]; }
  async writeFlash(image, len, progress) {
    const pages = Math.ceil(len / PAGE_SIZE);
    for (let p = 0; p < pages; p++) {
      const a0 = p * PAGE_SIZE, w = a0 >> 1;
      const page = image.subarray(a0, a0 + PAGE_SIZE);
      if (page.every((b) => b === 0xff)) continue;
      await this.tx([0x55, w & 0xff, (w >> 8) & 0xff]);
      await this.tx([0x64, 0, PAGE_SIZE, 0x46, ...page], 0, 2000);
      progress?.((p + 1) / pages);
    }
  }
  async readFlash(len, progress) {
    const out = new Uint8Array(len);
    for (let a = 0; a < len; a += PAGE_SIZE) {
      const n = Math.min(PAGE_SIZE, len - a), w = a >> 1;
      await this.tx([0x55, w & 0xff, (w >> 8) & 0xff]);
      out.set(await this.tx([0x74, 0, n, 0x46], n), a);
      progress?.((a + n) / len);
    }
    return out;
  }
  async close() {
    await this.tx([0x51]).catch(() => {});
    await this.link.close();
  }
}

// ---- STK500v2 protocol (serial framing or AVRISP mkII USB bulk)
class Stk2Serial {
  constructor(port, baud) { this.link = new SerialLink(port); this.baud = baud; this.seq = 0; }
  async open() { await this.link.open(this.baud); await sleep(50); this.link.flush(); }
  async send(body, timeout = 1500) {
    const seq = this.seq; this.seq = (this.seq + 1) & 0xff;
    const f = [0x1b, seq, body.length >> 8, body.length & 0xff, 0x0e, ...body];
    f.push(f.reduce((x, b) => x ^ b, 0));
    await this.link.write(f);
    const end = Date.now() + timeout;
    for (;;) {
      let [b] = await this.link.read(1, Math.max(50, end - Date.now()));
      if (b !== 0x1b) continue;
      const h = await this.link.read(4, timeout);
      if (h[3] !== 0x0e) continue;
      const len = (h[1] << 8) | h[2];
      const data = await this.link.read(len + 1, timeout);
      const cs = [0x1b, ...h, ...data].reduce((x, v) => x ^ v, 0);
      if (cs !== 0) throw new Error("STK500v2: Prüfsummenfehler");
      if (h[0] !== seq) continue;
      return data.slice(0, len);
    }
  }
  close() { return this.link.close(); }
}

class Stk2Usb {
  constructor(dev, log) { this.dev = dev; this.log = log; }
  async open() {
    await openUsb(this.dev, this.log);
    const alt = this.dev.configuration.interfaces[0].alternate;
    const ep = (dir) => alt.endpoints.find((e) => e.direction === dir && e.type === "bulk");
    this.epOut = ep("out")?.endpointNumber ?? 2;
    this.epIn = ep("in")?.endpointNumber ?? 2;
    this.packet = ep("in")?.packetSize ?? 64;
  }
  async send(body) {
    await this.dev.transferOut(this.epOut, new Uint8Array(body));
    if (body.length % this.packet === 0) await this.dev.transferOut(this.epOut, new Uint8Array(0));
    const out = [];
    for (;;) {
      const r = await this.dev.transferIn(this.epIn, this.packet);
      const chunk = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      out.push(...chunk);
      if (chunk.length < this.packet) break;
    }
    return out;
  }
  async close() { try { await this.dev.close(); } catch {} }
}

// SCK values: STK500 scale (serial programmers) and AVRISP mkII scale
const STK2_SCK = {
  stk500: { normal: 3 /* 57.6 kHz */, slow: 19 /* ~16 kHz */, slowest: 153 /* ~2 kHz */ },
  mkii: { normal: 7 /* ~96 kHz */, slow: 43 /* ~16 kHz */, slowest: 87 /* ~2 kHz */ },
};

export class Stk500v2 extends IspBase {
  // transport: { kind: "serial", port, baud } or { kind: "usb", dev }
  constructor(t, { sck = "normal", log } = {}) {
    super(log);
    this.t = t.kind === "usb" ? new Stk2Usb(t.dev, log) : new Stk2Serial(t.port, t.baud || 115200);
    this.sck = sck;
  }
  async x(body, expectLen) {
    const r = await this.t.send(body);
    if (r[0] !== body[0]) throw new Error(`STK500v2: unerwartete Antwort 0x${hex2(r[0] ?? 0)}`);
    if (r[1] !== 0) throw new Error(`STK500v2: Befehl 0x${hex2(body[0])} fehlgeschlagen (Status 0x${hex2(r[1])})`);
    if (expectLen && r.length < expectLen) throw new Error("STK500v2: Antwort zu kurz");
    return r;
  }
  async open() {
    await this.t.open();
    let name = null;
    for (let i = 0; i < 4 && !name; i++) {
      try {
        const r = await this.x([0x01]);
        name = String.fromCharCode(...r.slice(3, 3 + r[2]));
      } catch (e) { if (i === 3) throw new Error(`Kein STK500v2-Programmer gefunden (${e.message}). Richtiger Port/Modus?`); await sleep(200); }
    }
    this.log(`Programmer meldet sich als „${name}“.`);
    const scale = /MK2|MKII/i.test(name) || this.t instanceof Stk2Usb ? "mkii" : "stk500";
    try { await this.x([0x02, 0x98, STK2_SCK[scale][this.sck]]); }
    catch { this.log("ISP-Takt nicht gesetzt – der Programmer nutzt seinen eigenen Takt."); }
    // CMD_ENTER_PROGMODE_ISP with the ATtiny13 values from avrdude.conf
    await this.x([0x10, 200, 100, 25, 32, 0, 0x53, 3, 0xac, 0x53, 0, 0]).catch(() => {
      throw new Error("Chip antwortet nicht (Programmiermodus). Verkabelung, Stromversorgung und ISP-Takt prüfen.");
    });
  }
  async signature() {
    const s = [];
    for (let i = 0; i < 3; i++) s.push((await this.x([0x1b, 4, 0x30, 0, i, 0], 3))[2]);
    return s;
  }
  async readFuses() {
    const low = (await this.x([0x18, 4, 0x50, 0, 0, 0], 3))[2];
    const high = (await this.x([0x18, 4, 0x58, 0x08, 0, 0], 3))[2];
    return { low, high };
  }
  async writeFuse(which, v) { await this.x([0x17, 0xac, which === "low" ? 0xa0 : 0xa8, 0, v]); }
  async erase() { await this.x([0x12, 10, 0, 0xac, 0x80, 0, 0]); }
  async loadAddr(w) { await this.x([0x06, 0, 0, (w >> 8) & 0xff, w & 0xff]); }
  async writeFlash(image, len, progress) {
    const pages = Math.ceil(len / PAGE_SIZE);
    for (let p = 0; p < pages; p++) {
      const a0 = p * PAGE_SIZE;
      const page = image.subarray(a0, a0 + PAGE_SIZE);
      if (page.every((b) => b === 0xff)) continue;
      await this.loadAddr(a0 >> 1);
      // mode 0xC1: page mode, RDY/BSY polling, write page; delay 6 ms
      await this.x([0x13, 0, PAGE_SIZE, 0xc1, 6, 0x40, 0x4c, 0x20, 0xff, 0xff, ...page]);
      progress?.((p + 1) / pages);
    }
  }
  async readFlash(len, progress) {
    const out = new Uint8Array(len);
    for (let a = 0; a < len; a += PAGE_SIZE) {
      const n = Math.min(PAGE_SIZE, len - a);
      await this.loadAddr(a >> 1);
      const r = await this.x([0x14, 0, n, 0x20], n + 2);
      out.set(r.slice(2, 2 + n), a);
      progress?.((a + n) / len);
    }
    return out;
  }
  async close() {
    await this.x([0x11, 1, 1]).catch(() => {});
    await this.t.close();
  }
}
