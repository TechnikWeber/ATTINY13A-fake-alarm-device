/*
 * ATtiny13A fake alarm light – configurable firmware (V3)
 *
 * Same power strategy as raw_code_V2.c, but the timing lives in a small
 * settings block in flash (`fad_cfg`, starts with the magic "FADCFG").
 * The web flasher finds that block in the .hex file and patches it, so
 * nobody needs a compiler to change the blink pattern. The defaults below
 * match V2: one 3 ms flash every ~5 s.
 *
 * Hardware: LED at PB0, active LOW (LED lights when the pin is LOW).
 *
 * Timing:
 *   - Flash on-time: busy wait in 0.1 ms steps (CPU clock 1.2 MHz).
 *   - Pauses: power-down sleep, woken by the watchdog (128 kHz oscillator)
 *     in steps of 16 ms. Pauses are built from WDT periods
 *     8 s, 4 s, 2 s ... 16 ms. The watchdog oscillator is only accurate to
 *     roughly +-10 %, so are all pauses.
 *
 * Settings block layout (little endian, keep in sync with web/fad.js):
 *   0  char[6]  magic "FADCFG"
 *   6  uint8    layout version (1)
 *   7  uint8    flashes per burst (1..9)
 *   8  uint16   flash on-time in 0.1 ms (1..1000)
 *  10  uint16   gap between flashes of a burst, 16 ms ticks (1..)
 *  12  uint16   pause after a burst, 16 ms ticks (1..65535)
 *  14  uint8    LED pin PB0..PB4
 *  15  uint8    flags: bit 0 = LED active HIGH (default: active LOW)
 *  16  uint8    flashes at power-up as a "battery OK" sign (0..9)
 *  17  uint8    reserved (0)
 */

#include <avr/io.h>
#include <avr/interrupt.h>
#include <avr/pgmspace.h>
#include <avr/sleep.h>
#include <avr/wdt.h>
#include <util/delay.h>

struct fad_config {
    char     magic[6];
    uint8_t  version;
    uint8_t  flashes;
    uint16_t on_time;       /* 0.1 ms */
    uint16_t gap;           /* 16 ms ticks */
    uint16_t interval;      /* 16 ms ticks */
    uint8_t  led_pin;
    uint8_t  flags;
    uint8_t  boot_flashes;
    uint8_t  reserved;
};

#define FLAG_ACTIVE_HIGH 0x01

const struct fad_config fad_cfg PROGMEM __attribute__((used)) = {
    .magic        = { 'F', 'A', 'D', 'C', 'F', 'G' },
    .version      = 1,
    .flashes      = 1,
    .on_time      = 30,     /* 3 ms */
    .gap          = 16,     /* 256 ms, only used with flashes > 1 */
    .interval     = 312,    /* 4.99 s */
    .led_pin      = 0,      /* PB0 */
    .flags        = 0,      /* active LOW */
    .boot_flashes = 0,
    .reserved     = 0,
};

static uint8_t led_mask;
static uint8_t active_high;

ISR(WDT_vect) {
    /* only wakes the CPU */
}

/* n = 0..9 -> 16 ms * 2^n (16 ms ... 8 s) */
static void sleep_wdt(uint8_t n) {
    uint8_t bits = (n & 0x08) ? (uint8_t)((1 << WDP3) | (n & 0x07)) : n;
    wdt_reset();
    MCUSR &= ~(1 << WDRF);
    WDTCR |= (1 << WDCE) | (1 << WDE);
    WDTCR = (1 << WDTIE) | bits;
    sei();
    sleep_bod_disable();    /* no-op if BOD is already off via fuse */
    sleep_cpu();
    cli();
    WDTCR |= (1 << WDCE) | (1 << WDE);
    WDTCR = 0x00;
}

static void sleep_ticks(uint16_t t) {
    uint8_t n = 9;
    if (t == 0)
        t = 1;
    for (;;) {
        uint16_t step = (uint16_t)1 << n;
        if (t >= step) {
            sleep_wdt(n);
            t -= step;
        } else if (n == 0) {
            break;
        } else {
            n--;
        }
    }
}

static void led(uint8_t on) {
    if (on ^ active_high)
        PORTB &= ~led_mask;
    else
        PORTB |= led_mask;
}

/* 0.1 ms steps; the loop itself costs about 5 cycles at 1.2 MHz */
static void flash(uint16_t tenths) {
    led(1);
    while (tenths--)
        __builtin_avr_delay_cycles(F_CPU / 10000UL - 5);
    led(0);
}

int main(void) {
    /* Force 1.2 MHz even if the CKDIV8 fuse was cleared (9.6 MHz / 8). */
    CLKPR = (1 << CLKPCE);
    CLKPR = (1 << CLKPS1) | (1 << CLKPS0);

    uint8_t  flashes  = pgm_read_byte(&fad_cfg.flashes);
    uint16_t on_time  = pgm_read_word(&fad_cfg.on_time);
    uint16_t gap      = pgm_read_word(&fad_cfg.gap);
    uint16_t interval = pgm_read_word(&fad_cfg.interval);
    uint8_t  pin      = pgm_read_byte(&fad_cfg.led_pin);
    uint8_t  boot     = pgm_read_byte(&fad_cfg.boot_flashes);

    if (pin > 4)
        pin = 0;
    if (flashes == 0)
        flashes = 1;
    if (on_time == 0)
        on_time = 1;
    led_mask    = (uint8_t)(1 << pin);
    active_high = (pgm_read_byte(&fad_cfg.flags) & FLAG_ACTIVE_HIGH) ? 1 : 0;

    /* LED pin output and off, every other pin input with pull-up. */
    PORTB = 0x3F;
    led(0);
    DDRB = led_mask;

    /* Power savings */
    ADCSRA &= ~(1 << ADEN);
    ACSR |= (1 << ACD);
    DIDR0 = (1 << ADC0D) | (1 << ADC1D) | (1 << ADC2D) | (1 << ADC3D);
    PRR = (1 << PRTIM0) | (1 << PRADC);

    set_sleep_mode(SLEEP_MODE_PWR_DOWN);
    sleep_enable();

    while (boot--) {
        flash(200);         /* 20 ms */
        sleep_ticks(16);    /* 256 ms */
    }

    for (;;) {
        for (uint8_t i = 0; i < flashes; i++) {
            if (i)
                sleep_ticks(gap);
            flash(on_time);
        }
        sleep_ticks(interval);
    }
}
