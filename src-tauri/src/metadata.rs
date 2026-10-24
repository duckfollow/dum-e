//! Read-only catalog introspection. Object names are bound values, never SQL fragments.
use crate::db::{self, Profile, Table};
use serde::{Deserialize, Serialize};
use sqlx::{Executor, Row};
use std::{
    collections::BTreeMap,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
type Result<T> = std::result::Result<T, String>;
fn error(e: sqlx::Error) -> String {
    e.to_string()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub ordinal: i32,
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub primary_key_position: i32,
    pub generated: Option<String>,
    pub identity: Option<String>,
    pub comment: Option<String>,
    pub type_detail: Option<String>,
    pub enum_values: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexPart {
    pub expression: String,
    pub role: String,
    pub descending: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub unique: bool,
    pub primary: bool,
    pub method: String,
    pub parts: Vec<IndexPart>,
    pub predicate: Option<String>,
    pub partial: bool,
    pub definition: Option<String>,
    pub valid: Option<bool>,
    pub origin: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintInfo {
    pub name: Option<String>,
    pub kind: String,
    pub columns: Vec<String>,
    pub definition: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnPair {
    pub from: String,
    pub to: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub id: String,
    pub name: Option<String>,
    pub from_table: Table,
    pub to_table: Table,
    pub columns: Vec<ColumnPair>,
    pub on_update: String,
    pub on_delete: String,
    pub validated: Option<bool>,
    pub deferrable: Option<bool>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetails {
    pub table: Table,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
    pub relations: Vec<Relation>,
    pub definition: Option<String>,
    pub definition_kind: String,
    pub comment: Option<String>,
    pub strict: Option<bool>,
    pub without_rowid: Option<bool>,
    pub rowid_alias: Option<String>,
    pub foreign_keys_enforced: Option<bool>,
    pub notes: Vec<String>,
}
pub async fn inspect(profile: &Profile, password: &str, table: &Table) -> Result<TableDetails> {
    profile.validate()?;
    if table.name.is_empty()
        || table.name.len() > 1024
        || table.schema.is_empty()
        || table.schema.len() > 1024
        || table.name.contains('\0')
        || table.schema.contains('\0')
    {
        return Err("Invalid schema or table name".into());
    }
    let work = async {
        if profile.driver == "sqlite" {
            sqlite(profile, table).await
        } else {
            postgres(profile, password, table).await
        }
    };
    let result = tokio::time::timeout(Duration::from_secs(20), work)
        .await
        .map_err(|_| "Table metadata request timed out".to_string())??;
    if serde_json::to_vec(&result)
        .map_err(|e| e.to_string())?
        .len()
        > 4 * 1024 * 1024
    {
        return Err("Table metadata exceeds the 4 MB preview limit".into());
    }
    Ok(result)
}
pub(crate) fn object(schema: &str, name: &str) -> Table {
    Table {
        schema: schema.into(),
        name: name.into(),
        kind: "table".into(),
    }
}
fn affinity(declared: &str, strict: bool) -> String {
    let t = declared.to_uppercase();
    if strict && t == "ANY" {
        "ANY (STRICT)"
    } else if t.contains("INT") {
        "INTEGER affinity"
    } else if t.contains("CHAR") || t.contains("CLOB") || t.contains("TEXT") {
        "TEXT affinity"
    } else if t.is_empty() || t.contains("BLOB") {
        "BLOB affinity"
    } else if t.contains("REAL") || t.contains("FLOA") || t.contains("DOUB") {
        "REAL affinity"
    } else {
        "NUMERIC affinity"
    }
    .into()
}
async fn sqlite(profile: &Profile, selected: &Table) -> Result<TableDetails> {
    if selected.schema != "main" {
        return Err("Only the main SQLite schema is available in this connection".into());
    }
    let mut c = db::sqlite(profile, Arc::new(AtomicBool::new(false))).await?;
    c.execute("BEGIN").await.map_err(error)?;
    let row=sqlx::query("SELECT name,type,sql FROM sqlite_schema WHERE name=? COLLATE NOCASE AND type IN ('table','view')").bind(&selected.name).fetch_optional(&mut c).await.map_err(error)?.ok_or("Table or view no longer exists. Refresh the explorer.")?;
    let name: String = row.get("name");
    let kind: String = row.get("type");
    let definition: Option<String> = row.get("sql");
    let flags =
        sqlx::query("SELECT wr,strict FROM pragma_table_list WHERE schema='main' AND name=?")
            .bind(&name)
            .fetch_optional(&mut c)
            .await
            .map_err(error)?;
    let strict = flags
        .as_ref()
        .is_some_and(|r| r.get::<i64, _>("strict") != 0);
    let without_rowid = flags.as_ref().is_some_and(|r| r.get::<i64, _>("wr") != 0);
    let raw_columns=sqlx::query("SELECT cid,name,type,\"notnull\",dflt_value,pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid").bind(&name).fetch_all(&mut c).await.map_err(error)?;
    let raw_indexes =
        sqlx::query("SELECT name,\"unique\",origin,partial FROM pragma_index_list(?) ORDER BY seq")
            .bind(&name)
            .fetch_all(&mut c)
            .await
            .map_err(error)?;
    let mut columns: Vec<ColumnInfo> = raw_columns
        .iter()
        .map(|r| {
            let data_type: String = r.get("type");
            let hidden: i64 = r.get("hidden");
            ColumnInfo {
                ordinal: r.get::<i64, _>("cid") as i32 + 1,
                name: r.get("name"),
                type_detail: Some(affinity(&data_type, strict)),
                data_type,
                nullable: r.get::<i64, _>("notnull") == 0,
                default_value: r.get("dflt_value"),
                primary_key_position: r.get::<i64, _>("pk") as i32,
                generated: match hidden {
                    1 => Some("Hidden virtual-table column".into()),
                    2 => Some("VIRTUAL".into()),
                    3 => Some("STORED".into()),
                    _ => None,
                },
                identity: None,
                comment: None,
                enum_values: vec![],
            }
        })
        .collect();
    let primary: Vec<_> = columns
        .iter()
        .filter(|c| c.primary_key_position > 0)
        .collect();
    let rowid_alias = if kind == "table"
        && !without_rowid
        && primary.len() == 1
        && primary[0].data_type.eq_ignore_ascii_case("INTEGER")
        && !raw_indexes
            .iter()
            .any(|r| r.get::<String, _>("origin") == "pk")
    {
        Some(primary[0].name.clone())
    } else {
        None
    };
    for col in &mut columns {
        if col.primary_key_position > 0
            && (strict || without_rowid || rowid_alias.as_ref() == Some(&col.name))
        {
            col.nullable = false;
        }
    }
    let mut constraints = Vec::new();
    let mut pk_columns: Vec<_> = columns
        .iter()
        .filter(|c| c.primary_key_position > 0)
        .collect();
    pk_columns.sort_by_key(|c| c.primary_key_position);
    if !pk_columns.is_empty() {
        let names: Vec<_> = pk_columns.iter().map(|c| c.name.clone()).collect();
        constraints.push(ConstraintInfo {
            name: None,
            kind: "PRIMARY KEY".into(),
            definition: format!(
                "PRIMARY KEY ({})",
                names
                    .iter()
                    .map(|n| db::quoted(n))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            columns: names,
        });
    }
    let mut indexes = Vec::new();
    for row in raw_indexes {
        let index_name: String = row.get("name");
        let origin: String = row.get("origin");
        let parts = sqlx::query(
            "SELECT seqno,cid,name,\"desc\",\"key\" FROM pragma_index_xinfo(?) ORDER BY seqno",
        )
        .bind(&index_name)
        .fetch_all(&mut c)
        .await
        .map_err(error)?;
        let mut names = Vec::new();
        let mut parts: Vec<IndexPart> = parts
            .iter()
            .map(|r| {
                let name: Option<String> = r.get("name");
                let cid: i64 = r.get("cid");
                let key = r.get::<i64, _>("key") != 0;
                if key {
                    if let Some(n) = &name {
                        names.push(n.clone());
                    }
                }
                IndexPart {
                    expression: name.unwrap_or_else(|| {
                        if cid == -1 {
                            "rowid".into()
                        } else {
                            "(expression — see SQL definition)".into()
                        }
                    }),
                    role: if key { "key" } else { "auxiliary" }.into(),
                    descending: Some(r.get::<i64, _>("desc") != 0),
                }
            })
            .collect();
        let sql: Option<String> =
            sqlx::query_scalar("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?")
                .bind(&index_name)
                .fetch_optional(&mut c)
                .await
                .map_err(error)?
                .flatten();
        if origin == "u" {
            constraints.push(ConstraintInfo {
                name: None,
                kind: "UNIQUE".into(),
                columns: names.clone(),
                definition: format!(
                    "UNIQUE ({}) — backed by {}",
                    names
                        .iter()
                        .map(|n| db::quoted(n))
                        .collect::<Vec<_>>()
                        .join(", "),
                    index_name
                ),
            });
        }
        let partial = row.get::<i64, _>("partial") != 0;
        let parsed = sql
            .as_ref()
            .filter(|sql| sql.len() <= 65536)
            .and_then(|sql| {
                let statements = sqlparser::parser::Parser::parse_sql(
                    &sqlparser::dialect::SQLiteDialect {},
                    sql,
                )
                .ok()?;
                if statements.len() != 1 {
                    return None;
                }
                match statements.into_iter().next()? {
                    sqlparser::ast::Statement::CreateIndex(index) => Some(index),
                    _ => None,
                }
            });
        if let Some(index) = &parsed {
            for (position, part) in parts
                .iter_mut()
                .filter(|part| part.role == "key")
                .enumerate()
            {
                if part.expression == "(expression — see SQL definition)" {
                    if let Some(column) = index.columns.get(position) {
                        part.expression = column.column.expr.to_string();
                    }
                }
            }
        }
        indexes.push(IndexInfo {
            name: index_name,
            unique: row.get::<i64, _>("unique") != 0,
            primary: origin == "pk",
            method: "B-tree".into(),
            parts,
            partial,
            predicate: parsed.and_then(|index| index.predicate.map(|expr| expr.to_string())),
            definition: sql,
            valid: None,
            origin,
        });
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_schema WHERE type='table'")
        .fetch_one(&mut c)
        .await
        .map_err(error)?;
    if count > 2000 {
        return Err(
            "Relationship preview supports up to 2,000 SQLite tables in this version".into(),
        );
    }
    let known_names: Vec<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_schema WHERE type IN ('table','view')")
            .fetch_all(&mut c)
            .await
            .map_err(error)?;
    let fks=sqlx::query(r#"SELECT m.name AS source_table, f.id, f.seq, f."table" AS target_table, f."from" AS source_column, f."to" AS target_column, f.on_update, f.on_delete FROM sqlite_schema m JOIN pragma_foreign_key_list(m.name) f WHERE m.type='table' AND (m.name=? OR f."table"=? COLLATE NOCASE) ORDER BY m.name,f.id,f.seq LIMIT 10001"#).bind(&name).bind(&name).fetch_all(&mut c).await.map_err(error)?;
    if fks.len() > 10000 {
        return Err("Relationship metadata exceeds 10,000 column pairs".into());
    }
    let mut relations: BTreeMap<(String, i64), Relation> = BTreeMap::new();
    for row in fks {
        let source: String = row.get("source_table");
        let target_raw: String = row.get("target_table");
        let target = known_names
            .iter()
            .find(|name| name.eq_ignore_ascii_case(&target_raw))
            .cloned()
            .unwrap_or(target_raw);
        let id: i64 = row.get("id");
        let relation = relations
            .entry((source.clone(), id))
            .or_insert_with(|| Relation {
                id: format!("sqlite:{source}:{id}"),
                name: None,
                from_table: object("main", &source),
                to_table: object("main", &target),
                columns: vec![],
                on_update: row.get("on_update"),
                on_delete: row.get("on_delete"),
                validated: None,
                deferrable: None,
            });
        let raw_from: String = row.get("source_column");
        let source_column = if source == name {
            columns
                .iter()
                .find(|c| c.name.eq_ignore_ascii_case(&raw_from))
                .map(|c| c.name.clone())
                .unwrap_or(raw_from)
        } else {
            raw_from
        };
        relation.columns.push(ColumnPair {
            from: source_column,
            to: row.get("target_column"),
        });
    }
    // An omitted REFERENCES column list means the parent's PK, in declared PK order.
    for relation in relations.values_mut() {
        if relation.columns.iter().any(|pair| pair.to.is_none()) {
            let pk: Vec<String> =
                sqlx::query_scalar("SELECT name FROM pragma_table_xinfo(?) WHERE pk>0 ORDER BY pk")
                    .bind(&relation.to_table.name)
                    .fetch_all(&mut c)
                    .await
                    .map_err(error)?;
            if pk.len() == relation.columns.len() {
                for (pair, target) in relation.columns.iter_mut().zip(pk) {
                    if pair.to.is_none() {
                        pair.to = Some(target);
                    }
                }
            }
        }
    }
    for relation in relations.values().filter(|r| r.from_table.name == name) {
        let source: Vec<String> = relation.columns.iter().map(|p| p.from.clone()).collect();
        let target = relation
            .columns
            .iter()
            .map(|p| {
                p.to.as_ref()
                    .map(|s| db::quoted(s))
                    .unwrap_or("/* parent PK unavailable */".into())
            })
            .collect::<Vec<_>>()
            .join(", ");
        constraints.push(ConstraintInfo {
            name: None,
            kind: "FOREIGN KEY".into(),
            columns: source.clone(),
            definition: format!(
                "FOREIGN KEY ({}) REFERENCES {} ({target}) ON UPDATE {} ON DELETE {}",
                source
                    .iter()
                    .map(|s| db::quoted(s))
                    .collect::<Vec<_>>()
                    .join(", "),
                db::quoted(&relation.to_table.name),
                relation.on_update,
                relation.on_delete
            ),
        });
    }
    let enforced: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&mut c)
        .await
        .map_err(error)?;
    let mut notes=vec!["SQLite constraint names, CHECK details, and FK deferrability are not fully exposed by PRAGMAs. See the exact stored SQL definition.".into(),"Foreign-key enforcement below applies only to Dum-E’s read-only connection, not to other applications.".into()];
    if kind == "table" && !strict && !without_rowid {
        notes.push("On legacy SQLite rowid tables, a declared primary key can allow NULL unless it is explicitly NOT NULL or an INTEGER PRIMARY KEY rowid alias.".into());
    }
    Ok(TableDetails {
        table: Table {
            schema: "main".into(),
            name,
            kind: kind.clone(),
        },
        columns,
        indexes,
        constraints,
        relations: relations.into_values().collect(),
        definition,
        definition_kind: "Stored SQLite SQL".into(),
        comment: None,
        strict: if kind == "view" { None } else { Some(strict) },
        without_rowid: if kind == "view" {
            None
        } else {
            Some(without_rowid)
        },
        rowid_alias,
        foreign_keys_enforced: Some(enforced != 0),
        notes,
    })
}
pub(crate) fn action(code: &str) -> String {
    match code {
        "a" => "NO ACTION",
        "r" => "RESTRICT",
        "c" => "CASCADE",
        "n" => "SET NULL",
        "d" => "SET DEFAULT",
        _ => "Unknown",
    }
    .into()
}
async fn postgres(profile: &Profile, password: &str, selected: &Table) -> Result<TableDetails> {
    let mut c = db::postgres(profile, password).await?;
    c.execute("BEGIN READ ONLY").await.map_err(error)?;
    let relation=sqlx::query(r#"SELECT c.oid::bigint AS oid,c.relkind::text AS kind,obj_description(c.oid,'pg_class') AS comment FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r','p','v','m','f') AND (pg_has_role(c.relowner,'USAGE') OR has_table_privilege(c.oid,'SELECT') OR has_any_column_privilege(c.oid,'SELECT'))"#).bind(&selected.schema).bind(&selected.name).fetch_optional(&mut c).await.map_err(error)?.ok_or("Table is no longer visible to this connection. Refresh or check database permissions.")?;
    let oid: i64 = relation.get("oid");
    let code: String = relation.get("kind");
    let kind = match code.as_str() {
        "p" => "partitioned table",
        "v" => "view",
        "m" => "materialized view",
        "f" => "foreign table",
        _ => "table",
    };
    let rows=sqlx::query(r#"SELECT a.attnum::int AS ordinal,a.attname::text AS name,format_type(a.atttypid,a.atttypmod) AS data_type,NOT(a.attnotnull OR t.typnotnull) AS nullable,pg_get_expr(d.adbin,d.adrelid) AS default_value,COALESCE((SELECT array_position(p.conkey,a.attnum) FROM pg_constraint p WHERE p.conrelid=a.attrelid AND p.contype='p' LIMIT 1),0)::int AS pk,a.attgenerated::text AS generated,a.attidentity::text AS identity,col_description(a.attrelid,a.attnum) AS comment,CASE t.typtype WHEN 'd' THEN 'Domain over '||format_type(t.typbasetype,t.typtypmod) WHEN 'e' THEN 'Enum' ELSE NULL END AS type_detail,ARRAY(SELECT e.enumlabel::text FROM pg_enum e WHERE e.enumtypid=CASE WHEN t.typtype='d' THEN t.typbasetype ELSE t.oid END ORDER BY e.enumsortorder) AS enum_values FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid::bigint=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum"#).bind(oid).fetch_all(&mut c).await.map_err(error)?;
    let columns: Vec<ColumnInfo> = rows
        .iter()
        .map(|r| {
            let generated: String = r.get("generated");
            let identity: String = r.get("identity");
            ColumnInfo {
                ordinal: r.get("ordinal"),
                name: r.get("name"),
                data_type: r.get("data_type"),
                nullable: r.get("nullable"),
                default_value: r.get("default_value"),
                primary_key_position: r.get("pk"),
                generated: match generated.as_str() {
                    "s" => Some("STORED".into()),
                    "v" => Some("VIRTUAL".into()),
                    _ => None,
                },
                identity: match identity.as_str() {
                    "a" => Some("ALWAYS".into()),
                    "d" => Some("BY DEFAULT".into()),
                    _ => None,
                },
                comment: r.get("comment"),
                type_detail: r.get("type_detail"),
                enum_values: r.get("enum_values"),
            }
        })
        .collect();
    let rows=sqlx::query(r#"SELECT x.conname::text AS name,x.contype::text AS kind,pg_get_constraintdef(x.oid,true) AS definition,ARRAY(SELECT a.attname::text FROM unnest(x.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=x.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS columns FROM pg_constraint x WHERE x.conrelid::bigint=$1 ORDER BY x.contype,x.conname"#).bind(oid).fetch_all(&mut c).await.map_err(error)?;
    let constraints: Vec<ConstraintInfo> = rows
        .iter()
        .map(|r| {
            let code: String = r.get("kind");
            ConstraintInfo {
                name: Some(r.get("name")),
                kind: match code.as_str() {
                    "p" => "PRIMARY KEY",
                    "f" => "FOREIGN KEY",
                    "u" => "UNIQUE",
                    "c" => "CHECK",
                    "x" => "EXCLUSION",
                    "n" => "NOT NULL",
                    _ => "OTHER",
                }
                .into(),
                columns: r.get("columns"),
                definition: r.get("definition"),
            }
        })
        .collect();
    let rows=sqlx::query(r#"SELECT ci.relname::text AS name,i.indisunique AS unique,i.indisprimary AS primary,i.indisvalid AS valid,am.amname::text AS method,i.indnkeyatts::int AS key_count,pg_get_expr(i.indpred,i.indrelid) AS predicate,pg_get_indexdef(i.indexrelid) AS definition,ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnatts) k ORDER BY k) AS parts FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid JOIN pg_am am ON am.oid=ci.relam WHERE i.indrelid::bigint=$1 ORDER BY ci.relname"#).bind(oid).fetch_all(&mut c).await.map_err(error)?;
    let indexes: Vec<IndexInfo> = rows
        .iter()
        .map(|r| {
            let key_count: i32 = r.get("key_count");
            let parts: Vec<String> = r.get("parts");
            IndexInfo {
                name: r.get("name"),
                unique: r.get("unique"),
                primary: r.get("primary"),
                valid: Some(r.get("valid")),
                method: r.get("method"),
                partial: r.get::<Option<String>, _>("predicate").is_some(),
                predicate: r.get("predicate"),
                definition: Some(r.get("definition")),
                origin: "PostgreSQL catalog".into(),
                parts: parts
                    .into_iter()
                    .enumerate()
                    .map(|(i, expression)| IndexPart {
                        expression,
                        role: if (i as i32) < key_count {
                            "key"
                        } else {
                            "included"
                        }
                        .into(),
                        descending: None,
                    })
                    .collect(),
            }
        })
        .collect();
    let rows=sqlx::query(r#"SELECT x.oid::text AS id,x.conname::text AS name,sn.nspname::text AS source_schema,s.relname::text AS source_table,tn.nspname::text AS target_schema,t.relname::text AS target_table,x.confupdtype::text AS on_update,x.confdeltype::text AS on_delete,x.convalidated AS validated,x.condeferrable AS deferrable,ARRAY(SELECT a.attname::text FROM unnest(x.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=x.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS source_columns,ARRAY(SELECT a.attname::text FROM unnest(x.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=x.confrelid AND a.attnum=k.attnum ORDER BY k.ord) AS target_columns FROM pg_constraint x JOIN pg_class s ON s.oid=x.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace JOIN pg_class t ON t.oid=x.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace WHERE x.contype='f' AND (x.conrelid::bigint=$1 OR x.confrelid::bigint=$1) ORDER BY sn.nspname,s.relname,x.conname LIMIT 10001"#).bind(oid).fetch_all(&mut c).await.map_err(error)?;
    if rows.len() > 10000 {
        return Err("Relationship metadata exceeds 10,000 foreign keys".into());
    }
    let relations = rows
        .iter()
        .map(|r| {
            let from: Vec<String> = r.get("source_columns");
            let to: Vec<String> = r.get("target_columns");
            Relation {
                id: r.get("id"),
                name: Some(r.get("name")),
                from_table: object(
                    r.get::<String, _>("source_schema").as_str(),
                    r.get::<String, _>("source_table").as_str(),
                ),
                to_table: object(
                    r.get::<String, _>("target_schema").as_str(),
                    r.get::<String, _>("target_table").as_str(),
                ),
                columns: from
                    .into_iter()
                    .zip(to)
                    .map(|(from, to)| ColumnPair { from, to: Some(to) })
                    .collect(),
                on_update: action(&r.get::<String, _>("on_update")),
                on_delete: action(&r.get::<String, _>("on_delete")),
                validated: Some(r.get("validated")),
                deferrable: Some(r.get("deferrable")),
            }
        })
        .collect();
    let table = Table {
        schema: selected.schema.clone(),
        name: selected.name.clone(),
        kind: kind.into(),
    };
    let qualified = format!("{}.{}", db::quoted(&table.schema), db::quoted(&table.name));
    let definition = if code == "v" || code == "m" {
        let body: String = sqlx::query_scalar("SELECT pg_get_viewdef($1::bigint::oid,true)")
            .bind(oid)
            .fetch_one(&mut c)
            .await
            .map_err(error)?;
        Some(format!(
            "CREATE {}VIEW {qualified} AS\n{body}",
            if code == "m" { "MATERIALIZED " } else { "" }
        ))
    } else if code == "r" || code == "p" {
        let mut lines: Vec<String> = columns
            .iter()
            .map(|col| {
                let mut s = format!("  {} {}", db::quoted(&col.name), col.data_type);
                if let Some(generated) = &col.generated {
                    s.push_str(&format!(
                        " GENERATED ALWAYS AS ({}) {generated}",
                        col.default_value.as_deref().unwrap_or("/* unavailable */")
                    ));
                } else if let Some(identity) = &col.identity {
                    s.push_str(&format!(" GENERATED {identity} AS IDENTITY"));
                } else if let Some(default) = &col.default_value {
                    s.push_str(&format!(" DEFAULT {default}"));
                }
                if !col.nullable {
                    s.push_str(" NOT NULL");
                }
                s
            })
            .collect();
        lines.extend(
            constraints
                .iter()
                .filter(|c| c.kind != "NOT NULL")
                .map(|c| {
                    format!(
                        "  CONSTRAINT {} {}",
                        db::quoted(c.name.as_deref().unwrap_or("unnamed")),
                        c.definition
                    )
                }),
        );
        let mut s=format!("-- Catalog preview only; not a complete schema export.\nCREATE TABLE {qualified} (\n{}\n);",lines.join(",\n"));
        for index in &indexes {
            if let Some(definition) = &index.definition {
                if !index.primary
                    && !constraints
                        .iter()
                        .any(|c| c.name.as_ref() == Some(&index.name))
                {
                    s.push_str(&format!("\n\n{definition};"));
                }
            }
        }
        Some(s)
    } else {
        None
    };
    Ok(TableDetails{table,columns,indexes,constraints,relations,definition,definition_kind:"PostgreSQL catalog preview".into(),comment:relation.get("comment"),strict:None,without_rowid:None,rowid_alias:None,foreign_keys_enforced:None,notes:vec!["PostgreSQL SQL is a catalog-derived preview, not a complete pg_dump export. Partition/inheritance clauses, sequence options, grants, triggers, storage, and referenced types are not reconstructed.".into()]})
}

#[cfg(test)]
#[path = "metadata_tests.rs"]
mod tests;
