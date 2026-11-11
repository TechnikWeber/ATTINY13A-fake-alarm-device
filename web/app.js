import {
  FLASH_SIZE, SIGNATURE, TICK_MS, FACTORY_FUSES, KNOWN_USB,
  parseHex, toHex, findConfig, writeConfig, parseUsbId, fmtUsbId, hexBytes,
  UsbAsp, UsbTiny, Stk500v2, ArduinoIsp,
} from "./fad.js";

const $ = (id) => document.getElementById(id);
const nf = (v, d = 0) => v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

const FW_FILES = {
  v3: "fad_configurable.hex",
  v2: "fake_alarm_5s_3ms_default_V2.hex",
  v1: "fake_alarm_5s_3ms_default.hex",
};
const firmware = {};   // name -> { image, used, cfgOff }

// ------------------------------------------------------------ settings

const PRESETS = {
  orig:   { onTime: 3,  interval: 5,  flashes: 1, gap: 256, boot: 0 },
  alarm:  { onTime: 5,  interval: 2,  flashes: 1, gap: 256, boot: 0 },
  double: { onTime: 4,  interval: 4,  flashes: 2, gap: 160, boot: 0 },
  saver:  { onTime: 2,  interval: 10, flashes: 1, gap: 256, boot: 0 },
  camera: { onTime: 20, interval: 1,  flashes: 1, gap: 256, boot: 0 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (id, fallback) => { const v = parseFloat(String($(id).value).replace(",", ".")); return Number.isFinite(v) ? v : fallback; };

function readSettings() {
  return {
    onTime: clamp(Math.round(num("onTime", 3) * 10), 1, 1000),
    interval: clamp(Math.round((num("interval", 5) * 1000) / TICK_MS), 1, 65535),
    flashes: clamp(Math.round(num("flashes", 1)), 1, 9),
    gap: clamp(Math.round(num("gap", 256) / TICK_MS), 1, 500),
    bootFlashes: clamp(Math.round(num("boot", 0)), 0, 9),
    ledPin: +$("ledPin").value,
    activeHigh: $("polarity").value === "high",
  };
}

const fwChoice = () => document.querySelector('input[name="fw"]:checked').value;

function effective() {
  if (fwChoice() !== "v3") return { onTime: 30, interval: 320, flashes: 1, gap: 16, bootFlashes: 0, ledPin: 0, activeHigh: false, fixed: true };
  return readSettings();
}

function updateView() {
  const c = effective();
  $("cfgArea").classList.toggle("disabled", !!c.fixed);
  $("gapField").style.opacity = c.flashes > 1 ? 1 : 0.5;
  const onMs = c.onTime / 10, intMs = c.interval * TICK_MS, gapMs = c.gap * TICK_MS;
  $("intervalHint").textContent = `wird ${nf(intMs / 1000, 3)} s (${c.interval} × 16 ms Watchdog, ±10 %)`;
  $("gapHint").textContent = `wird ${nf(gapMs)} ms (Schritte zu 16 ms)`;
  $("onTimeHint").textContent = `wird ${nf(onMs, 1)} ms · 0,1 – 100 ms. Länger = besser sichtbar, mehr Strom.`;

  // timeline
  const burst = c.flashes * onMs + (c.flashes - 1) * gapMs;
  const period = burst + intMs;
  const W = 600, top = 8, base = 62;
  const x = (t) => 4 + (t / period) * (W - 8);
  let s = `<line class="axis" x1="4" y1="${base}" x2="${W - 4}" y2="${base}"/>`;
  for (let i = 0; i < c.flashes; i++) {
    const t0 = i * (onMs + gapMs);
    const w = Math.max(2, x(t0 + onMs) - x(t0));
    s += `<rect class="pulse" x="${x(t0)}" y="${top}" width="${w}" height="${base - top}" rx="1"/>`;
  }
  $("timeline").innerHTML = s;

  // power estimate
  const R = clamp(num("resistor", 3300), 100, 1e6);
  const iLed = Math.max(0, (3.0 - 1.9) / R) * 1000;       // mA
  const iActive = iLed + 0.25;                              // + CPU at 1.2 MHz
  const avg = num("baseCurrent", 8) / 1000 + (iActive * c.flashes * onMs) / period; // mA
  const hours = 220 / avg;
  $("stats").innerHTML =
    `<span>Zyklus <b>${nf(period / 1000, 2)} s</b></span>` +
    `<span>≈ <b>${nf(3600000 / period, 0)}</b> Blinken/h</span>` +
    `<span>Mittel <b>${nf(avg * 1000, 1)} µA</b></span>` +
    `<span>CR2032 <b>≈ ${nf(hours / 8760, 1)} Jahre</b> theoretisch, realistisch ~${nf((hours / 8760) * 0.6, 1)}</span>`;

  $("fileName").textContent = fileName();
  $("avrdudeCmd").textContent = `avrdude -c usbasp -p t13 -U flash:w:${fileName()}:i`;
  restartLed();
}

// LED preview in real time (very short flashes get at least one frame)
let ledTimer = null;
function restartLed() {
  clearTimeout(ledTimer);
  const led = $("led");
  const c = effective();
  const onMs = c.onTime / 10, gapMs = c.gap * TICK_MS, intMs = c.interval * TICK_MS;
  const shown = Math.max(onMs, 40);
  led.style.opacity = "";
  let i = 0;
  const step = () => {
    led.classList.add("on");
    led.style.filter = `brightness(${Math.min(1, 0.55 + onMs / 20)})`;
    ledTimer = setTimeout(() => {
      led.classList.remove("on");
      i++;
      const pause = i < c.flashes ? Math.max(0, gapMs - (shown - onMs)) : Math.max(0, intMs - (shown - onMs));
      if (i >= c.flashes) i = 0;
      ledTimer = setTimeout(step, pause);
    }, shown);
  };
  ledTimer = setTimeout(step, 300);
}

function fileName() {
  const f = fwChoice();
  if (f !== "v3") return FW_FILES[f];
  const c = readSettings();
  const s = (v) => nf(v, 3).replace(/,?0+$/, "").replace(",", ".");
  return `fad_${s((c.interval * TICK_MS) / 1000)}s_${s(c.onTime / 10)}ms${c.flashes > 1 ? `_${c.flashes}x` : ""}.hex`;
}

async function loadFirmware(name) {
  if (firmware[name]) return firmware[name];
  const r = await fetch(FW_FILES[name], { cache: "no-cache" });
  if (!r.ok) throw new Error(`${FW_FILES[name]} nicht gefunden (${r.status})`);
  const { image, used } = parseHex(await r.text());
  const cfgOff = name === "v3" ? findConfig(image) : -1;
  if (name === "v3" && cfgOff < 0) throw new Error("Einstellungsblock in der Firmware nicht gefunden");
  return (firmware[name] = { image, used, cfgOff });
}

async function buildImage() {
  const name = fwChoice();
  const fw = await loadFirmware(name);
  const image = name === "v3" ? writeConfig(fw.image, fw.cfgOff, readSettings()) : new Uint8Array(fw.image);
  return { image, used: fw.used };
}

function download(text, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------ programmer selection

const PROGS = {
  usbasp:   { usb: true,  id: "16c0:05dc", sck: true },
  usbtiny:  { usb: true,  id: "1781:0c9f", sck: true },
  mkii:     { usb: true,  id: "03eb:2104", sck: true },
  stk500v2: { usb: false, baud: 115200, sck: true },
  arduino:  { usb: false, baud: 19200, sck: false },
};
const progChoice = () => document.querySelector('input[name="prog"]:checked').value;
let device = null;   // USBDevice or SerialPort
let deviceKind = null;

function setDevice(d, kind, text) {
  device = d; deviceKind = kind;
  $("deviceInfo").innerHTML = text;
  $("deviceInfo").classList.toggle("found", !!d);
}

function describeUsb(d) {
  const id = fmtUsbId(d.vendorId, d.productId);
  const known = KNOWN_USB.find((k) => k.vid === d.vendorId && k.pid === d.productId);
  const name = [d.manufacturerName, d.productName].filter(Boolean).join(" ") || "USB-Gerät";
  return { id, known, text: `<b>${esc(name)}</b> · <code>${id}</code>${known ? ` · erkannt als ${esc(known.name)}` : ""}` };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function onProgChange() {
  const p = PROGS[progChoice()];
  $("usbIdField").hidden = !p.usb;
  $("baudField").hidden = p.usb;
  $("sckField").hidden = !p.sck;
  if (p.usb) $("usbId").value = p.id;
  else $("baud").value = p.baud;
  $("showAll").parentElement.hidden = !p.usb;
  setDevice(null, null, "Noch kein Programmer ausgewählt.");
  autoPick();
}

async function autoPick() {
  const kind = progChoice();
  try {
    if (PROGS[kind].usb && navigator.usb) {
      const want = parseUsbId($("usbId").value);
      const list = await navigator.usb.getDevices();
      const d = list.find((x) => want && x.vendorId === want.vid && x.productId === want.pid);
      if (d) setDevice(d, kind, describeUsb(d).text + " · schon freigegeben");
    } else if (!PROGS[kind].usb && navigator.serial) {
      const ports = await navigator.serial.getPorts();
      if (ports.length === 1) setDevice(ports[0], kind, describePort(ports[0]) + " · schon freigegeben");
    }
  } catch {}
}

function describePort(p) {
  const i = p.getInfo?.() || {};
  return i.usbVendorId ? `<b>Serieller Port</b> · USB <code>${fmtUsbId(i.usbVendorId, i.usbProductId)}</code>` : "<b>Serieller Port</b>";
}

async function search() {
  const kind = progChoice();
  try {
    if (PROGS[kind].usb) {
      if (!navigator.usb) throw new Error("Dieser Browser kann kein WebUSB (Chrome oder Edge nehmen).");
      const filters = [];
      const want = parseUsbId($("usbId").value);
      if (!want && !$("showAll").checked) throw new Error("USB-ID ungültig – Format VID:PID, z. B. 16c0:05dc");
      if (!$("showAll").checked) {
        filters.push({ vendorId: want.vid, productId: want.pid });
        for (const k of KNOWN_USB) if (!(k.vid === want.vid && k.pid === want.pid)) filters.push({ vendorId: k.vid, productId: k.pid });
      }
      const d = await navigator.usb.requestDevice({ filters });
      const info = describeUsb(d);
      // Detected a known programmer of another type -> switch the driver.
      if (info.known && info.known.kind !== kind) {
        document.querySelector(`input[name="prog"][value="${info.known.kind}"]`).checked = true;
        onProgChange();
        log(`Erkannt: ${info.known.name} – Programmer-Typ umgestellt.`);
      }
      $("usbId").value = info.id;
      setDevice(d, info.known ? info.known.kind : progChoice(), info.text);
      if (!info.known) log(`Unbekanntes Gerät ${info.id} – wird als „${progChoice()}“ angesprochen.`);
    } else {
      if (!navigator.serial) throw new Error("Dieser Browser kann kein Web Serial (Chrome oder Edge nehmen).");
      const p = await navigator.serial.requestPort();
      setDevice(p, kind, describePort(p));
    }
  } catch (e) {
    if (e.name === "NotFoundError") log("Kein Gerät ausgewählt.");
    else log(e.message, "err");
  }
}

function makeProgrammer() {
  const kind = progChoice();
  if (!device || deviceKind !== kind) throw new Error("Erst „Programmer suchen“ und ein Gerät auswählen.");
  const opts = { sck: $("sck").value, log };
  switch (kind) {
    case "usbasp": return new UsbAsp(device, opts);
    case "usbtiny": return new UsbTiny(device, opts);
    case "mkii": return new Stk500v2({ kind: "usb", dev: device }, opts);
    case "stk500v2": return new Stk500v2({ kind: "serial", port: device, baud: +$("baud").value || 115200 }, opts);
    case "arduino": return new ArduinoIsp(device, { log, baud: +$("baud").value || 19200 });
  }
}

// ------------------------------------------------------------ actions

function log(msg, cls) {
  const el = $("log");
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = msg;
  el.append(line);
  el.scrollTop = el.scrollHeight;
}
const bar = (f, done) => { $("bar").style.width = `${Math.round(f * 100)}%`; $("bar").classList.toggle("done", !!done); };

let busy = false;
async function run(task) {
  if (busy) return;
  busy = true;
  for (const b of ["flashBtn", "testBtn", "readBtn", "searchBtn"]) $(b).disabled = true;
  $("log").textContent = "";
  bar(0);
  let prog = null;
  try {
    prog = makeProgrammer();
    log("Verbinde …");
    await prog.open();
    const sig = await prog.signature();
    log(`Signatur: ${hexBytes(sig)}`);
    if (sig.every((b) => b === 0) || sig.every((b) => b === 0xff))
      throw new Error("Keine gültige Signatur – Verkabelung, Stromversorgung oder ISP-Takt prüfen.");
    if (sig.some((b, i) => b !== SIGNATURE[i]))
      throw new Error(`Das ist kein ATtiny13/13A (erwartet ${hexBytes(SIGNATURE)}).`);
    log("ATtiny13/13A gefunden.", "ok");
    const fuses = await prog.readFuses();
    log(`Fuses: lfuse 0x${hexBytes([fuses.low])}, hfuse 0x${hexBytes([fuses.high])}`);
    if ((fuses.low & 0x03) !== 0x02) log("Achtung: Takt ist nicht der interne 9,6-MHz-Oszillator – Zeiten stimmen nicht. Fuses auf Werkseinstellung setzen.", "err");
    if ((fuses.high & 0x06) !== 0x06) log("Achtung: BOD ist an – kostet ~20 µA, die Batterie hält nur Wochen. Fuses auf Werkseinstellung setzen.", "err");
    await task(prog, fuses);
  } catch (e) {
    log(e.message || String(e), "err");
    if (/Access denied|SecurityError|Failed to open|NetworkError/i.test(e.message || ""))
      log("Kein Zugriff aufs Gerät: unter Linux udev-Regel/dialout, unter Windows WinUSB-Treiber (siehe Hilfe). Anderes Programm (avrdude, Arduino-IDE) offen?");
  } finally {
    if (prog) await prog.close().catch(() => {});
    busy = false;
    for (const b of ["flashBtn", "testBtn", "readBtn", "searchBtn"]) $(b).disabled = false;
  }
}

async function doFlash(prog, fuses) {
  const { image, used } = await buildImage();
  log(`Firmware: ${fileName()} (${used} Bytes)`);
  log("Lösche Chip …");
  await prog.erase();
  log("Schreibe …");
  await prog.writeFlash(image, used, (f) => bar(f * 0.5));
  log("Prüfe …");
  const back = await prog.readFlash(used, (f) => bar(0.5 + f * 0.5));
  const bad = back.findIndex((b, i) => b !== image[i]);
  if (bad >= 0) throw new Error(`Prüfung fehlgeschlagen bei Adresse 0x${bad.toString(16)}: ${hexBytes([back[bad]])} statt ${hexBytes([image[bad]])}. ISP-Takt langsamer stellen.`);
  if ($("setFuses").checked) {
    if (fuses.low !== FACTORY_FUSES.low) await prog.writeFuse("low", FACTORY_FUSES.low);
    if (fuses.high !== FACTORY_FUSES.high) await prog.writeFuse("high", FACTORY_FUSES.high);
    const f = await prog.readFuses();
    log(`Fuses jetzt: lfuse 0x${hexBytes([f.low])}, hfuse 0x${hexBytes([f.high])}`, f.low === FACTORY_FUSES.low && f.high === FACTORY_FUSES.high ? "ok" : "err");
  }
  bar(1, true);
  log("Fertig – geschrieben und geprüft. Programmer abziehen, Batterie einlegen.", "ok");
}

async function doTest() {
  bar(1, true);
  log("Verbindung ok.", "ok");
}

async function doRead(prog) {
  const data = await prog.readFlash(FLASH_SIZE, (f) => bar(f));
  let used = FLASH_SIZE;
  while (used > 0 && data[used - 1] === 0xff) used--;
  used = Math.ceil(used / 2) * 2;
  download(toHex(data, used), "attiny13a_backup.hex");
  bar(1, true);
  log(`Ausgelesen: ${used} Bytes belegt, als attiny13a_backup.hex gespeichert.`, "ok");
}

// ------------------------------------------------------------ wiring

function init() {
  for (const id of ["onTime", "interval", "flashes", "gap", "boot", "ledPin", "polarity", "resistor", "baseCurrent"])
    $(id).addEventListener("input", updateView);
  for (const r of document.querySelectorAll('input[name="fw"]')) r.addEventListener("change", updateView);
  for (const b of document.querySelectorAll("[data-preset]")) {
    b.addEventListener("click", () => {
      const p = PRESETS[b.dataset.preset];
      $("onTime").value = p.onTime; $("interval").value = p.interval; $("flashes").value = p.flashes;
      $("gap").value = p.gap; $("boot").value = p.boot;
      updateView();
    });
  }
  for (const b of document.querySelectorAll("[data-copy]")) {
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); b.textContent = "Kopiert"; }
      catch { b.textContent = "Bitte markieren"; }
      setTimeout(() => (b.textContent = "Kopieren"), 1500);
    });
  }
  for (const r of document.querySelectorAll('input[name="prog"]')) r.addEventListener("change", onProgChange);
  $("usbId").addEventListener("change", () => { setDevice(null, null, "Noch kein Programmer ausgewählt."); autoPick(); });

  $("downloadBtn").addEventListener("click", async () => {
    try {
      const { image, used } = await buildImage();
      download(toHex(image, used), fileName());
    } catch (e) { log(e.message, "err"); }
  });
  $("searchBtn").addEventListener("click", search);
  $("flashBtn").addEventListener("click", () => run(doFlash));
  $("testBtn").addEventListener("click", () => run(doTest));
  $("readBtn").addEventListener("click", () => run(doRead));

  const missing = [];
  if (!("usb" in navigator)) missing.push("WebUSB");
  if (!("serial" in navigator)) missing.push("Web Serial");
  if (missing.length) {
    $("browserNotice").hidden = false;
    $("browserNotice").innerHTML = `Dieser Browser kann kein ${missing.join(" und kein ")}. Zum Flashen Chrome, Edge oder einen anderen Chromium-Browser am Desktop nehmen – oder in Schritt 2 die <code>.hex</code> speichern und mit avrdude flashen.`;
  }
  navigator.usb?.addEventListener("connect", (e) => {
    const info = describeUsb(e.device);
    log(`Eingesteckt: ${info.id}${info.known ? ` (${info.known.name})` : ""}`);
    autoPick();
  });
  navigator.usb?.addEventListener("disconnect", (e) => {
    if (e.device === device) setDevice(null, null, "Programmer abgezogen.");
  });

  onProgChange();
  updateView();
  loadFirmware("v3").catch((e) => log(`Firmware konnte nicht geladen werden: ${e.message}`, "err"));
}

init();
