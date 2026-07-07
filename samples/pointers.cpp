#include <iostream>

void swap(int* a, int* b) {
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

int main() {
    int x = 10;
    int y = 20;
    int* p = &x;
    int* q = nullptr;
    *p = 15;
    q = &y;
    swap(p, q);
    std::cout << "x = " << x << ", y = " << y << "\n";
    return 0;
}
