# An uncaught exception: the final step shows exactly where it blew up.
def average(nums):
    return sum(nums) / len(nums)


print(average([4, 8, 6]))
print(average([]))  # ZeroDivisionError — len([]) is 0
