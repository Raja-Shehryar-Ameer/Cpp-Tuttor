#include <iostream>
#include <string>
#include <vector>

int main() {
    std::string greeting = "hi";
    greeting += " there";
    std::vector<int> nums;
    nums.push_back(4);
    nums.push_back(8);
    nums.push_back(15);
    int total = 0;
    for (int n : nums) {
        total += n;
    }
    std::cout << greeting << ": " << total << "\n";
    return 0;
}
