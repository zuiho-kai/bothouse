window.__ModuleLoader__.load({
 id: "@deepseek-ai/dsh-experimental-client-ui-discord",
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
(function(){var s=document.createElement('style');s.setAttribute('data-dsh-plugin',"dsh-experimental-client-ui-discord");s.textContent=".ysIOBW_page {\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  padding-top: var(--dsh-frame-top-clearance, 0px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  grid-template-columns: 220px minmax(0, 1fr) 240px;\n  font-size: 14px;\n  line-height: 1.5;\n  display: grid;\n}\n\n.ysIOBW_notice {\n  max-width: 480px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: center;\n  grid-column: 1 / -1;\n  place-self: center;\n  padding: 24px;\n}\n\n.ysIOBW_rooms, .ysIOBW_members {\n  background: var(--dsw-alias-bg-layer-2);\n  min-height: 0;\n  padding: 8px 8px 16px;\n  overflow-y: auto;\n}\n\n.ysIOBW_groupTitle {\n  color: var(--dsw-alias-label-tertiary);\n  letter-spacing: .02em;\n  margin: 12px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.ysIOBW_room {\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.ysIOBW_room:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_room:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.ysIOBW_roomActive {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_hash {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 16px;\n}\n\n.ysIOBW_chat {\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n}\n\n.ysIOBW_chatHead {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  align-items: center;\n  gap: 6px;\n  height: 44px;\n  padding: 0 16px;\n  font-weight: 600;\n  display: flex;\n}\n\n.ysIOBW_log {\n  flex: 1;\n  min-height: 0;\n  padding: 8px 0 12px;\n  overflow-y: auto;\n}\n\n.ysIOBW_empty {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 24px 16px;\n}\n\n.ysIOBW_message {\n  grid-template-columns: 36px minmax(0, 1fr);\n  gap: 12px;\n  padding: 6px 16px;\n  display: grid;\n}\n\n.ysIOBW_message:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_system .ysIOBW_text {\n  color: var(--dsw-alias-label-tertiary);\n  font-style: italic;\n}\n\n.ysIOBW_avatar {\n  corner-shape: round;\n  color: #fff;\n  border-radius: 50%;\n  place-items: center;\n  width: 36px;\n  height: 36px;\n  font-weight: 700;\n  display: grid;\n}\n\n.ysIOBW_avatarSmall {\n  width: 28px;\n  height: 28px;\n  font-size: 12px;\n}\n\n.ysIOBW_messageBody {\n  min-width: 0;\n}\n\n.ysIOBW_messageHead {\n  align-items: baseline;\n  gap: 6px;\n  display: flex;\n}\n\n.ysIOBW_author {\n  font-weight: 600;\n}\n\n.ysIOBW_time {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.ysIOBW_tag {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  white-space: nowrap;\n  padding: 0 4px;\n  font-size: 10px;\n  font-weight: 600;\n}\n\n.ysIOBW_text {\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n}\n\n.ysIOBW_card {\n  border-left: 4px solid var(--dsw-alias-state-business-primary);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-layer-2);\n  margin-top: 4px;\n  padding: 6px 10px;\n}\n\n.ysIOBW_card[data-state=\"failed\"] {\n  border-left-color: var(--dsw-alias-state-error-primary);\n}\n\n.ysIOBW_cardTitle {\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.ysIOBW_working {\n  min-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n  padding: 0 16px;\n  font-size: 12px;\n}\n\n.ysIOBW_composer {\n  padding: 0 16px 16px;\n  position: relative;\n}\n\n.ysIOBW_composerRow {\n  align-items: flex-end;\n  gap: 8px;\n  display: flex;\n}\n\n.ysIOBW_mentionButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  width: 40px;\n  height: 40px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  font: inherit;\n  cursor: pointer;\n  flex: none;\n  font-size: 18px;\n  font-weight: 600;\n}\n\n.ysIOBW_mentionButton:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_mentionButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.ysIOBW_mentionPopup {\n  z-index: 2;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  max-height: 320px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  bottom: calc(100% - 8px);\n  left: 16px;\n  right: 16px;\n}\n\n.ysIOBW_mentionPopup > [role=\"listbox\"] {\n  min-height: 0;\n  overflow-y: auto;\n}\n\n.ysIOBW_mentionTitle {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 4px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.ysIOBW_mentionItem {\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n  align-items: center;\n  gap: 10px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.ysIOBW_mentionActive {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_mentionName {\n  font-weight: 600;\n}\n\n.ysIOBW_mentionMeta {\n  color: var(--dsw-alias-label-tertiary);\n  margin-left: auto;\n  font-size: 12px;\n}\n\n.ysIOBW_mentionHint {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-tertiary);\n  padding: 6px 8px 2px;\n  font-size: 11px;\n}\n\n.ysIOBW_sendError {\n  color: var(--dsw-alias-state-error-primary);\n  margin-bottom: 6px;\n  font-size: 12px;\n}\n\n.ysIOBW_input {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  width: 100%;\n  max-height: 40vh;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-layer-2);\n  font: inherit;\n  resize: none;\n  field-sizing: content;\n  padding: 10px 14px;\n}\n\n.ysIOBW_input:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.ysIOBW_member {\n  border-radius: var(--dsw-radius-sm);\n  min-width: 0;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: 1;\n  align-items: center;\n  gap: 10px;\n  padding: 5px 8px;\n  display: flex;\n}\n\n.ysIOBW_member:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_member:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.ysIOBW_offline {\n  opacity: .5;\n}\n\n.ysIOBW_memberAvatar {\n  position: relative;\n}\n\n.ysIOBW_presence {\n  border: 2px solid var(--dsw-alias-bg-layer-2);\n  corner-shape: round;\n  background: #23a55a;\n  border-radius: 50%;\n  width: 10px;\n  height: 10px;\n  position: absolute;\n  bottom: -2px;\n  right: -2px;\n}\n\n.ysIOBW_offline .ysIOBW_presence {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.ysIOBW_memberText {\n  flex-direction: column;\n  min-width: 0;\n  display: flex;\n}\n\n.ysIOBW_memberName {\n  align-items: center;\n  gap: 6px;\n  display: flex;\n}\n\n.ysIOBW_memberStatus {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n@media (width <= 900px) {\n  .ysIOBW_page {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .ysIOBW_rooms, .ysIOBW_members {\n    display: none;\n  }\n}\n\n.ysIOBW_groupHead {\n  justify-content: space-between;\n  align-items: center;\n  padding-right: 4px;\n  display: flex;\n}\n\n.ysIOBW_iconButton {\n  border-radius: var(--dsw-radius-sm);\n  width: 22px;\n  height: 22px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  font-size: 16px;\n  line-height: 1;\n}\n\n.ysIOBW_iconButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_roomInput, .ysIOBW_fieldInput {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n  padding: 6px 8px;\n}\n\n.ysIOBW_roomInput {\n  margin: 2px 0 6px;\n}\n\n.ysIOBW_roomInput:focus-visible, .ysIOBW_fieldInput:focus-visible, .ysIOBW_iconButton:focus-visible, .ysIOBW_linkButton:focus-visible, .ysIOBW_addMemberButton:focus-visible, .ysIOBW_primaryButton:focus-visible, .ysIOBW_secondaryButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.ysIOBW_addMemberButton {\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  margin: 4px 0;\n  padding: 7px 8px;\n}\n\n.ysIOBW_addMemberButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_memberRow {\n  border-radius: var(--dsw-radius-sm);\n  align-items: center;\n  display: flex;\n  position: relative;\n}\n\n.ysIOBW_memberRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.ysIOBW_memberRow .ysIOBW_member:hover {\n  background: none;\n}\n\n.ysIOBW_memberModel {\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  overflow: hidden;\n}\n\n.ysIOBW_memberActions {\n  color: var(--dsw-alias-label-tertiary);\n  opacity: 0;\n  flex: none;\n  gap: 4px;\n  padding-right: 6px;\n  font-size: 12px;\n  display: flex;\n}\n\n.ysIOBW_memberRow:hover .ysIOBW_memberActions, .ysIOBW_memberRow:focus-within .ysIOBW_memberActions {\n  opacity: 1;\n}\n\n.ysIOBW_linkButton {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 2px 4px;\n  font-size: 12px;\n}\n\n.ysIOBW_linkButton:hover {\n  color: var(--dsw-alias-label-primary);\n  text-decoration: underline;\n}\n\n.ysIOBW_dialogBackdrop {\n  z-index: 10;\n  background: #00000073;\n  place-items: center;\n  padding: 16px;\n  display: grid;\n  position: fixed;\n  inset: 0;\n}\n\n.ysIOBW_dialog {\n  border-radius: var(--dsw-radius-lg);\n  width: min(460px, 100%);\n  max-height: calc(100vh - 32px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  box-shadow: var(--dsw-elevation-panel, 0 12px 32px #0000004d);\n  flex-direction: column;\n  gap: 12px;\n  padding: 20px;\n  display: flex;\n  overflow-y: auto;\n}\n\n.ysIOBW_dialogTitle {\n  margin: 0;\n  font-size: 16px;\n}\n\n.ysIOBW_field {\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  gap: 4px;\n  font-size: 12px;\n  display: flex;\n}\n\n.ysIOBW_field textarea {\n  resize: vertical;\n}\n\n.ysIOBW_choiceRow {\n  flex-wrap: wrap;\n  gap: 12px;\n  display: flex;\n}\n\n.ysIOBW_choice {\n  color: var(--dsw-alias-label-primary, inherit);\n  cursor: pointer;\n  align-items: center;\n  gap: 4px;\n  font-size: 13px;\n  display: inline-flex;\n}\n\n.ysIOBW_dialogActions {\n  justify-content: flex-end;\n  gap: 8px;\n  display: flex;\n}\n\n.ysIOBW_primaryButton, .ysIOBW_secondaryButton {\n  border-radius: var(--dsw-radius-sm);\n  font: inherit;\n  cursor: pointer;\n  padding: 7px 14px;\n}\n\n.ysIOBW_primaryButton {\n  color: #fff;\n  background: var(--dsw-alias-state-business-primary);\n  border: 0;\n}\n\n.ysIOBW_primaryButton:disabled {\n  cursor: not-allowed;\n  opacity: .5;\n}\n\n.ysIOBW_secondaryButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-primary);\n  background: none;\n}\n";document.head.appendChild(s)})();
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");
let react = require("react");
// src/client/channel-source.ts
const INITIAL = {
	phase: "idle",
	error: void 0,
	rooms: [],
	roomId: void 0,
	members: [],
	thinking: {},
	messages: []
};
/** Status-coded service failure so the panel can tell "not enabled" from "not signed in". */
var ServiceError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.status = status;
		this.name = "ServiceError";
	}
};
function json(method, body) {
	return {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body)
	};
}
/**
* Browser transport over the page's own origin and document base.
* @returns fetch and EventSource bound to the current document.
*/
function browserTransport() {
	return {
		fetch: (input, init) => fetch(input, {
			credentials: "same-origin",
			...init
		}),
		openEvents: (url) => new EventSource(url, { withCredentials: true }),
		url: (path) => new URL(path, document.baseURI).toString()
	};
}
/**
* Create the channel source and its actions.
* @param transport - fetch/EventSource binding.
* @returns the observable snapshot, the actions, and a disposer.
*/
function createChannelSource(transport) {
	let snapshot = INITIAL;
	const listeners = /* @__PURE__ */ new Set();
	let stream;
	let lifetime;
	let pending;
	const set = (next) => {
		snapshot = {
			...snapshot,
			...next
		};
		for (const listener of listeners) listener();
	};
	const request = async (path, init) => {
		const response = await transport.fetch(transport.url(path), init);
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new ServiceError(response.status, body.error ?? response.statusText);
		}
		return await response.json();
	};
	const fail = (error) => {
		if (error instanceof ServiceError && error.status === 404) set({
			phase: "unavailable",
			error: void 0
		});
		else if (error instanceof ServiceError && error.status === 401) set({
			phase: "unauthorized",
			error: void 0
		});
		else set({
			phase: "error",
			error: error instanceof Error ? error.message : String(error)
		});
	};
	const applyEvent = (current, event) => {
		switch (event.type) {
			case "message": {
				if (event.message.room_id !== current.roomId) return current;
				const rows = new Map(current.messages.map((m) => [m.id, m]));
				rows.set(event.message.id, event.message);
				return {
					...current,
					messages: [...rows.values()].sort((a, b) => a.id - b.id)
				};
			}
			case "deleted": return event.room_id === current.roomId ? {
				...current,
				messages: current.messages.filter((m) => m.id !== event.id)
			} : current;
			case "members": return {
				...current,
				members: event.members
			};
			case "thinking": return {
				...current,
				thinking: {
					...current.thinking,
					[String(event.room_id)]: event.members
				}
			};
			case "rooms": return {
				...current,
				rooms: event.rooms
			};
			default: return current;
		}
	};
	const onEvent = (event) => {
		pending?.events.push(event);
		set(applyEvent(snapshot, event));
	};
	const refresh = async (resume) => {
		const owner = lifetime;
		if (owner === void 0) return;
		pending?.controller.abort();
		const read = {
			controller: new AbortController(),
			events: []
		};
		pending = read;
		const previous = snapshot;
		const current = () => lifetime === owner && pending === read && !read.controller.signal.aborted;
		try {
			const state = await request("collab/api/state", { signal: read.controller.signal });
			if (!current()) return;
			const roomId = state.rooms.some((r) => r.id === previous.roomId) ? previous.roomId : state.rooms[0]?.id;
			const rows = [];
			if (roomId !== void 0) {
				let after = resume && roomId === previous.roomId ? (previous.messages[0]?.id ?? 1) - 1 : void 0;
				while (current()) {
					const query = after === void 0 ? "limit=100" : "after=" + after + "&limit=200";
					const { messages } = await request("collab/api/rooms/" + roomId + "/messages?" + query, { signal: read.controller.signal });
					if (!current()) return;
					rows.push(...messages);
					if (after === void 0 || messages.length < 200) break;
					const next = messages.at(-1)?.id;
					if (next === void 0 || next <= after) throw new Error("Channel history cursor did not advance");
					after = next;
				}
			}
			let next = {
				phase: "ready",
				error: void 0,
				rooms: state.rooms,
				roomId,
				members: state.members,
				thinking: state.thinking,
				messages: rows
			};
			for (const event of read.events) next = applyEvent(next, event);
			pending = void 0;
			set(next);
		} catch (error) {
			if (!current()) return;
			pending = void 0;
			fail(error);
		}
	};
	const selectRoom = async (roomId) => {
		set({
			roomId,
			messages: []
		});
		await refresh(false);
	};
	const start = async (owner) => {
		set({
			phase: "loading",
			error: void 0
		});
		await refresh(false);
		if (lifetime !== owner || listeners.size === 0 || snapshot.phase !== "ready") return;
		try {
			const events = transport.openEvents(transport.url("collab/api/events"));
			stream = events;
			events.onopen = () => {
				if (lifetime === owner) refresh(true);
			};
			events.onerror = () => {
				if (lifetime !== owner) return;
				pending?.controller.abort();
				pending = void 0;
				set({
					phase: "loading",
					error: void 0
				});
			};
			events.onmessage = (event) => {
				if (lifetime !== owner) return;
				try {
					onEvent(JSON.parse(event.data));
				} catch (error) {}
			};
		} catch (error) {
			if (lifetime === owner) fail(error);
		}
	};
	const stop = () => {
		lifetime = void 0;
		pending?.controller.abort();
		pending = void 0;
		if (stream !== void 0) {
			stream.onopen = null;
			stream.onmessage = null;
			stream.onerror = null;
			stream.close();
			stream = void 0;
		}
	};
	return {
		source: {
			getSnapshot: () => snapshot,
			subscribe(listener) {
				listeners.add(listener);
				if (lifetime === void 0) {
					lifetime = {};
					start(lifetime);
				}
				return () => {
					listeners.delete(listener);
					if (listeners.size === 0) stop();
				};
			}
		},
		actions: {
			selectRoom,
			async send(text) {
				const roomId = snapshot.roomId;
				const owner = lifetime;
				if (roomId === void 0 || owner === void 0) throw new Error("No channel is open");
				const { message } = await request(`collab/api/rooms/${roomId}/messages`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						text,
						client_key: crypto.randomUUID()
					})
				});
				if (lifetime === owner) onEvent({
					type: "message",
					message
				});
			},
			async createRoom(name) {
				const { room } = await request("collab/api/rooms", json("POST", { name }));
				if (!snapshot.rooms.some((r) => r.id === room.id)) set({ rooms: [...snapshot.rooms, room] });
				await selectRoom(room.id);
			},
			async listModels() {
				const { routes } = await request("collab/api/models");
				return routes;
			},
			async listClis() {
				return await request("collab/api/clis");
			},
			async addMember(input) {
				await request("collab/api/members", json("POST", input));
			},
			async updateMember(id, input) {
				await request(`collab/api/members/${encodeURIComponent(id)}`, json("PATCH", input));
			},
			async removeMember(id) {
				await request(`collab/api/members/${encodeURIComponent(id)}`, { method: "DELETE" });
			}
		},
		dispose: stop
	};
}
// src/client/ChannelsIcon.tsx
/** Decorative occupant for the channels sidebar entry. */
/**
* Render the members glyph at the size the sidebar asks for; the sidebar owns the label.
* @param props - the sidebar's icon share.
* @returns decorative icon.
*/
function ChannelsIcon({ size }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUsersOutlineRegular, { size });
}
// src/client/mention-complete.ts
/** Characters that may sit right before an `@` that starts a mention. */
const MENTION_BOUNDARY = /[\s([{"'“‘，。、！？：；,.!?:;]/;
/**
* The mention being typed at `caret`, if any. A mention starts at an `@` at the
* beginning of the text or after whitespace/punctuation, and its query runs to
* the caret without whitespace (so `a@b.com` and finished `@name ` do not open it).
* @param text - the draft.
* @param caret - caret offset in `text`.
* @returns the active mention, or undefined.
*/
function activeMention(text, caret) {
	const head = text.slice(0, caret);
	const at = head.lastIndexOf("@");
	if (at < 0) return void 0;
	const query = head.slice(at + 1);
	if (/\s/.test(query)) return void 0;
	if (at > 0 && !MENTION_BOUNDARY.test(head[at - 1])) return void 0;
	return {
		start: at,
		query
	};
}
/**
* Members the query can name, best first: agents before people, then prefix
* matches before substring matches (on name or id, case-insensitive), then
* online before offline, then name order. An empty query lists everyone.
* @param members - channel members.
* @param query - text typed after `@`.
* @returns ranked candidates.
*/
function rankMembers(members, query) {
	const q = query.toLowerCase();
	const score = (m) => {
		if (q === "") return 0;
		const name = m.name.toLowerCase();
		const id = m.id.toLowerCase();
		if (name.startsWith(q) || id.startsWith(q)) return 0;
		if (name.includes(q) || id.includes(q)) return 1;
	};
	return members.map((m) => ({
		m,
		s: score(m)
	})).filter((x) => x.s !== void 0).sort((a, b) => Number(a.m.kind === "human") - Number(b.m.kind === "human") || a.s - b.s || Number(!a.m.online) - Number(!b.m.online) || a.m.name.localeCompare(b.m.name)).map((x) => x.m);
}
/**
* Replace the active `@query` with `@name ` and put the caret after it.
* @param text - the draft.
* @param caret - caret offset in `text`.
* @param mention - the active mention at `caret`.
* @param member - the chosen member.
* @returns the new draft and caret.
*/
function applyMention(text, caret, mention, member) {
	const insert = `@${member.name} `;
	const tail = text.slice(caret).replace(/^ /, "");
	return {
		text: text.slice(0, mention.start) + insert + tail,
		caret: mention.start + insert.length
	};
}
/**
* Insert `@name ` at the caret (member-list click), adding a separating space
* when the caret sits right after a non-space character.
* @param text - the draft.
* @param caret - caret offset in `text`.
* @param member - the member to mention.
* @returns the new draft and caret.
*/
function insertMention(text, caret, member) {
	const before = text.slice(0, caret);
	const insert = `${before === "" || /\s$/.test(before) ? "" : " "}@${member.name} `;
	return {
		text: before + insert + text.slice(caret),
		caret: caret + insert.length
	};
}
// src/client/ChannelsPage.module.css
var ChannelsPage_module_default = {
	"addMemberButton": "ysIOBW_addMemberButton",
	"author": "ysIOBW_author",
	"avatar": "ysIOBW_avatar",
	"avatarSmall": "ysIOBW_avatarSmall",
	"card": "ysIOBW_card",
	"cardTitle": "ysIOBW_cardTitle",
	"chat": "ysIOBW_chat",
	"chatHead": "ysIOBW_chatHead",
	"choice": "ysIOBW_choice",
	"choiceRow": "ysIOBW_choiceRow",
	"composer": "ysIOBW_composer",
	"composerRow": "ysIOBW_composerRow",
	"dialog": "ysIOBW_dialog",
	"dialogActions": "ysIOBW_dialogActions",
	"dialogBackdrop": "ysIOBW_dialogBackdrop",
	"dialogTitle": "ysIOBW_dialogTitle",
	"empty": "ysIOBW_empty",
	"field": "ysIOBW_field",
	"fieldInput": "ysIOBW_fieldInput",
	"groupHead": "ysIOBW_groupHead",
	"groupTitle": "ysIOBW_groupTitle",
	"hash": "ysIOBW_hash",
	"iconButton": "ysIOBW_iconButton",
	"input": "ysIOBW_input",
	"linkButton": "ysIOBW_linkButton",
	"log": "ysIOBW_log",
	"member": "ysIOBW_member",
	"memberActions": "ysIOBW_memberActions",
	"memberAvatar": "ysIOBW_memberAvatar",
	"memberModel": "ysIOBW_memberModel",
	"memberName": "ysIOBW_memberName",
	"memberRow": "ysIOBW_memberRow",
	"members": "ysIOBW_members",
	"memberStatus": "ysIOBW_memberStatus",
	"memberText": "ysIOBW_memberText",
	"mentionActive": "ysIOBW_mentionActive",
	"mentionButton": "ysIOBW_mentionButton",
	"mentionHint": "ysIOBW_mentionHint",
	"mentionItem": "ysIOBW_mentionItem",
	"mentionMeta": "ysIOBW_mentionMeta",
	"mentionName": "ysIOBW_mentionName",
	"mentionPopup": "ysIOBW_mentionPopup",
	"mentionTitle": "ysIOBW_mentionTitle",
	"message": "ysIOBW_message",
	"messageBody": "ysIOBW_messageBody",
	"messageHead": "ysIOBW_messageHead",
	"notice": "ysIOBW_notice",
	"offline": "ysIOBW_offline",
	"page": "ysIOBW_page",
	"presence": "ysIOBW_presence",
	"primaryButton": "ysIOBW_primaryButton",
	"room": "ysIOBW_room",
	"roomActive": "ysIOBW_roomActive",
	"roomInput": "ysIOBW_roomInput",
	"rooms": "ysIOBW_rooms",
	"secondaryButton": "ysIOBW_secondaryButton",
	"sendError": "ysIOBW_sendError",
	"system": "ysIOBW_system",
	"tag": "ysIOBW_tag",
	"text": "ysIOBW_text",
	"time": "ysIOBW_time",
	"working": "ysIOBW_working"
};
// src/client/MemberDialog.tsx
/**
* Add/edit dialog for one channel member: name, persona, and either a DSH
* model (grouped by provider route, as the host lists them) or, when adding, a
* CLI agent installed on this machine (Claude Code, Codex, Gemini). Submission goes through the
* injected action; the host's refusal (name taken, model unavailable) is shown
* inline and the form keeps its values.
*/
const SEP = "\0";
/** CLI choices offered for a local-CLI member, in display order (user request 2026-10-23). */
const CLI_CHOICES = [
	{
		cli: "claude",
		label: "Claude Code"
	},
	{
		cli: "codex",
		label: "Codex"
	},
	{
		cli: "gemini",
		label: "Gemini"
	}
];
/**
* Render the member dialog.
* @param props - target member, actions, and copy.
* @returns a modal form.
*/
function MemberDialog({ member, listModels, listClis, onSubmit, onClose, t }) {
	const [name, setName] = (0, react.useState)(member?.name ?? "");
	const [persona, setPersona] = (0, react.useState)(member?.persona ?? "");
	const [modelKey, setModelKey] = (0, react.useState)(member?.model ? member.model.provider + SEP + member.model.model : "");
	const [routes, setRoutes] = (0, react.useState)(void 0);
	const [error, setError] = (0, react.useState)(void 0);
	const [busy, setBusy] = (0, react.useState)(false);
	const [type, setType] = (0, react.useState)("dsh");
	const [clis, setClis] = (0, react.useState)(void 0);
	const [cli, setCli] = (0, react.useState)("");
	(0, react.useEffect)(() => {
		let live = true;
		listModels().then((list) => {
			if (live) setRoutes(list);
		}).catch((reason) => {
			if (live) {
				setRoutes([]);
				setError(reason instanceof Error ? reason.message : String(reason));
			}
		});
		return () => {
			live = false;
		};
	}, [listModels]);
	const wantClis = type === "cli" && clis === void 0;
	(0, react.useEffect)(() => {
		if (!wantClis) return;
		let live = true;
		listClis().then((list) => {
			if (!live) return;
			setClis(list);
			setCli((prev) => prev !== "" ? prev : CLI_CHOICES.find((c) => list.some((l) => l.cli === c.cli))?.cli ?? "");
		}).catch((reason) => {
			if (live) {
				setClis([]);
				setError(reason instanceof Error ? reason.message : String(reason));
			}
		});
		return () => {
			live = false;
		};
	}, [wantClis, listClis]);
	const submit = (event) => {
		event.preventDefault();
		if (busy) return;
		const [provider, model] = modelKey === "" ? [] : modelKey.split(SEP);
		setBusy(true);
		setError(void 0);
		onSubmit(type === "cli" ? {
			name: name.trim(),
			persona,
			cli
		} : {
			name: name.trim(),
			persona,
			model: provider !== void 0 && model !== void 0 ? {
				provider,
				model
			} : null
		}).then(onClose).catch((reason) => {
			setError(reason instanceof Error ? reason.message : String(reason));
		}).finally(() => {
			setBusy(false);
		});
	};
	const current = member?.model ? member.model.provider + SEP + member.model.model : void 0;
	const listed = routes?.some((r) => r.models.some((m) => r.provider + SEP + m.id === current)) ?? false;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.dialogBackdrop,
		onMouseDown: (event) => {
			if (event.target === event.currentTarget) onClose();
		},
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
			className: ChannelsPage_module_default.dialog,
			role: "dialog",
			"aria-modal": "true",
			"aria-label": member === void 0 ? t("memberDialogAdd") : t("memberDialogEdit", { name: member.name }),
			onSubmit: submit,
			onKeyDown: (event) => {
				if (event.key === "Escape") onClose();
			},
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: ChannelsPage_module_default.dialogTitle,
					children: member === void 0 ? t("memberDialogAdd") : t("memberDialogEdit", { name: member.name })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: ChannelsPage_module_default.field,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberName") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: ChannelsPage_module_default.fieldInput,
						value: name,
						maxLength: 32,
						autoFocus: true,
						onChange: (event) => {
							setName(event.target.value);
						}
					})]
				}),
				member === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.field,
					role: "radiogroup",
					"aria-label": t("memberType"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberType") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.choiceRow,
						children: ["dsh", "cli"].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: ChannelsPage_module_default.choice,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "radio",
								name: "member-type",
								value,
								checked: type === value,
								onChange: () => {
									setType(value);
									setError(void 0);
								}
							}), value === "dsh" ? t("memberTypeDsh") : t("memberTypeCli")]
						}, value))
					})]
				}),
				type === "cli" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.field,
					role: "radiogroup",
					"aria-label": t("memberCli"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: clis === void 0 ? t("memberCliLoading") : t("memberCli") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.choiceRow,
						children: CLI_CHOICES.map(({ cli: id, label }) => {
							const found = clis?.find((l) => l.cli === id);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: ChannelsPage_module_default.choice,
								title: found?.path,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "radio",
									name: "member-cli",
									value: id,
									checked: cli === id,
									disabled: found === void 0,
									onChange: () => {
										setCli(id);
									}
								}), found === void 0 && clis !== void 0 ? `${label} (${t("memberCliMissing")})` : label]
							}, id);
						})
					})]
				}),
				type === "dsh" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: ChannelsPage_module_default.field,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberModel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						className: ChannelsPage_module_default.fieldInput,
						value: modelKey,
						disabled: routes === void 0,
						onChange: (event) => {
							setModelKey(event.target.value);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: routes === void 0 ? t("memberModelLoading") : t("memberModelDefault")
							}),
							current !== void 0 && !listed && member?.model && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: current,
								children: `${member.model.provider}/${member.model.model}`
							}),
							routes?.map((route) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
								label: route.error === void 0 ? route.name : t("memberModelRouteError", {
									route: route.name,
									error: route.error
								}),
								children: route.models.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: route.provider + SEP + m.id,
									children: m.name === m.id ? m.id : `${m.name} (${m.id})`
								}, m.id))
							}, route.provider))
						]
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: ChannelsPage_module_default.field,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberPersona") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: ChannelsPage_module_default.fieldInput,
						rows: 4,
						value: persona,
						maxLength: 4e3,
						onChange: (event) => {
							setPersona(event.target.value);
						}
					})]
				}),
				error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.sendError,
					role: "alert",
					children: error
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.dialogActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.secondaryButton,
						onClick: onClose,
						children: t("cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "submit",
						className: ChannelsPage_module_default.primaryButton,
						disabled: busy || name.trim() === "" || type === "cli" && cli === "",
						children: t("save")
					})]
				})
			]
		})
	});
}
// src/client/ChannelsPage.tsx
/**
* Channels main panel: room list, message stream with composer, and member
* list, in a Discord-style three-column layout. All data arrives through the
* injected `useChannels` hook; posting goes through the injected actions.
*/
const PALETTE = [
	"#5865f2",
	"#eb459e",
	"#3ba55c",
	"#faa61a",
	"#ed4245",
	"#00a8fc",
	"#9b59b6",
	"#e67e22"
];
function color(id) {
	let h = 7;
	for (const c of id) h = h * 31 + c.charCodeAt(0) >>> 0;
	return PALETTE[h % PALETTE.length];
}
function Avatar({ id, name, small }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: small === true ? `${ChannelsPage_module_default.avatar} ${ChannelsPage_module_default.avatarSmall}` : ChannelsPage_module_default.avatar,
		style: { background: color(id) },
		"aria-hidden": true,
		children: (name || id).slice(0, 1)
	});
}
const CLI_TAG = {
	claude: "kindClaude",
	codex: "kindCodex",
	gemini: "kindGemini"
};
function KindTag({ kind, cli, t }) {
	if (cli !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: ChannelsPage_module_default.tag,
		children: t(CLI_TAG[cli])
	});
	if (kind === "dsh") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: ChannelsPage_module_default.tag,
		children: t("kindDsh")
	});
	if (kind === "bot") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: ChannelsPage_module_default.tag,
		children: t("kindBot")
	});
	return null;
}
function MessageRow({ message, member, t }) {
	let card;
	if (message.card !== null) try {
		card = JSON.parse(message.card);
	} catch (error) {}
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: message.author_kind === "system" ? `${ChannelsPage_module_default.message} ${ChannelsPage_module_default.system}` : ChannelsPage_module_default.message,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
			id: message.author,
			name: message.name
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: ChannelsPage_module_default.messageBody,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.messageHead,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.author,
						children: message.name
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KindTag, {
						kind: member?.kind,
						cli: member?.cli,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
						className: ChannelsPage_module_default.time,
						children: (/* @__PURE__ */ new Date(message.created_at * 1e3)).toLocaleString()
					})
				]
			}), card === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.text,
				children: message.text
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.card,
				"data-state": card.state,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.cardTitle,
					children: card.title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.text,
					children: message.text
				})]
			})]
		})]
	});
}
function MemberGroup({ title, members, busy, onPick, onEdit, onRemove, t }) {
	if (members.length === 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
		className: ChannelsPage_module_default.groupTitle,
		children: title
	}), members.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: m.online ? ChannelsPage_module_default.memberRow : `${ChannelsPage_module_default.memberRow} ${ChannelsPage_module_default.offline}`,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: ChannelsPage_module_default.member,
			title: t("mentionPick", { name: m.name }),
			onClick: () => {
				onPick(m);
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ChannelsPage_module_default.memberAvatar,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
					id: m.id,
					name: m.name,
					small: true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ChannelsPage_module_default.presence })]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ChannelsPage_module_default.memberText,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ChannelsPage_module_default.memberName,
						children: [m.name, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KindTag, {
							kind: m.kind,
							cli: m.cli,
							t
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.memberStatus,
						children: busy.has(m.id) ? t("working") : m.online ? t("online") : t("offline")
					}),
					m.kind === "dsh" && m.cli === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.memberModel,
						children: m.model ? `${m.model.provider}/${m.model.model}` : t("defaultModel")
					})
				]
			})]
		}), m.kind === "dsh" && (m.editable === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: ChannelsPage_module_default.memberActions,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.linkButton,
				onClick: () => {
					onEdit(m);
				},
				children: t("editMember")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.linkButton,
				onClick: () => {
					onRemove(m);
				},
				children: t("removeMember")
			})]
		}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: ChannelsPage_module_default.memberActions,
			title: t("configMember"),
			children: "⚙"
		}))]
	}, m.id))] });
}
/**
* Render the channels panel.
* @param props - framework, injected, and locale shares.
* @returns the three-column channel view.
*/
function ChannelsPage({ useChannels, selectRoom, send, createRoom, listModels, listClis, addMember, updateMember, removeMember, t }) {
	const state = useChannels((snapshot) => snapshot);
	const [drafts, setDrafts] = (0, react.useState)({});
	const [errors, setErrors] = (0, react.useState)({});
	const [sending, setSending] = (0, react.useState)({});
	const pendingRooms = (0, react.useRef)(/* @__PURE__ */ new Set());
	const draft = state.roomId === void 0 ? "" : drafts[state.roomId] ?? "";
	const sendError = state.roomId === void 0 ? void 0 : errors[state.roomId];
	const logRef = (0, react.useRef)(null);
	const stickRef = (0, react.useRef)(true);
	const inputRef = (0, react.useRef)(null);
	const [caret, setCaret] = (0, react.useState)(0);
	const [dismissedAt, setDismissedAt] = (0, react.useState)(void 0);
	const [highlight, setHighlight] = (0, react.useState)(0);
	const pendingCaret = (0, react.useRef)(void 0);
	const [dialog, setDialog] = (0, react.useState)(void 0);
	const [newRoom, setNewRoom] = (0, react.useState)(void 0);
	const [roomError, setRoomError] = (0, react.useState)(void 0);
	const [memberError, setMemberError] = (0, react.useState)(void 0);
	(0, react.useEffect)(() => {
		const input = inputRef.current;
		const next = pendingCaret.current;
		if (input === null || next === void 0) return;
		pendingCaret.current = void 0;
		input.focus();
		input.setSelectionRange(next, next);
	});
	(0, react.useEffect)(() => {
		const log = logRef.current;
		if (log !== null && stickRef.current) log.scrollTop = log.scrollHeight;
	}, [state.messages, state.roomId]);
	if (state.phase !== "ready") {
		const notice = state.phase === "unavailable" ? t("unavailable") : state.phase === "unauthorized" ? t("unauthorized") : state.phase === "error" ? t("error", { message: state.error ?? "" }) : t("loading");
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: ChannelsPage_module_default.page,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.notice,
				role: "status",
				children: notice
			})
		});
	}
	const room = state.rooms.find((r) => r.id === state.roomId);
	const busy = new Set(state.roomId === void 0 ? [] : state.thinking[String(state.roomId)] ?? []);
	const byId = new Map(state.members.map((m) => [m.id, m]));
	const busyNames = [...busy].map((id) => byId.get(id)?.name ?? id);
	const mention = activeMention(draft, caret);
	const candidates = mention === void 0 || mention.start === dismissedAt ? [] : rankMembers(state.members, mention.query);
	const popupOpen = mention !== void 0 && candidates.length > 0;
	const selected = Math.min(highlight, Math.max(candidates.length - 1, 0));
	const setDraft = (text, nextCaret) => {
		const roomId = state.roomId;
		if (roomId === void 0) return;
		setDrafts((previous) => ({
			...previous,
			[roomId]: text
		}));
		setCaret(nextCaret);
		setHighlight(0);
		pendingCaret.current = nextCaret;
	};
	const choose = (member) => {
		if (mention === void 0) return;
		const next = applyMention(draft, caret, mention, member);
		setDraft(next.text, next.caret);
	};
	const pickFromList = (member) => {
		const next = insertMention(draft, caret, member);
		setDraft(next.text, next.caret);
	};
	const submitRoom = () => {
		const name = (newRoom ?? "").trim();
		if (!name) {
			setNewRoom(void 0);
			return;
		}
		setRoomError(void 0);
		createRoom(name).then(() => {
			setNewRoom(void 0);
		}).catch((error) => {
			setRoomError(error instanceof Error ? error.message : String(error));
		});
	};
	const confirmRemove = (member) => {
		if (!window.confirm(t("removeConfirm", { name: member.name }))) return;
		setMemberError(void 0);
		removeMember(member.id).catch((error) => {
			setMemberError(error instanceof Error ? error.message : String(error));
		});
	};
	const openPicker = () => {
		const before = draft.slice(0, caret);
		const insert = before === "" || /\s$/.test(before) ? "@" : " @";
		setDismissedAt(void 0);
		setDraft(before + insert + draft.slice(caret), caret + insert.length);
	};
	const submit = () => {
		const roomId = state.roomId;
		const text = draft.trim();
		if (!text || roomId === void 0 || pendingRooms.current.has(roomId)) return;
		pendingRooms.current.add(roomId);
		setSending((previous) => ({
			...previous,
			[roomId]: true
		}));
		setErrors((previous) => ({
			...previous,
			[roomId]: void 0
		}));
		stickRef.current = true;
		send(text).then(() => {
			setDrafts((previous) => ({
				...previous,
				[roomId]: ""
			}));
		}).catch((error) => {
			setErrors((previous) => ({
				...previous,
				[roomId]: t("sendFailed", { message: error instanceof Error ? error.message : String(error) })
			}));
		}).finally(() => {
			pendingRooms.current.delete(roomId);
			setSending((previous) => ({
				...previous,
				[roomId]: false
			}));
		});
	};
	const onKeyDown = (event) => {
		if (popupOpen && !event.nativeEvent.isComposing) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				setHighlight((selected + step + candidates.length) % candidates.length);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				choose(candidates[selected]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setDismissedAt(mention?.start);
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			submit();
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.page,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
				className: ChannelsPage_module_default.rooms,
				"aria-label": t("rooms"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.groupHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: ChannelsPage_module_default.groupTitle,
							children: t("rooms")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ChannelsPage_module_default.iconButton,
							title: t("newRoom"),
							"aria-label": t("newRoom"),
							onClick: () => {
								setNewRoom("");
								setRoomError(void 0);
							},
							children: "+"
						})]
					}),
					newRoom !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: ChannelsPage_module_default.roomInput,
						autoFocus: true,
						value: newRoom,
						maxLength: 32,
						placeholder: t("newRoomPlaceholder"),
						"aria-label": t("newRoom"),
						onChange: (event) => {
							setNewRoom(event.target.value);
						},
						onKeyDown: (event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing) {
								event.preventDefault();
								submitRoom();
							}
							if (event.key === "Escape") {
								setNewRoom(void 0);
								setRoomError(void 0);
							}
						},
						onBlur: () => {
							if ((newRoom ?? "").trim() === "") setNewRoom(void 0);
						}
					}),
					roomError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.sendError,
						role: "alert",
						children: roomError
					}),
					state.rooms.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: r.id === state.roomId ? `${ChannelsPage_module_default.room} ${ChannelsPage_module_default.roomActive}` : ChannelsPage_module_default.room,
						"aria-current": r.id === state.roomId,
						onClick: () => {
							stickRef.current = true;
							selectRoom(r.id);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ChannelsPage_module_default.hash,
							"aria-hidden": true,
							children: "#"
						}), r.name]
					}, r.id))
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ChannelsPage_module_default.chat,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ChannelsPage_module_default.chatHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ChannelsPage_module_default.hash,
							"aria-hidden": true,
							children: "#"
						}), room?.name]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						ref: logRef,
						className: ChannelsPage_module_default.log,
						role: "log",
						"aria-live": "polite",
						onScroll: (event) => {
							const el = event.currentTarget;
							stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
						},
						children: state.messages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.empty,
							children: t("empty")
						}) : state.messages.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageRow, {
							message: m,
							member: byId.get(m.author),
							t
						}, m.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.working,
						"aria-live": "polite",
						children: busyNames.length > 0 ? t("workingList", { names: busyNames.join("、") }) : ""
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.composer,
						children: [
							sendError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ChannelsPage_module_default.sendError,
								role: "alert",
								children: sendError
							}),
							popupOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ChannelsPage_module_default.mentionPopup,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.mentionTitle,
										children: mention.query === "" ? t("mentionTitle") : t("mentionTitleQuery", { query: mention.query })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										role: "listbox",
										id: "channel-mention-list",
										"aria-label": t("mentionTitle"),
										children: candidates.map((m, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											id: `channel-mention-${m.id}`,
											role: "option",
											"aria-selected": index === selected,
											className: index === selected ? `${ChannelsPage_module_default.mentionItem} ${ChannelsPage_module_default.mentionActive}` : ChannelsPage_module_default.mentionItem,
											onMouseDown: (event) => {
												event.preventDefault();
											},
											onMouseEnter: () => {
												setHighlight(index);
											},
											onClick: () => {
												choose(m);
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: ChannelsPage_module_default.memberAvatar,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
														id: m.id,
														name: m.name,
														small: true
													}), m.online && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ChannelsPage_module_default.presence })]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ChannelsPage_module_default.mentionName,
													children: m.name
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KindTag, {
													kind: m.kind,
													cli: m.cli,
													t
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ChannelsPage_module_default.mentionMeta,
													children: busy.has(m.id) ? t("working") : m.online ? `@${m.id}` : t("offline")
												})
											]
										}, m.id))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.mentionHint,
										children: t("mentionHint")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ChannelsPage_module_default.composerRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									ref: inputRef,
									className: ChannelsPage_module_default.input,
									rows: 1,
									value: draft,
									disabled: state.roomId === void 0 || sending[state.roomId] === true,
									placeholder: t("placeholder", { room: room?.name ?? "" }),
									role: "combobox",
									"aria-expanded": popupOpen,
									"aria-controls": "channel-mention-list",
									"aria-autocomplete": "list",
									"aria-activedescendant": popupOpen ? `channel-mention-${candidates[selected].id}` : void 0,
									onChange: (event) => {
										const roomId = state.roomId;
										const value = event.target.value;
										if (roomId !== void 0) setDrafts((previous) => ({
											...previous,
											[roomId]: value
										}));
										setCaret(event.target.selectionStart);
										setHighlight(0);
									},
									onSelect: (event) => {
										setCaret(event.currentTarget.selectionStart);
									},
									onKeyDown
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ChannelsPage_module_default.mentionButton,
									title: t("mentionButton"),
									"aria-label": t("mentionButton"),
									disabled: state.roomId === void 0 || sending[state.roomId] === true,
									onClick: openPicker,
									children: "@"
								})]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: ChannelsPage_module_default.members,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ChannelsPage_module_default.addMemberButton,
						onClick: () => {
							setDialog(null);
						},
						children: ["+ ", t("addMember")]
					}),
					memberError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.sendError,
						role: "alert",
						children: memberError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberGroup, {
						title: t("agents", { count: String(state.members.filter((m) => m.kind !== "human").length) }),
						members: state.members.filter((m) => m.kind !== "human"),
						busy,
						onPick: pickFromList,
						onEdit: setDialog,
						onRemove: confirmRemove,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberGroup, {
						title: t("humans", { count: String(state.members.filter((m) => m.kind === "human").length) }),
						members: state.members.filter((m) => m.kind === "human"),
						busy,
						onPick: pickFromList,
						onEdit: setDialog,
						onRemove: confirmRemove,
						t
					})
				]
			}),
			dialog !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberDialog, {
				member: dialog ?? void 0,
				listModels,
				listClis,
				onSubmit: (input) => dialog === null ? addMember(input) : updateMember(dialog.id, input),
				onClose: () => {
					setDialog(void 0);
				},
				t
			})
		]
	});
}
// src/client/locales.ts
/** Channel panel dictionaries. */
/** Locale namespace owned by the channel panel. */
const NS = "discord-channels";
/** Simplified Chinese dictionary and key source. */
const zh = {
	panel: "频道",
	rooms: "文字频道",
	agents: "Agent — {count}",
	humans: "真人 — {count}",
	online: "在线",
	offline: "离线",
	working: "正在处理…",
	workingList: "{names} 正在处理…",
	kindDsh: "DSH",
	kindBot: "Agent",
	kindClaude: "Claude Code",
	kindCodex: "Codex",
	kindGemini: "Gemini",
	placeholder: "发消息到 #{room}，@成员 让它干活（Enter 发送，Shift+Enter 换行）",
	loading: "正在连接频道服务…",
	unavailable: "频道服务未启用：在 collab.yml 中配置服务后，用 --patch collab.yml 启动 DSH。",
	unauthorized: "还没有登录 DSH，请刷新页面。",
	error: "频道服务出错：{message}",
	empty: "这里还没有消息。@一个成员开始吧。",
	sendFailed: "发送失败：{message}",
	mentionTitle: "可以 @ 的成员",
	mentionTitleQuery: "匹配「{query}」的成员",
	mentionHint: "↑↓ 选择 · Enter / Tab 确认 · Esc 关闭",
	mentionButton: "@ 一个成员",
	mentionPick: "在输入框里 @{name}",
	newRoom: "新建频道",
	newRoomPlaceholder: "频道名，回车创建",
	addMember: "添加成员",
	editMember: "编辑",
	removeMember: "移除",
	removeConfirm: "移除成员「{name}」？历史消息会保留。",
	memberDialogAdd: "添加 DSH 成员",
	memberDialogEdit: "编辑成员「{name}」",
	memberName: "名字（@ 时用，不能有空格）",
	memberModel: "模型",
	memberModelDefault: "跟随 DSH 默认模型",
	memberModelLoading: "正在读取可用模型…",
	memberModelRouteError: "{route}（读取失败：{error}）",
	memberType: "成员类型",
	memberTypeDsh: "DSH 模型",
	memberTypeCli: "本机 CLI",
	memberCli: "本机 CLI",
	memberCliLoading: "正在检测本机 CLI…",
	memberCliMissing: "未检测到",
	memberPersona: "人设（可选）：它是谁、负责什么、说话风格",
	save: "保存",
	cancel: "取消",
	configMember: "来自配置文件，网页里不能修改",
	defaultModel: "默认模型"
};
/** English dictionary. */
const en = {
	panel: "Channels",
	rooms: "Text channels",
	agents: "Agents — {count}",
	humans: "People — {count}",
	online: "Online",
	offline: "Offline",
	working: "Working…",
	workingList: "{names} working…",
	kindDsh: "DSH",
	kindBot: "Agent",
	kindClaude: "Claude Code",
	kindCodex: "Codex",
	kindGemini: "Gemini",
	placeholder: "Message #{room}; @ a member to put it to work (Enter sends, Shift+Enter for a new line)",
	loading: "Connecting to the channel service…",
	unavailable: "The channel service is off: configure it in collab.yml, then start DSH with --patch collab.yml.",
	unauthorized: "Not signed in to DSH; reload the page.",
	error: "Channel service error: {message}",
	empty: "No messages yet. @ a member to start.",
	sendFailed: "Send failed: {message}",
	mentionTitle: "Members you can mention",
	mentionTitleQuery: "Members matching \"{query}\"",
	mentionHint: "↑↓ select · Enter / Tab confirm · Esc close",
	mentionButton: "Mention a member",
	mentionPick: "Mention {name} in the message box",
	newRoom: "New channel",
	newRoomPlaceholder: "Channel name, Enter to create",
	addMember: "Add member",
	editMember: "Edit",
	removeMember: "Remove",
	removeConfirm: "Remove member \"{name}\"? Their messages stay.",
	memberDialogAdd: "Add a DSH member",
	memberDialogEdit: "Edit member \"{name}\"",
	memberName: "Name (used for @, no spaces)",
	memberModel: "Model",
	memberModelDefault: "Follow the DSH default model",
	memberModelLoading: "Loading available models…",
	memberModelRouteError: "{route} (could not list: {error})",
	memberType: "Member type",
	memberTypeDsh: "DSH model",
	memberTypeCli: "Local CLI",
	memberCli: "Local CLI",
	memberCliLoading: "Detecting CLIs on this machine…",
	memberCliMissing: "not found",
	memberPersona: "Persona (optional): who it is, what it does, how it talks",
	save: "Save",
	cancel: "Cancel",
	configMember: "From the config file; not editable here",
	defaultModel: "Default model"
};
// src/client/index.ts
const PANEL_ID = "channels";
/** Required browser services. */
const inject = ["slots", "locale"];
/**
* Register the channel dictionaries, the main panel, and its sidebar entry.
* @param ctx - Client root context.
*/
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "client-ui-discord: dictionaries");
	const t = ctx.locale.bind(NS);
	const channels = createChannelSource(browserTransport());
	ctx.effect(() => channels.dispose, "client-ui-discord: channel stream");
	const injected = () => ({
		hooks: { channels: channels.source },
		selectRoom: channels.actions.selectRoom,
		send: channels.actions.send,
		createRoom: channels.actions.createRoom,
		listModels: channels.actions.listModels,
		listClis: channels.actions.listClis,
		addMember: channels.actions.addMember,
		updateMember: channels.actions.updateMember,
		removeMember: channels.actions.removeMember
	});
	ctx.slots.inject("main", () => ctx.slots.register({
		name: "main",
		key: PANEL_ID,
		locale: NS,
		inject: injected
	}, ChannelsPage));
	ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
		name: "sidebar.panellist",
		id: PANEL_ID,
		order: 5,
		locale: NS,
		label: () => t("panel")
	}, ChannelsIcon));
}
exports.apply = apply;
exports.inject = inject;

 return module.exports;
 }
});
