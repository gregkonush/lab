use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct Account {
  pub id: i64,
  pub code: String,
  pub name: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct JournalLine {
  pub id: i64,
  pub entry_id: i64,
  pub account_id: i64,
  pub account_code: String,
  pub account_name: String,
  pub debit: f64,
  pub credit: f64,
}

#[derive(Debug, Serialize)]
pub struct JournalEntry {
  pub id: i64,
  pub reference: Option<String>,
  pub description: String,
  pub entry_date: String,
  pub lines: Vec<JournalLine>,
}

#[derive(Debug, Serialize)]
pub struct BootstrapPayload {
  pub accounts: Vec<Account>,
  pub entries: Vec<JournalEntry>,
}
