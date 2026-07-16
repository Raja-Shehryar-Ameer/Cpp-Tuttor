# Two names, one list: b = a copies the REFERENCE, not the list.
a = [1, 2, 3]
b = a        # alias — both arrows point at the same object
c = a[:]     # slice copy — a genuinely new list
b.append(4)
print("a =", a)
print("c =", c)
