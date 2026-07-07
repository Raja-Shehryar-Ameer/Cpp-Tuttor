#include <iostream>

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    int rest = factorial(n - 1);
    return n * rest;
}

int main() {
    int n = 4;
    int result = factorial(n);
    std::cout << n << "! = " << result << "\n";
    return 0;
}
