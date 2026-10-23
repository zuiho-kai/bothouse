window.__ModuleLoader__.load({
 id: "@deepseek-ai/dsh-experimental-client-ui-discord",
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
(function(){var s=document.createElement('style');s.setAttribute('data-dsh-plugin',"dsh-experimental-client-ui-discord");s.textContent=".RqGPwG_page {\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  padding-top: var(--dsh-frame-top-clearance, 0px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  grid-template-columns: 220px minmax(0, 1fr) 240px;\n  font-size: 14px;\n  line-height: 1.5;\n  display: grid;\n}\n\n.RqGPwG_notice {\n  max-width: 480px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: center;\n  grid-column: 1 / -1;\n  place-self: center;\n  padding: 24px;\n}\n\n.RqGPwG_rooms, .RqGPwG_members {\n  background: var(--dsw-alias-bg-layer-2);\n  min-height: 0;\n  padding: 8px 8px 16px;\n  overflow-y: auto;\n}\n\n.RqGPwG_groupTitle {\n  color: var(--dsw-alias-label-tertiary);\n  letter-spacing: .02em;\n  margin: 12px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.RqGPwG_room {\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.RqGPwG_room:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_room:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.RqGPwG_workspace {\n  padding-left: 22px;\n  font-size: .95em;\n}\n\n.RqGPwG_roomLabel {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.RqGPwG_activeCount {\n  color: var(--dsw-alias-label-tertiary);\n  flex-shrink: 0;\n  margin-left: auto;\n  font-size: 11px;\n}\n\n.RqGPwG_activeBusy {\n  color: var(--dsw-alias-label-primary);\n}\n\n.RqGPwG_roomActive {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_roomUnread {\n  color: var(--dsw-alias-label-primary);\n  font-weight: 600;\n  position: relative;\n}\n\n.RqGPwG_roomUnread:before {\n  content: \"\";\n  background: var(--dsw-alias-label-primary, #fff);\n  border-radius: 0 4px 4px 0;\n  width: 4px;\n  height: 8px;\n  position: absolute;\n  top: 50%;\n  left: -2px;\n  transform: translateY(-50%);\n}\n\n.RqGPwG_roomMention:before {\n  background: #f23f43;\n  height: 12px;\n}\n\n.RqGPwG_unreadBadge {\n  background: var(--dsw-alias-interactive-bg-hover, #ffffff26);\n  min-width: 18px;\n  height: 18px;\n  color: var(--dsw-alias-label-primary, #fff);\n  box-sizing: border-box;\n  border-radius: 9px;\n  flex-shrink: 0;\n  justify-content: center;\n  align-items: center;\n  margin-left: auto;\n  padding: 0 5px;\n  font-size: 11px;\n  font-weight: 700;\n  line-height: 1;\n  display: inline-flex;\n}\n\n.RqGPwG_unreadMention {\n  color: #fff;\n  background: #f23f43;\n  box-shadow: 0 1px 4px #f23f4366;\n}\n\n.RqGPwG_notifyToggle {\n  border-radius: var(--dsw-radius-sm, 4px);\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-secondary);\n  cursor: pointer;\n  background: none;\n  border: 0;\n  justify-content: center;\n  align-items: center;\n  margin-left: auto;\n  padding: 0;\n  transition: color .15s, background-color .15s;\n  display: inline-flex;\n}\n\n.RqGPwG_notifyToggle:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_notifyOn {\n  color: var(--dsw-alias-label-primary);\n}\n\n.RqGPwG_notifyOff {\n  color: var(--dsw-alias-label-tertiary);\n  opacity: .6;\n}\n\n.RqGPwG_unreadDivider {\n  text-align: center;\n  align-items: center;\n  margin: 12px 16px;\n  display: flex;\n  position: relative;\n}\n\n.RqGPwG_unreadDivider:before, .RqGPwG_unreadDivider:after {\n  content: \"\";\n  opacity: .8;\n  background: #f23f43;\n  flex: 1;\n  height: 1px;\n}\n\n.RqGPwG_unreadDividerLabel {\n  color: #fff;\n  letter-spacing: .5px;\n  text-transform: uppercase;\n  background: #f23f43;\n  border-radius: 4px;\n  margin: 0 8px;\n  padding: 2px 8px;\n  font-size: 11px;\n  font-weight: 700;\n}\n\n.RqGPwG_hash {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 16px;\n}\n\n.RqGPwG_chat {\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n}\n\n.RqGPwG_chatHead {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  align-items: center;\n  gap: 6px;\n  height: 44px;\n  padding: 0 16px;\n  font-weight: 600;\n  display: flex;\n}\n\n.RqGPwG_log {\n  flex: 1;\n  min-height: 0;\n  padding: 8px 0 12px;\n  overflow-y: auto;\n}\n\n.RqGPwG_guide {\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 10px;\n  margin: 16px;\n  padding: 14px 16px;\n  display: flex;\n}\n\n.RqGPwG_empty {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 24px 16px;\n}\n\n.RqGPwG_message {\n  grid-template-columns: 36px minmax(0, 1fr);\n  gap: 12px;\n  padding: 6px 16px;\n  display: grid;\n}\n\n.RqGPwG_message:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_system .RqGPwG_text {\n  color: var(--dsw-alias-label-tertiary);\n  font-style: italic;\n}\n\n.RqGPwG_avatar {\n  corner-shape: round;\n  color: #fff;\n  border-radius: 50%;\n  place-items: center;\n  width: 36px;\n  height: 36px;\n  font-weight: 700;\n  display: grid;\n  position: relative;\n}\n\n.RqGPwG_avatarImage {\n  object-fit: cover;\n  border-radius: 50%;\n  width: 100%;\n  height: 100%;\n  position: absolute;\n  inset: 0;\n}\n\n.RqGPwG_avatarSmall {\n  width: 28px;\n  height: 28px;\n  font-size: 12px;\n}\n\n.RqGPwG_avatarAnchor {\n  align-self: start;\n  position: relative;\n}\n\n.RqGPwG_avatarButton {\n  cursor: pointer;\n  background: none;\n  border: 0;\n  border-radius: 50%;\n  padding: 0;\n}\n\n.RqGPwG_avatarMenu {\n  z-index: 3;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  min-width: 140px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 0;\n}\n\n.RqGPwG_avatarMenuTitle {\n  padding: 4px 8px;\n  font-weight: 700;\n}\n\n.RqGPwG_avatarMenuItem {\n  border-radius: var(--dsw-radius-sm);\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 6px 8px;\n}\n\n.RqGPwG_avatarMenuItem:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_messageBody {\n  min-width: 0;\n}\n\n.RqGPwG_messageHead {\n  align-items: baseline;\n  gap: 6px;\n  display: flex;\n}\n\n.RqGPwG_author {\n  font-weight: 600;\n}\n\n.RqGPwG_time {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.RqGPwG_tag {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  white-space: nowrap;\n  padding: 0 4px;\n  font-size: 10px;\n  font-weight: 600;\n}\n\n.RqGPwG_text {\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n}\n\n.RqGPwG_card {\n  border-left: 4px solid var(--dsw-alias-state-business-primary);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-layer-2);\n  margin-top: 4px;\n  padding: 6px 10px;\n}\n\n.RqGPwG_card[data-state=\"failed\"] {\n  border-left-color: var(--dsw-alias-state-error-primary);\n}\n\n.RqGPwG_cardTitle {\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.RqGPwG_permActions {\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.RqGPwG_permScope {\n  color: var(--dsw-alias-text-secondary);\n  flex-basis: 100%;\n  font-size: 12px;\n}\n\n.RqGPwG_permStatus {\n  margin-top: 6px;\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.RqGPwG_message {\n  position: relative;\n}\n\n.RqGPwG_quote {\n  border-left: 2px solid var(--dsw-alias-label-tertiary);\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  gap: 6px;\n  margin-bottom: 2px;\n  padding-left: 8px;\n  font-size: 12px;\n  display: flex;\n  overflow: hidden;\n}\n\n.RqGPwG_quoteDeleted {\n  font-style: italic;\n}\n\n.RqGPwG_quoteAuthor {\n  flex: none;\n  font-weight: 600;\n}\n\n.RqGPwG_replyButton {\n  opacity: 0;\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  cursor: pointer;\n  border: 0;\n  padding: 0 6px;\n  position: absolute;\n  top: 4px;\n  right: 16px;\n}\n\n.RqGPwG_message:hover .RqGPwG_replyButton, .RqGPwG_message:focus-within .RqGPwG_replyButton, .RqGPwG_replyButton:focus-visible {\n  opacity: 1;\n}\n\n@media (hover: none) {\n  .RqGPwG_replyButton {\n    opacity: 1;\n  }\n}\n\n.RqGPwG_replyBar {\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  align-items: center;\n  gap: 8px;\n  margin-bottom: 6px;\n  padding: 4px 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.RqGPwG_replyBarText {\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n}\n\n.RqGPwG_replyCancel {\n  color: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n}\n\n.RqGPwG_working {\n  min-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n  padding: 0 16px;\n  font-size: 12px;\n}\n\n.RqGPwG_composer {\n  padding: 0 16px 16px;\n  position: relative;\n}\n\n.RqGPwG_composerRow {\n  align-items: flex-end;\n  gap: 8px;\n  display: flex;\n}\n\n.RqGPwG_mentionButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  width: 40px;\n  height: 40px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  font: inherit;\n  cursor: pointer;\n  flex: none;\n  font-size: 18px;\n  font-weight: 600;\n}\n\n.RqGPwG_mentionButton:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_mentionButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.RqGPwG_mentionPopup {\n  z-index: 2;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  max-height: 320px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  bottom: calc(100% - 8px);\n  left: 16px;\n  right: 16px;\n}\n\n.RqGPwG_mentionPopup > [role=\"listbox\"] {\n  min-height: 0;\n  overflow-y: auto;\n}\n\n.RqGPwG_mentionTitle {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 4px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.RqGPwG_mentionItem {\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n  align-items: center;\n  gap: 10px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.RqGPwG_mentionActive {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_mentionName {\n  font-weight: 600;\n}\n\n.RqGPwG_mentionMeta {\n  color: var(--dsw-alias-label-tertiary);\n  margin-left: auto;\n  font-size: 12px;\n}\n\n.RqGPwG_mentionHint {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-tertiary);\n  padding: 6px 8px 2px;\n  font-size: 11px;\n}\n\n.RqGPwG_sendError {\n  color: var(--dsw-alias-state-error-primary);\n  margin-bottom: 6px;\n  font-size: 12px;\n}\n\n.RqGPwG_input {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  width: 100%;\n  max-height: 40vh;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-layer-2);\n  font: inherit;\n  resize: none;\n  field-sizing: content;\n  padding: 10px 14px;\n}\n\n.RqGPwG_input:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.RqGPwG_member {\n  border-radius: var(--dsw-radius-sm);\n  min-width: 0;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: 1;\n  align-items: center;\n  gap: 10px;\n  padding: 5px 8px;\n  display: flex;\n}\n\n.RqGPwG_member:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_member:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.RqGPwG_offline {\n  opacity: .5;\n}\n\n.RqGPwG_memberAvatar {\n  position: relative;\n}\n\n.RqGPwG_presence {\n  border: 2px solid var(--dsw-alias-bg-layer-2);\n  corner-shape: round;\n  background: #23a55a;\n  border-radius: 50%;\n  width: 10px;\n  height: 10px;\n  position: absolute;\n  bottom: -2px;\n  right: -2px;\n}\n\n.RqGPwG_offline .RqGPwG_presence {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.RqGPwG_memberText {\n  flex-direction: column;\n  min-width: 0;\n  display: flex;\n}\n\n.RqGPwG_memberName {\n  align-items: center;\n  gap: 6px;\n  display: flex;\n}\n\n.RqGPwG_memberStatus {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n@media (width <= 900px) {\n  .RqGPwG_page {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .RqGPwG_rooms, .RqGPwG_members {\n    display: none;\n  }\n}\n\n.RqGPwG_groupHead {\n  justify-content: space-between;\n  align-items: center;\n  padding-right: 4px;\n  display: flex;\n}\n\n.RqGPwG_iconButton {\n  border-radius: var(--dsw-radius-sm);\n  width: 22px;\n  height: 22px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  font-size: 16px;\n  line-height: 1;\n}\n\n.RqGPwG_iconButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_roomInput, .RqGPwG_fieldInput {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n  padding: 6px 8px;\n}\n\n.RqGPwG_roomInput {\n  margin: 2px 0 6px;\n}\n\n.RqGPwG_roomInput:focus-visible, .RqGPwG_fieldInput:focus-visible, .RqGPwG_iconButton:focus-visible, .RqGPwG_linkButton:focus-visible, .RqGPwG_addMemberButton:focus-visible, .RqGPwG_primaryButton:focus-visible, .RqGPwG_secondaryButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.RqGPwG_addMemberButton {\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  margin: 4px 0;\n  padding: 7px 8px;\n}\n\n.RqGPwG_addMemberButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_memberRow {\n  border-radius: var(--dsw-radius-sm);\n  align-items: center;\n  display: flex;\n  position: relative;\n}\n\n.RqGPwG_memberRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_memberRow .RqGPwG_member:hover {\n  background: none;\n}\n\n.RqGPwG_memberModel {\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  overflow: hidden;\n}\n\n.RqGPwG_memberActions {\n  color: var(--dsw-alias-label-tertiary);\n  opacity: 0;\n  flex: none;\n  gap: 4px;\n  padding-right: 6px;\n  font-size: 12px;\n  display: flex;\n}\n\n.RqGPwG_memberRow:hover .RqGPwG_memberActions, .RqGPwG_memberRow:focus-within .RqGPwG_memberActions {\n  opacity: 1;\n}\n\n.RqGPwG_linkButton {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 2px 4px;\n  font-size: 12px;\n}\n\n.RqGPwG_linkButton:hover {\n  color: var(--dsw-alias-label-primary);\n  text-decoration: underline;\n}\n\n.RqGPwG_dialogBackdrop {\n  z-index: 10;\n  background: #00000073;\n  place-items: center;\n  padding: 16px;\n  display: grid;\n  position: fixed;\n  inset: 0;\n}\n\n.RqGPwG_dialog {\n  border-radius: var(--dsw-radius-lg);\n  width: min(460px, 100%);\n  max-height: calc(100vh - 32px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  box-shadow: var(--dsw-elevation-panel, 0 12px 32px #0000004d);\n  flex-direction: column;\n  gap: 12px;\n  padding: 20px;\n  display: flex;\n  overflow-y: auto;\n}\n\n.RqGPwG_dialogTitle {\n  margin: 0;\n  font-size: 16px;\n}\n\n.RqGPwG_field {\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  gap: 4px;\n  font-size: 12px;\n  display: flex;\n}\n\n.RqGPwG_field textarea {\n  resize: vertical;\n}\n\n.RqGPwG_choiceRow {\n  flex-wrap: wrap;\n  gap: 12px;\n  display: flex;\n}\n\n.RqGPwG_choice {\n  color: var(--dsw-alias-label-primary, inherit);\n  cursor: pointer;\n  align-items: center;\n  gap: 4px;\n  font-size: 13px;\n  display: inline-flex;\n}\n\n.RqGPwG_dialogActions {\n  justify-content: flex-end;\n  gap: 8px;\n  display: flex;\n}\n\n.RqGPwG_primaryButton, .RqGPwG_secondaryButton {\n  border-radius: var(--dsw-radius-sm);\n  font: inherit;\n  cursor: pointer;\n  padding: 7px 14px;\n}\n\n.RqGPwG_primaryButton {\n  color: #fff;\n  background: var(--dsw-alias-state-business-primary);\n  border: 0;\n}\n\n.RqGPwG_primaryButton:disabled {\n  cursor: not-allowed;\n  opacity: .5;\n}\n\n.RqGPwG_secondaryButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-primary);\n  background: none;\n}\n\n.RqGPwG_memberFailed .RqGPwG_memberStatus {\n  color: var(--dsw-alias-state-error-primary, #ed4245);\n}\n\n.RqGPwG_memberFailed .RqGPwG_presence {\n  background: #ed4245;\n}\n\n.RqGPwG_mobileButton, .RqGPwG_drawerBackdrop {\n  display: none;\n}\n\n.RqGPwG_panelToggle {\n  border-radius: var(--dsw-radius-sm);\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  justify-content: center;\n  align-items: center;\n  font-size: 16px;\n  line-height: 1;\n  display: inline-flex;\n}\n\n.RqGPwG_panelToggle:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_panelToggle:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.RqGPwG_panelToggleEnd {\n  margin-left: auto;\n}\n\n@media (width >= 901px) {\n  .RqGPwG_page.RqGPwG_roomsHidden {\n    grid-template-columns: minmax(0, 1fr) 240px;\n  }\n\n  .RqGPwG_page.RqGPwG_membersHidden {\n    grid-template-columns: 220px minmax(0, 1fr);\n  }\n\n  .RqGPwG_page.RqGPwG_roomsHidden.RqGPwG_membersHidden {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .RqGPwG_roomsHidden > .RqGPwG_rooms, .RqGPwG_membersHidden > .RqGPwG_members {\n    display: none;\n  }\n}\n\n@media (width <= 900px) {\n  .RqGPwG_page {\n    position: relative;\n    overflow: hidden;\n  }\n\n  .RqGPwG_mobileButton {\n    min-width: 40px;\n    min-height: 40px;\n    color: inherit;\n    font: inherit;\n    cursor: pointer;\n    background: none;\n    border: 0;\n    border-radius: 6px;\n    justify-content: center;\n    align-items: center;\n    display: inline-flex;\n  }\n\n  .RqGPwG_mobileButton:last-child {\n    margin-left: auto;\n  }\n\n  .RqGPwG_panelToggle {\n    display: none;\n  }\n\n  .RqGPwG_drawerBackdrop {\n    z-index: 4;\n    background: #00000073;\n    border: 0;\n    display: block;\n    position: absolute;\n    inset: 0;\n  }\n\n  .RqGPwG_rooms.RqGPwG_drawerOpen, .RqGPwG_members.RqGPwG_drawerOpen {\n    z-index: 5;\n    box-sizing: border-box;\n    width: min(280px, 85%);\n    display: block;\n    position: absolute;\n    top: 0;\n    bottom: 0;\n    box-shadow: 0 0 24px #0000004d;\n  }\n\n  .RqGPwG_rooms.RqGPwG_drawerOpen {\n    left: 0;\n  }\n\n  .RqGPwG_members.RqGPwG_drawerOpen {\n    right: 0;\n  }\n\n  .RqGPwG_memberActions {\n    opacity: 1;\n  }\n\n  .RqGPwG_messageHead {\n    flex-wrap: wrap;\n  }\n}\n\n.RqGPwG_avatarPicker {\n  flex-wrap: wrap;\n  gap: 8px;\n  display: flex;\n}\n\n.RqGPwG_avatarOption {\n  cursor: pointer;\n  background: none;\n  border: 2px solid #0000;\n  border-radius: 50%;\n  padding: 2px;\n  display: grid;\n}\n\n.RqGPwG_avatarOption[aria-checked=\"true\"] {\n  border-color: var(--dsw-alias-accent, #5865f2);\n}\n\n.RqGPwG_taskBoard {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  margin-bottom: 8px;\n  padding-bottom: 8px;\n}\n\n.RqGPwG_taskList {\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n\n.RqGPwG_taskRow {\n  border-radius: var(--dsw-radius-sm);\n  padding: 6px 8px;\n}\n\n.RqGPwG_taskRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.RqGPwG_taskLine {\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n  display: flex;\n}\n\n.RqGPwG_taskTitle {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 13px;\n  overflow: hidden;\n}\n\n.RqGPwG_taskMeta {\n  color: var(--dsw-alias-label-tertiary);\n  flex-wrap: wrap;\n  gap: 0 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.RqGPwG_taskLinks {\n  gap: 8px;\n  display: flex;\n}\n\n.RqGPwG_taskEmpty {\n  color: var(--dsw-alias-label-tertiary);\n  margin: 0 8px;\n  font-size: 12px;\n}\n\n.RqGPwG_taskDone summary {\n  cursor: pointer;\n}\n\n.RqGPwG_taskStatus {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  flex: none;\n  padding: 0 4px;\n  font-size: 10px;\n  font-style: normal;\n  font-weight: 600;\n}\n\n.RqGPwG_taskStatus[data-status=\"asked\"], .RqGPwG_taskStatus[data-status=\"escalated\"], .RqGPwG_taskStatus[data-status=\"declined\"], .RqGPwG_taskStatus[data-status=\"rework\"] {\n  background: var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-error-primary));\n}\n\n.RqGPwG_taskStatus[data-status=\"done\"] {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.RqGPwG_taskCard {\n  margin-top: 4px;\n  font-style: normal;\n}\n\n.RqGPwG_taskMembers {\n  margin: 4px 0 0;\n  padding: 0;\n  list-style: none;\n}\n\n.RqGPwG_taskMember {\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n  display: flex;\n}\n\n.RqGPwG_taskMemberName {\n  font-weight: 600;\n}\n\n.RqGPwG_taskSub {\n  color: var(--dsw-alias-label-secondary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.RqGPwG_focused {\n  background: var(--dsw-alias-interactive-bg-hover);\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n}\n";document.head.appendChild(s)})();
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");
let react = require("react");
// src/client/unread.ts
const STORAGE_KEY_CURSORS = "bothouse:channel_read_cursors";
let memoryStorage$1;
function getStorage$1() {
	try {
		if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
		if (typeof localStorage !== "undefined") {
			localStorage.getItem("__test__");
			return localStorage;
		}
	} catch {}
	if (!memoryStorage$1) memoryStorage$1 = {};
	return {
		getItem: (k) => memoryStorage$1[k] ?? null,
		setItem: (k, v) => {
			memoryStorage$1[k] = v;
		}
	};
}
/** Load per-room read cursors from localStorage (room_id -> highest read message_id). */
function loadReadCursors() {
	const storage = getStorage$1();
	if (!storage) return {};
	try {
		const raw = storage.getItem(STORAGE_KEY_CURSORS);
		if (!raw) return {};
		return JSON.parse(raw);
	} catch {
		return {};
	}
}
/** Persist per-room read cursors to localStorage. */
function saveReadCursors(cursors) {
	const storage = getStorage$1();
	if (!storage) return;
	try {
		storage.setItem(STORAGE_KEY_CURSORS, JSON.stringify(cursors));
	} catch {}
}
/** Whether the current document is in the background or hidden. */
function isWindowBackground() {
	if (typeof document === "undefined") return false;
	return document.visibilityState === "hidden";
}
function escapeRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* Determine whether a message mentions the human owner or is an AI reply to the owner.
* Mirrored from mention rules and reply routing:
* 1. AI reply to a user message (`reply_to.author_kind === 'user'` or `reply_to.author === meId`);
* 2. @-mention in text addressing the user's name or id.
*/
function isMentionOrReply(msg, meId, members) {
	if (msg.author_kind === "user") return false;
	if (msg.reply_to !== void 0 && msg.reply_to.deleted !== true) {
		const q = msg.reply_to;
		if (q.author_kind === "user" || q.author === "owner" || meId !== void 0 && q.author === meId) return true;
	}
	const targetId = meId ?? "owner";
	const me = members.find((m) => m.id === targetId || m.kind === "human");
	const names = /* @__PURE__ */ new Set();
	names.add("owner");
	if (targetId) names.add(targetId);
	if (me?.name) names.add(me.name);
	const text = msg.text;
	for (const name of names) {
		if (!name) continue;
		const escaped = escapeRegExp(name);
		if (new RegExp(`(?:^|\\s|[<（(])@!?${escaped}(?:[>）)，,：:！!？?、～~\\s]|$)`, "i").test(text)) return true;
	}
	return false;
}
// src/client/notifications.ts
/**
* Desktop Notification API wrapper and preference persistence (#145).
*/
const STORAGE_KEY_NOTIFY = "bothouse:channel_notifications_enabled";
let memoryStorage;
function getStorage() {
	try {
		if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
		if (typeof localStorage !== "undefined") {
			localStorage.getItem("__test__");
			return localStorage;
		}
	} catch {}
	if (!memoryStorage) memoryStorage = {};
	return {
		getItem: (k) => memoryStorage[k] ?? null,
		setItem: (k, v) => {
			memoryStorage[k] = v;
		}
	};
}
/** Whether browser desktop notifications are supported in this environment. */
function isNotificationSupported() {
	return typeof window !== "undefined" && "Notification" in window || typeof Notification !== "undefined";
}
/** Load notification toggle preference (default: true). */
function loadNotificationPreference() {
	const storage = getStorage();
	if (!storage) return true;
	try {
		const val = storage.getItem(STORAGE_KEY_NOTIFY);
		return val === null ? true : val === "true";
	} catch {
		return true;
	}
}
/** Save notification toggle preference. */
function saveNotificationPreference(enabled) {
	const storage = getStorage();
	if (!storage) return;
	try {
		storage.setItem(STORAGE_KEY_NOTIFY, String(enabled));
	} catch {}
}
/** Request notification permission if not yet decided. */
async function requestNotificationPermission() {
	if (!isNotificationSupported()) return "unsupported";
	try {
		return await Notification.requestPermission();
	} catch {
		return Notification.permission;
	}
}
/**
* Dispatch a system notification if enabled and permitted.
*/
function notifyMessage(options) {
	if (!isNotificationSupported()) return void 0;
	if (typeof Notification === "undefined" || Notification.permission !== "granted") return void 0;
	if (!loadNotificationPreference()) return void 0;
	try {
		const n = new Notification(options.title, {
			body: options.body,
			tag: options.tag
		});
		if (options.onClick) n.onclick = () => {
			if (typeof window !== "undefined") window.focus?.();
			options.onClick?.();
			n.close();
		};
		return n;
	} catch {
		return;
	}
}
// src/client/channel-source.ts
/**
* Order rooms as chat channel, then its workspaces, in id order. A workspace whose
* chat channel is missing is shown at the top level so it stays reachable.
*/
function groupRooms(rooms) {
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
	tasks: [],
	taskChat: void 0,
	me: void 0,
	unread: {}
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
	const readCursors = loadReadCursors();
	let unreadState = {};
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
	const earlyTasks = /* @__PURE__ */ new Map();
	const newer = (a, b) => (a?.updated_at ?? -Infinity) <= b.updated_at;
	const applyEvent = (current, event) => {
		switch (event.type) {
			case "message": {
				const msg = event.message;
				const isCurrent = msg.room_id === current.roomId;
				const isBackground = isWindowBackground();
				if (!isCurrent) {
					const prev = unreadState[msg.room_id] ?? {
						count: 0,
						mention: false
					};
					const mention = prev.mention || isMentionOrReply(msg, current.me, current.members);
					const nextRoomUnread = {
						count: prev.count + 1,
						mention,
						firstUnreadId: prev.firstUnreadId ?? msg.id
					};
					unreadState = {
						...unreadState,
						[msg.room_id]: nextRoomUnread
					};
					if (msg.author_kind !== "user") notifyMessage({
						title: `#${current.rooms.find((r) => r.id === msg.room_id)?.name ?? String(msg.room_id)} - ${msg.name}`,
						body: msg.text.slice(0, 120),
						tag: `bothouse-room-${msg.room_id}`,
						onClick: () => {
							actions.selectRoom(msg.room_id);
						}
					});
					return {
						...current,
						unread: unreadState
					};
				}
				const rows = new Map(current.messages.map((m) => [m.id, m]));
				rows.set(msg.id, msg);
				const nextMessages = [...rows.values()].sort((a, b) => a.id - b.id);
				if (isBackground) {
					const prev = unreadState[msg.room_id] ?? {
						count: 0,
						mention: false
					};
					const mention = prev.mention || isMentionOrReply(msg, current.me, current.members);
					const nextRoomUnread = {
						count: prev.count + 1,
						mention,
						firstUnreadId: prev.firstUnreadId ?? msg.id
					};
					unreadState = {
						...unreadState,
						[msg.room_id]: nextRoomUnread
					};
					if (msg.author_kind !== "user") notifyMessage({
						title: `#${current.rooms.find((r) => r.id === msg.room_id)?.name ?? String(msg.room_id)} - ${msg.name}`,
						body: msg.text.slice(0, 120),
						tag: `bothouse-room-${msg.room_id}`,
						onClick: () => {
							actions.selectRoom(msg.room_id);
						}
					});
				} else {
					readCursors[msg.room_id] = Math.max(readCursors[msg.room_id] ?? 0, msg.id);
					saveReadCursors(readCursors);
					unreadState = {
						...unreadState,
						[msg.room_id]: {
							count: 0,
							mention: false
						}
					};
				}
				return {
					...current,
					messages: nextMessages,
					unread: unreadState
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
			case "rooms": return {
				...current,
				rooms: event.rooms
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
			const roomId = state.rooms.some((r) => r.id === previous.roomId) ? previous.roomId : state.rooms[0]?.id;
			const me = state.me ?? "owner";
			for (const r of state.rooms) if (r.id === roomId) {
				if (readCursors[r.id] === void 0 && r.last_message_id != null) {
					readCursors[r.id] = r.last_message_id;
					saveReadCursors(readCursors);
				}
				unreadState = {
					...unreadState,
					[r.id]: {
						count: 0,
						mention: false
					}
				};
			} else if (r.last_message_id != null && r.last_message_id > 0) {
				if (readCursors[r.id] === void 0) {
					readCursors[r.id] = 0;
					saveReadCursors(readCursors);
				}
				const c = readCursors[r.id] ?? 0;
				if (r.last_message_id > c) {
					const existing = unreadState[r.id];
					unreadState = {
						...unreadState,
						[r.id]: {
							count: Math.max(existing?.count ?? 0, r.last_message_id - c),
							mention: existing?.mention ?? false,
							firstUnreadId: existing?.firstUnreadId
						}
					};
				}
			}
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
			if (roomId !== void 0 && rows.length > 0) {
				const latestId = rows.at(-1).id;
				readCursors[roomId] = Math.max(readCursors[roomId] ?? 0, latestId);
				saveReadCursors(readCursors);
			}
			const keepBoard = roomId === previous.roomId;
			if (!keepBoard) earlyTasks.clear();
			let next = {
				phase: "ready",
				error: void 0,
				rooms: state.rooms,
				roomId,
				members: state.members,
				thinking: state.thinking,
				messages: rows,
				tasks: keepBoard ? previous.tasks : [],
				taskChat: keepBoard ? previous.taskChat : void 0,
				me,
				unread: unreadState
			};
			for (const event of read.events) next = applyEvent(next, event);
			pending = void 0;
			set(next);
			if (roomId !== void 0) loadBoard(owner, roomId);
		} catch (error) {
			if (!current()) return;
			pending = void 0;
			fail(error);
		}
	};
	const selectRoom = async (roomId) => {
		if (roomId !== snapshot.roomId) earlyTasks.clear();
		unreadState = {
			...unreadState,
			[roomId]: {
				count: 0,
				mention: false
			}
		};
		set(roomId === snapshot.roomId ? {
			roomId,
			messages: [],
			unread: unreadState
		} : {
			roomId,
			messages: [],
			tasks: [],
			taskChat: void 0,
			unread: unreadState
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
	const actions = {
		selectRoom,
		async send(text, replyTo) {
			const roomId = snapshot.roomId;
			const owner = lifetime;
			if (roomId === void 0 || owner === void 0) throw new Error("No channel is open");
			const { message } = await request(`collab/api/rooms/${roomId}/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(replyTo === void 0 ? {
					text,
					client_key: crypto.randomUUID()
				} : {
					text,
					client_key: crypto.randomUUID(),
					reply_to: replyTo
				})
			});
			if (lifetime === owner) onEvent({
				type: "message",
				message
			});
		},
		async createRoom(name) {
			const { room, workspace } = await request("collab/api/rooms", json("POST", { name }));
			const added = [room, workspace].filter((r) => r !== void 0 && !snapshot.rooms.some((s) => s.id === r.id));
			if (added.length > 0) set({ rooms: [...snapshot.rooms, ...added] });
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
		},
		async decidePermission(messageId, decision) {
			const owner = lifetime;
			const { message } = await request(`collab/api/messages/${messageId}/permission`, json("POST", { decision }));
			if (lifetime === owner) onEvent({
				type: "message",
				message
			});
		}
	};
	return {
		source,
		actions,
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
	rework: "taskRework"
};
/** Board order: the owner's turn first (tasks.mjs WORKING), then waiting for the lead, then finished. */
const GROUPS = [
	[
		"assigned",
		"accepted",
		"asked",
		"rework"
	],
	[
		"returned",
		"declined",
		"escalated"
	],
	["done"]
];
const groupOf = (status) => GROUPS.findIndex((g) => g.includes(status));
/** Board rows, grouped as above and newest first inside a group. */
function boardOrder(tasks) {
	return [...tasks].sort((a, b) => groupOf(a.status) - groupOf(b.status) || b.id - a.id);
}
/** Seconds a task has taken: until hand-back, until it closed, or until now. */
function elapsed(task, now) {
	const end = task.returned_at ?? (task.status === "done" ? task.updated_at : now);
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
/** Board sections: open tasks (owner's turn, then waiting for the lead) and finished ones. */
function boardGroups(tasks) {
	const rows = boardOrder(tasks);
	return {
		open: rows.filter((task) => task.status !== "done"),
		done: rows.filter((task) => task.status === "done")
	};
}
/** Task-card rows: the task's owner first, then each sub-task in dispatch order. */
function cardMembers(taskId, tasks) {
	const task = tasks.find((x) => x.id === taskId);
	if (task === void 0) return [];
	return [task, ...tasks.filter((x) => x.parent_task === task.id).sort((a, b) => a.id - b.id)];
}
// src/client/ChannelsPage.module.css
var ChannelsPage_module_default = {
	"activeBusy": "RqGPwG_activeBusy",
	"activeCount": "RqGPwG_activeCount",
	"addMemberButton": "RqGPwG_addMemberButton",
	"author": "RqGPwG_author",
	"avatar": "RqGPwG_avatar",
	"avatarAnchor": "RqGPwG_avatarAnchor",
	"avatarButton": "RqGPwG_avatarButton",
	"avatarImage": "RqGPwG_avatarImage",
	"avatarMenu": "RqGPwG_avatarMenu",
	"avatarMenuItem": "RqGPwG_avatarMenuItem",
	"avatarMenuTitle": "RqGPwG_avatarMenuTitle",
	"avatarOption": "RqGPwG_avatarOption",
	"avatarPicker": "RqGPwG_avatarPicker",
	"avatarSmall": "RqGPwG_avatarSmall",
	"card": "RqGPwG_card",
	"cardTitle": "RqGPwG_cardTitle",
	"chat": "RqGPwG_chat",
	"chatHead": "RqGPwG_chatHead",
	"choice": "RqGPwG_choice",
	"choiceRow": "RqGPwG_choiceRow",
	"composer": "RqGPwG_composer",
	"composerRow": "RqGPwG_composerRow",
	"dialog": "RqGPwG_dialog",
	"dialogActions": "RqGPwG_dialogActions",
	"dialogBackdrop": "RqGPwG_dialogBackdrop",
	"dialogTitle": "RqGPwG_dialogTitle",
	"drawerBackdrop": "RqGPwG_drawerBackdrop",
	"drawerOpen": "RqGPwG_drawerOpen",
	"empty": "RqGPwG_empty",
	"field": "RqGPwG_field",
	"fieldInput": "RqGPwG_fieldInput",
	"focused": "RqGPwG_focused",
	"groupHead": "RqGPwG_groupHead",
	"groupTitle": "RqGPwG_groupTitle",
	"guide": "RqGPwG_guide",
	"hash": "RqGPwG_hash",
	"iconButton": "RqGPwG_iconButton",
	"input": "RqGPwG_input",
	"linkButton": "RqGPwG_linkButton",
	"log": "RqGPwG_log",
	"member": "RqGPwG_member",
	"memberActions": "RqGPwG_memberActions",
	"memberAvatar": "RqGPwG_memberAvatar",
	"memberFailed": "RqGPwG_memberFailed",
	"memberModel": "RqGPwG_memberModel",
	"memberName": "RqGPwG_memberName",
	"memberRow": "RqGPwG_memberRow",
	"members": "RqGPwG_members",
	"membersHidden": "RqGPwG_membersHidden",
	"memberStatus": "RqGPwG_memberStatus",
	"memberText": "RqGPwG_memberText",
	"mentionActive": "RqGPwG_mentionActive",
	"mentionButton": "RqGPwG_mentionButton",
	"mentionHint": "RqGPwG_mentionHint",
	"mentionItem": "RqGPwG_mentionItem",
	"mentionMeta": "RqGPwG_mentionMeta",
	"mentionName": "RqGPwG_mentionName",
	"mentionPopup": "RqGPwG_mentionPopup",
	"mentionTitle": "RqGPwG_mentionTitle",
	"message": "RqGPwG_message",
	"messageBody": "RqGPwG_messageBody",
	"messageHead": "RqGPwG_messageHead",
	"mobileButton": "RqGPwG_mobileButton",
	"notice": "RqGPwG_notice",
	"notifyOff": "RqGPwG_notifyOff",
	"notifyOn": "RqGPwG_notifyOn",
	"notifyToggle": "RqGPwG_notifyToggle",
	"offline": "RqGPwG_offline",
	"page": "RqGPwG_page",
	"panelToggle": "RqGPwG_panelToggle",
	"panelToggleEnd": "RqGPwG_panelToggleEnd",
	"permActions": "RqGPwG_permActions",
	"permScope": "RqGPwG_permScope",
	"permStatus": "RqGPwG_permStatus",
	"presence": "RqGPwG_presence",
	"primaryButton": "RqGPwG_primaryButton",
	"quote": "RqGPwG_quote",
	"quoteAuthor": "RqGPwG_quoteAuthor",
	"quoteDeleted": "RqGPwG_quoteDeleted",
	"replyBar": "RqGPwG_replyBar",
	"replyBarText": "RqGPwG_replyBarText",
	"replyButton": "RqGPwG_replyButton",
	"replyCancel": "RqGPwG_replyCancel",
	"room": "RqGPwG_room",
	"roomActive": "RqGPwG_roomActive",
	"roomInput": "RqGPwG_roomInput",
	"roomLabel": "RqGPwG_roomLabel",
	"roomMention": "RqGPwG_roomMention",
	"rooms": "RqGPwG_rooms",
	"roomsHidden": "RqGPwG_roomsHidden",
	"roomUnread": "RqGPwG_roomUnread",
	"secondaryButton": "RqGPwG_secondaryButton",
	"sendError": "RqGPwG_sendError",
	"system": "RqGPwG_system",
	"tag": "RqGPwG_tag",
	"taskBoard": "RqGPwG_taskBoard",
	"taskCard": "RqGPwG_taskCard",
	"taskDone": "RqGPwG_taskDone",
	"taskEmpty": "RqGPwG_taskEmpty",
	"taskLine": "RqGPwG_taskLine",
	"taskLinks": "RqGPwG_taskLinks",
	"taskList": "RqGPwG_taskList",
	"taskMember": "RqGPwG_taskMember",
	"taskMemberName": "RqGPwG_taskMemberName",
	"taskMembers": "RqGPwG_taskMembers",
	"taskMeta": "RqGPwG_taskMeta",
	"taskRow": "RqGPwG_taskRow",
	"taskStatus": "RqGPwG_taskStatus",
	"taskSub": "RqGPwG_taskSub",
	"taskTitle": "RqGPwG_taskTitle",
	"text": "RqGPwG_text",
	"time": "RqGPwG_time",
	"unreadBadge": "RqGPwG_unreadBadge",
	"unreadDivider": "RqGPwG_unreadDivider",
	"unreadDividerLabel": "RqGPwG_unreadDividerLabel",
	"unreadMention": "RqGPwG_unreadMention",
	"working": "RqGPwG_working",
	"workspace": "RqGPwG_workspace"
};
// src/client/TaskBoard.tsx
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
function TaskBoard({ tasks, rooms, chatId, t, onOpen }) {
	const now = Date.now() / 1e3;
	const names = new Map(rooms.map((r) => [r.id, r.name]));
	const { open, done } = boardGroups(tasks);
	const total = open.length + done.length;
	const row = (task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		className: ChannelsPage_module_default.taskRow,
		"data-task-id": task.id,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.taskLine,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Status, {
					status: task.status,
					t
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: ChannelsPage_module_default.taskTitle,
					children: [
						"#",
						task.id,
						" ",
						task.title
					]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.taskMeta,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: task.owner_name }),
					task.room_id !== chatId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskIn", { room: names.get(task.room_id) ?? String(task.room_id) }) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskElapsed", { d: formatDuration(elapsed(task, now), t) }) }),
					task.next_check_at !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskNextCheck", { time: clock(task.next_check_at) }) })
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.taskLinks,
				children: [task.assign_msg_id !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ChannelsPage_module_default.linkButton,
					onClick: () => {
						onOpen(task.room_id, task.assign_msg_id);
					},
					children: t("taskOpenAssign")
				}), task.result_msg_id !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ChannelsPage_module_default.linkButton,
					onClick: () => {
						onOpen(task.room_id, task.result_msg_id);
					},
					children: t("taskOpenResult")
				})]
			})
		]
	}, task.id);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: ChannelsPage_module_default.taskBoard,
		"aria-label": t("taskBoard"),
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
				className: ChannelsPage_module_default.groupTitle,
				children: t("taskBoardTitle", { count: String(open.length) })
			}),
			total === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.taskEmpty,
				children: t("taskBoardEmpty")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: ChannelsPage_module_default.taskList,
				children: open.map(row)
			}),
			done.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: ChannelsPage_module_default.taskDone,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
					className: ChannelsPage_module_default.groupTitle,
					children: t("taskDoneGroup", { count: String(done.length) })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: ChannelsPage_module_default.taskList,
					children: done.map(row)
				})]
			})
		]
	});
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Status, {
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
// src/client/avatars.ts
/**
* Built-in member avatars served by the collab plugin at `collab/avatars/<slug>.png`:
* the five original character portraits (user 2026-10-23: 「我还是保留原本那个」).
*/
const AVATARS = [
	"orange",
	"whale",
	"dragon",
	"rainbow",
	"lanxi"
];
/**
* Image source for a member avatar.
* @param avatar - built-in slug, http(s) URL announced by a bot, or empty.
* @returns a URL relative to the document base, the absolute URL, or undefined for the initial badge.
*/
function avatarSrc(avatar) {
	if (avatar === void 0 || avatar === "") return void 0;
	if (/^https?:\/\//.test(avatar)) return avatar;
	return AVATARS.includes(avatar) ? `collab/avatars/${avatar}.png` : void 0;
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
function Avatar({ id, name, avatar, small }) {
	const src = avatarSrc(avatar);
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
	const [type, setType] = (0, react.useState)(member?.cli !== void 0 ? "cli" : "dsh");
	const [clis, setClis] = (0, react.useState)(void 0);
	const [cli, setCli] = (0, react.useState)(member?.cli ?? "");
	const [avatar, setAvatar] = (0, react.useState)(member?.avatar !== void 0 && AVATARS.includes(member.avatar) ? member.avatar : "");
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
			avatar,
			cli
		} : {
			name: name.trim(),
			persona,
			avatar,
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
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.field,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						id: "member-avatar-label",
						children: t("memberAvatar")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ChannelsPage_module_default.avatarPicker,
						role: "radiogroup",
						"aria-labelledby": "member-avatar-label",
						children: ["", ...AVATARS].map((slug) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "radio",
							"aria-checked": avatar === slug,
							className: ChannelsPage_module_default.avatarOption,
							title: slug === "" ? t("memberAvatarNone") : slug,
							onClick: () => {
								setAvatar(slug);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
								id: member?.id ?? (name.trim() || "new"),
								name: name.trim() || "?",
								avatar: slug
							})
						}, slug === "" ? "none" : slug))
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
// src/client/BellIcon.tsx
/**
* Bell icon indicating notification toggle state (#145).
*/
function BellIcon({ enabled }) {
	if (enabled) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
		width: "18",
		height: "18",
		viewBox: "0 0 24 24",
		fill: "currentColor",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" })
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
		width: "18",
		height: "18",
		viewBox: "0 0 24 24",
		fill: "currentColor",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 18.69L7.84 6.53 4.27 2.96 3 4.23l2.84 2.84C5.33 8.16 5 9.54 5 11v5l-2 2v1h15.46l2.31 2.31 1.27-1.27L20 18.69zM7 17v-6c0-.77.16-1.51.44-2.18l8.18 8.18H7zm5 5c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6.5-6.32V11c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.76.18-1.46.49-2.09.89l1.45 1.45C11 7.02 11.48 7 12 7c2.49 0 4.5 2.01 4.5 4.5v3.88l2 2z" })
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
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.permActions,
		children: [
			card.actions.map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: a.decision === "deny" ? ChannelsPage_module_default.secondaryButton : ChannelsPage_module_default.primaryButton,
				disabled: busy,
				onClick: () => {
					decide(a.decision);
				},
				children: a.label
			}, a.decision)),
			card.actions.some((a) => a.decision === "allow_all") && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.permScope,
				children: t("permAllowAllScope")
			}),
			error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.sendError,
				role: "alert",
				children: error
			})
		]
	});
}
// src/client/ChannelsPage.tsx
/**
* Channels main panel: room list, message stream with composer, and member
* list, in a Discord-style three-column layout. All data arrives through the
* injected `useChannels` hook; posting goes through the injected actions.
*/
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
/** The quoted original above a reply; a deleted original shows only a placeholder. */
function Quote({ quote, t }) {
	if (quote.deleted === true) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: `${ChannelsPage_module_default.quote} ${ChannelsPage_module_default.quoteDeleted}`,
		children: t("replyDeleted")
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: ChannelsPage_module_default.quote,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: ChannelsPage_module_default.quoteAuthor,
			children: quote.name
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: quote.text })]
	});
}
function MessageRow({ message, member, t, onConfigure, menuOpen, onAvatar, onCloseMenu, onMention, onDecide, onReply, tasks, focused }) {
	let card;
	if (message.card !== null) try {
		card = JSON.parse(message.card);
	} catch (error) {}
	const classes = [
		ChannelsPage_module_default.message,
		message.author_kind === "system" ? ChannelsPage_module_default.system : "",
		focused ? ChannelsPage_module_default.focused : ""
	].filter(Boolean).join(" ");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: classes,
		"data-message-id": message.id,
		children: [
			member === void 0 || message.author_kind === "system" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
				id: message.author,
				name: message.name,
				avatar: member?.avatar
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
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
						id: member.id,
						name: message.name,
						avatar: member.avatar
					})
				}), menuOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.avatarMenu,
					role: "menu",
					"aria-label": t("memberMenu", { name: member.name }),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.avatarMenuTitle,
						children: member.name
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "menuitem",
						className: ChannelsPage_module_default.avatarMenuItem,
						onClick: () => {
							onMention(member);
						},
						children: t("avatarMention")
					})]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.messageBody,
				children: [
					message.reply_to !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Quote, {
						quote: message.reply_to,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					}),
					card === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.text,
						children: message.text
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.card,
						"data-state": card.state,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ChannelsPage_module_default.cardTitle,
								children: card.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ChannelsPage_module_default.text,
								children: message.text
							}),
							card.action === "configure-model" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ChannelsPage_module_default.secondaryButton,
								onClick: onConfigure,
								children: t("configureModel")
							}),
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
					})
				]
			}),
			message.author_kind !== "system" && card === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: ChannelsPage_module_default.replyButton,
				title: t("reply"),
				"aria-label": t("reply"),
				onClick: () => {
					onReply(message);
				},
				children: "↩"
			})
		]
	});
}
function MemberGroup({ title, members, busy, onPick, onEdit, onRemove, t }) {
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
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: ChannelsPage_module_default.memberAvatar,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Avatar, {
					id: m.id,
					name: m.name,
					avatar: m.avatar,
					small: true
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: m.error ? `${ChannelsPage_module_default.presence} ${ChannelsPage_module_default.errorPresence}` : ChannelsPage_module_default.presence })]
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
						children: m.error ? t("memberFailed") : busy.has(m.id) ? t("working") : m.online ? t("online") : t("offline")
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
function ChannelsPage({ useChannels, selectRoom, send, createRoom, listModels, listClis, addMember, updateMember, removeMember, decidePermission, renderSlot, t }) {
	const state = useChannels((snapshot) => snapshot);
	const [drafts, setDrafts] = (0, react.useState)({});
	const [errors, setErrors] = (0, react.useState)({});
	const [sending, setSending] = (0, react.useState)({});
	const [replies, setReplies] = (0, react.useState)({});
	const pendingRooms = (0, react.useRef)(/* @__PURE__ */ new Set());
	const draft = state.roomId === void 0 ? "" : drafts[state.roomId] ?? "";
	const sendError = state.roomId === void 0 ? void 0 : errors[state.roomId];
	const replying = state.roomId === void 0 ? void 0 : replies[state.roomId];
	const logRef = (0, react.useRef)(null);
	const stickRef = (0, react.useRef)(true);
	const inputRef = (0, react.useRef)(null);
	const [caret, setCaret] = (0, react.useState)(0);
	const [dismissedAt, setDismissedAt] = (0, react.useState)(void 0);
	const [highlight, setHighlight] = (0, react.useState)(0);
	const pendingCaret = (0, react.useRef)(void 0);
	const [dialog, setDialog] = (0, react.useState)(void 0);
	const [modelsOpen, setModelsOpen] = (0, react.useState)(false);
	const [drawer, setDrawer] = (0, react.useState)(void 0);
	const [roomsHidden, setRoomsHidden] = (0, react.useState)(false);
	const [membersHidden, setMembersHidden] = (0, react.useState)(false);
	const [newRoom, setNewRoom] = (0, react.useState)(void 0);
	const [roomError, setRoomError] = (0, react.useState)(void 0);
	const [memberError, setMemberError] = (0, react.useState)(void 0);
	const [notificationsEnabled, setNotificationsEnabled] = (0, react.useState)(() => loadNotificationPreference());
	const [firstUnreadPerRoom, setFirstUnreadPerRoom] = (0, react.useState)({});
	const unreadDividerRef = (0, react.useRef)(null);
	const hasScrolledUnread = (0, react.useRef)({});
	const toggleNotifications = async () => {
		if (!notificationsEnabled) {
			if (isNotificationSupported()) {
				if (await requestNotificationPermission() === "denied") {
					alert(t("notificationsBlocked"));
					return;
				}
			}
			setNotificationsEnabled(true);
			saveNotificationPreference(true);
		} else {
			setNotificationsEnabled(false);
			saveNotificationPreference(false);
		}
	};
	(0, react.useEffect)(() => {
		const roomId = state.roomId;
		if (roomId === void 0) return;
		const unread = state.unread?.[roomId];
		if (unread?.firstUnreadId !== void 0 && firstUnreadPerRoom[roomId] === void 0) setFirstUnreadPerRoom((prev) => ({
			...prev,
			[roomId]: unread.firstUnreadId
		}));
	}, [
		state.roomId,
		state.unread,
		firstUnreadPerRoom
	]);
	(0, react.useEffect)(() => {
		const roomId = state.roomId;
		if (roomId === void 0) return;
		if (!hasScrolledUnread.current[roomId] && unreadDividerRef.current) {
			hasScrolledUnread.current[roomId] = true;
			stickRef.current = false;
			unreadDividerRef.current.scrollIntoView({ block: "start" });
		}
	}, [state.roomId, state.messages]);
	const composerRef = (0, react.useRef)(null);
	const openMentionAt = (0, react.useRef)(void 0);
	(0, react.useEffect)(() => {
		const onPress = (event) => {
			const at = openMentionAt.current;
			if (at === void 0 || composerRef.current?.contains(event.target) === true) return;
			setDismissedAt(at);
		};
		document.addEventListener("mousedown", onPress);
		return () => {
			document.removeEventListener("mousedown", onPress);
		};
	}, []);
	(0, react.useEffect)(() => {
		const input = inputRef.current;
		const next = pendingCaret.current;
		if (input === null || next === void 0) return;
		pendingCaret.current = void 0;
		input.focus();
		input.setSelectionRange(next, next);
	});
	const [avatarMenu, setAvatarMenu] = (0, react.useState)(void 0);
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
	(0, react.useEffect)(() => {
		const log = logRef.current;
		if (log !== null && stickRef.current) log.scrollTop = log.scrollHeight;
	}, [state.messages, state.roomId]);
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
	const openMessage = (roomId, messageId) => {
		setDrawer(void 0);
		setJump({
			roomId,
			messageId
		});
		if (roomId !== state.roomId) selectRoom(roomId);
	};
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
	openMentionAt.current = popupOpen ? mention.start : void 0;
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
		setDrawer(void 0);
		const next = insertMention(draft, caret, member);
		setDraft(next.text, next.caret);
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
		const replyTo = replies[roomId]?.id;
		(replyTo === void 0 ? send(text) : send(text, replyTo)).then(() => {
			setDrafts((previous) => ({
				...previous,
				[roomId]: ""
			}));
			setReplies((previous) => ({
				...previous,
				[roomId]: void 0
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
		className: [
			ChannelsPage_module_default.page,
			roomsHidden ? ChannelsPage_module_default.roomsHidden : "",
			membersHidden ? ChannelsPage_module_default.membersHidden : ""
		].filter(Boolean).join(" "),
		onKeyDown: (event) => {
			if (event.key === "Escape") setDrawer(void 0);
		},
		children: [
			drawer !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				className: ChannelsPage_module_default.drawerBackdrop,
				"aria-label": t("closeDrawer"),
				onClick: () => setDrawer(void 0)
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
				className: drawer === "rooms" ? `${ChannelsPage_module_default.rooms} ${ChannelsPage_module_default.drawerOpen}` : ChannelsPage_module_default.rooms,
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
					groupRooms(state.rooms).map(({ room: r, depth }) => {
						const active = r.active ?? 0;
						const showActive = depth === 1 || r.kind === "workspace" || active > 0;
						const roomUnread = state.unread?.[r.id];
						const hasUnread = roomUnread !== void 0 && roomUnread.count > 0 && r.id !== state.roomId;
						const isMention = hasUnread && roomUnread.mention;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: [
								ChannelsPage_module_default.room,
								depth === 1 ? ChannelsPage_module_default.workspace : "",
								r.id === state.roomId ? ChannelsPage_module_default.roomActive : "",
								hasUnread ? ChannelsPage_module_default.roomUnread : "",
								isMention ? ChannelsPage_module_default.roomMention : ""
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
								showActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: active > 0 ? `${ChannelsPage_module_default.activeCount} ${ChannelsPage_module_default.activeBusy}` : ChannelsPage_module_default.activeCount,
									children: t("activeTasks", { count: active })
								}),
								hasUnread && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: [ChannelsPage_module_default.unreadBadge, isMention ? ChannelsPage_module_default.unreadMention : ""].filter(Boolean).join(" "),
									title: isMention ? t("unreadMentionCount", { count: roomUnread.count }) : t("unreadCount", { count: roomUnread.count }),
									"aria-label": isMention ? t("unreadMentionCount", { count: roomUnread.count }) : t("unreadCount", { count: roomUnread.count }),
									children: isMention ? `@ ${roomUnread.count}` : roomUnread.count
								})
							]
						}, r.id);
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: ChannelsPage_module_default.chat,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ChannelsPage_module_default.chatHead,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
								children: "#"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.roomName,
								children: room?.name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: [ChannelsPage_module_default.notifyToggle, notificationsEnabled ? ChannelsPage_module_default.notifyOn : ChannelsPage_module_default.notifyOff].join(" "),
								title: t(notificationsEnabled ? "notificationsDisable" : "notificationsEnable"),
								"aria-label": t(notificationsEnabled ? "notificationsDisable" : "notificationsEnable"),
								"aria-pressed": notificationsEnabled,
								onClick: () => {
									toggleNotifications();
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BellIcon, { enabled: notificationsEnabled })
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
								type: "button",
								className: ChannelsPage_module_default.mobileButton,
								"aria-label": t("showMembers"),
								"aria-expanded": drawer === "members",
								onClick: () => setDrawer(drawer === "members" ? void 0 : "members"),
								children: t("membersButton")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						ref: logRef,
						className: ChannelsPage_module_default.log,
						role: "log",
						"aria-live": "polite",
						onScroll: (event) => {
							const el = event.currentTarget;
							stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
						},
						children: [!state.members.some((m) => m.kind !== "human") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: ChannelsPage_module_default.guide,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("guideNoMembers") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ChannelsPage_module_default.primaryButton,
								onClick: () => {
									setDialog(null);
								},
								children: t("addMember")
							})]
						}), state.messages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.empty,
							children: t("empty")
						}) : state.messages.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [state.roomId !== void 0 && firstUnreadPerRoom[state.roomId] === m.id && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.unreadDivider,
							ref: unreadDividerRef,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.unreadDividerLabel,
								children: t("unreadDivider")
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageRow, {
							message: m,
							member: byId.get(m.author),
							t,
							onConfigure: () => {
								setModelsOpen(true);
							},
							menuOpen: avatarMenu === m.id,
							onAvatar: () => {
								setAvatarMenu(avatarMenu === m.id ? void 0 : m.id);
							},
							onCloseMenu: () => {
								setAvatarMenu(void 0);
							},
							onMention: mentionFromAvatar,
							onDecide: decidePermission,
							tasks: state.tasks ?? [],
							focused: focusedId === m.id,
							onReply: startReply
						})] }, m.id))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.working,
						"aria-live": "polite",
						children: busyNames.length > 0 ? t("workingList", { names: busyNames.join("、") }) : ""
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.composer,
						ref: composerRef,
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
														avatar: m.avatar,
														small: true
													}), m.online && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: m.error ? `${ChannelsPage_module_default.presence} ${ChannelsPage_module_default.errorPresence}` : ChannelsPage_module_default.presence })]
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
				className: drawer === "members" ? `${ChannelsPage_module_default.members} ${ChannelsPage_module_default.drawerOpen}` : ChannelsPage_module_default.members,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskBoard, {
						tasks: state.tasks ?? [],
						rooms: state.rooms,
						chatId: state.taskChat,
						t,
						onOpen: openMessage
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
					}), renderSlot("settings.section", { close: () => {
						setModelsOpen(false);
					} }, { only: "models" })]
				})
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
	taskBoard: "任务板",
	taskBoardTitle: "任务板 — 进行中 {count}",
	taskBoardEmpty: "还没有派出的任务",
	taskDoneGroup: "已完成 — {count}",
	taskAssigned: "派出",
	taskAccepted: "已接",
	taskAsked: "有疑问",
	taskDeclined: "退回",
	taskEscalated: "升级",
	taskReturned: "交回",
	taskDone: "完成",
	taskRework: "返工",
	taskIn: "在 #{room}",
	taskElapsed: "用时 {d}",
	taskNextCheck: "下次看 {time}",
	taskOpenAssign: "派工消息",
	taskOpenResult: "交回消息",
	durSeconds: "{n} 秒",
	durMinutes: "{n} 分钟",
	durHours: "{h} 小时 {m} 分",
	configureModel: "去配置模型",
	permAllowed: "已允许",
	permDenied: "已拒绝",
	permAllowedAll: "已允许（本会话后续请求自动允许）",
	permExpired: "已过期：这个请求已被新请求取代或 bot 已重启，不再生效",
	permByText: "（文字回复）",
	permAllowAllScope: "「允许所有」只对这个 bot 当前会话生效：之后它的工具权限请求自动允许（向你提问的除外），bot 重启或开新会话后恢复逐条询问。",
	memberFailed: "出错",
	showRooms: "打开频道列表",
	showMembers: "打开成员列表",
	closeDrawer: "关闭列表",
	membersButton: "成员",
	collapseRooms: "收起频道列表",
	expandRooms: "展开频道列表",
	collapseMembers: "收起成员列表",
	expandMembers: "展开成员列表",
	rooms: "文字频道",
	agents: "Agent — {count}",
	humans: "真人 — {count}",
	online: "在线",
	close: "关闭",
	offline: "离线",
	working: "忙",
	workingList: "{names} 正在输入…",
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
	guideNoMembers: "频道里还没有角色成员。添加一个：用 DSH 里已配好的模型，或本机已装的 CLI（Claude Code、Codex、Gemini）。",
	sendFailed: "发送失败：{message}",
	mentionTitle: "可以 @ 的成员",
	mentionTitleQuery: "匹配「{query}」的成员",
	mentionHint: "↑↓ 选择 · Enter / Tab 确认 · Esc 关闭",
	mentionButton: "@ 一个成员",
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
	memberAvatar: "头像",
	memberAvatarNone: "不用头像（显示首字）",
	save: "保存",
	cancel: "取消",
	configMember: "来自配置文件，网页里不能修改",
	defaultModel: "默认模型",
	reply: "回复",
	replyingTo: "回复 {name}",
	replyDeleted: "原消息已删除",
	cancelReply: "取消回复",
	notificationsEnable: "开启桌面通知",
	notificationsDisable: "关闭桌面通知",
	notificationsBlocked: "通知已被浏览器拦截，请在浏览器权限设置中允许",
	unreadDivider: "以下是新消息",
	unreadCount: "{count} 条未读",
	unreadMentionCount: "@ {count} 条提及"
};
/** English dictionary. */
const en = {
	taskBoard: "Task board",
	taskBoardTitle: "Tasks — {count} in progress",
	taskBoardEmpty: "No tasks dispatched yet",
	taskDoneGroup: "Done — {count}",
	taskAssigned: "Assigned",
	taskAccepted: "Accepted",
	taskAsked: "Question",
	taskDeclined: "Declined",
	taskEscalated: "Escalated",
	taskReturned: "Handed back",
	taskDone: "Done",
	taskRework: "Rework",
	taskIn: "in #{room}",
	taskElapsed: "took {d}",
	taskNextCheck: "next check {time}",
	taskOpenAssign: "Dispatch",
	taskOpenResult: "Delivery",
	durSeconds: "{n}s",
	durMinutes: "{n} min",
	durHours: "{h} h {m} min",
	panel: "Channels",
	configureModel: "Configure model",
	permAllowed: "Allowed",
	permDenied: "Denied",
	permAllowedAll: "Allowed (later requests in this session are auto-approved)",
	permExpired: "Expired: replaced by a newer request or the bot restarted",
	permByText: "(text reply)",
	permAllowAllScope: "\"Allow all\" applies only to this bot's current session: its later tool permission requests are auto-approved (questions to you excepted) until the bot restarts or starts a new session.",
	memberFailed: "Error",
	showRooms: "Open channels",
	showMembers: "Open members",
	closeDrawer: "Close list",
	membersButton: "Members",
	collapseRooms: "Collapse channels",
	expandRooms: "Expand channels",
	collapseMembers: "Collapse members",
	expandMembers: "Expand members",
	rooms: "Text channels",
	agents: "Agents — {count}",
	humans: "People — {count}",
	online: "Online",
	close: "Close",
	offline: "Offline",
	working: "Busy",
	workingList: "{names} typing…",
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
	guideNoMembers: "No role members in this channel yet. Add one using a model configured in DSH, or a CLI installed on this machine (Claude Code, Codex, Gemini).",
	sendFailed: "Send failed: {message}",
	mentionTitle: "Members you can mention",
	mentionTitleQuery: "Members matching \"{query}\"",
	mentionHint: "↑↓ select · Enter / Tab confirm · Esc close",
	mentionButton: "Mention a member",
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
	memberAvatar: "Avatar",
	memberAvatarNone: "No avatar (show initial)",
	save: "Save",
	cancel: "Cancel",
	configMember: "From the config file; not editable here",
	defaultModel: "Default model",
	reply: "Reply",
	replyingTo: "Replying to {name}",
	replyDeleted: "Original message was deleted",
	cancelReply: "Cancel reply",
	notificationsEnable: "Enable desktop notifications",
	notificationsDisable: "Disable desktop notifications",
	notificationsBlocked: "Notifications blocked by browser permissions",
	unreadDivider: "New Messages",
	unreadCount: "{count} unread",
	unreadMentionCount: "@ {count} mentions"
};
// src/client/index.ts
const PANEL_ID = "channels";
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
		removeMember: channels.actions.removeMember,
		decidePermission: channels.actions.decidePermission
	});
	ctx.slots.inject("main", () => {
		const dispose = ctx.slots.register({
			name: "main",
			key: PANEL_ID,
			locale: NS,
			inject: injected,
			children: { "settings.section": {
				kind: "list",
				scope: "root"
			} }
		}, ChannelsPage);
		if (location.hash === `#${PANEL_ID}`) ctx.layout.selectPanel(PANEL_ID);
		return dispose;
	});
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
