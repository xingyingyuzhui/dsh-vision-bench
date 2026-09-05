#include <stdint.h>

volatile uint32_t counter = 0;
volatile uint32_t watched = 0;

static void update_value(void) {
    watched++;
}

int main(void) {
    while (1) {
        counter++;
        if ((counter % 1000) == 0) {
            update_value();
        }
    }
}
