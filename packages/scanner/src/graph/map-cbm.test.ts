import { describe, expect, it } from "vitest";
import { cbmEdgeToRelation, cbmLabelToKind, mapCbmNodeToGraphSymbol } from "./map-cbm.js";

describe("map-cbm", () => {
  it("maps CBM labels to graph symbol kinds", () => {
    expect(cbmLabelToKind("Function")).toBe("function");
    expect(cbmLabelToKind("Method")).toBe("method");
    expect(cbmLabelToKind("CustomLabel")).toBe("customlabel");
  });

  it("maps CBM edge types to relation strings", () => {
    expect(cbmEdgeToRelation("CALLS")).toBe("calls");
    expect(cbmEdgeToRelation("HTTP_CALLS")).toBe("http_calls");
    expect(cbmEdgeToRelation("UNKNOWN_EDGE")).toBe("unknown_edge");
  });

  it("maps CBM nodes to graph symbols", () => {
    const sym = mapCbmNodeToGraphSymbol(
      {
        id: 42,
        label: "Function",
        name: "generatePack",
        qualified_name: "generatePack",
        file_path: "src/pack.ts",
        start_line: 10,
        end_line: 40,
      },
      (path) => `file:${path}`,
    );
    expect(sym.id).toBe("42");
    expect(sym.fileId).toBe("file:src/pack.ts");
    expect(sym.kind).toBe("function");
    expect(sym.qualifiedName).toBe("generatePack");
    expect(sym.startLine).toBe(10);
  });
});
