export type Account = {
  id: number;
  code: string;
  name: string;
};

export type JournalLine = {
  id: number;
  entryId: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
};

export type JournalEntry = {
  id: number;
  reference: string | null;
  description: string;
  entryDate: string;
  lines: JournalLine[];
};

export type BootstrapPayload = {
  accounts: Account[];
  entries: JournalEntry[];
};
