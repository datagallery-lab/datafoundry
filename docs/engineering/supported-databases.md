# Supported Databases

日期：2026-06-29

本文档列出 Data Gateway 当前已经启用的 datasource 类型，以及前端 / TUI / 调用方应该如何通过
REST 配置并交给 agent 使用。

## 使用路径

数据库不直接暴露“任意 SQL REST API”。北向配置 API 只负责注册、测试连接、抓取 schema；
真正的数据分析仍通过 agent 工具边界执行：

```text
前端 / TUI
  -> GET /api/v1/datasource-types        # 发现可用类型和字段
  -> POST /api/v1/datasources            # 注册 datasource，凭据进入 secret store
  -> POST /api/v1/datasources/:id/test   # 连接测试
  -> POST /api/v1/datasources/:id/introspect
  -> GET /api/v1/datasources/:id/schema  # 给前端 schema browser 使用
  -> POST /api/copilotkit                # run_config / forwardedProps 选择 datasource
     -> Mastra DataAgent
     -> inspect_schema / run_sql_readonly
     -> Data Gateway SQL guard / audit / artifact
```

约束：

- 所有 datasource 都是只读语义，`run_sql_readonly` 始终经过 SQL guard、limit、timeout、mask、
  allowlist 和 SQL audit。
- 凭据只在创建/更新时提交，读接口只返回 `hasSecret` / `secretRef`，不会回传明文。
- Agent 必须先 `inspect_schema`，再 `run_sql_readonly`。
- MongoDB / Redis / Elasticsearch / OpenSearch 不是 SQL 数据库，但通过受限的 table-like 映射进入
  同一工具边界。

## 发现支持类型

```bash
curl http://127.0.0.1:8787/api/v1/datasource-types
```

响应中每个类型包含：

| 字段 | 说明 |
| --- | --- |
| `name` | 注册 datasource 时使用的稳定 `type` |
| `label` | UI 展示名 |
| `enabled` | 后端当前是否真的有 adapter；前端只应展示 `enabled=true` 的类型 |
| `description` | 类型说明 |
| `parameters[]` | 当前类型的连接字段 schema，含 `name` / `label` / `type` / `required` / `default_value` / `options` |

## 注册 datasource

通用请求：

```bash
curl -X POST http://127.0.0.1:8787/api/v1/datasources \
  -H "Content-Type: application/json" \
  -d '{
    "id": "sales-pg",
    "name": "Sales PostgreSQL",
    "type": "postgresql",
    "config": {
      "host": "127.0.0.1",
      "port": 5432,
      "database": "sales",
      "schema": "public",
      "username": "readonly"
    },
    "credentials": {
      "password": "secret-password"
    },
    "queryPolicy": {
      "maxRows": 1000,
      "timeoutMs": 10000,
      "denyWrite": true
    },
    "introspection": {
      "tableAllowlist": ["orders", "customers"],
      "refreshIntervalSec": 3600
    },
    "samplePolicy": {
      "allowSample": true,
      "maxSampleRows": 100
    },
    "maskFields": ["email", "phone"],
    "defaultEnabled": true
  }'
```

也可以用 `connection` 或 `settings` 替代 `config`。`password`、`token`、`credentialsJson` 等敏感字段建议放在
`credentials`；如果以内联字段提交，后端会尽量剥离常见 `password` 并写入 secret store。

注册后通常执行：

```bash
curl -X POST http://127.0.0.1:8787/api/v1/datasources/sales-pg/test
curl -X POST http://127.0.0.1:8787/api/v1/datasources/sales-pg/introspect
curl http://127.0.0.1:8787/api/v1/datasources/sales-pg/schema
```

## Agent run 中使用

GUI / TUI 应在 AG-UI / CopilotKit run input 中传入 active datasource。当前后端兼容
`forwardedProps.datasourceId` 和 `forwardedProps.run_config.activeDatasourceId`，推荐使用后者。

```jsonc
{
  "threadId": "session-001",
  "runId": "run-001",
  "forwardedProps": {
    "run_config": {
      "activeDatasourceId": "sales-pg",
      "enabledDatasourceIds": ["sales-pg"]
    }
  }
}
```

后端会把选中的 datasource 注入 run context。Agent 只能通过工具访问该 datasource，不能拿到凭据。

## 当前支持列表

| type | 连接方式 | 必填字段 | 说明 |
| --- | --- | --- | --- |
| `duckdb` | 内置 demo 或 DuckDB 文件 | `mode`; 文件模式需要 `path` | `mode=demo` 使用内置 orders 数据；`mode=file` 读取真实 DuckDB 文件 |
| `sqlite` | 本地 SQLite 文件 | `path` | 使用 `node:sqlite`，适合 local-first 文件库 |
| `csv` | 本地/上传 CSV 文件 | `file_path` | 文件被视作单表，默认表名 `dataset` |
| `xlsx` | 本地/上传 Excel 文件 | `file_path` | 读取首个工作表，默认表名 `dataset` |
| `postgresql` | PostgreSQL native client | `host`, `port`, `database`, `username`, `password` | 支持 `schema`，默认 `public` |
| `mysql` | MySQL native client | `host`, `port`, `database`, `username`, `password` | MySQL 协议 |
| `clickhouse` | HTTP JSON interface | `host`, `port`, `database` | `username` 默认 `default`，支持 `secure` |
| `snowflake` | Snowflake SDK | `account`, `warehouse`, `database`, `username`, `password` | 支持 `schema`、`role` |
| `bigquery` | BigQuery client | `projectId`, `dataset` | 凭据可用 `credentialsJson` 或 `keyFilename` |
| `sqlserver` | SQL Server native client | `host`, `port`, `database`, `username`, `password` | 支持 `schema`，默认 `dbo` |
| `oracle` | Oracle native client | `connectString`, `username`, `password` | 支持 `schema`，默认 username |
| `mongodb` | MongoDB native client | `uri`, `database` | 集合映射为 table；只支持简单 `SELECT ... FROM collection [LIMIT n]` |
| `gaussdb` | PostgreSQL 协议兼容 | `host`, `port`, `database`, `username`, `password` | 复用 PostgreSQL adapter |
| `access` | ODBC | `connectionString` 或 `path` | 运行环境必须安装 Access ODBC driver |
| `redis` | Redis native client | `url` | 暴露 `redis_keys` 伪表；支持 `database`、`keyPattern` |
| `starrocks` | MySQL 协议兼容 | `host`, `port`, `database`, `username`, `password` | 复用 MySQL adapter |
| `trino` | Trino REST `/v1/statement` | `host`, `port`, `catalog` | 支持 `schema`、`username`、`password`、`secure` |
| `presto` | Presto REST `/v1/statement` | `host`, `port`, `catalog` | 支持 `schema`、`username`、`password`、`secure` |
| `spark` | Spark Thrift Server / HiveServer2 | `host`, `port` | 支持 `schema`、`catalog`、`transport=tcp/http`、`auth=none/plain` |
| `databricks` | Databricks SQL Statement REST | `host`, `token`, `path` 或 `warehouseId` | 支持 `catalog`、`schema` |
| `redshift` | PostgreSQL 协议兼容 | `host`, `port`, `database`, `username`, `password` | 复用 PostgreSQL adapter，默认端口 5439 |
| `elasticsearch` | Elasticsearch client | `node` / `url` 或 `host`+`port` | index-as-table；支持 `indexPattern`、basic auth、`apiKey` |
| `opensearch` | OpenSearch client | `node` / `url` 或 `host`+`port` | index-as-table；支持 `indexPattern`、basic auth、`apiKey` |
| `doris` | MySQL 协议兼容 | `host`, `port`, `database`, `username`, `password` | 复用 MySQL adapter，默认端口 9030 |
| `mariadb` | MySQL 协议兼容 | `host`, `port`, `database`, `username`, `password` | 复用 MySQL adapter |
| `tidb` | MySQL 协议兼容 | `host`, `port`, `database`, `username`, `password` | 复用 MySQL adapter，默认端口 4000 |
| `oceanbase` | MySQL 协议兼容 | `host`, `port`, `database`, `username`, `password` | 复用 MySQL adapter，默认端口 2881 |
| `greenplum` | PostgreSQL 协议兼容 | `host`, `port`, `database`, `username`, `password` | 复用 PostgreSQL adapter |

## 类型示例

### DuckDB 文件

```json
{
  "id": "orders-duckdb",
  "name": "Orders DuckDB",
  "type": "duckdb",
  "config": {
    "mode": "file",
    "path": "/absolute/path/orders.duckdb"
  }
}
```

### ClickHouse

```json
{
  "id": "analytics-clickhouse",
  "name": "Analytics ClickHouse",
  "type": "clickhouse",
  "config": {
    "host": "127.0.0.1",
    "port": 8123,
    "database": "analytics",
    "username": "default",
    "secure": false
  },
  "credentials": {
    "password": "secret-password"
  }
}
```

### Snowflake

```json
{
  "id": "warehouse-snowflake",
  "name": "Warehouse Snowflake",
  "type": "snowflake",
  "config": {
    "account": "org-account",
    "warehouse": "COMPUTE_WH",
    "database": "ANALYTICS",
    "schema": "PUBLIC",
    "role": "ANALYST",
    "username": "readonly"
  },
  "credentials": {
    "password": "secret-password"
  }
}
```

### BigQuery

```json
{
  "id": "warehouse-bigquery",
  "name": "Warehouse BigQuery",
  "type": "bigquery",
  "config": {
    "projectId": "my-project",
    "dataset": "analytics",
    "location": "US"
  },
  "credentials": {
    "credentialsJson": "{\"type\":\"service_account\"}"
  }
}
```

### Databricks SQL

```json
{
  "id": "warehouse-databricks",
  "name": "Warehouse Databricks",
  "type": "databricks",
  "config": {
    "host": "dbc-xxxx.cloud.databricks.com",
    "warehouseId": "abc123",
    "catalog": "main",
    "schema": "default"
  },
  "credentials": {
    "token": "dapi..."
  }
}
```

也可以传 Databricks HTTP Path，后端会从 `/sql/1.0/warehouses/<warehouseId>` 中解析 warehouse id：

```json
{
  "path": "/sql/1.0/warehouses/abc123"
}
```

### Elasticsearch / OpenSearch

```json
{
  "id": "logs-search",
  "name": "Logs Search",
  "type": "elasticsearch",
  "config": {
    "node": "http://127.0.0.1:9200",
    "indexPattern": "logs-*",
    "username": "elastic"
  },
  "credentials": {
    "password": "secret-password"
  }
}
```

## 非 SQL 源的查询边界

| 类型 | table 映射 | `run_sql_readonly` 支持 |
| --- | --- | --- |
| `mongodb` | collection -> table | 简单 `SELECT * FROM collection LIMIT n`；可选择列，不支持复杂 where/join |
| `redis` | `redis_keys` 伪表 | 简单 `SELECT * FROM redis_keys LIMIT n` |
| `elasticsearch` / `opensearch` | index -> table | 简单 `SELECT * FROM index LIMIT n`；schema 来自 mapping |

复杂 Mongo aggregation、Redis 命令、Elasticsearch DSL 不通过当前 `run_sql_readonly` 暴露给 agent。

## 验证状态

已纳入本地 smoke：

- `npm run smoke:data-gateway`：本地 DuckDB demo、真实 DuckDB 文件、SQLite、CSV、XLSX、fake ClickHouse。
- `npm run smoke:config-api`：`/api/v1/datasource-types` 会断言所有已启用类型可发现。

未在默认 smoke 中跑真实外部服务 E2E：Snowflake、BigQuery、SQL Server、Oracle、MongoDB、GaussDB、
Access、Redis、StarRocks、Trino、Presto、Spark、Databricks、Redshift、Elasticsearch、OpenSearch、
Doris、MariaDB、TiDB、OceanBase、Greenplum。它们当前是 adapter 与配置契约已接通，真实环境验证需要
对应服务、网络和凭据。
