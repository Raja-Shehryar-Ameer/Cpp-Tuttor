#include <iostream>

struct Node {
    int value;
    Node* next;
};

int main() {
    Node* a = new Node{10, nullptr};
    Node* b = new Node{20, nullptr};
    a->next = b;
    std::cout << "b holds " << b->value << "\n";
    delete b;
    // BUG: a->next still points at the freed node (use-after-free).
    int leaked = a->next->value;
    bool corrupted = leaked != 20;
    std::cout << "freed read corrupted? " << (corrupted ? "yes" : "maybe not yet") << "\n";
    delete a;
    return 0;
}
