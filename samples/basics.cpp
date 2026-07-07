#include <iostream>

int main() {
    int x = 3;
    int y = 4;
    int sum = x + y;
    double ratio = static_cast<double>(x) / y;
    bool bigger = sum > 5;
    char grade = 'A';
    std::cout << "sum = " << sum << "\n";
    std::cout << "ratio = " << ratio << "\n";
    std::cout << "grade = " << grade << " bigger = " << bigger << "\n";
    return 0;
}
