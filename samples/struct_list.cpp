#include <iostream>

struct Node {
    int value;
    Node* next;
};

Node* push_front(Node* head, int value) {
    Node* node = new Node{value, head};
    return node;
}

int main() {
    Node* head = nullptr;
    head = push_front(head, 3);
    head = push_front(head, 2);
    head = push_front(head, 1);
    int total = 0;
    for (Node* cur = head; cur != nullptr; cur = cur->next) {
        total += cur->value;
    }
    std::cout << "total = " << total << "\n";
    while (head != nullptr) {
        Node* next = head->next;
        delete head;
        head = next;
    }
    return 0;
}
