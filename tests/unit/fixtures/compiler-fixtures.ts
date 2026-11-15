/** Sources whose real compiler output is stored next to this file (checked in compiler.test.ts). */
export const CONSTRUCTOR_SOURCE = "v = Variable()\n\n@construct\ndef seed(start: int):\n    v.set(start)\n\n@export\ndef get():\n    return v.get()\n";
export const FLOAT_SOURCE = "@export\ndef f(a: float):\n    return a\n";
