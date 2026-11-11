# Builds the configurable firmware (V3). Needs avr-gcc and avr-libc.
#   make            -> fad_configurable.hex
#   make size       -> flash/RAM usage

MCU    = attiny13a
F_CPU  = 1200000UL
CFLAGS = -mmcu=$(MCU) -DF_CPU=$(F_CPU) -Os -Wall -Wextra -std=gnu11

all: fad_configurable.hex

fad_configurable.elf: fad_configurable.c
	avr-gcc $(CFLAGS) -o $@ $<

fad_configurable.hex: fad_configurable.elf
	avr-objcopy -O ihex -R .eeprom $< $@

size: fad_configurable.elf
	avr-size $<

clean:
	rm -f fad_configurable.elf

.PHONY: all size clean
