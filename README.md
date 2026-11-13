# ATtiny13A fake alarm light

<p>
  <a href="https://github.com/TechnikWeber/ATTINY13A-fake-alarm-device/actions/workflows/pages.yml"><img alt="build" src="https://img.shields.io/github/actions/workflow/status/TechnikWeber/ATTINY13A-fake-alarm-device/pages.yml?branch=main&label=build"></a>
  <img alt="MCU: ATtiny13A" src="https://img.shields.io/badge/MCU-ATtiny13A-blue">
  <img alt="Power: CR2032" src="https://img.shields.io/badge/power-CR2032%20%C2%B7%20~5%20%C2%B5A-informational">
  <img alt="PCB: KiCad" src="https://img.shields.io/badge/PCB-KiCad-informational">
  <img alt="Web flasher UI: Deutsch" src="https://img.shields.io/badge/web%20flasher-Deutsch-informational">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p>
  <a href="https://technikweber.github.io/ATTINY13A-fake-alarm-device/"><b>Configure and flash from the browser</b></a> &nbsp;·&nbsp;
  <a href="#firmware"><b>Firmware</b></a> &nbsp;·&nbsp;
  <a href="#flashing"><b>Flashing with avrdude</b></a> &nbsp;·&nbsp;
  <a href="ATTINY13A_AlarmDevice"><b>KiCad project</b></a>
</p>

An extremely low-power gadget: an ATtiny13A flashes an LED briefly at regular intervals
to fake an armed alarm system. Running from a single CR2032 coin cell, it lasts **at
least a year**.

> **Status: tested.** The device has been running on real hardware for a while and works.
> Pick the LED series resistor for your LED, see [Choosing the series resistor](#choosing-the-series-resistor).

![The round "Fake-Alarm-Device" PCB, rendered in KiCad](docs/board-3d.png)

<img width="463" alt="Photo" src="https://github.com/user-attachments/assets/a8dc4973-b65d-4e64-a395-536100b6417c" /> <img width="487" alt="Photo" src="https://github.com/user-attachments/assets/adc7db20-9d0c-43a8-8bf3-e2cf133b17c3" />

## How it works

The microcontroller spends almost all its time in power-down sleep (~4–5 µA) and is woken
by the watchdog timer: 4 s, then 1 s — 5 s in total. Then it switches the LED on for
3 ms and goes back to sleep. ADC, analog comparator, timer and the digital input buffers
are switched off; the CPU runs on the default fuses (9.6 MHz / 8 = 1.2 MHz).

## Hardware

| Part | Value / type |
|---|---|
| MCU | ATtiny13A (DIP-8 or SOIC-8) |
| Power | CR2032 (3 V) |
| Bypass capacitor | 100 nF across VCC |
| LED | any low-current LED |
| LED series resistor | 3.3 kΩ on the board — usually too dim, see [below](#choosing-the-series-resistor) |
| Reset pull-up | 100 kΩ to VCC (draws no current in operation, see [Power budget](#power-budget)) |

The KiCad project (schematic, PCB and production files) is in
[`ATTINY13A_AlarmDevice/`](ATTINY13A_AlarmDevice).

### Choosing the series resistor

The 3.3 kΩ in the BOM lets only about 0.3 mA through a red LED. With a 3 ms flash
you barely see it, especially in daylight. Better: **a smaller resistor and a shorter
flash.** What the eye sees as brightness is mostly the peak current; the battery only
pays for current × time, so 1 ms at 3 mA costs about as much as 3 ms at 1 mA.

| LED | Forward voltage | Series resistor | LED current at 3 V | Flash length |
|---|---|---|---|---|
| Red (e.g. the Würth 0805 on the board) | ~1.9–2.0 V | **330 Ω** (220–470 Ω) | ~3 mA | 1–2 ms |
| Yellow / orange | ~2.0–2.1 V | 270 Ω (220–390 Ω) | ~3 mA | 1–2 ms |
| Green (modern InGaN) | ~2.6–2.8 V | 68 Ω (47–100 Ω) | ~3 mA | 1–2 ms |
| Blue / white | ~2.8–3.0 V | 47 Ω (22–68 Ω) | 2–4 mA, drops as the cell empties | 1–2 ms |
| Low-current / high-efficiency red | ~1.8 V | 1 kΩ (680 Ω–1.5 kΩ) | ~1 mA | 2–3 ms |

`R = (3.0 V − forward voltage) / current`. Average cost of a 3 mA × 1 ms flash every 5 s:
0.6 µA — the battery life barely changes. Blue and white LEDs sit close to the cell
voltage, so they get dimmer as the CR2032 runs down; red is the most reliable choice.
Set the flash length in the [web flasher](https://technikweber.github.io/ATTINY13A-fake-alarm-device/)
(and enter your resistor there for the battery-life estimate). Do not go much above
~10 mA: the coin cell sags under heavy pulses.

### Circuit

```
                  CR2032 (3V)
                     |
                    +++
                    | | 100 kΩ
                    +++
                     |
        +------------+------------+
        |            |            |
        |          [VCC]        [RESET] -- ATtiny13A
        |            |
       === 100 nF    |
        |          [GND]
        |            |
        +------------+
                     |
                    GND


   VCC ----[3.3 kΩ]----[LED anode]
                       [LED cathode] ---- PB0 (pin 5, ATtiny13A)
```

**Note:** the LED is active low, i.e. it lights when PB0 is pulled LOW.

### ATtiny13A pinout (DIP-8)

```
         ┌──┬──┐
   RESET │1 └ 8│ VCC
     PB3 │2   7│ PB2
     PB4 │3   6│ PB1
     GND │4   5│ PB0  ── LED
         └─────┘
```

## Web flasher

The [web flasher](https://technikweber.github.io/ATTINY13A-fake-alarm-device/) sets the
blink pattern without a compiler and flashes the chip straight from the browser:

- **Pattern:** flash length (0.1–100 ms), pause (16 ms steps up to ~17 min), flashes per
  burst (double flash …), gap inside a burst, "battery OK" flashes at power-up, LED pin
  and polarity. A live preview and a battery-life estimate update as you type.
- **Save:** download the configured `.hex` and flash it with avrdude — this always works,
  in any browser.
- **Flash:** USBasp (incl. Diamex ISP-Prog-NG) is the recommended path; USBtinyISP and
  AVRISP mkII (experimental) also go over WebUSB, STK500v2 programmers and Arduino as ISP
  over Web Serial. The USB ID is preset per programmer and can be changed; "Programmer
  suchen" lists matching devices and switches the driver when it recognises one. The
  flasher checks the signature, erases, writes, verifies, and can reset the fuses to the
  factory values.

WebUSB and Web Serial need Chrome, Edge or another Chromium browser on the desktop. On
Windows the programmer needs the **WinUSB** driver for WebUSB (Zadig, see below); on
Linux the udev rule below. Nothing has been tested on real hardware with the browser yet —
if it does not work for you, save the `.hex` and flash it with avrdude.

## Firmware

In [`Firmware/`](Firmware):

| File | What it is |
|---|---|
| `raw_code.c` / `fake_alarm_5s_3ms_default.hex` | 3 ms flash every 5 s |
| `raw_code_V2.c` / `fake_alarm_5s_3ms_default_V2.hex` | Same, optimised: unused pins with pull-ups (no floating inputs), BOD off during sleep |
| `fad_configurable.c` / `fad_configurable.hex` | V3: V2 plus a settings block in flash that the web flasher patches; defaults are 3 ms every ~5 s — **recommended** |

V3 also sets the clock prescaler to 1.2 MHz in software, so the timing is right even if
the CKDIV8 fuse was changed. Pauses come from the watchdog oscillator, which is only
accurate to about ±10 %. Build it with `make` in `Firmware/`.

## Software requirements

### Windows

1. **avrdude:** download from <https://github.com/avrdudes/avrdude/releases>, unpack e.g. to
   `C:\avrdude\`, optionally add it to the PATH.
2. **Driver for the Diamex ISP-Prog-NG (USBasp-compatible)**, if Windows does not recognise
   the programmer: start **Zadig** (<https://zadig.akeo.ie/>) with the programmer plugged in,
   *Options → List All Devices*, select "USBasp", choose **libusbK** (or libusb-win32) →
   *Install Driver*. For the web flasher choose **WinUSB** instead — WebUSB only works
   with WinUSB.
3. Optional, only to compile yourself: an AVR-GCC toolchain, e.g. Zak Kemble's builds
   (<https://blog.zakkemble.net/avr-gcc-builds/>).

### Linux

```bash
sudo apt install avrdude gcc-avr avr-libc       # Debian, Ubuntu, Raspberry Pi OS
sudo dnf install avrdude avr-gcc avr-libc       # Fedora
```

`gcc-avr`/`avr-gcc` and `avr-libc` are only needed to compile yourself. No driver is
needed, but without a udev rule only root may talk to the programmer. Check its USB ID
with `lsusb` (USBasp-compatible programmers usually show `16c0:05dc`), then:

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="16c0", ATTR{idProduct}=="05dc", TAG+="uaccess"' \
  | sudo tee /etc/udev/rules.d/60-usbasp.rules
sudo udevadm control --reload-rules
```

Unplug the programmer and plug it back in.

## Wiring programmer ↔ ATtiny13A

| Diamex ISP-Prog-NG (6-pin) | ATtiny13A pin |
|---|---|
| MISO | PB1 (pin 6) |
| VCC | VCC (pin 8) |
| SCK | PB2 (pin 7) |
| MOSI | PB0 (pin 5) |
| RESET | RESET (pin 1) |
| GND | GND (pin 4) |

> [!WARNING]
> While programming, **either** remove the CR2032 **or** switch off the programmer's target
> power — never power from both at the same time!

## Flashing

Or use the [web flasher](https://technikweber.github.io/ATTINY13A-fake-alarm-device/).


```bash
avrdude -c usbasp -p t13 -U flash:w:Firmware/fake_alarm_5s_3ms_default_V2.hex:i
```

## Fuses

The firmware runs on the **factory default fuses** — normally nothing needs to be set.
Only if a chip was configured differently:

```bash
avrdude -c usbasp -p t13 -U lfuse:w:0x6A:m -U hfuse:w:0xFF:m
```

| Fuse | Value | Meaning |
|---|---|---|
| `lfuse` | `0x6A` | internal RC 9.6 MHz, CKDIV8 on → 1.2 MHz clock, SPIEN on |
| `hfuse` | `0xFF` | BOD off, RSTDISBL off, debugWIRE off |

> [!IMPORTANT]
> BOD must be off — otherwise the chip draws ~20 µA for it alone and the battery does not
> last three months.

Read the fuses back to check (expected: `0x6a` and `0xff`):

```bash
avrdude -c usbasp -p t13 -U lfuse:r:-:h -U hfuse:r:-:h
```

## Compile it yourself

```bash
avr-gcc -mmcu=attiny13a -DF_CPU=1200000UL -Os -Wall -o fake_alarm.elf Firmware/raw_code_V2.c
avr-objcopy -O ihex -R .eeprom fake_alarm.elf fake_alarm.hex
avr-size --format=avr --mcu=attiny13a fake_alarm.elf
```

**Adjust it:** the flash length is the value in `_delay_ms(3);` (1–10 ms makes sense); the
interval comes from the two watchdog sleeps `sleep_wdt(WDT_4S); sleep_wdt(WDT_1S);` — the
watchdog offers steps from 16 ms to 8 s.

## Power budget

| State | Current |
|---|---|
| Power-down + WDT (sleep) | ~5 µA |
| LED flash (3 ms every 5 s) | ~0.2 µA average |
| **Total (average)** | **~5 µA** |

The reset pull-up does not appear here: both of its ends sit at VCC, so no current
flows through it unless RESET is pulled low (during programming). Its value does not
affect battery life; 100 kΩ keeps RESET less sensitive to noise than a higher value.

With a CR2032 of ~220 mAh usable capacity:

```
220 mAh / 0.005 mA ≈ 44,000 h ≈ 5 years (theoretical)
```

In practice (battery self-discharge, temperature swings): **realistically about 2–3 years**. Measure the sleep current with a multimeter to check your build.

## Troubleshooting

| Problem | Fix |
|---|---|
| `could not find USB device` | Windows: reinstall the Zadig driver. Linux: check the udev rule (or try with `sudo`). Try another USB port |
| `target doesn't answer` | Check the wiring, slow down the programming clock: add `-B 10` |
| `signature mismatch` | Wrong chip type, bad contact, or a defective chip |
| LED does not flash after inserting the battery | Check the fuses — above all the CKDIV8 bit (lfuse bit 7 = 0) |
| Battery lasts weeks instead of months | BOD enabled? Pull-up too low? Measure the sleep current with a multimeter |
| Flash hard to see | Use a smaller series resistor (e.g. 330 Ω for red) and a shorter flash (1–2 ms), see [Choosing the series resistor](#choosing-the-series-resistor) |

## License

[MIT](LICENSE).
