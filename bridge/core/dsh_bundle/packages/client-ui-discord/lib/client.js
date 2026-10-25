window.__ModuleLoader__.load({
 id: "@deepseek-ai/dsh-experimental-client-ui-discord",
 factory: (require) => {
 var module = { exports: {} };
 var exports = module.exports;
(function(){var s=document.createElement('style');s.setAttribute('data-dsh-plugin',"dsh-experimental-client-ui-discord");s.textContent=".bKAdKG_page {\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n  padding-top: var(--dsh-frame-top-clearance, 0px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  grid-template-columns: 220px minmax(0, 1fr) 240px;\n  font-size: 14px;\n  line-height: 1.5;\n  display: grid;\n}\n\n.bKAdKG_notice {\n  max-width: 480px;\n  color: var(--dsw-alias-label-secondary);\n  text-align: center;\n  grid-column: 1 / -1;\n  place-self: center;\n  padding: 24px;\n}\n\n.bKAdKG_rooms, .bKAdKG_members {\n  background: var(--dsw-alias-bg-layer-2);\n  min-height: 0;\n  padding: 8px 8px 16px;\n  overflow-y: auto;\n}\n\n.bKAdKG_groupTitle {\n  color: var(--dsw-alias-label-tertiary);\n  letter-spacing: .02em;\n  margin: 12px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.bKAdKG_room {\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  align-items: center;\n  gap: 6px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.bKAdKG_room:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_room:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.bKAdKG_workspace {\n  padding-left: 22px;\n  font-size: .95em;\n}\n\n.bKAdKG_roomLabel {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.bKAdKG_activeCount {\n  color: var(--dsw-alias-label-tertiary);\n  flex-shrink: 0;\n  margin-left: auto;\n  font-size: 11px;\n}\n\n.bKAdKG_activeBusy {\n  color: var(--dsw-alias-label-primary);\n}\n\n.bKAdKG_roomActive {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_hash {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 16px;\n}\n\n.bKAdKG_chat {\n  flex-direction: column;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n}\n\n.bKAdKG_chatHead {\n  -webkit-app-region: drag;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  align-items: center;\n  gap: 6px;\n  height: 44px;\n  padding: 0 16px;\n  font-weight: 600;\n  display: flex;\n}\n\n.bKAdKG_log {\n  flex: 1;\n  min-height: 0;\n  padding: 8px 0 12px;\n  overflow-y: auto;\n}\n\n.bKAdKG_guide {\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 10px;\n  margin: 16px;\n  padding: 14px 16px;\n  display: flex;\n}\n\n.bKAdKG_empty {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 24px 16px;\n}\n\n.bKAdKG_message {\n  grid-template-columns: 36px minmax(0, 1fr);\n  gap: 12px;\n  padding: 6px 16px;\n  display: grid;\n}\n\n.bKAdKG_message:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_system .bKAdKG_text {\n  color: var(--dsw-alias-label-tertiary);\n  font-style: italic;\n}\n\n.bKAdKG_avatar {\n  corner-shape: round;\n  color: #fff;\n  border-radius: 50%;\n  place-items: center;\n  width: 36px;\n  height: 36px;\n  font-weight: 700;\n  display: grid;\n  position: relative;\n}\n\n.bKAdKG_avatarImage {\n  object-fit: cover;\n  border-radius: 50%;\n  width: 100%;\n  height: 100%;\n  position: absolute;\n  inset: 0;\n}\n\n.bKAdKG_avatarSmall {\n  width: 28px;\n  height: 28px;\n  font-size: 12px;\n}\n\n.bKAdKG_avatarAnchor {\n  align-self: start;\n  position: relative;\n}\n\n.bKAdKG_avatarButton {\n  cursor: pointer;\n  background: none;\n  border: 0;\n  border-radius: 50%;\n  padding: 0;\n}\n\n.bKAdKG_avatarMenu {\n  z-index: 3;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  min-width: 140px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  top: calc(100% + 4px);\n  left: 0;\n}\n\n.bKAdKG_avatarMenuTitle {\n  padding: 4px 8px;\n  font-weight: 700;\n}\n\n.bKAdKG_avatarMenuItem {\n  border-radius: var(--dsw-radius-sm);\n  color: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 6px 8px;\n}\n\n.bKAdKG_avatarMenuItem:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_messageBody {\n  min-width: 0;\n}\n\n.bKAdKG_messageHead {\n  align-items: baseline;\n  gap: 6px;\n  display: flex;\n}\n\n.bKAdKG_author {\n  font-weight: 600;\n}\n\n.bKAdKG_time {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.bKAdKG_tag {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  white-space: nowrap;\n  padding: 0 4px;\n  font-size: 10px;\n  font-weight: 600;\n}\n\n.bKAdKG_edited {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n.bKAdKG_ownActions {\n  opacity: 0;\n  gap: 8px;\n  margin-left: auto;\n  display: inline-flex;\n}\n\n.bKAdKG_message:hover .bKAdKG_ownActions, .bKAdKG_ownActions:focus-within {\n  opacity: 1;\n}\n\n@media (hover: none) {\n  .bKAdKG_ownActions {\n    opacity: 1;\n  }\n}\n\n.bKAdKG_editBox {\n  flex-direction: column;\n  gap: 6px;\n  margin-top: 4px;\n  display: flex;\n}\n\n.bKAdKG_editInput {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  min-height: 60px;\n  color: inherit;\n  font: inherit;\n  resize: vertical;\n  padding: 8px;\n}\n\n.bKAdKG_editBar {\n  justify-content: flex-end;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.bKAdKG_editBar .bKAdKG_time {\n  margin-right: auto;\n}\n\n.bKAdKG_text {\n  white-space: normal;\n  overflow-wrap: anywhere;\n}\n\n.bKAdKG_card {\n  border-left: 4px solid var(--dsw-alias-state-business-primary);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-layer-2);\n  margin-top: 4px;\n  padding: 6px 10px;\n}\n\n.bKAdKG_card[data-state=\"failed\"] {\n  border-left-color: var(--dsw-alias-state-error-primary);\n}\n\n.bKAdKG_card[data-state=\"retrying\"] {\n  border-left-color: var(--dsw-alias-state-warning-primary, #faa61a);\n}\n\n.bKAdKG_cardButtons {\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.bKAdKG_cardTitle {\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.bKAdKG_cardHead {\n  justify-content: space-between;\n  align-items: center;\n  gap: 8px;\n  display: flex;\n}\n\n.bKAdKG_cardViews {\n  gap: 4px;\n  display: flex;\n}\n\n.bKAdKG_cardViewButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  color: inherit;\n  cursor: pointer;\n  background: none;\n  padding: 0 6px;\n  font-size: 12px;\n}\n\n.bKAdKG_cardViewButton[aria-pressed=\"true\"] {\n  background: var(--dsw-alias-bg-base);\n  font-weight: 600;\n}\n\n.bKAdKG_permActions {\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  margin-top: 6px;\n  display: flex;\n}\n\n.bKAdKG_permScope {\n  color: var(--dsw-alias-text-secondary);\n  flex-basis: 100%;\n  font-size: 12px;\n}\n\n.bKAdKG_permStatus {\n  margin-top: 6px;\n  font-size: 13px;\n  font-weight: 600;\n}\n\n.bKAdKG_message {\n  position: relative;\n}\n\n.bKAdKG_quote {\n  border-left: 2px solid var(--dsw-alias-label-tertiary);\n  min-width: 0;\n  color: var(--dsw-alias-label-tertiary);\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  gap: 6px;\n  margin-bottom: 2px;\n  padding-left: 8px;\n  font-size: 12px;\n  display: flex;\n  overflow: hidden;\n}\n\n.bKAdKG_quoteDeleted {\n  font-style: italic;\n}\n\n.bKAdKG_quoteAuthor {\n  flex: none;\n  font-weight: 600;\n}\n\n.bKAdKG_replyButton {\n  opacity: 0;\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  cursor: pointer;\n  border: 0;\n  padding: 0 6px;\n  position: absolute;\n  top: 4px;\n  right: 16px;\n}\n\n.bKAdKG_message:hover .bKAdKG_replyButton, .bKAdKG_message:focus-within .bKAdKG_replyButton, .bKAdKG_replyButton:focus-visible {\n  opacity: 1;\n}\n\n@media (hover: none) {\n  .bKAdKG_replyButton {\n    opacity: 1;\n  }\n}\n\n.bKAdKG_replyBar {\n  border-radius: var(--dsw-radius-sm);\n  color: var(--dsw-alias-label-tertiary);\n  background: var(--dsw-alias-bg-layer-2);\n  align-items: center;\n  gap: 8px;\n  margin-bottom: 6px;\n  padding: 4px 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.bKAdKG_replyBarText {\n  white-space: nowrap;\n  text-overflow: ellipsis;\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n}\n\n.bKAdKG_replyCancel {\n  color: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: none;\n}\n\n.bKAdKG_working {\n  min-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n  padding: 0 16px;\n  font-size: 12px;\n}\n\n.bKAdKG_composer {\n  padding: 0 16px 16px;\n  position: relative;\n}\n\n.bKAdKG_composerRow {\n  align-items: flex-end;\n  gap: 8px;\n  display: flex;\n}\n\n.bKAdKG_mentionButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  width: 40px;\n  height: 40px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-layer-2);\n  font: inherit;\n  cursor: pointer;\n  flex: none;\n  font-size: 18px;\n  font-weight: 600;\n}\n\n.bKAdKG_mentionButton:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_mentionButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.bKAdKG_mentionPopup {\n  z-index: 2;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-bg-base);\n  max-height: 320px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  flex-direction: column;\n  padding: 6px;\n  display: flex;\n  position: absolute;\n  bottom: calc(100% - 8px);\n  left: 16px;\n  right: 16px;\n}\n\n.bKAdKG_mentionPopup > [role=\"listbox\"] {\n  min-height: 0;\n  overflow-y: auto;\n}\n\n.bKAdKG_mentionTitle {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 4px 8px 6px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.bKAdKG_mentionItem {\n  border-radius: var(--dsw-radius-sm);\n  cursor: pointer;\n  align-items: center;\n  gap: 10px;\n  padding: 6px 8px;\n  display: flex;\n}\n\n.bKAdKG_mentionActive {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_mentionName {\n  font-weight: 600;\n}\n\n.bKAdKG_mentionMeta {\n  color: var(--dsw-alias-label-tertiary);\n  margin-left: auto;\n  font-size: 12px;\n}\n\n.bKAdKG_mentionHint {\n  border-top: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-tertiary);\n  padding: 6px 8px 2px;\n  font-size: 11px;\n}\n\n.bKAdKG_sendError {\n  color: var(--dsw-alias-state-error-primary);\n  margin-bottom: 6px;\n  font-size: 12px;\n}\n\n.bKAdKG_input {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-md);\n  width: 100%;\n  max-height: 40vh;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-layer-2);\n  font: inherit;\n  resize: none;\n  field-sizing: content;\n  padding: 10px 14px;\n}\n\n.bKAdKG_input:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.bKAdKG_member {\n  border-radius: var(--dsw-radius-sm);\n  min-width: 0;\n  color: inherit;\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  flex: 1;\n  align-items: center;\n  gap: 10px;\n  padding: 5px 8px;\n  display: flex;\n}\n\n.bKAdKG_member:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_member:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.bKAdKG_offline {\n  opacity: .5;\n}\n\n.bKAdKG_memberAvatar {\n  position: relative;\n}\n\n.bKAdKG_presence {\n  border: 2px solid var(--dsw-alias-bg-layer-2);\n  corner-shape: round;\n  background: #23a55a;\n  border-radius: 50%;\n  width: 10px;\n  height: 10px;\n  position: absolute;\n  bottom: -2px;\n  right: -2px;\n}\n\n.bKAdKG_offline .bKAdKG_presence {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.bKAdKG_memberText {\n  flex-direction: column;\n  min-width: 0;\n  display: flex;\n}\n\n.bKAdKG_memberName {\n  align-items: center;\n  gap: 6px;\n  display: flex;\n}\n\n.bKAdKG_memberStatus {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n}\n\n@media (width <= 900px) {\n  .bKAdKG_page {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .bKAdKG_rooms, .bKAdKG_members {\n    display: none;\n  }\n}\n\n.bKAdKG_groupHead {\n  justify-content: space-between;\n  align-items: center;\n  padding-right: 4px;\n  display: flex;\n}\n\n.bKAdKG_iconButton {\n  border-radius: var(--dsw-radius-sm);\n  width: 22px;\n  height: 22px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  font-size: 16px;\n  line-height: 1;\n}\n\n.bKAdKG_iconButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_roomInput, .bKAdKG_fieldInput {\n  box-sizing: border-box;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  font: inherit;\n  padding: 6px 8px;\n}\n\n.bKAdKG_roomInput {\n  margin: 2px 0 6px;\n}\n\n.bKAdKG_roomInput:focus-visible, .bKAdKG_fieldInput:focus-visible, .bKAdKG_iconButton:focus-visible, .bKAdKG_linkButton:focus-visible, .bKAdKG_addMemberButton:focus-visible, .bKAdKG_primaryButton:focus-visible, .bKAdKG_secondaryButton:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.bKAdKG_addMemberButton {\n  border: 1px dashed var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  width: 100%;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  margin: 4px 0;\n  padding: 7px 8px;\n}\n\n.bKAdKG_addMemberButton:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_memberRow {\n  border-radius: var(--dsw-radius-sm);\n  align-items: center;\n  display: flex;\n  position: relative;\n}\n\n.bKAdKG_memberRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_memberRow .bKAdKG_member:hover {\n  background: none;\n}\n\n.bKAdKG_memberModel {\n  color: var(--dsw-alias-label-tertiary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 11px;\n  overflow: hidden;\n}\n\n.bKAdKG_memberActions {\n  color: var(--dsw-alias-label-tertiary);\n  opacity: 0;\n  flex: none;\n  gap: 4px;\n  padding-right: 6px;\n  font-size: 12px;\n  display: flex;\n}\n\n.bKAdKG_memberRow:hover .bKAdKG_memberActions, .bKAdKG_memberRow:focus-within .bKAdKG_memberActions {\n  opacity: 1;\n}\n\n.bKAdKG_linkButton {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 2px 4px;\n  font-size: 12px;\n}\n\n.bKAdKG_linkButton:hover {\n  color: var(--dsw-alias-label-primary);\n  text-decoration: underline;\n}\n\n.bKAdKG_dialogBackdrop {\n  z-index: 10;\n  background: #00000073;\n  place-items: center;\n  padding: 16px;\n  display: grid;\n  position: fixed;\n  inset: 0;\n}\n\n.bKAdKG_dialog {\n  border-radius: var(--dsw-radius-lg);\n  width: min(460px, 100%);\n  max-height: calc(100vh - 32px);\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-base);\n  box-shadow: var(--dsw-elevation-panel, 0 12px 32px #0000004d);\n  flex-direction: column;\n  gap: 12px;\n  padding: 20px;\n  display: flex;\n  overflow-y: auto;\n}\n\n.bKAdKG_dialogTitle {\n  margin: 0;\n  font-size: 16px;\n}\n\n.bKAdKG_field {\n  color: var(--dsw-alias-label-secondary);\n  flex-direction: column;\n  gap: 4px;\n  font-size: 12px;\n  display: flex;\n}\n\n.bKAdKG_field textarea {\n  resize: vertical;\n}\n\n.bKAdKG_choiceRow {\n  flex-wrap: wrap;\n  gap: 12px;\n  display: flex;\n}\n\n.bKAdKG_choice {\n  color: var(--dsw-alias-label-primary, inherit);\n  cursor: pointer;\n  align-items: center;\n  gap: 4px;\n  font-size: 13px;\n  display: inline-flex;\n}\n\n.bKAdKG_dialogActions {\n  justify-content: flex-end;\n  gap: 8px;\n  display: flex;\n}\n\n.bKAdKG_primaryButton, .bKAdKG_secondaryButton {\n  border-radius: var(--dsw-radius-sm);\n  font: inherit;\n  cursor: pointer;\n  padding: 7px 14px;\n}\n\n.bKAdKG_primaryButton {\n  color: #fff;\n  background: var(--dsw-alias-state-business-primary);\n  border: 0;\n}\n\n.bKAdKG_primaryButton:disabled {\n  cursor: not-allowed;\n  opacity: .5;\n}\n\n.bKAdKG_secondaryButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  color: var(--dsw-alias-label-primary);\n  background: none;\n}\n\n.bKAdKG_memberFailed .bKAdKG_memberStatus {\n  color: var(--dsw-alias-state-error-primary, #ed4245);\n}\n\n.bKAdKG_memberFailed .bKAdKG_presence {\n  background: #ed4245;\n}\n\n.bKAdKG_mobileButton, .bKAdKG_drawerBackdrop {\n  display: none;\n}\n\n.bKAdKG_panelToggle {\n  border-radius: var(--dsw-radius-sm);\n  width: 28px;\n  height: 28px;\n  color: var(--dsw-alias-label-tertiary);\n  font: inherit;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  justify-content: center;\n  align-items: center;\n  font-size: 16px;\n  line-height: 1;\n  display: inline-flex;\n}\n\n.bKAdKG_panelToggle:hover {\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_panelToggle:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.bKAdKG_panelToggleEnd {\n  margin-left: auto;\n}\n\n.bKAdKG_capabilityMenu {\n  z-index: 4;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-base);\n  max-height: 260px;\n  box-shadow: var(--dsw-elevation-panel, 0 8px 24px #0000003d);\n  gap: 2px;\n  padding: 5px;\n  display: grid;\n  position: absolute;\n  bottom: calc(100% + 4px);\n  left: 0;\n  right: 0;\n  overflow-y: auto;\n}\n\n.bKAdKG_capabilityItem:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_capabilityHelp {\n  color: var(--dsw-alias-label-secondary);\n  white-space: normal;\n  margin: 6px;\n  font-size: 12px;\n}\n\n.bKAdKG_capabilityItem:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);\n}\n\n.bKAdKG_capabilityItem {\n  text-align: left;\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n  white-space: nowrap;\n  background: none;\n  border: 0;\n  padding: 5px 8px;\n  font-size: 12px;\n  font-weight: 400;\n}\n\n@media (width >= 901px) {\n  .bKAdKG_page.bKAdKG_roomsHidden {\n    grid-template-columns: minmax(0, 1fr) 240px;\n  }\n\n  .bKAdKG_page.bKAdKG_membersHidden {\n    grid-template-columns: 220px minmax(0, 1fr);\n  }\n\n  .bKAdKG_page.bKAdKG_roomsHidden.bKAdKG_membersHidden {\n    grid-template-columns: minmax(0, 1fr);\n  }\n\n  .bKAdKG_roomsHidden > .bKAdKG_rooms, .bKAdKG_membersHidden > .bKAdKG_members {\n    display: none;\n  }\n}\n\n@media (width <= 900px) {\n  .bKAdKG_page {\n    position: relative;\n    overflow: hidden;\n  }\n\n  .bKAdKG_mobileButton {\n    min-width: 40px;\n    min-height: 40px;\n    color: inherit;\n    font: inherit;\n    cursor: pointer;\n    background: none;\n    border: 0;\n    border-radius: 6px;\n    justify-content: center;\n    align-items: center;\n    display: inline-flex;\n  }\n\n  .bKAdKG_mobileButton:last-child {\n    margin-left: auto;\n  }\n\n  .bKAdKG_panelToggle {\n    display: none;\n  }\n\n  .bKAdKG_drawerBackdrop {\n    z-index: 4;\n    background: #00000073;\n    border: 0;\n    display: block;\n    position: absolute;\n    inset: 0;\n  }\n\n  .bKAdKG_rooms.bKAdKG_drawerOpen, .bKAdKG_members.bKAdKG_drawerOpen {\n    z-index: 5;\n    box-sizing: border-box;\n    width: min(280px, 85%);\n    display: block;\n    position: absolute;\n    top: 0;\n    bottom: 0;\n    box-shadow: 0 0 24px #0000004d;\n  }\n\n  .bKAdKG_rooms.bKAdKG_drawerOpen {\n    left: 0;\n  }\n\n  .bKAdKG_members.bKAdKG_drawerOpen {\n    right: 0;\n  }\n\n  .bKAdKG_memberActions {\n    opacity: 1;\n  }\n\n  .bKAdKG_messageHead {\n    flex-wrap: wrap;\n  }\n}\n\n.bKAdKG_avatarPicker {\n  flex-wrap: wrap;\n  gap: 8px;\n  display: flex;\n}\n\n.bKAdKG_avatarOption {\n  cursor: pointer;\n  background: none;\n  border: 2px solid #0000;\n  border-radius: 50%;\n  padding: 2px;\n  display: grid;\n}\n\n.bKAdKG_avatarOption[aria-checked=\"true\"] {\n  border-color: var(--dsw-alias-accent, #5865f2);\n}\n\n.bKAdKG_taskBoard {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  margin-bottom: 8px;\n  padding-bottom: 8px;\n}\n\n.bKAdKG_leadControl {\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n  margin: 0 0 10px;\n  padding: 0 8px 10px;\n}\n\n.bKAdKG_leadControl .bKAdKG_field {\n  color: var(--dsw-alias-label-tertiary);\n  gap: 5px;\n  font-size: 12px;\n}\n\n.bKAdKG_fieldLabel {\n  color: var(--dsw-alias-label-tertiary);\n  margin-bottom: 5px;\n  font-size: 12px;\n  display: block;\n}\n\n.bKAdKG_leadControl .bKAdKG_fieldInput {\n  width: 100%;\n  color: var(--dsw-alias-label-primary);\n  text-align: left;\n  cursor: pointer;\n}\n\n.bKAdKG_leadMenu {\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-bg-base);\n  gap: 2px;\n  margin-top: 4px;\n  padding: 4px;\n  display: grid;\n}\n\n.bKAdKG_leadOption {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n  text-align: left;\n  cursor: pointer;\n  background: none;\n  border: 0;\n  padding: 5px 8px;\n}\n\n.bKAdKG_leadOption:hover, .bKAdKG_leadOption[aria-selected=\"true\"] {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_taskSection + .bKAdKG_taskSection {\n  margin-top: 8px;\n}\n\n.bKAdKG_taskSectionTitle {\n  color: var(--dsw-alias-label-secondary);\n  margin: 0 0 4px;\n  padding: 0 8px;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.bKAdKG_taskOwnerGroup + .bKAdKG_taskOwnerGroup {\n  margin-top: 4px;\n}\n\n.bKAdKG_taskOwnerName {\n  color: var(--dsw-alias-label-tertiary);\n  padding: 0 8px;\n  font-size: 12px;\n}\n\n.bKAdKG_taskList {\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n\n.bKAdKG_taskRow {\n  border-radius: var(--dsw-radius-sm);\n  padding: 6px 8px;\n}\n\n.bKAdKG_taskRow:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.bKAdKG_taskLine {\n  align-items: center;\n  gap: 6px;\n  min-width: 0;\n  display: flex;\n}\n\n.bKAdKG_taskTitle {\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  font-size: 13px;\n  overflow: hidden;\n}\n\n.bKAdKG_taskMeta {\n  color: var(--dsw-alias-label-tertiary);\n  flex-wrap: wrap;\n  gap: 0 8px;\n  font-size: 12px;\n  display: flex;\n}\n\n.bKAdKG_taskLinks {\n  gap: 8px;\n  display: flex;\n}\n\n.bKAdKG_taskEmpty {\n  color: var(--dsw-alias-label-tertiary);\n  margin: 0 8px;\n  font-size: 12px;\n}\n\n.bKAdKG_taskDone summary {\n  cursor: pointer;\n}\n\n.bKAdKG_taskStatus {\n  border-radius: var(--dsw-radius-xs);\n  color: var(--dsw-alias-label-primary-inverted);\n  background: var(--dsw-alias-state-business-primary);\n  flex: none;\n  padding: 0 4px;\n  font-size: 10px;\n  font-style: normal;\n  font-weight: 600;\n}\n\n.bKAdKG_taskStatus[data-status=\"asked\"], .bKAdKG_taskStatus[data-status=\"escalated\"], .bKAdKG_taskStatus[data-status=\"declined\"], .bKAdKG_taskStatus[data-status=\"rework\"] {\n  background: var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-error-primary));\n}\n\n.bKAdKG_taskStatus[data-status=\"done\"] {\n  background: var(--dsw-alias-label-tertiary);\n}\n\n.bKAdKG_taskCard {\n  margin-top: 4px;\n  font-style: normal;\n}\n\n.bKAdKG_taskMembers {\n  margin: 4px 0 0;\n  padding: 0;\n  list-style: none;\n}\n\n.bKAdKG_taskMember {\n  align-items: center;\n  gap: 8px;\n  font-size: 13px;\n  display: flex;\n}\n\n.bKAdKG_taskMemberName {\n  font-weight: 600;\n}\n\n.bKAdKG_taskSub {\n  color: var(--dsw-alias-label-secondary);\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n.bKAdKG_focused {\n  background: var(--dsw-alias-interactive-bg-hover);\n  outline: 2px solid var(--dsw-alias-state-business-primary);\n}\n\n.bKAdKG_attachments {\n  flex-wrap: wrap;\n  gap: 6px;\n  margin: 4px 0;\n  display: flex;\n}\n\n.bKAdKG_attachmentImage {\n  border-radius: 4px;\n  max-width: min(320px, 100%);\n  max-height: 240px;\n  display: block;\n}\n\n.bKAdKG_attachmentThumb {\n  object-fit: cover;\n  vertical-align: middle;\n  border-radius: 3px;\n  width: 32px;\n  height: 32px;\n}\n\n.bKAdKG_attachmentFile {\n  background: var(--background-secondary, #7f7f7f26);\n  color: inherit;\n  border-radius: 4px;\n  align-items: center;\n  gap: 4px;\n  padding: 4px 8px;\n  text-decoration: none;\n  display: inline-flex;\n}\n\n.bKAdKG_attachmentSize {\n  opacity: .6;\n  font-size: .85em;\n}\n\n.bKAdKG_attachmentAudio {\n  flex-direction: column;\n  gap: 2px;\n  width: min(320px, 100%);\n  display: flex;\n}\n\n.bKAdKG_attachmentAudio audio {\n  width: 100%;\n}\n\n.bKAdKG_attachmentAudio a {\n  color: inherit;\n  text-decoration: none;\n}\n\n.bKAdKG_attachmentFile {\n  overflow-wrap: anywhere;\n  max-width: 100%;\n}\n\n.bKAdKG_chatHead button, .bKAdKG_chatHead input, .bKAdKG_chatHead select, .bKAdKG_chatHead a, .bKAdKG_chatHead [role=\"menu\"] {\n  -webkit-app-region: no-drag;\n}\n\n.bKAdKG_text pre, .bKAdKG_text table {\n  max-width: 100%;\n  overflow-x: auto;\n}\n";document.head.appendChild(s)})();
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");
let react = require("react");
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
/** Read a browser File into the POST form. */
const MAX_MESSAGE_BODY = 8388608;
/** Whether a message with these attachments would exceed the server's body cap (checked before sending). */
const messageTooLarge = (text, attachments) => new TextEncoder().encode(JSON.stringify({
	text,
	client_key: randomUUID(),
	reply_to: Number.MAX_SAFE_INTEGER,
	attachments
})).length > MAX_MESSAGE_BODY;
const readAttachment = async (file) => {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
	return {
		name: file.name || "pasted",
		mime: file.type || "application/octet-stream",
		data: btoa(binary)
	};
};
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
	leadId: null,
	tasks: [],
	taskChat: void 0,
	hasMoreOlder: false,
	outbox: []
};
/** Reconnect backoff: 1, 2, 4, 8… seconds, never beyond this cap. */
const MAX_BACKOFF_MS = 3e4;
/** Messages requested per page, both for the first read and for `loadOlder`. */
const PAGE_SIZE = 100;
/** Messages requested per catch-up read after a reconnect. */
const CATCH_UP_LIMIT = 200;
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
			const roomId = state.rooms.some((r) => r.id === previous.roomId) ? previous.roomId : state.rooms[0]?.id;
			const rows = [];
			let hasMoreOlder = false;
			if (roomId !== void 0) {
				if (resume && roomId === previous.roomId && previous.messages.length > 0) {
					const merged = new Map(previous.messages.map((m) => [m.id, m]));
					const oldest = previous.messages[0].id;
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
						cursor = next;
					}
					for (const id of [...merged.keys()]) if (id >= oldest && !present.has(id)) merged.delete(id);
					historyEpoch += 1;
					rows.push(...[...merged.values()].sort((a, b) => a.id - b.id));
					hasMoreOlder = previous.hasMoreOlder;
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
				rooms: state.rooms,
				roomId,
				members: state.members,
				thinking: state.thinking,
				messages: rows,
				hasMoreOlder,
				leadId: state.lead_id ?? null,
				effectiveLeadId: state.effective_lead_id ?? state.lead_id ?? null,
				tasks: keepBoard ? previous.tasks : [],
				taskChat: keepBoard ? previous.taskChat : void 0,
				outbox: outbox.filter((entry) => entry.roomId === roomId)
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
		historyEpoch += 1;
		if (roomId !== snapshot.roomId) earlyTasks.clear();
		const shown = outbox.filter((entry) => entry.roomId === roomId);
		set(roomId === snapshot.roomId ? {
			roomId,
			messages: [],
			outbox: shown
		} : {
			roomId,
			messages: [],
			outbox: shown,
			tasks: [],
			taskChat: void 0
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
		set({
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
	return {
		source,
		actions: {
			selectRoom,
			async send(text, replyTo, attachments) {
				const roomId = snapshot.roomId;
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
			async setDispatchMode(roomId, mode) {
				const result = await request(`collab/api/rooms/${roomId}/mode`, json("PATCH", { dispatch_mode: mode }));
				const chatId = snapshot.rooms.find((r) => r.id === roomId)?.parent_id ?? roomId;
				set({ rooms: snapshot.rooms.map((r) => r.id === chatId || r.parent_id === chatId ? {
					...r,
					...result
				} : r) });
			},
			async setLead(id) {
				const result = await request("collab/api/lead", json("PATCH", { lead_id: id }));
				if (lifetime !== void 0) onEvent({
					type: "lead",
					lead_id: result.lead_id,
					effective_lead_id: result.effective_lead_id
				});
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
					set({
						messages: [...merged.values()].sort((a, b) => a.id - b.id),
						hasMoreOlder: messages.length >= PAGE_SIZE
					});
					return messages.length;
				} finally {
					if (paging.get(roomId)?.ticket === ticket) paging.delete(roomId);
				}
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
// src/client/ChannelsPage.module.css
var ChannelsPage_module_default = {
	"activeBusy": "bKAdKG_activeBusy",
	"activeCount": "bKAdKG_activeCount",
	"addMemberButton": "bKAdKG_addMemberButton",
	"attachmentAudio": "bKAdKG_attachmentAudio",
	"attachmentFile": "bKAdKG_attachmentFile",
	"attachmentImage": "bKAdKG_attachmentImage",
	"attachments": "bKAdKG_attachments",
	"attachmentSize": "bKAdKG_attachmentSize",
	"attachmentThumb": "bKAdKG_attachmentThumb",
	"author": "bKAdKG_author",
	"avatar": "bKAdKG_avatar",
	"avatarAnchor": "bKAdKG_avatarAnchor",
	"avatarButton": "bKAdKG_avatarButton",
	"avatarImage": "bKAdKG_avatarImage",
	"avatarMenu": "bKAdKG_avatarMenu",
	"avatarMenuItem": "bKAdKG_avatarMenuItem",
	"avatarMenuTitle": "bKAdKG_avatarMenuTitle",
	"avatarOption": "bKAdKG_avatarOption",
	"avatarPicker": "bKAdKG_avatarPicker",
	"avatarSmall": "bKAdKG_avatarSmall",
	"capabilityHelp": "bKAdKG_capabilityHelp",
	"capabilityItem": "bKAdKG_capabilityItem",
	"capabilityMenu": "bKAdKG_capabilityMenu",
	"card": "bKAdKG_card",
	"cardButtons": "bKAdKG_cardButtons",
	"cardHead": "bKAdKG_cardHead",
	"cardTitle": "bKAdKG_cardTitle",
	"cardViewButton": "bKAdKG_cardViewButton",
	"cardViews": "bKAdKG_cardViews",
	"chat": "bKAdKG_chat",
	"chatHead": "bKAdKG_chatHead",
	"choice": "bKAdKG_choice",
	"choiceRow": "bKAdKG_choiceRow",
	"composer": "bKAdKG_composer",
	"composerRow": "bKAdKG_composerRow",
	"dialog": "bKAdKG_dialog",
	"dialogActions": "bKAdKG_dialogActions",
	"dialogBackdrop": "bKAdKG_dialogBackdrop",
	"dialogTitle": "bKAdKG_dialogTitle",
	"drawerBackdrop": "bKAdKG_drawerBackdrop",
	"drawerOpen": "bKAdKG_drawerOpen",
	"editBar": "bKAdKG_editBar",
	"editBox": "bKAdKG_editBox",
	"edited": "bKAdKG_edited",
	"editInput": "bKAdKG_editInput",
	"empty": "bKAdKG_empty",
	"field": "bKAdKG_field",
	"fieldInput": "bKAdKG_fieldInput",
	"fieldLabel": "bKAdKG_fieldLabel",
	"focused": "bKAdKG_focused",
	"groupHead": "bKAdKG_groupHead",
	"groupTitle": "bKAdKG_groupTitle",
	"guide": "bKAdKG_guide",
	"hash": "bKAdKG_hash",
	"iconButton": "bKAdKG_iconButton",
	"input": "bKAdKG_input",
	"leadControl": "bKAdKG_leadControl",
	"leadMenu": "bKAdKG_leadMenu",
	"leadOption": "bKAdKG_leadOption",
	"linkButton": "bKAdKG_linkButton",
	"log": "bKAdKG_log",
	"member": "bKAdKG_member",
	"memberActions": "bKAdKG_memberActions",
	"memberAvatar": "bKAdKG_memberAvatar",
	"memberFailed": "bKAdKG_memberFailed",
	"memberModel": "bKAdKG_memberModel",
	"memberName": "bKAdKG_memberName",
	"memberRow": "bKAdKG_memberRow",
	"members": "bKAdKG_members",
	"membersHidden": "bKAdKG_membersHidden",
	"memberStatus": "bKAdKG_memberStatus",
	"memberText": "bKAdKG_memberText",
	"mentionActive": "bKAdKG_mentionActive",
	"mentionButton": "bKAdKG_mentionButton",
	"mentionHint": "bKAdKG_mentionHint",
	"mentionItem": "bKAdKG_mentionItem",
	"mentionMeta": "bKAdKG_mentionMeta",
	"mentionName": "bKAdKG_mentionName",
	"mentionPopup": "bKAdKG_mentionPopup",
	"mentionTitle": "bKAdKG_mentionTitle",
	"message": "bKAdKG_message",
	"messageBody": "bKAdKG_messageBody",
	"messageHead": "bKAdKG_messageHead",
	"mobileButton": "bKAdKG_mobileButton",
	"notice": "bKAdKG_notice",
	"offline": "bKAdKG_offline",
	"ownActions": "bKAdKG_ownActions",
	"page": "bKAdKG_page",
	"panelToggle": "bKAdKG_panelToggle",
	"panelToggleEnd": "bKAdKG_panelToggleEnd",
	"permActions": "bKAdKG_permActions",
	"permScope": "bKAdKG_permScope",
	"permStatus": "bKAdKG_permStatus",
	"presence": "bKAdKG_presence",
	"primaryButton": "bKAdKG_primaryButton",
	"quote": "bKAdKG_quote",
	"quoteAuthor": "bKAdKG_quoteAuthor",
	"quoteDeleted": "bKAdKG_quoteDeleted",
	"replyBar": "bKAdKG_replyBar",
	"replyBarText": "bKAdKG_replyBarText",
	"replyButton": "bKAdKG_replyButton",
	"replyCancel": "bKAdKG_replyCancel",
	"room": "bKAdKG_room",
	"roomActive": "bKAdKG_roomActive",
	"roomInput": "bKAdKG_roomInput",
	"roomLabel": "bKAdKG_roomLabel",
	"rooms": "bKAdKG_rooms",
	"roomsHidden": "bKAdKG_roomsHidden",
	"secondaryButton": "bKAdKG_secondaryButton",
	"sendError": "bKAdKG_sendError",
	"system": "bKAdKG_system",
	"tag": "bKAdKG_tag",
	"taskBoard": "bKAdKG_taskBoard",
	"taskCard": "bKAdKG_taskCard",
	"taskDone": "bKAdKG_taskDone",
	"taskEmpty": "bKAdKG_taskEmpty",
	"taskLine": "bKAdKG_taskLine",
	"taskLinks": "bKAdKG_taskLinks",
	"taskList": "bKAdKG_taskList",
	"taskMember": "bKAdKG_taskMember",
	"taskMemberName": "bKAdKG_taskMemberName",
	"taskMembers": "bKAdKG_taskMembers",
	"taskMeta": "bKAdKG_taskMeta",
	"taskOwnerGroup": "bKAdKG_taskOwnerGroup",
	"taskOwnerName": "bKAdKG_taskOwnerName",
	"taskRow": "bKAdKG_taskRow",
	"taskSection": "bKAdKG_taskSection",
	"taskSectionTitle": "bKAdKG_taskSectionTitle",
	"taskStatus": "bKAdKG_taskStatus",
	"taskSub": "bKAdKG_taskSub",
	"taskTitle": "bKAdKG_taskTitle",
	"text": "bKAdKG_text",
	"time": "bKAdKG_time",
	"working": "bKAdKG_working",
	"workspace": "bKAdKG_workspace"
};
// src/client/Attachments.tsx
const isImage = (mime) => /^image\/(png|jpeg|gif|webp)$/.test(mime);
const isAudio = (mime) => mime.startsWith("audio/");
const size = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
/** Thumbnails for images, a download card for other files. */
function AttachmentList({ attachments }) {
	if (attachments === void 0 || attachments.length === 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.attachments,
		children: attachments.map((a) => isImage(a.mime) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
			href: attachmentUrl(a.id),
			target: "_blank",
			rel: "noreferrer",
			title: a.name,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				className: ChannelsPage_module_default.attachmentImage,
				src: attachmentUrl(a.id),
				alt: a.name,
				loading: "lazy"
			})
		}, a.id) : isAudio(a.mime) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: ChannelsPage_module_default.attachmentAudio,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("audio", {
				controls: true,
				preload: "metadata",
				src: attachmentUrl(a.id),
				title: a.name
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
				className: ChannelsPage_module_default.attachmentSize,
				href: attachmentUrl(a.id),
				download: a.name,
				children: [
					a.name,
					" · ",
					size(a.size)
				]
			})]
		}, a.id) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
			className: ChannelsPage_module_default.attachmentFile,
			href: attachmentUrl(a.id),
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
function useComposerAttachments(add, onError) {
	const inputRef = (0, react.useRef)(null);
	const take = (files) => {
		if (files.length === 0) return;
		Promise.all(files.map(readAttachment)).then(add).catch((error) => {
			onError(error instanceof Error ? error.message : String(error));
		});
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
				children: "📎"
			})] });
		}
	};
}
/** Files waiting to be sent with the next message. */
function PendingAttachments({ files, onRemove, removeLabel }) {
	if (files.length === 0) return null;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: ChannelsPage_module_default.attachments,
		children: files.map((f, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: ChannelsPage_module_default.attachmentFile,
			children: [
				isImage(f.mime) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: ChannelsPage_module_default.attachmentThumb,
					src: `data:${f.mime};base64,${f.data}`,
					alt: f.name
				}) : "📎",
				" ",
				f.name,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: ChannelsPage_module_default.replyCancel,
					title: removeLabel,
					"aria-label": removeLabel,
					onClick: () => onRemove(i),
					children: "×"
				})
			]
		}, `${i}-${f.name}`))
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
	}, ...rooms.filter((r) => r.kind === "workspace" && r.parent_id === chatId).map((r) => ({
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
			(task.status === "done" ? group.done : group.open).push(task);
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
function TaskBoard({ tasks, rooms, chatId, roomId, t, onOpen }) {
	const now = Date.now() / 1e3;
	const sections = boardSections(tasks, rooms, chatId, roomId);
	const openTotal = sections.reduce((n, s) => n + s.open, 0);
	const all = sections.reduce((n, s) => n + s.open + s.done, 0);
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
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskElapsed", { d: formatDuration(elapsed(task, now), t) }) }), task.next_check_at !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("taskNextCheck", { time: clock(task.next_check_at) }) })]
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
				children: t("taskBoardTitle", { count: String(openTotal) })
			}),
			all === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: ChannelsPage_module_default.taskEmpty,
				children: t("taskBoardEmpty")
			}),
			sections.map((section) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ChannelsPage_module_default.taskSection,
				"data-room-id": section.roomId,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
					className: ChannelsPage_module_default.taskSectionTitle,
					children: sectionTitle(section, t)
				}), section.owners.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: ChannelsPage_module_default.taskOwnerGroup,
					"data-owner": group.owner,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: ChannelsPage_module_default.taskOwnerName,
							children: t("taskBoardOwner", { name: group.ownerName })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: ChannelsPage_module_default.taskList,
							children: group.open.map(row)
						}),
						group.done.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: ChannelsPage_module_default.taskDone,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
								className: ChannelsPage_module_default.groupTitle,
								children: t("taskDoneGroup", { count: String(group.done.length) })
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: ChannelsPage_module_default.taskList,
								children: group.done.map(row)
							})]
						})
					]
				}, group.owner))]
			}, section.roomId))
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
// src/client/CapabilityList.tsx
/** On-demand help for existing capabilities; selecting help never executes an action. */
const CAPABILITIES = [
	["capabilityTaskBoard", "capabilityTaskBoardHelp"],
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
function MessageRow({ message, member, t, onConfigure, menuOpen, onAvatar, onCloseMenu, onMention, onDecide, onReply, onRetry, retrying, tasks, focused, cardView, onCardView, own }) {
	const labels = (0, react.useMemo)(() => ({
		code: {
			copyLabel: t("copyCode"),
			copiedLabel: t("copiedCode")
		},
		footnotes: t("footnotes")
	}), [t]);
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
							}),
							message.edited_at !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.edited,
								title: (/* @__PURE__ */ new Date(message.edited_at * 1e3)).toLocaleString(),
								children: t("messageEdited")
							}),
							own !== void 0 && own.editing === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: ChannelsPage_module_default.ownActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
								} else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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
					}) : card === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [message.text !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.text,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
							text: message.text,
							labels
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AttachmentList, { attachments: message.attachments })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.card,
						"data-state": card.state,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ChannelsPage_module_default.cardHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ChannelsPage_module_default.cardTitle,
									children: card.title
								}), typeof card.brief === "string" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ChannelsPage_module_default.text,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
									text: typeof card.brief === "string" && cardView === "brief" ? card.brief : message.text,
									labels
								})
							}),
							(card.state === "failed" || card.action === "configure-model") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
function ChannelsPage({ useChannels, selectRoom, send, createRoom, listModels, listClis, addMember, updateMember, removeMember, setLead, setDispatchMode, decidePermission, retryMessage, editMessage, withdrawMessage, openModelSettings, t }) {
	const state = useChannels((snapshot) => snapshot);
	const [editing, setEditing] = (0, react.useState)(void 0);
	const [ownNotice, setOwnNotice] = (0, react.useState)(void 0);
	const [drafts, setDrafts] = (0, react.useState)({});
	const [errors, setErrors] = (0, react.useState)({});
	const [sending, setSending] = (0, react.useState)({});
	const [replies, setReplies] = (0, react.useState)({});
	const [pendingFiles, setPendingFiles] = (0, react.useState)({});
	const attach = useComposerAttachments((files) => {
		const roomId = state.roomId;
		if (roomId === void 0) return;
		const next = [...pendingFiles[roomId] ?? [], ...files];
		if (messageTooLarge(drafts[roomId] ?? "", next)) {
			setErrors((previous) => ({
				...previous,
				[roomId]: t("attachmentsTooLarge", { limit: `${MAX_MESSAGE_BODY / 1024 / 1024} MiB` })
			}));
			return;
		}
		setPendingFiles((previous) => ({
			...previous,
			[roomId]: next
		}));
	}, (message) => {
		const roomId = state.roomId;
		if (roomId !== void 0) setErrors((previous) => ({
			...previous,
			[roomId]: t("sendFailed", { message })
		}));
	});
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
	const [retryingId, setRetryingId] = (0, react.useState)(void 0);
	const [modeSaving, setModeSaving] = (0, react.useState)(false);
	const [modeError, setModeError] = (0, react.useState)(void 0);
	const [leadSaving, setLeadSaving] = (0, react.useState)(false);
	const [leadOpen, setLeadOpen] = (0, react.useState)(false);
	const [capabilitiesDismissed, setCapabilitiesDismissed] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		setCapabilitiesDismissed(false);
	}, [state.roomId]);
	const composerRef = (0, react.useRef)(null);
	const openMentionAt = (0, react.useRef)(void 0);
	(0, react.useEffect)(() => {
		const onPress = (event) => {
			const at = openMentionAt.current;
			if (composerRef.current?.contains(event.target) === true) return;
			if (at !== void 0) setDismissedAt(at);
			if (draft === "/" && !capabilitiesDismissed) setCapabilitiesDismissed(true);
		};
		document.addEventListener("mousedown", onPress);
		return () => {
			document.removeEventListener("mousedown", onPress);
		};
	}, [draft, capabilitiesDismissed]);
	(0, react.useEffect)(() => {
		const input = inputRef.current;
		const next = pendingCaret.current;
		if (input === null || next === void 0) return;
		pendingCaret.current = void 0;
		input.focus();
		input.setSelectionRange(next, next);
	});
	const [avatarMenu, setAvatarMenu] = (0, react.useState)(void 0);
	const [cardViews, setCardViews] = (0, react.useState)({});
	const cardView = state.roomId === void 0 ? CARD_VIEW_DEFAULT : cardViews[state.roomId] ?? loadCardView(state.roomId);
	const chooseCardView = (view) => {
		if (state.roomId === void 0) return;
		const roomId = state.roomId;
		saveCardView(roomId, view);
		setCardViews((views) => ({
			...views,
			[roomId]: view
		}));
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
	const openTaskOwners = new Set((state.tasks ?? []).filter((t) => [
		"assigned",
		"accepted",
		"asked",
		"rework"
	].includes(t.status)).map((t) => t.owner));
	const busy = /* @__PURE__ */ new Set([...state.roomId === void 0 ? [] : state.thinking[String(state.roomId)] ?? [], ...openTaskOwners]);
	const byId = new Map(state.members.map((m) => [m.id, m]));
	const typingNames = (state.roomId === void 0 ? [] : state.thinking[String(state.roomId)] ?? []).map((id) => byId.get(id)?.name ?? id);
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
	const ownActions = (m) => {
		if (m.author_kind !== "user" || m.card !== null) return void 0;
		return {
			editing: editing?.id === m.id ? editing.text : void 0,
			onStartEdit: () => {
				setOwnNotice(void 0);
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
			},
			onEditSave: () => {
				if (editing?.id !== m.id || !editing.text.trim()) return;
				if (editing.text === m.text) {
					setEditing(void 0);
					return;
				}
				editMessage(m.id, editing.text).then(() => {
					setEditing(void 0);
				}, (error) => {
					setOwnNotice(error instanceof Error ? error.message : String(error));
				});
			},
			onWithdraw: () => {
				if (!window.confirm(t("withdrawConfirm"))) return;
				setOwnNotice(void 0);
				withdrawMessage(m.id).then(({ stopped, stillRunning }) => {
					const notes = [...stopped.length > 0 ? [t("withdrawStopped", { names: stopped.join("、") })] : [], ...stillRunning.length > 0 ? [t("withdrawRunning", { names: stillRunning.join("、") })] : []];
					if (notes.length > 0) setOwnNotice(notes.join("；"));
				}, (error) => {
					setOwnNotice(error instanceof Error ? error.message : String(error));
				});
			}
		};
	};
	const confirmRemove = (member) => {
		if (!window.confirm(t("removeConfirm", { name: member.name }))) return;
		setMemberError(void 0);
		removeMember(member.id).catch((error) => {
			setMemberError(error instanceof Error ? error.message : String(error));
		});
	};
	const changeLead = (id) => {
		setLeadOpen(false);
		if (!id || id === state.leadId || leadSaving) return;
		setMemberError(void 0);
		setLeadSaving(true);
		setLead(id).catch((error) => {
			setMemberError(error instanceof Error ? error.message : String(error));
		}).finally(() => {
			setLeadSaving(false);
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
	const submit = () => {
		const roomId = state.roomId;
		const text = draft.trim();
		const files = roomId === void 0 ? [] : pendingFiles[roomId] ?? [];
		if (!text && files.length === 0 || roomId === void 0 || pendingRooms.current.has(roomId)) return;
		if (files.length > 0 && messageTooLarge(text, files)) {
			setErrors((previous) => ({
				...previous,
				[roomId]: t("attachmentsTooLarge", { limit: `${MAX_MESSAGE_BODY / 1024 / 1024} MiB` })
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
		const replyTo = replies[roomId]?.id;
		(files.length > 0 ? send(text, replyTo, files) : replyTo === void 0 ? send(text) : send(text, replyTo)).then(() => {
			setDrafts((previous) => ({
				...previous,
				[roomId]: ""
			}));
			setPendingFiles((previous) => ({
				...previous,
				[roomId]: []
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
		if (draft === "/" && !capabilitiesDismissed && !event.nativeEvent.isComposing) {
			if (event.key === "Escape") {
				event.preventDefault();
				setCapabilitiesDismissed(true);
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				return;
			}
		}
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
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: [
								ChannelsPage_module_default.room,
								depth === 1 ? ChannelsPage_module_default.workspace : "",
								r.id === state.roomId ? ChannelsPage_module_default.roomActive : ""
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
						}) : state.messages.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageRow, {
							message: m,
							member: byId.get(m.author),
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
							onDecide: decidePermission,
							onRetry: handleRetry,
							retrying: retryingId === m.id,
							tasks: state.tasks ?? [],
							focused: focusedId === m.id,
							onReply: startReply,
							own: ownActions(m)
						}, m.id))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ChannelsPage_module_default.working,
						"aria-live": "polite",
						children: typingNames.length > 0 ? t("workingList", { names: typingNames.join("、") }) : ""
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.composer,
						ref: composerRef,
						children: [
							draft === "/" && !capabilitiesDismissed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CapabilityList, {
								t,
								onClose: () => {
									setCapabilitiesDismissed(true);
								}
							}, state.roomId),
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
							state.roomId !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PendingAttachments, {
								files: pendingFiles[state.roomId] ?? [],
								removeLabel: t("removeAttachment"),
								onRemove: (index) => {
									const roomId = state.roomId;
									setPendingFiles((previous) => ({
										...previous,
										[roomId]: (previous[roomId] ?? []).filter((_, i) => i !== index)
									}));
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ChannelsPage_module_default.composerRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
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
											setCapabilitiesDismissed(false);
											setCaret(event.target.selectionStart);
											setHighlight(0);
										},
										onSelect: (event) => {
											setCaret(event.currentTarget.selectionStart);
										},
										onKeyDown,
										onPaste: attach.onPaste,
										onDragOver: attach.onDragOver,
										onDrop: attach.onDrop
									}),
									attach.button(t("attachButton"), state.roomId === void 0 || sending[state.roomId] === true),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ChannelsPage_module_default.mentionButton,
										title: t("mentionButton"),
										"aria-label": t("mentionButton"),
										disabled: state.roomId === void 0 || sending[state.roomId] === true,
										onClick: openPicker,
										children: "@"
									})
								]
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
						roomId: state.roomId,
						t,
						onOpen: openMessage
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ChannelsPage_module_default.leadControl,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: ChannelsPage_module_default.fieldLabel,
								children: t("lead")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ChannelsPage_module_default.fieldInput,
								"aria-haspopup": "listbox",
								"aria-expanded": leadOpen,
								"aria-label": t("lead"),
								disabled: leadSaving || state.members.every((m) => m.kind === "human"),
								onClick: () => {
									setLeadOpen(!leadOpen);
								},
								children: state.members.find((m) => m.id === (state.effectiveLeadId ?? state.leadId))?.name ?? t("leadNone")
							}),
							leadOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: ChannelsPage_module_default.leadMenu,
								role: "listbox",
								"aria-label": t("lead"),
								children: state.members.filter((m) => m.kind !== "human").map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									role: "option",
									"aria-selected": m.id === state.leadId,
									className: ChannelsPage_module_default.leadOption,
									onClick: () => {
										changeLead(m.id);
									},
									children: m.name
								}, m.id))
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
						disabled: modeSaving || state.roomId === void 0,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: t("dispatchMode") }), [
							"solo",
							"team",
							"mixed"
						].map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: { display: "block" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "radio",
								name: "dispatch-mode",
								value: mode,
								checked: (state.rooms.find((r) => r.id === state.roomId)?.dispatch_mode ?? "mixed") === mode,
								onChange: () => {},
								onClick: () => {
									const roomId = state.roomId;
									if (roomId === void 0) return;
									setModeSaving(true);
									setModeError(void 0);
									setDispatchMode(roomId, mode).catch((error) => {
										setModeError(error instanceof Error ? error.message : String(error));
									}).finally(() => {
										setModeSaving(false);
									});
								}
							}), t(mode === "solo" ? "dispatchSolo" : mode === "team" ? "dispatchTeam" : "dispatchMixed")]
						}, mode))]
					}),
					modeError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "alert",
						children: modeError
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
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("configureModelHint") })]
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
	copyCode: "复制代码",
	copiedCode: "已复制",
	footnotes: "脚注",
	panel: "频道",
	capabilities: "能力清单",
	capabilityTaskBoard: "任务板",
	capabilityLater: "过会儿回来",
	capabilityReminder: "催办",
	capabilityWorkspace: "工作区",
	capabilityLead: "换主角色",
	capabilityDm: "私信",
	capabilityTaskBoardHelp: "在右侧任务板查看负责人、状态和下次查看时间，点「派工消息」或「交回消息」回到对应记录。",
	capabilityLaterHelp: "告诉角色何时回来、回来做什么，例如「十分钟后回来检查测试结果」。",
	capabilityReminderHelp: "通过任务分发派出的任务，到点会自动催办一次；负责人交回结果或说明卡在哪里。",
	capabilityWorkspaceHelp: "在聊天频道把任务交给角色，需要时由角色创建工作区。工作区的问题和阶段结果会送回聊天频道。",
	capabilityLeadHelp: "在成员栏的「主角色」里选择角色。切换后，没有点名的消息由新的主角色接收。",
	capabilityDmHelp: "在支持私信的平台打开与角色的私聊。角色也可向配置中的用户发送私信；DSH 频道页目前没有私信入口。",
	taskBoard: "任务板",
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
	taskRework: "返工",
	taskIn: "在 #{room}",
	taskElapsed: "用时 {d}",
	taskNextCheck: "下次看 {time}",
	taskOpenAssign: "派工消息",
	taskOpenResult: "交回消息",
	dispatchMode: "派活方式",
	dispatchSolo: "单模型多进程 — 同一模型分开处理任务",
	dispatchTeam: "完全团队 — 交给团队成员协作",
	dispatchMixed: "混合 — 按任务选择模型与成员",
	lead: "主角色",
	leadNone: "未选择（按原配置）",
	durSeconds: "{n} 秒",
	durMinutes: "{n} 分钟",
	durHours: "{h} 小时 {m} 分",
	configureModel: "去配置模型",
	configureModelHint: "模型在「设置 → 模型」里配置：点侧栏底部的设置入口，桌面版也可按 ⌘,（Windows/Linux 为 Ctrl+,）。",
	retry: "重试",
	retrying: "重试中…",
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
	attachButton: "添加图片或文件",
	removeAttachment: "移除附件",
	attachmentsTooLarge: "附件太大：一条消息合计不能超过 {limit}",
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
	withdrawStopped: "已撤回，并停下了 {names} 对它的处理",
	withdrawRunning: "已撤回；{names} 已经在处理这条，没能停下",
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
	cardView: "卡片视图",
	cardViewDetail: "细节",
	cardViewBrief: "简略",
	replyingTo: "回复 {name}",
	replyDeleted: "原消息已删除",
	cancelReply: "取消回复"
};
/** English dictionary. */
const en = {
	dispatchMode: "Dispatch mode",
	dispatchSolo: "Single model, multiple processes — separate tasks on one model",
	dispatchTeam: "Full team — delegate to team members",
	dispatchMixed: "Mixed — choose models and members for each task",
	copyCode: "Copy code",
	copiedCode: "Copied",
	footnotes: "Footnotes",
	taskBoard: "Task board",
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
	taskRework: "Rework",
	taskIn: "in #{room}",
	taskElapsed: "took {d}",
	taskNextCheck: "next check {time}",
	taskOpenAssign: "Dispatch",
	taskOpenResult: "Delivery",
	lead: "Primary role",
	leadNone: "No role is available",
	durSeconds: "{n}s",
	durMinutes: "{n} min",
	durHours: "{h} h {m} min",
	panel: "Channels",
	capabilities: "Capabilities",
	capabilityTaskBoard: "Task board",
	capabilityLater: "Come back later",
	capabilityReminder: "Reminders",
	capabilityWorkspace: "Workspaces",
	capabilityLead: "Primary role",
	capabilityDm: "Direct messages",
	capabilityTaskBoardHelp: "View owners, status and next-check times in the task board on the right. Open Dispatch or Delivery to jump to its message.",
	capabilityLaterHelp: "Tell a role when to return and what to do, for example “Check the test results in ten minutes.”",
	capabilityReminderHelp: "Dispatched tasks receive one reminder when due. The owner returns a result or explains the blocker.",
	capabilityWorkspaceHelp: "Assign work to a role in the chat channel. Roles create workspaces when needed; questions and progress return to the chat channel.",
	capabilityLeadHelp: "Choose a role under Primary role in the members panel. Messages without an explicit addressee then go to the new primary role.",
	capabilityDmHelp: "Open a private conversation with a role on a supported platform. Roles can also message the configured owner. The DSH Channels page currently has no private-chat entry.",
	configureModel: "Configure model",
	configureModelHint: "Models are configured in Settings → Models: use the settings entry at the bottom of the sidebar, or press ⌘, in the desktop app (Ctrl+, on Windows/Linux).",
	retry: "Retry",
	retrying: "Retrying…",
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
	attachButton: "Attach images or files",
	removeAttachment: "Remove attachment",
	attachmentsTooLarge: "Attachments too large: one message can carry at most {limit} in total",
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
	withdrawStopped: "Withdrawn, and stopped {names} working on it",
	withdrawRunning: "Withdrawn; {names} had already started on it and could not be stopped",
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
	cardView: "Card view",
	cardViewDetail: "Detail",
	cardViewBrief: "Brief",
	replyingTo: "Replying to {name}",
	replyDeleted: "Original message was deleted",
	cancelReply: "Cancel reply"
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
	const injected = (openModelSettings) => ({
		openModelSettings,
		hooks: { channels: channels.source },
		selectRoom: channels.actions.selectRoom,
		send: channels.actions.send,
		retrySend: channels.actions.retrySend,
		dismissSend: channels.actions.dismissSend,
		loadOlder: channels.actions.loadOlder,
		createRoom: channels.actions.createRoom,
		listModels: channels.actions.listModels,
		listClis: channels.actions.listClis,
		addMember: channels.actions.addMember,
		updateMember: channels.actions.updateMember,
		removeMember: channels.actions.removeMember,
		setDispatchMode: channels.actions.setDispatchMode,
		setLead: channels.actions.setLead,
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
		if (location.hash === `#${PANEL_ID}`) ctx.layout.selectPanel(PANEL_ID);
		return () => {
			unsubscribe();
			disposePanel?.();
		};
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
