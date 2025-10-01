import { FormEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import type { Account, BootstrapPayload, JournalEntry } from "./models";

type JournalLineDraft = {
  accountId: string;
  debit: string;
  credit: string;
};

type JournalFormState = {
  entryDate: string;
  reference: string;
  description: string;
  lines: JournalLineDraft[];
};

const today = () => new Date().toISOString().slice(0, 10);

const newLineDraft = (): JournalLineDraft => ({
  accountId: "",
  debit: "",
  credit: "",
});

function formatCurrency(amount: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [form, setForm] = useState<JournalFormState>({
    entryDate: today(),
    reference: "",
    description: "",
    lines: [newLineDraft(), newLineDraft()],
  });
  const [accountDraft, setAccountDraft] = useState({ code: "", name: "" });
  const [accountError, setAccountError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      setLoading(true);
      const data = await invoke<BootstrapPayload>("bootstrap");
      setAccounts(data.accounts);
      setEntries(data.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const totals = useMemo(() => {
    const totalDebit = entries.reduce((sum, entry) => {
      return (
        sum + entry.lines.reduce((lineSum, line) => lineSum + line.debit, 0)
      );
    }, 0);
    const totalCredit = entries.reduce((sum, entry) => {
      return (
        sum + entry.lines.reduce((lineSum, line) => lineSum + line.credit, 0)
      );
    }, 0);
    return { totalDebit, totalCredit };
  }, [entries]);

  function updateLine(index: number, patch: Partial<JournalLineDraft>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    }));
  }

  function addLine() {
    setForm((current) => ({
      ...current,
      lines: [...current.lines, newLineDraft()],
    }));
  }

  function removeLine(index: number) {
    setForm((current) => ({
      ...current,
      lines: current.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountDraft.code.trim() || !accountDraft.name.trim()) {
      setAccountError("Account code and name are required.");
      return;
    }
    try {
      setAccountError(null);
      const account = await invoke<Account>("create_account", {
        code: accountDraft.code.trim(),
        name: accountDraft.name.trim(),
      });
      setAccounts((current) => [...current, account]);
      setAccountDraft({ code: "", name: "" });
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const preparedLines = form.lines
      .map((line) => ({
        accountId: Number.parseInt(line.accountId, 10),
        debit: Number.parseFloat(line.debit || "0"),
        credit: Number.parseFloat(line.credit || "0"),
      }))
      .filter(
        (line) =>
          !Number.isNaN(line.accountId) && (line.debit > 0 || line.credit > 0),
      );

    if (preparedLines.length < 2) {
      setError("At least two lines with amounts are required.");
      return;
    }

    if (preparedLines.some((line) => line.debit > 0 && line.credit > 0)) {
      setError(
        "Each line should have either a debit or credit amount, not both.",
      );
      return;
    }

    const totalDebit = preparedLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = preparedLines.reduce(
      (sum, line) => sum + line.credit,
      0,
    );

    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      setError("Debits must equal credits.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const entry = await invoke<JournalEntry>("create_journal_entry", {
        entry: {
          entryDate: form.entryDate,
          reference: form.reference.trim() || null,
          description: form.description.trim(),
          lines: preparedLines,
        },
      });
      setEntries((current) => [entry, ...current]);
      setForm({
        entryDate: today(),
        reference: "",
        description: "",
        lines: [newLineDraft(), newLineDraft()],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Ledger</h1>
      {loading ? (
        <p>Loading ledger...</p>
      ) : (
        <>
          {error ? <p className="error">{error}</p> : null}
          <section className="card" aria-labelledby="journal-entry-heading">
            <h2 id="journal-entry-heading">New journal entry</h2>
            <form onSubmit={handleSubmit}>
              <fieldset>
                <label htmlFor="entry-date">Entry date</label>
                <input
                  id="entry-date"
                  type="date"
                  value={form.entryDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      entryDate: event.target.value,
                    }))
                  }
                  required
                />
              </fieldset>
              <fieldset>
                <label htmlFor="reference">Reference</label>
                <input
                  id="reference"
                  value={form.reference}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reference: event.target.value,
                    }))
                  }
                  placeholder="Optional reference..."
                />
              </fieldset>
              <fieldset>
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  rows={3}
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Describe the transaction..."
                  required
                />
              </fieldset>
              <fieldset>
                <div className="legend">Lines</div>
                <div className="lines-grid" role="list">
                  {form.lines.map((line, index) => (
                    <div
                      key={`line-${index}`}
                      className="line-row"
                      role="listitem"
                    >
                      <div>
                        <label htmlFor={`account-${index}`}>Account</label>
                        <select
                          id={`account-${index}`}
                          value={line.accountId}
                          onChange={(event) =>
                            updateLine(index, { accountId: event.target.value })
                          }
                          required
                        >
                          <option value="">Select account…</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} · {account.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`debit-${index}`}>Debit</label>
                        <input
                          id={`debit-${index}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.debit}
                          onChange={(event) =>
                            updateLine(index, { debit: event.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor={`credit-${index}`}>Credit</label>
                        <input
                          id={`credit-${index}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.credit}
                          onChange={(event) =>
                            updateLine(index, { credit: event.target.value })
                          }
                        />
                      </div>
                      {form.lines.length > 2 ? (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          style={{
                            marginTop: "32px",
                            background: "#2e3340",
                            color: "#f5f7fb",
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    onClick={addLine}
                    style={{ background: "#2e3340", color: "#f5f7fb" }}
                  >
                    Add line
                  </button>
                </div>
              </fieldset>
              <div className="actions">
                <button type="submit" disabled={submitting}>
                  {submitting ? "Recording…" : "Record entry"}
                </button>
              </div>
            </form>
          </section>

          <section className="card" aria-labelledby="accounts-heading">
            <h2 id="accounts-heading">Chart of accounts</h2>
            <form
              onSubmit={handleCreateAccount}
              style={{ marginTop: "16px", display: "grid", gap: "12px" }}
            >
              <div>
                <label htmlFor="account-code">Account code</label>
                <input
                  id="account-code"
                  value={accountDraft.code}
                  onChange={(event) =>
                    setAccountDraft((current) => ({
                      ...current,
                      code: event.target.value,
                    }))
                  }
                  placeholder="1000"
                  required
                />
              </div>
              <div>
                <label htmlFor="account-name">Account name</label>
                <input
                  id="account-name"
                  value={accountDraft.name}
                  onChange={(event) =>
                    setAccountDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Cash"
                  required
                />
              </div>
              <div className="actions">
                <button type="submit">Add account</button>
              </div>
              {accountError ? <p className="error">{accountError}</p> : null}
            </form>
            <div className="table-wrapper" aria-live="polite">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.code}</td>
                      <td>{account.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" aria-labelledby="entries-heading">
            <h2 id="entries-heading">Recent journal entries</h2>
            <div className="summary" role="group" aria-label="Totals">
              <div className="summary-item">
                <span className="summary-label">Total debits</span>
                <span className="summary-value">
                  {formatCurrency(totals.totalDebit)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total credits</span>
                <span className="summary-value">
                  {formatCurrency(totals.totalCredit)}
                </span>
              </div>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Description</th>
                    <th scope="col">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.entryDate}</td>
                      <td>{entry.reference || "—"}</td>
                      <td>{entry.description}</td>
                      <td>
                        <div className="badge">{entry.lines.length} lines</div>
                        <ul
                          style={{
                            margin: "8px 0 0",
                            padding: 0,
                            listStyle: "none",
                            display: "grid",
                            gap: "6px",
                          }}
                        >
                          {entry.lines.map((line) => (
                            <li key={line.id}>
                              {line.accountCode} · {line.accountName} —
                              {line.debit > 0
                                ? ` Debit ${formatCurrency(line.debit)}`
                                : null}
                              {line.credit > 0
                                ? ` Credit ${formatCurrency(line.credit)}`
                                : null}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
