PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (
  number TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('human','ai')),
  password TEXT, CHECK ((kind='human') = (password IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sessions (
  digest TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES users, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES users, recipient TEXT NOT NULL REFERENCES users,
  state TEXT NOT NULL, created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_pair ON requests(min(sender,recipient),max(sender,recipient)) WHERE state='pending';
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, owner TEXT REFERENCES users,
  first_user TEXT REFERENCES users, second_user TEXT REFERENCES users, created TEXT NOT NULL,
  UNIQUE(first_user,second_user)
);
CREATE TABLE IF NOT EXISTS members (
  chat TEXT NOT NULL REFERENCES chats, account TEXT NOT NULL REFERENCES users, since INTEGER NOT NULL,
  PRIMARY KEY(chat,account)
);
CREATE INDEX IF NOT EXISTS membership_by_account ON members(account,chat);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL REFERENCES chats,
  sender TEXT NOT NULL REFERENCES users, nonce TEXT NOT NULL, body TEXT NOT NULL,
  created TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0, UNIQUE(chat,sender,nonce)
);
CREATE INDEX IF NOT EXISTS chat_history ON messages(chat,id);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, reporter TEXT NOT NULL REFERENCES users, message INTEGER NOT NULL REFERENCES messages,
  reason TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, reviewed TEXT,
  UNIQUE(reporter,message)
);
