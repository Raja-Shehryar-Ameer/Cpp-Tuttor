#include <stdio.h>
#include <string.h>

int main(void) {
    int nums[5] = {4, 8, 15, 16, 23};
    int total = 0;
    for (int i = 0; i < 5; i++) {
        total += nums[i];
    }
    char name[16];
    strcpy(name, "shinso");
    size_t len = strlen(name);
    printf("total = %d\n", total);
    printf("%s has %zu letters\n", name, len);
    return 0;
}
