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
CREATE TABLE IF NOT EXISTS bothouse_pair_codes (
  account TEXT PRIMARY KEY REFERENCES users(number) ON DELETE CASCADE,
  digest TEXT NOT NULL, scope TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bothouse_links (
  account TEXT PRIMARY KEY REFERENCES users(number) ON DELETE CASCADE,
  scope TEXT NOT NULL, revision TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES users, recipient TEXT NOT NULL REFERENCES users,
  state TEXT NOT NULL, created TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_pair ON requests(min(sender,recipient),max(sender,recipient)) WHERE state='pending';
CREATE INDEX IF NOT EXISTS requests_sender_recipient ON requests(sender,recipient);
CREATE TABLE IF NOT EXISTS ai_friend_preferences (
  human TEXT PRIMARY KEY REFERENCES users(number),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_friend_role_preferences (
  human TEXT NOT NULL REFERENCES ai_friend_preferences(human) ON DELETE CASCADE,
  ai TEXT NOT NULL REFERENCES users(number) CHECK(ai IN ('arcade_ju','arcade_dragon')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL,
  PRIMARY KEY(human,ai)
);
CREATE TABLE IF NOT EXISTS friend_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL REFERENCES users(number),
  nonce TEXT NOT NULL,
  body TEXT NOT NULL,
  created TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE(author,nonce)
);
CREATE INDEX IF NOT EXISTS visible_friend_posts ON friend_posts(author,id DESC) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS ai_feed_follows (
  account TEXT NOT NULL REFERENCES users(number),
  role TEXT NOT NULL REFERENCES users(number),
  PRIMARY KEY(account,role)
);
CREATE INDEX IF NOT EXISTS ai_feed_follows_by_role ON ai_feed_follows(role);
CREATE TABLE IF NOT EXISTS ai_feed_turns (
  role TEXT NOT NULL REFERENCES users(number),
  day TEXT NOT NULL,
  started INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','published','quiet','failed')),
  PRIMARY KEY(role,day)
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, owner TEXT REFERENCES users,
  first_user TEXT REFERENCES users, second_user TEXT REFERENCES users, created TEXT NOT NULL,
  UNIQUE(first_user,second_user)
);
CREATE TABLE IF NOT EXISTS ai_web_search_settings (
  chat TEXT PRIMARY KEY REFERENCES chats ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  chat TEXT NOT NULL REFERENCES chats, account TEXT NOT NULL REFERENCES users, since INTEGER NOT NULL,
  PRIMARY KEY(chat,account)
);
CREATE INDEX IF NOT EXISTS membership_by_account ON members(account,chat);
CREATE TABLE IF NOT EXISTS conversation_membership_revisions (
  chat TEXT NOT NULL, account TEXT NOT NULL, revision TEXT NOT NULL,
  PRIMARY KEY(chat,account),
  FOREIGN KEY(chat,account) REFERENCES members(chat,account) ON DELETE CASCADE
);
CREATE TRIGGER IF NOT EXISTS assign_conversation_membership_revision AFTER INSERT ON members
BEGIN
  INSERT INTO conversation_membership_revisions VALUES(NEW.chat,NEW.account,lower(hex(randomblob(16))));
END;
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT NOT NULL REFERENCES chats,
  sender TEXT NOT NULL REFERENCES users, nonce TEXT NOT NULL, body TEXT NOT NULL,
  created TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0, UNIQUE(chat,sender,nonce)
);
CREATE INDEX IF NOT EXISTS chat_history ON messages(chat,id);
CREATE TABLE IF NOT EXISTS message_web_results (
  message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  sources TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_appointments (
  id TEXT PRIMARY KEY, chat TEXT NOT NULL REFERENCES chats(id), human TEXT NOT NULL REFERENCES users(number),
  task TEXT NOT NULL, wall TEXT NOT NULL, time_zone TEXT NOT NULL, due INTEGER NOT NULL, updated INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','sent','cancelled','missed'))
);
CREATE INDEX IF NOT EXISTS ai_appointments_due ON ai_appointments(due) WHERE state='pending';
CREATE INDEX IF NOT EXISTS ai_appointments_chat ON ai_appointments(chat,human);
CREATE TABLE IF NOT EXISTS ai_appointment_drafts (
  chat TEXT PRIMARY KEY REFERENCES chats(id), human TEXT NOT NULL REFERENCES users(number),
  task TEXT NOT NULL, day TEXT, time_zone TEXT, until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_appointment_messages (
  message INTEGER PRIMARY KEY REFERENCES messages(id), reply INTEGER REFERENCES messages(id)
);
CREATE INDEX IF NOT EXISTS ai_appointment_drafts_until ON ai_appointment_drafts(until);
CREATE TABLE IF NOT EXISTS conversation_reads (
  chat TEXT NOT NULL, account TEXT NOT NULL, through INTEGER NOT NULL CHECK(through>=0),
  PRIMARY KEY(chat,account),
  FOREIGN KEY(chat,account) REFERENCES members(chat,account) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS local_web_search_messages (
  message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS local_reaction_messages (
  message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS local_reaction_scan (
  chat TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  last_message INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS message_replies (
  message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  original INTEGER NOT NULL REFERENCES messages(id)
);
CREATE TABLE IF NOT EXISTS message_mentions (
  message INTEGER PRIMARY KEY REFERENCES messages,
  account TEXT NOT NULL REFERENCES users
);
CREATE TABLE IF NOT EXISTS message_images (
  message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
  width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
  digest TEXT NOT NULL, bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND 4194304)
);
CREATE TABLE IF NOT EXISTS message_stickers (
  message INTEGER PRIMARY KEY REFERENCES message_images(message) ON DELETE CASCADE,
  label TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS image_ai_permissions (
  image INTEGER NOT NULL REFERENCES message_images(message) ON DELETE CASCADE,
  ai TEXT NOT NULL REFERENCES users(number), provider TEXT NOT NULL, revision TEXT NOT NULL,
  PRIMARY KEY(image,ai)
);
CREATE TABLE IF NOT EXISTS ai_image_turns (
  prompt INTEGER PRIMARY KEY REFERENCES messages(id), chat TEXT NOT NULL REFERENCES chats(id),
  image INTEGER NOT NULL REFERENCES message_images(message), ai TEXT NOT NULL REFERENCES users(number),
  started INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','failed','answered')),
  reply INTEGER REFERENCES messages(id)
);
CREATE INDEX IF NOT EXISTS ai_image_turn_time ON ai_image_turns(started,chat);
CREATE UNIQUE INDEX IF NOT EXISTS ai_image_pending ON ai_image_turns(chat) WHERE state='pending';
CREATE TABLE IF NOT EXISTS message_voices (
  message INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 200 AND 120000),
  digest TEXT NOT NULL, bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 6444 AND 3840044)
);
CREATE TABLE IF NOT EXISTS ai_voice_choices (
  chat TEXT NOT NULL, human TEXT NOT NULL, ai TEXT NOT NULL,
  voice TEXT, revision TEXT NOT NULL,
  PRIMARY KEY(chat,human,ai),
  FOREIGN KEY(chat,human) REFERENCES members(chat,account) ON DELETE CASCADE,
  FOREIGN KEY(chat,ai) REFERENCES members(chat,account) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ai_voice_preferences (
  human TEXT NOT NULL REFERENCES users(number),
  ai TEXT NOT NULL REFERENCES users(number),
  voice TEXT, revision TEXT NOT NULL,
  PRIMARY KEY(human,ai)
);
CREATE TABLE IF NOT EXISTS ai_voice_scopes (
  chat TEXT NOT NULL, human TEXT NOT NULL, ai TEXT NOT NULL,
  backend TEXT NOT NULL CHECK(backend IN ('local','azure')),
  revision TEXT NOT NULL, legacy_voice TEXT,
  PRIMARY KEY(chat,human,ai),
  FOREIGN KEY(chat,human) REFERENCES members(chat,account) ON DELETE CASCADE,
  FOREIGN KEY(chat,ai) REFERENCES members(chat,account) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS message_sticker_sources (
  message INTEGER PRIMARY KEY REFERENCES message_stickers(message) ON DELETE CASCADE,
  source_code TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_direct_grants (
  chat TEXT PRIMARY KEY REFERENCES chats,
  human TEXT NOT NULL REFERENCES users,
  ai TEXT NOT NULL REFERENCES users
);
CREATE TABLE IF NOT EXISTS ai_direct_permissions (
  chat TEXT PRIMARY KEY REFERENCES ai_direct_grants,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL,
  context_floor INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_direct_turns (
  prompt INTEGER PRIMARY KEY REFERENCES messages,
  chat TEXT NOT NULL REFERENCES ai_direct_grants,
  state TEXT NOT NULL CHECK(state IN ('pending','failed','answered')),
  started INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_direct_daily ON ai_direct_turns(started,chat);
CREATE UNIQUE INDEX IF NOT EXISTS ai_direct_pending ON ai_direct_turns(chat) WHERE state='pending';
CREATE TABLE IF NOT EXISTS ai_direct_proactive (
  chat TEXT PRIMARY KEY REFERENCES ai_direct_grants(chat),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 0 AND 1439),
  time_zone TEXT NOT NULL,
  revision INTEGER NOT NULL,
  CHECK(start_minute<>end_minute)
);
CREATE INDEX IF NOT EXISTS enabled_ai_direct_proactive ON ai_direct_proactive(chat) WHERE enabled=1;
CREATE TABLE IF NOT EXISTS ai_proactive_turns (
  chat TEXT NOT NULL REFERENCES ai_direct_grants(chat),
  local_day TEXT NOT NULL,
  started INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','sent','quiet','failed','cancelled')),
  PRIMARY KEY(chat,local_day)
);
CREATE INDEX IF NOT EXISTS ai_proactive_daily ON ai_proactive_turns(started,chat);
CREATE INDEX IF NOT EXISTS ai_proactive_last_check ON ai_proactive_turns(chat,started DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_proactive_pending ON ai_proactive_turns(chat) WHERE state='pending';
CREATE TRIGGER IF NOT EXISTS stop_proactive_on_direct_pause_insert
AFTER INSERT ON ai_direct_permissions WHEN NEW.enabled=0
BEGIN
  UPDATE ai_direct_proactive SET enabled=0,revision=revision+1 WHERE chat=NEW.chat AND enabled=1;
  UPDATE ai_proactive_turns SET state='cancelled' WHERE chat=NEW.chat AND state='pending';
END;
CREATE TRIGGER IF NOT EXISTS stop_proactive_on_direct_pause_update
AFTER UPDATE OF enabled ON ai_direct_permissions WHEN NEW.enabled=0
BEGIN
  UPDATE ai_direct_proactive SET enabled=0,revision=revision+1 WHERE chat=NEW.chat AND enabled=1;
  UPDATE ai_proactive_turns SET state='cancelled' WHERE chat=NEW.chat AND state='pending';
END;
-- Older service code can still see the original grant after a same-file rollback.
CREATE TRIGGER IF NOT EXISTS ai_direct_paused_guard
BEFORE INSERT ON ai_direct_turns
WHEN EXISTS (SELECT 1 FROM ai_direct_permissions WHERE chat=NEW.chat AND enabled=0)
BEGIN
  SELECT RAISE(ABORT, 'AI direct cloud consent has been withdrawn');
END;
-- SQLite enforces speech revocation even when the preceding service version
-- changes chat consent against this same database.
CREATE TRIGGER IF NOT EXISTS clear_voice_on_direct_pause_insert
AFTER INSERT ON ai_direct_permissions WHEN NEW.enabled=0
BEGIN
  DELETE FROM ai_voice_scopes WHERE chat=NEW.chat;
  DELETE FROM ai_voice_choices WHERE chat=NEW.chat;
END;
CREATE TRIGGER IF NOT EXISTS clear_voice_on_direct_pause_update
AFTER UPDATE OF enabled ON ai_direct_permissions WHEN NEW.enabled=0
BEGIN
  DELETE FROM ai_voice_scopes WHERE chat=NEW.chat;
  DELETE FROM ai_voice_choices WHERE chat=NEW.chat;
END;
CREATE TABLE IF NOT EXISTS message_removals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat TEXT NOT NULL REFERENCES chats,
  message INTEGER NOT NULL UNIQUE REFERENCES messages
);
CREATE INDEX IF NOT EXISTS chat_removal_history ON message_removals(chat,id);
CREATE TRIGGER IF NOT EXISTS record_message_removal
AFTER UPDATE OF removed ON messages WHEN OLD.removed=0 AND NEW.removed=1
BEGIN
  INSERT OR IGNORE INTO message_removals(chat,message) VALUES(NEW.chat,NEW.id);
END;

CREATE TABLE IF NOT EXISTS ai_group_roles (
  chat TEXT NOT NULL,
  ai TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(chat,ai),
  FOREIGN KEY(chat,ai) REFERENCES members(chat,account) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ai_group_role_consents (
  chat TEXT NOT NULL,
  human TEXT NOT NULL,
  ai TEXT NOT NULL,
  provider TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(chat,human,ai,provider),
  FOREIGN KEY(chat,human) REFERENCES members(chat,account) ON DELETE CASCADE,
  FOREIGN KEY(chat,ai) REFERENCES ai_group_roles(chat,ai) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ai_group_cards (
  chat TEXT NOT NULL, ai TEXT NOT NULL, projection TEXT NOT NULL,
  PRIMARY KEY(chat,ai),
  FOREIGN KEY(chat,ai) REFERENCES ai_group_roles(chat,ai) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ai_group_card_portraits (
  chat TEXT NOT NULL, ai TEXT NOT NULL, revision TEXT NOT NULL, png BLOB NOT NULL,
  PRIMARY KEY(chat,ai),
  FOREIGN KEY(chat,ai) REFERENCES ai_group_cards(chat,ai) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ai_group_lorebooks (
  chat TEXT NOT NULL, ai TEXT NOT NULL, projection TEXT NOT NULL,
  PRIMARY KEY(chat,ai),
  FOREIGN KEY(chat,ai) REFERENCES ai_group_roles(chat,ai) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ai_group_exchange_ends (
  chat TEXT NOT NULL, human TEXT NOT NULL,
  closed_through INTEGER NOT NULL CHECK(closed_through>0),
  PRIMARY KEY(chat,human),
  FOREIGN KEY(chat,human) REFERENCES members(chat,account) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ai_group_turns (
  prompt INTEGER PRIMARY KEY REFERENCES messages,
  chat TEXT NOT NULL REFERENCES chats,
  state TEXT NOT NULL CHECK(state IN ('pending','failed','answered')),
  started INTEGER
);
CREATE TRIGGER IF NOT EXISTS clear_voice_on_group_consent_delete
AFTER DELETE ON ai_group_role_consents
BEGIN
  DELETE FROM ai_voice_scopes WHERE chat=OLD.chat AND human=OLD.human AND ai=OLD.ai;
  DELETE FROM ai_voice_choices WHERE chat=OLD.chat AND human=OLD.human AND ai=OLD.ai;
END;
CREATE TABLE IF NOT EXISTS ai_group_context_consents (
  chat TEXT NOT NULL,
  human TEXT NOT NULL,
  ai TEXT NOT NULL,
  provider TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(chat,human,ai,provider),
  FOREIGN KEY(chat,human,ai,provider) REFERENCES ai_group_role_consents(chat,human,ai,provider) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_group_daily ON ai_group_turns(started,chat);
CREATE UNIQUE INDEX IF NOT EXISTS ai_group_pending ON ai_group_turns(chat) WHERE state='pending';
CREATE TABLE IF NOT EXISTS ai_group_draw_settings (
  chat TEXT NOT NULL, ai TEXT NOT NULL, revision TEXT NOT NULL,
  PRIMARY KEY(chat,ai),
  FOREIGN KEY(chat,ai) REFERENCES ai_group_roles(chat,ai) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ai_group_draw_pauses (
  chat TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  ai TEXT NOT NULL REFERENCES users(number) ON DELETE CASCADE,
  PRIMARY KEY(chat,ai)
);
CREATE TABLE IF NOT EXISTS ai_group_draw_requests (
  prompt INTEGER PRIMARY KEY REFERENCES ai_group_turns(prompt),
  chat TEXT NOT NULL, human TEXT NOT NULL, ai TEXT NOT NULL, started INTEGER NOT NULL,
  reply INTEGER UNIQUE REFERENCES messages(id)
);
CREATE INDEX IF NOT EXISTS ai_group_draw_daily ON ai_group_draw_requests(started,chat);
CREATE TABLE IF NOT EXISTS ai_direct_draw_requests (
  prompt INTEGER PRIMARY KEY REFERENCES ai_direct_turns(prompt),
  chat TEXT NOT NULL, human TEXT NOT NULL, ai TEXT NOT NULL, started INTEGER NOT NULL,
  reply INTEGER UNIQUE REFERENCES messages(id)
);
CREATE INDEX IF NOT EXISTS ai_direct_draw_daily ON ai_direct_draw_requests(started,chat);
CREATE TABLE IF NOT EXISTS message_drawings (
  message INTEGER PRIMARY KEY REFERENCES message_images(message) ON DELETE CASCADE,
  original INTEGER NOT NULL REFERENCES message_images(message),
  title TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drawing_copies ON message_drawings(original);
CREATE TRIGGER IF NOT EXISTS remove_drawing_copies
AFTER UPDATE OF removed ON messages WHEN OLD.removed=0 AND NEW.removed=1
BEGIN
  UPDATE messages SET removed=1 WHERE removed=0 AND id IN
    (SELECT message FROM message_drawings WHERE original=NEW.id AND message<>NEW.id);
END;
CREATE TABLE IF NOT EXISTS ai_group_reply_links (
  reply INTEGER PRIMARY KEY REFERENCES messages,
  prompt INTEGER NOT NULL UNIQUE REFERENCES ai_group_turns,
  role_revision TEXT NOT NULL,
  consent_revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, reporter TEXT NOT NULL REFERENCES users, message INTEGER NOT NULL REFERENCES messages,
  reason TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, reviewed TEXT,
  UNIQUE(reporter,message)
);
CREATE INDEX IF NOT EXISTS reports_by_reporter ON reports(reporter,created DESC,id DESC);
CREATE TABLE IF NOT EXISTS report_media (
  report TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','audio/wav'))
);
CREATE TABLE IF NOT EXISTS friend_post_reports (
  id TEXT PRIMARY KEY, reporter TEXT NOT NULL REFERENCES users(number),
  post INTEGER NOT NULL REFERENCES friend_posts(id),
  reason TEXT NOT NULL, reported_text TEXT NOT NULL, status TEXT NOT NULL,
  created TEXT NOT NULL, reviewed TEXT,
  UNIQUE(reporter,post)
);
CREATE INDEX IF NOT EXISTS friend_post_reports_by_post ON friend_post_reports(post,status);
CREATE INDEX IF NOT EXISTS friend_post_reports_by_reporter ON friend_post_reports(reporter,created DESC,id DESC);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES users(number),
  nonce TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL,
  client_type TEXT NOT NULL, client_build TEXT NOT NULL,
  UNIQUE(account,nonce)
);
CREATE INDEX IF NOT EXISTS feedback_by_account ON feedback(account,created DESC,id DESC);
CREATE TABLE IF NOT EXISTS feedback_desktop_versions (
  feedback_id TEXT PRIMARY KEY REFERENCES feedback(id) ON DELETE CASCADE,
  desktop_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback_replies (
  feedback_id TEXT PRIMARY KEY REFERENCES feedback(id) ON DELETE CASCADE,
  reply_text TEXT NOT NULL, retest_version TEXT, replied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_ai (
  owner TEXT PRIMARY KEY REFERENCES users(number), ai TEXT NOT NULL UNIQUE REFERENCES users(number),
  role TEXT NOT NULL, revision TEXT NOT NULL, UNIQUE(owner,ai)
);
CREATE TABLE IF NOT EXISTS personal_ai_invitations (
  chat TEXT NOT NULL, owner TEXT NOT NULL, ai TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','joined')),
  revision TEXT NOT NULL, PRIMARY KEY(chat,ai),
  FOREIGN KEY(owner,ai) REFERENCES personal_ai(owner,ai),
  FOREIGN KEY(chat,owner) REFERENCES members(chat,account) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS personal_ai_public_profiles (
  ai TEXT PRIMARY KEY REFERENCES personal_ai(ai) ON DELETE CASCADE,
  card TEXT, lorebook TEXT, revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS personal_ai_private_profiles (
  ai TEXT PRIMARY KEY REFERENCES personal_ai(ai) ON DELETE CASCADE,
  card TEXT, lorebook TEXT, revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS personal_ai_private_portraits (
  ai TEXT PRIMARY KEY REFERENCES personal_ai_private_profiles(ai) ON DELETE CASCADE,
  png BLOB NOT NULL
);
-- The old single-message grant cannot authorize sharing recent history.
CREATE TABLE IF NOT EXISTS personal_ai_direct_context (
  chat TEXT PRIMARY KEY REFERENCES ai_direct_grants(chat) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS personal_ai_friend_settings (
  ai TEXT PRIMARY KEY REFERENCES personal_ai(ai) ON DELETE CASCADE,
  discoverable INTEGER NOT NULL CHECK(discoverable IN (0,1)),
  guest_cloud INTEGER NOT NULL CHECK(guest_cloud IN (0,1) AND guest_cloud<=discoverable),
  revision TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS personal_ai_remove_invited_member AFTER DELETE ON personal_ai_invitations
BEGIN
  DELETE FROM members WHERE chat=OLD.chat AND account=OLD.ai;
END;
CREATE TRIGGER IF NOT EXISTS personal_ai_remove_invite AFTER DELETE ON members
BEGIN
  DELETE FROM personal_ai_invitations WHERE chat=OLD.chat AND ai=OLD.account;
END;
CREATE TABLE IF NOT EXISTS personal_voice_defaults (
  human TEXT NOT NULL REFERENCES users(number), backend TEXT NOT NULL CHECK(backend='azure'),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), revision TEXT NOT NULL,
  PRIMARY KEY(human,backend)
);
CREATE TABLE IF NOT EXISTS personal_voice_pauses (
  chat TEXT NOT NULL REFERENCES chats ON DELETE CASCADE, human TEXT NOT NULL REFERENCES users(number),
  ai TEXT NOT NULL REFERENCES personal_ai(ai), revision TEXT NOT NULL, PRIMARY KEY(chat,human,ai)
);
CREATE TABLE IF NOT EXISTS personal_voice_offers (
  prompt INTEGER PRIMARY KEY REFERENCES messages ON DELETE CASCADE, revision TEXT NOT NULL
);

-- One durable Bothouse request per committed social message. Workers receive only this message.
CREATE TABLE IF NOT EXISTS bothouse_work_orders (
  prompt INTEGER PRIMARY KEY REFERENCES messages(id), request TEXT UNIQUE NOT NULL,
  chat TEXT NOT NULL REFERENCES chats, human TEXT NOT NULL REFERENCES users, ai TEXT NOT NULL REFERENCES users,
  scope TEXT NOT NULL, identity TEXT NOT NULL, board_id INTEGER, state TEXT NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 0, next_check INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bothouse_work_due ON bothouse_work_orders(state,next_check);
