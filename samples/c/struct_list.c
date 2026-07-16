#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    struct Node* next;
};

struct Node* push_front(struct Node* head, int value) {
    struct Node* node = malloc(sizeof(struct Node));
    node->value = value;
    node->next = head;
    return node;
}

int main(void) {
    struct Node* head = NULL;
    head = push_front(head, 3);
    head = push_front(head, 2);
    head = push_front(head, 1);
    int total = 0;
    for (struct Node* cur = head; cur != NULL; cur = cur->next) {
        total += cur->value;
    }
    printf("total = %d\n", total);
    while (head != NULL) {
        struct Node* next = head->next;
        free(head);
        head = next;
    }
    return 0;
}
