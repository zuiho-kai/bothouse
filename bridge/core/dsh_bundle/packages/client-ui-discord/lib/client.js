// dsh-client-source-sha256: d97913fa30b6c9eafe965259faea502f505c13cf13b84318e73b970b89d4ec0f
// dsh-style-sha256: 4e8c7282821f2aac857fba19c7ec76b7fceb91782891915bb78bb3c3c089bc50
window.__ModuleLoader__.load({
 id: "@deepseek-ai/dsh-experimental-client-ui-discord",
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
(function(){var s=document.createElement('style');s.setAttribute('data-dsh-plugin',"dsh-experimental-client-ui-discord");s.textContent=".dshc_page {\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  padding-top: var(--dsh-frame-top-clearance, 0px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  grid-template-columns: 220px minmax(0, 1fr) 240px;\n  font-size: 14px;\n  line-height: 1.5;\n  display: grid;\n}\n\n.dshc_notice {\n  max-width: 480px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: center;\n  grid-column: 1 / -1;\n  place-self: center;\n  padding: 24px;\n}\n\n.dshc_rooms, .dshc_members {\n  background: var(--dsw-alias-bg-layer-2);\n  min-height: 0;\n  padding: 0 8px 16px;\n  overflow-y: auto;\n}\n\n.dshc_membersHead {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  flex: none;\n  height: 44px;\n  margin: 0 0 8px;\n}\n\n.dshc_groupTitle {\n  color: var(--dsw-alias-label-tertiary);\n  letter-spacing: .02em;\n  margin: 12px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.dshc_room {\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.dshc_room:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_room:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_workspace {\n  padding-left: 22px;\n  font-size: .95em;\n}\n\n.dshc_roomLabel {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.dshc_activeCount {\n  color: var(--dsw-alias-label-tertiary);\n  flex-shrink: 0;\n  margin-left: auto;\n  font-size: 11px;\n}\n\n.dshc_activeBusy {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshc_roomActive {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_hash {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 16px;\n}\n\n.dshc_chat {\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n}\n\n.dshc_chatHead {\n  -webkit-app-region: drag;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  align-items: center;\n  gap: 6px;\n  height: 44px;\n  padding: 0 16px;\n  font-weight: 600;\n  display: flex;\n}\n\n.dshc_log {\n  flex: 1;\n  min-height: 0;\n  padding: 8px 0 12px;\n  overflow-y: auto;\n}\n\n.dshc_guide {\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 10px;\n  margin: 16px;\n  padding: 14px 16px;\n  display: flex;\n}\n\n.dshc_empty {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 24px 16px;\n}\n\n.dshc_message {\n  grid-template-columns: 36px minmax(0, 1fr);\n  gap: 12px;\n  padding: 6px 16px;\n  display: grid;\n}\n\n.dshc_system .dshc_text {\n  color: var(--dsw-alias-label-tertiary);\n  font-style: italic;\n}\n\n.dshc_avatar {\n  corner-shape: round;\n  color: #fff;\n  border-radius: 50%;\n  flex: none;\n  place-items: center;\n  width: 36px;\n  height: 36px;\n  font-weight: 700;\n  display: grid;\n  position: relative;\n}\n\n.dshc_avatarImage {\n  object-fit: cover;\n  border-radius: 50%;\n  width: 100%;\n  height: 100%;\n  position: absolute;\n  inset: 0;\n}\n\n.dshc_avatarSmall {\n  width: 28px;\n  height: 28px;\n  font-size: 12px;\n}\n\n.dshc_avatarAnchor {\n  align-self: start;\n  position: relative;\n}\n\n.dshc_avatarButton {\n  cursor: pointer;\n  background: none;\n  border: 0;\n  border-radius: 50%;\n  padding: 0;\n}\n\n.dshc_avatarMenu {\n  z-index: 3;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  min-width: 140px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 0;\n}\n\n.dshc_avatarMenuTitle {\n  padding: 4px 8px;\n  font-weight: 700;\n}\n\n.dshc_avatarMenuItem {\n  border-radius: var(--dsw-radius-sm);\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 6px 8px;\n}\n\n.dshc_avatarMenuItem:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_messageBody {\n  min-width: 0;\n}\n\n.dshc_messageHead {\n  align-items: baseline;\n  gap: 6px;\n  display: flex;\n}\n\n.dshc_author {\n  font-weight: 600;\n}\n\n.dshc_time {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dshc_tag {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  white-space: nowrap;\n  padding: 0 4px;\n  font-size: 10px;\n  font-weight: 600;\n}\n\n.dshc_edited {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.dshc_ownActions {\n  margin-left: auto;\n  margin-right: var(--channels-reply-clearance);\n  opacity: 0;\n  gap: 8px;\n  display: inline-flex;\n}\n\n.dshc_message:hover .dshc_ownActions, .dshc_ownActions:focus-within {\n  opacity: 1;\n}\n\n@media (hover: none) {\n  .dshc_ownActions {\n    display: none;\n  }\n\n  .dshc_message[data-tools-open] .dshc_ownActions {\n    opacity: 1;\n    display: inline-flex;\n  }\n}\n\n.dshc_editBox {\n  flex-direction: column;\n  gap: 6px;\n  margin-top: 4px;\n  display: flex;\n}\n\n.dshc_editInput {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  min-height: 60px;\n  color: inherit;\n  font: inherit;\n  resize: vertical;\n  padding: 8px;\n}\n\n.dshc_editBar {\n  justify-content: flex-end;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_editBar .dshc_time {\n  margin-right: auto;\n}\n\n.dshc_text {\n  white-space: normal;\n  overflow-wrap: anywhere;\n}\n\n.dshc_card {\n  border-left: 4px solid var(--dsw-alias-state-business-primary);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-layer-2);\n  margin-top: 4px;\n  padding: 6px 10px;\n}\n\n.dshc_card[data-state=\"failed\"] {\n  border-left-color: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_card[data-state=\"retrying\"] {\n  border-left-color: var(--dsw-alias-state-warning-primary, #faa61a);\n}\n\n.dshc_cardButtons {\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.dshc_cardTitle {\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.dshc_cardDetail {\n  color: var(--dsw-alias-label-secondary);\n  margin-top: 4px;\n  font-size: 12px;\n}\n\n.dshc_cardDetail summary {\n  cursor: pointer;\n}\n\n.dshc_cardDetail pre {\n  white-space: pre-wrap;\n  word-break: break-word;\n  margin: 4px 0 0;\n}\n\n.dshc_cardHead {\n  justify-content: space-between;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_cardViews {\n  gap: 4px;\n  display: flex;\n}\n\n.dshc_cardViewButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  color: inherit;\n  cursor: pointer;\n  background: none;\n  padding: 0 6px;\n  font-size: 12px;\n}\n\n.dshc_cardViewButton[aria-pressed=\"true\"] {\n  background: var(--dsw-alias-bg-base);\n  font-weight: 600;\n}\n\n.dshc_permActions {\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.dshc_permScope {\n  color: var(--dsw-alias-text-secondary);\n  flex-basis: 100%;\n  font-size: 12px;\n}\n\n.dshc_permStatus {\n  margin-top: 6px;\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.dshc_message {\n  --channels-reply-clearance: 36px;\n  position: relative;\n}\n\n.dshc_quote {\n  border-left: 2px solid var(--dsw-alias-label-tertiary);\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  gap: 6px;\n  margin-bottom: 2px;\n  padding-left: 8px;\n  font-size: 12px;\n  display: flex;\n  overflow: hidden;\n}\n\n.dshc_quoteDeleted {\n  font-style: italic;\n}\n\n.dshc_quoteAuthor {\n  flex: none;\n  font-weight: 600;\n}\n\n.dshc_replyButton {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  cursor: pointer;\n  border: 0;\n  padding: 0 6px;\n}\n\n.dshc_msgTools {\n  z-index: 1;\n  border: 1px solid var(--dsw-alias-separator, #7f7f7f40);\n  border-radius: var(--dsw-radius-sm, 6px);\n  background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-primary, #fff));\n  opacity: 0;\n  pointer-events: none;\n  align-items: center;\n  gap: 2px;\n  padding: 2px;\n  display: inline-flex;\n  position: absolute;\n  top: 2px;\n  right: 16px;\n  box-shadow: 0 2px 6px #00000014;\n}\n\n.dshc_msgTool {\n  border-radius: var(--dsw-radius-sm, 6px);\n  color: var(--dsw-alias-label-secondary);\n  white-space: nowrap;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 2px 8px;\n  font-size: 12px;\n}\n\n.dshc_msgTool:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshc_msgTool:disabled {\n  cursor: default;\n  opacity: .6;\n}\n\n.dshc_msgToolNote {\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  padding: 0 6px;\n  font-size: 12px;\n}\n\n.dshc_message:hover .dshc_msgTools, .dshc_message:focus-within .dshc_msgTools, .dshc_msgTools:has(.dshc_msgToolNote) {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n@media (hover: none) {\n  .dshc_message {\n    -webkit-touch-callout: none;\n  }\n\n  .dshc_msgTools {\n    display: none;\n  }\n\n  .dshc_message[data-tools-open] {\n    background: var(--dsw-alias-interactive-bg-hover);\n  }\n\n  .dshc_message[data-tools-open] .dshc_msgTools {\n    z-index: 3;\n    opacity: 1;\n    pointer-events: auto;\n    display: inline-flex;\n    top: -14px;\n    right: 12px;\n  }\n\n  .dshc_message[data-tools-open] .dshc_msgTool {\n    width: 40px;\n    height: 36px;\n  }\n}\n\n.dshc_replyBar {\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  align-items: center;\n  gap: 8px;\n  margin-bottom: 6px;\n  padding: 4px 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_replyBarText {\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n}\n\n.dshc_replyCancel {\n  color: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n}\n\n.dshc_working {\n  min-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n  align-items: center;\n  gap: 6px;\n  padding: 0 16px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_composer {\n  padding: 0 16px 16px;\n  position: relative;\n}\n\n.dshc_composerBox {\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: var(--dsw-radius-xl);\n  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-layer-2));\n  box-shadow: var(--dsw-shadow-lv1-blur);\n  flex-direction: column;\n  display: flex;\n  overflow: hidden;\n}\n\n.dshc_composerBox:focus-within {\n  border-color: var(--dsw-alias-label-tertiary);\n}\n\n.dshc_composerToolbar {\n  flex: none;\n  align-items: center;\n  gap: 4px;\n  padding: 4px 10px 10px;\n  display: flex;\n}\n\n.dshc_composerBox > .dshc_replyBar, .dshc_composerBox > .dshc_attachments {\n  margin: 10px 14px 0;\n}\n\n.dshc_mentionButton {\n  border-radius: var(--dsw-radius-full, 50%);\n  width: 32px;\n  height: 32px;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  padding: 0;\n  font-size: 18px;\n  display: inline-flex;\n}\n\n.dshc_mentionButton:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_sendButton {\n  border-radius: var(--dsw-radius-full, 50%);\n  width: 32px;\n  height: 32px;\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-label-primary);\n  font: inherit;\n  cursor: pointer;\n  border: 0;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  margin-left: auto;\n  padding: 0;\n  display: inline-flex;\n}\n\n.dshc_sendButton:disabled {\n  opacity: .45;\n  cursor: default;\n}\n\n.dshc_sendButton:focus-visible, .dshc_mentionButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_mentionPopup {\n  z-index: 2;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  max-height: 320px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  bottom: calc(100% - 8px);\n  left: 16px;\n  right: 16px;\n}\n\n.dshc_mentionPopup > [role=\"listbox\"] {\n  min-height: 0;\n  overflow-y: auto;\n}\n\n.dshc_mentionTitle {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 4px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.dshc_mentionItem {\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n  align-items: center;\n  gap: 10px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.dshc_mentionActive {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_mentionName {\n  font-weight: 600;\n}\n\n.dshc_mentionMeta {\n  color: var(--dsw-alias-label-tertiary);\n  margin-left: auto;\n  font-size: 12px;\n}\n\n.dshc_mentionHint {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-tertiary);\n  padding: 6px 8px 2px;\n  font-size: 11px;\n}\n\n.dshc_mentionBadge {\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #5865f2) 15%, transparent);\n  color: var(--dsw-alias-state-business-primary, #5865f2);\n  font-weight: 500;\n  line-height: inherit;\n  vertical-align: baseline;\n  -webkit-box-decoration-break: clone;\n  box-decoration-break: clone;\n  cursor: pointer;\n  border-radius: 3px;\n  padding: 0 4px;\n  transition: background-color .16s cubic-bezier(.2, 0, 0, 1), color .16s cubic-bezier(.2, 0, 0, 1);\n  display: inline-block;\n}\n\n.dshc_mentionBadge:hover {\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #5865f2) 28%, transparent);\n}\n\n.dshc_sendError {\n  color: var(--dsw-alias-state-error-primary);\n  margin-bottom: 6px;\n  font-size: 12px;\n}\n\n.dshc_inputSurface {\n  min-width: 0;\n  display: flex;\n  position: relative;\n}\n\n.dshc_input, .dshc_inputHighlights {\n  box-sizing: border-box;\n  width: 100%;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  white-space: pre-wrap;\n  overflow-wrap: break-word;\n  background: none;\n  border: 0;\n  border-radius: 0;\n  min-width: 0;\n  padding: 14px 16px 8px;\n  line-height: 1.5;\n}\n\n.dshc_input {\n  resize: none;\n  field-sizing: content;\n  color: #0000;\n  min-width: 0;\n  min-height: 52px;\n  max-height: 40vh;\n  caret-color: var(--dsw-alias-label-primary);\n  flex: 1;\n}\n\n.dshc_inputHighlights {\n  pointer-events: none;\n  height: 100%;\n  position: absolute;\n  inset: 0;\n  overflow: hidden;\n}\n\n.dshc_inputHighlights .dshc_inputMention {\n  font-weight: inherit;\n  cursor: inherit;\n  padding: 0;\n  display: inline;\n}\n\n.dshc_inputComposing .dshc_input {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshc_inputComposing .dshc_inputHighlights {\n  visibility: hidden;\n}\n\n@media (forced-colors: active) {\n  .dshc_input {\n    color: canvastext;\n    caret-color: canvastext;\n  }\n\n  .dshc_inputHighlights {\n    display: none;\n  }\n}\n\n.dshc_input::placeholder {\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  overflow: hidden;\n}\n\n@media (width <= 600px) {\n  .dshc_composer {\n    padding: 0 8px 8px;\n  }\n\n  .dshc_composerToolbar {\n    padding: 4px 8px 8px;\n  }\n\n  .dshc_input, .dshc_inputHighlights {\n    padding: 12px 14px 8px;\n  }\n}\n\n.dshc_input:focus-visible {\n  outline: none;\n}\n\n.dshc_member {\n  border-radius: var(--dsw-radius-sm);\n  min-width: 0;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: 1;\n  align-items: center;\n  gap: 10px;\n  padding: 5px 8px;\n  display: flex;\n}\n\n.dshc_member:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_member:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_offline {\n  opacity: .5;\n}\n\n.dshc_memberAvatar {\n  position: relative;\n}\n\n.dshc_presence {\n  border: 2px solid var(--dsw-alias-bg-layer-2);\n  corner-shape: round;\n  background: #23a55a;\n  border-radius: 50%;\n  width: 10px;\n  height: 10px;\n  position: absolute;\n  bottom: -2px;\n  right: -2px;\n}\n\n.dshc_offline .dshc_presence {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.dshc_memberText {\n  flex-direction: column;\n  min-width: 0;\n  display: flex;\n}\n\n.dshc_memberName {\n  align-items: center;\n  gap: 6px;\n  display: flex;\n}\n\n.dshc_memberStatus {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n@media (width <= 900px) {\n  .dshc_page {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .dshc_rooms, .dshc_members {\n    display: none;\n  }\n}\n\n.dshc_groupHead {\n  justify-content: space-between;\n  align-items: center;\n  padding-right: 4px;\n  display: flex;\n}\n\n.dshc_iconButton {\n  border-radius: var(--dsw-radius-sm);\n  width: 22px;\n  height: 22px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  font-size: 16px;\n  line-height: 1;\n}\n\n.dshc_iconButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_roomInput, .dshc_fieldInput {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n  padding: 6px 8px;\n}\n\n.dshc_roomInput {\n  margin: 2px 0 6px;\n}\n\n.dshc_roomInput:focus-visible, .dshc_fieldInput:focus-visible, .dshc_iconButton:focus-visible, .dshc_linkButton:focus-visible, .dshc_addMemberButton:focus-visible, .dshc_primaryButton:focus-visible, .dshc_secondaryButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_addMemberButton {\n  box-sizing: border-box;\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  margin: 4px 0;\n  padding: 7px 8px;\n}\n\n.dshc_addMemberButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_settingsDivider {\n  border: 0;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n  width: 100%;\n  margin: 8px 0 4px;\n}\n\n.dshc_memberListDivider {\n  border: 0;\n  border-top: 1px solid var(--dsw-alias-border-l1);\n  width: calc(100% - 16px);\n  margin: 12px 8px 2px;\n}\n\n.dshc_settingsButton {\n  text-align: left;\n  border-style: solid;\n  border-color: #0000;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_settingsButton svg {\n  flex: none;\n}\n\n.dshc_memberRow {\n  border-radius: var(--dsw-radius-sm);\n  align-items: center;\n  display: flex;\n  position: relative;\n}\n\n.dshc_memberRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_memberRow .dshc_member:hover {\n  background: none;\n}\n\n.dshc_memberModel {\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  overflow: hidden;\n}\n\n.dshc_memberActions {\n  color: var(--dsw-alias-label-tertiary);\n  opacity: 0;\n  flex: none;\n  gap: 4px;\n  padding-right: 6px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_memberRow:hover .dshc_memberActions, .dshc_memberRow:focus-within .dshc_memberActions {\n  opacity: 1;\n}\n\n.dshc_linkButton {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 2px 4px;\n  font-size: 12px;\n}\n\n.dshc_linkButton:hover {\n  color: var(--dsw-alias-label-primary);\n  text-decoration: underline;\n}\n\n.dshc_dialogBackdrop {\n  z-index: 10;\n  background: #00000073;\n  place-items: center;\n  padding: 16px;\n  display: grid;\n  position: fixed;\n  inset: 0;\n}\n\n.dshc_dialog {\n  box-sizing: border-box;\n  border-radius: var(--dsw-radius-lg);\n  width: min(460px, 100%);\n  max-height: calc(100vh - 32px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  box-shadow: var(--dsw-elevation-panel, 0 12px 32px #0000004d);\n  flex-direction: column;\n  gap: 12px;\n  padding: 20px;\n  display: flex;\n  overflow-y: auto;\n}\n\n.dshc_settingsDialog {\n  box-sizing: border-box;\n  height: min(70vh, 100dvh - 32px);\n  max-height: calc(100dvh - 32px);\n  overflow: hidden;\n}\n\n.dshc_settingsBody {\n  overscroll-behavior: contain;\n  flex: auto;\n  min-height: 0;\n  padding: 2px;\n  overflow-y: auto;\n}\n\n.dshc_settingsDialog > :not(.dshc_settingsBody) {\n  flex-shrink: 0;\n}\n\n.dshc_settingsFields {\n  flex-direction: column;\n  gap: 12px;\n  display: flex;\n}\n\n.dshc_settingsFeedback {\n  overflow-wrap: anywhere;\n  max-height: 20%;\n  overflow-y: auto;\n}\n\n.dshc_settingsDialog .dshc_dialogActions {\n  justify-content: space-between;\n}\n\n@media (width <= 599px) {\n  .dshc_settingsDialog {\n    height: calc(100dvh - 32px);\n    padding: 16px;\n  }\n}\n\n.dshc_avatarCropStage {\n  background: #000000a6;\n  padding: 20px;\n}\n\n.dshc_avatarCropFrame {\n  aspect-ratio: 1;\n  touch-action: none;\n  cursor: grab;\n  outline: 2px solid #fff;\n  width: min(256px, 100%);\n  margin: auto;\n  position: relative;\n  overflow: hidden;\n}\n\n.dshc_avatarCropFrame:active {\n  cursor: grabbing;\n}\n\n.dshc_avatarCropFrame img {\n  pointer-events: none;\n  user-select: none;\n  max-width: none;\n  position: absolute;\n}\n\n.dshc_dialogTitle {\n  margin: 0;\n  font-size: 16px;\n}\n\n.dshc_field {\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  gap: 4px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_field textarea {\n  resize: vertical;\n}\n\n.dshc_choiceRow {\n  flex-wrap: wrap;\n  gap: 12px;\n  display: flex;\n}\n\n.dshc_choiceColumn {\n  flex-direction: column;\n  gap: 12px;\n  display: flex;\n}\n\n.dshc_choiceColumn .dshc_choice {\n  grid-template-columns: max-content minmax(0, 1fr);\n  align-items: start;\n  display: grid;\n}\n\n.dshc_choice {\n  color: var(--dsw-alias-label-primary, inherit);\n  cursor: pointer;\n  align-items: center;\n  gap: 4px;\n  font-size: 13px;\n  display: inline-flex;\n}\n\n.dshc_dialogActions {\n  justify-content: flex-end;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_primaryButton, .dshc_secondaryButton {\n  border-radius: var(--dsw-radius-sm);\n  font: inherit;\n  cursor: pointer;\n  padding: 7px 14px;\n}\n\n.dshc_primaryButton {\n  color: #fff;\n  background: var(--dsw-alias-state-business-primary);\n  border: 0;\n}\n\n.dshc_primaryButton:disabled {\n  cursor: not-allowed;\n  opacity: .5;\n}\n\n.dshc_secondaryButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-primary);\n  background: none;\n}\n\n.dshc_memberFailed .dshc_memberStatus {\n  color: var(--dsw-alias-state-error-primary, #ed4245);\n}\n\n.dshc_memberFailed .dshc_presence {\n  background: #ed4245;\n}\n\n.dshc_mobileButton, .dshc_drawerBackdrop {\n  display: none;\n}\n\n.dshc_panelToggle {\n  border-radius: var(--dsw-radius-sm);\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  justify-content: center;\n  align-items: center;\n  font-size: 16px;\n  line-height: 1;\n  display: inline-flex;\n}\n\n.dshc_panelToggle:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_panelToggle:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_panelToggleEnd {\n  margin-left: auto;\n}\n\n.dshc_capabilityMenu {\n  z-index: 4;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-base);\n  max-height: 260px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  gap: 2px;\n  padding: 5px;\n  display: grid;\n  position: absolute;\n  bottom: calc(100% + 4px);\n  left: 0;\n  right: 0;\n  overflow-y: auto;\n}\n\n.dshc_capabilityItem:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_capabilityHelp {\n  color: var(--dsw-alias-label-secondary);\n  white-space: normal;\n  margin: 6px;\n  font-size: 12px;\n}\n\n.dshc_capabilityItem:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_capabilityItem {\n  text-align: left;\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n  white-space: nowrap;\n  background: none;\n  border: 0;\n  padding: 5px 8px;\n  font-size: 12px;\n  font-weight: 400;\n}\n\n@media (width >= 901px) {\n  .dshc_page.dshc_roomsHidden {\n    grid-template-columns: minmax(0, 1fr) 240px;\n  }\n\n  .dshc_page.dshc_membersHidden {\n    grid-template-columns: 220px minmax(0, 1fr);\n  }\n\n  .dshc_page.dshc_roomsHidden.dshc_membersHidden {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .dshc_roomsHidden > .dshc_rooms, .dshc_membersHidden > .dshc_members {\n    display: none;\n  }\n}\n\n@media (width <= 900px) {\n  .dshc_page {\n    position: relative;\n    overflow: hidden;\n  }\n\n  .dshc_mobileButton {\n    min-width: 40px;\n    min-height: 40px;\n    color: inherit;\n    font: inherit;\n    cursor: pointer;\n    background: none;\n    border: 0;\n    border-radius: 6px;\n    justify-content: center;\n    align-items: center;\n    display: inline-flex;\n  }\n\n  .dshc_mobileButton:last-child {\n    margin-left: auto;\n  }\n\n  .dshc_panelToggle {\n    display: none;\n  }\n\n  .dshc_drawerBackdrop {\n    z-index: 4;\n    background: #00000073;\n    border: 0;\n    display: block;\n    position: absolute;\n    inset: 0;\n  }\n\n  .dshc_rooms.dshc_drawerOpen, .dshc_members.dshc_drawerOpen {\n    z-index: 5;\n    box-sizing: border-box;\n    width: min(280px, 85%);\n    display: block;\n    position: absolute;\n    top: 0;\n    bottom: 0;\n    box-shadow: 0 0 24px #0000004d;\n  }\n\n  .dshc_rooms.dshc_drawerOpen {\n    left: 0;\n  }\n\n  .dshc_members.dshc_drawerOpen {\n    right: 0;\n  }\n\n  .dshc_memberActions {\n    opacity: 1;\n  }\n\n  .dshc_messageHead {\n    flex-wrap: wrap;\n  }\n}\n\n.dshc_avatarPicker {\n  flex-wrap: wrap;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_avatarOption {\n  cursor: pointer;\n  background: none;\n  border: 2px solid #0000;\n  border-radius: 50%;\n  padding: 2px;\n  display: grid;\n}\n\n.dshc_avatarOption[aria-checked=\"true\"] {\n  border-color: var(--dsw-alias-accent, #5865f2);\n}\n\n.dshc_taskBoardTrigger {\n  box-sizing: border-box;\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  height: 34px;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n  align-items: center;\n  gap: 8px;\n  margin: 4px 0;\n  padding: 7px 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_taskBoardTrigger:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_taskBoardTrigger:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_taskBoardSummary {\n  color: var(--dsw-alias-label-secondary);\n  text-align: right;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  flex: 1;\n  overflow: hidden;\n}\n\n.dshc_taskBoardDialog {\n  width: min(920px, 100%);\n  height: min(70vh, 100dvh - 32px);\n  overflow: hidden;\n}\n\n.dshc_taskBoardBody {\n  overscroll-behavior: contain;\n  flex: auto;\n  min-height: 0;\n  overflow-y: auto;\n}\n\n.dshc_taskBoardDialog > :not(.dshc_taskBoardBody) {\n  flex-shrink: 0;\n}\n\n.dshc_boardTabs {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  gap: 4px;\n  padding-bottom: 8px;\n  display: flex;\n  overflow-x: auto;\n}\n\n.dshc_boardTabs button {\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n  padding: 7px 10px;\n  font-size: 13px;\n}\n\n.dshc_boardTabs button:hover, .dshc_boardTabs button[aria-selected=\"true\"] {\n  color: var(--dsw-alias-state-business-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_boardTabs button:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n  outline-offset: -2px;\n}\n\n.dshc_boardTabCount {\n  font-variant-numeric: tabular-nums;\n  margin-left: 4px;\n}\n\n.dshc_boardCardGrid {\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 12px;\n  margin: 6px 0 16px;\n  padding: 2px;\n  list-style: none;\n  display: grid;\n}\n\n.dshc_boardTaskCard {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-base);\n  border-radius: 12px;\n  flex-direction: column;\n  gap: 10px;\n  min-width: 0;\n  padding: 14px;\n  transition: transform .14s, box-shadow .14s;\n  display: flex;\n}\n\n.dshc_boardTaskCard[data-working=\"true\"] {\n  border-color: var(--dsw-alias-state-business-primary);\n}\n\n.dshc_boardTaskCard[data-status=\"done\"], .dshc_boardTaskCard[data-status=\"cancelled\"], .dshc_boardTaskCard[data-status=\"superseded\"] {\n  filter: saturate(.25);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshc_boardTaskCard:hover {\n  transform: translateY(-2px);\n  box-shadow: 0 4px 12px #00000014;\n}\n\n.dshc_boardTaskHeader {\n  align-items: flex-start;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_boardTaskTitle {\n  overflow-wrap: anywhere;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  flex: 1;\n  font-size: 14px;\n  font-weight: 600;\n  line-height: 1.5;\n  display: -webkit-box;\n  overflow: hidden;\n}\n\n.dshc_boardTaskHeader .dshc_taskStatus {\n  border-radius: 999px;\n  padding: 3px 7px;\n  font-size: 11px;\n}\n\n.dshc_boardTaskCard .dshc_taskLinks {\n  justify-content: flex-end;\n  margin-top: auto;\n}\n\n.dshc_boardTabEmpty {\n  min-height: 240px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: center;\n  justify-content: center;\n  align-items: center;\n  padding: 40px 16px;\n  display: flex;\n}\n\n@media (width <= 640px) {\n  .dshc_boardCardGrid {\n    grid-template-columns: minmax(0, 1fr);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_boardTaskCard {\n    transition: none;\n  }\n\n  .dshc_boardTaskCard:hover {\n    transform: none;\n  }\n}\n\n.dshc_taskBoardScope {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n}\n\n.dshc_taskSection + .dshc_taskSection {\n  margin-top: 8px;\n}\n\n.dshc_taskSectionTitle {\n  color: var(--dsw-alias-label-secondary);\n  margin: 0 0 4px;\n  padding: 0 8px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.dshc_taskOwnerGroup + .dshc_taskOwnerGroup {\n  margin-top: 4px;\n}\n\n.dshc_taskOwnerName {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 0 8px;\n  font-size: 12px;\n}\n\n.dshc_taskList {\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n\n.dshc_taskRow {\n  border-radius: var(--dsw-radius-sm);\n  padding: 6px 8px;\n}\n\n.dshc_taskRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_taskLine {\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n  display: flex;\n}\n\n.dshc_taskTitle {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 13px;\n  overflow: hidden;\n}\n\n.dshc_taskMeta {\n  color: var(--dsw-alias-label-tertiary);\n  flex-wrap: wrap;\n  gap: 0 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_taskLinks {\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_taskEmpty {\n  color: var(--dsw-alias-label-tertiary);\n  margin: 0 8px;\n  font-size: 12px;\n}\n\n.dshc_taskDone summary {\n  cursor: pointer;\n}\n\n.dshc_taskStatus {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  flex: none;\n  padding: 0 4px;\n  font-size: 10px;\n  font-style: normal;\n  font-weight: 600;\n}\n\n.dshc_taskStatus[data-status=\"asked\"], .dshc_taskStatus[data-status=\"escalated\"], .dshc_taskStatus[data-status=\"declined\"], .dshc_taskStatus[data-status=\"rework\"] {\n  background: var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-error-primary));\n}\n\n.dshc_taskStatus[data-status=\"failed\"] {\n  background: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_taskStatus[data-status=\"done\"], .dshc_taskStatus[data-status=\"cancelled\"], .dshc_taskStatus[data-status=\"superseded\"] {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.dshc_taskCard {\n  margin-top: 4px;\n  font-style: normal;\n}\n\n.dshc_taskMembers {\n  margin: 4px 0 0;\n  padding: 0;\n  list-style: none;\n}\n\n.dshc_taskMember {\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n  display: flex;\n}\n\n.dshc_taskMemberName {\n  font-weight: 600;\n}\n\n.dshc_taskSub {\n  color: var(--dsw-alias-label-secondary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.dshc_focused {\n  background: var(--dsw-alias-interactive-bg-hover);\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n}\n\n.dshc_attachments {\n  flex-wrap: wrap;\n  gap: 6px;\n  margin: 4px 0;\n  display: flex;\n}\n\n.dshc_attachmentImage {\n  border-radius: 4px;\n  max-width: min(320px, 100%);\n  max-height: 240px;\n  display: block;\n}\n\n.dshc_imageAttachment {\n  align-content: start;\n  max-width: 100%;\n  display: grid;\n}\n\n.dshc_imagePreviewTrigger {\n  cursor: zoom-in;\n  background: none;\n  border: 0;\n  border-radius: 4px;\n  grid-area: 1 / 1;\n  padding: 0;\n}\n\n.dshc_imagePreviewTrigger:focus-visible {\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n  outline-offset: 2px;\n}\n\n.dshc_imagePreviewDialog {\n  box-sizing: border-box;\n  width: fit-content;\n  max-width: 90vw;\n  max-height: 90dvh;\n  overflow: auto;\n}\n\n.dshc_imagePreviewHeader {\n  flex-shrink: 0;\n  justify-content: space-between;\n  align-items: center;\n  gap: 12px;\n  display: flex;\n}\n\n.dshc_imagePreviewHeader span {\n  overflow-wrap: anywhere;\n  min-width: 0;\n}\n\n.dshc_imagePreviewHeader button {\n  flex-shrink: 0;\n}\n\n.dshc_imagePreviewImage {\n  object-fit: contain;\n  align-self: center;\n  max-width: 100%;\n  min-height: 0;\n  max-height: 65dvh;\n  display: block;\n}\n\n.dshc_imagePreviewActions {\n  flex-wrap: wrap;\n  flex-shrink: 0;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_imagePreviewActions a {\n  text-decoration: none;\n}\n\n.dshc_imagePreviewActions button:disabled {\n  cursor: wait;\n  opacity: .5;\n}\n\n.dshc_attachmentActions {\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-base);\n  opacity: 0;\n  pointer-events: none;\n  flex-wrap: wrap;\n  grid-area: 1 / 1;\n  place-self: start end;\n  gap: 4px;\n  margin: 4px;\n  padding: 4px;\n  display: flex;\n}\n\n.dshc_attachmentActions a {\n  text-decoration: none;\n}\n\n.dshc_attachmentActions button:disabled {\n  cursor: wait;\n  opacity: .5;\n}\n\n.dshc_imageAttachment:hover .dshc_attachmentActions, .dshc_imageAttachment:focus-within .dshc_attachmentActions, .dshc_imageAttachment[data-copy-state=\"error\"] .dshc_attachmentActions, .dshc_imageAttachment[data-copy-state=\"copying\"] .dshc_attachmentActions, .dshc_imageAttachment[data-copy-state=\"copied\"] .dshc_attachmentActions {\n  opacity: 1;\n  pointer-events: auto;\n}\n\n@media (hover: none), (pointer: coarse), (width <= 768px) {\n  .dshc_attachmentActions {\n    opacity: 1;\n    pointer-events: auto;\n  }\n}\n\n.dshc_attachmentThumb {\n  object-fit: cover;\n  vertical-align: middle;\n  border-radius: 3px;\n  width: 32px;\n  height: 32px;\n}\n\n.dshc_attachmentFile {\n  background: var(--background-secondary, #7f7f7f26);\n  color: inherit;\n  border-radius: 4px;\n  align-items: center;\n  gap: 4px;\n  padding: 4px 8px;\n  text-decoration: none;\n  display: inline-flex;\n}\n\n.dshc_attachmentSize {\n  opacity: .6;\n  font-size: .85em;\n}\n\n.dshc_attachmentAudio {\n  flex-direction: column;\n  gap: 2px;\n  width: min(320px, 100%);\n  display: flex;\n}\n\n.dshc_attachmentAudio audio {\n  width: 100%;\n}\n\n.dshc_attachmentAudio a {\n  color: inherit;\n  text-decoration: none;\n}\n\n.dshc_attachmentFile {\n  overflow-wrap: anywhere;\n  max-width: 100%;\n}\n\n.dshc_uploadBar {\n  background: var(--dsw-alias-border-l2);\n  border-radius: 2px;\n  flex: 80px;\n  min-width: 60px;\n  height: 4px;\n  overflow: hidden;\n}\n\n.dshc_uploadFill {\n  background: var(--dsw-alias-state-business-primary);\n  height: 100%;\n  transition: width .12s linear;\n  display: block;\n}\n\n.dshc_uploadState {\n  opacity: .7;\n  white-space: nowrap;\n  font-size: .85em;\n}\n\n.dshc_attachmentFile[data-state=\"failed\"] {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_attachmentFile[data-state=\"failed\"] .dshc_uploadState {\n  opacity: 1;\n}\n\n.dshc_chatHead button, .dshc_chatHead input, .dshc_chatHead select, .dshc_chatHead a, .dshc_chatHead [role=\"menu\"] {\n  -webkit-app-region: no-drag;\n}\n\n.dshc_text pre, .dshc_text table {\n  max-width: 100%;\n  overflow-x: auto;\n}\n\n@media (width >= 901px) {\n  .dshc_page {\n    grid-template-columns: 232px minmax(0, 1fr) 272px;\n  }\n\n  .dshc_page.dshc_roomsHidden {\n    grid-template-columns: minmax(0, 1fr) 272px;\n  }\n\n  .dshc_page.dshc_membersHidden {\n    grid-template-columns: 232px minmax(0, 1fr);\n  }\n\n  .dshc_page.dshc_roomsHidden.dshc_membersHidden {\n    grid-template-columns: minmax(0, 1fr);\n  }\n}\n\n.dshc_rooms {\n  padding-top: 4px;\n}\n\n.dshc_room {\n  border-radius: var(--dsw-radius-md);\n  min-height: 34px;\n  padding: 6px 10px;\n  transition: background-color .15s, color .15s;\n}\n\n.dshc_workspace {\n  min-height: 30px;\n  padding-left: 28px;\n  font-size: 13px;\n  position: relative;\n}\n\n.dshc_workspace:before {\n  content: \"\";\n  border-left: 1px solid var(--dsw-alias-border-l2);\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  border-bottom-left-radius: 4px;\n  width: 7px;\n  position: absolute;\n  top: 0;\n  bottom: 50%;\n  left: 15px;\n}\n\n.dshc_workspace .dshc_hash {\n  display: none;\n}\n\n.dshc_roomActive {\n  color: var(--dsw-alias-label-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);\n  box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary);\n  font-weight: 600;\n}\n\n.dshc_activeCount {\n  font-variant-numeric: tabular-nums;\n  border-radius: 999px;\n  margin-left: 0;\n  padding: 0 6px;\n  font-size: 11px;\n  line-height: 18px;\n}\n\n.dshc_activeBusy {\n  color: var(--dsw-alias-state-business-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);\n}\n\n.dshc_roomLabel {\n  flex: auto;\n  min-width: 0;\n}\n\n.dshc_avatarStack {\n  flex: none;\n  align-items: center;\n  padding-left: 4px;\n  display: inline-flex;\n}\n\n.dshc_stackDot {\n  border: 2px solid var(--dsw-alias-bg-layer-2);\n  background-position: center;\n  background-size: cover;\n  border-radius: 50%;\n  width: 18px;\n  height: 18px;\n  margin-left: -6px;\n}\n\n.dshc_room .dshc_stackDot {\n  width: 16px;\n  height: 16px;\n}\n\n.dshc_roomActive .dshc_stackDot {\n  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, var(--dsw-alias-bg-layer-2));\n}\n\n.dshc_chatHead {\n  gap: 8px;\n  height: 52px;\n}\n\n.dshc_roomName {\n  letter-spacing: -.01em;\n  white-space: nowrap;\n  font-size: 15px;\n}\n\n.dshc_headMeta {\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n  font-weight: 400;\n  overflow: hidden;\n}\n\n.dshc_headActivity {\n  color: var(--dsw-alias-label-secondary);\n  flex: none;\n  align-items: center;\n  gap: 6px;\n  margin-left: auto;\n  font-size: 12px;\n  font-weight: 500;\n  display: inline-flex;\n}\n\n.dshc_headActivity .dshc_stackDot {\n  border-color: var(--dsw-alias-bg-base);\n  width: 22px;\n  height: 22px;\n}\n\n.dshc_headActivity + .dshc_panelToggleEnd {\n  margin-left: 4px;\n}\n\n.dshc_chatHead > .dshc_roomName {\n  text-overflow: ellipsis;\n  min-width: 0;\n  overflow: hidden;\n}\n\n.dshc_chatHead > .dshc_taskBoardTrigger {\n  width: auto;\n  margin: 0 0 0 auto;\n}\n\n.dshc_chatHead .dshc_taskBoardSummary {\n  display: none;\n}\n\n.dshc_headLead {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-2);\n  border-radius: 999px;\n  flex: 0 auto;\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n  padding: 4px 8px;\n  font-size: 12px;\n  display: inline-flex;\n}\n\n.dshc_headLeadText {\n  flex-direction: column;\n  min-width: 0;\n  display: flex;\n}\n\n.dshc_headLeadName {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.dshc_headLeadStatus {\n  color: var(--dsw-alias-label-secondary);\n  white-space: nowrap;\n  font-size: 11px;\n  font-weight: 400;\n}\n\n.dshc_headLead + .dshc_panelToggleEnd {\n  margin-left: 0;\n}\n\n.dshc_membersHead {\n  align-items: center;\n  height: 52px;\n  padding: 0 4px;\n  display: flex;\n}\n\n.dshc_membersHeadTitle {\n  color: var(--dsw-alias-label-tertiary);\n  letter-spacing: .08em;\n  font-size: 11px;\n  font-weight: 650;\n}\n\n.dshc_log {\n  padding: 12px 0 16px;\n}\n\n.dshc_message {\n  grid-template-columns: 36px minmax(0, 1fr);\n  gap: 12px;\n  padding: 8px 20px 2px;\n  transition: background-color .15s;\n}\n\n.dshc_message.dshc_grouped {\n  padding-top: 1px;\n}\n\n.dshc_message:hover {\n  background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 70%, transparent);\n}\n\n.dshc_messageHead {\n  gap: 8px;\n  margin-bottom: 2px;\n}\n\n.dshc_messageHeadGrouped {\n  margin-bottom: 0;\n}\n\n.dshc_messageHeadGrouped:not(:has(*)) {\n  display: none;\n}\n\n.dshc_author {\n  font-size: 13px;\n}\n\n.dshc_time, .dshc_edited {\n  font-variant-numeric: tabular-nums;\n  font-size: 11px;\n}\n\n.dshc_gutterTime {\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n  text-align: right;\n  opacity: 0;\n  align-self: start;\n  padding-top: 3px;\n  font-size: 10px;\n  transition: opacity .15s;\n}\n\n.dshc_message:hover .dshc_gutterTime {\n  opacity: 1;\n}\n\n.dshc_text {\n  line-height: 1.6;\n}\n\n.dshc_own {\n  grid-template-columns: minmax(0, 1fr) 36px;\n}\n\n.dshc_own > :first-child {\n  grid-area: 1 / 2;\n}\n\n.dshc_own > .dshc_messageBody {\n  flex-direction: column;\n  grid-area: 1 / 1;\n  align-items: flex-end;\n  display: flex;\n}\n\n.dshc_own .dshc_messageHead {\n  flex-direction: row-reverse;\n}\n\n.dshc_own .dshc_ownActions {\n  margin-left: 0;\n  margin-right: auto;\n}\n\n.dshc_own > .dshc_messageBody > .dshc_bubbleLine > .dshc_text {\n  box-sizing: border-box;\n  max-width: 100%;\n  color: var(--dsw-alias-label-primary);\n  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, var(--dsw-alias-bg-layer-2));\n  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-business-primary) 28%, transparent);\n  border-radius: 16px 6px 16px 16px;\n  padding: 8px 14px;\n}\n\n.dshc_own > .dshc_messageBody > .dshc_quote {\n  align-self: flex-end;\n}\n\n.dshc_own .dshc_msgTools {\n  left: 16px;\n  right: auto;\n}\n\n.dshc_own.dshc_grouped > .dshc_messageBody > .dshc_bubbleLine > .dshc_text {\n  border-radius: 16px 6px 6px 16px;\n}\n\n.dshc_systemRecord {\n  flex-direction: column;\n  align-items: center;\n  padding-bottom: 4px;\n  display: flex;\n}\n\n.dshc_systemRecord > .dshc_systemLine {\n  align-self: stretch;\n}\n\n.dshc_taskRecord {\n  box-sizing: border-box;\n  width: min(480px, 100% - 40px);\n  margin-top: 0;\n}\n\n.dshc_systemLine {\n  color: var(--dsw-alias-label-tertiary);\n  align-items: center;\n  gap: 12px;\n  padding: 10px 32px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_systemLine:before, .dshc_systemLine:after {\n  content: \"\";\n  background: var(--dsw-alias-border-l2);\n  flex: 24px;\n  min-width: 24px;\n  height: 1px;\n}\n\n.dshc_systemText {\n  text-align: center;\n  max-width: min(640px, 80%);\n}\n\n.dshc_systemText p {\n  margin: 0;\n}\n\n.dshc_errorBar {\n  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent);\n  border-radius: 12px;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px 10px;\n  margin: 6px 20px 6px 68px;\n  padding: 8px 12px;\n  font-size: 13px;\n  display: flex;\n}\n\n.dshc_errorBar .dshc_cardButtons {\n  margin: 0 0 0 auto;\n}\n\n.dshc_errorBar .dshc_secondaryButton {\n  padding: 3px 10px;\n  font-size: 12px;\n}\n\n.dshc_errorBar[data-state=\"retried\"] {\n  opacity: .65;\n}\n\n.dshc_errorBar .dshc_cardDetail {\n  flex-basis: 100%;\n  order: 3;\n  margin: 0 0 0 28px;\n}\n\n.dshc_errorIcon {\n  color: #fff;\n  background: var(--dsw-alias-state-error-primary);\n  border-radius: 50%;\n  flex: none;\n  place-items: center;\n  width: 18px;\n  height: 18px;\n  font-size: 12px;\n  font-weight: 700;\n  display: grid;\n}\n\n.dshc_errorText {\n  min-width: 0;\n  color: var(--dsw-alias-label-primary);\n  flex: 200px;\n}\n\n.dshc_errorText p {\n  margin: 0;\n}\n\n.dshc_runStrip {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-layer-2));\n  border-radius: 12px;\n  flex-direction: column;\n  max-width: 100%;\n  margin-top: 4px;\n  padding: 5px 10px;\n  font-size: 12px;\n  display: inline-flex;\n}\n\n.dshc_runStrip[data-state=\"running\"] {\n  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-border-l2));\n}\n\n.dshc_runStrip[data-state=\"failed\"] {\n  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2));\n}\n\n.dshc_runHead {\n  min-width: 0;\n  color: var(--dsw-alias-label-secondary);\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_runTitle {\n  color: var(--dsw-alias-label-primary);\n  flex: none;\n  font-weight: 600;\n}\n\n.dshc_runSummary {\n  font-variant-numeric: tabular-nums;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.dshc_runHead .dshc_cardViews {\n  margin-left: 8px;\n}\n\n.dshc_runHead .dshc_cardViewButton {\n  color: var(--dsw-alias-label-tertiary);\n  border-radius: 999px;\n  font-size: 11px;\n}\n\n.dshc_runHead .dshc_cardViewButton[aria-pressed=\"true\"] {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshc_runIcon {\n  border-radius: 50%;\n  flex: none;\n  width: 12px;\n  height: 12px;\n  position: relative;\n}\n\n.dshc_runStrip[data-state=\"running\"] .dshc_runIcon {\n  border: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent);\n  border-top-color: var(--dsw-alias-state-business-primary);\n  animation: .8s linear infinite dshc_channels-spin;\n}\n\n.dshc_runStrip[data-state=\"completed\"] .dshc_runIcon {\n  background: #23a55a;\n}\n\n.dshc_runStrip[data-state=\"completed\"] .dshc_runIcon:after {\n  content: \"\";\n  border: 1.5px solid #fff;\n  border-width: 0 1.5px 1.5px 0;\n  width: 3px;\n  height: 6px;\n  position: absolute;\n  top: 2px;\n  left: 4px;\n  transform: rotate(45deg);\n}\n\n.dshc_runStrip[data-state=\"failed\"] .dshc_runIcon {\n  background: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_runSteps {\n  color: var(--dsw-alias-label-secondary);\n  margin-top: 4px;\n  font-size: 12px;\n  line-height: 1.55;\n}\n\n.dshc_runSteps p {\n  margin: 0;\n}\n\n.dshc_runStrip .dshc_cardButtons {\n  margin-top: 6px;\n}\n\n@keyframes dshc_channels-spin {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_runStrip[data-state=\"running\"] .dshc_runIcon {\n    animation-duration: 2.4s;\n  }\n}\n\n.dshc_card {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-2);\n  border-left-width: 1px;\n  border-radius: 14px;\n  margin-top: 6px;\n  padding: 10px 12px;\n}\n\n.dshc_card[data-state=\"failed\"] {\n  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, var(--dsw-alias-border-l2));\n}\n\n.dshc_taskAnchor {\n  max-width: 560px;\n  box-shadow: inset 3px 0 0 var(--channels-accent-warm, #d08a2e);\n}\n\n.dshc_permInline {\n  color: var(--dsw-alias-label-secondary);\n  flex-wrap: wrap;\n  align-items: baseline;\n  gap: 4px 8px;\n  display: flex;\n}\n\n.dshc_permInline .dshc_text {\n  flex: 0 auto;\n  min-width: 0;\n}\n\n.dshc_permInline .dshc_text p {\n  margin: 0;\n}\n\n.dshc_permLock {\n  color: var(--dsw-alias-state-warning-primary, #e9a23b);\n  flex: none;\n  font-size: 9px;\n}\n\n.dshc_permWaiting {\n  color: var(--dsw-alias-state-warning-primary, #e9a23b);\n  flex: none;\n  font-size: 11px;\n  font-weight: 600;\n}\n\n.dshc_permTray {\n  flex-direction: column;\n  gap: 6px;\n  max-height: 40%;\n  margin: 0 16px 8px;\n  display: flex;\n  overflow-y: auto;\n}\n\n.dshc_permTrayItem {\n  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 55%, var(--dsw-alias-border-l2));\n  background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 7%, var(--dsw-alias-bg-layer-2));\n  border-radius: 14px;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px 12px;\n  padding: 10px 12px;\n  display: flex;\n  box-shadow: 0 6px 20px -12px #00000059;\n}\n\n.dshc_permTrayText {\n  flex: 240px;\n  min-width: 0;\n  font-size: 13px;\n}\n\n.dshc_permTrayText .dshc_text p {\n  margin: 0;\n}\n\n.dshc_permTrayWho {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.dshc_permTrayItem .dshc_permActions {\n  flex-wrap: nowrap;\n  margin: 0;\n}\n\n.dshc_permTrayItem .dshc_permScope {\n  display: none;\n}\n\n.dshc_members {\n  flex-direction: column;\n  padding: 0 10px 16px;\n}\n\n@media (width >= 901px) {\n  .dshc_members {\n    display: flex;\n  }\n\n  .dshc_membersHidden > .dshc_members {\n    display: none;\n  }\n}\n\n.dshc_members.dshc_drawerOpen {\n  display: flex;\n}\n\n.dshc_activityNow {\n  flex-direction: column;\n  gap: 2px;\n  margin-bottom: 6px;\n  display: flex;\n}\n\n.dshc_activityItem {\n  border: 1px solid var(--dsw-alias-border-l2);\n  width: 100%;\n  color: inherit;\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  border-radius: 12px;\n  align-items: center;\n  gap: 10px;\n  padding: 8px 10px;\n  display: flex;\n}\n\n.dshc_activityItem + .dshc_activityItem {\n  margin-top: 4px;\n}\n\n.dshc_activityItem:hover {\n  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 40%, var(--dsw-alias-border-l2));\n}\n\n.dshc_activityItem:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_activityText {\n  flex-direction: column;\n  flex: 1;\n  min-width: 0;\n  display: flex;\n}\n\n.dshc_activityName {\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.dshc_activityWhat {\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n  overflow: hidden;\n}\n\n.dshc_activityPulse {\n  background: var(--dsw-alias-state-business-primary);\n  border-radius: 50%;\n  flex: none;\n  width: 8px;\n  height: 8px;\n  animation: 1.6s ease-in-out infinite dshc_channels-pulse;\n}\n\n@keyframes dshc_channels-pulse {\n  50% {\n    box-shadow: 0 0 0 3px #23a55a40;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_activityPulse {\n    animation: none;\n  }\n}\n\n.dshc_member {\n  padding: 6px 8px;\n}\n\n.dshc_memberText {\n  flex: 1;\n}\n\n.dshc_memberStatus {\n  flex: none;\n  margin-left: auto;\n  font-size: 11px;\n}\n\n.dshc_memberStatus[data-status=\"busy\"] {\n  color: var(--dsw-alias-state-business-primary);\n  font-weight: 600;\n}\n\n.dshc_memberStatus[data-status=\"error\"] {\n  color: var(--dsw-alias-state-error-primary);\n  font-weight: 600;\n}\n\n.dshc_memberActions {\n  background: var(--dsw-alias-bg-layer-2);\n  padding-left: 8px;\n  position: absolute;\n  top: 50%;\n  right: 8px;\n  transform: translateY(-50%);\n}\n\n.dshc_addMemberButton {\n  border-radius: 10px;\n}\n\n@media (width <= 900px) {\n  .dshc_headMeta, .dshc_headActivityText {\n    display: none;\n  }\n\n  .dshc_chatHead {\n    padding: 0 8px;\n  }\n\n  .dshc_mobileButton {\n    white-space: nowrap;\n  }\n\n  .dshc_headActivity ~ .dshc_mobileButton:last-child {\n    margin-left: 4px;\n  }\n\n  .dshc_message {\n    padding-left: 12px;\n    padding-right: 12px;\n  }\n\n  .dshc_errorBar {\n    margin-left: 12px;\n    margin-right: 12px;\n  }\n\n  .dshc_permTray {\n    margin: 0 8px 8px;\n  }\n\n  .dshc_permTrayItem .dshc_permActions {\n    flex-wrap: wrap;\n  }\n\n  .dshc_systemLine {\n    padding: 8px 12px;\n  }\n\n  .dshc_systemText {\n    max-width: 90%;\n  }\n\n  .dshc_memberActions {\n    background: none;\n    padding-left: 0;\n    position: static;\n    transform: none;\n  }\n}\n\n@keyframes dshc_channelsEnter {\n  from {\n    opacity: 0;\n    transform: translateY(6px);\n  }\n\n  to {\n    opacity: 1;\n    transform: none;\n  }\n}\n\n@keyframes dshc_channelsEnterOwn {\n  from {\n    opacity: 0;\n    transform: translateY(12px) scale(.985);\n  }\n\n  to {\n    opacity: 1;\n    transform: none;\n  }\n}\n\n@keyframes dshc_channelsGlow {\n  from {\n    opacity: 1;\n  }\n\n  to {\n    opacity: 0;\n  }\n}\n\n@keyframes dshc_channelsPop {\n  from {\n    opacity: 0;\n    transform: translateY(4px) scale(.98);\n  }\n\n  to {\n    opacity: 1;\n    transform: none;\n  }\n}\n\n@keyframes dshc_channelsDot {\n  0%, 60%, 100% {\n    opacity: .35;\n    transform: none;\n  }\n\n  30% {\n    opacity: 1;\n    transform: translateY(-2px);\n  }\n}\n\n@keyframes dshc_channelsDrain {\n  from {\n    transform: scaleX(1);\n  }\n\n  to {\n    transform: scaleX(0);\n  }\n}\n\n.dshc_enter {\n  animation: .18s cubic-bezier(.2, 0, 0, 1) both dshc_channelsEnter;\n}\n\n.dshc_enterOwn {\n  animation: .22s cubic-bezier(.22, 1, .36, 1) both dshc_channelsEnterOwn;\n}\n\n.dshc_enterGlow:before {\n  content: \"\";\n  pointer-events: none;\n  background: linear-gradient(90deg, color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent), transparent 70%);\n  animation: .7s cubic-bezier(.4, 0, .2, 1) both dshc_channelsGlow;\n  animation-delay: inherit;\n  position: absolute;\n  inset: 0;\n}\n\n.dshc_message {\n  transition: background-color .16s cubic-bezier(.2, 0, 0, 1);\n}\n\n.dshc_room {\n  transition: background-color .16s cubic-bezier(.2, 0, 0, 1), color .16s cubic-bezier(.2, 0, 0, 1);\n}\n\n.dshc_card {\n  transition: border-color .32s cubic-bezier(.2, 0, 0, 1), background-color .32s cubic-bezier(.2, 0, 0, 1);\n}\n\n.dshc_sendButton, .dshc_primaryButton, .dshc_secondaryButton, .dshc_mentionButton, .dshc_cardViewButton {\n  transition: background-color .16s cubic-bezier(.2, 0, 0, 1), opacity .16s cubic-bezier(.2, 0, 0, 1), transform .12s cubic-bezier(.2, 0, 0, 1);\n}\n\n.dshc_sendButton:not(:disabled):active, .dshc_primaryButton:not(:disabled):active, .dshc_secondaryButton:not(:disabled):active, .dshc_mentionButton:not(:disabled):active, .dshc_cardViewButton:active {\n  transform: translateY(1px);\n}\n\n.dshc_mentionPopup {\n  transform-origin: bottom;\n  animation: .16s cubic-bezier(.22, 1, .36, 1) both dshc_channelsPop;\n}\n\n.dshc_typingDots {\n  vertical-align: middle;\n  gap: 3px;\n  margin-right: 6px;\n  display: inline-flex;\n}\n\n.dshc_typingDots i {\n  background: currentColor;\n  border-radius: 50%;\n  width: 4px;\n  height: 4px;\n  animation: 1.2s ease-in-out infinite dshc_channelsDot;\n}\n\n.dshc_typingDots i:nth-child(2) {\n  animation-delay: .15s;\n}\n\n.dshc_typingDots i:nth-child(3) {\n  animation-delay: .3s;\n}\n\n.dshc_logWrap {\n  flex-direction: column;\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  position: relative;\n}\n\n.dshc_olderLoading {\n  color: var(--dsw-alias-label-tertiary);\n  text-align: center;\n  padding: 8px 16px;\n  font-size: 12px;\n}\n\n.dshc_unreadDivider {\n  color: var(--dsw-alias-state-error-primary);\n  align-items: center;\n  gap: 8px;\n  margin: 8px 16px;\n  font-size: 12px;\n  font-weight: 600;\n  display: flex;\n}\n\n.dshc_unreadDivider:before, .dshc_unreadDivider:after {\n  content: \"\";\n  opacity: .35;\n  background: currentColor;\n  flex: 1;\n  height: 1px;\n}\n\n.dshc_withdrawnRow {\n  text-align: right;\n  color: var(--dsw-alias-label-tertiary);\n  padding: 6px 16px;\n  font-size: 13px;\n  font-style: italic;\n  animation: .18s cubic-bezier(.2, 0, 0, 1) both dshc_channelsEnter;\n}\n\n.dshc_jumpLatest {\n  z-index: 3;\n  border: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #00000029);\n  font: inherit;\n  cursor: pointer;\n  border-radius: 999px;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 14px;\n  font-size: 12px;\n  animation: .22s cubic-bezier(.22, 1, .36, 1) both dshc_channelsPop;\n  display: inline-flex;\n  position: absolute;\n  bottom: 12px;\n  left: 50%;\n  transform: translateX(-50%);\n}\n\n.dshc_jumpLatest:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_jumpLatest:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_jumpCount {\n  color: var(--dsw-alias-state-business-primary);\n  font-weight: 600;\n}\n\n.dshc_undoToast {\n  z-index: 4;\n  border-radius: var(--dsw-radius-md);\n  width: max-content;\n  max-width: calc(100% - 32px);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-label-primary);\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  align-items: center;\n  gap: 12px;\n  margin: 0 auto;\n  padding: 8px 8px 8px 14px;\n  font-size: 13px;\n  animation: .22s cubic-bezier(.22, 1, .36, 1) both dshc_channelsPop;\n  display: flex;\n  position: absolute;\n  bottom: 12px;\n  left: 0;\n  right: 0;\n  overflow: hidden;\n}\n\n.dshc_undoButton {\n  border-radius: var(--dsw-radius-sm);\n  color: inherit;\n  background: color-mix(in srgb, currentColor 16%, transparent);\n  font: inherit;\n  cursor: pointer;\n  border: 0;\n  padding: 2px 10px;\n  font-weight: 600;\n}\n\n.dshc_undoButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_undoBar {\n  background: var(--dsw-alias-state-business-primary);\n  transform-origin: 0;\n  height: 2px;\n  animation: linear forwards dshc_channelsDrain;\n  position: absolute;\n  bottom: 0;\n  left: 0;\n  right: 0;\n}\n\n.dshc_undoToast ~ .dshc_jumpLatest {\n  display: none;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_enter, .dshc_enterOwn, .dshc_enterGlow:before, .dshc_mentionPopup, .dshc_jumpLatest, .dshc_undoToast, .dshc_withdrawnRow {\n    animation: none;\n  }\n\n  .dshc_typingDots i {\n    opacity: .6;\n    animation: none;\n  }\n\n  .dshc_undoBar {\n    animation: none;\n  }\n\n  .dshc_message, .dshc_room, .dshc_card, .dshc_sendButton, .dshc_primaryButton, .dshc_secondaryButton, .dshc_mentionButton, .dshc_mentionBadge, .dshc_cardViewButton {\n    transition: none;\n  }\n}\n\n.dshc_leadCard {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-2);\n  border-radius: 14px;\n  align-items: center;\n  gap: 10px;\n  margin: 8px 8px 4px;\n  display: flex;\n}\n\n.dshc_leadCardButton {\n  border-radius: inherit;\n  min-width: 0;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: auto;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 12px;\n  display: flex;\n}\n\n.dshc_leadCardButton:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_leadCardButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-alias-border-focus, currentColor);\n  outline-offset: -2px;\n}\n\n.dshc_leadCardButton:disabled {\n  cursor: default;\n  background: none;\n}\n\n.dshc_leadCardText {\n  flex-direction: column;\n  min-width: 0;\n  display: flex;\n}\n\n.dshc_leadCardName {\n  color: var(--dsw-alias-label-primary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 14px;\n  font-weight: 650;\n  overflow: hidden;\n}\n\n.dshc_leadCardStatus {\n  color: var(--dsw-alias-label-secondary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n  overflow: hidden;\n}\n\n.dshc_message:not(.dshc_own) > .dshc_messageBody > .dshc_bubbleLine > .dshc_text {\n  box-sizing: border-box;\n  background: var(--dsw-alias-bg-layer-2);\n  border-radius: 6px 16px 16px;\n  width: fit-content;\n  max-width: 100%;\n  padding: 8px 14px;\n}\n\n.dshc_message.dshc_grouped:not(.dshc_own) > .dshc_messageBody > .dshc_bubbleLine > .dshc_text {\n  border-radius: 6px 16px 16px 6px;\n}\n\n.dshc_own > .dshc_messageBody > .dshc_bubbleLine > .dshc_text {\n  color: var(--dsw-alias-bg-base);\n  background: var(--dsw-alias-label-primary);\n  box-shadow: none;\n}\n\n.dshc_own > .dshc_messageBody > .dshc_bubbleLine > .dshc_text * {\n  color: inherit;\n}\n\n.dshc_own > .dshc_messageBody > .dshc_bubbleLine > .dshc_text a {\n  color: inherit;\n  text-decoration: underline;\n}\n\n.dshc_own > .dshc_messageBody > .dshc_bubbleLine > .dshc_text code {\n  color: inherit;\n  background: color-mix(in srgb, var(--dsw-alias-bg-base) 18%, transparent);\n}\n\n.dshc_own > .dshc_messageBody > .dshc_bubbleLine > .dshc_text .dshc_mentionBadge {\n  color: var(--dsw-alias-bg-base);\n  background: color-mix(in srgb, var(--dsw-alias-bg-base) 24%, transparent);\n}\n\n.dshc_own > .dshc_messageBody > .dshc_bubbleLine > .dshc_text .dshc_mentionBadge:hover {\n  background: color-mix(in srgb, var(--dsw-alias-bg-base) 36%, transparent);\n}\n\n.dshc_boardDrawerBackdrop {\n  background: #00000040;\n  place-items: stretch end;\n  padding: 0;\n}\n\n.dshc_boardDrawerBackdrop > .dshc_taskBoardDialog {\n  box-sizing: border-box;\n  border-radius: 0;\n  width: min(440px, 100%);\n  height: 100dvh;\n  max-height: none;\n  animation: .2s ease-out dshc_boardDrawerIn;\n}\n\n@keyframes dshc_boardDrawerIn {\n  from {\n    opacity: 0;\n    transform: translateX(24px);\n  }\n\n  to {\n    opacity: 1;\n    transform: none;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_boardDrawerBackdrop > .dshc_taskBoardDialog {\n    animation: none;\n  }\n}\n\n.dshc_schemeToggle {\n  border-radius: var(--dsw-radius-sm);\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  margin-left: 4px;\n  font-size: 16px;\n  line-height: 1;\n  display: inline-flex;\n}\n\n.dshc_schemeToggle:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_schemeToggle:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_schemeToggle + .dshc_panelToggleEnd {\n  margin-left: 4px;\n}\n\n.dshc_progressCard {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-base);\n  box-shadow: 0 6px 18px #0000000a, 0 -12px 0 0 var(--dsw-alias-bg-base);\n  border-radius: 14px;\n  flex: none;\n  margin: 8px 16px 4px;\n  padding: 8px 14px;\n  font-size: 12px;\n  position: relative;\n}\n\n.dshc_progressHead {\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.dshc_progressTitle {\n  color: var(--dsw-alias-label-primary);\n  font-size: 12px;\n}\n\n.dshc_progressSummary {\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  flex: 1;\n  overflow: hidden;\n}\n\n.dshc_progressToggle {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  min-width: 22px;\n  height: 24px;\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  gap: 4px;\n  margin-left: auto;\n  padding: 0 10px;\n  font-size: 12px;\n  font-weight: 500;\n  line-height: 1;\n  display: inline-flex;\n}\n\n.dshc_progressChevron {\n  font-size: 12px;\n}\n\n.dshc_progressToggle:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_progressToggle:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_progressCard[data-folded=\"true\"] {\n  padding: 6px 12px;\n}\n\n.dshc_progressRows {\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 0 14px;\n  margin: 4px 0 0;\n  display: grid;\n}\n\n.dshc_progressRow {\n  min-width: 0;\n}\n\n.dshc_progressRow dt {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 10px;\n}\n\n.dshc_progressRow dd {\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  min-width: 0;\n  color: var(--dsw-alias-label-primary);\n  margin: 0;\n  overflow: hidden;\n}\n\n.dshc_progressRow[data-empty=\"true\"] dd {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshc_progressRow[data-row=\"open\"][data-empty=\"false\"] dd, .dshc_progressRow[data-row=\"open\"] .dshc_progressLink {\n  color: var(--dsw-alias-state-warning-primary, #b7791f);\n}\n\n.dshc_progressLink {\n  max-width: 100%;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 0;\n  overflow: hidden;\n}\n\n.dshc_progressLink:hover {\n  text-decoration: underline;\n}\n\n@media (width <= 760px) {\n  .dshc_progressCard {\n    margin: 6px 10px 2px;\n  }\n\n  .dshc_progressRows {\n    grid-template-columns: 52px minmax(0, 1fr);\n  }\n\n  .dshc_progressRow {\n    display: contents;\n  }\n}\n\n.dshc_stepChips {\n  flex-wrap: wrap;\n  gap: 6px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.dshc_stepChip {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-base);\n  max-width: 220px;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  border-radius: 999px;\n  align-items: center;\n  gap: 5px;\n  padding: 2px 9px 2px 7px;\n  font-size: 11px;\n  display: inline-flex;\n}\n\n.dshc_stepChip b {\n  color: var(--dsw-alias-label-primary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-weight: 600;\n  overflow: hidden;\n}\n\n.dshc_stepChip:disabled {\n  cursor: default;\n}\n\n.dshc_stepChip[aria-expanded=\"true\"] {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_stepChip[data-state=\"failed\"] {\n  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2));\n}\n\n.dshc_stepChip[data-state=\"failed\"] b {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_stepChip[data-state=\"running\"] {\n  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, var(--dsw-alias-border-l2));\n}\n\n.dshc_stepMark {\n  background: var(--dsw-alias-label-tertiary);\n  border-radius: 50%;\n  flex: none;\n  width: 7px;\n  height: 7px;\n}\n\n.dshc_stepChip[data-state=\"ok\"] .dshc_stepMark {\n  background: #23a55a;\n}\n\n.dshc_stepChip[data-state=\"failed\"] .dshc_stepMark {\n  background: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_stepChip[data-state=\"running\"] .dshc_stepMark {\n  background: var(--dsw-alias-state-business-primary);\n  animation: 1s ease-in-out infinite dshc_channels-blink;\n}\n\n@keyframes dshc_channels-blink {\n  50% {\n    opacity: .3;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_stepChip[data-state=\"running\"] .dshc_stepMark {\n    animation: none;\n  }\n}\n\n.dshc_stepOut {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base));\n  color: var(--dsw-alias-label-secondary);\n  border-radius: 8px;\n  flex-basis: 100%;\n  gap: 4px;\n  padding: 8px 10px;\n  font-size: 11px;\n  line-height: 1.5;\n  display: grid;\n}\n\n.dshc_stepOut[data-state=\"failed\"] {\n  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2));\n}\n\n.dshc_stepOut div {\n  gap: 8px;\n  min-width: 0;\n  display: flex;\n}\n\n.dshc_stepOut span {\n  color: var(--dsw-alias-label-tertiary);\n  flex: none;\n}\n\n.dshc_stepOut code {\n  overflow-wrap: anywhere;\n  min-width: 0;\n  font-family: ui-monospace, Menlo, monospace;\n}\n\n.dshc_stepOut[data-state=\"failed\"] > div[data-state=\"failed\"] > div:last-child > code {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_decideTray {\n  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 55%, var(--dsw-alias-border-l2));\n  background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 7%, var(--dsw-alias-bg-layer-2));\n  border-radius: 14px;\n  flex-direction: column;\n  max-height: 45%;\n  margin: 0 16px 8px;\n  display: flex;\n  overflow-y: auto;\n}\n\n.dshc_decideTrayHead {\n  width: 100%;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n  align-items: baseline;\n  gap: 8px;\n  padding: 7px 12px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_decideTrayHead strong {\n  color: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 70%, var(--dsw-alias-label-primary));\n}\n\n.dshc_decideTrayHead small {\n  color: var(--dsw-alias-label-secondary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.dshc_decideTrayHead:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n  outline-offset: -2px;\n}\n\n.dshc_decideTrayToggle {\n  color: var(--dsw-alias-label-secondary);\n  white-space: nowrap;\n  margin-left: auto;\n}\n\n.dshc_decideTray .dshc_permTray {\n  max-height: none;\n  margin: 0;\n  padding: 0 8px 8px;\n}\n\n.dshc_askList {\n  flex-direction: column;\n  display: flex;\n}\n\n.dshc_askItem {\n  border-top: 1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 30%, transparent);\n  background: var(--dsw-alias-bg-layer-2);\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px 10px;\n  padding: 8px 12px;\n  display: flex;\n}\n\n.dshc_askKind {\n  color: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 75%, var(--dsw-alias-label-primary));\n  background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 15%, transparent);\n  border-radius: 5px;\n  flex: none;\n  padding: 0 6px;\n  font-size: 11px;\n}\n\n.dshc_askText {\n  flex-direction: column;\n  flex: 200px;\n  min-width: 0;\n  font-size: 13px;\n  display: flex;\n}\n\n.dshc_askQuestion {\n  overflow-wrap: anywhere;\n}\n\n.dshc_askFrom {\n  color: var(--dsw-alias-label-secondary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  overflow: hidden;\n}\n\n.dshc_askForm {\n  flex: 0 260px;\n  align-items: center;\n  gap: 6px;\n  min-width: 160px;\n  display: flex;\n}\n\n.dshc_askInput {\n  border: 1px solid var(--dsw-alias-border-l2);\n  min-width: 0;\n  color: inherit;\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n  border-radius: 8px;\n  flex: 1;\n  padding: 4px 8px;\n  font-size: 12px;\n}\n\n.dshc_askInput:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.dshc_askSend {\n  width: 26px;\n  height: 26px;\n  color: var(--dsw-alias-bg-base);\n  background: var(--dsw-alias-label-primary);\n  cursor: pointer;\n  border: 0;\n  border-radius: 50%;\n  flex: none;\n  justify-content: center;\n  align-items: center;\n  padding: 0;\n  display: inline-flex;\n}\n\n.dshc_askSend:disabled {\n  opacity: .3;\n  cursor: default;\n}\n\n.dshc_askSend:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n  outline-offset: 2px;\n}\n\n.dshc_askDone {\n  color: var(--dsw-alias-label-secondary);\n  align-items: center;\n  gap: 8px;\n  font-size: 12px;\n  display: inline-flex;\n}\n\n.dshc_askNotice {\n  color: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #e9a23b) 75%, var(--dsw-alias-label-primary));\n  flex-basis: 100%;\n  font-size: 12px;\n}\n\n@media (width <= 900px) {\n  .dshc_decideTray {\n    margin: 0 8px 8px;\n  }\n\n  .dshc_askForm {\n    flex-basis: 100%;\n  }\n}\n\n.dshc_headTeam {\n  flex: none;\n  align-items: center;\n  margin-left: auto;\n  display: inline-flex;\n}\n\n.dshc_mate, .dshc_mateMore {\n  border: 2px solid var(--dsw-alias-bg-base);\n  background: var(--dsw-alias-bg-base);\n  cursor: pointer;\n  border-radius: 50%;\n  justify-content: center;\n  align-items: center;\n  margin-left: -6px;\n  padding: 0;\n  display: inline-flex;\n  position: relative;\n}\n\n.dshc_mate:first-child {\n  margin-left: 0;\n}\n\n.dshc_mate .dshc_avatar {\n  margin: 0;\n}\n\n.dshc_mateMore {\n  background: var(--dsw-alias-interactive-bg-hover);\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 11px;\n  font-weight: 600;\n}\n\n.dshc_mateDot {\n  box-sizing: border-box;\n  border: 2px solid var(--dsw-alias-bg-base);\n  background: var(--dsw-alias-label-tertiary);\n  border-radius: 50%;\n  width: 9px;\n  height: 9px;\n  position: absolute;\n  bottom: -2px;\n  right: -2px;\n}\n\n.dshc_mate[data-state=\"busy\"] .dshc_mateDot {\n  background: #23a55a;\n  animation: 1.6s ease-in-out infinite dshc_channels-pulse;\n}\n\n.dshc_mate[data-state=\"idle\"] .dshc_mateDot {\n  background: var(--dsw-alias-bg-base);\n  box-shadow: inset 0 0 0 1.5px var(--dsw-alias-label-tertiary);\n}\n\n.dshc_mate[data-state=\"error\"] .dshc_mateDot {\n  background: var(--dsw-alias-state-error-primary);\n}\n\n.dshc_mate[data-state=\"offline\"] {\n  opacity: .55;\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_mate[data-state=\"busy\"] .dshc_mateDot {\n    animation: none;\n  }\n}\n\n@media (width <= 760px) {\n  .dshc_headTeam {\n    display: none;\n  }\n}\n\n.dshc_chatHead > .dshc_headTeam + .dshc_taskBoardTrigger {\n  margin-left: 12px;\n}\n\n.dshc_sideDock {\n  display: none;\n}\n\n@media (width >= 1101px) {\n  .dshc_page.dshc_panelOpen {\n    grid-template-columns: 220px minmax(0, 1fr) min(420px, 36%) 240px;\n  }\n\n  .dshc_page.dshc_panelOpen.dshc_roomsHidden {\n    grid-template-columns: minmax(0, 1fr) min(420px, 36%) 240px;\n  }\n\n  .dshc_page.dshc_panelOpen.dshc_membersHidden {\n    grid-template-columns: 220px minmax(0, 1fr) min(420px, 36%);\n  }\n\n  .dshc_page.dshc_panelOpen.dshc_roomsHidden.dshc_membersHidden {\n    grid-template-columns: minmax(0, 1fr) min(420px, 36%);\n  }\n\n  .dshc_page.dshc_panelOpen > .dshc_sideDock {\n    border-left: 1px solid var(--dsw-alias-border-l2);\n    background: var(--dsw-alias-bg-base);\n    min-width: 0;\n    min-height: 0;\n    display: flex;\n  }\n}\n\n.dshc_sidePanel {\n  box-sizing: border-box;\n  width: 100%;\n  height: 100%;\n  max-height: none;\n  box-shadow: none;\n  border: 0;\n  border-radius: 0;\n  margin: 0;\n  animation: .2s ease-out dshc_boardDrawerIn;\n  position: relative;\n}\n\n.dshc_sidePanel:focus {\n  outline: none;\n}\n\n.dshc_sidePanelClose {\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n  background: none;\n  border: 0;\n  border-radius: 6px;\n  font-size: 18px;\n  line-height: 1;\n  position: absolute;\n  top: 10px;\n  right: 10px;\n}\n\n.dshc_sidePanelClose:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-primary);\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_sidePanel {\n    animation: none;\n  }\n}\n\n.dshc_sidePanel .dshc_boardCardGrid {\n  grid-template-columns: minmax(0, 1fr);\n}\n\n.dshc_slashPopup {\n  z-index: 6;\n  width: min(360px, 100% - 32px);\n  animation: none;\n  right: auto;\n}\n\n.dshc_slashGroup {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 6px 8px 2px;\n  font-size: 11px;\n}\n\n.dshc_slashItem {\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n  align-items: baseline;\n  gap: 8px;\n  padding: 5px 8px;\n  display: flex;\n}\n\n.dshc_slashActive {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_slashName {\n  flex: none;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-weight: 600;\n}\n\n.dshc_slashMeta {\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 12px;\n  overflow: hidden;\n}\n\n.dshc_sendButton.dshc_stopButton {\n  background: var(--dsw-alias-label-primary);\n}\n\n.dshc_stopNote + .dshc_sendButton {\n  margin-left: 8px;\n}\n\n.dshc_sendButton.dshc_stopButton[data-phase=\"stopping\"] {\n  opacity: .6;\n  cursor: progress;\n}\n\n.dshc_stopNote {\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  margin-left: auto;\n  font-size: 12px;\n}\n\n.dshc_cmdLine {\n  color: var(--dsw-alias-label-tertiary);\n  flex-wrap: wrap;\n  align-items: baseline;\n  gap: 6px;\n  padding: 1px 16px 1px 72px;\n  font-size: 12px;\n  display: flex;\n}\n\n.dshc_cmdLine code {\n  color: var(--dsw-alias-label-secondary);\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n}\n\n.dshc_cmdResult {\n  min-width: 0;\n  max-width: 60ch;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 0;\n  overflow: hidden;\n}\n\n.dshc_cmdResult[aria-expanded=\"true\"] {\n  white-space: pre-line;\n  max-width: none;\n}\n\n.dshc_cmdLine[data-failed=\"true\"] .dshc_cmdResult {\n  color: var(--dsw-alias-danger, #d94848);\n}\n\n@media (width <= 720px) {\n  .dshc_cmdLine {\n    padding-left: 16px;\n  }\n}\n\n.dshc_msgTool {\n  justify-content: center;\n  align-items: center;\n  width: 26px;\n  height: 24px;\n  padding: 0;\n  display: inline-flex;\n  position: relative;\n}\n\n.dshc_msgTool[data-tip]:after {\n  content: attr(data-tip);\n  z-index: 3;\n  background: var(--dsw-alias-label-primary);\n  color: var(--dsw-alias-label-primary-inverted);\n  white-space: nowrap;\n  opacity: 0;\n  pointer-events: none;\n  border-radius: 4px;\n  padding: 2px 6px;\n  font-size: 11px;\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 50%;\n  transform: translateX(-50%);\n}\n\n.dshc_msgTool[data-tip]:hover:after, .dshc_msgTool[data-tip]:focus-visible:after {\n  opacity: 1;\n  transition: opacity 0s 80ms;\n}\n\n.dshc_permSessionButton {\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  text-underline-offset: 2px;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 4px 6px;\n  font-size: 12px;\n  text-decoration: underline;\n}\n\n.dshc_permSessionButton:hover {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshc_permSessionButton:disabled {\n  opacity: .5;\n  cursor: default;\n}\n\n.dshc_queuedButton {\n  border: 1px solid var(--dsw-alias-border-default, #0000001f);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border-radius: 9px;\n  padding: 0 6px;\n  font-size: 11px;\n  line-height: 16px;\n}\n\n.dshc_queuedButton:hover {\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshc_queuedTag {\n  color: #a76a06;\n  background: #eaa02824;\n  border-radius: 4px;\n  padding: 0 5px;\n  font-size: 11px;\n  line-height: 16px;\n}\n\n[data-queued] .dshc_ownActions {\n  opacity: 1;\n}\n\n.dshc_memory {\n  margin-top: 4px;\n}\n\n.dshc_memoryBadge {\n  background: var(--dsw-alias-fill-secondary, #0000000d);\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  border: 0;\n  border-radius: 9px;\n  align-items: center;\n  gap: 4px;\n  padding: 0 6px;\n  font-size: 11px;\n  line-height: 18px;\n  display: inline-flex;\n}\n\n.dshc_memoryBadge:hover, .dshc_memoryBadge[aria-expanded=\"true\"] {\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshc_memoryList {\n  border-left: 2px solid var(--dsw-alias-border-default, #0000001f);\n  flex-direction: column;\n  gap: 4px;\n  max-width: 560px;\n  margin: 4px 0 0;\n  padding: 6px 10px;\n  font-size: 12px;\n  list-style: none;\n  display: flex;\n}\n\n.dshc_memoryItem {\n  flex-direction: column;\n  display: flex;\n}\n\n.dshc_memoryTitle {\n  color: var(--dsw-alias-label-secondary);\n  line-height: 1.5;\n}\n\n.dshc_memoryPage {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  font-family: var(--dsw-font-mono, ui-monospace, monospace);\n}\n\n.dshc_delivery {\n  flex-direction: column;\n  gap: 6px;\n  max-width: 720px;\n  margin-top: 8px;\n  display: flex;\n}\n\n.dshc_deliveryFrame {\n  border: 1px solid var(--background-modifier-accent, #7f7f7f4d);\n  background: #fff;\n  border-radius: 6px;\n  height: 360px;\n  display: flex;\n  overflow: hidden;\n}\n\n.dshc_deliveryActions {\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n  display: flex;\n}\n\n.dshc_deliveryActions a {\n  text-decoration: none;\n}\n\n.dshc_deliveryDone {\n  color: var(--text-muted, #888);\n  font-size: 12px;\n}\n\n.dshc_deliveryFullDialog {\n  box-sizing: border-box;\n  flex-direction: column;\n  gap: 8px;\n  width: 94vw;\n  max-width: none;\n  height: 92dvh;\n  display: flex;\n}\n\n.dshc_deliveryFullFrame {\n  background: #fff;\n  border-radius: 6px;\n  flex: 1;\n  min-height: 0;\n  display: flex;\n  overflow: hidden;\n}\n\n.dshc_dmTitle {\n  color: var(--text-muted, #888);\n  margin: 14px 8px 4px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.dshc_dmAvatar {\n  margin-right: 6px;\n  display: inline-flex;\n}\n\n.dshc_dmRow {\n  align-items: center;\n  display: flex;\n  position: relative;\n}\n\n.dshc_dmRow .dshc_room {\n  padding-right: 26px;\n}\n\n.dshc_dmClose {\n  border-radius: var(--dsw-radius-sm, 4px);\n  width: 20px;\n  height: 20px;\n  color: var(--dsw-alias-label-tertiary, #888);\n  font: inherit;\n  cursor: pointer;\n  opacity: 0;\n  background: none;\n  border: 0;\n  padding: 0;\n  font-size: 15px;\n  line-height: 20px;\n  position: absolute;\n  right: 4px;\n}\n\n.dshc_dmRow:hover .dshc_dmClose, .dshc_dmClose:focus-visible {\n  opacity: 1;\n}\n\n.dshc_dmClose:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n@media (hover: none) {\n  .dshc_dmClose {\n    opacity: 1;\n  }\n}\n\n.dshc_dmHead {\n  margin-top: 14px;\n}\n\n.dshc_dmPicker {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-layer-2);\n  flex-direction: column;\n  margin: 0 4px 4px;\n  padding: 4px;\n  display: flex;\n}\n\n.dshc_dmPickNone {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 6px 8px;\n  font-size: 12px;\n}\n\n.dshc_dmNewRow {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 13px;\n}\n\nbutton.dshc_headMeta {\n  border-radius: var(--dsw-radius-sm);\n  min-width: 0;\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: 0 auto;\n  padding: 2px 6px;\n  font-size: 12px;\n}\n\nbutton.dshc_headMeta:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshc_headSpacer {\n  flex: auto;\n}\n\n.dshc_roomUnread {\n  color: var(--dsw-alias-label-primary);\n  font-weight: 650;\n}\n\n.dshc_unreadBadge {\n  color: #fff;\n  background: var(--dsw-alias-state-danger-primary, #e5484d);\n  text-align: center;\n  font-variant-numeric: tabular-nums;\n  border-radius: 999px;\n  flex: none;\n  min-width: 18px;\n  padding: 0 5px;\n  font-size: 11px;\n  font-weight: 600;\n  line-height: 18px;\n}\n\n.dshc_slashDisabled {\n  opacity: .45;\n  cursor: not-allowed;\n}\n\n.dshc_leadCardHint {\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  overflow: hidden;\n}\n\n.dshc_roomWorking {\n  max-width: 96px;\n  color: var(--dsw-alias-state-business-primary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  flex: none;\n  align-items: center;\n  gap: 4px;\n  font-size: 11px;\n  font-weight: 500;\n  display: inline-flex;\n  overflow: hidden;\n}\n\n.dshc_roomWorkingDot {\n  background: currentColor;\n  border-radius: 50%;\n  flex: none;\n  width: 6px;\n  height: 6px;\n  animation: 1.4s ease-in-out infinite dshc_roomWorkingPulse;\n}\n\n@keyframes dshc_roomWorkingPulse {\n  50% {\n    opacity: .35;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dshc_roomWorkingDot {\n    animation: none;\n  }\n}\n\n.dshc_drawerTools {\n  display: none;\n}\n\n@media (width <= 600px) {\n  .dshc_drawerTools {\n    flex-wrap: wrap;\n    gap: 6px;\n    margin: 0 8px 8px;\n    display: flex;\n  }\n\n  .dshc_chatHead > .dshc_taskBoardTrigger, .dshc_chatHead > .dshc_schemeToggle, .dshc_chatHead > .dshc_headMeta, .dshc_chatHead > .dshc_headTeam {\n    display: none;\n  }\n\n  .dshc_chatHead > .dshc_roomName {\n    flex: auto;\n  }\n}\n\n.dshc_panelOpen .dshc_chatHead > .dshc_headTeam, .dshc_panelOpen .dshc_chatHead > .dshc_headMeta {\n  display: none;\n}\n\n.dshc_panelOpen .dshc_chatHead > .dshc_roomName {\n  flex: 0 auto;\n}\n\n.dshc_bubbleLine {\n  --bubble-cap: 668px;\n  --msg-tools-room: 94px;\n  width: fit-content;\n  max-width: min(var(--bubble-cap), 100%);\n}\n\n.dshc_own > .dshc_messageBody > .dshc_bubbleLine {\n  --bubble-cap: 588px;\n  align-self: flex-end;\n}\n\n@media (hover: hover) {\n  .dshc_bubbleLine {\n    max-width: min(var(--bubble-cap), 100% - var(--msg-tools-room));\n    position: relative;\n  }\n\n  .dshc_bubbleLine > .dshc_msgTools {\n    top: 4px;\n    left: calc(100% + 6px);\n    right: auto;\n  }\n\n  .dshc_own .dshc_bubbleLine > .dshc_msgTools {\n    left: auto;\n    right: calc(100% + 6px);\n  }\n\n  .dshc_bubbleLine > .dshc_msgTools > .dshc_msgToolNote {\n    box-sizing: border-box;\n    border: 1px solid var(--dsw-alias-separator, #7f7f7f40);\n    border-radius: var(--dsw-radius-sm, 6px);\n    background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-primary, #fff));\n    white-space: normal;\n    overflow-wrap: anywhere;\n    width: max-content;\n    max-width: 180px;\n    padding: 2px 6px;\n    position: absolute;\n    bottom: calc(100% + 4px);\n    right: 0;\n    box-shadow: 0 2px 6px #00000014;\n  }\n\n  .dshc_own .dshc_bubbleLine > .dshc_msgTools > .dshc_msgToolNote {\n    left: 0;\n    right: auto;\n  }\n\n  .dshc_bubbleLine > .dshc_msgTools > .dshc_msgToolNote.dshc_msgToolNoteBelow {\n    z-index: 4;\n    top: calc(100% + 4px);\n    bottom: auto;\n  }\n}\n[data-dc-scheme=\"light\"] {\n  --dsw-static-amber-100: #fef5e7;\n  --dsw-static-amber-400: #f7ad31;\n  --dsw-static-amber-500: #f59e0b;\n  --dsw-static-amber-600: #dd8629;\n  --dsw-static-amber-900: #27241f;\n  --dsw-static-blue-100: #dbeafe;\n  --dsw-static-blue-300: #93c5fd;\n  --dsw-static-blue-400: #60a5fa;\n  --dsw-static-blue-450: #4d93f8;\n  --dsw-static-blue-500: #3b82f6;\n  --dsw-static-blue-50: #eff6ff;\n  --dsw-static-blue-50p: #eaf3ff;\n  --dsw-static-blue-600: #2563eb;\n  --dsw-static-blue-75: #e5f0ff;\n  --dsw-static-blue-800: #1e40af;\n  --dsw-static-blue-900: #0e3074;\n  --dsw-static-blue-950: #172554;\n  --dsw-static-deepseek-100: #e4edfd;\n  --dsw-static-deepseek-200: #d3e2ff;\n  --dsw-static-deepseek-300: #b7c8fe;\n  --dsw-static-deepseek-400: #7aaaff;\n  --dsw-static-deepseek-450: #5686fe;\n  --dsw-static-deepseek-500: #4176e6;\n  --dsw-static-deepseek-50: #edf3fe;\n  --dsw-static-deepseek-600: #4868b2;\n  --dsw-static-deepseek-700-delete: #2f4c8f;\n  --dsw-static-deepseek-800: #34415b;\n  --dsw-static-deepseek-900: #283142;\n  --dsw-static-green-100: #e6faed;\n  --dsw-static-green-400: #4ed17e;\n  --dsw-static-green-500: #22c55e;\n  --dsw-static-green-500-a08: #22c55e14;\n  --dsw-static-green-500-a12: #22c55e1f;\n  --dsw-static-green-900: #233c2c;\n  --dsw-static-neutral-00: #fff;\n  --dsw-static-neutral-1000: #000;\n  --dsw-static-neutral-100: #f5f5f5;\n  --dsw-static-neutral-150: #ededed;\n  --dsw-static-neutral-200: #e5e5e5;\n  --dsw-static-neutral-250: #dcdcdc;\n  --dsw-static-neutral-300: #d4d4d4;\n  --dsw-static-neutral-400: #a2a4a6;\n  --dsw-static-neutral-500: #7f8287;\n  --dsw-static-neutral-50: #fafafa;\n  --dsw-static-neutral-550: #65676b;\n  --dsw-static-neutral-600: #545557;\n  --dsw-static-neutral-700: #3c3c3d;\n  --dsw-static-neutral-800: #292929;\n  --dsw-static-neutral-850: #212123;\n  --dsw-static-neutral-900: #0f0f0f;\n  --dsw-static-neutral-bluish-00: #fff;\n  --dsw-static-neutral-bluish-1000: #0f1115;\n  --dsw-static-neutral-bluish-100: #ebeef2;\n  --dsw-static-neutral-bluish-150: #e9ecf2;\n  --dsw-static-neutral-bluish-200: #e1e5ee;\n  --dsw-static-neutral-bluish-300: #cfd3d6;\n  --dsw-static-neutral-bluish-400: #adb2b8;\n  --dsw-static-neutral-bluish-500: #979da6;\n  --dsw-static-neutral-bluish-50: #f9fafb;\n  --dsw-static-neutral-bluish-600: #81858c;\n  --dsw-static-neutral-bluish-60: #f5f6f7;\n  --dsw-static-neutral-bluish-700: #61666b;\n  --dsw-static-neutral-bluish-750: #43454a;\n  --dsw-static-neutral-bluish-75: #f1f3f5;\n  --dsw-static-neutral-bluish-800: #353638;\n  --dsw-static-neutral-bluish-850: #2c2c2e;\n  --dsw-static-neutral-bluish-875: #232324;\n  --dsw-static-neutral-bluish-900: #1b1b1c;\n  --dsw-static-neutral-bluish-950: #151517;\n  --dsw-static-red-100: #fee2e2;\n  --dsw-static-red-400: #f25a5a;\n  --dsw-static-red-400-a12: #f25a5a1f;\n  --dsw-static-red-500: #ef4444;\n  --dsw-static-red-50: #fef2f2;\n  --dsw-static-red-600: #ec1313;\n  --dsw-static-red-600-a08: #ec131314;\n  --dsw-static-red-900: #570c0c;\n}\n\n[data-dc-scheme=\"dark\"] {\n  --dsw-static-amber-100: #fef5e7;\n  --dsw-static-amber-400: #f7ad31;\n  --dsw-static-amber-500: #f59e0b;\n  --dsw-static-amber-600: #dd8629;\n  --dsw-static-amber-900: #27241f;\n  --dsw-static-blue-100: #dbeafe;\n  --dsw-static-blue-300: #93c5fd;\n  --dsw-static-blue-400: #60a5fa;\n  --dsw-static-blue-450: #4d93f8;\n  --dsw-static-blue-500: #3b82f6;\n  --dsw-static-blue-50: #eff6ff;\n  --dsw-static-blue-50p: #eaf3ff;\n  --dsw-static-blue-600: #2563eb;\n  --dsw-static-blue-75: #e5f0ff;\n  --dsw-static-blue-800: #1e40af;\n  --dsw-static-blue-900: #0e3074;\n  --dsw-static-blue-950: #172554;\n  --dsw-static-deepseek-100: #e4edfd;\n  --dsw-static-deepseek-200: #d3e2ff;\n  --dsw-static-deepseek-300: #b7c8fe;\n  --dsw-static-deepseek-400: #7aaaff;\n  --dsw-static-deepseek-450: #5686fe;\n  --dsw-static-deepseek-500: #4176e6;\n  --dsw-static-deepseek-50: #edf3fe;\n  --dsw-static-deepseek-600: #4868b2;\n  --dsw-static-deepseek-700-delete: #2f4c8f;\n  --dsw-static-deepseek-800: #34415b;\n  --dsw-static-deepseek-900: #283142;\n  --dsw-static-green-100: #e6faed;\n  --dsw-static-green-400: #4ed17e;\n  --dsw-static-green-500: #22c55e;\n  --dsw-static-green-500-a08: #22c55e14;\n  --dsw-static-green-500-a12: #22c55e1f;\n  --dsw-static-green-900: #233c2c;\n  --dsw-static-neutral-00: #fff;\n  --dsw-static-neutral-1000: #000;\n  --dsw-static-neutral-100: #f5f5f5;\n  --dsw-static-neutral-150: #ededed;\n  --dsw-static-neutral-200: #e5e5e5;\n  --dsw-static-neutral-250: #dcdcdc;\n  --dsw-static-neutral-300: #d4d4d4;\n  --dsw-static-neutral-400: #a2a4a6;\n  --dsw-static-neutral-500: #7f8287;\n  --dsw-static-neutral-50: #fafafa;\n  --dsw-static-neutral-550: #65676b;\n  --dsw-static-neutral-600: #545557;\n  --dsw-static-neutral-700: #3c3c3d;\n  --dsw-static-neutral-800: #292929;\n  --dsw-static-neutral-850: #212123;\n  --dsw-static-neutral-900: #0f0f0f;\n  --dsw-static-neutral-bluish-00: #fff;\n  --dsw-static-neutral-bluish-1000: #0f1115;\n  --dsw-static-neutral-bluish-100: #ebeef2;\n  --dsw-static-neutral-bluish-150: #e9ecf2;\n  --dsw-static-neutral-bluish-200: #e1e5ee;\n  --dsw-static-neutral-bluish-300: #cfd3d6;\n  --dsw-static-neutral-bluish-400: #adb2b8;\n  --dsw-static-neutral-bluish-500: #979da6;\n  --dsw-static-neutral-bluish-50: #f9fafb;\n  --dsw-static-neutral-bluish-600: #81858c;\n  --dsw-static-neutral-bluish-60: #f9fafb;\n  --dsw-static-neutral-bluish-700: #61666b;\n  --dsw-static-neutral-bluish-750: #43454a;\n  --dsw-static-neutral-bluish-75: #f1f3f5;\n  --dsw-static-neutral-bluish-800: #353638;\n  --dsw-static-neutral-bluish-850: #2c2c2e;\n  --dsw-static-neutral-bluish-875: #232324;\n  --dsw-static-neutral-bluish-900: #1b1b1c;\n  --dsw-static-neutral-bluish-950: #151517;\n  --dsw-static-red-100: #fee2e2;\n  --dsw-static-red-400: #f25a5a;\n  --dsw-static-red-400-a12: #f25a5a1f;\n  --dsw-static-red-500: #ef4444;\n  --dsw-static-red-50: #fef2f2;\n  --dsw-static-red-600: #ec1313;\n  --dsw-static-red-600-a08: #ec131314;\n  --dsw-static-red-900: #570c0c;\n}\n\n[data-dc-scheme=\"light\"] {\n  --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-bg-document-preview: var(--dsw-static-neutral-bluish-100);\n  --dsw-alias-bg-document-selection: color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent);\n  --dsw-alias-label-document-preview: var(--dsw-static-neutral-bluish-700);\n  --dsw-alias-bg-layer-1: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-bg-layer-2: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-bg-layer-3: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-bg-mask-1: #0000003d;\n  --dsw-alias-bg-mask-2: #0000001f;\n  --dsw-alias-bg-mask-3: #0000007a;\n  --dsw-alias-bg-mask-photo: #000000e0;\n  --dsw-alias-bg-mask-drop: #ffffffb3;\n  --dsw-alias-bg-module-platform: var(--dsw-static-neutral-bluish-60);\n  --dsw-alias-bg-multi-select: var(--dsw-static-neutral-bluish-60);\n  --dsw-alias-bg-overlay: var(--dsw-static-neutral-bluish-150);\n  --dsw-alias-bg-skeleton: #0000000a;\n  --dsw-alias-border-inverted2: #0000;\n  --dsw-alias-border-inverted: #0000;\n  --dsw-alias-border-l1: #0000000a;\n  --dsw-alias-border-l2-darkmode-thin: #0000001a;\n  --dsw-alias-border-l2: #0000001a;\n  --dsw-alias-border-l3: #0000001f;\n  --dsw-alias-border-l4: #00000029;\n  --dsw-alias-brand-primary-invert: var(--dsw-static-neutral-bluish-1000);\n  --dsw-alias-brand-primary-new-colorprimary-new-color: #4176e6;\n  --dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-1000);\n  --dsw-alias-brand-text: var(--dsw-static-neutral-bluish-1000);\n  --dsw-alias-button-contrast-fill: var(--dsw-static-neutral-bluish-700);\n  --dsw-alias-button-elevated-fill: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-button-floating-fill: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-button-floating-hover: var(--dsw-static-neutral-bluish-75);\n  --dsw-alias-button-ghost-active-border: var(--dsw-static-neutral-bluish-500);\n  --dsw-alias-button-ghost-active-fill: var(--dsw-static-neutral-bluish-100);\n  --dsw-alias-button-ghost-active-hover: var(--dsw-static-neutral-bluish-150);\n  --dsw-alias-button-info-fill: var(--dsw-static-deepseek-500);\n  --dsw-alias-button-info-hover: var(--dsw-static-deepseek-400);\n  --dsw-alias-button-primary-dimmed: var(--dsw-static-neutral-bluish-100);\n  --dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);\n  --dsw-alias-button-primary-hover: var(--dsw-static-neutral-bluish-750);\n  --dsw-alias-button-tool-bar-fill-invisible: #1f1f1f5c;\n  --dsw-alias-button-tool-bar-fill: #54555780;\n  --dsw-alias-button-tool-bar-hover: #54555799;\n  --dsw-alias-interactive-bg-active: #2631481a;\n  --dsw-alias-interactive-bg-hover-accent: #26314824;\n  --dsw-alias-interactive-bg-hover-danger: #ec13130d;\n  --dsw-alias-interactive-bg-hover-solid: var(--dsw-static-neutral-bluish-75);\n  --dsw-alias-interactive-bg-hover: #2631480f;\n  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-400);\n  --dsw-alias-label-deep-diving: color-mix(in srgb, var(--dsw-static-deepseek-500) 70%, var(--dsw-static-blue-950));\n  --dsw-alias-label-deep-diving-shimmer: color-mix(in srgb, var(--dsw-static-deepseek-500) 30%, var(--dsw-static-blue-950));\n  --dsw-alias-label-dimmed: var(--dsw-static-neutral-bluish-200);\n  --dsw-alias-label-primary-bluish: var(--dsw-static-blue-900);\n  --dsw-alias-label-primary-dimmed: var(--dsw-static-neutral-bluish-950);\n  --dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-label-primary-inverted: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-label-primary: var(--dsw-static-neutral-bluish-1000);\n  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-700);\n  --dsw-alias-label-shimmer: color-mix(in srgb, var(--dsw-static-neutral-1000) 30%, transparent);\n  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-600);\n  --dsw-alias-menu-icon: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-link: var(--dsw-static-deepseek-500);\n  --dsw-alias-markdown-citation: var(--dsw-static-neutral-bluish-100);\n  --dsw-alias-markdown-code-block-banner: var(--dsw-static-neutral-bluish-50);\n  --dsw-alias-markdown-code-block: var(--dsw-static-neutral-bluish-50);\n  --dsw-alias-markdown-code-segment-selected: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-markdown-code-segment-unselected: var(--dsw-static-neutral-bluish-75);\n  --dsw-alias-markdown-inline-code: var(--dsw-static-neutral-50);\n  --dsw-alias-markdown-placeholder: var(--dsw-static-neutral-bluish-60);\n  --dsw-alias-markdown-tag: var(--dsw-static-neutral-bluish-75);\n  --dsw-alias-scrollbar-bg-l1: var(--dsw-static-neutral-200);\n  --dsw-alias-scrollbar-bg-l2: var(--dsw-static-neutral-200);\n  --dsw-alias-scrollbar-hover-l1: var(--dsw-static-neutral-300);\n  --dsw-alias-scrollbar-hover-l2: var(--dsw-static-neutral-300);\n  --dsw-alias-state-business-primary: var(--dsw-static-deepseek-500);\n  --dsw-alias-state-business-tertiary: var(--dsw-static-deepseek-100);\n  --dsw-alias-code-diff-added: var(--dsw-static-green-500-a08);\n  --dsw-alias-code-diff-deleted: var(--dsw-static-red-600-a08);\n  --dsw-alias-file-diff-added-bg: #e6f4e7;\n  --dsw-alias-file-diff-added-gutter: #edf7ed;\n  --dsw-alias-file-diff-added-marker: #01a241;\n  --dsw-alias-file-diff-deleted-bg: #fce6e2;\n  --dsw-alias-file-diff-deleted-gutter: #fdece9;\n  --dsw-alias-file-diff-deleted-marker: #ba2723;\n  --dsw-alias-state-error-primary: var(--dsw-static-red-600);\n  --dsw-alias-state-error-secondary: var(--dsw-static-red-400);\n  --dsw-alias-state-idle-primary: var(--dsw-static-neutral-300);\n  --dsw-alias-state-success-primary: var(--dsw-static-green-500);\n  --dsw-alias-state-success-secondary: var(--dsw-static-green-400);\n  --dsw-alias-state-success-tertiary: var(--dsw-static-green-100);\n  --dsw-alias-state-warn-label: var(--dsw-static-amber-600);\n  --dsw-alias-state-warn-primary: var(--dsw-static-amber-500);\n  --dsw-alias-state-warn-secondary: var(--dsw-static-amber-400);\n  --dsw-alias-state-warn-tertiary: var(--dsw-static-amber-100);\n  --dsw-alias-switch-thumb: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-toast-bg: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-toast-label: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-tooltip-bg: var(--dsw-static-neutral-bluish-850);\n  --dsw-alias-tooltip-key-bg: color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%);\n  --dsw-alias-turn-trigger-bg: var(--dsw-alias-markdown-code-block);\n  --dsw-alias-turn-trigger-bg-hover: var(--dsw-alias-interactive-bg-hover);\n  --dsw-specific-bubble-highlight: var(--dsw-static-deepseek-200);\n  --dsw-specific-bubble: var(--dsw-static-deepseek-50);\n  --dsw-specific-input-major: var(--dsw-static-neutral-bluish-00);\n  --dsw-specific-login-input: var(--dsw-static-neutral-bluish-50);\n  --dsw-menu-surface-fill: #f8f9fa94;\n  --dsw-alias-menu-group-header-fill: #f8f9faf0;\n  --dsw-specific-menu: var(--dsw-menu-surface-fill);\n  --dsw-specific-selector: var(--dsw-static-neutral-bluish-60);\n  --dsw-specific-sidebar-fill: var(--dsw-static-neutral-bluish-50);\n  --dsw-specific-sidebar-nav-item-active-accent: var(--dsw-static-deepseek-100);\n  --dsw-specific-sidebar-nav-item-active: var(--dsw-static-neutral-bluish-100);\n  --dsw-specific-sidebar-nav-item-hover: var(--dsw-static-neutral-bluish-75);\n  --dsw-specific-tip: var(--dsw-static-neutral-bluish-60);\n}\n\n[data-dc-scheme=\"dark\"] {\n  --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950);\n  --dsw-alias-bg-document-preview: var(--dsw-static-neutral-bluish-950);\n  --dsw-alias-bg-document-selection: color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent);\n  --dsw-alias-label-document-preview: var(--dsw-static-neutral-bluish-300);\n  --dsw-alias-bg-layer-1: var(--dsw-static-neutral-bluish-875);\n  --dsw-alias-bg-layer-2: var(--dsw-static-neutral-bluish-850);\n  --dsw-alias-bg-layer-3: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-bg-mask-1: #00000080;\n  --dsw-alias-bg-mask-2: #0003;\n  --dsw-alias-bg-mask-3: #0000007a;\n  --dsw-alias-bg-mask-photo: #000000e0;\n  --dsw-alias-bg-mask-drop: #272730b3;\n  --dsw-alias-bg-module-platform: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-bg-multi-select: var(--dsw-static-neutral-850);\n  --dsw-alias-bg-overlay: var(--dsw-static-neutral-bluish-700);\n  --dsw-alias-bg-skeleton: #ffffff14;\n  --dsw-alias-border-inverted2: #ffffff14;\n  --dsw-alias-border-inverted: #ffffff0f;\n  --dsw-alias-border-l1: #ffffff0f;\n  --dsw-alias-border-l2-darkmode-thin: #ffffff0f;\n  --dsw-alias-border-l2: #ffffff1f;\n  --dsw-alias-border-l3: #ffffff29;\n  --dsw-alias-border-l4: #fff3;\n  --dsw-alias-brand-primary-invert: var(--dsw-static-neutral-bluish-50);\n  --dsw-alias-brand-primary-new-colorprimary-new-color: var(--dsw-static-deepseek-450);\n  --dsw-alias-brand-primary: var(--dsw-static-neutral-bluish-50);\n  --dsw-alias-brand-text: var(--dsw-static-neutral-bluish-50);\n  --dsw-alias-button-contrast-fill: var(--dsw-static-neutral-bluish-50);\n  --dsw-alias-button-elevated-fill: var(--dsw-static-neutral-bluish-750);\n  --dsw-alias-button-floating-fill: var(--dsw-static-neutral-bluish-850);\n  --dsw-alias-button-floating-hover: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-button-ghost-active-border: var(--dsw-static-neutral-bluish-600);\n  --dsw-alias-button-ghost-active-fill: var(--dsw-static-neutral-bluish-750);\n  --dsw-alias-button-ghost-active-hover: var(--dsw-static-neutral-bluish-700);\n  --dsw-alias-button-info-fill: var(--dsw-static-deepseek-400);\n  --dsw-alias-button-info-hover: var(--dsw-static-deepseek-500);\n  --dsw-alias-button-primary-dimmed: var(--dsw-static-neutral-bluish-750);\n  --dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);\n  --dsw-alias-button-primary-hover: var(--dsw-static-neutral-bluish-100);\n  --dsw-alias-button-tool-bar-fill-invisible: #1f1f1f5c;\n  --dsw-alias-button-tool-bar-fill: #54555780;\n  --dsw-alias-button-tool-bar-hover: #54555799;\n  --dsw-alias-interactive-bg-active: #ffffff24;\n  --dsw-alias-interactive-bg-hover-accent: #ffffff3d;\n  --dsw-alias-interactive-bg-hover-danger: #f25a5a26;\n  --dsw-alias-interactive-bg-hover-solid: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-interactive-bg-hover: #ffffff14;\n  --dsw-alias-label-caption: var(--dsw-static-neutral-bluish-600);\n  --dsw-alias-label-deep-diving: color-mix(in srgb, var(--dsw-static-deepseek-450) 55%, var(--dsw-static-neutral-bluish-400));\n  --dsw-alias-label-deep-diving-shimmer: color-mix(in srgb, var(--dsw-static-blue-300) 65%, var(--dsw-static-deepseek-400));\n  --dsw-alias-label-dimmed: var(--dsw-static-neutral-bluish-750);\n  --dsw-alias-label-primary-bluish: var(--dsw-static-neutral-bluish-50);\n  --dsw-alias-label-primary-dimmed: var(--dsw-static-neutral-bluish-100);\n  --dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-1000);\n  --dsw-alias-label-primary-inverted: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-label-primary: var(--dsw-static-neutral-bluish-50);\n  --dsw-alias-label-secondary: var(--dsw-static-neutral-bluish-300);\n  --dsw-alias-label-shimmer: color-mix(in srgb, var(--dsw-static-neutral-00) 45%, transparent);\n  --dsw-alias-label-tertiary: var(--dsw-static-neutral-bluish-400);\n  --dsw-alias-menu-icon: var(--dsw-alias-label-primary-dimmed);\n  --dsw-alias-link: var(--dsw-static-deepseek-400);\n  --dsw-alias-markdown-citation: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-markdown-code-block-banner: var(--dsw-static-neutral-bluish-850);\n  --dsw-alias-markdown-code-block: var(--dsw-static-neutral-bluish-900);\n  --dsw-alias-markdown-code-segment-selected: var(--dsw-static-neutral-bluish-800);\n  --dsw-alias-markdown-code-segment-unselected: var(--dsw-static-neutral-bluish-900);\n  --dsw-alias-markdown-inline-code: var(--dsw-static-neutral-800);\n  --dsw-alias-markdown-placeholder: var(--dsw-static-neutral-bluish-850);\n  --dsw-alias-markdown-tag: var(--dsw-static-neutral-bluish-850);\n  --dsw-alias-scrollbar-bg-l1: var(--dsw-static-neutral-700);\n  --dsw-alias-scrollbar-bg-l2: var(--dsw-static-neutral-600);\n  --dsw-alias-scrollbar-hover-l1: var(--dsw-static-neutral-600);\n  --dsw-alias-scrollbar-hover-l2: var(--dsw-static-neutral-550);\n  --dsw-alias-state-business-primary: var(--dsw-static-deepseek-400);\n  --dsw-alias-state-business-tertiary: var(--dsw-static-deepseek-800);\n  --dsw-alias-code-diff-added: var(--dsw-static-green-500-a12);\n  --dsw-alias-code-diff-deleted: var(--dsw-static-red-400-a12);\n  --dsw-alias-file-diff-added-bg: #1f3124;\n  --dsw-alias-file-diff-added-gutter: #132016;\n  --dsw-alias-file-diff-added-marker: #41c977;\n  --dsw-alias-file-diff-deleted-bg: #3c1f1b;\n  --dsw-alias-file-diff-deleted-gutter: #28130e;\n  --dsw-alias-file-diff-deleted-marker: #fa423e;\n  --dsw-alias-state-error-primary: var(--dsw-static-red-400);\n  --dsw-alias-state-error-secondary: var(--dsw-static-red-400);\n  --dsw-alias-state-idle-primary: var(--dsw-static-neutral-600);\n  --dsw-alias-state-success-primary: var(--dsw-static-green-500);\n  --dsw-alias-state-success-secondary: var(--dsw-static-green-400);\n  --dsw-alias-state-success-tertiary: var(--dsw-static-green-900);\n  --dsw-alias-state-warn-label: var(--dsw-static-amber-600);\n  --dsw-alias-state-warn-primary: var(--dsw-static-amber-500);\n  --dsw-alias-state-warn-secondary: var(--dsw-static-amber-400);\n  --dsw-alias-state-warn-tertiary: var(--dsw-static-amber-900);\n  --dsw-alias-switch-thumb: var(--dsw-static-neutral-bluish-400);\n  --dsw-alias-toast-bg: var(--dsw-static-neutral-bluish-750);\n  --dsw-alias-toast-label: var(--dsw-static-neutral-bluish-00);\n  --dsw-alias-turn-trigger-bg: var(--dsw-alias-interactive-bg-hover);\n  --dsw-alias-turn-trigger-bg-hover: var(--dsw-alias-interactive-bg-active);\n  --dsw-alias-tooltip-bg: var(--dsw-static-neutral-bluish-750);\n  --dsw-alias-tooltip-key-bg: color-mix(in srgb, var(--dsw-alias-tooltip-bg), white 18%);\n  --dsw-specific-bubble-highlight: var(--dsw-static-neutral-bluish-750);\n  --dsw-specific-bubble: var(--dsw-static-neutral-bluish-850);\n  --dsw-specific-input-major: var(--dsw-static-neutral-bluish-850);\n  --dsw-specific-login-input: var(--dsw-static-neutral-bluish-900);\n  --dsw-menu-surface-fill: #43454a73;\n  --dsw-alias-menu-group-header-fill: #303136f0;\n  --dsw-specific-menu: var(--dsw-menu-surface-fill);\n  --dsw-specific-selector: var(--dsw-static-neutral-bluish-800);\n  --dsw-specific-sidebar-fill: var(--dsw-static-neutral-bluish-900);\n  --dsw-specific-sidebar-nav-item-active-accent: var(--dsw-static-neutral-bluish-800);\n  --dsw-specific-sidebar-nav-item-active: var(--dsw-static-neutral-bluish-750);\n  --dsw-specific-sidebar-nav-item-hover: var(--dsw-static-neutral-bluish-850);\n  --dsw-specific-tip: var(--dsw-static-neutral-bluish-800);\n}\n\nhtml[data-platform=\"darwin\"] [data-dc-scheme=\"light\"] {\n  --dsw-specific-menu: #f8f9faf0;\n}\n\nhtml[data-platform=\"darwin\"] [data-dc-scheme=\"dark\"] {\n  --dsw-specific-menu: #303136f0;\n}\n\n[data-dc-scheme=\"light\"] {\n  color-scheme: light;\n}\n\n[data-dc-scheme=\"dark\"] {\n  color-scheme: dark;\n}\n.dshc_embed {\n  box-sizing: border-box;\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  padding-top: var(--dsh-frame-top-clearance, 0px);\n  background: var(--dsw-alias-bg-base);\n  display: flex;\n}\n\n.dshc_frame {\n  background: var(--dsw-alias-bg-base);\n  border: 0;\n  flex: 1;\n  width: 100%;\n  height: 100%;\n}\n\n.dshc_remote {\n  box-sizing: border-box;\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  padding-top: var(--dsh-frame-top-clearance, 0px);\n  background: var(--dsw-alias-bg-base);\n  flex-direction: column;\n  display: flex;\n}\n\n.dshc_remoteBar {\n  border-bottom: 1px solid var(--dsw-alias-border-subtle, #7f7f7f40);\n  color: var(--dsw-alias-label-secondary);\n  align-items: center;\n  gap: 12px;\n  padding: 6px 12px;\n  font-size: 13px;\n  display: flex;\n}\n\n.dshc_remoteName {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n}\n\n.dshc_remoteBack {\n  border: 1px solid var(--dsw-alias-border-subtle, #7f7f7f59);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border-radius: 6px;\n  flex: none;\n  padding: 2px 10px;\n}\n\n.dshc_remoteBody {\n  flex: 1;\n  min-height: 0;\n}\n";document.head.appendChild(s)})();
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");
let react = require("react");
react = __toESM(react, 1);
let react_dom = require("react-dom");
// src/client/uuid.ts
/**
* v4 UUID that also works outside a secure context. `crypto.randomUUID` exists only
* on https/localhost pages, so a channel page opened at a plain-http LAN or Tailscale
* address has no such method; `crypto.getRandomValues` is available everywhere.
* Same approach as upstream DSH's `@deepseek-ai/dsh-util-crypto` randomUUID, which is
* not loadable here because the bundle keeps `@deepseek-ai/*` external.
* @returns a canonical lowercase v4 UUID string.
*/
function randomUUID() {
	const c = globalThis.crypto;
	if (typeof c.randomUUID === "function") return c.randomUUID();
	const bytes = c.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
	bytes[6] = bytes[6] & 15 | 64;
	bytes[8] = bytes[8] & 63 | 128;
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
// src/client/channel-source.ts
/** Relative URL of a stored attachment (same base as the other collab requests). */
const attachmentUrl = (id) => `collab/api/attachments/${encodeURIComponent(id)}`;
const MAX_MESSAGE_BODY = 8388608;
/** #197: fallback when the service does not report its cap (`max_upload_bytes`); matches collab's DEFAULT_MAX_UPLOAD_BYTES. */
const DEFAULT_MAX_UPLOAD_BYTES = 1073741824;
/**
* #1445: fallback text cap when the service does not report `max_text_chars`.
* 来源：dsh/collab/store.mjs:8 `MAX_TEXT = 128 * 1024`，同一数值也由 `/collab/api/state` 的
* `max_text_chars` 回传；这份抄写只覆盖还没有该字段的旧宿主。
*/
const DEFAULT_MAX_TEXT_CHARS = 131072;
/**
* #1445: whether the typed text alone exceeds the service's character cap. The service compares
* `text.length` against MAX_TEXT (collab/store.mjs), so this must count characters too — a byte
* count would let 131072 Chinese characters (about 400 KB) through to a `too-long` refusal.
*/
const textTooLarge = (text, maxChars) => text.length > maxChars;
/** Whether a message with these attachments would exceed the server's body cap (checked before sending). */
const messageTooLarge = (text, attachments) => new TextEncoder().encode(JSON.stringify({
	text,
	client_key: randomUUID(),
	reply_to: Number.MAX_SAFE_INTEGER,
	attachments
})).length > MAX_MESSAGE_BODY;
/** Bytes as a limit reads in the UI: 1 GB, 500 MB, 12.5 MB. */
const formatBytes = (bytes) => {
	if (bytes >= 1024 ** 3) return `${Number((bytes / 1024 ** 3).toFixed(2))} GB`;
	if (bytes >= 1024 ** 2) return `${Number((bytes / 1024 ** 2).toFixed(1))} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};
/** The upload route's path for one file: a header cannot carry 中文, so name and type ride the query. */
const uploadUrl = (file) => `collab/api/attachments?name=${encodeURIComponent(file.name || "pasted")}&mime=${encodeURIComponent(file.type || "application/octet-stream")}`;
/** #1023: the private chats, one per agent member, in id order. */
const dmRooms = (rooms) => rooms.filter((r) => r.dm_member != null);
/**
* Order rooms as chat channel, then its workspaces, in id order. A workspace whose
* chat channel is missing is shown at the top level so it stays reachable.
*/
function groupRooms(allRooms) {
	const rooms = allRooms.filter((r) => r.dm_member == null);
	const chats = new Set(rooms.filter((r) => r.kind !== "workspace").map((r) => r.id));
	const under = /* @__PURE__ */ new Map();
	for (const r of rooms) if (r.kind === "workspace" && r.parent_id != null && chats.has(r.parent_id)) under.set(r.parent_id, [...under.get(r.parent_id) ?? [], r]);
	const rows = [];
	for (const r of rooms) if (r.kind !== "workspace") {
		rows.push({
			room: r,
			depth: 0
		});
		for (const w of under.get(r.id) ?? []) rows.push({
			room: w,
			depth: 1
		});
	} else if (r.parent_id == null || !chats.has(r.parent_id)) rows.push({
		room: r,
		depth: 0
	});
	return rows;
}
const INITIAL = {
	phase: "idle",
	error: void 0,
	rooms: [],
	roomId: void 0,
	members: [],
	thinking: {},
	messages: [],
	leadId: null,
	tasks: [],
	taskChat: void 0,
	hasMoreOlder: false,
	outbox: [],
	maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
	maxTextChars: DEFAULT_MAX_TEXT_CHARS
};
/** Position of message `id` in rows ascending by id, or -1. */
function indexOfId(rows, id) {
	let lo = 0;
	let hi = rows.length - 1;
	while (lo <= hi) {
		const mid = lo + hi >> 1;
		const at = rows[mid].id;
		if (at === id) return mid;
		if (at < id) lo = mid + 1;
		else hi = mid - 1;
	}
	return -1;
}
/** Reconnect backoff: 1, 2, 4, 8… seconds, never beyond this cap. */
const MAX_BACKOFF_MS = 3e4;
/** Messages requested per page, both for the first read and for `loadOlder`. */
const PAGE_SIZE = 100;
/** Browser storage key holding the channel the owner had open before a reload. */
const ROOM_KEY = "dsh-collab.room";
/** Remember the open channel so reopening the panel returns to it instead of the first one. */
const rememberRoom = (roomId) => {
	try {
		globalThis.localStorage?.setItem(ROOM_KEY, String(roomId));
	} catch (error) {}
};
/** Channel id remembered by an earlier visit, or undefined when absent or unreadable. */
const rememberedRoom = () => {
	try {
		const raw = globalThis.localStorage?.getItem(ROOM_KEY);
		const id = raw === null || raw === void 0 || raw === "" ? NaN : Number(raw);
		return Number.isInteger(id) ? id : void 0;
	} catch (error) {
		return;
	}
};
/** Messages requested per catch-up read after a reconnect. */
const CATCH_UP_LIMIT = 200;
/** #197: one file the composer holds beyond the service's cap, named so the message can say which. */
var UploadTooLarge = class extends Error {
	fileName;
	size;
	limit;
	constructor(fileName, size, limit) {
		super(`${fileName}：${formatBytes(size)} > ${formatBytes(limit)}`);
		this.fileName = fileName;
		this.size = size;
		this.limit = limit;
		this.name = "UploadTooLarge";
	}
};
/**
* #216: where the instance that lost the lock publishes its holder. It is an exact route the
* refused plugin registers before throwing, so it answers while every other `/collab/api/*`
* path is a bare 404.
*/
const LOCK_HOLDER_PATH = "collab/api/lock";
/** Status-coded service failure so the panel can tell "not enabled" from "not signed in". */
var ServiceError = class extends Error {
	status;
	code;
	/**
	* @param status - HTTP status the service answered with.
	* @param message - the service's own sentence, kept for logs and the fallback line.
	* @param code - the machine code the service sends beside it (`conflict`, `invalid`, …), if any.
	*/
	constructor(status, message, code) {
		super(message);
		this.status = status;
		this.code = code;
		this.name = "ServiceError";
	}
};
/** 工作区<n> is how a workspace is addressed, so the store refuses that shape for a chat channel (collab/store.mjs WORKSPACE_PREFIX). */
const WORKSPACE_NAME = /^工作区\d+$/;
/** The cap the service puts on a member name; source: collab/roster.mjs `MAX_NAME = 32`. */
const MEMBER_NAME_MAX = 32;
/** The one member name the service accepts with a space; source: collab/roster.mjs `validate` (`/^Claude Code(?:-\d+)?$/`). */
const MEMBER_NAME_SPACED = /^Claude Code(?:-\d+)?$/;
/**
* The member-name shape the service refuses, copied from collab/roster.mjs `validate` so a name it
* accepted (say `Claude Code`) is never blamed for an unrelated `invalid` such as a missing model.
* @param name - the name after the service's own trim.
* @returns whether the service would word this as a bad name.
*/
function memberNameRefused(name) {
	return name.length > MEMBER_NAME_MAX || /[@<>\r\n\t]/.test(name) || /\s/.test(name) && !MEMBER_NAME_SPACED.test(name);
}
/**
* #268: the collab service answers a refusal with `code` plus an English sentence, and the panel
* used to show that sentence as-is. Word the failures a person can act on from the `code` alone —
* never by matching the English text — and keep the service sentence only inside the last resort.
* @param error - whatever the action rejected with.
* @param t - the panel's dictionary, so an English UI stays English.
* @param place - the field being edited when the action failed.
* @param typed - the name the person typed, for the copy that names it.
* @param limits - the caps the panel knows about, for the copy that quotes one back (#1445).
* @returns one line to show under the form.
*/
function errorText(error, t, place = "other", typed = "", limits = {}) {
	const message = error instanceof Error ? error.message : String(error);
	if (!(error instanceof ServiceError)) return message;
	if (error.code === "too-long") return t("messageTooLarge", { limit: t("charCount", { count: limits.textChars ?? 131072 }) });
	const code = error.code;
	const name = place === "room" ? typed.trim().replace(/^#/, "") : typed.trim();
	if (code === "conflict" && place === "room") return WORKSPACE_NAME.test(name) ? t("channelNameReserved", { name }) : t("channelNameTaken", { name });
	if (code === "invalid" && place === "room") return t("channelNameInvalid");
	if (code === "conflict" && place === "member") return t("memberNameTaken", { name });
	if (code === "invalid" && place === "member" && memberNameRefused(name)) return t("memberNameInvalid");
	return place === "send" ? t("sendFailed", { message }) : t("actionFailed", { message });
}
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
		upload: (url, body, onProgress, signal) => new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open("POST", url);
			xhr.withCredentials = true;
			xhr.setRequestHeader("content-type", body.type || "application/octet-stream");
			xhr.upload.addEventListener("progress", (event) => {
				if (event.lengthComputable) onProgress(event.loaded, event.total);
			});
			xhr.addEventListener("load", () => {
				let parsed;
				try {
					parsed = JSON.parse(xhr.responseText);
				} catch {
					parsed = void 0;
				}
				resolve({
					status: xhr.status,
					body: parsed
				});
			});
			xhr.addEventListener("error", () => {
				reject(/* @__PURE__ */ new Error("Upload failed: the connection dropped"));
			});
			xhr.addEventListener("abort", () => {
				reject(/* @__PURE__ */ new Error("Upload cancelled"));
			});
			signal?.addEventListener("abort", () => {
				xhr.abort();
			}, { once: true });
			xhr.send(body);
		}),
		openEvents: (url) => new EventSource(url, { withCredentials: true }),
		url: (path) => new URL(path, document.baseURI).toString(),
		delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		random: () => Math.random()
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
	/** Consecutive reconnect attempts since the stream last opened. */
	let attempt = 0;
	/** Identifies the scheduled retry, so a stop() or a newer retry cancels it. */
	let reconnectToken;
	/** Unconfirmed messages for every room; the snapshot exposes the selected room's. */
	/** #197: how big one attachment may be, as the service reported it (state) or the collab default. */
	let uploadLimit = DEFAULT_MAX_UPLOAD_BYTES;
	/** #1445: how many characters one message may hold, as `/collab/api/state` reported it (`max_text_chars`). */
	let textLimit = DEFAULT_MAX_TEXT_CHARS;
	let outbox = [];
	/**
	* Page-back request in flight per room, tagged with the ticket and the epoch
	* it was issued under. Only a latch from the current epoch blocks a new page:
	* after a window rebuild (A → B → A, reconnect) the old request is aborted and
	* can no longer hold the room hostage until it returns.
	*/
	const paging = /* @__PURE__ */ new Map();
	/** Ticket of the newest page-back request per room, so a page that lost its race is dropped. */
	const pageTicket = /* @__PURE__ */ new Map();
	let nextPageTicket = 0;
	/**
	* Bumped whenever the cached window is rebuilt (room switch or reconnect
	* reconcile). A page-back response captured under an older epoch describes a
	* window that no longer exists, so merging it would resurrect stale rows —
	* e.g. A → B → back to A, where the room check alone passes again.
	*/
	let historyEpoch = 0;
	/** #1030: live rows newer than a trimmed window's last one, kept until `loadNewer` catches up. */
	const ahead = /* @__PURE__ */ new Map();
	let newestSeen = 0;
	const unreadIds = /* @__PURE__ */ new Map();
	const withoutUnread = (unread, roomId) => {
		if (roomId === void 0 || unread?.[String(roomId)] === void 0) return unread;
		const { [String(roomId)]: _gone, ...rest } = unread;
		return rest;
	};
	const set = (next) => {
		snapshot = {
			...snapshot,
			...next
		};
		for (const listener of listeners) listener();
	};
	/** Re-publishes the outbox, narrowed to the selected room. */
	const publishOutbox = () => {
		set({ outbox: outbox.filter((entry) => entry.roomId === snapshot.roomId) });
	};
	const request = async (path, init) => {
		const response = await transport.fetch(transport.url(path), init);
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new ServiceError(response.status, body.error ?? response.statusText, body.code);
		}
		return await response.json();
	};
	/**
	* #216: a 404 from the channel service means one of two things — no service is configured,
	* or another DSH on this machine already holds the channel data and its plugin refused to
	* start. Only the refusing instance knows which, and it publishes `busy` at
	* `collab/api/lock` before it gives up; a host without that route answers 404 there too, so
	* the plain "not configured" reading stands.
	*/
	const readLockHolder = async () => {
		try {
			const body = await request(LOCK_HOLDER_PATH);
			if (body.busy !== true) return body.free === true ? { free: true } : void 0;
			return {
				holder: body.owner ?? void 0,
				dataDir: body.dataDir,
				lock: body.lock,
				free: false
			};
		} catch (error) {
			return;
		}
	};
	const fail = async (error, current = () => true) => {
		if (error instanceof ServiceError && error.status === 404) {
			const lock = await readLockHolder();
			if (!current()) return;
			if (lock !== void 0) set({
				phase: "locked",
				lockHolder: lock.holder,
				lockDataDir: lock.dataDir,
				lockPath: lock.lock,
				lockFree: lock.free,
				error: void 0
			});
			else set({
				phase: "unavailable",
				lockHolder: void 0,
				lockDataDir: void 0,
				lockPath: void 0,
				lockFree: void 0,
				error: void 0
			});
		} else if (error instanceof ServiceError && error.status === 401) set({
			phase: "unauthorized",
			lockHolder: void 0,
			error: void 0
		});
		else set({
			phase: "error",
			error: error instanceof Error ? error.message : String(error)
		});
	};
	const earlyTasks = /* @__PURE__ */ new Map();
	const newer = (a, b) => (a?.updated_at ?? -Infinity) <= b.updated_at;
	const applyEvent = (current, event) => {
		switch (event.type) {
			case "message": {
				if (event.message.room_id !== current.roomId) {
					const m = event.message;
					const key = String(m.room_id);
					const ids = unreadIds.get(key);
					const fresh = m.id > newestSeen;
					newestSeen = Math.max(newestSeen, m.id);
					if (!fresh || ids?.has(m.id) === true || m.author_kind !== "role" || m.card !== null) return current;
					const next = ids ?? /* @__PURE__ */ new Set();
					next.add(m.id);
					unreadIds.set(key, next);
					return {
						...current,
						unread: {
							...current.unread,
							[key]: next.size
						}
					};
				}
				newestSeen = Math.max(newestSeen, event.message.id);
				const list = current.messages;
				const id = event.message.id;
				const first = list[0];
				const last = list.at(-1);
				if (current.hasMoreNewer === true && last !== void 0 && id > last.id) {
					ahead.set(id, event.message);
					return current;
				}
				if (current.hasMoreOlder && first !== void 0 && id < first.id) return current;
				if (last === void 0 || id > last.id) return {
					...current,
					messages: [...list, event.message]
				};
				const at = indexOfId(list, id);
				if (at >= 0) {
					const messages = list.slice();
					messages[at] = event.message;
					return {
						...current,
						messages
					};
				}
				const rows = new Map(list.map((m) => [m.id, m]));
				rows.set(id, event.message);
				return {
					...current,
					messages: [...rows.values()].sort((a, b) => a.id - b.id)
				};
			}
			case "deleted": return event.room_id === current.roomId ? {
				...current,
				messages: current.messages.filter((m) => m.id !== event.id).map((m) => m.reply_to?.id === event.id ? {
					...m,
					reply_to: {
						id: event.id,
						deleted: true
					}
				} : m)
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
			case "queue": return {
				...current,
				queued: {
					...current.queued,
					[String(event.room_id)]: event.queued
				}
			};
			case "rooms": return {
				...current,
				rooms: event.rooms.map((r) => ({
					...current.rooms.find((old) => old.id === r.id),
					...r
				}))
			};
			case "room-settings": return {
				...current,
				rooms: current.rooms.map((r) => r.id === event.room_id || r.parent_id === event.room_id ? {
					...r,
					lead_id: event.lead_id,
					effective_lead_id: event.effective_lead_id,
					workspace_path: event.workspace_path,
					max_relay: event.max_relay ?? r.max_relay
				} : r)
			};
			case "lead": return {
				...current,
				leadId: event.lead_id,
				effectiveLeadId: event.effective_lead_id ?? event.lead_id
			};
			case "task": {
				if (current.taskChat === void 0) {
					if (newer(earlyTasks.get(event.task.id)?.task, event.task)) earlyTasks.set(event.task.id, {
						chat: event.chat_id,
						task: event.task
					});
					return current;
				}
				if (event.chat_id !== current.taskChat) return current;
				const rows = new Map((current.tasks ?? []).map((t) => [t.id, t]));
				rows.set(event.task.id, event.task);
				return {
					...current,
					tasks: [...rows.values()].sort((a, b) => b.id - a.id)
				};
			}
			default: return current;
		}
	};
	const onEvent = (event) => {
		pending?.events.push(event);
		set(applyEvent(snapshot, event));
	};
	let boardRead;
	const loadBoard = async (owner, roomId) => {
		boardRead?.abort();
		const read = new AbortController();
		boardRead = read;
		try {
			const board = await request("collab/api/rooms/" + roomId + "/tasks", { signal: read.signal });
			if (lifetime !== owner || boardRead !== read || snapshot.roomId !== roomId) return;
			const live = snapshot.taskChat === board.chat_id ? snapshot.tasks ?? [] : [];
			const early = [...earlyTasks.values()].filter((e) => e.chat === board.chat_id).map((e) => e.task);
			earlyTasks.clear();
			const rows = new Map(board.tasks.map((t) => [t.id, t]));
			for (const t of [...live, ...early]) if (newer(rows.get(t.id), t)) rows.set(t.id, t);
			set({
				tasks: [...rows.values()].sort((a, b) => b.id - a.id),
				taskChat: board.chat_id
			});
		} catch (error) {} finally {
			if (boardRead === read) boardRead = void 0;
		}
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
			if (Number.isSafeInteger(state.max_upload_bytes) && (state.max_upload_bytes ?? 0) > 0) uploadLimit = state.max_upload_bytes;
			if (Number.isSafeInteger(state.max_text_chars) && (state.max_text_chars ?? 0) > 0) textLimit = state.max_text_chars;
			const remembered = previous.roomId === void 0 ? rememberedRoom() : void 0;
			const roomId = state.rooms.some((r) => r.id === previous.roomId) ? previous.roomId : state.rooms.some((r) => r.id === remembered) ? remembered : state.rooms[0]?.id;
			const rows = [];
			let hasMoreOlder = false;
			let hasMoreNewer = false;
			ahead.clear();
			if (roomId !== void 0) {
				if (resume && roomId === previous.roomId && previous.messages.length > 0) {
					const merged = new Map(previous.messages.map((m) => [m.id, m]));
					const oldest = previous.messages[0].id;
					const newest = previous.hasMoreNewer === true ? previous.messages.at(-1).id : void 0;
					const present = /* @__PURE__ */ new Set();
					let cursor = oldest - 1;
					while (current()) {
						const { messages } = await request("collab/api/rooms/" + roomId + "/messages?after=" + cursor + "&limit=200", { signal: read.controller.signal });
						if (!current()) return;
						for (const row of messages) {
							merged.set(row.id, row);
							present.add(row.id);
						}
						if (messages.length < CATCH_UP_LIMIT) break;
						const next = messages.at(-1)?.id;
						if (next === void 0 || next <= cursor) throw new Error("Channel history cursor did not advance");
						if (newest !== void 0 && next >= newest) break;
						cursor = next;
					}
					for (const id of [...merged.keys()]) if (id >= oldest && !present.has(id) || newest !== void 0 && id > newest) merged.delete(id);
					historyEpoch += 1;
					rows.push(...[...merged.values()].sort((a, b) => a.id - b.id));
					hasMoreOlder = previous.hasMoreOlder;
					hasMoreNewer = newest !== void 0;
				} else {
					let after;
					while (current()) {
						const query = after === void 0 ? "limit=100" : "after=" + after + "&limit=200";
						const { messages } = await request("collab/api/rooms/" + roomId + "/messages?" + query, { signal: read.controller.signal });
						if (!current()) return;
						rows.push(...messages);
						if (after === void 0) {
							hasMoreOlder = messages.length >= PAGE_SIZE;
							break;
						}
						if (messages.length < CATCH_UP_LIMIT) break;
						const next = messages.at(-1)?.id;
						if (next === void 0 || next <= after) throw new Error("Channel history cursor did not advance");
						after = next;
					}
				}
			}
			const keepBoard = roomId === previous.roomId;
			if (!keepBoard) earlyTasks.clear();
			let next = {
				phase: "ready",
				error: void 0,
				lockHolder: void 0,
				lockDataDir: void 0,
				lockPath: void 0,
				lockFree: void 0,
				rooms: state.rooms,
				roomId,
				members: state.members,
				thinking: state.thinking,
				queued: state.queued ?? {},
				messages: rows,
				hasMoreOlder,
				hasMoreNewer,
				leadId: state.lead_id ?? null,
				effectiveLeadId: state.effective_lead_id ?? state.lead_id ?? null,
				maxUploadBytes: uploadLimit,
				maxTextChars: textLimit,
				tasks: keepBoard ? previous.tasks : [],
				taskChat: keepBoard ? previous.taskChat : void 0,
				outbox: outbox.filter((entry) => entry.roomId === roomId)
			};
			for (const row of rows) newestSeen = Math.max(newestSeen, row.id);
			if (roomId !== void 0) unreadIds.delete(String(roomId));
			next = {
				...next,
				unread: withoutUnread(snapshot.unread, roomId)
			};
			for (const event of read.events) next = applyEvent(next, event);
			pending = void 0;
			set(next);
			if (roomId !== void 0) loadBoard(owner, roomId);
		} catch (error) {
			if (!current()) return;
			await fail(error, current);
			if (pending === read) pending = void 0;
		}
	};
	const selectRoom = async (roomId) => {
		historyEpoch += 1;
		ahead.clear();
		rememberRoom(roomId);
		if (roomId !== snapshot.roomId) earlyTasks.clear();
		const shown = outbox.filter((entry) => entry.roomId === roomId);
		unreadIds.delete(String(roomId));
		const unread = withoutUnread(snapshot.unread, roomId);
		set(roomId === snapshot.roomId ? {
			roomId,
			messages: [],
			hasMoreNewer: false,
			outbox: shown,
			unread
		} : {
			roomId,
			messages: [],
			hasMoreNewer: false,
			outbox: shown,
			tasks: [],
			taskChat: void 0,
			unread
		});
		await refresh(false);
	};
	/** Wait before the next attempt; tests inject a fake so no clock is needed. */
	const pause = (ms) => transport.delay === void 0 ? Promise.resolve() : transport.delay(ms);
	/** Jitter source in `[0, 1)`. */
	const random = () => transport.random?.() ?? .5;
	/** Backoff before retry `attempt`: 1, 2, 4, 8… seconds, capped, then jittered. */
	const backoffMs = (attempt) => {
		const base = Math.min(1e3 * 2 ** attempt, MAX_BACKOFF_MS);
		return Math.round(base / 2 + random() * (base / 2));
	};
	/** Opens the live stream; `onerror` schedules a backoff retry (design §4.3). */
	const listen = (owner) => {
		if (lifetime !== owner || listeners.size === 0) return;
		let events;
		try {
			events = transport.openEvents(transport.url("collab/api/events"));
		} catch (error) {
			fail(error);
			return;
		}
		stream = events;
		events.onopen = () => {
			if (lifetime !== owner || stream !== events) return;
			attempt = 0;
			refresh(true);
		};
		events.onerror = () => {
			if (lifetime !== owner || stream !== events) return;
			stream = void 0;
			events.onopen = null;
			events.onmessage = null;
			events.onerror = null;
			events.close();
			pending?.controller.abort();
			pending = void 0;
			retry(owner);
			refresh(true);
		};
		events.onmessage = (event) => {
			if (lifetime !== owner || stream !== events) return;
			try {
				onEvent(JSON.parse(event.data));
			} catch (error) {}
		};
	};
	/** Enters `reconnecting` and resumes the stream after a jittered backoff. */
	const retry = (owner) => {
		if (lifetime !== owner) return;
		const token = { attempt };
		reconnectToken = token;
		const wait = backoffMs(attempt);
		attempt += 1;
		if (snapshot.phase !== "locked" && snapshot.phase !== "unavailable" && snapshot.phase !== "unauthorized") set({
			phase: "reconnecting",
			error: void 0
		});
		pause(wait).then(() => {
			if (lifetime !== owner || reconnectToken !== token) return;
			reconnectToken = void 0;
			listen(owner);
		});
	};
	const start = async (owner) => {
		set({
			phase: "loading",
			error: void 0
		});
		await refresh(false);
		if (lifetime !== owner || listeners.size === 0 || snapshot.phase !== "ready") return;
		listen(owner);
	};
	const stop = () => {
		lifetime = void 0;
		reconnectToken = void 0;
		attempt = 0;
		for (const latch of paging.values()) latch.controller.abort();
		paging.clear();
		pageTicket.clear();
		pending?.controller.abort();
		pending = void 0;
		boardRead?.abort();
		boardRead = void 0;
		if (stream !== void 0) {
			stream.onopen = null;
			stream.onmessage = null;
			stream.onerror = null;
			stream.close();
			stream = void 0;
		}
	};
	const source = {
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
	};
	/**
	* Posts one message under a stable `client_key`, showing it in the outbox
	* first (design §4.3). A retry reuses the key, so the service dedupes a
	* resend whose first attempt actually landed.
	*/
	const post = async (roomId, clientKey, text, replyTo, attachments) => {
		const files = attachments !== void 0 && attachments.length > 0 ? attachments : void 0;
		const owner = lifetime;
		if (owner === void 0) throw new Error("No channel is open");
		const show = (state, error) => {
			outbox = [...outbox.filter((entry) => entry.clientKey !== clientKey), {
				clientKey,
				roomId,
				text,
				...replyTo === void 0 ? {} : { replyTo },
				...files === void 0 ? {} : { attachments: files },
				state,
				...error === void 0 ? {} : { error }
			}];
			publishOutbox();
		};
		show("sending");
		try {
			const { message } = await request(`collab/api/rooms/${roomId}/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text,
					client_key: clientKey,
					...replyTo === void 0 ? {} : { reply_to: replyTo },
					...files === void 0 ? {} : { attachments: files }
				})
			});
			if (lifetime !== owner) return;
			outbox = outbox.filter((entry) => entry.clientKey !== clientKey);
			publishOutbox();
			onEvent({
				type: "message",
				message
			});
		} catch (error) {
			if (lifetime === owner) show("failed", error instanceof Error ? error.message : String(error));
			throw error;
		}
	};
	/**
	* #197: stream one file to the service and return the metadata the message names.
	* The bytes never pass through the message JSON, so the size cap is the service's
	* `maxUploadBytes` instead of MAX_MESSAGE_BODY.
	*/
	const upload = async (file, onProgress, signal) => {
		if (file.size > uploadLimit) throw new UploadTooLarge(file.name, file.size, uploadLimit);
		if (transport.upload === void 0) throw new Error("This browser cannot stream uploads");
		const { status, body } = await transport.upload(transport.url(uploadUrl(file)), file, onProgress ?? (() => {}), signal);
		const value = body;
		if (status === 413) {
			uploadLimit = Number(value?.max_upload_bytes ?? uploadLimit);
			throw new UploadTooLarge(file.name, file.size, uploadLimit);
		}
		const stored = value?.attachment;
		if (status >= 400 || stored?.id === void 0) throw new ServiceError(status, value?.error ?? "Upload failed");
		return {
			id: stored.id,
			name: stored.name ?? file.name,
			mime: stored.mime ?? file.type,
			size: stored.size ?? file.size
		};
	};
	return {
		source,
		actions: {
			uploadAttachment: upload,
			async reviewTask(id, verdict, note) {
				const { task } = await request(`collab/api/tasks/${id}/review`, json("POST", {
					verdict,
					note
				}));
				set({ tasks: (snapshot.tasks ?? []).map((row) => row.id === task.id ? task : row) });
			},
			async terminateTask(id, action, reason, supersededBy) {
				const { task } = await request(`collab/api/tasks/${id}/${action}`, json("POST", {
					reason,
					superseded_by: supersededBy
				}));
				set({ tasks: (snapshot.tasks ?? []).map((row) => row.id === task.id ? task : row) });
			},
			async dispatchTask(roomId, { title, owner, messageId }) {
				const { task } = await request(`collab/api/rooms/${roomId}/tasks`, json("POST", {
					title,
					owner,
					ref: "无（新建）",
					message_id: messageId,
					force: true
				}));
				set({ tasks: [...(snapshot.tasks ?? []).filter((row) => row.id !== task.id), task] });
			},
			selectRoom,
			async send(text, replyTo, attachments, targetRoomId) {
				const roomId = targetRoomId ?? snapshot.roomId;
				if (roomId === void 0) throw new Error("No channel is open");
				await post(roomId, randomUUID(), text, replyTo, attachments);
			},
			async retrySend(clientKey) {
				const roomId = snapshot.roomId;
				const entry = outbox.find((row) => row.clientKey === clientKey);
				if (entry === void 0 || roomId === void 0 || entry.roomId !== roomId) throw new Error("That message does not belong to the selected channel");
				await post(entry.roomId, entry.clientKey, entry.text, entry.replyTo, entry.attachments);
			},
			dismissSend(clientKey) {
				outbox = outbox.filter((entry) => entry.clientKey !== clientKey);
				publishOutbox();
			},
			async createRoom(name) {
				const { room, workspace } = await request("collab/api/rooms", json("POST", { name }));
				const added = [room, workspace].filter((r) => r !== void 0 && !snapshot.rooms.some((s) => s.id === r.id));
				if (added.length > 0) set({ rooms: [...snapshot.rooms, ...added] });
				await selectRoom(room.id);
			},
			async openDm(memberId) {
				const { room } = await request("collab/api/dms", json("POST", { member: memberId }));
				if (!snapshot.rooms.some((r) => r.id === room.id)) set({ rooms: [...snapshot.rooms, room] });
				await selectRoom(room.id);
			},
			async closeDm(roomId) {
				await request(`collab/api/dms/${roomId}`, { method: "DELETE" });
				const rooms = snapshot.rooms.filter((r) => r.id !== roomId);
				set({ rooms });
				const next = rooms.find((r) => r.kind !== "workspace" && r.dm_member == null);
				if (snapshot.roomId === roomId && next !== void 0) await selectRoom(next.id);
			},
			async renameRoom(roomId, name) {
				const { room } = await request(`collab/api/rooms/${roomId}`, json("PATCH", { name }));
				set({ rooms: snapshot.rooms.map((r) => r.id === roomId ? {
					...r,
					...room
				} : r) });
			},
			async listModels() {
				const { routes } = await request("collab/api/models");
				return routes;
			},
			async listPersonas() {
				return await request("collab/api/personas");
			},
			async listClis() {
				return await request("collab/api/clis");
			},
			async addMember(input) {
				const roomId = snapshot.roomId;
				if (roomId === void 0) throw new Error("No channel is open");
				const chatId = snapshot.rooms.find((r) => r.id === roomId)?.parent_id ?? roomId;
				const { avatarPng, ...fields } = input;
				const { member } = await request("collab/api/members", json("POST", {
					...fields,
					rooms: [chatId]
				}));
				if (avatarPng) try {
					await request(`collab/api/members/${encodeURIComponent(member.id)}/avatar`, json("POST", { png: avatarPng }));
				} catch (error) {
					await request(`collab/api/members/${encodeURIComponent(member.id)}`, { method: "DELETE" });
					throw error;
				}
			},
			async updateMember(id, input) {
				await request(`collab/api/members/${encodeURIComponent(id)}`, json("PATCH", input));
			},
			async removeMember(id) {
				await request(`collab/api/members/${encodeURIComponent(id)}`, { method: "DELETE" });
			},
			async setDispatchMode(roomId, mode) {
				const result = await request(`collab/api/rooms/${roomId}/mode`, json("PATCH", { dispatch_mode: mode }));
				const chatId = snapshot.rooms.find((r) => r.id === roomId)?.parent_id ?? roomId;
				set({ rooms: snapshot.rooms.map((r) => r.id === chatId || r.parent_id === chatId ? {
					...r,
					...result
				} : r) });
			},
			async setMaxRelay(roomId, maxRelay) {
				const result = await request(`collab/api/rooms/${roomId}/settings`, json("PATCH", { max_relay: maxRelay }));
				const chat = snapshot.rooms.find((r) => r.id === roomId)?.parent_id ?? roomId;
				if (lifetime !== void 0) onEvent({
					type: "room-settings",
					room_id: chat,
					...result
				});
			},
			async setLead(id, roomId = snapshot.roomId) {
				if (roomId === void 0) throw new Error("No channel is open");
				const result = await request(`collab/api/rooms/${roomId}/settings`, json("PATCH", { lead_id: id }));
				const chat = snapshot.rooms.find((r) => r.id === roomId)?.parent_id ?? roomId;
				if (lifetime !== void 0) onEvent({
					type: "room-settings",
					room_id: chat,
					...result
				});
			},
			async setWorkspacePath(roomId, path) {
				const result = await request(`collab/api/rooms/${roomId}/settings`, json("PATCH", { workspace_path: path }));
				const chat = snapshot.rooms.find((r) => r.id === roomId)?.parent_id ?? roomId;
				if (lifetime !== void 0) onEvent({
					type: "room-settings",
					room_id: chat,
					...result
				});
			},
			async renewRoom(roomId) {
				await request(`collab/api/rooms/${roomId}/renew`, json("POST", {}));
			},
			async decidePermission(messageId, decision) {
				const owner = lifetime;
				const { message } = await request(`collab/api/messages/${messageId}/permission`, json("POST", { decision }));
				if (lifetime === owner) onEvent({
					type: "message",
					message
				});
			},
			async loadOlder() {
				const roomId = snapshot.roomId;
				const owner = lifetime;
				const oldest = snapshot.messages[0]?.id;
				if (roomId === void 0 || owner === void 0) throw new Error("No channel is open");
				const held = paging.get(roomId);
				if (held !== void 0 && held.epoch === historyEpoch) return 0;
				if (oldest === void 0 || !snapshot.hasMoreOlder) return 0;
				held?.controller.abort();
				const ticket = ++nextPageTicket;
				const epoch = historyEpoch;
				const controller = new AbortController();
				paging.set(roomId, {
					ticket,
					epoch,
					controller
				});
				pageTicket.set(roomId, ticket);
				try {
					let messages;
					try {
						({messages} = await request(`collab/api/rooms/${roomId}/messages?before=${oldest}&limit=${PAGE_SIZE}`, { signal: controller.signal }));
					} catch (error) {
						if (controller.signal.aborted) return 0;
						throw error;
					}
					if (controller.signal.aborted) return 0;
					if (lifetime !== owner || snapshot.roomId !== roomId) return 0;
					if (epoch !== historyEpoch || pageTicket.get(roomId) !== ticket) return 0;
					const merged = new Map(snapshot.messages.map((m) => [m.id, m]));
					for (const row of messages) merged.set(row.id, row);
					const rows = [...merged.values()].sort((a, b) => a.id - b.id);
					const trimmed = rows.length > 300;
					if (trimmed) ahead.clear();
					set({
						messages: trimmed ? rows.slice(0, 300) : rows,
						hasMoreOlder: messages.length >= PAGE_SIZE,
						...trimmed ? { hasMoreNewer: true } : {}
					});
					return messages.length;
				} finally {
					if (paging.get(roomId)?.ticket === ticket) paging.delete(roomId);
				}
			},
			async loadNewer() {
				const roomId = snapshot.roomId;
				const owner = lifetime;
				const newest = snapshot.messages.at(-1)?.id;
				if (roomId === void 0 || owner === void 0) throw new Error("No channel is open");
				const held = paging.get(roomId);
				if (held !== void 0 && held.epoch === historyEpoch) return 0;
				if (newest === void 0 || snapshot.hasMoreNewer !== true) return 0;
				held?.controller.abort();
				const ticket = ++nextPageTicket;
				const epoch = historyEpoch;
				const controller = new AbortController();
				paging.set(roomId, {
					ticket,
					epoch,
					controller
				});
				pageTicket.set(roomId, ticket);
				try {
					let messages;
					try {
						({messages} = await request(`collab/api/rooms/${roomId}/messages?after=${newest}&limit=${PAGE_SIZE}`, { signal: controller.signal }));
					} catch (error) {
						if (controller.signal.aborted) return 0;
						throw error;
					}
					if (controller.signal.aborted) return 0;
					if (lifetime !== owner || snapshot.roomId !== roomId) return 0;
					if (epoch !== historyEpoch || pageTicket.get(roomId) !== ticket) return 0;
					const merged = new Map(snapshot.messages.map((m) => [m.id, m]));
					for (const row of messages) merged.set(row.id, row);
					const caughtUp = messages.length < PAGE_SIZE;
					if (caughtUp) for (const row of ahead.values()) merged.set(row.id, row);
					if (caughtUp) ahead.clear();
					const rows = [...merged.values()].sort((a, b) => a.id - b.id);
					const trimmed = rows.length > 300;
					set({
						messages: trimmed ? rows.slice(-300) : rows,
						hasMoreNewer: !caughtUp,
						...trimmed ? { hasMoreOlder: true } : {}
					});
					return messages.length;
				} finally {
					if (paging.get(roomId)?.ticket === ticket) paging.delete(roomId);
				}
			},
			keepLatest() {
				if (snapshot.hasMoreNewer === true || snapshot.messages.length <= 300) return;
				historyEpoch += 1;
				set({
					messages: snapshot.messages.slice(-300),
					hasMoreOlder: true
				});
			},
			async showLatest() {
				const roomId = snapshot.roomId;
				const owner = lifetime;
				if (roomId === void 0 || owner === void 0 || snapshot.hasMoreNewer !== true) return;
				historyEpoch += 1;
				const epoch = historyEpoch;
				const { messages } = await request(`collab/api/rooms/${roomId}/messages?limit=${PAGE_SIZE}`);
				if (lifetime !== owner || snapshot.roomId !== roomId || epoch !== historyEpoch) return;
				const merged = new Map(messages.map((m) => [m.id, m]));
				const last = messages.at(-1)?.id ?? Number.NEGATIVE_INFINITY;
				for (const row of ahead.values()) if (row.id > last) merged.set(row.id, row);
				ahead.clear();
				set({
					messages: [...merged.values()].sort((a, b) => a.id - b.id),
					hasMoreOlder: messages.length >= PAGE_SIZE,
					hasMoreNewer: false
				});
			},
			async retryMessage(messageId) {
				await request(`collab/api/messages/${messageId}/retry`, { method: "POST" });
			},
			async editMessage(messageId, text) {
				const owner = lifetime;
				const { message } = await request(`collab/api/messages/${messageId}`, json("PATCH", { text }));
				if (lifetime === owner) onEvent({
					type: "message",
					message
				});
			},
			async withdrawMessage(messageId) {
				const owner = lifetime;
				const roomId = snapshot.roomId;
				const { stopped, still_running } = await request(`collab/api/messages/${messageId}`, { method: "DELETE" });
				if (lifetime === owner && roomId !== void 0) onEvent({
					type: "deleted",
					id: messageId,
					room_id: roomId
				});
				return {
					stopped: stopped ?? [],
					stillRunning: still_running ?? []
				};
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
/**
* @typedef {import('mdast').Nodes} Nodes
*
* @typedef Options
*   Configuration (optional).
* @property {boolean | null | undefined} [includeImageAlt=true]
*   Whether to use `alt` for `image`s (default: `true`).
* @property {boolean | null | undefined} [includeHtml=true]
*   Whether to use `value` of HTML (default: `true`).
*/
/** @type {Options} */
const emptyOptions = {};
/**
* Get the text content of a node or list of nodes.
*
* Prefers the node’s plain-text fields, otherwise serializes its children,
* and if the given value is an array, serialize the nodes in it.
*
* @param {unknown} [value]
*   Thing to serialize, typically `Node`.
* @param {Options | null | undefined} [options]
*   Configuration (optional).
* @returns {string}
*   Serialized `value`.
*/
function toString(value, options) {
	const settings = options || emptyOptions;
	return one(value, typeof settings.includeImageAlt === "boolean" ? settings.includeImageAlt : true, typeof settings.includeHtml === "boolean" ? settings.includeHtml : true);
}
/**
* One node or several nodes.
*
* @param {unknown} value
*   Thing to serialize.
* @param {boolean} includeImageAlt
*   Include image `alt`s.
* @param {boolean} includeHtml
*   Include HTML.
* @returns {string}
*   Serialized node.
*/
function one(value, includeImageAlt, includeHtml) {
	if (node(value)) {
		if ("value" in value) return value.type === "html" && !includeHtml ? "" : value.value;
		if (includeImageAlt && "alt" in value && value.alt) return value.alt;
		if ("children" in value) return all(value.children, includeImageAlt, includeHtml);
	}
	if (Array.isArray(value)) return all(value, includeImageAlt, includeHtml);
	return "";
}
/**
* Serialize a list of nodes.
*
* @param {Array<unknown>} values
*   Thing to serialize.
* @param {boolean} includeImageAlt
*   Include image `alt`s.
* @param {boolean} includeHtml
*   Include HTML.
* @returns {string}
*   Serialized nodes.
*/
function all(values, includeImageAlt, includeHtml) {
	/** @type {Array<string>} */
	const result = [];
	let index = -1;
	while (++index < values.length) result[index] = one(values[index], includeImageAlt, includeHtml);
	return result.join("");
}
/**
* Check if `value` looks like a node.
*
* @param {unknown} value
*   Thing.
* @returns {value is Nodes}
*   Whether `value` is a node.
*/
function node(value) {
	return Boolean(value && typeof value === "object");
}
/**
* Map of named character references.
*
* @type {Record<string, string>}
*/
const characterEntities = {
	AElig: "Æ",
	AMP: "&",
	Aacute: "Á",
	Abreve: "Ă",
	Acirc: "Â",
	Acy: "А",
	Afr: "𝔄",
	Agrave: "À",
	Alpha: "Α",
	Amacr: "Ā",
	And: "⩓",
	Aogon: "Ą",
	Aopf: "𝔸",
	ApplyFunction: "⁡",
	Aring: "Å",
	Ascr: "𝒜",
	Assign: "≔",
	Atilde: "Ã",
	Auml: "Ä",
	Backslash: "∖",
	Barv: "⫧",
	Barwed: "⌆",
	Bcy: "Б",
	Because: "∵",
	Bernoullis: "ℬ",
	Beta: "Β",
	Bfr: "𝔅",
	Bopf: "𝔹",
	Breve: "˘",
	Bscr: "ℬ",
	Bumpeq: "≎",
	CHcy: "Ч",
	COPY: "©",
	Cacute: "Ć",
	Cap: "⋒",
	CapitalDifferentialD: "ⅅ",
	Cayleys: "ℭ",
	Ccaron: "Č",
	Ccedil: "Ç",
	Ccirc: "Ĉ",
	Cconint: "∰",
	Cdot: "Ċ",
	Cedilla: "¸",
	CenterDot: "·",
	Cfr: "ℭ",
	Chi: "Χ",
	CircleDot: "⊙",
	CircleMinus: "⊖",
	CirclePlus: "⊕",
	CircleTimes: "⊗",
	ClockwiseContourIntegral: "∲",
	CloseCurlyDoubleQuote: "”",
	CloseCurlyQuote: "’",
	Colon: "∷",
	Colone: "⩴",
	Congruent: "≡",
	Conint: "∯",
	ContourIntegral: "∮",
	Copf: "ℂ",
	Coproduct: "∐",
	CounterClockwiseContourIntegral: "∳",
	Cross: "⨯",
	Cscr: "𝒞",
	Cup: "⋓",
	CupCap: "≍",
	DD: "ⅅ",
	DDotrahd: "⤑",
	DJcy: "Ђ",
	DScy: "Ѕ",
	DZcy: "Џ",
	Dagger: "‡",
	Darr: "↡",
	Dashv: "⫤",
	Dcaron: "Ď",
	Dcy: "Д",
	Del: "∇",
	Delta: "Δ",
	Dfr: "𝔇",
	DiacriticalAcute: "´",
	DiacriticalDot: "˙",
	DiacriticalDoubleAcute: "˝",
	DiacriticalGrave: "`",
	DiacriticalTilde: "˜",
	Diamond: "⋄",
	DifferentialD: "ⅆ",
	Dopf: "𝔻",
	Dot: "¨",
	DotDot: "⃜",
	DotEqual: "≐",
	DoubleContourIntegral: "∯",
	DoubleDot: "¨",
	DoubleDownArrow: "⇓",
	DoubleLeftArrow: "⇐",
	DoubleLeftRightArrow: "⇔",
	DoubleLeftTee: "⫤",
	DoubleLongLeftArrow: "⟸",
	DoubleLongLeftRightArrow: "⟺",
	DoubleLongRightArrow: "⟹",
	DoubleRightArrow: "⇒",
	DoubleRightTee: "⊨",
	DoubleUpArrow: "⇑",
	DoubleUpDownArrow: "⇕",
	DoubleVerticalBar: "∥",
	DownArrow: "↓",
	DownArrowBar: "⤓",
	DownArrowUpArrow: "⇵",
	DownBreve: "̑",
	DownLeftRightVector: "⥐",
	DownLeftTeeVector: "⥞",
	DownLeftVector: "↽",
	DownLeftVectorBar: "⥖",
	DownRightTeeVector: "⥟",
	DownRightVector: "⇁",
	DownRightVectorBar: "⥗",
	DownTee: "⊤",
	DownTeeArrow: "↧",
	Downarrow: "⇓",
	Dscr: "𝒟",
	Dstrok: "Đ",
	ENG: "Ŋ",
	ETH: "Ð",
	Eacute: "É",
	Ecaron: "Ě",
	Ecirc: "Ê",
	Ecy: "Э",
	Edot: "Ė",
	Efr: "𝔈",
	Egrave: "È",
	Element: "∈",
	Emacr: "Ē",
	EmptySmallSquare: "◻",
	EmptyVerySmallSquare: "▫",
	Eogon: "Ę",
	Eopf: "𝔼",
	Epsilon: "Ε",
	Equal: "⩵",
	EqualTilde: "≂",
	Equilibrium: "⇌",
	Escr: "ℰ",
	Esim: "⩳",
	Eta: "Η",
	Euml: "Ë",
	Exists: "∃",
	ExponentialE: "ⅇ",
	Fcy: "Ф",
	Ffr: "𝔉",
	FilledSmallSquare: "◼",
	FilledVerySmallSquare: "▪",
	Fopf: "𝔽",
	ForAll: "∀",
	Fouriertrf: "ℱ",
	Fscr: "ℱ",
	GJcy: "Ѓ",
	GT: ">",
	Gamma: "Γ",
	Gammad: "Ϝ",
	Gbreve: "Ğ",
	Gcedil: "Ģ",
	Gcirc: "Ĝ",
	Gcy: "Г",
	Gdot: "Ġ",
	Gfr: "𝔊",
	Gg: "⋙",
	Gopf: "𝔾",
	GreaterEqual: "≥",
	GreaterEqualLess: "⋛",
	GreaterFullEqual: "≧",
	GreaterGreater: "⪢",
	GreaterLess: "≷",
	GreaterSlantEqual: "⩾",
	GreaterTilde: "≳",
	Gscr: "𝒢",
	Gt: "≫",
	HARDcy: "Ъ",
	Hacek: "ˇ",
	Hat: "^",
	Hcirc: "Ĥ",
	Hfr: "ℌ",
	HilbertSpace: "ℋ",
	Hopf: "ℍ",
	HorizontalLine: "─",
	Hscr: "ℋ",
	Hstrok: "Ħ",
	HumpDownHump: "≎",
	HumpEqual: "≏",
	IEcy: "Е",
	IJlig: "Ĳ",
	IOcy: "Ё",
	Iacute: "Í",
	Icirc: "Î",
	Icy: "И",
	Idot: "İ",
	Ifr: "ℑ",
	Igrave: "Ì",
	Im: "ℑ",
	Imacr: "Ī",
	ImaginaryI: "ⅈ",
	Implies: "⇒",
	Int: "∬",
	Integral: "∫",
	Intersection: "⋂",
	InvisibleComma: "⁣",
	InvisibleTimes: "⁢",
	Iogon: "Į",
	Iopf: "𝕀",
	Iota: "Ι",
	Iscr: "ℐ",
	Itilde: "Ĩ",
	Iukcy: "І",
	Iuml: "Ï",
	Jcirc: "Ĵ",
	Jcy: "Й",
	Jfr: "𝔍",
	Jopf: "𝕁",
	Jscr: "𝒥",
	Jsercy: "Ј",
	Jukcy: "Є",
	KHcy: "Х",
	KJcy: "Ќ",
	Kappa: "Κ",
	Kcedil: "Ķ",
	Kcy: "К",
	Kfr: "𝔎",
	Kopf: "𝕂",
	Kscr: "𝒦",
	LJcy: "Љ",
	LT: "<",
	Lacute: "Ĺ",
	Lambda: "Λ",
	Lang: "⟪",
	Laplacetrf: "ℒ",
	Larr: "↞",
	Lcaron: "Ľ",
	Lcedil: "Ļ",
	Lcy: "Л",
	LeftAngleBracket: "⟨",
	LeftArrow: "←",
	LeftArrowBar: "⇤",
	LeftArrowRightArrow: "⇆",
	LeftCeiling: "⌈",
	LeftDoubleBracket: "⟦",
	LeftDownTeeVector: "⥡",
	LeftDownVector: "⇃",
	LeftDownVectorBar: "⥙",
	LeftFloor: "⌊",
	LeftRightArrow: "↔",
	LeftRightVector: "⥎",
	LeftTee: "⊣",
	LeftTeeArrow: "↤",
	LeftTeeVector: "⥚",
	LeftTriangle: "⊲",
	LeftTriangleBar: "⧏",
	LeftTriangleEqual: "⊴",
	LeftUpDownVector: "⥑",
	LeftUpTeeVector: "⥠",
	LeftUpVector: "↿",
	LeftUpVectorBar: "⥘",
	LeftVector: "↼",
	LeftVectorBar: "⥒",
	Leftarrow: "⇐",
	Leftrightarrow: "⇔",
	LessEqualGreater: "⋚",
	LessFullEqual: "≦",
	LessGreater: "≶",
	LessLess: "⪡",
	LessSlantEqual: "⩽",
	LessTilde: "≲",
	Lfr: "𝔏",
	Ll: "⋘",
	Lleftarrow: "⇚",
	Lmidot: "Ŀ",
	LongLeftArrow: "⟵",
	LongLeftRightArrow: "⟷",
	LongRightArrow: "⟶",
	Longleftarrow: "⟸",
	Longleftrightarrow: "⟺",
	Longrightarrow: "⟹",
	Lopf: "𝕃",
	LowerLeftArrow: "↙",
	LowerRightArrow: "↘",
	Lscr: "ℒ",
	Lsh: "↰",
	Lstrok: "Ł",
	Lt: "≪",
	Map: "⤅",
	Mcy: "М",
	MediumSpace: " ",
	Mellintrf: "ℳ",
	Mfr: "𝔐",
	MinusPlus: "∓",
	Mopf: "𝕄",
	Mscr: "ℳ",
	Mu: "Μ",
	NJcy: "Њ",
	Nacute: "Ń",
	Ncaron: "Ň",
	Ncedil: "Ņ",
	Ncy: "Н",
	NegativeMediumSpace: "​",
	NegativeThickSpace: "​",
	NegativeThinSpace: "​",
	NegativeVeryThinSpace: "​",
	NestedGreaterGreater: "≫",
	NestedLessLess: "≪",
	NewLine: "\n",
	Nfr: "𝔑",
	NoBreak: "⁠",
	NonBreakingSpace: "\xA0",
	Nopf: "ℕ",
	Not: "⫬",
	NotCongruent: "≢",
	NotCupCap: "≭",
	NotDoubleVerticalBar: "∦",
	NotElement: "∉",
	NotEqual: "≠",
	NotEqualTilde: "≂̸",
	NotExists: "∄",
	NotGreater: "≯",
	NotGreaterEqual: "≱",
	NotGreaterFullEqual: "≧̸",
	NotGreaterGreater: "≫̸",
	NotGreaterLess: "≹",
	NotGreaterSlantEqual: "⩾̸",
	NotGreaterTilde: "≵",
	NotHumpDownHump: "≎̸",
	NotHumpEqual: "≏̸",
	NotLeftTriangle: "⋪",
	NotLeftTriangleBar: "⧏̸",
	NotLeftTriangleEqual: "⋬",
	NotLess: "≮",
	NotLessEqual: "≰",
	NotLessGreater: "≸",
	NotLessLess: "≪̸",
	NotLessSlantEqual: "⩽̸",
	NotLessTilde: "≴",
	NotNestedGreaterGreater: "⪢̸",
	NotNestedLessLess: "⪡̸",
	NotPrecedes: "⊀",
	NotPrecedesEqual: "⪯̸",
	NotPrecedesSlantEqual: "⋠",
	NotReverseElement: "∌",
	NotRightTriangle: "⋫",
	NotRightTriangleBar: "⧐̸",
	NotRightTriangleEqual: "⋭",
	NotSquareSubset: "⊏̸",
	NotSquareSubsetEqual: "⋢",
	NotSquareSuperset: "⊐̸",
	NotSquareSupersetEqual: "⋣",
	NotSubset: "⊂⃒",
	NotSubsetEqual: "⊈",
	NotSucceeds: "⊁",
	NotSucceedsEqual: "⪰̸",
	NotSucceedsSlantEqual: "⋡",
	NotSucceedsTilde: "≿̸",
	NotSuperset: "⊃⃒",
	NotSupersetEqual: "⊉",
	NotTilde: "≁",
	NotTildeEqual: "≄",
	NotTildeFullEqual: "≇",
	NotTildeTilde: "≉",
	NotVerticalBar: "∤",
	Nscr: "𝒩",
	Ntilde: "Ñ",
	Nu: "Ν",
	OElig: "Œ",
	Oacute: "Ó",
	Ocirc: "Ô",
	Ocy: "О",
	Odblac: "Ő",
	Ofr: "𝔒",
	Ograve: "Ò",
	Omacr: "Ō",
	Omega: "Ω",
	Omicron: "Ο",
	Oopf: "𝕆",
	OpenCurlyDoubleQuote: "“",
	OpenCurlyQuote: "‘",
	Or: "⩔",
	Oscr: "𝒪",
	Oslash: "Ø",
	Otilde: "Õ",
	Otimes: "⨷",
	Ouml: "Ö",
	OverBar: "‾",
	OverBrace: "⏞",
	OverBracket: "⎴",
	OverParenthesis: "⏜",
	PartialD: "∂",
	Pcy: "П",
	Pfr: "𝔓",
	Phi: "Φ",
	Pi: "Π",
	PlusMinus: "±",
	Poincareplane: "ℌ",
	Popf: "ℙ",
	Pr: "⪻",
	Precedes: "≺",
	PrecedesEqual: "⪯",
	PrecedesSlantEqual: "≼",
	PrecedesTilde: "≾",
	Prime: "″",
	Product: "∏",
	Proportion: "∷",
	Proportional: "∝",
	Pscr: "𝒫",
	Psi: "Ψ",
	QUOT: "\"",
	Qfr: "𝔔",
	Qopf: "ℚ",
	Qscr: "𝒬",
	RBarr: "⤐",
	REG: "®",
	Racute: "Ŕ",
	Rang: "⟫",
	Rarr: "↠",
	Rarrtl: "⤖",
	Rcaron: "Ř",
	Rcedil: "Ŗ",
	Rcy: "Р",
	Re: "ℜ",
	ReverseElement: "∋",
	ReverseEquilibrium: "⇋",
	ReverseUpEquilibrium: "⥯",
	Rfr: "ℜ",
	Rho: "Ρ",
	RightAngleBracket: "⟩",
	RightArrow: "→",
	RightArrowBar: "⇥",
	RightArrowLeftArrow: "⇄",
	RightCeiling: "⌉",
	RightDoubleBracket: "⟧",
	RightDownTeeVector: "⥝",
	RightDownVector: "⇂",
	RightDownVectorBar: "⥕",
	RightFloor: "⌋",
	RightTee: "⊢",
	RightTeeArrow: "↦",
	RightTeeVector: "⥛",
	RightTriangle: "⊳",
	RightTriangleBar: "⧐",
	RightTriangleEqual: "⊵",
	RightUpDownVector: "⥏",
	RightUpTeeVector: "⥜",
	RightUpVector: "↾",
	RightUpVectorBar: "⥔",
	RightVector: "⇀",
	RightVectorBar: "⥓",
	Rightarrow: "⇒",
	Ropf: "ℝ",
	RoundImplies: "⥰",
	Rrightarrow: "⇛",
	Rscr: "ℛ",
	Rsh: "↱",
	RuleDelayed: "⧴",
	SHCHcy: "Щ",
	SHcy: "Ш",
	SOFTcy: "Ь",
	Sacute: "Ś",
	Sc: "⪼",
	Scaron: "Š",
	Scedil: "Ş",
	Scirc: "Ŝ",
	Scy: "С",
	Sfr: "𝔖",
	ShortDownArrow: "↓",
	ShortLeftArrow: "←",
	ShortRightArrow: "→",
	ShortUpArrow: "↑",
	Sigma: "Σ",
	SmallCircle: "∘",
	Sopf: "𝕊",
	Sqrt: "√",
	Square: "□",
	SquareIntersection: "⊓",
	SquareSubset: "⊏",
	SquareSubsetEqual: "⊑",
	SquareSuperset: "⊐",
	SquareSupersetEqual: "⊒",
	SquareUnion: "⊔",
	Sscr: "𝒮",
	Star: "⋆",
	Sub: "⋐",
	Subset: "⋐",
	SubsetEqual: "⊆",
	Succeeds: "≻",
	SucceedsEqual: "⪰",
	SucceedsSlantEqual: "≽",
	SucceedsTilde: "≿",
	SuchThat: "∋",
	Sum: "∑",
	Sup: "⋑",
	Superset: "⊃",
	SupersetEqual: "⊇",
	Supset: "⋑",
	THORN: "Þ",
	TRADE: "™",
	TSHcy: "Ћ",
	TScy: "Ц",
	Tab: "	",
	Tau: "Τ",
	Tcaron: "Ť",
	Tcedil: "Ţ",
	Tcy: "Т",
	Tfr: "𝔗",
	Therefore: "∴",
	Theta: "Θ",
	ThickSpace: "  ",
	ThinSpace: " ",
	Tilde: "∼",
	TildeEqual: "≃",
	TildeFullEqual: "≅",
	TildeTilde: "≈",
	Topf: "𝕋",
	TripleDot: "⃛",
	Tscr: "𝒯",
	Tstrok: "Ŧ",
	Uacute: "Ú",
	Uarr: "↟",
	Uarrocir: "⥉",
	Ubrcy: "Ў",
	Ubreve: "Ŭ",
	Ucirc: "Û",
	Ucy: "У",
	Udblac: "Ű",
	Ufr: "𝔘",
	Ugrave: "Ù",
	Umacr: "Ū",
	UnderBar: "_",
	UnderBrace: "⏟",
	UnderBracket: "⎵",
	UnderParenthesis: "⏝",
	Union: "⋃",
	UnionPlus: "⊎",
	Uogon: "Ų",
	Uopf: "𝕌",
	UpArrow: "↑",
	UpArrowBar: "⤒",
	UpArrowDownArrow: "⇅",
	UpDownArrow: "↕",
	UpEquilibrium: "⥮",
	UpTee: "⊥",
	UpTeeArrow: "↥",
	Uparrow: "⇑",
	Updownarrow: "⇕",
	UpperLeftArrow: "↖",
	UpperRightArrow: "↗",
	Upsi: "ϒ",
	Upsilon: "Υ",
	Uring: "Ů",
	Uscr: "𝒰",
	Utilde: "Ũ",
	Uuml: "Ü",
	VDash: "⊫",
	Vbar: "⫫",
	Vcy: "В",
	Vdash: "⊩",
	Vdashl: "⫦",
	Vee: "⋁",
	Verbar: "‖",
	Vert: "‖",
	VerticalBar: "∣",
	VerticalLine: "|",
	VerticalSeparator: "❘",
	VerticalTilde: "≀",
	VeryThinSpace: " ",
	Vfr: "𝔙",
	Vopf: "𝕍",
	Vscr: "𝒱",
	Vvdash: "⊪",
	Wcirc: "Ŵ",
	Wedge: "⋀",
	Wfr: "𝔚",
	Wopf: "𝕎",
	Wscr: "𝒲",
	Xfr: "𝔛",
	Xi: "Ξ",
	Xopf: "𝕏",
	Xscr: "𝒳",
	YAcy: "Я",
	YIcy: "Ї",
	YUcy: "Ю",
	Yacute: "Ý",
	Ycirc: "Ŷ",
	Ycy: "Ы",
	Yfr: "𝔜",
	Yopf: "𝕐",
	Yscr: "𝒴",
	Yuml: "Ÿ",
	ZHcy: "Ж",
	Zacute: "Ź",
	Zcaron: "Ž",
	Zcy: "З",
	Zdot: "Ż",
	ZeroWidthSpace: "​",
	Zeta: "Ζ",
	Zfr: "ℨ",
	Zopf: "ℤ",
	Zscr: "𝒵",
	aacute: "á",
	abreve: "ă",
	ac: "∾",
	acE: "∾̳",
	acd: "∿",
	acirc: "â",
	acute: "´",
	acy: "а",
	aelig: "æ",
	af: "⁡",
	afr: "𝔞",
	agrave: "à",
	alefsym: "ℵ",
	aleph: "ℵ",
	alpha: "α",
	amacr: "ā",
	amalg: "⨿",
	amp: "&",
	and: "∧",
	andand: "⩕",
	andd: "⩜",
	andslope: "⩘",
	andv: "⩚",
	ang: "∠",
	ange: "⦤",
	angle: "∠",
	angmsd: "∡",
	angmsdaa: "⦨",
	angmsdab: "⦩",
	angmsdac: "⦪",
	angmsdad: "⦫",
	angmsdae: "⦬",
	angmsdaf: "⦭",
	angmsdag: "⦮",
	angmsdah: "⦯",
	angrt: "∟",
	angrtvb: "⊾",
	angrtvbd: "⦝",
	angsph: "∢",
	angst: "Å",
	angzarr: "⍼",
	aogon: "ą",
	aopf: "𝕒",
	ap: "≈",
	apE: "⩰",
	apacir: "⩯",
	ape: "≊",
	apid: "≋",
	apos: "'",
	approx: "≈",
	approxeq: "≊",
	aring: "å",
	ascr: "𝒶",
	ast: "*",
	asymp: "≈",
	asympeq: "≍",
	atilde: "ã",
	auml: "ä",
	awconint: "∳",
	awint: "⨑",
	bNot: "⫭",
	backcong: "≌",
	backepsilon: "϶",
	backprime: "‵",
	backsim: "∽",
	backsimeq: "⋍",
	barvee: "⊽",
	barwed: "⌅",
	barwedge: "⌅",
	bbrk: "⎵",
	bbrktbrk: "⎶",
	bcong: "≌",
	bcy: "б",
	bdquo: "„",
	becaus: "∵",
	because: "∵",
	bemptyv: "⦰",
	bepsi: "϶",
	bernou: "ℬ",
	beta: "β",
	beth: "ℶ",
	between: "≬",
	bfr: "𝔟",
	bigcap: "⋂",
	bigcirc: "◯",
	bigcup: "⋃",
	bigodot: "⨀",
	bigoplus: "⨁",
	bigotimes: "⨂",
	bigsqcup: "⨆",
	bigstar: "★",
	bigtriangledown: "▽",
	bigtriangleup: "△",
	biguplus: "⨄",
	bigvee: "⋁",
	bigwedge: "⋀",
	bkarow: "⤍",
	blacklozenge: "⧫",
	blacksquare: "▪",
	blacktriangle: "▴",
	blacktriangledown: "▾",
	blacktriangleleft: "◂",
	blacktriangleright: "▸",
	blank: "␣",
	blk12: "▒",
	blk14: "░",
	blk34: "▓",
	block: "█",
	bne: "=⃥",
	bnequiv: "≡⃥",
	bnot: "⌐",
	bopf: "𝕓",
	bot: "⊥",
	bottom: "⊥",
	bowtie: "⋈",
	boxDL: "╗",
	boxDR: "╔",
	boxDl: "╖",
	boxDr: "╓",
	boxH: "═",
	boxHD: "╦",
	boxHU: "╩",
	boxHd: "╤",
	boxHu: "╧",
	boxUL: "╝",
	boxUR: "╚",
	boxUl: "╜",
	boxUr: "╙",
	boxV: "║",
	boxVH: "╬",
	boxVL: "╣",
	boxVR: "╠",
	boxVh: "╫",
	boxVl: "╢",
	boxVr: "╟",
	boxbox: "⧉",
	boxdL: "╕",
	boxdR: "╒",
	boxdl: "┐",
	boxdr: "┌",
	boxh: "─",
	boxhD: "╥",
	boxhU: "╨",
	boxhd: "┬",
	boxhu: "┴",
	boxminus: "⊟",
	boxplus: "⊞",
	boxtimes: "⊠",
	boxuL: "╛",
	boxuR: "╘",
	boxul: "┘",
	boxur: "└",
	boxv: "│",
	boxvH: "╪",
	boxvL: "╡",
	boxvR: "╞",
	boxvh: "┼",
	boxvl: "┤",
	boxvr: "├",
	bprime: "‵",
	breve: "˘",
	brvbar: "¦",
	bscr: "𝒷",
	bsemi: "⁏",
	bsim: "∽",
	bsime: "⋍",
	bsol: "\\",
	bsolb: "⧅",
	bsolhsub: "⟈",
	bull: "•",
	bullet: "•",
	bump: "≎",
	bumpE: "⪮",
	bumpe: "≏",
	bumpeq: "≏",
	cacute: "ć",
	cap: "∩",
	capand: "⩄",
	capbrcup: "⩉",
	capcap: "⩋",
	capcup: "⩇",
	capdot: "⩀",
	caps: "∩︀",
	caret: "⁁",
	caron: "ˇ",
	ccaps: "⩍",
	ccaron: "č",
	ccedil: "ç",
	ccirc: "ĉ",
	ccups: "⩌",
	ccupssm: "⩐",
	cdot: "ċ",
	cedil: "¸",
	cemptyv: "⦲",
	cent: "¢",
	centerdot: "·",
	cfr: "𝔠",
	chcy: "ч",
	check: "✓",
	checkmark: "✓",
	chi: "χ",
	cir: "○",
	cirE: "⧃",
	circ: "ˆ",
	circeq: "≗",
	circlearrowleft: "↺",
	circlearrowright: "↻",
	circledR: "®",
	circledS: "Ⓢ",
	circledast: "⊛",
	circledcirc: "⊚",
	circleddash: "⊝",
	cire: "≗",
	cirfnint: "⨐",
	cirmid: "⫯",
	cirscir: "⧂",
	clubs: "♣",
	clubsuit: "♣",
	colon: ":",
	colone: "≔",
	coloneq: "≔",
	comma: ",",
	commat: "@",
	comp: "∁",
	compfn: "∘",
	complement: "∁",
	complexes: "ℂ",
	cong: "≅",
	congdot: "⩭",
	conint: "∮",
	copf: "𝕔",
	coprod: "∐",
	copy: "©",
	copysr: "℗",
	crarr: "↵",
	cross: "✗",
	cscr: "𝒸",
	csub: "⫏",
	csube: "⫑",
	csup: "⫐",
	csupe: "⫒",
	ctdot: "⋯",
	cudarrl: "⤸",
	cudarrr: "⤵",
	cuepr: "⋞",
	cuesc: "⋟",
	cularr: "↶",
	cularrp: "⤽",
	cup: "∪",
	cupbrcap: "⩈",
	cupcap: "⩆",
	cupcup: "⩊",
	cupdot: "⊍",
	cupor: "⩅",
	cups: "∪︀",
	curarr: "↷",
	curarrm: "⤼",
	curlyeqprec: "⋞",
	curlyeqsucc: "⋟",
	curlyvee: "⋎",
	curlywedge: "⋏",
	curren: "¤",
	curvearrowleft: "↶",
	curvearrowright: "↷",
	cuvee: "⋎",
	cuwed: "⋏",
	cwconint: "∲",
	cwint: "∱",
	cylcty: "⌭",
	dArr: "⇓",
	dHar: "⥥",
	dagger: "†",
	daleth: "ℸ",
	darr: "↓",
	dash: "‐",
	dashv: "⊣",
	dbkarow: "⤏",
	dblac: "˝",
	dcaron: "ď",
	dcy: "д",
	dd: "ⅆ",
	ddagger: "‡",
	ddarr: "⇊",
	ddotseq: "⩷",
	deg: "°",
	delta: "δ",
	demptyv: "⦱",
	dfisht: "⥿",
	dfr: "𝔡",
	dharl: "⇃",
	dharr: "⇂",
	diam: "⋄",
	diamond: "⋄",
	diamondsuit: "♦",
	diams: "♦",
	die: "¨",
	digamma: "ϝ",
	disin: "⋲",
	div: "÷",
	divide: "÷",
	divideontimes: "⋇",
	divonx: "⋇",
	djcy: "ђ",
	dlcorn: "⌞",
	dlcrop: "⌍",
	dollar: "$",
	dopf: "𝕕",
	dot: "˙",
	doteq: "≐",
	doteqdot: "≑",
	dotminus: "∸",
	dotplus: "∔",
	dotsquare: "⊡",
	doublebarwedge: "⌆",
	downarrow: "↓",
	downdownarrows: "⇊",
	downharpoonleft: "⇃",
	downharpoonright: "⇂",
	drbkarow: "⤐",
	drcorn: "⌟",
	drcrop: "⌌",
	dscr: "𝒹",
	dscy: "ѕ",
	dsol: "⧶",
	dstrok: "đ",
	dtdot: "⋱",
	dtri: "▿",
	dtrif: "▾",
	duarr: "⇵",
	duhar: "⥯",
	dwangle: "⦦",
	dzcy: "џ",
	dzigrarr: "⟿",
	eDDot: "⩷",
	eDot: "≑",
	eacute: "é",
	easter: "⩮",
	ecaron: "ě",
	ecir: "≖",
	ecirc: "ê",
	ecolon: "≕",
	ecy: "э",
	edot: "ė",
	ee: "ⅇ",
	efDot: "≒",
	efr: "𝔢",
	eg: "⪚",
	egrave: "è",
	egs: "⪖",
	egsdot: "⪘",
	el: "⪙",
	elinters: "⏧",
	ell: "ℓ",
	els: "⪕",
	elsdot: "⪗",
	emacr: "ē",
	empty: "∅",
	emptyset: "∅",
	emptyv: "∅",
	emsp13: " ",
	emsp14: " ",
	emsp: " ",
	eng: "ŋ",
	ensp: " ",
	eogon: "ę",
	eopf: "𝕖",
	epar: "⋕",
	eparsl: "⧣",
	eplus: "⩱",
	epsi: "ε",
	epsilon: "ε",
	epsiv: "ϵ",
	eqcirc: "≖",
	eqcolon: "≕",
	eqsim: "≂",
	eqslantgtr: "⪖",
	eqslantless: "⪕",
	equals: "=",
	equest: "≟",
	equiv: "≡",
	equivDD: "⩸",
	eqvparsl: "⧥",
	erDot: "≓",
	erarr: "⥱",
	escr: "ℯ",
	esdot: "≐",
	esim: "≂",
	eta: "η",
	eth: "ð",
	euml: "ë",
	euro: "€",
	excl: "!",
	exist: "∃",
	expectation: "ℰ",
	exponentiale: "ⅇ",
	fallingdotseq: "≒",
	fcy: "ф",
	female: "♀",
	ffilig: "ﬃ",
	fflig: "ﬀ",
	ffllig: "ﬄ",
	ffr: "𝔣",
	filig: "ﬁ",
	fjlig: "fj",
	flat: "♭",
	fllig: "ﬂ",
	fltns: "▱",
	fnof: "ƒ",
	fopf: "𝕗",
	forall: "∀",
	fork: "⋔",
	forkv: "⫙",
	fpartint: "⨍",
	frac12: "½",
	frac13: "⅓",
	frac14: "¼",
	frac15: "⅕",
	frac16: "⅙",
	frac18: "⅛",
	frac23: "⅔",
	frac25: "⅖",
	frac34: "¾",
	frac35: "⅗",
	frac38: "⅜",
	frac45: "⅘",
	frac56: "⅚",
	frac58: "⅝",
	frac78: "⅞",
	frasl: "⁄",
	frown: "⌢",
	fscr: "𝒻",
	gE: "≧",
	gEl: "⪌",
	gacute: "ǵ",
	gamma: "γ",
	gammad: "ϝ",
	gap: "⪆",
	gbreve: "ğ",
	gcirc: "ĝ",
	gcy: "г",
	gdot: "ġ",
	ge: "≥",
	gel: "⋛",
	geq: "≥",
	geqq: "≧",
	geqslant: "⩾",
	ges: "⩾",
	gescc: "⪩",
	gesdot: "⪀",
	gesdoto: "⪂",
	gesdotol: "⪄",
	gesl: "⋛︀",
	gesles: "⪔",
	gfr: "𝔤",
	gg: "≫",
	ggg: "⋙",
	gimel: "ℷ",
	gjcy: "ѓ",
	gl: "≷",
	glE: "⪒",
	gla: "⪥",
	glj: "⪤",
	gnE: "≩",
	gnap: "⪊",
	gnapprox: "⪊",
	gne: "⪈",
	gneq: "⪈",
	gneqq: "≩",
	gnsim: "⋧",
	gopf: "𝕘",
	grave: "`",
	gscr: "ℊ",
	gsim: "≳",
	gsime: "⪎",
	gsiml: "⪐",
	gt: ">",
	gtcc: "⪧",
	gtcir: "⩺",
	gtdot: "⋗",
	gtlPar: "⦕",
	gtquest: "⩼",
	gtrapprox: "⪆",
	gtrarr: "⥸",
	gtrdot: "⋗",
	gtreqless: "⋛",
	gtreqqless: "⪌",
	gtrless: "≷",
	gtrsim: "≳",
	gvertneqq: "≩︀",
	gvnE: "≩︀",
	hArr: "⇔",
	hairsp: " ",
	half: "½",
	hamilt: "ℋ",
	hardcy: "ъ",
	harr: "↔",
	harrcir: "⥈",
	harrw: "↭",
	hbar: "ℏ",
	hcirc: "ĥ",
	hearts: "♥",
	heartsuit: "♥",
	hellip: "…",
	hercon: "⊹",
	hfr: "𝔥",
	hksearow: "⤥",
	hkswarow: "⤦",
	hoarr: "⇿",
	homtht: "∻",
	hookleftarrow: "↩",
	hookrightarrow: "↪",
	hopf: "𝕙",
	horbar: "―",
	hscr: "𝒽",
	hslash: "ℏ",
	hstrok: "ħ",
	hybull: "⁃",
	hyphen: "‐",
	iacute: "í",
	ic: "⁣",
	icirc: "î",
	icy: "и",
	iecy: "е",
	iexcl: "¡",
	iff: "⇔",
	ifr: "𝔦",
	igrave: "ì",
	ii: "ⅈ",
	iiiint: "⨌",
	iiint: "∭",
	iinfin: "⧜",
	iiota: "℩",
	ijlig: "ĳ",
	imacr: "ī",
	image: "ℑ",
	imagline: "ℐ",
	imagpart: "ℑ",
	imath: "ı",
	imof: "⊷",
	imped: "Ƶ",
	in: "∈",
	incare: "℅",
	infin: "∞",
	infintie: "⧝",
	inodot: "ı",
	int: "∫",
	intcal: "⊺",
	integers: "ℤ",
	intercal: "⊺",
	intlarhk: "⨗",
	intprod: "⨼",
	iocy: "ё",
	iogon: "į",
	iopf: "𝕚",
	iota: "ι",
	iprod: "⨼",
	iquest: "¿",
	iscr: "𝒾",
	isin: "∈",
	isinE: "⋹",
	isindot: "⋵",
	isins: "⋴",
	isinsv: "⋳",
	isinv: "∈",
	it: "⁢",
	itilde: "ĩ",
	iukcy: "і",
	iuml: "ï",
	jcirc: "ĵ",
	jcy: "й",
	jfr: "𝔧",
	jmath: "ȷ",
	jopf: "𝕛",
	jscr: "𝒿",
	jsercy: "ј",
	jukcy: "є",
	kappa: "κ",
	kappav: "ϰ",
	kcedil: "ķ",
	kcy: "к",
	kfr: "𝔨",
	kgreen: "ĸ",
	khcy: "х",
	kjcy: "ќ",
	kopf: "𝕜",
	kscr: "𝓀",
	lAarr: "⇚",
	lArr: "⇐",
	lAtail: "⤛",
	lBarr: "⤎",
	lE: "≦",
	lEg: "⪋",
	lHar: "⥢",
	lacute: "ĺ",
	laemptyv: "⦴",
	lagran: "ℒ",
	lambda: "λ",
	lang: "⟨",
	langd: "⦑",
	langle: "⟨",
	lap: "⪅",
	laquo: "«",
	larr: "←",
	larrb: "⇤",
	larrbfs: "⤟",
	larrfs: "⤝",
	larrhk: "↩",
	larrlp: "↫",
	larrpl: "⤹",
	larrsim: "⥳",
	larrtl: "↢",
	lat: "⪫",
	latail: "⤙",
	late: "⪭",
	lates: "⪭︀",
	lbarr: "⤌",
	lbbrk: "❲",
	lbrace: "{",
	lbrack: "[",
	lbrke: "⦋",
	lbrksld: "⦏",
	lbrkslu: "⦍",
	lcaron: "ľ",
	lcedil: "ļ",
	lceil: "⌈",
	lcub: "{",
	lcy: "л",
	ldca: "⤶",
	ldquo: "“",
	ldquor: "„",
	ldrdhar: "⥧",
	ldrushar: "⥋",
	ldsh: "↲",
	le: "≤",
	leftarrow: "←",
	leftarrowtail: "↢",
	leftharpoondown: "↽",
	leftharpoonup: "↼",
	leftleftarrows: "⇇",
	leftrightarrow: "↔",
	leftrightarrows: "⇆",
	leftrightharpoons: "⇋",
	leftrightsquigarrow: "↭",
	leftthreetimes: "⋋",
	leg: "⋚",
	leq: "≤",
	leqq: "≦",
	leqslant: "⩽",
	les: "⩽",
	lescc: "⪨",
	lesdot: "⩿",
	lesdoto: "⪁",
	lesdotor: "⪃",
	lesg: "⋚︀",
	lesges: "⪓",
	lessapprox: "⪅",
	lessdot: "⋖",
	lesseqgtr: "⋚",
	lesseqqgtr: "⪋",
	lessgtr: "≶",
	lesssim: "≲",
	lfisht: "⥼",
	lfloor: "⌊",
	lfr: "𝔩",
	lg: "≶",
	lgE: "⪑",
	lhard: "↽",
	lharu: "↼",
	lharul: "⥪",
	lhblk: "▄",
	ljcy: "љ",
	ll: "≪",
	llarr: "⇇",
	llcorner: "⌞",
	llhard: "⥫",
	lltri: "◺",
	lmidot: "ŀ",
	lmoust: "⎰",
	lmoustache: "⎰",
	lnE: "≨",
	lnap: "⪉",
	lnapprox: "⪉",
	lne: "⪇",
	lneq: "⪇",
	lneqq: "≨",
	lnsim: "⋦",
	loang: "⟬",
	loarr: "⇽",
	lobrk: "⟦",
	longleftarrow: "⟵",
	longleftrightarrow: "⟷",
	longmapsto: "⟼",
	longrightarrow: "⟶",
	looparrowleft: "↫",
	looparrowright: "↬",
	lopar: "⦅",
	lopf: "𝕝",
	loplus: "⨭",
	lotimes: "⨴",
	lowast: "∗",
	lowbar: "_",
	loz: "◊",
	lozenge: "◊",
	lozf: "⧫",
	lpar: "(",
	lparlt: "⦓",
	lrarr: "⇆",
	lrcorner: "⌟",
	lrhar: "⇋",
	lrhard: "⥭",
	lrm: "‎",
	lrtri: "⊿",
	lsaquo: "‹",
	lscr: "𝓁",
	lsh: "↰",
	lsim: "≲",
	lsime: "⪍",
	lsimg: "⪏",
	lsqb: "[",
	lsquo: "‘",
	lsquor: "‚",
	lstrok: "ł",
	lt: "<",
	ltcc: "⪦",
	ltcir: "⩹",
	ltdot: "⋖",
	lthree: "⋋",
	ltimes: "⋉",
	ltlarr: "⥶",
	ltquest: "⩻",
	ltrPar: "⦖",
	ltri: "◃",
	ltrie: "⊴",
	ltrif: "◂",
	lurdshar: "⥊",
	luruhar: "⥦",
	lvertneqq: "≨︀",
	lvnE: "≨︀",
	mDDot: "∺",
	macr: "¯",
	male: "♂",
	malt: "✠",
	maltese: "✠",
	map: "↦",
	mapsto: "↦",
	mapstodown: "↧",
	mapstoleft: "↤",
	mapstoup: "↥",
	marker: "▮",
	mcomma: "⨩",
	mcy: "м",
	mdash: "—",
	measuredangle: "∡",
	mfr: "𝔪",
	mho: "℧",
	micro: "µ",
	mid: "∣",
	midast: "*",
	midcir: "⫰",
	middot: "·",
	minus: "−",
	minusb: "⊟",
	minusd: "∸",
	minusdu: "⨪",
	mlcp: "⫛",
	mldr: "…",
	mnplus: "∓",
	models: "⊧",
	mopf: "𝕞",
	mp: "∓",
	mscr: "𝓂",
	mstpos: "∾",
	mu: "μ",
	multimap: "⊸",
	mumap: "⊸",
	nGg: "⋙̸",
	nGt: "≫⃒",
	nGtv: "≫̸",
	nLeftarrow: "⇍",
	nLeftrightarrow: "⇎",
	nLl: "⋘̸",
	nLt: "≪⃒",
	nLtv: "≪̸",
	nRightarrow: "⇏",
	nVDash: "⊯",
	nVdash: "⊮",
	nabla: "∇",
	nacute: "ń",
	nang: "∠⃒",
	nap: "≉",
	napE: "⩰̸",
	napid: "≋̸",
	napos: "ŉ",
	napprox: "≉",
	natur: "♮",
	natural: "♮",
	naturals: "ℕ",
	nbsp: "\xA0",
	nbump: "≎̸",
	nbumpe: "≏̸",
	ncap: "⩃",
	ncaron: "ň",
	ncedil: "ņ",
	ncong: "≇",
	ncongdot: "⩭̸",
	ncup: "⩂",
	ncy: "н",
	ndash: "–",
	ne: "≠",
	neArr: "⇗",
	nearhk: "⤤",
	nearr: "↗",
	nearrow: "↗",
	nedot: "≐̸",
	nequiv: "≢",
	nesear: "⤨",
	nesim: "≂̸",
	nexist: "∄",
	nexists: "∄",
	nfr: "𝔫",
	ngE: "≧̸",
	nge: "≱",
	ngeq: "≱",
	ngeqq: "≧̸",
	ngeqslant: "⩾̸",
	nges: "⩾̸",
	ngsim: "≵",
	ngt: "≯",
	ngtr: "≯",
	nhArr: "⇎",
	nharr: "↮",
	nhpar: "⫲",
	ni: "∋",
	nis: "⋼",
	nisd: "⋺",
	niv: "∋",
	njcy: "њ",
	nlArr: "⇍",
	nlE: "≦̸",
	nlarr: "↚",
	nldr: "‥",
	nle: "≰",
	nleftarrow: "↚",
	nleftrightarrow: "↮",
	nleq: "≰",
	nleqq: "≦̸",
	nleqslant: "⩽̸",
	nles: "⩽̸",
	nless: "≮",
	nlsim: "≴",
	nlt: "≮",
	nltri: "⋪",
	nltrie: "⋬",
	nmid: "∤",
	nopf: "𝕟",
	not: "¬",
	notin: "∉",
	notinE: "⋹̸",
	notindot: "⋵̸",
	notinva: "∉",
	notinvb: "⋷",
	notinvc: "⋶",
	notni: "∌",
	notniva: "∌",
	notnivb: "⋾",
	notnivc: "⋽",
	npar: "∦",
	nparallel: "∦",
	nparsl: "⫽⃥",
	npart: "∂̸",
	npolint: "⨔",
	npr: "⊀",
	nprcue: "⋠",
	npre: "⪯̸",
	nprec: "⊀",
	npreceq: "⪯̸",
	nrArr: "⇏",
	nrarr: "↛",
	nrarrc: "⤳̸",
	nrarrw: "↝̸",
	nrightarrow: "↛",
	nrtri: "⋫",
	nrtrie: "⋭",
	nsc: "⊁",
	nsccue: "⋡",
	nsce: "⪰̸",
	nscr: "𝓃",
	nshortmid: "∤",
	nshortparallel: "∦",
	nsim: "≁",
	nsime: "≄",
	nsimeq: "≄",
	nsmid: "∤",
	nspar: "∦",
	nsqsube: "⋢",
	nsqsupe: "⋣",
	nsub: "⊄",
	nsubE: "⫅̸",
	nsube: "⊈",
	nsubset: "⊂⃒",
	nsubseteq: "⊈",
	nsubseteqq: "⫅̸",
	nsucc: "⊁",
	nsucceq: "⪰̸",
	nsup: "⊅",
	nsupE: "⫆̸",
	nsupe: "⊉",
	nsupset: "⊃⃒",
	nsupseteq: "⊉",
	nsupseteqq: "⫆̸",
	ntgl: "≹",
	ntilde: "ñ",
	ntlg: "≸",
	ntriangleleft: "⋪",
	ntrianglelefteq: "⋬",
	ntriangleright: "⋫",
	ntrianglerighteq: "⋭",
	nu: "ν",
	num: "#",
	numero: "№",
	numsp: " ",
	nvDash: "⊭",
	nvHarr: "⤄",
	nvap: "≍⃒",
	nvdash: "⊬",
	nvge: "≥⃒",
	nvgt: ">⃒",
	nvinfin: "⧞",
	nvlArr: "⤂",
	nvle: "≤⃒",
	nvlt: "<⃒",
	nvltrie: "⊴⃒",
	nvrArr: "⤃",
	nvrtrie: "⊵⃒",
	nvsim: "∼⃒",
	nwArr: "⇖",
	nwarhk: "⤣",
	nwarr: "↖",
	nwarrow: "↖",
	nwnear: "⤧",
	oS: "Ⓢ",
	oacute: "ó",
	oast: "⊛",
	ocir: "⊚",
	ocirc: "ô",
	ocy: "о",
	odash: "⊝",
	odblac: "ő",
	odiv: "⨸",
	odot: "⊙",
	odsold: "⦼",
	oelig: "œ",
	ofcir: "⦿",
	ofr: "𝔬",
	ogon: "˛",
	ograve: "ò",
	ogt: "⧁",
	ohbar: "⦵",
	ohm: "Ω",
	oint: "∮",
	olarr: "↺",
	olcir: "⦾",
	olcross: "⦻",
	oline: "‾",
	olt: "⧀",
	omacr: "ō",
	omega: "ω",
	omicron: "ο",
	omid: "⦶",
	ominus: "⊖",
	oopf: "𝕠",
	opar: "⦷",
	operp: "⦹",
	oplus: "⊕",
	or: "∨",
	orarr: "↻",
	ord: "⩝",
	order: "ℴ",
	orderof: "ℴ",
	ordf: "ª",
	ordm: "º",
	origof: "⊶",
	oror: "⩖",
	orslope: "⩗",
	orv: "⩛",
	oscr: "ℴ",
	oslash: "ø",
	osol: "⊘",
	otilde: "õ",
	otimes: "⊗",
	otimesas: "⨶",
	ouml: "ö",
	ovbar: "⌽",
	par: "∥",
	para: "¶",
	parallel: "∥",
	parsim: "⫳",
	parsl: "⫽",
	part: "∂",
	pcy: "п",
	percnt: "%",
	period: ".",
	permil: "‰",
	perp: "⊥",
	pertenk: "‱",
	pfr: "𝔭",
	phi: "φ",
	phiv: "ϕ",
	phmmat: "ℳ",
	phone: "☎",
	pi: "π",
	pitchfork: "⋔",
	piv: "ϖ",
	planck: "ℏ",
	planckh: "ℎ",
	plankv: "ℏ",
	plus: "+",
	plusacir: "⨣",
	plusb: "⊞",
	pluscir: "⨢",
	plusdo: "∔",
	plusdu: "⨥",
	pluse: "⩲",
	plusmn: "±",
	plussim: "⨦",
	plustwo: "⨧",
	pm: "±",
	pointint: "⨕",
	popf: "𝕡",
	pound: "£",
	pr: "≺",
	prE: "⪳",
	prap: "⪷",
	prcue: "≼",
	pre: "⪯",
	prec: "≺",
	precapprox: "⪷",
	preccurlyeq: "≼",
	preceq: "⪯",
	precnapprox: "⪹",
	precneqq: "⪵",
	precnsim: "⋨",
	precsim: "≾",
	prime: "′",
	primes: "ℙ",
	prnE: "⪵",
	prnap: "⪹",
	prnsim: "⋨",
	prod: "∏",
	profalar: "⌮",
	profline: "⌒",
	profsurf: "⌓",
	prop: "∝",
	propto: "∝",
	prsim: "≾",
	prurel: "⊰",
	pscr: "𝓅",
	psi: "ψ",
	puncsp: " ",
	qfr: "𝔮",
	qint: "⨌",
	qopf: "𝕢",
	qprime: "⁗",
	qscr: "𝓆",
	quaternions: "ℍ",
	quatint: "⨖",
	quest: "?",
	questeq: "≟",
	quot: "\"",
	rAarr: "⇛",
	rArr: "⇒",
	rAtail: "⤜",
	rBarr: "⤏",
	rHar: "⥤",
	race: "∽̱",
	racute: "ŕ",
	radic: "√",
	raemptyv: "⦳",
	rang: "⟩",
	rangd: "⦒",
	range: "⦥",
	rangle: "⟩",
	raquo: "»",
	rarr: "→",
	rarrap: "⥵",
	rarrb: "⇥",
	rarrbfs: "⤠",
	rarrc: "⤳",
	rarrfs: "⤞",
	rarrhk: "↪",
	rarrlp: "↬",
	rarrpl: "⥅",
	rarrsim: "⥴",
	rarrtl: "↣",
	rarrw: "↝",
	ratail: "⤚",
	ratio: "∶",
	rationals: "ℚ",
	rbarr: "⤍",
	rbbrk: "❳",
	rbrace: "}",
	rbrack: "]",
	rbrke: "⦌",
	rbrksld: "⦎",
	rbrkslu: "⦐",
	rcaron: "ř",
	rcedil: "ŗ",
	rceil: "⌉",
	rcub: "}",
	rcy: "р",
	rdca: "⤷",
	rdldhar: "⥩",
	rdquo: "”",
	rdquor: "”",
	rdsh: "↳",
	real: "ℜ",
	realine: "ℛ",
	realpart: "ℜ",
	reals: "ℝ",
	rect: "▭",
	reg: "®",
	rfisht: "⥽",
	rfloor: "⌋",
	rfr: "𝔯",
	rhard: "⇁",
	rharu: "⇀",
	rharul: "⥬",
	rho: "ρ",
	rhov: "ϱ",
	rightarrow: "→",
	rightarrowtail: "↣",
	rightharpoondown: "⇁",
	rightharpoonup: "⇀",
	rightleftarrows: "⇄",
	rightleftharpoons: "⇌",
	rightrightarrows: "⇉",
	rightsquigarrow: "↝",
	rightthreetimes: "⋌",
	ring: "˚",
	risingdotseq: "≓",
	rlarr: "⇄",
	rlhar: "⇌",
	rlm: "‏",
	rmoust: "⎱",
	rmoustache: "⎱",
	rnmid: "⫮",
	roang: "⟭",
	roarr: "⇾",
	robrk: "⟧",
	ropar: "⦆",
	ropf: "𝕣",
	roplus: "⨮",
	rotimes: "⨵",
	rpar: ")",
	rpargt: "⦔",
	rppolint: "⨒",
	rrarr: "⇉",
	rsaquo: "›",
	rscr: "𝓇",
	rsh: "↱",
	rsqb: "]",
	rsquo: "’",
	rsquor: "’",
	rthree: "⋌",
	rtimes: "⋊",
	rtri: "▹",
	rtrie: "⊵",
	rtrif: "▸",
	rtriltri: "⧎",
	ruluhar: "⥨",
	rx: "℞",
	sacute: "ś",
	sbquo: "‚",
	sc: "≻",
	scE: "⪴",
	scap: "⪸",
	scaron: "š",
	sccue: "≽",
	sce: "⪰",
	scedil: "ş",
	scirc: "ŝ",
	scnE: "⪶",
	scnap: "⪺",
	scnsim: "⋩",
	scpolint: "⨓",
	scsim: "≿",
	scy: "с",
	sdot: "⋅",
	sdotb: "⊡",
	sdote: "⩦",
	seArr: "⇘",
	searhk: "⤥",
	searr: "↘",
	searrow: "↘",
	sect: "§",
	semi: ";",
	seswar: "⤩",
	setminus: "∖",
	setmn: "∖",
	sext: "✶",
	sfr: "𝔰",
	sfrown: "⌢",
	sharp: "♯",
	shchcy: "щ",
	shcy: "ш",
	shortmid: "∣",
	shortparallel: "∥",
	shy: "­",
	sigma: "σ",
	sigmaf: "ς",
	sigmav: "ς",
	sim: "∼",
	simdot: "⩪",
	sime: "≃",
	simeq: "≃",
	simg: "⪞",
	simgE: "⪠",
	siml: "⪝",
	simlE: "⪟",
	simne: "≆",
	simplus: "⨤",
	simrarr: "⥲",
	slarr: "←",
	smallsetminus: "∖",
	smashp: "⨳",
	smeparsl: "⧤",
	smid: "∣",
	smile: "⌣",
	smt: "⪪",
	smte: "⪬",
	smtes: "⪬︀",
	softcy: "ь",
	sol: "/",
	solb: "⧄",
	solbar: "⌿",
	sopf: "𝕤",
	spades: "♠",
	spadesuit: "♠",
	spar: "∥",
	sqcap: "⊓",
	sqcaps: "⊓︀",
	sqcup: "⊔",
	sqcups: "⊔︀",
	sqsub: "⊏",
	sqsube: "⊑",
	sqsubset: "⊏",
	sqsubseteq: "⊑",
	sqsup: "⊐",
	sqsupe: "⊒",
	sqsupset: "⊐",
	sqsupseteq: "⊒",
	squ: "□",
	square: "□",
	squarf: "▪",
	squf: "▪",
	srarr: "→",
	sscr: "𝓈",
	ssetmn: "∖",
	ssmile: "⌣",
	sstarf: "⋆",
	star: "☆",
	starf: "★",
	straightepsilon: "ϵ",
	straightphi: "ϕ",
	strns: "¯",
	sub: "⊂",
	subE: "⫅",
	subdot: "⪽",
	sube: "⊆",
	subedot: "⫃",
	submult: "⫁",
	subnE: "⫋",
	subne: "⊊",
	subplus: "⪿",
	subrarr: "⥹",
	subset: "⊂",
	subseteq: "⊆",
	subseteqq: "⫅",
	subsetneq: "⊊",
	subsetneqq: "⫋",
	subsim: "⫇",
	subsub: "⫕",
	subsup: "⫓",
	succ: "≻",
	succapprox: "⪸",
	succcurlyeq: "≽",
	succeq: "⪰",
	succnapprox: "⪺",
	succneqq: "⪶",
	succnsim: "⋩",
	succsim: "≿",
	sum: "∑",
	sung: "♪",
	sup1: "¹",
	sup2: "²",
	sup3: "³",
	sup: "⊃",
	supE: "⫆",
	supdot: "⪾",
	supdsub: "⫘",
	supe: "⊇",
	supedot: "⫄",
	suphsol: "⟉",
	suphsub: "⫗",
	suplarr: "⥻",
	supmult: "⫂",
	supnE: "⫌",
	supne: "⊋",
	supplus: "⫀",
	supset: "⊃",
	supseteq: "⊇",
	supseteqq: "⫆",
	supsetneq: "⊋",
	supsetneqq: "⫌",
	supsim: "⫈",
	supsub: "⫔",
	supsup: "⫖",
	swArr: "⇙",
	swarhk: "⤦",
	swarr: "↙",
	swarrow: "↙",
	swnwar: "⤪",
	szlig: "ß",
	target: "⌖",
	tau: "τ",
	tbrk: "⎴",
	tcaron: "ť",
	tcedil: "ţ",
	tcy: "т",
	tdot: "⃛",
	telrec: "⌕",
	tfr: "𝔱",
	there4: "∴",
	therefore: "∴",
	theta: "θ",
	thetasym: "ϑ",
	thetav: "ϑ",
	thickapprox: "≈",
	thicksim: "∼",
	thinsp: " ",
	thkap: "≈",
	thksim: "∼",
	thorn: "þ",
	tilde: "˜",
	times: "×",
	timesb: "⊠",
	timesbar: "⨱",
	timesd: "⨰",
	tint: "∭",
	toea: "⤨",
	top: "⊤",
	topbot: "⌶",
	topcir: "⫱",
	topf: "𝕥",
	topfork: "⫚",
	tosa: "⤩",
	tprime: "‴",
	trade: "™",
	triangle: "▵",
	triangledown: "▿",
	triangleleft: "◃",
	trianglelefteq: "⊴",
	triangleq: "≜",
	triangleright: "▹",
	trianglerighteq: "⊵",
	tridot: "◬",
	trie: "≜",
	triminus: "⨺",
	triplus: "⨹",
	trisb: "⧍",
	tritime: "⨻",
	trpezium: "⏢",
	tscr: "𝓉",
	tscy: "ц",
	tshcy: "ћ",
	tstrok: "ŧ",
	twixt: "≬",
	twoheadleftarrow: "↞",
	twoheadrightarrow: "↠",
	uArr: "⇑",
	uHar: "⥣",
	uacute: "ú",
	uarr: "↑",
	ubrcy: "ў",
	ubreve: "ŭ",
	ucirc: "û",
	ucy: "у",
	udarr: "⇅",
	udblac: "ű",
	udhar: "⥮",
	ufisht: "⥾",
	ufr: "𝔲",
	ugrave: "ù",
	uharl: "↿",
	uharr: "↾",
	uhblk: "▀",
	ulcorn: "⌜",
	ulcorner: "⌜",
	ulcrop: "⌏",
	ultri: "◸",
	umacr: "ū",
	uml: "¨",
	uogon: "ų",
	uopf: "𝕦",
	uparrow: "↑",
	updownarrow: "↕",
	upharpoonleft: "↿",
	upharpoonright: "↾",
	uplus: "⊎",
	upsi: "υ",
	upsih: "ϒ",
	upsilon: "υ",
	upuparrows: "⇈",
	urcorn: "⌝",
	urcorner: "⌝",
	urcrop: "⌎",
	uring: "ů",
	urtri: "◹",
	uscr: "𝓊",
	utdot: "⋰",
	utilde: "ũ",
	utri: "▵",
	utrif: "▴",
	uuarr: "⇈",
	uuml: "ü",
	uwangle: "⦧",
	vArr: "⇕",
	vBar: "⫨",
	vBarv: "⫩",
	vDash: "⊨",
	vangrt: "⦜",
	varepsilon: "ϵ",
	varkappa: "ϰ",
	varnothing: "∅",
	varphi: "ϕ",
	varpi: "ϖ",
	varpropto: "∝",
	varr: "↕",
	varrho: "ϱ",
	varsigma: "ς",
	varsubsetneq: "⊊︀",
	varsubsetneqq: "⫋︀",
	varsupsetneq: "⊋︀",
	varsupsetneqq: "⫌︀",
	vartheta: "ϑ",
	vartriangleleft: "⊲",
	vartriangleright: "⊳",
	vcy: "в",
	vdash: "⊢",
	vee: "∨",
	veebar: "⊻",
	veeeq: "≚",
	vellip: "⋮",
	verbar: "|",
	vert: "|",
	vfr: "𝔳",
	vltri: "⊲",
	vnsub: "⊂⃒",
	vnsup: "⊃⃒",
	vopf: "𝕧",
	vprop: "∝",
	vrtri: "⊳",
	vscr: "𝓋",
	vsubnE: "⫋︀",
	vsubne: "⊊︀",
	vsupnE: "⫌︀",
	vsupne: "⊋︀",
	vzigzag: "⦚",
	wcirc: "ŵ",
	wedbar: "⩟",
	wedge: "∧",
	wedgeq: "≙",
	weierp: "℘",
	wfr: "𝔴",
	wopf: "𝕨",
	wp: "℘",
	wr: "≀",
	wreath: "≀",
	wscr: "𝓌",
	xcap: "⋂",
	xcirc: "◯",
	xcup: "⋃",
	xdtri: "▽",
	xfr: "𝔵",
	xhArr: "⟺",
	xharr: "⟷",
	xi: "ξ",
	xlArr: "⟸",
	xlarr: "⟵",
	xmap: "⟼",
	xnis: "⋻",
	xodot: "⨀",
	xopf: "𝕩",
	xoplus: "⨁",
	xotime: "⨂",
	xrArr: "⟹",
	xrarr: "⟶",
	xscr: "𝓍",
	xsqcup: "⨆",
	xuplus: "⨄",
	xutri: "△",
	xvee: "⋁",
	xwedge: "⋀",
	yacute: "ý",
	yacy: "я",
	ycirc: "ŷ",
	ycy: "ы",
	yen: "¥",
	yfr: "𝔶",
	yicy: "ї",
	yopf: "𝕪",
	yscr: "𝓎",
	yucy: "ю",
	yuml: "ÿ",
	zacute: "ź",
	zcaron: "ž",
	zcy: "з",
	zdot: "ż",
	zeetrf: "ℨ",
	zeta: "ζ",
	zfr: "𝔷",
	zhcy: "ж",
	zigrarr: "⇝",
	zopf: "𝕫",
	zscr: "𝓏",
	zwj: "‍",
	zwnj: "‌"
};
const own$1 = {}.hasOwnProperty;
/**
* Decode a single character reference (without the `&` or `;`).
* You probably only need this when you’re building parsers yourself that follow
* different rules compared to HTML.
* This is optimized to be tiny in browsers.
*
* @param {string} value
*   `notin` (named), `#123` (deci), `#x123` (hexa).
* @returns {string|false}
*   Decoded reference.
*/
function decodeNamedCharacterReference(value) {
	return own$1.call(characterEntities, value) ? characterEntities[value] : false;
}
/**
* Like `Array#splice`, but smarter for giant arrays.
*
* `Array#splice` takes all items to be inserted as individual argument which
* causes a stack overflow in V8 when trying to insert 100k items for instance.
*
* Otherwise, this does not return the removed items, and takes `items` as an
* array instead of rest parameters.
*
* @template {unknown} T
*   Item type.
* @param {Array<T>} list
*   List to operate on.
* @param {number} start
*   Index to remove/insert at (can be negative).
* @param {number} remove
*   Number of items to remove.
* @param {Array<T>} items
*   Items to inject into `list`.
* @returns {undefined}
*   Nothing.
*/
function splice(list, start, remove, items) {
	const end = list.length;
	let chunkStart = 0;
	/** @type {Array<unknown>} */
	let parameters;
	if (start < 0) start = -start > end ? 0 : end + start;
	else start = start > end ? end : start;
	remove = remove > 0 ? remove : 0;
	if (items.length < 1e4) {
		parameters = Array.from(items);
		parameters.unshift(start, remove);
		list.splice(...parameters);
	} else {
		if (remove) list.splice(start, remove);
		while (chunkStart < items.length) {
			parameters = items.slice(chunkStart, chunkStart + 1e4);
			parameters.unshift(start, 0);
			list.splice(...parameters);
			chunkStart += 1e4;
			start += 1e4;
		}
	}
}
/**
* Append `items` (an array) at the end of `list` (another array).
* When `list` was empty, returns `items` instead.
*
* This prevents a potentially expensive operation when `list` is empty,
* and adds items in batches to prevent V8 from hanging.
*
* @template {unknown} T
*   Item type.
* @param {Array<T>} list
*   List to operate on.
* @param {Array<T>} items
*   Items to add to `list`.
* @returns {Array<T>}
*   Either `list` or `items`.
*/
function push(list, items) {
	if (list.length > 0) {
		splice(list, list.length, 0, items);
		return list;
	}
	return items;
}
/**
* @import {
*   Extension,
*   Handles,
*   HtmlExtension,
*   NormalizedExtension
* } from 'micromark-util-types'
*/
const hasOwnProperty = {}.hasOwnProperty;
/**
* Combine multiple syntax extensions into one.
*
* @param {ReadonlyArray<Extension>} extensions
*   List of syntax extensions.
* @returns {NormalizedExtension}
*   A single combined extension.
*/
function combineExtensions(extensions) {
	/** @type {NormalizedExtension} */
	const all = {};
	let index = -1;
	while (++index < extensions.length) syntaxExtension(all, extensions[index]);
	return all;
}
/**
* Merge `extension` into `all`.
*
* @param {NormalizedExtension} all
*   Extension to merge into.
* @param {Extension} extension
*   Extension to merge.
* @returns {undefined}
*   Nothing.
*/
function syntaxExtension(all, extension) {
	/** @type {keyof Extension} */
	let hook;
	for (hook in extension) {
		/** @type {Record<string, unknown>} */
		const left = (hasOwnProperty.call(all, hook) ? all[hook] : void 0) || (all[hook] = {});
		/** @type {Record<string, unknown> | undefined} */
		const right = extension[hook];
		/** @type {string} */
		let code;
		if (right) for (code in right) {
			if (!hasOwnProperty.call(left, code)) left[code] = [];
			const value = right[code];
			constructs(left[code], Array.isArray(value) ? value : value ? [value] : []);
		}
	}
}
/**
* Merge `list` into `existing` (both lists of constructs).
* Mutates `existing`.
*
* @param {Array<unknown>} existing
*   List of constructs to merge into.
* @param {Array<unknown>} list
*   List of constructs to merge.
* @returns {undefined}
*   Nothing.
*/
function constructs(existing, list) {
	let index = -1;
	/** @type {Array<unknown>} */
	const before = [];
	while (++index < list.length) (list[index].add === "after" ? existing : before).push(list[index]);
	splice(existing, 0, 0, before);
}
/**
* Turn the number (in string form as either hexa- or plain decimal) coming from
* a numeric character reference into a character.
*
* Sort of like `String.fromCodePoint(Number.parseInt(value, base))`, but makes
* non-characters and control characters safe.
*
* @param {string} value
*   Value to decode.
* @param {number} base
*   Numeric base.
* @returns {string}
*   Character.
*/
function decodeNumericCharacterReference(value, base) {
	const code = Number.parseInt(value, base);
	if (code < 9 || code === 11 || code > 13 && code < 32 || code > 126 && code < 160 || code > 55295 && code < 57344 || code > 64975 && code < 65008 || (code & 65535) === 65535 || (code & 65535) === 65534 || code > 1114111) return "�";
	return String.fromCodePoint(code);
}
/**
* Normalize an identifier (as found in references, definitions).
*
* Collapses markdown whitespace, trim, and then lower- and uppercase.
*
* Some characters are considered “uppercase”, such as U+03F4 (`ϴ`), but if their
* lowercase counterpart (U+03B8 (`θ`)) is uppercased will result in a different
* uppercase character (U+0398 (`Θ`)).
* So, to get a canonical form, we perform both lower- and uppercase.
*
* Using uppercase last makes sure keys will never interact with default
* prototypal values (such as `constructor`): nothing in the prototype of
* `Object` is uppercase.
*
* @param {string} value
*   Identifier to normalize.
* @returns {string}
*   Normalized identifier.
*/
function normalizeIdentifier(value) {
	return value.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
}
/**
* @import {Code} from 'micromark-util-types'
*/
/**
* Check whether the character code represents an ASCII alpha (`a` through `z`,
* case insensitive).
*
* An **ASCII alpha** is an ASCII upper alpha or ASCII lower alpha.
*
* An **ASCII upper alpha** is a character in the inclusive range U+0041 (`A`)
* to U+005A (`Z`).
*
* An **ASCII lower alpha** is a character in the inclusive range U+0061 (`a`)
* to U+007A (`z`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
const asciiAlpha = regexCheck(/[A-Za-z]/);
/**
* Check whether the character code represents an ASCII alphanumeric (`a`
* through `z`, case insensitive, or `0` through `9`).
*
* An **ASCII alphanumeric** is an ASCII digit (see `asciiDigit`) or ASCII alpha
* (see `asciiAlpha`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
const asciiAlphanumeric = regexCheck(/[\dA-Za-z]/);
/**
* Check whether the character code represents an ASCII atext.
*
* atext is an ASCII alphanumeric (see `asciiAlphanumeric`), or a character in
* the inclusive ranges U+0023 NUMBER SIGN (`#`) to U+0027 APOSTROPHE (`'`),
* U+002A ASTERISK (`*`), U+002B PLUS SIGN (`+`), U+002D DASH (`-`), U+002F
* SLASH (`/`), U+003D EQUALS TO (`=`), U+003F QUESTION MARK (`?`), U+005E
* CARET (`^`) to U+0060 GRAVE ACCENT (`` ` ``), or U+007B LEFT CURLY BRACE
* (`{`) to U+007E TILDE (`~`).
*
* See:
* **\[RFC5322]**:
* [Internet Message Format](https://tools.ietf.org/html/rfc5322).
* P. Resnick.
* IETF.
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
const asciiAtext = regexCheck(/[#-'*+\--9=?A-Z^-~]/);
/**
* Check whether a character code is an ASCII control character.
*
* An **ASCII control** is a character in the inclusive range U+0000 NULL (NUL)
* to U+001F (US), or U+007F (DEL).
*
* @param {Code} code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
function asciiControl(code) {
	return code !== null && (code < 32 || code === 127);
}
/**
* Check whether the character code represents an ASCII digit (`0` through `9`).
*
* An **ASCII digit** is a character in the inclusive range U+0030 (`0`) to
* U+0039 (`9`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
const asciiDigit = regexCheck(/\d/);
/**
* Check whether the character code represents an ASCII hex digit (`a` through
* `f`, case insensitive, or `0` through `9`).
*
* An **ASCII hex digit** is an ASCII digit (see `asciiDigit`), ASCII upper hex
* digit, or an ASCII lower hex digit.
*
* An **ASCII upper hex digit** is a character in the inclusive range U+0041
* (`A`) to U+0046 (`F`).
*
* An **ASCII lower hex digit** is a character in the inclusive range U+0061
* (`a`) to U+0066 (`f`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
const asciiHexDigit = regexCheck(/[\dA-Fa-f]/);
/**
* Check whether the character code represents ASCII punctuation.
*
* An **ASCII punctuation** is a character in the inclusive ranges U+0021
* EXCLAMATION MARK (`!`) to U+002F SLASH (`/`), U+003A COLON (`:`) to U+0040 AT
* SIGN (`@`), U+005B LEFT SQUARE BRACKET (`[`) to U+0060 GRAVE ACCENT
* (`` ` ``), or U+007B LEFT CURLY BRACE (`{`) to U+007E TILDE (`~`).
*
* @param code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
const asciiPunctuation = regexCheck(/[!-/:-@[-`{-~]/);
/**
* Check whether a character code is a markdown line ending.
*
* A **markdown line ending** is the virtual characters M-0003 CARRIAGE RETURN
* LINE FEED (CRLF), M-0004 LINE FEED (LF) and M-0005 CARRIAGE RETURN (CR).
*
* In micromark, the actual character U+000A LINE FEED (LF) and U+000D CARRIAGE
* RETURN (CR) are replaced by these virtual characters depending on whether
* they occurred together.
*
* @param {Code} code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
function markdownLineEnding(code) {
	return code !== null && code < -2;
}
/**
* Check whether a character code is a markdown line ending (see
* `markdownLineEnding`) or markdown space (see `markdownSpace`).
*
* @param {Code} code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
function markdownLineEndingOrSpace(code) {
	return code !== null && (code < 0 || code === 32);
}
/**
* Check whether a character code is a markdown space.
*
* A **markdown space** is the concrete character U+0020 SPACE (SP) and the
* virtual characters M-0001 VIRTUAL SPACE (VS) and M-0002 HORIZONTAL TAB (HT).
*
* In micromark, the actual character U+0009 CHARACTER TABULATION (HT) is
* replaced by one M-0002 HORIZONTAL TAB (HT) and between 0 and 3 M-0001 VIRTUAL
* SPACE (VS) characters, depending on the column at which the tab occurred.
*
* @param {Code} code
*   Code.
* @returns {boolean}
*   Whether it matches.
*/
function markdownSpace(code) {
	return code === -2 || code === -1 || code === 32;
}
/**
* Check whether the character code represents Unicode punctuation.
*
* A **Unicode punctuation** is a character in the Unicode `Pc` (Punctuation,
* Connector), `Pd` (Punctuation, Dash), `Pe` (Punctuation, Close), `Pf`
* (Punctuation, Final quote), `Pi` (Punctuation, Initial quote), `Po`
* (Punctuation, Other), or `Ps` (Punctuation, Open) categories, or an ASCII
* punctuation (see `asciiPunctuation`).
*
* See:
* **\[UNICODE]**:
* [The Unicode Standard](https://www.unicode.org/versions/).
* Unicode Consortium.
*
* @param code
*   Code.
* @returns
*   Whether it matches.
*/
const unicodePunctuation = regexCheck(/\p{P}|\p{S}/u);
/**
* Check whether the character code represents Unicode whitespace.
*
* Note that this does handle micromark specific markdown whitespace characters.
* See `markdownLineEndingOrSpace` to check that.
*
* A **Unicode whitespace** is a character in the Unicode `Zs` (Separator,
* Space) category, or U+0009 CHARACTER TABULATION (HT), U+000A LINE FEED (LF),
* U+000C (FF), or U+000D CARRIAGE RETURN (CR) (**\[UNICODE]**).
*
* See:
* **\[UNICODE]**:
* [The Unicode Standard](https://www.unicode.org/versions/).
* Unicode Consortium.
*
* @param code
*   Code.
* @returns
*   Whether it matches.
*/
const unicodeWhitespace = regexCheck(/\s/);
/**
* Create a code check from a regex.
*
* @param {RegExp} regex
*   Expression.
* @returns {(code: Code) => boolean}
*   Check.
*/
function regexCheck(regex) {
	return check;
	/**
	* Check whether a code matches the bound regex.
	*
	* @param {Code} code
	*   Character code.
	* @returns {boolean}
	*   Whether the character code matches the bound regex.
	*/
	function check(code) {
		return code !== null && code > -1 && regex.test(String.fromCharCode(code));
	}
}
/**
* @import {Effects, State, TokenType} from 'micromark-util-types'
*/
/**
* Parse spaces and tabs.
*
* There is no `nok` parameter:
*
* *   spaces in markdown are often optional, in which case this factory can be
*     used and `ok` will be switched to whether spaces were found or not
* *   one line ending or space can be detected with `markdownSpace(code)` right
*     before using `factorySpace`
*
* ###### Examples
*
* Where `␉` represents a tab (plus how much it expands) and `␠` represents a
* single space.
*
* ```markdown
* ␉
* ␠␠␠␠
* ␉␠
* ```
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {TokenType} type
*   Type of the whole whitespace.
* @param {number | undefined} [max=Infinity]
*   Max (exclusive).
* @returns {State}
*   Start state.
*/
function factorySpace(effects, ok, type, max) {
	const limit = max ? max - 1 : Infinity;
	let size = 0;
	return start;
	/** @type {State} */
	function start(code) {
		if (markdownSpace(code)) {
			effects.enter(type);
			return prefix(code);
		}
		return ok(code);
	}
	/** @type {State} */
	function prefix(code) {
		if (markdownSpace(code) && size++ < limit) {
			effects.consume(code);
			return prefix;
		}
		effects.exit(type);
		return ok(code);
	}
}
/**
* Parse spaces and tabs, with a required minimum and maximum, matching
* `markdown-rs`’s `space_or_tab_min_max`.
*
* Unlike `factorySpace`, this can fail: `nok` is used when fewer than
* `min` spaces or tabs are found.
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {State} nok
*   State switched to when unsuccessful.
* @param {TokenType} type
*   Type of the whole whitespace.
* @param {number} min
*   Minimum allowed characters (inclusive).
* @param {number} max
*   Maximum allowed characters (inclusive).
* @returns {State}
*   Start state.
*/
function factorySpaceMinMax(effects, ok, nok, type, min, max) {
	let size = 0;
	return start;
	/** @type {State} */
	function start(code) {
		if (max > 0 && markdownSpace(code)) {
			effects.enter(type);
			return prefix(code);
		}
		return after(code);
	}
	/** @type {State} */
	function prefix(code) {
		if (markdownSpace(code) && size < max) {
			effects.consume(code);
			size++;
			return prefix;
		}
		effects.exit(type);
		return after(code);
	}
	/** @type {State} */
	function after(code) {
		return size >= min ? ok(code) : nok(code);
	}
}
/**
* @import {
*   InitialConstruct,
*   Initializer,
*   State,
*   TokenizeContext,
*   Token
* } from 'micromark-util-types'
*/
/** @type {InitialConstruct} */
const content$1 = { tokenize: initializeContent };
/**
* @this {TokenizeContext}
*   Context.
* @type {Initializer}
*   Content.
*/
function initializeContent(effects) {
	const contentStart = effects.attempt(this.parser.constructs.contentInitial, afterContentStartConstruct, paragraphInitial);
	/** @type {Token} */
	let previous;
	return contentStart;
	/** @type {State} */
	function afterContentStartConstruct(code) {
		if (code === null) {
			effects.consume(code);
			return;
		}
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return factorySpace(effects, contentStart, "linePrefix");
	}
	/** @type {State} */
	function paragraphInitial(code) {
		effects.enter("paragraph");
		return lineStart(code);
	}
	/** @type {State} */
	function lineStart(code) {
		const token = effects.enter("chunkText", {
			contentType: "text",
			previous
		});
		if (previous) previous.next = token;
		previous = token;
		return data(code);
	}
	/** @type {State} */
	function data(code) {
		if (code === null) {
			effects.exit("chunkText");
			effects.exit("paragraph");
			effects.consume(code);
			return;
		}
		if (markdownLineEnding(code)) {
			effects.consume(code);
			effects.exit("chunkText");
			return lineStart;
		}
		effects.consume(code);
		return data;
	}
}
/**
* @import {Event} from 'micromark-util-types'
*/
/**
* @typedef {[number, number, Array<Event>]} Change
* @typedef {[number, number, number]} Jump
*/
/**
* Tracks a bunch of edits.
*
* Port of `edit_map.rs` from `markdown-rs`:
* <https://github.com/wooorm/markdown-rs/blob/1506572f/src/util/edit_map.rs>.
*
* Deal with several changes in events, batching them together.
*
* Preferably, changes should be kept to a minimum.
* Sometimes, it’s needed to change the list of events, because parsing can be
* messy, and it helps to expose a cleaner interface of events to the compiler
* and other users.
* It can also help to merge many adjacent similar events.
* And, in other cases, it’s needed to parse subcontent: pass some events
* through another tokenizer and inject the result.
*/
var EditMap$1 = class {
	/**
	* Create a new edit map.
	*
	* @returns
	*   New instance.
	*/
	constructor() {
		/**
		* Changes by index, so `add` does not need to scan `map` (which is
		* quadratic for documents with many edits at different places).
		*
		* @type {Map<number, Change>}
		*/
		this.index = /* @__PURE__ */ new Map();
		/**
		* Record of changes.
		*
		* @type {Array<Change>}
		*/
		this.map = [];
	}
	/**
	* Create an edit: a remove and/or add at a certain place.
	*
	* @param {number} index
	*   Index at which to apply the edit.
	* @param {number} remove
	*   Count of items to remove at the index.
	* @param {Array<Event>} add
	*   Items to add at the index.
	* @returns {undefined}
	*   Nothing.
	*/
	add(index, remove, add) {
		addImplementation$1(this, index, remove, add, false);
	}
	/**
	* Create an edit: but insert `add` before existing additions, instead of
	* after them.
	*
	* @param {number} index
	*   Index at which to apply the edit.
	* @param {number} remove
	*   Count of items to remove at the index.
	* @param {Array<Event>} add
	*   Items to add at the index.
	* @returns {undefined}
	*   Nothing.
	*/
	addBefore(index, remove, add) {
		addImplementation$1(this, index, remove, add, true);
	}
	/**
	* Done, change the events.
	*
	* @param {Array<Event>} events
	*   List of events to apply the edits to.
	* @returns {undefined}
	*   Nothing.
	*/
	consume(events) {
		this.map.sort(function(a, b) {
			return a[0] - b[0];
		});
		if (this.map.length === 0) return;
		let index = this.map.length;
		/** @type {Array<Array<Event>>} */
		const vecs = [];
		while (index > 0) {
			index -= 1;
			vecs.push(events.slice(this.map[index][0] + this.map[index][1]), this.map[index][2]);
			events.length = this.map[index][0];
		}
		vecs.push(events.slice());
		events.length = 0;
		let slice = vecs.pop();
		while (slice) {
			for (const element of slice) events.push(element);
			slice = vecs.pop();
		}
		this.map.length = 0;
		this.index.clear();
	}
};
/**
* Create an edit.
*
* @param {EditMap} editMap
*   Edit map to apply to.
* @param {number} at
*   Index at which to apply the edit.
* @param {number} remove
*   Count of items to remove at the index.
* @param {Array<Event>} add
*   Items to add at the index.
* @param {boolean} before
*   Insert `add` before existing additions at `at`, instead of after them.
* @returns {undefined}
*   Nothing.
*/
function addImplementation$1(editMap, at, remove, add, before) {
	if (remove === 0 && add.length === 0) return;
	const existing = editMap.index.get(at);
	if (existing) {
		existing[1] += remove;
		if (before) {
			add.push(...existing[2]);
			existing[2] = add;
		} else existing[2].push(...add);
		return;
	}
	/** @type {Change} */
	const change = [
		at,
		remove,
		add
	];
	editMap.map.push(change);
	editMap.index.set(at, change);
}
/**
* @import {
*   Construct,
*   ContainerState,
*   InitialConstruct,
*   Initializer,
*   Point,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/**
* @typedef {[Construct, ContainerState]} StackItem
*   Construct and its state.
*/
/** @type {InitialConstruct} */
const document$2 = { tokenize: initializeDocument };
/** @type {Construct} */
const containerConstruct = { tokenize: tokenizeContainer };
/**
* @this {TokenizeContext}
*   Self.
* @type {Initializer}
*   Initializer.
*/
function initializeDocument(effects) {
	const self = this;
	/** @type {Array<StackItem>} */
	const stack = [];
	let continued = 0;
	/** @type {TokenizeContext | undefined} */
	let childFlow;
	/** @type {Token | undefined} */
	let childToken;
	/** @type {number} */
	let lineStartOffset;
	return start;
	/** @type {State} */
	function start(code) {
		if (continued < stack.length) {
			const item = stack[continued];
			self.containerState = item[1];
			return effects.attempt(item[0].continuation, documentContinue, checkNewContainers)(code);
		}
		return checkNewContainers(code);
	}
	/** @type {State} */
	function documentContinue(code) {
		continued++;
		if (self.containerState._closeFlow) {
			self.containerState._closeFlow = void 0;
			if (childFlow) closeFlow();
			const indexBeforeExits = self.events.length;
			let indexBeforeFlow = indexBeforeExits;
			/** @type {Point | undefined} */
			let point;
			while (indexBeforeFlow--) if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === "chunkFlow") {
				point = self.events[indexBeforeFlow][1].end;
				break;
			}
			exitContainers(continued);
			let index = indexBeforeExits;
			while (index < self.events.length) {
				self.events[index][1].end = { ...point };
				index++;
			}
			const editMap = new EditMap$1();
			editMap.add(indexBeforeFlow + 1, 0, self.events.slice(indexBeforeExits));
			editMap.add(indexBeforeExits, index - indexBeforeExits, []);
			editMap.consume(self.events);
			return checkNewContainers(code);
		}
		return start(code);
	}
	/** @type {State} */
	function checkNewContainers(code) {
		if (continued === stack.length) {
			if (!childFlow) return documentContinued(code);
			if (childFlow.currentConstruct && childFlow.currentConstruct.concrete) return flowStart(code);
			self.interrupt = Boolean(childFlow.currentConstruct && !childFlow._gfmTableDynamicInterruptHack);
		}
		self.containerState = {};
		return effects.check(containerConstruct, thereIsANewContainer, thereIsNoNewContainer)(code);
	}
	/** @type {State} */
	function thereIsANewContainer(code) {
		if (childFlow) closeFlow();
		exitContainers(continued);
		return documentContinued(code);
	}
	/** @type {State} */
	function thereIsNoNewContainer(code) {
		self.parser.lazy[self.now().line] = continued !== stack.length;
		lineStartOffset = self.now().offset;
		return flowStart(code);
	}
	/** @type {State} */
	function documentContinued(code) {
		self.containerState = {};
		return effects.attempt(containerConstruct, containerContinue, flowStart)(code);
	}
	/** @type {State} */
	function containerContinue(code) {
		continued++;
		stack.push([self.currentConstruct, self.containerState]);
		return documentContinued(code);
	}
	/** @type {State} */
	function flowStart(code) {
		if (code === null) {
			if (childFlow) closeFlow();
			exitContainers(0);
			effects.consume(code);
			return;
		}
		childFlow = childFlow || self.parser.flow(self.now());
		effects.enter("chunkFlow", {
			_tokenizer: childFlow,
			contentType: "flow",
			previous: childToken
		});
		return flowContinue(code);
	}
	/** @type {State} */
	function flowContinue(code) {
		if (code === null) {
			writeToChild(effects.exit("chunkFlow"), true);
			exitContainers(0);
			effects.consume(code);
			return;
		}
		if (markdownLineEnding(code)) {
			effects.consume(code);
			writeToChild(effects.exit("chunkFlow"));
			continued = 0;
			self.interrupt = void 0;
			return start;
		}
		effects.consume(code);
		return flowContinue;
	}
	/**
	* @param {Token} token
	*   Token.
	* @param {boolean | undefined} [endOfFile]
	*   Whether the token is at the end of the file (default: `false`).
	* @returns {undefined}
	*   Nothing.
	*/
	function writeToChild(token, endOfFile) {
		const stream = self.sliceStream(token);
		if (endOfFile) stream.push(null);
		token.previous = childToken;
		if (childToken) childToken.next = token;
		childToken = token;
		childFlow.defineSkip(token.start);
		childFlow.write(stream);
		if (self.parser.lazy[token.start.line]) {
			let index = childFlow.events.length;
			while (index--) if (childFlow.events[index][1].start.offset < lineStartOffset && (!childFlow.events[index][1].end || childFlow.events[index][1].end.offset > lineStartOffset)) return;
			const indexBeforeExits = self.events.length;
			let indexBeforeFlow = indexBeforeExits;
			/** @type {boolean | undefined} */
			let seen;
			/** @type {Point | undefined} */
			let point;
			while (indexBeforeFlow--) if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === "chunkFlow") {
				if (seen) {
					point = self.events[indexBeforeFlow][1].end;
					break;
				}
				seen = true;
			}
			exitContainers(continued);
			index = indexBeforeExits;
			while (index < self.events.length) {
				self.events[index][1].end = { ...point };
				index++;
			}
			const editMap = new EditMap$1();
			editMap.add(indexBeforeFlow + 1, 0, self.events.slice(indexBeforeExits));
			editMap.add(indexBeforeExits, index - indexBeforeExits, []);
			editMap.consume(self.events);
		}
	}
	/**
	* @param {number} size
	*   Size.
	* @returns {undefined}
	*   Nothing.
	*/
	function exitContainers(size) {
		let index = stack.length;
		while (index-- > size) {
			const entry = stack[index];
			self.containerState = entry[1];
			entry[0].exit.call(self, effects);
		}
		stack.length = size;
	}
	function closeFlow() {
		childFlow.write([null]);
		childToken = void 0;
		childFlow = void 0;
		self.containerState._closeFlow = void 0;
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*   Tokenizer.
*/
function tokenizeContainer(effects, ok, nok) {
	return factorySpace(effects, effects.attempt(this.parser.constructs.document, ok, nok), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
}
/**
* @import {Code} from 'micromark-util-types'
*/
/**
* Classify whether a code represents whitespace, punctuation, or something
* else.
*
* Used for attention (emphasis, strong), whose sequences can open or close
* based on the class of surrounding characters.
*
* > 👉 **Note**: eof (`null`) is seen as whitespace.
*
* @param {Code} code
*   Code.
* @returns {typeof constants.characterGroupWhitespace | typeof constants.characterGroupPunctuation | undefined}
*   Group.
*/
function classifyCharacter(code) {
	if (code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return 1;
	if (unicodePunctuation(code)) return 2;
}
/**
* @import {Event, Resolver, TokenizeContext} from 'micromark-util-types'
*/
/**
* Call all `resolveAll`s.
*
* @param {ReadonlyArray<{resolveAll?: Resolver | undefined}>} constructs
*   List of constructs, optionally with `resolveAll`s.
* @param {Array<Event>} events
*   List of events.
* @param {TokenizeContext} context
*   Context used by `tokenize`.
* @returns {Array<Event>}
*   Changed events.
*/
function resolveAll(constructs, events, context) {
	/** @type {Array<Resolver>} */
	const called = [];
	let index = -1;
	while (++index < constructs.length) {
		const resolve = constructs[index].resolveAll;
		if (resolve && !called.includes(resolve)) {
			events = resolve(events, context);
			called.push(resolve);
		}
	}
	return events;
}
/**
* @import {
*   Code,
*   Construct,
*   Event,
*   Point,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const attention = {
	name: "attention",
	resolveAll: resolveAllAttention,
	tokenize: tokenizeAttention
};
/**
* Take all events and resolve attention to emphasis or strong.
*
* @type {Resolver}
*/
function resolveAllAttention(events, context) {
	let index = -1;
	/** @type {Array<Event>} */
	let nextEvents;
	while (++index < events.length) if (events[index][0] === "enter" && events[index][1].type === "attentionSequence" && events[index][1]._close) {
		let open = index;
		while (open--) if (events[open][0] === "exit" && events[open][1].type === "attentionSequence" && events[open][1]._open && context.sliceSerialize(events[open][1]).charCodeAt(0) === context.sliceSerialize(events[index][1]).charCodeAt(0)) {
			if ((events[open][1]._close || events[index][1]._open) && (events[index][1].end.offset - events[index][1].start.offset) % 3 && !((events[open][1].end.offset - events[open][1].start.offset + events[index][1].end.offset - events[index][1].start.offset) % 3)) continue;
			const use = events[open][1].end.offset - events[open][1].start.offset > 1 && events[index][1].end.offset - events[index][1].start.offset > 1 ? 2 : 1;
			const start = { ...events[open][1].end };
			const end = { ...events[index][1].start };
			movePoint(start, -use);
			movePoint(end, use);
			const openingSequence = {
				type: use > 1 ? "strongSequence" : "emphasisSequence",
				start,
				end: { ...events[open][1].end }
			};
			const closingSequence = {
				type: use > 1 ? "strongSequence" : "emphasisSequence",
				start: { ...events[index][1].start },
				end
			};
			const text = {
				type: use > 1 ? "strongText" : "emphasisText",
				start: { ...events[open][1].end },
				end: { ...events[index][1].start }
			};
			const group = {
				type: use > 1 ? "strong" : "emphasis",
				start: { ...openingSequence.start },
				end: { ...closingSequence.end }
			};
			events[open][1].end = { ...openingSequence.start };
			events[index][1].start = { ...closingSequence.end };
			nextEvents = [];
			if (events[open][1].end.offset - events[open][1].start.offset) nextEvents = push(nextEvents, [[
				"enter",
				events[open][1],
				context
			], [
				"exit",
				events[open][1],
				context
			]]);
			nextEvents = push(nextEvents, [
				[
					"enter",
					group,
					context
				],
				[
					"enter",
					openingSequence,
					context
				],
				[
					"exit",
					openingSequence,
					context
				],
				[
					"enter",
					text,
					context
				]
			]);
			nextEvents = push(nextEvents, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + 1, index), context));
			nextEvents = push(nextEvents, [
				[
					"exit",
					text,
					context
				],
				[
					"enter",
					closingSequence,
					context
				],
				[
					"exit",
					closingSequence,
					context
				],
				[
					"exit",
					group,
					context
				]
			]);
			/** @type {number} */
			let offset = 0;
			if (events[index][1].end.offset - events[index][1].start.offset) {
				offset = 2;
				nextEvents = push(nextEvents, [[
					"enter",
					events[index][1],
					context
				], [
					"exit",
					events[index][1],
					context
				]]);
			}
			splice(events, open - 1, index - open + 3, nextEvents);
			index = open + nextEvents.length - offset - 2;
			break;
		}
	}
	index = -1;
	while (++index < events.length) if (events[index][1].type === "attentionSequence") events[index][1].type = "data";
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeAttention(effects, ok) {
	const attentionMarkers = this.parser.constructs.attentionMarkers.null;
	const previous = this.previous;
	const before = classifyCharacter(previous);
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Before a sequence.
	*
	* ```markdown
	* > | **
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		marker = code;
		effects.enter("attentionSequence");
		return inside(code);
	}
	/**
	* In a sequence.
	*
	* ```markdown
	* > | **
	*     ^^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === marker) {
			effects.consume(code);
			return inside;
		}
		const token = effects.exit("attentionSequence");
		const after = classifyCharacter(code);
		const open = !after || after === 2 && before || attentionMarkers.includes(code) && code !== 42 && code !== 95;
		const close = !before || before === 2 && after || attentionMarkers.includes(previous) && previous !== 42 && previous !== 95;
		token._open = Boolean(marker === 42 ? open : open && (before || !close));
		token._close = Boolean(marker === 42 ? close : close && (after || !open));
		return ok(code);
	}
}
/**
* Move a point a bit.
*
* Note: `move` only works inside lines! It’s not possible to move past other
* chunks (replacement characters, tabs, or line endings).
*
* @param {Point} point
*   Point.
* @param {number} offset
*   Amount to move.
* @returns {undefined}
*   Nothing.
*/
function movePoint(point, offset) {
	point.column += offset;
	point.offset += offset;
	point._bufferIndex += offset;
}
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const autolink = {
	name: "autolink",
	tokenize: tokenizeAutolink
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeAutolink(effects, ok, nok) {
	let size = 0;
	return start;
	/**
	* Start of an autolink.
	*
	* ```markdown
	* > | a<https://example.com>b
	*      ^
	* > | a<user@example.com>b
	*      ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("autolink");
		effects.enter("autolinkMarker");
		effects.consume(code);
		effects.exit("autolinkMarker");
		effects.enter("autolinkProtocol");
		return open;
	}
	/**
	* After `<`, at protocol or atext.
	*
	* ```markdown
	* > | a<https://example.com>b
	*       ^
	* > | a<user@example.com>b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (asciiAlpha(code)) {
			effects.consume(code);
			return schemeOrEmailAtext;
		}
		if (code === 64) return nok(code);
		return emailAtext(code);
	}
	/**
	* At second byte of protocol or atext.
	*
	* ```markdown
	* > | a<https://example.com>b
	*        ^
	* > | a<user@example.com>b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function schemeOrEmailAtext(code) {
		if (code === 43 || code === 45 || code === 46 || asciiAlphanumeric(code)) {
			size = 1;
			return schemeInsideOrEmailAtext(code);
		}
		return emailAtext(code);
	}
	/**
	* In ambiguous protocol or atext.
	*
	* ```markdown
	* > | a<https://example.com>b
	*        ^
	* > | a<user@example.com>b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function schemeInsideOrEmailAtext(code) {
		if (code === 58) {
			effects.consume(code);
			size = 0;
			return urlInside;
		}
		if ((code === 43 || code === 45 || code === 46 || asciiAlphanumeric(code)) && size++ < 32) {
			effects.consume(code);
			return schemeInsideOrEmailAtext;
		}
		size = 0;
		return emailAtext(code);
	}
	/**
	* After protocol, in URL.
	*
	* ```markdown
	* > | a<https://example.com>b
	*             ^
	* ```
	*
	* @type {State}
	*/
	function urlInside(code) {
		if (code === 62) {
			effects.exit("autolinkProtocol");
			effects.enter("autolinkMarker");
			effects.consume(code);
			effects.exit("autolinkMarker");
			effects.exit("autolink");
			return ok;
		}
		if (code === null || code === 32 || code === 60 || asciiControl(code)) return nok(code);
		effects.consume(code);
		return urlInside;
	}
	/**
	* In email atext.
	*
	* ```markdown
	* > | a<user.name@example.com>b
	*              ^
	* ```
	*
	* @type {State}
	*/
	function emailAtext(code) {
		if (code === 64) {
			effects.consume(code);
			return emailAtSignOrDot;
		}
		if (asciiAtext(code)) {
			effects.consume(code);
			return emailAtext;
		}
		return nok(code);
	}
	/**
	* In label, after at-sign or dot.
	*
	* ```markdown
	* > | a<user.name@example.com>b
	*                 ^       ^
	* ```
	*
	* @type {State}
	*/
	function emailAtSignOrDot(code) {
		return asciiAlphanumeric(code) ? emailLabel(code) : nok(code);
	}
	/**
	* In label, where `.` and `>` are allowed.
	*
	* ```markdown
	* > | a<user.name@example.com>b
	*                   ^
	* ```
	*
	* @type {State}
	*/
	function emailLabel(code) {
		if (code === 46) {
			effects.consume(code);
			size = 0;
			return emailAtSignOrDot;
		}
		if (code === 62) {
			effects.exit("autolinkProtocol").type = "autolinkEmail";
			effects.enter("autolinkMarker");
			effects.consume(code);
			effects.exit("autolinkMarker");
			effects.exit("autolink");
			return ok;
		}
		return emailValue(code);
	}
	/**
	* In label, where `.` and `>` are *not* allowed.
	*
	* Though, this is also used in `emailLabel` to parse other values.
	*
	* ```markdown
	* > | a<user.name@ex-ample.com>b
	*                    ^
	* ```
	*
	* @type {State}
	*/
	function emailValue(code) {
		if ((code === 45 || asciiAlphanumeric(code)) && size++ < 63) {
			const next = code === 45 ? emailValue : emailLabel;
			effects.consume(code);
			return next;
		}
		return nok(code);
	}
}
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const blankLine = {
	partial: true,
	tokenize: tokenizeBlankLine
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeBlankLine(effects, ok, nok) {
	return start;
	/**
	* Start of blank line.
	*
	* > 👉 **Note**: `␠` represents a space character.
	*
	* ```markdown
	* > | ␠␠␊
	*     ^
	* > | ␊
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		return markdownSpace(code) ? factorySpace(effects, after, "linePrefix")(code) : after(code);
	}
	/**
	* At eof/eol, after optional whitespace.
	*
	* > 👉 **Note**: `␠` represents a space character.
	*
	* ```markdown
	* > | ␠␠␊
	*       ^
	* > | ␊
	*     ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return code === null || markdownLineEnding(code) ? ok(code) : nok(code);
	}
}
/**
* @import {
*   Construct,
*   Exiter,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const blockQuote = {
	continuation: { tokenize: tokenizeBlockQuoteContinuation },
	exit: exit$1,
	name: "blockQuote",
	tokenize: tokenizeBlockQuoteStart
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeBlockQuoteStart(effects, ok, nok) {
	const self = this;
	return start;
	/**
	* Start of block quote.
	*
	* ```markdown
	* > | > a
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (code === 62) {
			const state = self.containerState;
			if (!state.open) {
				effects.enter("blockQuote", { _container: true });
				state.open = true;
			}
			effects.enter("blockQuotePrefix");
			effects.enter("blockQuoteMarker");
			effects.consume(code);
			effects.exit("blockQuoteMarker");
			return after;
		}
		return nok(code);
	}
	/**
	* After `>`, before optional whitespace.
	*
	* ```markdown
	* > | > a
	*      ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		if (markdownSpace(code)) {
			effects.enter("blockQuotePrefixWhitespace");
			effects.consume(code);
			effects.exit("blockQuotePrefixWhitespace");
			effects.exit("blockQuotePrefix");
			return ok;
		}
		effects.exit("blockQuotePrefix");
		return ok(code);
	}
}
/**
* Start of block quote continuation.
*
* ```markdown
*   | > a
* > | > b
*     ^
* ```
*
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeBlockQuoteContinuation(effects, ok, nok) {
	const self = this;
	return contStart;
	/**
	* Start of block quote continuation.
	*
	* Also used to parse the first block quote opening.
	*
	* ```markdown
	*   | > a
	* > | > b
	*     ^
	* ```
	*
	* @type {State}
	*/
	function contStart(code) {
		if (markdownSpace(code)) return factorySpace(effects, contBefore, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code);
		return contBefore(code);
	}
	/**
	* At `>`, after optional whitespace.
	*
	* Also used to parse the first block quote opening.
	*
	* ```markdown
	*   | > a
	* > | > b
	*     ^
	* ```
	*
	* @type {State}
	*/
	function contBefore(code) {
		return effects.attempt(blockQuote, ok, nok)(code);
	}
}
/** @type {Exiter} */
function exit$1(effects) {
	effects.exit("blockQuote");
}
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const characterEscape = {
	name: "characterEscape",
	tokenize: tokenizeCharacterEscape
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCharacterEscape(effects, ok, nok) {
	return start;
	/**
	* Start of character escape.
	*
	* ```markdown
	* > | a\*b
	*      ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("characterEscape");
		effects.enter("escapeMarker");
		effects.consume(code);
		effects.exit("escapeMarker");
		return inside;
	}
	/**
	* After `\`, at punctuation.
	*
	* ```markdown
	* > | a\*b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (asciiPunctuation(code)) {
			effects.enter("characterEscapeValue");
			effects.consume(code);
			effects.exit("characterEscapeValue");
			effects.exit("characterEscape");
			return ok;
		}
		return nok(code);
	}
}
/**
* @import {
*   Code,
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const characterReference = {
	name: "characterReference",
	tokenize: tokenizeCharacterReference
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCharacterReference(effects, ok, nok) {
	const self = this;
	let size = 0;
	/** @type {number} */
	let max;
	/** @type {(code: Code) => boolean} */
	let test;
	return start;
	/**
	* Start of character reference.
	*
	* ```markdown
	* > | a&amp;b
	*      ^
	* > | a&#123;b
	*      ^
	* > | a&#x9;b
	*      ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("characterReference");
		effects.enter("characterReferenceMarker");
		effects.consume(code);
		effects.exit("characterReferenceMarker");
		return open;
	}
	/**
	* After `&`, at `#` for numeric references or alphanumeric for named
	* references.
	*
	* ```markdown
	* > | a&amp;b
	*       ^
	* > | a&#123;b
	*       ^
	* > | a&#x9;b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (code === 35) {
			effects.enter("characterReferenceMarkerNumeric");
			effects.consume(code);
			effects.exit("characterReferenceMarkerNumeric");
			return numeric;
		}
		effects.enter("characterReferenceValue");
		max = 31;
		test = asciiAlphanumeric;
		return value(code);
	}
	/**
	* After `#`, at `x` for hexadecimals or digit for decimals.
	*
	* ```markdown
	* > | a&#123;b
	*        ^
	* > | a&#x9;b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function numeric(code) {
		if (code === 88 || code === 120) {
			effects.enter("characterReferenceMarkerHexadecimal");
			effects.consume(code);
			effects.exit("characterReferenceMarkerHexadecimal");
			effects.enter("characterReferenceValue");
			max = 6;
			test = asciiHexDigit;
			return value;
		}
		effects.enter("characterReferenceValue");
		max = 7;
		test = asciiDigit;
		return value(code);
	}
	/**
	* After markers (`&#x`, `&#`, or `&`), in value, before `;`.
	*
	* The character reference kind defines what and how many characters are
	* allowed.
	*
	* ```markdown
	* > | a&amp;b
	*       ^^^
	* > | a&#123;b
	*        ^^^
	* > | a&#x9;b
	*         ^
	* ```
	*
	* @type {State}
	*/
	function value(code) {
		if (code === 59 && size) {
			const token = effects.exit("characterReferenceValue");
			if (test === asciiAlphanumeric && !decodeNamedCharacterReference(self.sliceSerialize(token))) return nok(code);
			effects.enter("characterReferenceMarker");
			effects.consume(code);
			effects.exit("characterReferenceMarker");
			effects.exit("characterReference");
			return ok;
		}
		if (test(code) && size++ < max) {
			effects.consume(code);
			return value;
		}
		return nok(code);
	}
}
/** @type {Construct} */
const nonLazyContinuation$2 = {
	partial: true,
	tokenize: tokenizeNonLazyContinuation$2
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeNonLazyContinuation$2(effects, ok, nok) {
	const self = this;
	return start;
	/**
	* At eol, before continuation.
	*
	* ```markdown
	* > | * ```js
	*            ^
	*   | b
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (code === null) return nok(code);
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return after;
	}
	/**
	* A continuation.
	*
	* ```markdown
	*   | * ```js
	* > | b
	*     ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
	}
}
/**
* @import {
*   Code,
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const codeFenced = {
	concrete: true,
	name: "codeFenced",
	tokenize: tokenizeCodeFenced
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCodeFenced(effects, ok, nok) {
	const self = this;
	/** @type {Construct} */
	const closeStart = {
		partial: true,
		tokenize: tokenizeCloseStart
	};
	let initialPrefix = 0;
	let sizeOpen = 0;
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Start of code.
	*
	* ```markdown
	* > | ~~~js
	*     ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		return beforeSequenceOpen(code);
	}
	/**
	* In opening fence, after prefix, at sequence.
	*
	* ```markdown
	* > | ~~~js
	*     ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function beforeSequenceOpen(code) {
		const tail = self.events[self.events.length - 1];
		initialPrefix = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
		marker = code;
		effects.enter("codeFenced");
		effects.enter("codeFencedFence");
		effects.enter("codeFencedFenceSequence");
		return sequenceOpen(code);
	}
	/**
	* In opening fence sequence.
	*
	* ```markdown
	* > | ~~~js
	*      ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function sequenceOpen(code) {
		if (code === marker) {
			sizeOpen++;
			effects.consume(code);
			return sequenceOpen;
		}
		if (sizeOpen < 3) return nok(code);
		effects.exit("codeFencedFenceSequence");
		return markdownSpace(code) ? factorySpace(effects, infoBefore, "whitespace")(code) : infoBefore(code);
	}
	/**
	* In opening fence, after the sequence (and optional whitespace), before info.
	*
	* ```markdown
	* > | ~~~js
	*        ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function infoBefore(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("codeFencedFence");
			return self.interrupt ? ok(code) : effects.check(nonLazyContinuation$2, atNonLazyBreak, after)(code);
		}
		effects.enter("codeFencedFenceInfo");
		effects.enter("chunkString", { contentType: "string" });
		return info(code);
	}
	/**
	* In info.
	*
	* ```markdown
	* > | ~~~js
	*        ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function info(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("chunkString");
			effects.exit("codeFencedFenceInfo");
			return infoBefore(code);
		}
		if (markdownSpace(code)) {
			effects.exit("chunkString");
			effects.exit("codeFencedFenceInfo");
			return factorySpace(effects, metaBefore, "whitespace")(code);
		}
		if (code === 96 && code === marker) return nok(code);
		effects.consume(code);
		return info;
	}
	/**
	* In opening fence, after info and whitespace, before meta.
	*
	* ```markdown
	* > | ~~~js eval
	*           ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function metaBefore(code) {
		if (code === null || markdownLineEnding(code)) return infoBefore(code);
		effects.enter("codeFencedFenceMeta");
		effects.enter("chunkString", { contentType: "string" });
		return meta(code);
	}
	/**
	* In meta.
	*
	* ```markdown
	* > | ~~~js eval
	*           ^
	*   | alert(1)
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function meta(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("chunkString");
			effects.exit("codeFencedFenceMeta");
			return infoBefore(code);
		}
		if (code === 96 && code === marker) return nok(code);
		effects.consume(code);
		return meta;
	}
	/**
	* At eol/eof in code, before a non-lazy closing fence or content.
	*
	* ```markdown
	* > | ~~~js
	*          ^
	* > | alert(1)
	*             ^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function atNonLazyBreak(code) {
		return effects.attempt(closeStart, after, contentBefore)(code);
	}
	/**
	* Before code content, not a closing fence, at eol.
	*
	* ```markdown
	*   | ~~~js
	* > | alert(1)
	*             ^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function contentBefore(code) {
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return contentStart;
	}
	/**
	* Before code content, not a closing fence.
	*
	* ```markdown
	*   | ~~~js
	* > | alert(1)
	*     ^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function contentStart(code) {
		return initialPrefix > 0 && markdownSpace(code) ? factorySpace(effects, beforeContentChunk, "linePrefix", initialPrefix + 1)(code) : beforeContentChunk(code);
	}
	/**
	* Before code content, after optional prefix.
	*
	* ```markdown
	*   | ~~~js
	* > | alert(1)
	*     ^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function beforeContentChunk(code) {
		if (code === null || markdownLineEnding(code)) return effects.check(nonLazyContinuation$2, atNonLazyBreak, after)(code);
		effects.enter("codeFlowValue");
		return contentChunk(code);
	}
	/**
	* In code content.
	*
	* ```markdown
	*   | ~~~js
	* > | alert(1)
	*     ^^^^^^^^
	*   | ~~~
	* ```
	*
	* @type {State}
	*/
	function contentChunk(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("codeFlowValue");
			return beforeContentChunk(code);
		}
		effects.consume(code);
		return contentChunk;
	}
	/**
	* After code.
	*
	* ```markdown
	*   | ~~~js
	*   | alert(1)
	* > | ~~~
	*        ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		effects.exit("codeFenced");
		return ok(code);
	}
	/**
	* @this {TokenizeContext}
	*   Context.
	* @type {Tokenizer}
	*/
	function tokenizeCloseStart(effects, ok, nok) {
		let size = 0;
		return startBefore;
		/**
		*
		*
		* @type {State}
		*/
		function startBefore(code) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return start;
		}
		/**
		* Before closing fence, at optional whitespace.
		*
		* ```markdown
		*   | ~~~js
		*   | alert(1)
		* > | ~~~
		*     ^
		* ```
		*
		* @type {State}
		*/
		function start(code) {
			effects.enter("codeFencedFence");
			return markdownSpace(code) ? factorySpace(effects, beforeSequenceClose, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code) : beforeSequenceClose(code);
		}
		/**
		* In closing fence, after optional whitespace, at sequence.
		*
		* ```markdown
		*   | ~~~js
		*   | alert(1)
		* > | ~~~
		*     ^
		* ```
		*
		* @type {State}
		*/
		function beforeSequenceClose(code) {
			if (code === marker) {
				effects.enter("codeFencedFenceSequence");
				return sequenceClose(code);
			}
			return nok(code);
		}
		/**
		* In closing fence sequence.
		*
		* ```markdown
		*   | ~~~js
		*   | alert(1)
		* > | ~~~
		*     ^
		* ```
		*
		* @type {State}
		*/
		function sequenceClose(code) {
			if (code === marker) {
				size++;
				effects.consume(code);
				return sequenceClose;
			}
			if (size >= sizeOpen) {
				effects.exit("codeFencedFenceSequence");
				return markdownSpace(code) ? factorySpace(effects, sequenceCloseAfter, "whitespace")(code) : sequenceCloseAfter(code);
			}
			return nok(code);
		}
		/**
		* After closing fence sequence, after optional whitespace.
		*
		* ```markdown
		*   | ~~~js
		*   | alert(1)
		* > | ~~~
		*        ^
		* ```
		*
		* @type {State}
		*/
		function sequenceCloseAfter(code) {
			if (code === null || markdownLineEnding(code)) {
				effects.exit("codeFencedFence");
				return ok(code);
			}
			return nok(code);
		}
	}
}
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const codeIndented = {
	name: "codeIndented",
	tokenize: tokenizeCodeIndented
};
/** @type {Construct} */
const furtherStart = {
	partial: true,
	tokenize: tokenizeFurtherStart
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCodeIndented(effects, ok, nok) {
	return start;
	/**
	* Start of code (indented).
	*
	* > **Parsing note**: it is not needed to check if this first line is a
	* > filled line (that it has a non-whitespace character), because blank lines
	* > are parsed already, so we never run into that.
	*
	* ```markdown
	* > |     aaa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("codeIndented");
		return factorySpaceMinMax(effects, atBreak, nok, "linePrefix", 4, 4)(code);
	}
	/**
	* At a break.
	*
	* ```markdown
	* > |     aaa
	*         ^  ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (code === null) return after(code);
		if (markdownLineEnding(code)) return effects.attempt(furtherStart, atBreak, after)(code);
		effects.enter("codeFlowValue");
		return inside(code);
	}
	/**
	* In code content.
	*
	* ```markdown
	* > |     aaa
	*         ^^^^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("codeFlowValue");
			return atBreak(code);
		}
		effects.consume(code);
		return inside;
	}
	/** @type {State} */
	function after(code) {
		effects.exit("codeIndented");
		return ok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeFurtherStart(effects, ok, nok) {
	const self = this;
	return furtherStart;
	/**
	* At eol, trying to parse another indent.
	*
	* ```markdown
	* > |     aaa
	*            ^
	*   |     bbb
	* ```
	*
	* @type {State}
	*/
	function furtherStart(code) {
		if (self.parser.lazy[self.now().line]) return nok(code);
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return furtherStart;
		}
		return factorySpaceMinMax(effects, ok, onNotEnoughPrefix, "linePrefix", 4, 4)(code);
	}
	/**
	* After not enough of a prefix.
	*
	* A following line ending is another (potentially blank) line to try,
	* anything else means this isn’t a continuation.
	*
	* ```markdown
	* > |     aaa
	*
	*   |     bbb
	* ```
	*
	* @type {State}
	*/
	function onNotEnoughPrefix(code) {
		return markdownLineEnding(code) ? furtherStart(code) : nok(code);
	}
}
/**
* @import {
*   Construct,
*   Previous,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const codeText = {
	name: "codeText",
	previous: previous$2,
	resolve: resolveCodeText,
	tokenize: tokenizeCodeText
};
/** @type {Resolver} */
function resolveCodeText(events) {
	let tailExitIndex = events.length - 4;
	let headEnterIndex = 3;
	/** @type {number} */
	let index;
	/** @type {number | undefined} */
	let enter;
	if ((events[headEnterIndex][1].type === "lineEnding" || events[headEnterIndex][1].type === "space") && (events[tailExitIndex][1].type === "lineEnding" || events[tailExitIndex][1].type === "space")) {
		index = headEnterIndex;
		while (++index < tailExitIndex) if (events[index][1].type === "codeTextData") {
			events[headEnterIndex][1].type = "codeTextPadding";
			events[tailExitIndex][1].type = "codeTextPadding";
			headEnterIndex += 2;
			tailExitIndex -= 2;
			break;
		}
	}
	index = headEnterIndex - 1;
	tailExitIndex++;
	while (++index <= tailExitIndex) if (enter === void 0) {
		if (index !== tailExitIndex && events[index][1].type !== "lineEnding") enter = index;
	} else if (index === tailExitIndex || events[index][1].type === "lineEnding") {
		events[enter][1].type = "codeTextData";
		if (index !== enter + 2) {
			events[enter][1].end = events[index - 1][1].end;
			events.splice(enter + 2, index - enter - 2);
			tailExitIndex -= index - enter - 2;
			index = enter + 2;
		}
		enter = void 0;
	}
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Previous}
*/
function previous$2(code) {
	return code !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeCodeText(effects, ok, nok) {
	let sizeOpen = 0;
	/** @type {number} */
	let size;
	/** @type {Token} */
	let token;
	return start;
	/**
	* Start of code (text).
	*
	* ```markdown
	* > | `a`
	*     ^
	* > | \`a`
	*      ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("codeText");
		effects.enter("codeTextSequence");
		return sequenceOpen(code);
	}
	/**
	* In opening sequence.
	*
	* ```markdown
	* > | `a`
	*     ^
	* ```
	*
	* @type {State}
	*/
	function sequenceOpen(code) {
		if (code === 96) {
			effects.consume(code);
			sizeOpen++;
			return sequenceOpen;
		}
		effects.exit("codeTextSequence");
		return between(code);
	}
	/**
	* Between something and something else.
	*
	* ```markdown
	* > | `a`
	*      ^^
	* ```
	*
	* @type {State}
	*/
	function between(code) {
		if (code === null) return nok(code);
		if (code === 32) {
			effects.enter("space");
			effects.consume(code);
			effects.exit("space");
			return between;
		}
		if (code === 96) {
			token = effects.enter("codeTextSequence");
			size = 0;
			return sequenceClose(code);
		}
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return between;
		}
		effects.enter("codeTextData");
		return data(code);
	}
	/**
	* In data.
	*
	* ```markdown
	* > | `a`
	*      ^
	* ```
	*
	* @type {State}
	*/
	function data(code) {
		if (code === null || code === 32 || code === 96 || markdownLineEnding(code)) {
			effects.exit("codeTextData");
			return between(code);
		}
		effects.consume(code);
		return data;
	}
	/**
	* In closing sequence.
	*
	* ```markdown
	* > | `a`
	*       ^
	* ```
	*
	* @type {State}
	*/
	function sequenceClose(code) {
		if (code === 96) {
			effects.consume(code);
			size++;
			return sequenceClose;
		}
		if (size === sizeOpen) {
			effects.exit("codeTextSequence");
			effects.exit("codeText");
			return ok(code);
		}
		token.type = "codeTextData";
		return data(code);
	}
}
/**
* Some of the internal operations of micromark do lots of editing
* operations on very large arrays. This runs into problems with two
* properties of most circa-2020 JavaScript interpreters:
*
*  - Array-length modifications at the high end of an array (push/pop) are
*    expected to be common and are implemented in (amortized) time
*    proportional to the number of elements added or removed, whereas
*    other operations (shift/unshift and splice) are much less efficient.
*  - Function arguments are passed on the stack, so adding tens of thousands
*    of elements to an array with `arr.push(...newElements)` will frequently
*    cause stack overflows. (see <https://stackoverflow.com/questions/22123769/rangeerror-maximum-call-stack-size-exceeded-why>)
*
* SpliceBuffers are an implementation of gap buffers, which are a
* generalization of the "queue made of two stacks" idea. The splice buffer
* maintains a cursor, and moving the cursor has cost proportional to the
* distance the cursor moves, but inserting, deleting, or splicing in
* new information at the cursor is as efficient as the push/pop operation.
* This allows for an efficient sequence of splices (or pushes, pops, shifts,
* or unshifts) as long such edits happen at the same part of the array or
* generally sweep through the array from the beginning to the end.
*
* The interface for splice buffers also supports large numbers of inputs by
* passing a single array argument rather passing multiple arguments on the
* function call stack.
*
* @template T
*   Item type.
*/
var SpliceBuffer = class {
	/**
	* @param {ReadonlyArray<T> | null | undefined} [initial]
	*   Initial items (optional).
	* @returns
	*   Splice buffer.
	*/
	constructor(initial) {
		/** @type {Array<T>} */
		this.left = initial ? [...initial] : [];
		/** @type {Array<T>} */
		this.right = [];
	}
	/**
	* Array access;
	* does not move the cursor.
	*
	* @param {number} index
	*   Index.
	* @return {T}
	*   Item.
	*/
	get(index) {
		if (index < 0 || index >= this.left.length + this.right.length) throw new RangeError("Cannot access index `" + index + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
		if (index < this.left.length) return this.left[index];
		return this.right[this.right.length - index + this.left.length - 1];
	}
	/**
	* The length of the splice buffer, one greater than the largest index in the
	* array.
	*/
	get length() {
		return this.left.length + this.right.length;
	}
	/**
	* Remove and return `list[0]`;
	* moves the cursor to `0`.
	*
	* @returns {T | undefined}
	*   Item, optional.
	*/
	shift() {
		this.setCursor(0);
		return this.right.pop();
	}
	/**
	* Slice the buffer to get an array;
	* does not move the cursor.
	*
	* @param {number} start
	*   Start.
	* @param {number | null | undefined} [end]
	*   End (optional).
	* @returns {Array<T>}
	*   Array of items.
	*/
	slice(start, end) {
		/** @type {number} */
		const stop = end === null || end === void 0 ? Number.POSITIVE_INFINITY : end;
		if (stop < this.left.length) return this.left.slice(start, stop);
		if (start > this.left.length) return this.right.slice(this.right.length - stop + this.left.length, this.right.length - start + this.left.length).reverse();
		return this.left.slice(start).concat(this.right.slice(this.right.length - stop + this.left.length).reverse());
	}
	/**
	* Mimics the behavior of Array.prototype.splice() except for the change of
	* interface necessary to avoid segfaults when patching in very large arrays.
	*
	* This operation moves cursor is moved to `start` and results in the cursor
	* placed after any inserted items.
	*
	* @param {number} start
	*   Start;
	*   zero-based index at which to start changing the array;
	*   negative numbers count backwards from the end of the array and values
	*   that are out-of bounds are clamped to the appropriate end of the array.
	* @param {number | null | undefined} [deleteCount=0]
	*   Delete count (default: `0`);
	*   maximum number of elements to delete, starting from start.
	* @param {Array<T> | null | undefined} [items=[]]
	*   Items to include in place of the deleted items (default: `[]`).
	* @return {Array<T>}
	*   Any removed items.
	*/
	splice(start, deleteCount, items) {
		/** @type {number} */
		const count = deleteCount || 0;
		this.setCursor(Math.trunc(start));
		const removed = this.right.splice(this.right.length - count, Number.POSITIVE_INFINITY);
		if (items) chunkedPush(this.left, items);
		return removed.reverse();
	}
	/**
	* Remove and return the highest-numbered item in the array, so
	* `list[list.length - 1]`;
	* Moves the cursor to `length`.
	*
	* @returns {T | undefined}
	*   Item, optional.
	*/
	pop() {
		this.setCursor(Number.POSITIVE_INFINITY);
		return this.left.pop();
	}
	/**
	* Inserts a single item to the high-numbered side of the array;
	* moves the cursor to `length`.
	*
	* @param {T} item
	*   Item.
	* @returns {undefined}
	*   Nothing.
	*/
	push(item) {
		this.setCursor(Number.POSITIVE_INFINITY);
		this.left.push(item);
	}
	/**
	* Inserts many items to the high-numbered side of the array.
	* Moves the cursor to `length`.
	*
	* @param {Array<T>} items
	*   Items.
	* @returns {undefined}
	*   Nothing.
	*/
	pushMany(items) {
		this.setCursor(Number.POSITIVE_INFINITY);
		chunkedPush(this.left, items);
	}
	/**
	* Inserts a single item to the low-numbered side of the array;
	* Moves the cursor to `0`.
	*
	* @param {T} item
	*   Item.
	* @returns {undefined}
	*   Nothing.
	*/
	unshift(item) {
		this.setCursor(0);
		this.right.push(item);
	}
	/**
	* Inserts many items to the low-numbered side of the array;
	* moves the cursor to `0`.
	*
	* @param {Array<T>} items
	*   Items.
	* @returns {undefined}
	*   Nothing.
	*/
	unshiftMany(items) {
		this.setCursor(0);
		chunkedPush(this.right, items.reverse());
	}
	/**
	* Move the cursor to a specific position in the array. Requires
	* time proportional to the distance moved.
	*
	* If `n < 0`, the cursor will end up at the beginning.
	* If `n > length`, the cursor will end up at the end.
	*
	* @param {number} n
	*   Position.
	* @return {undefined}
	*   Nothing.
	*/
	setCursor(n) {
		if (n === this.left.length || n > this.left.length && this.right.length === 0 || n < 0 && this.left.length === 0) return;
		if (n < this.left.length) {
			const removed = this.left.splice(n, Number.POSITIVE_INFINITY);
			chunkedPush(this.right, removed.reverse());
		} else {
			const removed = this.right.splice(this.left.length + this.right.length - n, Number.POSITIVE_INFINITY);
			chunkedPush(this.left, removed.reverse());
		}
	}
};
/**
* Avoid stack overflow by pushing items onto the stack in segments
*
* @template T
*   Item type.
* @param {Array<T>} list
*   List to inject into.
* @param {ReadonlyArray<T>} right
*   Items to inject.
* @return {undefined}
*   Nothing.
*/
function chunkedPush(list, right) {
	/** @type {number} */
	let chunkStart = 0;
	if (right.length < 1e4) list.push(...right);
	else while (chunkStart < right.length) {
		list.push(...right.slice(chunkStart, chunkStart + 1e4));
		chunkStart += 1e4;
	}
}
/**
* @import {Chunk, Event, Token} from 'micromark-util-types'
*/
/**
* Tokenize subcontent.
*
* @param {Array<Event>} eventsArray
*   List of events.
* @returns {boolean}
*   Whether subtokens were found.
*/
function subtokenize(eventsArray) {
	/** @type {Record<string, number>} */
	const jumps = {};
	let index = -1;
	/** @type {Event} */
	let event;
	/** @type {number | undefined} */
	let lineIndex;
	/** @type {number} */
	let otherIndex;
	/** @type {Event} */
	let otherEvent;
	/** @type {Array<Event>} */
	let parameters;
	/** @type {Array<Event>} */
	let subevents;
	/** @type {boolean | undefined} */
	let more;
	const events = new SpliceBuffer(eventsArray);
	while (++index < events.length) {
		while (index in jumps) index = jumps[index];
		event = events.get(index);
		if (index && event[1].type === "chunkFlow" && events.get(index - 1)[1].type === "listItemPrefix") {
			subevents = event[1]._tokenizer.events;
			otherIndex = 0;
			if (otherIndex < subevents.length && subevents[otherIndex][1].type === "lineEndingBlank") otherIndex += 2;
			if (otherIndex < subevents.length && subevents[otherIndex][1].type === "content") while (++otherIndex < subevents.length) {
				if (subevents[otherIndex][1].type === "content") break;
				if (subevents[otherIndex][1].type === "chunkText") {
					subevents[otherIndex][1]._isInFirstContentOfListItem = true;
					otherIndex++;
				}
			}
		}
		if (event[0] === "enter") {
			if (event[1].contentType) {
				Object.assign(jumps, subcontent(events, index));
				index = jumps[index];
				more = true;
			}
		} else if (event[1]._container) {
			otherIndex = index;
			lineIndex = void 0;
			while (otherIndex--) {
				otherEvent = events.get(otherIndex);
				if (otherEvent[1].type === "lineEnding" || otherEvent[1].type === "lineEndingBlank") {
					if (otherEvent[0] === "enter") {
						if (lineIndex) events.get(lineIndex)[1].type = "lineEndingBlank";
						otherEvent[1].type = "lineEnding";
						lineIndex = otherIndex;
					}
				} else if (otherEvent[1].type === "linePrefix" || otherEvent[1].type === "listItemIndent") {} else break;
			}
			if (lineIndex) {
				event[1].end = { ...events.get(lineIndex)[1].start };
				parameters = events.slice(lineIndex, index);
				parameters.unshift(event);
				events.splice(lineIndex, index - lineIndex + 1, parameters);
			}
		}
	}
	splice(eventsArray, 0, Number.POSITIVE_INFINITY, events.slice(0));
	return !more;
}
/**
* Tokenize embedded tokens.
*
* @param {SpliceBuffer<Event>} events
*   Events.
* @param {number} eventIndex
*   Index.
* @returns {Record<string, number>}
*   Gaps.
*/
function subcontent(events, eventIndex) {
	const token = events.get(eventIndex)[1];
	const context = events.get(eventIndex)[2];
	let startPosition = eventIndex - 1;
	/** @type {Array<number>} */
	const startPositions = [];
	let tokenizer = token._tokenizer;
	if (!tokenizer) {
		tokenizer = context.parser[token.contentType](token.start);
		if (token._contentTypeTextTrailing) tokenizer._contentTypeTextTrailing = true;
	}
	const childEvents = tokenizer.events;
	/** @type {Array<[number, number]>} */
	const jumps = [];
	/** @type {Record<string, number>} */
	const gaps = {};
	/** @type {Array<Chunk>} */
	let stream;
	/** @type {Token | undefined} */
	let previous;
	let index = -1;
	/** @type {Token | undefined} */
	let current = token;
	let adjust = 0;
	let start = 0;
	const breaks = [start];
	while (current) {
		while (events.get(++startPosition)[1] !== current);
		startPositions.push(startPosition);
		if (!current._tokenizer) {
			stream = context.sliceStream(current);
			if (!current.next) stream.push(null);
			if (previous) tokenizer.defineSkip(current.start);
			if (current._isInFirstContentOfListItem) tokenizer._gfmTasklistFirstContentOfListItem = true;
			tokenizer.write(stream);
			if (current._isInFirstContentOfListItem) tokenizer._gfmTasklistFirstContentOfListItem = void 0;
		}
		previous = current;
		current = current.next;
	}
	current = token;
	while (++index < childEvents.length) if (childEvents[index][0] === "exit" && childEvents[index - 1][0] === "enter" && childEvents[index][1].type === childEvents[index - 1][1].type && childEvents[index][1].start.line !== childEvents[index][1].end.line) {
		start = index + 1;
		breaks.push(start);
		current._tokenizer = void 0;
		current.previous = void 0;
		current = current.next;
	}
	tokenizer.events = [];
	if (current) {
		current._tokenizer = void 0;
		current.previous = void 0;
	} else breaks.pop();
	index = breaks.length;
	while (index--) {
		const slice = childEvents.slice(breaks[index], breaks[index + 1]);
		const start = startPositions.pop();
		jumps.push([start, start + slice.length - 1]);
		events.splice(start, 2, slice);
	}
	jumps.reverse();
	index = -1;
	while (++index < jumps.length) {
		gaps[adjust + jumps[index][0]] = adjust + jumps[index][1];
		adjust += jumps[index][1] - jumps[index][0] - 1;
	}
	return gaps;
}
/**
* @import {
*   Construct,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/**
* No name because it must not be turned off.
* @type {Construct}
*/
const content = {
	resolve: resolveContent,
	tokenize: tokenizeContent
};
/** @type {Construct} */
const continuationConstruct = {
	partial: true,
	tokenize: tokenizeContinuation
};
/**
* Content is transparent: it’s parsed right now. That way, definitions are also
* parsed right now: before text in paragraphs (specifically, media) are parsed.
*
* @type {Resolver}
*/
function resolveContent(events) {
	subtokenize(events);
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeContent(effects, ok) {
	/** @type {Token | undefined} */
	let previous;
	return chunkStart;
	/**
	* Before a content chunk.
	*
	* ```markdown
	* > | abc
	*     ^
	* ```
	*
	* @type {State}
	*/
	function chunkStart(code) {
		effects.enter("content");
		previous = effects.enter("chunkContent", { contentType: "content" });
		return chunkInside(code);
	}
	/**
	* In a content chunk.
	*
	* ```markdown
	* > | abc
	*     ^^^
	* ```
	*
	* @type {State}
	*/
	function chunkInside(code) {
		if (code === null) return contentEnd(code);
		if (markdownLineEnding(code)) return effects.check(continuationConstruct, contentContinue, contentEnd)(code);
		effects.consume(code);
		return chunkInside;
	}
	/**
	*
	*
	* @type {State}
	*/
	function contentEnd(code) {
		effects.exit("chunkContent");
		effects.exit("content");
		return ok(code);
	}
	/**
	*
	*
	* @type {State}
	*/
	function contentContinue(code) {
		effects.consume(code);
		effects.exit("chunkContent");
		previous.next = effects.enter("chunkContent", {
			contentType: "content",
			previous
		});
		previous = previous.next;
		return chunkInside;
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeContinuation(effects, ok, nok) {
	const self = this;
	return startLookahead;
	/**
	*
	*
	* @type {State}
	*/
	function startLookahead(code) {
		effects.exit("chunkContent");
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return factorySpace(effects, prefixed, "linePrefix");
	}
	/**
	*
	*
	* @type {State}
	*/
	function prefixed(code) {
		if (code === null || markdownLineEnding(code)) return nok(code);
		const tail = self.events[self.events.length - 1];
		if (!self.parser.constructs.disable.null.includes("codeIndented") && tail && tail[1].type === "linePrefix" && tail[2].sliceSerialize(tail[1], true).length >= 4) return ok(code);
		return effects.interrupt(self.parser.constructs.flow, nok, ok)(code);
	}
}
/**
* @import {Effects, State, TokenType} from 'micromark-util-types'
*/
/**
* Parse destinations.
*
* ###### Examples
*
* ```markdown
* <a>
* <a\>b>
* <a b>
* <a)>
* a
* a\)b
* a(b)c
* a(b)
* ```
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {State} nok
*   State switched to when unsuccessful.
* @param {TokenType} type
*   Type for whole (`<a>` or `b`).
* @param {TokenType} literalType
*   Type when enclosed (`<a>`).
* @param {TokenType} literalMarkerType
*   Type for enclosing (`<` and `>`).
* @param {TokenType} rawType
*   Type when not enclosed (`b`).
* @param {TokenType} stringType
*   Type for the value (`a` or `b`).
* @param {number | undefined} [max=Infinity]
*   Depth of nested parens (inclusive).
* @returns {State}
*   Start state.
*/
function factoryDestination(effects, ok, nok, type, literalType, literalMarkerType, rawType, stringType, max) {
	const limit = max || Number.POSITIVE_INFINITY;
	let balance = 0;
	return start;
	/**
	* Start of destination.
	*
	* ```markdown
	* > | <aa>
	*     ^
	* > | aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (code === 60) {
			effects.enter(type);
			effects.enter(literalType);
			effects.enter(literalMarkerType);
			effects.consume(code);
			effects.exit(literalMarkerType);
			return enclosedBefore;
		}
		if (code === null || code === 32 || code === 41 || asciiControl(code)) return nok(code);
		effects.enter(type);
		effects.enter(rawType);
		effects.enter(stringType);
		effects.enter("chunkString", { contentType: "string" });
		return raw(code);
	}
	/**
	* After `<`, at an enclosed destination.
	*
	* ```markdown
	* > | <aa>
	*      ^
	* ```
	*
	* @type {State}
	*/
	function enclosedBefore(code) {
		if (code === 62) {
			effects.enter(literalMarkerType);
			effects.consume(code);
			effects.exit(literalMarkerType);
			effects.exit(literalType);
			effects.exit(type);
			return ok;
		}
		effects.enter(stringType);
		effects.enter("chunkString", { contentType: "string" });
		return enclosed(code);
	}
	/**
	* In enclosed destination.
	*
	* ```markdown
	* > | <aa>
	*      ^
	* ```
	*
	* @type {State}
	*/
	function enclosed(code) {
		if (code === 62) {
			effects.exit("chunkString");
			effects.exit(stringType);
			return enclosedBefore(code);
		}
		if (code === null || code === 60 || markdownLineEnding(code)) return nok(code);
		effects.consume(code);
		return code === 92 ? enclosedEscape : enclosed;
	}
	/**
	* After `\`, at a special character.
	*
	* ```markdown
	* > | <a\*a>
	*        ^
	* ```
	*
	* @type {State}
	*/
	function enclosedEscape(code) {
		if (code === 60 || code === 62 || code === 92) {
			effects.consume(code);
			return enclosed;
		}
		return enclosed(code);
	}
	/**
	* In raw destination.
	*
	* ```markdown
	* > | aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function raw(code) {
		if (!balance && (code === null || code === 41 || markdownLineEndingOrSpace(code))) {
			effects.exit("chunkString");
			effects.exit(stringType);
			effects.exit(rawType);
			effects.exit(type);
			return ok(code);
		}
		if (balance < limit && code === 40) {
			effects.consume(code);
			balance++;
			return raw;
		}
		if (code === 41) {
			effects.consume(code);
			balance--;
			return raw;
		}
		if (code === null || code === 32 || code === 40 || asciiControl(code)) return nok(code);
		effects.consume(code);
		return code === 92 ? rawEscape : raw;
	}
	/**
	* After `\`, at special character.
	*
	* ```markdown
	* > | a\*a
	*       ^
	* ```
	*
	* @type {State}
	*/
	function rawEscape(code) {
		if (code === 40 || code === 41 || code === 92) {
			effects.consume(code);
			return raw;
		}
		return raw(code);
	}
}
/**
* @import {
*   Effects,
*   State,
*   TokenizeContext,
*   TokenType
* } from 'micromark-util-types'
*/
/**
* Parse labels.
*
* > 👉 **Note**: labels in markdown are capped at 999 characters in the string.
*
* ###### Examples
*
* ```markdown
* [a]
* [a
* b]
* [a\]b]
* ```
*
* @this {TokenizeContext}
*   Tokenize context.
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {State} nok
*   State switched to when unsuccessful.
* @param {TokenType} type
*   Type of the whole label (`[a]`).
* @param {TokenType} markerType
*   Type for the markers (`[` and `]`).
* @param {TokenType} stringType
*   Type for the identifier (`a`).
* @returns {State}
*   Start state.
*/
function factoryLabel(effects, ok, nok, type, markerType, stringType) {
	const self = this;
	let size = 0;
	/** @type {boolean} */
	let seen;
	return start;
	/**
	* Start of label.
	*
	* ```markdown
	* > | [a]
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter(type);
		effects.enter(markerType);
		effects.consume(code);
		effects.exit(markerType);
		effects.enter(stringType);
		return atBreak;
	}
	/**
	* In label, at something, before something else.
	*
	* ```markdown
	* > | [a]
	*      ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (size > 999 || code === null || code === 91 || code === 93 && !seen || 
		/* c8 ignore next 3 */
		code === 94 && !size && "_hiddenFootnoteSupport" in self.parser.constructs) return nok(code);
		if (code === 93) {
			effects.exit(stringType);
			effects.enter(markerType);
			effects.consume(code);
			effects.exit(markerType);
			effects.exit(type);
			return ok;
		}
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return atBreak;
		}
		effects.enter("chunkString", { contentType: "string" });
		return labelInside(code);
	}
	/**
	* In label, in text.
	*
	* ```markdown
	* > | [a]
	*      ^
	* ```
	*
	* @type {State}
	*/
	function labelInside(code) {
		if (code === null || code === 91 || code === 93 || markdownLineEnding(code) || size++ > 999) {
			effects.exit("chunkString");
			return atBreak(code);
		}
		effects.consume(code);
		if (!seen) seen = !markdownSpace(code);
		return code === 92 ? labelEscape : labelInside;
	}
	/**
	* After `\`, at a special character.
	*
	* ```markdown
	* > | [a\*a]
	*        ^
	* ```
	*
	* @type {State}
	*/
	function labelEscape(code) {
		if (code === 91 || code === 92 || code === 93) {
			effects.consume(code);
			size++;
			return labelInside;
		}
		return labelInside(code);
	}
}
/**
* @import {
*   Code,
*   Effects,
*   State,
*   TokenType
* } from 'micromark-util-types'
*/
/**
* Parse titles.
*
* ###### Examples
*
* ```markdown
* "a"
* 'b'
* (c)
* "a
* b"
* 'a
*     b'
* (a\)b)
* ```
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @param {State} nok
*   State switched to when unsuccessful.
* @param {TokenType} type
*   Type of the whole title (`"a"`, `'b'`, `(c)`).
* @param {TokenType} markerType
*   Type for the markers (`"`, `'`, `(`, and `)`).
* @param {TokenType} stringType
*   Type for the value (`a`).
* @returns {State}
*   Start state.
*/
function factoryTitle(effects, ok, nok, type, markerType, stringType) {
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Start of title.
	*
	* ```markdown
	* > | "a"
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (code === 34 || code === 39 || code === 40) {
			effects.enter(type);
			effects.enter(markerType);
			effects.consume(code);
			effects.exit(markerType);
			marker = code === 40 ? 41 : code;
			return begin;
		}
		return nok(code);
	}
	/**
	* After opening marker.
	*
	* This is also used at the closing marker.
	*
	* ```markdown
	* > | "a"
	*      ^
	* ```
	*
	* @type {State}
	*/
	function begin(code) {
		if (code === marker) {
			effects.enter(markerType);
			effects.consume(code);
			effects.exit(markerType);
			effects.exit(type);
			return ok;
		}
		effects.enter(stringType);
		return atBreak(code);
	}
	/**
	* At something, before something else.
	*
	* ```markdown
	* > | "a"
	*      ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (code === marker) {
			effects.exit(stringType);
			return begin(marker);
		}
		if (code === null) return nok(code);
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			return factorySpace(effects, atBreak, "linePrefix");
		}
		effects.enter("chunkString", { contentType: "string" });
		return inside(code);
	}
	/**
	*
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === marker || code === null || markdownLineEnding(code)) {
			effects.exit("chunkString");
			return atBreak(code);
		}
		effects.consume(code);
		return code === 92 ? escape : inside;
	}
	/**
	* After `\`, at a special character.
	*
	* ```markdown
	* > | "a\*b"
	*      ^
	* ```
	*
	* @type {State}
	*/
	function escape(code) {
		if (code === marker || code === 92) {
			effects.consume(code);
			return inside;
		}
		return inside(code);
	}
}
/**
* @import {Effects, State} from 'micromark-util-types'
*/
/**
* Parse spaces and tabs.
*
* There is no `nok` parameter:
*
* *   line endings or spaces in markdown are often optional, in which case this
*     factory can be used and `ok` will be switched to whether spaces were found
*     or not
* *   one line ending or space can be detected with
*     `markdownLineEndingOrSpace(code)` right before using `factoryWhitespace`
*
* @param {Effects} effects
*   Context.
* @param {State} ok
*   State switched to when successful.
* @returns {State}
*   Start state.
*/
function factoryWhitespace(effects, ok) {
	/** @type {boolean} */
	let seen;
	return start;
	/** @type {State} */
	function start(code) {
		if (markdownLineEnding(code)) {
			effects.enter("lineEnding");
			effects.consume(code);
			effects.exit("lineEnding");
			seen = true;
			return start;
		}
		if (markdownSpace(code)) return factorySpace(effects, start, seen ? "linePrefix" : "lineSuffix")(code);
		return ok(code);
	}
}
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const definition = {
	name: "definition",
	tokenize: tokenizeDefinition
};
/** @type {Construct} */
const titleBefore = {
	partial: true,
	tokenize: tokenizeTitleBefore
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeDefinition(effects, ok, nok) {
	const self = this;
	/** @type {string} */
	let identifier;
	return start;
	/**
	* At start of a definition.
	*
	* ```markdown
	* > | [a]: b "c"
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("definition");
		return before(code);
	}
	/**
	* After optional whitespace, at `[`.
	*
	* ```markdown
	* > | [a]: b "c"
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		return factoryLabel.call(self, effects, labelAfter, nok, "definitionLabel", "definitionLabelMarker", "definitionLabelString")(code);
	}
	/**
	* After label.
	*
	* ```markdown
	* > | [a]: b "c"
	*        ^
	* ```
	*
	* @type {State}
	*/
	function labelAfter(code) {
		identifier = normalizeIdentifier(self.sliceSerialize(self.events[self.events.length - 1][1]).slice(1, -1));
		if (code === 58) {
			effects.enter("definitionMarker");
			effects.consume(code);
			effects.exit("definitionMarker");
			return markerAfter;
		}
		return nok(code);
	}
	/**
	* After marker.
	*
	* ```markdown
	* > | [a]: b "c"
	*         ^
	* ```
	*
	* @type {State}
	*/
	function markerAfter(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, destinationBefore)(code) : destinationBefore(code);
	}
	/**
	* Before destination.
	*
	* ```markdown
	* > | [a]: b "c"
	*          ^
	* ```
	*
	* @type {State}
	*/
	function destinationBefore(code) {
		return factoryDestination(effects, destinationAfter, nok, "definitionDestination", "definitionDestinationLiteral", "definitionDestinationLiteralMarker", "definitionDestinationRaw", "definitionDestinationString")(code);
	}
	/**
	* After destination.
	*
	* ```markdown
	* > | [a]: b "c"
	*           ^
	* ```
	*
	* @type {State}
	*/
	function destinationAfter(code) {
		return effects.attempt(titleBefore, after, after)(code);
	}
	/**
	* After definition.
	*
	* ```markdown
	* > | [a]: b
	*           ^
	* > | [a]: b "c"
	*               ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return markdownSpace(code) ? factorySpace(effects, afterWhitespace, "whitespace")(code) : afterWhitespace(code);
	}
	/**
	* After definition, after optional whitespace.
	*
	* ```markdown
	* > | [a]: b
	*           ^
	* > | [a]: b "c"
	*               ^
	* ```
	*
	* @type {State}
	*/
	function afterWhitespace(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("definition");
			self.parser.defined.push(identifier);
			return ok(code);
		}
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeTitleBefore(effects, ok, nok) {
	return titleBefore;
	/**
	* After destination, at whitespace.
	*
	* ```markdown
	* > | [a]: b
	*           ^
	* > | [a]: b "c"
	*           ^
	* ```
	*
	* @type {State}
	*/
	function titleBefore(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, beforeMarker)(code) : nok(code);
	}
	/**
	* At title.
	*
	* ```markdown
	*   | [a]: b
	* > | "c"
	*     ^
	* ```
	*
	* @type {State}
	*/
	function beforeMarker(code) {
		return factoryTitle(effects, titleAfter, nok, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(code);
	}
	/**
	* After title.
	*
	* ```markdown
	* > | [a]: b "c"
	*               ^
	* ```
	*
	* @type {State}
	*/
	function titleAfter(code) {
		return markdownSpace(code) ? factorySpace(effects, titleAfterOptionalWhitespace, "whitespace")(code) : titleAfterOptionalWhitespace(code);
	}
	/**
	* After title, after optional whitespace.
	*
	* ```markdown
	* > | [a]: b "c"
	*               ^
	* ```
	*
	* @type {State}
	*/
	function titleAfterOptionalWhitespace(code) {
		return code === null || markdownLineEnding(code) ? ok(code) : nok(code);
	}
}
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const hardBreakEscape = {
	name: "hardBreakEscape",
	tokenize: tokenizeHardBreakEscape
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeHardBreakEscape(effects, ok, nok) {
	return start;
	/**
	* Start of a hard break (escape).
	*
	* ```markdown
	* > | a\
	*      ^
	*   | b
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("hardBreakEscape");
		effects.consume(code);
		return after;
	}
	/**
	* After `\`, at eol.
	*
	* ```markdown
	* > | a\
	*       ^
	*   | b
	* ```
	*
	*  @type {State}
	*/
	function after(code) {
		if (markdownLineEnding(code)) {
			effects.exit("hardBreakEscape");
			return ok(code);
		}
		return nok(code);
	}
}
/**
* @import {
*   Construct,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const headingAtx = {
	name: "headingAtx",
	resolve: resolveHeadingAtx,
	tokenize: tokenizeHeadingAtx
};
/** @type {Resolver} */
function resolveHeadingAtx(events, context) {
	let contentEnd = events.length - 2;
	let contentStart = 3;
	if (events[contentStart][1].type === "whitespace") contentStart += 2;
	if (contentEnd - 2 > contentStart && events[contentEnd][1].type === "whitespace") contentEnd -= 2;
	if (events[contentEnd][1].type === "atxHeadingSequence" && (contentStart === contentEnd - 1 || contentEnd - 4 > contentStart && events[contentEnd - 2][1].type === "whitespace")) contentEnd -= contentStart + 1 === contentEnd ? 2 : 4;
	if (contentEnd > contentStart) {
		const content = {
			type: "atxHeadingText",
			start: events[contentStart][1].start,
			end: events[contentEnd][1].end
		};
		const text = {
			type: "chunkText",
			start: events[contentStart][1].start,
			end: events[contentEnd][1].end,
			contentType: "text"
		};
		splice(events, contentStart, contentEnd - contentStart + 1, [
			[
				"enter",
				content,
				context
			],
			[
				"enter",
				text,
				context
			],
			[
				"exit",
				text,
				context
			],
			[
				"exit",
				content,
				context
			]
		]);
	}
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeHeadingAtx(effects, ok, nok) {
	let size = 0;
	return start;
	/**
	* Start of a heading (atx).
	*
	* ```markdown
	* > | ## aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("atxHeading");
		return before(code);
	}
	/**
	* After optional whitespace, at `#`.
	*
	* ```markdown
	* > | ## aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		effects.enter("atxHeadingSequence");
		return sequenceOpen(code);
	}
	/**
	* In opening sequence.
	*
	* ```markdown
	* > | ## aa
	*     ^
	* ```
	*
	* @type {State}
	*/
	function sequenceOpen(code) {
		if (code === 35 && size++ < 6) {
			effects.consume(code);
			return sequenceOpen;
		}
		if (code === null || markdownLineEndingOrSpace(code)) {
			effects.exit("atxHeadingSequence");
			return atBreak(code);
		}
		return nok(code);
	}
	/**
	* After something, before something else.
	*
	* ```markdown
	* > | ## aa
	*       ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (code === 35) {
			effects.enter("atxHeadingSequence");
			return sequenceFurther(code);
		}
		if (code === null || markdownLineEnding(code)) {
			effects.exit("atxHeading");
			return ok(code);
		}
		if (markdownSpace(code)) return factorySpace(effects, atBreak, "whitespace")(code);
		effects.enter("atxHeadingText");
		return data(code);
	}
	/**
	* In further sequence (after whitespace).
	*
	* Could be normal “visible” hashes in the heading or a final sequence.
	*
	* ```markdown
	* > | ## aa ##
	*           ^
	* ```
	*
	* @type {State}
	*/
	function sequenceFurther(code) {
		if (code === 35) {
			effects.consume(code);
			return sequenceFurther;
		}
		effects.exit("atxHeadingSequence");
		return atBreak(code);
	}
	/**
	* In text.
	*
	* ```markdown
	* > | ## aa
	*        ^
	* ```
	*
	* @type {State}
	*/
	function data(code) {
		if (code === null || code === 35 || markdownLineEndingOrSpace(code)) {
			effects.exit("atxHeadingText");
			return atBreak(code);
		}
		effects.consume(code);
		return data;
	}
}
/**
* List of lowercase HTML “block” tag names.
*
* The list, when parsing HTML (flow), results in more relaxed rules (condition
* 6).
* Because they are known blocks, the HTML-like syntax doesn’t have to be
* strictly parsed.
* For tag names not in this list, a more strict algorithm (condition 7) is used
* to detect whether the HTML-like syntax is seen as HTML (flow) or not.
*
* This is copied from:
* <https://spec.commonmark.org/0.30/#html-blocks>.
*
* > 👉 **Note**: `search` was added in `CommonMark@0.31`.
*/
const htmlBlockNames = [
	"address",
	"article",
	"aside",
	"base",
	"basefont",
	"blockquote",
	"body",
	"caption",
	"center",
	"col",
	"colgroup",
	"dd",
	"details",
	"dialog",
	"dir",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"frame",
	"frameset",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"head",
	"header",
	"hr",
	"html",
	"iframe",
	"legend",
	"li",
	"link",
	"main",
	"menu",
	"menuitem",
	"nav",
	"noframes",
	"ol",
	"optgroup",
	"option",
	"p",
	"param",
	"search",
	"section",
	"summary",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"title",
	"tr",
	"track",
	"ul"
];
/**
* List of lowercase HTML “raw” tag names.
*
* The list, when parsing HTML (flow), results in HTML that can include lines
* without exiting, until a closing tag also in this list is found (condition
* 1).
*
* This module is copied from:
* <https://spec.commonmark.org/0.30/#html-blocks>.
*
* > 👉 **Note**: `textarea` was added in `CommonMark@0.30`.
*/
const htmlRawNames = [
	"pre",
	"script",
	"style",
	"textarea"
];
/**
* @import {
*   Code,
*   Construct,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const htmlFlow = {
	concrete: true,
	name: "htmlFlow",
	resolveTo: resolveToHtmlFlow,
	tokenize: tokenizeHtmlFlow
};
/** @type {Construct} */
const blankLineBefore = {
	partial: true,
	tokenize: tokenizeBlankLineBefore
};
/** @type {Resolver} */
function resolveToHtmlFlow(events) {
	let index = events.length;
	while (index--) if (events[index][0] === "enter" && events[index][1].type === "htmlFlow") break;
	if (index > 1 && events[index - 2][1].type === "linePrefix") {
		events[index][1].start = events[index - 2][1].start;
		events[index + 1][1].start = events[index - 2][1].start;
		events.splice(index - 2, 2);
	}
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeHtmlFlow(effects, ok, nok) {
	const self = this;
	/** @type {number} */
	let marker;
	/** @type {boolean} */
	let closingTag;
	/** @type {string} */
	let buffer;
	/** @type {number} */
	let index;
	/** @type {Code} */
	let markerB;
	return start;
	/**
	* Start of HTML (flow).
	*
	* ```markdown
	* > | <x />
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		return before(code);
	}
	/**
	* At `<`, after optional whitespace.
	*
	* ```markdown
	* > | <x />
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		effects.enter("htmlFlow");
		effects.enter("htmlFlowData");
		effects.consume(code);
		return open;
	}
	/**
	* After `<`, at tag name or other stuff.
	*
	* ```markdown
	* > | <x />
	*      ^
	* > | <!doctype>
	*      ^
	* > | <!--xxx-->
	*      ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (code === 33) {
			effects.consume(code);
			return declarationOpen;
		}
		if (code === 47) {
			effects.consume(code);
			closingTag = true;
			return tagCloseStart;
		}
		if (code === 63) {
			effects.consume(code);
			marker = 3;
			return self.interrupt ? ok : continuationDeclarationInside;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			buffer = String.fromCharCode(code);
			return tagName;
		}
		return nok(code);
	}
	/**
	* After `<!`, at declaration, comment, or CDATA.
	*
	* ```markdown
	* > | <!doctype>
	*       ^
	* > | <!--xxx-->
	*       ^
	* > | <![CDATA[>&<]]>
	*       ^
	* ```
	*
	* @type {State}
	*/
	function declarationOpen(code) {
		if (code === 45) {
			effects.consume(code);
			marker = 2;
			return commentOpenInside;
		}
		if (code === 91) {
			effects.consume(code);
			marker = 5;
			index = 0;
			return cdataOpenInside;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			marker = 4;
			return self.interrupt ? ok : continuationDeclarationInside;
		}
		return nok(code);
	}
	/**
	* After `<!-`, inside a comment, at another `-`.
	*
	* ```markdown
	* > | <!--xxx-->
	*        ^
	* ```
	*
	* @type {State}
	*/
	function commentOpenInside(code) {
		if (code === 45) {
			effects.consume(code);
			return self.interrupt ? ok : continuationDeclarationInside;
		}
		return nok(code);
	}
	/**
	* After `<![`, inside CDATA, expecting `CDATA[`.
	*
	* ```markdown
	* > | <![CDATA[>&<]]>
	*        ^^^^^^
	* ```
	*
	* @type {State}
	*/
	function cdataOpenInside(code) {
		if (code === "CDATA[".charCodeAt(index++)) {
			effects.consume(code);
			if (index === 6) return self.interrupt ? ok : continuation;
			return cdataOpenInside;
		}
		return nok(code);
	}
	/**
	* After `</`, in closing tag, at tag name.
	*
	* ```markdown
	* > | </x>
	*       ^
	* ```
	*
	* @type {State}
	*/
	function tagCloseStart(code) {
		if (asciiAlpha(code)) {
			effects.consume(code);
			buffer = String.fromCharCode(code);
			return tagName;
		}
		return nok(code);
	}
	/**
	* In tag name.
	*
	* ```markdown
	* > | <ab>
	*      ^^
	* > | </ab>
	*       ^^
	* ```
	*
	* @type {State}
	*/
	function tagName(code) {
		if (code === null || code === 47 || code === 62 || markdownLineEndingOrSpace(code)) {
			const slash = code === 47;
			const name = buffer.toLowerCase();
			if (!slash && !closingTag && htmlRawNames.includes(name)) {
				marker = 1;
				return self.interrupt ? ok(code) : continuation(code);
			}
			if (htmlBlockNames.includes(buffer.toLowerCase())) {
				marker = 6;
				if (slash) {
					effects.consume(code);
					return basicSelfClosing;
				}
				return self.interrupt ? ok(code) : continuation(code);
			}
			marker = 7;
			return self.interrupt && !self.parser.lazy[self.now().line] ? nok(code) : closingTag ? completeClosingTagAfter(code) : completeAttributeNameBefore(code);
		}
		if (code === 45 || asciiAlphanumeric(code)) {
			effects.consume(code);
			buffer += String.fromCharCode(code);
			return tagName;
		}
		return nok(code);
	}
	/**
	* After closing slash of a basic tag name.
	*
	* ```markdown
	* > | <div/>
	*          ^
	* ```
	*
	* @type {State}
	*/
	function basicSelfClosing(code) {
		if (code === 62) {
			effects.consume(code);
			return self.interrupt ? ok : continuation;
		}
		return nok(code);
	}
	/**
	* After closing slash of a complete tag name.
	*
	* ```markdown
	* > | <x/>
	*        ^
	* ```
	*
	* @type {State}
	*/
	function completeClosingTagAfter(code) {
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeClosingTagAfter;
		}
		return completeEnd(code);
	}
	/**
	* At an attribute name.
	*
	* At first, this state is used after a complete tag name, after whitespace,
	* where it expects optional attributes or the end of the tag.
	* It is also reused after attributes, when expecting more optional
	* attributes.
	*
	* ```markdown
	* > | <a />
	*        ^
	* > | <a :b>
	*        ^
	* > | <a _b>
	*        ^
	* > | <a b>
	*        ^
	* > | <a >
	*        ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeNameBefore(code) {
		if (code === 47) {
			effects.consume(code);
			return completeEnd;
		}
		if (code === 58 || code === 95 || asciiAlpha(code)) {
			effects.consume(code);
			return completeAttributeName;
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeAttributeNameBefore;
		}
		return completeEnd(code);
	}
	/**
	* In attribute name.
	*
	* ```markdown
	* > | <a :b>
	*         ^
	* > | <a _b>
	*         ^
	* > | <a b>
	*         ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeName(code) {
		if (code === 45 || code === 46 || code === 58 || code === 95 || asciiAlphanumeric(code)) {
			effects.consume(code);
			return completeAttributeName;
		}
		return completeAttributeNameAfter(code);
	}
	/**
	* After attribute name, at an optional initializer, the end of the tag, or
	* whitespace.
	*
	* ```markdown
	* > | <a b>
	*         ^
	* > | <a b=c>
	*         ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeNameAfter(code) {
		if (code === 61) {
			effects.consume(code);
			return completeAttributeValueBefore;
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeAttributeNameAfter;
		}
		return completeAttributeNameBefore(code);
	}
	/**
	* Before unquoted, double quoted, or single quoted attribute value, allowing
	* whitespace.
	*
	* ```markdown
	* > | <a b=c>
	*          ^
	* > | <a b="c">
	*          ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeValueBefore(code) {
		if (code === null || code === 60 || code === 61 || code === 62 || code === 96) return nok(code);
		if (code === 34 || code === 39) {
			effects.consume(code);
			markerB = code;
			return completeAttributeValueQuoted;
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeAttributeValueBefore;
		}
		return completeAttributeValueUnquoted(code);
	}
	/**
	* In double or single quoted attribute value.
	*
	* ```markdown
	* > | <a b="c">
	*           ^
	* > | <a b='c'>
	*           ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeValueQuoted(code) {
		if (code === markerB) {
			effects.consume(code);
			markerB = null;
			return completeAttributeValueQuotedAfter;
		}
		if (code === null || markdownLineEnding(code)) return nok(code);
		effects.consume(code);
		return completeAttributeValueQuoted;
	}
	/**
	* In unquoted attribute value.
	*
	* ```markdown
	* > | <a b=c>
	*          ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeValueUnquoted(code) {
		if (code === null || code === 34 || code === 39 || code === 47 || code === 60 || code === 61 || code === 62 || code === 96 || markdownLineEndingOrSpace(code)) return completeAttributeNameAfter(code);
		effects.consume(code);
		return completeAttributeValueUnquoted;
	}
	/**
	* After double or single quoted attribute value, before whitespace or the
	* end of the tag.
	*
	* ```markdown
	* > | <a b="c">
	*            ^
	* ```
	*
	* @type {State}
	*/
	function completeAttributeValueQuotedAfter(code) {
		if (code === 47 || code === 62 || markdownSpace(code)) return completeAttributeNameBefore(code);
		return nok(code);
	}
	/**
	* In certain circumstances of a complete tag where only an `>` is allowed.
	*
	* ```markdown
	* > | <a b="c">
	*             ^
	* ```
	*
	* @type {State}
	*/
	function completeEnd(code) {
		if (code === 62) {
			effects.consume(code);
			return completeAfter;
		}
		return nok(code);
	}
	/**
	* After `>` in a complete tag.
	*
	* ```markdown
	* > | <x>
	*        ^
	* ```
	*
	* @type {State}
	*/
	function completeAfter(code) {
		if (code === null || markdownLineEnding(code)) return continuation(code);
		if (markdownSpace(code)) {
			effects.consume(code);
			return completeAfter;
		}
		return nok(code);
	}
	/**
	* In continuation of any HTML kind.
	*
	* ```markdown
	* > | <!--xxx-->
	*          ^
	* ```
	*
	* @type {State}
	*/
	function continuation(code) {
		if (code === 45 && marker === 2) {
			effects.consume(code);
			return continuationCommentInside;
		}
		if (code === 60 && marker === 1) {
			effects.consume(code);
			return continuationRawTagOpen;
		}
		if (code === 62 && marker === 4) {
			effects.consume(code);
			return continuationClose;
		}
		if (code === 63 && marker === 3) {
			effects.consume(code);
			return continuationDeclarationInside;
		}
		if (code === 93 && marker === 5) {
			effects.consume(code);
			return continuationCdataInside;
		}
		if (markdownLineEnding(code) && (marker === 6 || marker === 7)) {
			effects.exit("htmlFlowData");
			return effects.check(blankLineBefore, continuationAfter, continuationStart)(code);
		}
		if (code === null || markdownLineEnding(code)) {
			effects.exit("htmlFlowData");
			return continuationStart(code);
		}
		effects.consume(code);
		return continuation;
	}
	/**
	* In continuation, at eol.
	*
	* ```markdown
	* > | <x>
	*        ^
	*   | asd
	* ```
	*
	* @type {State}
	*/
	function continuationStart(code) {
		return effects.check(nonLazyContinuation$2, continuationStartNonLazy, continuationAfter)(code);
	}
	/**
	* In continuation, at eol, before non-lazy content.
	*
	* ```markdown
	* > | <x>
	*        ^
	*   | asd
	* ```
	*
	* @type {State}
	*/
	function continuationStartNonLazy(code) {
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return continuationBefore;
	}
	/**
	* In continuation, before non-lazy content.
	*
	* ```markdown
	*   | <x>
	* > | asd
	*     ^
	* ```
	*
	* @type {State}
	*/
	function continuationBefore(code) {
		if (code === null || markdownLineEnding(code)) return continuationStart(code);
		effects.enter("htmlFlowData");
		return continuation(code);
	}
	/**
	* In comment continuation, after one `-`, expecting another.
	*
	* ```markdown
	* > | <!--xxx-->
	*             ^
	* ```
	*
	* @type {State}
	*/
	function continuationCommentInside(code) {
		if (code === 45) {
			effects.consume(code);
			return continuationDeclarationInside;
		}
		return continuation(code);
	}
	/**
	* In raw continuation, after `<`, at `/`.
	*
	* ```markdown
	* > | <script>console.log(1)<\/script>
	*                            ^
	* ```
	*
	* @type {State}
	*/
	function continuationRawTagOpen(code) {
		if (code === 47) {
			effects.consume(code);
			buffer = "";
			return continuationRawEndTag;
		}
		return continuation(code);
	}
	/**
	* In raw continuation, after `</`, in a raw tag name.
	*
	* ```markdown
	* > | <script>console.log(1)<\/script>
	*                             ^^^^^^
	* ```
	*
	* @type {State}
	*/
	function continuationRawEndTag(code) {
		if (code === 62) {
			const name = buffer.toLowerCase();
			if (htmlRawNames.includes(name)) {
				effects.consume(code);
				return continuationClose;
			}
			return continuation(code);
		}
		if (asciiAlpha(code) && buffer.length < 8) {
			effects.consume(code);
			buffer += String.fromCharCode(code);
			return continuationRawEndTag;
		}
		return continuation(code);
	}
	/**
	* In cdata continuation, after `]`, expecting `]>`.
	*
	* ```markdown
	* > | <![CDATA[>&<]]>
	*                  ^
	* ```
	*
	* @type {State}
	*/
	function continuationCdataInside(code) {
		if (code === 93) {
			effects.consume(code);
			return continuationDeclarationInside;
		}
		return continuation(code);
	}
	/**
	* In declaration or instruction continuation, at `>`.
	*
	* ```markdown
	* > | <!-->
	*         ^
	* > | <?>
	*       ^
	* > | <!q>
	*        ^
	* > | <!--ab-->
	*             ^
	* > | <![CDATA[>&<]]>
	*                   ^
	* ```
	*
	* @type {State}
	*/
	function continuationDeclarationInside(code) {
		if (code === 62) {
			effects.consume(code);
			return continuationClose;
		}
		if (code === 45 && marker === 2) {
			effects.consume(code);
			return continuationDeclarationInside;
		}
		return continuation(code);
	}
	/**
	* In closed continuation: everything we get until the eol/eof is part of it.
	*
	* ```markdown
	* > | <!doctype>
	*               ^
	* ```
	*
	* @type {State}
	*/
	function continuationClose(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("htmlFlowData");
			return continuationAfter(code);
		}
		effects.consume(code);
		return continuationClose;
	}
	/**
	* Done.
	*
	* ```markdown
	* > | <!doctype>
	*               ^
	* ```
	*
	* @type {State}
	*/
	function continuationAfter(code) {
		effects.exit("htmlFlow");
		return ok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeBlankLineBefore(effects, ok, nok) {
	return start;
	/**
	* Before eol, expecting blank line.
	*
	* ```markdown
	* > | <div>
	*          ^
	*   |
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return effects.attempt(blankLine, ok, nok);
	}
}
/**
* @import {
*   Code,
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const htmlText = {
	name: "htmlText",
	tokenize: tokenizeHtmlText
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeHtmlText(effects, ok, nok) {
	const self = this;
	/** @type {NonNullable<Code> | undefined} */
	let marker;
	/** @type {number} */
	let index;
	/** @type {State} */
	let returnState;
	return start;
	/**
	* Start of HTML (text).
	*
	* ```markdown
	* > | a <b> c
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("htmlText");
		effects.enter("htmlTextData");
		effects.consume(code);
		return open;
	}
	/**
	* After `<`, at tag name or other stuff.
	*
	* ```markdown
	* > | a <b> c
	*        ^
	* > | a <!doctype> c
	*        ^
	* > | a <!--b--> c
	*        ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (code === 33) {
			effects.consume(code);
			return declarationOpen;
		}
		if (code === 47) {
			effects.consume(code);
			return tagCloseStart;
		}
		if (code === 63) {
			effects.consume(code);
			return instruction;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			return tagOpen;
		}
		return nok(code);
	}
	/**
	* After `<!`, at declaration, comment, or CDATA.
	*
	* ```markdown
	* > | a <!doctype> c
	*         ^
	* > | a <!--b--> c
	*         ^
	* > | a <![CDATA[>&<]]> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function declarationOpen(code) {
		if (code === 45) {
			effects.consume(code);
			return commentOpenInside;
		}
		if (code === 91) {
			effects.consume(code);
			index = 0;
			return cdataOpenInside;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			return declaration;
		}
		return nok(code);
	}
	/**
	* In a comment, after `<!-`, at another `-`.
	*
	* ```markdown
	* > | a <!--b--> c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function commentOpenInside(code) {
		if (code === 45) {
			effects.consume(code);
			return commentEnd;
		}
		return nok(code);
	}
	/**
	* In comment.
	*
	* ```markdown
	* > | a <!--b--> c
	*           ^
	* ```
	*
	* @type {State}
	*/
	function comment(code) {
		if (code === null) return nok(code);
		if (code === 45) {
			effects.consume(code);
			return commentClose;
		}
		if (markdownLineEnding(code)) {
			returnState = comment;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return comment;
	}
	/**
	* In comment, after `-`.
	*
	* ```markdown
	* > | a <!--b--> c
	*             ^
	* ```
	*
	* @type {State}
	*/
	function commentClose(code) {
		if (code === 45) {
			effects.consume(code);
			return commentEnd;
		}
		return comment(code);
	}
	/**
	* In comment, after `--`.
	*
	* ```markdown
	* > | a <!--b--> c
	*              ^
	* ```
	*
	* @type {State}
	*/
	function commentEnd(code) {
		return code === 62 ? end(code) : code === 45 ? commentClose(code) : comment(code);
	}
	/**
	* After `<![`, in CDATA, expecting `CDATA[`.
	*
	* ```markdown
	* > | a <![CDATA[>&<]]> b
	*          ^^^^^^
	* ```
	*
	* @type {State}
	*/
	function cdataOpenInside(code) {
		if (code === "CDATA[".charCodeAt(index++)) {
			effects.consume(code);
			return index === 6 ? cdata : cdataOpenInside;
		}
		return nok(code);
	}
	/**
	* In CDATA.
	*
	* ```markdown
	* > | a <![CDATA[>&<]]> b
	*                ^^^
	* ```
	*
	* @type {State}
	*/
	function cdata(code) {
		if (code === null) return nok(code);
		if (code === 93) {
			effects.consume(code);
			return cdataClose;
		}
		if (markdownLineEnding(code)) {
			returnState = cdata;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return cdata;
	}
	/**
	* In CDATA, after `]`, at another `]`.
	*
	* ```markdown
	* > | a <![CDATA[>&<]]> b
	*                    ^
	* ```
	*
	* @type {State}
	*/
	function cdataClose(code) {
		if (code === 93) {
			effects.consume(code);
			return cdataEnd;
		}
		return cdata(code);
	}
	/**
	* In CDATA, after `]]`, at `>`.
	*
	* ```markdown
	* > | a <![CDATA[>&<]]> b
	*                     ^
	* ```
	*
	* @type {State}
	*/
	function cdataEnd(code) {
		if (code === 62) return end(code);
		if (code === 93) {
			effects.consume(code);
			return cdataEnd;
		}
		return cdata(code);
	}
	/**
	* In declaration.
	*
	* ```markdown
	* > | a <!b> c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function declaration(code) {
		if (code === null || code === 62) return end(code);
		if (markdownLineEnding(code)) {
			returnState = declaration;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return declaration;
	}
	/**
	* In instruction.
	*
	* ```markdown
	* > | a <?b?> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function instruction(code) {
		if (code === null) return nok(code);
		if (code === 63) {
			effects.consume(code);
			return instructionClose;
		}
		if (markdownLineEnding(code)) {
			returnState = instruction;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return instruction;
	}
	/**
	* In instruction, after `?`, at `>`.
	*
	* ```markdown
	* > | a <?b?> c
	*           ^
	* ```
	*
	* @type {State}
	*/
	function instructionClose(code) {
		return code === 62 ? end(code) : instruction(code);
	}
	/**
	* After `</`, in closing tag, at tag name.
	*
	* ```markdown
	* > | a </b> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function tagCloseStart(code) {
		if (asciiAlpha(code)) {
			effects.consume(code);
			return tagClose;
		}
		return nok(code);
	}
	/**
	* After `</x`, in a tag name.
	*
	* ```markdown
	* > | a </b> c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function tagClose(code) {
		if (code === 45 || asciiAlphanumeric(code)) {
			effects.consume(code);
			return tagClose;
		}
		return tagCloseBetween(code);
	}
	/**
	* In closing tag, after tag name.
	*
	* ```markdown
	* > | a </b> c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function tagCloseBetween(code) {
		if (markdownLineEnding(code)) {
			returnState = tagCloseBetween;
			return lineEndingBefore(code);
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return tagCloseBetween;
		}
		return end(code);
	}
	/**
	* After `<x`, in opening tag name.
	*
	* ```markdown
	* > | a <b> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function tagOpen(code) {
		if (code === 45 || asciiAlphanumeric(code)) {
			effects.consume(code);
			return tagOpen;
		}
		if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
		return nok(code);
	}
	/**
	* In opening tag, after tag name.
	*
	* ```markdown
	* > | a <b> c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenBetween(code) {
		if (code === 47) {
			effects.consume(code);
			return end;
		}
		if (code === 58 || code === 95 || asciiAlpha(code)) {
			effects.consume(code);
			return tagOpenAttributeName;
		}
		if (markdownLineEnding(code)) {
			returnState = tagOpenBetween;
			return lineEndingBefore(code);
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return tagOpenBetween;
		}
		return end(code);
	}
	/**
	* In attribute name.
	*
	* ```markdown
	* > | a <b c> d
	*          ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeName(code) {
		if (code === 45 || code === 46 || code === 58 || code === 95 || asciiAlphanumeric(code)) {
			effects.consume(code);
			return tagOpenAttributeName;
		}
		return tagOpenAttributeNameAfter(code);
	}
	/**
	* After attribute name, before initializer, the end of the tag, or
	* whitespace.
	*
	* ```markdown
	* > | a <b c> d
	*           ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeNameAfter(code) {
		if (code === 61) {
			effects.consume(code);
			return tagOpenAttributeValueBefore;
		}
		if (markdownLineEnding(code)) {
			returnState = tagOpenAttributeNameAfter;
			return lineEndingBefore(code);
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return tagOpenAttributeNameAfter;
		}
		return tagOpenBetween(code);
	}
	/**
	* Before unquoted, double quoted, or single quoted attribute value, allowing
	* whitespace.
	*
	* ```markdown
	* > | a <b c=d> e
	*            ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeValueBefore(code) {
		if (code === null || code === 60 || code === 61 || code === 62 || code === 96) return nok(code);
		if (code === 34 || code === 39) {
			effects.consume(code);
			marker = code;
			return tagOpenAttributeValueQuoted;
		}
		if (markdownLineEnding(code)) {
			returnState = tagOpenAttributeValueBefore;
			return lineEndingBefore(code);
		}
		if (markdownSpace(code)) {
			effects.consume(code);
			return tagOpenAttributeValueBefore;
		}
		effects.consume(code);
		return tagOpenAttributeValueUnquoted;
	}
	/**
	* In double or single quoted attribute value.
	*
	* ```markdown
	* > | a <b c="d"> e
	*             ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeValueQuoted(code) {
		if (code === marker) {
			effects.consume(code);
			marker = void 0;
			return tagOpenAttributeValueQuotedAfter;
		}
		if (code === null) return nok(code);
		if (markdownLineEnding(code)) {
			returnState = tagOpenAttributeValueQuoted;
			return lineEndingBefore(code);
		}
		effects.consume(code);
		return tagOpenAttributeValueQuoted;
	}
	/**
	* In unquoted attribute value.
	*
	* ```markdown
	* > | a <b c=d> e
	*            ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeValueUnquoted(code) {
		if (code === null || code === 34 || code === 39 || code === 60 || code === 61 || code === 96) return nok(code);
		if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
		effects.consume(code);
		return tagOpenAttributeValueUnquoted;
	}
	/**
	* After double or single quoted attribute value, before whitespace or the end
	* of the tag.
	*
	* ```markdown
	* > | a <b c="d"> e
	*               ^
	* ```
	*
	* @type {State}
	*/
	function tagOpenAttributeValueQuotedAfter(code) {
		if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
		return nok(code);
	}
	/**
	* In certain circumstances of a tag where only an `>` is allowed.
	*
	* ```markdown
	* > | a <b c="d"> e
	*               ^
	* ```
	*
	* @type {State}
	*/
	function end(code) {
		if (code === 62) {
			effects.consume(code);
			effects.exit("htmlTextData");
			effects.exit("htmlText");
			return ok;
		}
		return nok(code);
	}
	/**
	* At eol.
	*
	* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
	* > empty tokens.
	*
	* ```markdown
	* > | a <!--a
	*            ^
	*   | b-->
	* ```
	*
	* @type {State}
	*/
	function lineEndingBefore(code) {
		effects.exit("htmlTextData");
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return lineEndingAfter;
	}
	/**
	* After eol, at optional whitespace.
	*
	* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
	* > empty tokens.
	*
	* ```markdown
	*   | a <!--a
	* > | b-->
	*     ^
	* ```
	*
	* @type {State}
	*/
	function lineEndingAfter(code) {
		return markdownSpace(code) ? factorySpace(effects, lineEndingAfterPrefix, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code) : lineEndingAfterPrefix(code);
	}
	/**
	* After eol, after optional whitespace.
	*
	* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
	* > empty tokens.
	*
	* ```markdown
	*   | a <!--a
	* > | b-->
	*     ^
	* ```
	*
	* @type {State}
	*/
	function lineEndingAfterPrefix(code) {
		effects.enter("htmlTextData");
		return returnState(code);
	}
}
/**
* @import {
*   Construct,
*   Event,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer,
*   Token
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const labelEnd = {
	name: "labelEnd",
	resolveAll: resolveAllLabelEnd,
	resolveTo: resolveToLabelEnd,
	tokenize: tokenizeLabelEnd
};
/** @type {Construct} */
const resourceConstruct = { tokenize: tokenizeResource };
/** @type {Construct} */
const referenceFullConstruct = { tokenize: tokenizeReferenceFull };
/** @type {Construct} */
const referenceCollapsedConstruct = { tokenize: tokenizeReferenceCollapsed };
/** @type {Resolver} */
function resolveAllLabelEnd(events) {
	let index = -1;
	/** @type {Array<Event>} */
	const newEvents = [];
	while (++index < events.length) {
		const token = events[index][1];
		newEvents.push(events[index]);
		if (token.type === "labelImage" || token.type === "labelLink" || token.type === "labelEnd") {
			const offset = token.type === "labelImage" ? 4 : 2;
			token.type = "data";
			index += offset;
		}
	}
	if (events.length !== newEvents.length) splice(events, 0, events.length, newEvents);
	return events;
}
/** @type {Resolver} */
function resolveToLabelEnd(events, context) {
	let index = events.length;
	let offset = 0;
	/** @type {number | undefined} */
	let open;
	/** @type {number | undefined} */
	let close;
	/** @type {Array<Event>} */
	let media;
	while (index--) {
		const token = events[index][1];
		if (open) {
			if (token.type === "link" || token.type === "labelLink" && token._inactive) break;
			if (events[index][0] === "enter" && token.type === "labelLink") token._inactive = true;
		} else if (close) {
			if (events[index][0] === "enter" && (token.type === "labelImage" || token.type === "labelLink") && !token._balanced) {
				open = index;
				if (token.type !== "labelLink") {
					offset = 2;
					break;
				}
			}
		} else if (token.type === "labelEnd") close = index;
	}
	const group = {
		type: events[open][1].type === "labelLink" ? "link" : "image",
		start: { ...events[open][1].start },
		end: { ...events[events.length - 1][1].end }
	};
	const label = {
		type: "label",
		start: { ...events[open][1].start },
		end: { ...events[close][1].end }
	};
	const text = {
		type: "labelText",
		start: { ...events[open + offset + 2][1].end },
		end: { ...events[close - 2][1].start }
	};
	media = [[
		"enter",
		group,
		context
	], [
		"enter",
		label,
		context
	]];
	media = push(media, events.slice(open + 1, open + offset + 3));
	media = push(media, [[
		"enter",
		text,
		context
	]]);
	media = push(media, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + offset + 4, close - 3), context));
	media = push(media, [
		[
			"exit",
			text,
			context
		],
		events[close - 2],
		events[close - 1],
		[
			"exit",
			label,
			context
		]
	]);
	media = push(media, events.slice(close + 1));
	media = push(media, [[
		"exit",
		group,
		context
	]]);
	splice(events, open, events.length, media);
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeLabelEnd(effects, ok, nok) {
	const self = this;
	const labelStarts = self._labelStarts;
	/** @type {Token} */
	let labelStart;
	/** @type {boolean} */
	let defined;
	if (labelStarts) {
		while (labelStarts.length > 0 && labelStarts[labelStarts.length - 1]._balanced) labelStarts.pop();
		labelStart = labelStarts[labelStarts.length - 1];
	}
	return start;
	/**
	* Start of label end.
	*
	* ```markdown
	* > | [a](b) c
	*       ^
	* > | [a][b] c
	*       ^
	* > | [a][] b
	*       ^
	* > | [a] b
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (!labelStart) return nok(code);
		if (labelStart._inactive) return labelEndNok(code);
		defined = self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize({
			start: labelStart.end,
			end: self.now()
		})));
		effects.enter("labelEnd");
		effects.enter("labelMarker");
		effects.consume(code);
		effects.exit("labelMarker");
		effects.exit("labelEnd");
		return after;
	}
	/**
	* After `]`.
	*
	* ```markdown
	* > | [a](b) c
	*       ^
	* > | [a][b] c
	*       ^
	* > | [a][] b
	*       ^
	* > | [a] b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		if (code === 40) return effects.attempt(resourceConstruct, labelEndOk, defined ? labelEndOk : labelEndNok)(code);
		if (code === 91) return effects.attempt(referenceFullConstruct, labelEndOk, defined ? referenceNotFull : labelEndNok)(code);
		return defined ? labelEndOk(code) : labelEndNok(code);
	}
	/**
	* After `]`, at `[`, but not at a full reference.
	*
	* > 👉 **Note**: we only get here if the label is defined.
	*
	* ```markdown
	* > | [a][] b
	*        ^
	* > | [a] b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function referenceNotFull(code) {
		return effects.attempt(referenceCollapsedConstruct, labelEndOk, labelEndNok)(code);
	}
	/**
	* Done, we found something.
	*
	* ```markdown
	* > | [a](b) c
	*           ^
	* > | [a][b] c
	*           ^
	* > | [a][] b
	*          ^
	* > | [a] b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function labelEndOk(code) {
		labelStarts.pop();
		return ok(code);
	}
	/**
	* Done, it’s nothing.
	*
	* There was an okay opening, but we didn’t match anything.
	*
	* ```markdown
	* > | [a](b c
	*        ^
	* > | [a][b c
	*        ^
	* > | [a] b
	*        ^
	* ```
	*
	* @type {State}
	*/
	function labelEndNok(code) {
		labelStart._balanced = true;
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeResource(effects, ok, nok) {
	return resourceStart;
	/**
	* At a resource.
	*
	* ```markdown
	* > | [a](b) c
	*        ^
	* ```
	*
	* @type {State}
	*/
	function resourceStart(code) {
		effects.enter("resource");
		effects.enter("resourceMarker");
		effects.consume(code);
		effects.exit("resourceMarker");
		return resourceBefore;
	}
	/**
	* In resource, after `(`, at optional whitespace.
	*
	* ```markdown
	* > | [a](b) c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function resourceBefore(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceOpen)(code) : resourceOpen(code);
	}
	/**
	* In resource, after optional whitespace, at `)` or a destination.
	*
	* ```markdown
	* > | [a](b) c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function resourceOpen(code) {
		if (code === 41) return resourceEnd(code);
		return factoryDestination(effects, resourceDestinationAfter, resourceDestinationMissing, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(code);
	}
	/**
	* In resource, after destination, at optional whitespace.
	*
	* ```markdown
	* > | [a](b) c
	*          ^
	* ```
	*
	* @type {State}
	*/
	function resourceDestinationAfter(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceBetween)(code) : resourceEnd(code);
	}
	/**
	* At invalid destination.
	*
	* ```markdown
	* > | [a](<<) b
	*         ^
	* ```
	*
	* @type {State}
	*/
	function resourceDestinationMissing(code) {
		return nok(code);
	}
	/**
	* In resource, after destination and whitespace, at `(` or title.
	*
	* ```markdown
	* > | [a](b ) c
	*           ^
	* ```
	*
	* @type {State}
	*/
	function resourceBetween(code) {
		if (code === 34 || code === 39 || code === 40) return factoryTitle(effects, resourceTitleAfter, nok, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(code);
		return resourceEnd(code);
	}
	/**
	* In resource, after title, at optional whitespace.
	*
	* ```markdown
	* > | [a](b "c") d
	*              ^
	* ```
	*
	* @type {State}
	*/
	function resourceTitleAfter(code) {
		return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceEnd)(code) : resourceEnd(code);
	}
	/**
	* In resource, at `)`.
	*
	* ```markdown
	* > | [a](b) d
	*          ^
	* ```
	*
	* @type {State}
	*/
	function resourceEnd(code) {
		if (code === 41) {
			effects.enter("resourceMarker");
			effects.consume(code);
			effects.exit("resourceMarker");
			effects.exit("resource");
			return ok;
		}
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeReferenceFull(effects, ok, nok) {
	const self = this;
	return referenceFull;
	/**
	* In a reference (full), at the `[`.
	*
	* ```markdown
	* > | [a][b] d
	*        ^
	* ```
	*
	* @type {State}
	*/
	function referenceFull(code) {
		return factoryLabel.call(self, effects, referenceFullAfter, referenceFullMissing, "reference", "referenceMarker", "referenceString")(code);
	}
	/**
	* In a reference (full), after `]`.
	*
	* ```markdown
	* > | [a][b] d
	*          ^
	* ```
	*
	* @type {State}
	*/
	function referenceFullAfter(code) {
		return self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize(self.events[self.events.length - 1][1]).slice(1, -1))) ? ok(code) : nok(code);
	}
	/**
	* In reference (full) that was missing.
	*
	* ```markdown
	* > | [a][b d
	*        ^
	* ```
	*
	* @type {State}
	*/
	function referenceFullMissing(code) {
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeReferenceCollapsed(effects, ok, nok) {
	return referenceCollapsedStart;
	/**
	* In reference (collapsed), at `[`.
	*
	* > 👉 **Note**: we only get here if the label is defined.
	*
	* ```markdown
	* > | [a][] d
	*        ^
	* ```
	*
	* @type {State}
	*/
	function referenceCollapsedStart(code) {
		effects.enter("reference");
		effects.enter("referenceMarker");
		effects.consume(code);
		effects.exit("referenceMarker");
		return referenceCollapsedOpen;
	}
	/**
	* In reference (collapsed), at `]`.
	*
	* > 👉 **Note**: we only get here if the label is defined.
	*
	* ```markdown
	* > | [a][] d
	*         ^
	* ```
	*
	*  @type {State}
	*/
	function referenceCollapsedOpen(code) {
		if (code === 93) {
			effects.enter("referenceMarker");
			effects.consume(code);
			effects.exit("referenceMarker");
			effects.exit("reference");
			return ok;
		}
		return nok(code);
	}
}
/**
* @import {
*   Construct,
*   State,
*   Token,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const labelStartImage = {
	name: "labelStartImage",
	resolveAll: labelEnd.resolveAll,
	tokenize: tokenizeLabelStartImage
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeLabelStartImage(effects, ok, nok) {
	const self = this;
	/** @type {Token} */
	let labelImage;
	return start;
	/**
	* Start of label (image) start.
	*
	* ```markdown
	* > | a ![b] c
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("labelImage");
		effects.enter("labelImageMarker");
		effects.consume(code);
		effects.exit("labelImageMarker");
		return open;
	}
	/**
	* After `!`, at `[`.
	*
	* ```markdown
	* > | a ![b] c
	*        ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (code === 91) {
			effects.enter("labelMarker");
			effects.consume(code);
			effects.exit("labelMarker");
			labelImage = effects.exit("labelImage");
			return after;
		}
		return nok(code);
	}
	/**
	* After `![`.
	*
	* ```markdown
	* > | a ![b] c
	*         ^
	* ```
	*
	* This is needed in because, when GFM footnotes are enabled, images never
	* form when started with a `^`.
	* Instead, links form:
	*
	* ```markdown
	* ![^a](b)
	*
	* ![^a][b]
	*
	* [b]: c
	* ```
	*
	* ```html
	* <p>!<a href=\"b\">^a</a></p>
	* <p>!<a href=\"c\">^a</a></p>
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		/* c8 ignore next 6 */
		if (code === 94 && "_hiddenFootnoteSupport" in self.parser.constructs) return nok(code);
		self._labelStarts = self._labelStarts || [];
		self._labelStarts.push(labelImage);
		return ok(code);
	}
}
/**
* @import {
*   Construct,
*   State,
*   Token,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const labelStartLink = {
	name: "labelStartLink",
	resolveAll: labelEnd.resolveAll,
	tokenize: tokenizeLabelStartLink
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeLabelStartLink(effects, ok, nok) {
	const self = this;
	/** @type {Token} */
	let labelLink;
	return start;
	/**
	* Start of label (link) start.
	*
	* ```markdown
	* > | a [b] c
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("labelLink");
		effects.enter("labelMarker");
		effects.consume(code);
		effects.exit("labelMarker");
		labelLink = effects.exit("labelLink");
		return after;
	}
	/** @type {State} */
	function after(code) {
		/* c8 ignore next 6 */
		if (code === 94 && "_hiddenFootnoteSupport" in self.parser.constructs) return nok(code);
		self._labelStarts = self._labelStarts || [];
		self._labelStarts.push(labelLink);
		return ok(code);
	}
}
/**
* @import {
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const lineEnding = {
	name: "lineEnding",
	tokenize: tokenizeLineEnding
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeLineEnding(effects, ok) {
	return start;
	/** @type {State} */
	function start(code) {
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return factorySpace(effects, ok, "linePrefix");
	}
}
/**
* @import {
*   Code,
*   Construct,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const thematicBreak = {
	name: "thematicBreak",
	tokenize: tokenizeThematicBreak
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeThematicBreak(effects, ok, nok) {
	let size = 0;
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* Start of thematic break.
	*
	* ```markdown
	* > | ***
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("thematicBreak");
		return before(code);
	}
	/**
	* After optional whitespace, at marker.
	*
	* ```markdown
	* > | ***
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		marker = code;
		return atBreak(code);
	}
	/**
	* After something, before something else.
	*
	* ```markdown
	* > | ***
	*     ^
	* ```
	*
	* @type {State}
	*/
	function atBreak(code) {
		if (code === marker) {
			effects.enter("thematicBreakSequence");
			return sequence(code);
		}
		if (size >= 3 && (code === null || markdownLineEnding(code))) {
			effects.exit("thematicBreak");
			return ok(code);
		}
		return nok(code);
	}
	/**
	* In sequence.
	*
	* ```markdown
	* > | ***
	*     ^
	* ```
	*
	* @type {State}
	*/
	function sequence(code) {
		if (code === marker) {
			effects.consume(code);
			size++;
			return sequence;
		}
		effects.exit("thematicBreakSequence");
		return markdownSpace(code) ? factorySpace(effects, atBreak, "whitespace")(code) : atBreak(code);
	}
}
/**
* @import {
*   Code,
*   Construct,
*   Exiter,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const list = {
	continuation: { tokenize: tokenizeListContinuation },
	exit: tokenizeListEnd,
	name: "list",
	tokenize: tokenizeListStart
};
/** @type {Construct} */
const listItemPrefixWhitespaceConstruct = {
	partial: true,
	tokenize: tokenizeListItemPrefixWhitespace
};
/** @type {Construct} */
const indentConstruct = {
	partial: true,
	tokenize: tokenizeIndent$1
};
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeListStart(effects, ok, nok) {
	const self = this;
	const tail = self.events[self.events.length - 1];
	let initialSize = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
	let size = 0;
	return start;
	/** @type {State} */
	function start(code) {
		const kind = self.containerState.type || (code === 42 || code === 43 || code === 45 ? "listUnordered" : "listOrdered");
		if (kind === "listUnordered" ? !self.containerState.marker || code === self.containerState.marker : asciiDigit(code)) {
			if (!self.containerState.type) {
				self.containerState.type = kind;
				effects.enter(kind, { _container: true });
			}
			if (kind === "listUnordered") {
				effects.enter("listItemPrefix");
				return code === 42 || code === 45 ? effects.check(thematicBreak, nok, atMarker)(code) : atMarker(code);
			}
			if (!self.interrupt || code === 49) {
				effects.enter("listItemPrefix");
				effects.enter("listItemValue");
				return inside(code);
			}
		}
		return nok(code);
	}
	/** @type {State} */
	function inside(code) {
		if (asciiDigit(code) && ++size < 10) {
			effects.consume(code);
			return inside;
		}
		if ((!self.interrupt || size < 2) && (self.containerState.marker ? code === self.containerState.marker : code === 41 || code === 46)) {
			effects.exit("listItemValue");
			return atMarker(code);
		}
		return nok(code);
	}
	/**
	* @type {State}
	**/
	function atMarker(code) {
		effects.enter("listItemMarker");
		effects.consume(code);
		effects.exit("listItemMarker");
		self.containerState.marker = self.containerState.marker || code;
		return effects.check(blankLine, self.interrupt ? nok : onBlank, effects.attempt(listItemPrefixWhitespaceConstruct, endOfPrefix, otherPrefix));
	}
	/** @type {State} */
	function onBlank(code) {
		self.containerState.initialBlankLine = true;
		initialSize++;
		return endOfPrefix(code);
	}
	/** @type {State} */
	function otherPrefix(code) {
		if (markdownSpace(code)) {
			effects.enter("listItemPrefixWhitespace");
			effects.consume(code);
			effects.exit("listItemPrefixWhitespace");
			return endOfPrefix;
		}
		return nok(code);
	}
	/** @type {State} */
	function endOfPrefix(code) {
		self.containerState.size = initialSize + self.sliceSerialize(effects.exit("listItemPrefix"), true).length;
		return ok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeListContinuation(effects, ok, nok) {
	const self = this;
	self.containerState._closeFlow = void 0;
	return effects.check(blankLine, onBlank, notBlank);
	/** @type {State} */
	function onBlank(code) {
		self.containerState.furtherBlankLines = self.containerState.furtherBlankLines || self.containerState.initialBlankLine;
		return factorySpace(effects, ok, "listItemIndent", self.containerState.size + 1)(code);
	}
	/** @type {State} */
	function notBlank(code) {
		if (self.containerState.furtherBlankLines || !markdownSpace(code)) {
			self.containerState.furtherBlankLines = void 0;
			self.containerState.initialBlankLine = void 0;
			return notInCurrentItem(code);
		}
		self.containerState.furtherBlankLines = void 0;
		self.containerState.initialBlankLine = void 0;
		return effects.attempt(indentConstruct, ok, notInCurrentItem)(code);
	}
	/** @type {State} */
	function notInCurrentItem(code) {
		self.containerState._closeFlow = true;
		self.interrupt = void 0;
		return factorySpace(effects, effects.attempt(list, ok, nok), "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeIndent$1(effects, ok, nok) {
	const self = this;
	return factorySpace(effects, afterPrefix, "listItemIndent", self.containerState.size + 1);
	/** @type {State} */
	function afterPrefix(code) {
		const tail = self.events[self.events.length - 1];
		return tail && tail[1].type === "listItemIndent" && tail[2].sliceSerialize(tail[1], true).length === self.containerState.size ? ok(code) : nok(code);
	}
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Exiter}
*/
function tokenizeListEnd(effects) {
	effects.exit(this.containerState.type);
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeListItemPrefixWhitespace(effects, ok, nok) {
	const self = this;
	return factorySpace(effects, afterPrefix, "listItemPrefixWhitespace", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 5);
	/** @type {State} */
	function afterPrefix(code) {
		const tail = self.events[self.events.length - 1];
		return !markdownSpace(code) && tail && tail[1].type === "listItemPrefixWhitespace" ? ok(code) : nok(code);
	}
}
/**
* @import {
*   Code,
*   Construct,
*   Resolver,
*   State,
*   TokenizeContext,
*   Tokenizer
* } from 'micromark-util-types'
*/
/** @type {Construct} */
const setextUnderline = {
	name: "setextUnderline",
	resolveTo: resolveToSetextUnderline,
	tokenize: tokenizeSetextUnderline
};
/** @type {Resolver} */
function resolveToSetextUnderline(events, context) {
	const editMap = new EditMap$1();
	let index = events.length;
	/** @type {number | undefined} */
	let content;
	/** @type {number | undefined} */
	let text;
	/** @type {number | undefined} */
	let definition;
	while (index--) if (events[index][0] === "enter") {
		if (events[index][1].type === "content") {
			content = index;
			break;
		}
		if (events[index][1].type === "paragraph") text = index;
	} else {
		if (events[index][1].type === "content") editMap.add(index, 1, []);
		if (!definition && events[index][1].type === "definition") definition = index;
	}
	const heading = {
		type: "setextHeading",
		start: { ...events[content][1].start },
		end: { ...events[events.length - 1][1].end }
	};
	events[text][1].type = "setextHeadingText";
	if (definition) {
		editMap.add(text, 0, [[
			"enter",
			heading,
			context
		]]);
		editMap.add(definition + 1, 0, [[
			"exit",
			events[content][1],
			context
		]]);
		events[content][1].end = { ...events[definition][1].end };
	} else events[content][1] = heading;
	editMap.add(events.length, 0, [[
		"exit",
		heading,
		context
	]]);
	editMap.consume(events);
	return events;
}
/**
* @this {TokenizeContext}
*   Context.
* @type {Tokenizer}
*/
function tokenizeSetextUnderline(effects, ok, nok) {
	const self = this;
	/** @type {NonNullable<Code>} */
	let marker;
	return start;
	/**
	* At start of heading (setext) underline.
	*
	* ```markdown
	*   | aa
	* > | ==
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		let index = self.events.length;
		/** @type {boolean | undefined} */
		let paragraph;
		while (index--) if (self.events[index][1].type !== "lineEnding" && self.events[index][1].type !== "linePrefix" && self.events[index][1].type !== "content") {
			paragraph = self.events[index][1].type === "paragraph";
			break;
		}
		if (!self.parser.lazy[self.now().line] && (self.interrupt || paragraph)) {
			effects.enter("setextHeadingLine");
			marker = code;
			return before(code);
		}
		return nok(code);
	}
	/**
	* After optional whitespace, at `-` or `=`.
	*
	* ```markdown
	*   | aa
	* > | ==
	*     ^
	* ```
	*
	* @type {State}
	*/
	function before(code) {
		effects.enter("setextHeadingLineSequence");
		return inside(code);
	}
	/**
	* In sequence.
	*
	* ```markdown
	*   | aa
	* > | ==
	*     ^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (code === marker) {
			effects.consume(code);
			return inside;
		}
		effects.exit("setextHeadingLineSequence");
		return markdownSpace(code) ? factorySpace(effects, after, "lineSuffix")(code) : after(code);
	}
	/**
	* After sequence, after optional whitespace.
	*
	* ```markdown
	*   | aa
	* > | ==
	*       ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("setextHeadingLine");
			return ok(code);
		}
		return nok(code);
	}
}
/**
* @import {
*   InitialConstruct,
*   Initializer,
*   State,
*   TokenizeContext
* } from 'micromark-util-types'
*/
/** @type {InitialConstruct} */
const flow$1 = { tokenize: initializeFlow };
/**
* @this {TokenizeContext}
*   Self.
* @type {Initializer}
*   Initializer.
*/
function initializeFlow(effects) {
	const self = this;
	const initial = effects.attempt(blankLine, atBlankEnding, effects.attempt(this.parser.constructs.flowInitial, afterConstruct, factorySpace(effects, effects.attempt(this.parser.constructs.flow, afterConstruct, effects.attempt(content, afterConstruct)), "linePrefix")));
	return initial;
	/** @type {State} */
	function atBlankEnding(code) {
		if (code === null) {
			effects.consume(code);
			return;
		}
		effects.enter("lineEndingBlank");
		effects.consume(code);
		effects.exit("lineEndingBlank");
		self.currentConstruct = void 0;
		return initial;
	}
	/** @type {State} */
	function afterConstruct(code) {
		if (code === null) {
			effects.consume(code);
			return;
		}
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		self.currentConstruct = void 0;
		return initial;
	}
}
/**
* @import {
*   Code,
*   InitialConstruct,
*   Initializer,
*   Resolver,
*   State,
*   TokenizeContext
* } from 'micromark-util-types'
*/
const resolver = { resolveAll: createResolver() };
const string$1 = initializeFactory("string");
const text$2 = initializeFactory("text");
/**
* @param {'string' | 'text'} field
*   Field.
* @returns {InitialConstruct}
*   Construct.
*/
function initializeFactory(field) {
	return {
		resolveAll: createResolver(field === "text" ? resolveAllLineSuffixes : void 0),
		tokenize: initializeText
	};
	/**
	* @this {TokenizeContext}
	*   Context.
	* @type {Initializer}
	*/
	function initializeText(effects) {
		const self = this;
		const constructs = this.parser.constructs[field];
		const text = effects.attempt(constructs, start, notText);
		return start;
		/** @type {State} */
		function start(code) {
			return atBreak(code) ? text(code) : notText(code);
		}
		/** @type {State} */
		function notText(code) {
			if (code === null) {
				effects.consume(code);
				return;
			}
			effects.enter("data");
			effects.consume(code);
			return data;
		}
		/** @type {State} */
		function data(code) {
			if (atBreak(code)) {
				effects.exit("data");
				return text(code);
			}
			effects.consume(code);
			return data;
		}
		/**
		* @param {Code} code
		*   Code.
		* @returns {boolean}
		*   Whether the code is a break.
		*/
		function atBreak(code) {
			if (code === null) return true;
			const list = constructs[code];
			let index = -1;
			if (list) while (++index < list.length) {
				const item = list[index];
				if (!item.previous || item.previous.call(self, self.previous)) return true;
			}
			return false;
		}
	}
}
/**
* @param {Resolver | undefined} [extraResolver]
*   Resolver.
* @returns {Resolver}
*   Resolver.
*/
function createResolver(extraResolver) {
	return resolveAllText;
	/** @type {Resolver} */
	function resolveAllText(events, context) {
		let index = -1;
		/** @type {number | undefined} */
		let enter;
		while (++index <= events.length) if (enter === void 0) {
			if (events[index] && events[index][1].type === "data") {
				enter = index;
				index++;
			}
		} else if (!events[index] || events[index][1].type !== "data") {
			if (index !== enter + 2) {
				events[enter][1].end = events[index - 1][1].end;
				events.splice(enter + 2, index - enter - 2);
				index = enter + 2;
			}
			enter = void 0;
		}
		return extraResolver ? extraResolver(events, context) : events;
	}
}
/**
* A rather ugly set of instructions which again looks at chunks in the input
* stream.
* The reason to do this here is that it is *much* faster to parse in reverse.
* And that we can’t hook into `null` to split the line suffix before an EOF.
* To do: figure out if we can make this into a clean utility, or even in core.
* As it will be useful for GFMs literal autolink extension (and maybe even
* tables?)
*
* @type {Resolver}
*/
function resolveAllLineSuffixes(events, context) {
	const editMap = new EditMap$1();
	let eventIndex = 0;
	while (++eventIndex <= events.length) if ((eventIndex === events.length || events[eventIndex][1].type === "lineEnding") && events[eventIndex - 1][1].type === "data") {
		const data = events[eventIndex - 1][1];
		const chunks = context.sliceStream(data);
		let index = chunks.length;
		let bufferIndex = -1;
		let size = 0;
		/** @type {boolean | undefined} */
		let tabs;
		while (index--) {
			const chunk = chunks[index];
			if (typeof chunk === "string") {
				bufferIndex = chunk.length;
				while (chunk.charCodeAt(bufferIndex - 1) === 32) {
					size++;
					bufferIndex--;
				}
				if (bufferIndex) break;
				bufferIndex = -1;
			} else if (chunk === -2) {
				tabs = true;
				size++;
			} else if (chunk === -1) {} else {
				index++;
				break;
			}
		}
		if (context._contentTypeTextTrailing && eventIndex === events.length) size = 0;
		if (size) {
			const token = {
				type: eventIndex === events.length || tabs || size < 2 ? "lineSuffix" : "hardBreakTrailing",
				start: {
					_bufferIndex: index ? bufferIndex : data.start._bufferIndex + bufferIndex,
					_index: data.start._index + index,
					line: data.end.line,
					column: data.end.column - size,
					offset: data.end.offset - size
				},
				end: { ...data.end }
			};
			data.end = { ...token.start };
			if (data.start.offset === data.end.offset) Object.assign(data, token);
			else editMap.add(eventIndex, 0, [[
				"enter",
				token,
				context
			], [
				"exit",
				token,
				context
			]]);
		}
		eventIndex++;
	}
	editMap.consume(events);
	return events;
}
/**
* @import {Extension} from 'micromark-util-types'
*/
var constructs_exports = /* @__PURE__ */ __exportAll({
	attentionMarkers: () => attentionMarkers,
	contentInitial: () => contentInitial,
	disable: () => disable,
	document: () => document$1,
	flow: () => flow,
	flowInitial: () => flowInitial,
	insideSpan: () => insideSpan,
	string: () => string,
	text: () => text$1
});
/** @satisfies {Extension['document']} */
const document$1 = {
	[42]: list,
	[43]: list,
	[45]: list,
	[48]: list,
	[49]: list,
	[50]: list,
	[51]: list,
	[52]: list,
	[53]: list,
	[54]: list,
	[55]: list,
	[56]: list,
	[57]: list,
	[62]: blockQuote
};
/** @satisfies {Extension['contentInitial']} */
const contentInitial = { [91]: definition };
/** @satisfies {Extension['flowInitial']} */
const flowInitial = {
	[-2]: codeIndented,
	[-1]: codeIndented,
	[32]: codeIndented
};
/** @satisfies {Extension['flow']} */
const flow = {
	[35]: headingAtx,
	[42]: thematicBreak,
	[45]: [setextUnderline, thematicBreak],
	[60]: htmlFlow,
	[61]: setextUnderline,
	[95]: thematicBreak,
	[96]: codeFenced,
	[126]: codeFenced
};
/** @satisfies {Extension['string']} */
const string = {
	[38]: characterReference,
	[92]: characterEscape
};
/** @satisfies {Extension['text']} */
const text$1 = {
	[-5]: lineEnding,
	[-4]: lineEnding,
	[-3]: lineEnding,
	[33]: labelStartImage,
	[38]: characterReference,
	[42]: attention,
	[60]: [autolink, htmlText],
	[91]: labelStartLink,
	[92]: [hardBreakEscape, characterEscape],
	[93]: labelEnd,
	[95]: attention,
	[96]: codeText
};
/** @satisfies {Extension['insideSpan']} */
const insideSpan = { null: [attention, resolver] };
/** @satisfies {Extension['attentionMarkers']} */
const attentionMarkers = { null: [42, 95] };
/** @satisfies {Extension['disable']} */
const disable = { null: [] };
/**
* @import {
*   Chunk,
*   Code,
*   ConstructRecord,
*   Construct,
*   Effects,
*   InitialConstruct,
*   ParseContext,
*   Point,
*   State,
*   TokenizeContext,
*   Token
* } from 'micromark-util-types'
*/
/**
* @callback Restore
*   Restore the state.
* @returns {undefined}
*   Nothing.
*
* @typedef Info
*   Info.
* @property {Restore} restore
*   Restore.
* @property {number} from
*   From.
*
* @callback ReturnHandle
*   Handle a successful run.
* @param {Construct} construct
*   Construct.
* @param {Info} info
*   Info.
* @returns {undefined}
*   Nothing.
*/
/**
* Create a tokenizer.
* Tokenizers deal with one type of data (e.g., containers, flow, text).
* The parser is the object dealing with it all.
* `initialize` works like other constructs, except that only its `tokenize`
* function is used, in which case it doesn’t receive an `ok` or `nok`.
* `from` can be given to set the point before the first character, although
* when further lines are indented, they must be set with `defineSkip`.
*
* @param {ParseContext} parser
*   Parser.
* @param {InitialConstruct} initialize
*   Construct.
* @param {Omit<Point, '_bufferIndex' | '_index'> | undefined} [from]
*   Point (optional).
* @returns {TokenizeContext}
*   Context.
*/
function createTokenizer(parser, initialize, from) {
	/** @type {Point} */
	let point = {
		_bufferIndex: -1,
		_index: 0,
		line: from && from.line || 1,
		column: from && from.column || 1,
		offset: from && from.offset || 0
	};
	/** @type {Record<string, number>} */
	const columnStart = {};
	/** @type {Array<Construct>} */
	const resolveAllConstructs = [];
	/** @type {Array<Chunk>} */
	let chunks = [];
	/** @type {Array<Token>} */
	let stack = [];
	/**
	* Tools used for tokenizing.
	*
	* @type {Effects}
	*/
	const effects = {
		attempt: constructFactory(onsuccessfulconstruct),
		check: constructFactory(onsuccessfulcheck),
		consume,
		enter,
		exit,
		interrupt: constructFactory(onsuccessfulcheck, { interrupt: true })
	};
	/**
	* State and tools for resolving and serializing.
	*
	* @type {TokenizeContext}
	*/
	const context = {
		code: null,
		containerState: {},
		defineSkip,
		events: [],
		now,
		parser,
		previous: null,
		sliceSerialize,
		sliceStream,
		write
	};
	/**
	* The state function.
	*
	* @type {State | undefined}
	*/
	let state = initialize.tokenize.call(context, effects);
	if (initialize.resolveAll) resolveAllConstructs.push(initialize);
	return context;
	/** @type {TokenizeContext['write']} */
	function write(slice) {
		chunks = push(chunks, slice);
		main();
		if (chunks[chunks.length - 1] !== null) return [];
		addResult(initialize, 0);
		context.events = resolveAll(resolveAllConstructs, context.events, context);
		return context.events;
	}
	/** @type {TokenizeContext['sliceSerialize']} */
	function sliceSerialize(token, expandTabs) {
		return serializeChunks(sliceStream(token), expandTabs);
	}
	/** @type {TokenizeContext['sliceStream']} */
	function sliceStream(token) {
		return sliceChunks(chunks, token);
	}
	/** @type {TokenizeContext['now']} */
	function now() {
		const { _bufferIndex, _index, line, column, offset } = point;
		return {
			_bufferIndex,
			_index,
			line,
			column,
			offset
		};
	}
	/** @type {TokenizeContext['defineSkip']} */
	function defineSkip(value) {
		columnStart[value.line] = value.column;
		accountForPotentialSkip();
	}
	/**
	* Main loop (note that `_index` and `_bufferIndex` in `point` are modified by
	* `consume`).
	* Here is where we walk through the chunks, which either include strings of
	* several characters, or numerical character codes.
	* The reason to do this in a loop instead of a call is so the stack can
	* drain.
	*
	* @returns {undefined}
	*   Nothing.
	*/
	function main() {
		while (point._index < chunks.length) {
			const chunk = chunks[point._index];
			if (typeof chunk === "string") {
				const chunkIndex = point._index;
				if (point._bufferIndex < 0) point._bufferIndex = 0;
				while (point._index === chunkIndex && point._bufferIndex < chunk.length) go(chunk.charCodeAt(point._bufferIndex));
			} else go(chunk);
		}
	}
	/**
	* Deal with one code.
	*
	* @param {Code} code
	*   Code.
	* @returns {undefined}
	*   Nothing.
	*/
	function go(code) {
		state = state(code);
	}
	/** @type {Effects['consume']} */
	function consume(code) {
		if (markdownLineEnding(code)) {
			point.line++;
			point.column = 1;
			point.offset += code === -3 ? 2 : 1;
			accountForPotentialSkip();
		} else if (code !== -1) {
			point.column++;
			point.offset++;
		}
		if (point._bufferIndex < 0) point._index++;
		else {
			point._bufferIndex++;
			if (point._bufferIndex === chunks[point._index].length) {
				point._bufferIndex = -1;
				point._index++;
			}
		}
		context.previous = code;
	}
	/** @type {Effects['enter']} */
	function enter(type, fields) {
		/** @type {Token} */
		const token = fields || {};
		token.type = type;
		token.start = now();
		context.events.push([
			"enter",
			token,
			context
		]);
		stack.push(token);
		return token;
	}
	/** @type {Effects['exit']} */
	function exit(type) {
		const token = stack.pop();
		token.end = now();
		context.events.push([
			"exit",
			token,
			context
		]);
		return token;
	}
	/**
	* Use results.
	*
	* @type {ReturnHandle}
	*/
	function onsuccessfulconstruct(construct, info) {
		addResult(construct, info.from);
	}
	/**
	* Discard results.
	*
	* @type {ReturnHandle}
	*/
	function onsuccessfulcheck(_, info) {
		info.restore();
	}
	/**
	* Factory to attempt/check/interrupt.
	*
	* @param {ReturnHandle} onreturn
	*   Callback.
	* @param {{interrupt?: boolean | undefined} | undefined} [fields]
	*   Fields.
	*/
	function constructFactory(onreturn, fields) {
		return hook;
		/**
		* Handle either an object mapping codes to constructs, a list of
		* constructs, or a single construct.
		*
		* @param {Array<Construct> | ConstructRecord | Construct} constructs
		*   Constructs.
		* @param {State} returnState
		*   State.
		* @param {State | undefined} [bogusState]
		*   State.
		* @returns {State}
		*   State.
		*/
		function hook(constructs, returnState, bogusState) {
			/** @type {ReadonlyArray<Construct>} */
			let listOfConstructs;
			/** @type {number} */
			let constructIndex;
			/** @type {Construct} */
			let currentConstruct;
			/** @type {Info} */
			let info;
			return Array.isArray(constructs) ? handleListOfConstructs(constructs) : "tokenize" in constructs ? handleListOfConstructs([constructs]) : handleMapOfConstructs(constructs);
			/**
			* Handle a list of construct.
			*
			* @param {ConstructRecord} map
			*   Constructs.
			* @returns {State}
			*   State.
			*/
			function handleMapOfConstructs(map) {
				return start;
				/** @type {State} */
				function start(code) {
					const left = code !== null && map[code];
					const all = code !== null && map.null;
					return handleListOfConstructs([...Array.isArray(left) ? left : left ? [left] : [], ...Array.isArray(all) ? all : all ? [all] : []])(code);
				}
			}
			/**
			* Handle a list of construct.
			*
			* @param {ReadonlyArray<Construct>} list
			*   Constructs.
			* @returns {State}
			*   State.
			*/
			function handleListOfConstructs(list) {
				listOfConstructs = list;
				constructIndex = 0;
				if (list.length === 0) return bogusState;
				return handleConstruct(list[constructIndex]);
			}
			/**
			* Handle a single construct.
			*
			* @param {Construct} construct
			*   Construct.
			* @returns {State}
			*   State.
			*/
			function handleConstruct(construct) {
				return start;
				/** @type {State} */
				function start(code) {
					info = store();
					currentConstruct = construct;
					if (!construct.partial) context.currentConstruct = construct;
					if (construct.name && context.parser.constructs.disable.null.includes(construct.name)) return nok(code);
					return construct.tokenize.call(fields ? Object.assign(Object.create(context), fields) : context, effects, ok, nok)(code);
				}
			}
			/** @type {State} */
			function ok(code) {
				onreturn(currentConstruct, info);
				return returnState;
			}
			/** @type {State} */
			function nok(code) {
				info.restore();
				if (++constructIndex < listOfConstructs.length) return handleConstruct(listOfConstructs[constructIndex]);
				return bogusState;
			}
		}
	}
	/**
	* @param {Construct} construct
	*   Construct.
	* @param {number} from
	*   From.
	* @returns {undefined}
	*   Nothing.
	*/
	function addResult(construct, from) {
		if (construct.resolveAll && !resolveAllConstructs.includes(construct)) resolveAllConstructs.push(construct);
		if (construct.resolve) splice(context.events, from, context.events.length - from, construct.resolve(context.events.slice(from), context));
		if (construct.resolveTo) context.events = construct.resolveTo(context.events, context);
	}
	/**
	* Store state.
	*
	* @returns {Info}
	*   Info.
	*/
	function store() {
		const startPoint = now();
		const startPrevious = context.previous;
		const startCurrentConstruct = context.currentConstruct;
		const startEventsIndex = context.events.length;
		const startStack = Array.from(stack);
		return {
			from: startEventsIndex,
			restore
		};
		/**
		* Restore state.
		*
		* @returns {undefined}
		*   Nothing.
		*/
		function restore() {
			point = startPoint;
			context.previous = startPrevious;
			context.currentConstruct = startCurrentConstruct;
			context.events.length = startEventsIndex;
			stack = startStack;
			accountForPotentialSkip();
		}
	}
	/**
	* Move the current point a bit forward in the line when it’s on a column
	* skip.
	*
	* @returns {undefined}
	*   Nothing.
	*/
	function accountForPotentialSkip() {
		if (point.line in columnStart && point.column < 2) {
			point.column = columnStart[point.line];
			point.offset += columnStart[point.line] - 1;
		}
	}
}
/**
* Get the chunks from a slice of chunks in the range of a token.
*
* @param {ReadonlyArray<Chunk>} chunks
*   Chunks.
* @param {Pick<Token, 'end' | 'start'>} token
*   Token.
* @returns {Array<Chunk>}
*   Chunks.
*/
function sliceChunks(chunks, token) {
	const startIndex = token.start._index;
	const startBufferIndex = token.start._bufferIndex;
	const endIndex = token.end._index;
	const endBufferIndex = token.end._bufferIndex;
	/** @type {Array<Chunk>} */
	let view;
	if (startIndex === endIndex) view = [chunks[startIndex].slice(startBufferIndex, endBufferIndex)];
	else {
		view = chunks.slice(startIndex, endIndex);
		if (startBufferIndex > -1) {
			const head = view[0];
			if (typeof head === "string") view[0] = head.slice(startBufferIndex);
			else view.shift();
		}
		if (endBufferIndex > 0) view.push(chunks[endIndex].slice(0, endBufferIndex));
	}
	return view;
}
/**
* Get the string value of a slice of chunks.
*
* @param {ReadonlyArray<Chunk>} chunks
*   Chunks.
* @param {boolean | undefined} [expandTabs=false]
*   Whether to expand tabs (default: `false`).
* @returns {string}
*   Result.
*/
function serializeChunks(chunks, expandTabs) {
	let index = -1;
	/** @type {Array<string>} */
	const result = [];
	/** @type {boolean | undefined} */
	let atTab;
	while (++index < chunks.length) {
		const chunk = chunks[index];
		/** @type {string} */
		let value;
		if (typeof chunk === "string") value = chunk;
		else switch (chunk) {
			case -5:
				value = "\r";
				break;
			case -4:
				value = "\n";
				break;
			case -3:
				value = "\r\n";
				break;
			case -2:
				value = expandTabs ? " " : "	";
				break;
			case -1:
				if (!expandTabs && atTab) continue;
				value = " ";
				break;
			default: value = String.fromCharCode(chunk);
		}
		atTab = chunk === -2;
		result.push(value);
	}
	return result.join("");
}
/**
* @import {
*   Create,
*   FullNormalizedExtension,
*   InitialConstruct,
*   ParseContext,
*   ParseOptions
* } from 'micromark-util-types'
*/
/**
* @param {ParseOptions | null | undefined} [options]
*   Configuration (optional).
* @returns {ParseContext}
*   Parser.
*/
function parse(options) {
	/** @type {ParseContext} */
	const parser = {
		constructs: combineExtensions([constructs_exports, ...(options || {}).extensions || []]),
		content: create(content$1),
		defined: [],
		document: create(document$2),
		flow: create(flow$1),
		lazy: {},
		string: create(string$1),
		text: create(text$2)
	};
	return parser;
	/**
	* @param {InitialConstruct} initial
	*   Construct to start with.
	* @returns {Create}
	*   Create a tokenizer.
	*/
	function create(initial) {
		return creator;
		/** @type {Create} */
		function creator(from) {
			return createTokenizer(parser, initial, from);
		}
	}
}
/**
* @import {Event} from 'micromark-util-types'
*/
/**
* @param {Array<Event>} events
*   Events.
* @returns {Array<Event>}
*   Events.
*/
function postprocess(events) {
	while (!subtokenize(events));
	return events;
}
/**
* @import {Chunk, Code, Encoding, Value} from 'micromark-util-types'
*/
/**
* @callback Preprocessor
*   Preprocess a value.
* @param {Value} value
*   Value.
* @param {Encoding | null | undefined} [encoding]
*   Encoding when `value` is a typed array (optional).
* @param {boolean | null | undefined} [end=false]
*   Whether this is the last chunk (default: `false`).
* @returns {Array<Chunk>}
*   Chunks.
*/
const search = /[\0\t\n\r]/g;
/**
* @returns {Preprocessor}
*   Preprocess a value.
*/
function preprocess() {
	let column = 1;
	let buffer = "";
	/** @type {boolean | undefined} */
	let start = true;
	/** @type {boolean | undefined} */
	let atCarriageReturn;
	return preprocessor;
	/** @type {Preprocessor} */
	function preprocessor(value, encoding, end) {
		value = buffer + (typeof value === "string" ? value.toString() : new TextDecoder(encoding || void 0).decode(value));
		/** @type {Array<Chunk>} */
		const chunks = [];
		let startPosition = 0;
		buffer = "";
		if (start) {
			if (value.charCodeAt(0) === 65279) startPosition++;
			start = void 0;
		}
		while (startPosition < value.length) {
			search.lastIndex = startPosition;
			const match = search.exec(value);
			const endPosition = match && match.index !== void 0 ? match.index : value.length;
			const code = value.charCodeAt(endPosition);
			if (!match) {
				buffer = value.slice(startPosition);
				break;
			}
			if (code === 10 && startPosition === endPosition && atCarriageReturn) {
				chunks.push(-3);
				atCarriageReturn = void 0;
			} else {
				if (atCarriageReturn) {
					chunks.push(-5);
					atCarriageReturn = void 0;
				}
				if (startPosition < endPosition) {
					chunks.push(value.slice(startPosition, endPosition));
					column += endPosition - startPosition;
				}
				switch (code) {
					case 0:
						chunks.push(65533);
						column++;
						break;
					case 9: {
						const next = Math.ceil(column / 4) * 4;
						chunks.push(-2);
						while (column++ < next) chunks.push(-1);
						break;
					}
					case 10:
						chunks.push(-4);
						column = 1;
						break;
					default:
						atCarriageReturn = true;
						column = 1;
				}
			}
			startPosition = endPosition + 1;
		}
		if (end) {
			if (atCarriageReturn) chunks.push(-5);
			if (buffer) chunks.push(buffer);
			chunks.push(null);
		}
		return chunks;
	}
}
const characterEscapeOrReference = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
/**
* Decode markdown strings (which occur in places such as fenced code info
* strings, destinations, labels, and titles).
*
* The “string” content type allows character escapes and -references.
* This decodes those.
*
* @param {string} value
*   Value to decode.
* @returns {string}
*   Decoded value.
*/
function decodeString(value) {
	return value.replace(characterEscapeOrReference, decode);
}
/**
* @param {string} $0
*   Match.
* @param {string} $1
*   Character escape.
* @param {string} $2
*   Character reference.
* @returns {string}
*   Decoded value
*/
function decode($0, $1, $2) {
	if ($1) return $1;
	if ($2.charCodeAt(0) === 35) {
		const head = $2.charCodeAt(1);
		const hex = head === 120 || head === 88;
		return decodeNumericCharacterReference($2.slice(hex ? 2 : 1), hex ? 16 : 10);
	}
	return decodeNamedCharacterReference($2) || $0;
}
/**
* @typedef {import('unist').Node} Node
* @typedef {import('unist').Point} Point
* @typedef {import('unist').Position} Position
*/
/**
* @typedef NodeLike
* @property {string} type
* @property {PositionLike | null | undefined} [position]
*
* @typedef PointLike
* @property {number | null | undefined} [line]
* @property {number | null | undefined} [column]
* @property {number | null | undefined} [offset]
*
* @typedef PositionLike
* @property {PointLike | null | undefined} [start]
* @property {PointLike | null | undefined} [end]
*/
/**
* Serialize the positional info of a point, position (start and end points),
* or node.
*
* @param {Node | NodeLike | Point | PointLike | Position | PositionLike | null | undefined} [value]
*   Node, position, or point.
* @returns {string}
*   Pretty printed positional info of a node (`string`).
*
*   In the format of a range `ls:cs-le:ce` (when given `node` or `position`)
*   or a point `l:c` (when given `point`), where `l` stands for line, `c` for
*   column, `s` for `start`, and `e` for end.
*   An empty string (`''`) is returned if the given value is neither `node`,
*   `position`, nor `point`.
*/
function stringifyPosition(value) {
	if (!value || typeof value !== "object") return "";
	if ("position" in value || "type" in value) return position(value.position);
	if ("start" in value || "end" in value) return position(value);
	if ("line" in value || "column" in value) return point$1(value);
	return "";
}
/**
* @param {Point | PointLike | null | undefined} point
* @returns {string}
*/
function point$1(point) {
	return index(point && point.line) + ":" + index(point && point.column);
}
/**
* @param {Position | PositionLike | null | undefined} pos
* @returns {string}
*/
function position(pos) {
	return point$1(pos && pos.start) + "-" + point$1(pos && pos.end);
}
/**
* @param {number | null | undefined} value
* @returns {number}
*/
function index(value) {
	return value && typeof value === "number" ? value : 1;
}
/**
* @import {
*   Break,
*   Blockquote,
*   Code,
*   Definition,
*   Emphasis,
*   Heading,
*   Html,
*   Image,
*   InlineCode,
*   Link,
*   ListItem,
*   List,
*   Nodes,
*   Paragraph,
*   PhrasingContent,
*   ReferenceType,
*   Root,
*   Strong,
*   Text,
*   ThematicBreak
* } from 'mdast'
* @import {
*   Encoding,
*   Event,
*   Token,
*   Value
* } from 'micromark-util-types'
* @import {Point} from 'unist'
* @import {
*   CompileContext,
*   CompileData,
*   Config,
*   Extension,
*   Handle,
*   OnEnterError,
*   Options
* } from './types.js'
*/
const own = {}.hasOwnProperty;
/**
* Turn markdown into a syntax tree.
*
* @overload
* @param {Value} value
* @param {Encoding | null | undefined} [encoding]
* @param {Options | null | undefined} [options]
* @returns {Root}
*
* @overload
* @param {Value} value
* @param {Options | null | undefined} [options]
* @returns {Root}
*
* @param {Value} value
*   Markdown to parse.
* @param {Encoding | Options | null | undefined} [encoding]
*   Character encoding for when `value` is `Buffer`.
* @param {Options | null | undefined} [options]
*   Configuration.
* @returns {Root}
*   mdast tree.
*/
function fromMarkdown(value, encoding, options) {
	if (encoding && typeof encoding === "object") {
		options = encoding;
		encoding = void 0;
	}
	return compiler(options)(postprocess(parse(options).document().write(preprocess()(value, encoding, true))));
}
/**
* Note this compiler only understand complete buffering, not streaming.
*
* @param {Options | null | undefined} [options]
*/
function compiler(options) {
	/** @type {Config} */
	const config = {
		afterExit: [],
		beforeEnter: [],
		transforms: [],
		canContainEols: [
			"emphasis",
			"fragment",
			"heading",
			"paragraph",
			"strong"
		],
		enter: {
			autolink: opener(link),
			autolinkProtocol: onenterdata,
			autolinkEmail: onenterdata,
			atxHeading: opener(heading),
			blockQuote: opener(blockQuote),
			characterEscape: onenterdata,
			characterReference: onenterdata,
			codeFenced: opener(codeFlow),
			codeFencedFenceInfo: buffer,
			codeFencedFenceMeta: buffer,
			codeIndented: opener(codeFlow, buffer),
			codeText: opener(codeText, buffer),
			codeTextData: onenterdata,
			data: onenterdata,
			codeFlowValue: onenterdata,
			definition: opener(definition),
			definitionDestinationString: buffer,
			definitionLabelString: buffer,
			definitionTitleString: buffer,
			emphasis: opener(emphasis),
			hardBreakEscape: opener(hardBreak),
			hardBreakTrailing: opener(hardBreak),
			htmlFlow: opener(html, buffer),
			htmlFlowData: onenterdata,
			htmlText: opener(html, buffer),
			htmlTextData: onenterdata,
			image: opener(image),
			label: buffer,
			link: opener(link),
			listItem: opener(listItem),
			listItemValue: onenterlistitemvalue,
			listOrdered: opener(list, onenterlistordered),
			listUnordered: opener(list),
			paragraph: opener(paragraph),
			reference: onenterreference,
			referenceString: buffer,
			resourceDestinationString: buffer,
			resourceTitleString: buffer,
			setextHeading: opener(heading),
			strong: opener(strong),
			thematicBreak: opener(thematicBreak)
		},
		exit: {
			atxHeading: closer(),
			atxHeadingSequence: onexitatxheadingsequence,
			autolink: closer(),
			autolinkEmail: onexitautolinkemail,
			autolinkProtocol: onexitautolinkprotocol,
			blockQuote: closer(),
			characterEscapeValue: onexitdata,
			characterReferenceMarkerHexadecimal: onexitcharacterreferencemarker,
			characterReferenceMarkerNumeric: onexitcharacterreferencemarker,
			characterReferenceValue: onexitcharacterreferencevalue,
			characterReference: onexitcharacterreference,
			codeFenced: closer(onexitcodefenced),
			codeFencedFence: onexitcodefencedfence,
			codeFencedFenceInfo: onexitcodefencedfenceinfo,
			codeFencedFenceMeta: onexitcodefencedfencemeta,
			codeFlowValue: onexitdata,
			codeIndented: closer(onexitcodeindented),
			codeText: closer(onexitcodetext),
			codeTextData: onexitdata,
			data: onexitdata,
			definition: closer(),
			definitionDestinationString: onexitdefinitiondestinationstring,
			definitionLabelString: onexitdefinitionlabelstring,
			definitionTitleString: onexitdefinitiontitlestring,
			emphasis: closer(),
			hardBreakEscape: closer(onexithardbreak),
			hardBreakTrailing: closer(onexithardbreak),
			htmlFlow: closer(onexithtmlflow),
			htmlFlowData: onexitdata,
			htmlText: closer(onexithtmltext),
			htmlTextData: onexitdata,
			image: closer(onexitimage),
			label: onexitlabel,
			labelText: onexitlabeltext,
			lineEnding: onexitlineending,
			link: closer(onexitlink),
			listItem: closer(),
			listOrdered: closer(),
			listUnordered: closer(),
			paragraph: closer(),
			referenceString: onexitreferencestring,
			resourceDestinationString: onexitresourcedestinationstring,
			resourceTitleString: onexitresourcetitlestring,
			resource: onexitresource,
			setextHeading: closer(onexitsetextheading),
			setextHeadingLineSequence: onexitsetextheadinglinesequence,
			setextHeadingText: onexitsetextheadingtext,
			strong: closer(),
			thematicBreak: closer()
		}
	};
	configure(config, (options || {}).mdastExtensions || []);
	/** @type {CompileData} */
	const data = {};
	return compile;
	/**
	* Turn micromark events into an mdast tree.
	*
	* @param {Array<Event>} events
	*   Events.
	* @returns {Root}
	*   mdast tree.
	*/
	function compile(events) {
		/** @type {Root} */
		let tree = {
			type: "root",
			children: [],
			position: void 0
		};
		/** @type {Omit<CompileContext, 'sliceSerialize'>} */
		const context = {
			stack: [tree],
			tokenStack: [],
			config,
			enter,
			exit,
			buffer,
			resume,
			data
		};
		/** @type {Array<number>} */
		const listStack = [];
		/** @type {Array<Event>} */
		const prepared = [];
		let index = -1;
		while (++index < events.length) {
			prepared.push(events[index]);
			if (events[index][1].type === "listOrdered" || events[index][1].type === "listUnordered") {
				if (events[index][0] === "enter") listStack.push(prepared.length - 1);
				else prepareList(prepared, listStack.pop());
			}
		}
		events = prepared;
		index = -1;
		while (++index < events.length) {
			const handler = config[events[index][0]];
			if (events[index][0] === "enter" && config.beforeEnter.length > 0) callListeners(config.beforeEnter, {
				...context,
				sliceSerialize: events[index][2].sliceSerialize
			}, events[index][1]);
			if (own.call(handler, events[index][1].type)) handler[events[index][1].type].call({
				...context,
				sliceSerialize: events[index][2].sliceSerialize
			}, events[index][1]);
			if (events[index][0] === "exit" && config.afterExit.length > 0) callListeners(config.afterExit, {
				...context,
				sliceSerialize: events[index][2].sliceSerialize
			}, events[index][1]);
		}
		if (context.tokenStack.length > 0) {
			const tail = context.tokenStack[context.tokenStack.length - 1];
			(tail[1] || defaultOnError).call(context, void 0, tail[0]);
		}
		tree.position = {
			start: point(events.length > 0 ? events[0][1].start : {
				line: 1,
				column: 1,
				offset: 0
			}),
			end: point(events.length > 0 ? events[events.length - 2][1].end : {
				line: 1,
				column: 1,
				offset: 0
			})
		};
		index = -1;
		while (++index < config.transforms.length) tree = config.transforms[index](tree) || tree;
		return tree;
	}
	/**
	* @param {Array<Handle>} listeners
	*   Listeners.
	* @param {CompileContext} context
	*   Context.
	* @param {Token} token
	*   Token.
	* @returns {undefined}
	*   Nothing.
	*/
	function callListeners(listeners, context, token) {
		let index = -1;
		while (++index < listeners.length) listeners[index].call(context, token);
	}
	/**
	* @param {Array<Event>} events
	*   Events, ending with the list to prepare.
	* @param {number} start
	*   Index of the list enter.
	* @returns {undefined}
	*/
	function prepareList(events, start) {
		const end = events.length - 1;
		let index = start - 1;
		let containerBalance = -1;
		let listSpread = false;
		/** @type {Token | undefined} */
		let listItem;
		/** @type {number | undefined} */
		let lineIndex;
		/** @type {number | undefined} */
		let firstBlankLineIndex;
		/** @type {boolean | undefined} */
		let atMarker;
		/**
		* `listItem` events to insert before the event at `at`, in walk order.
		* Merged in after the walk, as inserting while walking would shift the
		* rest of the list once per item.
		* @type {Array<{at: number, event: Event}>}
		*/
		const insertions = [];
		while (++index <= end) {
			const event = events[index];
			switch (event[1].type) {
				case "listUnordered":
				case "listOrdered":
				case "blockQuote":
					if (event[0] === "enter") containerBalance++;
					else containerBalance--;
					atMarker = void 0;
					break;
				case "lineEndingBlank":
					if (event[0] === "enter") {
						if (listItem && !atMarker && !containerBalance && !firstBlankLineIndex) firstBlankLineIndex = index;
						atMarker = void 0;
					}
					break;
				case "linePrefix":
				case "listItemValue":
				case "listItemMarker":
				case "listItemPrefix":
				case "listItemPrefixWhitespace": break;
				default: atMarker = void 0;
			}
			if (!containerBalance && event[0] === "enter" && event[1].type === "listItemPrefix" || containerBalance === -1 && event[0] === "exit" && (event[1].type === "listUnordered" || event[1].type === "listOrdered")) {
				if (listItem) {
					let tailIndex = index;
					lineIndex = void 0;
					while (tailIndex--) {
						const tailEvent = events[tailIndex];
						if (tailEvent[1].type === "lineEnding" || tailEvent[1].type === "lineEndingBlank") {
							if (tailEvent[0] === "exit") continue;
							if (lineIndex) {
								events[lineIndex][1].type = "lineEndingBlank";
								listSpread = true;
							}
							tailEvent[1].type = "lineEnding";
							lineIndex = tailIndex;
						} else if (tailEvent[1].type === "linePrefix" || tailEvent[1].type === "blockQuotePrefix" || tailEvent[1].type === "blockQuotePrefixWhitespace" || tailEvent[1].type === "blockQuoteMarker" || tailEvent[1].type === "listItemIndent") {} else break;
					}
					if (firstBlankLineIndex && (!lineIndex || firstBlankLineIndex < lineIndex)) listItem._spread = true;
					listItem.end = Object.assign({}, lineIndex ? events[lineIndex][1].start : event[1].end);
					insertions.push({
						at: lineIndex || index,
						event: [
							"exit",
							listItem,
							event[2]
						]
					});
				}
				if (event[1].type === "listItemPrefix") {
					/** @type {Token} */
					const item = {
						type: "listItem",
						_spread: false,
						start: Object.assign({}, event[1].start),
						end: void 0
					};
					listItem = item;
					insertions.push({
						at: index,
						event: [
							"enter",
							item,
							event[2]
						]
					});
					firstBlankLineIndex = void 0;
					atMarker = true;
				}
			}
		}
		const listEvents = events.splice(start);
		let insertion = 0;
		index = -1;
		while (++index < listEvents.length) {
			while (insertion < insertions.length && insertions[insertion].at === start + index) events.push(insertions[insertion++].event);
			events.push(listEvents[index]);
		}
		events[start][1]._spread = listSpread;
	}
	/**
	* Create an opener handle.
	*
	* @param {(token: Token) => Nodes} create
	*   Create a node.
	* @param {Handle | undefined} [and]
	*   Optional function to also run.
	* @returns {Handle}
	*   Handle.
	*/
	function opener(create, and) {
		return open;
		/**
		* @this {CompileContext}
		* @param {Token} token
		* @returns {undefined}
		*/
		function open(token) {
			enter.call(this, create(token), token);
			if (and) and.call(this, token);
		}
	}
	/**
	* @type {CompileContext['buffer']}
	*/
	function buffer() {
		this.stack.push({
			type: "fragment",
			children: []
		});
	}
	/**
	* @type {CompileContext['enter']}
	*/
	function enter(node, token, errorHandler) {
		this.stack[this.stack.length - 1].children.push(node);
		this.stack.push(node);
		this.tokenStack.push([token, errorHandler || void 0]);
		node.position = {
			start: point(token.start),
			end: void 0
		};
	}
	/**
	* Create a closer handle.
	*
	* @param {Handle | undefined} [and]
	*   Optional function to also run.
	* @returns {Handle}
	*   Handle.
	*/
	function closer(and) {
		return close;
		/**
		* @this {CompileContext}
		* @param {Token} token
		* @returns {undefined}
		*/
		function close(token) {
			if (and) and.call(this, token);
			exit.call(this, token);
		}
	}
	/**
	* @type {CompileContext['exit']}
	*/
	function exit(token, onExitError) {
		const node = this.stack.pop();
		const open = this.tokenStack.pop();
		if (!open) throw new Error("Cannot close `" + token.type + "` (" + stringifyPosition({
			start: token.start,
			end: token.end
		}) + "): it’s not open");
		if (open[0].type !== token.type) {
			if (onExitError) onExitError.call(this, token, open[0]);
			else (open[1] || defaultOnError).call(this, token, open[0]);
		}
		node.position.end = point(token.end);
	}
	/**
	* @type {CompileContext['resume']}
	*/
	function resume() {
		return toString(this.stack.pop());
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onenterlistordered() {
		this.data.expectingFirstListItemValue = true;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onenterlistitemvalue(token) {
		if (this.data.expectingFirstListItemValue) {
			const ancestor = this.stack[this.stack.length - 2];
			ancestor.start = Number.parseInt(this.sliceSerialize(token), 10);
			this.data.expectingFirstListItemValue = void 0;
		}
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodefencedfenceinfo() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.lang = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodefencedfencemeta() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.meta = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodefencedfence() {
		if (this.data.flowCodeInside) return;
		this.buffer();
		this.data.flowCodeInside = true;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodefenced() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
		this.data.flowCodeInside = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodeindented() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data.replace(/(\r?\n|\r)$/g, "");
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitdefinitionlabelstring(token) {
		const label = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.label = label;
		node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitdefinitiontitlestring() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.title = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitdefinitiondestinationstring() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.url = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitatxheadingsequence(token) {
		const node = this.stack[this.stack.length - 1];
		if (!node.depth) node.depth = this.sliceSerialize(token).length;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitsetextheadingtext() {
		this.data.setextHeadingSlurpLineEnding = true;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitsetextheadinglinesequence(token) {
		const node = this.stack[this.stack.length - 1];
		node.depth = this.sliceSerialize(token).codePointAt(0) === 61 ? 1 : 2;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitsetextheading() {
		this.data.setextHeadingSlurpLineEnding = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onenterdata(token) {
		/** @type {Array<Nodes>} */
		const siblings = this.stack[this.stack.length - 1].children;
		let tail = siblings[siblings.length - 1];
		if (!tail || tail.type !== "text") {
			tail = text();
			tail.position = {
				start: point(token.start),
				end: void 0
			};
			siblings.push(tail);
		}
		this.stack.push(tail);
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitdata(token) {
		const tail = this.stack.pop();
		tail.value += this.sliceSerialize(token);
		tail.position.end = point(token.end);
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitlineending(token) {
		const context = this.stack[this.stack.length - 1];
		if (this.data.atHardBreak) {
			const tail = context.children[context.children.length - 1];
			tail.position.end = point(token.end);
			this.data.atHardBreak = void 0;
			return;
		}
		if (!this.data.setextHeadingSlurpLineEnding && config.canContainEols.includes(context.type)) {
			onenterdata.call(this, token);
			onexitdata.call(this, token);
		}
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexithardbreak() {
		this.data.atHardBreak = true;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexithtmlflow() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexithtmltext() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcodetext() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.value = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitlink() {
		const node = this.stack[this.stack.length - 1];
		if (this.data.inReference) {
			/** @type {ReferenceType} */
			const referenceType = this.data.referenceType || "shortcut";
			node.type += "Reference";
			node.referenceType = referenceType;
			delete node.url;
			delete node.title;
		} else {
			delete node.identifier;
			delete node.label;
		}
		this.data.referenceType = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitimage() {
		const node = this.stack[this.stack.length - 1];
		if (this.data.inReference) {
			/** @type {ReferenceType} */
			const referenceType = this.data.referenceType || "shortcut";
			node.type += "Reference";
			node.referenceType = referenceType;
			delete node.url;
			delete node.title;
		} else {
			delete node.identifier;
			delete node.label;
		}
		this.data.referenceType = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitlabeltext(token) {
		const string = this.sliceSerialize(token);
		const ancestor = this.stack[this.stack.length - 2];
		ancestor.label = decodeString(string);
		ancestor.identifier = normalizeIdentifier(string).toLowerCase();
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitlabel() {
		const fragment = this.stack[this.stack.length - 1];
		const value = this.resume();
		const node = this.stack[this.stack.length - 1];
		this.data.inReference = true;
		if (node.type === "link") node.children = fragment.children;
		else node.alt = value;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitresourcedestinationstring() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.url = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitresourcetitlestring() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.title = data;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitresource() {
		this.data.inReference = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onenterreference() {
		this.data.referenceType = "collapsed";
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitreferencestring(token) {
		const label = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.label = label;
		node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
		this.data.referenceType = "full";
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcharacterreferencemarker(token) {
		this.data.characterReferenceType = token.type;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcharacterreferencevalue(token) {
		const data = this.sliceSerialize(token);
		const type = this.data.characterReferenceType;
		/** @type {string} */
		let value;
		if (type) {
			value = decodeNumericCharacterReference(data, type === "characterReferenceMarkerNumeric" ? 10 : 16);
			this.data.characterReferenceType = void 0;
		} else value = decodeNamedCharacterReference(data);
		const tail = this.stack[this.stack.length - 1];
		tail.value += value;
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitcharacterreference(token) {
		const tail = this.stack.pop();
		tail.position.end = point(token.end);
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitautolinkprotocol(token) {
		onexitdata.call(this, token);
		const node = this.stack[this.stack.length - 1];
		node.url = this.sliceSerialize(token);
	}
	/**
	* @this {CompileContext}
	* @type {Handle}
	*/
	function onexitautolinkemail(token) {
		onexitdata.call(this, token);
		const node = this.stack[this.stack.length - 1];
		node.url = "mailto:" + this.sliceSerialize(token);
	}
	/** @returns {Blockquote} */
	function blockQuote() {
		return {
			type: "blockquote",
			children: [],
			position: void 0
		};
	}
	/** @returns {Code} */
	function codeFlow() {
		return {
			type: "code",
			lang: null,
			meta: null,
			value: "",
			position: void 0
		};
	}
	/** @returns {InlineCode} */
	function codeText() {
		return {
			type: "inlineCode",
			value: "",
			position: void 0
		};
	}
	/** @returns {Definition} */
	function definition() {
		return {
			type: "definition",
			identifier: "",
			label: null,
			title: null,
			url: "",
			position: void 0
		};
	}
	/** @returns {Emphasis} */
	function emphasis() {
		return {
			type: "emphasis",
			children: [],
			position: void 0
		};
	}
	/** @returns {Heading} */
	function heading() {
		return {
			type: "heading",
			depth: 0,
			children: [],
			position: void 0
		};
	}
	/** @returns {Break} */
	function hardBreak() {
		return {
			type: "break",
			position: void 0
		};
	}
	/** @returns {Html} */
	function html() {
		return {
			type: "html",
			value: "",
			position: void 0
		};
	}
	/** @returns {Image} */
	function image() {
		return {
			type: "image",
			title: null,
			url: "",
			alt: null,
			position: void 0
		};
	}
	/** @returns {Link} */
	function link() {
		return {
			type: "link",
			title: null,
			url: "",
			children: [],
			position: void 0
		};
	}
	/**
	* @param {Token} token
	* @returns {List}
	*/
	function list(token) {
		return {
			type: "list",
			ordered: token.type === "listOrdered",
			start: null,
			spread: token._spread,
			children: [],
			position: void 0
		};
	}
	/**
	* @param {Token} token
	* @returns {ListItem}
	*/
	function listItem(token) {
		return {
			type: "listItem",
			spread: token._spread,
			checked: null,
			children: [],
			position: void 0
		};
	}
	/** @returns {Paragraph} */
	function paragraph() {
		return {
			type: "paragraph",
			children: [],
			position: void 0
		};
	}
	/** @returns {Strong} */
	function strong() {
		return {
			type: "strong",
			children: [],
			position: void 0
		};
	}
	/** @returns {Text} */
	function text() {
		return {
			type: "text",
			value: "",
			position: void 0
		};
	}
	/** @returns {ThematicBreak} */
	function thematicBreak() {
		return {
			type: "thematicBreak",
			position: void 0
		};
	}
}
/**
* Copy a point-like value.
*
* @param {Point} d
*   Point-like value.
* @returns {Point}
*   unist point.
*/
function point(d) {
	return {
		line: d.line,
		column: d.column,
		offset: d.offset
	};
}
/**
* @param {Config} combined
* @param {Array<Array<Extension> | Extension>} extensions
* @returns {undefined}
*/
function configure(combined, extensions) {
	let index = -1;
	while (++index < extensions.length) {
		const value = extensions[index];
		if (Array.isArray(value)) configure(combined, value);
		else extension(combined, value);
	}
}
/**
* @param {Config} combined
* @param {Extension} extension
* @returns {undefined}
*/
function extension(combined, extension) {
	/** @type {keyof Extension} */
	let key;
	for (key in extension) if (own.call(extension, key)) switch (key) {
		case "canContainEols": {
			const right = extension[key];
			if (right) combined[key].push(...right);
			break;
		}
		case "transforms": {
			const right = extension[key];
			if (right) combined[key].push(...right);
			break;
		}
		case "afterExit":
		case "beforeEnter": {
			const right = extension[key];
			if (right) combined[key].push(right);
			break;
		}
		case "enter":
		case "exit": {
			const right = extension[key];
			if (right) Object.assign(combined[key], right);
			break;
		}
	}
}
/** @type {OnEnterError} */
function defaultOnError(left, right) {
	if (left) throw new Error("Cannot close `" + left.type + "` (" + stringifyPosition({
		start: left.start,
		end: left.end
	}) + "): a different token (`" + right.type + "`, " + stringifyPosition({
		start: right.start,
		end: right.end
	}) + ") is open");
	throw new Error("Cannot close document, a token (`" + right.type + "`, " + stringifyPosition({
		start: right.start,
		end: right.end
	}) + ") is still open");
}
/**
* Count how often a character (or substring) is used in a string.
*
* @param {string} value
*   Value to search in.
* @param {string} character
*   Character (or substring) to look for.
* @return {number}
*   Number of times `character` occurred in `value`.
*/
function ccount(value, character) {
	const source = String(value);
	if (typeof character !== "string") throw new TypeError("Expected character");
	let count = 0;
	let index = source.indexOf(character);
	while (index !== -1) {
		count++;
		index = source.indexOf(character, index + character.length);
	}
	return count;
}
function escapeStringRegexp(string) {
	if (typeof string !== "string") throw new TypeError("Expected a string");
	return string.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
/**
* Generate an assertion from a test.
*
* Useful if you’re going to test many nodes, for example when creating a
* utility where something else passes a compatible test.
*
* The created function is a bit faster because it expects valid input only:
* a `node`, `index`, and `parent`.
*
* @param {Test} test
*   *   when nullish, checks if `node` is a `Node`.
*   *   when `string`, works like passing `(node) => node.type === test`.
*   *   when `function` checks if function passed the node is true.
*   *   when `object`, checks that all keys in test are in node, and that they have (strictly) equal values.
*   *   when `array`, checks if any one of the subtests pass.
* @returns {Check}
*   An assertion.
*/
const convert = (
/**
* @param {Test} [test]
* @returns {Check}
*/
function(test) {
	if (test === null || test === void 0) return ok;
	if (typeof test === "function") return castFactory(test);
	if (typeof test === "object") return Array.isArray(test) ? anyFactory(test) : propertiesFactory(test);
	if (typeof test === "string") return typeFactory(test);
	throw new Error("Expected function, string, or object as test");
});
/**
* @param {Array<Props | TestFunction | string>} tests
* @returns {Check}
*/
function anyFactory(tests) {
	/** @type {Array<Check>} */
	const checks = [];
	let index = -1;
	while (++index < tests.length) checks[index] = convert(tests[index]);
	return castFactory(any);
	/**
	* @this {unknown}
	* @type {TestFunction}
	*/
	function any(...parameters) {
		let index = -1;
		while (++index < checks.length) if (checks[index].apply(this, parameters)) return true;
		return false;
	}
}
/**
* Turn an object into a test for a node with a certain fields.
*
* @param {Props} check
* @returns {Check}
*/
function propertiesFactory(check) {
	const checkAsRecord = check;
	return castFactory(all);
	/**
	* @param {Node} node
	* @returns {boolean}
	*/
	function all(node) {
		const nodeAsRecord = node;
		/** @type {string} */
		let key;
		for (key in check) if (nodeAsRecord[key] !== checkAsRecord[key]) return false;
		return true;
	}
}
/**
* Turn a string into a test for a node with a certain type.
*
* @param {string} check
* @returns {Check}
*/
function typeFactory(check) {
	return castFactory(type);
	/**
	* @param {Node} node
	*/
	function type(node) {
		return node && node.type === check;
	}
}
/**
* Turn a custom test into a test for a node that passes that test.
*
* @param {TestFunction} testFunction
* @returns {Check}
*/
function castFactory(testFunction) {
	return check;
	/**
	* @this {unknown}
	* @type {Check}
	*/
	function check(value, index, parent) {
		return Boolean(looksLikeANode(value) && testFunction.call(this, value, typeof index === "number" ? index : void 0, parent || void 0));
	}
}
function ok() {
	return true;
}
/**
* @param {unknown} value
* @returns {value is Node}
*/
function looksLikeANode(value) {
	return value !== null && typeof value === "object" && "type" in value;
}
/**
* Color a string.
*
* @param {string} d
*   Value.
* @returns {string}
*   Colored value.
*/
function color$1(d) {
	return "\x1B[33m" + d + "\x1B[39m";
}
/**
* @import {Node as UnistNode, Parent as UnistParent} from 'unist'
*/
/**
* @typedef {Exclude<import('unist-util-is').Test, undefined> | undefined} Test
*   Test from `unist-util-is`.
*
*   Note: we have remove and add `undefined`, because otherwise when generating
*   automatic `.d.ts` files, TS tries to flatten paths from a local perspective,
*   which doesn’t work when publishing on npm.
*/
/**
* @typedef {(
*   Fn extends (value: any) => value is infer Thing
*   ? Thing
*   : Fallback
* )} Predicate
*   Get the value of a type guard `Fn`.
* @template Fn
*   Value; typically function that is a type guard (such as `(x): x is Y`).
* @template Fallback
*   Value to yield if `Fn` is not a type guard.
*/
/**
* @typedef {(
*   Check extends null | undefined // No test.
*   ? Value
*   : Value extends {type: Check} // String (type) test.
*   ? Value
*   : Value extends Check // Partial test.
*   ? Value
*   : Check extends Function // Function test.
*   ? Predicate<Check, Value> extends Value
*     ? Predicate<Check, Value>
*     : never
*   : never // Some other test?
* )} MatchesOne
*   Check whether a node matches a primitive check in the type system.
* @template Value
*   Value; typically unist `Node`.
* @template Check
*   Value; typically `unist-util-is`-compatible test, but not arrays.
*/
/**
* @typedef {(
*   Check extends ReadonlyArray<infer T>
*   ? MatchesOne<Value, T>
*   : Check extends Array<infer T>
*   ? MatchesOne<Value, T>
*   : MatchesOne<Value, Check>
* )} Matches
*   Check whether a node matches a check in the type system.
* @template Value
*   Value; typically unist `Node`.
* @template Check
*   Value; typically `unist-util-is`-compatible test.
*/
/**
* @typedef {0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10} Uint
*   Number; capped reasonably.
*/
/**
* @typedef {I extends 0 ? 1 : I extends 1 ? 2 : I extends 2 ? 3 : I extends 3 ? 4 : I extends 4 ? 5 : I extends 5 ? 6 : I extends 6 ? 7 : I extends 7 ? 8 : I extends 8 ? 9 : 10} Increment
*   Increment a number in the type system.
* @template {Uint} [I=0]
*   Index.
*/
/**
* @typedef {(
*   Node extends UnistParent
*   ? Node extends {children: Array<infer Children>}
*     ? Child extends Children ? Node : never
*     : never
*   : never
* )} InternalParent
*   Collect nodes that can be parents of `Child`.
* @template {UnistNode} Node
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
*/
/**
* @typedef {InternalParent<InclusiveDescendant<Tree>, Child>} Parent
*   Collect nodes in `Tree` that can be parents of `Child`.
* @template {UnistNode} Tree
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
*/
/**
* @typedef {(
*   Depth extends Max
*   ? never
*   :
*     | InternalParent<Node, Child>
*     | InternalAncestor<Node, InternalParent<Node, Child>, Max, Increment<Depth>>
* )} InternalAncestor
*   Collect nodes in `Tree` that can be ancestors of `Child`.
* @template {UnistNode} Node
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
* @template {Uint} [Max=10]
*   Max; searches up to this depth.
* @template {Uint} [Depth=0]
*   Current depth.
*/
/**
* @typedef {InternalAncestor<InclusiveDescendant<Tree>, Child>} Ancestor
*   Collect nodes in `Tree` that can be ancestors of `Child`.
* @template {UnistNode} Tree
*   All node types in a tree.
* @template {UnistNode} Child
*   Node to search for.
*/
/**
* @typedef {(
*   Tree extends UnistParent
*     ? Depth extends Max
*       ? Tree
*       : Tree | InclusiveDescendant<Tree['children'][number], Max, Increment<Depth>>
*     : Tree
* )} InclusiveDescendant
*   Collect all (inclusive) descendants of `Tree`.
*
*   > 👉 **Note**: for performance reasons, this seems to be the fastest way to
*   > recurse without actually running into an infinite loop, which the
*   > previous version did.
*   >
*   > Practically, a max of `2` is typically enough assuming a `Root` is
*   > passed, but it doesn’t improve performance.
*   > It gets higher with `List > ListItem > Table > TableRow > TableCell`.
*   > Using up to `10` doesn’t hurt or help either.
* @template {UnistNode} Tree
*   Tree type.
* @template {Uint} [Max=10]
*   Max; searches up to this depth.
* @template {Uint} [Depth=0]
*   Current depth.
*/
/**
* @typedef {'skip' | boolean} Action
*   Union of the action types.
*
* @typedef {number} Index
*   Move to the sibling at `index` next (after node itself is completely
*   traversed).
*
*   Useful if mutating the tree, such as removing the node the visitor is
*   currently on, or any of its previous siblings.
*   Results less than 0 or greater than or equal to `children.length` stop
*   traversing the parent.
*
* @typedef {[(Action | null | undefined | void)?, (Index | null | undefined)?]} ActionTuple
*   List with one or two values, the first an action, the second an index.
*
* @typedef {Action | ActionTuple | Index | null | undefined | void} VisitorResult
*   Any value that can be returned from an enter visitor.
*
*   Like `VisitorResultExit`,
*   but `SKIP` can also be returned,
*   to not walk the children of the node,
*   and `ActionTuple` can be used to combine an action with an index.
*
* @typedef {Index | boolean | null | undefined | void} VisitorResultExit
*   Any value that can be returned from an exit visitor.
*/
/**
* @callback Visitor
*   Handle a node (matching `test`, if given) before its children.
*
*   Changes inside `node` are walked next.
*   Replacing or removing it is easier in `exit`.
*   When replacing or removing it here,
*   return `SKIP` (as otherwise its old children are walked),
*   or `[SKIP, index]` to continue with the node now at `index`.
*   Changing next siblings (in walk order) is fine;
*   changing previous siblings needs a new `Index`.
*   Removing an ancestor or changing its previous siblings is not supported.
* @param {Visited} node
*   Found node.
* @param {Array<VisitedParents>} ancestors
*   Ancestors of `node`.
* @param {number | undefined} index
*   Index of `node` in its parent (the last of `ancestors`),
*   or `undefined` for the tree itself.
* @returns {VisitorResult}
*   What to do next.
*
*   Like `VisitorExit`,
*   but `SKIP` can also be returned,
*   to not walk the children of `node`.
*   Passing a tuple back (`ActionTuple`) only makes sense as `[SKIP, Index]`.
* @template {UnistNode} [Visited=UnistNode]
*   Visited node type.
* @template {UnistParent} [VisitedParents=UnistParent]
*   Ancestor type.
*/
/**
* @callback VisitorExit
*   Handle a node (matching `test`, if given) after its children.
*
*   Changes inside `node` are not walked,
*   which makes this a good place to change `node` based on its children,
*   or to replace or remove it.
*   When removing `node` or changing previous siblings (in walk order),
*   return a new `Index`.
*   Removing an ancestor or changing its previous siblings is not supported.
* @param {Visited} node
*   Found node.
* @param {Array<VisitedParents>} ancestors
*   Ancestors of `node`.
* @param {number | undefined} index
*   Index of `node` in its parent (the last of `ancestors`),
*   or `undefined` for the tree itself.
* @returns {VisitorResultExit}
*   What to do next.
*
*   `CONTINUE` (`true`, nothing) continues as normal,
*   `EXIT` (`false`) stops traversing,
*   and `Index` continues at that sibling.
* @template {UnistNode} [Visited=UnistNode]
*   Visited node type.
* @template {UnistParent} [VisitedParents=UnistParent]
*   Ancestor type.
*/
/**
* @template {UnistNode} [Visited=UnistNode]
*   Visited node type.
* @template {UnistParent} [VisitedParents=UnistParent]
*   Ancestor type.
* @typedef Visitors
*   Handle nodes when entering and exiting them.
*   The `enter` visitor is optional while `exit` is required.
*
*   Pass an `enter` visitor directly to only handle nodes when entering them.
*
*   `enter` is called before children (if any) are walked and `exit` after that.
*   `exit` is still called when `enter` returns `SKIP`.
*   Both `enter` and `exit` are only called for nodes that match an optional `test`.
* @property {Visitor<Visited, VisitedParents> | null | undefined} [enter]
*   Handle a node before its children (optional).
* @property {VisitorExit<Visited, VisitedParents>} exit
*   Handle a node after its children.
*/
/**
* @typedef {Visitor<Matches<InclusiveDescendant<Tree>, Check>, Ancestor<Tree, Matches<InclusiveDescendant<Tree>, Check>>>} BuildVisitor
*   Build a typed `Visitor` function from a tree and a test.
*
*   It will infer which values are passed as `node` and which as `parents`.
* @template {UnistNode} [Tree=UnistNode]
*   Tree type.
* @template {Test} [Check=Test]
*   Test type.
*/
/**
* @typedef {Visitors<Matches<InclusiveDescendant<Tree>, Check>, Ancestor<Tree, Matches<InclusiveDescendant<Tree>, Check>>>} BuildVisitors
*   Build typed `Visitors` from a tree and a test.
*
*   It will infer which values are passed as `node` and which as `parents`.
* @template {UnistNode} [Tree=UnistNode]
*   Tree type.
* @template {Test} [Check=Test]
*   Test type.
*/
/** @type {Readonly<ActionTuple>} */
const empty = [];
/**
* Do not traverse this node’s children.
* Only works when entering a node.
*/
const SKIP = "skip";
/**
* Visit nodes, with ancestral information.
*
* This algorithm performs *depth-first* *tree traversal* in *preorder*
* (**NLR**) or if `reverse` is given,
* in *reverse preorder* (**NRL**).
* An `exit` visitor is called in *postorder* (**LRN**)
* or if `reverse` is given, in *reverse postorder* (**RLN**).
*
* You can choose which nodes are visited by passing a `test`.
* For complex tests, you should test yourself in a visitor, as it will be
* faster and will have improved type information.
*
* Walking the tree is an intensive task.
* Make use of the return values of the visitor when possible.
* Instead of walking a tree multiple times, walk it once, use `unist-util-is`
* to check if a node matches, and then perform different operations.
*
* You can change the tree.
* Changes inside a node made when entering it are walked,
* changes made when exiting it are not.
* See `Visitor` and `VisitorExit` for more info.
*
* @overload
* @param {Tree} tree
*   Tree to traverse.
* @param {Check} check
*   `unist-util-is`-compatible test.
* @param {BuildVisitor<Tree, Check>} enter
*   Handle each node when entering it.
* @param {boolean | null | undefined} [reverse]
*   Walk children from last to first;
*   for `enter`, reverse preorder (NRL) instead of preorder (NLR);
*   for `exit`, reverse postorder (RLN) instead of postorder (LRN).
* @returns {undefined}
*   Nothing.
*
* @overload
* @param {Tree} tree
*   Tree to traverse.
* @param {Check} check
*   `unist-util-is`-compatible test.
* @param {BuildVisitors<Tree, Check>} visitors
*   Handle each node when exiting it, and optionally when entering it.
* @param {boolean | null | undefined} [reverse]
*   Walk children from last to first;
*   for `enter`, reverse preorder (NRL) instead of preorder (NLR);
*   for `exit`, reverse postorder (RLN) instead of postorder (LRN).
* @returns {undefined}
*   Nothing.
*
* @overload
* @param {Tree} tree
*   Tree to traverse.
* @param {BuildVisitor<Tree>} enter
*   Handle each node when entering it.
* @param {boolean | null | undefined} [reverse]
*   Walk children from last to first;
*   for `enter`, reverse preorder (NRL) instead of preorder (NLR);
*   for `exit`, reverse postorder (RLN) instead of postorder (LRN).
* @returns {undefined}
*   Nothing.
*
* @overload
* @param {Tree} tree
*   Tree to traverse.
* @param {BuildVisitors<Tree>} visitors
*   Handle each node when exiting it, and optionally when entering it.
* @param {boolean | null | undefined} [reverse]
*   Walk children from last to first;
*   for `enter`, reverse preorder (NRL) instead of preorder (NLR);
*   for `exit`, reverse postorder (RLN) instead of postorder (LRN).
* @returns {undefined}
*   Nothing.
*
* @param {UnistNode} tree
*   Tree to traverse.
* @param {Visitor | Visitors | Test} testOrEnterOrVisitors
*   `unist-util-is`-compatible test, `enter`, or `visitors`.
* @param {Visitor | Visitors | boolean | null | undefined} [enterOrVisitorsOrReverse]
*   `enter`, `visitors`, or `reverse` after a test.
* @param {boolean | null | undefined} [reverse]
*   Walk children from last to first;
*   for `enter`, reverse preorder (NRL) instead of preorder (NLR);
*   for `exit`, reverse postorder (RLN) instead of postorder (LRN).
* @returns {undefined}
*   Nothing.
*
* @template {UnistNode} Tree
*   Node type.
* @template {Test} Check
*   `unist-util-is`-compatible test.
*/
function visitParents(tree, testOrEnterOrVisitors, enterOrVisitorsOrReverse, reverse) {
	if (!tree || typeof tree !== "object") throw new Error("Unexpected value `" + tree + "` for `tree`, expected node");
	let preorder = true;
	/** @type {Test} */
	let check;
	/** @type {Visitors | Visitor} */
	let visitors;
	/** @type {Visitor | null | undefined} */
	let enter;
	/** @type {VisitorExit | null | undefined} */
	let exit;
	if (typeof enterOrVisitorsOrReverse === "function" || enterOrVisitorsOrReverse && typeof enterOrVisitorsOrReverse === "object") {
		check = testOrEnterOrVisitors;
		visitors = enterOrVisitorsOrReverse;
		if (reverse) preorder = false;
	} else {
		visitors = testOrEnterOrVisitors;
		if (enterOrVisitorsOrReverse) preorder = false;
	}
	if (typeof visitors === "function") enter = visitors;
	else if (visitors && typeof visitors === "object") {
		if (visitors.enter === null || visitors.enter === void 0) {} else if (typeof visitors.enter === "function") enter = visitors.enter;
		else throw new Error("Unexpected value `" + visitors.enter + "` for `visitors.enter`, expected optional visitor");
		if (typeof visitors.exit === "function") exit = visitors.exit;
		else throw new Error("Unexpected value `" + visitors.exit + "` for `visitors.exit`, expected visitor (pass a visitor directly if you only want an enter visitor)");
	} else throw new Error("Unexpected value `" + visitors + "` for `enter` or `visitors`, expected visitor or object with visitors");
	const is = convert(check);
	const step = preorder ? 1 : -1;
	factory(tree, void 0, [])();
	/**
	* Create a function to visit a node.
	*
	* @param {UnistNode} node
	*   Node to visit.
	* @param {number | undefined} index
	*   Index of `node` in its parent.
	* @param {Array<UnistParent>} parents
	*   Ancestors of `node`.
	* @returns {() => Readonly<ActionTuple>}
	*   Visit `node`.
	*/
	function factory(node, index, parents) {
		const value = node && typeof node === "object" ? node : {};
		if (typeof value.type === "string") {
			const name = typeof value.tagName === "string" ? value.tagName : typeof value.name === "string" ? value.name : void 0;
			Object.defineProperty(visit, "name", { value: "node (" + color$1(node.type + (name ? "<" + name + ">" : "")) + ")" });
		}
		return visit;
		function visit() {
			const matches = !check || is(node, index, parents[parents.length - 1] || void 0);
			/** @type {Readonly<ActionTuple>} */
			let result = empty;
			if (enter && matches) {
				result = toResult(enter(node, parents, index));
				if (result[0] === false) return result;
			}
			if ("children" in node && node.children) {
				const nodeAsParent = node;
				if (nodeAsParent.children && result[0] !== "skip") {
					let offset = (preorder ? -1 : nodeAsParent.children.length) + step;
					const grandparents = [...parents, nodeAsParent];
					while (offset > -1 && offset < nodeAsParent.children.length) {
						const child = nodeAsParent.children[offset];
						const subresult = factory(child, offset, grandparents)();
						if (subresult[0] === false) return subresult;
						offset = typeof subresult[1] === "number" ? subresult[1] : offset + step;
					}
				}
			}
			if (exit && matches) {
				const exitResult = toResult(exit(node, parents, index));
				if (exitResult[0] === "skip") throw new Error("Unexpected value `" + exitResult[0] + "` from `exit`, expected `CONTINUE`, `EXIT`, index, or nothing");
				if (exitResult[0] === false || typeof exitResult[1] === "number") return exitResult;
			}
			return result;
		}
	}
}
/**
* Turn a return value into a clean result.
*
* @param {VisitorResult} value
*   Valid return values from visitors.
* @returns {Readonly<ActionTuple>}
*   Clean result.
*/
function toResult(value) {
	if (Array.isArray(value)) return value;
	if (typeof value === "number") return [true, value];
	return value === null || value === void 0 ? empty : [value];
}
/**
* @import {Nodes, Parents, PhrasingContent, Root, Text} from 'mdast'
* @import {BuildVisitor, Test, VisitorResult} from 'unist-util-visit-parents'
*/
/**
* @typedef RegExpMatchObject
*   Info on the match.
* @property {number} index
*   The index of the search at which the result was found.
* @property {string} input
*   A copy of the search string in the text node.
* @property {[...Array<Parents>, Text]} stack
*   All ancestors of the text node, where the last node is the text itself.
*
* @typedef {RegExp | string} Find
*   Pattern to find.
*
*   Strings are escaped and then turned into global expressions.
*
* @typedef {Array<FindAndReplaceTuple>} FindAndReplaceList
*   Several find and replaces, in array form.
*
* @typedef {[Find, Replace?]} FindAndReplaceTuple
*   Find and replace in tuple form.
*
* @typedef {ReplaceFunction | string | null | undefined} Replace
*   Thing to replace with.
*
* @callback ReplaceFunction
*   Callback called when a search matches.
* @param {...any} parameters
*   The parameters are the result of corresponding search expression:
*
*   * `value` (`string`) — whole match
*   * `...capture` (`Array<string>`) — matches from regex capture groups
*   * `match` (`RegExpMatchObject`) — info on the match
* @returns {Array<PhrasingContent> | PhrasingContent | string | false | null | undefined}
*   Thing to replace with.
*
*   * when `null`, `undefined`, `''`, remove the match
*   * …or when `false`, do not replace at all
*   * …or when `string`, replace with a text node of that value
*   * …or when `Node` or `Array<Node>`, replace with those nodes
*
* @typedef {[RegExp, ReplaceFunction]} Pair
*   Normalized find and replace.
*
* @typedef {Array<Pair>} Pairs
*   All find and replaced.
*
* @typedef Options
*   Configuration.
* @property {Test | null | undefined} [ignore]
*   Test for which nodes to ignore (optional).
*/
/**
* Find patterns in a tree and replace them.
*
* The algorithm searches the tree in *preorder* for complete values in `Text`
* nodes.
* Partial matches are not supported.
*
* @param {Nodes} tree
*   Tree to change.
* @param {FindAndReplaceList | FindAndReplaceTuple} list
*   Patterns to find.
* @param {Options | null | undefined} [options]
*   Configuration (optional).
* @returns {undefined}
*   Nothing.
*/
function findAndReplace(tree, list, options) {
	const ignored = convert((options || {}).ignore || []);
	const pairs = toPairs(list);
	let pairIndex = -1;
	while (++pairIndex < pairs.length) visitParents(tree, visitor);
	/**
	* Handle text nodes and skip ignored nodes.
	*
	* @type {BuildVisitor<Root>}
	*/
	function visitor(node, parents, index) {
		if (node.type === "text" && typeof index === "number") return handler(node, parents, index);
		if (ignored(node, index, parents[parents.length - 1])) return SKIP;
	}
	/**
	* Handle a text node which is not in an ignored parent.
	*
	* @param {Text} node
	*   Text node to search in.
	* @param {Array<Parents>} parents
	*   Ancestors of `node`.
	* @param {number} index
	*   Index of `node` in its parent.
	* @returns {VisitorResult}
	*   Where to continue visiting.
	*/
	function handler(node, parents, index) {
		const parent = parents[parents.length - 1];
		const find = pairs[pairIndex][0];
		const replace = pairs[pairIndex][1];
		let start = 0;
		let change = false;
		/** @type {Array<PhrasingContent>} */
		let nodes = [];
		find.lastIndex = 0;
		let match = find.exec(node.value);
		while (match) {
			const position = match.index;
			/** @type {RegExpMatchObject} */
			const matchObject = {
				index: match.index,
				input: match.input,
				stack: [...parents, node]
			};
			let value = replace(...match, matchObject);
			if (typeof value === "string") value = value.length > 0 ? {
				type: "text",
				value
			} : void 0;
			if (value === false) find.lastIndex = position + 1;
			else {
				if (start !== position) add({
					type: "text",
					value: node.value.slice(start, position)
				});
				if (Array.isArray(value)) for (const child of value) add(child);
				else if (value) add(value);
				start = position + match[0].length;
				change = true;
			}
			if (!find.global) break;
			match = find.exec(node.value);
		}
		if (change) {
			if (start < node.value.length) add({
				type: "text",
				value: node.value.slice(start)
			});
			parent.children.splice(index, 1, ...nodes);
		} else nodes = [node];
		return index + nodes.length;
		/**
		* Add a node.
		*
		* @param {PhrasingContent} child
		*   Node to add.
		* @returns {undefined}
		*   Nothing.
		*/
		function add(child) {
			const previous = nodes[nodes.length - 1];
			if (previous && previous.type === "text" && child.type === "text") previous.value += child.value;
			else nodes.push(child);
		}
	}
}
/**
* Turn a tuple or a list of tuples into pairs.
*
* @param {FindAndReplaceList | FindAndReplaceTuple} tupleOrList
*   Schema.
* @returns {Pairs}
*   Clean pairs.
*/
function toPairs(tupleOrList) {
	if (!Array.isArray(tupleOrList)) throw new TypeError("Expected find and replace tuple or list of tuples");
	/** @type {Pairs} */
	const result = [];
	const list = !tupleOrList[0] || Array.isArray(tupleOrList[0]) ? tupleOrList : [tupleOrList];
	let index = -1;
	while (++index < list.length) {
		const tuple = list[index];
		result.push([toExpression(tuple[0]), toFunction(tuple[1])]);
	}
	return result;
}
/**
* Turn a find into an expression.
*
* @param {Find} find
*   Pattern to find.
* @returns {RegExp}
*   Global expression.
*/
function toExpression(find) {
	return typeof find === "string" ? new RegExp(escapeStringRegexp(find), "g") : find;
}
/**
* Turn a replace into a function.
*
* @param {Replace} replace
*   Thing to replace with.
* @returns {ReplaceFunction}
*   Function that returns that thing.
*/
function toFunction(replace) {
	return typeof replace === "function" ? replace : function() {
		return replace;
	};
}
/**
* @import {RegExpMatchObject, ReplaceFunction} from 'mdast-util-find-and-replace'
* @import {CompileContext, Extension as FromMarkdownExtension, Handle as FromMarkdownHandle, Transform as FromMarkdownTransform} from 'mdast-util-from-markdown'
* @import {ConstructName, Options as ToMarkdownExtension} from 'mdast-util-to-markdown'
* @import {Link, PhrasingContent} from 'mdast'
*/
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM autolink
* literals in markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-to-markdown` to enable GFM autolink literals.
*/
function gfmAutolinkLiteralFromMarkdown() {
	return {
		transforms: [transformGfmAutolinkLiterals],
		enter: {
			literalAutolink: enterLiteralAutolink,
			literalAutolinkEmail: enterLiteralAutolinkValue,
			literalAutolinkHttp: enterLiteralAutolinkValue,
			literalAutolinkWww: enterLiteralAutolinkValue
		},
		exit: {
			literalAutolink: exitLiteralAutolink,
			literalAutolinkEmail: exitLiteralAutolinkEmail,
			literalAutolinkHttp: exitLiteralAutolinkHttp,
			literalAutolinkWww: exitLiteralAutolinkWww
		}
	};
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterLiteralAutolink(token) {
	this.enter({
		type: "link",
		title: null,
		url: "",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterLiteralAutolinkValue(token) {
	this.config.enter.autolinkProtocol.call(this, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitLiteralAutolinkHttp(token) {
	this.config.exit.autolinkProtocol.call(this, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitLiteralAutolinkWww(token) {
	this.config.exit.data.call(this, token);
	const node = this.stack[this.stack.length - 1];
	node.type;
	node.url = "http://" + this.sliceSerialize(token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitLiteralAutolinkEmail(token) {
	this.config.exit.autolinkEmail.call(this, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitLiteralAutolink(token) {
	this.exit(token);
}
/** @type {FromMarkdownTransform} */
function transformGfmAutolinkLiterals(tree) {
	findAndReplace(tree, [[/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, findUrl], [/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu, findEmail]], { ignore: ["link", "linkReference"] });
}
/**
* @type {ReplaceFunction}
* @param {string} _
* @param {string} protocol
* @param {string} domain
* @param {string} path
* @param {RegExpMatchObject} match
* @returns {Array<PhrasingContent> | Link | false}
*/
function findUrl(_, protocol, domain, path, match) {
	let prefix = "";
	if (!previous$1(match)) return false;
	if (/^w/i.test(protocol)) {
		domain = protocol + domain;
		protocol = "";
		prefix = "http://";
	}
	if (!isCorrectDomain(domain)) return false;
	const parts = splitUrl(domain + path);
	if (!parts[0]) return false;
	/** @type {Link} */
	const result = {
		type: "link",
		title: null,
		url: prefix + protocol + parts[0],
		children: [{
			type: "text",
			value: protocol + parts[0]
		}]
	};
	if (parts[1]) return [result, {
		type: "text",
		value: parts[1]
	}];
	return result;
}
/**
* @type {ReplaceFunction}
* @param {string} _
* @param {string} atext
* @param {string} label
* @param {RegExpMatchObject} match
* @returns {Link | false}
*/
function findEmail(_, atext, label, match) {
	if (!previous$1(match, true) || /[-\d_]$/.test(label)) return false;
	return {
		type: "link",
		title: null,
		url: "mailto:" + atext + "@" + label,
		children: [{
			type: "text",
			value: atext + "@" + label
		}]
	};
}
/**
* @param {string} domain
* @returns {boolean}
*/
function isCorrectDomain(domain) {
	const parts = domain.split(".");
	if (parts.length < 2 || parts[parts.length - 1] && (/_/.test(parts[parts.length - 1]) || !/[a-zA-Z\d]/.test(parts[parts.length - 1])) || parts[parts.length - 2] && (/_/.test(parts[parts.length - 2]) || !/[a-zA-Z\d]/.test(parts[parts.length - 2]))) return false;
	return true;
}
/**
* @param {string} url
* @returns {[string, string | undefined]}
*/
function splitUrl(url) {
	const trailExec = /[!"&'),.:;<>?\]}]+$/.exec(url);
	if (!trailExec) return [url, void 0];
	url = url.slice(0, trailExec.index);
	let trail = trailExec[0];
	let closingParenIndex = trail.indexOf(")");
	const openingParens = ccount(url, "(");
	let closingParens = ccount(url, ")");
	while (closingParenIndex !== -1 && openingParens > closingParens) {
		url += trail.slice(0, closingParenIndex + 1);
		trail = trail.slice(closingParenIndex + 1);
		closingParenIndex = trail.indexOf(")");
		closingParens++;
	}
	return [url, trail];
}
/**
* @param {RegExpMatchObject} match
* @param {boolean | null | undefined} [email=false]
* @returns {boolean}
*/
function previous$1(match, email) {
	const code = match.input.charCodeAt(match.index - 1);
	return (match.index === 0 || unicodeWhitespace(code) || unicodePunctuation(code)) && (!email || code !== 47);
}
/**
* @import {
*   CompileContext,
*   Extension as FromMarkdownExtension,
*   Handle as FromMarkdownHandle
* } from 'mdast-util-from-markdown'
* @import {ToMarkdownOptions} from 'mdast-util-gfm-footnote'
* @import {
*   Handle as ToMarkdownHandle,
*   Map,
*   Options as ToMarkdownExtension
* } from 'mdast-util-to-markdown'
* @import {FootnoteDefinition, FootnoteReference} from 'mdast'
*/
footnoteReference.peek = footnoteReferencePeek;
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterFootnoteCallString() {
	this.buffer();
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterFootnoteCall(token) {
	this.enter({
		type: "footnoteReference",
		identifier: "",
		label: ""
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterFootnoteDefinitionLabelString() {
	this.buffer();
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterFootnoteDefinition(token) {
	this.enter({
		type: "footnoteDefinition",
		identifier: "",
		label: "",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitFootnoteCallString(token) {
	const label = this.resume();
	const node = this.stack[this.stack.length - 1];
	node.type;
	node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
	node.label = label;
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitFootnoteCall(token) {
	this.exit(token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitFootnoteDefinitionLabelString(token) {
	const label = this.resume();
	const node = this.stack[this.stack.length - 1];
	node.type;
	node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
	node.label = label;
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitFootnoteDefinition(token) {
	this.exit(token);
}
/** @type {ToMarkdownHandle} */
function footnoteReferencePeek() {
	return "[";
}
/**
* @type {ToMarkdownHandle}
* @param {FootnoteReference} node
*/
function footnoteReference(node, _, state, info) {
	const tracker = state.createTracker(info);
	let value = tracker.move("[^");
	const exit = state.enter("footnoteReference");
	const subexit = state.enter("reference");
	value += tracker.move(state.safe(state.associationId(node), {
		after: "]",
		before: value
	}));
	subexit();
	exit();
	value += tracker.move("]");
	return value;
}
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM footnotes
* in markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown`.
*/
function gfmFootnoteFromMarkdown() {
	return {
		enter: {
			gfmFootnoteCallString: enterFootnoteCallString,
			gfmFootnoteCall: enterFootnoteCall,
			gfmFootnoteDefinitionLabelString: enterFootnoteDefinitionLabelString,
			gfmFootnoteDefinition: enterFootnoteDefinition
		},
		exit: {
			gfmFootnoteCallString: exitFootnoteCallString,
			gfmFootnoteCall: exitFootnoteCall,
			gfmFootnoteDefinitionLabelString: exitFootnoteDefinitionLabelString,
			gfmFootnoteDefinition: exitFootnoteDefinition
		}
	};
}
handleDelete.attention = attentionDelete;
handleDelete.peek = peekDelete;
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM
* strikethrough in markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown` to enable GFM strikethrough.
*/
function gfmStrikethroughFromMarkdown() {
	return {
		canContainEols: ["delete"],
		enter: { strikethrough: enterStrikethrough },
		exit: { strikethrough: exitStrikethrough }
	};
}
/**
* Enter strikethrough.
*
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterStrikethrough(token) {
	this.enter({
		type: "delete",
		children: [],
		position: void 0
	}, token);
}
/**
* Exit strikethrough.
*
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitStrikethrough(token) {
	this.exit(token);
}
/**
* Serialize a delete node.
*
* @type {ToMarkdownHandle}
* @param {Delete} node
*   Node to serialize.
*/
function handleDelete(node, _, state, info) {
	const tracker = state.createTracker(info);
	const sequence = state.stack.includes("strikethrough") ? "~" : "~~";
	const exit = state.enter("strikethrough");
	let value = tracker.move(sequence);
	value += state.containerPhrasing(node, {
		...tracker.current(),
		before: value,
		after: "~"
	});
	value += tracker.move(sequence);
	exit();
	return value;
}
/**
* Serialize a delete node as attention.
*
* @type {Attention}
*/
function attentionDelete() {
	return {
		construct: "strikethrough",
		markers: ["~"],
		sizes: [2, 1]
	};
}
/**
* Peek the first character of a delete node.
*
* @type {ToMarkdownHandle}
*/
function peekDelete() {
	return "~";
}
/**
* @typedef {import('mdast').InlineCode} InlineCode
* @typedef {import('mdast').Table} Table
* @typedef {import('mdast').TableCell} TableCell
* @typedef {import('mdast').TableRow} TableRow
*
* @typedef {import('markdown-table').Options} MarkdownTableOptions
*
* @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
* @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
* @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
*
* @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
* @typedef {import('mdast-util-to-markdown').Handle} ToMarkdownHandle
* @typedef {import('mdast-util-to-markdown').State} State
* @typedef {import('mdast-util-to-markdown').Info} Info
*/
/**
* @typedef Options
*   Configuration.
* @property {boolean | null | undefined} [tableCellPadding=true]
*   Whether to add a space of padding between delimiters and cells (default:
*   `true`).
* @property {boolean | null | undefined} [tablePipeAlign=true]
*   Whether to align the delimiters (default: `true`).
* @property {MarkdownTableOptions['stringLength'] | null | undefined} [stringLength]
*   Function to detect the length of table cell content, used when aligning
*   the delimiters between cells (optional).
*/
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM tables in
* markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown` to enable GFM tables.
*/
function gfmTableFromMarkdown() {
	return {
		enter: {
			table: enterTable,
			tableData: enterCell,
			tableHeader: enterCell,
			tableRow: enterRow
		},
		exit: {
			codeText: exitCodeText,
			table: exitTable,
			tableData: exit,
			tableHeader: exit,
			tableRow: exit
		}
	};
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterTable(token) {
	const align = token._align;
	this.enter({
		type: "table",
		align: align.map(function(d) {
			return d === "none" ? null : d;
		}),
		children: []
	}, token);
	this.data.inTable = true;
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitTable(token) {
	this.exit(token);
	this.data.inTable = void 0;
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterRow(token) {
	this.enter({
		type: "tableRow",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exit(token) {
	this.exit(token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function enterCell(token) {
	this.enter({
		type: "tableCell",
		children: []
	}, token);
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitCodeText(token) {
	let value = this.resume();
	if (this.data.inTable) value = value.replace(/\\([\\|])/g, replace);
	const node = this.stack[this.stack.length - 1];
	node.type;
	node.value = value;
	this.exit(token);
}
/**
* @param {string} $0
* @param {string} $1
* @returns {string}
*/
function replace($0, $1) {
	return $1 === "|" ? $1 : $0;
}
/**
* @typedef {import('mdast').ListItem} ListItem
* @typedef {import('mdast').Paragraph} Paragraph
* @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
* @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
* @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
* @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
* @typedef {import('mdast-util-to-markdown').Handle} ToMarkdownHandle
*/
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM task
* list items in markdown.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown` to enable GFM task list items.
*/
function gfmTaskListItemFromMarkdown() {
	return { exit: {
		taskListCheckValueChecked: exitCheck,
		taskListCheckValueUnchecked: exitCheck,
		paragraph: exitParagraphWithTaskListItem
	} };
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitCheck(token) {
	const node = this.stack[this.stack.length - 2];
	node.type;
	node.checked = token.type === "taskListCheckValueChecked";
}
/**
* @this {CompileContext}
* @type {FromMarkdownHandle}
*/
function exitParagraphWithTaskListItem(token) {
	const parent = this.stack[this.stack.length - 2];
	if (parent && parent.type === "listItem" && typeof parent.checked === "boolean") {
		const node = this.stack[this.stack.length - 1];
		node.type;
		const head = node.children[0];
		if (head && head.type === "text") {
			const siblings = parent.children;
			let index = -1;
			/** @type {Paragraph | undefined} */
			let firstParaghraph;
			while (++index < siblings.length) {
				const sibling = siblings[index];
				if (sibling.type === "paragraph") {
					firstParaghraph = sibling;
					break;
				}
			}
			if (firstParaghraph === node) {
				head.value = head.value.slice(1);
				if (head.value.length === 0) node.children.shift();
				else if (node.position && head.position && typeof head.position.start.offset === "number") {
					head.position.start.column++;
					head.position.start.offset++;
					node.position.start = Object.assign({}, head.position.start);
				}
			}
		}
	}
	this.exit(token);
}
/**
* @import {Extension as FromMarkdownExtension} from 'mdast-util-from-markdown'
* @import {Options} from 'mdast-util-gfm'
* @import {Options as ToMarkdownExtension} from 'mdast-util-to-markdown'
*/
/**
* Create an extension for `mdast-util-from-markdown` to enable GFM (autolink
* literals, footnotes, strikethrough, tables, tasklists).
*
* @returns {Array<FromMarkdownExtension>}
*   Extension for `mdast-util-from-markdown` to enable GFM (autolink literals,
*   footnotes, strikethrough, tables, tasklists).
*/
function gfmFromMarkdown() {
	return [
		gfmAutolinkLiteralFromMarkdown(),
		gfmFootnoteFromMarkdown(),
		gfmStrikethroughFromMarkdown(),
		gfmTableFromMarkdown(),
		gfmTaskListItemFromMarkdown()
	];
}
/**
* @typedef {import('hast').Element} HastElement
* @typedef {import('hast').ElementContent} HastElementContent
* @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
* @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
* @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
* @typedef {import('mdast-util-to-markdown').Handle} ToMarkdownHandle
* @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
* @typedef {import('../index.js').InlineMath} InlineMath
* @typedef {import('../index.js').Math} Math
*
* @typedef ToOptions
*   Configuration.
* @property {boolean | null | undefined} [singleDollarTextMath=true]
*   Whether to support math (text) with a single dollar (default: `true`).
*
*   Single dollars work in Pandoc and many other places, but often interfere
*   with “normal” dollars in text.
*   If you turn this off, you can still use two or more dollars for text math.
*/
/**
* Create an extension for `mdast-util-from-markdown`.
*
* @returns {FromMarkdownExtension}
*   Extension for `mdast-util-from-markdown`.
*/
function mathFromMarkdown() {
	return {
		enter: {
			mathFlow: enterMathFlow,
			mathFlowFenceMeta: enterMathFlowMeta,
			mathText: enterMathText
		},
		exit: {
			mathFlow: exitMathFlow,
			mathFlowFence: exitMathFlowFence,
			mathFlowFenceMeta: exitMathFlowMeta,
			mathFlowValue: exitMathData,
			mathText: exitMathText,
			mathTextData: exitMathData
		}
	};
	/**
	* @this {CompileContext}
	* @type {FromMarkdownHandle}
	*/
	function enterMathFlow(token) {
		this.enter({
			type: "math",
			meta: null,
			value: "",
			data: {
				hName: "pre",
				hChildren: [{
					type: "element",
					tagName: "code",
					properties: { className: ["language-math", "math-display"] },
					children: []
				}]
			}
		}, token);
	}
	/**
	* @this {CompileContext}
	* @type {FromMarkdownHandle}
	*/
	function enterMathFlowMeta() {
		this.buffer();
	}
	/**
	* @this {CompileContext}
	* @type {FromMarkdownHandle}
	*/
	function exitMathFlowMeta() {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.type;
		node.meta = data;
	}
	/**
	* @this {CompileContext}
	* @type {FromMarkdownHandle}
	*/
	function exitMathFlowFence() {
		if (this.data.mathFlowInside) return;
		this.buffer();
		this.data.mathFlowInside = true;
	}
	/**
	* @this {CompileContext}
	* @type {FromMarkdownHandle}
	*/
	function exitMathFlow(token) {
		const data = this.resume().replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
		const node = this.stack[this.stack.length - 1];
		node.type;
		this.exit(token);
		node.value = data;
		const code = node.data.hChildren[0];
		code.type;
		code.tagName;
		code.children.push({
			type: "text",
			value: data
		});
		this.data.mathFlowInside = void 0;
	}
	/**
	* @this {CompileContext}
	* @type {FromMarkdownHandle}
	*/
	function enterMathText(token) {
		this.enter({
			type: "inlineMath",
			value: "",
			data: {
				hName: "code",
				hProperties: { className: ["language-math", "math-inline"] },
				hChildren: []
			}
		}, token);
		this.buffer();
	}
	/**
	* @this {CompileContext}
	* @type {FromMarkdownHandle}
	*/
	function exitMathText(token) {
		const data = this.resume();
		const node = this.stack[this.stack.length - 1];
		node.type;
		this.exit(token);
		node.value = data;
		node.data.hChildren.push({
			type: "text",
			value: data
		});
	}
	/**
	* @this {CompileContext}
	* @type {FromMarkdownHandle}
	*/
	function exitMathData(token) {
		this.config.enter.data.call(this, token);
		this.config.exit.data.call(this, token);
	}
}
/**
* @import {Code, ConstructRecord, Event, Extension, Previous, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
const wwwPrefix = {
	tokenize: tokenizeWwwPrefix,
	partial: true
};
const domain = {
	tokenize: tokenizeDomain,
	partial: true
};
const path = {
	tokenize: tokenizePath,
	partial: true
};
const trail = {
	tokenize: tokenizeTrail,
	partial: true
};
const emailDomainDotTrail = {
	tokenize: tokenizeEmailDomainDotTrail,
	partial: true
};
const wwwAutolink = {
	name: "wwwAutolink",
	tokenize: tokenizeWwwAutolink,
	previous: previousWww
};
const protocolAutolink = {
	name: "protocolAutolink",
	tokenize: tokenizeProtocolAutolink,
	previous: previousProtocol
};
const emailAutolink = {
	name: "emailAutolink",
	tokenize: tokenizeEmailAutolink,
	previous: previousEmail
};
/** @type {ConstructRecord} */
const text = {};
/**
* Create an extension for `micromark` to support GitHub autolink literal
* syntax.
*
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions` to enable GFM
*   autolink literal syntax.
*/
function gfmAutolinkLiteral() {
	return { text };
}
/** @type {Code} */
let code = 48;
while (code < 123) {
	text[code] = emailAutolink;
	code++;
	if (code === 58) code = 65;
	else if (code === 91) code = 97;
}
text[43] = emailAutolink;
text[45] = emailAutolink;
text[46] = emailAutolink;
text[95] = emailAutolink;
text[72] = [emailAutolink, protocolAutolink];
text[104] = [emailAutolink, protocolAutolink];
text[87] = [emailAutolink, wwwAutolink];
text[119] = [emailAutolink, wwwAutolink];
/**
* Email autolink literal.
*
* ```markdown
* > | a contact@example.org b
*       ^^^^^^^^^^^^^^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeEmailAutolink(effects, ok, nok) {
	const self = this;
	/** @type {boolean | undefined} */
	let dot;
	/** @type {boolean} */
	let data;
	return start;
	/**
	* Start of email autolink literal.
	*
	* ```markdown
	* > | a contact@example.org b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		if (!gfmAtext(code) || !previousEmail.call(self, self.previous) || previousUnbalanced(self.events)) return nok(code);
		effects.enter("literalAutolink");
		effects.enter("literalAutolinkEmail");
		return atext(code);
	}
	/**
	* In email atext.
	*
	* ```markdown
	* > | a contact@example.org b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function atext(code) {
		if (gfmAtext(code)) {
			effects.consume(code);
			return atext;
		}
		if (code === 64) {
			effects.consume(code);
			return emailDomain;
		}
		return nok(code);
	}
	/**
	* In email domain.
	*
	* The reference code is a bit overly complex as it handles the `@`, of which
	* there may be just one.
	* Source: <https://github.com/github/cmark-gfm/blob/ef1cfcb/extensions/autolink.c#L318>
	*
	* ```markdown
	* > | a contact@example.org b
	*               ^
	* ```
	*
	* @type {State}
	*/
	function emailDomain(code) {
		if (code === 46) return effects.check(emailDomainDotTrail, emailDomainAfter, emailDomainDot)(code);
		if (code === 45 || code === 95 || asciiAlphanumeric(code)) {
			data = true;
			effects.consume(code);
			return emailDomain;
		}
		return emailDomainAfter(code);
	}
	/**
	* In email domain, on dot that is not a trail.
	*
	* ```markdown
	* > | a contact@example.org b
	*                      ^
	* ```
	*
	* @type {State}
	*/
	function emailDomainDot(code) {
		effects.consume(code);
		dot = true;
		return emailDomain;
	}
	/**
	* After email domain.
	*
	* ```markdown
	* > | a contact@example.org b
	*                          ^
	* ```
	*
	* @type {State}
	*/
	function emailDomainAfter(code) {
		if (data && dot && asciiAlpha(self.previous)) {
			effects.exit("literalAutolinkEmail");
			effects.exit("literalAutolink");
			return ok(code);
		}
		return nok(code);
	}
}
/**
* `www` autolink literal.
*
* ```markdown
* > | a www.example.org b
*       ^^^^^^^^^^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeWwwAutolink(effects, ok, nok) {
	const self = this;
	return wwwStart;
	/**
	* Start of www autolink literal.
	*
	* ```markdown
	* > | www.example.com/a?b#c
	*     ^
	* ```
	*
	* @type {State}
	*/
	function wwwStart(code) {
		if (code !== 87 && code !== 119 || !previousWww.call(self, self.previous) || previousUnbalanced(self.events)) return nok(code);
		effects.enter("literalAutolink");
		effects.enter("literalAutolinkWww");
		return effects.check(wwwPrefix, effects.attempt(domain, effects.attempt(path, wwwAfter), nok), nok)(code);
	}
	/**
	* After a www autolink literal.
	*
	* ```markdown
	* > | www.example.com/a?b#c
	*                          ^
	* ```
	*
	* @type {State}
	*/
	function wwwAfter(code) {
		effects.exit("literalAutolinkWww");
		effects.exit("literalAutolink");
		return ok(code);
	}
}
/**
* Protocol autolink literal.
*
* ```markdown
* > | a https://example.org b
*       ^^^^^^^^^^^^^^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeProtocolAutolink(effects, ok, nok) {
	const self = this;
	let buffer = "";
	let seen = false;
	return protocolStart;
	/**
	* Start of protocol autolink literal.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*     ^
	* ```
	*
	* @type {State}
	*/
	function protocolStart(code) {
		if ((code === 72 || code === 104) && previousProtocol.call(self, self.previous) && !previousUnbalanced(self.events)) {
			effects.enter("literalAutolink");
			effects.enter("literalAutolinkHttp");
			buffer += String.fromCodePoint(code);
			effects.consume(code);
			return protocolPrefixInside;
		}
		return nok(code);
	}
	/**
	* In protocol.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*     ^^^^^
	* ```
	*
	* @type {State}
	*/
	function protocolPrefixInside(code) {
		if (asciiAlpha(code) && buffer.length < 5) {
			buffer += String.fromCodePoint(code);
			effects.consume(code);
			return protocolPrefixInside;
		}
		if (code === 58) {
			const protocol = buffer.toLowerCase();
			if (protocol === "http" || protocol === "https") {
				effects.consume(code);
				return protocolSlashesInside;
			}
		}
		return nok(code);
	}
	/**
	* In slashes.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*           ^^
	* ```
	*
	* @type {State}
	*/
	function protocolSlashesInside(code) {
		if (code === 47) {
			effects.consume(code);
			if (seen) return afterProtocol;
			seen = true;
			return protocolSlashesInside;
		}
		return nok(code);
	}
	/**
	* After protocol, before domain.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*             ^
	* ```
	*
	* @type {State}
	*/
	function afterProtocol(code) {
		return code === null || asciiControl(code) || markdownLineEndingOrSpace(code) || unicodeWhitespace(code) || unicodePunctuation(code) ? nok(code) : effects.attempt(domain, effects.attempt(path, protocolAfter), nok)(code);
	}
	/**
	* After a protocol autolink literal.
	*
	* ```markdown
	* > | https://example.com/a?b#c
	*                              ^
	* ```
	*
	* @type {State}
	*/
	function protocolAfter(code) {
		effects.exit("literalAutolinkHttp");
		effects.exit("literalAutolink");
		return ok(code);
	}
}
/**
* `www` prefix.
*
* ```markdown
* > | a www.example.org b
*       ^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeWwwPrefix(effects, ok, nok) {
	let size = 0;
	return wwwPrefixInside;
	/**
	* In www prefix.
	*
	* ```markdown
	* > | www.example.com
	*     ^^^^
	* ```
	*
	* @type {State}
	*/
	function wwwPrefixInside(code) {
		if ((code === 87 || code === 119) && size < 3) {
			size++;
			effects.consume(code);
			return wwwPrefixInside;
		}
		if (code === 46 && size === 3) {
			effects.consume(code);
			return wwwPrefixAfter;
		}
		return nok(code);
	}
	/**
	* After www prefix.
	*
	* ```markdown
	* > | www.example.com
	*         ^
	* ```
	*
	* @type {State}
	*/
	function wwwPrefixAfter(code) {
		return code === null ? nok(code) : ok(code);
	}
}
/**
* Domain.
*
* ```markdown
* > | a https://example.org b
*               ^^^^^^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeDomain(effects, ok, nok) {
	/** @type {boolean | undefined} */
	let underscoreInLastSegment;
	/** @type {boolean | undefined} */
	let underscoreInLastLastSegment;
	/** @type {boolean | undefined} */
	let seen;
	return domainInside;
	/**
	* In domain.
	*
	* ```markdown
	* > | https://example.com/a
	*             ^^^^^^^^^^^
	* ```
	*
	* @type {State}
	*/
	function domainInside(code) {
		if (code === 46 || code === 95) return effects.check(trail, domainAfter, domainAtPunctuation)(code);
		if (code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code) || code !== 45 && unicodePunctuation(code)) return domainAfter(code);
		seen = true;
		effects.consume(code);
		return domainInside;
	}
	/**
	* In domain, at potential trailing punctuation, that was not trailing.
	*
	* ```markdown
	* > | https://example.com
	*                    ^
	* ```
	*
	* @type {State}
	*/
	function domainAtPunctuation(code) {
		if (code === 95) underscoreInLastSegment = true;
		else {
			underscoreInLastLastSegment = underscoreInLastSegment;
			underscoreInLastSegment = void 0;
		}
		effects.consume(code);
		return domainInside;
	}
	/**
	* After domain.
	*
	* ```markdown
	* > | https://example.com/a
	*                        ^
	* ```
	*
	* @type {State} */
	function domainAfter(code) {
		if (underscoreInLastLastSegment || underscoreInLastSegment || !seen) return nok(code);
		return ok(code);
	}
}
/**
* Path.
*
* ```markdown
* > | a https://example.org/stuff b
*                          ^^^^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizePath(effects, ok) {
	let sizeOpen = 0;
	let sizeClose = 0;
	return pathInside;
	/**
	* In path.
	*
	* ```markdown
	* > | https://example.com/a
	*                        ^^
	* ```
	*
	* @type {State}
	*/
	function pathInside(code) {
		if (code === 40) {
			sizeOpen++;
			effects.consume(code);
			return pathInside;
		}
		if (code === 41 && sizeClose < sizeOpen) return pathAtPunctuation(code);
		if (code === 33 || code === 34 || code === 38 || code === 39 || code === 41 || code === 42 || code === 44 || code === 46 || code === 58 || code === 59 || code === 60 || code === 63 || code === 93 || code === 95 || code === 126) return effects.check(trail, ok, pathAtPunctuation)(code);
		if (code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return ok(code);
		effects.consume(code);
		return pathInside;
	}
	/**
	* In path, at potential trailing punctuation, that was not trailing.
	*
	* ```markdown
	* > | https://example.com/a"b
	*                          ^
	* ```
	*
	* @type {State}
	*/
	function pathAtPunctuation(code) {
		if (code === 41) sizeClose++;
		effects.consume(code);
		return pathInside;
	}
}
/**
* Trail.
*
* This calls `ok` if this *is* the trail, followed by an end, which means
* the entire trail is not part of the link.
* It calls `nok` if this *is* part of the link.
*
* ```markdown
* > | https://example.com").
*                        ^^^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeTrail(effects, ok, nok) {
	return trail;
	/**
	* In trail of domain or path.
	*
	* ```markdown
	* > | https://example.com").
	*                        ^
	* ```
	*
	* @type {State}
	*/
	function trail(code) {
		if (code === 33 || code === 34 || code === 39 || code === 41 || code === 42 || code === 44 || code === 46 || code === 58 || code === 59 || code === 63 || code === 95 || code === 126) {
			effects.consume(code);
			return trail;
		}
		if (code === 38) {
			effects.consume(code);
			return trailCharacterReferenceStart;
		}
		if (code === 93) {
			effects.consume(code);
			return trailBracketAfter;
		}
		if (code === 60 || code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return ok(code);
		return nok(code);
	}
	/**
	* In trail, after `]`.
	*
	* > 👉 **Note**: this deviates from `cmark-gfm` to fix a bug.
	* > See end of <https://github.com/github/cmark-gfm/issues/278> for more.
	*
	* ```markdown
	* > | https://example.com](
	*                         ^
	* ```
	*
	* @type {State}
	*/
	function trailBracketAfter(code) {
		if (code === null || code === 40 || code === 91 || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return ok(code);
		return trail(code);
	}
	/**
	* In character-reference like trail, after `&`.
	*
	* ```markdown
	* > | https://example.com&amp;).
	*                         ^
	* ```
	*
	* @type {State}
	*/
	function trailCharacterReferenceStart(code) {
		return asciiAlpha(code) ? trailCharacterReferenceInside(code) : nok(code);
	}
	/**
	* In character-reference like trail.
	*
	* ```markdown
	* > | https://example.com&amp;).
	*                         ^
	* ```
	*
	* @type {State}
	*/
	function trailCharacterReferenceInside(code) {
		if (code === 59) {
			effects.consume(code);
			return trail;
		}
		if (asciiAlpha(code)) {
			effects.consume(code);
			return trailCharacterReferenceInside;
		}
		return nok(code);
	}
}
/**
* Dot in email domain trail.
*
* This calls `ok` if this *is* the trail, followed by an end, which means
* the trail is not part of the link.
* It calls `nok` if this *is* part of the link.
*
* ```markdown
* > | contact@example.org.
*                        ^
* ```
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeEmailDomainDotTrail(effects, ok, nok) {
	return start;
	/**
	* Dot.
	*
	* ```markdown
	* > | contact@example.org.
	*                    ^   ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.consume(code);
		return after;
	}
	/**
	* After dot.
	*
	* ```markdown
	* > | contact@example.org.
	*                     ^   ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return asciiAlphanumeric(code) ? nok(code) : ok(code);
	}
}
/**
* See:
* <https://github.com/github/cmark-gfm/blob/ef1cfcb/extensions/autolink.c#L156>.
*
* @type {Previous}
*/
function previousWww(code) {
	return code === null || code === 40 || code === 42 || code === 95 || code === 91 || code === 93 || code === 126 || markdownLineEndingOrSpace(code);
}
/**
* See:
* <https://github.com/github/cmark-gfm/blob/ef1cfcb/extensions/autolink.c#L214>.
*
* @type {Previous}
*/
function previousProtocol(code) {
	return !asciiAlpha(code);
}
/**
* @this {TokenizeContext}
* @type {Previous}
*/
function previousEmail(code) {
	return !(code === 47 || gfmAtext(code));
}
/**
* @param {Code} code
* @returns {boolean}
*/
function gfmAtext(code) {
	return code === 43 || code === 45 || code === 46 || code === 95 || asciiAlphanumeric(code);
}
/**
* @param {Array<Event>} events
* @returns {boolean}
*/
function previousUnbalanced(events) {
	let index = events.length;
	let result = false;
	while (index--) {
		const token = events[index][1];
		if ((token.type === "labelLink" || token.type === "labelImage") && !token._balanced) {
			result = true;
			break;
		}
		if (token._gfmAutolinkLiteralWalkedInto) {
			result = false;
			break;
		}
	}
	if (events.length > 0 && !result) events[events.length - 1][1]._gfmAutolinkLiteralWalkedInto = true;
	return result;
}
/**
* @import {Event, Exiter, Extension, Resolver, State, Token, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
const indent = {
	tokenize: tokenizeIndent,
	partial: true
};
/**
* Create an extension for `micromark` to enable GFM footnote syntax.
*
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions` to
*   enable GFM footnote syntax.
*/
function gfmFootnote() {
	/** @type {Extension} */
	return {
		document: { [91]: {
			name: "gfmFootnoteDefinition",
			tokenize: tokenizeDefinitionStart,
			continuation: { tokenize: tokenizeDefinitionContinuation },
			exit: gfmFootnoteDefinitionEnd
		} },
		text: {
			[91]: {
				name: "gfmFootnoteCall",
				tokenize: tokenizeGfmFootnoteCall
			},
			[93]: {
				name: "gfmPotentialFootnoteCall",
				add: "after",
				tokenize: tokenizePotentialGfmFootnoteCall,
				resolveTo: resolveToPotentialGfmFootnoteCall
			}
		}
	};
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizePotentialGfmFootnoteCall(effects, ok, nok) {
	const self = this;
	let index = self.events.length;
	const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
	/** @type {Token} */
	let labelStart;
	while (index--) {
		const token = self.events[index][1];
		if (token.type === "labelImage") {
			labelStart = token;
			break;
		}
		if (token.type === "gfmFootnoteCall" || token.type === "labelLink" || token.type === "label" || token.type === "image" || token.type === "link") break;
	}
	return start;
	/**
	* @type {State}
	*/
	function start(code) {
		if (!labelStart || !labelStart._balanced) return nok(code);
		const id = normalizeIdentifier(self.sliceSerialize({
			start: labelStart.end,
			end: self.now()
		}));
		if (id.codePointAt(0) !== 94 || !defined.includes(id.slice(1))) return nok(code);
		effects.enter("gfmFootnoteCallLabelMarker");
		effects.consume(code);
		effects.exit("gfmFootnoteCallLabelMarker");
		return ok(code);
	}
}
/** @type {Resolver} */
function resolveToPotentialGfmFootnoteCall(events, context) {
	let index = events.length;
	while (index--) if (events[index][1].type === "labelImage" && events[index][0] === "enter") {
		events[index][1];
		break;
	}
	events[index + 1][1].type = "data";
	events[index + 3][1].type = "gfmFootnoteCallLabelMarker";
	/** @type {Token} */
	const call = {
		type: "gfmFootnoteCall",
		start: Object.assign({}, events[index + 3][1].start),
		end: Object.assign({}, events[events.length - 1][1].end)
	};
	/** @type {Token} */
	const marker = {
		type: "gfmFootnoteCallMarker",
		start: Object.assign({}, events[index + 3][1].end),
		end: Object.assign({}, events[index + 3][1].end)
	};
	marker.end.column++;
	marker.end.offset++;
	marker.end._bufferIndex++;
	/** @type {Token} */
	const string = {
		type: "gfmFootnoteCallString",
		start: Object.assign({}, marker.end),
		end: Object.assign({}, events[events.length - 1][1].start)
	};
	/** @type {Token} */
	const chunk = {
		type: "chunkString",
		contentType: "string",
		start: Object.assign({}, string.start),
		end: Object.assign({}, string.end)
	};
	/** @type {Array<Event>} */
	const replacement = [
		events[index + 1],
		events[index + 2],
		[
			"enter",
			call,
			context
		],
		events[index + 3],
		events[index + 4],
		[
			"enter",
			marker,
			context
		],
		[
			"exit",
			marker,
			context
		],
		[
			"enter",
			string,
			context
		],
		[
			"enter",
			chunk,
			context
		],
		[
			"exit",
			chunk,
			context
		],
		[
			"exit",
			string,
			context
		],
		events[events.length - 2],
		events[events.length - 1],
		[
			"exit",
			call,
			context
		]
	];
	events.splice(index, events.length - index + 1, ...replacement);
	return events;
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeGfmFootnoteCall(effects, ok, nok) {
	const self = this;
	const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
	let size = 0;
	/** @type {boolean} */
	let data;
	return start;
	/**
	* Start of footnote label.
	*
	* ```markdown
	* > | a [^b] c
	*       ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("gfmFootnoteCall");
		effects.enter("gfmFootnoteCallLabelMarker");
		effects.consume(code);
		effects.exit("gfmFootnoteCallLabelMarker");
		return callStart;
	}
	/**
	* After `[`, at `^`.
	*
	* ```markdown
	* > | a [^b] c
	*        ^
	* ```
	*
	* @type {State}
	*/
	function callStart(code) {
		if (code !== 94) return nok(code);
		effects.enter("gfmFootnoteCallMarker");
		effects.consume(code);
		effects.exit("gfmFootnoteCallMarker");
		effects.enter("gfmFootnoteCallString");
		effects.enter("chunkString").contentType = "string";
		return callData;
	}
	/**
	* In label.
	*
	* ```markdown
	* > | a [^b] c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function callData(code) {
		if (size > 999 || code === 93 && !data || code === null || code === 91 || markdownLineEndingOrSpace(code)) return nok(code);
		if (code === 93) {
			effects.exit("chunkString");
			const token = effects.exit("gfmFootnoteCallString");
			if (!defined.includes(normalizeIdentifier(self.sliceSerialize(token)))) return nok(code);
			effects.enter("gfmFootnoteCallLabelMarker");
			effects.consume(code);
			effects.exit("gfmFootnoteCallLabelMarker");
			effects.exit("gfmFootnoteCall");
			return ok;
		}
		if (!markdownLineEndingOrSpace(code)) data = true;
		size++;
		effects.consume(code);
		return code === 92 ? callEscape : callData;
	}
	/**
	* On character after escape.
	*
	* ```markdown
	* > | a [^b\c] d
	*           ^
	* ```
	*
	* @type {State}
	*/
	function callEscape(code) {
		if (code === 91 || code === 92 || code === 93) {
			effects.consume(code);
			size++;
			return callData;
		}
		return callData(code);
	}
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeDefinitionStart(effects, ok, nok) {
	const self = this;
	const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
	/** @type {string} */
	let identifier;
	let size = 0;
	/** @type {boolean | undefined} */
	let data;
	return start;
	/**
	* Start of GFM footnote definition.
	*
	* ```markdown
	* > | [^a]: b
	*     ^
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("gfmFootnoteDefinition")._container = true;
		effects.enter("gfmFootnoteDefinitionLabel");
		effects.enter("gfmFootnoteDefinitionLabelMarker");
		effects.consume(code);
		effects.exit("gfmFootnoteDefinitionLabelMarker");
		return labelAtMarker;
	}
	/**
	* In label, at caret.
	*
	* ```markdown
	* > | [^a]: b
	*      ^
	* ```
	*
	* @type {State}
	*/
	function labelAtMarker(code) {
		if (code === 94) {
			effects.enter("gfmFootnoteDefinitionMarker");
			effects.consume(code);
			effects.exit("gfmFootnoteDefinitionMarker");
			effects.enter("gfmFootnoteDefinitionLabelString");
			effects.enter("chunkString").contentType = "string";
			return labelInside;
		}
		return nok(code);
	}
	/**
	* In label.
	*
	* > 👉 **Note**: `cmark-gfm` prevents whitespace from occurring in footnote
	* > definition labels.
	*
	* ```markdown
	* > | [^a]: b
	*       ^
	* ```
	*
	* @type {State}
	*/
	function labelInside(code) {
		if (size > 999 || code === 93 && !data || code === null || code === 91 || markdownLineEndingOrSpace(code)) return nok(code);
		if (code === 93) {
			effects.exit("chunkString");
			const token = effects.exit("gfmFootnoteDefinitionLabelString");
			identifier = normalizeIdentifier(self.sliceSerialize(token));
			effects.enter("gfmFootnoteDefinitionLabelMarker");
			effects.consume(code);
			effects.exit("gfmFootnoteDefinitionLabelMarker");
			effects.exit("gfmFootnoteDefinitionLabel");
			return labelAfter;
		}
		if (!markdownLineEndingOrSpace(code)) data = true;
		size++;
		effects.consume(code);
		return code === 92 ? labelEscape : labelInside;
	}
	/**
	* After `\`, at a special character.
	*
	* > 👉 **Note**: `cmark-gfm` currently does not support escaped brackets:
	* > <https://github.com/github/cmark-gfm/issues/240>
	*
	* ```markdown
	* > | [^a\*b]: c
	*         ^
	* ```
	*
	* @type {State}
	*/
	function labelEscape(code) {
		if (code === 91 || code === 92 || code === 93) {
			effects.consume(code);
			size++;
			return labelInside;
		}
		return labelInside(code);
	}
	/**
	* After definition label.
	*
	* ```markdown
	* > | [^a]: b
	*         ^
	* ```
	*
	* @type {State}
	*/
	function labelAfter(code) {
		if (code === 58) {
			effects.enter("definitionMarker");
			effects.consume(code);
			effects.exit("definitionMarker");
			if (!defined.includes(identifier)) defined.push(identifier);
			return factorySpace(effects, whitespaceAfter, "gfmFootnoteDefinitionWhitespace");
		}
		return nok(code);
	}
	/**
	* After definition prefix.
	*
	* ```markdown
	* > | [^a]: b
	*           ^
	* ```
	*
	* @type {State}
	*/
	function whitespaceAfter(code) {
		return ok(code);
	}
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeDefinitionContinuation(effects, ok, nok) {
	return effects.check(blankLine, ok, effects.attempt(indent, ok, nok));
}
/** @type {Exiter} */
function gfmFootnoteDefinitionEnd(effects) {
	effects.exit("gfmFootnoteDefinition");
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeIndent(effects, ok, nok) {
	const self = this;
	return factorySpace(effects, afterPrefix, "gfmFootnoteDefinitionIndent", 5);
	/**
	* @type {State}
	*/
	function afterPrefix(code) {
		const tail = self.events[self.events.length - 1];
		return tail && tail[1].type === "gfmFootnoteDefinitionIndent" && tail[2].sliceSerialize(tail[1], true).length === 4 ? ok(code) : nok(code);
	}
}
/**
* @import {Options} from 'micromark-extension-gfm-strikethrough'
* @import {Event, Extension, Resolver, State, Token, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
/**
* Create an extension for `micromark` to enable GFM strikethrough syntax.
*
* @param {Options | null | undefined} [options={}]
*   Configuration.
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions`, to
*   enable GFM strikethrough syntax.
*/
function gfmStrikethrough(options) {
	let single = (options || {}).singleTilde;
	const tokenizer = {
		name: "strikethrough",
		tokenize: tokenizeStrikethrough,
		resolveAll: resolveAllStrikethrough
	};
	if (single === null || single === void 0) single = true;
	return {
		text: { [126]: tokenizer },
		insideSpan: { null: [tokenizer] },
		attentionMarkers: { null: [126] }
	};
	/**
	* Take events and resolve strikethrough.
	*
	* @type {Resolver}
	*/
	function resolveAllStrikethrough(events, context) {
		let index = -1;
		while (++index < events.length) if (events[index][0] === "enter" && events[index][1].type === "strikethroughSequenceTemporary" && events[index][1]._close) {
			let open = index;
			while (open--) if (events[open][0] === "exit" && events[open][1].type === "strikethroughSequenceTemporary" && events[open][1]._open && events[index][1].end.offset - events[index][1].start.offset === events[open][1].end.offset - events[open][1].start.offset) {
				events[index][1].type = "strikethroughSequence";
				events[open][1].type = "strikethroughSequence";
				/** @type {Token} */
				const strikethrough = {
					type: "strikethrough",
					start: Object.assign({}, events[open][1].start),
					end: Object.assign({}, events[index][1].end)
				};
				/** @type {Token} */
				const text = {
					type: "strikethroughText",
					start: Object.assign({}, events[open][1].end),
					end: Object.assign({}, events[index][1].start)
				};
				/** @type {Array<Event>} */
				const nextEvents = [
					[
						"enter",
						strikethrough,
						context
					],
					[
						"enter",
						events[open][1],
						context
					],
					[
						"exit",
						events[open][1],
						context
					],
					[
						"enter",
						text,
						context
					]
				];
				const insideSpan = context.parser.constructs.insideSpan.null;
				if (insideSpan) splice(nextEvents, nextEvents.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context));
				splice(nextEvents, nextEvents.length, 0, [
					[
						"exit",
						text,
						context
					],
					[
						"enter",
						events[index][1],
						context
					],
					[
						"exit",
						events[index][1],
						context
					],
					[
						"exit",
						strikethrough,
						context
					]
				]);
				splice(events, open - 1, index - open + 3, nextEvents);
				index = open + nextEvents.length - 2;
				break;
			}
		}
		index = -1;
		while (++index < events.length) if (events[index][1].type === "strikethroughSequenceTemporary") events[index][1].type = "data";
		return events;
	}
	/**
	* @this {TokenizeContext}
	* @type {Tokenizer}
	*/
	function tokenizeStrikethrough(effects, ok, nok) {
		const previous = this.previous;
		const events = this.events;
		let size = 0;
		return start;
		/** @type {State} */
		function start(code) {
			if (previous === 126 && events[events.length - 1][1].type !== "characterEscape") return nok(code);
			effects.enter("strikethroughSequenceTemporary");
			return more(code);
		}
		/** @type {State} */
		function more(code) {
			const before = classifyCharacter(previous);
			if (code === 126) {
				if (size > 1) return nok(code);
				effects.consume(code);
				size++;
				return more;
			}
			if (size < 2 && !single) return nok(code);
			const token = effects.exit("strikethroughSequenceTemporary");
			const after = classifyCharacter(code);
			token._open = !after || after === 2 && Boolean(before);
			token._close = !before || before === 2 && Boolean(after);
			return ok(code);
		}
	}
}
/**
* @import {Event} from 'micromark-util-types'
*/
/**
* @typedef {[number, number, Array<Event>]} Change
* @typedef {[number, number, number]} Jump
*/
/**
* Tracks a bunch of edits.
*/
var EditMap = class {
	/**
	* Create a new edit map.
	*/
	constructor() {
		/**
		* Record of changes.
		*
		* @type {Array<Change>}
		*/
		this.map = [];
		/**
		* Changes by index, so `add` does not scan `map` (quadratic on
		* table-heavy documents).
		*
		* @type {Map<number, Change>}
		*/
		this.index = /* @__PURE__ */ new Map();
	}
	/**
	* Create an edit: a remove and/or add at a certain place.
	*
	* @param {number} index
	*   Index at which to apply the edit.
	* @param {number} remove
	*   Count of items to remove at the index.
	* @param {Array<Event>} add
	*   Items to add at the index.
	* @returns {undefined}
	*   Nothing.
	*/
	add(index, remove, add) {
		addImplementation(this, index, remove, add);
	}
	/**
	* Done, change the events.
	*
	* @param {Array<Event>} events
	*   List of events to apply the edits to.
	* @returns {undefined}
	*   Nothing.
	*/
	consume(events) {
		this.map.sort(function(a, b) {
			return a[0] - b[0];
		});
		/* c8 ignore next 3 -- `resolve` is never called without tables, so without edits. */
		if (this.map.length === 0) return;
		let index = this.map.length;
		/** @type {Array<Array<Event>>} */
		const vecs = [];
		while (index > 0) {
			index -= 1;
			vecs.push(events.slice(this.map[index][0] + this.map[index][1]), this.map[index][2]);
			events.length = this.map[index][0];
		}
		vecs.push(events.slice());
		events.length = 0;
		let slice = vecs.pop();
		while (slice) {
			for (const element of slice) events.push(element);
			slice = vecs.pop();
		}
		this.map.length = 0;
		this.index.clear();
	}
};
/**
* Create an edit.
*
* @param {EditMap} editMap
*   Edit map to apply to.
* @param {number} at
*   Index at which to apply the edit.
* @param {number} remove
*   Count of items to remove at the index.
* @param {Array<Event>} add
*   Items to add at the index.
* @returns {undefined}
*   Nothing.
*/
function addImplementation(editMap, at, remove, add) {
	/* c8 ignore next 3 -- `resolve` is never called without tables, so without edits. */
	if (remove === 0 && add.length === 0) return;
	const existing = editMap.index.get(at);
	if (existing) {
		existing[1] += remove;
		existing[2].push(...add);
		return;
	}
	/** @type {Change} */
	const change = [
		at,
		remove,
		add
	];
	editMap.map.push(change);
	editMap.index.set(at, change);
}
/**
* @import {Event} from 'micromark-util-types'
*/
/**
* @typedef {'center' | 'left' | 'none' | 'right'} Align
*/
/**
* Figure out the alignment of a GFM table.
*
* @param {Readonly<Array<Event>>} events
*   List of events.
* @param {number} index
*   Table enter event.
* @returns {Array<Align>}
*   List of aligns.
*/
function gfmTableAlign(events, index) {
	let inDelimiterRow = false;
	/** @type {Array<Align>} */
	const align = [];
	while (index < events.length) {
		const event = events[index];
		if (inDelimiterRow) {
			if (event[0] === "enter") {
				if (event[1].type === "tableContent") align.push(events[index + 1][1].type === "tableDelimiterMarker" ? "left" : "none");
			} else if (event[1].type === "tableContent") {
				if (events[index - 1][1].type === "tableDelimiterMarker") {
					const alignIndex = align.length - 1;
					align[alignIndex] = align[alignIndex] === "left" ? "center" : "right";
				}
			} else if (event[1].type === "tableDelimiterRow") break;
		} else if (event[0] === "enter" && event[1].type === "tableDelimiterRow") inDelimiterRow = true;
		index += 1;
	}
	return align;
}
/**
* @import {Event, Extension, Point, Resolver, State, Token, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
/**
* @typedef {[number, number, number, number]} Range
*   Cell info.
*
* @typedef {0 | 1 | 2 | 3} RowKind
*   Where we are: `1` for head row, `2` for delimiter row, `3` for body row.
*/
/**
* Create an HTML extension for `micromark` to support GitHub tables syntax.
*
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions` to enable GFM
*   table syntax.
*/
function gfmTable() {
	return { flow: { null: {
		name: "table",
		tokenize: tokenizeTable,
		resolveAll: resolveTable
	} } };
}
/**
* Tokenizer for GFM tables.
*
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeTable(effects, ok, nok) {
	const self = this;
	let size = 0;
	let sizeB = 0;
	/** @type {boolean | undefined} */
	let seen;
	return start;
	/**
	* Start of a GFM table.
	*
	* If there is a valid table row or table head before, then we try to parse
	* another row.
	* Otherwise, we try to parse a head.
	*
	* ```markdown
	* > | | a |
	*     ^
	*   | | - |
	* > | | b |
	*     ^
	* ```
	* @type {State}
	*/
	function start(code) {
		let index = self.events.length - 1;
		while (index > -1) {
			const { type } = self.events[index][1];
			if (type === "lineEnding" || type === "linePrefix") index--;
			else break;
		}
		const tail = index > -1 ? self.events[index][1].type : null;
		const next = tail === "tableHead" || tail === "tableRow" ? bodyRowStart : headRowBefore;
		if (next === bodyRowStart && self.parser.lazy[self.now().line]) return nok(code);
		return next(code);
	}
	/**
	* Before table head row.
	*
	* ```markdown
	* > | | a |
	*     ^
	*   | | - |
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headRowBefore(code) {
		effects.enter("tableHead");
		effects.enter("tableRow");
		return headRowStart(code);
	}
	/**
	* Before table head row, after whitespace.
	*
	* ```markdown
	* > | | a |
	*     ^
	*   | | - |
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headRowStart(code) {
		if (code === 124) return headRowBreak(code);
		seen = true;
		sizeB += 1;
		return headRowBreak(code);
	}
	/**
	* At break in table head row.
	*
	* ```markdown
	* > | | a |
	*     ^
	*       ^
	*         ^
	*   | | - |
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headRowBreak(code) {
		if (code === null) return nok(code);
		if (markdownLineEnding(code)) {
			if (sizeB > 1) {
				sizeB = 0;
				self.interrupt = true;
				effects.exit("tableRow");
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return headDelimiterStart;
			}
			return nok(code);
		}
		if (markdownSpace(code)) return factorySpace(effects, headRowBreak, "whitespace")(code);
		sizeB += 1;
		if (seen) {
			seen = false;
			size += 1;
		}
		if (code === 124) {
			effects.enter("tableCellDivider");
			effects.consume(code);
			effects.exit("tableCellDivider");
			seen = true;
			return headRowBreak;
		}
		effects.enter("data");
		return headRowData(code);
	}
	/**
	* In table head row data.
	*
	* ```markdown
	* > | | a |
	*       ^
	*   | | - |
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headRowData(code) {
		if (code === null || code === 124 || markdownLineEndingOrSpace(code)) {
			effects.exit("data");
			return headRowBreak(code);
		}
		effects.consume(code);
		return code === 92 ? headRowEscape : headRowData;
	}
	/**
	* In table head row escape.
	*
	* ```markdown
	* > | | a\-b |
	*         ^
	*   | | ---- |
	*   | | c    |
	* ```
	*
	* @type {State}
	*/
	function headRowEscape(code) {
		if (code === 92 || code === 124) {
			effects.consume(code);
			return headRowData;
		}
		return headRowData(code);
	}
	/**
	* Before delimiter row.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*     ^
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headDelimiterStart(code) {
		self.interrupt = false;
		if (self.parser.lazy[self.now().line]) return nok(code);
		effects.enter("tableDelimiterRow");
		seen = false;
		if (markdownSpace(code)) return factorySpace(effects, headDelimiterBefore, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code);
		return headDelimiterBefore(code);
	}
	/**
	* Before delimiter row, after optional whitespace.
	*
	* Reused when a `|` is found later, to parse another cell.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*     ^
	*   | | b |
	* ```
	*
	* @type {State}
	*/
	function headDelimiterBefore(code) {
		if (code === 45 || code === 58) return headDelimiterValueBefore(code);
		if (code === 124) {
			seen = true;
			effects.enter("tableCellDivider");
			effects.consume(code);
			effects.exit("tableCellDivider");
			return headDelimiterCellBefore;
		}
		return headDelimiterNok(code);
	}
	/**
	* After `|`, before delimiter cell.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*      ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterCellBefore(code) {
		if (markdownSpace(code)) return factorySpace(effects, headDelimiterValueBefore, "whitespace")(code);
		return headDelimiterValueBefore(code);
	}
	/**
	* Before delimiter cell value.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*       ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterValueBefore(code) {
		if (code === 58) {
			sizeB += 1;
			seen = true;
			effects.enter("tableDelimiterMarker");
			effects.consume(code);
			effects.exit("tableDelimiterMarker");
			return headDelimiterLeftAlignmentAfter;
		}
		if (code === 45) {
			sizeB += 1;
			return headDelimiterLeftAlignmentAfter(code);
		}
		if (code === null || markdownLineEnding(code)) return headDelimiterCellAfter(code);
		return headDelimiterNok(code);
	}
	/**
	* After delimiter cell left alignment marker.
	*
	* ```markdown
	*   | | a  |
	* > | | :- |
	*        ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterLeftAlignmentAfter(code) {
		if (code === 45) {
			effects.enter("tableDelimiterFiller");
			return headDelimiterFiller(code);
		}
		return headDelimiterNok(code);
	}
	/**
	* In delimiter cell filler.
	*
	* ```markdown
	*   | | a |
	* > | | - |
	*       ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterFiller(code) {
		if (code === 45) {
			effects.consume(code);
			return headDelimiterFiller;
		}
		if (code === 58) {
			seen = true;
			effects.exit("tableDelimiterFiller");
			effects.enter("tableDelimiterMarker");
			effects.consume(code);
			effects.exit("tableDelimiterMarker");
			return headDelimiterRightAlignmentAfter;
		}
		effects.exit("tableDelimiterFiller");
		return headDelimiterRightAlignmentAfter(code);
	}
	/**
	* After delimiter cell right alignment marker.
	*
	* ```markdown
	*   | |  a |
	* > | | -: |
	*         ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterRightAlignmentAfter(code) {
		if (markdownSpace(code)) return factorySpace(effects, headDelimiterCellAfter, "whitespace")(code);
		return headDelimiterCellAfter(code);
	}
	/**
	* After delimiter cell.
	*
	* ```markdown
	*   | |  a |
	* > | | -: |
	*          ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterCellAfter(code) {
		if (code === 124) return headDelimiterBefore(code);
		if (code === null || markdownLineEnding(code)) {
			if (!seen || size !== sizeB) return headDelimiterNok(code);
			effects.exit("tableDelimiterRow");
			effects.exit("tableHead");
			return ok(code);
		}
		return headDelimiterNok(code);
	}
	/**
	* In delimiter row, at a disallowed byte.
	*
	* ```markdown
	*   | | a |
	* > | | x |
	*       ^
	* ```
	*
	* @type {State}
	*/
	function headDelimiterNok(code) {
		return nok(code);
	}
	/**
	* Before table body row.
	*
	* ```markdown
	*   | | a |
	*   | | - |
	* > | | b |
	*     ^
	* ```
	*
	* @type {State}
	*/
	function bodyRowStart(code) {
		effects.enter("tableRow");
		return bodyRowBreak(code);
	}
	/**
	* At break in table body row.
	*
	* ```markdown
	*   | | a |
	*   | | - |
	* > | | b |
	*     ^
	*       ^
	*         ^
	* ```
	*
	* @type {State}
	*/
	function bodyRowBreak(code) {
		if (code === 124) {
			effects.enter("tableCellDivider");
			effects.consume(code);
			effects.exit("tableCellDivider");
			return bodyRowBreak;
		}
		if (code === null || markdownLineEnding(code)) {
			effects.exit("tableRow");
			return ok(code);
		}
		if (markdownSpace(code)) return factorySpace(effects, bodyRowBreak, "whitespace")(code);
		effects.enter("data");
		return bodyRowData(code);
	}
	/**
	* In table body row data.
	*
	* ```markdown
	*   | | a |
	*   | | - |
	* > | | b |
	*       ^
	* ```
	*
	* @type {State}
	*/
	function bodyRowData(code) {
		if (code === null || code === 124 || markdownLineEndingOrSpace(code)) {
			effects.exit("data");
			return bodyRowBreak(code);
		}
		effects.consume(code);
		return code === 92 ? bodyRowEscape : bodyRowData;
	}
	/**
	* In table body row escape.
	*
	* ```markdown
	*   | | a    |
	*   | | ---- |
	* > | | b\-c |
	*         ^
	* ```
	*
	* @type {State}
	*/
	function bodyRowEscape(code) {
		if (code === 92 || code === 124) {
			effects.consume(code);
			return bodyRowData;
		}
		return bodyRowData(code);
	}
}
/** @type {Resolver} */
function resolveTable(events, context) {
	let index = -1;
	let inFirstCellAwaitingPipe = true;
	/** @type {RowKind} */
	let rowKind = 0;
	/** @type {Range} */
	let lastCell = [
		0,
		0,
		0,
		0
	];
	/** @type {Range} */
	let cell = [
		0,
		0,
		0,
		0
	];
	let afterHeadAwaitingFirstBodyRow = false;
	let lastTableEnd = 0;
	/** @type {Token | undefined} */
	let currentTable;
	/** @type {Token | undefined} */
	let currentBody;
	/** @type {Token | undefined} */
	let currentCell;
	const map = new EditMap();
	while (++index < events.length) {
		const event = events[index];
		const token = event[1];
		if (event[0] === "enter") {
			if (token.type === "tableHead") {
				afterHeadAwaitingFirstBodyRow = false;
				if (lastTableEnd !== 0) {
					flushTableEnd(map, context, lastTableEnd, currentTable, currentBody);
					currentBody = void 0;
					lastTableEnd = 0;
				}
				currentTable = {
					type: "table",
					start: Object.assign({}, token.start),
					end: Object.assign({}, token.end)
				};
				map.add(index, 0, [[
					"enter",
					currentTable,
					context
				]]);
			} else if (token.type === "tableRow" || token.type === "tableDelimiterRow") {
				inFirstCellAwaitingPipe = true;
				currentCell = void 0;
				lastCell = [
					0,
					0,
					0,
					0
				];
				cell = [
					0,
					index + 1,
					0,
					0
				];
				if (afterHeadAwaitingFirstBodyRow) {
					afterHeadAwaitingFirstBodyRow = false;
					currentBody = {
						type: "tableBody",
						start: Object.assign({}, token.start),
						end: Object.assign({}, token.end)
					};
					map.add(index, 0, [[
						"enter",
						currentBody,
						context
					]]);
				}
				rowKind = token.type === "tableDelimiterRow" ? 2 : currentBody ? 3 : 1;
			} else if (rowKind && (token.type === "data" || token.type === "tableDelimiterMarker" || token.type === "tableDelimiterFiller")) {
				inFirstCellAwaitingPipe = false;
				if (cell[2] === 0) {
					if (lastCell[1] !== 0) {
						cell[0] = cell[1];
						currentCell = flushCell(map, context, lastCell, rowKind, void 0, currentCell);
						lastCell = [
							0,
							0,
							0,
							0
						];
					}
					cell[2] = index;
				}
			} else if (token.type === "tableCellDivider") {
				if (inFirstCellAwaitingPipe) inFirstCellAwaitingPipe = false;
				else {
					if (lastCell[1] !== 0) {
						cell[0] = cell[1];
						currentCell = flushCell(map, context, lastCell, rowKind, void 0, currentCell);
					}
					lastCell = cell;
					cell = [
						lastCell[1],
						index,
						0,
						0
					];
				}
			}
		} else if (token.type === "tableHead") {
			afterHeadAwaitingFirstBodyRow = true;
			lastTableEnd = index;
		} else if (token.type === "tableRow" || token.type === "tableDelimiterRow") {
			lastTableEnd = index;
			if (lastCell[1] !== 0) {
				cell[0] = cell[1];
				currentCell = flushCell(map, context, lastCell, rowKind, index, currentCell);
			} else if (cell[1] !== 0) currentCell = flushCell(map, context, cell, rowKind, index, currentCell);
			rowKind = 0;
		} else if (rowKind && (token.type === "data" || token.type === "tableDelimiterMarker" || token.type === "tableDelimiterFiller")) cell[3] = index;
	}
	if (lastTableEnd !== 0) flushTableEnd(map, context, lastTableEnd, currentTable, currentBody);
	map.consume(context.events);
	index = -1;
	while (++index < context.events.length) {
		const event = context.events[index];
		if (event[0] === "enter" && event[1].type === "table") event[1]._align = gfmTableAlign(context.events, index);
	}
	return events;
}
/**
* Generate a cell.
*
* @param {EditMap} map
*   Edit map to apply to.
* @param {Readonly<TokenizeContext>} context
*   Tokenize context.
* @param {Readonly<Range>} range
*   Range of the cell within events.
* @param {RowKind} rowKind
*   Type of row.
* @param {number | undefined} rowEnd
*   Index of the end of the row, if known.
* @param {Token | undefined} previousCell
*   Previous cell token, if any.
* @returns {Token | undefined}
*   Current cell token after flushing, if any.
*/
function flushCell(map, context, range, rowKind, rowEnd, previousCell) {
	const groupName = rowKind === 1 ? "tableHeader" : rowKind === 2 ? "tableDelimiter" : "tableData";
	const valueName = "tableContent";
	if (range[0] !== 0) {
		previousCell.end = Object.assign({}, getPoint(context.events, range[0]));
		map.add(range[0], 0, [[
			"exit",
			previousCell,
			context
		]]);
	}
	const now = getPoint(context.events, range[1]);
	previousCell = {
		type: groupName,
		start: Object.assign({}, now),
		end: Object.assign({}, now)
	};
	map.add(range[1], 0, [[
		"enter",
		previousCell,
		context
	]]);
	if (range[2] !== 0) {
		const relatedStart = getPoint(context.events, range[2]);
		const relatedEnd = getPoint(context.events, range[3]);
		/** @type {Token} */
		const valueToken = {
			type: valueName,
			start: Object.assign({}, relatedStart),
			end: Object.assign({}, relatedEnd)
		};
		map.add(range[2], 0, [[
			"enter",
			valueToken,
			context
		]]);
		if (rowKind !== 2) {
			const start = context.events[range[2]];
			const end = context.events[range[3]];
			start[1].end = Object.assign({}, end[1].end);
			start[1].type = "chunkText";
			start[1].contentType = "text";
			if (range[3] > range[2] + 1) {
				const a = range[2] + 1;
				const b = range[3] - range[2] - 1;
				map.add(a, b, []);
			}
		}
		map.add(range[3] + 1, 0, [[
			"exit",
			valueToken,
			context
		]]);
	}
	if (rowEnd !== void 0) {
		previousCell.end = Object.assign({}, getPoint(context.events, rowEnd));
		map.add(rowEnd, 0, [[
			"exit",
			previousCell,
			context
		]]);
		previousCell = void 0;
	}
	return previousCell;
}
/**
* Generate table end (and table body end).
*
* @param {Readonly<EditMap>} map
*   Edit map to apply to.
* @param {Readonly<TokenizeContext>} context
*   Tokenize context.
* @param {number} index
*   Index within the events where the table end should be inserted.
* @param {Token} table
*   Table token.
* @param {Token | undefined} tableBody
*   Table body token, if any.
* @returns {undefined}
*   Nothing.
*/
function flushTableEnd(map, context, index, table, tableBody) {
	/** @type {Array<Event>} */
	const exits = [];
	const related = getPoint(context.events, index);
	if (tableBody) {
		tableBody.end = Object.assign({}, related);
		exits.push([
			"exit",
			tableBody,
			context
		]);
	}
	table.end = Object.assign({}, related);
	exits.push([
		"exit",
		table,
		context
	]);
	map.add(index + 1, 0, exits);
}
/**
* Get the point (start or end) for a given event in the list of events.
*
* @param {Readonly<Array<Event>>} events
*   List of events.
* @param {number} index
*   Index of the event to get the point for.
* @returns {Readonly<Point>}
*   Start point for enter and end point for exit.
*/
function getPoint(events, index) {
	const event = events[index];
	const side = event[0] === "enter" ? "start" : "end";
	return event[1][side];
}
/**
* @import {Extension, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
const tasklistCheck = {
	name: "tasklistCheck",
	tokenize: tokenizeTasklistCheck
};
/**
* Create an HTML extension for `micromark` to support GFM task list items
* syntax.
*
* @returns {Extension}
*   Extension for `micromark` that can be passed in `htmlExtensions` to
*   support GFM task list items when serializing to HTML.
*/
function gfmTaskListItem() {
	return { text: { [91]: tasklistCheck } };
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeTasklistCheck(effects, ok, nok) {
	const self = this;
	return open;
	/**
	* At start of task list item check.
	*
	* ```markdown
	* > | * [x] y.
	*       ^
	* ```
	*
	* @type {State}
	*/
	function open(code) {
		if (self.previous !== null || !self._gfmTasklistFirstContentOfListItem) return nok(code);
		effects.enter("taskListCheck");
		effects.enter("taskListCheckMarker");
		effects.consume(code);
		effects.exit("taskListCheckMarker");
		return inside;
	}
	/**
	* In task list item check.
	*
	* ```markdown
	* > | * [x] y.
	*        ^
	* ```
	*
	* @type {State}
	*/
	function inside(code) {
		if (markdownLineEndingOrSpace(code)) {
			effects.enter("taskListCheckValueUnchecked");
			effects.consume(code);
			effects.exit("taskListCheckValueUnchecked");
			return close;
		}
		if (code === 88 || code === 120) {
			effects.enter("taskListCheckValueChecked");
			effects.consume(code);
			effects.exit("taskListCheckValueChecked");
			return close;
		}
		return nok(code);
	}
	/**
	* At close of task list item check.
	*
	* ```markdown
	* > | * [x] y.
	*         ^
	* ```
	*
	* @type {State}
	*/
	function close(code) {
		if (code === 93) {
			effects.enter("taskListCheckMarker");
			effects.consume(code);
			effects.exit("taskListCheckMarker");
			effects.exit("taskListCheck");
			return after;
		}
		return nok(code);
	}
	/**
	* @type {State}
	*/
	function after(code) {
		if (markdownLineEnding(code)) return ok(code);
		if (markdownSpace(code)) return effects.check({ tokenize: spaceThenNonSpace }, ok, nok)(code);
		return nok(code);
	}
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function spaceThenNonSpace(effects, ok, nok) {
	return factorySpace(effects, after, "whitespace");
	/**
	* After whitespace, after task list item check.
	*
	* ```markdown
	* > | * [x] y.
	*           ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		return code === null ? nok(code) : ok(code);
	}
}
/**
* @typedef {import('micromark-extension-gfm-footnote').HtmlOptions} HtmlOptions
* @typedef {import('micromark-extension-gfm-strikethrough').Options} Options
* @typedef {import('micromark-util-types').Extension} Extension
* @typedef {import('micromark-util-types').HtmlExtension} HtmlExtension
*/
/**
* Create an extension for `micromark` to enable GFM syntax.
*
* @param {Options | null | undefined} [options]
*   Configuration (optional).
*
*   Passed to `micromark-extens-gfm-strikethrough`.
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions` to enable GFM
*   syntax.
*/
function gfm(options) {
	return combineExtensions([
		gfmAutolinkLiteral(),
		gfmFootnote(),
		gfmStrikethrough(options),
		gfmTable(),
		gfmTaskListItem()
	]);
}
/**
* @import {Construct, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
/** @type {Construct} */
const mathFlow = {
	tokenize: tokenizeMathFenced,
	concrete: true,
	name: "mathFlow"
};
/** @type {Construct} */
const nonLazyContinuation$1 = {
	tokenize: tokenizeNonLazyContinuation$1,
	partial: true
};
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeMathFenced(effects, ok, nok) {
	const self = this;
	const tail = self.events[self.events.length - 1];
	const initialSize = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
	let sizeOpen = 0;
	return start;
	/**
	* Start of math.
	*
	* ```markdown
	* > | $$
	*     ^
	*   | \frac{1}{2}
	*   | $$
	* ```
	*
	* @type {State}
	*/
	function start(code) {
		effects.enter("mathFlow");
		effects.enter("mathFlowFence");
		effects.enter("mathFlowFenceSequence");
		return sequenceOpen(code);
	}
	/**
	* In opening fence sequence.
	*
	* ```markdown
	* > | $$
	*      ^
	*   | \frac{1}{2}
	*   | $$
	* ```
	*
	* @type {State}
	*/
	function sequenceOpen(code) {
		if (code === 36) {
			effects.consume(code);
			sizeOpen++;
			return sequenceOpen;
		}
		if (sizeOpen < 2) return nok(code);
		effects.exit("mathFlowFenceSequence");
		return factorySpace(effects, metaBefore, "whitespace")(code);
	}
	/**
	* In opening fence, before meta.
	*
	* ```markdown
	* > | $$asciimath
	*       ^
	*   | x < y
	*   | $$
	* ```
	*
	* @type {State}
	*/
	function metaBefore(code) {
		if (code === null || markdownLineEnding(code)) return metaAfter(code);
		effects.enter("mathFlowFenceMeta");
		effects.enter("chunkString", { contentType: "string" });
		return meta(code);
	}
	/**
	* In meta.
	*
	* ```markdown
	* > | $$asciimath
	*        ^
	*   | x < y
	*   | $$
	* ```
	*
	* @type {State}
	*/
	function meta(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("chunkString");
			effects.exit("mathFlowFenceMeta");
			return metaAfter(code);
		}
		if (code === 36) return nok(code);
		effects.consume(code);
		return meta;
	}
	/**
	* After meta.
	*
	* ```markdown
	* > | $$
	*       ^
	*   | \frac{1}{2}
	*   | $$
	* ```
	*
	* @type {State}
	*/
	function metaAfter(code) {
		effects.exit("mathFlowFence");
		if (self.interrupt) return ok(code);
		return effects.attempt(nonLazyContinuation$1, beforeNonLazyContinuation, after)(code);
	}
	/**
	* After eol/eof in math, at a non-lazy closing fence or content.
	*
	* ```markdown
	*   | $$
	* > | \frac{1}{2}
	*     ^
	* > | $$
	*     ^
	* ```
	*
	* @type {State}
	*/
	function beforeNonLazyContinuation(code) {
		return effects.attempt({
			tokenize: tokenizeClosingFence,
			partial: true
		}, after, contentStart)(code);
	}
	/**
	* Before math content, definitely not before a closing fence.
	*
	* ```markdown
	*   | $$
	* > | \frac{1}{2}
	*     ^
	*   | $$
	* ```
	*
	* @type {State}
	*/
	function contentStart(code) {
		return (initialSize ? factorySpace(effects, beforeContentChunk, "linePrefix", initialSize + 1) : beforeContentChunk)(code);
	}
	/**
	* Before math content, after optional prefix.
	*
	* ```markdown
	*   | $$
	* > | \frac{1}{2}
	*     ^
	*   | $$
	* ```
	*
	* @type {State}
	*/
	function beforeContentChunk(code) {
		if (code === null) return after(code);
		if (markdownLineEnding(code)) return effects.attempt(nonLazyContinuation$1, beforeNonLazyContinuation, after)(code);
		effects.enter("mathFlowValue");
		return contentChunk(code);
	}
	/**
	* In math content.
	*
	* ```markdown
	*   | $$
	* > | \frac{1}{2}
	*      ^
	*   | $$
	* ```
	*
	* @type {State}
	*/
	function contentChunk(code) {
		if (code === null || markdownLineEnding(code)) {
			effects.exit("mathFlowValue");
			return beforeContentChunk(code);
		}
		effects.consume(code);
		return contentChunk;
	}
	/**
	* After math (ha!).
	*
	* ```markdown
	*   | $$
	*   | \frac{1}{2}
	* > | $$
	*       ^
	* ```
	*
	* @type {State}
	*/
	function after(code) {
		effects.exit("mathFlow");
		return ok(code);
	}
	/** @type {Tokenizer} */
	function tokenizeClosingFence(effects, ok, nok) {
		let size = 0;
		/**
		* Before closing fence, at optional whitespace.
		*
		* ```markdown
		*   | $$
		*   | \frac{1}{2}
		* > | $$
		*     ^
		* ```
		*/
		return factorySpace(effects, beforeSequenceClose, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
		/**
		* In closing fence, after optional whitespace, at sequence.
		*
		* ```markdown
		*   | $$
		*   | \frac{1}{2}
		* > | $$
		*     ^
		* ```
		*
		* @type {State}
		*/
		function beforeSequenceClose(code) {
			effects.enter("mathFlowFence");
			effects.enter("mathFlowFenceSequence");
			return sequenceClose(code);
		}
		/**
		* In closing fence sequence.
		*
		* ```markdown
		*   | $$
		*   | \frac{1}{2}
		* > | $$
		*      ^
		* ```
		*
		* @type {State}
		*/
		function sequenceClose(code) {
			if (code === 36) {
				size++;
				effects.consume(code);
				return sequenceClose;
			}
			if (size < sizeOpen) return nok(code);
			effects.exit("mathFlowFenceSequence");
			return factorySpace(effects, afterSequenceClose, "whitespace")(code);
		}
		/**
		* After closing fence sequence, after optional whitespace.
		*
		* ```markdown
		*   | $$
		*   | \frac{1}{2}
		* > | $$
		*       ^
		* ```
		*
		* @type {State}
		*/
		function afterSequenceClose(code) {
			if (code === null || markdownLineEnding(code)) {
				effects.exit("mathFlowFence");
				return ok(code);
			}
			return nok(code);
		}
	}
}
/**
* @this {TokenizeContext}
* @type {Tokenizer}
*/
function tokenizeNonLazyContinuation$1(effects, ok, nok) {
	const self = this;
	return start;
	/** @type {State} */
	function start(code) {
		if (code === null) return ok(code);
		effects.enter("lineEnding");
		effects.consume(code);
		effects.exit("lineEnding");
		return lineStart;
	}
	/** @type {State} */
	function lineStart(code) {
		return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
	}
}
/**
* @import {Options} from 'micromark-extension-math'
* @import {Construct, Previous, Resolver, State, Token, TokenizeContext, Tokenizer} from 'micromark-util-types'
*/
/**
* @param {Options | null | undefined} [options={}]
*   Configuration (default: `{}`).
* @returns {Construct}
*   Construct.
*/
function mathText(options) {
	let single = (options || {}).singleDollarTextMath;
	if (single === null || single === void 0) single = true;
	return {
		tokenize: tokenizeMathText,
		resolve: resolveMathText,
		previous,
		name: "mathText"
	};
	/**
	* @this {TokenizeContext}
	* @type {Tokenizer}
	*/
	function tokenizeMathText(effects, ok, nok) {
		let sizeOpen = 0;
		/** @type {number} */
		let size;
		/** @type {Token} */
		let token;
		return start;
		/**
		* Start of math (text).
		*
		* ```markdown
		* > | $a$
		*     ^
		* > | \$a$
		*      ^
		* ```
		*
		* @type {State}
		*/
		function start(code) {
			effects.enter("mathText");
			effects.enter("mathTextSequence");
			return sequenceOpen(code);
		}
		/**
		* In opening sequence.
		*
		* ```markdown
		* > | $a$
		*     ^
		* ```
		*
		* @type {State}
		*/
		function sequenceOpen(code) {
			if (code === 36) {
				effects.consume(code);
				sizeOpen++;
				return sequenceOpen;
			}
			if (sizeOpen < 2 && !single) return nok(code);
			effects.exit("mathTextSequence");
			return between(code);
		}
		/**
		* Between something and something else.
		*
		* ```markdown
		* > | $a$
		*      ^^
		* ```
		*
		* @type {State}
		*/
		function between(code) {
			if (code === null) return nok(code);
			if (code === 36) {
				token = effects.enter("mathTextSequence");
				size = 0;
				return sequenceClose(code);
			}
			if (code === 32) {
				effects.enter("space");
				effects.consume(code);
				effects.exit("space");
				return between;
			}
			if (markdownLineEnding(code)) {
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return between;
			}
			effects.enter("mathTextData");
			return data(code);
		}
		/**
		* In data.
		*
		* ```markdown
		* > | $a$
		*      ^
		* ```
		*
		* @type {State}
		*/
		function data(code) {
			if (code === null || code === 32 || code === 36 || markdownLineEnding(code)) {
				effects.exit("mathTextData");
				return between(code);
			}
			effects.consume(code);
			return data;
		}
		/**
		* In closing sequence.
		*
		* ```markdown
		* > | `a`
		*       ^
		* ```
		*
		* @type {State}
		*/
		function sequenceClose(code) {
			if (code === 36) {
				effects.consume(code);
				size++;
				return sequenceClose;
			}
			if (size === sizeOpen) {
				effects.exit("mathTextSequence");
				effects.exit("mathText");
				return ok(code);
			}
			token.type = "mathTextData";
			return data(code);
		}
	}
}
/** @type {Resolver} */
function resolveMathText(events) {
	let tailExitIndex = events.length - 4;
	let headEnterIndex = 3;
	/** @type {number} */
	let index;
	/** @type {number | undefined} */
	let enter;
	if ((events[headEnterIndex][1].type === "lineEnding" || events[headEnterIndex][1].type === "space") && (events[tailExitIndex][1].type === "lineEnding" || events[tailExitIndex][1].type === "space")) {
		index = headEnterIndex;
		while (++index < tailExitIndex) if (events[index][1].type === "mathTextData") {
			events[tailExitIndex][1].type = "mathTextPadding";
			events[headEnterIndex][1].type = "mathTextPadding";
			headEnterIndex += 2;
			tailExitIndex -= 2;
			break;
		}
	}
	index = headEnterIndex - 1;
	tailExitIndex++;
	while (++index <= tailExitIndex) if (enter === void 0) {
		if (index !== tailExitIndex && events[index][1].type !== "lineEnding") enter = index;
	} else if (index === tailExitIndex || events[index][1].type === "lineEnding") {
		events[enter][1].type = "mathTextData";
		if (index !== enter + 2) {
			events[enter][1].end = events[index - 1][1].end;
			events.splice(enter + 2, index - enter - 2);
			tailExitIndex -= index - enter - 2;
			index = enter + 2;
		}
		enter = void 0;
	}
	return events;
}
/**
* @this {TokenizeContext}
* @type {Previous}
*/
function previous(code) {
	return code !== 36 || this.events[this.events.length - 1][1].type === "characterEscape";
}
/**
* @import {Options} from 'micromark-extension-math'
* @import {Extension} from 'micromark-util-types'
*/
/**
* Create an extension for `micromark` to enable math syntax.
*
* @param {Options | null | undefined} [options={}]
*   Configuration (default: `{}`).
* @returns {Extension}
*   Extension for `micromark` that can be passed in `extensions`, to
*   enable math syntax.
*/
function math(options) {
	return {
		flow: { [36]: mathFlow },
		text: { [36]: mathText(options) }
	};
}
/**
* Character codes.
*
* This module is compiled away!
*
* micromark works based on character codes.
* This module contains constants for the ASCII block and the replacement
* character.
* A couple of them are handled in a special way, such as the line endings
* (CR, LF, and CR+LF, commonly known as end-of-line: EOLs), the tab (horizontal
* tab) and its expansion based on what column it’s at (virtual space),
* and the end-of-file (eof) character.
* As values are preprocessed before handling them, the actual characters LF,
* CR, HT, and NUL (which is present as the replacement character), are
* guaranteed to not exist.
*
* Unicode basic latin block.
*/
const codes = {
	carriageReturn: -5,
	lineFeed: -4,
	carriageReturnLineFeed: -3,
	horizontalTab: -2,
	virtualSpace: -1,
	eof: null,
	nul: 0,
	soh: 1,
	stx: 2,
	etx: 3,
	eot: 4,
	enq: 5,
	ack: 6,
	bel: 7,
	bs: 8,
	ht: 9,
	lf: 10,
	vt: 11,
	ff: 12,
	cr: 13,
	so: 14,
	si: 15,
	dle: 16,
	dc1: 17,
	dc2: 18,
	dc3: 19,
	dc4: 20,
	nak: 21,
	syn: 22,
	etb: 23,
	can: 24,
	em: 25,
	sub: 26,
	esc: 27,
	fs: 28,
	gs: 29,
	rs: 30,
	us: 31,
	space: 32,
	exclamationMark: 33,
	quotationMark: 34,
	numberSign: 35,
	dollarSign: 36,
	percentSign: 37,
	ampersand: 38,
	apostrophe: 39,
	leftParenthesis: 40,
	rightParenthesis: 41,
	asterisk: 42,
	plusSign: 43,
	comma: 44,
	dash: 45,
	dot: 46,
	slash: 47,
	digit0: 48,
	digit1: 49,
	digit2: 50,
	digit3: 51,
	digit4: 52,
	digit5: 53,
	digit6: 54,
	digit7: 55,
	digit8: 56,
	digit9: 57,
	colon: 58,
	semicolon: 59,
	lessThan: 60,
	equalsTo: 61,
	greaterThan: 62,
	questionMark: 63,
	atSign: 64,
	uppercaseA: 65,
	uppercaseB: 66,
	uppercaseC: 67,
	uppercaseD: 68,
	uppercaseE: 69,
	uppercaseF: 70,
	uppercaseG: 71,
	uppercaseH: 72,
	uppercaseI: 73,
	uppercaseJ: 74,
	uppercaseK: 75,
	uppercaseL: 76,
	uppercaseM: 77,
	uppercaseN: 78,
	uppercaseO: 79,
	uppercaseP: 80,
	uppercaseQ: 81,
	uppercaseR: 82,
	uppercaseS: 83,
	uppercaseT: 84,
	uppercaseU: 85,
	uppercaseV: 86,
	uppercaseW: 87,
	uppercaseX: 88,
	uppercaseY: 89,
	uppercaseZ: 90,
	leftSquareBracket: 91,
	backslash: 92,
	rightSquareBracket: 93,
	caret: 94,
	underscore: 95,
	graveAccent: 96,
	lowercaseA: 97,
	lowercaseB: 98,
	lowercaseC: 99,
	lowercaseD: 100,
	lowercaseE: 101,
	lowercaseF: 102,
	lowercaseG: 103,
	lowercaseH: 104,
	lowercaseI: 105,
	lowercaseJ: 106,
	lowercaseK: 107,
	lowercaseL: 108,
	lowercaseM: 109,
	lowercaseN: 110,
	lowercaseO: 111,
	lowercaseP: 112,
	lowercaseQ: 113,
	lowercaseR: 114,
	lowercaseS: 115,
	lowercaseT: 116,
	lowercaseU: 117,
	lowercaseV: 118,
	lowercaseW: 119,
	lowercaseX: 120,
	lowercaseY: 121,
	lowercaseZ: 122,
	leftCurlyBrace: 123,
	verticalBar: 124,
	rightCurlyBrace: 125,
	tilde: 126,
	del: 127,
	byteOrderMarker: 65279,
	replacementCharacter: 65533
};
/**
* This module is compiled away!
*
* Parsing markdown comes with a couple of constants, such as minimum or maximum
* sizes of certain sequences.
* Additionally, there are a couple symbols used inside micromark.
* These are all defined here, but compiled away by scripts.
*/
const constants = {
	attentionSideAfter: 2,
	attentionSideBefore: 1,
	atxHeadingOpeningFenceSizeMax: 6,
	autolinkDomainSizeMax: 63,
	autolinkSchemeSizeMax: 32,
	cdataOpeningString: "CDATA[",
	characterGroupPunctuation: 2,
	characterGroupWhitespace: 1,
	characterReferenceDecimalSizeMax: 7,
	characterReferenceHexadecimalSizeMax: 6,
	characterReferenceNamedSizeMax: 31,
	codeFencedSequenceSizeMin: 3,
	contentTypeContent: "content",
	contentTypeDocument: "document",
	contentTypeFlow: "flow",
	contentTypeString: "string",
	contentTypeText: "text",
	hardBreakPrefixSizeMin: 2,
	htmlBasic: 6,
	htmlCdata: 5,
	htmlComment: 2,
	htmlComplete: 7,
	htmlDeclaration: 4,
	htmlInstruction: 3,
	htmlRawSizeMax: 8,
	htmlRaw: 1,
	linkResourceDestinationBalanceMax: 32,
	linkReferenceSizeMax: 999,
	listItemValueSizeMax: 10,
	numericBaseDecimal: 10,
	numericBaseHexadecimal: 16,
	tabSize: 4,
	thematicBreakMarkerCountMin: 3,
	v8MaxSafeChunkSize: 1e4
};
/**
* This module is compiled away!
*
* Here is the list of all types of tokens exposed by micromark, with a short
* explanation of what they include and where they are found.
* In picking names, generally, the rule is to be as explicit as possible
* instead of reusing names.
* For example, there is a `definitionDestination` and a `resourceDestination`,
* instead of one shared name.
*/
const types = {
	data: "data",
	whitespace: "whitespace",
	lineEnding: "lineEnding",
	lineEndingBlank: "lineEndingBlank",
	linePrefix: "linePrefix",
	lineSuffix: "lineSuffix",
	atxHeading: "atxHeading",
	atxHeadingSequence: "atxHeadingSequence",
	atxHeadingText: "atxHeadingText",
	autolink: "autolink",
	autolinkEmail: "autolinkEmail",
	autolinkMarker: "autolinkMarker",
	autolinkProtocol: "autolinkProtocol",
	characterEscape: "characterEscape",
	characterEscapeValue: "characterEscapeValue",
	characterReference: "characterReference",
	characterReferenceMarker: "characterReferenceMarker",
	characterReferenceMarkerNumeric: "characterReferenceMarkerNumeric",
	characterReferenceMarkerHexadecimal: "characterReferenceMarkerHexadecimal",
	characterReferenceValue: "characterReferenceValue",
	codeFenced: "codeFenced",
	codeFencedFence: "codeFencedFence",
	codeFencedFenceSequence: "codeFencedFenceSequence",
	codeFencedFenceInfo: "codeFencedFenceInfo",
	codeFencedFenceMeta: "codeFencedFenceMeta",
	codeFlowValue: "codeFlowValue",
	codeIndented: "codeIndented",
	codeText: "codeText",
	codeTextData: "codeTextData",
	codeTextPadding: "codeTextPadding",
	codeTextSequence: "codeTextSequence",
	content: "content",
	definition: "definition",
	definitionDestination: "definitionDestination",
	definitionDestinationLiteral: "definitionDestinationLiteral",
	definitionDestinationLiteralMarker: "definitionDestinationLiteralMarker",
	definitionDestinationRaw: "definitionDestinationRaw",
	definitionDestinationString: "definitionDestinationString",
	definitionLabel: "definitionLabel",
	definitionLabelMarker: "definitionLabelMarker",
	definitionLabelString: "definitionLabelString",
	definitionMarker: "definitionMarker",
	definitionTitle: "definitionTitle",
	definitionTitleMarker: "definitionTitleMarker",
	definitionTitleString: "definitionTitleString",
	emphasis: "emphasis",
	emphasisSequence: "emphasisSequence",
	emphasisText: "emphasisText",
	escapeMarker: "escapeMarker",
	hardBreakEscape: "hardBreakEscape",
	hardBreakTrailing: "hardBreakTrailing",
	htmlFlow: "htmlFlow",
	htmlFlowData: "htmlFlowData",
	htmlText: "htmlText",
	htmlTextData: "htmlTextData",
	image: "image",
	label: "label",
	labelText: "labelText",
	labelLink: "labelLink",
	labelImage: "labelImage",
	labelMarker: "labelMarker",
	labelImageMarker: "labelImageMarker",
	labelEnd: "labelEnd",
	link: "link",
	paragraph: "paragraph",
	reference: "reference",
	referenceMarker: "referenceMarker",
	referenceString: "referenceString",
	resource: "resource",
	resourceDestination: "resourceDestination",
	resourceDestinationLiteral: "resourceDestinationLiteral",
	resourceDestinationLiteralMarker: "resourceDestinationLiteralMarker",
	resourceDestinationRaw: "resourceDestinationRaw",
	resourceDestinationString: "resourceDestinationString",
	resourceMarker: "resourceMarker",
	resourceTitle: "resourceTitle",
	resourceTitleMarker: "resourceTitleMarker",
	resourceTitleString: "resourceTitleString",
	setextHeading: "setextHeading",
	setextHeadingText: "setextHeadingText",
	setextHeadingLine: "setextHeadingLine",
	setextHeadingLineSequence: "setextHeadingLineSequence",
	strong: "strong",
	strongSequence: "strongSequence",
	strongText: "strongText",
	thematicBreak: "thematicBreak",
	thematicBreakSequence: "thematicBreakSequence",
	blockQuote: "blockQuote",
	blockQuotePrefix: "blockQuotePrefix",
	blockQuoteMarker: "blockQuoteMarker",
	blockQuotePrefixWhitespace: "blockQuotePrefixWhitespace",
	listOrdered: "listOrdered",
	listUnordered: "listUnordered",
	listItemIndent: "listItemIndent",
	listItemMarker: "listItemMarker",
	listItemPrefix: "listItemPrefix",
	listItemPrefixWhitespace: "listItemPrefixWhitespace",
	listItemValue: "listItemValue",
	chunkDocument: "chunkDocument",
	chunkContent: "chunkContent",
	chunkFlow: "chunkFlow",
	chunkText: "chunkText",
	chunkString: "chunkString"
};
// src/client/mathCompatibility.ts
/** Extend upstream dollar-only math syntax with TeX delimiters while reusing its token vocabulary. */
const previousBackslash = function(code) {
	if (code !== codes.backslash) return true;
	const tail = this.events.at(-1);
	/* v8 ignore next -- a previous code necessarily has a preceding event. */
	if (tail === void 0) return false;
	return tail[1].type === types.characterEscape;
};
const tokenizeBackslashMathText = function(effects, ok, nok) {
	return start;
	function start(code) {
		/* v8 ignore next -- the text construct is dispatched only for a backslash. */
		if (code !== codes.backslash) return nok(code);
		effects.enter("mathText");
		effects.enter("mathTextSequence");
		effects.consume(code);
		return open;
	}
	function open(code) {
		if (code !== codes.leftParenthesis) return nok(code);
		effects.consume(code);
		effects.exit("mathTextSequence");
		return between;
	}
	function between(code) {
		if (code === codes.eof) return nok(code);
		if (code === codes.backslash) return effects.attempt({
			partial: true,
			tokenize: tokenizeClose
		}, close, afterCloseAttempt)(code);
		if (markdownLineEnding(code)) {
			effects.enter(types.lineEnding);
			effects.consume(code);
			effects.exit(types.lineEnding);
			return between;
		}
		return dataStart(code);
	}
	function afterCloseAttempt(code) {
		return effects.check({
			partial: true,
			tokenize: tokenizeOpen
		}, nok, dataStart)(code);
	}
	function dataStart(code) {
		effects.enter("mathTextData");
		effects.consume(code);
		return code === codes.backslash ? afterDataBackslash : data;
	}
	function afterDataBackslash(code) {
		if (code === codes.backslash) {
			effects.consume(code);
			return data;
		}
		return data(code);
	}
	function data(code) {
		if (code === codes.eof || code === codes.backslash || markdownLineEnding(code)) {
			effects.exit("mathTextData");
			return between(code);
		}
		effects.consume(code);
		return data;
	}
	function close(code) {
		effects.exit("mathText");
		return ok(code);
	}
	function tokenizeClose(closeEffects, closeOk, closeNok) {
		return slash;
		function slash(code) {
			/* v8 ignore next -- this partial construct is attempted only at a backslash. */
			if (code !== codes.backslash) return closeNok(code);
			closeEffects.enter("mathTextSequence");
			closeEffects.consume(code);
			return parenthesis;
		}
		function parenthesis(code) {
			if (code !== codes.rightParenthesis) return closeNok(code);
			closeEffects.consume(code);
			closeEffects.exit("mathTextSequence");
			return closeOk;
		}
	}
	function tokenizeOpen(openEffects, openOk, openNok) {
		return slash;
		function slash(code) {
			/* v8 ignore next -- the opening check follows a failed close attempt at a backslash. */
			if (code !== codes.backslash) return openNok(code);
			openEffects.enter(types.chunkString);
			openEffects.consume(code);
			return parenthesis;
		}
		function parenthesis(code) {
			if (code !== codes.leftParenthesis) return openNok(code);
			openEffects.consume(code);
			openEffects.exit(types.chunkString);
			return openOk;
		}
	}
};
function createMathFlow(marker, openMarker, closeMarker, multiline) {
	const tokenize = function(effects, ok, nok) {
		const self = this;
		let oddBackslashRun = false;
		const tail = self.events.at(-1);
		const initialSize = tail?.[1].type === types.linePrefix ? tail[2].sliceSerialize(tail[1], true).length : 0;
		return start;
		function start(code) {
			/* v8 ignore next -- the flow construct is dispatched only for its marker. */
			if (code !== marker) return nok(code);
			effects.enter("mathFlow");
			effects.enter("mathFlowFence");
			effects.enter("mathFlowFenceSequence");
			effects.consume(code);
			return open;
		}
		function open(code) {
			if (code !== openMarker) return nok(code);
			effects.consume(code);
			effects.exit("mathFlowFenceSequence");
			effects.exit("mathFlowFence");
			return marker === codes.dollarSign ? afterDollarOpen : content;
		}
		function afterDollarOpen(code) {
			return code === codes.dollarSign ? nok(code) : content(code);
		}
		function content(code) {
			if (code === codes.eof) return nok(code);
			if (code === marker && (marker !== codes.dollarSign || !oddBackslashRun)) return effects.attempt({
				partial: true,
				tokenize: tokenizeClosingFence
			}, closed, afterClosingFenceAttempt)(code);
			if (markdownLineEnding(code)) return multiline ? effects.attempt(nonLazyContinuation, afterContinuation, nok)(code) : nok(code);
			return valueStart(code);
		}
		function afterClosingFenceAttempt(code) {
			return marker === codes.backslash ? effects.check({
				partial: true,
				tokenize: tokenizeOpeningFence
			}, nok, markerValueStart)(code) : markerValueStart(code);
		}
		function afterContinuation(code) {
			return effects.attempt({
				partial: true,
				tokenize: tokenizeClosingFence
			}, closed, initialSize ? factorySpace(effects, content, types.linePrefix, initialSize + 1) : content)(code);
		}
		function valueStart(code) {
			effects.enter("mathFlowValue");
			oddBackslashRun = code === codes.backslash;
			effects.consume(code);
			return value;
		}
		function markerValueStart(code) {
			effects.enter("mathFlowValue");
			oddBackslashRun = false;
			effects.consume(code);
			return valueAfterMarker;
		}
		function valueAfterMarker(code) {
			if (code === marker) {
				effects.consume(code);
				return value;
			}
			return value(code);
		}
		function value(code) {
			if (code === codes.eof || code === marker || markdownLineEnding(code)) {
				effects.exit("mathFlowValue");
				return content(code);
			}
			oddBackslashRun = code === codes.backslash ? !oddBackslashRun : false;
			effects.consume(code);
			return value;
		}
		function closed(code) {
			effects.exit("mathFlow");
			return ok(code);
		}
		function tokenizeClosingFence(closeEffects, closeOk, closeNok) {
			return factorySpace(closeEffects, sequenceStart, types.linePrefix, constants.tabSize);
			function sequenceStart(code) {
				if (code !== marker) return closeNok(code);
				closeEffects.enter("mathFlowFence");
				closeEffects.enter("mathFlowFenceSequence");
				closeEffects.consume(code);
				return sequenceEnd;
			}
			function sequenceEnd(code) {
				if (code !== closeMarker) return closeNok(code);
				closeEffects.consume(code);
				closeEffects.exit("mathFlowFenceSequence");
				return factorySpace(closeEffects, after, types.whitespace);
			}
			function after(code) {
				if (code !== codes.eof && !markdownLineEnding(code)) return closeNok(code);
				closeEffects.exit("mathFlowFence");
				return closeOk(code);
			}
		}
		function tokenizeOpeningFence(openEffects, openOk, openNok) {
			return sequenceStart;
			function sequenceStart(code) {
				/* v8 ignore next -- the opening check follows a failed close attempt at the marker. */
				if (code !== marker) return openNok(code);
				openEffects.enter(types.chunkString);
				openEffects.consume(code);
				return sequenceEnd;
			}
			function sequenceEnd(code) {
				if (code !== openMarker) return openNok(code);
				openEffects.consume(code);
				openEffects.exit(types.chunkString);
				return openOk;
			}
		}
	};
	return {
		concrete: true,
		name: marker === codes.dollarSign ? "sameLineDollarMathFlow" : "backslashMathFlow",
		tokenize
	};
}
const tokenizeNonLazyContinuation = function(effects, ok, nok) {
	const self = this;
	return start;
	function start(code) {
		/* v8 ignore next -- continuation constructs are attempted only after a line ending. */
		if (code === codes.eof) return ok(code);
		/* v8 ignore next -- continuation constructs are attempted only after a line ending. */
		if (!markdownLineEnding(code)) return nok(code);
		effects.enter(types.lineEnding);
		effects.consume(code);
		effects.exit(types.lineEnding);
		return lineStart;
	}
	function lineStart(code) {
		return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
	}
};
const nonLazyContinuation = {
	partial: true,
	tokenize: tokenizeNonLazyContinuation
};
const backslashMathText = {
	name: "backslashMathText",
	previous: previousBackslash,
	tokenize: tokenizeBackslashMathText
};
const backslashMathFlow = createMathFlow(codes.backslash, codes.leftSquareBracket, codes.rightSquareBracket, true);
const sameLineDollarMathFlow = createMathFlow(codes.dollarSign, codes.dollarSign, codes.dollarSign, false);
const backslashMath = {
	flow: {
		[codes.backslash]: backslashMathFlow,
		[codes.dollarSign]: sameLineDollarMathFlow
	},
	text: { [codes.backslash]: backslashMathText }
};
/**
* TeX backslash delimiters and same-line display-dollar blocks as a micromark
* syntax extension reusing `micromark-extension-math`'s token vocabulary; the
* caller must also register `math()` on the same parse so the emitted tokens
* compile to standard math nodes.
* @returns The micromark syntax extension.
*/
function mathCompatibility() {
	return backslashMath;
}
// src/client/softBreaks.ts
/**
* Turns each soft line break in a paragraph into a markdown hard break (two trailing spaces), so
* a message reads line by line as typed — the same rule as remark-breaks. The text is parsed with
* MarkdownText's own settled grammar (GFM + math), so only line endings inside paragraph text
* change; code, math, tables, HTML, inline code and existing hard breaks keep their bytes.
*/
function softBreaksToHard(text) {
	const source = text.replace(/\r\n/g, "\n");
	const tree = fromMarkdown(source, {
		extensions: [
			gfm(),
			mathCompatibility(),
			math()
		],
		mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()]
	});
	const breaks = [];
	const visit = (node, inParagraph) => {
		if (inParagraph && node.type === "text") {
			const start = node.position?.start.offset;
			const end = node.position?.end.offset;
			if (start === void 0 || end === void 0) return;
			for (let i = source.indexOf("\n", start); i !== -1 && i < end; i = source.indexOf("\n", i + 1)) breaks.push(i);
			return;
		}
		for (const child of node.children ?? []) visit(child, inParagraph || node.type === "paragraph");
	};
	visit(tree, false);
	let out = source;
	for (let k = breaks.length - 1; k >= 0; k--) out = out.slice(0, breaks[k]) + "  " + out.slice(breaks[k]);
	return out;
}
// src/client/collab-url.ts
/**
* #236: which DSH a channels panel talks to. The local panel uses the collab paths as they are
* (`collab/api/…`, relative to document.baseURI); a panel opened from 其他电脑 on a paired
* computer sends the same paths through this DSH's forwarder `collab/remote/<link>/…`
* (dsh/collab/pairing.mjs remoteProxyRoute), so mentions, avatars, replies, attachments and the
* task board all read and write the other computer and never this one.
*/
/** Local panel: paths stay as they are. */
const localCollabUrl = (path) => path;
/** A paired link id, as dsh/collab/pairing.mjs PairClient issues them (randomUUID). */
const LINK_ID = /^[0-9a-f-]{36}$/;
/**
* Paths of a paired computer, through this DSH's remote forwarder.
* @param linkId - link id from `GET collab/api/remote/links`.
* @returns the path mapper; non-collab paths (http links) are left alone.
*/
function remoteCollabUrl(linkId) {
	if (!LINK_ID.test(linkId)) throw new Error(`bad remote link id: ${linkId}`);
	const mount = `collab/remote/${linkId}/`;
	return (path) => path.startsWith("collab/") ? mount + path.slice(7) : path;
}
/**
* Same transport with its paths sent to a paired computer.
* @param base - transport bound to this page (browserTransport).
* @param map - path mapper from remoteCollabUrl.
* @returns the remote transport.
*/
function mappedTransport(base, map) {
	return {
		...base,
		url: (path) => base.url(map(path))
	};
}
/** The mapper of the panel a component renders in; the local panel when none is provided. */
const CollabUrlContext = (0, react.createContext)(localCollabUrl);
/** Read the mapper of the surrounding channels panel. */
const useCollabUrl = () => (0, react.useContext)(CollabUrlContext);
// src/client/ChannelsPage.module.css
var ChannelsPage_module_default = {
	"activeBusy": "dshc_activeBusy",
	"activeCount": "dshc_activeCount",
	"activityItem": "dshc_activityItem",
	"activityName": "dshc_activityName",
	"activityNow": "dshc_activityNow",
	"activityPulse": "dshc_activityPulse",
	"activityText": "dshc_activityText",
	"activityWhat": "dshc_activityWhat",
	"addMemberButton": "dshc_addMemberButton",
	"askDone": "dshc_askDone",
	"askForm": "dshc_askForm",
	"askFrom": "dshc_askFrom",
	"askInput": "dshc_askInput",
	"askItem": "dshc_askItem",
	"askKind": "dshc_askKind",
	"askList": "dshc_askList",
	"askNotice": "dshc_askNotice",
	"askQuestion": "dshc_askQuestion",
	"askSend": "dshc_askSend",
	"askText": "dshc_askText",
	"attachmentActions": "dshc_attachmentActions",
	"attachmentAudio": "dshc_attachmentAudio",
	"attachmentFile": "dshc_attachmentFile",
	"attachmentImage": "dshc_attachmentImage",
	"attachments": "dshc_attachments",
	"attachmentSize": "dshc_attachmentSize",
	"attachmentThumb": "dshc_attachmentThumb",
	"author": "dshc_author",
	"avatar": "dshc_avatar",
	"avatarAnchor": "dshc_avatarAnchor",
	"avatarButton": "dshc_avatarButton",
	"avatarCropFrame": "dshc_avatarCropFrame",
	"avatarCropStage": "dshc_avatarCropStage",
	"avatarImage": "dshc_avatarImage",
	"avatarMenu": "dshc_avatarMenu",
	"avatarMenuItem": "dshc_avatarMenuItem",
	"avatarMenuTitle": "dshc_avatarMenuTitle",
	"avatarOption": "dshc_avatarOption",
	"avatarPicker": "dshc_avatarPicker",
	"avatarSmall": "dshc_avatarSmall",
	"avatarStack": "dshc_avatarStack",
	"boardCardGrid": "dshc_boardCardGrid",
	"boardDrawerBackdrop": "dshc_boardDrawerBackdrop",
	"boardDrawerIn": "dshc_boardDrawerIn",
	"boardTabCount": "dshc_boardTabCount",
	"boardTabEmpty": "dshc_boardTabEmpty",
	"boardTabs": "dshc_boardTabs",
	"boardTaskCard": "dshc_boardTaskCard",
	"boardTaskHeader": "dshc_boardTaskHeader",
	"boardTaskTitle": "dshc_boardTaskTitle",
	"bubbleLine": "dshc_bubbleLine",
	"capabilityHelp": "dshc_capabilityHelp",
	"capabilityItem": "dshc_capabilityItem",
	"capabilityMenu": "dshc_capabilityMenu",
	"card": "dshc_card",
	"cardButtons": "dshc_cardButtons",
	"cardDetail": "dshc_cardDetail",
	"cardHead": "dshc_cardHead",
	"cardTitle": "dshc_cardTitle",
	"cardViewButton": "dshc_cardViewButton",
	"cardViews": "dshc_cardViews",
	"channels-blink": "dshc_channels-blink",
	"channels-pulse": "dshc_channels-pulse",
	"channels-spin": "dshc_channels-spin",
	"channelsDot": "dshc_channelsDot",
	"channelsDrain": "dshc_channelsDrain",
	"channelsEnter": "dshc_channelsEnter",
	"channelsEnterOwn": "dshc_channelsEnterOwn",
	"channelsGlow": "dshc_channelsGlow",
	"channelsPop": "dshc_channelsPop",
	"chat": "dshc_chat",
	"chatHead": "dshc_chatHead",
	"choice": "dshc_choice",
	"choiceColumn": "dshc_choiceColumn",
	"choiceRow": "dshc_choiceRow",
	"cmdLine": "dshc_cmdLine",
	"cmdResult": "dshc_cmdResult",
	"composer": "dshc_composer",
	"composerBox": "dshc_composerBox",
	"composerToolbar": "dshc_composerToolbar",
	"decideTray": "dshc_decideTray",
	"decideTrayHead": "dshc_decideTrayHead",
	"decideTrayToggle": "dshc_decideTrayToggle",
	"delivery": "dshc_delivery",
	"deliveryActions": "dshc_deliveryActions",
	"deliveryDone": "dshc_deliveryDone",
	"deliveryFrame": "dshc_deliveryFrame",
	"deliveryFullDialog": "dshc_deliveryFullDialog",
	"deliveryFullFrame": "dshc_deliveryFullFrame",
	"dialog": "dshc_dialog",
	"dialogActions": "dshc_dialogActions",
	"dialogBackdrop": "dshc_dialogBackdrop",
	"dialogTitle": "dshc_dialogTitle",
	"dmAvatar": "dshc_dmAvatar",
	"dmClose": "dshc_dmClose",
	"dmHead": "dshc_dmHead",
	"dmNewRow": "dshc_dmNewRow",
	"dmPicker": "dshc_dmPicker",
	"dmPickNone": "dshc_dmPickNone",
	"dmRow": "dshc_dmRow",
	"dmTitle": "dshc_dmTitle",
	"drawerBackdrop": "dshc_drawerBackdrop",
	"drawerOpen": "dshc_drawerOpen",
	"drawerTools": "dshc_drawerTools",
	"editBar": "dshc_editBar",
	"editBox": "dshc_editBox",
	"edited": "dshc_edited",
	"editInput": "dshc_editInput",
	"empty": "dshc_empty",
	"enter": "dshc_enter",
	"enterGlow": "dshc_enterGlow",
	"enterOwn": "dshc_enterOwn",
	"errorBar": "dshc_errorBar",
	"errorIcon": "dshc_errorIcon",
	"errorText": "dshc_errorText",
	"field": "dshc_field",
	"fieldInput": "dshc_fieldInput",
	"focused": "dshc_focused",
	"grouped": "dshc_grouped",
	"groupHead": "dshc_groupHead",
	"groupTitle": "dshc_groupTitle",
	"guide": "dshc_guide",
	"gutterTime": "dshc_gutterTime",
	"hash": "dshc_hash",
	"headActivity": "dshc_headActivity",
	"headActivityText": "dshc_headActivityText",
	"headLead": "dshc_headLead",
	"headLeadName": "dshc_headLeadName",
	"headLeadStatus": "dshc_headLeadStatus",
	"headLeadText": "dshc_headLeadText",
	"headMeta": "dshc_headMeta",
	"headSpacer": "dshc_headSpacer",
	"headTeam": "dshc_headTeam",
	"iconButton": "dshc_iconButton",
	"imageAttachment": "dshc_imageAttachment",
	"imagePreviewActions": "dshc_imagePreviewActions",
	"imagePreviewDialog": "dshc_imagePreviewDialog",
	"imagePreviewHeader": "dshc_imagePreviewHeader",
	"imagePreviewImage": "dshc_imagePreviewImage",
	"imagePreviewTrigger": "dshc_imagePreviewTrigger",
	"input": "dshc_input",
	"inputComposing": "dshc_inputComposing",
	"inputHighlights": "dshc_inputHighlights",
	"inputMention": "dshc_inputMention",
	"inputSurface": "dshc_inputSurface",
	"jumpCount": "dshc_jumpCount",
	"jumpLatest": "dshc_jumpLatest",
	"leadCard": "dshc_leadCard",
	"leadCardButton": "dshc_leadCardButton",
	"leadCardHint": "dshc_leadCardHint",
	"leadCardName": "dshc_leadCardName",
	"leadCardStatus": "dshc_leadCardStatus",
	"leadCardText": "dshc_leadCardText",
	"linkButton": "dshc_linkButton",
	"log": "dshc_log",
	"logWrap": "dshc_logWrap",
	"mate": "dshc_mate",
	"mateDot": "dshc_mateDot",
	"mateMore": "dshc_mateMore",
	"member": "dshc_member",
	"memberActions": "dshc_memberActions",
	"memberAvatar": "dshc_memberAvatar",
	"memberFailed": "dshc_memberFailed",
	"memberListDivider": "dshc_memberListDivider",
	"memberModel": "dshc_memberModel",
	"memberName": "dshc_memberName",
	"memberRow": "dshc_memberRow",
	"members": "dshc_members",
	"membersHead": "dshc_membersHead",
	"membersHeadTitle": "dshc_membersHeadTitle",
	"membersHidden": "dshc_membersHidden",
	"memberStatus": "dshc_memberStatus",
	"memberText": "dshc_memberText",
	"memory": "dshc_memory",
	"memoryBadge": "dshc_memoryBadge",
	"memoryItem": "dshc_memoryItem",
	"memoryList": "dshc_memoryList",
	"memoryPage": "dshc_memoryPage",
	"memoryTitle": "dshc_memoryTitle",
	"mentionActive": "dshc_mentionActive",
	"mentionBadge": "dshc_mentionBadge",
	"mentionButton": "dshc_mentionButton",
	"mentionHint": "dshc_mentionHint",
	"mentionItem": "dshc_mentionItem",
	"mentionMeta": "dshc_mentionMeta",
	"mentionName": "dshc_mentionName",
	"mentionPopup": "dshc_mentionPopup",
	"mentionTitle": "dshc_mentionTitle",
	"message": "dshc_message",
	"messageBody": "dshc_messageBody",
	"messageHead": "dshc_messageHead",
	"messageHeadGrouped": "dshc_messageHeadGrouped",
	"mobileButton": "dshc_mobileButton",
	"msgTool": "dshc_msgTool",
	"msgToolNote": "dshc_msgToolNote",
	"msgToolNoteBelow": "dshc_msgToolNoteBelow",
	"msgTools": "dshc_msgTools",
	"notice": "dshc_notice",
	"offline": "dshc_offline",
	"olderLoading": "dshc_olderLoading",
	"own": "dshc_own",
	"ownActions": "dshc_ownActions",
	"page": "dshc_page",
	"panelOpen": "dshc_panelOpen",
	"panelToggle": "dshc_panelToggle",
	"panelToggleEnd": "dshc_panelToggleEnd",
	"permActions": "dshc_permActions",
	"permInline": "dshc_permInline",
	"permLock": "dshc_permLock",
	"permScope": "dshc_permScope",
	"permSessionButton": "dshc_permSessionButton",
	"permStatus": "dshc_permStatus",
	"permTray": "dshc_permTray",
	"permTrayItem": "dshc_permTrayItem",
	"permTrayText": "dshc_permTrayText",
	"permTrayWho": "dshc_permTrayWho",
	"permWaiting": "dshc_permWaiting",
	"presence": "dshc_presence",
	"primaryButton": "dshc_primaryButton",
	"progressCard": "dshc_progressCard",
	"progressChevron": "dshc_progressChevron",
	"progressHead": "dshc_progressHead",
	"progressLink": "dshc_progressLink",
	"progressRow": "dshc_progressRow",
	"progressRows": "dshc_progressRows",
	"progressSummary": "dshc_progressSummary",
	"progressTitle": "dshc_progressTitle",
	"progressToggle": "dshc_progressToggle",
	"queuedButton": "dshc_queuedButton",
	"queuedTag": "dshc_queuedTag",
	"quote": "dshc_quote",
	"quoteAuthor": "dshc_quoteAuthor",
	"quoteDeleted": "dshc_quoteDeleted",
	"replyBar": "dshc_replyBar",
	"replyBarText": "dshc_replyBarText",
	"replyButton": "dshc_replyButton",
	"replyCancel": "dshc_replyCancel",
	"room": "dshc_room",
	"roomActive": "dshc_roomActive",
	"roomInput": "dshc_roomInput",
	"roomLabel": "dshc_roomLabel",
	"roomName": "dshc_roomName",
	"rooms": "dshc_rooms",
	"roomsHidden": "dshc_roomsHidden",
	"roomUnread": "dshc_roomUnread",
	"roomWorking": "dshc_roomWorking",
	"roomWorkingDot": "dshc_roomWorkingDot",
	"roomWorkingPulse": "dshc_roomWorkingPulse",
	"runHead": "dshc_runHead",
	"runIcon": "dshc_runIcon",
	"runSteps": "dshc_runSteps",
	"runStrip": "dshc_runStrip",
	"runSummary": "dshc_runSummary",
	"runTitle": "dshc_runTitle",
	"schemeToggle": "dshc_schemeToggle",
	"secondaryButton": "dshc_secondaryButton",
	"sendButton": "dshc_sendButton",
	"sendError": "dshc_sendError",
	"settingsBody": "dshc_settingsBody",
	"settingsButton": "dshc_settingsButton",
	"settingsDialog": "dshc_settingsDialog",
	"settingsDivider": "dshc_settingsDivider",
	"settingsFeedback": "dshc_settingsFeedback",
	"settingsFields": "dshc_settingsFields",
	"sideDock": "dshc_sideDock",
	"sidePanel": "dshc_sidePanel",
	"sidePanelClose": "dshc_sidePanelClose",
	"slashActive": "dshc_slashActive",
	"slashDisabled": "dshc_slashDisabled",
	"slashGroup": "dshc_slashGroup",
	"slashItem": "dshc_slashItem",
	"slashMeta": "dshc_slashMeta",
	"slashName": "dshc_slashName",
	"slashPopup": "dshc_slashPopup",
	"stackDot": "dshc_stackDot",
	"stepChip": "dshc_stepChip",
	"stepChips": "dshc_stepChips",
	"stepMark": "dshc_stepMark",
	"stepOut": "dshc_stepOut",
	"stopButton": "dshc_stopButton",
	"stopNote": "dshc_stopNote",
	"system": "dshc_system",
	"systemLine": "dshc_systemLine",
	"systemRecord": "dshc_systemRecord",
	"systemText": "dshc_systemText",
	"tag": "dshc_tag",
	"taskAnchor": "dshc_taskAnchor",
	"taskBoardBody": "dshc_taskBoardBody",
	"taskBoardDialog": "dshc_taskBoardDialog",
	"taskBoardScope": "dshc_taskBoardScope",
	"taskBoardSummary": "dshc_taskBoardSummary",
	"taskBoardTrigger": "dshc_taskBoardTrigger",
	"taskCard": "dshc_taskCard",
	"taskDone": "dshc_taskDone",
	"taskEmpty": "dshc_taskEmpty",
	"taskLine": "dshc_taskLine",
	"taskLinks": "dshc_taskLinks",
	"taskList": "dshc_taskList",
	"taskMember": "dshc_taskMember",
	"taskMemberName": "dshc_taskMemberName",
	"taskMembers": "dshc_taskMembers",
	"taskMeta": "dshc_taskMeta",
	"taskOwnerGroup": "dshc_taskOwnerGroup",
	"taskOwnerName": "dshc_taskOwnerName",
	"taskRecord": "dshc_taskRecord",
	"taskRow": "dshc_taskRow",
	"taskSection": "dshc_taskSection",
	"taskSectionTitle": "dshc_taskSectionTitle",
	"taskStatus": "dshc_taskStatus",
	"taskSub": "dshc_taskSub",
	"taskTitle": "dshc_taskTitle",
	"text": "dshc_text",
	"time": "dshc_time",
	"typingDots": "dshc_typingDots",
	"undoBar": "dshc_undoBar",
	"undoButton": "dshc_undoButton",
	"undoToast": "dshc_undoToast",
	"unreadBadge": "dshc_unreadBadge",
	"unreadDivider": "dshc_unreadDivider",
	"uploadBar": "dshc_uploadBar",
	"uploadFill": "dshc_uploadFill",
	"uploadState": "dshc_uploadState",
	"withdrawnRow": "dshc_withdrawnRow",
	"working": "dshc_working",
	"workspace": "dshc_workspace"
};
// src/client/scheme.ts
const SCHEME_KEY = "dsh-channels-scheme";
const DEFAULT_SCHEME = "light";
const listeners = /* @__PURE__ */ new Set();
let current;
function readStored() {
	try {
		const raw = globalThis.localStorage?.getItem(SCHEME_KEY);
		return raw === "dark" || raw === "light" ? raw : DEFAULT_SCHEME;
	} catch (error) {
		return DEFAULT_SCHEME;
	}
}
let host;
function notify() {
	for (const fn of listeners) fn();
}
/** Follow the host theme from now on; the returned function lets go of it. */
function bindHostTheme(next) {
	host = next;
	current = next.scheme();
	notify();
	const off = next.subscribe(() => {
		if (host !== next) return;
		current = next.scheme();
		notify();
	});
	return () => {
		off();
		if (host !== next) return;
		host = void 0;
		current = void 0;
		notify();
	};
}
function getScheme() {
	return current ??= readStored();
}
function setScheme(next) {
	current = next;
	if (host !== void 0) try {
		host.set(next);
	} catch (error) {}
	try {
		globalThis.localStorage?.setItem(SCHEME_KEY, next);
	} catch (error) {}
	for (const fn of listeners) fn();
}
function subscribe(fn) {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}
/** Current plugin scheme; put it on every plugin root as data-dc-scheme (page and body portals). */
function useScheme() {
	return (0, react.useSyncExternalStore)(subscribe, getScheme, getScheme);
}
// src/client/Attachments.tsx
const isImage = (mime) => /^image\/(png|jpeg|gif|webp)$/.test(mime);
const isAudio = (mime) => mime.startsWith("audio/");
const size = formatBytes;
function ImageAttachment({ attachment: a, t }) {
	const url = useCollabUrl();
	const attachmentUrl$1 = (id) => url(attachmentUrl(id));
	const [opened, setOpened] = (0, react.useState)(false);
	const trigger = (0, react.useRef)(null);
	const dialog = (0, react.useRef)(null);
	const closeButton = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		if (!opened) return;
		const origin = trigger.current;
		closeButton.current?.focus();
		const containFocus = (event) => {
			if (!dialog.current?.contains(event.target)) closeButton.current?.focus();
		};
		document.addEventListener("focusin", containFocus);
		return () => {
			document.removeEventListener("focusin", containFocus);
			origin?.focus();
		};
	}, [opened]);
	const [copyState, setCopyState] = (0, react.useState)("idle");
	(0, react.useEffect)(() => {
		if (copyState !== "copied") return;
		const timer = setTimeout(() => setCopyState("idle"), 2e3);
		return () => clearTimeout(timer);
	}, [copyState]);
	const copy = async () => {
		if (copyState === "copying") return;
		setCopyState("copying");
		try {
			if (typeof navigator.clipboard?.write !== "function" || typeof ClipboardItem === "undefined") {
				setCopyState("error");
				return;
			}
			const response = await fetch(attachmentUrl$1(a.id));
			if (!response.ok) throw new Error("Image download failed");
			const blob = await response.blob();
			await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
			setCopyState("copied");
		} catch {
			setCopyState("error");
		}
	};
	const copyLabel = t(copyState === "copied" ? "attachmentCopied" : copyState === "copying" ? "attachmentCopying" : "attachmentCopy");
	const actions = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
		className: copyState === "error" ? ChannelsPage_module_default.primaryButton : ChannelsPage_module_default.secondaryButton,
		href: attachmentUrl$1(a.id),
		download: a.name,
		target: "_blank",
		rel: "noreferrer",
		"aria-label": t("attachmentDownload"),
		children: t("attachmentDownload")
	}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		className: ChannelsPage_module_default.secondaryButton,
		onClick: () => {
			copy();
		},
		disabled: copyState === "copying",
		"aria-label": copyLabel,
		"aria-live": "polite",
		children: copyLabel
	})] });
	const error = copyState === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.sendError,
		role: "alert",
		children: t("attachmentCopyError")
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.imageAttachment,
		"data-copy-state": copyState,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				ref: trigger,
				type: "button",
				className: ChannelsPage_module_default.imagePreviewTrigger,
				title: a.name,
				"aria-haspopup": "dialog",
				"aria-expanded": opened,
				onClick: () => setOpened(true),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: ChannelsPage_module_default.attachmentImage,
					src: attachmentUrl$1(a.id),
					alt: a.name,
					loading: "lazy"
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.attachmentActions,
				children: actions
			}),
			!opened && error,
			opened && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.dialogBackdrop,
				"data-dc-scheme": getScheme(),
				onClick: (event) => {
					if (event.target === event.currentTarget) setOpened(false);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					ref: dialog,
					className: `${ChannelsPage_module_default.dialog} ${ChannelsPage_module_default.imagePreviewDialog}`,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": a.name,
					tabIndex: -1,
					onKeyDown: (event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							setOpened(false);
						}
						if (event.key === "Tab") {
							const controls = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled), a[href]"));
							const first = controls[0];
							const last = controls[controls.length - 1];
							if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
								event.preventDefault();
								last?.focus();
							} else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
								event.preventDefault();
								first?.focus();
							}
						}
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.imagePreviewHeader,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: a.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								ref: closeButton,
								type: "button",
								className: ChannelsPage_module_default.secondaryButton,
								"aria-label": t("close"),
								onClick: () => setOpened(false),
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							className: ChannelsPage_module_default.imagePreviewImage,
							src: attachmentUrl$1(a.id),
							alt: a.name
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.imagePreviewActions,
							children: actions
						}),
						error
					]
				})
			}), document.body)
		]
	});
}
/** Thumbnails for images, a download card for other files. */
function AttachmentList({ attachments, t }) {
	const url = useCollabUrl();
	const attachmentUrl$2 = (id) => url(attachmentUrl(id));
	if (attachments === void 0 || attachments.length === 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.attachments,
		children: attachments.map((a) => isImage(a.mime) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ImageAttachment, {
			attachment: a,
			t
		}, a.id) : isAudio(a.mime) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: ChannelsPage_module_default.attachmentAudio,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
				controls: true,
				preload: "metadata",
				src: attachmentUrl$2(a.id),
				title: a.name
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
				className: ChannelsPage_module_default.attachmentSize,
				href: attachmentUrl$2(a.id),
				download: a.name,
				children: [
					a.name,
					" · ",
					size(a.size)
				]
			})]
		}, a.id) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
			className: ChannelsPage_module_default.attachmentFile,
			href: attachmentUrl$2(a.id),
			download: a.name,
			children: [
				"📎 ",
				a.name,
				" ",
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ChannelsPage_module_default.attachmentSize,
					children: size(a.size)
				})
			]
		}, a.id))
	});
}
/** Files carried by a paste or drop event (empty when it is plain text). */
const eventFiles = (list) => list === null ? [] : Array.from(list.files);
/**
* Composer helpers: an attach button with its hidden file input, the pending
* list with remove buttons, and paste/drop handlers for the textarea.
*/
function useComposerAttachments(add) {
	const inputRef = (0, react.useRef)(null);
	const take = (files) => {
		if (files.length === 0) return;
		add(files);
	};
	return {
		onPaste(event) {
			const files = eventFiles(event.clipboardData);
			if (files.length === 0) return;
			event.preventDefault();
			take(files);
		},
		onDragOver(event) {
			if (event.dataTransfer.types.includes("Files")) event.preventDefault();
		},
		onDrop(event) {
			const files = eventFiles(event.dataTransfer);
			if (files.length === 0) return;
			event.preventDefault();
			take(files);
		},
		button(label, disabled) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				ref: inputRef,
				type: "file",
				multiple: true,
				hidden: true,
				onChange: (event) => {
					take(Array.from(event.target.files ?? []));
					event.target.value = "";
				}
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.mentionButton,
				title: label,
				"aria-label": label,
				disabled,
				onClick: () => inputRef.current?.click(),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					width: "20",
					height: "20",
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "1.5",
					strokeLinecap: "round",
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 5v14M5 12h14" })
				})
			})] });
		}
	};
}
/** Files waiting to be sent with the next message, each with its upload progress. */
function PendingAttachments({ files, onRemove, removeLabel, labels }) {
	if (files.length === 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.attachments,
		children: files.map((f) => {
			const percent = Math.round(f.progress * 100);
			const state = f.error !== void 0 ? f.error : f.attachment !== void 0 ? "" : percent > 0 ? labels.uploading : labels.queued;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ChannelsPage_module_default.attachmentFile,
				"data-state": f.error !== void 0 ? "failed" : f.attachment !== void 0 ? "done" : "uploading",
				children: [
					f.preview !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
						className: ChannelsPage_module_default.attachmentThumb,
						src: f.preview,
						alt: f.name
					}) : "📎",
					" ",
					f.name,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.attachmentSize,
						children: size(f.size)
					}),
					f.attachment === void 0 && f.error === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.uploadBar,
						role: "progressbar",
						"aria-valuenow": percent,
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-label": `${f.name} ${percent}%`,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ChannelsPage_module_default.uploadFill,
							style: { width: `${percent}%` }
						})
					}),
					state !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.uploadState,
						children: state
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.replyCancel,
						title: removeLabel,
						"aria-label": removeLabel,
						onClick: () => onRemove(f.key),
						children: "×"
					})
				]
			}, f.key);
		})
	});
}
// src/client/PanelPages.module.css
var PanelPages_module_default = {
	"embed": "dshc_embed",
	"frame": "dshc_frame",
	"remote": "dshc_remote",
	"remoteBack": "dshc_remoteBack",
	"remoteBar": "dshc_remoteBar",
	"remoteBody": "dshc_remoteBody",
	"remoteName": "dshc_remoteName"
};
// src/client/EmbedPage.tsx
/**
* The frame both the panel and the delivery card (#1023) use. `sandboxed` is for pages the
* owner did not write (a bot's delivery): scripts run, but a page from this origin gets an
* opaque origin so it cannot act with the owner's sign-in.
*/
function EmbedFrame({ src, title, sandboxed = false, sameOrigin = false }) {
	const sandbox = !sandboxed ? void 0 : sameOrigin ? "allow-scripts allow-forms allow-popups allow-modals" : "allow-scripts allow-forms allow-popups allow-modals allow-same-origin";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
		className: PanelPages_module_default.frame,
		src,
		title,
		sandbox,
		loading: "lazy",
		referrerPolicy: sandboxed ? "no-referrer" : "same-origin"
	});
}
// src/client/DeliveryPreview.tsx
/**
* #1023 交付卡放能点的网页: when a hand-back (a task's result message) delivers a web page —
* an uploaded .html file or an http(s) link — the card shows the page itself in a sandboxed
* frame, with 全屏, 继续改 and 收下 beside it, so the owner does not download and reopen it.
* Any other delivery keeps the plain card.
*/
/** True for an uploaded web page (by type or by name). */
const isHtmlAttachment = (a) => /^text\/html\b/i.test(a.mime) || /\.html?$/i.test(a.name);
/** First http(s) URL in a message, markdown link or bare; undefined when there is none. */
function firstWebLink(text) {
	return /https?:\/\/[^\s<>()\]"'`]+/i.exec(text)?.[0].replace(/[.,;:!?。，；：！？]+$/, "");
}
/** The web page this message delivers: an .html upload first, else the first link. */
function deliverableOf(message, url = (path) => path) {
	const page = message.attachments?.find(isHtmlAttachment);
	if (page !== void 0) return {
		src: `${url(attachmentUrl(page.id))}?view=page`,
		title: page.name,
		sameOrigin: true
	};
	const link = firstWebLink(message.text);
	if (link === void 0) return void 0;
	let sameOrigin = false;
	try {
		sameOrigin = new URL(link, document.baseURI).origin === window.location.origin;
	} catch {
		return;
	}
	return {
		src: link,
		title: link,
		sameOrigin
	};
}
/** Tasks this message was handed back for (TaskBoard result_msg_id). */
const deliveredTasks = (message, tasks) => tasks.filter((task) => task.result_msg_id === message.id);
function DeliveryPreview({ page, task, t, onReview, onRevise }) {
	const [full, setFull] = (0, react.useState)(false);
	const [state, setState] = (0, react.useState)("idle");
	const closeRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		if (full) closeRef.current?.focus();
	}, [full]);
	const waiting = task !== void 0 && task.status === "returned" && onReview !== void 0;
	const accept = () => {
		if (task === void 0 || onReview === void 0 || state === "saving") return;
		setState("saving");
		onReview(task.id, "done").then(() => {
			setState("idle");
		}, () => {
			setState("error");
		});
	};
	const actions = (inDialog) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.deliveryActions,
		children: [
			!inDialog && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.secondaryButton,
				onClick: () => {
					setFull(true);
				},
				children: t("deliveryFull")
			}),
			waiting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.secondaryButton,
				onClick: () => {
					setFull(false);
					onRevise();
				},
				children: t("deliveryRevise")
			}),
			waiting && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.primaryButton,
				disabled: state === "saving",
				onClick: accept,
				children: t("deliveryAccept")
			}),
			task?.status === "done" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.deliveryDone,
				children: t("deliveryAccepted")
			}),
			state === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.sendError,
				role: "alert",
				children: t("deliveryAcceptFailed")
			})
		]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.delivery,
		"data-delivery-preview": true,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.deliveryFrame,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmbedFrame, {
					src: page.src,
					title: page.title,
					sandboxed: true,
					sameOrigin: page.sameOrigin
				})
			}),
			actions(false),
			full && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.dialogBackdrop,
				"data-dc-scheme": getScheme(),
				onClick: (event) => {
					if (event.target === event.currentTarget) setFull(false);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: `${ChannelsPage_module_default.dialog} ${ChannelsPage_module_default.deliveryFullDialog}`,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": page.title,
					onKeyDown: (event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							setFull(false);
						}
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.imagePreviewHeader,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: page.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								ref: closeRef,
								type: "button",
								className: ChannelsPage_module_default.secondaryButton,
								"aria-label": t("close"),
								onClick: () => {
									setFull(false);
								},
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.deliveryFullFrame,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmbedFrame, {
								src: page.src,
								title: page.title,
								sandboxed: true,
								sameOrigin: page.sameOrigin
							})
						}),
						actions(true)
					]
				})
			}), document.body)
		]
	});
}
// src/client/task-board.ts
/** Locale key of each status label (dsh/collab/tasks.mjs STATUS). */
const STATUS_KEY = {
	assigned: "taskAssigned",
	accepted: "taskAccepted",
	asked: "taskAsked",
	declined: "taskDeclined",
	escalated: "taskEscalated",
	returned: "taskReturned",
	done: "taskDone",
	rework: "taskRework",
	cancelled: "taskCancelled",
	superseded: "taskSuperseded",
	failed: "taskFailed"
};
const DECIDE = [
	"asked",
	"returned",
	"declined",
	"escalated",
	"failed"
];
const isTerminalTask = (task) => [
	"done",
	"cancelled",
	"superseded"
].includes(task.status);
function boardGroupOf(task) {
	if (DECIDE.includes(task.status)) return "decide";
	if (isTerminalTask(task)) return "done";
	return task.paused_at != null ? "parked" : "working";
}
/** Live work on the owner's side, for Activity and the busy marks: open and not parked
* (paused_at), the same rule the board uses to move a task out of 在做. */
const LIVE = [
	"assigned",
	"accepted",
	"asked",
	"rework"
];
const isLiveTask = (task) => task.paused_at == null && LIVE.includes(task.status);
/** Single source for tab membership and board ordering; `groups` empty means all tasks.
* The board opens on the first group that has tasks, 等你定 when all are empty. */
const BOARD_TABS = [
	{
		id: "decide",
		label: "taskTabDecide",
		groups: ["decide"],
		initial: true
	},
	{
		id: "working",
		label: "taskTabWorking",
		groups: ["working"]
	},
	{
		id: "parked",
		label: "taskTabParked",
		groups: ["parked"]
	},
	{
		id: "all",
		label: "taskTabAll",
		groups: []
	}
];
const ORDER = [
	"decide",
	"working",
	"parked",
	"done"
];
const groupOf = (task) => ORDER.indexOf(boardGroupOf(task));
/** Whether a task shows under a tab. */
const inTab = (tab, task) => tab.groups.length === 0 || tab.groups.includes(boardGroupOf(task));
/** Board rows, grouped as above and newest first inside a group. */
function boardOrder(tasks) {
	return [...tasks].sort((a, b) => groupOf(a) - groupOf(b) || b.id - a.id);
}
/** Seconds a task has taken: until hand-back, until it closed, or until now. */
function elapsed(task, now) {
	const end = task.returned_at ?? (isTerminalTask(task) ? task.updated_at : now);
	return Math.max(0, end - task.created_at);
}
/** Elapsed time as words (unit conversions only). */
function formatDuration(seconds, t) {
	const s = Math.round(seconds);
	if (s < 60) return t("durSeconds", { n: String(s) });
	if (s < 3600) return t("durMinutes", { n: String(Math.round(s / 60)) });
	return t("durHours", {
		h: String(Math.floor(s / 3600)),
		m: String(Math.round(s % 3600 / 60))
	});
}
/** Task-card rows: the task's owner first, then each sub-task in dispatch order. */
function cardMembers(taskId, tasks) {
	const task = tasks.find((x) => x.id === taskId);
	if (task === void 0) return [];
	return [task, ...tasks.filter((x) => x.parent_task === task.id).sort((a, b) => a.id - b.id)];
}
/**
* Heading of a board block: the room's own name, for the chat channel as for a workspace.
* A fixed "chat channel" label hid which channel a board belongs to once several chat
* channels are in use.
*/
function sectionTitle(section, t) {
	return t(section.chat ? "taskBoardChat" : "taskBoardWorkspace", { room: section.name });
}
/**
* The board grouped as chat channel -> workspace -> owner, the shape the owner asked for:
* a chat channel's board covers all of its workspaces, and inside each block the tasks are
* listed per member. A task belongs to the room it was dispatched in (its room_id); the
* board only reads that, it never infers a room from a name.
* `chatId` is the chat channel the board belongs to, `roomId` the room being viewed: a
* workspace shows only its own block, the chat channel shows itself and its workspaces.
* Rooms without tasks are left out; the viewed room itself always stays, so an empty
* board still says which room it is.
*/
function boardSections(tasks, rooms, chatId, roomId) {
	if (chatId === void 0) return [];
	const chat = rooms.find((r) => r.id === chatId);
	const viewed = roomId === void 0 ? void 0 : rooms.find((r) => r.id === roomId);
	const blocks = viewed?.kind === "workspace" ? [{
		id: viewed.id,
		name: viewed.name,
		chat: false
	}] : [{
		id: chatId,
		name: chat?.name ?? String(chatId),
		chat: true
	}, ...rooms.filter((r) => r.kind === "workspace" && (r.parent_id === chatId || tasks.some((task) => task.room_id === r.id && task.paused_at != null))).map((r) => ({
		id: r.id,
		name: r.name,
		chat: false
	}))];
	const sections = [];
	for (const block of blocks) {
		const mine = boardOrder(tasks.filter((task) => task.room_id === block.id));
		if (block.id !== roomId && !block.chat && mine.length === 0) continue;
		const byOwner = /* @__PURE__ */ new Map();
		for (const task of mine) {
			let group = byOwner.get(task.owner);
			if (group === void 0) {
				group = {
					open: [],
					done: []
				};
				byOwner.set(task.owner, group);
			}
			(isTerminalTask(task) ? group.done : group.open).push(task);
		}
		const owners = [...byOwner].map(([owner, group]) => ({
			owner,
			ownerName: (group.open[0] ?? group.done[0]).owner_name,
			open: group.open,
			done: group.done
		}));
		sections.push({
			roomId: block.id,
			name: block.name,
			chat: block.chat,
			owners,
			open: owners.reduce((n, g) => n + g.open.length, 0),
			done: owners.reduce((n, g) => n + g.done.length, 0)
		});
	}
	return sections;
}
// src/client/TaskBoard.tsx
/**
* Team mode B (#139): the task board beside the channel (who, what, status,
* when it is next checked) and the task card shown for task records in the
* message stream (one row per member: the task owner and its sub-tasks, each
* with its elapsed time). Data comes from the snapshot's `tasks`.
*/
function clock(seconds) {
	return (/* @__PURE__ */ new Date(seconds * 1e3)).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
}
function Status({ status, t }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: ChannelsPage_module_default.taskStatus,
		"data-status": status,
		children: t(STATUS_KEY[status])
	});
}
/**
* Right-column board for the selected chat channel.
* @param onOpen - jump to a message in a room (dispatch or delivery).
*/
/** Wide enough for the board to sit beside the chat (#125, owner's 11:53 sample: 右侧详情并排面板,
* the sample's own breakpoint); narrower screens keep the overlay drawer. */
const SIDE_QUERY = "(min-width: 1101px)";
function useSideBySide() {
	const query = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(SIDE_QUERY) : void 0;
	const [wide, setWide] = (0, react.useState)(query?.matches ?? false);
	(0, react.useEffect)(() => {
		if (query === void 0) return;
		const update = () => {
			setWide(query.matches);
		};
		update();
		query.addEventListener?.("change", update);
		return () => {
			query.removeEventListener?.("change", update);
		};
	}, [query?.media]);
	return wide;
}
function TaskBoard({ tasks, rooms, chatId, roomId, t, onOpen, onReview, onTerminate, dock, onDocked }) {
	const [opened, setOpened] = (0, react.useState)(false);
	const wide = useSideBySide();
	const docked = opened && wide && dock != null;
	(0, react.useEffect)(() => {
		onDocked?.(docked);
	}, [docked]);
	const [selectedTab, setSelectedTab] = (0, react.useState)(BOARD_TABS.find((tab) => tab.initial).id);
	const [reviewing, setReviewing] = (0, react.useState)();
	const [terminating, setTerminating] = (0, react.useState)();
	const [replacement, setReplacement] = (0, react.useState)("");
	const [reason, setReason] = (0, react.useState)("");
	const [saving, setSaving] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)();
	const dialog = (0, react.useRef)(null);
	const titleId = (0, react.useId)();
	const tabId = (0, react.useId)();
	const now = Date.now() / 1e3;
	const sections = boardSections(tasks, rooms, chatId, roomId);
	const roomName = rooms.find((room) => room.id === roomId)?.name ?? rooms.find((room) => room.id === chatId)?.name ?? "";
	const channelTotal = sections.filter((section) => section.chat).reduce((n, section) => n + section.open + section.done, 0);
	const workspaceTotal = sections.filter((section) => !section.chat).reduce((n, section) => n + section.open + section.done, 0);
	const close = () => {
		setOpened(false);
	};
	const dockedRef = (0, react.useRef)(docked);
	dockedRef.current = docked;
	(0, react.useEffect)(() => {
		if (!dockedRef.current) setOpened(false);
	}, [roomId]);
	(0, react.useEffect)(() => {
		if (!opened) return;
		const previous = document.activeElement;
		dialog.current?.focus();
		return () => {
			previous?.focus();
		};
	}, [opened]);
	const jump = (targetRoomId, messageId) => {
		if (!docked) (0, react_dom.flushSync)(close);
		onOpen(targetRoomId, messageId);
	};
	const all = sections.reduce((n, s) => n + s.open + s.done, 0);
	const scopedTasks = sections.flatMap((section) => section.owners.flatMap((group) => [...group.open, ...group.done]));
	const groupCount = (group) => scopedTasks.filter((task) => boardGroupOf(task) === group).length;
	const activeTab = BOARD_TABS.find((tab) => tab.id === selectedTab);
	const matches = (task) => inTab(activeTab, task);
	const visibleCount = scopedTasks.filter(matches).length;
	const review = async (id, verdict) => {
		setSaving(true);
		setError(void 0);
		try {
			await onReview?.(id, verdict, verdict === "rework" ? reason.trim() : void 0);
			setReviewing(void 0);
			setReason("");
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setSaving(false);
		}
	};
	const terminate = async () => {
		if (!terminating) return;
		setSaving(true);
		setError(void 0);
		try {
			await onTerminate?.(terminating.id, terminating.action, reason.trim(), terminating.action === "supersede" && replacement !== "" ? Number(replacement) : void 0);
			setTerminating(void 0);
			setReason("");
			setReplacement("");
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
		} finally {
			setSaving(false);
		}
	};
	const row = (task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		className: ChannelsPage_module_default.boardTaskCard,
		"data-task-id": task.id,
		"data-status": task.status,
		"data-working": boardGroupOf(task) === "working",
		"data-group": boardGroupOf(task),
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.boardTaskHeader,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ChannelsPage_module_default.boardTaskTitle,
					children: [
						"#",
						task.id,
						" ",
						task.title
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Status, {
					status: task.status,
					t
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.taskMeta,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: task.owner_name }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskElapsed", { d: formatDuration(elapsed(task, now), t) }) }),
					task.next_check_at !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskNextCheck", { time: clock(task.next_check_at) }) })
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.taskLinks,
				children: [
					task.assign_msg_id !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.linkButton,
						onClick: () => {
							jump(task.room_id, task.assign_msg_id);
						},
						children: t("taskOpenAssign")
					}),
					task.result_msg_id !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.linkButton,
						onClick: () => {
							jump(task.room_id, task.result_msg_id);
						},
						children: t("taskOpenResult")
					}),
					onReview !== void 0 && [
						"returned",
						"declined",
						"escalated"
					].includes(task.status) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.linkButton,
						disabled: saving,
						onClick: () => {
							review(task.id, "done");
						},
						children: t("taskApprove")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.linkButton,
						disabled: saving,
						onClick: () => {
							setTerminating(void 0);
							setReviewing(task.id);
							setReason("");
							setError(void 0);
						},
						children: t("taskSendBack")
					})] }),
					onTerminate !== void 0 && !isTerminalTask(task) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: ["cancel", "supersede"].map((action) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.linkButton,
						disabled: saving,
						onClick: () => {
							setReviewing(void 0);
							setTerminating({
								id: task.id,
								action
							});
							setReason("");
							setReplacement("");
							setError(void 0);
						},
						children: t(action === "cancel" ? "taskCancel" : "taskSupersede")
					}, action)) })
				]
			}),
			task.termination_reason && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.taskMeta,
				children: t("taskTerminationNote", { reason: task.termination_reason })
			}),
			task.superseded_by != null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.taskMeta,
				children: t("taskReplacement", { id: String(task.superseded_by) })
			}),
			reviewing === task.id && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				onSubmit: (event) => {
					event.preventDefault();
					review(task.id, "rework");
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("taskReviewReason"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					value: reason,
					required: true,
					onChange: (event) => {
						setReason(event.target.value);
					}
				})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "submit",
					disabled: saving || !reason.trim(),
					children: t("taskReviewSubmit")
				})]
			}),
			terminating?.id === task.id && !isTerminalTask(task) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				onSubmit: (event) => {
					event.preventDefault();
					terminate();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("taskTerminationReason"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: reason,
						required: true,
						maxLength: 131072,
						onChange: (event) => {
							setReason(event.target.value);
						}
					})] }),
					terminating.action === "supersede" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("taskReplacementId"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "number",
						min: "1",
						step: "1",
						value: replacement,
						onChange: (event) => {
							setReplacement(event.target.value);
						}
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "submit",
						disabled: saving || !reason.trim(),
						children: t(terminating.action === "cancel" ? "taskConfirmCancel" : "taskConfirmSupersede")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: saving,
						onClick: () => {
							setTerminating(void 0);
						},
						children: t("taskKeep")
					})
				]
			})
		]
	}, task.id);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: ChannelsPage_module_default.taskBoardTrigger,
			"aria-label": t("taskBoardOpen"),
			"aria-haspopup": wide && dock != null ? void 0 : "dialog",
			"aria-expanded": opened,
			onClick: () => {
				if (docked) {
					close();
					return;
				}
				setSelectedTab((BOARD_TABS.find((tab) => tab.groups.length > 0 && scopedTasks.some((task) => inTab(tab, task))) ?? BOARD_TABS.find((tab) => tab.initial)).id);
				setOpened(true);
			},
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskBoard") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ChannelsPage_module_default.taskBoardSummary,
					children: all === 0 ? t("taskBoardNoTasks") : t("taskBoardSummary", {
						decide: String(groupCount("decide")),
						working: String(groupCount("working"))
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					children: "›"
				})
			]
		}),
		docked && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
			ref: dialog,
			className: `${ChannelsPage_module_default.dialog} ${ChannelsPage_module_default.taskBoardDialog} ${ChannelsPage_module_default.sidePanel}`,
			role: "region",
			"aria-labelledby": titleId,
			tabIndex: -1,
			onKeyDown: (event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					close();
				}
			},
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", {
					id: titleId,
					className: ChannelsPage_module_default.dialogTitle,
					children: [
						t("taskBoard"),
						" · ",
						roomName
					]
				}),
				docked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ChannelsPage_module_default.sidePanelClose,
					"aria-label": t("taskBoardClose"),
					title: t("taskBoardClose"),
					onClick: close,
					children: "×"
				}),
				error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					role: "alert",
					children: error
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.taskBoardScope,
					children: t("taskBoardScope", {
						room: rooms.find((room) => room.id === chatId)?.name ?? roomName,
						channel: String(channelTotal),
						workspaces: String(workspaceTotal)
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.boardTabs,
					role: "tablist",
					"aria-label": t("taskTabLabel"),
					children: BOARD_TABS.map((tab, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						id: `${tabId}-${tab.id}`,
						type: "button",
						role: "tab",
						"aria-selected": selectedTab === tab.id,
						"aria-controls": `${tabId}-panel`,
						tabIndex: selectedTab === tab.id ? 0 : -1,
						onClick: () => {
							setSelectedTab(tab.id);
						},
						onKeyDown: (event) => {
							let next = index;
							if (event.key === "ArrowRight") next = (index + 1) % BOARD_TABS.length;
							else if (event.key === "ArrowLeft") next = (index + BOARD_TABS.length - 1) % BOARD_TABS.length;
							else if (event.key === "Home") next = 0;
							else if (event.key === "End") next = BOARD_TABS.length - 1;
							else return;
							event.preventDefault();
							setSelectedTab(BOARD_TABS[next].id);
							document.getElementById(`${tabId}-${BOARD_TABS[next].id}`)?.focus();
						},
						children: [
							t(tab.label),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.boardTabCount,
								children: scopedTasks.filter((task) => inTab(tab, task)).length
							})
						]
					}, tab.id))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					id: `${tabId}-panel`,
					className: ChannelsPage_module_default.taskBoardBody,
					role: "tabpanel",
					"aria-labelledby": `${tabId}-${selectedTab}`,
					tabIndex: 0,
					children: [visibleCount === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.boardTabEmpty,
						children: all === 0 ? t("taskBoardEmptyInModal") : t("taskTabEmpty", { tab: t(activeTab.label) })
					}), sections.map((section) => {
						const owners = section.owners.map((group) => ({
							...group,
							visible: [...group.open, ...group.done].filter(matches)
						})).filter((group) => group.visible.length > 0);
						if (owners.length === 0) return null;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.taskSection,
							"data-room-id": section.roomId,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
								className: ChannelsPage_module_default.taskSectionTitle,
								children: sectionTitle(section, t)
							}), owners.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ChannelsPage_module_default.taskOwnerGroup,
								"data-owner": group.owner,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ChannelsPage_module_default.taskOwnerName,
									children: t("taskBoardOwner", { name: group.ownerName })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: ChannelsPage_module_default.boardCardGrid,
									children: group.visible.map(row)
								})]
							}, group.owner))]
						}, section.roomId);
					})]
				}),
				!docked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.dialogActions,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.secondaryButton,
						onClick: close,
						children: t("close")
					})
				})
			]
		}), dock),
		opened && !docked && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: `${ChannelsPage_module_default.dialogBackdrop} ${ChannelsPage_module_default.boardDrawerBackdrop}`,
			"data-dc-scheme": getScheme(),
			onMouseDown: (event) => {
				if (event.target === event.currentTarget) close();
			},
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: dialog,
				className: `${ChannelsPage_module_default.dialog} ${ChannelsPage_module_default.taskBoardDialog}`,
				role: "dialog",
				"aria-modal": "true",
				"aria-labelledby": titleId,
				tabIndex: -1,
				onKeyDown: (event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						close();
					}
					if (event.key === "Tab") {
						const focusable = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled):not([tabindex=\"-1\"]), input:not(:disabled), [role=\"tabpanel\"]"));
						const first = focusable[0];
						const last = focusable[focusable.length - 1];
						if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
							event.preventDefault();
							last?.focus();
						} else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
							event.preventDefault();
							first?.focus();
						}
					}
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h2", {
						id: titleId,
						className: ChannelsPage_module_default.dialogTitle,
						children: [
							t("taskBoard"),
							" · ",
							roomName
						]
					}),
					docked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.sidePanelClose,
						"aria-label": t("taskBoardClose"),
						title: t("taskBoardClose"),
						onClick: close,
						children: "×"
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "alert",
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.taskBoardScope,
						children: t("taskBoardScope", {
							room: rooms.find((room) => room.id === chatId)?.name ?? roomName,
							channel: String(channelTotal),
							workspaces: String(workspaceTotal)
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.boardTabs,
						role: "tablist",
						"aria-label": t("taskTabLabel"),
						children: BOARD_TABS.map((tab, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							id: `${tabId}-${tab.id}`,
							type: "button",
							role: "tab",
							"aria-selected": selectedTab === tab.id,
							"aria-controls": `${tabId}-panel`,
							tabIndex: selectedTab === tab.id ? 0 : -1,
							onClick: () => {
								setSelectedTab(tab.id);
							},
							onKeyDown: (event) => {
								let next = index;
								if (event.key === "ArrowRight") next = (index + 1) % BOARD_TABS.length;
								else if (event.key === "ArrowLeft") next = (index + BOARD_TABS.length - 1) % BOARD_TABS.length;
								else if (event.key === "Home") next = 0;
								else if (event.key === "End") next = BOARD_TABS.length - 1;
								else return;
								event.preventDefault();
								setSelectedTab(BOARD_TABS[next].id);
								document.getElementById(`${tabId}-${BOARD_TABS[next].id}`)?.focus();
							},
							children: [
								t(tab.label),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ChannelsPage_module_default.boardTabCount,
									children: scopedTasks.filter((task) => inTab(tab, task)).length
								})
							]
						}, tab.id))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						id: `${tabId}-panel`,
						className: ChannelsPage_module_default.taskBoardBody,
						role: "tabpanel",
						"aria-labelledby": `${tabId}-${selectedTab}`,
						tabIndex: 0,
						children: [visibleCount === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.boardTabEmpty,
							children: all === 0 ? t("taskBoardEmptyInModal") : t("taskTabEmpty", { tab: t(activeTab.label) })
						}), sections.map((section) => {
							const owners = section.owners.map((group) => ({
								...group,
								visible: [...group.open, ...group.done].filter(matches)
							})).filter((group) => group.visible.length > 0);
							if (owners.length === 0) return null;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ChannelsPage_module_default.taskSection,
								"data-room-id": section.roomId,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									className: ChannelsPage_module_default.taskSectionTitle,
									children: sectionTitle(section, t)
								}), owners.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ChannelsPage_module_default.taskOwnerGroup,
									"data-owner": group.owner,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.taskOwnerName,
										children: t("taskBoardOwner", { name: group.ownerName })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: ChannelsPage_module_default.boardCardGrid,
										children: group.visible.map(row)
									})]
								}, group.owner))]
							}, section.roomId);
						})]
					}),
					!docked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.dialogActions,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ChannelsPage_module_default.secondaryButton,
							onClick: close,
							children: t("close")
						})
					})
				]
			})
		}), document.body)
	] });
}
/**
* Card for a task record in the message stream: the task and one row per
* member (owner of the task and of each sub-task) with status and elapsed time.
* Renders nothing when the task is not on the loaded board.
*/
function TaskCard({ taskId, tasks, t }) {
	const members = cardMembers(taskId, tasks);
	const task = members[0];
	if (task === void 0) return null;
	const now = Date.now() / 1e3;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.taskCard,
		"data-status": task.status,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: ChannelsPage_module_default.taskLine,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ChannelsPage_module_default.cardTitle,
				children: [
					"#",
					task.id,
					" ",
					task.title
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Status, {
				status: task.status,
				t
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
			className: ChannelsPage_module_default.taskMembers,
			children: members.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: ChannelsPage_module_default.taskMember,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.taskMemberName,
						children: m.owner_name
					}),
					m.id !== task.id && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.taskSub,
						children: m.title
					}),
					m.id !== task.id && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Status, {
						status: m.status,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.taskMeta,
						children: formatDuration(elapsed(m, now), t)
					})
				]
			}, m.id))
		})]
	});
}
// src/client/ProgressCard.tsx
const newest = (tasks) => tasks.reduce((best, task) => best === void 0 || task.updated_at > best.updated_at ? task : best, void 0);
/** The four rows for the tasks of these rooms; empty when the channel has no task at all. */
function channelProgress(tasks, rooms) {
	const mine = tasks.filter((task) => rooms.has(task.room_id));
	if (mine.length === 0) return [];
	const done = mine.filter((task) => task.status === "done");
	const doing = mine.filter((task) => boardGroupOf(task) === "working");
	const returned = mine.filter((task) => task.status === "returned");
	const next = returned.length > 0 ? returned : mine.filter((task) => boardGroupOf(task) === "parked");
	const open = mine.filter((task) => task.status === "asked" || task.status === "declined" || task.status === "escalated");
	return [
		{
			row: "done",
			task: newest(done),
			count: done.length
		},
		{
			row: "doing",
			task: newest(doing),
			count: doing.length
		},
		{
			row: "next",
			task: newest(next),
			count: next.length
		},
		{
			row: "open",
			task: newest(open),
			count: open.length
		}
	];
}
const LABEL$1 = {
	done: "progressDone",
	doing: "progressDoing",
	next: "progressNext",
	open: "progressOpen"
};
/** Folded state of the card, remembered per room in the browser (#156). Same shape as the card view switch. */
const FOLD_KEY = "dsh-channels-progress-folded:";
function loadProgressFolded(roomId) {
	try {
		return globalThis.localStorage?.getItem(FOLD_KEY + roomId) === "1";
	} catch (error) {
		return false;
	}
}
function saveProgressFolded(roomId, folded) {
	try {
		globalThis.localStorage?.setItem(FOLD_KEY + roomId, folded ? "1" : "0");
	} catch (error) {}
}
function lineText(line, t) {
	const task = line.task;
	if (task === void 0) return t("progressNone");
	const base = line.row === "next" ? t(task.status === "returned" ? "progressNextReview" : "progressNextResume", {
		id: String(task.id),
		title: task.title,
		name: task.owner_name
	}) : t("progressTask", {
		id: String(task.id),
		title: task.title,
		name: task.owner_name
	});
	return line.count > 1 ? `${base}${t("progressMore", { count: String(line.count - 1) })}` : base;
}
function ProgressCard({ lines, t, onOpen, folded, onToggle }) {
	const shown = lines.filter((line) => line.task !== void 0);
	if (shown.length === 0) return null;
	const summary = shown.map((line) => `${t(LABEL$1[line.row])} ${line.count}`).join(" · ");
	const label = t(folded ? "progressExpand" : "progressFold");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: ChannelsPage_module_default.progressCard,
		"data-folded": folded,
		role: "region",
		"aria-label": t("progressTitle"),
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: ChannelsPage_module_default.progressHead,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
					className: ChannelsPage_module_default.progressTitle,
					children: t("progressTitle")
				}),
				folded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ChannelsPage_module_default.progressSummary,
					title: summary,
					children: summary
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ChannelsPage_module_default.progressToggle,
					title: label,
					"aria-label": label,
					"aria-expanded": !folded,
					onClick: onToggle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(folded ? "progressExpandShort" : "progressFoldShort") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						"aria-hidden": "true",
						className: ChannelsPage_module_default.progressChevron,
						children: folded ? "▾" : "▴"
					})]
				})
			]
		}), !folded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
			className: ChannelsPage_module_default.progressRows,
			children: shown.map((line) => {
				const text = lineText(line, t);
				const target = line.task?.assign_msg_id;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.progressRow,
					"data-row": line.row,
					"data-empty": line.task === void 0,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t(LABEL$1[line.row]) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						title: text,
						children: line.task !== void 0 && target != null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ChannelsPage_module_default.progressLink,
							onClick: () => {
								onOpen(line.task.room_id, target);
							},
							children: text
						}) : text
					})]
				}, line.row);
			})
		})]
	});
}
// src/client/StepChips.tsx
/**
* Step chips under a run strip: one chip per tool name with its call count and outcome;
* a click shows every call and output, a failed step is marked red. Data comes
* from the progress card's `chips` (dsh/collab/cloudweb.mjs stepChips); older cards without it
* keep the plain step lines.
*/
const STATES = /* @__PURE__ */ new Set([
	"ok",
	"failed",
	"running",
	"unknown"
]);
/** The chips of a parsed card, or undefined when the card carries none (older cards). */
function chipsOf(card) {
	if (!Array.isArray(card?.chips) || card.chips.length === 0) return void 0;
	const chips = card.chips.filter((c) => c !== null && typeof c === "object" && typeof c.tool === "string" && STATES.has(c.state));
	return chips.length > 0 ? chips : void 0;
}
const LABEL = {
	ok: "stepOk",
	failed: "stepFailed",
	running: "stepRunning",
	unknown: "stepUnknown"
};
/** 用户 2026-11-11：同一轮所有同名工具显示 ×N；沿用失败 > 在途 > 未知 > 成功。 */
function groupTools(chips) {
	const groups = [];
	const byTool = /* @__PURE__ */ new Map();
	for (const chip of chips) {
		const key = chip.tool.toLowerCase();
		const previous = byTool.get(key);
		if (previous) {
			previous.steps.push(chip);
			const states = [previous.state, chip.state];
			previous.state = states.includes("failed") ? "failed" : states.includes("running") ? "running" : states.includes("unknown") ? "unknown" : "ok";
		} else {
			const group = {
				tool: chip.tool,
				state: chip.state,
				steps: [chip]
			};
			groups.push(group);
			if (key) byTool.set(key, group);
		}
	}
	return groups;
}
/** Older cards have only brief text; recognize the producer's tool lines, leave other prose intact. */
function compactBrief(brief) {
	return groupTools(brief.split("\n").map((line) => {
		const match = /^(✅|❌|🔧) (.+?)(?: · (成功|失败|进行中))?$/.exec(line);
		const state = match?.[1] === "❌" ? "failed" : match?.[1] === "✅" ? "ok" : match?.[3] === "进行中" ? "running" : "unknown";
		return {
			tool: match?.[2] ?? "",
			state,
			output: line
		};
	})).map((group) => {
		if (group.steps.length === 1) return group.steps[0].output;
		const status = {
			failed: "❌",
			ok: "✅",
			running: "🔧",
			unknown: "🔧"
		}[group.state];
		const suffix = {
			failed: " · 失败",
			ok: " · 成功",
			running: " · 进行中",
			unknown: ""
		}[group.state];
		return `${status} ${group.tool} ×${group.steps.length}${suffix}`;
	}).join("\n");
}
function StepChips({ chips: given, runState, t, latest }) {
	const [open, setOpen] = (0, react.useState)();
	const chips = runState === "running" ? given : given.map((c) => c.state === "running" ? {
		...c,
		state: "unknown"
	} : c);
	const all = groupTools(chips);
	const groups = latest !== void 0 && all.length > latest ? all.slice(-latest) : all;
	const hidden = all.length - groups.length;
	const shown = open === void 0 ? void 0 : groups[open];
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.stepChips,
		role: "group",
		"aria-label": t("stepChips"),
		children: [
			hidden > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.stepChip,
				"data-state": "unknown",
				"data-steps-folded": true,
				children: t("stepsFolded", { total: String(chips.length) })
			}),
			groups.map((chip, i) => {
				const detail = chip.steps.some((step) => step.input !== void 0 || step.output !== void 0);
				const name = `${chip.tool}${chip.steps.length > 1 ? ` ×${chip.steps.length}` : ""}`;
				const label = `${name} · ${t(LABEL[chip.state])}`;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ChannelsPage_module_default.stepChip,
					"data-state": chip.state,
					"aria-expanded": detail ? open === i : void 0,
					disabled: !detail,
					title: label,
					"aria-label": label,
					onClick: () => {
						setOpen(open === i ? void 0 : i);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.stepMark,
						"aria-hidden": true
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: name })]
				}, i);
			}),
			shown !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.stepOut,
				"data-state": shown.state,
				role: "region",
				"aria-label": t("stepOutput", { tool: shown.tool }),
				children: shown.steps.map((step, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-state": step.state,
					children: [
						shown.steps.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("b", { children: [
							step.tool,
							" · ",
							t(LABEL[step.state])
						] }),
						step.input !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("stepInput") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: step.input })] }),
						step.output !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("stepResult") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: step.output })] })
					]
				}, i))
			})
		]
	});
}
// src/client/CapabilityList.tsx
/** On-demand help for existing capabilities; selecting help never executes an action. */
const CAPABILITIES = [
	["capabilityTaskBoard", "capabilityTaskBoardHelp"],
	["capabilityAttachments", "capabilityAttachmentsHelp"],
	["capabilityLater", "capabilityLaterHelp"],
	["capabilityReminder", "capabilityReminderHelp"],
	["capabilityWorkspace", "capabilityWorkspaceHelp"],
	["capabilityLead", "capabilityLeadHelp"],
	["capabilityDm", "capabilityDmHelp"]
];
/** Show the capability names and, after selection, the corresponding usage. */
function CapabilityList({ t, onClose }) {
	const [selected, setSelected] = (0, react.useState)();
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: ChannelsPage_module_default.capabilityMenu,
		"aria-label": t("capabilities"),
		onKeyDown: (event) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.groupHead,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("capabilities") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ChannelsPage_module_default.iconButton,
					"aria-label": t("close"),
					onClick: onClose,
					children: "×"
				})]
			}),
			CAPABILITIES.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.capabilityItem,
				"aria-pressed": selected === item,
				onClick: () => {
					setSelected(item);
				},
				children: t(item[0])
			}, item[0])),
			selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: ChannelsPage_module_default.capabilityHelp,
				role: "status",
				children: t(selected[1])
			})
		]
	});
}
// src/client/SlashMenu.tsx
const GROUP_TITLE = {
	control: "slashGroupControl",
	model: "slashGroupModel",
	view: "slashGroupView"
};
function SlashMenu({ commands, selected, target, leadName, dmName, disabled = () => false, grouped, t, onPick, onHover }) {
	const noCmd = dmName ?? leadName;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: `${ChannelsPage_module_default.mentionPopup} ${ChannelsPage_module_default.slashPopup}`,
		role: "region",
		"aria-label": t("slashTitle"),
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.mentionTitle,
				children: target !== void 0 ? t("slashTitleLead", { name: target }) : noCmd !== void 0 ? t("slashTitleDmNoCmd", { name: noCmd }) : t("slashTitleNoLead")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				role: "listbox",
				id: "channel-slash-list",
				"aria-label": t("slashTitle"),
				children: commands.map((c, index) => [grouped && c.group !== commands[index - 1]?.group ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.slashGroup,
					role: "presentation",
					children: t(GROUP_TITLE[c.group])
				}, `group-${c.group}`) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					id: `channel-slash-${index}`,
					role: "option",
					"aria-selected": index === selected,
					"aria-disabled": disabled(c) || void 0,
					title: disabled(c) ? t("slashDisabledHint") : void 0,
					className: [
						ChannelsPage_module_default.slashItem,
						index === selected ? ChannelsPage_module_default.slashActive : "",
						disabled(c) ? ChannelsPage_module_default.slashDisabled : ""
					].filter(Boolean).join(" "),
					onMouseDown: (event) => {
						event.preventDefault();
					},
					onMouseEnter: () => {
						onHover(index);
					},
					onClick: () => {
						if (!disabled(c)) onPick(c);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ChannelsPage_module_default.slashName,
						children: ["/", c.name]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.slashMeta,
						children: t(c.hint)
					})]
				}, c.name)])
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.mentionHint,
				children: t("slashHint")
			})
		]
	});
}
// src/client/slash-commands.ts
const SLASH_COMMANDS = [
	{
		name: "stop",
		group: "control",
		hint: "slashStop",
		run: {
			kind: "send",
			text: "/stop"
		}
	},
	{
		name: "stop all",
		group: "control",
		hint: "slashStopAll",
		run: {
			kind: "send",
			text: "/stop all",
			broadcast: true
		}
	},
	{
		name: "ps",
		group: "control",
		hint: "slashPs",
		run: {
			kind: "fill",
			text: "/ps "
		}
	},
	{
		name: "new",
		group: "control",
		hint: "slashNew",
		run: {
			kind: "send",
			text: "/new"
		}
	},
	{
		name: "compress",
		group: "control",
		hint: "slashCompress",
		run: {
			kind: "send",
			text: "/compress"
		}
	},
	{
		name: "model",
		group: "model",
		hint: "slashModel",
		run: {
			kind: "send",
			text: "/model"
		}
	},
	{
		name: "reasoning",
		group: "model",
		hint: "slashReasoning",
		run: {
			kind: "send",
			text: "/reasoning"
		}
	},
	{
		name: "status",
		group: "view",
		hint: "slashStatus",
		run: {
			kind: "send",
			text: "/status"
		}
	},
	{
		name: "usage",
		group: "view",
		hint: "slashUsage",
		run: {
			kind: "send",
			text: "/usage"
		}
	},
	{
		name: "cron",
		group: "view",
		hint: "slashCron",
		run: {
			kind: "send",
			text: "/cron"
		}
	},
	{
		name: "board",
		group: "view",
		hint: "slashBoard",
		run: {
			kind: "panel",
			panel: "board"
		}
	},
	{
		name: "help",
		group: "view",
		hint: "slashHelp",
		run: {
			kind: "panel",
			panel: "help"
		}
	}
];
/** 体检 #5: a command that goes to one bot; without one it is shown greyed out. */
function needsTarget(command) {
	return command.run.kind === "fill" || command.run.kind === "send" && command.run.broadcast !== true;
}
/** The text after a leading `/` while the draft is still a bare command word; undefined otherwise. */
function slashQuery(draft) {
	const m = /^\/([^\s/]*(?: all)?)$/.exec(draft);
	return m === null ? void 0 : m[1];
}
/** Commands whose name starts with (then contains) the query, case-insensitive. */
function matchCommands(query, hint = () => "") {
	const q = query.toLowerCase();
	if (q === "") return SLASH_COMMANDS;
	const starts = SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
	const rest = SLASH_COMMANDS.filter((c) => !c.name.startsWith(q) && (c.name.includes(q) || hint(c.hint).includes(query)));
	return [...starts, ...rest];
}
/**
* A typed command (`/model gpt-5`) is addressed to the primary role, like a click on the
* menu; a draft that already names someone, `/stop all`, or a non-command is left alone.
*/
function addressCommand(text, leadName) {
	if (leadName === void 0 || !/^\/[a-z]/i.test(text) || /^\/stop\s+all\s*$/i.test(text)) return text;
	return `@${leadName} ${text}`;
}
/**
* A bot command line the owner sent (`@橘 /model x`, or a bare `/stop all`), shown as a thin
* line instead of a chat bubble (#1017); undefined for any other text.
*/
function commandLine(text) {
	const t = text.trim();
	if (/^\/stop\s+all$/i.test(t)) return { command: "/stop all" };
	const m = /^@(\S+)\s+(\/[a-z][\s\S]*)$/i.exec(t);
	if (m === null || m[2].includes("\n")) return void 0;
	return {
		target: m[1],
		command: m[2].trim()
	};
}
/**
* The bridge's own answer to each owner command line (#1017): the target bot's next message
* that is not agent output (`from_turn === 0`: a command reply, bridge/platform/cloud-web
* `agent` flag), before the owner speaks again. `/ps` is left out — what follows it is the
* running turn itself, not an answer to the command.
* @returns command message id → its answer.
*/
function commandAnswers(messages, nameOf) {
	const out = /* @__PURE__ */ new Map();
	messages.forEach((m, index) => {
		if (m.author_kind !== "user" || m.card !== null) return;
		const line = commandLine(m.text);
		if (line?.target === void 0 || /^\/ps\b/i.test(line.command)) return;
		for (const next of messages.slice(index + 1)) {
			if (next.author_kind === "user") return;
			if (next.author_kind === "role" && next.card === null && next.from_turn === 0 && nameOf(next.author) === line.target) {
				out.set(m.id, next);
				return;
			}
		}
	});
	return out;
}
/** A command answer that reports a failure (the bridge prefixes those with ❌ / ⚠️). */
function answerFailed(text) {
	return /^\s*(❌|⚠️|error\b)|失败|未知命令|unknown command/i.test(text);
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
	})).filter((x) => x.s !== void 0).sort((a, b) => Number(a.m.kind === "human") - Number(b.m.kind === "human") || a.s - b.s || Number(!a.m.online) - Number(!b.m.online) || a.m.name.localeCompare(b.m.name, "en")).map((x) => x.m);
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
// src/client/mention-highlight.tsx
/**
* Mention badge highlighting for channel message text and quotes.
* Highlights valid channel members/roles as pill badges (Discord-style),
* cleanly separated from regular text, without false positives in code or emails.
*/
const FENCE = "```";
function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* True when the text holds a blank line: two line endings with only spaces or tabs between.
* A `code span` cannot cross one — the blank line ends the paragraph, so the renderer closes the
* span before it (#245: `@肥鱼` + blank line + `@G哥` inside one pair of backticks is plain text
* on the page, and must be plain text on the backend too).
*/
function hasBlankLine(text) {
	return /\n[ \t]*\n/.test(text.replace(/\r\n?/g, "\n"));
}
const HTML_BLOCK_TAGS = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const HTML_BLOCK_TAG = new RegExp(`^ {0,3}</?(?:${HTML_BLOCK_TAGS})(?:[ \\t]|/?>|$)`, "i");
const HTML_ANY_TAG = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?[ \t]*\/?>[ \t]*$/;
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/;
/** Columns the leading indent of `text` covers, starting from column `base`. */
function indentWidth(text, base = 0) {
	let col = base;
	for (const ch of text) if (ch === " ") col += 1;
	else if (ch === "	") col += 4 - col % 4;
	else break;
	return col - base;
}
/**
* The blockquote prefix at `line[i]` (three spaces at most, then `>` and one optional blank), read
* from column `col`; `{ next, col }` after it, or undefined when the line has none there.
*/
function quotePrefixAt(line, from, col) {
	let i = from;
	let at = col;
	let spaces = 0;
	while (spaces < 4 && line[i] === " ") {
		i++;
		at++;
		spaces++;
	}
	if (spaces > 3 || line[i] !== ">") return void 0;
	i++;
	at++;
	if (line[i] === " " || line[i] === "	") {
		at += line[i] === "	" ? 4 - at % 4 : 1;
		i++;
	}
	return {
		next: i,
		col: at
	};
}
/** Strips every blockquote marker of a line, so its content can be measured from column 0. */
function stripQuotes(line) {
	let i = 0;
	let col = 0;
	let depth = 0;
	for (;;) {
		const prefix = quotePrefixAt(line, i, col);
		if (!prefix) return {
			rest: line.slice(i),
			depth,
			col
		};
		i = prefix.next;
		col = prefix.col;
		depth++;
	}
}
/**
* Column where a list item's content begins, or undefined when the line is not a list item. An
* empty marker (`1.` alone on its line) cannot open a list inside a paragraph, so it counts as
* neither.
*/
function itemContentIndent(line) {
	const { rest, col } = stripQuotes(line);
	const lead = indentWidth(rest, col);
	if (lead >= 4) return void 0;
	const body = rest.slice(/^[ \t]*/.exec(rest)[0].length);
	const marker = LIST_MARKER.exec(body);
	if (!marker) return void 0;
	if (body.slice(marker[0].length).trim() === "") return void 0;
	const gap = /^[ \t]*/.exec(body.slice(marker[0].length))[0];
	const padding = gap === "" ? 1 : Math.min(indentWidth(gap, col + lead + marker[0].length), 4);
	return lead + marker[0].length + padding;
}
/**
* True when a line whose content starts with `content` opens one of the block-level structures
* this rule knows, ending the paragraph before it: ATX headings, setext underlines, thematic
* breaks, backtick fences, list items, HTML blocks and a further quote marker. Tilde fences and
* math blocks also end a paragraph in CommonMark, but the backend reads neither, so treating them
* as spans keeps a different bug out of this change (#259 stays on the six families the report
* names; the deviation list above splitMentions() records both). A footnote definition is handled
* by footnoteRanges(), not here: it ends a body, not the paragraph a code span sits in (#271).
* `container` is set for a line that lazily continues an outer container: there a bare list
* marker or a lone HTML tag already opens a block the paragraph cannot hold.
*/
function startsBlock(content, setext = true, container = false) {
	if (indentWidth(content) >= 4) return false;
	if (container && /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(content)) return true;
	if (container && HTML_ANY_TAG.test(content)) return true;
	return /^ {0,3}#{1,6}(?:[ \t]|$)/.test(content) || setext && /^ {0,3}(?:=+|-+)[ \t]*$/.test(content) || /^ {0,3}(?:[*\-_][ \t]*){3,}$/.test(content) || /^ {0,3}`{3,}[^`]*$/.test(content) || /^ {0,3}>/.test(content) || /^ {0,3}[-*+][ \t]+\S/.test(content) || /^ {0,3}1[.)][ \t]+\S/.test(content) || /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(content) || /^ {0,3}<!--/.test(content) || /^ {0,3}<\?/.test(content) || /^ {0,3}<![A-Za-z]/.test(content) || /^ {0,3}<!\[CDATA\[/.test(content) || HTML_BLOCK_TAG.test(content);
}
/**
* [start, end) offsets of every physical line; CRLF, CR and LF all end one. Read once per
* codeSpanRanges() call and handed to lineIndex(), not rescanned per backtick run (#271: doing
* that cost O(runs × lines) — 128 KiB of one-backtick lines took 54 s inside hub.post's
* transaction).
*/
function splitLines(text) {
	const lines = [];
	for (let start = 0; start <= text.length;) {
		let end = start;
		while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end++;
		lines.push([start, end]);
		if (end >= text.length) break;
		start = text[end] === "\r" && text[end + 1] === "\n" ? end + 2 : end + 1;
	}
	return lines;
}
/**
* The line holding `offset`: the last line that starts at or before it. `splitLines` covers the
* whole text contiguously, so that is the line `offset` sits on, or the one that ends there.
*/
function lineAt(lines, offset) {
	let lo = 0;
	let hi = lines.length - 1;
	while (lo < hi) {
		const mid = lo + hi + 1 >> 1;
		if (lines[mid][0] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}
function lineFacts(text, lines, i) {
	const line = text.slice(lines[i][0], lines[i][1]);
	const { rest, depth, col } = stripQuotes(line);
	return {
		blank: line.trim() === "",
		fence: FENCE_LINE.test(line),
		itemIndent: itemContentIndent(line),
		rest,
		depth,
		col,
		atDepth: startsBlock(rest, false, true)
	};
}
function lineIndex(text) {
	const lines = splitLines(text);
	const facts = lines.map((_, i) => lineFacts(text, lines, i));
	const contained = new Array(lines.length);
	for (let i = 0; i < lines.length; i++) {
		const f = facts[i];
		if (f.blank || f.fence) {
			contained[i] = {
				baseIndent: 0,
				depth: 0
			};
			continue;
		}
		const run = i > 0 && !facts[i - 1].blank && !facts[i - 1].fence ? contained[i - 1] : void 0;
		contained[i] = {
			baseIndent: f.itemIndent !== void 0 ? f.itemIndent : run ? run.baseIndent : 0,
			depth: Math.max(f.depth, run ? run.depth : 0)
		};
	}
	return {
		lines,
		facts,
		contained
	};
}
/**
* True when the text between an opening and a closing backtick run holds something that ends the
* paragraph, so the run cannot close the span (#259): a blank line, or a line that opens a
* block-level structure. The renderer decides this inside the containers the span sits in, so the
* list item's content indent and the blockquote depth of the opening line are carried along, and
* a line that lazily continues an outer container is judged by what it would start there.
*
* `index` is the lineIndex(text) of the whole text, shared by every pair (#271): rebuilt per pair
* it cost O(runs × lines), 128 KiB of one-backtick lines taking 54 s.
*/
function endsParagraph(text, from, to, index) {
	if (hasBlankLine(text.slice(from, to))) return true;
	const { lines, facts, contained } = index;
	const openLine = lineAt(lines, from);
	const { baseIndent, depth: openDepth } = contained[openLine];
	for (let i = openLine + 1; i < lines.length && lines[i][0] < to; i++) {
		const f = facts[i];
		if (f.rest.trim() === "") return true;
		if (f.depth > openDepth) return true;
		if (f.depth < openDepth) {
			if (f.atDepth) return true;
			continue;
		}
		const indent = indentWidth(f.rest, f.col) - baseIndent;
		if (startsBlock(" ".repeat(Math.max(0, indent)) + f.rest.trimStart(), indent >= 0, indent < 0)) return true;
	}
	return false;
}
/**
* Offsets of Markdown inline code spans, [start, end) each, matching what the markdown renderer
* turns into <code> and the backend skips (dsh/collab/mentions.mjs codeSpanRanges — keep them in
* step). A span is a run of backticks closed by a run of the same length inside the same
* paragraph; it may hold single line breaks but nothing that ends the paragraph (a blank line
* #245, or a block-level structure #259). A lone backtick stays literal text, and runs of three
* or more are fences, left to fencedRanges().
*/
function codeSpanRanges(text) {
	const runs = [];
	for (let i = 0; i < text.length;) {
		if (text[i] !== "`") {
			i++;
			continue;
		}
		let j = i;
		while (j < text.length && text[j] === "`") j++;
		runs.push({
			start: i,
			len: j - i
		});
		i = j;
	}
	const ranges = [];
	let index;
	for (let k = 0; k < runs.length; k++) {
		const { start, len } = runs[k];
		if (len >= 3) continue;
		for (let c = k + 1; c < runs.length; c++) {
			if (runs[c].len !== len) continue;
			if (endsParagraph(text, start + len, runs[c].start, index ??= lineIndex(text))) break;
			ranges.push([start + len, runs[c].start]);
			k = c;
			break;
		}
	}
	return ranges;
}
/** True when [index, index + len) overlaps any excluded range. */
function overlaps(ranges, index, len) {
	return ranges.some(([start, end]) => index < end && index + len > start);
}
/**
* Builds a regex matcher and lookup map for channel member mention aliases.
* Longest aliases are prioritized so e.g. "@阿柚子" matches before "@阿柚".
*/
function buildMentionMatcher(members) {
	if (!members || members.length === 0) return void 0;
	const aliasMap = /* @__PURE__ */ new Map();
	for (const m of members) {
		const name = m.name?.trim();
		const id = m.id?.trim();
		if (name) aliasMap.set("@" + name, m);
		if (id) {
			aliasMap.set("@" + id, m);
			aliasMap.set("<@" + id + ">", m);
			aliasMap.set("<@!" + id + ">", m);
		}
		if (m.mentionId) {
			aliasMap.set("<@" + m.mentionId + ">", m);
			aliasMap.set("<@!" + m.mentionId + ">", m);
		}
	}
	const sortedAliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length);
	if (sortedAliases.length === 0) return void 0;
	const parts = sortedAliases.map((alias) => {
		const escaped = escapeRegex(alias);
		return /[a-zA-Z0-9_]$/.test(alias) ? `${escaped}(?![a-zA-Z0-9_])` : escaped;
	});
	return {
		regex: new RegExp(`(?<=^|[^a-zA-Z0-9_])(${parts.join("|")})`, "g"),
		aliasMap
	};
}
/**
* Offsets of ``` fenced blocks, [start, end) each, the way the backend reads them
* (dsh/collab/mentions.mjs split(): text.split('```') and odd parts are inside a fence).
* An unterminated fence runs to the end of the text, as it does there.
*/
function fencedRanges(text) {
	const ranges = [];
	let open = -1;
	let at = text.indexOf(FENCE);
	while (at >= 0) {
		if (open < 0) open = at + 3;
		else {
			ranges.push([open, at]);
			open = -1;
		}
		at = text.indexOf(FENCE, at + 3);
	}
	if (open >= 0) ranges.push([open, text.length]);
	return ranges;
}
/** A definition line: `[^label]:` at 0-3 columns, the label holding no space or bracket. */
const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:/;
/** A line that opens an HTML block (CommonMark types 1-6): its lines are raw until a blank one. */
const HTML_OPEN = new RegExp(`^ {0,3}(?:<(?:script|pre|style|textarea)(?:[ \\t>]|$)|<!--|<\\?|<![A-Za-z]|<!\\[CDATA\\[|</?(?:${HTML_BLOCK_TAGS})(?:[ \\t>]|/?>|$))`, "i");
/**
* True when a line at 0-3 columns opens a block, so it ends a footnote body before it. A setext
* underline (`===`, `--`) is absorbed by the definition's own paragraph and does not end it, while
* a bare `-` or `1.` does, because it opens a list. A tilde fence is left out on purpose: it ends a
* body in CommonMark, but the backend reads only ``` fences (#259), and the footnote rule stays on
* the same side of that gap.
*/
function endsDefinitionBody(rest) {
	if (indentWidth(rest) >= 4) return false;
	const c = rest.replace(/^[ \t]*/, "");
	if (/^(?:[*\-_][ \t]*){3,}$/.test(c)) return true;
	if (/^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(c)) return true;
	if (/^(?:=+|-+)[ \t]*$/.test(c)) return false;
	return /^#{1,6}(?:[ \t]|$)/.test(c) || /^\$\$/.test(c) || /^ {0,3}`{3,}[^`]*$/.test(c) || /^>/.test(c) || /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(c) || /^ {0,3}<!--/.test(c) || /^ {0,3}<\?/.test(c) || /^ {0,3}<![A-Za-z]/.test(c) || /^ {0,3}<!\[CDATA\[/.test(c) || HTML_BLOCK_TAG.test(c) || HTML_ANY_TAG.test(c);
}
/**
* Ranges whose lines the renderer does not read as Markdown at all, so a `[^x]:` inside one is
* plain text and not a definition: backtick fences, `~~~` fences and `$$` math blocks.
*/
function footnoteOpaqueRanges(text) {
	const ranges = [...fencedRanges(text)];
	for (const open of [/^ {0,3}~{3,}/, /^ {0,3}\$\$/]) {
		let start = -1;
		let at = 0;
		for (const line of text.split("\n")) {
			if (open.test(line)) {
				if (start < 0) start = at;
				else {
					ranges.push([start, at + line.length]);
					start = -1;
				}
			}
			at += line.length + 1;
		}
		if (start >= 0) ranges.push([start, text.length]);
	}
	return ranges;
}
/** Lines of an HTML block: from its opening line to the line before the next blank one. */
function htmlBlockRegions(text, lines) {
	const regions = [];
	for (let i = 0; i < lines.length; i++) {
		if (!HTML_OPEN.test(text.slice(lines[i][0], lines[i][1]))) continue;
		let end = i;
		while (end + 1 < lines.length && text.slice(lines[end + 1][0], lines[end + 1][1]).trim() !== "") end++;
		regions.push([lines[i][0], lines[end][1]]);
		i = end;
	}
	return regions;
}
/**
* Every footnote definition in the text with the container it sits in: `depth` quote markers and
* `base` the content indent of the list item that holds it (0 at the top level). Read from the
* first line only, which is enough to walk the body.
*
* `marker` is where the `[^label]:` marker of the line ends. Only that prefix is invisible on the
* page; the text after it is the definition's own body and shows up in the footnote section, so a
* reference there is a reference a reader can see (#271).
*/
function footnoteDefs(text, lines) {
	const defs = [];
	const opaque = [...footnoteOpaqueRanges(text), ...htmlBlockRegions(text, lines)];
	const inside = (offset) => opaque.some(([start, end]) => offset >= start && offset < end);
	for (let i = 0; i < lines.length; i++) {
		if (inside(lines[i][0])) continue;
		const { rest, depth, col } = stripQuotes(text.slice(lines[i][0], lines[i][1]));
		let m = FOOTNOTE_DEF.exec(rest);
		if (m) {
			defs.push({
				line: i,
				label: m[1],
				depth,
				base: 0,
				marker: lines[i][1] - rest.length + m[0].length
			});
			continue;
		}
		const marker = LIST_MARKER.exec(rest);
		if (!marker) continue;
		const after = rest.slice(marker[0].length);
		const gap = /^[ \t]*/.exec(after)[0];
		if (gap === "") continue;
		const indent = indentWidth(gap, col + marker[0].length);
		const content = after.slice(gap.length);
		const pad = content.length < 4 ? Math.min(indent, 3) : 0;
		m = FOOTNOTE_DEF.exec(" ".repeat(pad) + content);
		if (m && indent < 4) defs.push({
			line: i,
			label: m[1],
			depth,
			base: indent,
			marker: lines[i][1] - content.length + m[0].length - pad
		});
	}
	return defs;
}
/**
* Last line of the body of `def`, walking the lines its paragraph covers.
*
* Two collected definitions can never sit inside one body: mdast nests a second definition inside
* the first only when its line is indented four or more columns past the first one's content
* column, and such a line is never collected as a definition (footnoteDefs() reads `[^x]:` at 0-3
* columns only, like every other list marker). A line it does collect therefore opens a block of
* its own, so the walk stops there with the last line it really covered — no shortcut needed, and
* no re-walking either: both bodies end before the next definition line, which keeps the whole
* pass linear in the text. This says nothing about a *nested* definition the page still renders:
* that one is not collected here at all, and its page semantics stay a known deviation below.
*/
function definitionBodyEnd(text, lines, def, next) {
	let last = def.line;
	let open = text.slice(def.marker, lines[def.line][1]).trim() !== "";
	for (let j = def.line + 1; j < lines.length; j++) {
		if (j === next) break;
		const { rest, depth, col } = stripQuotes(text.slice(lines[j][0], lines[j][1]));
		if (rest.trim() === "") {
			let k = j;
			while (k < lines.length) {
				if (stripQuotes(text.slice(lines[k][0], lines[k][1])).rest.trim() !== "") break;
				k++;
			}
			if (k < lines.length) {
				const r = stripQuotes(text.slice(lines[k][0], lines[k][1]));
				if (r.depth >= def.depth && indentWidth(r.rest, r.col) - def.base >= 4) {
					j = k - 1;
					last = k - 1;
					open = true;
					continue;
				}
			}
			break;
		}
		if (depth > def.depth) break;
		if (depth < def.depth) {
			if (!open || endsDefinitionBody(rest)) break;
			last = j;
			continue;
		}
		if (indentWidth(rest, col) - def.base >= 4) {
			last = j;
			open = true;
			continue;
		}
		if (endsDefinitionBody(rest)) break;
		if (!open) break;
		last = j;
	}
	return last;
}
/** Ranges sorted and merged, so overlapping and stacked ranges cost one pass. */
function mergeRanges(ranges) {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const out = [];
	for (const [start, end] of sorted) {
		const last = out[out.length - 1];
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else out.push([start, end]);
	}
	return out;
}
/** `text` with every `[start, end)` blanked out, line endings kept so offsets stay put. */
function maskText(text, ranges) {
	const chars = text.split("");
	for (const [start, end] of mergeRanges(ranges)) for (let i = start; i < end && i < chars.length; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
	return chars.join("");
}
/**
* [start, end) of every hidden footnote definition: the definition line and the lines that
* continue it, for each label nothing readable refers to. A repeated label keeps only its first
* definition (the renderer shows that one and drops the rest), and a reference counts only where a
* reader can see it — not inside a fence, an inline code span, an HTML comment, the `[^x]:` marker
* of a definition line or another hidden body. The text after the marker of a definition line is
* the body the page prints in the footnote section, so a reference there does count. The backend
* applies the same rule in mentions(), so the page and the gate agree on what was called.
*
* The early return keeps the cost off ordinary text: without `[^` nothing is scanned at all.
*/
function footnoteRanges(text, codeSpans) {
	if (!text.includes("[^")) return [];
	const spans = codeSpans ?? codeSpanRanges(text);
	const lines = splitLines(text);
	const defs = footnoteDefs(text, lines);
	if (defs.length === 0) return [];
	const ends = defs.map((def, k) => definitionBodyEnd(text, lines, def, k + 1 < defs.length ? defs[k + 1].line : void 0));
	const bodies = defs.map((def, k) => [lines[def.line][0], lines[ends[k]][1]]);
	const blind = [
		...spans,
		...footnoteOpaqueRanges(text),
		...htmlBlockRegions(text, lines)
	];
	for (const def of defs) blind.push([lines[def.line][0], def.marker]);
	for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) blind.push([m.index, m.index + m[0].length]);
	const searchable = maskText(text, blind);
	const first = /* @__PURE__ */ new Map();
	defs.forEach((def, i) => {
		const key = def.label.toLowerCase();
		if (!first.has(key)) first.set(key, i);
	});
	const calledOutside = /* @__PURE__ */ new Set();
	const insideBody = defs.map(() => /* @__PURE__ */ new Set());
	let body = 0;
	for (const m of searchable.matchAll(/\[\^([^\]\s]+)\]/g)) {
		let slashes = 0;
		for (let i = m.index - 1; i >= 0 && searchable[i] === "\\"; i--) slashes++;
		if (slashes % 2 !== 0) continue;
		while (body < bodies.length && bodies[body][1] <= m.index) body++;
		const owner = body < bodies.length && m.index >= bodies[body][0] ? body : -1;
		(owner < 0 ? calledOutside : insideBody[owner]).add(m[1].toLowerCase());
	}
	const shown = /* @__PURE__ */ new Set();
	const pending = [];
	const open = (labels) => {
		for (const label of labels) {
			const i = first.get(label);
			if (i === void 0 || shown.has(i)) continue;
			shown.add(i);
			pending.push(i);
		}
	};
	open(calledOutside);
	while (pending.length > 0) open(insideBody[pending.pop()]);
	const hidden = [];
	defs.forEach((def, i) => {
		if (!shown.has(i)) hidden.push([lines[def.line][0], lines[ends[i]][1]]);
	});
	return mergeRanges(hidden);
}
/**
* Known deviations from the page, kept on purpose (#259, #271). Each one showed the same answer
* before this code was written, so the list is the honest edge of this rule, not a regression:
*
* - `~~~` fences: the page renders them as code, the backend reads only ```, so a name inside one
*   is coloured nowhere and called there.
* - `$$` math blocks: the page ends a paragraph at one, the backend does not, so a code span that
*   crosses `$$` holds there and breaks here (nobody called, page colours both names).
* - A GFM table delimiter row (`|---|`): same shape — the page ends the paragraph, the backend
*   keeps the span, so nobody is called while the page colours both names.
* - A four-column indented code block: the page renders it as code and colours nothing, the
*   backend has no indented-code reader and calls the name. The footnote rule below shares it: a
*   `[^x]:` line indented four columns is a code block on the page and hidden there, and it is
*   not a definition here either, so a name on that line is a call there. Likewise a `[^2]` written
*   only on a four-column line is not a reference on the page, while this backend reads it as one
*   and shows the `[^2]:` definition the page keeps hidden.
* - A nested definition — a `[^x]:` line indented four or more columns past the outer body's
*   content column. The page nests it under the outer footnote and shows it only when its own
*   label is called; this splitter collects definitions at 0-3 columns only, so that line is never
*   a definition here. Both matchers then give the same answer, and it is not the page's, in both
*   directions: `[^1]: a` / four-column `[^2]: 注 @name` / `见 [^1]` colours the name here while
*   the page renders the outer footnote as `a` with no badge, and with `见 [^2]` nothing is
*   coloured here while the page does show the badge. Same on bdd67b4 — not a regression of #271,
*   and #323 corrected the notes instead of widening the implementation.
* - A code span opened on a block line (`# ` + backtick + name): the paragraph already ended
*   before the opener, so the page never makes it a span and colours the names; endsParagraph()
*   only reads the lines between the runs, so the span still holds here.
*
* Splits plain text into non-mention and mention segments. An @ inside a ``` fence, an inline
* code span or a hidden footnote definition is left as text: the backend does not call anyone
* there (dsh/collab/mentions.mjs), so colouring it would promise a call that never happens (#237,
* #271).
*/
function splitMentions(text, members) {
	if (!text) return [];
	const matcher = buildMentionMatcher(members);
	if (!matcher) return [{ text }];
	const { regex, aliasMap } = matcher;
	const segments = [];
	const codeSpans = codeSpanRanges(text);
	const skip = [
		...fencedRanges(text),
		...codeSpans,
		...footnoteRanges(text, codeSpans)
	];
	let lastIndex = 0;
	for (const match of text.matchAll(regex)) {
		const matchText = match[0];
		const startIndex = match.index ?? 0;
		if (overlaps(skip, startIndex, matchText.length)) continue;
		if (startIndex > lastIndex) segments.push({ text: text.slice(lastIndex, startIndex) });
		const member = aliasMap.get(matchText);
		segments.push({
			text: matchText,
			member
		});
		lastIndex = startIndex + matchText.length;
	}
	if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
	return segments;
}
/**
* Formats mention text for display in the pill badge:
* converts raw Discord tags like <@12345> into readable @Name.
*/
function formatMentionBadgeText(rawText, member) {
	if (rawText.startsWith("<@")) return `@${member.name}`;
	return rawText;
}
/**
* Highlights mentions in the text nodes of a container element without
* touching code blocks (<pre>, <code>), input controls, or scripts.
*/
function highlightMentionsInElement(container, members, badgeClassName = ChannelsPage_module_default.mentionBadge) {
	if (!container || !members || members.length === 0) return;
	const matcher = buildMentionMatcher(members);
	if (!matcher) return;
	const doc = container.ownerDocument || document;
	const existing = container.querySelectorAll(`.${badgeClassName}, [data-mention]`);
	for (const el of existing) el.replaceWith(doc.createTextNode(el.textContent || ""));
	container.normalize();
	const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, { acceptNode(node) {
		const parent = node.parentElement;
		if (!parent) return NodeFilter.FILTER_REJECT;
		if (parent.closest("pre, code, textarea, input, script, style")) return NodeFilter.FILTER_REJECT;
		return NodeFilter.FILTER_ACCEPT;
	} });
	const textNodes = [];
	let curr;
	while (curr = walker.nextNode()) textNodes.push(curr);
	for (const node of textNodes) {
		const text = node.nodeValue || "";
		if (!text) continue;
		matcher.regex.lastIndex = 0;
		if (!matcher.regex.test(text)) continue;
		const segments = splitMentions(text, members);
		if (segments.length === 1 && !segments[0]?.member) continue;
		const fragment = doc.createDocumentFragment();
		for (const seg of segments) if (!seg.member) fragment.appendChild(doc.createTextNode(seg.text));
		else {
			const badge = doc.createElement("span");
			badge.className = badgeClassName;
			badge.dataset.mention = seg.member.id;
			badge.title = `@${seg.member.name}`;
			badge.textContent = formatMentionBadgeText(seg.text, seg.member);
			fragment.appendChild(badge);
		}
		node.replaceWith(fragment);
	}
}
/**
* Renders quote text with mention pill badges as React elements.
*/
function renderQuoteMentions(text, members, onMention, badgeClassName = ChannelsPage_module_default.mentionBadge) {
	return splitMentions(text, members).map((seg, idx) => {
		if (!seg.member) return seg.text;
		const member = seg.member;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: badgeClassName,
			"data-mention": member.id,
			title: `@${member.name}`,
			onClick: onMention ? (e) => {
				e.stopPropagation();
				onMention(member);
			} : void 0,
			children: formatMentionBadgeText(seg.text, member)
		}, idx);
	});
}
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? react.useLayoutEffect : react.useEffect;
/**
* Wraps MarkdownText and applies Discord-style pill badge highlighting
* to recognized channel member mentions.
*/
function HighlightedMarkdown({ text, labels, members, className, inline, dataCardText, onMention }) {
	const containerRef = (0, react.useRef)(null);
	useIsomorphicLayoutEffect(() => {
		const el = containerRef.current;
		if (!el || !members || members.length === 0) return;
		highlightMentionsInElement(el, members, ChannelsPage_module_default.mentionBadge);
	}, [text, members]);
	const handleClick = (e) => {
		if (!onMention || !members) return;
		const target = e.target.closest("[data-mention]");
		if (!target) return;
		const mentionId = target.dataset.mention;
		const member = members.find((m) => m.id === mentionId);
		if (member) {
			e.stopPropagation();
			onMention(member);
		}
	};
	if (inline) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		ref: (el) => {
			containerRef.current = el;
		},
		className,
		onClick: handleClick,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
			text,
			labels
		}, text)
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		ref: (el) => {
			containerRef.current = el;
		},
		className,
		"data-card-text": dataCardText ? true : void 0,
		onClick: handleClick,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
			text,
			labels
		}, text)
	});
}
// src/client/avatars.ts
/**
* Built-in member avatars served by the collab plugin at `collab/avatars/<slug>.png`:
* the four B-version character portraits (Claude / GPT / DeepSeek / Gemini) + Grok + lanxi.
* These are the slugs a member can pick for itself (MemberDialog).
*/
const AVATARS = [
	"orange",
	"whale",
	"dragon",
	"rainbow",
	"lanxi",
	"grok"
];
const DEFAULT_AVATAR_STYLE = "brand";
const AVATAR_SETS = {
	brand: {
		claude: "brand-claude",
		gpt: "brand-openai",
		deepseek: "brand-deepseek",
		gemini: "brand-gemini",
		grok: "brand-grok",
		minimax: "brand-minimax"
	},
	chibi: {
		claude: "orange",
		gpt: "dragon",
		deepseek: "whale",
		gemini: "rainbow",
		grok: "grok",
		minimax: "lanxi"
	}
};
/** Every image the plugin serves under collab/avatars/ (both sets). */
const SERVED = [...AVATARS, ...Object.values(AVATAR_SETS.brand)];
function normalizeAvatarStyle(v) {
	return v === "chibi" ? "chibi" : DEFAULT_AVATAR_STYLE;
}
/**
* Maps member role/model/cli/name to a built-in avatar slug in the given set (default brand):
* Claude, GPT / Codex, DeepSeek, Gemini, Grok, MiniMax. A member's own built-in pick wins.
*/
function matchAvatarSlug(opts, style = DEFAULT_AVATAR_STYLE) {
	if (opts.avatar && SERVED.includes(opts.avatar)) return opts.avatar;
	const family = matchFamily(opts);
	return family === void 0 ? void 0 : AVATAR_SETS[style][family];
}
function matchFamily(opts) {
	const model = (opts.model || "").toLowerCase();
	const cli = (opts.cli || "").toLowerCase();
	const name = (opts.name || opts.id || "").toLowerCase();
	if (model) {
		if (model.includes("claude") || model.includes("opus") || model.includes("sonnet") || model.includes("haiku")) return "claude";
		if (model.includes("gpt") || model.includes("codex") || model.includes("o1") || model.includes("o3") || model.includes("o4") || model.includes("chatgpt")) return "gpt";
		if (model.includes("deepseek") || model.includes("r1") || model.includes("v3")) return "deepseek";
		if (model.includes("gemini")) return "gemini";
		if (model.includes("grok") || model.includes("xai")) return "grok";
	}
	if (cli) {
		if (cli === "claude" || cli === "claudecode") return "claude";
		if (cli === "codex") return "gpt";
		if (cli === "deepseek" || cli === "dsh") return "deepseek";
		if (cli === "gemini" || cli === "antigravity") return "gemini";
		if (cli === "grok") return "grok";
	}
	if (name) {
		if (name === "橘" || name === "c酱" || name === "cjiang" || name === "claude") return "claude";
		if (name === "龙娘" || name === "g哥" || name === "gge" || name === "codex" || name === "gpt") return "gpt";
		if (name === "鲸鱼娘" || name === "肥鱼" || name === "deep" || name === "deepseek" || name === "dsh") return "deepseek";
		if (name === "彩虹猫" || name === "大豆包" || name === "gjiang" || name === "gemini") return "gemini";
		if (name === "岚汐" || name === "lanxi" || name === "minimax") return "minimax";
		if (name === "grok" || name.includes("grok")) return "grok";
	}
}
/**
* Image source for a member avatar.
* @param avatar - built-in slug, http(s) URL announced by a bot, AvatarOptions, or empty.
* @param url - #236 path mapper of the panel (a paired computer's panel reads its avatars).
* @returns a URL relative to the document base, the absolute URL, or undefined for the initial badge.
*/
function avatarSrc(avatar, url = (path) => path, style = DEFAULT_AVATAR_STYLE) {
	if (avatar === void 0 || avatar === "") return void 0;
	if (typeof avatar === "string") {
		if (/^upload:[a-z0-9-]+\.png$/.test(avatar)) return url(`collab/avatars/uploads/${avatar.slice(7)}`);
		if (/^https?:\/\//.test(avatar)) return avatar;
		if (SERVED.includes(avatar)) return url(`collab/avatars/${avatar}.png`);
		const matched = matchAvatarSlug({ name: avatar }, style);
		return matched ? url(`collab/avatars/${matched}.png`) : void 0;
	}
	const a = avatar.avatar;
	if (a && /^upload:[a-z0-9-]+\.png$/.test(a)) return url(`collab/avatars/uploads/${a.slice(7)}`);
	if (a && /^https?:\/\//.test(a)) return a;
	const slug = matchAvatarSlug(avatar, style);
	return slug ? url(`collab/avatars/${slug}.png`) : void 0;
}
// src/client/avatar-style.ts
/**
* Which built-in avatar set members without their own avatar show (#602). The value lives in the
* bothouse config ([display] avatar_style), read through this DSH's panel forwarder
* (dsh/collab/panel.mjs, `collab/panel/api/v1/settings`), so the channel page and the web panel
* show the same set. No bothouse, not the owner, or any error: the default brand set.
* The embedded panel announces a switch on the `bothouse-avatar-style` BroadcastChannel
* (bridge/web/src/lib/avatarMap.ts), so the page follows without a reload.
*/
const AVATAR_STYLE_CHANNEL = "bothouse-avatar-style";
const SETTINGS_PATH = "collab/panel/api/v1/settings";
const targets = /* @__PURE__ */ new Map();
function stateFor(url) {
	const path = url(SETTINGS_PATH);
	let state = targets.get(path);
	if (!state) {
		state = {
			current: DEFAULT_AVATAR_STYLE,
			started: false,
			listeners: /* @__PURE__ */ new Set()
		};
		targets.set(path, state);
	}
	return state;
}
function setAvatarStyle(style, url = localCollabUrl) {
	const state = stateFor(url);
	if (style === state.current) return;
	state.current = style;
	for (const fn of state.listeners) fn();
}
/** Reads the stored set once and listens for switches from the panel. */
function startAvatarStyle(fetchImpl = globalThis.fetch, url = localCollabUrl) {
	const state = stateFor(url);
	if (state.started) return;
	state.started = true;
	const path = url(SETTINGS_PATH);
	const link = path.match(/(?:^|\/)collab\/remote\/([^/]+)\/panel\//)?.[1];
	try {
		const ch = new BroadcastChannel(link ? `${AVATAR_STYLE_CHANNEL}:${link}` : AVATAR_STYLE_CHANNEL);
		state.channel = ch;
		ch.onmessage = (e) => {
			setAvatarStyle(normalizeAvatarStyle(e.data), url);
		};
	} catch (error) {}
	if (typeof fetchImpl !== "function") return;
	fetchImpl(path, { credentials: "same-origin" }).then((r) => r.ok ? r.json() : void 0).then((s) => {
		if (s?.data !== void 0) setAvatarStyle(normalizeAvatarStyle(s.data.avatar_style), url);
	}).catch((error) => {});
}
function useAvatarStyle() {
	const url = useCollabUrl();
	const state = stateFor(url);
	(0, react.useEffect)(() => {
		startAvatarStyle(globalThis.fetch, url);
	}, [url]);
	return (0, react.useSyncExternalStore)((fn) => {
		state.listeners.add(fn);
		return () => {
			state.listeners.delete(fn);
		};
	}, () => state.current, () => state.current);
}
// src/client/Avatar.tsx
/** Member portrait: a built-in or bot-announced image over a colored initial badge. */
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
/** Member portrait, or a colored initial badge when there is none or the image fails to load. */
function Avatar({ id, name, avatar, avatarVersion, small, cli, model }) {
	const url = useCollabUrl();
	const style = useAvatarStyle();
	const base = avatarSrc({
		avatar,
		name,
		cli,
		model,
		id
	}, url, style);
	const src = base && avatar?.startsWith("upload:") && avatarVersion ? `${base}?v=${avatarVersion}` : base;
	const [broken, setBroken] = (0, react.useState)(void 0);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: small === true ? `${ChannelsPage_module_default.avatar} ${ChannelsPage_module_default.avatarSmall}` : ChannelsPage_module_default.avatar,
		style: { background: color(id) },
		"aria-hidden": true,
		children: [(name || id).slice(0, 1), src !== void 0 && broken !== src && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
			className: ChannelsPage_module_default.avatarImage,
			src,
			alt: "",
			onError: () => {
				setBroken(src);
			}
		})]
	});
}
// src/client/persona.ts
/**
* Rewrite only the identity references in a persona text. Replacing every
* occurrence also changes ordinary prose such as 橘色长发, 女仆长制服 or
* 一只渡鸦 when the persona name happens to be a common word.
*/
function renamePersonaIdentity(text, oldName, newName) {
	if (!oldName || oldName === newName) return text;
	let out = text;
	for (const [from, to] of [
		[`「${oldName}」`, `「${newName}」`],
		[`"${oldName}"`, `"${newName}"`],
		[`“${oldName}”`, `“${newName}”`],
		[`# 角色：${oldName}`, `# 角色：${newName}`],
		[`# Character: ${oldName}`, `# Character: ${newName}`]
	]) out = out.split(from).join(to);
	return out;
}
// src/client/avatar-upload.ts
/** Coordinates are in source pixels; the frame is 256 logical pixels wide. */
function cropRect(width, height, scale, x, y) {
	const minimum = 256 / Math.min(width, height);
	const boundedScale = Math.max(minimum, Math.min(Math.max(4, minimum), scale));
	const size = 256 / boundedScale;
	return {
		x: Math.max(0, Math.min(width - size, x)),
		y: Math.max(0, Math.min(height - size, y)),
		size,
		scale: boundedScale
	};
}
async function loadAvatar(file) {
	if (![
		"image/png",
		"image/jpeg",
		"image/webp"
	].includes(file.type)) throw new Error("avatar-png");
	if (file.size > 10485760) throw new Error("avatar-size");
	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		await new Promise((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(/* @__PURE__ */ new Error("avatar-png"));
			image.src = url;
		});
		if (!image.naturalWidth || !image.naturalHeight) throw new Error("avatar-png");
		return image;
	} catch (reason) {
		URL.revokeObjectURL(url);
		throw reason;
	}
}
var AvatarOutputSizeError = class extends Error {
	bytes;
	constructor(bytes) {
		super("avatar-output-size");
		this.bytes = bytes;
	}
};
/** Export only the selected square, preserving proportions. */
function avatarPng(image, rect) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 256;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("avatar-convert");
	context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, 256, 256);
	const data = canvas.toDataURL("image/png").split(",")[1];
	if (!data) throw new Error("avatar-convert");
	const bytes = atob(data).length;
	if (bytes > 262144) throw new AvatarOutputSizeError(bytes);
	return data;
}
async function uploadAvatar(id, png, url = (path) => path) {
	const response = await fetch(url(`collab/api/members/${encodeURIComponent(id)}/avatar`), {
		method: png === void 0 ? "DELETE" : "POST",
		headers: { "content-type": "application/json" },
		...png === void 0 ? {} : { body: JSON.stringify({ png }) }
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
	return result.member;
}
// src/client/AvatarCropDialog.tsx
function AvatarCropDialog({ image, onConfirm, onCancel, t }) {
	const minimum = 256 / Math.min(image.naturalWidth, image.naturalHeight);
	const [rect, setRect] = (0, react.useState)(() => cropRect(image.naturalWidth, image.naturalHeight, minimum, (image.naturalWidth - 256 / minimum) / 2, (image.naturalHeight - 256 / minimum) / 2));
	const [error, setError] = (0, react.useState)();
	const frame = (0, react.useRef)(null);
	const modal = (0, react.useRef)(null);
	const drag = (0, react.useRef)();
	(0, react.useLayoutEffect)(() => {
		const previous = document.activeElement;
		modal.current?.focus();
		return () => previous?.focus();
	}, []);
	const zoom = (scale) => setRect((old) => {
		const next = cropRect(image.naturalWidth, image.naturalHeight, scale, 0, 0);
		return cropRect(image.naturalWidth, image.naturalHeight, next.scale, old.x + (old.size - next.size) / 2, old.y + (old.size - next.size) / 2);
	});
	(0, react.useLayoutEffect)(() => {
		const element = frame.current;
		const wheel = (event) => {
			event.preventDefault();
			zoom(rect.scale * Math.exp(-event.deltaY * .001));
		};
		element.addEventListener("wheel", wheel, { passive: false });
		return () => element.removeEventListener("wheel", wheel);
	}, [rect.scale]);
	const confirm = () => {
		try {
			onConfirm(avatarPng(image, rect));
		} catch (reason) {
			setError(reason instanceof AvatarOutputSizeError ? t("memberAvatarOutputSizeError", { kb: (reason.bytes / 1024).toFixed(1) }) : t("memberAvatarConvertError"));
		}
	};
	return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.dialogBackdrop,
		"data-dc-scheme": getScheme(),
		onMouseDown: (event) => {
			event.stopPropagation();
			if (event.target === event.currentTarget) onCancel();
		},
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: ChannelsPage_module_default.dialog,
			role: "dialog",
			"aria-modal": "true",
			"aria-label": t("memberAvatarCrop"),
			tabIndex: -1,
			ref: modal,
			onKeyDown: (event) => {
				event.stopPropagation();
				if (event.key === "Escape") {
					event.preventDefault();
					onCancel();
				}
				if (event.key === "Enter") {
					event.preventDefault();
					confirm();
				}
				if (event.key === "Tab") {
					const controls = modal.current.querySelectorAll("input, button");
					const first = controls[0], last = controls[controls.length - 1];
					if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) {
						event.preventDefault();
						last?.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first?.focus();
					}
				}
			},
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: ChannelsPage_module_default.dialogTitle,
					children: t("memberAvatarCrop")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("memberAvatarCropHint") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.avatarCropStage,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						ref: frame,
						className: ChannelsPage_module_default.avatarCropFrame,
						"aria-label": t("memberAvatarCrop"),
						onPointerDown: (event) => {
							if (!event.isPrimary || event.button !== 0) return;
							event.currentTarget.setPointerCapture(event.pointerId);
							drag.current = {
								id: event.pointerId,
								x: event.clientX,
								y: event.clientY
							};
						},
						onPointerMove: (event) => {
							const old = drag.current;
							if (!old || old.id !== event.pointerId) return;
							const ratio = rect.size / event.currentTarget.getBoundingClientRect().width;
							const dx = (event.clientX - old.x) * ratio, dy = (event.clientY - old.y) * ratio;
							drag.current = {
								id: old.id,
								x: event.clientX,
								y: event.clientY
							};
							setRect((value) => cropRect(image.naturalWidth, image.naturalHeight, value.scale, value.x - dx, value.y - dy));
						},
						onLostPointerCapture: () => {
							drag.current = void 0;
						},
						onPointerCancel: () => {
							drag.current = void 0;
						},
						onPointerUp: (event) => {
							drag.current = void 0;
							event.currentTarget.releasePointerCapture(event.pointerId);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							src: image.src,
							alt: "",
							draggable: false,
							style: {
								width: `${image.naturalWidth / rect.size * 100}%`,
								height: `${image.naturalHeight / rect.size * 100}%`,
								left: `${-rect.x / rect.size * 100}%`,
								top: `${-rect.y / rect.size * 100}%`
							}
						})
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: ChannelsPage_module_default.field,
					children: [t("memberAvatarZoom"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "range",
						min: minimum,
						max: Math.max(4, minimum),
						step: "any",
						value: rect.scale,
						onChange: (event) => zoom(Number(event.target.value))
					})]
				}),
				error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					role: "alert",
					className: ChannelsPage_module_default.sendError,
					children: error
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.dialogActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.secondaryButton,
						onClick: onCancel,
						children: t("cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.primaryButton,
						onClick: confirm,
						children: t("memberAvatarConfirm")
					})]
				})
			]
		})
	}), document.body);
}
// src/client/MemberDialog.tsx
/**
* Add/edit dialog for one channel member: name, persona, and either a DSH
* model (grouped by provider route, as the host lists them) or, when adding, a
* CLI agent installed on this machine (Claude Code, Codex, Gemini), plus one of the built-in
* avatars or none (initial badge). Submission goes through the
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
const NO_MEMBERS = [];
/** DSH's built-in permission presets in DSH's own order; default = DSH default workspace-write (collab/cli-member.mjs DEFAULT_PERMISSION_PRESET). */
const PRESETS = [
	{
		id: "read-only",
		label: "permissionReadOnly",
		hint: "permissionReadOnlyHint"
	},
	{
		id: "workspace-write",
		label: "permissionWorkspaceWrite",
		hint: "permissionWorkspaceWriteHint"
	},
	{
		id: "danger-full-access",
		label: "permissionFullAccess",
		hint: "permissionFullAccessHint"
	}
];
const DEFAULT_PRESET = "workspace-write";
/**
* Render the member dialog.
* @param props - target member, actions, and copy.
* @returns a modal form.
*/
function MemberDialog({ member, members = NO_MEMBERS, listModels, listClis, listPersonas, onSubmit, onClose, t }) {
	const collabUrl = useCollabUrl();
	const [name, setName] = (0, react.useState)(member?.name ?? "DSH");
	const [nameCustomized, setNameCustomized] = (0, react.useState)(member === void 0 ? false : member.nameCustomized);
	const [keepName, setKeepName] = (0, react.useState)(true);
	const [personas, setPersonas] = (0, react.useState)([]);
	const [personaSlug, setPersonaSlug] = (0, react.useState)("");
	const [persona, setPersona] = (0, react.useState)(member?.persona ?? "");
	const nativeModel = member?.model && typeof member.model !== "string" ? member.model : void 0;
	const [modelKey, setModelKey] = (0, react.useState)(nativeModel ? nativeModel.provider + SEP + nativeModel.model : "");
	const [claudeModel, setClaudeModel] = (0, react.useState)(member?.cli === "claude" && typeof member.model === "string" ? member.model : "");
	const [claudeModelChanged, setClaudeModelChanged] = (0, react.useState)(false);
	const [routes, setRoutes] = (0, react.useState)(void 0);
	const [error, setError] = (0, react.useState)(void 0);
	const [busy, setBusy] = (0, react.useState)(false);
	const [type, setType] = (0, react.useState)(member?.cli !== void 0 ? "cli" : "dsh");
	const [clis, setClis] = (0, react.useState)(void 0);
	const [cli, setCli] = (0, react.useState)(member?.cli ?? "");
	const [preset, setPreset] = (0, react.useState)(member?.permissionPreset ?? DEFAULT_PRESET);
	const [avatar, setAvatar] = (0, react.useState)(member?.avatar ?? "");
	const [pendingPng, setPendingPng] = (0, react.useState)();
	const [preview, setPreview] = (0, react.useState)();
	const fileInput = (0, react.useRef)(null);
	const [cropImage, setCropImage] = (0, react.useState)();
	(0, react.useEffect)(() => () => {
		if (cropImage) URL.revokeObjectURL(cropImage.src);
	}, [cropImage]);
	const selectAvatar = async (file) => {
		setBusy(true);
		setError(void 0);
		try {
			setCropImage(await loadAvatar(file));
		} catch (reason) {
			const message = reason instanceof Error ? reason.message : String(reason);
			setError(message === "avatar-size" ? t("memberAvatarSizeError") : t("memberAvatarPngError"));
		} finally {
			setBusy(false);
		}
	};
	const changeAvatar = async (png) => {
		setBusy(true);
		setError(void 0);
		try {
			if (member) {
				const updated = await uploadAvatar(member.id, png, collabUrl);
				setAvatar(updated.avatar ?? "");
			} else {
				setPendingPng(png);
				setAvatar("");
			}
			setPreview(png ? `data:image/png;base64,${png}` : void 0);
		} catch (reason) {
			const message = reason instanceof Error ? reason.message : String(reason);
			setError(message === "avatar-png" ? t("memberAvatarPngError") : message === "avatar-size" ? t("memberAvatarSizeError") : message === "avatar-convert" ? t("memberAvatarConvertError") : errorText(reason, t));
		} finally {
			setBusy(false);
		}
	};
	const backend = type === "cli" ? CLI_CHOICES.find((c) => c.cli === cli)?.label ?? "" : "DSH";
	(0, react.useEffect)(() => {
		if (nameCustomized !== false || !backend) return;
		const used = new Set(members.filter((m) => m.id !== member?.id).map((m) => m.name.toLowerCase()));
		let next = backend;
		for (let n = 2; used.has(next.toLowerCase()); n++) next = `${backend}-${n}`;
		if (next === name) return;
		if (keepName && persona) setPersona((text) => renamePersonaIdentity(text, name, next));
		setName(next);
	}, [
		backend,
		nameCustomized,
		members,
		member?.id,
		name,
		keepName,
		persona
	]);
	(0, react.useEffect)(() => {
		if (listPersonas) listPersonas().then(setPersonas).catch((reason) => setError(String(reason)));
	}, [listPersonas]);
	(0, react.useEffect)(() => {
		let live = true;
		listModels().then((list) => {
			if (live) setRoutes(list);
		}).catch((reason) => {
			if (live) {
				setRoutes([]);
				setError(errorText(reason, t));
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
				setError(errorText(reason, t));
			}
		});
		return () => {
			live = false;
		};
	}, [wantClis, listClis]);
	const submit = (event) => {
		event.preventDefault();
		if (busy || cropImage) return;
		const [provider, model] = modelKey === "" ? [] : modelKey.split(SEP);
		setBusy(true);
		setError(void 0);
		const identity = nameCustomized === void 0 ? {} : { nameCustomized };
		const input = type === "cli" ? {
			name: name.trim(),
			...identity,
			persona,
			avatar,
			...pendingPng ? { avatarPng: pendingPng } : {},
			cli,
			permissionPreset: preset,
			...cli === "claude" && (member?.cli !== "claude" || claudeModelChanged) ? { model: claudeModel.trim() || null } : {}
		} : {
			name: name.trim(),
			...identity,
			persona,
			avatar,
			...pendingPng ? { avatarPng: pendingPng } : {},
			model: provider !== void 0 && model !== void 0 ? {
				provider,
				model
			} : null
		};
		onSubmit(input).then(onClose).catch((reason) => {
			setError(errorText(reason, t, "member", input.name));
		}).finally(() => {
			setBusy(false);
		});
	};
	const current = nativeModel ? nativeModel.provider + SEP + nativeModel.model : void 0;
	const listed = routes?.some((r) => r.models.some((m) => r.provider + SEP + m.id === current)) ?? false;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.dialogBackdrop,
		onMouseDown: (event) => {
			if (event.target === event.currentTarget) onClose();
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
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
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: name === backend ? name : `${name}·${backend}` }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("memberNoPersona") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("memberOptional") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: ChannelsPage_module_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberName") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: ChannelsPage_module_default.fieldInput,
							value: name,
							maxLength: 32,
							onChange: (event) => {
								const next = event.target.value;
								if (personaSlug && keepName && name) setPersona(renamePersonaIdentity(persona, name, next));
								setName(next);
								setNameCustomized(true);
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.field,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								id: "member-avatar-label",
								children: t("memberAvatar")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.avatarPicker,
								role: "radiogroup",
								"aria-labelledby": "member-avatar-label",
								children: ["", ...AVATARS].map((slug) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "radio",
									"aria-checked": avatar === slug,
									className: ChannelsPage_module_default.avatarOption,
									title: slug === "" ? t("memberAvatarNone") : slug,
									disabled: busy,
									onClick: () => {
										setAvatar(slug);
										setPendingPng(void 0);
										setPreview(void 0);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
										id: member?.id ?? (name.trim() || "new"),
										name: name.trim() || "?",
										avatar: slug
									})
								}, slug === "" ? "none" : slug))
							}),
							(preview || avatar.startsWith("upload:")) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: preview ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
								src: preview,
								width: 64,
								height: 64,
								alt: t("memberAvatarCustom")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
								id: member?.id ?? "new",
								name,
								avatar
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: fileInput,
								type: "file",
								accept: "image/png,image/jpeg,image/webp",
								hidden: true,
								"aria-label": t("memberAvatarUpload"),
								onChange: (event) => {
									const file = event.target.files?.[0];
									event.target.value = "";
									if (file) selectAvatar(file);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: busy,
								className: ChannelsPage_module_default.secondaryButton,
								onClick: () => fileInput.current?.click(),
								children: t("memberAvatarUpload")
							}),
							(preview || avatar.startsWith("upload:")) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: busy,
								className: ChannelsPage_module_default.secondaryButton,
								onClick: () => {
									changeAvatar();
								},
								children: t("memberAvatarReset")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberAvatarHint") })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
						className: ChannelsPage_module_default.field,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: keepName,
							onChange: (e) => setKeepName(e.target.checked)
						}), t("memberKeepName")] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						className: ChannelsPage_module_default.fieldInput,
						"aria-label": t("memberPersonaLibrary"),
						value: personaSlug,
						onChange: (e) => {
							setPersonaSlug(e.target.value);
							const p = personas.find((p) => p.slug === e.target.value);
							setPersona(p ? keepName ? renamePersonaIdentity(p.text, p.name, name) : p.text : "");
							if (p) {
								setAvatar(p.avatar || "");
								if (!keepName) {
									setName(p.name);
									setNameCustomized(true);
								}
							}
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: t("memberPersonaNone")
						}), personas.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: p.slug,
							children: p.name
						}, p.slug))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: ChannelsPage_module_default.field,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberPersona") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: ChannelsPage_module_default.fieldInput,
							rows: 4,
							value: persona,
							maxLength: 4e3,
							onChange: (e) => setPersona(e.target.value)
						})]
					})
				] }),
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
				type === "cli" && cli === "claude" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: ChannelsPage_module_default.field,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberModel") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: ChannelsPage_module_default.fieldInput,
							"aria-label": t("memberModel"),
							value: claudeModel,
							placeholder: t("memberClaudeModelDefault"),
							onChange: (event) => {
								setClaudeModel(event.target.value);
								setClaudeModelChanged(true);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberClaudeModelHint") })
					]
				}),
				type === "cli" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: ChannelsPage_module_default.field,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("memberPermission") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							className: ChannelsPage_module_default.fieldInput,
							"aria-label": t("memberPermission"),
							value: preset,
							onChange: (event) => {
								setPreset(event.target.value);
							},
							children: PRESETS.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: p.id,
								children: t(p.label)
							}, p.id))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(PRESETS.find((p) => p.id === preset)?.hint ?? "permissionWorkspaceWriteHint") })
					]
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
							current !== void 0 && !listed && nativeModel && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: current,
								children: `${nativeModel.provider}/${nativeModel.model}`
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
		}), cropImage && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvatarCropDialog, {
			image: cropImage,
			t,
			onCancel: () => setCropImage(void 0),
			onConfirm: (png) => {
				setCropImage(void 0);
				changeAvatar(png);
			}
		})]
	});
}
// src/client/ChannelSettingsDialog.tsx
const RELAY_CAP_MIN = 6;
const RELAY_CAP_MAX = 20;
const tabs = [
	"basic",
	"dispatch",
	"workspace"
];
const tabLabels = {
	basic: "settingsBasic",
	dispatch: "settingsDispatch",
	workspace: "settingsWorkspace"
};
/** Drafts and save outcomes live for the whole dialog, independently of the selected tab. */
function ChannelSettingsDialog({ room, members, effectiveLead, renameRoom, setDispatchMode, setMaxRelay, setLead, setWorkspacePath, renewRoom, initialTab = "basic", t, onClose }) {
	const [tab, setTab] = (0, react.useState)(initialTab);
	const [name, setName] = (0, react.useState)(room.name);
	const [mode, setMode] = (0, react.useState)(room.dispatch_mode ?? "mixed");
	const [relay, setRelay] = (0, react.useState)(String(room.max_relay ?? RELAY_CAP_MIN));
	const [lead, setLeadDraft] = (0, react.useState)(room.lead_id === void 0 ? effectiveLead : room.lead_id ?? "");
	const [directory, setDirectory] = (0, react.useState)(room.workspace_path ?? "");
	const [saved, setSaved] = (0, react.useState)({
		name: room.name,
		mode: room.dispatch_mode ?? "mixed",
		relay: String(room.max_relay ?? RELAY_CAP_MIN),
		lead: room.lead_id === void 0 ? effectiveLead : room.lead_id ?? "",
		directory: room.workspace_path ?? ""
	});
	const [saving, setSaving] = (0, react.useState)({});
	const [errors, setErrors] = (0, react.useState)({});
	const [success, setSuccess] = (0, react.useState)({});
	const [renewPending, setRenewPending] = (0, react.useState)(false);
	const [renewing, setRenewing] = (0, react.useState)(false);
	const dialogRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		dialogRef.current?.focus();
	}, []);
	const relayValid = /^\d+$/.test(relay) && Number(relay) >= RELAY_CAP_MIN && Number(relay) <= RELAY_CAP_MAX;
	const dirty = {
		basic: room.kind !== "workspace" && name !== saved.name,
		dispatch: mode !== saved.mode || relay !== saved.relay || lead !== saved.lead,
		workspace: directory !== saved.directory
	};
	const close = () => {
		if (Object.values(saving).some(Boolean) || renewing) return;
		if (Object.values(dirty).some(Boolean) && !window.confirm(t("settingsDiscardConfirm"))) return;
		onClose();
	};
	const clearFeedback = (target) => {
		setErrors((previous) => ({
			...previous,
			[target]: void 0
		}));
		setSuccess((previous) => ({
			...previous,
			[target]: false
		}));
	};
	const save = async (target) => {
		if (saving[target] || !dirty[target]) return;
		if (target === "basic" && (!name || name.length > 32 || /\s/.test(name))) return;
		if (target === "dispatch" && !relayValid) return;
		if (target === "workspace" && (!directory || renewing || renewPending)) return;
		setSaving((previous) => ({
			...previous,
			[target]: true
		}));
		clearFeedback(target);
		try {
			if (target === "basic") {
				await renameRoom(room.id, name);
				setSaved((previous) => ({
					...previous,
					name
				}));
			} else if (target === "dispatch") {
				if (mode !== saved.mode) {
					await setDispatchMode(room.id, mode);
					setSaved((previous) => ({
						...previous,
						mode
					}));
				}
				if (lead !== saved.lead) {
					await setLead(lead, room.id);
					setSaved((previous) => ({
						...previous,
						lead
					}));
				}
				if (relay !== saved.relay) {
					await setMaxRelay(room.id, Number(relay));
					setSaved((previous) => ({
						...previous,
						relay
					}));
				}
			} else {
				await setWorkspacePath(room.id, directory);
				setSaved((previous) => ({
					...previous,
					directory
				}));
				setRenewPending(true);
			}
			setSuccess((previous) => ({
				...previous,
				[target]: true
			}));
		} catch (error) {
			setErrors((previous) => ({
				...previous,
				[target]: errorText(error, t, target === "basic" ? "room" : "other", name)
			}));
		} finally {
			setSaving((previous) => ({
				...previous,
				[target]: false
			}));
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.dialogBackdrop,
		onClick: close,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
			ref: dialogRef,
			tabIndex: -1,
			className: `${ChannelsPage_module_default.dialog} ${ChannelsPage_module_default.settingsDialog}`,
			role: "dialog",
			"aria-modal": "true",
			"aria-label": t("channelSettings"),
			onClick: (event) => {
				event.stopPropagation();
			},
			onKeyDown: (event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					close();
				}
				if (event.key !== "Tab") return;
				const controls = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex=\"0\"]")).filter((control) => control.tabIndex >= 0);
				const first = controls[0];
				const last = controls[controls.length - 1];
				if (!controls.includes(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
					event.preventDefault();
					(event.shiftKey ? last : first)?.focus();
				}
			},
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					className: ChannelsPage_module_default.dialogTitle,
					children: t("channelSettings")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.boardTabs,
					role: "tablist",
					"aria-label": t("channelSettings"),
					children: tabs.map((value, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						id: `settings-tab-${value}`,
						type: "button",
						role: "tab",
						"aria-selected": tab === value,
						"aria-controls": `settings-panel-${value}`,
						tabIndex: tab === value ? 0 : -1,
						onClick: () => {
							setTab(value);
						},
						onKeyDown: (event) => {
							if (![
								"ArrowLeft",
								"ArrowRight",
								"Home",
								"End"
							].includes(event.key)) return;
							event.preventDefault();
							const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(index + (event.key === "ArrowRight" ? 1 : 2)) % tabs.length];
							setTab(next);
							document.getElementById(`settings-tab-${next}`)?.focus();
						},
						children: t(tabLabels[value])
					}, value))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.settingsBody,
					id: `settings-panel-${tab}`,
					role: "tabpanel",
					"aria-labelledby": `settings-tab-${tab}`,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						id: "channel-settings-form",
						className: ChannelsPage_module_default.settingsFields,
						onSubmit: (event) => {
							event.preventDefault();
							save(tab);
						},
						children: [
							tab === "basic" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: ChannelsPage_module_default.field,
								children: [
									t("channelName"),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: ChannelsPage_module_default.fieldInput,
										"aria-label": t("channelName"),
										value: name,
										disabled: saving.basic || room.kind === "workspace",
										onChange: (event) => {
											setName(event.target.value);
											clearFeedback("basic");
										},
										onKeyDown: (event) => {
											if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(room.kind === "workspace" ? "workspaceNameFixed" : "channelNameHint") })
								]
							}) }),
							tab === "dispatch" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ChannelsPage_module_default.field,
									role: "radiogroup",
									"aria-label": t("dispatchMode"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dispatchMode") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.choiceColumn,
										children: [
											"solo",
											"team",
											"mixed"
										].map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											className: ChannelsPage_module_default.choice,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "radio",
												name: "settings-dispatch-mode",
												disabled: saving.dispatch,
												checked: mode === value,
												onChange: () => {
													setMode(value);
													clearFeedback("dispatch");
												}
											}), t(value === "solo" ? "dispatchSolo" : value === "team" ? "dispatchTeam" : "dispatchMixed")]
										}, value))
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: ChannelsPage_module_default.field,
									children: [t("channelLead"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
										className: ChannelsPage_module_default.fieldInput,
										"aria-label": t("channelLead"),
										value: lead,
										disabled: saving.dispatch,
										onChange: (event) => {
											setLeadDraft(event.target.value);
											clearFeedback("dispatch");
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: t("leadNone")
										}), members.filter((member) => member.kind !== "human").map((member) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: member.id,
											children: member.name
										}, member.id))]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: ChannelsPage_module_default.field,
									children: [
										t("settingsRelay"),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: ChannelsPage_module_default.fieldInput,
											type: "number",
											min: RELAY_CAP_MIN,
											max: RELAY_CAP_MAX,
											step: 1,
											"aria-label": t("settingsRelay"),
											value: relay,
											disabled: saving.dispatch,
											onChange: (event) => {
												setRelay(event.target.value);
												clearFeedback("dispatch");
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("settingsRelayHint") })
									]
								})
							] }),
							tab === "workspace" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: ChannelsPage_module_default.field,
								children: [
									t("workingDirectory"),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: ChannelsPage_module_default.fieldInput,
										"aria-label": t("workingDirectory"),
										value: directory,
										disabled: saving.workspace || renewing || renewPending,
										onChange: (event) => {
											setDirectory(event.target.value);
											clearFeedback("workspace");
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("workingDirectoryHint") })
								]
							}) })
						]
					}), tab === "workspace" && renewPending && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: ChannelsPage_module_default.settingsFields,
						role: "alertdialog",
						"aria-label": t("renewConfirm"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.field,
							children: t("renewConfirm")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.dialogActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ChannelsPage_module_default.secondaryButton,
								disabled: renewing,
								onClick: () => {
									setRenewPending(false);
								},
								children: t("renewLater")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ChannelsPage_module_default.primaryButton,
								disabled: renewing,
								onClick: () => {
									setRenewing(true);
									setErrors((previous) => ({
										...previous,
										workspace: void 0
									}));
									renewRoom(room.id).then(() => {
										setRenewPending(false);
									}).catch((error) => {
										setErrors((previous) => ({
											...previous,
											workspace: errorText(error, t)
										}));
									}).finally(() => {
										setRenewing(false);
									});
								},
								children: t("renewNow")
							})]
						})]
					})]
				}),
				(errors[tab] !== void 0 || success[tab]) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ChannelsPage_module_default.settingsFeedback,
					children: errors[tab] !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.sendError,
						role: "alert",
						children: errors[tab]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.field,
						role: "status",
						children: t("settingsSaved")
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.dialogActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.secondaryButton,
						disabled: Object.values(saving).some(Boolean) || renewing,
						onClick: close,
						children: t("close")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "submit",
						form: "channel-settings-form",
						"aria-busy": Boolean(saving[tab]),
						className: ChannelsPage_module_default.primaryButton,
						disabled: saving[tab] || !dirty[tab] || tab === "basic" && (!name || name.length > 32 || /\s/.test(name)) || tab === "dispatch" && !relayValid || tab === "workspace" && (!directory || renewing || renewPending),
						children: t(saving[tab] ? "settingsSaving" : "messageSave")
					})]
				})
			]
		})
	});
}
function headTeam(members, leadId, tasks, thinking, rooms) {
	return members.filter((m) => m.kind !== "human" && m.id !== leadId).map((member) => {
		const replying = [...rooms].some((id) => (thinking[String(id)] ?? []).includes(member.id));
		const task = tasks.filter((t) => t.owner === member.id && rooms.has(t.room_id) && isLiveTask(t)).sort((a, b) => b.updated_at - a.updated_at)[0];
		return {
			member,
			state: member.error ? "error" : !member.online ? "offline" : replying || task !== void 0 ? "busy" : "idle",
			task,
			replying
		};
	});
}
const STATE_KEY = {
	busy: "mateBusy",
	idle: "mateIdle",
	error: "mateError",
	offline: "mateOffline"
};
function mateLabel(mate, t) {
	const doing = mate.task !== void 0 ? t("mateTask", {
		id: String(mate.task.id),
		title: mate.task.title
	}) : mate.replying ? t("mateReplying") : "";
	return [
		mate.member.name,
		t(STATE_KEY[mate.state]),
		doing
	].filter(Boolean).join(" · ");
}
function HeadTeam({ mates, t, onOpen }) {
	if (mates.length === 0) return null;
	const shown = mates.slice(0, 4);
	const rest = mates.length - shown.length;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.headTeam,
		role: "group",
		"aria-label": t("headTeam"),
		children: [shown.map((mate) => {
			const label = mateLabel(mate, t);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ChannelsPage_module_default.mate,
				"data-state": mate.state,
				title: label,
				"aria-label": label,
				onClick: onOpen,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
					id: mate.member.id,
					name: mate.member.name,
					avatar: mate.member.avatar,
					avatarVersion: mate.member.avatarVersion,
					small: true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ChannelsPage_module_default.mateDot,
					"aria-hidden": true
				})]
			}, mate.member.id);
		}), rest > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: ChannelsPage_module_default.mateMore,
			title: mates.slice(4).map((m) => mateLabel(m, t)).join("\n"),
			"aria-label": t("headTeamMore", { count: String(rest) }),
			onClick: onOpen,
			children: ["+", rest]
		})]
	});
}
// src/client/PermissionCard.tsx
/**
* Buttons for a cloud-web bot's permission prompt (#120). The card JSON is
* written by dsh/collab/cloudweb.mjs; the decision goes to
* POST collab/api/messages/{id}/permission, and the updated card arrives back
* as a `message` event, so the state shown here always comes from the server.
*/
const STATE_TEXT = {
	allowed: "permAllowed",
	denied: "permDenied",
	allowed_all: "permAllowedAll",
	expired: "permExpired"
};
function PermissionCard({ messageId, card, t, onDecide }) {
	const [busy, setBusy] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)(void 0);
	if (card.state !== "pending") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.permStatus,
		role: "status",
		children: [t(STATE_TEXT[card.state]), card.decided_by === "text" && ` ${t("permByText")}`]
	});
	const decide = (decision) => {
		if (busy) return;
		setBusy(true);
		setError(void 0);
		onDecide(messageId, decision).catch((e) => {
			setError(e instanceof Error ? e.message : String(e));
		}).finally(() => {
			setBusy(false);
		});
	};
	const order = {
		allow: 0,
		deny: 1,
		allow_all: 2
	};
	const actions = [...card.actions].sort((a, b) => order[a.decision] - order[b.decision]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.permActions,
		children: [actions.map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: a.decision === "allow" ? ChannelsPage_module_default.primaryButton : a.decision === "deny" ? ChannelsPage_module_default.secondaryButton : ChannelsPage_module_default.permSessionButton,
			title: a.decision === "allow_all" ? t("permAllowAllScope") : void 0,
			disabled: busy,
			onClick: () => {
				decide(a.decision);
			},
			children: a.decision === "allow" ? t("permAllowOnce") : a.decision === "allow_all" ? t("permAllowSession") : a.label
		}, a.decision)), error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: ChannelsPage_module_default.sendError,
			role: "alert",
			children: error
		})]
	});
}
/** Questions waiting on the lead/user in these rooms, oldest first so the longest wait is on top. */
function openQuestions(tasks, rooms) {
	return tasks.filter((task) => task.status === "asked" && task.paused_at == null && rooms.has(task.room_id)).sort((a, b) => a.updated_at - b.updated_at);
}
function AskItem({ reply, t, onDraft, onSend, onUndo, isImeEnter }) {
	const { task, draft, phase, error } = reply;
	let tail;
	if (phase.kind === "pending") tail = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: ChannelsPage_module_default.askDone,
		role: "status",
		children: [t("askReplied", { text: phase.text }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: ChannelsPage_module_default.linkButton,
			onClick: onUndo,
			children: t("askUndo", { n: String(phase.left) })
		})]
	});
	else if (phase.kind === "sent") tail = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: ChannelsPage_module_default.askDone,
		role: "status",
		children: t("askReplied", { text: phase.text })
	});
	else tail = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
		className: ChannelsPage_module_default.askForm,
		onSubmit: (event) => {
			event.preventDefault();
			onSend();
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
			className: ChannelsPage_module_default.askInput,
			value: draft,
			placeholder: t("askPlaceholder"),
			"aria-label": t("askReplyTo", { id: String(task.id) }),
			onChange: (event) => {
				onDraft(event.target.value);
			},
			onKeyDown: (event) => {
				if (event.key === "Enter" && !event.shiftKey && !isImeEnter(event)) {
					event.preventDefault();
					onSend();
				}
			}
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "submit",
			className: ChannelsPage_module_default.askSend,
			title: t("askSend"),
			"aria-label": t("askSend"),
			disabled: draft.trim() === "",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "14",
				height: "14",
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "2.4",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 19V5m-6 6 6-6 6 6" })
			})
		})]
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.askItem,
		"data-task-id": task.id,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.askKind,
				children: t("askKind")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.askText,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ChannelsPage_module_default.askQuestion,
					children: task.note?.trim() || t("askNoNote")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
					className: ChannelsPage_module_default.askFrom,
					children: t("askFrom", {
						name: task.owner_name,
						id: String(task.id),
						title: task.title
					})
				})]
			}),
			tail,
			phase.kind === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.askNotice,
				role: "status",
				children: t("askApiPending")
			}),
			error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.sendError,
				role: "alert",
				children: error
			})
		]
	});
}
/** A reply keeps its row while it counts down or after it failed, even once the task left `asked`,
* so the user can still undo it or see the error. Drafts and delivered replies of tasks no longer
* asked are not shown. */
function inFlight(reply) {
	return reply.phase.kind === "pending" || reply.error !== void 0;
}
/**
* The folding tray. `permissions` is the existing permission list (rendered by the page), so
* its buttons and server-driven states stay exactly as before; the tray only adds the header
* and the questions. Renders nothing when neither waits.
*/
function DecideTray({ questions, permissionCount, permissions, t, onAnswer, isImeEnter }) {
	const [open, setOpen] = (0, react.useState)(true);
	const [replies, setReplies] = (0, react.useState)(/* @__PURE__ */ new Map());
	const timers = (0, react.useRef)(/* @__PURE__ */ new Map());
	const answerRef = (0, react.useRef)(onAnswer);
	answerRef.current = onAnswer;
	(0, react.useEffect)(() => () => {
		for (const id of timers.current.values()) clearInterval(id);
	}, []);
	const asked = new Map(questions.map((task) => [task.id, task]));
	const askedKey = questions.map((task) => task.id).join(",");
	(0, react.useEffect)(() => {
		setReplies((prev) => {
			const stale = [...prev.values()].filter((r) => !asked.has(r.task.id) && !inFlight(r));
			if (stale.length === 0) return prev;
			const next = new Map(prev);
			for (const r of stale) next.delete(r.task.id);
			return next;
		});
	}, [askedKey]);
	const patch = (taskId, change) => {
		setReplies((prev) => {
			const known = prev.get(taskId);
			const task = asked.get(taskId) ?? known?.task;
			if (task === void 0) return prev;
			const next = new Map(prev);
			const changed = change(known ?? {
				draft: "",
				phase: { kind: "draft" },
				task
			});
			if (changed === void 0) next.delete(taskId);
			else next.set(taskId, changed);
			return next;
		});
	};
	const stop = (taskId) => {
		clearInterval(timers.current.get(taskId));
		timers.current.delete(taskId);
	};
	const deliver = (taskId, text) => {
		stop(taskId);
		patch(taskId, (r) => ({
			...r,
			phase: {
				kind: "sent",
				text
			}
		}));
		answerRef.current?.(taskId, text).catch((e) => {
			patch(taskId, (r) => ({
				...r,
				phase: { kind: "draft" },
				draft: text,
				error: e instanceof Error ? e.message : String(e)
			}));
		});
	};
	const send = (taskId) => {
		const reply = replies.get(taskId);
		const text = (reply?.draft ?? "").trim();
		if (text === "" || reply?.phase.kind === "pending") return;
		if (onAnswer === void 0) {
			patch(taskId, (r) => ({
				...r,
				error: void 0,
				phase: { kind: "unavailable" }
			}));
			return;
		}
		patch(taskId, (r) => ({
			...r,
			draft: "",
			error: void 0,
			phase: {
				kind: "pending",
				text,
				left: 5
			}
		}));
		let left = 5;
		stop(taskId);
		timers.current.set(taskId, setInterval(() => {
			left -= 1;
			if (left <= 0) deliver(taskId, text);
			else patch(taskId, (r) => ({
				...r,
				phase: {
					kind: "pending",
					text,
					left
				}
			}));
		}, 1e3));
	};
	const undo = (taskId) => {
		stop(taskId);
		patch(taskId, (r) => r.phase.kind === "pending" ? {
			...r,
			draft: r.phase.text,
			phase: { kind: "draft" }
		} : r);
	};
	const draftOf = (taskId, text) => {
		patch(taskId, (r) => ({
			...r,
			draft: text,
			phase: r.phase.kind === "unavailable" ? { kind: "draft" } : r.phase
		}));
	};
	const rows = questions.map((task) => {
		const known = replies.get(task.id);
		return known === void 0 ? {
			draft: "",
			phase: { kind: "draft" },
			task
		} : {
			...known,
			task
		};
	});
	for (const reply of replies.values()) if (!asked.has(reply.task.id) && inFlight(reply)) rows.push(reply);
	if (rows.length === 0 && permissionCount === 0) return null;
	const head = t("trayAsks", { count: String(rows.length + permissionCount) });
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: ChannelsPage_module_default.decideTray,
		role: "region",
		"aria-label": t("decideTray"),
		"data-open": open,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: ChannelsPage_module_default.decideTrayHead,
			"aria-expanded": open,
			onClick: () => {
				setOpen(!open);
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: head }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.decideTrayToggle,
				children: t(open ? "trayCollapse" : "trayExpand")
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			hidden: !open,
			children: [rows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.askList,
				children: rows.map((reply) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AskItem, {
					reply,
					t,
					onDraft: (text) => {
						draftOf(reply.task.id, text);
					},
					onSend: () => {
						send(reply.task.id);
					},
					onUndo: () => {
						undo(reply.task.id);
					},
					isImeEnter
				}, reply.task.id))
			}), permissions]
		})]
	});
}
/** How long a withdrawal can still be undone, ms. 来源：用户 11-03 23:1x 同意「撤回不弹确认、底部 5 秒撤销条」 */
const WITHDRAW_UNDO_MS = 5e3;
function createLiveTracker() {
	return {
		roomId: void 0,
		maxId: Number.NEGATIVE_INFINITY,
		fresh: /* @__PURE__ */ new Map()
	};
}
/**
* Record which rows of `messages` arrived live. The first fill of a room, a
* room switch and older pages (ids below the known maximum) never animate.
*/
function trackLive(tracker, roomId, messages) {
	const last = messages.length === 0 ? Number.NEGATIVE_INFINITY : messages[messages.length - 1].id;
	if (tracker.roomId !== roomId || tracker.maxId === Number.NEGATIVE_INFINITY) {
		tracker.roomId = roomId;
		tracker.maxId = last;
		tracker.fresh = /* @__PURE__ */ new Map();
		return tracker.fresh;
	}
	let slot = 0;
	for (const m of messages) {
		if (m.id <= tracker.maxId || tracker.fresh.has(m.id)) continue;
		tracker.fresh.set(m.id, Math.min(slot, 5));
		slot++;
	}
	if (last > tracker.maxId) tracker.maxId = last;
	return tracker.fresh;
}
/** Rows from `fromId` on that someone else wrote: what the "back to latest" pill counts. */
function unreadCount(messages, fromId) {
	return messages.filter((m) => m.id >= fromId && m.author_kind !== "user").length;
}
/** The last message you wrote that can still be edited (no card, not being withdrawn). */
function lastOwnEditable(messages, skipId) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.author_kind === "user" && m.card === null && m.id !== skipId) return m;
	}
}
/** Whether the reader asked the system to reduce motion. */
function prefersReducedMotion() {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
// src/client/ChannelsPage.tsx
/**
* Channels main panel: room list, message stream with composer, and member
* activity panel, in a conversation-first layout. All data arrives through the
* injected `useChannels` hook; posting goes through the injected actions.
*/
const CLI_TAG = {
	claude: "kindClaude",
	codex: "kindCodex",
	gemini: "kindGemini"
};
function KindTag({ kind, cli, name, t }) {
	if (cli !== void 0) {
		const label = t(CLI_TAG[cli]);
		return name === label ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: ChannelsPage_module_default.tag,
			children: ["·", label]
		});
	}
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
/** IME candidate confirmation (desktop isComposing, iOS/Android keyCode 229) must not send/select/save. */
function isImeEnter(event) {
	return Reflect.get(event.nativeEvent, "isComposing") === true || Reflect.get(event.nativeEvent, "keyCode") === 229;
}
/**
* #197: an object URL for an image the composer is about to send, so no base64 copy is
* held for the thumbnail. A browser or test environment without createObjectURL simply
* shows the 📎 instead of a preview.
*/
function previewOf(file) {
	if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 8388608) return void 0;
	if (typeof URL.createObjectURL !== "function") return void 0;
	try {
		return URL.createObjectURL(file);
	} catch {
		return;
	}
}
/** Touch or narrow screens get the short composer placeholder (the long one wraps beside the send button). */
function compactComposer() {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none), (max-width: 600px)").matches;
}
/** The quoted original above a reply; a deleted original shows only a placeholder. */
function Quote({ quote, t, members, onMention }) {
	if (quote.deleted === true) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: `${ChannelsPage_module_default.quote} ${ChannelsPage_module_default.quoteDeleted}`,
		children: t("replyDeleted")
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.quote,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: ChannelsPage_module_default.quoteAuthor,
			children: quote.name
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: members ? renderQuoteMentions(quote.text, members, onMention) : quote.text })]
	});
}
const CARD_VIEW_DEFAULT = "brief";
const CARD_VIEW_KEY = "dsh-channels-card-view:";
function loadCardView(roomId) {
	try {
		const v = globalThis.localStorage?.getItem(CARD_VIEW_KEY + roomId);
		if (v === "detail" || v === "brief") return v;
	} catch (error) {}
	return CARD_VIEW_DEFAULT;
}
function saveCardView(roomId, view) {
	try {
		globalThis.localStorage?.setItem(CARD_VIEW_KEY + roomId, view);
	} catch (error) {}
}
function parseCard(message) {
	if (message.card === null) return void 0;
	try {
		return JSON.parse(message.card);
	} catch (error) {}
}
/**
* What the lead is doing, from real data only (11-04 review of the white scheme: the capsule
* must say 「在干啥」— the current task's short name or the live progress-card brief; when
* the lead is busy but reported nothing, say so instead of inventing text).
* Order: failure/offline, then the lead's live task in this channel or its workspaces,
* then the last line of its running progress card here, then busy-without-task, then idle.
*/
function leadDoing(lead, { tasks, rooms, thinking, messages }, t) {
	if (lead.error) return t("memberFailed");
	if (lead.online === false) return t("offline");
	const task = tasks.filter((x) => x.owner === lead.id && rooms.has(x.room_id) && boardGroupOf(x) === "working").sort((a, b) => b.updated_at - a.updated_at)[0];
	if (task !== void 0) return `#${task.id} ${task.title}`;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.author !== lead.id) continue;
		const card = parseCard(m);
		if (cardRole(card) !== "progress" || card?.state !== "running") continue;
		const line = (card.brief ?? "").split("\n").map((x) => x.trim()).filter(Boolean).at(-1);
		if (line) return line;
		break;
	}
	if ([...rooms].some((id) => (thinking[String(id)] ?? []).includes(lead.id))) return t("headLeadBusyUnreported");
	return t("headLeadIdle");
}
function cardRole(card) {
	if (card === void 0) return "none";
	if (card.kind === "permission") return "permission";
	if (card.kind === "task") return "task";
	if (card.kind === void 0 && card.action === void 0 && (typeof card.steps === "number" || typeof card.brief === "string" || card.state === "running" || card.state === "completed")) return "progress";
	if (card.action === "configure-model" || card.state === "failed" || card.state === "retried") return "failure";
	return "other";
}
/** A pending permission request: its buttons live in the tray above the composer. */
function pendingPermission(message) {
	const card = parseCard(message);
	return card?.kind === "permission" && card.state === "pending";
}
/** 用户 2026-11-04：完成的零/一步进度不占聊天行；失败步骤仍须可见。 */
function trivialProgress(message) {
	const card = parseCard(message);
	return cardRole(card) === "progress" && card?.state === "completed" && typeof card.steps === "number" && Number.isInteger(card.steps) && card.steps >= 0 && card.steps <= 1 && !chipsOf(card)?.some((chip) => chip.state === "failed") && !(card.brief ?? message.text).split("\n").some((line) => line.startsWith("❌ "));
}
const GROUP_WINDOW_SEC = 300;
/** Same author, close in time, plain or progress: the row drops its avatar and name. */
function continues(previous, message) {
	if (previous === void 0 || previous.author_kind === "system" || message.author_kind === "system") return false;
	if (previous.author !== message.author || previous.author_kind !== message.author_kind) return false;
	if (message.reply_to !== void 0 || message.created_at - previous.created_at > GROUP_WINDOW_SEC) return false;
	const role = cardRole(parseCard(message));
	const before = cardRole(parseCard(previous));
	return (role === "none" || role === "progress") && (before === "none" || before === "progress");
}
function clockOf(seconds) {
	return (/* @__PURE__ */ new Date(seconds * 1e3)).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit"
	});
}
/**
* #216: fill the "held by another DSH" notice from the holder record. A record written by an
* older build may miss a field, so each one falls back to its own unknown placeholder rather
* than printing `undefined`. `dataDir` and `lock` come from the refused instance too: a holder
* that wrote no record still leaves the page able to name the contended directory and file.
*/
function lockHolderText(holder, dataDir, lockPath, t) {
	const unknown = t("lockedUnknown");
	return {
		pid: holder?.pid ?? unknown,
		started: holder?.startedAt === void 0 ? unknown : new Date(holder.startedAt).toLocaleString([], {
			month: "numeric",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		}),
		dataDir: holder?.dataDir ?? dataDir ?? unknown,
		lock: lockPath ?? unknown
	};
}
/** #1020: the memory entries a reply used — a small badge that opens to their titles. */
function MemoryBadge({ items, t }) {
	const [open, setOpen] = (0, react.useState)(false);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.memory,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: ChannelsPage_module_default.memoryBadge,
			"aria-expanded": open,
			onClick: () => {
				setOpen(!open);
			},
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					children: "◇"
				}),
				" ",
				t("memoryBadge", { count: items.length })
			]
		}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
			className: ChannelsPage_module_default.memoryList,
			"aria-label": t("memoryList"),
			children: items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: ChannelsPage_module_default.memoryItem,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ChannelsPage_module_default.memoryTitle,
					children: item.title || t("memoryMoved")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ChannelsPage_module_default.memoryPage,
					children: [
						item.page,
						" #",
						item.ref
					]
				})]
			}, item.id))
		})]
	});
}
const LONG_PRESS_MS = 450;
function MessageRow({ message, member, members, t, onConfigure, menuOpen, onAvatar, onCloseMenu, onMention, onDm, onReview, onDecide, onReply, onTask, onRetry, retrying, tasks, focused, cardView, onCardView, own, grouped, enter, queuedFor, taskCardShown = true, toolsOpen = false, onLongPress, chatRoom = false }) {
	const collabUrl = useCollabUrl();
	const labels = (0, react.useMemo)(() => ({
		code: {
			copyLabel: t("copyCode"),
			copiedLabel: t("copiedCode")
		},
		footnotes: t("footnotes")
	}), [t]);
	const card = parseCard(message);
	const role = cardRole(card);
	const shown = typeof card?.brief === "string" && cardView === "brief" ? role === "progress" ? compactBrief(card.brief) : card.brief : message.text;
	const markdown = (0, react.useMemo)(() => softBreaksToHard(shown), [shown]);
	const stepLines = role === "progress" ? shown.slice(shown.indexOf("\n") + 1).split("\n") : [];
	const steps = chatRoom && stepLines.length > 3 ? [t("stepsFolded", { total: String(stepLines.length) }), ...stepLines.slice(-3)].join("\n") : stepLines.join("\n");
	const stepsMarkdown = (0, react.useMemo)(() => steps === "" ? "" : softBreaksToHard(steps), [steps]);
	const fullTime = (/* @__PURE__ */ new Date(message.created_at * 1e3)).toLocaleString();
	const editButtonRef = (0, react.useRef)(null);
	const [toolNote, setToolNote] = (0, react.useState)(void 0);
	const noteTimer = (0, react.useRef)(void 0);
	(0, react.useEffect)(() => () => {
		clearTimeout(noteTimer.current);
	}, []);
	const noteRef = (0, react.useRef)(null);
	const [noteBelow, setNoteBelow] = (0, react.useState)(false);
	const showNote = (next) => {
		clearTimeout(noteTimer.current);
		setNoteBelow(false);
		setToolNote(next);
	};
	(0, react.useLayoutEffect)(() => {
		if (toolNote === void 0 || noteBelow) return;
		const el = noteRef.current;
		if (el === null) return;
		let clip;
		for (let node = el.parentElement; node !== null; node = node.parentElement) {
			const overflowY = getComputedStyle(node).overflowY;
			if (overflowY === "auto" || overflowY === "scroll") {
				clip = node;
				break;
			}
		}
		if (clip === void 0) return;
		if (el.getBoundingClientRect().top < clip.getBoundingClientRect().top + clip.clientTop) setNoteBelow(true);
	}, [toolNote, noteBelow]);
	const note = (tool, text) => {
		showNote({
			tool,
			text
		});
		noteTimer.current = setTimeout(() => {
			setToolNote(void 0);
		}, 2e3);
	};
	const copy = () => {
		const done = () => {
			note("copy", t("toolCopied"));
		};
		const clip = globalThis.navigator?.clipboard;
		if (clip === void 0) {
			note("copy", t("toolCopyFailed"));
			return;
		}
		clip.writeText(message.text).then(done, () => {
			note("copy", t("toolCopyFailed"));
		});
	};
	const toTask = () => {
		if (onTask === void 0 || toolNote?.tool === "task") return;
		setToolNote({
			tool: "task",
			text: t("toolTasking")
		});
		setNoteBelow(false);
		onTask(message).then(() => {
			note("task", t("toolTasked"));
		}, (error) => {
			note("task", t("toolTaskFailed", { message: error instanceof Error ? error.message : String(error) }));
		});
	};
	const press = (0, react.useRef)(void 0);
	(0, react.useEffect)(() => () => {
		clearTimeout(press.current);
	}, []);
	const startPress = () => {
		clearTimeout(press.current);
		if (onLongPress !== void 0) press.current = setTimeout(onLongPress, LONG_PRESS_MS);
	};
	const endPress = () => {
		clearTimeout(press.current);
	};
	const wasEditing = (0, react.useRef)(false);
	const isEditing = own?.editing !== void 0;
	(0, react.useEffect)(() => {
		if (wasEditing.current && !isEditing && own?.editingOther !== true) editButtonRef.current?.focus();
		wasEditing.current = isEditing;
	}, [isEditing, own?.editingOther]);
	const rawError = typeof card?.detail === "string" && card.detail !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
		className: ChannelsPage_module_default.cardDetail,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("rawError") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: card.detail })]
	});
	const retryButtons = (role === "failure" || card?.state === "failed") && card !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.cardButtons,
		children: [card.state !== "retried" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: ChannelsPage_module_default.secondaryButton,
			disabled: retrying,
			onClick: () => onRetry(message.id),
			children: retrying ? t("retrying") : t("retry")
		}), card.action === "configure-model" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			className: ChannelsPage_module_default.secondaryButton,
			onClick: onConfigure,
			children: t("configureModel")
		})]
	});
	const enterClass = enter === void 0 ? "" : message.author_kind === "user" ? ChannelsPage_module_default.enterOwn : ChannelsPage_module_default.enter;
	const enterStyle = enter ? { animationDelay: `${enter * 18}ms` } : void 0;
	if (message.author_kind === "system" && (role === "none" || role === "task")) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: [
			ChannelsPage_module_default.systemRecord,
			enterClass,
			focused ? ChannelsPage_module_default.focused : ""
		].filter(Boolean).join(" "),
		style: enterStyle,
		"data-message-id": message.id,
		role: "note",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: ChannelsPage_module_default.systemLine,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.systemText,
				title: fullTime,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HighlightedMarkdown, {
					text: markdown,
					labels,
					members,
					onMention,
					inline: true
				})
			})
		}), card?.kind === "task" && typeof card.task_id === "number" && taskCardShown && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: `${ChannelsPage_module_default.card} ${ChannelsPage_module_default.taskRecord}`,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
				taskId: card.task_id,
				tasks,
				t
			})
		})]
	});
	if (message.author_kind === "system" && role === "failure") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: [
			ChannelsPage_module_default.errorBar,
			enterClass,
			focused ? ChannelsPage_module_default.focused : ""
		].filter(Boolean).join(" "),
		style: enterStyle,
		"data-message-id": message.id,
		"data-state": card?.state,
		role: "alert",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.errorIcon,
				"aria-hidden": true,
				children: "!"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(HighlightedMarkdown, {
				text: markdown,
				labels,
				members,
				className: ChannelsPage_module_default.errorText,
				onMention
			}),
			rawError,
			retryButtons
		]
	});
	const classes = [
		ChannelsPage_module_default.message,
		grouped ? ChannelsPage_module_default.grouped : "",
		message.author_kind === "user" ? ChannelsPage_module_default.own : "",
		focused ? ChannelsPage_module_default.focused : "",
		enterClass,
		enter !== void 0 && message.author_kind !== "user" ? ChannelsPage_module_default.enterGlow : ""
	].filter(Boolean).join(" ");
	const anchored = card?.kind === "task" ? [] : tasks.filter((task) => task.assign_msg_id === message.id);
	const anchoredIds = new Set(anchored.map((task) => task.id));
	const taskCards = anchored.filter((task) => task.parent_task === null || !anchoredIds.has(task.parent_task));
	const progressLines = role === "progress" ? shown.split("\n") : [];
	const deliveredFor = deliveredTasks(message, tasks);
	const deliveredPage = deliveredFor.length > 0 ? deliverableOf(message, collabUrl) : void 0;
	const delivered = deliveredPage === void 0 ? void 0 : {
		page: deliveredPage,
		task: deliveredFor.find((task) => task.status === "returned") ?? deliveredFor[0]
	};
	const progressFolded = role === "progress" && cardView === "brief" && card?.state === "completed";
	const chips = role === "progress" ? chipsOf(card) : void 0;
	const tools = message.author_kind !== "system" && card === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: ChannelsPage_module_default.msgTools,
		"data-message-tools": true,
		children: [
			toolNote !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref: noteRef,
				className: `${ChannelsPage_module_default.msgToolNote} ${noteBelow ? ChannelsPage_module_default.msgToolNoteBelow : ""}`,
				"data-note-below": noteBelow ? "" : void 0,
				role: "status",
				children: toolNote.text
			}),
			message.text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.msgTool,
				"data-tip": t("toolCopy"),
				"aria-label": t("toolCopy"),
				onClick: copy,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					width: "15",
					height: "15",
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "9",
						y: "9",
						width: "11",
						height: "11",
						rx: "2"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5 15V6a2 2 0 0 1 2-2h8" })]
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: `${ChannelsPage_module_default.msgTool} ${ChannelsPage_module_default.replyButton}`,
				"data-tip": t("reply"),
				"aria-label": t("reply"),
				onClick: () => {
					onReply(message);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					width: "15",
					height: "15",
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9 14 4 9l5-5" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 9h10a6 6 0 0 1 6 6v5" })]
				})
			}),
			onTask !== void 0 && message.text.trim() !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.msgTool,
				"data-tip": t("toolTaskHint"),
				"aria-label": t("toolTask"),
				disabled: toolNote?.tool === "task" && toolNote.text === t("toolTasking"),
				onClick: toTask,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					width: "15",
					height: "15",
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": "true",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "4",
						y: "4",
						width: "16",
						height: "16",
						rx: "2"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m8.5 12 2.5 2.5 4.5-5" })]
				})
			})
		]
	}) : void 0;
	const toolsBesideBubble = tools !== void 0 && own?.editing === void 0 && (message.text !== "" || (message.attachments?.length ?? 0) > 0);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: classes,
		"data-message-id": message.id,
		"data-queued": queuedFor !== void 0 || void 0,
		"data-tools-open": toolsOpen || void 0,
		style: enterStyle,
		onTouchStart: startPress,
		onTouchEnd: endPress,
		onTouchMove: endPress,
		onTouchCancel: endPress,
		onContextMenu: (event) => {
			if (onLongPress === void 0 || typeof window.matchMedia !== "function" || !window.matchMedia("(hover: none)").matches) return;
			event.preventDefault();
			onLongPress();
		},
		children: [
			grouped ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
				className: ChannelsPage_module_default.gutterTime,
				title: fullTime,
				dateTime: (/* @__PURE__ */ new Date(message.created_at * 1e3)).toISOString(),
				children: clockOf(message.created_at)
			}) : member === void 0 || message.author_kind === "system" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
				id: message.author,
				name: message.name,
				avatar: member?.avatar,
				avatarVersion: member?.avatarVersion
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ChannelsPage_module_default.avatarAnchor,
				"data-avatar-menu": true,
				onKeyDown: (event) => {
					if (event.key === "Escape") onCloseMenu();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ChannelsPage_module_default.avatarButton,
					"aria-label": t("memberMenu", { name: member.name }),
					"aria-haspopup": "menu",
					"aria-expanded": menuOpen,
					onClick: onAvatar,
					onContextMenu: (event) => {
						event.preventDefault();
						onMention(member);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
						id: member.id,
						name: message.name,
						avatar: member.avatar,
						avatarVersion: member.avatarVersion
					})
				}), menuOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.avatarMenu,
					role: "menu",
					"aria-label": t("memberMenu", { name: member.name }),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.avatarMenuTitle,
							children: member.name
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "menuitem",
							className: ChannelsPage_module_default.avatarMenuItem,
							onClick: () => {
								onMention(member);
							},
							children: t("avatarMention")
						}),
						onDm !== void 0 && member.kind !== "human" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "menuitem",
							className: ChannelsPage_module_default.avatarMenuItem,
							onClick: () => {
								onCloseMenu();
								onDm(member);
							},
							children: t("dmOpen")
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.messageBody,
				children: [
					message.reply_to !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Quote, {
						quote: message.reply_to,
						t,
						members,
						onMention
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: grouped ? `${ChannelsPage_module_default.messageHead} ${ChannelsPage_module_default.messageHeadGrouped}` : ChannelsPage_module_default.messageHead,
						children: [
							!grouped && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.author,
								children: message.name
							}),
							!grouped && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KindTag, {
								name: message.name,
								kind: member?.kind,
								cli: member?.cli,
								t
							}),
							!grouped && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
								className: ChannelsPage_module_default.time,
								title: fullTime,
								dateTime: (/* @__PURE__ */ new Date(message.created_at * 1e3)).toISOString(),
								children: clockOf(message.created_at)
							}),
							message.edited_at !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.edited,
								title: (/* @__PURE__ */ new Date(message.edited_at * 1e3)).toLocaleString(),
								children: t("messageEdited")
							}),
							queuedFor !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.queuedTag,
								title: t("queuedFor", { names: queuedFor.join("、") }),
								children: t("queuedTag")
							}),
							own !== void 0 && own.editing === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ChannelsPage_module_default.ownActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									ref: editButtonRef,
									type: "button",
									className: ChannelsPage_module_default.linkButton,
									onClick: own.onStartEdit,
									children: t("messageEdit")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ChannelsPage_module_default.linkButton,
									onClick: own.onWithdraw,
									children: t("messageWithdraw")
								})]
							})
						]
					}),
					own?.editing !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.editBox,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: ChannelsPage_module_default.editInput,
							value: own.editing,
							"aria-label": t("messageEdit"),
							autoFocus: true,
							onChange: (event) => {
								own.onEditChange(event.target.value);
							},
							onKeyDown: (event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									own.onEditCancel();
								} else if (event.key === "Enter" && !event.shiftKey && !isImeEnter(event)) {
									event.preventDefault();
									own.onEditSave();
								}
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.editBar,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ChannelsPage_module_default.time,
									children: t("messageEditHint")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ChannelsPage_module_default.secondaryButton,
									onClick: own.onEditCancel,
									children: t("messageCancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: ChannelsPage_module_default.primaryButton,
									disabled: !own.editing.trim(),
									onClick: own.onEditSave,
									children: t("messageSave")
								})
							]
						})]
					}) : card === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						message.text !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.bubbleLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(HighlightedMarkdown, {
								text: markdown,
								labels,
								members,
								className: ChannelsPage_module_default.text,
								onMention
							}), toolsBesideBubble && tools]
						}) : toolsBesideBubble && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.bubbleLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AttachmentList, {
								attachments: message.attachments,
								t
							}), tools]
						}),
						(message.text !== "" || !toolsBesideBubble) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AttachmentList, {
							attachments: message.attachments,
							t
						}),
						delivered !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeliveryPreview, {
							page: delivered.page,
							task: delivered.task,
							t,
							onReview,
							onRevise: () => {
								onReply(message);
							}
						})
					] }) : role === "progress" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.runStrip,
						"data-state": card.state ?? "running",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ChannelsPage_module_default.runHead,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.runIcon,
										"aria-hidden": true
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.runTitle,
										children: card.title
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.runSummary,
										children: progressLines[0]
									}),
									typeof card.brief === "string" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.cardViews,
										role: "group",
										"aria-label": t("cardView"),
										children: ["detail", "brief"].map((view) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: ChannelsPage_module_default.cardViewButton,
											"aria-pressed": cardView === view,
											onClick: () => {
												onCardView(view);
											},
											children: t(view === "detail" ? "cardViewDetail" : "cardViewBrief")
										}, view))
									})
								]
							}),
							cardView === "brief" && chips !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StepChips, {
								chips,
								runState: card.state,
								t,
								latest: chatRoom ? 3 : void 0
							}) : !progressFolded && progressLines.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HighlightedMarkdown, {
								text: stepsMarkdown,
								labels,
								members,
								className: `${ChannelsPage_module_default.text} ${ChannelsPage_module_default.runSteps}`,
								dataCardText: true,
								onMention
							}),
							retryButtons
						]
					}) : role === "permission" && card.state === "pending" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.permInline,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.permLock,
								"aria-hidden": true,
								children: "●"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(HighlightedMarkdown, {
								text: markdown,
								labels,
								members,
								className: ChannelsPage_module_default.text,
								onMention
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.permWaiting,
								children: t("permPending")
							})
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.card,
						"data-state": card.state,
						"data-role": role,
						children: [
							card.title !== void 0 && card.kind !== "permission" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ChannelsPage_module_default.cardHead,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ChannelsPage_module_default.cardTitle,
									children: card.title
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(HighlightedMarkdown, {
								text: markdown,
								labels,
								members,
								className: ChannelsPage_module_default.text,
								onMention
							}),
							rawError,
							retryButtons,
							card.kind === "permission" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PermissionCard, {
								messageId: message.id,
								card,
								t,
								onDecide
							}),
							card.kind === "task" && typeof card.task_id === "number" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
								taskId: card.task_id,
								tasks,
								t
							})
						]
					}),
					taskCards.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `${ChannelsPage_module_default.card} ${ChannelsPage_module_default.taskAnchor}`,
						"data-anchored-task": task.id,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskCard, {
							taskId: task.id,
							tasks,
							t
						})
					}, task.id)),
					message.memories !== void 0 && message.memories.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemoryBadge, {
						items: message.memories,
						t
					})
				]
			}),
			tools !== void 0 && !toolsBesideBubble && tools
		]
	});
}
/** One pending permission request in the tray above the composer (#113). */
function PermTrayItem({ message, author, members, onMention, t, onDecide }) {
	const labels = (0, react.useMemo)(() => ({
		code: {
			copyLabel: t("copyCode"),
			copiedLabel: t("copiedCode")
		},
		footnotes: t("footnotes")
	}), [t]);
	const markdown = (0, react.useMemo)(() => softBreaksToHard(message.text), [message.text]);
	const card = (0, react.useMemo)(() => parseCard(message), [message]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.permTrayItem,
		"data-message-id": message.id,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
				id: message.author,
				name: message.name,
				avatar: author?.avatar,
				avatarVersion: author?.avatarVersion,
				small: true
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.permTrayText,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ChannelsPage_module_default.permTrayWho,
					children: t("permAsks", { name: message.name })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HighlightedMarkdown, {
					text: markdown,
					labels,
					members,
					className: ChannelsPage_module_default.text,
					onMention
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PermissionCard, {
				messageId: message.id,
				card,
				t,
				onDecide
			})
		]
	});
}
/**
* #1017: an owner's bot command (`@橘 /model x`, `/stop all`) as one thin line — who it went to,
* the command, and the bot's answer folded in (first line; click for all of it).
*/
function CommandRow({ message, target, command, answer, t }) {
	const [open, setOpen] = (0, react.useState)(false);
	const failed = answer !== void 0 && answerFailed(answer.text);
	const first = answer?.text.split("\n").map((x) => x.trim()).find(Boolean) ?? "";
	const more = answer !== void 0 && answer.text.trim() !== first;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.cmdLine,
		"data-message-id": message.id,
		"data-failed": failed,
		title: (/* @__PURE__ */ new Date(message.created_at * 1e3)).toLocaleString(),
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: target === void 0 ? t("cmdToAll") : t("cmdTo", { name: target }) }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: command }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				children: "·"
			}),
			answer === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("cmdSent") }) : more ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.cmdResult,
				"aria-expanded": open,
				onClick: () => {
					setOpen(!open);
				},
				children: open ? answer.text : first
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: ChannelsPage_module_default.cmdResult,
				children: first
			})
		]
	});
}
function MemberGroup({ title, members, busy, onPick, onEdit, onRemove, onDm, t }) {
	if (members.length === 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
		className: ChannelsPage_module_default.groupTitle,
		children: title
	}), members.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: `${ChannelsPage_module_default.memberRow} ${m.error ? ChannelsPage_module_default.memberFailed : m.online ? "" : ChannelsPage_module_default.offline}`,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: ChannelsPage_module_default.member,
			title: t("mentionPick", { name: m.name }),
			onClick: () => {
				onPick(m);
			},
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ChannelsPage_module_default.memberAvatar,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
						id: m.id,
						name: m.name,
						avatar: m.avatar,
						avatarVersion: m.avatarVersion,
						small: true
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: m.error ? `${ChannelsPage_module_default.presence} ${ChannelsPage_module_default.errorPresence}` : ChannelsPage_module_default.presence })]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ChannelsPage_module_default.memberText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: ChannelsPage_module_default.memberName,
						children: [m.name, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KindTag, {
							name: m.name,
							kind: m.kind,
							cli: m.cli,
							t
						})]
					}), m.kind === "dsh" && m.cli === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.memberModel,
						children: typeof m.model === "string" ? m.model : m.model ? `${m.model.provider}/${m.model.model}` : t("defaultModel")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: ChannelsPage_module_default.memberStatus,
					"data-status": m.error ? "error" : busy.has(m.id) ? "busy" : m.online ? "online" : "offline",
					children: m.error ? t("memberFailed") : busy.has(m.id) ? t("working") : m.online ? t("online") : t("offline")
				})
			]
		}), (m.kind === "dsh" || onDm !== void 0 && m.kind !== "human") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: ChannelsPage_module_default.memberActions,
			title: m.kind === "dsh" && m.editable !== true ? t("configMember") : void 0,
			children: [onDm !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.linkButton,
				onClick: () => {
					onDm(m);
				},
				children: t("dmOpen")
			}), m.kind === "dsh" && (m.editable === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
			})] }) : "⚙")]
		})]
	}, m.id))] });
}
/**
* Render the channels panel.
* @param props - framework, injected, and locale shares.
* @returns the three-column channel view.
*/
function ChannelsPage({ useChannels, selectRoom, send, uploadAttachment, reviewTask, terminateTask, dispatchTask, openDm, closeDm, createRoom, renameRoom, listModels, listClis, listPersonas, addMember, updateMember, removeMember, setLead, setWorkspacePath, renewRoom, setDispatchMode, setMaxRelay, decidePermission, retryMessage, editMessage, withdrawMessage, loadOlder, loadNewer, keepLatest, showLatest, openModelSettings, answerTask, t }) {
	const scheme = useScheme();
	const state = useChannels((snapshot) => snapshot);
	const [editing, setEditing] = (0, react.useState)(void 0);
	const [ownNotice, setOwnNotice] = (0, react.useState)(void 0);
	const editFromComposer = (0, react.useRef)(false);
	const [drafts, setDrafts] = (0, react.useState)({});
	const [errors, setErrors] = (0, react.useState)({});
	const [sending, setSending] = (0, react.useState)({});
	const [replies, setReplies] = (0, react.useState)({});
	const [pendingFiles, setPendingFiles] = (0, react.useState)({});
	const pendingRef = (0, react.useRef)(pendingFiles);
	const updateFiles = (update) => {
		pendingRef.current = update(pendingRef.current);
		setPendingFiles(pendingRef.current);
	};
	const uploading = (0, react.useRef)(/* @__PURE__ */ new Map());
	const patchFile = (roomId, key, change) => {
		updateFiles((previous) => ({
			...previous,
			[roomId]: (previous[roomId] ?? []).map((file) => file.key === key ? change(file) : file)
		}));
	};
	const limit = state.maxUploadBytes ?? 1073741824;
	/** #1445: the character cap the store enforces, read back from /state (MAX_TEXT there). */
	const textLimit = state.maxTextChars ?? 131072;
	/** #1445: a failure worded in the panel's language, quoting the caps this panel knows about. */
	const failure = (error, place = "other", typed = "") => errorText(error, t, place, typed, { textChars: textLimit });
	const attach = useComposerAttachments((picked) => {
		const roomId = state.roomId;
		if (roomId === void 0) return;
		const added = picked.map((file) => {
			const preview = previewOf(file);
			return {
				key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				name: file.name || "pasted",
				mime: file.type || "application/octet-stream",
				size: file.size,
				progress: 0,
				...preview === void 0 ? {} : { preview },
				...uploadAttachment === void 0 ? { error: t("uploadUnsupported") } : file.size > limit ? { error: t("attachmentTooLarge", {
					name: file.name || "pasted",
					size: formatBytes(file.size),
					limit: formatBytes(limit)
				}) } : {}
			};
		});
		updateFiles((previous) => ({
			...previous,
			[roomId]: [...previous[roomId] ?? [], ...added]
		}));
		picked.forEach((file, index) => {
			const entry = added[index];
			if (entry.error !== void 0 || uploadAttachment === void 0) return;
			const controller = new AbortController();
			const done = uploadAttachment(file, (sent, total) => {
				patchFile(roomId, entry.key, (current) => ({
					...current,
					progress: total === 0 ? 1 : Math.min(1, sent / total)
				}));
			}, controller.signal).then((attachment) => {
				patchFile(roomId, entry.key, (current) => ({
					...current,
					progress: 1,
					attachment
				}));
			}).catch((error) => {
				patchFile(roomId, entry.key, (current) => ({
					...current,
					error: error instanceof UploadTooLarge ? t("attachmentTooLarge", {
						name: error.fileName,
						size: formatBytes(error.size),
						limit: formatBytes(error.limit)
					}) : t("uploadFailed", {
						name: current.name,
						message: error instanceof Error ? error.message : String(error)
					})
				}));
			}).finally(() => {
				uploading.current.delete(entry.key);
			});
			uploading.current.set(entry.key, {
				done,
				controller
			});
		});
	});
	const removeFile = (roomId, key) => {
		const gone = (pendingRef.current[roomId] ?? []).find((file) => file.key === key);
		if (gone?.preview !== void 0) URL.revokeObjectURL(gone.preview);
		uploading.current.get(key)?.controller.abort();
		uploading.current.delete(key);
		updateFiles((previous) => ({
			...previous,
			[roomId]: (previous[roomId] ?? []).filter((file) => file.key !== key)
		}));
	};
	(0, react.useEffect)(() => () => {
		for (const job of uploading.current.values()) job.controller.abort();
		for (const room of Object.values(pendingRef.current)) for (const file of room) if (file.preview !== void 0) URL.revokeObjectURL(file.preview);
	}, []);
	const pendingRooms = (0, react.useRef)(/* @__PURE__ */ new Set());
	const draft = state.roomId === void 0 ? "" : drafts[state.roomId] ?? "";
	const sendError = state.roomId === void 0 ? void 0 : errors[state.roomId];
	const replying = state.roomId === void 0 ? void 0 : replies[state.roomId];
	const logRef = (0, react.useRef)(null);
	const stickRef = (0, react.useRef)(true);
	const [atBottom, setAtBottom] = (0, react.useState)(true);
	const [unread, setUnread] = (0, react.useState)(void 0);
	const [loadingOlder, setLoadingOlder] = (0, react.useState)(false);
	const olderAnchor = (0, react.useRef)(void 0);
	const rowAnchor = (0, react.useRef)(void 0);
	const live = (0, react.useRef)(createLiveTracker());
	const [pendingWithdraw, setPendingWithdraw] = (0, react.useState)(void 0);
	const withdrawTimer = (0, react.useRef)(void 0);
	const pendingWithdrawRef = (0, react.useRef)(pendingWithdraw);
	pendingWithdrawRef.current = pendingWithdraw;
	(0, react.useEffect)(() => () => {
		clearTimeout(withdrawTimer.current);
		pendingWithdrawRef.current?.commit();
	}, []);
	const inputRef = (0, react.useRef)(null);
	const inputHighlightsRef = (0, react.useRef)(null);
	const [composing, setComposing] = (0, react.useState)(false);
	const syncInputHighlights = () => {
		const input = inputRef.current;
		const highlights = inputHighlightsRef.current;
		if (!input || !highlights) return;
		highlights.style.width = `${input.getBoundingClientRect().width - (input.offsetWidth - input.clientWidth)}px`;
		highlights.scrollTop = input.scrollTop;
		highlights.scrollLeft = input.scrollLeft;
	};
	(0, react.useLayoutEffect)(() => {
		syncInputHighlights();
		const input = inputRef.current;
		if (!input || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(syncInputHighlights);
		observer.observe(input);
		return () => observer.disconnect();
	}, [draft, state.roomId]);
	const [caret, setCaret] = (0, react.useState)(0);
	const [dismissedAt, setDismissedAt] = (0, react.useState)(void 0);
	const [highlight, setHighlight] = (0, react.useState)(0);
	const pendingCaret = (0, react.useRef)(void 0);
	const [dialog, setDialog] = (0, react.useState)(void 0);
	const [modelsOpen, setModelsOpen] = (0, react.useState)(false);
	const [drawer, setDrawer] = (0, react.useState)(void 0);
	const roomsRef = (0, react.useRef)(null);
	const membersRef = (0, react.useRef)(null);
	const chatRef = (0, react.useRef)(null);
	const roomsToggleRef = (0, react.useRef)(null);
	const membersToggleRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		if (drawer === void 0) return;
		const surface = drawer === "rooms" ? roomsRef.current : membersRef.current;
		const opener = drawer === "rooms" ? roomsToggleRef.current : membersToggleRef.current;
		if (surface === null) return;
		const background = [chatRef.current, drawer === "rooms" ? membersRef.current : roomsRef.current].filter((node) => node !== null);
		const previousInert = background.map((node) => node.inert);
		background.forEach((node) => {
			node.inert = true;
		});
		const controls = () => Array.from(surface.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex=\"-1\"])")).filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0);
		(controls()[0] ?? surface).focus();
		const onKey = (event) => {
			const nested = event.target.closest("[role=\"dialog\"][aria-modal=\"true\"]");
			if (nested !== null && nested !== surface) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				setDrawer(void 0);
			} else if (event.key === "Tab") {
				const items = controls();
				const first = items[0];
				const last = items[items.length - 1];
				if (!items.includes(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
					event.preventDefault();
					(event.shiftKey ? last ?? surface : first ?? surface).focus();
				}
			}
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			background.forEach((node, index) => {
				node.inert = previousInert[index];
			});
			opener?.focus();
		};
	}, [drawer]);
	const [roomsHidden, setRoomsHidden] = (0, react.useState)(false);
	const [membersHidden, setMembersHidden] = (0, react.useState)(true);
	const [boardDock, setBoardDock] = (0, react.useState)(null);
	const [boardDocked, setBoardDocked] = (0, react.useState)(false);
	const [newRoom, setNewRoom] = (0, react.useState)(void 0);
	const [roomError, setRoomError] = (0, react.useState)(void 0);
	const [memberError, setMemberError] = (0, react.useState)(void 0);
	const [retryingId, setRetryingId] = (0, react.useState)(void 0);
	const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
	const [settingsTab, setSettingsTab] = (0, react.useState)("basic");
	const settingsButtonRef = (0, react.useRef)(null);
	const settingsReturnRef = (0, react.useRef)(null);
	const leadCardRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		if (!settingsOpen) return;
		const opener = settingsReturnRef.current;
		return () => {
			opener?.focus();
		};
	}, [settingsOpen]);
	(0, react.useEffect)(() => {
		setSettingsOpen(false);
	}, [state.roomId]);
	const [capabilitiesDismissed, setCapabilitiesDismissed] = (0, react.useState)(false);
	const [helpOpen, setHelpOpen] = (0, react.useState)(false);
	const [slashHighlight, setSlashHighlight] = (0, react.useState)(0);
	const [stopping, setStopping] = (0, react.useState)(void 0);
	(0, react.useEffect)(() => {
		setCapabilitiesDismissed(false);
		setHelpOpen(false);
		setStopping(void 0);
	}, [state.roomId]);
	const composerRef = (0, react.useRef)(null);
	const openMentionAt = (0, react.useRef)(void 0);
	(0, react.useEffect)(() => {
		const onPress = (event) => {
			const at = openMentionAt.current;
			if (composerRef.current?.contains(event.target) === true) return;
			if (at !== void 0) setDismissedAt(at);
			if (slashQuery(draft) !== void 0 && !capabilitiesDismissed) setCapabilitiesDismissed(true);
			setHelpOpen(false);
		};
		document.addEventListener("mousedown", onPress);
		return () => {
			document.removeEventListener("mousedown", onPress);
		};
	}, [draft, capabilitiesDismissed]);
	const backToComposer = () => {
		if (editFromComposer.current) pendingCaret.current = caret;
		editFromComposer.current = false;
	};
	(0, react.useEffect)(() => {
		const input = inputRef.current;
		const next = pendingCaret.current;
		if (input === null || next === void 0) return;
		pendingCaret.current = void 0;
		input.focus();
		input.setSelectionRange(next, next);
	});
	const [avatarMenu, setAvatarMenu] = (0, react.useState)(void 0);
	const [toolsFor, setToolsFor] = (0, react.useState)(void 0);
	(0, react.useEffect)(() => {
		if (toolsFor === void 0) return;
		const onPress = (event) => {
			if (event.target?.closest?.(`[data-message-id="${toolsFor}"]`) == null) setToolsFor(void 0);
		};
		document.addEventListener("touchstart", onPress);
		document.addEventListener("mousedown", onPress);
		return () => {
			document.removeEventListener("touchstart", onPress);
			document.removeEventListener("mousedown", onPress);
		};
	}, [toolsFor]);
	(0, react.useEffect)(() => {
		setToolsFor(void 0);
	}, [state.roomId]);
	const [dmPicker, setDmPicker] = (0, react.useState)(false);
	const [cardViews, setCardViews] = (0, react.useState)({});
	const [progressFolded, setProgressFolded] = (0, react.useState)({});
	const cardView = state.roomId === void 0 ? CARD_VIEW_DEFAULT : cardViews[state.roomId] ?? loadCardView(state.roomId);
	const folded = state.roomId !== void 0 && (progressFolded[state.roomId] ?? loadProgressFolded(state.roomId));
	const toggleProgress = () => {
		if (state.roomId === void 0) return;
		const roomId = state.roomId;
		saveProgressFolded(roomId, !folded);
		setProgressFolded((folds) => ({
			...folds,
			[roomId]: !folded
		}));
	};
	const chooseCardView = (view) => {
		if (state.roomId === void 0) return;
		const roomId = state.roomId;
		saveCardView(roomId, view);
		setCardViews((views) => ({
			...views,
			[roomId]: view
		}));
		if (prefersReducedMotion()) return;
		requestAnimationFrame(() => {
			logRef.current?.querySelectorAll("[data-card-text]").forEach((el) => {
				el.animate?.([{ opacity: .25 }, { opacity: 1 }], {
					duration: 180,
					easing: "cubic-bezier(.2,0,0,1)"
				});
			});
		});
	};
	(0, react.useEffect)(() => {
		if (avatarMenu === void 0) return;
		const onPress = (event) => {
			if (event.target?.closest?.("[data-avatar-menu]") == null) setAvatarMenu(void 0);
		};
		document.addEventListener("mousedown", onPress);
		return () => {
			document.removeEventListener("mousedown", onPress);
		};
	}, [avatarMenu]);
	const visibleMessages = (0, react.useMemo)(() => state.messages.filter((m) => !trivialProgress(m) || state.tasks?.some((task) => task.assign_msg_id === m.id)), [state.messages, state.tasks]);
	const fresh = (0, react.useMemo)(() => trackLive(live.current, state.roomId, state.messages), [state.messages, state.roomId]);
	(0, react.useLayoutEffect)(() => {
		const log = logRef.current;
		if (log === null) return;
		const row = rowAnchor.current;
		const el = row === void 0 ? null : log.querySelector(`[data-message-id="${row.id}"]`);
		if (row !== void 0 && el !== null) {
			rowAnchor.current = void 0;
			olderAnchor.current = void 0;
			log.scrollTop += el.getBoundingClientRect().top - log.getBoundingClientRect().top - row.offset;
			return;
		}
		const anchor = olderAnchor.current;
		if (anchor === void 0) return;
		olderAnchor.current = void 0;
		rowAnchor.current = void 0;
		log.scrollTop = log.scrollHeight - anchor.height + anchor.top;
	}, [state.messages]);
	(0, react.useEffect)(() => {
		if (stickRef.current && state.hasMoreNewer !== true && state.messages.length > 300) keepLatest?.();
	}, [state.messages, state.hasMoreNewer]);
	const handled = (0, react.useRef)({
		roomId: void 0,
		id: Number.NEGATIVE_INFINITY
	});
	(0, react.useEffect)(() => {
		const roomId = state.roomId;
		const lastId = state.messages.length === 0 ? Number.NEGATIVE_INFINITY : state.messages[state.messages.length - 1].id;
		const since = handled.current.roomId === roomId ? handled.current.id : lastId;
		handled.current = {
			roomId,
			id: Math.max(since, lastId)
		};
		const log = logRef.current;
		if (log !== null && stickRef.current) {
			log.scrollTop = log.scrollHeight;
			return;
		}
		if (roomId === void 0) return;
		const first = visibleMessages.find((m) => m.id > since && fresh.has(m.id) && m.author_kind !== "user");
		if (first !== void 0 && (unread === void 0 || unread.roomId !== roomId || unread.seen)) setUnread({
			roomId,
			fromId: first.id,
			seen: false
		});
	}, [
		state.messages,
		state.roomId,
		visibleMessages
	]);
	const pendingKey = state.messages.filter(pendingPermission).map((m) => m.id).join(",");
	(0, react.useEffect)(() => {
		const log = logRef.current;
		if (log !== null && stickRef.current) log.scrollTop = log.scrollHeight;
	}, [pendingKey]);
	(0, react.useEffect)(() => {
		setUnread(void 0);
		setAtBottom(true);
		const log = logRef.current;
		if (log === null || prefersReducedMotion()) return;
		log.animate?.([{
			opacity: 0,
			transform: "translateX(6px)"
		}, {
			opacity: 1,
			transform: "none"
		}], {
			duration: 200,
			easing: "cubic-bezier(.2,0,0,1)"
		});
	}, [state.roomId]);
	const scrollToLatest = () => {
		const log = logRef.current;
		if (log === null) return;
		stickRef.current = true;
		setAtBottom(true);
		if (state.hasMoreNewer === true) {
			showLatest?.();
			return;
		}
		if (typeof log.scrollTo === "function") log.scrollTo({
			top: log.scrollHeight,
			behavior: prefersReducedMotion() ? "auto" : "smooth"
		});
		else log.scrollTop = log.scrollHeight;
	};
	/** #1030: the first row at least partly in view and how far its top sits from the log's top. */
	const firstRowInView = (log) => {
		const top = log.getBoundingClientRect().top;
		for (const el of log.querySelectorAll("[data-message-id]")) {
			const box = el.getBoundingClientRect();
			if (box.bottom > top) return {
				id: el.getAttribute("data-message-id") ?? "",
				offset: box.top - top
			};
		}
	};
	/** #1030: the reader reached the bottom of a window that dropped its newest rows. */
	const pageForward = () => {
		const log = logRef.current;
		if (log === null || loadNewer === void 0 || loadingOlder || state.hasMoreNewer !== true) return;
		rowAnchor.current = firstRowInView(log);
		setLoadingOlder(true);
		loadNewer().then((added) => {
			if (added === 0) rowAnchor.current = void 0;
		}, (error) => {
			rowAnchor.current = void 0;
			const roomId = state.roomId;
			if (roomId !== void 0) setErrors((previous) => ({
				...previous,
				[roomId]: error instanceof Error ? error.message : String(error)
			}));
		}).finally(() => {
			setLoadingOlder(false);
		});
	};
	const pageBack = () => {
		const log = logRef.current;
		if (log === null || loadingOlder || state.hasMoreOlder !== true || state.messages.length === 0) return;
		olderAnchor.current = {
			height: log.scrollHeight,
			top: log.scrollTop
		};
		if (state.messages.length + 100 > 300) rowAnchor.current = firstRowInView(log);
		setLoadingOlder(true);
		loadOlder().then((added) => {
			if (added === 0) olderAnchor.current = void 0;
		}, (error) => {
			olderAnchor.current = void 0;
			const roomId = state.roomId;
			if (roomId !== void 0) setErrors((previous) => ({
				...previous,
				[roomId]: error instanceof Error ? error.message : String(error)
			}));
		}).finally(() => {
			setLoadingOlder(false);
		});
	};
	const [jump, setJump] = (0, react.useState)(void 0);
	const [focusedId, setFocusedId] = (0, react.useState)(void 0);
	(0, react.useEffect)(() => {
		if (jump === void 0 || jump.roomId !== state.roomId) return;
		const el = logRef.current?.querySelector(`[data-message-id="${jump.messageId}"]`);
		if (el == null) return;
		stickRef.current = false;
		el.scrollIntoView?.({ block: "center" });
		setFocusedId(jump.messageId);
		setJump(void 0);
	}, [
		jump,
		state.messages,
		state.roomId
	]);
	const openActivity = () => {
		if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 900px)").matches) setDrawer("members");
		else setMembersHidden(false);
	};
	const openMessage = (roomId, messageId) => {
		setDrawer(void 0);
		setJump({
			roomId,
			messageId
		});
		if (roomId !== state.roomId) selectRoom(roomId);
	};
	const stillAnswering = stopping !== void 0 && state.roomId !== void 0 && (state.thinking[String(state.roomId)] ?? []).includes(stopping.botId);
	(0, react.useEffect)(() => {
		if (stopping === void 0) return;
		if (stopping.phase === "stopping" && !stillAnswering) {
			setStopping({
				...stopping,
				phase: "stopped"
			});
			return;
		}
		const timer = setTimeout(() => {
			setStopping(void 0);
		}, stopping.phase === "stopped" ? 2e3 : 3e4);
		return () => {
			clearTimeout(timer);
		};
	}, [stopping, stillAnswering]);
	if (state.phase !== "ready") {
		const notice = state.phase === "locked" ? state.lockFree === true ? t("lockedFree") : state.lockHolder === void 0 ? t("lockedUnnamed", lockHolderText(void 0, state.lockDataDir, state.lockPath, t)) : t("locked", lockHolderText(state.lockHolder, state.lockDataDir, state.lockPath, t)) : state.phase === "unavailable" ? t("unavailable") : state.phase === "unauthorized" ? t("unauthorized") : state.phase === "error" ? t("error", { message: state.error ?? "" }) : t("loading");
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: ChannelsPage_module_default.page,
			"data-dc-scheme": scheme,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.notice,
				role: "status",
				children: notice
			})
		});
	}
	const room = state.rooms.find((r) => r.id === state.roomId);
	const channelId = room?.parent_id ?? room?.id;
	const dmWith = room?.dm_member ?? void 0;
	const visibleMembers = dmWith !== void 0 ? state.members.filter((m) => m.kind === "human" || m.id === dmWith) : state.members.filter((m) => !m.rooms?.length || channelId !== void 0 && m.rooms.includes(channelId));
	const openTaskOwners = new Set((state.tasks ?? []).filter(isLiveTask).map((t) => t.owner));
	const busy = /* @__PURE__ */ new Set([...state.roomId === void 0 ? [] : state.thinking[String(state.roomId)] ?? [], ...openTaskOwners]);
	const byId = new Map(visibleMembers.map((m) => [m.id, m]));
	const firstUnread = unread !== void 0 && unread.roomId === state.roomId ? visibleMessages.find((m) => m.id >= unread.fromId && m.author_kind !== "user")?.id : void 0;
	const visibleUnreadCount = unread !== void 0 && unread.roomId === state.roomId && !unread.seen ? unreadCount(visibleMessages, unread.fromId) : 0;
	const typingNames = (state.roomId === void 0 ? [] : state.thinking[String(state.roomId)] ?? []).map((id) => byId.get(id)?.name ?? id);
	const queuedFor = /* @__PURE__ */ new Map();
	for (const [memberId, ids] of Object.entries(state.roomId === void 0 ? {} : state.queued?.[String(state.roomId)] ?? {})) for (const id of ids) queuedFor.set(id, [...queuedFor.get(id) ?? [], byId.get(memberId)?.name ?? memberId]);
	const jumpToQueued = () => {
		const first = Math.min(...queuedFor.keys());
		document.querySelector(`[data-message-id="${first}"]`)?.scrollIntoView({
			block: "center",
			behavior: "smooth"
		});
	};
	const channelRooms = new Set(state.rooms.filter((r) => r.id === channelId || r.parent_id === channelId).map((r) => r.id));
	const leadId = room?.effective_lead_id === void 0 ? state.effectiveLeadId ?? state.leadId : room.effective_lead_id;
	const lead = visibleMembers.find((member) => member.id === leadId);
	const leadStatus = lead !== void 0 ? leadDoing(lead, {
		tasks: state.tasks ?? [],
		rooms: channelRooms,
		thinking: state.thinking,
		messages: state.messages
	}, t) : leadId == null ? t("headLeadUnset") : t("headLeadLoading");
	const openTasks = (state.tasks ?? []).filter(isLiveTask);
	const activity = visibleMembers.filter((m) => m.kind !== "human").flatMap((m) => {
		const where = [...channelRooms].find((id) => (state.thinking[String(id)] ?? []).includes(m.id));
		const task = openTasks.find((task) => task.owner === m.id && channelRooms.has(task.room_id));
		if (where === void 0 && task === void 0) return [];
		return [{
			member: m,
			room: state.rooms.find((r) => r.id === (where ?? task?.room_id)),
			task,
			thinking: where !== void 0
		}];
	});
	const pendingPerms = state.messages.filter(pendingPermission);
	const questions = openQuestions(state.tasks ?? [], channelRooms);
	const channelActive = room === void 0 ? 0 : state.rooms.filter((r) => channelRooms.has(r.id)).reduce((n, r) => n + (r.active ?? 0), 0);
	const mention = activeMention(draft, caret);
	const candidates = mention === void 0 || mention.start === dismissedAt ? [] : rankMembers(visibleMembers, mention.query);
	const popupOpen = mention !== void 0 && candidates.length > 0;
	openMentionAt.current = popupOpen ? mention.start : void 0;
	const selected = Math.min(highlight, Math.max(candidates.length - 1, 0));
	const dmPeer = dmWith === void 0 ? void 0 : byId.get(dmWith);
	const commandTarget = dmWith !== void 0 ? dmPeer?.kind === "bot" ? dmPeer : void 0 : lead?.kind === "bot" ? lead : void 0;
	const slash = slashQuery(draft);
	const slashCommands = slash === void 0 || capabilitiesDismissed || popupOpen ? [] : matchCommands(slash, (key) => t(key)).filter((c) => dmWith === void 0 || c.name !== "stop all" && c.name !== "board");
	const slashOpen = slashCommands.length > 0;
	const slashSelected = Math.min(slashHighlight, Math.max(slashCommands.length - 1, 0));
	const workingBots = (state.roomId === void 0 ? [] : state.thinking[String(state.roomId)] ?? []).map((id) => byId.get(id)).filter((m) => m !== void 0 && (m.kind === "bot" || m.kind === "dsh"));
	const stopTarget = workingBots.find((m) => m.id === commandTarget?.id) ?? workingBots[0];
	const roomFiles = state.roomId === void 0 ? [] : pendingFiles[state.roomId] ?? [];
	const stopMode = (stopTarget !== void 0 || stopping?.phase === "stopping") && draft.trim() === "" && roomFiles.length === 0;
	const taskCardAt = /* @__PURE__ */ new Map();
	for (const m of visibleMessages) for (const task of state.tasks ?? []) if (task.assign_msg_id === m.id && !taskCardAt.has(task.id) && parseCard(m)?.kind !== "task") taskCardAt.set(task.id, m.id);
	for (const m of visibleMessages) {
		const card = m.author_kind === "system" ? parseCard(m) : void 0;
		if (card?.kind === "task" && typeof card.task_id === "number" && !taskCardAt.has(card.task_id)) taskCardAt.set(card.task_id, m.id);
	}
	const recordShowsCard = (m) => {
		const card = parseCard(m);
		return card?.kind !== "task" || typeof card.task_id !== "number" || taskCardAt.get(card.task_id) === m.id;
	};
	const answers = commandAnswers(state.messages, (id) => byId.get(id)?.name);
	const answerIds = new Set([...answers.values()].map((m) => m.id));
	const boardOpen = boardDocked && dmWith === void 0;
	const placeholder = dmWith !== void 0 ? t("dmPlaceholder", { name: dmPeer?.name ?? room?.name ?? "" }) : t(compactComposer() || boardOpen ? "placeholderShort" : "placeholder", { room: room?.name ?? "" });
	const openBoard = () => {
		setDrawer(void 0);
		setTimeout(() => {
			chatRef.current?.querySelector(`button[aria-label="${t("taskBoardOpen")}"]`)?.click();
		}, 0);
	};
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
		setDrawer(void 0);
		const next = insertMention(draft, caret, member);
		setDraft(next.text, next.caret);
	};
	const startDm = openDm === void 0 ? void 0 : (member) => {
		setDrawer(void 0);
		stickRef.current = true;
		openDm(member.id).catch((error) => {
			setRoomError(t("dmOpenFailed", { message: error instanceof Error ? error.message : String(error) }));
		});
	};
	const endDm = closeDm === void 0 ? void 0 : (roomId) => {
		closeDm(roomId).catch((error) => {
			setRoomError(t("dmCloseFailed", { message: error instanceof Error ? error.message : String(error) }));
		});
	};
	const mentionFromAvatar = (member) => {
		setAvatarMenu(void 0);
		pickFromList(member);
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
			setRoomError(errorText(error, t, "room", name));
		});
	};
	const ownActions = (m) => {
		if (m.author_kind !== "user" || m.card !== null) return void 0;
		return {
			editing: editing?.id === m.id ? editing.text : void 0,
			editingOther: editing !== void 0 && editing.id !== m.id,
			onStartEdit: () => {
				setOwnNotice(void 0);
				editFromComposer.current = false;
				setEditing({
					id: m.id,
					text: m.text
				});
			},
			onEditChange: (text) => {
				setEditing({
					id: m.id,
					text
				});
			},
			onEditCancel: () => {
				setEditing(void 0);
				backToComposer();
			},
			onEditSave: () => {
				if (editing?.id !== m.id || !editing.text.trim()) return;
				if (editing.text === m.text) {
					setEditing(void 0);
					return;
				}
				editMessage(m.id, editing.text).then(() => {
					setEditing(void 0);
					backToComposer();
				}, (error) => {
					setOwnNotice(error instanceof Error ? error.message : String(error));
				});
			},
			onWithdraw: () => {
				setOwnNotice(void 0);
				clearTimeout(withdrawTimer.current);
				pendingWithdrawRef.current?.commit();
				let done = false;
				const commit = () => {
					if (done) return;
					done = true;
					clearTimeout(withdrawTimer.current);
					setPendingWithdraw((current) => current?.id === m.id ? void 0 : current);
					sendWithdraw(m.id);
				};
				setPendingWithdraw({
					id: m.id,
					commit
				});
				withdrawTimer.current = setTimeout(commit, WITHDRAW_UNDO_MS);
			}
		};
	};
	const undoWithdraw = () => {
		clearTimeout(withdrawTimer.current);
		setPendingWithdraw(void 0);
	};
	const sendWithdraw = (id) => {
		withdrawMessage(id).then(({ stopped, stillRunning }) => {
			const notes = [...stopped.length > 0 ? [t("withdrawStopped", { names: stopped.join("、") })] : [], ...stillRunning.length > 0 ? [t("withdrawRunning", { names: stillRunning.join("、") })] : []];
			if (notes.length > 0) setOwnNotice(notes.join("；"));
		}, (error) => {
			setOwnNotice(error instanceof Error ? error.message : String(error));
		});
	};
	const confirmRemove = (member) => {
		if (!window.confirm(t("removeConfirm", { name: member.name }))) return;
		setMemberError(void 0);
		removeMember(member.id).catch((error) => {
			setMemberError(errorText(error, t, "member", member.name));
		});
	};
	const openPicker = () => {
		const before = draft.slice(0, caret);
		const insert = before === "" || /\s$/.test(before) ? "@" : " @";
		setDismissedAt(void 0);
		setDraft(before + insert + draft.slice(caret), caret + insert.length);
	};
	const handleRetry = (messageId) => {
		setRetryingId(messageId);
		retryMessage(messageId).catch((error) => {
			const msg = error instanceof Error ? error.message : String(error);
			const roomId = state.roomId;
			if (roomId !== void 0) setErrors((previous) => ({
				...previous,
				[roomId]: msg
			}));
		}).finally(() => {
			setRetryingId(void 0);
		});
	};
	/** Send one command line now, keeping the draft unless it was the command itself; resolves to whether it went out. */
	const sendCommand = (text, clearDraft) => {
		const roomId = state.roomId;
		if (roomId === void 0) return Promise.resolve(false);
		setErrors((previous) => ({
			...previous,
			[roomId]: void 0
		}));
		stickRef.current = true;
		if (state.hasMoreNewer === true) showLatest?.();
		return send(text).then(() => {
			if (clearDraft) setDrafts((previous) => ({
				...previous,
				[roomId]: ""
			}));
			return true;
		}, (error) => {
			setErrors((previous) => ({
				...previous,
				[roomId]: failure(error, "send")
			}));
			return false;
		});
	};
	const noTarget = () => {
		const roomId = state.roomId;
		if (roomId !== void 0) setErrors((previous) => ({
			...previous,
			[roomId]: t("slashNoLead")
		}));
	};
	const runSlash = (command) => {
		const run = command.run;
		if (commandTarget === void 0 && needsTarget(command)) {
			noTarget();
			return;
		}
		setSlashHighlight(0);
		if (run.kind === "panel") {
			setDraft("", 0);
			if (run.panel === "help") {
				setCapabilitiesDismissed(false);
				setHelpOpen(true);
				return;
			}
			chatRef.current?.querySelector(`button[aria-label="${t("taskBoardOpen")}"]`)?.click();
			return;
		}
		if (run.kind === "send" && run.broadcast === true) {
			sendCommand(run.text, true);
			return;
		}
		if (commandTarget === void 0) {
			noTarget();
			return;
		}
		const line = `@${commandTarget.name} ${run.text}`;
		if (run.kind === "fill") {
			setCapabilitiesDismissed(true);
			setDraft(line, line.length);
			return;
		}
		sendCommand(line, true);
	};
	const stopReply = () => {
		if (stopTarget === void 0 || stopping?.phase === "stopping") return;
		const target = stopTarget;
		setStopping({
			botId: target.id,
			name: target.name,
			phase: "stopping"
		});
		sendCommand(`@${target.name} /stop`, false).then((sent) => {
			if (!sent) setStopping(void 0);
		});
	};
	const toTask = dispatchTask === void 0 || state.roomId === void 0 || leadId == null ? void 0 : async (message) => {
		const line = message.text.split("\n").map((x) => x.trim()).find(Boolean) ?? "";
		const title = line.length > 40 ? `${line.slice(0, 40)}…` : line;
		await dispatchTask(message.room_id, {
			title,
			owner: leadId,
			messageId: message.id
		});
	};
	const submit = () => {
		const roomId = state.roomId;
		const text = addressCommand(draft.trim(), commandTarget?.name);
		const held = roomId === void 0 ? [] : pendingRef.current[roomId] ?? [];
		if (!text && held.length === 0 || roomId === void 0 || pendingRooms.current.has(roomId)) return;
		const refused = held.filter((file) => file.error !== void 0);
		if (refused.length > 0) {
			setErrors((previous) => ({
				...previous,
				[roomId]: refused[0]?.error
			}));
			return;
		}
		const maxTextChars = state.maxTextChars ?? 131072;
		if (textTooLarge(text, maxTextChars)) {
			setErrors((previous) => ({
				...previous,
				[roomId]: t("messageTooLarge", { limit: t("charCount", { count: maxTextChars }) })
			}));
			return;
		}
		if (messageTooLarge(text, [])) {
			setErrors((previous) => ({
				...previous,
				[roomId]: t("messageTooLarge", { limit: formatBytes(MAX_MESSAGE_BODY) })
			}));
			return;
		}
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
		if (state.hasMoreNewer === true) showLatest?.();
		setUnread(void 0);
		const replyTo = replies[roomId]?.id;
		/** Post the message; a file that failed while it streamed is reported instead of sent. */
		const go = () => {
			const keys = new Set(held.map((file) => file.key));
			const ready = (pendingRef.current[roomId] ?? []).filter((file) => keys.has(file.key));
			const broken = ready.find((file) => file.error !== void 0);
			if (broken?.error !== void 0) {
				setErrors((previous) => ({
					...previous,
					[roomId]: broken.error
				}));
				return Promise.resolve();
			}
			const files = ready.map((file) => file.attachment).filter((a) => a !== void 0);
			if (!text && ready.length === 0) return Promise.resolve();
			return send(text, replyTo, files.length > 0 ? files : void 0, roomId).then(() => {
				for (const file of ready) if (file.preview !== void 0) URL.revokeObjectURL(file.preview);
				setDrafts((previous) => ({
					...previous,
					[roomId]: ""
				}));
				updateFiles((previous) => ({
					...previous,
					[roomId]: (previous[roomId] ?? []).filter((file) => !keys.has(file.key))
				}));
				setReplies((previous) => ({
					...previous,
					[roomId]: void 0
				}));
			}).catch((error) => {
				setErrors((previous) => ({
					...previous,
					[roomId]: failure(error, "send")
				}));
			});
		};
		const settle = () => {
			pendingRooms.current.delete(roomId);
			setSending((previous) => ({
				...previous,
				[roomId]: false
			}));
		};
		const waits = held.map((file) => uploading.current.get(file.key)?.done).filter((job) => job !== void 0);
		if (waits.length === 0) {
			go().finally(settle);
			return;
		}
		Promise.all(waits).then(go).finally(settle);
	};
	const startReply = (message) => {
		const roomId = state.roomId;
		if (roomId === void 0) return;
		setReplies((previous) => ({
			...previous,
			[roomId]: message
		}));
		pendingCaret.current = caret;
	};
	const cancelReply = () => {
		const roomId = state.roomId;
		if (roomId !== void 0) setReplies((previous) => ({
			...previous,
			[roomId]: void 0
		}));
	};
	const onKeyDown = (event) => {
		if (slashOpen && !isImeEnter(event)) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				setSlashHighlight((slashSelected + step + slashCommands.length) % slashCommands.length);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				runSlash(slashCommands[slashSelected]);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setCapabilitiesDismissed(true);
				return;
			}
		}
		if (popupOpen && !isImeEnter(event)) {
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
		if (event.key === "ArrowUp" && draft === "" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && !isImeEnter(event)) {
			const last = lastOwnEditable(state.messages, pendingWithdraw?.id);
			if (last !== void 0) {
				event.preventDefault();
				setOwnNotice(void 0);
				editFromComposer.current = true;
				setEditing({
					id: last.id,
					text: last.text
				});
				requestAnimationFrame(() => {
					logRef.current?.querySelector(`[data-message-id="${last.id}"]`)?.scrollIntoView?.({
						block: "nearest",
						behavior: prefersReducedMotion() ? "auto" : "smooth"
					});
				});
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey && !isImeEnter(event)) {
			event.preventDefault();
			submit();
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: [
			ChannelsPage_module_default.page,
			roomsHidden ? ChannelsPage_module_default.roomsHidden : "",
			membersHidden ? ChannelsPage_module_default.membersHidden : "",
			boardOpen ? ChannelsPage_module_default.panelOpen : ""
		].filter(Boolean).join(" "),
		"data-dc-scheme": scheme,
		children: [
			drawer !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				className: ChannelsPage_module_default.drawerBackdrop,
				"aria-label": t("closeDrawer"),
				onClick: () => setDrawer(void 0)
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
				ref: roomsRef,
				className: drawer === "rooms" ? `${ChannelsPage_module_default.rooms} ${ChannelsPage_module_default.drawerOpen}` : ChannelsPage_module_default.rooms,
				"aria-label": t("rooms"),
				role: drawer === "rooms" ? "dialog" : void 0,
				"aria-modal": drawer === "rooms" ? true : void 0,
				tabIndex: drawer === "rooms" ? -1 : void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.leadCard,
						role: "group",
						"aria-label": t("leadCard"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							ref: leadCardRef,
							type: "button",
							className: ChannelsPage_module_default.leadCardButton,
							disabled: room === void 0,
							title: `${lead === void 0 ? leadStatus : `${lead.name} · ${leadStatus}`}\n${t("leadCardChange")}`,
							onClick: () => {
								settingsReturnRef.current = leadCardRef.current;
								setDrawer(void 0);
								setSettingsTab("dispatch");
								setSettingsOpen(true);
							},
							children: [lead !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
								id: lead.id,
								name: lead.name,
								avatar: lead.avatar,
								avatarVersion: lead.avatarVersion
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ChannelsPage_module_default.leadCardText,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.leadCardName,
										children: lead?.name ?? t("headLead")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ChannelsPage_module_default.leadCardStatus,
										children: [
											t("leadPinned"),
											" · ",
											leadStatus
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.leadCardHint,
										children: leadId == null ? t("leadCardSet") : t("leadCardHint")
									})
								]
							})]
						})
					}),
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
							if (event.key === "Enter" && !isImeEnter(event)) {
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
					groupRooms(state.rooms).map(({ room: r, depth }) => {
						const active = r.active ?? 0;
						const showActive = active > 0;
						const workers = (state.thinking[String(r.id)] ?? []).map((id) => state.members.find((m) => m.id === id)).filter((m) => m !== void 0);
						const fresh = r.id === state.roomId ? 0 : state.unread?.[String(r.id)] ?? 0;
						const working = workers.length === 0 ? void 0 : workers.length === 1 ? t("roomWorking", { name: workers[0].name }) : t("roomWorkingMany", { count: String(workers.length) });
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							"data-unread": fresh > 0 || void 0,
							className: [
								ChannelsPage_module_default.room,
								depth === 1 ? ChannelsPage_module_default.workspace : "",
								r.id === state.roomId ? ChannelsPage_module_default.roomActive : "",
								fresh > 0 ? ChannelsPage_module_default.roomUnread : ""
							].filter(Boolean).join(" "),
							"aria-current": r.id === state.roomId,
							onClick: () => {
								stickRef.current = true;
								setDrawer(void 0);
								selectRoom(r.id);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ChannelsPage_module_default.hash,
									"aria-hidden": true,
									children: "#"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ChannelsPage_module_default.roomLabel,
									children: r.name
								}),
								working !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: ChannelsPage_module_default.roomWorking,
									"aria-hidden": true,
									title: workers.map((m) => m.name).join("、"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.roomWorkingDot,
										"aria-hidden": true
									}), working]
								}),
								fresh > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ChannelsPage_module_default.unreadBadge,
									"aria-label": t("roomUnread", { count: String(fresh) }),
									children: fresh > 99 ? "99+" : fresh
								}),
								showActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: active > 0 ? `${ChannelsPage_module_default.activeCount} ${ChannelsPage_module_default.activeBusy}` : ChannelsPage_module_default.activeCount,
									children: t("activeTasks", { count: active })
								})
							]
						}, r.id);
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: `${ChannelsPage_module_default.groupHead} ${ChannelsPage_module_default.dmHead}`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: ChannelsPage_module_default.groupTitle,
							children: t("dmGroup")
						}), startDm !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ChannelsPage_module_default.iconButton,
							title: t("dmNew"),
							"aria-label": t("dmNew"),
							"aria-expanded": dmPicker,
							onClick: () => {
								setDmPicker(!dmPicker);
							},
							children: "+"
						})]
					}),
					dmPicker && startDm !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.dmPicker,
						role: "menu",
						"aria-label": t("dmPickTitle"),
						children: state.members.filter((m) => m.kind !== "human").length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.dmPickNone,
							children: t("dmPickNone")
						}) : state.members.filter((m) => m.kind !== "human").map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "menuitem",
							className: ChannelsPage_module_default.room,
							onClick: () => {
								setDmPicker(false);
								startDm(m);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.dmAvatar,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
									id: m.id,
									name: m.name,
									avatar: m.avatar,
									avatarVersion: m.avatarVersion,
									small: true
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.roomLabel,
								children: m.name
							})]
						}, m.id))
					}),
					startDm !== void 0 && dmRooms(state.rooms).length === 0 && !dmPicker && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: `${ChannelsPage_module_default.room} ${ChannelsPage_module_default.dmNewRow}`,
						onClick: () => {
							setDmPicker(true);
						},
						children: ["+ ", t("dmNew")]
					}),
					dmRooms(state.rooms).map((r) => {
						const peer = state.members.find((m) => m.id === r.dm_member);
						const label = peer?.name ?? r.name;
						const fresh = r.id === state.roomId ? 0 : state.unread?.[String(r.id)] ?? 0;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.dmRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								"data-unread": fresh > 0 || void 0,
								className: [
									ChannelsPage_module_default.room,
									r.id === state.roomId ? ChannelsPage_module_default.roomActive : "",
									fresh > 0 ? ChannelsPage_module_default.roomUnread : ""
								].filter(Boolean).join(" "),
								"aria-current": r.id === state.roomId,
								"data-dm-room": r.dm_member,
								onClick: () => {
									stickRef.current = true;
									setDrawer(void 0);
									selectRoom(r.id);
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.dmAvatar,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
											id: r.dm_member ?? "",
											name: label,
											avatar: peer?.avatar,
											avatarVersion: peer?.avatarVersion,
											small: true
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.roomLabel,
										children: label
									}),
									fresh > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.unreadBadge,
										"aria-label": t("roomUnread", { count: String(fresh) }),
										children: fresh > 99 ? "99+" : fresh
									})
								]
							}), endDm !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ChannelsPage_module_default.dmClose,
								"data-dm-close": r.id,
								title: t("dmClose"),
								"aria-label": t("dmCloseNamed", { name: label }),
								onClick: () => {
									endDm(r.id);
								},
								children: "×"
							})]
						}, r.id);
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				ref: chatRef,
				className: ChannelsPage_module_default.chat,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ChannelsPage_module_default.chatHead,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								ref: roomsToggleRef,
								type: "button",
								className: ChannelsPage_module_default.mobileButton,
								"aria-label": t("showRooms"),
								"aria-expanded": drawer === "rooms",
								onClick: () => setDrawer(drawer === "rooms" ? void 0 : "rooms"),
								children: "☰"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ChannelsPage_module_default.panelToggle,
								title: t(roomsHidden ? "expandRooms" : "collapseRooms"),
								"aria-label": t(roomsHidden ? "expandRooms" : "collapseRooms"),
								"aria-expanded": !roomsHidden,
								onClick: () => {
									setRoomsHidden(!roomsHidden);
								},
								children: roomsHidden ? "»" : "«"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.hash,
								"aria-hidden": true,
								children: dmWith !== void 0 ? "@" : "#"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.roomName,
								children: dmWith !== void 0 ? state.members.find((m) => m.id === dmWith)?.name ?? room?.name : room?.name
							}),
							dmWith === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ChannelsPage_module_default.headMeta,
								title: t("showMembersList"),
								onClick: openActivity,
								children: [t("headMembers", { count: visibleMembers.length }), channelActive > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" · ", t("activeTasks", { count: channelActive })] })]
							}),
							dmWith === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeadTeam, {
								mates: headTeam(visibleMembers, leadId, state.tasks ?? [], state.thinking, channelRooms),
								t,
								onOpen: openActivity
							}),
							dmWith === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskBoard, {
								tasks: state.tasks ?? [],
								rooms: state.rooms,
								chatId: state.taskChat,
								roomId: state.roomId,
								t,
								onOpen: openMessage,
								onReview: reviewTask,
								onTerminate: terminateTask,
								dock: boardDock,
								onDocked: setBoardDocked
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: ChannelsPage_module_default.headSpacer }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ChannelsPage_module_default.schemeToggle,
								title: t(scheme === "light" ? "schemeToDark" : "schemeToLight"),
								"aria-label": t(scheme === "light" ? "schemeToDark" : "schemeToLight"),
								"aria-pressed": scheme === "dark",
								onClick: () => {
									setScheme(scheme === "light" ? "dark" : "light");
								},
								children: scheme === "light" ? "☾" : "☀"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `${ChannelsPage_module_default.panelToggle} ${ChannelsPage_module_default.panelToggleEnd}`,
								title: t(membersHidden ? "expandMembers" : "collapseMembers"),
								"aria-label": t(membersHidden ? "expandMembers" : "collapseMembers"),
								"aria-expanded": !membersHidden,
								onClick: () => {
									setMembersHidden(!membersHidden);
								},
								children: membersHidden ? "«" : "»"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								ref: membersToggleRef,
								type: "button",
								className: ChannelsPage_module_default.mobileButton,
								"aria-label": t("showMembers"),
								"aria-expanded": drawer === "members",
								onClick: () => setDrawer(drawer === "members" ? void 0 : "members"),
								children: t("membersButton")
							})
						]
					}),
					dmWith === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressCard, {
						lines: channelProgress(state.tasks ?? [], channelRooms),
						t,
						onOpen: openMessage,
						folded,
						onToggle: toggleProgress
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.logWrap,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								ref: logRef,
								className: ChannelsPage_module_default.log,
								role: "log",
								"aria-live": "polite",
								onScroll: (event) => {
									const el = event.currentTarget;
									const edge = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
									if (edge && state.hasMoreNewer === true) pageForward();
									const bottom = edge && state.hasMoreNewer !== true;
									stickRef.current = bottom;
									if (bottom !== atBottom) setAtBottom(bottom);
									if (bottom && unread !== void 0 && !unread.seen) setUnread({
										...unread,
										seen: true
									});
									if (el.scrollTop <= 40) pageBack();
								},
								children: [
									dmWith === void 0 && !visibleMembers.some((m) => m.kind !== "human") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: ChannelsPage_module_default.guide,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("guideNoMembers") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: ChannelsPage_module_default.primaryButton,
											onClick: () => {
												setDialog(null);
											},
											children: t("addMember")
										})]
									}),
									loadingOlder && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.olderLoading,
										role: "status",
										children: t("loadingOlder")
									}),
									visibleMessages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.empty,
										children: dmWith !== void 0 ? t("dmEmpty", { name: dmPeer?.name ?? room?.name ?? "" }) : t("empty")
									}) : visibleMessages.map((m, index) => [firstUnread === m.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.unreadDivider,
										role: "separator",
										children: t("newMessagesDivider")
									}, `unread-${m.id}`) : null, pendingWithdraw?.id === m.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ChannelsPage_module_default.withdrawnRow,
										"data-message-id": m.id,
										children: t("withdrawPending")
									}, m.id) : answerIds.has(m.id) ? null : m.author_kind === "user" && m.card === null && commandLine(m.text) !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommandRow, {
										message: m,
										target: commandLine(m.text)?.target,
										command: commandLine(m.text)?.command ?? "",
										answer: answers.get(m.id),
										t
									}, m.id) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageRow, {
										enter: fresh.get(m.id),
										message: m,
										grouped: continues(visibleMessages[index - 1], m) && !answerIds.has(visibleMessages[index - 1]?.id ?? -1) && !(visibleMessages[index - 1]?.author_kind === "user" && commandLine(visibleMessages[index - 1]?.text ?? "") !== void 0),
										member: byId.get(m.author),
										members: visibleMembers,
										t,
										onConfigure: () => {
											if (!openModelSettings()) setModelsOpen(true);
										},
										menuOpen: avatarMenu === m.id,
										cardView,
										onCardView: chooseCardView,
										onAvatar: () => {
											setAvatarMenu(avatarMenu === m.id ? void 0 : m.id);
										},
										onCloseMenu: () => {
											setAvatarMenu(void 0);
										},
										onMention: mentionFromAvatar,
										onDm: startDm,
										onReview: reviewTask,
										onDecide: decidePermission,
										onRetry: handleRetry,
										retrying: retryingId === m.id,
										tasks: state.tasks ?? [],
										focused: focusedId === m.id,
										onReply: startReply,
										onTask: toTask,
										own: ownActions(m),
										queuedFor: queuedFor.get(m.id),
										taskCardShown: recordShowsCard(m),
										toolsOpen: toolsFor === m.id,
										onLongPress: () => {
											setToolsFor(m.id);
										},
										chatRoom: room?.kind !== "workspace"
									}, m.id)])
								]
							}),
							pendingWithdraw !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ChannelsPage_module_default.undoToast,
								role: "status",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("withdrawToast") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ChannelsPage_module_default.undoButton,
										onClick: undoWithdraw,
										children: t("withdrawUndo")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.undoBar,
										style: { animationDuration: `5000ms` },
										"aria-hidden": "true"
									})
								]
							}),
							(!atBottom || state.hasMoreNewer === true) && state.messages.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: ChannelsPage_module_default.jumpLatest,
								onClick: scrollToLatest,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										children: "↓"
									}),
									" ",
									t("jumpLatest"),
									visibleUnreadCount > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.jumpCount,
										children: t("jumpLatestCount", { count: visibleUnreadCount })
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.working,
						"aria-live": "polite",
						children: [typingNames.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: ChannelsPage_module_default.typingDots,
							"aria-hidden": "true",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})
							]
						}), t("workingList", { names: typingNames.join("、") })] }), queuedFor.size > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ChannelsPage_module_default.queuedButton,
							title: t("queuedJump"),
							onClick: jumpToQueued,
							children: t("queuedCount", { count: queuedFor.size })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DecideTray, {
						questions,
						permissionCount: pendingPerms.length,
						permissions: pendingPerms.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.permTray,
							role: "region",
							"aria-label": t("permTray", { count: pendingPerms.length }),
							children: pendingPerms.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PermTrayItem, {
								message: m,
								author: byId.get(m.author),
								members: visibleMembers,
								onMention: mentionFromAvatar,
								t,
								onDecide: decidePermission
							}, m.id))
						}),
						t,
						onAnswer: answerTask,
						isImeEnter
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.composer,
						ref: composerRef,
						children: [
							helpOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityList, {
								t,
								onClose: () => {
									setHelpOpen(false);
								}
							}, state.roomId),
							slashOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SlashMenu, {
								commands: slashCommands,
								selected: slashSelected,
								target: commandTarget?.name,
								leadName: dmWith === void 0 && commandTarget === void 0 ? lead?.name : void 0,
								dmName: dmWith === void 0 ? void 0 : dmPeer?.name ?? room?.name,
								disabled: (c) => commandTarget === void 0 && needsTarget(c),
								grouped: slash === "",
								t,
								onPick: runSlash,
								onHover: setSlashHighlight
							}),
							sendError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ChannelsPage_module_default.sendError,
								role: "alert",
								children: sendError
							}),
							ownNotice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ChannelsPage_module_default.sendError,
								role: "status",
								children: ownNotice
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
														avatar: m.avatar,
														avatarVersion: m.avatarVersion,
														small: true
													}), m.online && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: m.error ? `${ChannelsPage_module_default.presence} ${ChannelsPage_module_default.errorPresence}` : ChannelsPage_module_default.presence })]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ChannelsPage_module_default.mentionName,
													children: m.name
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(KindTag, {
													name: m.name,
													kind: m.kind,
													cli: m.cli,
													t
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ChannelsPage_module_default.mentionMeta,
													children: m.error ? t("memberFailed") : busy.has(m.id) ? t("working") : m.online ? `@${m.id}` : t("offline")
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
								className: ChannelsPage_module_default.composerBox,
								children: [
									replying !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: ChannelsPage_module_default.replyBar,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: ChannelsPage_module_default.replyBarText,
											children: [t("replyingTo", { name: replying.name }), state.messages.some((m) => m.id === replying.id) ? "" : ` · ${t("replyDeleted")}`]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: ChannelsPage_module_default.replyCancel,
											title: t("cancelReply"),
											"aria-label": t("cancelReply"),
											onClick: cancelReply,
											children: "×"
										})]
									}),
									state.roomId !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PendingAttachments, {
										files: pendingFiles[state.roomId] ?? [],
										removeLabel: t("removeAttachment"),
										labels: {
											uploading: t("attachmentUploading"),
											queued: t("attachmentQueued")
										},
										onRemove: (key) => removeFile(state.roomId, key)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: composing ? `${ChannelsPage_module_default.inputSurface} ${ChannelsPage_module_default.inputComposing}` : ChannelsPage_module_default.inputSurface,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
											ref: inputRef,
											className: ChannelsPage_module_default.input,
											rows: 1,
											enterKeyHint: "send",
											value: draft,
											disabled: state.roomId === void 0 || sending[state.roomId] === true,
											placeholder,
											role: "combobox",
											"aria-expanded": popupOpen || slashOpen,
											"aria-controls": slashOpen ? "channel-slash-list" : "channel-mention-list",
											"aria-autocomplete": "list",
											"aria-activedescendant": popupOpen ? `channel-mention-${candidates[selected].id}` : slashOpen ? `channel-slash-${slashSelected}` : void 0,
											onChange: (event) => {
												const roomId = state.roomId;
												const value = event.target.value;
												if (roomId !== void 0) setDrafts((previous) => ({
													...previous,
													[roomId]: value
												}));
												setCapabilitiesDismissed(false);
												setHelpOpen(false);
												setCaret(event.target.selectionStart);
												setHighlight(0);
												setSlashHighlight(0);
											},
											onSelect: (event) => {
												setCaret(event.currentTarget.selectionStart);
											},
											onScroll: syncInputHighlights,
											onCompositionStart: () => setComposing(true),
											onCompositionEnd: () => setComposing(false),
											onKeyDown,
											onPaste: attach.onPaste,
											onDragOver: attach.onDragOver,
											onDrop: attach.onDrop
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											ref: inputHighlightsRef,
											className: ChannelsPage_module_default.inputHighlights,
											"data-composer-highlights": true,
											"aria-hidden": "true",
											children: [splitMentions(draft, visibleMembers).map((segment, index) => segment.member ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `${ChannelsPage_module_default.mentionBadge} ${ChannelsPage_module_default.inputMention}`,
												"data-mention": segment.member.id,
												children: segment.text
											}, index) : segment.text), "\n"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: ChannelsPage_module_default.composerToolbar,
										children: [
											attach.button(t("attachButton"), state.roomId === void 0 || sending[state.roomId] === true),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: ChannelsPage_module_default.mentionButton,
												title: t("mentionButton"),
												"aria-label": t("mentionButton"),
												disabled: state.roomId === void 0 || sending[state.roomId] === true,
												onClick: openPicker,
												children: "@"
											}),
											stopping !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: ChannelsPage_module_default.stopNote,
												role: "status",
												children: t(stopping.phase === "stopping" ? "stopPending" : "stopDone", { name: stopping.name })
											}),
											stopMode ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: `${ChannelsPage_module_default.sendButton} ${ChannelsPage_module_default.stopButton}`,
												title: t("stopReply", { name: (stopTarget ?? stopping)?.name ?? "" }),
												"aria-label": t("stopReply", { name: (stopTarget ?? stopping)?.name ?? "" }),
												"data-phase": stopping?.phase,
												"aria-disabled": stopping?.phase === "stopping",
												onMouseDown: (event) => {
													event.preventDefault();
												},
												onClick: stopReply,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
													width: "14",
													height: "14",
													viewBox: "0 0 24 24",
													"aria-hidden": "true",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
														x: "5",
														y: "5",
														width: "14",
														height: "14",
														rx: "2.5",
														fill: "currentColor"
													})
												})
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: ChannelsPage_module_default.sendButton,
												title: t("sendButton"),
												"aria-label": t("sendButton"),
												disabled: state.roomId === void 0 || sending[state.roomId] === true || draft.trim() === "" && (pendingFiles[state.roomId] ?? []).length === 0,
												onMouseDown: (event) => {
													event.preventDefault();
												},
												onClick: submit,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
													width: "20",
													height: "20",
													viewBox: "0 0 24 24",
													fill: "none",
													stroke: "currentColor",
													strokeWidth: "2",
													strokeLinecap: "round",
													strokeLinejoin: "round",
													"aria-hidden": "true",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 19V5m-6 6 6-6 6 6" })
												})
											})
										]
									})
								]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: setBoardDock,
				className: ChannelsPage_module_default.sideDock
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				ref: membersRef,
				className: drawer === "members" ? `${ChannelsPage_module_default.members} ${ChannelsPage_module_default.drawerOpen}` : ChannelsPage_module_default.members,
				role: drawer === "members" ? "dialog" : void 0,
				"aria-modal": drawer === "members" ? true : void 0,
				"aria-label": t("activityPanel"),
				tabIndex: drawer === "members" ? -1 : void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.membersHead,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: ChannelsPage_module_default.membersHeadTitle,
							children: t("activityPanel")
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.drawerTools,
						children: [dmWith === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ChannelsPage_module_default.secondaryButton,
							onClick: openBoard,
							children: t("drawerBoard")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ChannelsPage_module_default.secondaryButton,
							"aria-pressed": scheme === "dark",
							onClick: () => {
								setScheme(scheme === "light" ? "dark" : "light");
							},
							children: t("drawerDark")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						ref: settingsButtonRef,
						type: "button",
						className: `${ChannelsPage_module_default.addMemberButton} ${ChannelsPage_module_default.settingsButton}`,
						disabled: room === void 0,
						onClick: () => {
							settingsReturnRef.current = drawer === "members" ? membersToggleRef.current : settingsButtonRef.current;
							setDrawer(void 0);
							setSettingsTab("basic");
							setSettingsOpen(true);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							width: "16",
							height: "16",
							viewBox: "0 0 24 24",
							fill: "none",
							stroke: "currentColor",
							strokeWidth: "1.5",
							strokeLinecap: "round",
							strokeLinejoin: "round",
							"aria-hidden": "true",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m9.5 3-.7 2.3-2 .9-2.2-.6-2.5 4.3 1.6 1.7v2.3l-1.6 1.7 2.5 4.3 2.2-.6 2 .9.7 2.3h5l.7-2.3 2-.9 2.2.6 2.5-4.3-1.6-1.7v-2.3l1.6-1.7-2.5-4.3-2.2.6-2-.9L14.5 3Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: "12",
								cy: "12.75",
								r: "3"
							})]
						}), t("channelSettings")]
					}),
					activity.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: ChannelsPage_module_default.activityNow,
						"aria-label": t("activityNow"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: ChannelsPage_module_default.groupTitle,
							children: t("activityNow")
						}), activity.map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ChannelsPage_module_default.activityItem,
							onClick: () => {
								pickFromList(a.member);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
									id: a.member.id,
									name: a.member.name,
									avatar: a.member.avatar,
									avatarVersion: a.member.avatarVersion,
									small: true
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: ChannelsPage_module_default.activityText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ChannelsPage_module_default.activityName,
										children: a.member.name
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: ChannelsPage_module_default.activityWhat,
										children: [a.task !== void 0 ? `#${a.task.id} ${a.task.title}` : t("activityThinking"), a.room !== void 0 && a.room.id !== state.roomId ? ` · ${a.room.name}` : ""]
									})]
								}),
								a.thinking && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ChannelsPage_module_default.activityPulse,
									"aria-hidden": true
								})
							]
						}, a.member.id))]
					}),
					dmWith === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: ChannelsPage_module_default.addMemberButton,
						onClick: () => {
							setDrawer(void 0);
							setDialog(null);
						},
						children: ["+ ", t("addMember")]
					}),
					memberError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.sendError,
						role: "alert",
						children: memberError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { className: ChannelsPage_module_default.memberListDivider }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberGroup, {
						title: t("agents", { count: String(visibleMembers.filter((m) => m.kind !== "human").length) }),
						members: visibleMembers.filter((m) => m.kind !== "human"),
						busy,
						onPick: pickFromList,
						onEdit: setDialog,
						onRemove: confirmRemove,
						onDm: dmWith === void 0 ? startDm : void 0,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberGroup, {
						title: t("humans", { count: String(visibleMembers.filter((m) => m.kind === "human").length) }),
						members: visibleMembers.filter((m) => m.kind === "human"),
						busy,
						onPick: pickFromList,
						onEdit: setDialog,
						onRemove: confirmRemove,
						t
					})
				]
			}),
			settingsOpen && room !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelSettingsDialog, {
				room,
				members: visibleMembers,
				initialTab: settingsTab,
				effectiveLead: room.effective_lead_id === void 0 ? state.effectiveLeadId ?? state.leadId ?? "" : room.effective_lead_id ?? "",
				renameRoom,
				setDispatchMode,
				setMaxRelay,
				setLead,
				setWorkspacePath,
				renewRoom,
				t,
				onClose: () => {
					setSettingsOpen(false);
				}
			}, room.id),
			modelsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.dialogBackdrop,
				onClick: () => {
					setModelsOpen(false);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: ChannelsPage_module_default.dialog,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("configureModel"),
					onClick: (event) => {
						event.stopPropagation();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ChannelsPage_module_default.secondaryButton,
						onClick: () => {
							setModelsOpen(false);
						},
						children: t("close")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("configureModelHint") })]
				})
			}),
			dialog !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemberDialog, {
				member: dialog ?? void 0,
				listModels,
				listClis,
				listPersonas,
				members: state.members,
				onSubmit: (input) => dialog === null ? addMember(input) : updateMember(dialog.id, input),
				onClose: () => {
					setDialog(void 0);
				},
				t
			})
		]
	});
}
// src/client/RemoteChannelsPage.tsx
const BELOW_BAR = { "--dsh-frame-top-clearance": "0px" };
function RemoteChannelsPage(props) {
	const { remoteName, collabUrl, back, t } = props;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CollabUrlContext.Provider, {
		value: collabUrl,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: PanelPages_module_default.remote,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PanelPages_module_default.remoteBar,
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: PanelPages_module_default.remoteName,
					children: t("remoteViewing", { name: remoteName })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: PanelPages_module_default.remoteBack,
					onClick: back,
					children: t("remoteBack")
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: PanelPages_module_default.remoteBody,
				style: BELOW_BAR,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChannelsPage, { ...props })
			})]
		})
	});
}
// src/client/locales.ts
/** Channel panel dictionaries. */
/** Locale namespace owned by the channel panel. */
const NS = "discord-channels";
/** Simplified Chinese dictionary and key source. */
const zh = {
	headMembers: "{count} 位成员",
	headBusy: "{names} 在忙",
	headLead: "当前主角色",
	headTeam: "队友忙闲",
	headTeamMore: "另 {count} 位队友",
	mateBusy: "忙",
	mateIdle: "闲",
	mateError: "出错",
	mateOffline: "离线",
	mateTask: "#{id} {title}",
	mateReplying: "在回复",
	headLeadIdle: "空闲",
	headLeadBusyUnreported: "在忙",
	headLeadUnset: "未设主角色",
	progressTitle: "本频道进展",
	progressDone: "做完",
	progressDoing: "在做",
	progressNext: "下一步",
	progressOpen: "没定",
	progressNone: "没有",
	progressTask: "#{id} {title} · {name}",
	progressNextReview: "验收 #{id} {title}（{name} 已交回）",
	progressNextResume: "接着做 #{id} {title}（{name}，已暂停）",
	progressMore: "，另 {count} 件",
	progressFold: "收起进展",
	progressExpand: "展开进展",
	progressFoldShort: "收起",
	progressExpandShort: "展开",
	decideTray: "等你定和权限请求",
	trayAsks: "等你点头 · {count} 件",
	trayCollapse: "收起",
	trayExpand: "展开",
	askKind: "等你定",
	askNoNote: "（没写问题内容，点开任务板看派活消息）",
	askFrom: "{name} 问 · #{id} {title}",
	askPlaceholder: "直接回复…",
	askReplyTo: "回复 #{id}",
	askSend: "发送回复",
	askReplied: "已回复：{text}",
	askUndo: "撤回（{n} 秒）",
	askApiPending: "接口修复中：这里的回复还送不到，先在聊天里 @ 对方回复",
	headLeadLoading: "读取中",
	leadPinned: "主角色",
	leadCard: "主角色",
	leadCardHint: "接你的话，派活给队友，收结果",
	leadCardSet: "点这里选一个",
	leadCardChange: "点开频道设置，换主角色",
	activityPanel: "活动",
	activityNow: "正在进行",
	activityThinking: "思考中",
	permPending: "等你点头",
	permTray: "待你确认的权限请求（{count}）",
	permAsks: "{name} 请求权限",
	copyCode: "复制代码",
	copiedCode: "已复制",
	attachmentDownload: "下载",
	attachmentCopy: "复制图片",
	attachmentCopying: "复制中…",
	attachmentCopied: "已复制",
	attachmentCopyError: "复制失败，请下载图片后保存或复制。",
	footnotes: "脚注",
	panel: "频道",
	panelDesk: "团队工作台",
	panelGalaxy: "Wiki 星河",
	panelBothouse: "bothouse",
	panelDevices: "其他电脑",
	remoteViewing: "正在用「{name}」的频道（那台电脑上的成员和消息）",
	remoteBack: "返回其他电脑",
	channelSettings: "频道设置",
	settingsBasic: "基本",
	settingsDispatch: "派活",
	settingsWorkspace: "工作区",
	settingsSaved: "已保存",
	settingsSaving: "保存中…",
	settingsDiscardConfirm: "还有未保存的改动。关闭将丢弃这些改动，确定关闭吗？",
	settingsRelay: "接力上限",
	settingsRelayHint: "Agent 连续接力达到上限后暂停自动接力，等人来 @。6–20 的整数，默认 6。",
	workingDirectory: "工作目录",
	workingDirectoryHint: "请输入已存在的绝对目录。只影响写入范围和相对路径，不影响读取；保存后下次新建会话生效。工作区继承所属频道。",
	renewConfirm: "已更新工作目录，是否立即为该频道重建会话？重建会清空当前对话上下文。",
	renewNow: "立即重建",
	renewLater: "稍后",
	channelLead: "谁当家（主角色）",
	channelName: "频道名称",
	channelNameHint: "1–32 个字符，不能含空白。",
	workspaceNameFixed: "工作区名称由系统分配，不能修改。",
	channelNameReserved: "「{name}」是工作区占用的名字，换个频道名吧。",
	channelNameTaken: "已经有频道叫「{name}」了，换个名字吧。",
	channelNameInvalid: "频道名要 1–32 个字符，不能含空白。",
	memberNameTaken: "已经有成员叫「{name}」了，换个名字吧。",
	memberNameInvalid: "成员名要 1–32 个字符，不能含空白、@ 或 <>（Claude Code 除外）。",
	actionFailed: "没成功：{message}",
	slashTitle: "命令",
	slashTitleLead: "发给 {name} 的命令",
	slashTitleNoLead: "命令 · 先在频道设置里选主角色，才能用这些命令",
	slashTitleDmNoCmd: "命令 · {name} 不接这些命令",
	slashDisabledHint: "没人接这条命令",
	slashHint: "↑↓ 选择 · 回车执行 · Esc 关闭",
	slashNoLead: "主角色不是 bothouse 机器人，没人接这条命令；先在频道设置里选主角色，或直接 @ 机器人再打命令。",
	slashStop: "停下这一轮，下条接着说",
	slashStopAll: "频道里所有机器人都停下",
	slashPs: "给正在跑的这轮补一句",
	slashNew: "开新会话",
	slashModel: "查看或切换模型",
	slashReasoning: "调思考深度",
	slashCron: "看定时任务",
	slashStatus: "看当前状态",
	slashUsage: "看用量",
	slashCompress: "压缩上下文",
	slashBoard: "打开任务板",
	slashHelp: "频道能做什么",
	slashGroupControl: "控制",
	slashGroupModel: "模型",
	slashGroupView: "查看",
	stopReply: "停止 {name} 这次回复",
	stopPending: "正在停止 {name}…",
	stopDone: "{name} 已停止",
	cmdTo: "发给 {name}",
	cmdToAll: "发给全部机器人",
	cmdSent: "已发出",
	permAllowOnce: "这次允许",
	permAllowSession: "本会话自动允许",
	toolCopy: "复制",
	toolCopied: "已复制",
	toolCopyFailed: "复制失败",
	toolTask: "转任务",
	toolTaskHint: "放上任务板，交给主角色",
	toolTasking: "转任务中…",
	toolTasked: "已放上任务板",
	toolTaskFailed: "转任务失败：{message}",
	capabilities: "能力清单",
	capabilityTaskBoard: "任务板",
	capabilityAttachments: "图片和文件",
	capabilityAttachmentsHelp: "cc-connect、DSH 原生成员和本机 CLI 成员都可接收频道附件。PNG/JPEG/GIF/WebP 不超过 5 MB 时作为图片，其余作为文件。",
	capabilityLater: "过会儿回来",
	capabilityReminder: "催办",
	capabilityWorkspace: "工作区",
	capabilityLead: "换主角色",
	capabilityDm: "私信",
	capabilityTaskBoardHelp: "点击右侧「任务板」统计行，在弹窗里查看负责人、状态和下次查看时间，点「派工消息」或「交回消息」回到对应记录。",
	capabilityLaterHelp: "三类成员都可登记一次性回查：告诉角色何时回来、回来做什么。登记后频道显示下次回查时间，服务重启后仍会在原房间叫醒原成员。",
	capabilityReminderHelp: "通过任务分发派出的任务，到点会自动催办一次；负责人交回结果或说明卡在哪里。",
	capabilityWorkspaceHelp: "在聊天频道把任务交给角色，需要时由角色创建工作区。工作区的问题和阶段结果会送回聊天频道。",
	capabilityLeadHelp: "在成员栏的「主角色」里选择角色。切换后，没有点名的消息由新的主角色接收。",
	capabilityDmHelp: "在左栏「私聊」或机器人头像菜单点「发私信」，和这个角色一对一说话，不打扰大群。角色也可向配置中的用户发送私信。",
	taskTabLabel: "按任务状态筛选",
	taskTabAll: "全部",
	taskTabDecide: "等你定",
	taskTabWorking: "在做",
	taskTabParked: "暂停/待发布",
	taskTabEmpty: "「{tab}」下没有任务",
	taskBoard: "任务板",
	taskBoardSummary: "等你定 {decide} · 在做 {working}",
	taskBoardOpen: "打开任务板",
	taskBoardClose: "关闭任务板",
	taskBoardNoTasks: "暂无任务",
	taskBoardEmptyInModal: "还没有派出的任务",
	taskBoardScope: "{room} {channel} · 工作区合计 {workspaces}",
	taskBoardTitle: "任务板 — 进行中 {count}",
	taskBoardEmpty: "还没有派出的任务",
	taskDoneGroup: "已完成 — {count}",
	taskBoardChat: "{room}",
	taskBoardWorkspace: "{room}",
	taskBoardOwner: "{name}",
	taskAssigned: "派出",
	taskAccepted: "已接",
	taskAsked: "有疑问",
	taskDeclined: "退回",
	taskEscalated: "升级",
	taskReturned: "交回",
	taskDone: "完成",
	taskCancelled: "已取消",
	taskSuperseded: "已替代",
	taskFailed: "出错",
	taskCancel: "取消任务",
	taskSupersede: "标为被替代",
	taskTerminationReason: "取消或替代原因",
	taskReplacementId: "替代任务编号（可选）",
	taskTerminationNote: "原因：{reason}",
	taskReplacement: "替代任务：#{id}",
	taskConfirmCancel: "确认取消任务",
	taskConfirmSupersede: "确认被替代",
	taskKeep: "继续保留任务",
	taskRework: "返工",
	taskIn: "在 #{room}",
	taskElapsed: "用时 {d}",
	taskNextCheck: "下次看 {time}",
	taskOpenAssign: "派工消息",
	taskOpenResult: "交回消息",
	taskApprove: "验收通过",
	taskSendBack: "要求返工",
	taskReviewReason: "返工原因（必填）",
	taskReviewSubmit: "提交返工",
	dispatchMode: "派活方式",
	dispatchSolo: "单模型多进程 — 同一模型分开处理任务",
	dispatchTeam: "完全团队 — 交给团队成员协作",
	dispatchMixed: "混合 — 按任务选择模型与成员",
	lead: "主角色",
	leadNone: "未选择（单成员自动接话，多成员不接话）",
	durSeconds: "{n} 秒",
	durMinutes: "{n} 分钟",
	durHours: "{h} 小时 {m} 分",
	configureModel: "去填密钥",
	configureModelHint: "模型在「设置 → 模型」里配置：点侧栏底部的设置入口，桌面版也可按 ⌘,（Windows/Linux 为 Ctrl+,）。",
	retry: "重试",
	rawError: "原始错误",
	retrying: "重试中…",
	permAllowed: "已允许",
	permDenied: "已拒绝",
	permAllowedAll: "已允许（本会话之后自动允许）",
	permExpired: "这条确认失效了：被新请求顶掉，或机器人重启过",
	permByText: "（文字回复）",
	permAllowAllScope: "只对这个机器人当前会话有效：之后它要的工具权限自动允许（向你提问的除外），机器人重启或开新会话后恢复逐条问。",
	memberFailed: "出错",
	showRooms: "打开频道列表",
	showMembers: "打开活动栏",
	schemeToDark: "切换到深色",
	schemeToLight: "切换到白色",
	closeDrawer: "关闭列表",
	membersButton: "活动",
	collapseRooms: "收起频道列表",
	expandRooms: "展开频道列表",
	collapseMembers: "收起活动栏",
	expandMembers: "展开活动栏",
	rooms: "文字频道",
	agents: "Agent — {count}",
	humans: "真人 — {count}",
	online: "在线",
	close: "关闭",
	dmGroup: "私聊",
	dmNew: "发私信",
	dmPickTitle: "和谁私聊",
	dmPickNone: "还没有能私聊的成员",
	dmPlaceholder: "发消息给 {name}",
	dmEmpty: "这里只有你和 {name}。",
	roomUnread: "{count} 条新消息",
	roomWorking: "{name} 在干活",
	roomWorkingMany: "{count} 人在干活",
	showMembersList: "查看成员",
	drawerBoard: "看任务板",
	drawerDark: "深色模式",
	dmOpen: "发私信",
	dmOpenFailed: "打不开私聊：{message}",
	dmClose: "关闭私聊（记录保留，再点「发私信」可恢复）",
	dmCloseNamed: "关闭和 {name} 的私聊",
	dmCloseFailed: "关不掉私聊：{message}",
	deliveryFull: "全屏",
	deliveryRevise: "继续改",
	deliveryAccept: "收下",
	deliveryAccepted: "已收下",
	deliveryAcceptFailed: "没收下，再点一次",
	offline: "离线",
	working: "忙",
	workingList: "{names} 正在输入…",
	queuedCount: "排队 {count} 条",
	queuedJump: "看排队的消息",
	queuedTag: "排队中",
	queuedFor: "等 {names} 忙完再处理，撤回就不发了",
	memoryBadge: "记忆 {count}",
	memoryList: "这条回复用到的记忆",
	memoryMoved: "（这一行已改动或移走）",
	kindDsh: "DSH",
	kindBot: "Agent",
	kindClaude: "Claude Code",
	kindCodex: "Codex",
	kindGemini: "Gemini",
	placeholderShort: "发消息到 #{room}",
	placeholder: "发消息到 #{room}，@成员 派活（回车发送，Shift+回车换行）",
	loading: "正在连接频道服务…",
	unavailable: "频道服务未启用：在 collab.yml 中配置服务后，用 --patch collab.yml 启动 DSH。",
	locked: "频道服务没有启动：这台电脑上已经有另一个 DSH 在用同一份频道数据（进程 {pid}，{started} 打开，数据目录 {dataDir}）。直接用已经打开的那个就行；要换成本页这个 DSH，先把那个关掉，再把本页这个 DSH 关掉重开——只刷新页面不会把频道接上。",
	lockedUnnamed: "频道服务没有启动：这台电脑上已经有另一个 DSH 在用同一份频道数据（数据目录 {dataDir}，进程 {pid}）——它没留下是哪个进程的记录，通常是因为那个 DSH 是旧版本，或者刚打开还没写记录。别去改配置：先看谁占着这个文件：macOS 或 Linux 上用 lsof {lock}，Windows 上在资源监视器的磁盘活动里搜这个文件名；找到那个 DSH 后关掉它，再关掉并重开本页这个 DSH，频道就能接上（只刷新页面不行）。",
	lockedFree: "频道服务还是没有启动：刚才占着频道数据的那个 DSH 已经关掉了，锁是空的；但本页的频道插件是在它占着的时候启动失败的，不会自己回来。把本页这个 DSH 关掉重开，频道就能接上。",
	lockedUnknown: "未知",
	unauthorized: "还没有登录 DSH，请刷新页面。",
	error: "频道服务出错：{message}",
	empty: "这里还没有消息。@一个成员开始吧。",
	guideNoMembers: "频道里还没有角色成员。添加一个：用 DSH 里已配好的模型，或本机已装的 CLI（Claude Code、Codex、Gemini）。",
	sendFailed: "发送失败：{message}",
	mentionTitle: "可以 @ 的成员",
	mentionTitleQuery: "匹配「{query}」的成员",
	mentionHint: "↑↓ 选择 · Enter / Tab 确认 · Esc 关闭",
	mentionButton: "@ 一个成员",
	sendButton: "发送",
	attachButton: "添加图片或文件",
	removeAttachment: "移除附件",
	attachmentsTooLarge: "附件太大：一条消息合计不能超过 {limit}",
	messageTooLarge: "消息太长：一条消息不能超过 {limit}",
	/** #1445: the text cap counts characters, so the number reads with its unit in the panel language. */
	charCount: "{count} 字符",
	attachmentTooLarge: "「{name}」{size}，超过单个文件上限 {limit}",
	attachmentUploading: "上传中",
	attachmentQueued: "等待上传",
	uploadFailed: "「{name}」上传失败：{message}",
	uploadUnsupported: "这个页面不能上传文件，请刷新后再试",
	mentionPick: "在输入框里 @{name}",
	memberMenu: "{name} 的成员操作",
	avatarMention: "@ TA",
	newRoom: "新建频道",
	newRoomPlaceholder: "频道名，回车创建",
	activeTasks: "进行中 {count} 件",
	addMember: "添加成员",
	editMember: "编辑",
	removeMember: "移除",
	removeConfirm: "移除成员「{name}」？历史消息会保留。",
	messageEdit: "编辑",
	messageWithdraw: "撤回",
	messageEdited: "（已编辑）",
	messageSave: "保存",
	messageCancel: "取消",
	messageEditHint: "Enter 保存，Esc 取消；已经读过的成员不会重新回复",
	withdrawConfirm: "撤回这条消息？成员对它的处理也会停下。",
	withdrawToast: "已撤回一条消息",
	withdrawUndo: "撤销",
	withdrawPending: "你撤回了一条消息",
	jumpLatest: "回到最新",
	jumpLatestCount: "{count} 条新消息",
	newMessagesDivider: "以下为新消息",
	loadingOlder: "正在加载更早的消息…",
	withdrawStopped: "已撤回，并停下了 {names} 对它的处理",
	withdrawRunning: "已撤回；{names} 已经在处理这条，没能停下",
	memberDialogAdd: "添加 DSH 成员",
	memberDialogEdit: "编辑成员「{name}」",
	memberName: "名字（@ 时用）",
	memberOptional: "可选：自定义名字、性格与说话风格、职责",
	memberNoPersona: "默认不附加角色人设，可以直接开始工作。",
	memberKeepName: "保留我的名字",
	memberPersonaNone: "不使用人设",
	memberPersonaLibrary: "从人设库选择",
	memberModel: "模型",
	memberModelDefault: "跟随 DSH 默认模型",
	memberClaudeModelDefault: "留空跟随 Claude CLI 默认模型",
	memberClaudeModelHint: "填写 Claude 模型 ID 或别名，保存后下一轮生效。",
	memberModelLoading: "正在读取可用模型…",
	memberModelRouteError: "{route}（读取失败：{error}）",
	memberType: "成员类型",
	memberTypeDsh: "DSH 模型",
	memberTypeCli: "本机 CLI",
	memberCli: "本机 CLI",
	memberCliLoading: "正在检测本机 CLI…",
	memberCliMissing: "未检测到",
	memberPermission: "权限",
	permissionReadOnly: "仅可查看",
	permissionWorkspaceWrite: "工作区内修改",
	permissionFullAccess: "完全权限",
	permissionReadOnlyHint: "CLI 要动手的工具调用一律拒绝。",
	permissionWorkspaceWriteHint: "CLI 要动手时在频道里发审批卡，由你决定。",
	permissionFullAccessHint: "启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。",
	memberPersona: "人设（可选）：它是谁、负责什么、说话风格",
	memberAvatar: "头像",
	memberAvatarNone: "不用头像（显示首字）",
	memberAvatarUpload: "上传图片",
	memberAvatarCustom: "自定义头像预览",
	memberAvatarReset: "恢复默认",
	memberAvatarHint: "PNG / JPEG / WebP，原图最大 10MB；取景后自动压缩为 256×256 PNG（最大 256KB），仅存本机。已有成员确认后立即生效。",
	memberAvatarPngError: "请选择有效的 PNG、JPEG 或 WebP 图片",
	memberAvatarSizeError: "原图不能超过 10MB",
	memberAvatarCrop: "裁切头像",
	memberAvatarCropHint: "拖动图片选择区域，用滚轮或滑杆缩放。Esc 取消，Enter 确认。",
	memberAvatarZoom: "缩放",
	memberAvatarConfirm: "确认裁切",
	memberAvatarOutputSizeError: "裁切后的 PNG 为 {kb}KB，超过 256KB；请选择其他区域或换一张图片。",
	memberAvatarConvertError: "图片处理失败，请重新选择",
	save: "保存",
	cancel: "取消",
	configMember: "来自配置文件，网页里不能修改",
	defaultModel: "默认模型",
	reply: "回复",
	cardView: "卡片视图",
	cardViewDetail: "细节",
	cardViewBrief: "简略",
	stepChips: "步骤",
	stepsFolded: "共 {total} 步，只显示最近几步",
	stepOk: "成功",
	stepFailed: "失败",
	stepRunning: "进行中",
	stepUnknown: "未报结果",
	stepOutput: "{tool} 的输入和输出",
	stepInput: "调用",
	stepResult: "输出",
	replyingTo: "回复 {name}",
	replyDeleted: "原消息已删除",
	cancelReply: "取消回复"
};
/** English dictionary. */
const en = {
	headMembers: "{count} members",
	headBusy: "{names} at work",
	headLead: "Current primary role",
	headTeam: "Teammates busy or idle",
	headTeamMore: "{count} more teammates",
	mateBusy: "busy",
	mateIdle: "idle",
	mateError: "error",
	mateOffline: "offline",
	mateTask: "#{id} {title}",
	mateReplying: "replying",
	headLeadIdle: "Idle",
	headLeadBusyUnreported: "Busy",
	headLeadUnset: "No lead set",
	progressTitle: "Channel progress",
	progressDone: "Done",
	progressDoing: "Doing",
	progressNext: "Next",
	progressOpen: "Open",
	progressNone: "None",
	progressTask: "#{id} {title} · {name}",
	progressNextReview: "Review #{id} {title} (handed back by {name})",
	progressNextResume: "Resume #{id} {title} ({name}, paused)",
	progressMore: ", {count} more",
	progressFold: "Fold progress",
	progressExpand: "Expand progress",
	progressFoldShort: "Fold",
	progressExpandShort: "Expand",
	decideTray: "Waiting on you and permission requests",
	trayAsks: "Waiting on you · {count}",
	trayCollapse: "Collapse",
	trayExpand: "Expand",
	askKind: "Question",
	askNoNote: "(No question text; open the task board for the dispatch message)",
	askFrom: "{name} asks · #{id} {title}",
	askPlaceholder: "Reply directly…",
	askReplyTo: "Reply to #{id}",
	askSend: "Send reply",
	askReplied: "Replied: {text}",
	askUndo: "Undo ({n}s)",
	askApiPending: "Reply endpoint is being fixed: replies here cannot be delivered yet; @ them in the chat instead",
	headLeadLoading: "Loading",
	leadPinned: "Primary role",
	leadCard: "Primary role",
	leadCardHint: "Takes your messages, hands work to teammates, collects results",
	leadCardSet: "Click to pick one",
	leadCardChange: "Open channel settings to change the primary role",
	activityPanel: "Activity",
	activityNow: "Now",
	activityThinking: "Thinking",
	permPending: "Waiting on you",
	permTray: "Permission requests awaiting you ({count})",
	permAsks: "{name} asks for permission",
	dispatchMode: "Dispatch mode",
	dispatchSolo: "Single model, multiple processes — separate tasks on one model",
	dispatchTeam: "Full team — delegate to team members",
	dispatchMixed: "Mixed — choose models and members for each task",
	copyCode: "Copy code",
	copiedCode: "Copied",
	attachmentDownload: "Download",
	attachmentCopy: "Copy image",
	attachmentCopying: "Copying…",
	attachmentCopied: "Copied",
	attachmentCopyError: "Could not copy. Download the image to save or copy it.",
	footnotes: "Footnotes",
	taskTabLabel: "Filter tasks by status",
	taskTabAll: "All",
	taskTabDecide: "Needs you",
	taskTabWorking: "In progress",
	taskTabParked: "Paused / to release",
	taskTabEmpty: "No tasks in {tab}",
	taskBoard: "Task board",
	taskBoardSummary: "Needs you {decide} · In progress {working}",
	taskBoardOpen: "Open task board",
	taskBoardClose: "Close task board",
	taskBoardNoTasks: "No tasks",
	taskBoardEmptyInModal: "No tasks dispatched yet",
	taskBoardScope: "{room} {channel} · Workspaces total {workspaces}",
	taskBoardTitle: "Tasks — {count} in progress",
	taskBoardEmpty: "No tasks dispatched yet",
	taskDoneGroup: "Done — {count}",
	taskBoardChat: "{room}",
	taskBoardWorkspace: "{room}",
	taskBoardOwner: "{name}",
	taskAssigned: "Assigned",
	taskAccepted: "Accepted",
	taskAsked: "Question",
	taskDeclined: "Declined",
	taskEscalated: "Escalated",
	taskReturned: "Handed back",
	taskDone: "Done",
	taskCancelled: "Cancelled",
	taskSuperseded: "Superseded",
	taskFailed: "Failed",
	taskCancel: "Cancel task",
	taskSupersede: "Mark superseded",
	taskTerminationReason: "Reason for cancellation or supersession",
	taskReplacementId: "Replacement task ID (optional)",
	taskTerminationNote: "Reason: {reason}",
	taskReplacement: "Replacement task: #{id}",
	taskConfirmCancel: "Confirm cancellation",
	taskConfirmSupersede: "Confirm supersession",
	taskKeep: "Keep task",
	taskRework: "Rework",
	taskIn: "in #{room}",
	taskElapsed: "took {d}",
	taskNextCheck: "next check {time}",
	taskOpenAssign: "Dispatch",
	taskOpenResult: "Delivery",
	taskApprove: "Accept result",
	taskSendBack: "Request rework",
	taskReviewReason: "Reason for rework (required)",
	taskReviewSubmit: "Submit rework",
	lead: "Primary role",
	leadNone: "No selection (one member replies; multiple stay quiet)",
	durSeconds: "{n}s",
	durMinutes: "{n} min",
	durHours: "{h} h {m} min",
	panel: "Channels",
	panelDesk: "Team desk",
	panelGalaxy: "Wiki galaxy",
	panelBothouse: "bothouse",
	panelDevices: "Other computers",
	remoteViewing: "Channels on “{name}” (members and messages of that computer)",
	remoteBack: "Back to other computers",
	channelSettings: "Channel settings",
	settingsBasic: "Basic",
	settingsDispatch: "Dispatch",
	settingsWorkspace: "Workspace",
	settingsSaved: "Saved",
	settingsSaving: "Saving…",
	settingsDiscardConfirm: "You have unsaved changes. Closing will discard them. Close anyway?",
	settingsRelay: "Relay cap",
	settingsRelayHint: "Agent-to-agent relays stop at this cap until a person @-mentions again. Integer 6–20, default 6.",
	workingDirectory: "Working directory",
	workingDirectoryHint: "Enter an existing absolute directory. This affects write scope and relative paths, not reads. It applies to new sessions; workspaces inherit their channel.",
	renewConfirm: "Working directory updated. Recreate this channel’s sessions now? This clears the current conversation context.",
	renewNow: "Recreate now",
	renewLater: "Later",
	channelLead: "Primary role",
	channelName: "Channel name",
	channelNameHint: "1–32 characters, without whitespace.",
	workspaceNameFixed: "Workspace names are assigned by the system and cannot be changed.",
	channelNameReserved: "\"{name}\" is a workspace name; pick another channel name.",
	channelNameTaken: "A channel named \"{name}\" already exists; pick another name.",
	channelNameInvalid: "A channel name is 1–32 characters and contains no whitespace.",
	memberNameTaken: "A member named \"{name}\" already exists; pick another name.",
	memberNameInvalid: "A member name is 1–32 characters, without whitespace, @ or <> (Claude Code excepted).",
	actionFailed: "That did not work: {message}",
	slashTitle: "Commands",
	slashTitleLead: "Commands to {name}",
	slashTitleNoLead: "Commands · pick a primary role in channel settings to use these",
	slashTitleDmNoCmd: "Commands · {name} does not take these commands",
	slashDisabledHint: "No one takes this command",
	slashHint: "↑↓ select · Enter run · Esc close",
	slashNoLead: "The primary role is not a bothouse bot, so no one takes this command. Pick a primary role in channel settings, or @ a bot before the command.",
	slashStop: "Stop the primary role's current turn (the session stays)",
	slashStopAll: "Stop every bot in this channel",
	slashPs: "Steer: add to the turn that is running",
	slashNew: "Start a new session",
	slashModel: "List or switch models",
	slashReasoning: "Show or set reasoning effort",
	slashCron: "Scheduled tasks",
	slashStatus: "Status",
	slashUsage: "Usage",
	slashCompress: "Compress the context",
	slashBoard: "Open the task board",
	slashHelp: "What this channel can do",
	slashGroupControl: "Control",
	slashGroupModel: "Model",
	slashGroupView: "View",
	stopReply: "Stop {name}'s reply",
	stopPending: "Stopping {name}…",
	stopDone: "{name} stopped",
	cmdTo: "to {name}",
	cmdToAll: "to every bot",
	cmdSent: "sent",
	permAllowOnce: "Allow once",
	permAllowSession: "Auto-allow this session",
	toolCopy: "Copy",
	toolCopied: "Copied",
	toolCopyFailed: "Copy failed",
	toolTask: "To task",
	toolTaskHint: "Put this message on the task board for the primary role",
	toolTasking: "Adding…",
	toolTasked: "On the task board",
	toolTaskFailed: "Could not add the task: {message}",
	capabilities: "Capabilities",
	capabilityTaskBoard: "Task board",
	capabilityAttachments: "Images and files",
	capabilityAttachmentsHelp: "cc-connect, native DSH and local CLI members receive channel attachments. PNG/JPEG/GIF/WebP up to 5 MB are images; other uploads are files.",
	capabilityLater: "Come back later",
	capabilityReminder: "Reminders",
	capabilityWorkspace: "Workspaces",
	capabilityLead: "Primary role",
	capabilityDm: "Direct messages",
	capabilityTaskBoardHelp: "Click the Task board summary on the right to view owners, status and next-check times in a dialog. Open Dispatch or Delivery to jump to its message.",
	capabilityLaterHelp: "All three member types can schedule one-shot follow-ups. Tell the role when to return and what to do. Registration appears in the channel, and wakes the original member in the original room after restart.",
	capabilityReminderHelp: "Dispatched tasks receive one reminder when due. The owner returns a result or explains the blocker.",
	capabilityWorkspaceHelp: "Assign work to a role in the chat channel. Roles create workspaces when needed; questions and progress return to the chat channel.",
	capabilityLeadHelp: "Choose a role under Primary role in the members panel. Messages without an explicit addressee then go to the new primary role.",
	capabilityDmHelp: "Use New message under Direct messages in the left column, or Message privately in a bot's avatar menu, to talk with that role one to one, away from the channel. Roles can also message the configured owner.",
	configureModel: "Add a model key",
	configureModelHint: "Models are configured in Settings → Models: use the settings entry at the bottom of the sidebar, or press ⌘, in the desktop app (Ctrl+, on Windows/Linux).",
	retry: "Retry",
	rawError: "Original error",
	retrying: "Retrying…",
	permAllowed: "Allowed",
	permDenied: "Denied",
	permAllowedAll: "Allowed (later requests in this session are auto-approved)",
	permExpired: "This request no longer applies: a newer one replaced it, or the bot restarted",
	permByText: "(text reply)",
	permAllowAllScope: "\"Allow all\" applies only to this bot's current session: its later tool permission requests are auto-approved (questions to you excepted) until the bot restarts or starts a new session.",
	memberFailed: "Error",
	showRooms: "Open channels",
	showMembers: "Open activity",
	schemeToDark: "Switch to dark",
	schemeToLight: "Switch to light",
	closeDrawer: "Close list",
	membersButton: "Activity",
	collapseRooms: "Collapse channels",
	expandRooms: "Expand channels",
	collapseMembers: "Collapse activity",
	expandMembers: "Expand activity",
	rooms: "Text channels",
	agents: "Agents — {count}",
	humans: "People — {count}",
	online: "Online",
	close: "Close",
	dmGroup: "Direct messages",
	dmNew: "New message",
	dmPickTitle: "Message whom",
	dmPickNone: "No member to message yet",
	dmPlaceholder: "Message {name}",
	dmEmpty: "Only you and {name} are here.",
	roomUnread: "{count} new messages",
	roomWorking: "{name} is working",
	roomWorkingMany: "{count} working",
	showMembersList: "Show members",
	drawerBoard: "Task board",
	drawerDark: "Dark mode",
	dmOpen: "Message privately",
	dmOpenFailed: "Could not open the private chat: {message}",
	dmClose: "Close this private chat (history is kept; Message privately reopens it)",
	dmCloseNamed: "Close the private chat with {name}",
	dmCloseFailed: "Could not close the private chat: {message}",
	deliveryFull: "Full screen",
	deliveryRevise: "Keep editing",
	deliveryAccept: "Accept",
	deliveryAccepted: "Accepted",
	deliveryAcceptFailed: "Not accepted, try again",
	offline: "Offline",
	working: "Busy",
	workingList: "{names} typing…",
	queuedCount: "{count} queued",
	queuedJump: "Show queued messages",
	queuedTag: "Queued",
	queuedFor: "Waits until {names} is free; withdraw it to drop it",
	memoryBadge: "Memory {count}",
	memoryList: "Memory this reply used",
	memoryMoved: "(this line changed or moved)",
	kindDsh: "DSH",
	kindBot: "Agent",
	kindClaude: "Claude Code",
	kindCodex: "Codex",
	kindGemini: "Gemini",
	placeholderShort: "Message #{room}",
	placeholder: "Message #{room}; @ a member to put it to work (Enter sends, Shift+Enter for a new line)",
	loading: "Connecting to the channel service…",
	unavailable: "The channel service is off: configure it in collab.yml, then start DSH with --patch collab.yml.",
	locked: "The channel service did not start: another DSH on this machine is already using the same channel data (process {pid}, opened {started}, data directory {dataDir}). Keep using the DSH you already have open; to switch to this one, quit that one, then quit and reopen this DSH — reloading the page will not reconnect the channel.",
	lockedUnnamed: "The channel service did not start: another DSH on this machine is already using the same channel data (data directory {dataDir}, process {pid}) and left no record of which process it is — usually because that DSH is an older build, or has only just started. Do not touch the configuration: first see what holds the lock file — lsof {lock} on macOS or Linux, or search that file name in Resource Monitor on Windows; then quit that DSH, quit and reopen this one, and the channel reconnects (reloading the page will not).",
	lockedFree: "The channel service still did not start: the DSH that held the channel data has quit and the lock is free, but this page's channel plugin refused at startup and does not come back by itself. Quit and reopen this DSH to reconnect the channel.",
	lockedUnknown: "unknown",
	unauthorized: "Not signed in to DSH; reload the page.",
	error: "Channel service error: {message}",
	empty: "No messages yet. @ a member to start.",
	guideNoMembers: "No role members in this channel yet. Add one using a model configured in DSH, or a CLI installed on this machine (Claude Code, Codex, Gemini).",
	sendFailed: "Send failed: {message}",
	mentionTitle: "Members you can mention",
	mentionTitleQuery: "Members matching \"{query}\"",
	mentionHint: "↑↓ select · Enter / Tab confirm · Esc close",
	mentionButton: "Mention a member",
	sendButton: "Send",
	attachButton: "Attach images or files",
	removeAttachment: "Remove attachment",
	attachmentsTooLarge: "Attachments too large: one message can carry at most {limit} in total",
	messageTooLarge: "Message too long: one message can hold at most {limit}",
	charCount: "{count} characters",
	attachmentTooLarge: "\"{name}\" is {size}, over the per-file limit of {limit}",
	attachmentUploading: "Uploading",
	attachmentQueued: "Waiting to upload",
	uploadFailed: "\"{name}\" failed to upload: {message}",
	uploadUnsupported: "This page cannot upload files; reload and try again",
	mentionPick: "Mention {name} in the message box",
	memberMenu: "Member actions for {name}",
	avatarMention: "Mention",
	newRoom: "New channel",
	newRoomPlaceholder: "Channel name, Enter to create",
	activeTasks: "{count} in progress",
	addMember: "Add member",
	editMember: "Edit",
	removeMember: "Remove",
	removeConfirm: "Remove member \"{name}\"? Their messages stay.",
	messageEdit: "Edit",
	messageWithdraw: "Withdraw",
	messageEdited: "(edited)",
	messageSave: "Save",
	messageCancel: "Cancel",
	messageEditHint: "Enter to save, Esc to cancel; members that already read it will not reply again",
	withdrawConfirm: "Withdraw this message? Members working on it will stop.",
	withdrawToast: "Message withdrawn",
	withdrawUndo: "Undo",
	withdrawPending: "You withdrew a message",
	jumpLatest: "Jump to latest",
	jumpLatestCount: "{count} new",
	newMessagesDivider: "New messages",
	loadingOlder: "Loading earlier messages…",
	withdrawStopped: "Withdrawn, and stopped {names} working on it",
	withdrawRunning: "Withdrawn; {names} had already started on it and could not be stopped",
	memberDialogAdd: "Add a DSH member",
	memberDialogEdit: "Edit member \"{name}\"",
	memberName: "Name (used for @)",
	memberOptional: "Optional: name, personality, speaking style and responsibilities",
	memberNoPersona: "Ready to work without a persona.",
	memberKeepName: "Keep my name",
	memberPersonaNone: "No persona",
	memberPersonaLibrary: "Choose from persona library",
	memberModel: "Model",
	memberModelDefault: "Follow the DSH default model",
	memberClaudeModelDefault: "Leave blank to follow the Claude CLI default",
	memberClaudeModelHint: "Enter a Claude model ID or alias. Changes apply on the next turn.",
	memberModelLoading: "Loading available models…",
	memberModelRouteError: "{route} (could not list: {error})",
	memberType: "Member type",
	memberTypeDsh: "DSH model",
	memberTypeCli: "Local CLI",
	memberCli: "Local CLI",
	memberCliLoading: "Detecting CLIs on this machine…",
	memberCliMissing: "not found",
	memberPermission: "Permission",
	permissionReadOnly: "Read Only",
	permissionWorkspaceWrite: "Workspace Write",
	permissionFullAccess: "Full access",
	permissionReadOnlyHint: "Tool calls that would change anything are refused.",
	permissionWorkspaceWriteHint: "When the CLI wants to act, an approval card is posted in the channel for you to decide.",
	permissionFullAccessHint: "Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.",
	memberPersona: "Persona (optional): who it is, what it does, how it talks",
	memberAvatar: "Avatar",
	memberAvatarNone: "No avatar (show initial)",
	memberAvatarUpload: "Upload image",
	memberAvatarCustom: "Custom avatar preview",
	memberAvatarReset: "Restore default",
	memberAvatarHint: "PNG / JPEG / WebP, up to 10MB; cropped and compressed to 256×256 PNG (up to 256KB), stored locally. Confirmation applies immediately for existing members.",
	memberAvatarPngError: "Choose a valid PNG, JPEG or WebP image",
	memberAvatarSizeError: "Source image must not exceed 10MB",
	memberAvatarCrop: "Crop avatar",
	memberAvatarCropHint: "Drag to choose an area; use the wheel or slider to zoom. Esc cancels, Enter confirms.",
	memberAvatarZoom: "Zoom",
	memberAvatarConfirm: "Confirm crop",
	memberAvatarOutputSizeError: "The cropped PNG is {kb}KB, exceeding 256KB; choose another area or image.",
	memberAvatarConvertError: "Could not process this image; choose it again",
	save: "Save",
	cancel: "Cancel",
	configMember: "From the config file; not editable here",
	defaultModel: "Default model",
	reply: "Reply",
	cardView: "Card view",
	cardViewDetail: "Detail",
	cardViewBrief: "Brief",
	stepChips: "Steps",
	stepsFolded: "{total} steps, latest shown",
	stepOk: "succeeded",
	stepFailed: "failed",
	stepRunning: "running",
	stepUnknown: "no result",
	stepOutput: "{tool} call and output",
	stepInput: "Call",
	stepResult: "Output",
	replyingTo: "Replying to {name}",
	replyDeleted: "Original message was deleted",
	cancelReply: "Cancel reply"
};
// src/client/panel-hash.ts
/** Shape the fragment may take: one sidebar key (`plugins`, `schedules`, `collab-desk`, …). */
const PANEL_ID$1 = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
/** The main-panel id a fragment names; `null` for an empty or unrecognised one. */
function panelIdFromHash(hash) {
	const raw = hash.startsWith("#") ? hash.slice(1) : hash;
	return PANEL_ID$1.test(raw) ? raw : null;
}
/** The address of the current page with `id` as its fragment: query (the wizard token) untouched. */
function addressFor(id) {
	return `${location.pathname}${location.search}${id === null ? "" : `#${id}`}`;
}
/**
* Mirror every later panel selection into the fragment; the returned function stops following.
* Opening a panel writes `#<id>`, going back to the conversation clears it.
* @param layout - `ctx.layout` (panel selection and its shared source).
* @returns unsubscribe.
*/
function followPanelHash(layout) {
	const source = layout.panelInfo;
	let last = source.getSnapshot().activePanelId;
	return source.subscribe(() => {
		const next = source.getSnapshot().activePanelId;
		if (next === last) return;
		last = next;
		if (addressFor(next) === `${location.pathname}${location.search}${location.hash}`) return;
		history.replaceState(history.state, "", addressFor(next));
	});
}
/** Whether a keyed `main` panel with this id is registered right now. */
function hasMainPanel(slots, id) {
	return slots.entriesOfSlot("main").some((entry) => entry.options.key === id);
}
/**
* Open the panel the fragment names, once its package has registered it; the returned function
* stops waiting. Panels register when their own browser half loads, which can be after this
* plugin: `layout.selectPanel` throws for a main key that is not registered yet (see
* bothouse-dsh-panel/client.js), so this waits for the registration instead of firing once.
* @param layout - `ctx.layout`.
* @param slots - `ctx.slots` (main-slot registry and its change subscription).
* @param hash - the fragment to honour; defaults to the current address.
* @returns unsubscribe from the pending restore.
*/
function restorePanelFromHash(layout, slots, hash = location.hash) {
	const id = panelIdFromHash(hash);
	if (id === null) return () => {};
	if (hasMainPanel(slots, id)) {
		layout.selectPanel(id);
		return () => {};
	}
	if (layout.panelInfo.getSnapshot().activePanelId !== null) return () => {};
	let stopWaiting = () => {};
	let stopWatching = () => {};
	const done = () => {
		stopWaiting();
		stopWatching();
	};
	stopWaiting = slots.subscribe("main", () => {
		if (!hasMainPanel(slots, id)) return;
		done();
		if (layout.panelInfo.getSnapshot().activePanelId === null) layout.selectPanel(id);
	});
	stopWatching = layout.panelInfo.subscribe(done);
	return done;
}
// src/client/index.ts
const PANEL_ID = "channels";
const REMOTE_PANEL_ID = "remote-channels";
const DEVICES_PANEL_ID = "collab-devices";
/** Global the 其他电脑 page (same origin, in an iframe) calls to open a link's channels here. */
const OPEN_REMOTE = "__bothouseOpenRemoteChannels";
/** Required browser services. */
const inject = [
	"slots",
	"locale",
	"layout"
];
/**
* Register the channel dictionaries, the main panel, and its sidebar entry.
* @param ctx - Client root context.
*/
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "client-ui-discord: dictionaries");
	ctx.effect(() => followPanelHash(ctx.layout), "client-ui-discord: panel hash");
	ctx.effect(() => restorePanelFromHash(ctx.layout, ctx.slots), "client-ui-discord: panel hash restore");
	const t = ctx.locale.bind(NS);
	const channels = createChannelSource(browserTransport());
	ctx.effect(() => channels.dispose, "client-ui-discord: channel stream");
	const injected = (openModelSettings) => injectedFor(channels, openModelSettings);
	const injectedFor = (channels, openModelSettings) => ({
		openModelSettings,
		hooks: { channels: channels.source },
		selectRoom: channels.actions.selectRoom,
		send: channels.actions.send,
		uploadAttachment: channels.actions.uploadAttachment,
		reviewTask: channels.actions.reviewTask,
		terminateTask: channels.actions.terminateTask,
		dispatchTask: channels.actions.dispatchTask,
		openDm: channels.actions.openDm,
		closeDm: channels.actions.closeDm,
		retrySend: channels.actions.retrySend,
		dismissSend: channels.actions.dismissSend,
		loadOlder: channels.actions.loadOlder,
		loadNewer: channels.actions.loadNewer,
		keepLatest: channels.actions.keepLatest,
		showLatest: channels.actions.showLatest,
		createRoom: channels.actions.createRoom,
		renameRoom: channels.actions.renameRoom,
		listModels: channels.actions.listModels,
		listClis: channels.actions.listClis,
		listPersonas: channels.actions.listPersonas,
		addMember: channels.actions.addMember,
		updateMember: channels.actions.updateMember,
		removeMember: channels.actions.removeMember,
		setDispatchMode: channels.actions.setDispatchMode,
		setMaxRelay: channels.actions.setMaxRelay,
		setLead: channels.actions.setLead,
		setWorkspacePath: channels.actions.setWorkspacePath,
		renewRoom: channels.actions.renewRoom,
		decidePermission: channels.actions.decidePermission,
		retryMessage: channels.actions.retryMessage,
		editMessage: channels.actions.editMessage,
		withdrawMessage: channels.actions.withdrawMessage
	});
	ctx.slots.inject("main", () => {
		let currentStore;
		let disposePanel;
		const bindPanel = () => {
			const shellStore = ctx.slots.entriesOfSlot("sidebar.settings")[0]?.store;
			if (disposePanel && shellStore === currentStore) return;
			disposePanel?.();
			currentStore = shellStore;
			disposePanel = shellStore ? ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS,
				store: shellStore,
				inject: (actions) => injected(() => {
					actions.openSection("models");
					return true;
				})
			}, ChannelsPage) : ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS,
				inject: () => injected(() => false)
			}, ChannelsPage);
		};
		bindPanel();
		const unsubscribe = ctx.slots.subscribe("sidebar.settings", bindPanel);
		return () => {
			unsubscribe();
			disposePanel?.();
		};
	});
	ctx.slots.inject("main", () => {
		let remote;
		const close = () => {
			remote?.dispose();
			remote = void 0;
		};
		const open = (link, name) => {
			const url = remoteCollabUrl(link);
			if (remote?.link !== link) {
				close();
				const source = createChannelSource(mappedTransport(browserTransport(), url));
				const unregister = ctx.slots.register({
					name: "main",
					key: REMOTE_PANEL_ID,
					locale: NS,
					inject: () => ({
						...injectedFor(source, () => false),
						remoteName: name,
						collabUrl: url,
						back: () => {
							ctx.layout.selectPanel(DEVICES_PANEL_ID);
						}
					})
				}, RemoteChannelsPage);
				remote = {
					link,
					dispose: () => {
						unregister();
						source.dispose();
					}
				};
			}
			ctx.layout.selectPanel(REMOTE_PANEL_ID);
			return true;
		};
		Reflect.set(globalThis, OPEN_REMOTE, open);
		return () => {
			if (Reflect.get(globalThis, "__bothouseOpenRemoteChannels") === open) Reflect.deleteProperty(globalThis, OPEN_REMOTE);
			close();
		};
	});
	if (typeof ctx.inject === "function") ctx.inject(["theme"], (themed) => {
		const theme = Reflect.get(themed, "theme");
		if (theme === void 0) return;
		const on = Reflect.get(themed, "on");
		themed.effect(() => bindHostTheme({
			scheme: () => theme.getTheme().active.colorScheme,
			set: (next) => {
				theme.setTheme(next);
			},
			subscribe: (fn) => on.call(themed, "theme/change", fn)
		}), "client-ui-discord: host theme");
	});
	ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
		name: "sidebar.panellist",
		id: PANEL_ID,
		order: 5,
		locale: NS,
		label: () => t("panel")
	}, ChannelsIcon));
}
exports.OPEN_REMOTE = OPEN_REMOTE;
exports.apply = apply;
exports.inject = inject;

 return module.exports;
 }
});
