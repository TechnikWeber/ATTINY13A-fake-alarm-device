<img width="463" height="391" alt="image" src="https://github.com/user-attachments/assets/a8dc4973-b65d-4e64-a395-536100b6417c" />

<img width="487" height="388" alt="image" src="https://github.com/user-attachments/assets/adc7db20-9d0c-43a8-8bf3-e2cf133b17c3" />

# Fake-Alarmanlagen-LED mit ATtiny13A

Ein extrem stromsparendes Projekt, bei dem ein ATtiny13A eine LED in regelmäßigen Abständen kurz aufblitzen lässt, um eine aktive Alarmanlage zu simulieren. Versorgt aus einer einzelnen CR2032-Knopfzelle hält die Schaltung **mindestens ein Jahr** durch.

## Funktionsweise

Der Mikrocontroller schläft die meiste Zeit im Power-Down-Modus (~5 µA) und wird vom Watchdog-Timer alle ~1 Sekunde geweckt. Nach der eingestellten Anzahl Wakeups (z.B. 5 für 5 Sekunden) wird die LED kurz angeschaltet (z.B. 3 ms), danach geht der Chip wieder schlafen.

## Hardware

| Bauteil | Wert / Typ |
|---|---|
| MCU | ATtiny13A (DIP-8 oder SOIC-8) |
| Stromversorgung | CR2032 (3 V) |
| Stützkondensator | 100 nF parallel zu VCC |
| LED | beliebige Low-Current-LED |
| Vorwiderstand LED | 3,3 kΩ |
| Reset-Pullup | 1 MΩ gegen VCC (statt 100 kΩ — spart ~25 µA!) |

### Schaltung

```
                  CR2032 (3V)
                     |
                    +++
                    | | 1 MΩ
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


   VCC ----[3,3 kΩ]----[LED Anode]
                       [LED Kathode] ---- PB0 (Pin 5, ATtiny13A)
```

**Hinweis:** Die LED ist low-active, d.h. sie leuchtet wenn PB0 auf LOW gezogen wird. Das spart minimal Strom gegenüber dem Anschluss gegen GND.

### Pinbelegung ATtiny13A (DIP-8)

```
         ┌──┬──┐
   RESET │1 └ 8│ VCC
     PB3 │2   7│ PB2
     PB4 │3   6│ PB1
     GND │4   5│ PB0  ── LED
         └─────┘
```

## Versionen

Im Repo liegen mehrere vorkompilierte `.hex`-Dateien:

| Datei | Blitzdauer | Intervall |
|---|---|---|
| `fake_alarm_3s_3ms.hex` | 3 ms | 3 s |
| `fake_alarm_3s_5ms.hex` | 5 ms | 3 s |
| `fake_alarm_5s_3ms.hex` | 3 ms | 5 s |

Empfohlen: **`fake_alarm_3ms_5s.hex`** — guter Kompromiss aus Sichtbarkeit, Stromverbrauch und realistischem Verhalten.

## Software-Voraussetzungen (Windows)

### 1. avrdude installieren
- Download: https://github.com/avrdudes/avrdude/releases
- ZIP entpacken nach z.B. `C:\avrdude\`
- Optional: Verzeichnis zur PATH-Umgebungsvariable hinzufügen

### 2. Treiber für Diamex ISP-Prog-NG (USBasp-kompatibel)
Falls Windows den Programmer nicht erkennt:
- **Zadig** herunterladen: https://zadig.akeo.ie/
- Diamex anstecken, Zadig starten
- *Options → List All Devices*
- "USBasp" auswählen
- Treiber **libusbK** (oder libusb-win32) wählen → *Install Driver*

### 3. Optional: AVR-Toolchain (nur falls selbst kompiliert werden soll)
- Zak Kemble's AVR-GCC Builds: https://blog.zakkemble.net/avr-gcc-builds/

## Verkabelung Programmer ↔ ATtiny13A

| Diamex ISP-Prog-NG (6-pol) | ATtiny13A Pin |
|---|---|
| MISO | PB1 (Pin 6) |
| VCC | VCC (Pin 8) |
| SCK | PB2 (Pin 7) |
| MOSI | PB0 (Pin 5) |
| RESET | RESET (Pin 1) |
| GND | GND (Pin 4) |

> ⚠️ **Wichtig:** Während des Programmierens **entweder** die CR2032 entfernen **oder** die Target-Power des Programmers deaktivieren — niemals beides gleichzeitig versorgen!

## Flashen

Eingabeaufforderung im Verzeichnis mit der `.hex`-Datei öffnen:

```cmd
avrdude -c usbasp -p t13 -U flash:w:fake_alarm_3ms_5s.hex:i
```

## Fuses setzen (nur nötig wenn sie abweichen, standardmäßig sollte es schon passen!)

```cmd
avrdude -c usbasp -p t13 -U lfuse:w:0x6B:m -U hfuse:w:0xFF:m
```

| Fuse | Wert | Bedeutung |
|---|---|---|
| `lfuse` | `0x6A` | Int. RC 9.6 MHz, CKDIV8 aktiv → 1,2 MHz Takt |
| `hfuse` | `0xFF` | BOD aus, RSTDISBL aus, SPIEN aktiv |

> **Wichtig:** BOD muss aus sein — sonst zieht der Chip allein dafür ~20 µA und die Batterie hält keine drei Monate.

Fuses auslesen zur Kontrolle:

```cmd
avrdude -c usbasp -p t13 -U lfuse:r:-:h -U hfuse:r:-:h
```

Erwartete Ausgabe: `0x6b` und `0xff`.

## Selbst kompilieren

```cmd
avr-gcc -mmcu=attiny13a -DF_CPU=1200000UL -Os -Wall -o fake_alarm.elf fake_alarm_3ms_5s.c
avr-objcopy -O ihex -R .eeprom fake_alarm.elf fake_alarm.hex
avr-size --format=avr --mcu=attiny13a fake_alarm.elf
```

### Anpassungen im Quellcode

- **Blitzdauer ändern:** Wert in `_delay_ms(3);` anpassen (1–10 ms sind sinnvoll)
- **Intervall ändern:** Vergleichswert in `if (++counter >= 5)` anpassen (entspricht Sekunden)

## Strombudget

| Zustand | Stromverbrauch |
|---|---|
| Power-Down + WDT (Sleep) | ~5 µA |
| LED-Blitz (3 ms alle 5 s) | ~0,2 µA Mittelwert |
| Reset-Pullup 1 MΩ | ~3 µA |
| **Gesamt (Mittelwert)** | **~8 µA** |

Bei einer CR2032 mit ~220 mAh nutzbarer Kapazität:

```
220 mAh / 0,008 mA ≈ 27.500 h ≈ 3,1 Jahre (theoretisch)
```

In der Praxis (Selbstentladung der Batterie, Temperaturschwankungen): **realistisch 1,5–2 Jahre**.

## Troubleshooting

| Problem | Lösung |
|---|---|
| `could not find USB device` | Zadig-Treiber neu installieren, anderen USB-Port testen |
| `target doesn't answer` | Verkabelung prüfen, Taktrate reduzieren: Option `-B 10` ergänzen |
| `signature mismatch` | Falscher Chip-Typ, schlechter Kontakt, oder Chip defekt |
| LED blitzt nicht nach Einsetzen der Batterie | Fuses prüfen — vor allem CKDIV8-Bit (lfuse Bit 7 = 0) |
| Batterie hält nur Wochen statt Monate | BOD aktiviert? Pull-up zu niederohmig? Sleep-Strom mit Multimeter messen |
| Blitz zu schwach sichtbar | Längere Blitzdauer wählen (5 ms statt 3 ms) |

## Lizenz

[CC0-1.0](LICENSE) — Public Domain, mach was du willst damit.
