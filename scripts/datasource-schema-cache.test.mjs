import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { handleConfigApiRequest } from "../apps/api/dist/config-api.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";

test("schema refresh discards an inspection result from an older datasource revision", async () => {
  await withMetadataStore(async (store) => {
    const datasource = store.dataSources.create({
      user_id: "dev-user",
      id: "race-postgresql",
      name: "Race PostgreSQL",
      type: "postgresql",
      config: { schema: "old_schema" },
    });
    let releaseFirstInspection;
    let notifyFirstInspection;
    const firstInspectionStarted = new Promise((resolve) => {
      notifyFirstInspection = resolve;
    });
    const firstInspectionGate = new Promise((resolve) => {
      releaseFirstInspection = resolve;
    });
    let inspectionCount = 0;
    const dataGateway = {
      inspectSchema: async () => {
        inspectionCount += 1;
        const config = JSON.parse(store.dataSources.get({
          user_id: "dev-user",
          datasource_id: "race-postgresql",
        }).config_json);
        const capturedSchema = config.schema;
        if (inspectionCount === 1) {
          notifyFirstInspection();
          await firstInspectionGate;
        }
        return {
          datasource_id: "race-postgresql",
          tables: [{ name: `${capturedSchema}_table`, columns: [] }],
        };
      },
    };
    const context = {
      dataGateway,
      metadataStore: store,
      userId: "dev-user",
      workspaceId: "default",
    };
    const schemaPath = "/api/v1/datasources/race-postgresql/schema";
    const pendingSchema = handleConfigApiRequest(request("GET", schemaPath), schemaPath, context);
    await firstInspectionStarted;

    const patchPath = "/api/v1/datasources/race-postgresql";
    const patch = await handleConfigApiRequest(
      request("PATCH", patchPath, {
        revision: datasource.revision,
        config: { schema: "new_schema" },
      }),
      patchPath,
      context,
    );
    assert.equal(patch?.status, 200);
    releaseFirstInspection();

    const refreshed = await pendingSchema;
    assert.equal(refreshed?.status, 200);
    assert.deepEqual(
      refreshed?.body.data.tables.map(({ name }) => name),
      ["new_schema_table"],
    );
    const cached = await handleConfigApiRequest(request("GET", schemaPath), schemaPath, context);
    assert.deepEqual(
      cached?.body.data.tables.map(({ name }) => name),
      ["new_schema_table"],
    );
    assert.equal(inspectionCount, 2);
  });
});

test("datasource PATCH accepts explicit empty and null policy values", async () => {
  await withMetadataStore(async (store) => {
    const datasource = store.dataSources.create({
      user_id: "dev-user",
      id: "policy-postgresql",
      name: "Policy PostgreSQL",
      type: "postgresql",
      config: {
        schema: "public",
        introspection: { refreshIntervalSec: 300, tableAllowlist: ["orders"] },
        maskFields: ["secret"],
        queryPolicy: { maxRows: 100, timeoutMs: 5000 },
        samplePolicy: { maxSampleRows: 20 },
      },
    });
    const path = "/api/v1/datasources/policy-postgresql";
    const response = await handleConfigApiRequest(
      request("PATCH", path, {
        revision: datasource.revision,
        introspection: { refreshIntervalSec: null, tableAllowlist: [] },
        maskFields: [],
        queryPolicy: { maxRows: null, timeoutMs: null },
        samplePolicy: { maxSampleRows: null },
      }),
      path,
      {
        dataGateway: {},
        metadataStore: store,
        userId: "dev-user",
        workspaceId: "default",
      },
    );

    assert.equal(response?.status, 200);
    assert.deepEqual(response?.body.data.config.introspection, {
      refreshIntervalSec: null,
      tableAllowlist: [],
    });
    assert.deepEqual(response?.body.data.config.maskFields, []);
    assert.deepEqual(response?.body.data.config.queryPolicy, {
      maxRows: null,
      timeoutMs: null,
    });
    assert.deepEqual(response?.body.data.config.samplePolicy, {
      maxSampleRows: null,
    });
  });
});

function request(method, path, body) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.url = path;
  stream.headers = body === undefined ? {} : { "content-type": "application/json" };
  return stream;
}

async function withMetadataStore(callback) {
  const root = mkdtempSync(join(tmpdir(), "datafoundry-schema-cache-test-"));
  const store = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    secret_master_key: "schema-cache-test-key",
  });
  try {
    await callback(store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}
