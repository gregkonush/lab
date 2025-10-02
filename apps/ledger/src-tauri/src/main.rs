#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::BTreeMap;
use std::error::Error;
use std::path::PathBuf;

use chrono::NaiveDate;
use libsql::{params, Builder, Connection, Database, Value};
use serde::Deserialize;
use tauri::{AppHandle, State};
use thiserror::Error;

mod models;

use models::{Account, BootstrapPayload, JournalEntry, JournalLine};

type Result<T> = std::result::Result<T, AppError>;

struct AppState {
  db: Database,
}

#[derive(Debug, Error)]
enum AppError {
  #[error("{0}")]
  Message(String),
  #[error("database error: {0}")]
  Database(#[from] libsql::Error),
  #[error("io error: {0}")]
  Io(#[from] std::io::Error),
  #[error("failed to resolve application data directory")]
  AppDir,
  #[error("invalid date supplied")]
  InvalidDate,
  #[error("journal entry not found")]
  NotFound,
}

impl From<AppError> for String {
  fn from(value: AppError) -> Self {
    value.to_string()
  }
}

#[derive(Debug, Deserialize)]
struct JournalEntryLineInput {
  account_id: i64,
  debit: f64,
  credit: f64,
}

#[derive(Debug, Deserialize)]
struct JournalEntryInput {
  entry_date: String,
  reference: Option<String>,
  description: String,
  lines: Vec<JournalEntryLineInput>,
}

impl AppState {
  async fn new(app: &AppHandle) -> Result<Self> {
    let db_path = Self::resolve_db_path(app)?;
    let db = Builder::new_local(db_path.to_string_lossy()).build().await?;
    let state = Self { db };
    state.ensure_schema().await?;
    Ok(state)
  }

  fn resolve_db_path(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
      .path_resolver()
      .app_data_dir()
      .ok_or(AppError::AppDir)?;
    std::fs::create_dir_all(&data_dir)?;
    Ok(data_dir.join("ledger.db"))
  }

  async fn ensure_schema(&self) -> Result<()> {
    let conn = self.connection().await?;
    conn
      .execute(
        "CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL
          )",
        (),
      )
      .await?;
    conn
      .execute(
        "CREATE TABLE IF NOT EXISTS journal_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_date TEXT NOT NULL,
            reference TEXT,
            description TEXT NOT NULL
          )",
        (),
      )
      .await?;
    conn
      .execute(
        "CREATE TABLE IF NOT EXISTS journal_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            debit REAL NOT NULL DEFAULT 0,
            credit REAL NOT NULL DEFAULT 0,
            FOREIGN KEY(entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
            FOREIGN KEY(account_id) REFERENCES accounts(id)
          )",
        (),
      )
      .await?;

    let mut count_rows = conn
      .query("SELECT COUNT(1) FROM accounts", ())
      .await?;
    let count_row = count_rows.next().await?.unwrap();
    let existing: i64 = count_row.get(0)?;
    if existing == 0 {
      let defaults = [
        ("1000", "Cash"),
        ("1100", "Accounts Receivable"),
        ("2000", "Accounts Payable"),
        ("3000", "Owner's Equity"),
      ];
      for (code, name) in defaults {
        conn
          .execute(
            "INSERT OR IGNORE INTO accounts (code, name) VALUES (?1, ?2)",
            params![code, name],
          )
          .await?;
      }
    }

    Ok(())
  }

  async fn connection(&self) -> Result<Connection> {
    let conn = self.db.connect()?;
    conn.execute("PRAGMA foreign_keys = ON", ()).await?;
    Ok(conn)
  }

  async fn list_accounts(&self) -> Result<Vec<Account>> {
    let conn = self.connection().await?;
    let mut rows = conn
      .query(
        "SELECT id, code, name FROM accounts ORDER BY code ASC",
        (),
      )
      .await?;
    let mut accounts = Vec::new();
    while let Some(row) = rows.next().await? {
      accounts.push(Account {
        id: row.get(0)?,
        code: row.get(1)?,
        name: row.get(2)?,
      });
    }
    Ok(accounts)
  }

  async fn list_entries(&self) -> Result<Vec<JournalEntry>> {
    let conn = self.connection().await?;
    let mut rows = conn
      .query(
        "SELECT
            e.id,
            e.reference,
            e.description,
            e.entry_date,
            l.id,
            l.account_id,
            a.code,
            a.name,
            l.debit,
            l.credit
          FROM journal_entries e
          JOIN journal_lines l ON l.entry_id = e.id
          JOIN accounts a ON a.id = l.account_id
          ORDER BY e.entry_date DESC, e.id DESC, l.id ASC",
        (),
      )
      .await?;
    let mut entries: BTreeMap<i64, JournalEntry> = BTreeMap::new();
    while let Some(row) = rows.next().await? {
      let entry_id: i64 = row.get(0)?;
      let reference = match row.get_value(1)? {
        Value::Null => None,
        Value::Text(text) => Some(text),
        other => Some(other.to_string()),
      };
      let description: String = row.get(2)?;
      let entry_date: String = row.get(3)?;
      let line = JournalLine {
        id: row.get(4)?,
        entry_id,
        account_id: row.get(5)?,
        account_code: row.get(6)?,
        account_name: row.get(7)?,
        debit: row.get(8)?,
        credit: row.get(9)?,
      };
      entries
        .entry(entry_id)
        .and_modify(|entry| entry.lines.push(line.clone()))
        .or_insert_with(|| JournalEntry {
          id: entry_id,
          reference,
          description: description.clone(),
          entry_date: entry_date.clone(),
          lines: vec![line],
        });
    }
    let mut sorted: Vec<JournalEntry> = entries.into_values().collect();
    sorted.sort_by(|a, b| b.entry_date.cmp(&a.entry_date).then(b.id.cmp(&a.id)));
    Ok(sorted)
  }

  async fn get_entry(&self, entry_id: i64) -> Result<JournalEntry> {
    let conn = self.connection().await?;
    let mut entry_rows = conn
      .query(
        "SELECT id, reference, description, entry_date FROM journal_entries WHERE id = ?1",
        params![entry_id],
      )
      .await?;
    let entry_row = entry_rows.next().await?.ok_or(AppError::NotFound)?;
    let reference = match entry_row.get_value(1)? {
      Value::Null => None,
      Value::Text(text) => Some(text),
      other => Some(other.to_string()),
    };
    let description: String = entry_row.get(2)?;
    let entry_date: String = entry_row.get(3)?;

    let mut line_rows = conn
      .query(
        "SELECT l.id, l.account_id, a.code, a.name, l.debit, l.credit
         FROM journal_lines l
         JOIN accounts a ON a.id = l.account_id
         WHERE l.entry_id = ?1
         ORDER BY l.id ASC",
        params![entry_id],
      )
      .await?;
    let mut lines = Vec::new();
    while let Some(row) = line_rows.next().await? {
      lines.push(JournalLine {
        id: row.get(0)?,
        entry_id,
        account_id: row.get(1)?,
        account_code: row.get(2)?,
        account_name: row.get(3)?,
        debit: row.get(4)?,
        credit: row.get(5)?,
      });
    }

    Ok(JournalEntry {
      id: entry_id,
      reference,
      description,
      entry_date,
      lines,
    })
  }
}

#[tauri::command]
async fn bootstrap(state: State<'_, AppState>) -> std::result::Result<BootstrapPayload, String> {
  let accounts = state.list_accounts().await.map_err(String::from)?;
  let entries = state.list_entries().await.map_err(String::from)?;
  Ok(BootstrapPayload { accounts, entries })
}

#[tauri::command]
async fn create_account(
  code: String,
  name: String,
  state: State<'_, AppState>,
) -> std::result::Result<Account, String> {
  if code.trim().is_empty() || name.trim().is_empty() {
    return Err(AppError::Message("Account code and name are required".into()).into());
  }
  let conn = state.connection().await.map_err(String::from)?;
  let affected = conn
    .execute(
      "INSERT OR IGNORE INTO accounts (code, name) VALUES (?1, ?2)",
      params![code.trim(), name.trim()],
    )
    .await
    .map_err(String::from)?;
  if affected == 0 {
    return Err(AppError::Message("An account with that code already exists".into()).into());
  }
  let account_id = conn.last_insert_rowid();
  Ok(Account {
    id: account_id,
    code: code.trim().to_string(),
    name: name.trim().to_string(),
  })
}

#[tauri::command]
async fn create_journal_entry(
  entry: JournalEntryInput,
  state: State<'_, AppState>,
) -> std::result::Result<JournalEntry, String> {
  if entry.description.trim().is_empty() {
    return Err(AppError::Message("Description is required".into()).into());
  }
  if entry.lines.is_empty() {
    return Err(AppError::Message("At least one line is required".into()).into());
  }
  if NaiveDate::parse_from_str(&entry.entry_date, "%Y-%m-%d").is_err() {
    return Err(AppError::InvalidDate.into());
  }

  let debit_total: f64 = entry.lines.iter().map(|line| line.debit).sum();
  let credit_total: f64 = entry.lines.iter().map(|line| line.credit).sum();
  if (debit_total - credit_total).abs() > 0.005 {
    return Err(AppError::Message("Debits must equal credits".into()).into());
  }

  let conn = state.connection().await.map_err(String::from)?;
  let tx = conn.transaction().await.map_err(String::from)?;
  let trimmed_description = entry.description.trim().to_string();
  let reference = entry
    .reference
    .as_ref()
    .map(|value| value.trim())
    .filter(|value| !value.is_empty());
  tx
    .execute(
      "INSERT INTO journal_entries (entry_date, reference, description) VALUES (?1, ?2, ?3)",
      params![entry.entry_date, reference, trimmed_description],
    )
    .await
    .map_err(String::from)?;
  let entry_id = tx.last_insert_rowid();

  for line in entry.lines {
    let amount_check = (line.debit > 0.0) as i32 + (line.credit > 0.0) as i32;
    if amount_check == 2 {
      return Err(AppError::Message("A line cannot contain both debit and credit values".into()).into());
    }
    if amount_check == 0 {
      continue;
    }
    tx
      .execute(
        "INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?1, ?2, ?3, ?4)",
        params![entry_id, line.account_id, line.debit, line.credit],
      )
      .await
      .map_err(String::from)?;
  }

  tx.commit().await.map_err(String::from)?;
  state.get_entry(entry_id).await.map_err(String::from)
}

#[tauri::command]
async fn health_check() -> &'static str {
  "ok"
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let handle = app.handle();
      match tauri::async_runtime::block_on(AppState::new(&handle)) {
        Ok(state) => {
          app.manage(state);
          Ok(())
        }
        Err(err) => Err(Box::new(err) as Box<dyn Error>),
      }
    })
    .invoke_handler(tauri::generate_handler![
      bootstrap,
      create_account,
      create_journal_entry,
      health_check
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
