import { describe, it } from "node:test";
import { findOrphans, scanXQueryFile } from "./scanDeadCode.ts";
import assert from "node:assert";

describe.skip("scan dead code", () => {
  it("can scan code", async () => {
    const script = `
import module namespace xxx="yyy";

declare function xxx:yyy(){
xxx:yyy()
};

declare function xxx:zzz(){
xxx:yyy()
};

xxx:yyy()
`;

    const graph = new Map();

    await scanXQueryFile("main.xqm", script, graph);

    const deadCode = findOrphans(graph);

    assert.deepEqual(deadCode, new Set(["Q{yyy}zzz"]));
  });

  it("can scan code across multiple modules", async () => {
    const script = `
import module namespace xxx="yyy";

declare function local:yyy(){
xxx:yyy()
};

declare function local:dead-entry(){
xxx:dead-a()
};


local:yyy()
`;

    const script2 = `
module namespace xxx="yyy";

declare function xxx:yyy(){
xxx:yyy()
};

declare function xxx:dead-a(){
xxx:dead-b()
};

declare function xxx:dead-b(){
xxx:dead-a()
};
`;

    const graph = new Map();

    await scanXQueryFile("main.xqm", script, graph);
    await scanXQueryFile("lib.xql", script2, graph);

    const deadCode = findOrphans(graph);

    assert.deepEqual(
      deadCode,
      new Set(["Q{http://www.w3.org/2005/xquery-local-functions}dead-entry"]),
    );
  });
});
