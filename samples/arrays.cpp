#include <iostream>

int main() {
    int nums[4] = {5, 8, 13, 21};
    char word[6] = "hello";
    int* cursor = nums;
    int total = 0;
    for (int i = 0; i < 4; i++) {
        total += nums[i];
        cursor = &nums[i];
    }
    std::cout << word << " total = " << total << "\n";
    std::cout << "last = " << *cursor << "\n";
    return 0;
}
