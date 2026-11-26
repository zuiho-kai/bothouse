'use strict';
/*
 * Deterministic check that a quote a model attributes to the owner is really in the owner
 * message it cites. Shared by the wiki proposals and the nightly reflection.
 *
 * Adapted from bothouse, https://github.com/zuiho-kai/bothouse
 * Upstream path: bridge/contrib/wiki/llmwiki/ingest.py (`FLAT`, `in_order`, the fragment rule of
 *   `bad_quotes` / `misquotes`: a quote with an ellipsis is a list of fragments that must all
 *   occur, in order, in one message)
 * Upstream revision: 218051eccbb31923aa2b0d837801cf4d82c4799f
 * License: Apache-2.0, Copyright (c) 2026 zuiho-kai and bothouse contributors
 *
 * Re-implemented and modified for Agent Arcade (AGPL-3.0) on 2026-11-13:
 * - Node CommonJS; evidence names a stored message id instead of a session id on a wiki line;
 * - the cited message must exist and be an owner message; a quote needs at least two
 *   characters after normalisation; quote length is bounded.
 */
// Compared without whitespace and punctuation: the owner types "," where a model writes "，".
// A dot between digits stays ("v1.2" is not "v12").
const FLAT = /[\s，,。！!？?、：:；;“”"'‘’（）()…~～]+|(?<!\d)\.|\.(?!\d)/g;
const QUOTE_CHARS = 120, MIN_FLAT = 2;

const flat = text => String(text ?? '').replace(FLAT, '').toLowerCase();
/** The fragments of a quote: split at "…" or "...", each normalised, empty ones dropped. */
const fragments = quote => String(quote ?? '').split(/…+|\.{3,}/).map(flat).filter(Boolean);

/** All fragments occur in `text` (already normalised), in that order. */
function inOrder(frags, text) {
  let at = 0;
  for (const fragment of frags) {
    at = text.indexOf(fragment, at);
    if (at < 0) return false;
    at += fragment.length;
  }
  return true;
}

/** True when `quote` is the owner's wording in `messageText` (one message, not pieced across messages). */
function verifyQuote(quote, messageText) {
  if (typeof quote !== 'string' || typeof messageText !== 'string' || !quote.trim() || quote.length > QUOTE_CHARS) return false;
  const frags = fragments(quote);
  if (!frags.length || frags.join('').length < MIN_FLAT) return false;
  return inOrder(frags, flat(messageText));
}

/**
 * Splits evidence `[{messageId, quote}]` into verified and failed items. `messages` maps a
 * message id to `{role, text}`; only a message whose role is 'user' can carry a quote.
 * @returns {{verified: {messageId: string, quote: string}[], failed: {messageId: *, quote: *, reason: string}[]}}
 */
function verifyEvidence(evidence, messages) {
  const verified = [], failed = [];
  for (const item of Array.isArray(evidence) ? evidence.slice(0, 20) : []) {
    const messageId = item?.messageId, quote = item?.quote;
    const message = typeof messageId === 'string' ? messages.get(messageId) : null;
    const reason = !item || typeof item !== 'object' || typeof messageId !== 'string' || typeof quote !== 'string' ? 'malformed'
      : !message ? 'unknown_message' : message.role !== 'user' ? 'not_owner_message' : !verifyQuote(quote, message.text) ? 'quote_not_found' : null;
    if (reason) failed.push({messageId, quote, reason}); else verified.push({messageId, quote});
  }
  return {verified, failed};
}

module.exports = {FLAT, QUOTE_CHARS, flat, fragments, inOrder, verifyQuote, verifyEvidence};
