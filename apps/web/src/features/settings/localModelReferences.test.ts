import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalModelReference,
  findLocalModelReference,
  normalizeLocalModelBindings,
  resolveLocalModelReference,
} from "./localModelReferences.ts";

test("anonymous Cloud references bind to model entry ids", () => {
  const reference = createLocalModelReference();
  const bindings = normalizeLocalModelBindings({ [reference]: "entry-a" });
  assert.equal(resolveLocalModelReference(bindings, reference), "entry-a");
  assert.equal(findLocalModelReference(bindings, "entry-a"), reference);
});
