#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    struct Node* next;
};

int main(void) {
    struct Node* a = malloc(sizeof(struct Node));
    struct Node* b = malloc(sizeof(struct Node));
    a->value = 10;
    b->value = 20;
    a->next = b;
    b->next = NULL;
    printf("b holds %d\n", b->value);
    free(b);
    // BUG: a->next still points at the freed node (use-after-free).
    int leaked = a->next->value;
    printf("freed read corrupted? %s\n", leaked != 20 ? "yes" : "maybe not yet");
    free(a);
    return 0;
}
