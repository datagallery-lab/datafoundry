import { describe, expect, it } from "vitest";
import { visibleConfigFields } from "../data-task-state";

describe("PostgreSQL configuration fields", () => {
  it("shows SSL as a PostgreSQL-only toggle", () => {
    const postgresqlSsl = visibleConfigFields("db", {
      type: "postgresql",
      mode: "readonly",
    }).find((field) => field.key === "ssl");
    const mysqlSsl = visibleConfigFields("db", {
      type: "mysql",
      mode: "readonly",
    }).find((field) => field.key === "ssl");

    expect(postgresqlSsl?.inputType).toBe("toggle");
    expect(mysqlSsl).toBeUndefined();
  });
});
