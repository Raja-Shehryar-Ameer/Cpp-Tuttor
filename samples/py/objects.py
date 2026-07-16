# Objects are structs on the heap; .next references wire nodes together.
class Node:
    def __init__(self, value):
        self.value = value
        self.next = None


head = Node(1)
head.next = Node(2)
head.next.next = Node(3)

count = 0
walk = head
while walk is not None:
    count += 1
    walk = walk.next
print("nodes:", count)
