# A dict on the heap: one field per key, updated in place.
ages = {"ada": 36, "alan": 41}
ages["grace"] = 45
oldest = max(ages, key=ages.get)
print(oldest, "is the oldest at", ages[oldest])
