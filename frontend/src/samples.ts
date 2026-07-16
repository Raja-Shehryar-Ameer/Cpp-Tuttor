// Example gallery: sources come straight from the repo's samples/ directory.

import arrays from "../../samples/arrays.cpp?raw";
import basics from "../../samples/basics.cpp?raw";
import cArrays from "../../samples/c/arrays.c?raw";
import cBasics from "../../samples/c/basics.c?raw";
import cHeapBug from "../../samples/c/heap_bug.c?raw";
import cPointers from "../../samples/c/pointers.c?raw";
import cRecursion from "../../samples/c/recursion.c?raw";
import cStructList from "../../samples/c/struct_list.c?raw";
import heapBug from "../../samples/heap_bug.cpp?raw";
import pointers from "../../samples/pointers.cpp?raw";
import pyAliasing from "../../samples/py/aliasing.py?raw";
import pyBasics from "../../samples/py/basics.py?raw";
import pyDict from "../../samples/py/dict.py?raw";
import pyException from "../../samples/py/exception.py?raw";
import pyObjects from "../../samples/py/objects.py?raw";
import pyRecursion from "../../samples/py/recursion.py?raw";
import recursion from "../../samples/recursion.cpp?raw";
import structList from "../../samples/struct_list.cpp?raw";
import vectorString from "../../samples/vector_string.cpp?raw";
import type { TracerLanguage } from "./api/client";

export const SAMPLES_BY_LANG: Record<TracerLanguage, Record<string, string>> = {
  cpp: {
    "basics — variables & arithmetic": basics,
    "pointers — swap via pointers": pointers,
    "arrays — C arrays & C-strings": arrays,
    "recursion — factorial": recursion,
    "linked list — manual nodes on the heap": structList,
    "use-after-free — a heap bug, visualized": heapBug,
    "vector & string — STL containers": vectorString,
  },
  c: {
    "basics — variables & arithmetic": cBasics,
    "pointers — swap via pointers": cPointers,
    "arrays — C arrays & C-strings": cArrays,
    "recursion — factorial": cRecursion,
    "linked list — malloc'd nodes on the heap": cStructList,
    "use-after-free — a heap bug, visualized": cHeapBug,
  },
  python: {
    "basics — variables & arithmetic": pyBasics,
    "aliasing — two names, one list": pyAliasing,
    "dict — a struct that grows": pyDict,
    "recursion — factorial": pyRecursion,
    "objects — a linked list of Nodes": pyObjects,
    "exception — where it blew up": pyException,
  },
};

export const DEFAULT_SAMPLE: Record<TracerLanguage, string> = {
  cpp: "pointers — swap via pointers",
  c: "pointers — swap via pointers",
  python: "aliasing — two names, one list",
};
