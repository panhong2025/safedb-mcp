import { describe, it, expect } from "vitest";
import { Pager } from "../src/core/pager.js";

describe("Pager", () => {
  it("paginates results correctly", () => {
    const pager = new Pager(3, 500); // 3 rows per page
    const columns = ["id", "name"];
    const rows = [
      [1, "Alice"],
      [2, "Bob"],
      [3, "Charlie"],
      [4, "Dave"],
      [5, "Eve"],
    ];

    const page1 = pager.formatResult(columns, rows, 42);
    expect(page1.page).toBe(1);
    expect(page1.total_pages).toBe(2);
    expect(page1.total_rows).toBe(5);
    expect(page1.rows).toHaveLength(3);
    expect(page1.has_more).toBe(true);
    expect(page1.execution_time_ms).toBe(42);

    const page2 = pager.nextPage();
    expect(page2).not.toBeNull();
    expect(page2!.page).toBe(2);
    expect(page2!.rows).toHaveLength(2);
    expect(page2!.has_more).toBe(false);

    const page3 = pager.nextPage();
    expect(page3).toBeNull();
  });

  it("truncates long fields", () => {
    const pager = new Pager(50, 20); // truncate at 20 chars
    const columns = ["id", "content"];
    const rows = [[1, "This is a very long string that should be truncated"]];

    const result = pager.formatResult(columns, rows, 10);
    const value = result.rows[0]![1] as string;
    expect(value).toContain("[truncated,");
    expect(value).toContain("chars]");
    expect(result.truncated_fields).toContain("content");
  });

  it("handles empty results", () => {
    const pager = new Pager(50, 500);
    const result = pager.formatResult(["id"], [], 5);
    expect(result.total_rows).toBe(0);
    expect(result.page).toBe(1);
    expect(result.has_more).toBe(false);
  });
});
