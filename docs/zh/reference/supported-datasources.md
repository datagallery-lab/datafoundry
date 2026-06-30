# 支持的数据源

Open Data Agent 通过 Data Gateway 管理数据源。客户端只负责注册、测试、选择和展示；真实连接、schema 检查、只读查询、安全策略和审计由后端执行。

## 推荐试用路径

首次体验建议使用内置 DuckDB 演示数据源，不需要准备自己的数据库。接入自有数据时，建议按下面顺序验证：

1. 本地文件或内置 demo：DuckDB、SQLite、CSV、Excel。
2. 常见关系型数据库：PostgreSQL、MySQL。
3. 云数仓、湖仓、搜索和 NoSQL 数据源。

## 当前类型

| 类型 | 说明 |
| --- | --- |
| `duckdb` | 内置 demo、DuckDB 文件或内存分析。 |
| `sqlite` | 本地 SQLite 文件。 |
| `csv` | CSV 文件。 |
| `xlsx` | Excel 文件。 |
| `postgresql` | PostgreSQL 只读连接。 |
| `mysql` | MySQL 只读连接。 |
| `clickhouse` | ClickHouse HTTP 连接。 |
| `snowflake` | Snowflake 数据仓库。 |
| `bigquery` | BigQuery 数据仓库。 |
| `sqlserver` | Microsoft SQL Server。 |
| `oracle` | Oracle Database。 |
| `mongodb` | MongoDB collection 以 table-like 方式进入工具边界。 |
| `redis` | Redis keyspace 以受限映射方式进入工具边界。 |
| `elasticsearch` | Elasticsearch index 以 table-like 方式进入工具边界。 |
| `opensearch` | OpenSearch index 以 table-like 方式进入工具边界。 |
| `starrocks` | StarRocks。 |
| `trino` | Trino。 |
| `presto` | Presto。 |
| `spark` | Spark SQL。 |
| `databricks` | Databricks SQL。 |
| `redshift` | Amazon Redshift。 |
| `doris` | Apache Doris。 |
| `mariadb` | MariaDB。 |
| `tidb` | TiDB。 |
| `oceanbase` | OceanBase。 |
| `greenplum` | Greenplum。 |
| `gaussdb` | GaussDB。 |
| `access` | Microsoft Access 文件。 |

部分外部服务适配器需要对应服务、网络和凭据才能完成真实环境验证。公开演示建议优先使用 DuckDB demo、SQLite、CSV、Excel、PostgreSQL 或 MySQL。

## 发现类型 schema

可以通过接口读取当前后端支持的类型和参数 schema：

```bash
curl http://127.0.0.1:8787/api/v1/datasource-types
```

前端应根据接口返回的字段 schema 渲染表单，而不是硬编码所有数据源参数。

## 凭据边界

- 创建或更新数据源时可以提交连接凭据。
- 读接口不会返回明文密码、Token 或完整连接串。
- Agent run 只接收数据源 ID 和选择信息，不接收明文凭据。
- SQL 执行由 Data Gateway 统一做只读限制、超时、行数限制和审计。

## 延伸阅读

- 接入步骤请看 [数据源指南](../guides/data-sources.md)。
- 配置接口请看 [配置 API 参考](configuration-api.md)。
