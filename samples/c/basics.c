#include <stdio.h>

int main(void) {
    int a = 7;
    int b = 3;
    int sum = a + b;
    int product = a * b;
    double ratio = (double)a / b;
    printf("sum = %d\n", sum);
    printf("product = %d\n", product);
    printf("ratio = %.2f\n", ratio);
    return 0;
}
