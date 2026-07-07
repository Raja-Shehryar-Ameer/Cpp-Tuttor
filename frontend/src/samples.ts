// Example gallery: sources come straight from the repo's samples/ directory.

import arrays from "../../samples/arrays.cpp?raw";
import basics from "../../samples/basics.cpp?raw";
import heapBug from "../../samples/heap_bug.cpp?raw";
import pointers from "../../samples/pointers.cpp?raw";
import recursion from "../../samples/recursion.cpp?raw";
import structList from "../../samples/struct_list.cpp?raw";
import vectorString from "../../samples/vector_string.cpp?raw";

export const SAMPLES: Record<string, string> = {
  "basics — variables & arithmetic": basics,
  "pointers — swap via pointers": pointers,
  "arrays — C arrays & C-strings": arrays,
  "recursion — factorial": recursion,
  "linked list — manual nodes on the heap": structList,
  "use-after-free — a heap bug, visualized": heapBug,
  "vector & string — STL containers": vectorString,
};
