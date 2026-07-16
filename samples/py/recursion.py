# factorial(4): frames stack up, then unwind carrying return values.
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


print("4! =", factorial(4))
