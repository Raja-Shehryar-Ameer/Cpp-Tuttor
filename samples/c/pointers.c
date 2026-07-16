#include <stdio.h>

void swap(int* a, int* b) {
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

int main(void) {
    int x = 10;
    int y = 20;
    int* p = &x;
    int* q = NULL;
    *p = 15;
    q = &y;
    swap(p, q);
    printf("x = %d, y = %d\n", x, y);
    return 0;
}
